import mqtt, { type MqttClient } from 'mqtt'
import type { BridgeWindow } from '../../shared/bridgeWindow'
import { bambuMqttHost, type BambuRegion } from './cloud'

export type BambuMqttConnectOpts = {
  /** app-level device uuid */
  connectionId: string
  serial: string
  mode: 'lan' | 'cloud'
  /** LAN: printer IP; Cloud: unused */
  host?: string
  region?: BambuRegion
  /** LAN: access code; Cloud: account access token */
  password: string
  /** Cloud only: numeric user id */
  userId?: string
}

export type BambuLivePatch = {
  connectionId: string
  health: 'online' | 'offline' | 'warning' | 'error' | 'connecting'
  state: string
  progress: number
  remainingSeconds?: number
  layer?: number
  layerTotal?: number
  extruder?: { actual: number; target: number }
  bed?: { actual: number; target: number }
  boardTemp?: number
  chamberTemp?: number
  fanSpeed?: number
  chamberFanSpeed?: number
  printSpeed?: number
  filename?: string
  /** MQTT gcode_file path on printer storage */
  gcodeFile?: string
  amsSlots?: Array<{ id: number; material: string; color: string; remain: number }>
  message?: string
  updatedAt: string
}

type Session = {
  client: MqttClient
  serial: string
  seq: number
  print: Record<string, unknown>
}

const sessions = new Map<string, Session>()

/** HMS 0500-0500-0001-0007 — third-party MQTT writes blocked without Developer Mode */
const MQTT_VERIFY_HINT =
  '打印机拒绝控制指令（MQTT命令检测失败）。当前固件开启了 ACS 鉴权：请在屏幕先开「仅局域网模式」，再开「开发者模式」后重连。A≥01.05 / P1≥01.08.02 / X1≥01.08.03 / H2D≥01.01.00.01 起一般需要；开启后无法使用拓竹云与 Handy。'

function getWin(getter: () => BridgeWindow | null): BridgeWindow | null {
  return getter()
}

function isMqttVerifyFail(print: Record<string, unknown>): boolean {
  const reason = String(print.reason ?? print.fail_reason ?? print.msg ?? '').toLowerCase()
  if (
    reason.includes('verif') ||
    reason.includes('mqtt') ||
    reason.includes('命令检测') ||
    reason.includes('鉴权')
  ) {
    return true
  }
  const result = String(print.result ?? '').toLowerCase()
  if (result === 'failed' || result === 'fail' || result === 'error') {
    if (reason.includes('command') || reason.includes('sign') || reason.includes('auth')) return true
  }
  const hms = print.hms
  if (Array.isArray(hms)) {
    for (const item of hms) {
      if (!item || typeof item !== 'object') continue
      const code = Number((item as { code?: number }).code ?? 0)
      // 0500_0500_0001_0007 packed forms vary; match module 0x0500 when present
      if (Number.isFinite(code) && code !== 0) {
        const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, '0')
        if (hex.startsWith('0500') || hex.includes('05000500')) return true
      }
      const attr = Number((item as { attr?: number }).attr ?? 0)
      if (((attr >> 16) & 0xffff) === 0x0500 || ((attr >> 24) & 0xff) === 0x05) return true
    }
  }
  return false
}

