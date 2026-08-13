import { create } from 'zustand'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import { isAdminUi } from '../utils/appMode'
import { downloadBlob } from '../utils/openExternal'
import { newId } from '../utils/id'
import {
  defaultSsoSettings,
  normalizeSsoSettings,
  type SsoSettingsBundle
} from '@shared/sso'
import {
  defaultAiVisionSettings,
  normalizeAiVisionSettings,
  type AiVisionSettings
} from '@shared/aiVision'
import {
  defaultAlertNotifySettings,
  normalizeAlertNotifySettings,
  type AlertNotifySettings
} from '@shared/alertNotify'
import {
  DEFAULT_SITE_NAME,
  normalizeDataImage,
  normalizeSiteFooter,
  normalizeSiteName,
  normalizeSiteTitle
} from '@shared/siteBranding'

export type ApiMode = 'readonly' | 'control'
export type ApiAccessMode = 'local' | 'sunlogin' | 'frpc'
export type HskFwType = 1 | 2 | 3
export type FrpcProxyType = 'tcp' | 'http'
export type UiThemeId = string
export type UiBgMode = 'default' | 'color' | 'image'

export type AppSettings = {
  apiEnabled: boolean
  apiMode: ApiMode
  apiPort: number
  apiKey: string
  apiAccessMode: ApiAccessMode
  publicIp: string
  publicIpv6: string
  domain: string
  /** Explicit public site URL for plugins */
  publicBaseUrl: string
  hskEnabled: boolean
  hskApiKey: string
  hskDomain: string
  hskExternalPort: number
  hskFwType: HskFwType
  hskMemo: string
  frpcServerAddr: string
  frpcServerPort: number
  frpcUser: string
  frpcToken: string
  frpcProxyName: string
  frpcType: FrpcProxyType
  frpcRemotePort: number
  frpcPublicHost: string
  frpcCustomDomain: string
  frpcTlsEnable: boolean
  notifyOnError: boolean
  notifyOnPrintDone: boolean
  notifyOnIdle: boolean
  notifyOnLowFilament: boolean
  /** Bambu AMS remain% delta → local spool deduct on print finish */
  amsAutoDeduct: boolean
  /** Device status refresh interval in seconds (1–60) */
  deviceRefreshSec: number
  openAtLogin: boolean
  minimizeToTray: boolean
  webhookEnabled: boolean
  webhookUrl: string
  uiTheme: UiThemeId
  uiThemePack: string
  uiBgMode: UiBgMode
  uiBgColor: string
  uiBgImage: string
  siteName: string
  siteTitle: string
  siteLogo: string
  siteFavicon: string
  siteFooter: string
  sso: SsoSettingsBundle
  /** 内部监控 AI 巡检 */
  aiVision: AiVisionSettings
  /** 异常对接 */
  alertNotify: AlertNotifySettings
}

export function normalizeDeviceRefreshSec(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(60, n))
}

export function resolveDeviceRefreshMs(settings: { deviceRefreshSec?: number } | null | undefined): number {
  return normalizeDeviceRefreshSec(settings?.deviceRefreshSec) * 1000
}

export type ApiStatus = {
  running: boolean
  port: number
  mode: ApiMode
  localUrls: string[]
  publicUrl: string | null
  publicIpv6Url?: string | null
  webUrl?: string | null
  domainUrl: string | null
  hskUrl: string | null
  frpcUrl: string | null
  error?: string
}

export type HskDomainItem = {
  domainname: string
  account?: string
  expiredate?: number
}

export type HskMapping = {
  memo?: string
  domain: string
  port: number
  servicehost?: string
  serviceport?: number
  fwtype?: number
  isforbid?: boolean
}

function newApiKey(): string {
  return newId().replace(/-/g, '')
}

const HSK_DEFAULT_MEMO = 'hanye-3D打印机监控台-API'

