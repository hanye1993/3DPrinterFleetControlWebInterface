import axios, { type AxiosInstance } from 'axios'
import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import { emptyStatus, type PrinterAdapter, type StatusListener } from './base'
import { resolveDeviceRefreshMs, useSettingsStore } from '../stores/settingsStore'
import { parseGcodeFilamentGrams } from '../utils/gcodeFilament'

function pollMs(): number {
  return resolveDeviceRefreshMs(useSettingsStore.getState().settings)
}

function backupPollMs(): number {
  return Math.max(pollMs() * 3, 6000)
}

type MoonrakerWsMsg = {
  jsonrpc?: string
  method?: string
  params?: unknown
  id?: number
  result?: unknown
  error?: { message: string }
}

const BASE_OBJECTS = [
  'print_stats',
  'display_status',
  'toolhead',
  'extruder',
  'heater_bed',
  'fan',
  'gcode_move',
  'virtual_sdcard'
]

export class MoonrakerAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly brand: DeviceConfig['brand']
  private http: AxiosInstance
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private printDuration = 0
  private wsMode: 'live' | 'poll' = 'poll'
  private unsubWs: (() => void) | null = null
  private metaFilename: string | null = null
  private layerTotalFromMeta: number | undefined
  private layerHeightFromMeta: number | undefined
  private objectHeightFromMeta: number | undefined
  /** gcode metadata estimated_time (seconds) */
  private estimatedTimeFromMeta: number | undefined
  /** gcode metadata filament_weight sum (grams) */
  private filamentWeightFromMeta: number | undefined
  private objectKeys: string[] = [...BASE_OBJECTS]

  constructor(config: DeviceConfig, apiKey: string) {
    this.deviceId = config.id
    this.baseUrl = (config.baseUrl || '').replace(/\/$/, '')
    this.apiKey = apiKey
    this.brand = config.brand
    this.last = emptyStatus(config.id, 'connecting')
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      headers: moonrakerAuthHeaders(apiKey)
    })
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', message: '连接中…' })
    try {
      await this.http.get('/server/info')
      await this.resolveObjects()
      await this.refreshSnapshot()
      this.startPolling()
      void this.openWs()
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw err
    }
  }

  private async resolveObjects(): Promise<void> {
    try {
      const { data } = await this.http.get('/printer/objects/list')
      const listed: string[] = data?.result?.objects ?? []
      const fans = listed.filter(
        (o) =>
          o === 'fan' ||
          o.startsWith('fan_generic') ||
          o.startsWith('heater_fan') ||
          o.startsWith('controller_fan')
      )
      const sensors = listed.filter(
        (o) =>
          o.startsWith('temperature_sensor') ||
          o.startsWith('temperature_fan') ||
          o === 'temperature_host'
      )
      this.objectKeys = Array.from(new Set([...BASE_OBJECTS, ...fans, ...sensors]))
    } catch {
      this.objectKeys = [...BASE_OBJECTS]
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopPolling()
    this.unsubWs?.()
    this.unsubWs = null
    await window.electronAPI?.moonrakerWs?.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    if (payload.action === 'print_file') {
      if (!payload.filename) throw new Error('缺少文件名')
      await this.printFile(payload.filename)
      return
    }
    const script = toGcode(payload)
    if (!script) throw new Error('不支持的控制指令')
    await this.http.post('/printer/gcode/script', null, { params: { script } })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    const { data } = await this.http.get('/server/files/list', { params: { root: 'gcodes' } })
    const list = (data?.result ?? []) as Array<{ path: string; size: number; modified?: number }>
    return list
      .map((f) => ({ path: f.path, size: f.size, modified: f.modified }))
      .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0))
  }

  async uploadFile(file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('root', 'gcodes')
    await this.http.post('/server/files/upload', form, {
      timeout: 120000,
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  }

  async downloadFile(remotePath: string): Promise<ArrayBuffer> {
    const path = remotePath.replace(/^\/+/, '')
    const { data } = await this.http.get(`/server/files/gcodes/${encodeURI(path)}`, {
      responseType: 'arraybuffer',
      timeout: 120000
    })
    return data as ArrayBuffer
  }

  async printFile(remotePath: string): Promise<void> {
    const filename = remotePath.replace(/^\/+/, '')
    await this.http.post('/printer/print/start', null, { params: { filename } })
  }

  async getCameras() {
    const { discoverDeviceCameras } = await import('./camera')
    const list = await discoverDeviceCameras(
      { id: this.deviceId, name: '', brand: this.brand, baseUrl: this.baseUrl, createdAt: '' },
      this.apiKey
    )
    // Fallback optimistic candidate if IPC returned empty but we have a baseUrl
    if (!list.length && this.baseUrl) {
      const origin = this.baseUrl.replace(/\/$/, '')
      return [
        {
          id: 'fallback-webcam',
          name: '摄像头',
          streamUrl: `${origin}/webcam/?action=stream`,
          snapshotUrl: `${origin}/webcam/?action=snapshot`,
          remoteStreamUrl: `${origin}/webcam/?action=stream`,
          remoteSnapshotUrl: `${origin}/webcam/?action=snapshot`
        }
      ]
    }
    return list
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }

  private async refreshSnapshot(): Promise<void> {
    // Moonraker expects `?print_stats&fan&…` (empty values). Axios drops `null` params
    // by default, which previously returned an empty status and wiped progress/ETA.
    const { data } = await this.http.get('/printer/objects/query', {
      params: Object.fromEntries(this.objectKeys.map((k) => [k, ''])),
      paramsSerializer: {
        serialize: (params) =>
          Object.keys(params)
            .map((k) => `${encodeURIComponent(k)}`)
            .join('&')
      }
    })
    const raw = data?.result?.status ?? {}
    this.applyStatusObjects(raw)
  }

  private applyStatusObjects(raw: Record<string, any>): void {
    this.printDuration = Number(raw.print_stats?.print_duration ?? this.printDuration ?? 0)
    const status = mapObjects(this.deviceId, raw, this.printDuration, {
      layerTotalMeta: this.layerTotalFromMeta,
      layerHeight: this.layerHeightFromMeta,
      objectHeight: this.objectHeightFromMeta,
      estimatedTime: this.estimatedTimeFromMeta
    })
    this.applyLayerMeta(status)
    status.message = undefined
    status.health = status.health === 'error' ? 'error' : 'online'
    // Orca footer may only be readable after upload finishes; retry once near end/finish
    const st = String(status.state || '').toLowerCase()
    const nearDone =
      st === 'complete' ||
      st === 'completed' ||
      st === 'finished' ||
      st === 'finish' ||
      (status.progress ?? 0) >= 99
    if (nearDone && !(this.filamentWeightFromMeta != null && this.filamentWeightFromMeta > 0)) {
      this.metaFilename = null
    }
    this.emit(status)
    void this.ensureLayerMeta(status.filename)
  }

  private applyLayerMeta(status: PrinterLiveStatus): void {
    if ((status.layerTotal == null || status.layerTotal <= 0) && this.layerTotalFromMeta) {
      status.layerTotal = this.layerTotalFromMeta
    }
    if (this.filamentWeightFromMeta != null && this.filamentWeightFromMeta > 0) {
      status.filamentUsedGrams = this.filamentWeightFromMeta
    }
  }

  private async ensureLayerMeta(filename?: string): Promise<void> {
    const name = filename?.replace(/^\/+/, '').trim()
    if (!name || name === this.metaFilename) return
    this.metaFilename = name
    this.filamentWeightFromMeta = undefined
    try {
      const { data } = await this.http.get('/server/files/metadata', {
        params: { filename: name }
      })
      const result = data?.result ?? {}
      const lc = Number(result.layer_count)
      const lh = Number(result.layer_height)
      const oh = Number(result.object_height)
      const et = Number(result.estimated_time)
      const fw = parseFilamentWeightG(
        result.filament_weight ?? result.filament_weight_total ?? result.filament
      )
      let changed = false
      if (Number.isFinite(lc) && lc > 0) {
        this.layerTotalFromMeta = lc
        changed = true
      }
      if (Number.isFinite(lh) && lh > 0) {
        this.layerHeightFromMeta = lh
        changed = true
      }
      if (Number.isFinite(oh) && oh > 0) {
        this.objectHeightFromMeta = oh
        changed = true
      }
      if (Number.isFinite(et) && et > 0) {
        this.estimatedTimeFromMeta = et
        changed = true
      }
      if (fw != null && fw > 0) {
        this.filamentWeightFromMeta = fw
        changed = true
      } else {
        // Orca/Prusa put "; filament used [g]" near the **file end** — read tail (+ head)
        const fromFile = await this.readFilamentFromGcodeFile(name, Number(result.size) || 0)
        if (fromFile != null && fromFile > 0) {
          this.filamentWeightFromMeta = fromFile
          changed = true
        }
      }
      if (changed) {
        void this.refreshSnapshot().catch(() => undefined)
      }
    } catch {
      // metadata optional
    }
  }

  /** Orca writes usage summary at EOF; also check header for other slicers */
  private async readFilamentFromGcodeFile(filename: string, sizeHint: number): Promise<number | null> {
    const path = filename
      .split('/')
      .map((p) => encodeURIComponent(p))
      .join('/')
    const url = `/server/files/gcodes/${path}`
    const chunks: string[] = []

    const pull = async (range: string) => {
      try {
        const res = await this.http.get(url, {
          responseType: 'text',
          headers: { Range: range },
          timeout: 12000,
          validateStatus: (s) => s === 200 || s === 206
        })
        const text = typeof res.data === 'string' ? res.data : String(res.data || '')
        if (text) chunks.push(text)
      } catch {
        /* optional */
      }
    }

    // Tail first — Orca footer
    if (sizeHint > 0) {
      const start = Math.max(0, sizeHint - 131072)
      await pull(`bytes=${start}-${sizeHint - 1}`)
    } else {
      await pull('bytes=-131072')
    }
    // Head — Cura / some headers
    await pull('bytes=0-32767')

    const combined = chunks.join('\n')
    return parseGcodeFilamentGrams(combined)
  }

  private startPolling(intervalMs?: number): void {
    const ms = intervalMs ?? pollMs()
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    if (ms <= pollMs() + 500) this.wsMode = 'poll'
    this.pollTimer = setInterval(() => {
      if (this.closed) return
      // Always poll when interval is backup (live) or primary (poll)
      void this.refreshSnapshot().catch(() => undefined)
    }, ms)
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  private handleWsMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as MoonrakerWsMsg
      // Full snapshot from printer.objects.subscribe result
      if (msg.result && typeof msg.result === 'object' && !msg.method) {
        const status = (msg.result as { status?: Record<string, any> }).status
        if (status && typeof status === 'object') {
          this.applyStatusObjects(status)
          return
        }
      }
      if (msg.method === 'notify_status_update' && Array.isArray(msg.params)) {
        const patch = msg.params[0] as Record<string, unknown>
        const ps = patch.print_stats as { print_duration?: number } | undefined
        if (ps?.print_duration != null) this.printDuration = Number(ps.print_duration)
        const next = mergePatch(this.last, patch, this.printDuration, {
          layerTotalMeta: this.layerTotalFromMeta,
          layerHeight: this.layerHeightFromMeta,
          objectHeight: this.objectHeightFromMeta,
          estimatedTime: this.estimatedTimeFromMeta
        })
        this.applyLayerMeta(next)
        this.emit(next)
        void this.ensureLayerMeta(next.filename)
      }
      if (msg.method === 'notify_klippy_disconnected') {
        this.emit({
          ...this.last,
          health: 'error',
          state: 'klippy_disconnected',
          message: 'Klippy 断开'
        })
      }
      if (msg.method === 'notify_klippy_ready') {
        void this.refreshSnapshot()
      }
    } catch {
      // ignore
    }
  }

  private async openWs(): Promise<void> {
    if (this.closed) return
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (!window.electronAPI?.moonrakerWs) {
      this.startPolling()
      return
    }

    this.unsubWs?.()
    this.unsubWs = window.electronAPI.moonrakerWs.onEvent((ev) => {
      if (ev.connectionId !== this.deviceId || this.closed) return
      if (ev.event === 'open') {
        this.wsMode = 'live'
        // Keep a slow poll as backup — bad subscribe objects can silence WS updates
        this.startPolling(backupPollMs())
        this.emit({ ...this.last, health: 'online', message: undefined })
      } else if (ev.event === 'message' && ev.data) {
        this.handleWsMessage(ev.data)
      } else if (ev.event === 'close') {
        this.startPolling(pollMs())
        if (!this.closed) {
          this.reconnectTimer = setTimeout(() => {
            void this.openWs()
          }, 8000)
        }
      }
    })

    const res = await window.electronAPI.moonrakerWs.connect({
      connectionId: this.deviceId,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey || undefined
    })

    if (!res?.ok) {
      this.startPolling()
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => {
          void this.openWs()
        }, 10000)
      }
    }
  }
}

