import axios from 'axios'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { getDevicePollMs } from '../pollInterval'

export type FlashforgeConnectOpts = {
  connectionId: string
  host: string
  serial: string
  checkCode: string
}

export type FlashforgeLivePatch = {
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
  host: string
  serial: string
  checkCode: string
  timer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function hostOnly(raw: string): string {
  return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim()
}

function apiBase(host: string): string {
  return `http://${host}:8898`
}

async function postDetail(host: string, serial: string, checkCode: string): Promise<Record<string, unknown>> {
  const { data } = await axios.post(
    `${apiBase(host)}/detail`,
    { serialNumber: serial, checkCode },
    { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
  )
  return data as Record<string, unknown>
}

async function postControl(
  host: string,
  serial: string,
  checkCode: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { data } = await axios.post(
    `${apiBase(host)}/control`,
    { serialNumber: serial, checkCode, payload },
    { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
  )
  const code = Number((data as { code?: number }).code)
  if (code !== 0 && code !== 200) {
    throw new Error(String((data as { message?: string }).message || `控制失败 code=${code}`))
  }
}

function mapDetail(connectionId: string, detail: Record<string, unknown>): FlashforgeLivePatch {
  const progressRaw = Number(detail.printProgress ?? 0)
  const progress = progressRaw <= 1 ? Math.round(progressRaw * 1000) / 10 : progressRaw
  const est = Number(detail.estimatedTime ?? 0)
  // estimatedTime often minutes remaining
  const remainingSeconds = est > 0 ? Math.round(est > 10000 ? est : est * 60) : undefined
  const fan = Number(detail.coolingFanSpeed ?? detail.chamberFanSpeed ?? 0)
  const fanPct = fan > 100 ? Math.round((fan / 255) * 100) : fan

  return {
    connectionId,
    health: 'online',
    state: String(detail.status || 'unknown'),
    progress,
    remainingSeconds,
    layer: detail.printLayer != null ? Number(detail.printLayer) : undefined,
    layerTotal: detail.targetPrintLayer != null ? Number(detail.targetPrintLayer) : undefined,
    fanSpeed: Number.isFinite(fanPct) ? fanPct : undefined,
    printSpeed:
      detail.printSpeedAdjust != null
        ? Math.round(Number(detail.printSpeedAdjust))
        : detail.currentPrintSpeed != null
          ? Math.round(Number(detail.currentPrintSpeed))
          : undefined,
    filename: String(detail.printFileName || '').replace(/^\/data\//, '') || undefined,
    extruder: {
      actual: Number(detail.rightTemp ?? detail.leftTemp ?? 0),
      target: Number(detail.rightTargetTemp ?? detail.leftTargetTemp ?? 0)
    },
    bed: {
      actual: Number(detail.platTemp ?? 0),
      target: Number(detail.platTargetTemp ?? 0)
    },
    updatedAt: new Date().toISOString()
  }
}

export async function flashforgeProbe(
  host: string,
  serial: string,
  checkCode: string
): Promise<{ ok: boolean; message: string; name?: string }> {
  try {
    const h = hostOnly(host)
    const data = await postDetail(h, serial.trim(), checkCode.trim())
    const code = Number(data.code)
    if (code !== 0 && code !== 200) {
      return { ok: false, message: String(data.message || `校验失败 code=${code}`) }
    }
    const detail = (data.detail || {}) as Record<string, unknown>
    return {
      ok: true,
      message: '闪铸局域网连接成功',
      name: String(detail.name || '')
    }
  } catch (err) {
    return {
      ok: false,
      message: axios.isAxiosError(err)
        ? String(err.response?.data?.message || err.message)
        : String(err)
    }
  }
}

export function createFlashforgeBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: FlashforgeLivePatch) => {
    getMainWindow()?.webContents.send('flashforge:lan:status', patch)
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
      const data = await postDetail(s.host, s.serial, s.checkCode)
      const code = Number(data.code)
      if (code !== 0 && code !== 200) {
        emit({
          connectionId,
          health: 'warning',
          state: 'warning',
          progress: 0,
          message: String(data.message || `状态错误 code=${code}`),
          updatedAt: new Date().toISOString()
        })
        return
      }
      const detail = (data.detail || {}) as Record<string, unknown>
      emit(mapDetail(connectionId, detail))
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

  const connect = async (
    opts: FlashforgeConnectOpts
  ): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const host = hostOnly(opts.host)
    if (!host || !opts.serial || !opts.checkCode) {
      return { ok: false, message: '需要 IP、序列号与 CheckCode' }
    }

    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接闪铸局域网…',
      updatedAt: new Date().toISOString()
    })

    const probe = await flashforgeProbe(host, opts.serial, opts.checkCode)
    if (!probe.ok) {
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

    const session: Session = {
      host,
      serial: opts.serial.trim(),
      checkCode: opts.checkCode.trim(),
      timer: null
    }
    sessions.set(opts.connectionId, session)
    await poll(opts.connectionId, session)
    session.timer = setInterval(() => {
      void poll(opts.connectionId, session)
    }, getDevicePollMs())
    return { ok: true, message: probe.message }
  }

  const control = async (connectionId: string, action: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')
    const map: Record<string, string> = {
      pause: 'pause',
      resume: 'continue',
      cancel: 'cancel'
    }
    const ffAction = map[action]
    if (!ffAction) throw new Error(`闪铸暂不支持: ${action}`)
    await postControl(s.host, s.serial, s.checkCode, {
      cmd: 'jobCtl_cmd',
      args: { jobID: '0', action: ffAction }
    })
  }

  return { connect, disconnect, disconnectAll, control }
}
