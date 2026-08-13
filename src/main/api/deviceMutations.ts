import { randomUUID } from 'crypto'
import { readJsonArray, writeJsonArray } from '../storage/jsonBridge'
import { normalizeSsoSettings, publicSsoSettings } from '../../shared/sso'
import { normalizeAiVisionSettings, publicAiVision } from '../../shared/aiVision'
import { normalizeAlertNotifySettings, publicAlertNotify } from '../../shared/alertNotify'

const BRANDS = new Set([
  'klipper',
  'bambu',
  'creality',
  'elegoo',
  'anycubic',
  'snapmaker',
  'flashforge',
  'qidi'
])

/** Built-in or plugin brand ids: lowercase letter + [a-z0-9_] */
export function isAllowedDeviceBrand(brand: string): boolean {
  const b = String(brand || '')
    .trim()
    .toLowerCase()
  if (!b) return false
  if (BRANDS.has(b)) return true
  return /^[a-z][a-z0-9_]{0,63}$/.test(b)
}

const RESERVED_DEVICE_KEYS = new Set([
  'id',
  'name',
  'brand',
  'tech',
  'group',
  'tags',
  'connectionMode',
  'baseUrl',
  'secretKey',
  'secret',
  'accessCode',
  'apiKey',
  'bambuDeviceId',
  'bambuHost',
  'bambuRegion',
  'bambuUserId',
  'anycubicPrinterId',
  'anycubicAuthMode',
  'crealityUserId',
  'crealityDeviceId',
  'crealityRegion',
  'flashforgeSerial',
  'aiVisionEnabled',
  'model',
  'createdAt',
  'pluginData',
  'clearSecret'
])

function mergePluginExtras(device: DeviceRow, body: Record<string, unknown>): void {
  if (body.pluginData != null && typeof body.pluginData === 'object' && !Array.isArray(body.pluginData)) {
    device.pluginData = body.pluginData as Record<string, unknown>
  }
  for (const [k, v] of Object.entries(body)) {
    if (RESERVED_DEVICE_KEYS.has(k)) continue
    if (!(k.startsWith('x_') || k.startsWith('plugin_'))) continue
    if (v === undefined) continue
    device[k] = v
  }
}

export type DeviceRow = {
  id: string
  name: string
  brand: string
  tech?: string
  group?: string
  tags?: string[]
  connectionMode?: string
  baseUrl?: string
  secretKey?: string
  bambuDeviceId?: string
  bambuHost?: string
  bambuRegion?: string
  bambuUserId?: string
  anycubicPrinterId?: string
  anycubicAuthMode?: string
  crealityUserId?: string
  crealityDeviceId?: string
  crealityRegion?: string
  flashforgeSerial?: string
  /** false = skip AI vision; omit/true = include when global AI is on */
  aiVisionEnabled?: boolean
  createdAt?: string
  [key: string]: unknown
}

function readDevices(path: string): DeviceRow[] {
  return readJsonArray(path) as DeviceRow[]
}

function writeDevices(path: string, devices: DeviceRow[]): void {
  writeJsonArray(path, devices)
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s || undefined
}

