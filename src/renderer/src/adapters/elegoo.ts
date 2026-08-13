import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import { emptyStatus, type PrinterAdapter, type StatusListener } from './base'

function hostFromConfig(config: DeviceConfig): string {
  const raw = config.baseUrl || ''
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    return u.hostname
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

export class ElegooAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly host: string
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private unsub: (() => void) | null = null
  private closed = true

  constructor(config: DeviceConfig, _secret: string) {
    this.deviceId = config.id
    this.host = hostFromConfig(config)
    this.last = emptyStatus(config.id, 'offline')
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', state: 'connecting', message: '连接中…' })
    if (!this.host) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少打印机 IP' })
      throw new Error('缺少打印机 IP')
    }

    this.unsub?.()
    this.unsub =
      window.electronAPI?.elegoo?.sdcp.onStatus((patch) => {
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
          message: patch.message,
          updatedAt: patch.updatedAt
        })
      }) ?? null

    const res = await window.electronAPI?.elegoo?.sdcp.connect({
      connectionId: this.deviceId,
      host: this.host
    })
    if (!res?.ok) {
      const message = res?.message || '爱乐库连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.unsub?.()
    this.unsub = null
    await window.electronAPI?.elegoo?.sdcp.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    await window.electronAPI?.elegoo?.sdcp.control({
      connectionId: this.deviceId,
      action: payload.action,
      percent: payload.percent,
      fan: payload.fan
    })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    return []
  }

  async uploadFile(_file: File): Promise<void> {
    throw new Error('爱乐库文件上传后续版本再接入')
  }

  async downloadFile(_remotePath: string): Promise<ArrayBuffer> {
    throw new Error('爱乐库文件下载暂未接入')
  }

  async getCameras() {
    const { discoverDeviceCameras } = await import('./camera')
    return discoverDeviceCameras({
      id: this.deviceId,
      name: '',
      brand: 'elegoo',
      baseUrl: this.host ? `http://${this.host}` : '',
      createdAt: ''
    })
  }

  async printFile(_remotePath: string): Promise<void> {
    throw new Error('爱乐库远程开打后续版本再接入')
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }
}
