export type PrinterBrand =
  | 'klipper'
  | 'bambu'
  | 'creality'
  | 'elegoo'
  | 'anycubic'
  | 'snapmaker'
  | 'flashforge'
  | 'qidi'
/** Process type — FDM and resin are separate workspaces */
export type PrinterTech = 'fdm' | 'resin'
export type ConnectionMode = 'lan' | 'cloud'
export type BambuRegion = 'china' | 'global'
export type DeviceHealth = 'online' | 'offline' | 'warning' | 'error' | 'connecting'

export interface DeviceConfig {
  id: string
  name: string
  /** Built-in brands or plugin-registered ids (a-z0-9_) */
  brand: PrinterBrand | string
  /** Defaults to fdm for legacy saved devices */
  tech?: PrinterTech
  /** Printer model / product name — required for same-model batch print grouping */
  model?: string
  group?: string
  tags?: string[]
  /** Moonraker / Fluidd / Creality base URL, e.g. http://192.168.1.178:4408 */
  baseUrl?: string
  /** secret key id in safeStorage (Moonraker API Key / JWT / Bambu secrets) */
  secretKey?: string
  connectionMode?: ConnectionMode | string
  /** Bambu device serial (dev_id) */
  bambuDeviceId?: string
  /** Bambu LAN IP / hostname */
  bambuHost?: string
  /** Bambu cloud region */
  bambuRegion?: BambuRegion
  /** Bambu cloud numeric user id (MQTT username u_{id}) */
  bambuUserId?: string
  /** Anycubic cloud printer id */
  anycubicPrinterId?: string
  /** Anycubic cloud auth mode */
  anycubicAuthMode?: 'web' | 'slicer'
  /** Creality cloud user id */
  crealityUserId?: string
  /** Creality cloud device id */
  crealityDeviceId?: string
  /** Creality cloud region */
  crealityRegion?: 'china' | 'global'
  /** FlashForge serial number */
  flashforgeSerial?: string
  /**
   * Per-device AI vision patrol. Default true when omitted.
   * Global「AI 对接」总开关仍优先；关闭后本机不再参与巡检。
   */
  aiVisionEnabled?: boolean
  /** Free-form plugin payload persisted with the device */
  pluginData?: Record<string, unknown>
  createdAt: string
  [key: string]: unknown
}

export interface TemperaturePair {
  actual: number
  target: number
}

export interface PrinterLiveStatus {
  deviceId: string
  health: DeviceHealth
  state: string
  progress: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: TemperaturePair
  bed?: TemperaturePair
  /** 主板温度 ℃；无数据视为 0 */
  boardTemp?: number
  /** 仓内温度 ℃；无数据视为 0 */
  chamberTemp?: number
  /** 模型冷却风扇 0–100 */
  fanSpeed?: number
  /** 仓内/机舱风扇 0–100；无则不显示调节 */
  chamberFanSpeed?: number
  /** Moonraker 仓内风扇名，控制时回传 */
  chamberFanName?: string
  printSpeed?: number
  extrudeFactor?: number
  filename?: string
  /** Printer-side job path (Bambu gcode_file) */
  gcodeFile?: string
  amsSlots?: Array<{ id: number; material: string; color: string; remain: number }>
  /** Filament used for current/last job (g), e.g. from Moonraker file metadata */
  filamentUsedGrams?: number
  cameraThumbUrl?: string
  message?: string
  updatedAt: string
}

export type ControlAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'emergency_stop'
  | 'home'
  | 'jog'
  | 'set_temp'
  | 'set_fan'
  | 'set_speed'
  | 'set_flow'
  | 'set_z_offset'
  | 'set_chamber_temp'
  | 'extrude'
  | 'retract'
  | 'restart'
  | 'firmware_restart'
  | 'print_file'
  | 'load_filament'
  | 'unload_filament'

export interface ControlPayload {
  action: ControlAction
  axis?: 'X' | 'Y' | 'Z' | 'E'
  amount?: number
  temperature?: number
  heater?: 'extruder' | 'bed'
  percent?: number
  /** set_fan：part=模型风扇（默认），chamber=仓内风扇 */
  fan?: 'part' | 'chamber'
  /** relative path under gcodes root */
  filename?: string
  /** AMS 槽位（1 起）；不传则外挂料架 / 默认宏 */
  slot?: number
  /** Moonraker 仓内风扇对象名，如 chamber_fan */
  fanName?: string
}

export interface PrinterFileInfo {
  path: string
  size: number
  modified?: number
}