export function createBambuMqttBridge(
  getMainWindow: () => BridgeWindow | null,
  onStatus?: (patch: BambuLivePatch) => void
) {
  const emit = (patch: BambuLivePatch) => {
    const win = getWin(getMainWindow)
    win?.webContents.send('bambu:mqtt:status', patch)
    onStatus?.(patch)
  }

  const connect = async (opts: BambuMqttConnectOpts): Promise<{ ok: boolean; message?: string }> => {
    await disconnect(opts.connectionId)

    emit({
      connectionId: opts.connectionId,
      health: 'connecting',
      state: 'connecting',
      progress: 0,
      message: opts.mode === 'lan' ? '正在连接局域网 MQTT…' : '正在连接云端 MQTT…',
      updatedAt: new Date().toISOString()
    })

    const isLan = opts.mode === 'lan'
    const host = isLan ? opts.host?.trim() : bambuMqttHost(opts.region || 'global')
    if (!host) {
      emit({
        connectionId: opts.connectionId,
        health: 'error',
        state: 'error',
        progress: 0,
        message: '缺少主机地址',
        updatedAt: new Date().toISOString()
      })
      return { ok: false, message: '缺少主机地址' }
    }

    const username = isLan ? 'bblp' : `u_${opts.userId}`
    if (!isLan && !opts.userId) {
      return { ok: false, message: '缺少云端用户 ID' }
    }

    const url = `mqtts://${host}:8883`

    return await new Promise((resolve) => {
      let settled = false
      const client = mqtt.connect(url, {
        username,
        password: opts.password,
        clientId: `printer-monitor-${opts.connectionId.slice(0, 8)}-${Date.now()}`,
        reconnectPeriod: 5000,
        connectTimeout: 15000,
        protocolVersion: 4,
        clean: true,
        rejectUnauthorized: false
      })

      const session: Session = { client, serial: opts.serial, seq: 1, print: {} }
      sessions.set(opts.connectionId, session)

      const done = (ok: boolean, message?: string) => {
        if (settled) return
        settled = true
        resolve({ ok, message })
      }

      client.on('connect', () => {
        const reportTopic = `device/${opts.serial}/report`
        client.subscribe(reportTopic, { qos: 0 }, (err) => {
          if (err) {
            emit({
              connectionId: opts.connectionId,
              health: 'error',
              state: 'error',
              progress: 0,
              message: `订阅失败: ${err.message}`,
              updatedAt: new Date().toISOString()
            })
            done(false, err.message)
            return
          }
          // request full status (HA-compatible pushall)
          publishRaw(opts.connectionId, {
            pushing: {
              sequence_id: String(session.seq++),
              command: 'pushall'
            }
          })
          emit({
            connectionId: opts.connectionId,
            health: 'online',
            state: 'idle',
            progress: 0,
            message: isLan ? '局域网已连接' : '云端已连接',
            updatedAt: new Date().toISOString()
          })
          done(true)
        })
      })

      client.on('message', (_topic, payload) => {
        try {
          const msg = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
          if (msg.print && typeof msg.print === 'object') {
            session.print = deepMerge(session.print, msg.print as Record<string, unknown>)
            emit(mapPrintToPatch(opts.connectionId, session.print, isLan))
          }
          // Some firmwares ACK commands under print.result / reason
          const printObj = msg.print as Record<string, unknown> | undefined
          if (printObj && isMqttVerifyFail(printObj)) {
            emit({
              connectionId: opts.connectionId,
              health: 'warning',
              state: String(session.print.gcode_state || 'IDLE'),
              progress: Number(session.print.mc_percent ?? 0),
              message: MQTT_VERIFY_HINT,
              updatedAt: new Date().toISOString()
            })
          }
        } catch {
          // ignore
        }
      })

      client.on('error', (err) => {
        emit({
          connectionId: opts.connectionId,
          health: 'error',
          state: 'error',
          progress: 0,
          message: err.message,
          updatedAt: new Date().toISOString()
        })
        done(false, err.message)
      })

      client.on('close', () => {
        if (sessions.get(opts.connectionId)?.client === client) {
          emit({
            connectionId: opts.connectionId,
            health: 'warning',
            state: 'disconnected',
            progress: 0,
            message: 'MQTT 已断开，重连中…',
            updatedAt: new Date().toISOString()
          })
        }
      })

      client.on('reconnect', () => {
        emit({
          connectionId: opts.connectionId,
          health: 'connecting',
          state: 'reconnecting',
          progress: 0,
          message: 'MQTT 重连中…',
          updatedAt: new Date().toISOString()
        })
      })
    })
  }

  const disconnect = async (connectionId: string): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) return
    sessions.delete(connectionId)
    await new Promise<void>((resolve) => {
      s.client.end(true, {}, () => resolve())
    })
    emit({
      connectionId,
      health: 'offline',
      state: 'offline',
      progress: 0,
      updatedAt: new Date().toISOString()
    })
  }

  const disconnectAll = async (): Promise<void> => {
    const ids = Array.from(sessions.keys())
    for (const id of ids) await disconnect(id)
  }

  const publishRaw = (connectionId: string, body: object): void => {
    const s = sessions.get(connectionId)
    if (!s || !s.client.connected) throw new Error('设备未连接')
    const topic = `device/${s.serial}/request`
    s.client.publish(topic, JSON.stringify(body), { qos: 1 })
  }

  const control = async (
    connectionId: string,
    action: string,
    extra?: {
      temperature?: number
      heater?: string
      percent?: number
      filename?: string
      slot?: number
      fan?: 'part' | 'chamber'
      axis?: 'X' | 'Y' | 'Z' | 'E'
      amount?: number
    }
  ): Promise<void> => {
    const s = sessions.get(connectionId)
    if (!s) throw new Error('设备未连接')
    const seq = String(s.seq++)

    switch (action) {
      case 'pause':
        publishRaw(connectionId, { print: { sequence_id: seq, command: 'pause' } })
        break
      case 'resume':
        publishRaw(connectionId, { print: { sequence_id: seq, command: 'resume' } })
        break
      case 'cancel':
      case 'emergency_stop':
        publishRaw(connectionId, { print: { sequence_id: seq, command: 'stop' } })
        break
      case 'set_speed':
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'print_speed',
            param: String(Math.max(1, Math.min(4, Math.round((extra?.percent ?? 100) / 25))))
          }
        })
        break
      case 'set_temp': {
        const temp = Math.round(extra?.temperature ?? 0)
        const gcode =
          extra?.heater === 'bed' ? `M140 S${temp}\n` : `M104 S${temp}\n`
        publishRaw(connectionId, {
          print: { sequence_id: seq, command: 'gcode_line', param: gcode }
        })
        break
      }
      case 'home':
        publishRaw(connectionId, {
          print: { sequence_id: seq, command: 'gcode_line', param: 'G28\n' }
        })
        break
      case 'jog': {
        const axis = String(extra?.axis || '').toUpperCase()
        const amount = Number(extra?.amount)
        if (!['X', 'Y', 'Z', 'E'].includes(axis) || !Number.isFinite(amount) || amount === 0) {
          throw new Error('点动需要 axis(X/Y/Z/E) 与非零 amount(mm)')
        }
        const feed = axis === 'Z' || axis === 'E' ? 300 : 3000
        const dist = Math.max(-100, Math.min(100, Math.round(amount * 1000) / 1000))
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'gcode_line',
            param: `G91\nG1 ${axis}${dist} F${feed}\nG90\n`
          }
        })
        break
      }
      case 'print_file':
        if (!extra?.filename) throw new Error('缺少文件名')
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'gcode_file',
            param: extra.filename
          }
        })
        break
      case 'set_fan': {
        // Match Bambu Studio / HA: 10% steps, PWM 0–255, P1 part / P2 aux / P3 chamber
        const pct = Math.max(0, Math.min(100, Math.round((extra?.percent ?? 0) / 10) * 10))
        const pwm = Math.ceil((255 * pct) / 100)
        const idx = extra?.fan === 'chamber' ? 3 : 1
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'gcode_line',
            param: `M106 P${idx} S${pwm}\n`
          }
        })
        break
      }
      case 'load_filament': {
        const t = Math.max(160, Math.round(extra?.temperature ?? 220))
        const slot = extra?.slot
        // AMS 槽 1..N → target 0..；不传 slot → 外挂料架 254
        const target =
          slot != null && slot > 0 ? Math.max(0, Math.floor(slot) - 1) : 254
        const amsId = target === 254 ? 255 : Math.floor(target / 4)
        const slotId = target === 254 ? 0 : target % 4
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'ams_change_filament',
            target,
            ams_id: amsId,
            slot_id: slotId,
            curr_temp: t,
            tar_temp: t
          }
        })
        break
      }
      case 'unload_filament': {
        const t = Math.max(160, Math.round(extra?.temperature ?? 220))
        // target 255 = unload current filament
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'ams_change_filament',
            target: 255,
            curr_temp: t,
            tar_temp: t
          }
        })
        break
      }
      case 'set_flow': {
        const pct = Math.max(1, Math.min(200, Math.round(extra?.percent ?? 100)))
        publishRaw(connectionId, {
          print: { sequence_id: seq, command: 'gcode_line', param: `M221 S${pct}\n` }
        })
        break
      }
      case 'set_chamber_temp': {
        const temp = Math.round(extra?.temperature ?? 0)
        publishRaw(connectionId, {
          print: { sequence_id: seq, command: 'gcode_line', param: `M141 S${temp}\n` }
        })
        break
      }
      case 'extrude':
      case 'retract': {
        const rawAmt = Number(extra?.amount)
        if (!Number.isFinite(rawAmt) || rawAmt === 0) {
          throw new Error('extrude/retract 需要非零 amount(mm)')
        }
        const len = Math.max(0.1, Math.min(50, Math.abs(rawAmt)))
        const signed = action === 'retract' ? -len : len
        const temp = Number(extra?.temperature)
        const heat =
          Number.isFinite(temp) && temp > 0 ? `M109 S${Math.round(temp)}\n` : ''
        publishRaw(connectionId, {
          print: {
            sequence_id: seq,
            command: 'gcode_line',
            param: `${heat}G91\nG1 E${signed} F300\nG90\n`
          }
        })
        break
      }
      default:
        throw new Error(`不支持的指令: ${action}`)
    }
  }

  return { connect, disconnect, disconnectAll, control }
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

