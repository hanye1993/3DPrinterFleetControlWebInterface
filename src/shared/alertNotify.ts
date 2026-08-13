/** Exception / alert notification channels (软件设置 → 异常对接) */

export type AlertEventKind =
  | 'printerError'
  | 'printDone'
  | 'printerIdle'
  | 'lowFilament'
  | 'aiVision'
  | 'monitorOffline'

export const ALERT_EVENT_LABELS: Record<AlertEventKind, string> = {
  printerError: '打印机报错 / 异常',
  printDone: '打印完成',
  printerIdle: '打印机空闲',
  lowFilament: '耗材余量过低',
  aiVision: 'AI 监控异常（炒面等）',
  monitorOffline: '摄像头监控离线'
}

export const ALERT_EVENT_KINDS: AlertEventKind[] = [
  'printerError',
  'printDone',
  'printerIdle',
  'lowFilament',
  'aiVision',
  'monitorOffline'
]

/** Domestic SMS vendors + custom HTTP (covers vast majority of Chinese SMS gateways) */
export type SmsProviderId =
  | 'aliyun'
  | 'tencent'
  | 'huawei'
  | 'yunpian'
  | 'smsbao'
  | 'chuanglan'
  | 'ihuyi'
  | 'juhe'
  | 'submail'
  | 'custom'

export const SMS_PROVIDER_LABELS: Record<SmsProviderId, string> = {
  aliyun: '阿里云短信',
  tencent: '腾讯云短信',
  huawei: '华为云短信',
  yunpian: '云片',
  smsbao: '短信宝',
  chuanglan: '创蓝253',
  ihuyi: '互亿无线',
  juhe: '聚合数据',
  submail: '赛邮 SUBMAIL',
  custom: '自定义 HTTP（兼容其它短信商）'
}

export type AlertNotifySettings = {
  enabled: boolean
  /** Per-event switches */
  events: Record<AlertEventKind, boolean>
  /** Min seconds between same device+event notifications */
  cooldownSec: number

  /** PushPlus 微信推送 https://www.pushplus.plus */
  pushplusEnabled: boolean
  pushplusToken: string
  pushplusTopic: string

  /** Server酱 / Server酱³ */
  serverchanEnabled: boolean
  serverchanSendKey: string

  /** SMS */
  smsEnabled: boolean
  smsProvider: SmsProviderId
  /** Comma / space / newline separated mobile numbers */
  smsPhones: string
  smsAccessKeyId: string
  smsAccessKeySecret: string
  smsSignName: string
  smsTemplateCode: string
  /** Aliyun region id, default cn-hangzhou */
  smsRegion: string
  /** Tencent SmsSdkAppId */
  smsSdkAppId: string
  /** Huawei app key/secret/channel/endpoint */
  smsAppKey: string
  smsAppSecret: string
  smsChannel: string
  smsEndpoint: string
  /** Yunpian / smsbao / chuanglan / ihuyi / juhe / submail / custom */
  smsApiKey: string
  smsApiUser: string
  smsApiUrl: string
  smsApiMethod: 'GET' | 'POST'
  /** JSON object string for extra headers */
  smsApiHeaders: string
  /**
   * Body or query template. Placeholders:
   * {{phone}} {{content}} {{title}} {{sign}} {{key}} {{secret}} {{tpl}}
   */
  smsApiBodyTemplate: string

  /** 企微应用消息（复用「企业软件对接」企微凭证） */
  wecomNotifyEnabled: boolean
  /** userid list or @all */
  wecomNotifyTouser: string

  /** 钉钉自定义机器人 Webhook */
  dingtalkNotifyEnabled: boolean
  dingtalkWebhook: string
  /** 加签 secret（可选） */
  dingtalkSecret: string

  /** 自定义 Webhook（JSON POST） */
  webhookNotifyEnabled: boolean
  webhookNotifyUrl: string
}