function parseFilamentWeightG(raw: unknown): number | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw === 'string') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  }
  if (Array.isArray(raw)) {
    let sum = 0
    for (const x of raw) {
      const n =
        typeof x === 'object' && x && 'weight' in (x as object)
          ? Number((x as { weight?: number }).weight)
          : Number(x)
      if (Number.isFinite(n) && n > 0) sum += n
    }
    return sum > 0 ? sum : undefined
  }
  return undefined
}

function toGcode(payload: ControlPayload): string | null {
  switch (payload.action) {
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
      const axis = payload.axis
      const amount = payload.amount
      if (!axis || amount == null || !Number.isFinite(amount) || amount === 0) return null
      const feed = axis === 'Z' || axis === 'E' ? 300 : 3000
      const dist = Math.max(-100, Math.min(100, Math.round(amount * 1000) / 1000))
      return `G91\nG1 ${axis}${dist} F${feed}\nG90`
    }
    case 'set_temp':
      if (payload.heater === 'bed') return `M140 S${payload.temperature ?? 0}`
      return `M104 S${payload.temperature ?? 0}`
    case 'set_fan': {
      const pct = Math.max(0, Math.min(100, Math.round(payload.percent ?? 0)))
      if (payload.fan === 'chamber') {
        const name = (payload.fanName || 'chamber_fan').replace(/[^\w-]/g, '') || 'chamber_fan'
        return `SET_FAN_SPEED FAN=${name} SPEED=${(pct / 100).toFixed(2)}`
      }
      return `M106 S${Math.round((pct / 100) * 255)}`
    }
    case 'set_speed':
      return `M220 S${payload.percent ?? 100}`
    case 'load_filament': {
      const t = payload.temperature
      return t != null && t > 0 ? `LOAD_FILAMENT TEMP=${Math.round(t)}` : 'LOAD_FILAMENT'
    }
    case 'unload_filament': {
      const t = payload.temperature
      return t != null && t > 0 ? `UNLOAD_FILAMENT TEMP=${Math.round(t)}` : 'UNLOAD_FILAMENT'
    }
    default:
      return null
  }
}

