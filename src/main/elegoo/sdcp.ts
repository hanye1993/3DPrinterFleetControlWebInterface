import { randomUUID } from 'crypto'
import WebSocket from 'ws'
import type { BridgeWindow } from '../../shared/bridgeWindow'

export type ElegooSdcpConnectOpts = {
  connectionId: string
  host: string
}

export type ElegooLivePatch = {
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
  chamberFanSpeed?: number
  boardTemp?: number
  chamberTemp?: number
  printSpeed?: number
  filename?: string
  message?: string
  updatedAt: string
}

type Session = {
  socket: WebSocket
  host: string
  mainboardId: string
  heartbeat: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

const PRINT_STATUS: Record<number, string> = {
  0: 'standby',
  1: 'homing',
  5: 'pausing',
  6: 'paused',
  7: 'stopping',
  8: 'stopped',
  9: 'complete',
  10: 'file_checking',
  11: 'printer_checking',
  12: 'resuming',
  13: 'printing',
  14: 'error',
  15: 'auto_leveling',
  16: 'preheating',
  17: 'resonance_testing',
  18: 'print_start',
  20: 'preheating_completed'
}

function hostOnly(raw: string): string {
  return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim()
}

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  if (Array.isArray(v) && v.length >= 2) {
    const n = Number(v[1])
    return Number.isFinite(n) ? n : undefined
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function targetNum(v: unknown, explicit?: unknown): number {
  if (explicit != null) {
    const n = Number(explicit)
    if (Number.isFinite(n)) return n
  }
  if (Array.isArray(v) && v.length >= 1) {
    const n = Number(v[0])
    if (Number.isFinite(n)) return n
  }
  return 0
}

function makeCmd(cmd: number, data: Record<string, unknown> = {}, mainboardId = ''): string {
  const requestId = randomUUID().replace(/-/g, '')
  return JSON.stringify({
    Id: requestId,
    Data: {
      Cmd: cmd,
      Data: data,
      RequestID: requestId,
      MainboardID: mainboardId,
      TimeStamp: Date.now(),
      From: 1
    }
  })
}

function extractStatus(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (raw.Status && typeof raw.Status === 'object') return raw.Status as Record<string, unknown>
  const data = raw.Data
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (d.Status && typeof d.Status === 'object') return d.Status as Record<string, unknown>
  }
  return null
}

function mapStatus(connectionId: string, status: Record<string, unknown>): ElegooLivePatch {
  const printInfo = (status.PrintInfo || {}) as Record<string, unknown>
  const fan = (status.CurrentFanSpeed || {}) as Record<string, unknown>
  const code = num(printInfo.Status)
  const state = code != null ? PRINT_STATUS[code] || `status_${code}` : 'unknown'
  const currentTicks = num(printInfo.CurrentTicks) ?? 0
  const totalTicks = num(printInfo.TotalTicks) ?? 0
  const remaining =
    totalTicks > currentTicks ? Math.round(totalTicks - currentTicks) : undefined

  const nozzleRaw = status.TempOfNozzle
  const bedRaw = status.TempOfHotbed

  return {
    connectionId,
    health: 'online',
    state,
    progress: num(printInfo.Progress) ?? 0,
    remainingSeconds: remaining,
    layer: num(printInfo.CurrentLayer),
    layerTotal: num(printInfo.TotalLayer),
    fanSpeed: num(fan.ModelFan),
    chamberFanSpeed:
      num(fan.BoxFan) ?? num(fan.ChamberFan) ?? num(fan.AuxiliaryFan) ?? undefined,
    boardTemp: num(status.TempOfBoard) ?? num(status.TempOfMainboard) ?? 0,
    chamberTemp: num(status.TempOfBox) ?? num(status.TempOfChamber) ?? 0,
    printSpeed: num(printInfo.PrintSpeedPct),
    filename: String(printInfo.Filename || '') || undefined,
    extruder: {
      actual: num(nozzleRaw) ?? 0,
      target: targetNum(nozzleRaw, status.TempTargetNozzle)
    },
    bed: {
      actual: num(bedRaw) ?? 0,
      target: targetNum(bedRaw, status.TempTargetHotbed)
    },
    updatedAt: new Date().toISOString()
  }
}

function candidateUrls(host: string): string[] {
  return [`ws://${host}:3030/websocket`, `ws://${host}/websocket`]
}

export function createElegooSdcpBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: ElegooLivePatch) => {
    getMainWindow()?.webContents.send('elegoo:sdcp:status', patch)
  }

  const clearHeartbeat = (s: Session) => {
    if (s.heartbeat) {
      clearInterval(s.heartbeat)
      s.heartbeat = null
    }
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    sessions.delete(connectionId)
    clearHeartbeat(s)
    try {
      s.socket.removeAllListeners()
      s.socket.close()
    } catch {
      // ignore
    }
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

  const tryConnectUrl = (wsUrl: string): Promise<WebSocket> =>
    new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl, {
        handshakeTimeout: 8000,
        rejectUnauthorized: false
      })
      const timer = setTimeout(() => {
        try {
          socket.terminate()
        } catch {
          // ignore
        }
        reject(new Error('连接超时'))
      }, 10000)
      socket.once('open', () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })

  const connect = async (
    opts: ElegooSdcpConnectOpts
  ): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const host = hostOnly(opts.host)
    if (!host) return { ok: false, message: '缺少主机地址' }

    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在连接爱乐库 SDCP…',
      updatedAt: new Date().toISOString()
    })

    let socket: WebSocket | null = null
    let lastErr = '无法连接'
    for (const url of candidateUrls(host)) {
      try {
        socket = await tryConnectUrl(url)
        break
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
      }
    }
    if (!socket) {
      emit({
        connectionId: opts.connectionId,
        health: 'error',
        state: 'error',
        progress: 0,
        message: lastErr,
        updatedAt: new Date().toISOString()
      })
      return { ok: false, message: lastErr }
    }

    const session: Session = { socket, host, mainboardId: '', heartbeat: null }
    sessions.set(opts.connectionId, session)

    const requestStatus = () => {
      try {
        socket!.send(makeCmd(0, {}, session.mainboardId))
      } catch {
        // ignore
      }
    }

    socket.on('message', (buf) => {
      try {
        const raw = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
        const mb =
          String(raw.MainboardID || '') ||
          String((raw.Data as Record<string, unknown> | undefined)?.MainboardID || '')
        if (mb) session.mainboardId = mb

        // attributes response may nest Name etc.; ignore for live patch
        const status = extractStatus(raw)
        if (status) {
          emit(mapStatus(opts.connectionId, status))
          return
        }

        // some firmware wraps status under Topic sdcp/status/...
        const topic = String(raw.Topic || '')
        if (topic.includes('sdcp/status') && raw.Status) {
          emit(mapStatus(opts.connectionId, raw.Status as Record<string, unknown>))
        }
      } catch {
        // ignore
      }
    })

    socket.on('close', () => {
      if (sessions.get(opts.connectionId)?.socket === socket) {
        clearHeartbeat(session)
        sessions.delete(opts.connectionId)
        emit({
          connectionId: opts.connectionId,
          health: 'offline',
          state: 'offline',
          progress: 0,
          message: '连接已断开',
          updatedAt: new Date().toISOString()
        })
      }
    })

    socket.on('error', () => {
      // close handler will emit
    })

    // Attributes + status; heartbeat keeps 60s idle timeout away
    try {
      socket.send(makeCmd(1, {}, ''))
    } catch {
      // ignore
    }
    requestStatus()
    session.heartbeat = setInterval(() => {
      try {
        socket!.send('ping')
        requestStatus()
      } catch {
        // ignore
      }
    }, 25000)

    emit({
      connectionId: opts.connectionId,
      health: 'online',
      state: 'standby',
      progress: 0,
      message: undefined,
      updatedAt: new Date().toISOString()
    })
    return { ok: true }
  }

  const control = async (
    connectionId: string,
    action: string,
    extra?: { percent?: number; fan?: 'part' | 'chamber' }
  ): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')

    let cmd = 0
    let data: Record<string, unknown> = {}
    if (action === 'pause') cmd = 129
    else if (action === 'resume') cmd = 131
    else if (action === 'cancel') cmd = 130
    else if (action === 'set_fan' && extra?.percent != null) {
      cmd = 403
      const pct = Math.max(0, Math.min(100, Math.round(extra.percent)))
      if (extra.fan === 'chamber') {
        data = { TargetFanSpeed: { BoxFan: pct } }
      } else {
        data = { TargetFanSpeed: { ModelFan: pct } }
      }
    } else if (action === 'set_speed' && extra?.percent != null) {
      cmd = 403
      data = { PrintSpeedPct: Math.max(1, Math.min(200, Math.round(extra.percent))) }
    } else {
      throw new Error(`爱乐库暂不支持操作: ${action}`)
    }

    s.socket.send(makeCmd(cmd, data, s.mainboardId))
  }

  return { connect, disconnect, disconnectAll, control }
}
