import axios from 'axios'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { getDevicePollMs } from '../pollInterval'

export type SnapmakerConnectOpts = {
  connectionId: string
  host: string
  /** Existing Luban/API token; empty to request new (needs touchscreen confirm) */
  token?: string
}

export type SnapmakerLivePatch = {
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
  /** refreshed token for caller to persist */
  token?: string
  updatedAt: string
}

type Session = {
  host: string
  token: string
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function hostOnly(raw: string): string {
  return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim()
}

function apiBase(host: string): string {
  return `http://${host}:8080`
}

async function connectToken(
  host: string,
  token?: string
): Promise<{ ok: boolean; token?: string; message?: string }> {
  try {
    const body = token ? `token=${encodeURIComponent(token)}` : ''
    const { data, status } = await axios.post(`${apiBase(host)}/api/v1/connect`, body, {
      timeout: 12000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: () => true
    })
    if (status === 204) {
      return {
        ok: false,
        message: '请在打印机屏幕上确认连接授权，然后重试（或填入已授权 Token）'
      }
    }
    if (status === 401) {
      return { ok: false, message: 'Token 无效，请重新连接并在屏幕确认' }
    }
    if (status >= 400) {
      return { ok: false, message: `连接失败 HTTP ${status}` }
    }
    const t =
      (typeof data === 'object' && data && (data as { token?: string }).token) ||
      token ||
      ''
    if (!t) {
      // some FW returns token in body string
      const text = typeof data === 'string' ? data : JSON.stringify(data || {})
      const m = text.match(/[0-9a-fA-F-]{20,}/)
      if (m) return { ok: true, token: m[0] }
      return { ok: false, message: '未返回 Token，请在屏幕确认后重试' }
    }
    return { ok: true, token: String(t) }
  } catch (err) {
    return {
      ok: false,
      message: axios.isAxiosError(err) ? err.message : String(err)
    }
  }
}

async function fetchStatus(host: string, token: string): Promise<Record<string, unknown>> {
  const { data, status } = await axios.get(`${apiBase(host)}/api/v1/status`, {
    params: { token, _: Date.now() },
    timeout: 10000,
    validateStatus: () => true
  })
  if (status === 401 || status === 204) {
    throw new Error('未连接：请重新授权 Token')
  }
  if (status >= 400) throw new Error(`状态请求失败 HTTP ${status}`)
  if (typeof data === 'string' && data.toLowerCase().includes('not connected')) {
    throw new Error('未连接：请重新授权 Token')
  }
  return (typeof data === 'object' && data ? data : {}) as Record<string, unknown>
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function mapStatus(connectionId: string, raw: Record<string, unknown>): SnapmakerLivePatch {
  const tool = (raw.toolHead || raw.toolhead || raw.head || {}) as Record<string, unknown>
  const bed = (raw.heatedBed || raw.bed || {}) as Record<string, unknown>
  const progress =
    num(raw.progress) ??
    num(raw.printProgress) ??
    num((raw.job as Record<string, unknown> | undefined)?.progress) ??
    0
  const progressPct = progress <= 1 ? Math.round(progress * 1000) / 10 : progress

  const nozzle =
    num(tool.temperature) ??
    num(raw.nozzleTemperature) ??
    num((raw.temperature as Record<string, unknown> | undefined)?.t)
  const nozzleTarget =
    num(tool.targetTemperature) ??
    num(raw.nozzleTargetTemperature) ??
    num((raw.temperature as Record<string, unknown> | undefined)?.tTarget)
  const bedActual =
    num(bed.temperature) ??
    num(raw.bedTemperature) ??
    num((raw.temperature as Record<string, unknown> | undefined)?.b)
  const bedTarget =
    num(bed.targetTemperature) ??
    num(raw.bedTargetTemperature) ??
    num((raw.temperature as Record<string, unknown> | undefined)?.bTarget)

  const remain =
    num(raw.estimatedTime) ??
    num(raw.remainingTime) ??
    num((raw.job as Record<string, unknown> | undefined)?.remainingTime)

  return {
    connectionId,
    health: 'online',
    state: String(raw.status || raw.state || raw.workStatus || 'unknown'),
    progress: progressPct,
    remainingSeconds: remain != null ? Math.round(remain > 100000 ? remain / 1000 : remain) : undefined,
    layer: num(raw.currentLayer) ?? num(raw.layer),
    layerTotal: num(raw.totalLayer) ?? num(raw.layerCount),
    fanSpeed: num(raw.fanSpeed) ?? num(raw.fan),
    filename: String(raw.gcodeName || raw.fileName || raw.filename || '') || undefined,
    extruder: {
      actual: nozzle ?? 0,
      target: nozzleTarget ?? 0
    },
    bed: {
      actual: bedActual ?? 0,
      target: bedTarget ?? 0
    },
    updatedAt: new Date().toISOString()
  }
}

export async function snapmakerProbe(
  host: string,
  token?: string
): Promise<{ ok: boolean; message: string; token?: string }> {
  const h = hostOnly(host)
  if (!h) return { ok: false, message: '缺少 IP' }
  const c = await connectToken(h, token?.trim() || undefined)
  if (!c.ok || !c.token) return { ok: false, message: c.message || '连接失败' }
  try {
    await fetchStatus(h, c.token)
    return { ok: true, message: 'Snapmaker 局域网连接成功', token: c.token }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      token: c.token
    }
  }
}

export function createSnapmakerBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: SnapmakerLivePatch) => {
    getMainWindow()?.webContents.send('snapmaker:lan:status', patch)
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

  const poll = async (connectionId: string, s: Session): Promise<void> => {
    try {
      const raw = await fetchStatus(s.host, s.token)
      emit(mapStatus(connectionId, raw))
    } catch (err) {
      // try reconnect once
      const c = await connectToken(s.host, s.token)
      if (c.ok && c.token) {
        s.token = c.token
        try {
          const raw = await fetchStatus(s.host, s.token)
          emit({ ...mapStatus(connectionId, raw), token: s.token })
          return
        } catch {
          // fall through
        }
      }
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

  const connect = async (
    opts: SnapmakerConnectOpts
  ): Promise<{ ok: boolean; message?: string; token?: string }> => {
    await disconnect(opts.connectionId)
    const host = hostOnly(opts.host)
    if (!host) return { ok: false, message: '缺少主机地址' }

    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接 Snapmaker…',
      updatedAt: new Date().toISOString()
    })

    const probe = await snapmakerProbe(host, opts.token)
    if (!probe.ok || !probe.token) {
      emit({
        connectionId: opts.connectionId,
        health: 'error',
        state: 'error',
        progress: 0,
        message: probe.message,
        updatedAt: new Date().toISOString()
      })
      return { ok: false, message: probe.message }
    }

    const session: Session = { host, token: probe.token, timer: null }
    sessions.set(opts.connectionId, session)
    await poll(opts.connectionId, session)
    session.timer = setInterval(() => {
      void poll(opts.connectionId, session)
    }, getDevicePollMs())
    return { ok: true, message: probe.message, token: probe.token }
  }

  const control = async (connectionId: string, action: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')
    const pathMap: Record<string, string> = {
      pause: '/api/v1/pause',
      resume: '/api/v1/resume',
      cancel: '/api/v1/stop'
    }
    const path = pathMap[action]
    if (!path) throw new Error(`Snapmaker 暂不支持: ${action}`)
    const { status } = await axios.post(
      `${apiBase(s.host)}${path}`,
      `token=${encodeURIComponent(s.token)}`,
      {
        timeout: 10000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true
      }
    )
    if (status >= 400) throw new Error(`控制失败 HTTP ${status}`)
  }

  return { connect, disconnect, disconnectAll, control }
}