function estimateRemaining(
  progressPct: number,
  printDuration: number,
  estimatedTime?: number
): number | undefined {
  const frac = progressPct / 100
  if (progressPct >= 99.9) return 0
  // Prefer slicer estimated_time when print_duration is still low / missing
  if (estimatedTime != null && estimatedTime > 0 && progressPct >= 0.5) {
    return Math.max(0, Math.round(estimatedTime * (1 - frac)))
  }
  if (progressPct < 0.5 || printDuration <= 0) return undefined
  return Math.round(printDuration * ((1 - frac) / frac))
}

type LayerHints = {
  layerTotalMeta?: number
  layerHeight?: number
  objectHeight?: number
  estimatedTime?: number
}

function pickFanSpeedPct(status: Record<string, any>): number {
  let max = 0
  for (const [key, val] of Object.entries(status)) {
    if (
      key !== 'fan' &&
      !key.startsWith('fan_generic') &&
      !key.startsWith('heater_fan') &&
      !key.startsWith('controller_fan')
    ) {
      continue
    }
    const kl = key.toLowerCase()
    if (kl.includes('chamber') || kl.includes('enclosure')) continue
    const speed = Number((val as { speed?: number } | null)?.speed ?? 0)
    if (Number.isFinite(speed) && speed > max) max = speed
  }
  return Math.round(max * 100)
}