function colorFromTray(trayColor?: string): string {
  if (!trayColor || trayColor.length < 6) return '#888888'
  const hex = trayColor.slice(0, 6)
  return `#${hex}`
}

function bambuFanPct(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  // MQTT 常见 0–15 档
  if (n <= 15) return Math.round((n / 15) * 100)
  if (n <= 100) return Math.round(n)
  return Math.min(100, Math.round((n / 255) * 100))
}

function mapPrintToPatch(
  connectionId: string,
  print: Record<string, any>,
  isLan: boolean
): BambuLivePatch {
  const state = String(print.gcode_state || print.mc_print_stage || 'IDLE')
  const progress = Number(print.mc_percent ?? 0)
  const remaining = Number(print.mc_remaining_time ?? 0) * 60
  const layer = Number(print.layer_num ?? 0) || undefined
  const layerTotal = Number(print.total_layer_num ?? 0) || undefined
  const spdLvl = Number(print.spd_lvl ?? 2)
  const printSpeed = spdLvl * 25

  const amsSlots: BambuLivePatch['amsSlots'] = []
  const amsList = print.ams?.ams
  if (Array.isArray(amsList)) {
    let slotId = 1
    for (const unit of amsList) {
      const trays = unit?.tray
      if (!Array.isArray(trays)) continue
      for (const tray of trays) {
        const material = tray?.tray_type || (tray?.tray_info_idx ? '未知' : '空')
        amsSlots.push({
          id: slotId++,
          material,
          color: colorFromTray(tray?.tray_color),
          remain: Number(tray?.remain ?? 0)
        })
      }
    }
  }

  let message = isLan ? '局域网' : '云端'
  if (isMqttVerifyFail(print)) {
    message = MQTT_VERIFY_HINT
  } else if (state === 'FAILED' || state === 'ERROR') {
    message = formatBambuPrintError(print)
  }

  const health =
    state === 'FAILED' || state === 'ERROR'
      ? 'error'
      : isMqttVerifyFail(print)
        ? 'warning'
        : 'online'

  const hasChamberFan = print.big_fan2_speed != null || print.big_fan1_speed != null

  return {
    connectionId,
    health,
    state,
    progress,
    remainingSeconds: remaining > 0 ? remaining : undefined,
    layer,
    layerTotal,
    extruder: {
      actual: Number(print.nozzle_temper ?? 0),
      target: Number(print.nozzle_target_temper ?? 0)
    },
    bed: {
      actual: Number(print.bed_temper ?? 0),
      target: Number(print.bed_target_temper ?? 0)
    },
    boardTemp: (() => {
      const n = Number(print.board_temper ?? print.frame_temper)
      return Number.isFinite(n) ? n : 0
    })(),
    chamberTemp: (() => {
      const n = Number(print.chamber_temper)
      return Number.isFinite(n) ? n : 0
    })(),
    fanSpeed: bambuFanPct(print.cooling_fan_speed ?? print.heatbreak_fan_speed ?? 0),
    chamberFanSpeed: hasChamberFan
      ? bambuFanPct(print.big_fan2_speed ?? print.big_fan1_speed)
      : undefined,
    printSpeed,
    filename: print.subtask_name || print.gcode_file || undefined,
    gcodeFile: typeof print.gcode_file === 'string' ? print.gcode_file : undefined,
    amsSlots: amsSlots.length ? amsSlots : undefined,
    message,
    updatedAt: new Date().toISOString()
  }
}

function formatBambuPrintError(print: Record<string, any>): string {
  const parts: string[] = ['打印失败']
  const code = Number(print.print_error ?? 0)
  if (Number.isFinite(code) && code !== 0) {
    const hex = (code >>> 0).toString(16).toUpperCase().padStart(8, '0')
    parts.push(`0x${hex}`)
  }
  const mc = String(print.mc_print_error_code ?? '').trim()
  if (mc && mc !== '0') parts.push(`码 ${mc}`)
  const hms = print.hms
  if (Array.isArray(hms) && hms.length > 0) {
    const first = hms[0]
    if (first?.code != null) parts.push(`HMS ${first.code}`)
  }
  return parts.join(' · ')
}
