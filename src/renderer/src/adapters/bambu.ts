import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import { emptyStatus, type PrinterAdapter, type StatusListener } from './base'

/**
 * Bambu Lab adapter — MQTT via Electron main process.
 * - LAN: mqtts://{ip}:8883 user=bblp password=access_code
 * - Cloud: mqtts://{region}.mqtt.bambulab.com:8883 user=u_{uid} password=access_token
 */
export class BambuAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly config: DeviceConfig
  private readonly secret: string
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private unsubStatus: (() => void) | null = null
  private closed = true

  constructor(config: DeviceConfig, secret: string) {
    this.deviceId = config.id
    this.config = config
    this.secret = secret
    this.last = emptyStatus(config.id, 'offline')
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', message: '连接中…', state: 'connecting' })

    if (!this.config.bambuDeviceId) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少设备序列号' })
      throw new Error('缺少设备序列号')
    }
    if (!this.secret) {
      this.emit({
        ...emptyStatus(this.deviceId, 'error'),
        message:
          this.config.connectionMode === 'cloud' ? '缺少云端登录令牌，请重新登录账号' : '缺少局域网访问码'
      })
      throw new Error('缺少认证信息')
    }

    this.unsubStatus?.()
    this.unsubStatus =
      window.electronAPI?.bambu.mqtt.onStatus((patch) => {
        if (patch.connectionId !== this.deviceId || this.closed) return
        this.emit({
          deviceId: this.deviceId,
          health: patch.health,
          state: patch.state,
          progress: patch.progress,
          remainingSeconds: patch.remainingSeconds,
          layer: patch.layer,
          layerTotal: patch.layerTotal,
          extruder: patch.extruder,
          bed: patch.bed,
          boardTemp: patch.boardTemp ?? 0,
          chamberTemp: patch.chamberTemp ?? 0,
          fanSpeed: patch.fanSpeed,
          chamberFanSpeed: patch.chamberFanSpeed,
          printSpeed: patch.printSpeed,
          filename: patch.filename,
          gcodeFile: patch.gcodeFile,
          amsSlots: patch.amsSlots,
          message: patch.message,
          updatedAt: patch.updatedAt
        })
      }) ?? null

    const mode = this.config.connectionMode === 'cloud' ? 'cloud' : 'lan'
    const res = await window.electronAPI?.bambu.mqtt.connect({
      connectionId: this.deviceId,
      serial: this.config.bambuDeviceId,
      mode,
      host: this.config.bambuHost,
      region: this.config.bambuRegion || 'global',
      password: this.secret,
      userId: this.config.bambuUserId
    })

    if (!res?.ok) {
      const message = res?.message || 'MQTT 连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.unsubStatus?.()
    this.unsubStatus = null
    await window.electronAPI?.bambu.mqtt.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    await window.electronAPI?.bambu.mqtt.control({
      connectionId: this.deviceId,
      action: payload.action,
      temperature: payload.temperature,
      heater: payload.heater,
      percent: payload.percent,
      filename: payload.filename,
      slot: payload.slot,
      fan: payload.fan,
      axis: payload.axis,
      amount: payload.amount
    })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    return []
  }

  async uploadFile(_file: File): Promise<void> {
    throw new Error('Bambu 文件上传请使用 Bambu Studio / Handy，后续版本再接入')
  }

  async downloadFile(_remotePath: string): Promise<ArrayBuffer> {
    throw new Error('Bambu 文件下载暂未接入')
  }

  async printFile(remotePath: string): Promise<void> {
    await this.control({ action: 'print_file', filename: remotePath })
  }

  async getCameras() {
    const { discoverDeviceCameras } = await import('./camera')
    // LAN chamber cam (:6000) needs access code — cloud MQTT token is not valid here
    const accessCode =
      this.config.connectionMode === 'lan' || (this.secret && this.secret.length <= 32)
        ? this.secret
        : undefined
    return discoverDeviceCameras(this.config, accessCode)
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }
}