export type AlertNotifyPublic = Omit<
  AlertNotifySettings,
  | 'pushplusToken'
  | 'serverchanSendKey'
  | 'smsAccessKeySecret'
  | 'smsAppSecret'
  | 'smsApiKey'
  | 'dingtalkSecret'
  | 'dingtalkWebhook'
  | 'webhookNotifyUrl'
> & {
  pushplusToken: string
  pushplusTokenSet: boolean
  serverchanSendKey: string
  serverchanSendKeySet: boolean
  smsAccessKeySecret: string
  smsAccessKeySecretSet: boolean
  smsAppSecret: string
  smsAppSecretSet: boolean
  smsApiKey: string
  smsApiKeySet: boolean
  dingtalkSecret: string
  dingtalkSecretSet: boolean
  dingtalkWebhook: string
  dingtalkWebhookSet: boolean
  webhookNotifyUrl: string
  webhookNotifyUrlSet: boolean
}

export type AlertNotifyPayload = {
  kind: AlertEventKind
  title: string
  content: string
  deviceId?: string
  deviceName?: string
  at?: string
  extra?: Record<string, unknown>
}

function defaultEvents(): Record<AlertEventKind, boolean> {
  return {
    printerError: true,
    printDone: false,
    printerIdle: false,
    lowFilament: true,
    aiVision: true,
    monitorOffline: false
  }
}

