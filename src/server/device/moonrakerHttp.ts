import axios, { type AxiosInstance } from 'axios'
import {
  buildJogGcode,
  isControlAction,
  normalizeMoonrakerProxyPath,
  parseControlExtras,
  parseExtrudeAmount,
  parseMoonrakerProxyMethod,
  parseZOffsetAmount,
  type JogAxis,
  type MoonrakerProxyRequest
} from '../../main/api/controlShared'

function authHeaders(secret?: string): Record<string, string> {
  if (!secret) return {}
  if (secret.split('.').length >= 3) return { Authorization: `Bearer ${secret}` }
  return { 'X-Api-Key': secret }
}

export function createMoonrakerClient(baseUrl: string, apiKey?: string): AxiosInstance {
  return axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    timeout: 15000,
    headers: authHeaders(apiKey)
  })
}

export function mapMoonrakerStatus(
  deviceId: string,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const printStats = (raw.print_stats ?? {}) as Record<string, unknown>
  const display = (raw.display_status ?? {}) as Record<string, unknown>
  const virtual = (raw.virtual_sdcard ?? {}) as Record<string, unknown>
  const extruder = (raw.extruder ?? {}) as Record<string, unknown>
  const bed = (raw.heater_bed ?? {}) as Record<string, unknown>
  const gcodeMove = (raw.gcode_move ?? {}) as Record<string, unknown>

  const progressFrac = Number(display.progress ?? virtual.progress ?? 0)
  const progress = Number.isFinite(progressFrac)
    ? Math.max(0, Math.min(100, progressFrac * 100))
    : 0
  const state = String(printStats.state || 'standby')
  const duration = Number(printStats.print_duration ?? 0)
  let remainingSeconds: number | undefined
  if (progress >= 0.5 && progress < 99.9 && duration > 0) {
    remainingSeconds = Math.round(duration * ((100 - progress) / progress))
  } else if (progress >= 99.9) {
    remainingSeconds = 0
  }

  const info = printStats.info as { current_layer?: number; total_layer?: number } | undefined
  const layer = info?.current_layer != null ? Number(info.current_layer) : undefined
  const layerTotal = info?.total_layer != null ? Number(info.total_layer) : undefined
  const filename = String(printStats.filename || '').trim() || undefined
  const errMsg = String(printStats.message || '').trim()

  let fanSpeed = 0
  const fan = raw.fan as { speed?: number } | undefined
  if (fan?.speed != null) fanSpeed = Math.round(Number(fan.speed) * 100)

  return {
    deviceId,
    health: errMsg ? 'warning' : 'online',
    state,
    progress,
    remainingSeconds,
    layer,
    layerTotal,
    extruder: {
      actual: Number(extruder.temperature ?? 0),
      target: Number(extruder.target ?? 0)
    },
    bed: {
      actual: Number(bed.temperature ?? 0),
      target: Number(bed.target ?? 0)
    },
    fanSpeed,
    printSpeed: gcodeMove.speed_factor != null ? Math.round(Number(gcodeMove.speed_factor) * 100) : undefined,
    filename,
    message: errMsg || undefined,
    updatedAt: new Date().toISOString()
  }
}

function controlToGcode(payload: Record<string, unknown>): string | null {
  const action = payload.action
  if (!isControlAction(action)) return null
  switch (action) {
    case 'pause':
      return 'PAUSE'
    case 'resume':
      return 'RESUME'
    case 'cancel':
      return 'CANCEL_PRINT'
    case 'emergency_stop':
      return 'M112'
    case 'home':
      return 'G28'
    case 'jog': {
      const axis = payload.axis as JogAxis | undefined
      const amount = payload.amount
      if (!axis || typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
        return null
      }
      return buildJogGcode(axis, amount)
    }
    case 'set_temp':
      if (payload.heater === 'bed') return `M140 S${payload.temperature ?? 0}`
      return `M104 S${payload.temperature ?? 0}`
    case 'set_chamber_temp': {
      const t = Math.round(Number(payload.temperature ?? 0))
      return `M141 S${t}`
    }
    case 'set_fan': {
      const pct = Math.max(0, Math.min(100, Math.round(Number(payload.percent ?? 0))))
      if (payload.fan === 'chamber') {
        const name = String(payload.fanName || 'chamber_fan').replace(/[^\w-]/g, '') || 'chamber_fan'
        return `SET_FAN_SPEED FAN=${name} SPEED=${(pct / 100).toFixed(2)}`
      }
      return `M106 S${Math.round((pct / 100) * 255)}`
    }
    case 'set_speed':
      return `M220 S${payload.percent ?? 100}`
    case 'set_flow':
      return `M221 S${Math.max(1, Math.min(200, Math.round(Number(payload.percent ?? 100))))}`
    case 'set_z_offset': {
      const adj = parseZOffsetAmount(payload.amount)
      if (adj == null) return null
      return `SET_GCODE_OFFSET Z_ADJUST=${adj} MOVE=1`
    }
    case 'extrude':
    case 'retract': {
      const len = parseExtrudeAmount(payload.amount)
      if (len == null) return null
      const signed = action === 'retract' ? -len : len
      const temp = Number(payload.temperature)
      const heat =
        Number.isFinite(temp) && temp > 0 ? `M109 S${Math.round(temp)}\n` : ''
      return `${heat}G91\nG1 E${signed} F300\nG90`
    }
    case 'load_filament': {
      const t = payload.temperature
      return t != null && Number(t) > 0 ? `LOAD_FILAMENT TEMP=${Math.round(Number(t))}` : 'LOAD_FILAMENT'
    }
    case 'unload_filament': {
      const t = payload.temperature
      return t != null && Number(t) > 0 ? `UNLOAD_FILAMENT TEMP=${Math.round(Number(t))}` : 'UNLOAD_FILAMENT'
    }
    default:
      return null
  }
}

