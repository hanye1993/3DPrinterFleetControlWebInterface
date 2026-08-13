import type { PrinterLiveStatus } from '../types/printer'

export type DeviceStatusKind = 'idle' | 'finished' | 'error' | 'printing' | 'offline'

export const DEVICE_STATUS_FILTERS: { value: DeviceStatusKind; label: string }[] = [
  { value: 'idle', label: '空闲' },
  { value: 'finished', label: '打印完成' },
  { value: 'error', label: '报错' },
  { value: 'printing', label: '正在打印' },
  { value: 'offline', label: '离线' }
]

function norm(state?: string): string {
  return String(state || '')
    .trim()
    .toLowerCase()
}

function isErrorStatus(st: PrinterLiveStatus): boolean {
  if (st.health === 'error') return true
  const s = norm(st.state)
  if (!s) return false
  return (
    s === 'failed' ||
    s === 'error' ||
    s === 'fatal' ||
    s.includes('failed') ||
    s.includes('error') ||
    s.startsWith('klippy_')
  )
}

function isFinishedStatus(st: PrinterLiveStatus): boolean {
  const s = norm(st.state)
  return (
    s === 'finish' ||
    s === 'finished' ||
    s === 'complete' ||
    s === 'completed' ||
    s === 'done'
  )
}

function isIdleStatus(st: PrinterLiveStatus): boolean {
  if (st.health === 'offline' || st.health === 'connecting') return false
  const s = norm(st.state)
  return (
    s === 'idle' ||
    s === 'standby' ||
    s === 'ready' ||
    s === 'cancelled' ||
    s === 'canceled'
  )
}

/** Classify live status for filter checkboxes */
export function deviceStatusKind(st?: PrinterLiveStatus | null): DeviceStatusKind {
  if (!st) return 'offline'
  if (st.health === 'offline' || st.health === 'connecting') return 'offline'
  const s = norm(st.state)
  if (s === 'offline' || s === 'connecting' || s === 'reconnecting' || s === 'disconnected') {
    return 'offline'
  }
  if (isErrorStatus(st)) return 'error'
  if (isFinishedStatus(st)) return 'finished'
  if (isIdleStatus(st)) return 'idle'
  return 'printing'
}

/**
 * Card / detail primary line:
 * error → error detail; idle → 机器空闲; finish → 打印完成; else filename / message.
 */
export function deviceStatusLabel(st?: PrinterLiveStatus | null): string {
  if (!st) return '等待状态…'

  if (isErrorStatus(st)) {
    const detail = (st.message || '').trim() || String(st.state || '').trim()
    return detail || '错误'
  }

  if (isFinishedStatus(st)) return '打印完成'

  if (st.health === 'offline' || norm(st.state) === 'offline') {
    return (st.message || '').trim() || '离线'
  }

  if (isIdleStatus(st)) return '机器空闲'

  const file = (st.filename || '').trim()
  if (file) return file

  const msg = (st.message || '').trim()
  if (msg) return msg

  const state = String(st.state || '').trim()
  return state || '等待状态…'
}

/** Short machine-state label for card footer (not filename). */
export function deviceRuntimeStatusLabel(st?: PrinterLiveStatus | null): string {
  if (!st) return '等待状态…'
  const kind = deviceStatusKind(st)
  const s = norm(st.state)

  if (kind === 'offline') {
    if (s === 'connecting' || s === 'reconnecting') return '连接中'
    return '离线'
  }
  if (kind === 'error') return '报错'
  if (kind === 'finished') return '打印完成'
  if (kind === 'idle') return '空闲'

  if (s.includes('pause') || s === 'paused') return '已暂停'
  if (s === 'prepare' || s === 'preparing' || s.includes('heat')) return '准备中'
  if (s === 'slicing') return '切片中'
  if (s === 'running' || s === 'printing' || s === 'print' || s === 'busy') return '正在打印'
  return '正在打印'
}
