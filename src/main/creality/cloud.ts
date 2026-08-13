import axios from 'axios'
import { randomUUID } from 'crypto'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { getDevicePollMs } from '../pollInterval'

export type CrealityCloudRegion = 'china' | 'global'

export type CrealityCloudDevice = {
  id: string
  name: string
  model?: string
  online: boolean
  /** LAN IP if cloud returns one — can fall back to local WS */
  host?: string
}

export type CrealityLivePatch = {
  connectionId: string
  health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
  state: string
  progress: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: { actual: number; target: number }
  bed?: { actual: number; target: number }
  fanSpeed?: number
  printSpeed?: number
  filename?: string
  message?: string
  updatedAt: string
}

type Session = {
  token: string
  userId: string
  region: CrealityCloudRegion
  deviceId: string
  host?: string
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function cloudBase(region: CrealityCloudRegion): string {
  // model-admin.crealitygroup.com cert expired; official web app uses api.crealitycloud.*
  return region === 'china' ? 'https://api.crealitycloud.cn' : 'https://api.crealitycloud.com'
}

function webBase(region: CrealityCloudRegion): string {
  return region === 'china' ? 'https://www.crealitycloud.cn' : 'https://www.crealitycloud.com'
}

function headers(token: string, userId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json; charset=UTF-8',
    __CXY_APP_ID_: 'creality_model',
    __CXY_OS_LANG_: '0',
    __CXY_DUID_: randomUUID().replace(/-/g, ''),
    __CXY_OS_VER_: 'Windows',
    __CXY_PLATFORM_: '14',
    __CXY_REQUESTID_: randomUUID(),
    __CXY_UID_: userId,
    __CXY_TOKEN_: token
  }
}

async function postJson(
  region: CrealityCloudRegion,
  path: string,
  token: string,
  userId: string,
  body: unknown = {}
): Promise<Record<string, unknown>> {
  const { data } = await axios.post(`${cloudBase(region)}${path}`, body, {
    headers: headers(token, userId),
    timeout: 20000
  })
  return data as Record<string, unknown>
}

/** User-bound printers (Creality Print deviceMgr). NOT /device/deviceList (that is model catalog). */
const DEVICE_LIST_PATHS = [
  '/api/rest/print/cluster/devices/getDevices',
  '/api/cxy/v2/device/user/deviceList',
  '/api/cxy/v2/device/list'
]

function flattenDevices(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  const candidates = [p.result, p.data, p]
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Record<string, unknown>[]
    if (c && typeof c === 'object') {
      const o = c as Record<string, unknown>
      for (const key of ['list', 'deviceList', 'devices', 'printerList', 'rows']) {
        if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[]
      }
    }
  }
  return []
}

/** Catalog rows (HALOT-X1 / K2 SE …) and ephemeral getToken ghosts must not appear as printers. */
function isBoundPrinter(raw: Record<string, unknown>): boolean {
  if (Array.isArray(raw.deviceMethod) || Array.isArray(raw.deviceItems)) return false
  if (raw.thumbnail && !raw.tbId && !raw.macAddress && !raw.deviceName) return false
  const tbId = String(raw.tbId || '').trim()
  const mac = String(raw.macAddress || raw.mac || '').trim()
  const numericId = Number(raw.deviceId)
  const state = Number(raw.deviceState)
  if (state === -2) return false
  if (tbId) return true
  if (mac && Number.isFinite(numericId) && numericId > 0) return true
  if (Number.isFinite(numericId) && numericId > 0 && (raw.model || raw.deviceType)) return true
  return false
}

