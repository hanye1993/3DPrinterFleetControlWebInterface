import axios from 'axios'
import { createHash, randomBytes } from 'crypto'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { getDevicePollMs } from '../pollInterval'

const BASE = 'https://cloud-universe.anycubic.com'
const API_ROOT = `${BASE}/p/p/workbench/api`

const AC_AID = 'f9b3528877c94d5c9c5af32245db46ef'
const AC_SEC = '0cf75926606049a3937f56b0373b99fb'
const AC_VID_WEB = '1.0.0'
const AC_VID_SLICER = 'V3.0.0'

export type AnycubicAuthMode = 'web' | 'slicer'

export type AnycubicCloudDevice = {
  id: string
  name: string
  model?: string
  online: boolean
  key?: string
}

export type AnycubicLivePatch = {
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
  mode: AnycubicAuthMode
  printerId: string
  projectId?: number
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

function nonce(len = 32): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length]
  return out
}

function authHeaders(token: string | null, mode: AnycubicAuthMode): Record<string, string> {
  const version = mode === 'slicer' ? AC_VID_SLICER : AC_VID_WEB
  const deviceType = mode === 'slicer' ? 'pcf' : 'web'
  const isCn = '1'
  const n = nonce()
  const ts = String(Date.now())
  const sig = md5(`${AC_AID}${ts}${version}${AC_SEC}${n}${AC_AID}`)
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Xx-Device-Type': deviceType,
    'Xx-Is-Cn': isCn,
    'Xx-Nonce': n,
    'Xx-Signature': sig,
    'Xx-Timestamp': ts,
    'Xx-Version': version,
    'XX-LANGUAGE': 'CN',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  }
  if (token) h['XX-Token'] = token
  return h
}

async function apiGet(
  path: string,
  token: string,
  mode: AnycubicAuthMode,
  query?: Record<string, string>
): Promise<unknown> {
  const { data } = await axios.get(`${API_ROOT}${path}`, {
    headers: authHeaders(token, mode),
    params: query,
    timeout: 20000
  })
  return data
}

async function apiPost(
  path: string,
  token: string,
  mode: AnycubicAuthMode,
  body: unknown
): Promise<unknown> {
  const { data } = await axios.post(`${API_ROOT}${path}`, body, {
    headers: authHeaders(token, mode),
    timeout: 20000
  })
  return data
}

/** Exchange slicer OAuth access_token for XX-Token */
export async function anycubicExchangeSlicerToken(
  accessToken: string
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  try {
    const { data } = await axios.post(
      `${API_ROOT}/v3/public/loginWithAccessToken`,
      { device_type: 'pcf', access_token: accessToken.trim() },
      { headers: authHeaders(null, 'slicer'), timeout: 20000 }
    )
    const token =
      (data as { data?: { token?: string } })?.data?.token ||
      (data as { data?: { XX_Token?: string } })?.data?.XX_Token ||
      (data as { token?: string })?.token
    if (!token) {
      return { ok: false, message: (data as { msg?: string })?.msg || '无法换取 Token，请确认粘贴的是切片软件 access_token' }
    }
    return { ok: true, token: String(token) }
  } catch (err) {
    return {
      ok: false,
      message: axios.isAxiosError(err)
        ? String(err.response?.data?.msg || err.message)
        : String(err)
    }
  }
}

export async function anycubicValidateToken(
  token: string,
  mode: AnycubicAuthMode
): Promise<{ ok: boolean; message: string; email?: string; userId?: string }> {
  try {
    let t = token.trim()
    if (mode === 'slicer' && t.length < 80) {
      // likely access_token — exchange
      const ex = await anycubicExchangeSlicerToken(t)
      if (!ex.ok) return { ok: false, message: ex.message }
      t = ex.token
    }
    const data = (await apiGet('/user/profile/userInfo', t, mode === 'slicer' ? 'web' : mode)) as {
      code?: number
      msg?: string
      data?: { email?: string; id?: number | string; user_email?: string }
    }
    if (data.code != null && data.code !== 1 && data.code !== 200 && data.code !== 0) {
      return { ok: false, message: data.msg || `Token 无效 (code=${data.code})` }
    }
    const email = data.data?.email || data.data?.user_email
    const userId = data.data?.id != null ? String(data.data.id) : undefined
    return { ok: true, message: '登录成功', email, userId }
  } catch (err) {
    return {
      ok: false,
      message: axios.isAxiosError(err)
        ? String(err.response?.data?.msg || err.message)
        : String(err)
    }
  }
}

function mapDevice(raw: Record<string, unknown>): AnycubicCloudDevice {
  const id = String(raw.id ?? raw.printer_id ?? '')
  const name = String(raw.name || raw.device_name || raw.machine_name || id)
  const model = String(raw.machine_name || raw.model || raw.type || '')
  const deviceStatus = Number(raw.device_status ?? raw.status ?? 0)
  // device_status: 1 offline-ish / 2 online (varies); also check is_printing / available
  const online =
    deviceStatus === 2 ||
    raw.available === true ||
    Number(raw.is_printing) > 0 ||
    String(raw.device_status) === 'online'
  return { id, name, model: model || undefined, online, key: raw.key != null ? String(raw.key) : undefined }
}

