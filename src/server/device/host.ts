import type { AxiosInstance } from 'axios'
import { createBambuMqttBridge } from '../../main/bambu/mqtt'
import { createMoonrakerWsBridge } from '../../main/moonraker/ws'
import { createCrealityCloudBridge } from '../../main/creality/cloud'
import { createElegooSdcpBridge } from '../../main/elegoo/sdcp'
import { createAnycubicLanBridge } from '../../main/anycubic/lan'
import { createAnycubicCloudBridge } from '../../main/anycubic/cloud'
import { createFlashforgeBridge } from '../../main/flashforge/lan'
import { createSnapmakerBridge } from '../../main/snapmaker/lan'
import { getDevicePollMs } from '../../main/pollInterval'
import { createBridgeWindow } from './mockWindow'
import {
  createMoonrakerClient,
  moonrakerControl,
  moonrakerDownloadFile,
  moonrakerListFiles,
  moonrakerPollStatus,
  moonrakerProxyRequest,
  moonrakerUploadFile,
  parseControlPayload
} from './moonrakerHttp'
import { bambuDownloadFile, bambuListFiles, bambuUploadFile } from '../../main/bambu/files'
import { computeDeviceCapabilities, type DeviceCapabilities } from './capabilities'
import type { MoonrakerProxyRequest } from '../../main/api/controlShared'

type DeviceRow = Record<string, unknown>
type StatusMap = Record<string, unknown>

type LivePatch = {
  connectionId: string
  health: string
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
  gcodeFile?: string
  amsSlots?: unknown[]
  message?: string
  updatedAt: string
}

const MOONRAKER_OBJECTS = [
  'print_stats',
  'display_status',
  'toolhead',
  'extruder',
  'heater_bed',
  'fan',
  'gcode_move',
  'virtual_sdcard'
]

export type DeviceHostDeps = {
  readDevices: () => DeviceRow[]
  getSecret: (secretKey: string) => Promise<string | null>
  setSecret: (secretKey: string, value: string) => void
}

function hostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return ''
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`)
    return u.hostname
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

function deviceHost(d: DeviceRow): string {
  if (typeof d.bambuHost === 'string' && d.bambuHost.trim()) return d.bambuHost.trim()
  return hostFromBaseUrl(typeof d.baseUrl === 'string' ? d.baseUrl : undefined)
}

function isMoonrakerDevice(d: DeviceRow): boolean {
  const brand = String(d.brand || '')
  if (brand === 'klipper' || brand === 'qidi') return true
  if (brand === 'creality' && d.connectionMode !== 'cloud') return true
  // Snapmaker U1 ships Moonraker on :7125（非旧版 Luban /api/v1）
  if (brand === 'snapmaker' && String(d.snapmakerApi || '') === 'moonraker') return true
  return false
}

function patchToStatus(patch: LivePatch): Record<string, unknown> {
  return {
    deviceId: patch.connectionId,
    health: patch.health,
    state: patch.state,
    progress: patch.progress,
    remainingSeconds: patch.remainingSeconds,
    layer: patch.layer,
    layerTotal: patch.layerTotal,
    extruder: patch.extruder,
    bed: patch.bed,
    boardTemp: patch.boardTemp,
    chamberTemp: patch.chamberTemp,
    fanSpeed: patch.fanSpeed,
    chamberFanSpeed: patch.chamberFanSpeed,
    printSpeed: patch.printSpeed,
    filename: patch.filename || patch.gcodeFile,
    amsSlots: patch.amsSlots,
    message: patch.message,
    updatedAt: patch.updatedAt || new Date().toISOString()
  }
}

/** Merge live patches so MQTT reconnect does not wipe temperature / progress. */
function mergeStatusPatch(
  prev: Record<string, unknown> | undefined,
  patch: LivePatch
): Record<string, unknown> {
  const next = patchToStatus(patch)
  if (!prev) return next
  const merged: Record<string, unknown> = { ...prev }
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined && v !== null) merged[k] = v
  }
  merged.updatedAt = next.updatedAt
  return merged
}

function canBatchPrint(d: DeviceRow): boolean {
  if (d.tech === 'resin') return false
  const brand = String(d.brand || '')
  if (brand === 'bambu') {
    const host = String((d as { bambuHost?: string }).bambuHost || d.host || '').trim()
    return Boolean(host)
  }
  if (d.connectionMode === 'cloud') return false
  return brand === 'klipper' || brand === 'creality' || brand === 'qidi' ||
    (brand === 'snapmaker' && String(d.snapmakerApi || '') === 'moonraker')
}

export class DeviceHost {
  readonly statuses: StatusMap = {}
  private deps: DeviceHostDeps
  private pollTimers = new Map<string, ReturnType<typeof setInterval>>()
  private moonrakerHttp = new Map<string, AxiosInstance>()
  private connecting = new Set<string>()

  private bambuMqtt!: ReturnType<typeof createBambuMqttBridge>
  private moonrakerWs!: ReturnType<typeof createMoonrakerWsBridge>
  private crealityCloud!: ReturnType<typeof createCrealityCloudBridge>
  private elegooSdcp!: ReturnType<typeof createElegooSdcpBridge>
  private anycubicLan!: ReturnType<typeof createAnycubicLanBridge>
  private anycubicCloud!: ReturnType<typeof createAnycubicCloudBridge>
  private flashforgeLan!: ReturnType<typeof createFlashforgeBridge>
  private snapmakerLan!: ReturnType<typeof createSnapmakerBridge>

  constructor(deps: DeviceHostDeps) {
    this.deps = deps
    const win = createBridgeWindow(this.onIpc)
    this.bambuMqtt = createBambuMqttBridge(win, (p) => this.applyPatch(p as LivePatch))
    this.moonrakerWs = createMoonrakerWsBridge(win)
    this.crealityCloud = createCrealityCloudBridge(win)
    this.elegooSdcp = createElegooSdcpBridge(win)
    this.anycubicLan = createAnycubicLanBridge(win)
    this.anycubicCloud = createAnycubicCloudBridge(win)
    this.flashforgeLan = createFlashforgeBridge(win)
    this.snapmakerLan = createSnapmakerBridge(win)
  }

  private onIpc = (channel: string, data: unknown): void => {
    if (channel.endsWith(':status') && data && typeof data === 'object') {
      this.applyPatch(data as LivePatch)
      return
    }
    if (channel === 'moonraker:ws:event' && data && typeof data === 'object') {
      const ev = data as { connectionId?: string; event?: string }
      if (ev.event === 'message' || ev.event === 'open') {
        void this.refreshMoonrakerPoll(ev.connectionId || '')
      }
    }
  }

  private applyPatch(patch: LivePatch): void {
    const id = patch.connectionId
    if (!id) return
    const prev = this.statuses[id] as Record<string, unknown> | undefined
    this.statuses[id] = mergeStatusPatch(prev, patch)
  }

  private setStatus(deviceId: string, partial: Record<string, unknown>): void {
    this.statuses[deviceId] = {
      deviceId,
      health: 'offline',
      state: 'unknown',
      progress: 0,
      updatedAt: new Date().toISOString(),
      ...partial
    }
  }

  private stopPoll(deviceId: string): void {
    const t = this.pollTimers.get(deviceId)
    if (t) clearInterval(t)
    this.pollTimers.delete(deviceId)
    this.moonrakerHttp.delete(deviceId)
  }

  private startMoonrakerPoll(deviceId: string, http: AxiosInstance): void {
    this.moonrakerHttp.set(deviceId, http)
    const poll = () => {
      void moonrakerPollStatus(http, deviceId, MOONRAKER_OBJECTS)
        .then((st) => {
          this.statuses[deviceId] = st
        })
        .catch((e) => {
          this.setStatus(deviceId, {
            health: 'warning',
            state: 'warning',
            message: e instanceof Error ? e.message : String(e)
          })
        })
    }
    poll()
    const t = setInterval(poll, getDevicePollMs())
    this.pollTimers.set(deviceId, t)
  }

  private async refreshMoonrakerPoll(deviceId: string): Promise<void> {
    const http = this.moonrakerHttp.get(deviceId)
    if (!http) return
    try {
      this.statuses[deviceId] = await moonrakerPollStatus(http, deviceId, MOONRAKER_OBJECTS)
    } catch {
      /* ignore */
    }
  }

  private async secretFor(d: DeviceRow): Promise<string> {
    const key = typeof d.secretKey === 'string' ? d.secretKey : ''
    if (!key) return ''
    return (await this.deps.getSecret(key)) || ''
  }

  /** LAN access code for FTPS/camera — cloud token is never used as FTPS password. */
  private async bambuLanAccessCode(d: DeviceRow): Promise<string> {
    const lanKey =
      typeof d.bambuLanSecretKey === 'string' && d.bambuLanSecretKey.trim()
        ? d.bambuLanSecretKey.trim()
        : `bambu:lan:${String(d.id || '')}`
    if (lanKey) {
      const fromLan = (await this.deps.getSecret(lanKey)) || ''
      if (fromLan.trim()) return fromLan.trim()
    }
    if (typeof d.bambuLanAccessCode === 'string' && d.bambuLanAccessCode.trim()) {
      return d.bambuLanAccessCode.trim()
    }
    const pd = d.pluginData
    if (pd && typeof pd === 'object' && !Array.isArray(pd)) {
      const c = (pd as Record<string, unknown>).bambuLanAccessCode
      if (typeof c === 'string' && c.trim()) return c.trim()
    }
    const secret = await this.secretFor(d)
    if (d.connectionMode === 'cloud') {
      return secret && secret.length <= 32 ? secret : ''
    }
    return secret
  }

  async connectDevice(d: DeviceRow): Promise<void> {
    const id = String(d.id || '')
    if (!id || this.connecting.has(id)) return
    this.connecting.add(id)
    try {
      this.setStatus(id, { health: 'connecting', state: 'connecting', message: '连接中…' })
      const brand = String(d.brand || '')
      const secret = await this.secretFor(d)

      if (brand === 'bambu') {
        const mode = d.connectionMode === 'cloud' ? 'cloud' : 'lan'
        const password =
          mode === 'lan' ? (await this.bambuLanAccessCode(d)) || secret : secret
        if (!password || password.startsWith('v1:')) {
          throw new Error(
            mode === 'lan'
              ? '拓竹访问码缺失或已失效（服务端密钥变更）。请编辑设备，重新填写局域网访问码后保存。'
              : '拓竹云端令牌缺失或已失效。请编辑设备重新登录/填写令牌。'
          )
        }
        const res = await this.bambuMqtt.connect({
          connectionId: id,
          serial: String(d.bambuDeviceId || ''),
          mode,
          host: deviceHost(d) || undefined,
          region: (d.bambuRegion as 'china' | 'global') || 'global',
          password,
          userId: d.bambuUserId ? String(d.bambuUserId) : undefined
        })
        if (!res.ok) throw new Error(res.message || 'Bambu 连接失败')
        return
      }

      if (isMoonrakerDevice(d)) {
        const baseUrl = String(d.baseUrl || '').replace(/\/$/, '')
        if (!baseUrl) throw new Error('缺少 Moonraker 地址')
        const http = createMoonrakerClient(baseUrl, secret || undefined)
        await http.get('/server/info')
        this.startMoonrakerPoll(id, http)
        void this.moonrakerWs.connect({
          connectionId: id,
          baseUrl,
          apiKey: secret || undefined
        })
        return
      }

      if (brand === 'creality' && d.connectionMode === 'cloud') {
        const res = await this.crealityCloud.connect({
          connectionId: id,
          token: secret,
          userId: String(d.crealityUserId || '0'),
          deviceId: String(d.crealityDeviceId || ''),
          region: (d.crealityRegion as 'china' | 'global') || 'china',
          host: deviceHost(d) || undefined
        })
        if (!res.ok) throw new Error(res.message || '创想云连接失败')
        return
      }

      if (brand === 'elegoo') {
        const host = deviceHost(d)
        const res = await this.elegooSdcp.connect({ connectionId: id, host })
        if (!res.ok) throw new Error(res.message || '爱乐酷连接失败')
        return
      }

      if (brand === 'anycubic') {
        if (d.connectionMode === 'cloud') {
          const res = await this.anycubicCloud.connect({
            connectionId: id,
            token: secret,
            printerId: String(d.anycubicPrinterId || ''),
            mode: (d.anycubicAuthMode as 'web' | 'slicer') || 'web'
          })
          if (!res.ok) throw new Error(res.message || '纵维云连接失败')
        } else {
          const res = await this.anycubicLan.connect({ connectionId: id, host: deviceHost(d) })
          if (!res.ok) throw new Error(res.message || '纵维立方连接失败')
        }
        return
      }

      if (brand === 'flashforge') {
        const res = await this.flashforgeLan.connect({
          connectionId: id,
          host: deviceHost(d),
          serial: String(d.flashforgeSerial || ''),
          checkCode: secret
        })
        if (!res.ok) throw new Error(res.message || '闪铸连接失败')
        return
      }

      if (brand === 'snapmaker') {
        // Legacy devices without snapmakerApi: U1 Moonraker returns 404 on Luban paths
        const host = deviceHost(d)
        if (host && String(d.snapmakerApi || '') !== 'luban') {
          try {
            const baseUrl = `http://${host}:7125`
            const http = createMoonrakerClient(baseUrl, secret || undefined)
            await http.get('/server/info')
            this.startMoonrakerPoll(id, http)
            void this.moonrakerWs.connect({
              connectionId: id,
              baseUrl,
              apiKey: secret || undefined
            })
            return
          } catch {
            // not Moonraker — fall through to Luban
          }
        }
        const res = await this.snapmakerLan.connect({
          connectionId: id,
          host,
          token: secret || undefined
        })
        if (!res.ok) throw new Error(res.message || 'Snapmaker 连接失败')
        if (res.token && typeof d.secretKey === 'string' && d.secretKey) {
          this.deps.setSecret(d.secretKey, res.token)
        }
        return
      }

      throw new Error(`不支持的设备品牌: ${brand}`)
    } catch (e) {
      this.setStatus(id, {
        health: 'error',
        state: 'error',
        message: e instanceof Error ? e.message : String(e)
      })
    } finally {
      this.connecting.delete(id)
    }
  }

  async disconnectDevice(deviceId: string): Promise<void> {
    this.stopPoll(deviceId)
    await Promise.allSettled([
      this.bambuMqtt.disconnect(deviceId),
      this.moonrakerWs.disconnect(deviceId),
      this.crealityCloud.disconnect(deviceId),
      this.elegooSdcp.disconnect(deviceId),
      this.anycubicLan.disconnect(deviceId),
      this.anycubicCloud.disconnect(deviceId),
      this.flashforgeLan.disconnect(deviceId),
      this.snapmakerLan.disconnect(deviceId)
    ])
    delete this.statuses[deviceId]
  }

  async reconnectAll(): Promise<{ ok: boolean; message?: string }> {
    const devices = this.deps.readDevices()
    for (const id of Object.keys(this.statuses)) {
      await this.disconnectDevice(id)
    }
    await Promise.all(devices.map((d) => this.connectDevice(d)))
    return { ok: true, message: `已重连 ${devices.length} 台设备` }
  }

  private findDevice(deviceId: string): DeviceRow | undefined {
    return this.deps.readDevices().find((d) => String(d.id || '') === deviceId)
  }

  async control(
    deviceId: string,
    payload: unknown
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const d = this.findDevice(deviceId)
      if (!d) return { ok: false, message: '设备不存在' }
      const body = parseControlPayload(payload)
      const brand = String(d.brand || '')

      if (brand === 'bambu') {
        await this.bambuMqtt.control(deviceId, String(body.action || ''), {
          temperature: body.temperature as number | undefined,
          heater: body.heater as string | undefined,
          percent: body.percent as number | undefined,
          filename: body.filename as string | undefined,
          slot: body.slot as number | undefined,
          fan: body.fan as 'part' | 'chamber' | undefined,
          axis: body.axis as 'X' | 'Y' | 'Z' | 'E' | undefined,
          amount: body.amount as number | undefined
        })
        return { ok: true }
      }

      if (isMoonrakerDevice(d) || this.moonrakerHttp.has(deviceId)) {
        const http = this.moonrakerHttp.get(deviceId)
        if (!http) return { ok: false, message: '设备未连接' }
        await moonrakerControl(http, body)
        return { ok: true }
      }

      if (brand === 'creality' && d.connectionMode === 'cloud') {
        await this.crealityCloud.control(deviceId, String(body.action || ''))
        return { ok: true }
      }
      if (brand === 'elegoo') {
        await this.elegooSdcp.control(deviceId, String(body.action || ''), {
          percent: body.percent as number | undefined,
          fan: body.fan as 'part' | 'chamber' | undefined
        })
        return { ok: true }
      }
      if (brand === 'anycubic') {
        if (d.connectionMode === 'cloud') {
          await this.anycubicCloud.control(deviceId, String(body.action || ''))
        } else {
          await this.anycubicLan.control(deviceId, String(body.action || ''), {
            temperature: body.temperature as number | undefined,
            heater: body.heater as string | undefined,
            percent: body.percent as number | undefined
          })
        }
        return { ok: true }
      }
      if (brand === 'flashforge') {
        await this.flashforgeLan.control(deviceId, String(body.action || ''))
        return { ok: true }
      }
      if (brand === 'snapmaker') {
        await this.snapmakerLan.control(deviceId, String(body.action || ''))
        return { ok: true }
      }

      return { ok: false, message: '该品牌暂不支持远程控制' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  getCapabilities(deviceId: string): DeviceCapabilities {
    return computeDeviceCapabilities(this.findDevice(deviceId))
  }

  async sendGcode(
    deviceId: string,
    script: string
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const d = this.findDevice(deviceId)
      if (!d) return { ok: false, message: '设备不存在' }
      if (!isMoonrakerDevice(d) && !this.moonrakerHttp.has(deviceId)) {
        return { ok: false, message: '仅 Moonraker 类设备支持任意 G-code' }
      }
      const http = this.moonrakerHttp.get(deviceId)
      if (!http) return { ok: false, message: '设备未连接' }
      const s = String(script || '').trim()
      if (!s) return { ok: false, message: '缺少 script' }
      await http.post('/printer/gcode/script', null, { params: { script: s } })
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  async moonrakerRequest(
    deviceId: string,
    req: MoonrakerProxyRequest
  ): Promise<{ ok: boolean; status?: number; data?: unknown; message?: string }> {
    try {
      const d = this.findDevice(deviceId)
      if (!d) return { ok: false, status: 404, message: '设备不存在' }
      if (!isMoonrakerDevice(d) && !this.moonrakerHttp.has(deviceId)) {
        return { ok: false, status: 400, message: '仅 Moonraker 类设备支持透传' }
      }
      const http = this.moonrakerHttp.get(deviceId)
      if (!http) return { ok: false, status: 503, message: '设备未连接' }
      return await moonrakerProxyRequest(http, req)
    } catch (e) {
      return { ok: false, status: 502, message: e instanceof Error ? e.message : String(e) }
    }
  }

  async deviceOp(req: {
    deviceId: string
    op: 'listFiles' | 'uploadFile' | 'downloadFile'
    filename?: string
    contentBase64?: string
    remotePath?: string
  }): Promise<{
    ok: boolean
    message?: string
    files?: Array<{ path: string; size: number; modified?: number }>
    filename?: string
    remotePath?: string
    contentBase64?: string
    contentType?: string
  }> {
    try {
      const d = this.findDevice(req.deviceId)
      if (!d) return { ok: false, message: '设备不存在' }
      const brand = String(d.brand || '').toLowerCase()

      if (isMoonrakerDevice(d) || this.moonrakerHttp.has(req.deviceId)) {
        const http = this.moonrakerHttp.get(req.deviceId)
        if (!http) return { ok: false, message: '设备未连接' }

        if (req.op === 'listFiles') {
          const files = await moonrakerListFiles(http)
          return { ok: true, files }
        }
        if (req.op === 'uploadFile') {
          const name = req.filename || 'upload.gcode'
          const b64 = req.contentBase64 || ''
          const buf = Buffer.from(b64, 'base64')
          await moonrakerUploadFile(http, name, buf)
          return { ok: true, filename: name, remotePath: name }
        }
        if (req.op === 'downloadFile') {
          const remotePath = req.remotePath || ''
          const buf = await moonrakerDownloadFile(http, remotePath)
          return {
            ok: true,
            filename: remotePath.split('/').pop() || 'download.bin',
            remotePath,
            contentBase64: buf.toString('base64'),
            contentType: 'application/octet-stream'
          }
        }
        return { ok: false, message: `未知操作 ${req.op}` }
      }

      if (brand === 'bambu') {
        const host = deviceHost(d)
        if (!host) {
          return {
            ok: false,
            message:
              d.connectionMode === 'cloud'
                ? '拓竹云端设备缺少局域网 IP。请在设备上填写 bambuHost，并配置 bambuLanAccessCode（局域网访问码）后即可传文件。'
                : '缺少打印机局域网 IP，无法 FTPS 传文件。请在设备设置里填写 bambuHost / IP。'
          }
        }
        const accessCode = await this.bambuLanAccessCode(d)
        if (!accessCode) {
          return {
            ok: false,
            message:
              d.connectionMode === 'cloud'
                ? '云端拓竹需额外配置局域网访问码（bambuLanAccessCode / pluginData.bambuLanAccessCode）才能 FTPS。'
                : '缺少局域网访问码，无法连接打印机 FTPS。'
          }
        }
        if (req.op === 'listFiles') {
          const files = await bambuListFiles({ host, accessCode })
          return { ok: true, files }
        }
        if (req.op === 'uploadFile') {
          const name = req.filename || 'upload.gcode'
          const buf = Buffer.from(req.contentBase64 || '', 'base64')
          const up = await bambuUploadFile({ host, accessCode, filename: name, content: buf })
          return { ok: true, filename: name, remotePath: up.remotePath }
        }
        if (req.op === 'downloadFile') {
          const remotePath = req.remotePath || ''
          const dl = await bambuDownloadFile({ host, accessCode, remotePath })
          return {
            ok: true,
            filename: dl.filename,
            remotePath,
            contentBase64: dl.content.toString('base64'),
            contentType: 'application/octet-stream'
          }
        }
        return { ok: false, message: `未知操作 ${req.op}` }
      }

      return {
        ok: false,
        message: `该设备不支持文件操作（品牌 ${brand || '未知'}，见 getDeviceCapabilities）`
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  async startPrint(req: {
    deviceId: string
    filename: string
    contentBase64?: string
  }): Promise<{ ok: boolean; message?: string; remotePath?: string }> {
    const d = this.findDevice(req.deviceId)
    if (!d) return { ok: false, message: '设备不存在' }
    const brand = String(d.brand || '').toLowerCase()
    if (brand === 'bambu' && d.connectionMode === 'cloud') {
      const host = deviceHost(d)
      const code = await this.bambuLanAccessCode(d)
      if (!host || !code) {
        return {
          ok: false,
          message:
            '拓竹云端开打需同时配置局域网 IP（bambuHost）与访问码（bambuLanAccessCode）。亦可改用「局域网」重新添加。'
        }
      }
    }
    let remotePath = req.filename
    if (req.contentBase64) {
      const up = await this.deviceOp({
        deviceId: req.deviceId,
        op: 'uploadFile',
        filename: req.filename,
        contentBase64: req.contentBase64
      })
      if (!up.ok) return { ok: false, message: up.message || '上传失败' }
      remotePath = up.remotePath || req.filename
    }
    const ctrl = await this.control(req.deviceId, {
      action: 'print_file',
      filename: remotePath
    })
    return { ...ctrl, remotePath }
  }

  async batchPrint(payload: {
    deviceIds: string[]
    filename: string
    contentBase64?: string
  }): Promise<{
    ok: boolean
    results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
  }> {
    const results: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }> =
      []
    for (const deviceId of payload.deviceIds) {
      const d = this.findDevice(deviceId)
      const deviceName = String(d?.name || deviceId)
      if (!d || !canBatchPrint(d)) {
        results.push({ deviceId, deviceName, ok: false, message: '设备不支持批量打印' })
        continue
      }
      try {
        const r = await this.startPrint({
          deviceId,
          filename: payload.filename,
          contentBase64: payload.contentBase64
        })
        if (!r.ok) throw new Error(r.message || '开打失败')
        results.push({ deviceId, deviceName, ok: true })
      } catch (e) {
        results.push({
          deviceId,
          deviceName,
          ok: false,
          message: e instanceof Error ? e.message : String(e)
        })
      }
    }
    return { ok: results.every((r) => r.ok), results }
  }

  async approvedPrint(req: {
    deviceId: string
    filename: string
    contentBase64?: string
  }): Promise<{ ok: boolean; message?: string }> {
    return this.startPrint(req)
  }

  async bootstrap(): Promise<void> {
    const devices = this.deps.readDevices()
    await Promise.all(devices.map((d) => this.connectDevice(d)))
  }
}