const defaults: AppSettings = {
  apiEnabled: false,
  apiMode: 'readonly',
  apiPort: 17890,
  apiKey: '',
  apiAccessMode: 'local',
  publicIp: '',
  publicIpv6: '',
  domain: '',
  publicBaseUrl: '',
  hskEnabled: false,
  hskApiKey: '',
  hskDomain: '',
  hskExternalPort: 0,
  hskFwType: 2,
  hskMemo: HSK_DEFAULT_MEMO,
  frpcServerAddr: '',
  frpcServerPort: 7000,
  frpcUser: '',
  frpcToken: '',
  frpcProxyName: '',
  frpcType: 'tcp',
  frpcRemotePort: 17890,
  frpcPublicHost: '',
  frpcCustomDomain: '',
  frpcTlsEnable: false,
  notifyOnError: true,
  notifyOnPrintDone: true,
  notifyOnIdle: false,
  notifyOnLowFilament: true,
  amsAutoDeduct: true,
  deviceRefreshSec: 3,
  openAtLogin: false,
  minimizeToTray: true,
  webhookEnabled: false,
  webhookUrl: '',
  uiTheme: 'midnight',
  uiThemePack: 'default',
  uiBgMode: 'default',
  uiBgColor: '#0f1115',
  uiBgImage: '',
  siteName: DEFAULT_SITE_NAME,
  siteTitle: '',
  siteLogo: '',
  siteFavicon: '',
  siteFooter: '',
  sso: defaultSsoSettings(),
  aiVision: defaultAiVisionSettings(),
  alertNotify: defaultAlertNotifySettings()
}

function normalizeUiTheme(v: unknown): UiThemeId {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return s
  return 'midnight'
}

function normalizeUiThemePack(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (/^[a-z0-9_]{1,64}$/.test(s)) return s
  return 'default'
}

function normalizeUiBgMode(v: unknown): UiBgMode {
  if (v === 'color' || v === 'image' || v === 'default') return v
  return 'default'
}

const APPEARANCE_CACHE_KEY = 'pm:appearance'

type AppearanceCache = {
  uiTheme?: string
  uiThemePack?: string
  uiBgMode?: string
  uiBgColor?: string
  uiBgImage?: string
  siteName?: string
  siteTitle?: string
  siteLogo?: string
  siteFavicon?: string
  siteFooter?: string
}

