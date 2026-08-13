/** 设备控制 action 白名单（含进料/退料） */
export const DEVICE_CONTROL_ACTIONS = [
  'pause',
  'resume',
  'cancel',
  'emergency_stop',
  'home',
  'set_temp',
  'set_fan',
  'set_speed',
  'print_file',
  'load_filament',
  'unload_filament'
] as const

export type DeviceControlAction = (typeof DEVICE_CONTROL_ACTIONS)[number]

export function isControlAction(v: unknown): v is DeviceControlAction {
  return typeof v === 'string' && (DEVICE_CONTROL_ACTIONS as readonly string[]).includes(v)
}

export function parseControlExtras(body: Record<string, unknown>): {
  temperature?: number
  heater?: string
  percent?: number
  filename?: string
  slot?: number
  fan?: 'part' | 'chamber'
  fanName?: string
} {
  const out: {
    temperature?: number
    heater?: string
    percent?: number
    filename?: string
    slot?: number
    fan?: 'part' | 'chamber'
    fanName?: string
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
  return out
}