export function defaultAlertNotifySettings(): AlertNotifySettings {
  return {
    enabled: false,
    events: defaultEvents(),
    cooldownSec: 120,
    pushplusEnabled: false,
    pushplusToken: '',
    pushplusTopic: '',
    serverchanEnabled: false,
    serverchanSendKey: '',
    smsEnabled: false,
    smsProvider: 'custom',
    smsPhones: '',
    smsAccessKeyId: '',
    smsAccessKeySecret: '',
    smsSignName: '',
    smsTemplateCode: '',
    smsRegion: 'cn-hangzhou',
    smsSdkAppId: '',
    smsAppKey: '',
    smsAppSecret: '',
    smsChannel: '',
    smsEndpoint: 'https://smsapi.cn-north-4.myhuaweicloud.com:443',
    smsApiKey: '',
    smsApiUser: '',
    smsApiUrl: '',
    smsApiMethod: 'POST',
    smsApiHeaders: '',
    smsApiBodyTemplate: '',
    wecomNotifyEnabled: false,
    wecomNotifyTouser: '@all',
    dingtalkNotifyEnabled: false,
    dingtalkWebhook: '',
    dingtalkSecret: '',
    webhookNotifyEnabled: false,
    webhookNotifyUrl: ''
  }
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  return fallback
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asSmsProvider(v: unknown): SmsProviderId {
  if (typeof v === 'string' && v in SMS_PROVIDER_LABELS) return v as SmsProviderId
  return 'custom'
}

export function normalizeAlertNotifySettings(raw: unknown): AlertNotifySettings {
  const base = defaultAlertNotifySettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const evRaw =
    o.events && typeof o.events === 'object' ? (o.events as Record<string, unknown>) : {}
  const events = { ...base.events }
  for (const k of ALERT_EVENT_KINDS) {
    if (typeof evRaw[k] === 'boolean') events[k] = evRaw[k] as boolean
  }
  const cool = Math.round(Number(o.cooldownSec))
  return {
    enabled: o.enabled === true,
    events,
    cooldownSec: Number.isFinite(cool) ? Math.max(30, Math.min(3600, cool)) : base.cooldownSec,
    pushplusEnabled: o.pushplusEnabled === true,
    pushplusToken: asStr(o.pushplusToken).trim(),
    pushplusTopic: asStr(o.pushplusTopic).trim(),
    serverchanEnabled: o.serverchanEnabled === true,
    serverchanSendKey: asStr(o.serverchanSendKey).trim(),
    smsEnabled: o.smsEnabled === true,
    smsProvider: asSmsProvider(o.smsProvider),
    smsPhones: asStr(o.smsPhones).trim(),
    smsAccessKeyId: asStr(o.smsAccessKeyId).trim(),
    smsAccessKeySecret: asStr(o.smsAccessKeySecret),
    smsSignName: asStr(o.smsSignName).trim(),
    smsTemplateCode: asStr(o.smsTemplateCode).trim(),
    smsRegion: asStr(o.smsRegion).trim() || base.smsRegion,
    smsSdkAppId: asStr(o.smsSdkAppId).trim(),
    smsAppKey: asStr(o.smsAppKey).trim(),
    smsAppSecret: asStr(o.smsAppSecret),
    smsChannel: asStr(o.smsChannel).trim(),
    smsEndpoint: asStr(o.smsEndpoint).trim() || base.smsEndpoint,
    smsApiKey: asStr(o.smsApiKey),
    smsApiUser: asStr(o.smsApiUser).trim(),
    smsApiUrl: asStr(o.smsApiUrl).trim(),
    smsApiMethod: o.smsApiMethod === 'GET' ? 'GET' : 'POST',
    smsApiHeaders: asStr(o.smsApiHeaders),
    smsApiBodyTemplate: asStr(o.smsApiBodyTemplate),
    wecomNotifyEnabled: o.wecomNotifyEnabled === true,
    wecomNotifyTouser: asStr(o.wecomNotifyTouser).trim() || '@all',
    dingtalkNotifyEnabled: o.dingtalkNotifyEnabled === true,
    dingtalkWebhook: asStr(o.dingtalkWebhook).trim(),
    dingtalkSecret: asStr(o.dingtalkSecret),
    webhookNotifyEnabled: asBool(o.webhookNotifyEnabled, false),
    webhookNotifyUrl: asStr(o.webhookNotifyUrl).trim()
  }
}

/** Keep secrets when patch leaves them empty. */
export function mergeAlertNotifySettings(
  prev: AlertNotifySettings | undefined,
  patch: unknown
): AlertNotifySettings {
  const p = prev || defaultAlertNotifySettings()
  const next = normalizeAlertNotifySettings({ ...p, ...(patch as object) })
  const keep = (key: keyof AlertNotifySettings) => {
    if (!next[key] && p[key]) (next as Record<string, unknown>)[key as string] = p[key]
  }
  keep('pushplusToken')
  keep('serverchanSendKey')
  keep('smsAccessKeySecret')
  keep('smsAppSecret')
  keep('smsApiKey')
  keep('dingtalkSecret')
  keep('dingtalkWebhook')
  keep('webhookNotifyUrl')
  return next
}

export function publicAlertNotify(settings: AlertNotifySettings): AlertNotifyPublic {
  return {
    ...settings,
    pushplusToken: '',
    pushplusTokenSet: Boolean(settings.pushplusToken),
    serverchanSendKey: '',
    serverchanSendKeySet: Boolean(settings.serverchanSendKey),
    smsAccessKeySecret: '',
    smsAccessKeySecretSet: Boolean(settings.smsAccessKeySecret),
    smsAppSecret: '',
    smsAppSecretSet: Boolean(settings.smsAppSecret),
    smsApiKey: '',
    smsApiKeySet: Boolean(settings.smsApiKey),
    dingtalkSecret: '',
    dingtalkSecretSet: Boolean(settings.dingtalkSecret),
    dingtalkWebhook: settings.dingtalkWebhook
      ? `${settings.dingtalkWebhook.slice(0, 24)}…`
      : '',
    dingtalkWebhookSet: Boolean(settings.dingtalkWebhook),
    webhookNotifyUrl: settings.webhookNotifyUrl
      ? `${settings.webhookNotifyUrl.slice(0, 24)}…`
      : '',
    webhookNotifyUrlSet: Boolean(settings.webhookNotifyUrl)
  }
}

export function parsePhoneList(raw: string): string[] {
  return String(raw || '')
    .split(/[\s,;，；]+/)
    .map((s) => s.trim())
    .filter((s) => /^1\d{10}$/.test(s))
}