export function createDeviceFromBody(
  body: Record<string, unknown>
): { device: DeviceRow; secret?: string } | { error: string } {
  const name = str(body.name)
  const brand = str(body.brand)?.toLowerCase()
  if (!name) return { error: 'name is required' }
  if (!brand || !isAllowedDeviceBrand(brand)) {
    return { error: 'brand 无效（内置品牌或插件自定义：小写字母开头，仅 a-z0-9_）' }
  }
  const tech = body.tech === 'resin' ? 'resin' : 'fdm'
  const connectionMode = body.connectionMode === 'cloud' ? 'cloud' : 'lan'
  const secret = str(body.secret) || str(body.accessCode) || str(body.apiKey)
  const id = str(body.id) || randomUUID()
  const secretKey = secret ? `dev-${id}` : str(body.secretKey)

  const device: DeviceRow = {
    id,
    name,
    brand,
    tech,
    connectionMode,
    createdAt: new Date().toISOString(),
    group: str(body.group),
    tags: Array.isArray(body.tags) ? body.tags.map((t) => String(t)).filter(Boolean) : undefined,
    model: str(body.model),
    baseUrl: str(body.baseUrl),
    secretKey,
    bambuDeviceId: str(body.bambuDeviceId),
    bambuHost: str(body.bambuHost),
    bambuRegion: body.bambuRegion === 'global' ? 'global' : body.bambuRegion === 'china' ? 'china' : undefined,
    bambuUserId: str(body.bambuUserId),
    anycubicPrinterId: str(body.anycubicPrinterId),
    anycubicAuthMode:
      body.anycubicAuthMode === 'slicer' || body.anycubicAuthMode === 'web'
        ? String(body.anycubicAuthMode)
        : undefined,
    crealityUserId: str(body.crealityUserId),
    crealityDeviceId: str(body.crealityDeviceId),
    crealityRegion:
      body.crealityRegion === 'global' || body.crealityRegion === 'china'
        ? String(body.crealityRegion)
        : undefined,
    flashforgeSerial: str(body.flashforgeSerial),
    aiVisionEnabled:
      body.aiVisionEnabled === false ? false : body.aiVisionEnabled === true ? true : undefined
  }
  mergePluginExtras(device, body)

  const builtin = BRANDS.has(brand)
  if (builtin && brand === 'bambu' && connectionMode === 'lan' && !device.bambuHost && !device.baseUrl) {
    return { error: 'bambu LAN device requires bambuHost' }
  }
  if (
    builtin &&
    (brand === 'klipper' || brand === 'qidi' || (brand === 'creality' && connectionMode === 'lan')) &&
    !device.baseUrl
  ) {
    return { error: 'Moonraker-style device requires baseUrl' }
  }

  return { device, secret: secret || undefined }
}

export function mergeDeviceFromBody(
  prev: DeviceRow,
  body: Record<string, unknown>
): { device: DeviceRow; secret?: string; clearSecret?: boolean } | { error: string } {
  const name = body.name != null ? str(body.name) : prev.name
  if (!name) return { error: 'name is required' }
  let brand = prev.brand
  if (body.brand != null) {
    const b = str(body.brand)?.toLowerCase()
    if (!b || !isAllowedDeviceBrand(b)) {
      return { error: 'brand 无效（内置品牌或插件自定义：小写字母开头，仅 a-z0-9_）' }
    }
    brand = b
  }
  const tech =
    body.tech != null ? (body.tech === 'resin' ? 'resin' : 'fdm') : prev.tech === 'resin' ? 'resin' : 'fdm'
  const connectionMode =
    body.connectionMode != null
      ? body.connectionMode === 'cloud'
        ? 'cloud'
        : 'lan'
      : prev.connectionMode === 'cloud'
        ? 'cloud'
        : 'lan'

  const secret = str(body.secret) || str(body.accessCode) || str(body.apiKey)
  const clearSecret = body.secret === null || body.clearSecret === true
  let secretKey = prev.secretKey
  if (secret) secretKey = secretKey || `dev-${prev.id}`
  if (clearSecret) secretKey = undefined

  const pick = (key: string, fromBody: unknown, fallback: unknown): string | undefined => {
    if (fromBody === null) return undefined
    if (fromBody !== undefined) return str(fromBody)
    return fallback != null ? str(fallback) : undefined
  }

  const device: DeviceRow = {
    ...prev,
    id: prev.id,
    name,
    brand,
    tech,
    connectionMode,
    createdAt: prev.createdAt || new Date().toISOString(),
    group: pick('group', body.group, prev.group),
    tags:
      body.tags === null
        ? undefined
        : Array.isArray(body.tags)
          ? body.tags.map((t) => String(t)).filter(Boolean)
          : prev.tags,
    model: pick('model', body.model, prev.model),
    baseUrl: pick('baseUrl', body.baseUrl, prev.baseUrl),
    secretKey,
    bambuDeviceId: pick('bambuDeviceId', body.bambuDeviceId, prev.bambuDeviceId),
    bambuHost: pick('bambuHost', body.bambuHost, prev.bambuHost),
    bambuRegion:
      body.bambuRegion === null
        ? undefined
        : body.bambuRegion === 'global' || body.bambuRegion === 'china'
          ? String(body.bambuRegion)
          : prev.bambuRegion,
    bambuUserId: pick('bambuUserId', body.bambuUserId, prev.bambuUserId),
    anycubicPrinterId: pick('anycubicPrinterId', body.anycubicPrinterId, prev.anycubicPrinterId),
    anycubicAuthMode:
      body.anycubicAuthMode === null
        ? undefined
        : body.anycubicAuthMode === 'slicer' || body.anycubicAuthMode === 'web'
          ? String(body.anycubicAuthMode)
          : prev.anycubicAuthMode,
    crealityUserId: pick('crealityUserId', body.crealityUserId, prev.crealityUserId),
    crealityDeviceId: pick('crealityDeviceId', body.crealityDeviceId, prev.crealityDeviceId),
    crealityRegion:
      body.crealityRegion === null
        ? undefined
        : body.crealityRegion === 'global' || body.crealityRegion === 'china'
          ? String(body.crealityRegion)
          : prev.crealityRegion,
    flashforgeSerial: pick('flashforgeSerial', body.flashforgeSerial, prev.flashforgeSerial),
    aiVisionEnabled:
      body.aiVisionEnabled === false
        ? false
        : body.aiVisionEnabled === true
          ? true
          : body.aiVisionEnabled === null
            ? undefined
            : prev.aiVisionEnabled === false
              ? false
              : prev.aiVisionEnabled === true
                ? true
                : undefined
  }
  mergePluginExtras(device, body)

  return {
    device,
    secret: secret || undefined,
    clearSecret: clearSecret || undefined
  }
}

