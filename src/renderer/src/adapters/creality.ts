import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import { emptyStatus, type PrinterAdapter, type StatusListener } from './base'

function hostFromBaseUrl(baseUrl?: string): string {
  if (!baseUrl) return ''
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`)
    return u.hostname
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

/**
 * Creality Cloud only.
 * LAN Creality uses MoonrakerAdapter (same as Klipper / Qidi).
 */
export class CrealityAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly config: DeviceConfig
  private readonly secret: string
  private readonly host: string
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private unsubCloud: (() => void) | null = null
  private closed = true

  constructor(config: DeviceConfig, apiKey: string) {
    this.deviceId = config.id
    this.config = config
    this.secret = apiKey
    this.host = hostFromBaseUrl(config.baseUrl)
    this.last = emptyStatus(config.id, 'offline')
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', state: 'connecting', message: '连接创想云…' })
    if (!this.secret) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少创想云 Token，请重新登录' })
      throw new Error('缺少创想云 Token')
    }
    const cloudDeviceId = this.config.crealityDeviceId
    if (!cloudDeviceId) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少创想云设备 ID' })
      throw new Error('缺少创想云设备 ID')
    }

    this.unsubCloud?.()
    this.unsubCloud =
      window.electronAPI?.creality?.cloud.onStatus((patch) => {
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

    const res = await window.electronAPI?.creality?.cloud.connect({
      connectionId: this.deviceId,
      token: this.secret,
      userId: this.config.crealityUserId || '0',
      deviceId: cloudDeviceId,
      region: this.config.crealityRegion || 'china',
      host: this.host || undefined
    })
    if (!res?.ok) {
      const message = res?.message || '创想云连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.unsubCloud?.()
    this.unsubCloud = null
    await window.electronAPI?.creality?.cloud.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    await window.electronAPI?.creality?.cloud.control({
      connectionId: this.deviceId,
      action: payload.action
    })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    return []
  }

  async uploadFile(_file: File): Promise<void> {
    throw new Error('创想云暂不支持上传')
  }

  async downloadFile(_remotePath: string): Promise<ArrayBuffer> {
    throw new Error('创想云暂不支持下载')
  }

  async printFile(_remotePath: string): Promise<void> {
    throw new Error('创想云暂不支持远程开打')
  }

  async getCameras() {
    return []
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }
}
