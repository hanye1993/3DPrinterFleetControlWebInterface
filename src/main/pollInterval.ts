/** Shared poll interval for main-process LAN / cloud status timers */

let getter: () => number = () => 3000

export function setDevicePollMsGetter(fn: () => number): void {
  getter = fn
}

export function getDevicePollMs(): number {
  const ms = Number(getter())
  if (!Number.isFinite(ms) || ms < 1000) return 3000
  return Math.min(60_000, Math.max(1000, Math.round(ms)))
}
