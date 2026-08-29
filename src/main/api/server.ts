import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { randomUUID } from 'crypto'
import { networkInterfaces } from 'os'
import { dirname, resolve } from 'path'
import { readJsonArray, writeJsonArray } from '../storage/jsonBridge'
import {
  calcQuoteCosts,
  parseGcodeMeta,
  spoolPricePerKg,
  QUOTE_MATERIAL_PRESETS,
  QUOTE_PRINTER_PRESETS,
  type PricingMode,
  type QuoteCalcParams
} from './quoteCalc'
import {
  handleMonitorApi,
  monitorSummaryCounts,
  setMonitorSnapshotConcurrency,
  type MonitorApiDeps
} from './monitorApi'

import {
  DEVICE_CONTROL_ACTIONS,
  isControlAction,
  parseControlExtras,
  type DeviceControlAction
} from './controlShared'
import { handleFullApi, type FullApiDeps } from './fullApi'
import { handleAiVisionApi } from './aiVisionApi'
import { probeFfmpeg } from './ffmpegProbe'
import type { VisionMonitor } from '../ai/visionMonitor'
import { deviceNameFromPath, makeOperationLog } from '../operationLogs/helpers'
import { fetchBambuPrintUsageGrams } from '../bambu/printUsage'
import type { OperationLog } from '../../shared/operationLog'
import {
  buildHttpUrl,
  isIpv4Family,
  isIpv6Family,
  isLoopbackAddress,
  isPublicIpv6Address
} from '../../shared/serverUrl'
import { verifyJwt } from '../auth/jwt'
import {
  assertDeviceControlAllowed,
  filterDevicesForAuth,
  handleAuthApi,
  type AuthApiDeps,
  type AuthContext
} from '../auth/authApi'
import type { UserStore } from '../auth/users'
import type { PrintRequestStore } from '../auth/printRequests'
import { effectivePermissions, hasPerm } from '../../shared/permissions'
import { defaultSsoSettings, normalizeSsoSettings, type SsoSettingsBundle } from '../../shared/sso'
import {
  DEFAULT_SITE_NAME,
  normalizeDataImage,
  normalizeSiteFooter,
  normalizeSiteName,
  normalizeSiteTitle
} from '../../shared/siteBranding'
import {
  defaultAiVisionSettings,
  normalizeAiVisionSettings,
  type AiVisionSettings
} from '../../shared/aiVision'
import {
  defaultAlertNotifySettings,
  normalizeAlertNotifySettings,
  type AlertNotifySettings
} from '../../shared/alertNotify'
import {
  detectStatusAlertEvents,
  dispatchAlertNotify,
  ensureAlertRetryLoop
} from '../alert/dispatcher'
import { setAlertHistoryDataRoot } from '../alert/history'
import { handleAlertNotifyApi } from './alertNotifyApi'
import { handleBackupApi } from './backupApi'
import { handlePluginApi } from './pluginApi'
import { handleDocsApi } from './docsApi'
import type { PluginManager } from '../plugin/manager'
import { handleThemeApi } from './themeApi'
import { handleMarketplaceApi } from './marketplaceApi'
import { handleNavApi } from './navApi'
import type { ThemeManager } from '../theme/manager'
import type { NavConfigStore } from '../nav/navConfigStore'
import { handleSsoPublicApi } from '../auth/ssoApi'
import { serveWebStatic, webClientAvailable } from './webStatic'
import {
  amsSyncFromPrinters,
  createCloudSpool,
  deleteCloudSpool,
  getFilamentBackendState,
  isCloudSpoolId,
  listCloudSpools,
  loginFilamentBambu,
  logoutFilamentBambu,
  mirrorCloudCreateToLocal,
  mirrorLocalCreateToCloud,
  overlayBind,
  runMutualSync,
  sendFilamentBambuCode,
  setFilamentBackend,
  setMutualSync,
  updateCloudSpool,
  type FilamentBackendKind
} from './filamentBackend'
import {
  getFilamentSyncSources,
  setFilamentSyncSources,
  syncAllFilamentSources,
  syncFilamentSource,
  testFilamentSyncSource,
  type FilamentSyncSource
} from './filamentSyncSources'
import {
  applyGithubSourceUpdate,
  checkGithubUpdate,
  listUpdateMirrors,
  readLocalPackageVersion,
  readPreferredMirror,
  setUpdatePrefsDataRoot,
  writePreferredMirror,
  isUpdateMirrorId
} from '../update/githubUpdate'

export type { DeviceControlAction }
export { DEVICE_CONTROL_ACTIONS }

export type ApiMode = 'readonly' | 'control'

export type ApiAccessMode = 'local' | 'sunlogin' | 'frpc'

export type HskFwType = 1 | 2 | 3

export type FrpcProxyType = 'tcp' | 'http'

export type AppSettings = {
  apiEnabled: boolean
  apiMode: ApiMode
  apiPort: number
  apiKey: string
  apiAccessMode?: ApiAccessMode
  publicIp?: string
  /** Public IPv6 for client / OAuth base URL (e.g. 2001:db8::1) */
  publicIpv6?: string
  domain?: string
  /** Explicit public site URL for plugins (remote access guide / QR). Overrides domain/ip. */
  publicBaseUrl?: string
  hskEnabled?: boolean
  hskApiKey?: string
  hskDomain?: string
  hskExternalPort?: number
  hskFwType?: HskFwType
  hskMemo?: string
  frpcServerAddr?: string
  frpcServerPort?: number
  /** 面板账号 / 多用户 frps 的 user（如 DPFRP 的 user） */
  frpcUser?: string
  frpcToken?: string
  /** 隧道名称，商业面板通常强制与官方配置一致 */
  frpcProxyName?: string
  frpcType?: FrpcProxyType
  frpcRemotePort?: number
  frpcPublicHost?: string
  frpcCustomDomain?: string
  /** 是否启用 frpc→frps TLS；多数面板要求 false */
  frpcTlsEnable?: boolean
  /** 桌面通知 */
  notifyOnError?: boolean
  notifyOnPrintDone?: boolean
  notifyOnIdle?: boolean
  notifyOnLowFilament?: boolean
  amsAutoDeduct?: boolean
  /** 设备状态刷新间隔（秒），1–60，默认 3；推送类协议不受影响 */
  deviceRefreshSec?: number
  /** 开机自启 / 托盘 */
  openAtLogin?: boolean
  minimizeToTray?: boolean
  /** 状态 Webhook（POST JSON） */
  webhookEnabled?: boolean
  webhookUrl?: string
  /** 外观：主题包内样式 id（如 midnight） */
  uiTheme?: string
  /** 外观：已启用的主题包 identifier（默认 default） */
  uiThemePack?: string
  /** 背景：default|color|image */
  uiBgMode?: string
  uiBgColor?: string
  /** data URL 或空 */
  uiBgImage?: string
  /** 网站品牌：显示名（顶栏 / 登录） */
  siteName?: string
  /** 浏览器标签标题；空则用 siteName */
  siteTitle?: string
  /** Logo data URL */
  siteLogo?: string
  /** Favicon / ico data URL */
  siteFavicon?: string
  /** 底部自定义文案 */
  siteFooter?: string
  /** 企微 / 钉钉 / AD 对接 */
  sso?: SsoSettingsBundle
  /** 内部监控 AI 巡检 */
  aiVision?: AiVisionSettings
  /** 异常对接（微信 / 短信 / 企微 / 钉钉 / Webhook） */
  alertNotify?: AlertNotifySettings
  /** 监控墙快照全局并发（1–32，默认 6） */
  monitorSnapshotConcurrency?: number
  /**
   * Extra LAN /24 prefixes for printer discover, e.g. "192.168.1,192.168.10"
   * Merged with env LAN_SCAN_SUBNETS and auto NICs (up to 8).
   */
  lanScanSubnets?: string
}

/** Clamp and return device refresh interval in seconds */
export function normalizeDeviceRefreshSec(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 3
  return Math.max(1, Math.min(60, n))
}

export function normalizeMonitorSnapshotConcurrency(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 6
  return Math.max(1, Math.min(32, n))
}

/** Milliseconds for poll timers */
export function resolveDeviceRefreshMs(settings: { deviceRefreshSec?: number } | null | undefined): number {
  return normalizeDeviceRefreshSec(settings?.deviceRefreshSec) * 1000
}

export type ApiStatus = {
  running: boolean
  port: number
  mode: ApiMode
  localUrls: string[]
  publicUrl: string | null
  publicIpv6Url: string | null
  /** Browser web UI entry (same port as API) */
  webUrl: string | null
  domainUrl: string | null
  hskUrl: string | null
  frpcUrl: string | null
  error?: string
}

export const HSK_DEFAULT_MEMO = 'hanye-3D打印机监控台-API'

export type ControlRequestHandler = (
  deviceId: string,
  payload: unknown
) => Promise<{ ok: boolean; message?: string }>

type DeviceRow = {
  id: string
  name: string
  brand: string
  tech?: string
  group?: string
  tags?: string[]
  connectionMode?: string
  createdAt?: string
  [key: string]: unknown
}

type SpoolRow = {
  id: string
  brandId?: string
  material?: string
  color?: string
  colorHex?: string
  totalGrams?: number
  remainGrams?: number
  rolls?: number
  location?: string
  price?: number
  openedAt?: string
  notes?: string
  tech?: string
  archived?: boolean
  amsBinding?: { deviceId: string; slotId: number } | null
  amsBindings?: { deviceId: string; slotId: number }[]
  createdAt?: string
  updatedAt?: string
  [key: string]: unknown
}

function normalizeAmsBinding(
  raw: unknown
): { deviceId: string; slotId: number } | null | undefined {
  if (raw === null) return null
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const deviceId = String(o.deviceId || '').trim()
  const slotId = Math.floor(Number(o.slotId))
  if (!deviceId || !Number.isFinite(slotId) || slotId < 0) return null
  return { deviceId, slotId }
}

function normalizeRolls(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(99, n)
}

function normalizeAmsBindings(
  raw: unknown,
  fallback: { deviceId: string; slotId: number } | null | undefined,
  rolls: number
): { deviceId: string; slotId: number }[] {
  const out: { deviceId: string; slotId: number }[] = []
  const seen = new Set<string>()
  const push = (b: { deviceId: string; slotId: number } | null | undefined): void => {
    if (!b) return
    const key = `${b.deviceId}:${b.slotId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(b)
  }
  if (Array.isArray(raw)) {
    // Explicit array (even empty) wins — do not resurrect legacy amsBinding
    for (const item of raw) {
      const b = normalizeAmsBinding(item)
      if (b) push(b)
    }
    return out.slice(0, rolls)
  }
  if (fallback) push(fallback)
  return out.slice(0, rolls)
}

type StatusMap = Record<string, unknown>

const DEFAULT_PORT = 17890

export function resolveAccessMode(settings: AppSettings): ApiAccessMode {
  if (
    settings.apiAccessMode === 'local' ||
    settings.apiAccessMode === 'sunlogin' ||
    settings.apiAccessMode === 'frpc'
  ) {
    return settings.apiAccessMode
  }
  return settings.hskEnabled ? 'sunlogin' : 'local'
}

export function buildHskUrl(settings: AppSettings): string | null {
  if (resolveAccessMode(settings) !== 'sunlogin') return null
  const domain = (settings.hskDomain || '').trim()
  if (!domain) return null
  const host = domain.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  if (!host) return null
  const fw = settings.hskFwType === 1 ? 1 : settings.hskFwType === 3 ? 3 : 2
  const extPort = Number(settings.hskExternalPort) || 0
  if (fw === 3) {
    return extPort && extPort !== 443 ? `https://${host}:${extPort}` : `https://${host}`
  }
  if (fw === 2) {
    return extPort && extPort !== 80 ? `http://${host}:${extPort}` : `http://${host}`
  }
  if (extPort > 0) return `http://${host}:${extPort}`
  return `http://${host}`
}

