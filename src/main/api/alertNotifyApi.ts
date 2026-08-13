import type { IncomingMessage, ServerResponse } from 'http'
import type { AlertEventKind } from '../../shared/alertNotify'
import { ALERT_EVENT_KINDS, ALERT_EVENT_LABELS } from '../../shared/alertNotify'
import { dispatchAlertNotify } from '../alert/dispatcher'

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

export async function handleAlertNotifyApi(opts: {
  method: string
  path: string
  req: IncomingMessage
  res: ServerResponse
  sendJson: SendJson
  readBody: ReadBody
  getSettings: () => Record<string, unknown>
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
  } | null
}): Promise<boolean> {
  const { method, path, req, res, sendJson, readBody, getSettings, getPluginManager } = opts

  if (method === 'POST' && path === '/api/v1/alert-notify/test') {
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' })
      return true
    }
    const kindRaw = typeof body.kind === 'string' ? body.kind : 'printerError'
    const kind = (ALERT_EVENT_KINDS.includes(kindRaw as AlertEventKind)
      ? kindRaw
      : 'printerError') as AlertEventKind
    const channels = Array.isArray(body.channels)
      ? body.channels.filter((c): c is string => typeof c === 'string')
      : undefined
    const title =
      (typeof body.title === 'string' && body.title.trim()) ||
      `【测试】${ALERT_EVENT_LABELS[kind]}`
    const content =
      (typeof body.content === 'string' && body.content.trim()) ||
      `这是一条来自打印机监控台的测试通知（${new Date().toLocaleString()}）`

    const result = await dispatchAlertNotify(
      () => getSettings() as never,
      {
        kind,
        title,
        content,
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
        deviceName: typeof body.deviceName === 'string' ? body.deviceName : '测试设备',
        at: new Date().toISOString()
      },
      { bypassCooldown: true, bypassEventGate: true, channels, getPluginManager }
    )
    sendJson(res, result.ok ? 200 : 400, {
      ok: result.ok,
      skipped: result.skipped,
      reason: result.reason,
      results: result.results
    })
    return true
  }

  if (method === 'POST' && path === '/api/v1/alert-notify/emit') {
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON' })
      return true
    }
    const kindRaw = typeof body.kind === 'string' ? body.kind : ''
    if (!ALERT_EVENT_KINDS.includes(kindRaw as AlertEventKind)) {
      sendJson(res, 400, { ok: false, message: '无效的 kind' })
      return true
    }
    const kind = kindRaw as AlertEventKind
    const title =
      (typeof body.title === 'string' && body.title.trim()) || ALERT_EVENT_LABELS[kind]
    const content =
      (typeof body.content === 'string' && body.content.trim()) || title
    const result = await dispatchAlertNotify(
      () => getSettings() as never,
      {
        kind,
        title,
        content,
        deviceId: typeof body.deviceId === 'string' ? body.deviceId : undefined,
        deviceName: typeof body.deviceName === 'string' ? body.deviceName : undefined,
        at: new Date().toISOString(),
        extra:
          body.extra && typeof body.extra === 'object'
            ? (body.extra as Record<string, unknown>)
            : undefined
      },
      { getPluginManager }
    )
    sendJson(res, 200, {
      ok: true,
      skipped: result.skipped,
      reason: result.reason,
      results: result.results
    })
    return true
  }

  return false
}
