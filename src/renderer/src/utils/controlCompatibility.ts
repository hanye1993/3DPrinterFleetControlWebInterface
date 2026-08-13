import type { PrinterLiveStatus } from '../types/printer'

export type BatchControlAction = 'pause' | 'resume' | 'cancel'

function norm(state?: string): string {
  return String(state || '')
    .trim()
    .toLowerCase()
}

function isOffline(st?: PrinterLiveStatus | null): boolean {
  if (!st) return true
  if (st.health === 'offline' || st.health === 'connecting') return true
  const s = norm(st.state)
  return (
    s === 'offline' ||
    s === 'connecting' ||
    s === 'reconnecting' ||
    s === 'disconnected'
  )
}

function isPaused(st: PrinterLiveStatus): boolean {
  const s = norm(st.state)
  return (
    s === 'paused' ||
    s === 'pause' ||
    s === 'pausing' ||
    s.includes('paused') ||
    (s.includes('pause') && !s.includes('unpause'))
  )
}

function isActivelyPrinting(st: PrinterLiveStatus): boolean {
  if (isOffline(st) || isPaused(st)) return false
  const s = norm(st.state)
  if (
    s === 'idle' ||
    s === 'standby' ||
    s === 'ready' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'stopped' ||
    s === 'finish' ||
    s === 'finished' ||
    s === 'complete' ||
    s === 'completed' ||
    s === 'done' ||
    s === 'failed' ||
    s === 'error' ||
    s === 'fatal' ||
    s === 'free' ||
    s.startsWith('klippy_')
  ) {
    return false
  }
  // printing / running / preparing / heating / etc.
  return (
    s === 'printing' ||
    s === 'running' ||
    s === 'print' ||
    s === 'busy' ||
    s === 'print_start' ||
    s === 'preheating' ||
    s === 'homing' ||
    s === 'prepare' ||
    s === 'preparing' ||
    s === 'slicing' ||
    s === 'resuming' ||
    s === 'auto_leveling' ||
    s === 'file_checking' ||
    s === 'printer_checking' ||
    s === 'resonance_testing' ||
    s.includes('heat') ||
    s.includes('print') ||
    s.includes('run')
  )
}

function isStoppable(st: PrinterLiveStatus): boolean {
  if (isOffline(st)) return false
  return isPaused(st) || isActivelyPrinting(st)
}

/** Whether live status allows this batch control action (brand-agnostic). */
export function canApplyBatchControl(
  action: BatchControlAction,
  st?: PrinterLiveStatus | null
): { ok: true } | { ok: false; reason: string } {
  if (isOffline(st)) {
    return { ok: false, reason: '设备离线或未连接' }
  }
  const state = String(st?.state || '').trim() || '未知'
  if (action === 'pause') {
    if (isPaused(st!)) return { ok: false, reason: `已暂停，跳过（${state}）` }
    if (!isActivelyPrinting(st!)) return { ok: false, reason: `当前不可暂停（${state}）` }
    return { ok: true }
  }
  if (action === 'resume') {
    if (!isPaused(st!)) return { ok: false, reason: `当前不可继续（${state}）` }
    return { ok: true }
  }
  // cancel / stop
  if (!isStoppable(st!)) return { ok: false, reason: `当前不可停止（${state}）` }
  return { ok: true }
}

export function batchControlActionLabel(action: BatchControlAction): string {
  if (action === 'pause') return '暂停'
  if (action === 'resume') return '继续'
  return '停止'
}
