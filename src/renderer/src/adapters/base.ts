import type {
  ControlPayload,
  DeviceConfig,
  PrinterFileInfo,
  PrinterLiveStatus
} from '../types/printer'
import type { CameraSource } from './camera'

export type StatusListener = (status: PrinterLiveStatus) => void
export type { CameraSource }

export interface PrinterAdapter {
  readonly deviceId: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(listener: StatusListener): () => void
  control(payload: ControlPayload): Promise<void>
  listFiles(): Promise<PrinterFileInfo[]>
  uploadFile(file: File): Promise<void>
  /** 从打印机下载文件内容，用于保存到本地 */
  downloadFile(remotePath: string): Promise<ArrayBuffer>
  /** 开始打印指定 gcode（相对 gcodes 根路径） */
  printFile(remotePath: string): Promise<void>
  /** 探测可用摄像头；无摄像头返回空数组（界面不显示画面） */
  getCameras(): Promise<CameraSource[]>
}

export function emptyStatus(
  deviceId: string,
  health: PrinterLiveStatus['health'] = 'offline'
): PrinterLiveStatus {
  return {
    deviceId,
    health,
    state: 'unknown',
    progress: 0,
    updatedAt: new Date().toISOString()
  }
}
