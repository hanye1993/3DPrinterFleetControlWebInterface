import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import { readJsonArray, writeJsonArray } from '../storage/jsonBridge'
import { canDeviceAction } from '../../shared/permissions'
import type { AuthContext } from '../auth/authApi'

export type ZoneCameraRow = {
  id: string
  name: string
  url: string
  snapshotUrl?: string
  sourceType?: string
  pluginData?: Record<string, unknown>
  [key: string]: unknown
}

export type MonitorZoneRow = {
  id: string
  name: string
  cameras: ZoneCameraRow[]
  createdAt: string
  updatedAt?: string
}

export type MonitorCameraInfo = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
}

export type MonitorWallDevice = {
  deviceId: string
  name: string
  brand: string
  cameras: MonitorCameraInfo[]
}

export type SnapshotResult =
  | { ok: true; contentType: string; base64: string }
  | { ok: false; message: string }

export type MonitorApiDeps = {
  getMonitorZonesPath: () => string
  onMonitorZonesChanged?: () => void
  listWall: () => Promise<MonitorWallDevice[]>
  listDeviceCameras: (deviceId: string) => Promise<MonitorWallDevice | null>
  /** Resolve snapshot for a raw camera URL (HTTP / MJPEG / bambu-cam://) */
  takeSnapshot: (url: string, apiKey?: string) => Promise<SnapshotResult>
  /** Device secret for Moonraker / Bambu LAN access code */
  getDeviceApiKey: (deviceId: string) => string | null
  /**
   * Extra discovery URL candidates for a logical device camera (chamber fail-over).
   * Used when the primary collapsed URL does not yield a frame.
   */
  listDeviceCameraProbeUrls?: (deviceId: string, cameraId: string) => Promise<string[]>
  getPluginManager?: () => {
    runHook: (name: string, value: unknown, ctx?: unknown) => Promise<unknown>
  } | null
}

type JsonSend = (res: ServerResponse, status: number, body: unknown) => void

function normalizeSnapshotUrl(raw: string): string {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.startsWith('bambu-cam://') || s.startsWith('server-api:')) return s
  try {
    const u = new URL(s.includes('://') ? s : `http://${s}`)
    u.hash = ''
    u.username = ''
    u.password = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return s
  }
}

function isBlockedSnapshotHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  if (!h) return true
  if (h === 'localhost' || h === 'metadata.google.internal') return true
  if (h === '169.254.169.254' || h === 'metadata') return true
  // IPv4 private/link-local still allowed for LAN printers — only block cloud metadata.
  return false
}

async function isAllowedSnapshotUrl(deps: MonitorApiDeps, target: string): Promise<boolean> {
  const want = normalizeSnapshotUrl(target)
  if (!want) return false
  try {
    if (/^https?:\/\//i.test(want)) {
      const host = new URL(want).hostname
      if (isBlockedSnapshotHost(host)) return false
    }
  } catch {
    return false
  }
  const allowed = new Set<string>()
  for (const z of readZones(deps.getMonitorZonesPath())) {
    for (const c of z.cameras || []) {
      if (c.url) allowed.add(normalizeSnapshotUrl(String(c.url)))
      if (c.snapshotUrl) allowed.add(normalizeSnapshotUrl(String(c.snapshotUrl)))
    }
  }
  try {
    const wall = await deps.listWall()
    for (const d of wall) {
      for (const c of d.cameras || []) {
        if (c.streamUrl) allowed.add(normalizeSnapshotUrl(String(c.streamUrl)))
        if (c.snapshotUrl) allowed.add(normalizeSnapshotUrl(String(c.snapshotUrl)))
      }
    }
  } catch {
    /* ignore wall errors — zones alone may still allow */
  }
  if (allowed.has(want)) return true
  // Prefix match for server-api paths / query variants
  for (const a of allowed) {
    if (!a) continue
    if (want.startsWith(a) || a.startsWith(want)) return true
  }
  return false
}

/** Client JWT users only see cameras for devices they can view. */
function canViewDeviceCameras(auth: AuthContext | null | undefined, deviceId: string): boolean {
  if (!auth || auth.kind === 'apiKey' || auth.kind === 'local') return true
  if (auth.kind === 'user') return canDeviceAction(auth.user, deviceId, 'view')
  return false
}
function readZones(path: string): MonitorZoneRow[] {
  const raw = readJsonArray(path)
  return raw.filter(
    (z) => z && typeof z === 'object' && typeof (z as MonitorZoneRow).id === 'string'
  ) as MonitorZoneRow[]
}

