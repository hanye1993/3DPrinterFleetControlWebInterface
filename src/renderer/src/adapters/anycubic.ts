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

export class AnycubicAdapter implements PrinterAdapter {
  readonly deviceId: string
  private readonly config: DeviceConfig
  private readonly secret: string
  private readonly host: string
  private listeners = new Set<StatusListener>()
  private last: PrinterLiveStatus
  private unsub: (() => void) | null = null
  private closed = true

  constructor(config: DeviceConfig, secret: string) {
    this.deviceId = config.id
    this.config = config
    this.secret = secret
    this.host = hostFromConfig(config)
    this.last = emptyStatus(config.id, 'offline')
  }

  async connect(): Promise<void> {
    this.closed = false
    this.emit({ ...this.last, health: 'connecting', state: 'connecting', message: '连接中…' })

    if (this.config.connectionMode === 'cloud') {
      await this.connectCloud()
      return
    }

    if (!this.host) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少打印机 IP' })
      throw new Error('缺少打印机 IP')
    }

    this.unsub?.()
    this.unsub =
      window.electronAPI?.anycubic?.lan.onStatus((patch) => {
        if (patch.connectionId !== this.deviceId || this.closed) return
        this.applyPatch(patch)
      }) ?? null

    const res = await window.electronAPI?.anycubic?.lan.connect({
      connectionId: this.deviceId,
      host: this.host
    })
    if (!res?.ok) {
      const message = res?.message || '纵维立方连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  async disconnect(): Promise<void> {
    this.closed = true
    this.unsub?.()
    this.unsub = null
    await window.electronAPI?.anycubic?.lan.disconnect(this.deviceId)
    await window.electronAPI?.anycubic?.cloud.disconnect(this.deviceId)
    this.emit(emptyStatus(this.deviceId, 'offline'))
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener)
    listener(this.last)
    return () => this.listeners.delete(listener)
  }

  async control(payload: ControlPayload): Promise<void> {
    if (this.config.connectionMode === 'cloud') {
      await window.electronAPI?.anycubic?.cloud.control({
        connectionId: this.deviceId,
        action: payload.action
      })
      return
    }
    await window.electronAPI?.anycubic?.lan.control({
      connectionId: this.deviceId,
      action: payload.action,
      temperature: payload.temperature,
      heater: payload.heater,
      percent: payload.percent
    })
  }

  async listFiles(): Promise<PrinterFileInfo[]> {
    return []
  }

  async uploadFile(_file: File): Promise<void> {
    throw new Error('纵维立方文件上传后续版本再接入')
  }

  async downloadFile(_remotePath: string): Promise<ArrayBuffer> {
    throw new Error('纵维立方文件下载暂未接入')
  }

  async printFile(_remotePath: string): Promise<void> {
    throw new Error('纵维立方远程开打后续版本再接入')
  }

  async getCameras() {
    if (this.config.connectionMode === 'cloud') return []
    const { discoverDeviceCameras } = await import('./camera')
    return discoverDeviceCameras(this.config)
  }

  private async connectCloud(): Promise<void> {
    if (!this.secret) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少纵维云 Token' })
      throw new Error('缺少纵维云 Token')
    }
    const printerId = this.config.anycubicPrinterId
    if (!printerId) {
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message: '缺少纵维云打印机 ID' })
      throw new Error('缺少纵维云打印机 ID')
    }

    this.unsub?.()
    this.unsub =
      window.electronAPI?.anycubic?.cloud.onStatus((patch) => {
        if (patch.connectionId !== this.deviceId || this.closed) return
        this.applyPatch(patch)
      }) ?? null

    const res = await window.electronAPI?.anycubic?.cloud.connect({
      connectionId: this.deviceId,
      token: this.secret,
      printerId,
      mode: this.config.anycubicAuthMode || 'web'
    })
    if (!res?.ok) {
      const message = res?.message || '纵维云连接失败'
      this.emit({ ...emptyStatus(this.deviceId, 'error'), message })
      throw new Error(message)
    }
  }

  private applyPatch(patch: {
    health: PrinterLiveStatus['health']
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
  }): void {
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
  }

  private emit(status: PrinterLiveStatus): void {
    this.last = { ...status, deviceId: this.deviceId, updatedAt: new Date().toISOString() }
    this.listeners.forEach((l) => l(this.last))
  }
}
