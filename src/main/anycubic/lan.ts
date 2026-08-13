import { createDecipheriv, createHash, randomBytes } from 'crypto'
import mqtt, { type MqttClient } from 'mqtt'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { getDevicePollMs } from '../pollInterval'

export type AnycubicLanConnectOpts = {
  connectionId: string
  host: string
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

type HandshakeResult = {
  brokerHost: string
  brokerPort: number
  username: string
  password: string
  deviceId: string
  modelId: string
}

type Session = {
  client: MqttClient
  host: string
  hs: HandshakeResult
  pollTimer: ReturnType<typeof setInterval> | null
  lastPatch: Partial<AnycubicLivePatch>
  /** merged info/temp/fan fields for incremental reports */
  cache: Record<string, unknown>
}

const PREFIX = 'anycubic/anycubicCloud/v1'
const sessions = new Map<string, Session>()

function hostOnly(raw: string): string {
  return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].trim()
}

function sign(token: string, ts: number, nonce: string): string {
  const first = createHash('md5').update(token.slice(0, 16)).digest('hex')
  return createHash('md5').update(first + String(ts) + nonce).digest('hex')
}

function randomAlnum(len: number, charset: string): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += charset[bytes[i] % charset.length]
  return out
}

function decryptCtrl(infoB64: string, token: string, localToken: string): Record<string, unknown> {
  const key = Buffer.from(token.slice(16, 32), 'utf8')
  const iv = Buffer.alloc(16, 0)
  Buffer.from(localToken, 'utf8').copy(iv, 0, 0, Math.min(16, Buffer.byteLength(localToken)))
  const decipher = createDecipheriv('aes-128-cbc', key, iv)
  const plain = Buffer.concat([decipher.update(Buffer.from(infoB64, 'base64')), decipher.final()])
  return JSON.parse(plain.toString('utf8')) as Record<string, unknown>
}

async function fetchJson(method: string, url: string, timeoutMs = 8000): Promise<Record<string, unknown>> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as Record<string, unknown>
  } finally {
    clearTimeout(timer)
  }
}