function writeZones(path: string, zones: MonitorZoneRow[]): void {
  writeJsonArray(path, zones)
}

function sendImage(
  res: ServerResponse,
  status: number,
  contentType: string,
  buf: Buffer
): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key'
  })
  res.end(buf)
}

async function respondSnapshot(
  res: ServerResponse,
  url: URL,
  result: SnapshotResult,
  sendJson: JsonSend
): Promise<void> {
  if (!result.ok) {
    sendJson(res, 502, { ok: false, message: result.message })
    return
  }
  const format = (url.searchParams.get('format') || 'jpeg').toLowerCase()
  if (format === 'json' || format === 'base64') {
    sendJson(res, 200, {
      ok: true,
      contentType: result.contentType,
      base64: result.base64
    })
    return
  }
  sendImage(res, 200, result.contentType || 'image/jpeg', Buffer.from(result.base64, 'base64'))
}

function collectCameraExtras(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (
    source.pluginData != null &&
    typeof source.pluginData === 'object' &&
    !Array.isArray(source.pluginData)
  ) {
    out.pluginData = source.pluginData
  }
  for (const [k, v] of Object.entries(source)) {
    if (!(k.startsWith('x_') || k.startsWith('plugin_'))) continue
    if (v === undefined) continue
    out[k] = v
  }
  return out
}

function normalizeCameraInput(
  body: Record<string, unknown>,
  prev?: ZoneCameraRow
): { cam: ZoneCameraRow } | { error: string } {
  const name = String(body.name ?? prev?.name ?? '').trim() || '摄像头'
  const sourceTypeRaw = body.sourceType ?? prev?.sourceType
  const sourceType =
    sourceTypeRaw != null && String(sourceTypeRaw).trim()
      ? String(sourceTypeRaw).trim()
      : undefined
  let url = String(body.url ?? prev?.url ?? '').trim()
  const isPluginSource = !!(sourceType && sourceType !== 'http' && sourceType !== 'stream')
  if (!url && isPluginSource) {
    url = `plugin://${sourceType}`
  }
  if (!url) return { error: 'url is required (or use a plugin sourceType)' }
  const snapshotRaw = body.snapshotUrl ?? prev?.snapshotUrl
  const snapshotUrl =
    snapshotRaw != null && String(snapshotRaw).trim() ? String(snapshotRaw).trim() : undefined
  const extras = {
    ...collectCameraExtras(prev || {}),
    ...collectCameraExtras(body)
  }
  return {
    cam: {
      id: prev?.id || randomUUID(),
      name,
      url,
      snapshotUrl,
      sourceType: isPluginSource ? sourceType : sourceType === 'http' ? 'http' : sourceType,
      ...extras
    }
  }
}

async function resolveZoneCameraSnapshot(
  deps: MonitorApiDeps,
  opts: {
    zone: MonitorZoneRow
    camera: ZoneCameraRow
    method: string
    path: string
    url: URL
    auth?: AuthContext | null
  }
): Promise<SnapshotResult> {
  try {
    const pm = deps.getPluginManager?.()
    if (pm) {
      const hooked = (await pm.runHook(
        'monitor_camera_snapshot',
        {
          handled: false,
          zone: opts.zone,
          camera: opts.camera
        },
        { method: opts.method, path: opts.path, url: opts.url, auth: opts.auth }
      )) as {
        handled?: boolean
        ok?: boolean
        contentType?: string
        base64?: string
        message?: string
        url?: string
      }
      if (hooked && hooked.handled === true) {
        if (hooked.ok && hooked.base64) {
          return {
            ok: true,
            contentType: hooked.contentType || 'image/jpeg',
            base64: hooked.base64
          }
        }
        return { ok: false, message: hooked.message || 'Plugin snapshot failed' }
      }
      if (hooked && typeof hooked.url === 'string' && hooked.url.trim()) {
        return deps.takeSnapshot(hooked.url.trim())
      }
    }
  } catch {
    /* fall through */
  }
  const target = (opts.camera.snapshotUrl || opts.camera.url || '').trim()
  if (!target || target.startsWith('plugin://')) {
    return {
      ok: false,
      message:
        '该摄像头未提供可拉取的 URL；请在插件 main.js 实现 monitor_camera_snapshot 返回画面'
    }
  }
  return deps.takeSnapshot(target)
}

