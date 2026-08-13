import type { IncomingMessage, ServerResponse } from 'http'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { ThemeManager } from '../theme/manager'
import { decodeThemeZipPayload } from '../theme/manager'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

function contentTypeFor(file: string): string {
  const e = extname(file).toLowerCase()
  if (e === '.js') return 'application/javascript; charset=utf-8'
  if (e === '.css') return 'text/css; charset=utf-8'
  if (e === '.json') return 'application/json; charset=utf-8'
  if (e === '.htm' || e === '.html') return 'text/html; charset=utf-8'
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.svg') return 'image/svg+xml'
  if (e === '.webp') return 'image/webp'
  return 'application/octet-stream'
}

export async function handleThemeApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  isAdmin: boolean
  getThemeManager: () => ThemeManager | null
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
  } | null
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody, isAdmin, getThemeManager, getPluginManager } =
    opts
  const tm = getThemeManager()
  const pm = getPluginManager?.()

  const assetMatch = path.match(/^\/api\/v1\/themes\/([^/]+)\/asset\/(.+)$/)
  if (method === 'GET' && assetMatch) {
    if (!tm) {
      sendJson(res, 503, { ok: false, message: '主题系统未启动' })
      return true
    }
    const file = tm.resolveAsset(decodeURIComponent(assetMatch[1]), decodeURIComponent(assetMatch[2]))
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

  if (method === 'GET' && path === '/api/v1/themes/active') {
    if (!tm) {
      sendJson(res, 503, { ok: false, message: '主题系统未启动' })
      return true
    }
    sendJson(res, 200, { ok: true, active: await tm.getActiveUiPayload() })
    return true
  }

  if (!path.startsWith('/api/v1/themes')) return false

  if (!tm) {
    sendJson(res, 503, { ok: false, message: '主题系统未启动' })
    return true
  }

  if (method === 'GET' && path === '/api/v1/themes') {
    sendJson(res, 200, {
      ok: true,
      active: await tm.getActiveUiPayload(),
      themes: tm.list(),
      bundled: tm.listBundled()
    })
    return true
  }

  if (method !== 'GET' && !isAdmin) {
    sendJson(res, 403, { ok: false, message: '需要管理员权限管理主题' })
    return true
  }

  if (method === 'POST' && path === '/api/v1/themes/install-zip') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      if (pm) {
        const before = (await pm.runHook('theme_install', {
          proceed: true,
          source: 'zip'
        })) as { proceed?: boolean; status?: number; body?: unknown }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
      }
      const st = await tm.installFromZip(decodeThemeZipPayload(body))
      sendJson(res, 200, { ok: true, theme: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/themes/install-url') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const url = typeof body.url === 'string' ? body.url : ''
      const sha256 = typeof body.sha256 === 'string' ? body.sha256 : undefined
      if (!url) {
        sendJson(res, 400, { ok: false, message: '缺少 url' })
        return true
      }
      if (pm) {
        const before = (await pm.runHook('theme_install', {
          proceed: true,
          source: 'url',
          url
        })) as { proceed?: boolean; status?: number; body?: unknown }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
      }
      const st = await tm.installFromUrl(url, sha256)
      sendJson(res, 200, { ok: true, theme: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  if (method === 'POST' && path === '/api/v1/themes/install-bundled') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const id = typeof body.identifier === 'string' ? body.identifier : ''
      if (!id) {
        sendJson(res, 400, { ok: false, message: '缺少 identifier' })
        return true
      }
      if (pm) {
        const before = (await pm.runHook('theme_install', {
          proceed: true,
          source: 'bundled',
          identifier: id
        })) as { proceed?: boolean; status?: number; body?: unknown }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
      }
      const st = await tm.installBundled(id)
      sendJson(res, 200, { ok: true, theme: st })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const enable = path.match(/^\/api\/v1\/themes\/([^/]+)\/enable$/)
  if (method === 'POST' && enable) {
    try {
      let id = decodeURIComponent(enable[1])
      if (pm) {
        const before = (await pm.runHook('theme_activate', {
          proceed: true,
          identifier: id
        })) as { proceed?: boolean; status?: number; body?: unknown; identifier?: string }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.identifier) id = String(before.identifier)
      }
      const st = await tm.setActive(id)
      sendJson(res, 200, { ok: true, theme: st, active: await tm.getActiveUiPayload() })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  const one = path.match(/^\/api\/v1\/themes\/([^/]+)$/)
  if (method === 'DELETE' && one) {
    try {
      await tm.uninstall(decodeURIComponent(one[1]))
      sendJson(res, 200, { ok: true, active: await tm.getActiveUiPayload() })
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  return false
}