function mapDevice(raw: Record<string, unknown>): CrealityCloudDevice {
  const numericId = Number(raw.deviceId)
  const id = String(
    (Number.isFinite(numericId) && numericId > 0 ? numericId : '') ||
      raw.tbId ||
      raw.id ||
      raw.printerId ||
      raw.iotId ||
      raw.device_id ||
      raw.deviceName ||
      ''
  )
  const deviceType =
    raw.deviceType && typeof raw.deviceType === 'object'
      ? (raw.deviceType as Record<string, unknown>)
      : null
  const name = String(
    raw.aliasName || raw.deviceName || raw.name || raw.nickname || raw.nickName || raw.modelName || id
  )
  const model = String(
    deviceType?.name || raw.modelName || raw.model || raw.printerType || deviceType?.internalName || ''
  )
  const host =
    String(raw.ip || raw.wanip || raw.localIp || raw.deviceIp || raw.netIP || '').trim() || undefined
  const online =
    raw.online === true ||
    raw.isOnline === true ||
    Number(raw.onlineStatus) === 1 ||
    Number(raw.deviceState) === 1 ||
    String(raw.state) === 'online' ||
    Number(raw.status) === 1
  return { id, name, model: model || undefined, online, host }
}

export async function crealityFetchDevices(
  region: CrealityCloudRegion,
  token: string,
  userId: string
): Promise<{ ok: boolean; devices: CrealityCloudDevice[]; message?: string }> {
  const errors: string[] = []
  for (const path of DEVICE_LIST_PATHS) {
    try {
      const body = path.includes('getDevices') ? { page: 1, pageSize: 100 } : {}
      const data = await postJson(region, path, token, userId, body)
      const code = Number(data.code)
      // getDevices may omit code; treat missing code + result.list as success
      const hasResultList =
        data.result &&
        typeof data.result === 'object' &&
        Array.isArray((data.result as Record<string, unknown>).list)
      if (!Number.isNaN(code) && code !== 0 && code !== 200 && !hasResultList) {
        errors.push(`${path}: ${String(data.msg || data.message || code)}`)
        continue
      }
      const devices = flattenDevices(data)
        .filter(isBoundPrinter)
        .map(mapDevice)
        .filter((d) => d.id)
      // Prefer real printer endpoint; skip catalog-style empty/false positives
      if (path.includes('getDevices') || devices.length) {
        return {
          ok: true,
          devices,
          message: devices.length ? undefined : '账号下暂无绑定设备'
        }
      }
      if (code === 0 || code === 200) {
        // Successful but not printer-shaped (e.g. old catalog API) — try next path
        continue
      }
    } catch (err) {
      errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    ok: false,
    devices: [],
    message: errors.slice(0, 3).join('；') || '无法获取设备列表，请确认 Token 有效'
  }
}

/**
 * Desktop Electron SSO window removed — paste Creality cloud token in device settings instead.
 */
export function crealityOpenLoginWindow(
  _region: CrealityCloudRegion
): Promise<{ ok: true; token: string; userId: string } | { ok: false; message: string }> {
  return Promise.resolve({
    ok: false,
    message: '网页版不支持弹窗登录创想云，请在设备设置中粘贴 Token'
  })
}

function mapCloudStatus(connectionId: string, raw: Record<string, unknown>): CrealityLivePatch {
  const progress = Number(raw.printProgress ?? raw.progress ?? raw.print_progress ?? 0)
  const left = Number(raw.printLeftTime ?? raw.leftTime ?? raw.remain_time ?? 0)
  return {
    connectionId,
    health: 'online',
    state: String(raw.state || raw.printState || raw.status || 'online'),
    progress: progress <= 1 ? Math.round(progress * 100) : progress,
    remainingSeconds: left > 0 ? (left > 100000 ? left : left * 60) : undefined,
    layer: (() => {
      const n = Number(raw.layer ?? raw.CurrentLayer ?? raw.currentLayer)
      return Number.isFinite(n) && n > 0 ? n : undefined
    })(),
    layerTotal: (() => {
      const n = Number(raw.TotalLayer ?? raw.totalLayer ?? raw.TotalLayers ?? raw.layerCount)
      if (Number.isFinite(n) && n > 0) return n
      const layer = Number(raw.layer ?? raw.CurrentLayer ?? 0)
      const prog = progress <= 1 ? progress * 100 : progress
      if (layer > 0 && prog >= 1) {
        const est = Math.round(layer / (prog / 100))
        return est >= layer ? est : undefined
      }
      return undefined
    })(),
    fanSpeed: raw.fan != null ? Number(raw.fan) : undefined,
    filename: String(raw.printName || raw.filename || raw.gcodeName || '') || undefined,
    extruder: {
      actual: Number(raw.nozzleTemp ?? raw.nozzle_temp ?? 0),
      target: Number(raw.targetNozzleTemp ?? raw.target_nozzle_temp ?? 0)
    },
    bed: {
      actual: Number(raw.bedTemp ?? raw.bed_temp ?? 0),
      target: Number(raw.targetBedTemp ?? raw.target_bed_temp ?? 0)
    },
    updatedAt: new Date().toISOString()
  }
}

export function createCrealityCloudBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: CrealityLivePatch) => {
    getMainWindow()?.webContents.send('creality:cloud:status', patch)
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    if (s.timer) clearInterval(s.timer)
    sessions.delete(connectionId)
    emit({
      connectionId,
      health: 'offline',
      state: 'offline',
      progress: 0,
      updatedAt: new Date().toISOString()
    })
  }

  const disconnectAll = async (): Promise<void> => {
    for (const id of Array.from(sessions.keys())) await disconnect(id)
  }

  const pollOnce = async (connectionId: string, s: Session): Promise<void> => {
    try {
      const list = await crealityFetchDevices(s.region, s.token, s.userId)
      const mine = list.devices.find((d) => d.id === s.deviceId)
      if (!mine) {
        emit({
          connectionId,
          health: 'warning',
          state: 'unknown',
          progress: 0,
          message: '云端设备列表中未找到该机',
          updatedAt: new Date().toISOString()
        })
        return
      }
      if (mine.host) s.host = mine.host
      emit({
        connectionId,
        health: mine.online ? 'online' : 'offline',
        state: mine.online ? 'online' : 'offline',
        progress: 0,
        message: mine.host ? `云端在线 · LAN ${mine.host}` : mine.online ? '云端在线' : '云端离线',
        filename: mine.name,
        updatedAt: new Date().toISOString()
      })

      // If LAN IP known, enrich via native :9999 briefly is out of scope here;
      // try a few status endpoints
      for (const path of [
        `/api/cxy/v2/device/deviceInfo`,
        `/api/cxy/device/getDeviceInfo`,
        `/api/cxy/v2/printer/status`
      ]) {
        try {
          const data = await postJson(s.region, path, s.token, s.userId, {
            deviceId: s.deviceId,
            id: s.deviceId
          })
          const code = Number(data.code)
          if (code !== 0 && code !== 200) continue
          const detail =
            (data.result as Record<string, unknown>) ||
            (data.data as Record<string, unknown>) ||
            data
          if (detail && typeof detail === 'object') {
            emit(mapCloudStatus(connectionId, detail as Record<string, unknown>))
            return
          }
        } catch {
          // try next
        }
      }
    } catch (err) {
      emit({
        connectionId,
        health: 'warning',
        state: 'warning',
        progress: 0,
        message: err instanceof Error ? err.message : String(err),
        updatedAt: new Date().toISOString()
      })
    }
  }

  const connect = async (opts: {
    connectionId: string
    token: string
    userId: string
    deviceId: string
    region?: CrealityCloudRegion
    host?: string
  }): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const region = opts.region || 'china'
    const session: Session = {
      token: opts.token,
      userId: opts.userId || '0',
      region,
      deviceId: opts.deviceId,
      host: opts.host,
      timer: null
    }
    sessions.set(opts.connectionId, session)
    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接创想云…',
      updatedAt: new Date().toISOString()
    })
    await pollOnce(opts.connectionId, session)
    session.timer = setInterval(() => {
      void pollOnce(opts.connectionId, session)
    }, Math.max(getDevicePollMs(), 10000))
    return { ok: true }
  }

  const control = async (_connectionId: string, _action: string): Promise<void> => {
    throw new Error('创想云远程控制因机型协议差异，建议改用局域网模式操作')
  }

  return { connect, disconnect, disconnectAll, control, webBase }
}
