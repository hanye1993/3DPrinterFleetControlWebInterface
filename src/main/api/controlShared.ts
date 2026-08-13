/** 设备控制 action 白名单（含进料/退料/轴点动及插件深控动作） */
export const DEVICE_CONTROL_ACTIONS = [
  'pause',
  'resume',
  'cancel',
  'emergency_stop',
  'home',
  'jog',
  'set_temp',
  'set_fan',
  'set_speed',
  'set_flow',
  'set_z_offset',
  'set_chamber_temp',
  'extrude',
  'retract',
  'restart',
  'firmware_restart',
  'print_file',
  'load_filament',
  'unload_filament'
] as const

export type DeviceControlAction = (typeof DEVICE_CONTROL_ACTIONS)[number]

export type JogAxis = 'X' | 'Y' | 'Z' | 'E'

export function isControlAction(v: unknown): v is DeviceControlAction {
  return typeof v === 'string' && (DEVICE_CONTROL_ACTIONS as readonly string[]).includes(v)
}

export function parseJogAxis(v: unknown): JogAxis | undefined {
  if (typeof v !== 'string') return undefined
  const a = v.trim().toUpperCase()
  if (a === 'X' || a === 'Y' || a === 'Z' || a === 'E') return a
  return undefined
}

/** 相对点动距离（mm），限制在 ±100 */
export function parseJogAmount(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return undefined
  return Math.max(-100, Math.min(100, Math.round(v * 1000) / 1000))
}

/** Z 偏移相对量（mm），限制 ±2 */
export function parseZOffsetAmount(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return undefined
  return Math.max(-2, Math.min(2, Math.round(v * 1000) / 1000))
}

/** 挤出/回抽长度（mm），限制 0.1–50 */
export function parseExtrudeAmount(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return undefined
  const a = Math.abs(v)
  if (a < 0.1 || a > 50) return undefined
  return Math.round(a * 1000) / 1000
}

/** 相对点动 G-code：G91 → G1 → G90 */
export function buildJogGcode(axis: JogAxis, amount: number): string {
  const feed = axis === 'Z' || axis === 'E' ? 300 : 3000
  const dist = Number(amount.toFixed(3))
  return `G91\nG1 ${axis}${dist} F${feed}\nG90`
}

export function parseControlExtras(body: Record<string, unknown>): {
  temperature?: number
  heater?: string
  percent?: number
  filename?: string
  slot?: number
  fan?: 'part' | 'chamber'
  fanName?: string
  axis?: JogAxis
  amount?: number
} {
  const out: {
    temperature?: number
    heater?: string
    percent?: number
    filename?: string
    slot?: number
    fan?: 'part' | 'chamber'
    fanName?: string
    axis?: JogAxis
    amount?: number
  } = {}
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
    out.temperature = body.temperature
  }
  if (typeof body.heater === 'string') out.heater = body.heater
  if (typeof body.percent === 'number' && Number.isFinite(body.percent)) {
    out.percent = body.percent
  }
  if (typeof body.filename === 'string' && body.filename.trim()) {
    out.filename = body.filename.trim()
  }
  if (typeof body.slot === 'number' && Number.isFinite(body.slot)) {
    out.slot = Math.floor(body.slot)
  }
  if (body.fan === 'chamber' || body.fan === 'part') out.fan = body.fan
  if (typeof body.fanName === 'string' && body.fanName.trim()) {
    out.fanName = body.fanName.trim()
  }
  const axis = parseJogAxis(body.axis)
  if (axis) out.axis = axis
  const amount = parseJogAmount(body.amount)
  if (amount != null) out.amount = amount
  // z_offset / extrude may pass amount outside jog ±100; prefer raw when action needs it
  if (
    typeof body.amount === 'number' &&
    Number.isFinite(body.amount) &&
    out.amount == null
  ) {
    out.amount = body.amount
  }
  return out
}

export type MoonrakerProxyMethod = 'GET' | 'POST' | 'DELETE'

export type MoonrakerProxyRequest = {
  method: MoonrakerProxyMethod
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
}

/** Validate Moonraker proxy path: absolute path on that printer only (no SSRF). */
export function normalizeMoonrakerProxyPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.trim()
  if (!p) return null
  if (!p.startsWith('/')) p = `/${p}`
  if (p.includes('..') || p.includes('://') || p.includes('\\')) return null
  if (p.length > 512) return null
  return p
}

export function parseMoonrakerProxyMethod(v: unknown): MoonrakerProxyMethod | null {
  const m = String(v || '')
    .trim()
    .toUpperCase()
  if (m === 'GET' || m === 'POST' || m === 'DELETE') return m
  return null
}