export function buildFrpcUrl(settings: AppSettings): string | null {
  if (resolveAccessMode(settings) !== 'frpc') return null
  const type = settings.frpcType === 'http' ? 'http' : 'tcp'
  if (type === 'http') {
    const domain = (settings.frpcCustomDomain || settings.frpcPublicHost || '').trim()
    if (!domain) return null
    if (domain.includes('://')) return domain.replace(/\/$/, '')
    return `http://${domain.replace(/\/$/, '')}`
  }
  const host = (settings.frpcPublicHost || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const remote = Number(settings.frpcRemotePort) || 0
  if (!host || remote < 1) return null
  return `http://${host}:${remote}`
}

/** 生成 frpc.toml（v0.52+ / 面板兼容写法），本地端口绑定本软件 API */
export function buildFrpcToml(settings: AppSettings): string {
  const serverAddr = (settings.frpcServerAddr || '').trim() || '127.0.0.1'
  const serverPort = Number(settings.frpcServerPort) || 7000
  const user = (settings.frpcUser || '').trim()
  const token = (settings.frpcToken || '').trim()
  const proxyName = (settings.frpcProxyName || '').trim() || 'printer-monitor-api'
  const localPort = settings.apiPort || DEFAULT_PORT
  const type = settings.frpcType === 'http' ? 'http' : 'tcp'
  const remotePort = Number(settings.frpcRemotePort) || 0
  const customDomain = (settings.frpcCustomDomain || '').trim()
  const tlsEnable = settings.frpcTlsEnable === true

  const q = (s: string) => s.replace(/"/g, '')
  const lines = [
    '# hanye-3D打印机监控台 — frpc 配置',
    '# 用法: frpc -c frpc.toml',
    '# 兼容自建 frps 与 DPFRP 等面板下发的配置格式',
    '',
    'serverAddr = "' + q(serverAddr) + '"',
    'serverPort = ' + serverPort
  ]
  if (user) lines.push('user = "' + q(user) + '"')
  if (token) lines.push('auth.token = "' + q(token) + '"')
  lines.push(
    'transport.tls.enable = ' + (tlsEnable ? 'true' : 'false'),
    'transport.tls.disableCustomTLSFirstByte = false',
    '',
    '[[proxies]]',
    'name = "' + q(proxyName) + '"',
    'type = "' + type + '"',
    'localIP = "127.0.0.1"',
    'localPort = ' + localPort
  )
  if (type === 'tcp') {
    lines.push('remotePort = ' + (remotePort || localPort))
  } else if (customDomain) {
    lines.push('customDomains = ["' + q(customDomain) + '"]')
  }
  lines.push('')
  return lines.join('\n')
}

export function defaultSettings(): AppSettings {
  return {
    apiEnabled: false,
    apiMode: 'readonly',
    apiPort: DEFAULT_PORT,
    apiKey: randomUUID().replace(/-/g, ''),
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
    alertNotify: defaultAlertNotifySettings(),
    monitorSnapshotConcurrency: 6,
    lanScanSubnets: ''
  }
}

function normalizeHskFwType(v: unknown): HskFwType {
  const n = Number(v)
  if (n === 1 || n === 3) return n
  return 2
}

function normalizeAccessMode(o: Record<string, unknown>): ApiAccessMode {
  if (
    o.apiAccessMode === 'sunlogin' ||
    o.apiAccessMode === 'local' ||
    o.apiAccessMode === 'frpc'
  ) {
    return o.apiAccessMode
  }
  return o.hskEnabled ? 'sunlogin' : 'local'
}

export function normalizeSettings(raw: unknown): AppSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const port = Number(o.apiPort)
  const ext = Number(o.hskExternalPort)
  const frpcServerPort = Number(o.frpcServerPort)
  const frpcRemotePort = Number(o.frpcRemotePort)
  const apiAccessMode = normalizeAccessMode(o)
  return {
    apiEnabled: Boolean(o.apiEnabled),
    apiMode: o.apiMode === 'control' ? 'control' : 'readonly',
    apiPort: Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : DEFAULT_PORT,
    apiKey: typeof o.apiKey === 'string' && o.apiKey.trim() ? o.apiKey.trim() : base.apiKey,
    apiAccessMode,
    publicIp: typeof o.publicIp === 'string' ? o.publicIp.trim() : '',
    publicIpv6: typeof o.publicIpv6 === 'string' ? o.publicIpv6.trim() : '',
    domain: typeof o.domain === 'string' ? o.domain.trim() : '',
    publicBaseUrl: typeof o.publicBaseUrl === 'string' ? o.publicBaseUrl.trim() : '',
    hskEnabled: apiAccessMode === 'sunlogin',
    hskApiKey: typeof o.hskApiKey === 'string' ? o.hskApiKey.trim() : '',
    hskDomain: typeof o.hskDomain === 'string' ? o.hskDomain.trim() : '',
    hskExternalPort:
      Number.isFinite(ext) && ext > 0 && ext < 65536 ? Math.floor(ext) : 0,
    hskFwType: normalizeHskFwType(o.hskFwType),
    hskMemo:
      typeof o.hskMemo === 'string' && o.hskMemo.trim() ? o.hskMemo.trim() : HSK_DEFAULT_MEMO,
    frpcServerAddr: typeof o.frpcServerAddr === 'string' ? o.frpcServerAddr.trim() : '',
    frpcServerPort:
      Number.isFinite(frpcServerPort) && frpcServerPort > 0 && frpcServerPort < 65536
        ? Math.floor(frpcServerPort)
        : 7000,
    frpcUser: typeof o.frpcUser === 'string' ? o.frpcUser.trim() : '',
    frpcToken: typeof o.frpcToken === 'string' ? o.frpcToken.trim() : '',
    frpcProxyName: typeof o.frpcProxyName === 'string' ? o.frpcProxyName.trim() : '',
    frpcType: o.frpcType === 'http' ? 'http' : 'tcp',
    frpcRemotePort:
      Number.isFinite(frpcRemotePort) && frpcRemotePort > 0 && frpcRemotePort < 65536
        ? Math.floor(frpcRemotePort)
        : DEFAULT_PORT,
    frpcPublicHost: typeof o.frpcPublicHost === 'string' ? o.frpcPublicHost.trim() : '',
    frpcCustomDomain: typeof o.frpcCustomDomain === 'string' ? o.frpcCustomDomain.trim() : '',
    frpcTlsEnable: o.frpcTlsEnable === true,
    notifyOnError: o.notifyOnError !== false,
    notifyOnPrintDone: o.notifyOnPrintDone !== false,
    notifyOnIdle: Boolean(o.notifyOnIdle),
    notifyOnLowFilament: o.notifyOnLowFilament !== false,
    amsAutoDeduct: o.amsAutoDeduct !== false,
    deviceRefreshSec: normalizeDeviceRefreshSec(o.deviceRefreshSec),
    openAtLogin: Boolean(o.openAtLogin),
    minimizeToTray: o.minimizeToTray !== false,
    webhookEnabled: Boolean(o.webhookEnabled),
    webhookUrl: typeof o.webhookUrl === 'string' ? o.webhookUrl.trim() : '',
    uiTheme: normalizeUiTheme(o.uiTheme),
    uiThemePack: normalizeUiThemePack(o.uiThemePack),
    uiBgMode: normalizeUiBgMode(o.uiBgMode),
    uiBgColor:
      typeof o.uiBgColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(o.uiBgColor.trim())
        ? o.uiBgColor.trim()
        : '#0f1115',
    uiBgImage:
      typeof o.uiBgImage === 'string' && o.uiBgImage.startsWith('data:image/')
        ? o.uiBgImage.length < 2_500_000
          ? o.uiBgImage
          : ''
        : '',
    siteName: normalizeSiteName(o.siteName),
    siteTitle: normalizeSiteTitle(o.siteTitle),
    siteLogo: normalizeDataImage(o.siteLogo),
    siteFavicon: normalizeDataImage(o.siteFavicon, 800_000),
    siteFooter: normalizeSiteFooter(o.siteFooter),
    sso: normalizeSsoSettings(o.sso),
    aiVision: normalizeAiVisionSettings(o.aiVision),
    alertNotify: normalizeAlertNotifySettings(o.alertNotify),
    monitorSnapshotConcurrency: normalizeMonitorSnapshotConcurrency(o.monitorSnapshotConcurrency),
    lanScanSubnets:
      typeof o.lanScanSubnets === 'string'
        ? o.lanScanSubnets.trim().slice(0, 500)
        : base.lanScanSubnets
  }
}

function normalizeUiTheme(v: unknown): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (/^[a-zA-Z0-9_-]{1,64}$/.test(s)) return s
  return 'midnight'
}

function normalizeUiThemePack(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (/^[a-z0-9_]{1,64}$/.test(s)) return s
  return 'default'
}

function normalizeUiBgMode(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  if (s === 'color' || s === 'image' || s === 'default') return s
  return 'default'
}

function localIpv4s(): string[] {
  const nets = networkInterfaces()
  const out: string[] = []
  for (const list of Object.values(nets)) {
    if (!list) continue
    for (const n of list) {
      if (isIpv4Family(n.family) && !n.internal) out.push(n.address)
    }
  }
  return out
}

function localIpv6s(): string[] {
  const nets = networkInterfaces()
  const out: string[] = []
  for (const list of Object.values(nets)) {
    if (!list) continue
    for (const n of list) {
      if (!isIpv6Family(n.family) || n.internal) continue
      const addr = n.address.split('%')[0]!
      if (isPublicIpv6Address(addr)) out.push(addr)
    }
  }
  return out
}

function deviceTech(d: DeviceRow): 'fdm' | 'resin' {
  return d.tech === 'resin' ? 'resin' : 'fdm'
}

function sanitizeDevice(d: DeviceRow): Record<string, unknown> {
  const {
    secretKey: _s,
    bambuUserId: _u,
    crealityUserId: _c,
    anycubicPrinterId: _a,
    ...rest
  } = d
  return {
    ...rest,
    tech: deviceTech(d)
  }
}

/** Optional per-response api_after hook (set on ServerResponse during authenticated handling). */
const API_AFTER_HOOK = Symbol('hanyeApiAfter')

type ApiAfterFn = (status: number, body: unknown) => { status: number; body: unknown }

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const hook = (res as ServerResponse & { [API_AFTER_HOOK]?: ApiAfterFn })[API_AFTER_HOOK]
  let outStatus = status
  let outBody = body
  if (hook) {
    try {
      const next = hook(status, body)
      if (next && typeof next === 'object') {
        if (typeof next.status === 'number') outStatus = next.status
        if ('body' in next) outBody = next.body
      }
    } catch (e) {
      console.error('[plugin] api_after', e)
    }
  }
  const data = JSON.stringify(outBody)
  res.writeHead(outStatus, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
  })
  res.end(data)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export type ApiServerDeps = {
  getDevicesPath: () => string
  getFilamentPath: () => string
  getMonitorZonesPath: () => string
  getSettings: () => AppSettings
  getStatuses: () => StatusMap
  onControl: ControlRequestHandler
  /** Notify UI after filament file written via API */
  onFilamentChanged?: () => void
  /** Notify UI after monitor zones written via API */
  onMonitorZonesChanged?: () => void
  /** Notify UI after devices.json mutated via API */
  onDevicesChanged?: () => void
  /** After backup import: reload settings / users from disk */
  onBackupImported?: () => void | Promise<void>
  listWallCameras: MonitorApiDeps['listWall']
  listDeviceCameras: MonitorApiDeps['listDeviceCameras']
  listDeviceCameraProbeUrls?: MonitorApiDeps['listDeviceCameraProbeUrls']
  takeCameraSnapshot: MonitorApiDeps['takeSnapshot']
  getDeviceApiKey: MonitorApiDeps['getDeviceApiKey']
  setDeviceSecret: FullApiDeps['setDeviceSecret']
  deleteDeviceSecret: FullApiDeps['deleteDeviceSecret']
  getSecret?: (key: string) => string | null
  onDeviceOp: FullApiDeps['onDeviceOp']
  onGetDeviceCapabilities?: FullApiDeps['onGetDeviceCapabilities']
  onMoonrakerRequest?: FullApiDeps['onMoonrakerRequest']
  onSendGcode?: FullApiDeps['onSendGcode']
  onBatchPrint: FullApiDeps['onBatchPrint']
  startLanDiscover: FullApiDeps['startLanDiscover']
  getLanDiscover: FullApiDeps['getLanDiscover']
  cancelLanDiscover: FullApiDeps['cancelLanDiscover']
  getLogs: FullApiDeps['getLogs']
  clearLogs: FullApiDeps['clearLogs']
  appendLog?: (entry: OperationLog) => void
  patchSettings: FullApiDeps['patchSettings']
  version?: string
  /** Auth / RBAC (server mode) */
  getUserStore?: () => UserStore | null
  getPrintRequestStore?: () => PrintRequestStore | null
  getPresenceStore?: () => import('../auth/presence').PresenceStore | null
  onApprovedPrint?: AuthApiDeps['onApprovedPrint']
  onStartPrintJob?: AuthApiDeps['onStartPrintJob']
  /** When true, loopback requests without credentials are treated as local admin */
  allowLocalAdmin?: boolean
  /** Ask host UI / adapters to reconnect all printers */
  onReconnectDevices?: () => Promise<{ ok: boolean; message?: string }>
  /** Quote copy/export history (shared across clients) */
  getQuoteHistoryStore?: () => import('../quote/historyStore').QuoteHistoryStore | null
  /** Saved quote calculator schemes (server only) */
  getQuoteSchemesStore?: () => import('../quote/schemesStore').QuoteSchemesStore | null
  getVisionMonitor?: () => VisionMonitor | null
  getPluginManager?: () => PluginManager | null
  getThemeManager?: () => ThemeManager | null
  getNavConfigStore?: () => NavConfigStore | null
}