export function addDevice(
  path: string,
  body: Record<string, unknown>
): { device: DeviceRow; secret?: string } | { error: string } {
  const created = createDeviceFromBody(body)
  if ('error' in created) return created
  const devices = readDevices(path)
  if (devices.some((d) => d.id === created.device.id)) {
    return { error: 'Device id already exists' }
  }
  devices.push(created.device)
  writeDevices(path, devices)
  return created
}

export function updateDevice(
  path: string,
  id: string,
  body: Record<string, unknown>
): { device: DeviceRow; secret?: string; clearSecret?: boolean; prevSecretKey?: string } | { error: string } {
  const devices = readDevices(path)
  const idx = devices.findIndex((d) => d.id === id)
  if (idx < 0) return { error: 'Device not found' }
  const prev = devices[idx]
  const merged = mergeDeviceFromBody(prev, body)
  if ('error' in merged) return merged
  devices[idx] = merged.device
  writeDevices(path, devices)
  return { ...merged, prevSecretKey: prev.secretKey }
}

export function removeDevice(
  path: string,
  id: string
): { removed: DeviceRow } | { error: string } {
  const devices = readDevices(path)
  const idx = devices.findIndex((d) => d.id === id)
  if (idx < 0) return { error: 'Device not found' }
  const [removed] = devices.splice(idx, 1)
  writeDevices(path, devices)
  return { removed }
}

export function maskApiKey(key: string | undefined): string {
  const k = String(key || '')
  if (!k) return ''
  if (k.length <= 8) return '****'
  return `${k.slice(0, 4)}…${k.slice(-4)}`
}

export function publicSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const apiKey = typeof settings.apiKey === 'string' ? settings.apiKey : ''
  const {
    frpcToken: _t,
    hskApiKey: _h,
    apiKey: _k,
    uiBgImage: _img,
    sso: rawSso,
    aiVision: rawAi,
    alertNotify: rawAlert,
    ...rest
  } = settings
  return {
    ...rest,
    apiKeySet: !!apiKey,
    apiKeyMasked: maskApiKey(apiKey),
    frpcTokenSet: !!(typeof settings.frpcToken === 'string' && settings.frpcToken),
    hskApiKeySet: !!(typeof settings.hskApiKey === 'string' && settings.hskApiKey),
    sso: publicSsoSettings(normalizeSsoSettings(rawSso)),
    aiVision: publicAiVision(normalizeAiVisionSettings(rawAi)),
    alertNotify: publicAlertNotify(normalizeAlertNotifySettings(rawAlert))
  }
}

/** Fields allowed via PATCH /api/v1/settings */
export const SETTINGS_PATCH_KEYS = [
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
