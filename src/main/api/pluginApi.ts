import type { IncomingMessage, ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { PluginManager, PluginRequestCtx } from '../plugin/manager'
import { decodeZipPayload } from '../plugin/manager'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

function queryOf(url: URL): Record<string, string> {
  const q: Record<string, string> = {}
  url.searchParams.forEach((v, k) => {
    q[k] = v
  })
  return q
}

function headersOf(req: IncomingMessage): Record<string, string | string[] | undefined> {
  return { ...req.headers }
}

function contentTypeFor(file: string): string {
  const e = extname(file).toLowerCase()
  if (e === '.js') return 'application/javascript; charset=utf-8'
  if (e === '.css') return 'text/css; charset=utf-8'
  if (e === '.html' || e === '.htm') return 'text/html; charset=utf-8'
  if (e === '.json') return 'application/json; charset=utf-8'
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.svg') return 'image/svg+xml'
  if (e === '.wasm') return 'application/wasm'
  if (e === '.webmanifest') return 'application/manifest+json'
  if (e === '.woff2') return 'font/woff2'
  return 'application/octet-stream'
}

function escapeAttr(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 插件页 HTML：注入 JWT、补全静态资源绝对路径（供 iframe src 真实 URL 加载） */
export function preparePluginPageHtml(html: string, jwt: string, apiOrigin: string): string {
  let page = String(html || '')
  const safeOrigin = apiOrigin && /^https?:\/\//i.test(apiOrigin) ? apiOrigin.replace(/\/$/, '') : ''
  const token = String(jwt || '')
  page = page.replace(
    /<html(\s[^>]*)?>/i,
    (m) => m.replace(/>$/, '') + ` data-hanye-jwt="${escapeAttr(token)}" data-hanye-api="${escapeAttr(safeOrigin)}">`
  )
  if (safeOrigin) {
    page = page.replace(/(src=["'])(\/api\/v1\/plugins\/)/gi, `$1${safeOrigin}$2`)
    page = page.replace(/(href=["'])(\/api\/v1\/plugins\/)/gi, `$1${safeOrigin}$2`)
  }
  return page
}

function isPluginHttp(data: unknown): data is {
  __pluginHttp: {
    status?: number
    headers?: Record<string, string>
    body?: string
    json?: unknown
  }
} {
  return Boolean(
    data &&
      typeof data === 'object' &&
      '__pluginHttp' in data &&
      (data as { __pluginHttp?: unknown }).__pluginHttp &&
      typeof (data as { __pluginHttp: unknown }).__pluginHttp === 'object'
  )
}

async function runCustomRoute(
  hit: NonNullable<ReturnType<PluginManager['matchCustomRoute']>>,
  opts: {
    method: string
    path: string
    url: URL
    req: IncomingMessage
    res: ServerResponse
    sendJson: SendJson
    readBody: ReadBody
    auth: unknown
    pm?: PluginManager | null
  }
): Promise<void> {
  const { method, path, url, req, res, sendJson, readBody, auth, pm } = opts
  const ctx: PluginRequestCtx = {
    method,
    path,
    url,
    query: queryOf(url),
    headers: headersOf(req),
    auth
  }
  let rawBody = ''
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    rawBody = await readBody(req)
    try {
      ctx.body = rawBody ? JSON.parse(rawBody) : {}
    } catch {
      ctx.body = { raw: rawBody }
    }
    ;(ctx as { rawBody?: string }).rawBody = rawBody
  }
  if (pm && hit.route.public) {
    const before = (await pm.runHook('filter:http.callback.before', {
      proceed: true,
      pluginId: hit.route.identifier,
      path,
      method,
      req: ctx
    })) as { proceed?: boolean; status?: number; body?: unknown }
    // also short name via resolve
    if (before && before.proceed === false) {
      sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'callback blocked' })
      return
    }
  }
  const data = await hit.route.handler(ctx, hit.api)
  if (isPluginHttp(data)) {
    const h = data.__pluginHttp
    const headers: Record<string, string> = { ...(h.headers || {}) }
    let body = h.body ?? ''
    if (h.json !== undefined) {
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json; charset=utf-8'
      }
      body = JSON.stringify(h.json)
    }
    res.writeHead(h.status || 200, headers)
    res.end(body)
    return
  }
  sendJson(res, 200, { ok: true, data })
}

export async function handlePluginApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  auth: unknown
  isAdmin: boolean
  getPluginManager: () => PluginManager | null
  /** Only match registerRoute(..., { public: true }) */
  publicCustomOnly?: boolean
}): Promise<boolean> {
  const {
    method,
    path,
    url,
    req,
    res,
    sendJson,
    readBody,
    auth,
    isAdmin,
    getPluginManager,
    publicCustomOnly
  } = opts
  const pm = getPluginManager()

  // Public plugin assets (login UI / theme / client scripts) — no JWT
  const assetMatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/asset\/(.+)$/)
  if (method === 'GET' && assetMatch) {
    if (!pm) {
      sendJson(res, 503, { ok: false, message: '插件系统未启动' })
      return true
    }
    const file = pm.resolvePluginAsset(
      decodeURIComponent(assetMatch[1]),
      decodeURIComponent(assetMatch[2])
    )
    if (!file || !existsSync(file)) {
      sendJson(res, 404, { ok: false, message: '文件不存在' })
      return true
    }
    const buf = readFileSync(file)
    res.writeHead(200, {
      'Content-Type': contentTypeFor(file),
      'Cache-Control': 'public, max-age=60'
    })
    res.end(buf)
    return true
  }

  // Static: /api/v1/plugins/:id/static/*
  const staticMatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/static\/(.+)$/)
  if (method === 'GET' && staticMatch) {
    if (!pm) {
      sendJson(res, 503, { ok: false, message: '插件系统未启动' })
      return true
    }
    const file = pm.resolveStatic(decodeURIComponent(staticMatch[1]), decodeURIComponent(staticMatch[2]))
    if (!file || !existsSync(file)) {
      sendJson(res, 404, { ok: false, message: '文件不存在' })
      return true
    }
    const buf = readFileSync(file)
    res.writeHead(200, {
      'Content-Type': contentTypeFor(file),
      'Cache-Control': 'public, max-age=60'
    })
    res.end(buf)
    return true
  }

  if (
    !path.startsWith('/api/v1/plugins') &&
    path !== '/api/v1/plugin/ui' &&
    !path.startsWith('/api/v1/plugin-notices')
  ) {
    // Custom plugin routes
    if (pm) {
      const hit = pm.matchCustomRoute(method, path, publicCustomOnly ? { publicOnly: true } : undefined)
      if (hit) {
        if (publicCustomOnly && !hit.route.public) return false
        try {
          await runCustomRoute(hit, { method, path, url, req, res, sendJson, readBody, auth, pm })
        } catch (e) {
          sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
        }
        return true
      }
    }
    return false
  }

  if (publicCustomOnly) return false

  if (!pm) {
    sendJson(res, 503, { ok: false, message: '插件系统未启动' })
    return true
  }

  // Public UI for login page (no auth) — handled in server before auth too
  if (method === 'GET' && path === '/api/v1/plugins/public-ui') {
    const nav: unknown[] = []
    const assets = await pm.collectUiAssets({ publicOnly: true })
    sendJson(res, 200, { ok: true, nav, assets })
    return true
  }

  // UI manifest (any logged-in user)
  if (method === 'GET' && (path === '/api/v1/plugins/ui' || path === '/api/v1/plugin/ui')) {
    let nav = await pm.collectUiNavAsync()
    const assets = await pm.collectUiAssets()
    const permissions = await pm.collectPermissionsCatalog()
    // Filter nav by user-group module allow-list when policy is active
    if (auth && typeof auth === 'object' && (auth as { kind?: string }).kind === 'user') {
      const u = (auth as { user?: { level?: string; groupIds?: string[] } }).user
      if (u && u.level !== 'admin') {
        const access = pm.groupModuleAccessFor(u.groupIds)
        if (access.length) {
          const allow = new Set(access.map((m) => `${m.pluginId}:${m.module}`))
          nav = nav.filter((item) => {
            const id = String(item.identifier || '')
            const mod = String(item.module || '')
            return allow.has(`${id}:${mod}`)
          })
        }
      }
    }
    sendJson(res, 200, {
      ok: true,
      nav,
      assets,
      permissions,
      kernelVersion: pm.kernelVersion,
      plugins: pm.list().filter((p) => p.available),
      i18n: pm.collectI18nMaps(),
      userGroups: pm.listUserGroups().map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description
      }))
    })
    return true
  }

  if (method === 'GET' && path === '/api/v1/plugins') {
    sendJson(res, 200, {
      ok: true,
      kernelVersion: pm.kernelVersion,
      plugins: pm.list(),
      bundled: pm.listBundled()
    })
    return true
  }

  if (method === 'GET' && path === '/api/v1/plugins/bundled') {
    sendJson(res, 200, { ok: true, bundled: pm.listBundled() })
    return true
  }

  // User groups (Discuz-like) — any logged-in for apply in user form
  if (method === 'GET' && (path === '/api/v1/user-groups' || path === '/api/v1/permission-packs')) {
    const groups = pm.listUserGroups()
    sendJson(res, 200, {
      ok: true,
      groups,
      // legacy alias
      packs: groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        permissions: g.permissions
      }))
    })
    return true
  }

  // In-app notices (operator inbox)
  if (method === 'GET' && path === '/api/v1/plugin-notices') {
    const userId =
      auth && typeof auth === 'object' && (auth as { kind?: string }).kind === 'user'
        ? String((auth as { user?: { id?: string } }).user?.id || '')
        : undefined
    const store = pm.getNoticeStore()
    sendJson(res, 200, {
      ok: true,
      notices: store.list({ userId, limit: Number(url.searchParams.get('limit') || 50) }),
      unread: store.unreadCount(userId)
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugin-notices/read') {
    const userId =
      auth && typeof auth === 'object' && (auth as { kind?: string }).kind === 'user'
        ? String((auth as { user?: { id?: string } }).user?.id || '')
        : undefined
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const store = pm.getNoticeStore()
      if (body.all === true) {
        sendJson(res, 200, { ok: true, count: store.markAllRead(userId) })
      } else {
        const ids = Array.isArray(body.ids) ? body.ids.map(String) : []
        sendJson(res, 200, { ok: true, count: store.markRead(ids, userId) })
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  // Admin-only mutations
  const needAdmin = method !== 'GET'
  if (needAdmin && !isAdmin) {
    sendJson(res, 403, { ok: false, message: '需要管理员权限管理插件' })
    return true
  }

  if (method === 'GET' && path === '/api/v1/plugins/kernel-debug') {
    if (!isAdmin) {
      sendJson(res, 403, { ok: false, message: '需要管理员权限' })
      return true
    }
    sendJson(res, 200, { ok: true, ...pm.getKernelDebug() })
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugins/kernel-debug/reset-stats') {
    pm.resetHookStats()
    sendJson(res, 200, { ok: true, ...pm.getKernelDebug() })
    return true
  }

  if (
    method === 'PUT' &&
    (path === '/api/v1/user-groups' || path === '/api/v1/permission-packs')
  ) {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const list = Array.isArray(body.groups)
        ? (body.groups as never[])
        : Array.isArray(body.packs)
          ? (body.packs as never[])
          : []
      const groups = pm.saveUserGroups(list)
      sendJson(res, 200, {
        ok: true,
        groups,
        packs: groups.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
          permissions: g.permissions
        }))
      })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const modulesPatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/modules-enabled$/)
  if (method === 'PATCH' && modulesPatch) {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const map =
        body.enabledModules && typeof body.enabledModules === 'object'
          ? (body.enabledModules as Record<string, boolean>)
          : {}
      const st = await pm.setEnabledModules(decodeURIComponent(modulesPatch[1]), map)
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugins/install-url') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const url = typeof body.url === 'string' ? body.url : ''
      const sha256 = typeof body.sha256 === 'string' ? body.sha256 : undefined
      if (!url) {
        sendJson(res, 400, { ok: false, message: '缺少 url' })
        return true
      }
      const st = await pm.installFromUrl(url, sha256)
      const { resolve } = await import('path')
      const dataRoot = resolve(process.env.DATA_ROOT || `${process.cwd()}/data`)
      const { assertUsableIfMarketPack } = await import('../license/licenseGate')
      const gate = await assertUsableIfMarketPack({
        dataRoot,
        appIdentifier: st.identifier,
        kind: 'plugin',
        licenseKey: typeof body.licenseKey === 'string' ? body.licenseKey.trim() : undefined
      })
      if (!gate.ok) {
        try {
          await pm.uninstall(st.identifier)
        } catch {
          /* ignore */
        }
        sendJson(res, 403, {
          ok: false,
          genuine: false,
          code: gate.code,
          message: `非正版授权，无法安装：${gate.message}`
        })
        return true
      }
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugins/install-zip') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const buf = decodeZipPayload(body)
      const st = await pm.installFromZip(buf)
      const { resolve } = await import('path')
      const dataRoot = resolve(process.env.DATA_ROOT || `${process.cwd()}/data`)
      const { assertUsableIfMarketPack } = await import('../license/licenseGate')
      const gate = await assertUsableIfMarketPack({
        dataRoot,
        appIdentifier: st.identifier,
        kind: 'plugin',
        licenseKey: typeof body.licenseKey === 'string' ? body.licenseKey.trim() : undefined
      })
      if (!gate.ok) {
        try {
          await pm.uninstall(st.identifier)
        } catch {
          /* ignore */
        }
        sendJson(res, 403, {
          ok: false,
          genuine: false,
          code: gate.code,
          message: `非正版授权，无法安装：${gate.message}`
        })
        return true
      }
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugins/install-bundled') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const id = typeof body.identifier === 'string' ? body.identifier : ''
      if (!id) {
        sendJson(res, 400, { ok: false, message: '缺少 identifier' })
        return true
      }
      const st = await pm.installBundled(id)
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/plugins/reload') {
    await pm.reloadAll()
    sendJson(res, 200, { ok: true, plugins: pm.list(), kernelVersion: pm.kernelVersion })
    return true
  }

  const one = path.match(/^\/api\/v1\/plugins\/([^/]+)$/)
  if (method === 'GET' && one) {
    const st = pm.get(decodeURIComponent(one[1]))
    if (!st) {
      sendJson(res, 404, { ok: false, message: '未安装' })
      return true
    }
    sendJson(res, 200, { ok: true, plugin: st })
    return true
  }

  const enable = path.match(/^\/api\/v1\/plugins\/([^/]+)\/enable$/)
  if (method === 'POST' && enable) {
    try {
      const id = decodeURIComponent(enable[1])
      const { resolve } = await import('path')
      const dataRoot = resolve(process.env.DATA_ROOT || `${process.cwd()}/data`)
      const { assertUsableIfMarketPack } = await import('../license/licenseGate')
      const gate = await assertUsableIfMarketPack({
        dataRoot,
        appIdentifier: id,
        kind: 'plugin'
      })
      if (!gate.ok) {
        sendJson(res, 403, {
          ok: false,
          genuine: false,
          code: gate.code,
          message: `非正版授权，无法启用/使用：${gate.message}`
        })
        return true
      }
      const st = await pm.setAvailable(id, true)
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const disable = path.match(/^\/api\/v1\/plugins\/([^/]+)\/disable$/)
  if (method === 'POST' && disable) {
    try {
      const st = await pm.setAvailable(decodeURIComponent(disable[1]), false)
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const vars = path.match(/^\/api\/v1\/plugins\/([^/]+)\/vars$/)
  if (method === 'PATCH' && vars) {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const map: Record<string, string> = {}
      if (body.vars && typeof body.vars === 'object') {
        for (const [k, v] of Object.entries(body.vars as Record<string, unknown>)) {
          map[k] = String(v ?? '')
        }
      }
      const st = await pm.setVars(decodeURIComponent(vars[1]), map)
      sendJson(res, 200, { ok: true, plugin: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const uninstall = path.match(/^\/api\/v1\/plugins\/([^/]+)$/)
  if (method === 'DELETE' && uninstall) {
    try {
      await pm.uninstall(decodeURIComponent(uninstall[1]))
      sendJson(res, 200, { ok: true })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  // Plugin page HTML (iframe src — 真实 URL，文件选择器才能工作)
  const pageMatch = path.match(/^\/api\/v1\/plugins\/([^/]+)\/page\/([^/]+)$/)
  if (method === 'GET' && pageMatch) {
    if (!pm) {
      sendJson(res, 503, { ok: false, message: '插件系统未启动' })
      return true
    }
    const user = auth && typeof auth === 'object' && (auth as { kind?: string }).kind === 'user'
      ? (auth as { user?: { id?: string } }).user
      : null
    if (!user?.id) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('请先登录')
      return true
    }
    try {
      const ctx: PluginRequestCtx = {
        method: 'GET',
        path,
        url,
        query: queryOf(url),
        headers: headersOf(req),
        auth
      }
      const data = await pm.runModule(decodeURIComponent(pageMatch[1]), decodeURIComponent(pageMatch[2]), ctx)
      if (data && typeof data === 'object' && '__html' in (data as object)) {
        const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
        const host = String(req.headers.host || 'localhost')
        const origin = `${proto}://${host}`
        const jwt =
          String(req.headers.authorization || '')
            .replace(/^bearer\s+/i, '')
            .trim() ||
          String(url.searchParams.get('access_token') || url.searchParams.get('token') || '')
        const page = preparePluginPageHtml(String((data as { __html: string }).__html), jwt, origin)
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store'
        })
        res.end(page)
        return true
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('插件页不存在')
      return true
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(e instanceof Error ? e.message : String(e))
      return true
    }
  }

  // Module invoke: POST /api/v1/plugins/:id/modules/:name
  const mod = path.match(/^\/api\/v1\/plugins\/([^/]+)\/modules\/([^/]+)$/)
  if ((method === 'GET' || method === 'POST') && mod) {
    try {
      const ctx: PluginRequestCtx = {
        method,
        path,
        url,
        query: queryOf(url),
        headers: headersOf(req),
        auth
      }
      if (method === 'POST') {
        const raw = await readBody(req)
        try {
          ctx.body = raw ? JSON.parse(raw) : {}
        } catch {
          ctx.body = { raw }
        }
      }
      const data = await pm.runModule(decodeURIComponent(mod[1]), decodeURIComponent(mod[2]), ctx)
      sendJson(res, 200, { ok: true, data })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  return false
}