export async function anycubicListDevices(
  token: string,
  mode: AnycubicAuthMode
): Promise<{ ok: boolean; devices: AnycubicCloudDevice[]; message?: string; resolvedToken?: string }> {
  try {
    let t = token.trim()
    let resolvedMode: AnycubicAuthMode = mode
    if (mode === 'slicer') {
      const ex = await anycubicExchangeSlicerToken(t)
      if (ex.ok) {
        t = ex.token
        resolvedMode = 'web'
      }
    }
    const data = (await apiGet('/work/printer/getPrinters', t, resolvedMode)) as {
      code?: number
      msg?: string
      data?: unknown
    }
    const list = Array.isArray(data.data)
      ? data.data
      : Array.isArray((data.data as { list?: unknown[] })?.list)
        ? (data.data as { list: unknown[] }).list
        : []
    const devices = (list as Record<string, unknown>[]).map(mapDevice).filter((d) => d.id)
    return { ok: true, devices, resolvedToken: t }
  } catch (err) {
    return {
      ok: false,
      devices: [],
      message: axios.isAxiosError(err)
        ? String(err.response?.data?.msg || err.message)
        : String(err)
    }
  }
}

function mapStatusPatch(
  connectionId: string,
  raw: Record<string, unknown>
): AnycubicLivePatch {
  const project = (raw.project || raw.latest_project || raw.task || {}) as Record<string, unknown>
  const temp = (raw.temp || raw.temperature || {}) as Record<string, unknown>
  const isPrinting = Number(raw.is_printing ?? 0)
  const deviceStatus = Number(raw.device_status ?? 0)
  let state = 'standby'
  if (deviceStatus === 1) state = 'offline'
  else if (isPrinting === 2 || String(project.state || '').includes('paus')) state = 'paused'
  else if (isPrinting === 1 || Number(raw.is_printing) === 1) state = 'printing'
  else if (project.state) state = String(project.state)

  const remainMin = project.remain_time != null ? Number(project.remain_time) : undefined

  return {
    connectionId,
    health: deviceStatus === 1 ? 'offline' : 'online',
    state,
    progress: Number(project.progress ?? raw.progress ?? 0) || 0,
    remainingSeconds:
      remainMin != null && Number.isFinite(remainMin) ? Math.round(remainMin * 60) : undefined,
    layer: project.curr_layer != null ? Number(project.curr_layer) : undefined,
    layerTotal: project.total_layers != null ? Number(project.total_layers) : undefined,
    fanSpeed: raw.fan_speed_pct != null ? Number(raw.fan_speed_pct) : undefined,
    filename: String(project.filename || project.name || '') || undefined,
    extruder: {
      actual: Number(temp.curr_nozzle_temp ?? temp.nozzle ?? 0),
      target: Number(temp.target_nozzle_temp ?? 0)
    },
    bed: {
      actual: Number(temp.curr_hotbed_temp ?? temp.bed ?? 0),
      target: Number(temp.target_hotbed_temp ?? 0)
    },
    updatedAt: new Date().toISOString()
  }
}

export function createAnycubicCloudBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: AnycubicLivePatch) => {
    getMainWindow()?.webContents.send('anycubic:cloud:status', patch)
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
      const data = (await apiGet('/work/printer/printersStatus', s.token, 'web')) as {
        data?: Record<string, unknown>[]
      }
      const list = Array.isArray(data.data) ? data.data : []
      const mine = list.find((x) => String(x.id) === s.printerId) || list[0]
      if (!mine) {
        emit({
          connectionId,
          health: 'warning',
          state: 'unknown',
          progress: 0,
          message: '云端未返回该设备状态',
          updatedAt: new Date().toISOString()
        })
        return
      }
      const proj = (mine.project || mine.latest_project) as Record<string, unknown> | undefined
      if (proj?.id != null) s.projectId = Number(proj.id)
      emit(mapStatusPatch(connectionId, mine))
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
    printerId: string
    mode?: AnycubicAuthMode
  }): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接纵维云…',
      updatedAt: new Date().toISOString()
    })

    let token = opts.token.trim()
    const mode = opts.mode || 'web'
    if (mode === 'slicer') {
      const ex = await anycubicExchangeSlicerToken(token)
      if (!ex.ok) {
        emit({
          connectionId: opts.connectionId,
          health: 'error',
          state: 'error',
          progress: 0,
          message: ex.message,
          updatedAt: new Date().toISOString()
        })
        return { ok: false, message: ex.message }
      }
      token = ex.token
    }

    const session: Session = {
      token,
      mode: 'web',
      printerId: opts.printerId,
      timer: null
    }
    sessions.set(opts.connectionId, session)
    await pollOnce(opts.connectionId, session)
    session.timer = setInterval(() => {
      void pollOnce(opts.connectionId, session)
    }, Math.max(getDevicePollMs(), 8000))
    return { ok: true }
  }

  const control = async (
    connectionId: string,
    action: string
  ): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')
    const orderMap: Record<string, number> = { pause: 2, resume: 3, cancel: 4 }
    const orderId = orderMap[action]
    if (!orderId) throw new Error(`纵维云暂不支持: ${action}`)

    let projectId = s.projectId
    if (projectId == null) {
      await pollOnce(connectionId, s)
      projectId = s.projectId
    }
    if (projectId == null) throw new Error('当前无打印任务，无法控制')

    const body = {
      order_id: orderId,
      printer_id: Number(s.printerId),
      project_id: projectId,
      data: {},
      ams_info: null,
      settings: null
    }
    const resp = (await apiPost('/work/operation/sendOrder', s.token, 'web', body)) as {
      code?: number
      msg?: string
    }
    if (resp.code != null && resp.code !== 1 && resp.code !== 200 && resp.code !== 0) {
      throw new Error(resp.msg || `控制失败 code=${resp.code}`)
    }
  }

  return { connect, disconnect, disconnectAll, control }
}
