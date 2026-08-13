import WebSocket from 'ws'
import axios from 'axios'
import type { BridgeWindow } from '../../shared/bridgeWindow'

export type MoonrakerWsConnectOpts = {
  connectionId: string
  baseUrl: string
  apiKey?: string
}

type Session = {
  socket: WebSocket
}

const sessions = new Map<string, Session>()

const DEFAULT_OBJECTS: Record<string, null> = {
  print_stats: null,
  display_status: null,
  toolhead: null,
  extruder: null,
  heater_bed: null,
  fan: null,
  gcode_move: null,
  virtual_sdcard: null
}

function authHeaders(secret?: string): Record<string, string> {
  if (!secret) return {}
  if (secret.split('.').length >= 3) {
    return { Authorization: `Bearer ${secret}` }
  }
  return { 'X-Api-Key': secret }
}

function wsCandidates(baseUrl: string): string[] {
  const u = new URL(baseUrl.replace(/\/$/, ''))
  const proto = u.protocol === 'https:' ? 'wss:' : 'ws:'
  const list = [`${proto}//${u.host}/websocket`]
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  if (port === '4408' || port === '4409' || port === '80' || port === '443') {
    list.push(`${proto}//${u.hostname}:7125/websocket`)
  }
  return list
}

async function fetchOneshot(baseUrl: string, apiKey?: string): Promise<string | null> {
  try {
    const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/access/oneshot_token`, {
      timeout: 8000,
      headers: authHeaders(apiKey)
    })
    const token = data?.result
    return token ? String(token) : null
  } catch {
    return null
  }
}

async function listExtraObjects(baseUrl: string, apiKey?: string): Promise<string[]> {
  try {
    const { data } = await axios.get(`${baseUrl.replace(/\/$/, '')}/printer/objects/list`, {
      timeout: 8000,
      headers: authHeaders(apiKey)
    })
    const listed: string[] = data?.result?.objects ?? []
    return listed.filter(
      (o) =>
        o === 'fan' ||
        o.startsWith('fan_generic') ||
        o.startsWith('heater_fan') ||
        o.startsWith('controller_fan') ||
        o.startsWith('temperature_sensor') ||
        o.startsWith('temperature_fan') ||
        o.startsWith('temperature_host')
    )
  } catch {
    return []
  }
}

function buildSubscribeObjects(extra: string[]): Record<string, null> {
  // Only subscribe to objects that exist — unknown names can fail the whole subscribe
  const objects = { ...DEFAULT_OBJECTS }
  for (const name of extra) {
    objects[name] = null
  }
  return objects
}

export function createMoonrakerWsBridge(
  getMainWindow: () => BridgeWindow | null,
  onEvent?: (payload: unknown) => void
) {
  const emit = (payload: unknown) => {
    getMainWindow()?.webContents.send('moonraker:ws:event', payload)
    onEvent?.(payload)
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    sessions.delete(connectionId)
    try {
      s.socket.removeAllListeners()
      s.socket.close()
    } catch {
      // ignore
    }
  }

  const disconnectAll = async (): Promise<void> => {
    for (const id of Array.from(sessions.keys())) {
      await disconnect(id)
    }
  }

  const tryConnectUrl = (
    connectionId: string,
    wsUrl: string,
    subscribeObjects: Record<string, null>
  ): Promise<{ ok: boolean; message?: string }> =>
    new Promise((resolve) => {
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

      const failTimer = setTimeout(() => {
        try {
          socket.terminate()
        } catch {
          // ignore
        }
        done(false, 'WebSocket 超时')
      }, 12000)

      socket.on('open', () => {
        // 部分机型握手后立刻踢掉，稍等确认仍 OPEN
        setTimeout(() => {
          if (socket.readyState !== WebSocket.OPEN) {
            clearTimeout(failTimer)
            done(false, '连接后立即断开')
            return
          }
          clearTimeout(failTimer)
          sessions.set(connectionId, { socket })
          socket.send(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'printer.objects.subscribe',
              params: { objects: subscribeObjects },
              id: 1
            })
          )
          emit({ connectionId, event: 'open', wsUrl })
          done(true)

          socket.on('message', (data) => {
            emit({
              connectionId,
              event: 'message',
              data: data.toString('utf8')
            })
          })

          socket.on('close', () => {
            if (sessions.get(connectionId)?.socket === socket) {
              sessions.delete(connectionId)
              emit({ connectionId, event: 'close' })
            }
          })
        }, 400)
      })

      socket.on('error', (err) => {
        clearTimeout(failTimer)
        done(false, err.message)
      })

      socket.on('close', () => {
        if (!settled) {
          clearTimeout(failTimer)
          done(false, 'WebSocket 关闭')
        }
      })
    })

  const connect = async (
    opts: MoonrakerWsConnectOpts
  ): Promise<{ ok: boolean; message?: string; wsUrl?: string }> => {
    await disconnect(opts.connectionId)
    const baseUrl = opts.baseUrl.replace(/\/$/, '')
    const extraObjects = await listExtraObjects(baseUrl, opts.apiKey)
    const subscribeObjects = buildSubscribeObjects(extraObjects)
    const token = await fetchOneshot(baseUrl, opts.apiKey)
    const candidates = wsCandidates(baseUrl)
    const errors: string[] = []

    const attempt = async (wsUrl: string) => {
      const res = await tryConnectUrl(opts.connectionId, wsUrl, subscribeObjects)
      if (res.ok) return true
      errors.push(`${wsUrl}: ${res.message || '失败'}`)
      await disconnect(opts.connectionId)
      return false
    }

    for (const raw of candidates) {
      const wsUrl = token ? `${raw}?token=${encodeURIComponent(token)}` : raw
      if (await attempt(wsUrl)) return { ok: true, wsUrl }
    }

    if (token) {
      for (const raw of candidates) {
        if (await attempt(raw)) return { ok: true, wsUrl: raw }
      }
    }

    return { ok: false, message: errors.slice(0, 4).join('；') }
  }

  return { connect, disconnect, disconnectAll }
}