function pickChamberFan(
  status: Record<string, any>
): { pct: number; name: string } | null {
  for (const [key, val] of Object.entries(status)) {
    const kl = key.toLowerCase()
    if (!kl.includes('chamber') && !kl.includes('enclosure')) continue
    if (
      key !== 'fan' &&
      !key.startsWith('fan_generic') &&
      !key.startsWith('temperature_fan') &&
      !key.startsWith('heater_fan') &&
      !key.startsWith('controller_fan')
    ) {
      continue
    }
    const speed = Number((val as { speed?: number } | null)?.speed)
    if (!Number.isFinite(speed)) continue
    const name = key.includes(' ')
      ? key.slice(key.indexOf(' ') + 1)
      : key.replace(/^(fan_generic|temperature_fan|heater_fan|controller_fan)/, '').trim() ||
        key
    return { pct: Math.round(Math.max(0, Math.min(1, speed)) * 100), name }
  }
  return null
}

function sensorTemp(status: Record<string, any>, kinds: RegExp[]): number {
  let best: number | undefined
  for (const [key, val] of Object.entries(status)) {
    const kl = key.toLowerCase()
    if (
      !kl.startsWith('temperature_sensor') &&
      !kl.startsWith('temperature_fan') &&
      kl !== 'temperature_host' &&
      !kl.startsWith('temperature_host')
    ) {
      continue
    }
    if (!kinds.some((re) => re.test(kl))) continue
    const t = Number((val as { temperature?: number } | null)?.temperature)
    if (!Number.isFinite(t)) continue
    best = t
    break
  }
  return best != null ? best : 0
}