export class ApiServer {
  private server: Server | null = null
  private lastError: string | undefined
  private readonly deps: ApiServerDeps
  private readonly sseClients = new Set<ServerResponse>()
  private lastWebhookAt = 0
  private readonly prevStatusSnap = new Map<string, { health?: string; state?: string }>()

  constructor(deps: ApiServerDeps) {
    this.deps = deps
  }

  /** 状态快照更新后：SSE 广播 + 可选 Webhook + 异常对接 + 插件钩子 */
  publishStatuses(statuses: StatusMap): void {
    void this.publishStatusesAsync(statuses)
  }

  private async publishStatusesAsync(statuses: StatusMap): Promise<void> {
    let next = statuses
    try {
      const pm = this.deps.getPluginManager?.()
      if (pm) {
        next = await pm.runHook('statuses_publish', statuses)
        if (typeof pm.emitDomainEventsFromStatuses === 'function') {
          await pm.emitDomainEventsFromStatuses(next as Record<string, unknown>)
        }
      }
    } catch {
      /* ignore */
    }
    const payload = {
      type: 'statuses',
      time: new Date().toISOString(),
      count: Object.keys(next).length,
      statuses: next
    }
    this.broadcastSse('statuses', payload)
    void this.fireWebhook(payload)
    void this.fireStatusAlerts(next)
  }

  private async fireStatusAlerts(statuses: StatusMap): Promise<void> {
    try {
      const events = detectStatusAlertEvents(this.prevStatusSnap, statuses)
      if (!events.length) return
      const getSettings = () => this.deps.getSettings() as never
      for (const ev of events) {
        await dispatchAlertNotify(getSettings, ev, {
          getPluginManager: () => this.deps.getPluginManager?.() || null
        })
      }
    } catch {
      /* ignore notify errors */
    }
  }

  private broadcastSse(event: string, data: unknown): void {
    if (!this.sseClients.size) return
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    this.sseClients.forEach((res) => {
      try {
        res.write(chunk)
      } catch {
        this.sseClients.delete(res)
      }
    })
  }

