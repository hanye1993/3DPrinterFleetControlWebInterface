import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonArray, writeJsonArray } from '../storage/jsonBridge'
import {
  addDevice,
  publicSettings,
  removeDevice,
  SETTINGS_PATCH_KEYS,
  updateDevice
} from './deviceMutations'
import type { AuthContext } from '../auth/authApi'
import { assertDeviceControlAllowed } from '../auth/authApi'
import { effectivePermissions, hasPerm } from '../../shared/permissions'
import {
  DEVICE_CONTROL_ACTIONS,
  isControlAction,
  parseControlExtras,
  parseMoonrakerProxyMethod,
  normalizeMoonrakerProxyPath
} from './controlShared'
import { handleOnboardApi } from './onboardApi'
import type { OperationLog } from '../../shared/operationLog'
import { deviceNameFromPath, makeOperationLog } from '../operationLogs/helpers'

export type DeviceOpHandler = (req: {
  deviceId: string
  op: 'listFiles' | 'uploadFile' | 'downloadFile'
  filename?: string
  contentBase64?: string
  remotePath?: string
}) => Promise<{
  ok: boolean
  message?: string
  files?: Array<{ path: string; size: number; modified?: number }>
  filename?: string
  contentBase64?: string
  contentType?: string
}>

export type BatchPrintHandler = (payload: {
  deviceIds: string[]
  filename: string
  contentBase64?: string
}) => Promise<{
  ok: boolean
  results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
}>

export type FullApiDeps = {
  getDevicesPath: () => string
  getFilamentPath: () => string
  getSettings: () => Record<string, unknown> & { apiMode?: string; apiKey?: string }
  onControl: (deviceId: string, payload: unknown) => Promise<{ ok: boolean; message?: string }>
  onDevicesChanged?: () => void
  setDeviceSecret: (secretKey: string, value: string) => void
  deleteDeviceSecret: (secretKey: string) => void
  onDeviceOp: DeviceOpHandler
  onGetDeviceCapabilities?: (deviceId: string) => unknown
  onMoonrakerRequest?: (
    deviceId: string,
    req: {
      method: string
      path: string
      query?: Record<string, string | number | boolean | null | undefined>
      body?: unknown
    }
  ) => Promise<{ ok: boolean; status?: number; data?: unknown; message?: string }>
  onSendGcode?: (
    deviceId: string,
    script: string
  ) => Promise<{ ok: boolean; message?: string }>
  onBatchPrint: BatchPrintHandler
  startLanDiscover: (opts?: { brands?: string[] }) => Promise<{ ok: boolean; message?: string }>
  getLanDiscover: () => {
    phase: string
    scanned: number
    total: number
    found: number
    message?: string
    hits: unknown[]
  }
  cancelLanDiscover: () => void
  getLogs: (opts?: { limit?: number; deviceId?: string }) => unknown[]
  clearLogs: () => void
  appendLog?: (entry: OperationLog) => void
  patchSettings: (
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; settings?: unknown; message?: string }>
  sanitizeDevice: (d: Record<string, unknown>) => Record<string, unknown>
  onFilamentChanged?: () => void
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
  } | null
}

type SendJson = (res: ServerResponse, status: number, body: unknown) => void
type ReadBody = (req: IncomingMessage) => Promise<string>

function requireControl(
  settings: { apiMode?: string },
  res: ServerResponse,
  sendJson: SendJson,
  auth?: AuthContext | null
): boolean {
  if (settings.apiMode === 'readonly') {
    sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
    return false
  }
  // Open API Key removed — only JWT users / local session may mutate
  if (auth?.kind === 'user' || auth?.kind === 'local') return true
  sendJson(res, 403, { ok: false, message: 'Unauthorized' })
  return false
}

function requireAdminUser(
  auth: AuthContext | null | undefined,
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (!auth || auth.kind === 'local') return true
  if (auth.kind === 'user') {
    if (auth.user.level === 'admin') return true
    if (hasPerm(effectivePermissions(auth.user), '*')) return true
  }
  sendJson(res, 403, { ok: false, message: '仅管理员可修改系统设置' })
  return false
}