function pickBoardTemp(status: Record<string, any>): number {
  return sensorTemp(status, [
    /board/,
    /mcu/,
    /\brpi\b/,
    /raspberry/,
    /host/,
    /motherboard/,
    /主板/,
    /电子/
  ])
}

function pickChamberTemp(status: Record<string, any>): number {
  return sensorTemp(status, [/chamber/, /enclosure/, /cabin/, /仓/, /机舱/, /箱体/])
}

function estimateLayerFromZ(
  status: Record<string, any>,
  hints: LayerHints
): { layer?: number; layerTotal?: number } {
  const z = Number(status.toolhead?.position?.[2])
  const lh = hints.layerHeight
  if (!Number.isFinite(z) || z < 0 || lh == null || lh <= 0) return {}
  const layer = Math.max(1, Math.floor(z / lh) + 1)
  let layerTotal = hints.layerTotalMeta
  if ((layerTotal == null || layerTotal <= 0) && hints.objectHeight && hints.objectHeight > 0) {
    layerTotal = Math.max(layer, Math.round(hints.objectHeight / lh))
  }
  return { layer, layerTotal }
}

function mapObjects(
  deviceId: string,
  status: Record<string, any>,
  printDuration = 0,
  hints: LayerHints = {}
): PrinterLiveStatus {
  const printStats = status.print_stats ?? {}
  const display = status.display_status ?? {}
  const extruder = status.extruder ?? {}
  const bed = status.heater_bed ?? {}
  const gcodeMove = status.gcode_move ?? {}
  const virtual = status.virtual_sdcard ?? {}

  const state = String(printStats.state || 'standby')
  // display_status / virtual_sdcard progress is 0–1; guard NaN
  const progressFrac = Number(display.progress ?? virtual.progress ?? 0)
  const progress = Number.isFinite(progressFrac) ? Math.max(0, Math.min(100, progressFrac * 100)) : 0
  const duration = Number(printStats.print_duration ?? printDuration ?? 0)

  let layer =
    printStats.info?.current_layer != null ? Number(printStats.info.current_layer) : undefined
  let layerTotal =
    printStats.info?.total_layer != null ? Number(printStats.info.total_layer) : undefined
  if (layerTotal == null || !Number.isFinite(layerTotal) || layerTotal <= 0) {
    layerTotal = hints.layerTotalMeta
  }
  if (layer == null || !Number.isFinite(layer) || layer <= 0) {
    const fromZ = estimateLayerFromZ(status, { ...hints, layerTotalMeta: layerTotal })
    layer = fromZ.layer
    if ((layerTotal == null || layerTotal <= 0) && fromZ.layerTotal) layerTotal = fromZ.layerTotal
  }
  // Progress × total when slicer omitted SET_PRINT_STATS_INFO
  if (
    (layer == null || layer <= 0) &&
    layerTotal != null &&
    layerTotal > 0 &&
    progress >= 0.5
  ) {
    layer = Math.max(1, Math.min(layerTotal, Math.round((progress / 100) * layerTotal)))
  }

  const filename = String(printStats.filename || '').trim() || undefined
  const errMsg = String(printStats.message || printStats.error_message || '').trim()

  const chamber = pickChamberFan(status)

  return {
    deviceId,
    health: state === 'error' ? 'error' : 'online',
    state,
    progress: Math.round(progress * 10) / 10,
    remainingSeconds: estimateRemaining(progress, duration, hints.estimatedTime),
    filename,
    message: state === 'error' ? errMsg || '打印错误' : undefined,
    extruder: {
      actual: Number(extruder.temperature ?? 0),
      target: Number(extruder.target ?? 0)
    },
    bed: {
      actual: Number(bed.temperature ?? 0),
      target: Number(bed.target ?? 0)
    },
    fanSpeed: pickFanSpeedPct(status),
    chamberFanSpeed: chamber?.pct,
    chamberFanName: chamber?.name,
    boardTemp: pickBoardTemp(status),
    chamberTemp: pickChamberTemp(status),
    printSpeed: Math.round(Number(gcodeMove.speed_factor ?? 1) * 100),
    extrudeFactor: Math.round(Number(gcodeMove.extrude_factor ?? 1) * 100),
    layer: layer != null && Number.isFinite(layer) && layer > 0 ? layer : undefined,
    layerTotal:
      layerTotal != null && Number.isFinite(layerTotal) && layerTotal > 0 ? layerTotal : undefined,
    updatedAt: new Date().toISOString()
  }
}