  private async fireWebhook(payload: unknown): Promise<void> {
    const s = this.deps.getSettings()
    if (!s.webhookEnabled || !s.webhookUrl) return
    const now = Date.now()
    // 节流：最快 2s 一次，避免机群刷爆
    if (now - this.lastWebhookAt < 2000) return
    this.lastWebhookAt = now
    let url = s.webhookUrl
    let body: unknown = payload
    let proceed = true
    try {
      const pm = this.deps.getPluginManager?.()
      if (pm) {
        const hooked = (await pm.runHook('webhook_outbound', {
          proceed: true,
          url,
          payload: body
        })) as { proceed?: boolean; url?: string; payload?: unknown }
        if (hooked && hooked.proceed === false) return
        if (typeof hooked?.url === 'string') url = hooked.url
        if (hooked?.payload !== undefined) body = hooked.payload
        proceed = hooked?.proceed !== false
      }
    } catch {
      /* ignore */
    }
    if (!proceed) return
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': s.apiKey || '',
          'User-Agent': 'printer-monitor-webhook'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      })
    } catch {
      /* ignore webhook errors */
    }
  }

  status(): ApiStatus {
    const s = this.deps.getSettings()
    const running = !!this.server?.listening
    const port = s.apiPort
    const ips = localIpv4s()
    const ips6 = localIpv6s()
    const localUrls = [
      `http://127.0.0.1:${port}`,
      ...ips.map((ip) => `http://${ip}:${port}`),
      ...ips6.map((ip) => buildHttpUrl(ip, port))
    ]
    const access = resolveAccessMode(s)
    const publicUrl =
      access === 'local' && s.publicIp ? buildHttpUrl(s.publicIp, port) : null
    const publicIpv6Url =
      access === 'local' && s.publicIpv6 ? buildHttpUrl(s.publicIpv6, port) : null
    const webUrl =
      running && webClientAvailable()
        ? buildHttpUrl('127.0.0.1', port).replace(/\/$/, '') + '/'
        : null
    const domainUrl =
      access === 'local' && s.domain
        ? s.domain.includes('://')
          ? s.domain.replace(/\/$/, '')
          : `http://${s.domain}${port === 80 ? '' : `:${port}`}`
        : null
    return {
      running,
      port,
      mode: s.apiMode,
      localUrls,
      publicUrl,
      publicIpv6Url,
      webUrl,
      domainUrl,
      hskUrl: buildHskUrl(s),
      frpcUrl: buildFrpcUrl(s),
      error: this.lastError
    }
  }

  async start(): Promise<ApiStatus> {
    await this.stop()
    const s = this.deps.getSettings()
    this.lastError = undefined
    try {
      const dataRoot = dirname(this.deps.getFilamentPath())
      setAlertHistoryDataRoot(dataRoot)
      ensureAlertRetryLoop(
        () => this.deps.getSettings() as never,
        () => this.deps.getPluginManager?.() || null
      )
      setMonitorSnapshotConcurrency(
        normalizeMonitorSnapshotConcurrency(this.deps.getSettings().monitorSnapshotConcurrency)
      )
    } catch {
      /* ignore alert history init */
    }
    return new Promise((resolve) => {
      const server = createServer((req, res) => {
        void this.handle(req, res)
      })

      const finish = (err?: Error) => {
        if (err) {
          this.lastError = err.message
          this.server = null
        } else {
          this.server = server
        }
        resolve(this.status())
      }

      const tryListen = (opts: { host: string; ipv6Only?: boolean }, next?: () => void) => {
        const onError = (err: Error) => {
          server.removeListener('listening', onListening)
          if (next) next()
          else finish(err)
        }
        const onListening = () => {
          server.removeListener('error', onError)
          finish()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        if (opts.host === '::') {
          server.listen({ port: s.apiPort, host: '::', ipv6Only: opts.ipv6Only ?? false })
        } else {
          server.listen(s.apiPort, opts.host)
        }
      }

      // Dual-stack IPv6 + IPv4 for LAN/WAN client access
      tryListen({ host: '::', ipv6Only: false }, () => {
        tryListen({ host: '0.0.0.0' })
      })
    })
  }

  async stop(): Promise<ApiStatus> {
    this.sseClients.forEach((res) => {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    })
    this.sseClients.clear()
    const srv = this.server
    this.server = null
    if (!srv) return this.status()
    await new Promise<void>((resolve) => {
      srv.close(() => resolve())
    })
    return this.status()
  }

  private resolveAuth(req: IncomingMessage, settings: AppSettings): AuthContext | null {
    const users = this.deps.getUserStore?.()
    const presence = this.deps.getPresenceStore?.()
    const bearer = String(req.headers.authorization || '')
    let token = ''
    if (bearer.toLowerCase().startsWith('bearer ')) {
      token = bearer.slice(7).trim()
    } else {
      // EventSource cannot set Authorization — allow token query on SSE only
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        const p = u.pathname.replace(/\/+$/, '') || '/'
        if (p === '/api/v1/events' || /^\/api\/v1\/plugins\/[^/]+\/page\/[^/]+$/.test(p)) {
          token = String(u.searchParams.get('access_token') || u.searchParams.get('token') || '').trim()
        }
      } catch {
        /* ignore */
      }
    }
    if (token && users) {
      const payload = verifyJwt(token, users.getJwtSecret())
      if (payload) {
        if (presence?.isTokenRevoked(payload.sub, payload.iat)) {
          return null
        }
        const user = users.getById(payload.sub)
        if (user && user.enabled) {
          presence?.touch(user)
          return { kind: 'user', user, payload }
        }
      }
    }
    const key = req.headers['x-api-key']
    // Open API Key auth removed — web uses JWT / local session only
    void key
    void settings

    if (this.deps.allowLocalAdmin !== false) {
      const ra = req.socket.remoteAddress || ''
      if (isLoopbackAddress(ra)) {
        // Only elevate loopback when no credential was attempted
        if (!key && !bearer && !token) return { kind: 'local' }
      }
    }
    return null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method || 'GET').toUpperCase()
    if (method === 'OPTIONS') {
      sendJson(res, 204, {})
      return
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const settings = this.deps.getSettings()

    if (path === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        version: this.deps.version || readLocalPackageVersion() || '1.4.1',
        mode: settings.apiMode,
        time: new Date().toISOString(),
        web: webClientAvailable()
      })
      return
    }

    // Discuz-like early bootstrap: common runs even before auth
    {
      const pmEarly = this.deps.getPluginManager?.()
      if (pmEarly) {
        try {
          if (typeof pmEarly.whenReady === 'function') await pmEarly.whenReady()
          const softAuth = this.resolveAuth(req, settings)
          await pmEarly.runHook('common', null, {
            method,
            path,
            url,
            query: Object.fromEntries(url.searchParams.entries()),
            headers: { ...req.headers },
            auth: softAuth
          })
        } catch (e) {
          console.error('[plugin] early common', e)
        }
      }
    }

    // Install / deploy docs (NODE_DEPLOY / MYSQL / BAOTA)
    {
      const docsHandled = await handleDocsApi({ method, path, res, sendJson })
      if (docsHandled) return
    }

    if (method === 'GET' && !path.startsWith('/api')) {
      if (serveWebStatic(path, res)) return
    }

    // Plugin/theme static + public-ui before auth (login page needs them)
    {
      const earlyPlugin =
        (method === 'GET' && path === '/api/v1/plugins/public-ui') ||
        (method === 'GET' && /^\/api\/v1\/plugins\/[^/]+\/(static|asset)\//.test(path))
      if (earlyPlugin) {
        const pluginHandled = await handlePluginApi({
          method,
          path,
          url,
          req,
          res,
          sendJson,
          readBody,
          auth: { kind: 'local' },
          isAdmin: false,
          getPluginManager: () => this.deps.getPluginManager?.() || null
        })
        if (pluginHandled) return
      }
      // Public custom plugin routes (OAuth / login buttons) — no JWT
      {
        const pm = this.deps.getPluginManager?.() || null
        if (pm?.matchCustomRoute(method, path, { publicOnly: true })) {
          const pluginHandled = await handlePluginApi({
            method,
            path,
            url,
            req,
            res,
            sendJson,
            readBody,
            auth: { kind: 'local' },
            isAdmin: false,
            publicCustomOnly: true,
            getPluginManager: () => this.deps.getPluginManager?.() || null
          })
          if (pluginHandled) return
        }
      }
      const earlyTheme =
        (method === 'GET' && path === '/api/v1/themes/active') ||
        (method === 'GET' && /^\/api\/v1\/themes\/[^/]+\/asset\//.test(path))
      if (earlyTheme) {
        const themeHandled = await handleThemeApi({
          method,
          path,
          req,
          res,
          sendJson,
          readBody,
          isAdmin: false,
          getThemeManager: () => this.deps.getThemeManager?.() || null,
          getPluginManager: () => this.deps.getPluginManager?.() || null
        })
        if (themeHandled) return
      }
    }

    // Public branding for login / favicon before auth
    if (method === 'GET' && path === '/api/v1/branding') {
      const s = this.deps.getSettings()
      sendJson(res, 200, {
        ok: true,
        siteName: s.siteName || DEFAULT_SITE_NAME,
        siteTitle: s.siteTitle || '',
        siteLogo: s.siteLogo || '',
        siteFavicon: s.siteFavicon || '',
        siteFooter: s.siteFooter || ''
      })
      return
    }

    // Login + SSO public endpoints
    if (method === 'POST' && path === '/api/v1/auth/login') {
      const users = this.deps.getUserStore?.()
      const printRequests = this.deps.getPrintRequestStore?.()
      if (!users || !printRequests) {
        sendJson(res, 501, { ok: false, message: 'Auth not configured' })
        return
      }
      await handleAuthApi({
        method,
        path,
        req,
        res,
        auth: { kind: 'apiKey' },
        deps: {
          users,
          printRequests,
          presence: this.deps.getPresenceStore?.() || undefined,
          getDevices: () =>
            (readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]).map((d) => ({
              id: String(d.id),
              name: String(d.name || d.id)
            })),
          onStartPrintJob:
            this.deps.onStartPrintJob ||
            this.deps.onApprovedPrint ||
            (async () => ({ ok: false, message: '未配置' })),
          onApprovedPrint:
            this.deps.onStartPrintJob ||
            this.deps.onApprovedPrint ||
            (async () => ({ ok: false, message: '未配置' })),
          getSso: () => normalizeSsoSettings(this.deps.getSettings().sso),
          getApiBaseSettings: () => {
            const s = this.deps.getSettings()
            return { publicIp: s.publicIp, publicIpv6: s.publicIpv6, domain: s.domain, apiPort: s.apiPort }
          },
          getPluginManager: () => this.deps.getPluginManager?.() || null
        },
        sendJson,
        readBody
      })
      return
    }

    {
      const users = this.deps.getUserStore?.()
      if (users && path.startsWith('/api/v1/auth/sso')) {
        const handled = await handleSsoPublicApi({
          method,
          path,
          url,
          req,
          res,
          deps: {
            users,
            presence: this.deps.getPresenceStore?.() || undefined,
            getSso: () => normalizeSsoSettings(this.deps.getSettings().sso),
            getApiBaseSettings: () => {
              const s = this.deps.getSettings()
              return { publicIp: s.publicIp, publicIpv6: s.publicIpv6, domain: s.domain, apiPort: s.apiPort }
            },
            getPluginManager: () => this.deps.getPluginManager?.() || null
          },
          sendJson,
          readBody
        })
        if (handled) return
      }
    }

    if (method === 'GET' && path === '/api/v1/auth/meta') {
      const users = this.deps.getUserStore?.()
      const printRequests = this.deps.getPrintRequestStore?.()
      if (users && printRequests) {
        await handleAuthApi({
          method,
          path,
          req,
          res,
          auth: { kind: 'local' },
          deps: {
            users,
            printRequests,
            presence: this.deps.getPresenceStore?.() || undefined,
            getDevices: () => [],
            onApprovedPrint: async () => ({ ok: true }),
            getSso: () => normalizeSsoSettings(this.deps.getSettings().sso),
            getApiBaseSettings: () => {
              const s = this.deps.getSettings()
              return { publicIp: s.publicIp, publicIpv6: s.publicIpv6, domain: s.domain, apiPort: s.apiPort }
            },
            getPluginManager: () => this.deps.getPluginManager?.() || null
          },
          sendJson,
          readBody
        })
        return
      }
    }

    const auth = this.resolveAuth(req, settings)
    if (!auth) {
      const users = this.deps.getUserStore?.()
      const presence = this.deps.getPresenceStore?.()
      const bearer = String(req.headers.authorization || '')
      if (bearer.toLowerCase().startsWith('bearer ') && users && presence) {
        const payload = verifyJwt(bearer.slice(7).trim(), users.getJwtSecret())
        if (payload && presence.isTokenRevoked(payload.sub, payload.iat)) {
          sendJson(res, 401, { ok: false, message: '账号已被踢下线，请重新登录' })
          return
        }
      }
      sendJson(res, 401, {
        ok: false,
        message: 'Unauthorized: need Authorization: Bearer <jwt>'
      })
      return
    }

    if (method === 'GET' && path === '/api/v1/system/ffmpeg') {
      const probe = await probeFfmpeg()
      sendJson(res, 200, probe)
      return
    }

    const isPluginAdmin =
      auth.kind === 'local' ||
      auth.kind === 'apiKey' ||
      (auth.kind === 'user' && auth.user.level === 'admin')

    // Plugin hooks + /api/v1/plugins
    {
      const pm = this.deps.getPluginManager?.()
      const pluginCtx = {
        method,
        path,
        url,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: { ...req.headers },
        auth
      }
      if (pm) {
        ;(res as ServerResponse & { [API_AFTER_HOOK]?: ApiAfterFn })[API_AFTER_HOOK] = (
          status,
          body
        ) => {
          const next = pm.runHookSync('api_after', { status, body, method, path }, pluginCtx) as {
            status?: number
            body?: unknown
          }
          return {
            status: typeof next?.status === 'number' ? next.status : status,
            body: next && 'body' in next ? next.body : body
          }
        }
        try {
          // common already ran early; only api_before here
          const before = await pm.runHook<{
            proceed?: boolean
            status?: number
            body?: unknown
            method?: string
            path?: string
          }>('api_before', { proceed: true, method, path }, pluginCtx)
          if (before && before.proceed === false) {
            sendJson(res, before.status || 200, before.body ?? { ok: true })
            return
          }
        } catch (e) {
          console.error('[plugin] api_before', e)
        }
      }

      // Discuz-style: /plugin.php?id=identifier:module
      if (
        (path === '/plugin.php' || path === '/api/v1/plugin.php') &&
        (method === 'GET' || method === 'POST')
      ) {
        const idParam = String(url.searchParams.get('id') || '').trim()
        const [pluginId, moduleName] = idParam.split(':')
        if (pm && pluginId && moduleName) {
          try {
            const ctx = {
              method,
              path,
              url,
              query: Object.fromEntries(url.searchParams.entries()),
              headers: { ...req.headers },
              auth
            } as import('../plugin/manager').PluginRequestCtx
            if (method === 'POST') {
              const raw = await readBody(req)
              try {
                ctx.body = raw ? JSON.parse(raw) : {}
              } catch {
                ctx.body = { raw }
              }
            }
            const data = await pm.runModule(pluginId, moduleName, ctx)
            sendJson(res, 200, { ok: true, data })
            return
          } catch (e) {
            sendJson(res, 403, { ok: false, message: e instanceof Error ? e.message : String(e) })
            return
          }
        }
        sendJson(res, 400, { ok: false, message: 'plugin.php 需要 id=identifier:module' })
        return
      }

      const pluginHandled = await handlePluginApi({
        method,
        path,
        url,
        req,
        res,
        sendJson,
        readBody,
        auth,
        isAdmin: isPluginAdmin,
        getPluginManager: () => this.deps.getPluginManager?.() || null
      })
      if (pluginHandled) return

      const themeHandled = await handleThemeApi({
        method,
        path,
        req,
        res,
        sendJson,
        readBody,
        isAdmin: isPluginAdmin,
        getThemeManager: () => this.deps.getThemeManager?.() || null,
        getPluginManager: () => this.deps.getPluginManager?.() || null
      })
      if (themeHandled) return

      const marketHandled = await handleMarketplaceApi({
        method,
        path,
        req,
        res,
        sendJson,
        readBody,
        isAdmin: isPluginAdmin,
        dataRoot: resolve(dirname(this.deps.getDevicesPath())),
        getPluginManager: () => this.deps.getPluginManager?.() || null,
        getThemeManager: () => this.deps.getThemeManager?.() || null
      })
      if (marketHandled) return

      const navHandled = await handleNavApi({
        method,
        path,
        req,
        res,
        sendJson,
        readBody,
        isAdmin: isPluginAdmin,
        getNavConfigStore: () => this.deps.getNavConfigStore?.() || null,
        getPluginManager: () => this.deps.getPluginManager?.() || null
      })
      if (navHandled) return
    }

    const users = this.deps.getUserStore?.()
    const printRequests = this.deps.getPrintRequestStore?.()
    if (users && printRequests) {
      const authHandled = await handleAuthApi({
        method,
        path,
        req,
        res,
        auth,
        deps: {
          users,
          printRequests,
          presence: this.deps.getPresenceStore?.() || undefined,
          getDevices: () =>
            (readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]).map((d) => ({
              id: String(d.id),
              name: String(d.name || d.id)
            })),
          onStartPrintJob:
            this.deps.onStartPrintJob ||
            this.deps.onApprovedPrint ||
            (async () => ({ ok: false, message: '未配置' })),
          onApprovedPrint:
            this.deps.onStartPrintJob ||
            this.deps.onApprovedPrint ||
            (async () => ({ ok: false, message: '未配置' })),
          getSso: () => normalizeSsoSettings(this.deps.getSettings().sso),
          getApiBaseSettings: () => {
            const s = this.deps.getSettings()
            return { publicIp: s.publicIp, publicIpv6: s.publicIpv6, domain: s.domain, apiPort: s.apiPort }
          },
          getPluginManager: () => this.deps.getPluginManager?.() || null
        },
        sendJson,
        readBody
      })
      if (authHandled) return
    }

    if (method === 'GET' && path === '/api/v1/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, Authorization'
      })
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, time: new Date().toISOString() })}\n\n`)
      this.sseClients.add(res)
      const statuses = this.deps.getStatuses()
      res.write(
        `event: statuses\ndata: ${JSON.stringify({
          type: 'statuses',
          time: new Date().toISOString(),
          count: Object.keys(statuses).length,
          statuses
        })}\n\n`
      )
      req.on('close', () => {
        this.sseClients.delete(res)
      })
      return
    }

    try {
      if (method === 'GET' && path === '/api/v1/summary') {
        let devices = readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]
        devices = filterDevicesForAuth(auth, devices)
        const spools = readJsonArray(this.deps.getFilamentPath()) as SpoolRow[]
        const statuses = this.deps.getStatuses()
        const monitor = monitorSummaryCounts(this.deps.getMonitorZonesPath())
        sendJson(res, 200, {
          ok: true,
          devices: {
            total: devices.length,
            fdm: devices.filter((d) => deviceTech(d) === 'fdm').length,
            resin: devices.filter((d) => deviceTech(d) === 'resin').length,
            online: devices.filter((d) => (statuses[d.id] as { health?: string } | undefined)?.health === 'online')
              .length
          },
          filament: {
            total: spools.filter((s) => !s.archived).length,
            fdm: spools.filter((s) => s.tech === 'fdm' && !s.archived).length,
            resin: spools.filter((s) => s.tech === 'resin' && !s.archived).length
          },
          monitor: {
            zones: monitor.zones,
            zoneCameras: monitor.cameras
          },
          mode: settings.apiMode
        })
        return
      }

      const monitorHandled = await handleMonitorApi({
        method,
        path,
        url,
        req,
        res,
        apiMode: settings.apiMode,
        auth,
        deps: {
          getMonitorZonesPath: this.deps.getMonitorZonesPath,
          onMonitorZonesChanged: this.deps.onMonitorZonesChanged,
          listWall: this.deps.listWallCameras,
          listDeviceCameras: this.deps.listDeviceCameras,
          listDeviceCameraProbeUrls: this.deps.listDeviceCameraProbeUrls,
          takeSnapshot: this.deps.takeCameraSnapshot,
          getDeviceApiKey: this.deps.getDeviceApiKey,
          getPluginManager: () => this.deps.getPluginManager?.() || null
        },
        sendJson,
        readBody
      })
      if (monitorHandled) return

      const alertHandled = await handleAlertNotifyApi({
        method,
        path,
        req,
        res,
        sendJson,
        readBody,
        auth,
        getSettings: () => this.deps.getSettings() as unknown as Record<string, unknown>,
        getPluginManager: () => this.deps.getPluginManager?.() || null
      })
      if (alertHandled) return

      const backupHandled = await handleBackupApi({
        method,
        path,
        url,
        req,
        res,
        auth,
        getFilamentPath: this.deps.getFilamentPath,
        sendJson,
        readBody,
        onImported: async () => {
          this.deps.onFilamentChanged?.()
          this.deps.onMonitorZonesChanged?.()
          this.deps.onDevicesChanged?.()
          await this.deps.onBackupImported?.()
        }
      })
      if (backupHandled) return

      const aiHandled = await handleAiVisionApi({
        method,
        path,
        req,
        res,
        sendJson,
        readBody,
        getAiVision: () => this.deps.getSettings().aiVision,
        getVisionMonitor: () => this.deps.getVisionMonitor?.() || null,
        getPluginManager: () => this.deps.getPluginManager?.() || null
      })
      if (aiHandled) return

      const fullHandled = await handleFullApi({
        method,
        path,
        url,
        req,
        res,
        auth,
        deps: {
          getDevicesPath: this.deps.getDevicesPath,
          getFilamentPath: this.deps.getFilamentPath,
          getSettings: () => this.deps.getSettings() as unknown as Record<string, unknown> & {
            apiMode?: string
            apiKey?: string
          },
          onControl: this.deps.onControl,
          onDevicesChanged: this.deps.onDevicesChanged,
          setDeviceSecret: this.deps.setDeviceSecret,
          deleteDeviceSecret: this.deps.deleteDeviceSecret,
          onDeviceOp: this.deps.onDeviceOp,
          onGetDeviceCapabilities: this.deps.onGetDeviceCapabilities,
          onMoonrakerRequest: this.deps.onMoonrakerRequest,
          onSendGcode: this.deps.onSendGcode,
          onBatchPrint: this.deps.onBatchPrint,
          startLanDiscover: this.deps.startLanDiscover,
          getLanDiscover: this.deps.getLanDiscover,
          cancelLanDiscover: this.deps.cancelLanDiscover,
          getLogs: this.deps.getLogs,
          clearLogs: this.deps.clearLogs,
          appendLog: this.deps.appendLog,
          patchSettings: this.deps.patchSettings,
          sanitizeDevice: (d) => sanitizeDevice(d as DeviceRow),
          onFilamentChanged: this.deps.onFilamentChanged,
          getPluginManager: () => this.deps.getPluginManager?.() || null,
          getUserStore: () => this.deps.getUserStore?.() || null
        },
        sendJson,
        readBody
      })
      if (fullHandled) return

      if (method === 'GET' && path === '/api/v1/devices') {
        const tech = url.searchParams.get('tech')
        let devices = (readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]).map(sanitizeDevice)
        devices = filterDevicesForAuth(auth, devices as Array<{ id: string }>) as typeof devices
        if (tech === 'fdm' || tech === 'resin') {
          devices = devices.filter((d) => d.tech === tech)
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            devices = await pm.runHook(
              'devices_list',
              devices,
              {
                method,
                path,
                url,
                query: Object.fromEntries(url.searchParams.entries()),
                headers: { ...req.headers },
                auth
              }
            )
          }
        } catch {
          /* ignore */
        }
        const statuses = this.deps.getStatuses()
        sendJson(res, 200, {
          ok: true,
          devices: devices.map((d) => ({
            ...d,
            status: statuses[String(d.id)] || null
          }))
        })
        return
      }

      if (method === 'POST' && path === '/api/v1/devices/reconnect') {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        if (auth.kind === 'user') {
          if (!hasPerm(effectivePermissions(auth.user), 'device.view')) {
            sendJson(res, 403, { ok: false, message: '无权限' })
            return
          }
        }
        if (!this.deps.onReconnectDevices) {
          sendJson(res, 501, { ok: false, message: '未配置重连' })
          return
        }
        const result = await this.deps.onReconnectDevices()
        sendJson(res, result.ok ? 200 : 502, result)
        return
      }

      const deviceMatch = path.match(/^\/api\/v1\/devices\/([^/]+)$/)
      if (method === 'GET' && deviceMatch) {
        const id = decodeURIComponent(deviceMatch[1])
        const devices = readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]
        const found = devices.find((d) => d.id === id)
        if (!found) {
          sendJson(res, 404, { ok: false, message: 'Device not found' })
          return
        }
        sendJson(res, 200, {
          ok: true,
          device: sanitizeDevice(found),
          status: this.deps.getStatuses()[id] || null
        })
        return
      }

      const controlMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/control$/)
      if (method === 'POST' && controlMatch) {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        const id = decodeURIComponent(controlMatch[1])
        const raw = await readBody(req)
        let payload: unknown
        try {
          payload = raw ? JSON.parse(raw) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        if (!payload || typeof payload !== 'object') {
          sendJson(res, 400, { ok: false, message: 'Body must be a JSON object' })
          return
        }
        const body = payload as Record<string, unknown>
        if (!isControlAction(body.action)) {
          sendJson(res, 400, {
            ok: false,
            message: `Unknown or missing action. Allowed: ${DEVICE_CONTROL_ACTIONS.join(', ')}`
          })
          return
        }
        if (body.action === 'jog') {
          const extras = parseControlExtras(body)
          if (!extras.axis || extras.amount == null) {
            sendJson(res, 400, {
              ok: false,
              message: 'jog 需要 axis(X/Y/Z/E) 与非零 amount(mm)'
            })
            return
          }
        }
        const gate = assertDeviceControlAllowed(auth, id, body.action)
        if (!gate.ok) {
          sendJson(res, gate.status, { ok: false, message: gate.message })
          return
        }
        const controlPayload = {
          action: body.action,
          ...parseControlExtras(body)
        }
        const pmCtrl = this.deps.getPluginManager?.()
        if (pmCtrl) {
          const beforeCtrl = (await pmCtrl.runHook(
            'control_before',
            { proceed: true, deviceId: id, payload: controlPayload },
            {
              method,
              path,
              url,
              query: Object.fromEntries(url.searchParams.entries()),
              headers: { ...req.headers },
              auth
            }
          )) as {
            proceed?: boolean
            status?: number
            body?: unknown
            payload?: typeof controlPayload
          }
          if (beforeCtrl && beforeCtrl.proceed === false) {
            sendJson(res, beforeCtrl.status || 403, beforeCtrl.body ?? { ok: false, message: 'blocked' })
            return
          }
        }
        const result = await this.deps.onControl(id, controlPayload)
        this.deps.appendLog?.(
          makeOperationLog(
            id,
            deviceNameFromPath(this.deps.getDevicesPath, id),
            String(body.action),
            result.ok ? 'ok' : 'error',
            result.message
          )
        )
        let out = result
        if (pmCtrl) {
          out = await pmCtrl.runHook(
            'control_after',
            { ...result, deviceId: id, payload: controlPayload },
            {
              method,
              path,
              url,
              query: Object.fromEntries(url.searchParams.entries()),
              headers: { ...req.headers },
              auth
            }
          )
        }
        sendJson(res, out.ok ? 200 : 502, out)
        return
      }

      const bambuUsageMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/bambu\/print-usage$/)
      if (method === 'POST' && bambuUsageMatch) {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        const id = decodeURIComponent(bambuUsageMatch[1])
        if (auth.kind === 'user') {
          const visible = filterDevicesForAuth(auth, [{ id }]) as Array<{ id: string }>
          if (!visible.length) {
            sendJson(res, 403, { ok: false, message: '无该设备权限' })
            return
          }
        }
        const devices = readJsonArray(this.deps.getDevicesPath()) as Array<Record<string, unknown>>
        const device = devices.find((d) => String(d.id || '') === id)
        if (!device || String(device.brand || '') !== 'bambu') {
          sendJson(res, 404, { ok: false, message: 'Not a Bambu device' })
          return
        }
        if ((device.connectionMode || 'lan') !== 'lan' || !device.bambuHost) {
          sendJson(res, 400, { ok: false, message: '仅支持 Bambu 局域网设备' })
          return
        }
        const accessCode = this.deps.getDeviceApiKey(id)
        if (!accessCode) {
          sendJson(res, 400, { ok: false, message: '缺少访问码' })
          return
        }
        const raw = await readBody(req)
        let body: Record<string, unknown> = {}
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown
            if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
          } catch {
            sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
            return
          }
        }
        const usage = await fetchBambuPrintUsageGrams({
          host: String(device.bambuHost),
          accessCode,
          gcodeFile: typeof body.gcodeFile === 'string' ? body.gcodeFile : undefined,
          filename: typeof body.filename === 'string' ? body.filename : undefined
        })
        sendJson(res, usage.ok ? 200 : 502, usage)
        return
      }

      // 进料 / 退料专用接口（等价于 control + load_filament / unload_filament）
      const filamentCtrl = path.match(/^\/api\/v1\/devices\/([^/]+)\/filament\/(load|unload)$/)
      if (method === 'POST' && filamentCtrl) {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        const id = decodeURIComponent(filamentCtrl[1])
        const kind = filamentCtrl[2] as 'load' | 'unload'
        const gate = assertDeviceControlAllowed(
          auth,
          id,
          kind === 'load' ? 'load_filament' : 'unload_filament'
        )
        if (!gate.ok) {
          sendJson(res, gate.status, { ok: false, message: gate.message })
          return
        }
        const raw = await readBody(req)
        let body: Record<string, unknown> = {}
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as unknown
            if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
          } catch {
            sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
            return
          }
        }
        const extras = parseControlExtras(body)
        const result = await this.deps.onControl(id, {
          action: kind === 'load' ? 'load_filament' : 'unload_filament',
          ...extras
        })
        this.deps.appendLog?.(
          makeOperationLog(
            id,
            deviceNameFromPath(this.deps.getDevicesPath, id),
            kind === 'load' ? 'load_filament' : 'unload_filament',
            result.ok ? 'ok' : 'error',
            result.message
          )
        )
        sendJson(res, result.ok ? 200 : 502, result)
        return
      }

      if (method === 'GET' && path === '/api/v1/filament/backend') {
        sendJson(res, 200, { ok: true, ...getFilamentBackendState(filamentCloudDeps(this.deps)) })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/backend') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { backend?: string; mutualSync?: boolean } = {}
        try {
          body = raw ? (JSON.parse(raw) as { backend?: string; mutualSync?: boolean }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        const deps = filamentCloudDeps(this.deps)
        if (typeof body.mutualSync === 'boolean' && body.backend == null) {
          const st = setMutualSync(deps, body.mutualSync)
          sendJson(res, 200, { ok: true, ...st })
          return
        }
        const backend: FilamentBackendKind =
          body.backend === 'bambu_studio' ? 'bambu_studio' : 'local'
        let st = setFilamentBackend(deps, backend)
        if (typeof body.mutualSync === 'boolean') {
          st = setMutualSync(deps, body.mutualSync)
        }
        if (backend === 'bambu_studio' && !st.loggedIn) {
          sendJson(res, 200, {
            ok: true,
            ...st,
            message: '请登录拓竹账号以对接 Bambu Studio 耗材管理'
          })
          return
        }
        sendJson(res, 200, { ok: true, ...st })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/bambu/send-code') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { region?: string; account?: string } = {}
        try {
          body = raw ? (JSON.parse(raw) as { region?: string; account?: string }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        const r = await sendFilamentBambuCode({
          region: body.region === 'global' ? 'global' : 'china',
          account: String(body.account || '')
        })
        sendJson(res, r.ok ? 200 : 400, r)
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/bambu/login') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { region?: string; account?: string; password?: string; code?: string } = {}
        try {
          body = raw ? (JSON.parse(raw) as typeof body) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        const r = await loginFilamentBambu(filamentCloudDeps(this.deps), {
          region: body.region === 'global' ? 'global' : 'china',
          account: String(body.account || ''),
          password: body.password,
          code: body.code
        })
        sendJson(res, 200, { ...r, ...getFilamentBackendState(filamentCloudDeps(this.deps)) })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/bambu/logout') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        sendJson(res, 200, { ok: true, ...logoutFilamentBambu(filamentCloudDeps(this.deps)) })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/bambu/ams-sync') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const devices = readJsonArray(this.deps.getDevicesPath()) as DeviceRow[]
        const serials = devices
          .filter((d) => String(d.brand || '') === 'bambu')
          .map((d) => String(d.bambuDeviceId || d.serial || '').trim())
          .filter(Boolean)
        const r = await amsSyncFromPrinters(filamentCloudDeps(this.deps), serials)
        sendJson(res, r.ok ? 200 : 400, r)
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/bambu/mutual-sync') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const deps = filamentCloudDeps(this.deps)
        const raw = await readBody(req)
        let body: { enable?: boolean } = {}
        try {
          body = raw ? (JSON.parse(raw) as { enable?: boolean }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        if (typeof body.enable === 'boolean') {
          setMutualSync(deps, body.enable)
          if (!body.enable) {
            sendJson(res, 200, {
              ok: true,
              ...getFilamentBackendState(deps),
              message: '已关闭互相同步',
              pushed: 0,
              pulled: 0,
              updated: 0,
              skipped: 0
            })
            return
          }
        }
        const r = await runMutualSync(deps)
        this.deps.onFilamentChanged?.()
        sendJson(res, r.ok ? 200 : 400, { ...r, ...getFilamentBackendState(deps) })
        return
      }

      if (method === 'GET' && path === '/api/v1/filament/sync-sources') {
        sendJson(res, 200, { ok: true, ...getFilamentSyncSources(filamentSyncDeps(this.deps)) })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/sync-sources') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { sources?: Partial<FilamentSyncSource>[] } = {}
        try {
          body = raw ? (JSON.parse(raw) as { sources?: Partial<FilamentSyncSource>[] }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        if (!Array.isArray(body.sources)) {
          sendJson(res, 400, { ok: false, message: '需要 sources 数组（最多 3 个）' })
          return
        }
        const st = setFilamentSyncSources(filamentSyncDeps(this.deps), body.sources)
        sendJson(res, 200, { ok: true, ...st })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/sync-sources/test') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { id?: string } = {}
        try {
          body = raw ? (JSON.parse(raw) as { id?: string }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        const r = await testFilamentSyncSource(filamentSyncDeps(this.deps), String(body.id || ''))
        sendJson(res, r.ok ? 200 : 400, r)
        return
      }

      if (method === 'POST' && path === '/api/v1/filament/sync-sources/sync') {
        if (auth.kind === 'user' && !hasPerm(effectivePermissions(auth.user), 'filament.edit')) {
          sendJson(res, 403, { ok: false, message: '缺少权限：filament.edit' })
          return
        }
        const raw = await readBody(req)
        let body: { id?: string; all?: boolean } = {}
        try {
          body = raw ? (JSON.parse(raw) as { id?: string; all?: boolean }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        const deps = filamentSyncDeps(this.deps)
        if (body.all || !body.id) {
          const r = await syncAllFilamentSources(deps)
          this.deps.onFilamentChanged?.()
          sendJson(res, r.ok ? 200 : 400, r)
          return
        }
        const r = await syncFilamentSource(deps, String(body.id))
        this.deps.onFilamentChanged?.()
        sendJson(res, r.ok ? 200 : 400, { ok: r.ok, message: r.message, results: [r] })
        return
      }

      if (method === 'GET' && path === '/api/v1/filament') {
        const tech = url.searchParams.get('tech')
        const archived = url.searchParams.get('archived')
        const source = url.searchParams.get('source')
        let spools = readJsonArray(this.deps.getFilamentPath()) as SpoolRow[]
        const fb = getFilamentBackendState(filamentCloudDeps(this.deps))

        if (source === 'local') {
          // local page / local linking only
        } else if (source === 'bambu') {
          if (!fb.loggedIn) {
            sendJson(res, 200, { ok: true, spools: [], backend: fb, message: '未登录拓竹云' })
            return
          }
          const cloud = await listCloudSpools(filamentCloudDeps(this.deps))
          if (!cloud.ok) {
            sendJson(res, 502, { ok: false, message: cloud.message, backend: fb })
            return
          }
          spools = cloud.spools as SpoolRow[]
        } else if (fb.backend === 'bambu_studio' && fb.loggedIn) {
          const cloud = await listCloudSpools(filamentCloudDeps(this.deps))
          if (!cloud.ok) {
            sendJson(res, 502, { ok: false, message: cloud.message, backend: fb })
            return
          }
          spools = cloud.spools as SpoolRow[]
        }
        if (tech === 'fdm' || tech === 'resin') {
          spools = spools.filter((s) => s.tech === tech)
        }
        if (archived === '0' || archived === 'false') {
          spools = spools.filter((s) => !s.archived)
        } else if (archived === '1' || archived === 'true') {
          spools = spools.filter((s) => !!s.archived)
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const hooked = (await pm.runHook(
              'filament_list',
              { spools },
              { method, path, url, auth, tech, archived }
            )) as { spools?: SpoolRow[] }
            if (hooked?.spools && Array.isArray(hooked.spools)) spools = hooked.spools
          }
        } catch {
          /* ignore */
        }
        sendJson(res, 200, { ok: true, spools, backend: fb })
        return
      }

      const filamentOne = path.match(/^\/api\/v1\/filament\/([^/]+)$/)
      if (filamentOne) {
        const id = decodeURIComponent(filamentOne[1])
        const file = this.deps.getFilamentPath()
        const spools = readJsonArray(file) as SpoolRow[]
        const idx = spools.findIndex((s) => s.id === id)

        if (method === 'GET') {
          if (idx < 0 && isCloudSpoolId(id)) {
            const cloud = await listCloudSpools(filamentCloudDeps(this.deps))
            if (!cloud.ok) {
              sendJson(res, 502, { ok: false, message: cloud.message })
              return
            }
            const spool = cloud.spools.find((s) => String(s.id) === id)
            if (!spool) {
              sendJson(res, 404, { ok: false, message: 'Spool not found' })
              return
            }
            sendJson(res, 200, { ok: true, spool })
            return
          }
          if (idx < 0) {
            sendJson(res, 404, { ok: false, message: 'Spool not found' })
            return
          }
          sendJson(res, 200, { ok: true, spool: spools[idx] })
          return
        }

        if (method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
          // JWT / local session: RBAC; Open API Key still gated by apiMode
          if (auth.kind === 'apiKey' && settings.apiMode !== 'control') {
            sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
            return
          }
          if (auth.kind === 'user') {
            const need =
              method === 'DELETE' ? 'filament.delete' : 'filament.edit'
            if (!hasPerm(effectivePermissions(auth.user), need)) {
              sendJson(res, 403, { ok: false, message: `缺少权限：${need}` })
              return
            }
          }
          if (idx < 0 && isCloudSpoolId(id)) {
            if (method === 'DELETE') {
              const r = await deleteCloudSpool(filamentCloudDeps(this.deps), id)
              sendJson(res, r.ok ? 200 : 400, r.ok ? { ok: true } : { ok: false, message: r.message })
              this.deps.onFilamentChanged?.()
              return
            }
            const raw = await readBody(req)
            let body: Record<string, unknown> = {}
            try {
              body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
            } catch {
              sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
              return
            }
            const r = await updateCloudSpool(filamentCloudDeps(this.deps), id, body)
            if (!r.ok) {
              sendJson(res, 400, { ok: false, message: r.message || '拓竹云更新失败' })
              return
            }
            this.deps.onFilamentChanged?.()
            sendJson(res, 200, { ok: true, spool: { id, ...body } })
            return
          }
          if (idx < 0) {
            sendJson(res, 404, { ok: false, message: 'Spool not found' })
            return
          }
          if (method === 'DELETE') {
            try {
              const pm = this.deps.getPluginManager?.()
              if (pm) {
                const before = (await pm.runHook(
                  'filament_delete',
                  { proceed: true, spoolId: id, spool: spools[idx] },
                  { method, path, url, auth }
                )) as {
                  proceed?: boolean
                  status?: number
                  body?: unknown
                }
                if (before && before.proceed === false) {
                  sendJson(
                    res,
                    before.status || 403,
                    before.body ?? { ok: false, message: 'blocked' }
                  )
                  return
                }
              }
            } catch {
              /* ignore */
            }
            spools.splice(idx, 1)
            writeSpools(file, spools)
            this.deps.onFilamentChanged?.()
            sendJson(res, 200, { ok: true })
            return
          }
          const raw = await readBody(req)
          let body: Record<string, unknown>
          try {
            body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
          } catch {
            sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
            return
          }
          try {
            const pm = this.deps.getPluginManager?.()
            if (pm) {
              const before = (await pm.runHook(
                'filament_update',
                { proceed: true, spoolId: id, spool: body, prev: spools[idx] },
                { method, path, url, auth }
              )) as {
                proceed?: boolean
                status?: number
                body?: unknown
                spool?: Record<string, unknown>
              }
              if (before && before.proceed === false) {
                sendJson(
                  res,
                  before.status || 403,
                  before.body ?? { ok: false, message: 'blocked' }
                )
                return
              }
              if (before?.spool && typeof before.spool === 'object') body = before.spool
            }
          } catch {
            /* ignore */
          }
          const next = mergeSpool(spools[idx], body, method === 'PUT')
          if ('error' in next) {
            sendJson(res, 400, { ok: false, message: next.error })
            return
          }
          spools[idx] = next.spool
          writeSpools(file, spools)
          this.deps.onFilamentChanged?.()
          sendJson(res, 200, { ok: true, spool: next.spool })
          return
        }
      }

      const filamentArchive = path.match(/^\/api\/v1\/filament\/([^/]+)\/archive$/)
      if (method === 'POST' && filamentArchive) {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        const id = decodeURIComponent(filamentArchive[1])
        const file = this.deps.getFilamentPath()
        const spools = readJsonArray(file) as SpoolRow[]
        const idx = spools.findIndex((s) => s.id === id)
        if (idx < 0) {
          sendJson(res, 404, { ok: false, message: 'Spool not found' })
          return
        }
        const raw = await readBody(req)
        let archived = true
        if (raw) {
          try {
            const body = JSON.parse(raw) as { archived?: boolean }
            if (typeof body.archived === 'boolean') archived = body.archived
          } catch {
            sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
            return
          }
        }
        spools[idx] = {
          ...spools[idx],
          archived,
          updatedAt: new Date().toISOString()
        }
        writeSpools(file, spools)
        this.deps.onFilamentChanged?.()
        sendJson(res, 200, { ok: true, spool: spools[idx] })
        return
      }

      if (method === 'POST' && path === '/api/v1/filament') {
        if (settings.apiMode !== 'control') {
          sendJson(res, 403, { ok: false, message: 'API is in readonly mode' })
          return
        }
        const raw = await readBody(req)
        let body: Record<string, unknown>
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'filament_create',
              { proceed: true, spool: body },
              { method, path, url, auth }
            )) as {
              proceed?: boolean
              status?: number
              body?: unknown
              spool?: Record<string, unknown>
            }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
            if (before?.spool && typeof before.spool === 'object') body = before.spool
          }
        } catch {
          /* ignore */
        }
        const depsFb = filamentCloudDeps(this.deps)
        const createdLocal = async () => {
          const created = createSpool(body)
          if ('error' in created) {
            sendJson(res, 400, { ok: false, message: created.error })
            return
          }
          const file = this.deps.getFilamentPath()
          const spools = readJsonArray(file) as SpoolRow[]
          spools.unshift(created.spool)
          writeSpools(file, spools)
          try {
            await mirrorLocalCreateToCloud(depsFb, created.spool as Record<string, unknown>)
          } catch {
            /* ignore mirror errors */
          }
          this.deps.onFilamentChanged?.()
          sendJson(res, 200, { ok: true, spool: created.spool })
        }

        const fb = getFilamentBackendState(depsFb)
        const tech = String(body.tech || 'fdm')
        if (fb.backend === 'bambu_studio' && fb.loggedIn && tech !== 'resin') {
          const r = await createCloudSpool(depsFb, body)
          if (!r.ok) {
            sendJson(res, 400, { ok: false, message: r.message || '拓竹云添加失败' })
            return
          }
          const listed = await listCloudSpools(depsFb)
          const cloudSpool = listed.ok ? listed.spools[0] : null
          if (cloudSpool) {
            try {
              mirrorCloudCreateToLocal(depsFb, cloudSpool as Record<string, unknown>)
            } catch {
              /* ignore */
            }
          }
          this.deps.onFilamentChanged?.()
          sendJson(res, 200, {
            ok: true,
            spool: cloudSpool || { ...body }
          })
          return
        }
        await createdLocal()
        return
      }

      if (method === 'GET' && path === '/api/v1/quote/presets') {
        let payload: Record<string, unknown> = {
          ok: true,
          materials: QUOTE_MATERIAL_PRESETS,
          printers: QUOTE_PRINTER_PRESETS
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const hooked = (await pm.runHook('quote_presets', payload, {
              method,
              path,
              url,
              auth
            })) as Record<string, unknown>
            if (hooked && typeof hooked === 'object') payload = hooked
          }
        } catch {
          /* ignore */
        }
        sendJson(res, 200, payload)
        return
      }

      if (method === 'POST' && path === '/api/v1/quote/calculate') {
        const raw = await readBody(req)
        let body: Record<string, unknown>
        try {
          body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'quote_calculate',
              { proceed: true, body },
              { method, path, url, auth }
            )) as {
              proceed?: boolean
              status?: number
              body?: unknown
              request?: Record<string, unknown>
            }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
            if (before?.request && typeof before.request === 'object') body = before.request
          }
        } catch {
          /* ignore */
        }
        const shared = parseQuoteShared(body)
        if ('error' in shared) {
          sendJson(res, 400, { ok: false, message: shared.error })
          return
        }
        const spools = readJsonArray(this.deps.getFilamentPath()) as SpoolRow[]
        const optionsRaw = Array.isArray(body.options) ? body.options : null
        if (optionsRaw && optionsRaw.length > 0) {
          const options = optionsRaw.slice(0, 8).map((opt, i) => {
            const o = (opt && typeof opt === 'object' ? opt : {}) as Record<string, unknown>
            const spoolId = typeof o.spoolId === 'string' ? o.spoolId : null
            const spool = spoolId ? spools.find((s) => s.id === spoolId) : undefined
            let pricePerKg = Number(o.pricePerKg)
            if ((!Number.isFinite(pricePerKg) || pricePerKg < 0) && spool) {
              pricePerKg = spoolPricePerKg(spool) ?? 0
            }
            if (!Number.isFinite(pricePerKg) || pricePerKg < 0) {
              pricePerKg = Number(body.pricePerKg) || 0
            }
            const costs = calcQuoteCosts({ ...shared.params, pricePerKg })
            return {
              id: typeof o.id === 'string' ? o.id : `opt-${i + 1}`,
              name: typeof o.name === 'string' ? o.name : `方案 ${i + 1}`,
              brandId: typeof o.brandId === 'string' ? o.brandId : spool?.brandId,
              materialId: typeof o.materialId === 'string' ? o.materialId : spool?.material,
              color: typeof o.color === 'string' ? o.color : spool?.color,
              colorHex: typeof o.colorHex === 'string' ? o.colorHex : spool?.colorHex,
              spoolId,
              pricePerKg,
              note: typeof o.note === 'string' ? o.note : undefined,
              costs
            }
          })
          let out: Record<string, unknown> = { ok: true, shared: shared.params, options }
          try {
            const pm = this.deps.getPluginManager?.()
            if (pm) {
              const after = (await pm.runHook('quote_calculate', out, {
                method,
                path,
                url,
                auth,
                phase: 'after'
              })) as Record<string, unknown>
              if (after && typeof after === 'object' && after.ok !== false) out = after
            }
          } catch {
            /* ignore */
          }
          sendJson(res, 200, out)
          return
        }
        const pricePerKg = Number(body.pricePerKg) || 0
        const costs = calcQuoteCosts({ ...shared.params, pricePerKg })
        let outSingle: Record<string, unknown> = {
          ok: true,
          shared: { ...shared.params, pricePerKg },
          costs
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const after = (await pm.runHook('quote_calculate', outSingle, {
              method,
              path,
              url,
              auth,
              phase: 'after'
            })) as Record<string, unknown>
            if (after && typeof after === 'object' && after.ok !== false) outSingle = after
          }
        } catch {
          /* ignore */
        }
        sendJson(res, 200, outSingle)
        return
      }

      if (method === 'POST' && path === '/api/v1/quote/parse-gcode') {
        const raw = await readBody(req)
        let body: { text?: string; gcode?: string }
        try {
          body = raw ? (JSON.parse(raw) as { text?: string; gcode?: string }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        let text = body.text || body.gcode || ''
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'quote_parse_gcode',
              { proceed: true, text },
              { method, path, url, auth }
            )) as {
              proceed?: boolean
              status?: number
              body?: unknown
              text?: string
              result?: Record<string, unknown>
            }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
            if (typeof before?.text === 'string') text = before.text
            if (before?.result && typeof before.result === 'object') {
              sendJson(res, 200, { ok: true, ...before.result })
              return
            }
          }
        } catch {
          /* ignore */
        }
        if (!text.trim()) {
          sendJson(res, 400, { ok: false, message: 'Body must include text or gcode' })
          return
        }
        sendJson(res, 200, { ok: true, ...parseGcodeMeta(text) })
        return
      }

      if (method === 'POST' && path === '/api/v1/quote/history') {
        const store = this.deps.getQuoteHistoryStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '报价记录服务未就绪' })
          return
        }
        if (auth.kind !== 'user' && auth.kind !== 'local' && auth.kind !== 'apiKey') {
          sendJson(res, 401, { ok: false, message: '未登录' })
          return
        }
        const rawHist = await readBody(req)
        let bodyHist: Record<string, unknown>
        try {
          bodyHist = rawHist ? (JSON.parse(rawHist) as Record<string, unknown>) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'quote_history_create',
              { proceed: true, record: bodyHist },
              { method, path, url, auth }
            )) as {
              proceed?: boolean
              status?: number
              body?: unknown
              record?: Record<string, unknown>
            }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
            if (before?.record && typeof before.record === 'object') bodyHist = before.record
          }
        } catch {
          /* ignore */
        }
        try {
          const record = store.append({
            action: bodyHist.action === 'export' ? 'export' : 'copy',
            userId: auth.kind === 'user' ? auth.user.id : 'local',
            username: auth.kind === 'user' ? auth.user.username : 'server',
            displayName:
              auth.kind === 'user'
                ? auth.user.displayName || auth.user.username
                : auth.kind === 'apiKey'
                  ? 'API Key'
                  : '本机服务端',
            customer: typeof bodyHist.customer === 'string' ? bodyHist.customer : undefined,
            jobName: typeof bodyHist.jobName === 'string' ? bodyHist.jobName : undefined,
            tech: bodyHist.tech === 'resin' ? 'resin' : 'fdm',
            weightG: Number(bodyHist.weightG) || 0,
            printHours: Number(bodyHist.printHours) || 0,
            qty: Number(bodyHist.qty) || 1,
            options: Array.isArray(bodyHist.options)
              ? (bodyHist.options as import('../../shared/quoteHistory').QuoteHistoryOption[])
              : [],
            textPreview: typeof bodyHist.textPreview === 'string' ? bodyHist.textPreview : undefined,
            gcodeFileName:
              typeof bodyHist.gcodeFileName === 'string' ? bodyHist.gcodeFileName : undefined
          })
          sendJson(res, 200, { ok: true, record })
        } catch (e) {
          sendJson(res, 400, {
            ok: false,
            message: e instanceof Error ? e.message : '保存报价记录失败'
          })
        }
        return
      }

      if (method === 'GET' && path === '/api/v1/quote/history') {
        const store = this.deps.getQuoteHistoryStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '报价记录服务未就绪' })
          return
        }
        const canList =
          auth.kind === 'local' ||
          auth.kind === 'apiKey' ||
          (auth.kind === 'user' &&
            (auth.user.level === 'admin' ||
              hasPerm(effectivePermissions(auth.user), 'nav.users') ||
              hasPerm(effectivePermissions(auth.user), 'nav.tools')))
        if (!canList) {
          sendJson(res, 403, { ok: false, message: '无权限查看全部报价记录' })
          return
        }
        const q = url.searchParams.get('q') || undefined
        const userId = url.searchParams.get('userId') || undefined
        const username = url.searchParams.get('username') || undefined
        const action = url.searchParams.get('action') || undefined
        const limitRaw = Number(url.searchParams.get('limit') || 200)
        const records = store.list({
          q,
          userId,
          username,
          action,
          limit: Number.isFinite(limitRaw) ? limitRaw : 200
        })
        let out = { ok: true as const, records }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const hooked = (await pm.runHook('quote_history_list', out, {
              method,
              path,
              url,
              auth
            })) as { ok?: boolean; records?: typeof records }
            if (hooked?.records && Array.isArray(hooked.records)) {
              out = { ok: true, records: hooked.records }
            }
          }
        } catch {
          /* ignore */
        }
        sendJson(res, 200, out)
        return
      }

      if (method === 'DELETE' && path.startsWith('/api/v1/quote/history/')) {
        const store = this.deps.getQuoteHistoryStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '报价记录服务未就绪' })
          return
        }
        const canDelete =
          auth.kind === 'local' ||
          auth.kind === 'apiKey' ||
          (auth.kind === 'user' &&
            (auth.user.level === 'admin' ||
              hasPerm(effectivePermissions(auth.user), 'nav.users') ||
              hasPerm(effectivePermissions(auth.user), 'nav.tools')))
        if (!canDelete) {
          sendJson(res, 403, { ok: false, message: '无权限删除报价记录' })
          return
        }
        const id = decodeURIComponent(path.slice('/api/v1/quote/history/'.length))
        if (!id) {
          sendJson(res, 400, { ok: false, message: '缺少记录 ID' })
          return
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'quote_history_delete',
              { proceed: true, id },
              { method, path, url, auth }
            )) as { proceed?: boolean; status?: number; body?: unknown }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
          }
        } catch {
          /* ignore */
        }
        try {
          store.remove(id)
          sendJson(res, 200, { ok: true })
        } catch (e) {
          sendJson(res, 400, {
            ok: false,
            message: e instanceof Error ? e.message : '删除报价记录失败'
          })
        }
        return
      }

      if (method === 'GET' && path === '/api/v1/update/mirrors') {
        const preferred = readPreferredMirror(dirname(this.deps.getFilamentPath()))
        sendJson(res, 200, {
          ok: true,
          preferred,
          mirrors: listUpdateMirrors()
        })
        return
      }

      if (method === 'POST' && path === '/api/v1/update/mirror') {
        const canSet =
          auth.kind === 'local' ||
          (auth.kind === 'user' && auth.user.level === 'admin')
        if (!canSet) {
          sendJson(res, 403, { ok: false, message: '仅管理员可切换更新平台' })
          return
        }
        const raw = await readBody(req)
        let body: { mirror?: string } = {}
        try {
          body = raw ? (JSON.parse(raw) as { mirror?: string }) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        if (!isUpdateMirrorId(body.mirror)) {
          sendJson(res, 400, { ok: false, message: 'mirror 须为 github | gitee | gitcode' })
          return
        }
        const dataRoot = dirname(this.deps.getFilamentPath())
        setUpdatePrefsDataRoot(dataRoot)
        const preferred = writePreferredMirror(body.mirror, dataRoot)
        sendJson(res, 200, {
          ok: true,
          preferred,
          mirrors: listUpdateMirrors()
        })
        return
      }

      if (method === 'GET' && path === '/api/v1/update/check') {
        const force = url.searchParams.get('force') === '1'
        const mirrorParam = url.searchParams.get('mirror')
        const dataRoot = dirname(this.deps.getFilamentPath())
        setUpdatePrefsDataRoot(dataRoot)
        const current = this.deps.version || readLocalPackageVersion()
        const result = await checkGithubUpdate({
          currentVersion: current,
          force,
          mirror: mirrorParam
        })
        // Always 200: unreachable mirror is a normal check outcome, not an HTTP failure.
        sendJson(res, 200, {
          ...result,
          preferred: readPreferredMirror(dataRoot),
          mirrors: listUpdateMirrors()
        })
        return
      }

      if (method === 'POST' && path === '/api/v1/update/apply') {
        const canApply =
          auth.kind === 'local' ||
          (auth.kind === 'user' && auth.user.level === 'admin')
        if (!canApply) {
          sendJson(res, 403, { ok: false, message: '仅管理员可执行源码更新' })
          return
        }
        const dataRoot = dirname(this.deps.getFilamentPath())
        setUpdatePrefsDataRoot(dataRoot)
        const raw = await readBody(req)
        let body: { mirror?: string } = {}
        try {
          body = raw ? (JSON.parse(raw) as { mirror?: string }) : {}
        } catch {
          body = {}
        }
        if (isUpdateMirrorId(body.mirror)) {
          writePreferredMirror(body.mirror, dataRoot)
        }
        const current = this.deps.version || readLocalPackageVersion()
        const result = await applyGithubSourceUpdate({
          currentVersion: current,
          mirror: isUpdateMirrorId(body.mirror) ? body.mirror : undefined
        })
        sendJson(res, result.ok ? 200 : result.reachable ? 500 : 502, result)
        return
      }

      if (method === 'GET' && path === '/api/v1/service/status') {
        const canStatus =
          auth.kind === 'local' ||
          auth.kind === 'apiKey' ||
          (auth.kind === 'user' && auth.user.level === 'admin')
        if (!canStatus) {
          sendJson(res, 403, { ok: false, message: '无权限' })
          return
        }
        sendJson(res, 200, { ok: true, status: this.status() })
        return
      }

      const quoteSchemeCanManage =
        auth.kind === 'local' ||
        auth.kind === 'apiKey' ||
        (auth.kind === 'user' &&
          (auth.user.level === 'admin' ||
            hasPerm(effectivePermissions(auth.user), 'nav.tools')))

      if (method === 'GET' && path === '/api/v1/quote/schemes') {
        const store = this.deps.getQuoteSchemesStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '计算方案服务未就绪' })
          return
        }
        if (!quoteSchemeCanManage) {
          sendJson(res, 403, { ok: false, message: '无权限查看计算方案' })
          return
        }
        let schemes = store.list()
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const hooked = (await pm.runHook(
              'quote_schemes_list',
              { schemes },
              { method, path, url, auth }
            )) as { schemes?: typeof schemes }
            if (hooked?.schemes && Array.isArray(hooked.schemes)) schemes = hooked.schemes
          }
        } catch {
          /* ignore */
        }
        sendJson(res, 200, { ok: true, schemes })
        return
      }

      const schemeMatch = path.match(/^\/api\/v1\/quote\/schemes\/([^/]+)(\/gcode)?$/)
      if (schemeMatch) {
        const store = this.deps.getQuoteSchemesStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '计算方案服务未就绪' })
          return
        }
        const schemeId = decodeURIComponent(schemeMatch[1])
        const isGcode = Boolean(schemeMatch[2])

        if (method === 'GET' && isGcode) {
          if (!quoteSchemeCanManage) {
            sendJson(res, 403, { ok: false, message: '无权限' })
            return
          }
          const result = store.readGcode(schemeId)
          sendJson(res, result.ok ? 200 : 404, result)
          return
        }

        if (method === 'GET' && !isGcode) {
          if (!quoteSchemeCanManage) {
            sendJson(res, 403, { ok: false, message: '无权限' })
            return
          }
          const scheme = store.get(schemeId)
          if (!scheme) {
            sendJson(res, 404, { ok: false, message: '方案不存在' })
            return
          }
          sendJson(res, 200, { ok: true, scheme })
          return
        }

        if (method === 'DELETE' && !isGcode) {
          if (!quoteSchemeCanManage) {
            sendJson(res, 403, { ok: false, message: '无权限' })
            return
          }
          try {
            const pm = this.deps.getPluginManager?.()
            if (pm) {
              const before = (await pm.runHook(
                'quote_schemes_delete',
                { proceed: true, schemeId },
                { method, path, url, auth }
              )) as { proceed?: boolean; status?: number; body?: unknown }
              if (before && before.proceed === false) {
                sendJson(
                  res,
                  before.status || 403,
                  before.body ?? { ok: false, message: 'blocked' }
                )
                return
              }
            }
          } catch {
            /* ignore */
          }
          try {
            store.remove(schemeId)
            sendJson(res, 200, { ok: true })
          } catch (e) {
            sendJson(res, 400, {
              ok: false,
              message: e instanceof Error ? e.message : '删除失败'
            })
          }
          return
        }
      }

      if (method === 'POST' && path === '/api/v1/quote/schemes') {
        const store = this.deps.getQuoteSchemesStore?.()
        if (!store) {
          sendJson(res, 503, { ok: false, message: '计算方案服务未就绪' })
          return
        }
        if (!quoteSchemeCanManage) {
          sendJson(res, 403, { ok: false, message: '无权限保存计算方案' })
          return
        }
        const rawScheme = await readBody(req)
        let bodyScheme: Record<string, unknown>
        try {
          bodyScheme = rawScheme ? (JSON.parse(rawScheme) as Record<string, unknown>) : {}
        } catch {
          sendJson(res, 400, { ok: false, message: 'Invalid JSON body' })
          return
        }
        try {
          const pm = this.deps.getPluginManager?.()
          if (pm) {
            const before = (await pm.runHook(
              'quote_schemes_save',
              { proceed: true, scheme: bodyScheme },
              { method, path, url, auth }
            )) as {
              proceed?: boolean
              status?: number
              body?: unknown
              scheme?: Record<string, unknown>
            }
            if (before && before.proceed === false) {
              sendJson(
                res,
                before.status || 403,
                before.body ?? { ok: false, message: 'blocked' }
              )
              return
            }
            if (before?.scheme && typeof before.scheme === 'object') bodyScheme = before.scheme
          }
        } catch {
          /* ignore */
        }
        try {
          const scheme = store.save({
            id: typeof bodyScheme.id === 'string' ? bodyScheme.id : undefined,
            name: String(bodyScheme.name || ''),
            customer: typeof bodyScheme.customer === 'string' ? bodyScheme.customer : undefined,
            jobName: typeof bodyScheme.jobName === 'string' ? bodyScheme.jobName : undefined,
            tech: bodyScheme.tech === 'resin' ? 'resin' : 'fdm',
            weightG: Number(bodyScheme.weightG) || 0,
            hours: Number(bodyScheme.hours) || 0,
            minutesExtra: Number(bodyScheme.minutesExtra) || 0,
            wastePct: Number(bodyScheme.wastePct) || 0,
            printerId: String(bodyScheme.printerId || 'custom'),
            watts: Number(bodyScheme.watts) || 0,
            electricity: Number(bodyScheme.electricity) || 0,
            wearPerHour: Number(bodyScheme.wearPerHour) || 0,
            laborMinutes: Number(bodyScheme.laborMinutes) || 0,
            laborRate: Number(bodyScheme.laborRate) || 0,
            packaging: Number(bodyScheme.packaging) || 0,
            shipping: Number(bodyScheme.shipping) || 0,
            failPct: Number(bodyScheme.failPct) || 0,
            pricingMode: bodyScheme.pricingMode === 'margin' ? 'margin' : 'markup',
            markupPct: Number(bodyScheme.markupPct) || 0,
            marginPct: Number(bodyScheme.marginPct) || 0,
            minPrice: Number(bodyScheme.minPrice) || 0,
            qty: Number(bodyScheme.qty) || 1,
            options: Array.isArray(bodyScheme.options)
              ? (bodyScheme.options as import('../../shared/quoteSchemes').QuoteSchemeMaterialOption[])
              : [],
            gcodeText: typeof bodyScheme.gcodeText === 'string' ? bodyScheme.gcodeText : undefined,
            gcodeFileName:
              typeof bodyScheme.gcodeFileName === 'string' ? bodyScheme.gcodeFileName : undefined,
            gcodeNote: typeof bodyScheme.gcodeNote === 'string' ? bodyScheme.gcodeNote : undefined,
            clearGcode: bodyScheme.clearGcode === true
          })
          sendJson(res, 200, { ok: true, scheme })
        } catch (e) {
          sendJson(res, 400, {
            ok: false,
            message: e instanceof Error ? e.message : '保存失败'
          })
        }
        return
      }

      sendJson(res, 404, { ok: false, message: 'Not found' })
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      })
    }
  }
}

function writeSpools(path: string, spools: SpoolRow[]): void {
  writeJsonArray(path, spools)
}

function filamentCloudDeps(deps: ApiServerDeps) {
  return {
    filamentPath: deps.getFilamentPath(),
    getSecret: (key: string) => deps.getSecret?.(key) || null,
    setSecret: (key: string, value: string) => deps.setDeviceSecret(key, value),
    deleteSecret: (key: string) => deps.deleteDeviceSecret(key)
  }
}

function filamentSyncDeps(deps: ApiServerDeps) {
  return { filamentPath: deps.getFilamentPath() }
}

function collectSpoolExtras(source: Record<string, unknown>): Record<string, unknown> {
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

function createSpool(
  body: Record<string, unknown>
): { spool: SpoolRow } | { error: string } {
  const brandId = String(body.brandId || '').trim()
  const material = String(body.material || '').trim()
  const color = String(body.color || '').trim()
  const colorHex = String(body.colorHex || '#888888').trim() || '#888888'
  const tech = body.tech === 'resin' ? 'resin' : 'fdm'
  const totalGrams = Math.max(0, Number(body.totalGrams) || 0)
  let remainGrams = Number(body.remainGrams)
  if (!Number.isFinite(remainGrams)) remainGrams = totalGrams
  remainGrams = Math.max(0, Math.min(totalGrams || remainGrams, remainGrams))
  if (!brandId) return { error: 'brandId is required' }
  if (!material) return { error: 'material is required' }
  if (!color) return { error: 'color is required' }
  if (totalGrams <= 0) return { error: 'totalGrams must be > 0' }
  const now = new Date().toISOString()
  const rolls = normalizeRolls(body.rolls)
  const legacyBind = normalizeAmsBinding(body.amsBinding)
  const amsBindings = normalizeAmsBindings(
    body.amsBindings,
    legacyBind === undefined ? null : legacyBind,
    rolls
  )
  return {
    spool: {
      id: randomUUID(),
      brandId,
      material,
      color,
      colorHex,
      totalGrams,
      remainGrams,
      rolls,
      location: body.location != null ? String(body.location) : undefined,
      price: body.price != null && Number.isFinite(Number(body.price)) ? Number(body.price) : undefined,
      openedAt: body.openedAt != null ? String(body.openedAt) : undefined,
      notes: body.notes != null ? String(body.notes) : undefined,
      tech,
      archived: !!body.archived,
      amsBindings,
      amsBinding: amsBindings[0] || null,
      createdAt: now,
      updatedAt: now,
      ...collectSpoolExtras(body)
    }
  }
}

function mergeSpool(
  prev: SpoolRow,
  body: Record<string, unknown>,
  replace: boolean
): { spool: SpoolRow } | { error: string } {
  const base: Record<string, unknown> = replace
    ? {
        id: prev.id,
        createdAt: prev.createdAt,
        brandId: body.brandId,
        material: body.material,
        color: body.color,
        colorHex: body.colorHex,
        totalGrams: body.totalGrams,
        remainGrams: body.remainGrams,
        rolls: body.rolls,
        location: body.location,
        price: body.price,
        openedAt: body.openedAt,
        notes: body.notes,
        tech: body.tech,
        archived: body.archived,
        amsBinding: body.amsBinding,
        amsBindings: body.amsBindings
      }
    : { ...prev, ...body, id: prev.id, createdAt: prev.createdAt }

  const brandId = String(base.brandId || '').trim()
  const material = String(base.material || '').trim()
  const color = String(base.color || '').trim()
  const colorHex = String(base.colorHex || '#888888').trim() || '#888888'
  const tech = base.tech === 'resin' ? 'resin' : 'fdm'
  const totalGrams = Math.max(0, Number(base.totalGrams) || 0)
  let remainGrams = Number(base.remainGrams)
  if (!Number.isFinite(remainGrams)) remainGrams = totalGrams
  remainGrams = Math.max(0, Math.min(totalGrams || remainGrams, remainGrams))
  if (!brandId) return { error: 'brandId is required' }
  if (!material) return { error: 'material is required' }
  if (!color) return { error: 'color is required' }
  if (totalGrams <= 0) return { error: 'totalGrams must be > 0' }

  const rolls =
    'rolls' in base && base.rolls != null ? normalizeRolls(base.rolls) : normalizeRolls(prev.rolls)

  const legacyBind =
    'amsBinding' in base
      ? normalizeAmsBinding(base.amsBinding)
      : normalizeAmsBinding(prev.amsBinding)
  const bindingsRaw = 'amsBindings' in base ? base.amsBindings : prev.amsBindings
  const amsBindings = normalizeAmsBindings(
    bindingsRaw,
    legacyBind === undefined ? null : legacyBind,
    rolls
  )

  return {
    spool: {
      id: prev.id,
      brandId,
      material,
      color,
      colorHex,
      totalGrams,
      remainGrams,
      rolls,
      location: base.location != null && base.location !== '' ? String(base.location) : undefined,
      price:
        base.price != null && base.price !== '' && Number.isFinite(Number(base.price))
          ? Number(base.price)
          : undefined,
      openedAt: base.openedAt != null && base.openedAt !== '' ? String(base.openedAt) : undefined,
      notes: base.notes != null && base.notes !== '' ? String(base.notes) : undefined,
      tech,
      archived: !!base.archived,
      amsBindings,
      amsBinding: amsBindings[0] || null,
      createdAt: prev.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...(replace
        ? collectSpoolExtras(body)
        : {
            ...collectSpoolExtras(prev as Record<string, unknown>),
            ...collectSpoolExtras(base)
          })
    }
  }
}

function parseQuoteShared(
  body: Record<string, unknown>
): { params: Omit<QuoteCalcParams, 'pricePerKg'> } | { error: string } {
  const pricingMode: PricingMode = body.pricingMode === 'margin' ? 'margin' : 'markup'
  const printHours =
    body.printHours != null
      ? Number(body.printHours)
      : (Number(body.printHoursHours) || 0) + (Number(body.printMinutes) || 0) / 60
  if (!Number.isFinite(printHours) || printHours < 0) {
    return { error: 'printHours must be a non-negative number' }
  }
  const weightG = Number(body.weightG)
  if (!Number.isFinite(weightG) || weightG < 0) {
    return { error: 'weightG must be a non-negative number' }
  }
  return {
    params: {
      weightG,
      wastePct: Number(body.wastePct) || 0,
      watts: Number(body.watts) || 0,
      printHours,
      electricity: Number(body.electricity) || 0,
      wearPerHour: Number(body.wearPerHour) || 0,
      laborMinutes: Number(body.laborMinutes) || 0,
      laborRate: Number(body.laborRate) || 0,
      packaging: Number(body.packaging) || 0,
      shipping: Number(body.shipping) || 0,
      failPct: Number(body.failPct) || 0,
      pricingMode,
      markupPct: Number(body.markupPct) || 0,
      marginPct: Number(body.marginPct) || 0,
      minPrice: Number(body.minPrice) || 0,
      qty: Math.max(1, Math.floor(Number(body.qty) || 1))
    }
  }
}
