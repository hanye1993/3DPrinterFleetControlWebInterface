/** AI vision monitoring for internal camera wall */

export type AiFaultKind = 'spaghetti' | 'airPrint' | 'modelFell' | 'warping'

/** none = 仅告警；pause = 暂停打印；stop = 停止打印 */
export type AiFaultAction = 'none' | 'pause' | 'stop'

export const AI_FAULT_LABELS: Record<AiFaultKind, string> = {
  spaghetti: '炒面',
  airPrint: '空打',
  modelFell: '模型掉落',
  warping: '翘边'
}

export const AI_FAULT_KINDS: AiFaultKind[] = [
  'spaghetti',
  'airPrint',
  'modelFell',
  'warping'
]

export type AiVisionSettings = {
  enabled: boolean
  /** 巡检间隔（秒） */
  intervalSec: number
  /** 最低置信度 0–1 */
  minConfidence: number
  /** 云端视觉大模型（OpenAI 兼容），可识别全部异常 */
  cloudEnabled: boolean
  cloudBaseUrl: string
  cloudApiKey: string
  cloudModel: string
  /** 本地 YOLOv8，仅检测炒面（assets/yolo/best.pt） */
  yoloEnabled: boolean
  yoloWeights: string
  yoloPython: string
  actions: Record<AiFaultKind, AiFaultAction>
  /** 空数组 = 监控所有有摄像头的设备 */
  deviceIds: string[]
}

export type AiVisionPublic = Omit<AiVisionSettings, 'cloudApiKey'> & {
  cloudApiKey: string
  cloudApiKeySet: boolean
}

export type AiVisionAlert = {
  id: string
  deviceId: string
  deviceName: string
  kind: AiFaultKind
  label: string
  confidence: number
  source: 'yolo' | 'cloud'
  action: AiFaultAction
  actionOk?: boolean
  actionMessage?: string
  at: string
}

export function defaultAiVisionSettings(): AiVisionSettings {
  return {
    enabled: false,
    intervalSec: 20,
    minConfidence: 0.45,
    cloudEnabled: false,
    cloudBaseUrl: 'https://api.openai.com/v1',
    cloudApiKey: '',
    cloudModel: 'gpt-4o-mini',
    yoloEnabled: false,
    yoloWeights: 'assets/yolo/best.pt',
    yoloPython: 'python',
    actions: {
      spaghetti: 'pause',
      airPrint: 'pause',
      modelFell: 'stop',
      warping: 'none'
    },
    deviceIds: []
  }
}

function asAction(v: unknown, fallback: AiFaultAction): AiFaultAction {
  if (v === 'none' || v === 'pause' || v === 'stop') return v
  return fallback
}

export function normalizeAiVisionSettings(raw: unknown): AiVisionSettings {
  const base = defaultAiVisionSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const actionsRaw =
    o.actions && typeof o.actions === 'object'
      ? (o.actions as Record<string, unknown>)
      : {}
  const interval = Math.round(Number(o.intervalSec))
  const conf = Number(o.minConfidence)
  const deviceIds = Array.isArray(o.deviceIds)
    ? o.deviceIds.map((x) => String(x || '')).filter(Boolean)
    : []
  return {
    enabled: o.enabled === true,
    intervalSec: Number.isFinite(interval) ? Math.max(5, Math.min(600, interval)) : base.intervalSec,
    minConfidence: Number.isFinite(conf)
      ? Math.max(0.05, Math.min(0.99, conf))
      : base.minConfidence,
    cloudEnabled: o.cloudEnabled === true,
    cloudBaseUrl:
      typeof o.cloudBaseUrl === 'string' && o.cloudBaseUrl.trim()
        ? o.cloudBaseUrl.trim().replace(/\/$/, '')
        : base.cloudBaseUrl,
    cloudApiKey: typeof o.cloudApiKey === 'string' ? o.cloudApiKey : '',
    cloudModel:
      typeof o.cloudModel === 'string' && o.cloudModel.trim()
        ? o.cloudModel.trim()
        : base.cloudModel,
    yoloEnabled: o.yoloEnabled === true,
    yoloWeights:
      typeof o.yoloWeights === 'string' && o.yoloWeights.trim()
        ? o.yoloWeights.trim()
        : base.yoloWeights,
    yoloPython:
      typeof o.yoloPython === 'string' && o.yoloPython.trim()
        ? o.yoloPython.trim()
        : base.yoloPython,
    actions: {
      spaghetti: asAction(actionsRaw.spaghetti, base.actions.spaghetti),
      airPrint: asAction(actionsRaw.airPrint, base.actions.airPrint),
      modelFell: asAction(actionsRaw.modelFell, base.actions.modelFell),
      warping: asAction(actionsRaw.warping, base.actions.warping)
    },
    deviceIds
  }
}

/** Merge patch into previous, keeping cloudApiKey when patch leaves it empty. */
export function mergeAiVisionSettings(
  prev: AiVisionSettings | undefined,
  patch: unknown
): AiVisionSettings {
  const next = normalizeAiVisionSettings({ ...(prev || {}), ...(patch as object) })
  if (!next.cloudApiKey && prev?.cloudApiKey) {
    next.cloudApiKey = prev.cloudApiKey
  }
  return next
}

export function publicAiVision(settings: AiVisionSettings): AiVisionPublic {
  const key = settings.cloudApiKey || ''
  return {
    ...settings,
    cloudApiKey: '',
    cloudApiKeySet: Boolean(key)
  }
}

/** Default on when field is missing (legacy devices). */
export function isDeviceAiVisionEnabled(
  device: { aiVisionEnabled?: boolean } | null | undefined
): boolean {
  return device?.aiVisionEnabled !== false
}