function mergePatch(
  prev: PrinterLiveStatus,
  patch: Record<string, any>,
  printDuration: number,
  hints: LayerHints = {}
): PrinterLiveStatus {
  const mergedObjects: Record<string, any> = {
    print_stats: {},
    display_status: {},
    toolhead: {},
    extruder: {},
    heater_bed: {},
    fan: {},
    gcode_move: {},
    virtual_sdcard: {}
  }

  mergedObjects.print_stats = {
    state: prev.state,
    filename: prev.filename,
    print_duration: printDuration,
    info: { current_layer: prev.layer, total_layer: prev.layerTotal }
  }
  mergedObjects.display_status = { progress: prev.progress / 100 }
  mergedObjects.extruder = {
    temperature: prev.extruder?.actual,
    target: prev.extruder?.target
  }
  mergedObjects.heater_bed = {
    temperature: prev.bed?.actual,
    target: prev.bed?.target
  }
  mergedObjects.fan = { speed: (prev.fanSpeed ?? 0) / 100 }
  mergedObjects.gcode_move = {
    speed_factor: (prev.printSpeed ?? 100) / 100,
    extrude_factor: (prev.extrudeFactor ?? 100) / 100
  }
  mergedObjects.virtual_sdcard = { progress: prev.progress / 100 }

  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      mergedObjects[key] = { ...(mergedObjects[key] || {}), ...(value as object) }
    } else {
      mergedObjects[key] = value
    }
  }

  const next = mapObjects(prev.deviceId, mergedObjects, printDuration, hints)
  if (next.health === 'error' && !next.message && prev.message) {
    next.message = prev.message
  }
  const patchHasSensor = Object.keys(patch).some(
    (k) =>
      k.startsWith('temperature_sensor') ||
      k.startsWith('temperature_fan') ||
      k.startsWith('temperature_host')
  )
  if (!patchHasSensor) {
    if (prev.boardTemp != null) next.boardTemp = prev.boardTemp
    if (prev.chamberTemp != null) next.chamberTemp = prev.chamberTemp
  }
  if (
    !Object.keys(patch).some(
      (k) =>
        k.includes('chamber') ||
        k.includes('enclosure') ||
        k.startsWith('fan_generic') ||
        k.startsWith('temperature_fan')
    )
  ) {
    if (prev.chamberFanSpeed != null) next.chamberFanSpeed = prev.chamberFanSpeed
    if (prev.chamberFanName != null) next.chamberFanName = prev.chamberFanName
  }
  return next
}

export function moonrakerAuthHeaders(secret?: string | null): Record<string, string> {
  if (!secret) return {}
  if (secret.split('.').length >= 3) {
    return { Authorization: `Bearer ${secret}` }
  }
  return { 'X-Api-Key': secret }
}

