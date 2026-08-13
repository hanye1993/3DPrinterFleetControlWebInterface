import type { IncomingMessage, ServerResponse } from 'http'
import type { NavConfigStore } from '../nav/navConfigStore'
import { normalizeNavConfig } from '../../shared/navConfig'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export async function handleNavApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  isAdmin: boolean
  getNavConfigStore: () => NavConfigStore | null
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
  } | null
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody, isAdmin, getNavConfigStore, getPluginManager } =
    opts
  if (!path.startsWith('/api/v1/nav-config')) return false

  const store = getNavConfigStore()
  if (!store) {
    sendJson(res, 503, { ok: false, message: '导航配置未启动' })
    return true
  }

  if (method === 'GET' && path === '/api/v1/nav-config') {
    sendJson(res, 200, { ok: true, config: store.get() })
    return true
  }

  if (method === 'PUT' && path === '/api/v1/nav-config') {
    if (!isAdmin) {
      sendJson(res, 403, { ok: false, message: '需要管理员权限' })
      return true
    }
    try {
      const raw = await readBody(req)
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      let next = normalizeNavConfig(body.config ?? body)
      const pm = getPluginManager?.()
      if (pm) {
        const hooked = (await pm.runHook('nav_config_save', {
          proceed: true,
          config: next
        })) as {
          proceed?: boolean
          status?: number
          body?: unknown
          config?: unknown
        }
        if (hooked && hooked.proceed === false) {
          sendJson(res, hooked.status || 403, hooked.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (hooked?.config) next = normalizeNavConfig(hooked.config)
      }
      const saved = store.save(next)
      sendJson(res, 200, { ok: true, config: saved })
    } catch (e) {
      sendJson(res, 400, {
        ok: false,
        message: e instanceof Error ? e.message : String(e)
      })
    }
    return true
  }

  sendJson(res, 404, { ok: false, message: '未知导航接口' })
  return true
}
