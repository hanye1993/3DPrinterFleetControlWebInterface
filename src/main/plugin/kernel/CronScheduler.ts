/**
 * Minimal cron scheduler for plugin modules with type=cron.
 * Supports: every:1m | every:5m | every:1h | star-slash-N * * * * | N * * * *
 * Per-job mutex + last status for ops / debug UI.
 */
export type CronJob = {
  pluginId: string
  module: string
  schedule: string
  run: () => Promise<void>
}

export type CronJobStatus = {
  pluginId: string
  module: string
  schedule: string
  lastRunAt?: string
  lastOkAt?: string
  lastError?: string
  lastDurationMs?: number
  running: boolean
  skippedBusy: number
}

function parseEveryMs(schedule: string): number | null {
  const m = schedule.trim().match(/^every:(\d+)(m|h|s)$/i)
  if (!m) return null
  const n = Math.max(1, parseInt(m[1], 10) || 1)
  const u = m[2].toLowerCase()
  if (u === 's') return n * 1000
  if (u === 'h') return n * 3600_000
  return n * 60_000
}

/** True if 5-field cron should fire at `now` (minute resolution). */
export function cronMatches(schedule: string, now = new Date()): boolean {
  const everyMs = parseEveryMs(schedule)
  if (everyMs != null) return true // interval checked via lastRun
  const parts = schedule.trim().split(/\s+/)
  if (parts.length < 5) return false
  const [min, hour, dom, mon, dow] = parts
  const matchField = (field: string, value: number, max: number): boolean => {
    if (field === '*') return true
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10)
      return step > 0 && value % step === 0
    }
    if (field.includes(',')) {
      return field.split(',').some((p) => matchField(p.trim(), value, max))
    }
    if (field.includes('-')) {
      const [a, b] = field.split('-').map((x) => parseInt(x, 10))
      return value >= a && value <= b
    }
    return parseInt(field, 10) === value
  }
  return (
    matchField(min, now.getMinutes(), 59) &&
    matchField(hour, now.getHours(), 23) &&
    matchField(dom, now.getDate(), 31) &&
    matchField(mon, now.getMonth() + 1, 12) &&
    matchField(dow, now.getDay(), 6)
  )
}

export function shouldRunCron(
  schedule: string,
  lastRunIso: string | undefined,
  now = Date.now()
): boolean {
  const everyMs = parseEveryMs(schedule)
  if (everyMs != null) {
    if (!lastRunIso) return true
    const last = Date.parse(lastRunIso)
    if (!Number.isFinite(last)) return true
    return now - last >= everyMs
  }
  if (!cronMatches(schedule, new Date(now))) return false
  if (!lastRunIso) return true
  const last = Date.parse(lastRunIso)
  // avoid double-fire within same minute
  return !Number.isFinite(last) || now - last >= 55_000
}

export class CronScheduler {
  private jobs = new Map<string, CronJob>()
  private timer: ReturnType<typeof setInterval> | null = null
  private lastRun = new Map<string, string>()
  private running = new Set<string>()
  private meta = new Map<
    string,
    {
      lastOkAt?: string
      lastError?: string
      lastDurationMs?: number
      skippedBusy: number
    }
  >()
  private onPersist?: (pluginId: string, module: string, at: string) => void

  constructor(opts?: {
    getLastRun?: (pluginId: string, module: string) => string | undefined
    onPersist?: (pluginId: string, module: string, at: string) => void
  }) {
    if (opts?.getLastRun) {
      this.getLastRun = opts.getLastRun
    }
    this.onPersist = opts?.onPersist
  }

  private getLastRun: (pluginId: string, module: string) => string | undefined = (p, m) =>
    this.lastRun.get(`${p}:${m}`)

  setLastRunLookup(fn: (pluginId: string, module: string) => string | undefined): void {
    this.getLastRun = fn
  }

  register(job: CronJob): void {
    this.jobs.set(`${job.pluginId}:${job.module}`, job)
    if (!this.meta.has(`${job.pluginId}:${job.module}`)) {
      this.meta.set(`${job.pluginId}:${job.module}`, { skippedBusy: 0 })
    }
  }

  clearPlugin(pluginId: string): void {
    for (const key of Array.from(this.jobs.keys())) {
      if (key.startsWith(pluginId + ':')) {
        this.jobs.delete(key)
        this.running.delete(key)
      }
    }
  }

  listStatus(): CronJobStatus[] {
    const out: CronJobStatus[] = []
    for (const [key, job] of Array.from(this.jobs.entries())) {
      const m = this.meta.get(key) || { skippedBusy: 0 }
      out.push({
        pluginId: job.pluginId,
        module: job.module,
        schedule: job.schedule,
        lastRunAt: this.getLastRun(job.pluginId, job.module),
        lastOkAt: m.lastOkAt,
        lastError: m.lastError,
        lastDurationMs: m.lastDurationMs,
        running: this.running.has(key),
        skippedBusy: m.skippedBusy
      })
    }
    return out
  }

  start(intervalMs = 30_000): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), intervalMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      try {
        ;(this.timer as NodeJS.Timeout).unref()
      } catch {
        /* ignore */
      }
    }
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(): Promise<void> {
    const now = Date.now()
    for (const job of Array.from(this.jobs.values())) {
      const key = `${job.pluginId}:${job.module}`
      const last = this.getLastRun(job.pluginId, job.module)
      if (!shouldRunCron(job.schedule, last, now)) continue
      if (this.running.has(key)) {
        const m = this.meta.get(key) || { skippedBusy: 0 }
        m.skippedBusy++
        this.meta.set(key, m)
        continue
      }
      const at = new Date(now).toISOString()
      this.lastRun.set(key, at)
      this.onPersist?.(job.pluginId, job.module, at)
      this.running.add(key)
      const t0 = Date.now()
      try {
        await job.run()
        const m = this.meta.get(key) || { skippedBusy: 0 }
        m.lastOkAt = new Date().toISOString()
        m.lastError = undefined
        m.lastDurationMs = Date.now() - t0
        this.meta.set(key, m)
      } catch (e) {
        const m = this.meta.get(key) || { skippedBusy: 0 }
        m.lastError = e instanceof Error ? e.message : String(e)
        m.lastDurationMs = Date.now() - t0
        this.meta.set(key, m)
        console.error(`[cron:${job.pluginId}/${job.module}]`, e)
      } finally {
        this.running.delete(key)
      }
    }
  }
}