/** Operation logs: admin JWT or local session only */
function requireAdminForLogs(
  auth: AuthContext | null | undefined,
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (!auth || auth.kind === 'local') return true
  if (auth.kind === 'user') {
    if (auth.user.level === 'admin') return true
    if (hasPerm(effectivePermissions(auth.user), '*')) return true
  }
  sendJson(res, 403, { ok: false, message: '仅管理员可访问操作日志' })
  return false
}

function requireUserPerm(
  auth: AuthContext | null | undefined,
  perm: string,
  res: ServerResponse,
  sendJson: SendJson
): boolean {
  if (!auth || auth.kind !== 'user') return true
  if (hasPerm(effectivePermissions(auth.user), perm)) return true
  sendJson(res, 403, { ok: false, message: `缺少权限：${perm}` })
  return false
}

async function parseJsonBody(
  req: IncomingMessage,
  readBody: ReadBody
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; message: string }> {
  const raw = await readBody(req)
  if (!raw) return { ok: true, body: {} }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Body must be a JSON object' }
    }
    return { ok: true, body: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, message: 'Invalid JSON body' }
  }
}

function safeRemotePath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').trim()
  if (!p || p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null
  return p
}

/**
 * Extra full-API routes. Returns true if handled.
 */
export async function handleFullApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  deps: FullApiDeps
  sendJson: SendJson
  readBody: ReadBody
  auth?: AuthContext | null
}): Promise<boolean> {
  const { method, path, url, req, res, deps, sendJson, readBody, auth } = opts
  const settings = deps.getSettings()

  if (path.startsWith('/api/v1/onboard/')) {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook('onboard_before', {
        proceed: true,
        method,
        path
      })) as { proceed?: boolean; status?: number; body?: unknown }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
    }
    let captured: { status: number; body: unknown } | null = null
    const wrapSend: typeof sendJson = (r, status, body) => {
      captured = { status, body }
      sendJson(r, status, body)
    }
    const handled = await handleOnboardApi({ method, path, req, res, sendJson: wrapSend, readBody })
    // Callback assignment is invisible to control-flow analysis
    const snap = captured as { status: number; body: unknown } | null
    if (handled && pm && snap) {
      void pm.runHook('onboard_after', {
        method,
        path,
        status: snap.status,
        body: snap.body
      })
    }
    return handled
  }

  // —— Settings ——
  if (method === 'GET' && path === '/api/v1/settings') {
    let payload: { ok: boolean; settings: Record<string, unknown> } = {
      ok: true,
      settings: publicSettings(settings as Record<string, unknown>) as Record<string, unknown>
    }
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        payload = (await pm.runHook('settings_get', payload, {
          method,
          path,
          url,
          auth
        })) as { ok: boolean; settings: Record<string, unknown> }
      }
    } catch {
      /* ignore */
    }
    sendJson(res, 200, payload)
    return true
  }

  if (method === 'PATCH' && path === '/api/v1/settings') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    if (!requireAdminUser(auth, res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let patch: Record<string, unknown> = {}
    for (const key of SETTINGS_PATCH_KEYS) {
      if (key in parsed.body) patch[key] = parsed.body[key]
    }
    if (!Object.keys(patch).length) {
      sendJson(res, 400, { ok: false, message: 'No allowed settings fields in body' })
      return true
    }
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'settings_patch',
          { proceed: true, patch },
          { method, path, url, auth }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          patch?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.patch && typeof before.patch === 'object') patch = before.patch
      }
    } catch {
      /* ignore */
    }
    const result = await deps.patchSettings(patch)
    if (!result.ok) {
      sendJson(res, 400, { ok: false, message: result.message || 'Failed to patch settings' })
      return true
    }
    sendJson(res, 200, {
      ok: true,
      settings: publicSettings((result.settings || deps.getSettings()) as Record<string, unknown>)
    })
    return true
  }

  // —— Logs（仅管理员 / 本机会话）——
  if (method === 'GET' && path === '/api/v1/logs') {
    if (!requireAdminForLogs(auth, res, sendJson)) return true
    const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 100)))
    const deviceId = url.searchParams.get('deviceId') || undefined
    let logs = deps.getLogs({ limit, deviceId: deviceId || undefined })
    const pm = deps.getPluginManager?.()
    if (pm) logs = (await pm.runHook('logs_list', logs)) as typeof logs
    sendJson(res, 200, { ok: true, logs, count: logs.length })
    return true
  }

  if (method === 'DELETE' && path === '/api/v1/logs') {
    if (!requireAdminForLogs(auth, res, sendJson)) return true
    if (!requireControl(settings, res, sendJson, auth)) return true
    deps.clearLogs()
    sendJson(res, 200, { ok: true })
    return true
  }

  if (method === 'POST' && path === '/api/v1/logs') {
    if (!requireAdminForLogs(auth, res, sendJson)) return true
    if (!requireControl(settings, res, sendJson, auth)) return true
    if (!deps.appendLog) {
      sendJson(res, 501, { ok: false, message: '日志写入未启用' })
      return true
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const body = parsed.body
    const deviceId = String(body.deviceId || '').trim()
    const action = String(body.action || '').trim()
    if (!deviceId || !action) {
      sendJson(res, 400, { ok: false, message: 'deviceId and action are required' })
      return true
    }
    const deviceName =
      String(body.deviceName || '').trim() ||
      deviceNameFromPath(deps.getDevicesPath, deviceId)
    let entry = makeOperationLog(
      deviceId,
      deviceName,
      action,
      String(body.result || 'ok'),
      typeof body.detail === 'string' ? body.detail : undefined
    )
    const pm = deps.getPluginManager?.()
    if (pm) {
      const hooked = (await pm.runHook('logs_append', { proceed: true, entry })) as {
        proceed?: boolean
        entry?: typeof entry
        status?: number
        body?: unknown
      }
      if (hooked && hooked.proceed === false) {
        sendJson(res, hooked.status || 403, hooked.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (hooked?.entry) entry = hooked.entry
    }
    deps.appendLog(entry)
    sendJson(res, 200, { ok: true })
    return true
  }

  // —— LAN discover ——
  if (method === 'POST' && path === '/api/v1/discover/lan') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let brands = Array.isArray(parsed.body.brands)
      ? parsed.body.brands.map((b) => String(b))
      : undefined
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook('discover_lan_before', {
        proceed: true,
        brands
      })) as { proceed?: boolean; status?: number; body?: unknown; brands?: string[] }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (Array.isArray(before?.brands)) brands = before.brands.map(String)
    }
    const started = await deps.startLanDiscover(brands ? { brands } : undefined)
    let out = { ok: started.ok, message: started.message, ...deps.getLanDiscover() }
    if (pm) out = (await pm.runHook('discover_lan_after', out)) as typeof out
    sendJson(res, started.ok ? 200 : 409, out)
    return true
  }

  if (method === 'GET' && path === '/api/v1/discover/lan') {
    sendJson(res, 200, { ok: true, ...deps.getLanDiscover() })
    return true
  }

  if (method === 'DELETE' && path === '/api/v1/discover/lan') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    deps.cancelLanDiscover()
    sendJson(res, 200, { ok: true, ...deps.getLanDiscover() })
    return true
  }

  // —— Batch ——
  if (method === 'POST' && path === '/api/v1/batch/control') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let deviceIds = Array.isArray(parsed.body.deviceIds)
      ? parsed.body.deviceIds.map((id) => String(id)).filter(Boolean)
      : []
    if (!deviceIds.length) {
      sendJson(res, 400, { ok: false, message: 'deviceIds is required' })
      return true
    }
    if (!isControlAction(parsed.body.action)) {
      sendJson(res, 400, {
        ok: false,
        message: `Unknown or missing action. Allowed: ${DEVICE_CONTROL_ACTIONS.join(', ')}`
      })
      return true
    }
    let extras = parseControlExtras(parsed.body)
    let action = parsed.body.action
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook('control_batch_before', {
        proceed: true,
        deviceIds,
        action,
        extras
      })) as {
        proceed?: boolean
        status?: number
        body?: unknown
        deviceIds?: string[]
        action?: string
        extras?: Record<string, unknown>
      }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (Array.isArray(before?.deviceIds)) deviceIds = before.deviceIds.map(String)
      if (before?.action && isControlAction(before.action)) action = before.action
      if (before?.extras) extras = before.extras as typeof extras
    }
    const results: Array<{ deviceId: string; ok: boolean; message?: string }> = []
    for (const id of deviceIds) {
      const r = await deps.onControl(id, { action, ...extras })
      deps.appendLog?.(
        makeOperationLog(
          id,
          deviceNameFromPath(deps.getDevicesPath, id),
          String(action),
          r.ok ? 'ok' : 'error',
          r.message
        )
      )
      results.push({ deviceId: id, ok: r.ok, message: r.message })
    }
    let out = { ok: results.every((r) => r.ok), results }
    if (pm) {
      out = (await pm.runHook('control_batch_after', out)) as typeof out
    }
    sendJson(res, 200, out)
    return true
  }

  if (method === 'POST' && path === '/api/v1/batch/print') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let deviceIds = Array.isArray(parsed.body.deviceIds)
      ? parsed.body.deviceIds.map((id) => String(id)).filter(Boolean)
      : []
    let filename = String(parsed.body.filename || '').trim()
    let contentBase64 =
      typeof parsed.body.contentBase64 === 'string' ? parsed.body.contentBase64 : undefined
    if (!deviceIds.length) {
      sendJson(res, 400, { ok: false, message: 'deviceIds is required' })
      return true
    }
    if (!filename) {
      sendJson(res, 400, { ok: false, message: 'filename is required' })
      return true
    }
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook(
        'print_batch_before',
        {
          proceed: true,
          deviceIds,
          filename,
          contentBase64
        },
        { method, path, url, query: Object.fromEntries(url.searchParams), headers: {}, auth }
      )) as {
        proceed?: boolean
        status?: number
        body?: unknown
        deviceIds?: string[]
        filename?: string
        contentBase64?: string
      }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (Array.isArray(before?.deviceIds)) deviceIds = before.deviceIds.map(String)
      if (before?.filename) filename = String(before.filename)
      if (typeof before?.contentBase64 === 'string') contentBase64 = before.contentBase64
    }
    let result = await deps.onBatchPrint({ deviceIds, filename, contentBase64 })
    for (const row of result.results || []) {
      deps.appendLog?.(
        makeOperationLog(
          row.deviceId,
          row.deviceName || deviceNameFromPath(deps.getDevicesPath, row.deviceId),
          'batch_print',
          row.ok ? 'ok' : 'error',
          row.message || filename
        )
      )
    }
    if (pm) {
      result = (await pm.runHook('print_batch_after', result)) as typeof result
    }
    sendJson(res, result.ok ? 200 : 502, result)
    return true
  }

  // —— Device CRUD ——
  if (method === 'POST' && path === '/api/v1/devices') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    if (!requireUserPerm(auth, 'device.create', res, sendJson)) return true
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let body = parsed.body
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'device_create',
          { proceed: true, device: body },
          { method, path, url, auth }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          device?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.device && typeof before.device === 'object') body = before.device
      }
    } catch {
      /* ignore */
    }
    const created = addDevice(deps.getDevicesPath(), body)
    if ('error' in created) {
      sendJson(res, 400, { ok: false, message: created.error })
      return true
    }
    if (created.secret && created.device.secretKey) {
      deps.setDeviceSecret(created.device.secretKey, created.secret)
    }
    deps.onDevicesChanged?.()
    sendJson(res, 200, {
      ok: true,
      device: deps.sanitizeDevice(created.device),
      secretSaved: !!created.secret
    })
    return true
  }

  const deviceOnly = path.match(/^\/api\/v1\/devices\/([^/]+)$/)
  if (deviceOnly && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const id = decodeURIComponent(deviceOnly[1])
    if (method === 'DELETE') {
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'device_delete',
            { proceed: true, deviceId: id },
            { method, path, url, auth }
          )) as {
            proceed?: boolean
            status?: number
            body?: unknown
          }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
            return true
          }
        }
      } catch {
        /* ignore */
      }
      const removed = removeDevice(deps.getDevicesPath(), id)
      if ('error' in removed) {
        sendJson(res, 404, { ok: false, message: removed.error })
        return true
      }
      if (removed.removed.secretKey) deps.deleteDeviceSecret(removed.removed.secretKey)
      deps.onDevicesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let patchBody = parsed.body
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'device_update',
          { proceed: true, deviceId: id, patch: patchBody },
          { method, path, url, auth }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          patch?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.patch && typeof before.patch === 'object') patchBody = before.patch
      }
    } catch {
      /* ignore */
    }
    const updated = updateDevice(deps.getDevicesPath(), id, patchBody)
    if ('error' in updated) {
      sendJson(res, updated.error === 'Device not found' ? 404 : 400, {
        ok: false,
        message: updated.error
      })
      return true
    }
    if (updated.clearSecret && updated.prevSecretKey) {
      deps.deleteDeviceSecret(updated.prevSecretKey)
    }
    if (updated.secret && updated.device.secretKey) {
      deps.setDeviceSecret(updated.device.secretKey, updated.secret)
    }
    deps.onDevicesChanged?.()
    sendJson(res, 200, {
      ok: true,
      device: deps.sanitizeDevice(updated.device),
      secretSaved: !!updated.secret
    })
    return true
  }

  // —— Device capabilities (plugin / UI probe) ——
  const capsMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/capabilities$/)
  if (capsMatch && method === 'GET') {
    const id = decodeURIComponent(capsMatch[1])
    if (!deps.onGetDeviceCapabilities) {
      sendJson(res, 501, { ok: false, message: 'capabilities 未实现' })
      return true
    }
    const capabilities = deps.onGetDeviceCapabilities(id)
    sendJson(res, 200, { ok: true, capabilities })
    return true
  }

  // —— Arbitrary G-code (Moonraker-class devices) ——
  const gcodeMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/gcode$/)
  if (gcodeMatch && method === 'POST') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const id = decodeURIComponent(gcodeMatch[1])
    if (!deps.onSendGcode) {
      sendJson(res, 501, { ok: false, message: 'gcode 未实现' })
      return true
    }
    if (auth) {
      const gate = assertDeviceControlAllowed(auth, id, 'gcode')
      if (!gate.ok) {
        sendJson(res, gate.status, { ok: false, message: gate.message })
        return true
      }
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const script =
      typeof parsed.body.script === 'string'
        ? parsed.body.script
        : typeof parsed.body.gcode === 'string'
          ? parsed.body.gcode
          : ''
    if (!String(script).trim()) {
      sendJson(res, 400, { ok: false, message: '需要 script 或 gcode 字符串' })
      return true
    }
    const result = await deps.onSendGcode(id, script)
    deps.appendLog?.(
      makeOperationLog(
        id,
        deviceNameFromPath(deps.getDevicesPath, id),
        'gcode',
        result.ok ? 'ok' : 'error',
        result.message
      )
    )
    sendJson(res, result.ok ? 200 : 502, { ok: result.ok, message: result.message })
    return true
  }

  // —— Moonraker HTTP proxy (no UI; plugins / advanced clients) ——
  const moonrakerMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/moonraker$/)
  if (moonrakerMatch && method === 'POST') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const id = decodeURIComponent(moonrakerMatch[1])
    if (!deps.onMoonrakerRequest) {
      sendJson(res, 501, { ok: false, message: 'moonraker 透传未实现' })
      return true
    }
    if (auth) {
      const gate = assertDeviceControlAllowed(auth, id, 'moonraker')
      if (!gate.ok) {
        sendJson(res, gate.status, { ok: false, message: gate.message })
        return true
      }
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const m = parseMoonrakerProxyMethod(parsed.body.method)
    const p = normalizeMoonrakerProxyPath(parsed.body.path)
    if (!m || !p) {
      sendJson(res, 400, {
        ok: false,
        message: '需要 method(GET|POST|DELETE) 与 path（以 / 开头）'
      })
      return true
    }
    const query =
      parsed.body.query && typeof parsed.body.query === 'object' && !Array.isArray(parsed.body.query)
        ? (parsed.body.query as Record<string, string | number | boolean | null | undefined>)
        : undefined
    const result = await deps.onMoonrakerRequest(id, {
      method: m,
      path: p,
      query,
      body: parsed.body.body
    })
    sendJson(res, result.ok ? 200 : result.status && result.status >= 400 ? result.status : 502, {
      ok: result.ok,
      status: result.status,
      data: result.data,
      message: result.message
    })
    return true
  }

  // —— Device files ——
  const filesList = path.match(/^\/api\/v1\/devices\/([^/]+)\/files$/)
  if (filesList && method === 'GET') {
    const id = decodeURIComponent(filesList[1])
    if (auth) {
      const gate = assertDeviceControlAllowed(auth, id, 'files.read')
      if (!gate.ok) {
        sendJson(res, gate.status, { ok: false, message: gate.message })
        return true
      }
    }
    let result = await deps.onDeviceOp({ deviceId: id, op: 'listFiles' })
    const pm = deps.getPluginManager?.()
    if (pm) {
      result = (await pm.runHook('files_list', { deviceId: id, ...result })) as typeof result
    }
    sendJson(res, result.ok ? 200 : 502, {
      ok: result.ok,
      files: result.files || [],
      message: result.message
    })
    return true
  }

  if (filesList && method === 'POST') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const id = decodeURIComponent(filesList[1])
    if (auth) {
      const gate = assertDeviceControlAllowed(auth, id, 'files.upload')
      if (!gate.ok) {
        sendJson(res, gate.status, { ok: false, message: gate.message })
        return true
      }
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    let filename = String(parsed.body.filename || '').trim()
    let contentBase64 = String(parsed.body.contentBase64 || '')
    if (!filename || !contentBase64) {
      sendJson(res, 400, { ok: false, message: 'filename and contentBase64 are required' })
      return true
    }
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook('files_upload', {
        proceed: true,
        deviceId: id,
        filename,
        contentBase64
      })) as {
        proceed?: boolean
        status?: number
        body?: unknown
        filename?: string
        contentBase64?: string
      }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (before?.filename) filename = String(before.filename)
      if (typeof before?.contentBase64 === 'string') contentBase64 = before.contentBase64
    }
    const result = await deps.onDeviceOp({
      deviceId: id,
      op: 'uploadFile',
      filename,
      contentBase64
    })
    deps.appendLog?.(
      makeOperationLog(
        id,
        deviceNameFromPath(deps.getDevicesPath, id),
        'upload',
        result.ok ? 'ok' : 'error',
        result.ok ? filename : result.message
      )
    )
    sendJson(res, result.ok ? 200 : 502, result)
    return true
  }

  const fileContent = path.match(/^\/api\/v1\/devices\/([^/]+)\/files\/content$/)
  if (fileContent && method === 'GET') {
    const id = decodeURIComponent(fileContent[1])
    if (auth) {
      const gate = assertDeviceControlAllowed(auth, id, 'files.read')
      if (!gate.ok) {
        sendJson(res, gate.status, { ok: false, message: gate.message })
        return true
      }
    }
    let remote = safeRemotePath(String(url.searchParams.get('path') || ''))
    if (!remote) {
      sendJson(res, 400, { ok: false, message: 'Query path is required and must be relative' })
      return true
    }
    const pm = deps.getPluginManager?.()
    if (pm) {
      const before = (await pm.runHook('files_download', {
        proceed: true,
        deviceId: id,
        remotePath: remote
      })) as { proceed?: boolean; status?: number; body?: unknown; remotePath?: string }
      if (before && before.proceed === false) {
        sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
        return true
      }
      if (before?.remotePath) remote = safeRemotePath(String(before.remotePath)) || remote
    }
    const result = await deps.onDeviceOp({
      deviceId: id,
      op: 'downloadFile',
      remotePath: remote
    })
    if (!result.ok) {
      deps.appendLog?.(
        makeOperationLog(
          id,
          deviceNameFromPath(deps.getDevicesPath, id),
          'download',
          'error',
          result.message || remote
        )
      )
      sendJson(res, 502, result)
      return true
    }
    deps.appendLog?.(
      makeOperationLog(
        id,
        deviceNameFromPath(deps.getDevicesPath, id),
        'download',
        'ok',
        remote
      )
    )
    const format = (url.searchParams.get('format') || 'json').toLowerCase()
    if (format === 'binary' || format === 'raw') {
      const buf = Buffer.from(result.contentBase64 || '', 'base64')
      const name = result.filename || remote.split('/').pop() || 'download.bin'
      res.writeHead(200, {
        'Content-Type': result.contentType || 'application/octet-stream',
        'Content-Length': buf.length,
        'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
      })
      res.end(buf)
      return true
    }
    sendJson(res, 200, {
      ok: true,
      filename: result.filename || remote,
      contentBase64: result.contentBase64,
      contentType: result.contentType || 'application/octet-stream'
    })
    return true
  }

  if (fileContent && method === 'DELETE') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    sendJson(res, 501, {
      ok: false,
      message: 'Device file delete is not supported via API yet'
    })
    return true
  }

  // —— Filament bind helpers ——
  const filamentBind = path.match(/^\/api\/v1\/filament\/([^/]+)\/(bind|unbind)$/)
  if (filamentBind && method === 'POST') {
    if (!requireControl(settings, res, sendJson, auth)) return true
    const spoolId = decodeURIComponent(filamentBind[1])
    const kind = filamentBind[2] as 'bind' | 'unbind'
    if (!requireUserPerm(auth, kind === 'bind' ? 'filament.bind' : 'filament.unbind', res, sendJson)) {
      return true
    }
    const parsed = await parseJsonBody(req, readBody)
    if (!parsed.ok) {
      sendJson(res, 400, { ok: false, message: parsed.message })
      return true
    }
    const deviceId = String(parsed.body.deviceId || '').trim()
    const slotId = Math.floor(Number(parsed.body.slotId))
    if (!deviceId || !Number.isFinite(slotId) || slotId < 0) {
      sendJson(res, 400, { ok: false, message: 'deviceId and slotId (>=0) are required' })
      return true
    }
    const file = deps.getFilamentPath()
    let spools = readJsonArray(file) as Array<Record<string, unknown>>
    try {
      const idx = spools.findIndex((s) => String(s.id) === spoolId)
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Spool not found' })
        return true
      }
      const spool = spools[idx]
      const rolls = Math.max(1, Math.min(99, Math.floor(Number(spool.rolls) || 1)))

      // Clear this slot on all spools; bind/unbind on target
      for (const s of spools) {
        let list: Array<{ deviceId: string; slotId: number }> = []
        if (Array.isArray(s.amsBindings)) {
          list = [...(s.amsBindings as Array<{ deviceId: string; slotId: number }>)]
        } else if (s.amsBinding && typeof s.amsBinding === 'object') {
          const b = s.amsBinding as { deviceId?: string; slotId?: number }
          if (b.deviceId) list = [{ deviceId: b.deviceId, slotId: Number(b.slotId) }]
        }
        list = list.filter(
          (b) => !(b.deviceId === deviceId && Number(b.slotId) === slotId)
        )
        if (String(s.id) === spoolId && kind === 'bind') {
          if (!list.some((b) => b.deviceId === deviceId && Number(b.slotId) === slotId)) {
            if (list.length >= rolls) {
              sendJson(res, 409, {
                ok: false,
                message: `Spool only has ${rolls} roll(s); binding full`
              })
              return true
            }
            list.push({ deviceId, slotId })
          }
        }
        s.amsBindings = list
        s.amsBinding = list[0] || null
        if (String(s.id) === spoolId) s.rolls = rolls
        s.updatedAt = new Date().toISOString()
      }
      writeJsonArray(file, spools)
      deps.onFilamentChanged?.()
      const next = spools.find((s) => String(s.id) === spoolId)
      sendJson(res, 200, { ok: true, spool: next })
      return true
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      })
      return true
    }
  }

  return false
}