/**
 * Handle /api/v1/monitor/* and /api/v1/devices/:id/cameras*
 * @returns true if the request was handled
 */
export async function handleMonitorApi(opts: {
  method: string
  path: string
  url: URL
  req: IncomingMessage
  res: ServerResponse
  apiMode: 'readonly' | 'control'
  auth?: AuthContext | null
  deps: MonitorApiDeps
  sendJson: JsonSend
  readBody: (req: IncomingMessage) => Promise<string>
}): Promise<boolean> {
  const { method, path, url, req, res, apiMode, auth, deps, sendJson, readBody } = opts
  const requireControl = (): boolean => {
    if (apiMode !== 'control') {
      sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
      return false
    }
    return true
  }

  // —— 内部监控（打印机舱内摄像头墙）——
  if (method === 'GET' && path === '/api/v1/monitor/wall') {
    let wall = (await deps.listWall()).filter((row) => canViewDeviceCameras(auth, row.deviceId))
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const hooked = (await pm.runHook(
          'monitor_wall',
          { devices: wall },
          { method, path, url, auth }
        )) as { devices?: MonitorWallDevice[] }
        if (hooked?.devices && Array.isArray(hooked.devices)) wall = hooked.devices
      }
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true, devices: wall })
    return true
  }

  const deviceCams = path.match(/^\/api\/v1\/devices\/([^/]+)\/cameras$/)
  if (method === 'GET' && deviceCams) {
    const id = decodeURIComponent(deviceCams[1])
    if (!canViewDeviceCameras(auth, id)) {
      sendJson(res, 403, { ok: false, message: '无该设备摄像头权限' })
      return true
    }
    const row = await deps.listDeviceCameras(id)
    if (!row) {
      sendJson(res, 404, { ok: false, message: 'Device not found' })
      return true
    }
    sendJson(res, 200, { ok: true, ...row })
    return true
  }

  const deviceCamSnap = path.match(/^\/api\/v1\/devices\/([^/]+)\/cameras\/([^/]+)\/snapshot$/)
  if (method === 'GET' && deviceCamSnap) {
    const deviceId = decodeURIComponent(deviceCamSnap[1])
    const cameraId = decodeURIComponent(deviceCamSnap[2])
    if (!canViewDeviceCameras(auth, deviceId)) {
      sendJson(res, 403, { ok: false, message: '无该设备摄像头权限' })
      return true
    }
    const row = await deps.listDeviceCameras(deviceId)
    if (!row) {
      sendJson(res, 404, { ok: false, message: 'Device not found' })
      return true
    }
    const cam = row.cameras.find((c) => c.id === cameraId)
    if (!cam) {
      sendJson(res, 404, { ok: false, message: 'Camera not found' })
      return true
    }
    const target = cam.snapshotUrl || cam.streamUrl
    const apiKey = deps.getDeviceApiKey(deviceId) || undefined
    let shot = await deps.takeSnapshot(target, apiKey)
    if (!shot.ok && deps.listDeviceCameraProbeUrls && !String(cameraId).startsWith('extra:')) {
      try {
        const probes = await deps.listDeviceCameraProbeUrls(deviceId, cameraId)
        for (const u of probes) {
          if (!u || u === target) continue
          shot = await deps.takeSnapshot(u, apiKey)
          if (shot.ok) break
        }
      } catch {
        /* keep first failure */
      }
    }
    await respondSnapshot(res, url, shot, sendJson)
    return true
  }

  // —— 区域监控 ——
  if (method === 'GET' && path === '/api/v1/monitor/zones') {
    let zones = readZones(deps.getMonitorZonesPath())
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const hooked = (await pm.runHook(
          'monitor_zones_list',
          { zones },
          { method, path, url, auth }
        )) as { zones?: MonitorZoneRow[] }
        if (hooked?.zones && Array.isArray(hooked.zones)) zones = hooked.zones
      }
    } catch {
      /* ignore */
    }
    sendJson(res, 200, { ok: true, zones })
    return true
  }

  if (method === 'POST' && path === '/api/v1/monitor/zones') {
    if (!requireControl()) return true
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'monitor_zone_create',
          { proceed: true, zone: body },
          { method, path, url, auth }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          zone?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.zone && typeof before.zone === 'object') body = before.zone
      }
    } catch {
      /* ignore */
    }
    const now = new Date().toISOString()
    const zone: MonitorZoneRow = {
      id: randomUUID(),
      name: String(body.name || '').trim() || '未命名区域',
      cameras: [],
      createdAt: now,
      updatedAt: now
    }
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    zones.push(zone)
    writeZones(file, zones)
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, zone })
    return true
  }

  if (method === 'PUT' && path === '/api/v1/monitor/zones') {
    if (!requireControl()) return true
    const raw = await readBody(req)
    let body: unknown
    try {
      body = raw ? JSON.parse(raw) : null
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    const list = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as { zones?: unknown }).zones)
        ? (body as { zones: unknown[] }).zones
        : null
    if (!list) {
      sendJson(res, 400, { ok: false, message: 'Body must be a zones array or { zones: [] }' })
      return true
    }
    writeZones(deps.getMonitorZonesPath(), list as MonitorZoneRow[])
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, zones: readZones(deps.getMonitorZonesPath()) })
    return true
  }

  const zoneOne = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)$/)
  if (zoneOne) {
    const zoneId = decodeURIComponent(zoneOne[1])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const idx = zones.findIndex((z) => z.id === zoneId)

    if (method === 'GET') {
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      sendJson(res, 200, { ok: true, zone: zones[idx] })
      return true
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (!requireControl()) return true
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      const raw = await readBody(req)
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
        return true
      }
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'monitor_zone_update',
            { proceed: true, zoneId, zone: body, prev: zones[idx] },
            { method, path, url, auth }
          )) as {
            proceed?: boolean
            status?: number
            body?: unknown
            zone?: Record<string, unknown>
          }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
            return true
          }
          if (before?.zone && typeof before.zone === 'object') body = before.zone
        }
      } catch {
        /* ignore */
      }
      const name = String(body.name ?? zones[idx].name).trim()
      if (!name) {
        sendJson(res, 400, { ok: false, message: 'name is required' })
        return true
      }
      const cameras =
        method === 'PUT' && Array.isArray(body.cameras)
          ? (body.cameras as ZoneCameraRow[])
          : zones[idx].cameras
      zones[idx] = {
        ...zones[idx],
        name,
        cameras,
        updatedAt: new Date().toISOString()
      }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true, zone: zones[idx] })
      return true
    }

    if (method === 'DELETE') {
      if (!requireControl()) return true
      if (idx < 0) {
        sendJson(res, 404, { ok: false, message: 'Zone not found' })
        return true
      }
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'monitor_zone_delete',
            { proceed: true, zoneId, zone: zones[idx] },
            { method, path, url, auth }
          )) as { proceed?: boolean; status?: number; body?: unknown }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
            return true
          }
        }
      } catch {
        /* ignore */
      }
      zones.splice(idx, 1)
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  const zoneCams = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras$/)
  if (method === 'POST' && zoneCams) {
    if (!requireControl()) return true
    const zoneId = decodeURIComponent(zoneCams[1])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const idx = zones.findIndex((z) => z.id === zoneId)
    if (idx < 0) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    try {
      const pm = deps.getPluginManager?.()
      if (pm) {
        const before = (await pm.runHook(
          'monitor_camera_create',
          { proceed: true, zoneId, camera: body },
          { method, path, url, auth }
        )) as {
          proceed?: boolean
          status?: number
          body?: unknown
          camera?: Record<string, unknown>
        }
        if (before && before.proceed === false) {
          sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
          return true
        }
        if (before?.camera && typeof before.camera === 'object') body = before.camera
      }
    } catch {
      /* ignore */
    }
    const created = normalizeCameraInput(body)
    if ('error' in created) {
      sendJson(res, 400, { ok: false, message: created.error })
      return true
    }
    zones[idx] = {
      ...zones[idx],
      cameras: [...zones[idx].cameras, created.cam],
      updatedAt: new Date().toISOString()
    }
    writeZones(file, zones)
    deps.onMonitorZonesChanged?.()
    sendJson(res, 200, { ok: true, camera: created.cam, zone: zones[idx] })
    return true
  }

  const zoneCamOne = path.match(/^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras\/([^/]+)$/)
  if (zoneCamOne) {
    const zoneId = decodeURIComponent(zoneCamOne[1])
    const cameraId = decodeURIComponent(zoneCamOne[2])
    const file = deps.getMonitorZonesPath()
    const zones = readZones(file)
    const zIdx = zones.findIndex((z) => z.id === zoneId)
    if (zIdx < 0) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const cIdx = zones[zIdx].cameras.findIndex((c) => c.id === cameraId)

    if (method === 'GET') {
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      sendJson(res, 200, { ok: true, camera: zones[zIdx].cameras[cIdx] })
      return true
    }

    if (method === 'PATCH' || method === 'PUT') {
      if (!requireControl()) return true
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      const raw = await readBody(req)
      let body: Record<string, unknown> = {}
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      } catch {
        sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
        return true
      }
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'monitor_camera_update',
            {
              proceed: true,
              zoneId,
              cameraId,
              camera: body,
              prev: zones[zIdx].cameras[cIdx]
            },
            { method, path, url, auth }
          )) as {
            proceed?: boolean
            status?: number
            body?: unknown
            camera?: Record<string, unknown>
          }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
            return true
          }
          if (before?.camera && typeof before.camera === 'object') body = before.camera
        }
      } catch {
        /* ignore */
      }
      const next = normalizeCameraInput(body, zones[zIdx].cameras[cIdx])
      if ('error' in next) {
        sendJson(res, 400, { ok: false, message: next.error })
        return true
      }
      zones[zIdx].cameras[cIdx] = next.cam
      zones[zIdx] = { ...zones[zIdx], updatedAt: new Date().toISOString() }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true, camera: next.cam, zone: zones[zIdx] })
      return true
    }

    if (method === 'DELETE') {
      if (!requireControl()) return true
      if (cIdx < 0) {
        sendJson(res, 404, { ok: false, message: 'Camera not found' })
        return true
      }
      try {
        const pm = deps.getPluginManager?.()
        if (pm) {
          const before = (await pm.runHook(
            'monitor_camera_delete',
            {
              proceed: true,
              zoneId,
              cameraId,
              camera: zones[zIdx].cameras[cIdx]
            },
            { method, path, url, auth }
          )) as { proceed?: boolean; status?: number; body?: unknown }
          if (before && before.proceed === false) {
            sendJson(res, before.status || 403, before.body ?? { ok: false, message: 'blocked' })
            return true
          }
        }
      } catch {
        /* ignore */
      }
      zones[zIdx].cameras.splice(cIdx, 1)
      zones[zIdx] = { ...zones[zIdx], updatedAt: new Date().toISOString() }
      writeZones(file, zones)
      deps.onMonitorZonesChanged?.()
      sendJson(res, 200, { ok: true })
      return true
    }
  }

  const zoneCamSnap = path.match(
    /^\/api\/v1\/monitor\/zones\/([^/]+)\/cameras\/([^/]+)\/snapshot$/
  )
  if (method === 'GET' && zoneCamSnap) {
    const zoneId = decodeURIComponent(zoneCamSnap[1])
    const cameraId = decodeURIComponent(zoneCamSnap[2])
    const zones = readZones(deps.getMonitorZonesPath())
    const zone = zones.find((z) => z.id === zoneId)
    if (!zone) {
      sendJson(res, 404, { ok: false, message: 'Zone not found' })
      return true
    }
    const cam = zone.cameras.find((c) => c.id === cameraId)
    if (!cam) {
      sendJson(res, 404, { ok: false, message: 'Camera not found' })
      return true
    }
    const shot = await resolveZoneCameraSnapshot(deps, {
      zone,
      camera: cam,
      method,
      path,
      url,
      auth
    })
    await respondSnapshot(res, url, shot, sendJson)
    return true
  }

  if (method === 'POST' && path === '/api/v1/camera/snapshot') {
    const raw = await readBody(req)
    let body: Record<string, unknown> = {}
    try {
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
      return true
    }
    const target = String(body.url || '').trim()
    if (!target) {
      sendJson(res, 400, { ok: false, message: 'url required' })
      return true
    }
    const allowed = await isAllowedSnapshotUrl(deps, target)
    if (!allowed) {
      sendJson(res, 403, {
        ok: false,
        message: '摄像头地址不在白名单（仅允许已登记设备/区域摄像头）'
      })
      return true
    }
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined
    const shot = await deps.takeSnapshot(target, apiKey)
    if (!shot.ok) {
      sendJson(res, 502, { ok: false, message: shot.message })
      return true
    }
    sendJson(res, 200, {
      ok: true,
      contentType: shot.contentType,
      base64: shot.base64
    })
    return true
  }

  return false
}

export function monitorSummaryCounts(zonesPath: string): {
  zones: number
  cameras: number
} {
  const zones = readZones(zonesPath)
  return {
    zones: zones.length,
    cameras: zones.reduce((n, z) => n + (z.cameras?.length || 0), 0)
  }
}
