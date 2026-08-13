import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import { emptyStatus, type PrinterAdapter, type StatusListener } from './base'

function hostFromConfig(config: DeviceConfig): string {
  const raw = config.baseUrl || config.bambuHost || ''
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    return u.hostname
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

export class FlashforgeAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly config: DeviceConfig
  private readonly checkCode: string
  private readonly host: string
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private unsub: (() => void) | null = null
  private closed = true

  constructor(config: DeviceConfig, checkCode: string) {
    this.deviceId = config.id
    this.config = config
    this.checkCode = checkCode
    this.host = hostFromConfig(config)
    this.last = emptyStatus(config.id, 'offline')
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', state: 'connecting', message: '连接中…' })
    const serial = this.config.flashforgeSerial
    if (!this.host || !serial || !this.checkCode) {
      this.emit({
        ...emptyStatus(this.deviceId, 'error'),
        message: '缺少 IP / 序列号 / CheckCode'
      })
      throw new Error('缺少闪铸连接参数')
    }

    this.unsub?.()
    this.unsub =
      window.electronAPI?.flashforge?.lan.onStatus((patch) => {
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
          fanSpeed: patch.fanSpeed,
          printSpeed: patch.printSpeed,
          filename: patch.filename,
          message: patch.message,
          updatedAt: patch.updatedAt
        })
      }) ?? null

    const res = await window.electronAPI?.flashforge?.lan.connect({
      connectionId: this.deviceId,
      host: this.host,
      serial,
      checkCode: this.checkCode
    })
    if (!res?.ok) {
      const message = res?.message || '闪铸连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.unsub?.()
    this.unsub = null
    await window.electronAPI?.flashforge?.lan.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    await window.electronAPI?.flashforge?.lan.control({
      connectionId: this.deviceId,
      action: payload.action
    })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    return []
  }

  async uploadFile(_file: File): Promise<void> {
    throw new Error('闪铸文件上传后续版本再接入')
  }

  async downloadFile(_remotePath: string): Promise<ArrayBuffer> {
    throw new Error('闪铸文件下载暂未接入')
  }

  async printFile(_remotePath: string): Promise<void> {
    throw new Error('闪铸远程开打后续版本再接入')
  }

  async getCameras() {
    const { discoverDeviceCameras } = await import('./camera')
    return discoverDeviceCameras(this.config)
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }
}