async function doHandshake(host: string): Promise<HandshakeResult> {
  const info = await fetchJson('GET', `http://${host}:18910/info`)
  if (info.ctrlType === 'cloud') {
    throw new Error('打印机处于云端模式，请在设置中开启 LAN Mode')
  }
  const token = String(info.token || '')
  const ctrlInfoUrl = String(info.ctrlInfoUrl || '')
  const modelId = info.modelId != null ? String(info.modelId) : ''
  if (!token || !ctrlInfoUrl || !modelId) {
    throw new Error('该机型不支持已验证的签名局域网握手（需 Kobra 3 / S1 一代）')
  }

  const ts = Date.now()
  const nonce = randomAlnum(6, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  const did = randomAlnum(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
  const qs = new URLSearchParams({
    ts: String(ts),
    nonce,
    sign: sign(token, ts, nonce),
    did
  })
  const ctrl = await fetchJson('POST', `${ctrlInfoUrl}?${qs.toString()}`)
  if (Number(ctrl.code) !== 200) {
    throw new Error(`局域网握手失败: ${String(ctrl.message || 'unknown')}`)
  }
  const dataWrap = ctrl.data as Record<string, unknown> | undefined
  if (!dataWrap?.info || !dataWrap?.token) throw new Error('握手响应缺少凭证')

  const data = decryptCtrl(String(dataWrap.info), token, String(dataWrap.token))
  const broker = String(data.broker || '')
  const m = broker.match(/mqtts?:\/\/([^:]+):(\d+)/)
  if (!m) throw new Error('无法解析 MQTT 地址')

  return {
    brokerHost: m[1],
    brokerPort: Number(m[2]),
    username: String(data.username || ''),
    password: String(data.password || ''),
    deviceId: String(data.deviceId || ''),
    modelId
  }
}

function queryTopic(modelId: string, deviceId: string, msgType: string): string {
  return `${PREFIX}/web/printer/${modelId}/${deviceId}/${msgType}`
}

function reportPrefix(modelId: string, deviceId: string): string {
  return `${PREFIX}/printer/public/${modelId}/${deviceId}`
}

function mapPrintSpeedMode(mode?: number): number | undefined {
  // 1 silent / 2 standard / 3 sport — expose as rough %
  if (mode == null) return undefined
  if (mode === 1) return 50
  if (mode === 2) return 100
  if (mode === 3) return 150
  return mode
}

function deriveState(data: Record<string, unknown>): string {
  const raw = String(data.state || '')
  const proj = (data.project || data.last_project || {}) as Record<string, unknown>
  const projState = String(proj.state || '')
  const pause = Number(proj.pause)
  if (pause === 1) return 'paused'
  if (pause === 2) return 'pausing'
  if (pause === 3) return 'resuming'
  if (pause === 4) return 'stopping'
  if (raw === 'free') return 'standby'
  if (projState) return projState
  return raw || 'unknown'
}

function patchFromInfo(
  connectionId: string,
  data: Record<string, unknown>,
  prev: Partial<AnycubicLivePatch>
): AnycubicLivePatch {
  const temp = (data.temp || {}) as Record<string, unknown>
  const proj = (data.project || data.last_project || {}) as Record<string, unknown>
  const remainMin = proj.remain_time != null ? Number(proj.remain_time) : undefined

  return {
    connectionId,
    health: 'online',
    state: deriveState(data),
    progress: Number(proj.progress ?? prev.progress ?? 0) || 0,
    remainingSeconds:
      remainMin != null && Number.isFinite(remainMin)
        ? Math.round(remainMin * 60)
        : prev.remainingSeconds,
    layer: proj.curr_layer != null ? Number(proj.curr_layer) : prev.layer,
    layerTotal: proj.total_layers != null ? Number(proj.total_layers) : prev.layerTotal,
    fanSpeed: data.fan_speed_pct != null ? Number(data.fan_speed_pct) : prev.fanSpeed,
    printSpeed:
      mapPrintSpeedMode(
        data.print_speed_mode != null ? Number(data.print_speed_mode) : undefined
      ) ?? prev.printSpeed,
    filename: String(proj.filename || prev.filename || '') || undefined,
    extruder: {
      actual: Number(temp.curr_nozzle_temp ?? prev.extruder?.actual ?? 0),
      target: Number(temp.target_nozzle_temp ?? prev.extruder?.target ?? 0)
    },
    bed: {
      actual: Number(temp.curr_hotbed_temp ?? prev.bed?.actual ?? 0),
      target: Number(temp.target_hotbed_temp ?? prev.bed?.target ?? 0)
    },
    updatedAt: new Date().toISOString()
  }
}

export function createAnycubicLanBridge(getMainWindow: () => BridgeWindow | null) {
  const emit = (patch: AnycubicLivePatch) => {
    getMainWindow()?.webContents.send('anycubic:lan:status', patch)
  }

  const publishQuery = (s: Session, msgType: string) => {
    const body = JSON.stringify({
      type: msgType,
      action: 'query',
      timestamp: Date.now(),
      msgid: randomBytes(16).toString('hex'),
      data: null
    })
    s.client.publish(queryTopic(s.hs.modelId, s.hs.deviceId, msgType), body)
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    sessions.delete(connectionId)
    if (s.pollTimer) clearInterval(s.pollTimer)
    try {
      s.client.end(true)
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

  const connect = async (
    opts: AnycubicLanConnectOpts
  ): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)
    const host = hostOnly(opts.host)
    if (!host) return { ok: false, message: '缺少主机地址' }

    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: '正在局域网握手…',
      updatedAt: new Date().toISOString()
    })

    let hs: HandshakeResult
    try {
      hs = await doHandshake(host)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      emit({
        connectionId: opts.connectionId,
        health: 'error',
        state: 'error',
        progress: 0,
        message,
        updatedAt: new Date().toISOString()
      })
      return { ok: false, message }
    }

    return await new Promise((resolve) => {
      let settled = false
      const done = (ok: boolean, message?: string) => {
        if (settled) return
        settled = true
        resolve({ ok, message })
      }

      const client = mqtt.connect(`mqtts://${hs.brokerHost}:${hs.brokerPort}`, {
        username: hs.username,
        password: hs.password,
        rejectUnauthorized: false,
        reconnectPeriod: 5000,
        connectTimeout: 15000,
        protocolVersion: 4,
        clientId: `pm-${randomBytes(4).toString('hex')}`
      })

      const session: Session = {
        client,
        host,
        hs,
        pollTimer: null,
        lastPatch: {},
        cache: {}
      }

      client.on('connect', () => {
        sessions.set(opts.connectionId, session)
        client.subscribe(`${reportPrefix(hs.modelId, hs.deviceId)}/#`)
        for (const t of ['info', 'tempature', 'fan', 'print']) publishQuery(session, t)
        session.pollTimer = setInterval(() => {
          publishQuery(session, 'info')
        }, Math.max(getDevicePollMs(), 8000))
        emit({
          connectionId: opts.connectionId,
          health: 'online',
          state: 'standby',
          progress: 0,
          updatedAt: new Date().toISOString()
        })
        done(true)
      })

      client.on('message', (_topic, buf) => {
        try {
          const obj = JSON.parse(buf.toString('utf8')) as Record<string, unknown>
          if (obj.action === 'query' && obj.data == null && obj.state == null) return
          const parts = String(_topic).split('/').filter(Boolean)
          const msgType = String(obj.type || parts[parts.length - 2] || parts[parts.length - 1] || '')
          const data = obj.data
          if (!data || typeof data !== 'object') return
          const d = data as Record<string, unknown>

          if (
            msgType === 'info' ||
            msgType === 'print' ||
            msgType === 'tempature' ||
            msgType === 'fan' ||
            msgType === 'report'
          ) {
            const prevTemp = (session.cache.temp || {}) as Record<string, unknown>
            if (msgType === 'tempature') {
              session.cache.temp = { ...prevTemp, ...d }
            } else {
              session.cache = {
                ...session.cache,
                ...d,
                temp: {
                  ...prevTemp,
                  ...((d.temp as Record<string, unknown>) || {})
                }
              }
            }
            if (msgType === 'fan') {
              if (d.fan_speed_pct != null) session.cache.fan_speed_pct = d.fan_speed_pct
              if (d.aux_fan_speed_pct != null) session.cache.aux_fan_speed_pct = d.aux_fan_speed_pct
            }
            if (msgType === 'print' && !session.cache.project) {
              session.cache.project = d
            }
            const patch = patchFromInfo(opts.connectionId, session.cache, session.lastPatch)
            session.lastPatch = patch
            emit(patch)
          }
        } catch {
          // ignore
        }
      })

      client.on('error', (err) => {
        if (!settled) {
          done(false, err.message)
          void disconnect(opts.connectionId)
        } else {
          emit({
            connectionId: opts.connectionId,
            health: 'warning',
            state: 'warning',
            progress: session.lastPatch.progress ?? 0,
            message: err.message,
            updatedAt: new Date().toISOString()
          })
        }
      })

      client.on('close', () => {
        if (sessions.get(opts.connectionId)?.client === client) {
          if (session.pollTimer) clearInterval(session.pollTimer)
          sessions.delete(opts.connectionId)
          emit({
            connectionId: opts.connectionId,
            health: 'offline',
            state: 'offline',
            progress: 0,
            message: 'MQTT 已断开',
            updatedAt: new Date().toISOString()
          })
        }
        done(false, 'MQTT 连接关闭')
      })
    })
  }

  const control = async (
    connectionId: string,
    action: string,
    extra?: { temperature?: number; heater?: string; percent?: number }
  ): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')

    let msgType = 'print'
    let mqttAction = ''
    let data: Record<string, unknown> | null = { taskid: '-1' }

    if (action === 'pause') mqttAction = 'pause'
    else if (action === 'resume') mqttAction = 'resume'
    else if (action === 'cancel') mqttAction = 'stop'
    else if (action === 'set_temp' && extra?.temperature != null) {
      mqttAction = 'update'
      const key = extra.heater === 'bed' ? 'target_hotbed_temp' : 'target_nozzle_temp'
      data = { taskid: '-1', settings: { [key]: Math.round(extra.temperature) } }
    } else if (action === 'set_fan' && extra?.percent != null) {
      mqttAction = 'update'
      data = {
        taskid: '-1',
        settings: { fan_speed_pct: Math.max(0, Math.min(100, Math.round(extra.percent))) }
      }
    } else {
      throw new Error(`纵维立方暂不支持操作: ${action}`)
    }

    const body = JSON.stringify({
      type: msgType,
      action: mqttAction,
      timestamp: Date.now(),
      msgid: randomBytes(16).toString('hex'),
      data
    })
    s.client.publish(queryTopic(s.hs.modelId, s.hs.deviceId, msgType), body)
  }

  return { connect, disconnect, disconnectAll, control }
}