function readAppearanceCache(): AppearanceCache | null {
  try {
    const raw = localStorage.getItem(APPEARANCE_CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AppearanceCache
  } catch {
    return null
  }
}

function writeAppearanceCache(
  s: Pick<
    AppSettings,
    | 'uiTheme'
    | 'uiThemePack'
    | 'uiBgMode'
    | 'uiBgColor'
    | 'uiBgImage'
    | 'siteName'
    | 'siteTitle'
    | 'siteLogo'
    | 'siteFavicon'
    | 'siteFooter'
  >
): void {
  try {
    localStorage.setItem(
      APPEARANCE_CACHE_KEY,
      JSON.stringify({
        uiTheme: s.uiTheme,
        uiThemePack: s.uiThemePack,
        uiBgMode: s.uiBgMode,
        uiBgColor: s.uiBgColor,
        uiBgImage: s.uiBgImage,
        siteName: s.siteName,
        siteTitle: s.siteTitle,
        siteLogo: s.siteLogo,
        siteFavicon: s.siteFavicon,
        siteFooter: s.siteFooter
      })
    )
  } catch {
    /* ignore quota — drop large images and keep text branding */
    try {
      localStorage.setItem(
        APPEARANCE_CACHE_KEY,
        JSON.stringify({
          uiTheme: s.uiTheme,
          uiThemePack: s.uiThemePack,
          uiBgMode: s.uiBgMode,
          uiBgColor: s.uiBgColor,
          uiBgImage: '',
          siteName: s.siteName,
          siteTitle: s.siteTitle,
          siteLogo: '',
          siteFavicon: '',
          siteFooter: s.siteFooter
        })
      )
    } catch {
      /* ignore */
    }
  }
}

/** Browser-local theme/bg/brand wins over server defaults (and over silent refresh). */
function mergeAppearanceCache(settings: AppSettings): AppSettings {
  const a = readAppearanceCache()
  if (!a) return settings
  return {
    ...settings,
    ...(a.uiTheme != null ? { uiTheme: normalizeUiTheme(a.uiTheme) } : {}),
    ...(a.uiThemePack != null ? { uiThemePack: normalizeUiThemePack(a.uiThemePack) } : {}),
    ...(a.uiBgMode != null ? { uiBgMode: normalizeUiBgMode(a.uiBgMode) } : {}),
    ...(typeof a.uiBgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(a.uiBgColor)
      ? { uiBgColor: a.uiBgColor }
      : {}),
    ...(typeof a.uiBgImage === 'string' &&
    (a.uiBgImage === '' || a.uiBgImage.startsWith('data:image/'))
      ? { uiBgImage: a.uiBgImage }
      : {}),
    ...(a.siteName != null ? { siteName: normalizeSiteName(a.siteName) } : {}),
    ...(a.siteTitle != null ? { siteTitle: normalizeSiteTitle(a.siteTitle) } : {}),
    ...(typeof a.siteLogo === 'string' &&
    (a.siteLogo === '' || a.siteLogo.startsWith('data:image/'))
      ? { siteLogo: a.siteLogo }
      : {}),
    ...(typeof a.siteFavicon === 'string' &&
    (a.siteFavicon === '' || a.siteFavicon.startsWith('data:image/'))
      ? { siteFavicon: a.siteFavicon }
      : {}),
    ...(a.siteFooter != null ? { siteFooter: normalizeSiteFooter(a.siteFooter) } : {})
  }
}

function initialSettings(): AppSettings {
  return mergeAppearanceCache({ ...defaults })
}

function mapSettings(raw: Record<string, unknown> | Partial<AppSettings> | null | undefined): AppSettings {
  const r = (raw || {}) as Partial<AppSettings> & Record<string, unknown>
  const fw = Number(r.hskFwType)
  const apiAccessMode: ApiAccessMode =
    r.apiAccessMode === 'sunlogin' ||
    r.apiAccessMode === 'local' ||
    r.apiAccessMode === 'frpc'
      ? r.apiAccessMode
      : r.hskEnabled
        ? 'sunlogin'
        : 'local'
  return {
    apiEnabled: Boolean(r.apiEnabled),
    apiMode: r.apiMode === 'control' ? 'control' : 'readonly',
    apiPort: Number(r.apiPort) || 17890,
    apiKey: (typeof r.apiKey === 'string' && r.apiKey) || newApiKey(),
    apiAccessMode,
    publicIp: (typeof r.publicIp === 'string' && r.publicIp) || '',
    publicIpv6: (typeof r.publicIpv6 === 'string' && r.publicIpv6) || '',
    domain: (typeof r.domain === 'string' && r.domain) || '',
    publicBaseUrl: (typeof r.publicBaseUrl === 'string' && r.publicBaseUrl) || '',
    hskEnabled: apiAccessMode === 'sunlogin',
    hskApiKey: (typeof r.hskApiKey === 'string' && r.hskApiKey) || '',
    hskDomain: (typeof r.hskDomain === 'string' && r.hskDomain) || '',
    hskExternalPort: Number(r.hskExternalPort) || 0,
    hskFwType: fw === 1 || fw === 3 ? fw : 2,
    hskMemo: (typeof r.hskMemo === 'string' && r.hskMemo) || HSK_DEFAULT_MEMO,
    frpcServerAddr: (typeof r.frpcServerAddr === 'string' && r.frpcServerAddr) || '',
    frpcServerPort: Number(r.frpcServerPort) || 7000,
    frpcUser: (typeof r.frpcUser === 'string' && r.frpcUser) || '',
    frpcToken: (typeof r.frpcToken === 'string' && r.frpcToken) || '',
    frpcProxyName: (typeof r.frpcProxyName === 'string' && r.frpcProxyName) || '',
    frpcType: r.frpcType === 'http' ? 'http' : 'tcp',
    frpcRemotePort: Number(r.frpcRemotePort) || 17890,
    frpcPublicHost: (typeof r.frpcPublicHost === 'string' && r.frpcPublicHost) || '',
    frpcCustomDomain: (typeof r.frpcCustomDomain === 'string' && r.frpcCustomDomain) || '',
    frpcTlsEnable: r.frpcTlsEnable === true,
    notifyOnError: r.notifyOnError !== false,
    notifyOnPrintDone: r.notifyOnPrintDone !== false,
    notifyOnIdle: Boolean(r.notifyOnIdle),
    notifyOnLowFilament: r.notifyOnLowFilament !== false,
    amsAutoDeduct: r.amsAutoDeduct !== false,
    deviceRefreshSec: normalizeDeviceRefreshSec(r.deviceRefreshSec),
    openAtLogin: Boolean(r.openAtLogin),
    minimizeToTray: r.minimizeToTray !== false,
    webhookEnabled: Boolean(r.webhookEnabled),
    webhookUrl: (typeof r.webhookUrl === 'string' && r.webhookUrl) || '',
    uiTheme: normalizeUiTheme(r.uiTheme),
    uiThemePack: normalizeUiThemePack(r.uiThemePack),
    uiBgMode: normalizeUiBgMode(r.uiBgMode),
    uiBgColor:
      typeof r.uiBgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(r.uiBgColor)
        ? r.uiBgColor
        : '#0f1115',
    uiBgImage:
      typeof r.uiBgImage === 'string' && r.uiBgImage.startsWith('data:image/')
        ? r.uiBgImage
        : '',
    siteName: normalizeSiteName(r.siteName),
    siteTitle: normalizeSiteTitle(r.siteTitle),
    siteLogo: normalizeDataImage(r.siteLogo),
    siteFavicon: normalizeDataImage(r.siteFavicon, 800_000),
    siteFooter: normalizeSiteFooter(r.siteFooter),
    sso: (() => {
      const next = normalizeSsoSettings(r.sso)
      // Public settings strip secrets; keep empty secrets (server disk load has real ones)
      const pub = r.sso as
        | {
            wecom?: { secretSet?: boolean; secret?: string }
            dingtalk?: { appSecretSet?: boolean; appSecret?: string }
            ad?: { bindPasswordSet?: boolean; bindPassword?: string }
          }
        | undefined
      if (pub?.wecom?.secretSet && !next.wecom.secret) next.wecom.secret = ''
      if (pub?.dingtalk?.appSecretSet && !next.dingtalk.appSecret) next.dingtalk.appSecret = ''
      if (pub?.ad?.bindPasswordSet && !next.ad.bindPassword) next.ad.bindPassword = ''
      return next
    })(),
    aiVision: (() => {
      const next = normalizeAiVisionSettings(r.aiVision)
      const pub = r.aiVision as { cloudApiKeySet?: boolean; cloudApiKey?: string } | undefined
      if (pub?.cloudApiKeySet && !next.cloudApiKey) next.cloudApiKey = ''
      return next
    })(),
    alertNotify: (() => {
      const next = normalizeAlertNotifySettings(r.alertNotify)
      const pub = r.alertNotify as
        | {
            pushplusTokenSet?: boolean
            serverchanSendKeySet?: boolean
            smsAccessKeySecretSet?: boolean
            smsAppSecretSet?: boolean
            smsApiKeySet?: boolean
            dingtalkSecretSet?: boolean
            dingtalkWebhookSet?: boolean
            webhookNotifyUrlSet?: boolean
          }
        | undefined
      if (pub?.pushplusTokenSet && !next.pushplusToken) next.pushplusToken = ''
      if (pub?.serverchanSendKeySet && !next.serverchanSendKey) next.serverchanSendKey = ''
      if (pub?.smsAccessKeySecretSet && !next.smsAccessKeySecret) next.smsAccessKeySecret = ''
      if (pub?.smsAppSecretSet && !next.smsAppSecret) next.smsAppSecret = ''
      if (pub?.smsApiKeySet && !next.smsApiKey) next.smsApiKey = ''
      if (pub?.dingtalkSecretSet && !next.dingtalkSecret) next.dingtalkSecret = ''
      if (pub?.dingtalkWebhookSet && !next.dingtalkWebhook) next.dingtalkWebhook = ''
      if (pub?.webhookNotifyUrlSet && !next.webhookNotifyUrl) next.webhookNotifyUrl = ''
      return next
    })()
  }
}

type SettingsState = {
  settings: AppSettings
  status: ApiStatus | null
  loading: boolean
  saving: boolean
  init: () => Promise<void>
  refreshFromServer: (opts?: { silent?: boolean }) => Promise<void>
  refreshStatus: () => Promise<void>
  patchLocal: (partial: Partial<AppSettings>) => void
  save: (partial?: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: initialSettings(),
  status: null,
  loading: true,
  saving: false,

  init: async () => {
    set({ loading: true })
    let raw: Record<string, unknown> | null = null
    if (isClientMode()) {
      try {
        const data = await serverGet<{ settings?: Record<string, unknown> }>('/api/v1/settings')
        raw = (data.settings || null) as Record<string, unknown> | null
      } catch (e) {
        console.error(e)
        raw = null
      }
    } else {
      raw = (await window.electronAPI?.settings?.load()) as Record<string, unknown> | null
    }
    // 本机缓存优先：网页端主题不跟服务端默认值跑，也不被定时刷新冲掉
    const settings = mergeAppearanceCache(mapSettings(raw as Record<string, unknown>))
    const status = isClientMode()
      ? null
      : (await window.electronAPI?.api?.status()) || null
    set({ settings, status, loading: false })
  },

  refreshFromServer: async (opts?: { silent?: boolean }) => {
    if (!isClientMode()) return
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true })
    try {
      const data = await serverGet<{ settings?: Record<string, unknown> }>('/api/v1/settings')
      const raw = (data.settings || null) as Record<string, unknown> | null
      const settings = mergeAppearanceCache(mapSettings(raw as Record<string, unknown>))
      const prev = get().settings
      if (JSON.stringify(prev) === JSON.stringify(settings)) {
        if (!silent) set({ loading: false })
        return
      }
      set({ settings, loading: false })
    } catch (e) {
      console.error(e)
      if (!silent) set({ loading: false })
    }
  },

  refreshStatus: async () => {
    if (isClientMode()) {
      if (isAdminUi()) {
        try {
          const data = await serverGet<{ status?: ApiStatus }>('/api/v1/service/status')
          set({ status: data.status || null })
        } catch {
          set({ status: null })
        }
      } else {
        set({ status: null })
      }
      return
    }
    const status = (await window.electronAPI?.api?.status()) || null
    set({ status })
  },

  patchLocal: (partial) => {
    set({ settings: { ...get().settings, ...partial } })
  },

  save: async (partial) => {
    set({ saving: true })
    const next = { ...get().settings, ...partial }

    const applyMerged = (mapped: AppSettings, status: ApiStatus | null) => {
      const merged = {
        ...mapped,
        openAtLogin: next.openAtLogin,
        minimizeToTray: next.minimizeToTray,
        notifyOnError: next.notifyOnError,
        notifyOnPrintDone: next.notifyOnPrintDone,
        notifyOnIdle: next.notifyOnIdle,
        notifyOnLowFilament: next.notifyOnLowFilament,
        amsAutoDeduct: next.amsAutoDeduct,
        deviceRefreshSec: next.deviceRefreshSec,
        uiTheme: next.uiTheme,
        uiThemePack: next.uiThemePack,
        uiBgMode: next.uiBgMode,
        uiBgColor: next.uiBgColor,
        uiBgImage: next.uiBgImage,
        siteName: next.siteName,
        siteTitle: next.siteTitle,
        siteLogo: next.siteLogo,
        siteFavicon: next.siteFavicon,
        siteFooter: next.siteFooter,
        sso: next.sso,
        aiVision: next.aiVision,
        alertNotify: next.alertNotify
      }
      writeAppearanceCache(merged)
      set({ settings: merged, status, saving: false })
    }

    // 立刻落盘本机缓存，避免刷新/定时拉取抢在 PATCH 完成前把主题冲掉
    writeAppearanceCache(next)

    if (isClientMode()) {
      try {
        const patch: Record<string, unknown> = {}
        const appearanceKeys = [
          'uiTheme',
          'uiThemePack',
          'uiBgMode',
          'uiBgColor',
          'uiBgImage',
          'siteName',
          'siteTitle',
          'siteLogo',
          'siteFavicon',
          'siteFooter'
        ] as const
        const adminPatchKeys = [
          'publicIp',
          'publicIpv6',
          'domain',
          'notifyOnError',
          'notifyOnPrintDone',
          'notifyOnIdle',
          'notifyOnLowFilament',
          'amsAutoDeduct',
          'deviceRefreshSec',
          'webhookEnabled',
          'webhookUrl',
          'openAtLogin',
          'minimizeToTray',
          'sso',
          'aiVision',
          'alertNotify',
          ...appearanceKeys
        ] as const
        const userPatchKeys = [
          'notifyOnError',
          'notifyOnPrintDone',
          'notifyOnIdle',
          'notifyOnLowFilament',
          'amsAutoDeduct',
          'deviceRefreshSec',
          'webhookEnabled',
          'webhookUrl',
          'openAtLogin',
          'minimizeToTray',
          ...appearanceKeys
        ] as const
        const allowed = isAdminUi() ? adminPatchKeys : userPatchKeys
        const partialKeys = partial ? Object.keys(partial) : []
        if (isAdminUi() && partialKeys.length === 0) {
          for (const key of adminPatchKeys) patch[key] = next[key]
        } else {
          for (const key of allowed) {
            if (partial && key in partial) patch[key] = next[key]
          }
        }
        if (Object.keys(patch).length) {
          try {
            const data = await serverSend<{ settings?: Record<string, unknown> }>(
              '/api/v1/settings',
              'PATCH',
              patch
            )
            applyMerged(mapSettings(data.settings as Record<string, unknown>), null)
            if (isAdminUi()) await get().refreshStatus()
          } catch (e) {
            console.error(e)
            applyMerged(next, null)
          }
        } else {
          applyMerged(next, null)
        }
      } catch (e) {
        console.error(e)
        applyMerged(next, null)
      }
      return
    }

    const res = await window.electronAPI?.settings?.save(next)
    if (res) {
      applyMerged(mapSettings(res.settings as Record<string, unknown>), res.status as ApiStatus)
    } else {
      set({ saving: false })
    }
  }
}))
