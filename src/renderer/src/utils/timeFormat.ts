/** 剩余秒数 →「2h 15m」/「45m」 */
export function formatRemain(sec?: number): string {
  if (sec == null || Number.isNaN(sec) || !Number.isFinite(sec)) return '--'
  if (sec <= 0) return '0m'
  const m = Math.floor(sec / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

/**
 * 根据剩余秒数推算完成时刻，如「20:05」「明天 08:30」「8/7 14:00」
 */
export function formatEtaFinish(remainingSeconds?: number, now = new Date()): string {
  if (
    remainingSeconds == null ||
    Number.isNaN(remainingSeconds) ||
    !Number.isFinite(remainingSeconds) ||
    remainingSeconds <= 0
  ) {
    return '--'
  }
  const eta = new Date(now.getTime() + remainingSeconds * 1000)
  const hh = String(eta.getHours()).padStart(2, '0')
  const mm = String(eta.getMinutes()).padStart(2, '0')
  const time = `${hh}:${mm}`

  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startEta = new Date(eta.getFullYear(), eta.getMonth(), eta.getDate()).getTime()
  const dayDiff = Math.round((startEta - startToday) / 86_400_000)

  if (dayDiff <= 0) return time
  if (dayDiff === 1) return `明天 ${time}`
  if (dayDiff === 2) return `后天 ${time}`
  return `${eta.getMonth() + 1}/${eta.getDate()} ${time}`
}
