import WebSocket from 'ws'
import type { BridgeWindow } from '../../shared/bridgeWindow'

export type CrealityNativeConnectOpts = {
  connectionId: string
  /** printer host/IP without port */
  host: string
}

export type CrealityNativePatch = {
  connectionId: string
  event: 'open' | 'close' | 'status'
  state?: string
  progress?: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: { actual: number; target: number }
  bed?: { actual: number; target: number }
  fanSpeed?: number
  filename?: string
  message?: string
}

type Session = {
  socket: WebSocket
  host: string
  /** accumulated telemetry — firmware sends delta snapshots */
  snap: Record<string, unknown>
  paraTimer: ReturnType<typeof setInterval> | null
}

const sessions = new Map<string, Session>()

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const n = num(obj[k])
    if (n != null) return n
  }
  return undefined
}

/** Creality deviceState / state numeric codes → UI state string */
function mapState(raw: Record<string, unknown>): string {
  const code = pickNum(raw, ['deviceState', 'state'])
  if (code != null) {
    switch (code) {
      case 0:
        return 'standby'
      case 1:
        return 'printing'
      case 2:
        return 'paused'
      case 3:
        return 'complete'
      case 4:
        return 'error'
      case 5:
        return 'paused'
      default:
        break
    }
  }
  const s = raw.state ?? raw.deviceState ?? raw.printerState
  if (typeof s === 'string' && s.length) return s
  return 'unknown'
}

function mapSnapshot(connectionId: string, raw: Record<string, unknown>): CrealityNativePatch {
  const progressRaw = pickNum(raw, ['printProgress', 'dProgress', 'progress', 'mc_percent'])
  const progress =
    progressRaw == null ? undefined : progressRaw <= 1 ? Math.round(progressRaw * 1000) / 10 : progressRaw

  const left = pickNum(raw, ['printLeftTime', 'print_left_time', 'leftTime', 'remainTime'])
  const layer = pickNum(raw, ['layer', 'currentLayer', 'workingLayer', 'curLayer', 'Layer'])
  const layerTotal = pickNum(raw, [
    'TotalLayer',
    'totalLayer',
    'total_layer',
    'layerCount',
    'TotalLayers'
  ])

  let fan = pickNum(raw, [
    'modelFanPct',
    'fanPct',
    'fanSpeed',
    'modelFan',
    'fan',
    'auxFan',
    'caseFanPct',
    'auxiliaryFanPct'
  ])
  if (fan != null && fan > 100) fan = Math.round((fan / 255) * 100)

  const nozzle = pickNum(raw, ['nozzleTemp', 'nozzle_temp', 'temp0'])
  const nozzleTarget = pickNum(raw, ['targetNozzleTemp', 'nozzleTargetTemp', 'target0'])
  const bed = pickNum(raw, ['bedTemp0', 'bedTemp', 'bed_temp', 'temp1'])
  const bedTarget = pickNum(raw, [
    'targetBedTemp0',
    'targetBedTemp',
    'bedTargetTemp',
    'target1'
  ])

  const filenameRaw = String(
    raw.printFileName ?? raw.gCodeName ?? raw.filename ?? raw.fileName ?? ''
  ).trim()
  const filename =
    filenameRaw && filenameRaw !== 'null' && filenameRaw !== 'undefined'
      ? filenameRaw.replace(/\\/g, '/').split('/').filter(Boolean).pop() || filenameRaw
      : undefined

  return {
    connectionId,
    event: 'status',
    state: mapState(raw),
    progress,
    remainingSeconds: left != null && left > 0 ? Math.round(left) : left === 0 ? 0 : undefined,
    layer,
    layerTotal,
    fanSpeed: fan,
    filename,
    extruder:
      nozzle != null
        ? { actual: nozzle, target: nozzleTarget ?? 0 }
        : undefined,
    bed: bed != null ? { actual: bed, target: bedTarget ?? 0 } : undefined
  }
}

function flattenIncoming(msg: Record<string, unknown>): Record<string, unknown> {
  const nested = msg.data ?? msg.result ?? msg.params
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...msg, ...(nested as Record<string, unknown>) }
  }
  return msg
}

export function createCrealityNativeBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (payload: CrealityNativePatch) => {
    getMainWindow()?.webContents.send('creality:native:event', payload)
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    sessions.delete(connectionId)
    if (s.paraTimer) clearInterval(s.paraTimer)
    try {
      s.socket.removeAllListeners()
      s.socket.close()
    } catch {
      // ignore
    }
    emit({ connectionId, event: 'close' })
  }

  const disconnectAll = async (): Promise<void> => {
    for (const id of Array.from(sessions.keys())) await disconnect(id)
  }

  const connect = async (
    opts: CrealityNativeConnectOpts
  ): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const host = opts.host.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
    if (!host) return { ok: false, message: '缺少主机地址' }

    const wsUrl = `ws://${host}:9999/`

    return await new Promise((resolve) => {
      let settled = false
      const done = (ok: boolean, message?: string) => {
        if (settled) return
        settled = true
        resolve({ ok, message })
      }

      const socket = new WebSocket(wsUrl, {
        handshakeTimeout: 10000,
        rejectUnauthorized: false
      })

      const timer = setTimeout(() => {
        try {
          socket.terminate()
        } catch {
          // ignore
        }
        done(false, '创想原生通道超时（:9999）')
      }, 12000)

      socket.on('open', () => {
        clearTimeout(timer)
        const session: Session = { socket, host, snap: {}, paraTimer: null }
        sessions.set(opts.connectionId, session)
        emit({ connectionId: opts.connectionId, event: 'open' })
        const ask = () => {
          try {
            // Empty get keeps stream alive; ReqPrinterPara refreshes TotalLayer / filename
            socket.send(JSON.stringify({ method: 'get', params: {} }))
            socket.send(JSON.stringify({ method: 'get', params: { ReqPrinterPara: 1 } }))
          } catch {
            // ignore
          }
        }
        ask()
        session.paraTimer = setInterval(ask, 15000)
        done(true)
      })

      socket.on('message', (buf) => {
        try {
          const text = buf.toString('utf8')
          const raw = flattenIncoming(JSON.parse(text) as Record<string, unknown>)
          if (raw.result != null && Object.keys(raw).length <= 2 && typeof raw.result !== 'object') {
            return
          }

          const session = sessions.get(opts.connectionId)
          if (!session || session.socket !== socket) return

          for (const [k, v] of Object.entries(raw)) {
            if (v !== undefined) session.snap[k] = v
          }

          emit(mapSnapshot(opts.connectionId, session.snap))
        } catch {
          // ignore
        }
      })

      socket.on('close', () => {
        clearTimeout(timer)
        const cur = sessions.get(opts.connectionId)
        if (cur?.socket === socket) {
          if (cur.paraTimer) clearInterval(cur.paraTimer)
          sessions.delete(opts.connectionId)
          emit({ connectionId: opts.connectionId, event: 'close' })
        }
        done(false, '创想原生通道关闭')
      })

      socket.on('error', (err) => {
        clearTimeout(timer)
        done(false, err.message)
      })
    })
  }

  return { connect, disconnect, disconnectAll }
}