export async function moonrakerLogin(
  baseUrl: string,
  username: string,
  password: string
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  try {
    const { data } = await axios.post(
      `${baseUrl.replace(/\/$/, '')}/access/login`,
      { username: username.trim(), password },
      { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
    )
    const token = data?.result?.token
    if (!token) return { ok: false, message: '登录成功但未返回令牌' }
    return { ok: true, token: String(token) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '登录失败' }
  }
}

export function normalizeCrealityUrl(input: string): string {
  let raw = input.trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`
  const u = new URL(raw)
  if (!u.port) u.port = '4408'
  return u.origin
}

export function crealityProbeCandidates(input: string): string[] {
  const primary = normalizeCrealityUrl(input)
  if (!primary) return []
  const u = new URL(primary)
  const host = u.hostname
  const list = [primary]
  const extras = [`http://${host}:4408`, `http://${host}:7125`, `http://${host}:80`]
  for (const e of extras) {
    if (!list.includes(e)) list.push(e)
  }
  return list
}

export async function probeMoonraker(
  baseUrl: string,
  apiKey?: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await axios.get(`${baseUrl.replace(/\/$/, '')}/server/info`, {
      timeout: 8000,
      headers: moonrakerAuthHeaders(apiKey)
    })
    const klippy = res.data?.result?.klippy_state
    return { ok: true, message: `已连接${klippy ? `（Klippy: ${klippy}）` : ''}` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '探测失败' }
  }
}

export async function probeCreality(
  urlOrHost: string,
  opts?: { apiKey?: string; username?: string; password?: string }
): Promise<{ ok: boolean; message: string; baseUrl?: string; token?: string }> {
  const candidates = crealityProbeCandidates(urlOrHost)
  const errors: string[] = []

  for (const url of candidates) {
    let token = opts?.apiKey?.trim() || undefined

    if (opts?.username && opts?.password) {
      const login = await moonrakerLogin(url, opts.username, opts.password)
      if (login.ok) {
        token = login.token
      } else {
        errors.push(`${url} 登录: ${login.message}`)
      }
    }

    const probe = await probeMoonraker(url, token)
    if (probe.ok) {
      return {
        ok: true,
        message: `${probe.message} @ ${url}`,
        baseUrl: url,
        token
      }
    }
    errors.push(`${url}: ${probe.message}`)
  }

  return {
    ok: false,
    message:
      errors.slice(0, 3).join('；') ||
      '无法连接。请确认打印机与电脑同网，地址形如 http://192.168.1.178:4408'
  }
}

/** QIDI Fluidd UI commonly on :10088; Moonraker API often :7125 or proxied via 10088 */
export function normalizeQidiUrl(input: string): string {
  let raw = input.trim()
  if (!raw) return ''
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`
  const u = new URL(raw)
  if (!u.port) u.port = '10088'
  return u.origin
}

export function qidiProbeCandidates(input: string): string[] {
  const primary = normalizeQidiUrl(input)
  if (!primary) return []
  const u = new URL(primary)
  const host = u.hostname
  const list = [primary]
  const extras = [`http://${host}:10088`, `http://${host}:7125`, `http://${host}:80`]
  for (const e of extras) {
    if (!list.includes(e)) list.push(e)
  }
  return list
}

export async function probeQidi(
  urlOrHost: string,
  opts?: { apiKey?: string; username?: string; password?: string }
): Promise<{ ok: boolean; message: string; baseUrl?: string; token?: string }> {
  const candidates = qidiProbeCandidates(urlOrHost)
  const errors: string[] = []

  for (const url of candidates) {
    let token = opts?.apiKey?.trim() || undefined

    if (opts?.username && opts?.password) {
      const login = await moonrakerLogin(url, opts.username, opts.password)
      if (login.ok) {
        token = login.token
      } else {
        errors.push(`${url} 登录: ${login.message}`)
      }
    }

    const probe = await probeMoonraker(url, token)
    if (probe.ok) {
      return {
        ok: true,
        message: `${probe.message} @ ${url}`,
        baseUrl: url,
        token
      }
    }
    errors.push(`${url}: ${probe.message}`)
  }

  return {
    ok: false,
    message:
      errors.slice(0, 3).join('；') ||
      '无法连接。启迪默认 Fluidd 端口 10088，例如 http://192.168.1.50:10088'
  }
}
