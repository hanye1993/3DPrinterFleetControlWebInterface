import type { IncomingMessage, ServerResponse } from 'http'
import type { PluginManager } from '../plugin/manager'
import type { ThemeManager } from '../theme/manager'
import {
  enrichPackages,
  fetchBinary,
  loadMarketCatalog,
  MARKET_REPO_URL,
  packageDownloadUrls,
  verifySha256,
  type MarketPackageKind
} from '../marketplace/catalog'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export async function handleMarketplaceApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  isAdmin: boolean
  getPluginManager: () => PluginManager | null
  getThemeManager: () => ThemeManager | null
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody, isAdmin, getPluginManager, getThemeManager } =
    opts

  if (!path.startsWith('/api/v1/marketplace')) return false

  if (!isAdmin) {
    sendJson(res, 403, { ok: false, message: '仅管理员可使用应用市场' })
    return true
  }

  const pm = getPluginManager()
  const tm = getThemeManager()

  if (method === 'GET' && (path === '/api/v1/marketplace' || path === '/api/v1/marketplace/')) {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    const force = u.searchParams.get('force') === '1'
    const loaded = await loadMarketCatalog(force)
    const plugins = new Map<string, string>()
    const themes = new Map<string, string>()
    if (pm) {
      for (const p of pm.list()) {
        plugins.set(p.identifier, p.version)
      }
    }
    if (tm) {
      for (const t of tm.list()) {
        themes.set(t.identifier, t.version)
      }
    }
    const packages = enrichPackages(loaded.catalog, { plugins, themes })
    sendJson(res, 200, {
      ok: loaded.ok,
      reachable: loaded.reachable,
      message: loaded.message,
      source: loaded.source,
      repo: loaded.catalog.repo || MARKET_REPO_URL,
      name: loaded.catalog.name || '应用市场',
      updatedAt: loaded.catalog.updatedAt,
      packages
    })
    return true
  }

  if (method === 'GET' && path === '/api/v1/marketplace/refresh') {
    const loaded = await loadMarketCatalog(true)
    sendJson(res, 200, {
      ok: loaded.ok,
      reachable: loaded.reachable,
      message: loaded.message,
      count: loaded.catalog.packages.length,
      repo: MARKET_REPO_URL
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/marketplace/install') {
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      const kind = (body.kind === 'theme' ? 'theme' : body.kind === 'plugin' ? 'plugin' : null) as
        | MarketPackageKind
        | null
      const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : ''
      if (!kind || !identifier) {
        sendJson(res, 400, { ok: false, message: '缺少 kind / identifier' })
        return true
      }
      if (kind === 'plugin' && !pm) {
        sendJson(res, 503, { ok: false, message: '插件系统未启动' })
        return true
      }
      if (kind === 'theme' && !tm) {
        sendJson(res, 503, { ok: false, message: '主题系统未启动' })
        return true
      }

      const loaded = await loadMarketCatalog(false)
      if (!loaded.reachable) {
        sendJson(res, 502, { ok: false, reachable: false, message: loaded.message })
        return true
      }
      const pkg = loaded.catalog.packages.find(
        (p) => p.kind === kind && p.identifier === identifier
      )
      if (!pkg) {
        sendJson(res, 404, { ok: false, message: `市场中未找到 ${kind}:${identifier}` })
        return true
      }

      const urls =
        typeof body.url === 'string' && body.url.trim()
          ? [body.url.trim(), ...packageDownloadUrls(pkg.path)]
          : packageDownloadUrls(pkg.path)
      const dl = await fetchBinary(urls)
      if (!dl.ok) {
        sendJson(res, 502, { ok: false, reachable: false, message: dl.message })
        return true
      }
      verifySha256(dl.buf, pkg.sha256)

      if (kind === 'plugin') {
        const st = await pm!.installFromZip(dl.buf)
        sendJson(res, 200, {
          ok: true,
          kind,
          plugin: st,
          downloadedFrom: dl.url,
          message: `已安装插件 ${st.name || st.identifier} v${st.version}`
        })
      } else {
        const st = await tm!.installFromZip(dl.buf)
        sendJson(res, 200, {
          ok: true,
          kind,
          theme: st,
          downloadedFrom: dl.url,
          message: `已安装主题 ${st.name || st.identifier} v${st.version}`
        })
      }
    } catch (e) {
      sendJson(res, 400, { ok: false, message: e instanceof Error ? e.message : String(e) })
    }
    return true
  }

  return false
}
