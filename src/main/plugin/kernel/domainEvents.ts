/**
 * Detect device / print domain events from status snapshots.
 */
export type DomainEvent = {
  name: string
  payload: Record<string, unknown>
}

type Snap = {
  health?: string
  state?: string
  online?: boolean
  filename?: string
  gcodeFile?: string
  progress?: number
  filamentUsedGrams?: number
  brand?: string
  deviceName?: string
  name?: string
}

type PrintTrack = {
  startedAt: string
  filename?: string
  brand?: string
}

const printTracks = new Map<string, PrintTrack>()

function isOnline(st: Snap): boolean {
  const health = String(st.health || '').toLowerCase()
  if (health === 'offline' || health === 'disconnected') return false
  if (st.online === false) return false
  if (st.online === true) return true
  return health !== '' && health !== 'unknown'
}

function isPrinting(state: string): boolean {
  return /print|run|busy|pause/.test(state)
}

function isDone(state: string): boolean {
  return /complete|finish|success|done/.test(state)
}

function isFailed(state: string): boolean {
  return /fail|error|cancel|abort/.test(state)
}

function jobName(st: Snap): string | undefined {
  const f = String(st.filename || st.gcodeFile || '').trim()
  return f || undefined
}

export function detectDomainEvents(
  prev: Map<string, Snap>,
  statuses: Record<string, unknown>,
  deviceBrandById?: Record<string, string>
): DomainEvent[] {
  const out: DomainEvent[] = []
  const at = new Date().toISOString()
  for (const [deviceId, raw] of Object.entries(statuses)) {
    if (!raw || typeof raw !== 'object') continue
    const st = raw as Snap
    const health = String(st.health || '')
    const state = String(st.state || '').toLowerCase()
    const online = isOnline({ health, state, online: st.online })
    const before = prev.get(deviceId)
    const name = st.deviceName || st.name || deviceId
    const brand = String(st.brand || deviceBrandById?.[deviceId] || '')
    const filename = jobName(st)
    const progress =
      typeof st.progress === 'number' && Number.isFinite(st.progress) ? st.progress : undefined
    const filamentUsedGrams =
      typeof st.filamentUsedGrams === 'number' && Number.isFinite(st.filamentUsedGrams)
        ? st.filamentUsedGrams
        : undefined

    prev.set(deviceId, {
      health,
      state,
      online,
      filename: st.filename,
      gcodeFile: st.gcodeFile,
      progress,
      filamentUsedGrams,
      brand,
      deviceName: name
    })
    if (!before) continue

    const wasOnline = before.online === true || isOnline(before)
    if (!wasOnline && online) {
      out.push({
        name: 'action:device.online',
        payload: { deviceId, deviceName: name, brand, state, health, at }
      })
    } else if (wasOnline && !online) {
      out.push({
        name: 'action:device.offline',
        payload: { deviceId, deviceName: name, brand, state, health, at }
      })
    }

    const wasPrinting = isPrinting(before.state || '')
    const nowPrinting = isPrinting(state)
    if (!wasPrinting && nowPrinting) {
      printTracks.set(deviceId, {
        startedAt: at,
        filename: filename || jobName(before),
        brand
      })
      out.push({
        name: 'action:print.started',
        payload: {
          deviceId,
          deviceName: name,
          brand,
          state,
          filename: filename || jobName(before),
          progress: progress ?? 0,
          startedAt: at,
          at
        }
      })
    } else if (wasPrinting && isDone(state)) {
      const track = printTracks.get(deviceId)
      printTracks.delete(deviceId)
      const startedAt = track?.startedAt
      const durationSec = startedAt
        ? Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 1000))
        : undefined
      out.push({
        name: 'action:print.finished',
        payload: {
          deviceId,
          deviceName: name,
          brand: brand || track?.brand,
          state,
          filename: filename || track?.filename || jobName(before),
          progress: progress ?? 100,
          filamentUsedGrams: filamentUsedGrams ?? before.filamentUsedGrams,
          startedAt,
          durationSec,
          at
        }
      })
    } else if (wasPrinting && isFailed(state) && before.state !== state) {
      const track = printTracks.get(deviceId)
      printTracks.delete(deviceId)
      const startedAt = track?.startedAt
      const durationSec = startedAt
        ? Math.max(0, Math.round((Date.parse(at) - Date.parse(startedAt)) / 1000))
        : undefined
      out.push({
        name: 'action:print.failed',
        payload: {
          deviceId,
          deviceName: name,
          brand: brand || track?.brand,
          state,
          filename: filename || track?.filename || jobName(before),
          progress,
          filamentUsedGrams: filamentUsedGrams ?? before.filamentUsedGrams,
          startedAt,
          durationSec,
          at
        }
      })
    }
  }
  return out
}