export async function moonrakerPollStatus(
  http: AxiosInstance,
  deviceId: string,
  objectKeys: string[]
): Promise<Record<string, unknown>> {
  const { data } = await http.get('/printer/objects/query', {
    params: Object.fromEntries(objectKeys.map((k) => [k, ''])),
    paramsSerializer: {
      serialize: (params) =>
        Object.keys(params as Record<string, string>)
          .map((k) => encodeURIComponent(k))
          .join('&')
    }
  })
  const raw = (data?.result?.status ?? {}) as Record<string, unknown>
  return mapMoonrakerStatus(deviceId, raw)
}

export async function moonrakerControl(
  http: AxiosInstance,
  payload: Record<string, unknown>
): Promise<void> {
  if (payload.action === 'print_file') {
    const filename = String(payload.filename || '').replace(/^\/+/, '')
    if (!filename) throw new Error('缺少文件名')
    await http.post('/printer/print/start', null, { params: { filename } })
    return
  }
  if (payload.action === 'restart') {
    await http.post('/printer/restart')
    return
  }
  if (payload.action === 'firmware_restart') {
    await http.post('/printer/firmware_restart')
    return
  }
  if (payload.action === 'jog') {
    const axis = payload.axis as JogAxis | undefined
    const amount = payload.amount
    if (!axis || typeof amount !== 'number' || !Number.isFinite(amount) || amount === 0) {
      throw new Error('点动需要 axis(X/Y/Z/E) 与非零 amount(mm)')
    }
  }
  if (payload.action === 'set_z_offset' && parseZOffsetAmount(payload.amount) == null) {
    throw new Error('set_z_offset 需要非零 amount(mm)，范围 ±2')
  }
  if (
    (payload.action === 'extrude' || payload.action === 'retract') &&
    parseExtrudeAmount(payload.amount) == null
  ) {
    throw new Error('extrude/retract 需要 amount(mm)，范围 0.1–50')
  }
  const script = controlToGcode(payload)
  if (!script) throw new Error('不支持的控制指令')
  await http.post('/printer/gcode/script', null, { params: { script } })
}

export async function moonrakerProxyRequest(
  http: AxiosInstance,
  req: MoonrakerProxyRequest
): Promise<{ ok: boolean; status: number; data?: unknown; message?: string }> {
  const method = parseMoonrakerProxyMethod(req.method)
  const path = normalizeMoonrakerProxyPath(req.path)
  if (!method || !path) {
    return { ok: false, status: 400, message: 'method/path 无效（仅 GET|POST|DELETE，path 须为 /…）' }
  }
  try {
    const res = await http.request({
      method,
      url: path,
      params: req.query || undefined,
      data: method === 'GET' ? undefined : req.body,
      timeout: 60_000,
      validateStatus: () => true
    })
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      data: res.data
    }
  } catch (e) {
    return {
      ok: false,
      status: 502,
      message: e instanceof Error ? e.message : String(e)
    }
  }
}

export async function moonrakerListFiles(
  http: AxiosInstance
): Promise<Array<{ path: string; size: number; modified?: number }>> {
  const { data } = await http.get('/server/files/list', { params: { root: 'gcodes' } })
  const list = (data?.result ?? []) as Array<{ path: string; size: number; modified?: number }>
  return list
    .map((f) => ({ path: f.path, size: f.size, modified: f.modified }))
    .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
}

export async function moonrakerUploadFile(
  http: AxiosInstance,
  filename: string,
  content: Buffer
): Promise<void> {
  const form = new FormData()
  const bytes = new Uint8Array(content.length)
  bytes.set(content)
  form.append('file', new Blob([bytes]), filename)
  form.append('root', 'gcodes')
  await http.post('/server/files/upload', form, {
    timeout: 300000,
    headers: { 'Content-Type': 'multipart/form-data' }
  })
}

export async function moonrakerDownloadFile(http: AxiosInstance, remotePath: string): Promise<Buffer> {
  const path = remotePath.replace(/^\/+/, '')
  const { data } = await http.get(`/server/files/gcodes/${encodeURI(path)}`, {
    responseType: 'arraybuffer',
    timeout: 300000
  })
  return Buffer.from(data as ArrayBuffer)
}

export function parseControlPayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {}
  const o = body as Record<string, unknown>
  if (!isControlAction(o.action)) return o
  return { action: o.action, ...parseControlExtras(o) }
}
