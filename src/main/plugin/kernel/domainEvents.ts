/**
 * Detect device / print domain events from status snapshots.
 */
export type DomainEvent = {
  name: string
  payload: Record<string, unknown>
}

type Snap = { health?: string; state?: string; online?: boolean }

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

export function detectDomainEvents(
  prev: Map<string, Snap>,
  statuses: Record<string, unknown>
): DomainEvent[] {
  const out: DomainEvent[] = []
  const at = new Date().toISOString()
  for (const [deviceId, raw] of Object.entries(statuses)) {
    if (!raw || typeof raw !== 'object') continue
    const st = raw as Snap & { deviceName?: string; name?: string }
    const health = String(st.health || '')
    const state = String(st.state || '').toLowerCase()
    const online = isOnline({ health, state, online: st.online })
    const before = prev.get(deviceId)
    const name = st.deviceName || st.name || deviceId
    prev.set(deviceId, { health, state, online })
    if (!before) continue

    const wasOnline = before.online === true || isOnline(before)
    if (!wasOnline && online) {
      out.push({
        name: 'action:device.online',
        payload: { deviceId, deviceName: name, state, health, at }
      })
    } else if (wasOnline && !online) {
      out.push({
        name: 'action:device.offline',
        payload: { deviceId, deviceName: name, state, health, at }
      })
    }

    const wasPrinting = isPrinting(before.state || '')
    const nowPrinting = isPrinting(state)
    if (!wasPrinting && nowPrinting) {
      out.push({
        name: 'action:print.started',
        payload: { deviceId, deviceName: name, state, at }
      })
    } else if (wasPrinting && isDone(state)) {
      out.push({
        name: 'action:print.finished',
        payload: { deviceId, deviceName: name, state, at }
      })
    } else if (wasPrinting && isFailed(state) && before.state !== state) {
      out.push({
        name: 'action:print.failed',
        payload: { deviceId, deviceName: name, state, at }
      })
    }
  }
  return out
}
