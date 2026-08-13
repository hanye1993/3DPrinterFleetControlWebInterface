import type { ActionHookFn, FilterHookFn, HookBus, HookPriority, HookRuntime } from '../../../shared/pluginKernel'

type Entry = {
  fn: FilterHookFn | ActionHookFn
  priority: HookPriority
  pluginId: string
}

export type HookBusStats = {
  invocations: number
  errors: number
  timeouts: number
  circuitOpens: number
  lastError?: { hook: string; pluginId: string; message: string; at: string }
  byPlugin: Record<
    string,
    { invocations: number; errors: number; timeouts: number; openUntil?: number }
  >
}

const DEFAULT_TIMEOUT_MS = 5000
const CIRCUIT_FAIL_THRESHOLD = 8
const CIRCUIT_OPEN_MS = 30_000

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`hook timeout ${ms}ms: ${label}`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/**
 * Hook bus with per-plugin fault isolation:
 * - try/catch around every handler
 * - timeout (default 5s)
 * - circuit breaker after repeated failures
 */
export class DefaultHookBus implements HookBus {
  private hooks = new Map<string, Entry[]>()
  private stats: HookBusStats = {
    invocations: 0,
    errors: 0,
    timeouts: 0,
    circuitOpens: 0,
    byPlugin: {}
  }
  private circuit = new Map<string, { fails: number; openUntil: number }>()
  timeoutMs = DEFAULT_TIMEOUT_MS

  getStats(): HookBusStats {
    const byPlugin = { ...this.stats.byPlugin }
    for (const [id, c] of Array.from(this.circuit.entries())) {
      byPlugin[id] = {
        ...(byPlugin[id] || { invocations: 0, errors: 0, timeouts: 0 }),
        openUntil: c.openUntil > Date.now() ? c.openUntil : undefined
      }
    }
    return { ...this.stats, byPlugin }
  }

  resetStats(): void {
    this.stats = {
      invocations: 0,
      errors: 0,
      timeouts: 0,
      circuitOpens: 0,
      byPlugin: {}
    }
    this.circuit.clear()
  }

  private bump(pluginId: string, field: 'invocations' | 'errors' | 'timeouts'): void {
    this.stats[field]++
    const id = pluginId || '_host'
    if (!this.stats.byPlugin[id]) {
      this.stats.byPlugin[id] = { invocations: 0, errors: 0, timeouts: 0 }
    }
    this.stats.byPlugin[id][field]++
  }

  private isOpen(pluginId: string): boolean {
    if (!pluginId) return false
    const c = this.circuit.get(pluginId)
    if (!c) return false
    if (c.openUntil > Date.now()) return true
    if (c.openUntil && c.openUntil <= Date.now()) {
      this.circuit.set(pluginId, { fails: 0, openUntil: 0 })
    }
    return false
  }

  private recordFail(pluginId: string, hook: string, err: unknown, kind: 'error' | 'timeout'): void {
    if (kind === 'timeout') this.bump(pluginId, 'timeouts')
    else this.bump(pluginId, 'errors')
    const msg = err instanceof Error ? err.message : String(err)
    this.stats.lastError = {
      hook,
      pluginId,
      message: msg,
      at: new Date().toISOString()
    }
    if (!pluginId) return
    const c = this.circuit.get(pluginId) || { fails: 0, openUntil: 0 }
    c.fails++
    if (c.fails >= CIRCUIT_FAIL_THRESHOLD) {
      c.openUntil = Date.now() + CIRCUIT_OPEN_MS
      c.fails = 0
      this.stats.circuitOpens++
      console.error(`[hook] circuit OPEN plugin=${pluginId} for ${CIRCUIT_OPEN_MS}ms`)
    }
    this.circuit.set(pluginId, c)
  }

  private recordOk(pluginId: string): void {
    if (!pluginId) return
    const c = this.circuit.get(pluginId)
    if (c && c.openUntil <= Date.now()) {
      this.circuit.set(pluginId, { fails: 0, openUntil: 0 })
    }
  }

  on(
    name: string,
    fn: FilterHookFn | ActionHookFn,
    opts?: { priority?: HookPriority; pluginId?: string }
  ): () => void {
    const entry: Entry = {
      fn,
      priority: opts?.priority ?? 100,
      pluginId: opts?.pluginId || ''
    }
    const list = this.hooks.get(name) || []
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority)
    this.hooks.set(name, list)
    return () => this.off(name, fn)
  }

  off(name: string, fn: FilterHookFn | ActionHookFn): void {
    const list = this.hooks.get(name)
    if (!list) return
    this.hooks.set(
      name,
      list.filter((e) => e.fn !== fn)
    )
  }

  clearPlugin(pluginId: string): void {
    for (const [name, list] of Array.from(this.hooks.entries())) {
      this.hooks.set(
        name,
        list.filter((e: Entry) => e.pluginId !== pluginId)
      )
    }
    this.circuit.delete(pluginId)
  }

  applySync<T>(name: string, value: T, hostCtx?: unknown): T {
    const list = this.hooks.get(name) || []
    let cur: unknown = value
    let aborted = false
    let reason = ''
    for (const e of list) {
      if (aborted) break
      if (this.isOpen(e.pluginId)) continue
      this.bump(e.pluginId, 'invocations')
      const rt: HookRuntime = {
        pluginId: e.pluginId,
        aborted: false,
        reason: undefined,
        hostCtx,
        abort: (msg?: string) => {
          aborted = true
          reason = msg || 'aborted'
          rt.aborted = true
          rt.reason = reason
        }
      }
      try {
        const next = (e.fn as FilterHookFn)(cur, rt) as unknown
        if (next !== undefined && next !== null && typeof (next as { then?: unknown }).then === 'function') {
          void withTimeout(Promise.resolve(next), this.timeoutMs, `${name}@${e.pluginId}`)
            .then((v) => {
              this.recordOk(e.pluginId)
              void v
            })
            .catch((err) => {
              const kind =
                err instanceof Error && err.message.includes('timeout') ? 'timeout' : 'error'
              this.recordFail(e.pluginId, name, err, kind)
              console.error(`[hook:${name}][${e.pluginId}] async`, err)
            })
        } else if (next !== undefined) {
          cur = next
          this.recordOk(e.pluginId)
        } else {
          this.recordOk(e.pluginId)
        }
        if (rt.aborted) aborted = true
      } catch (err) {
        this.recordFail(e.pluginId, name, err, 'error')
        console.error(`[hook:${name}][${e.pluginId}]`, err)
      }
    }
    return cur as T
  }

  async apply<T>(name: string, value: T, hostCtx?: unknown): Promise<T> {
    const list = this.hooks.get(name) || []
    let cur: unknown = value
    let aborted = false
    let reason = ''
    for (const e of list) {
      if (aborted) break
      if (this.isOpen(e.pluginId)) continue
      this.bump(e.pluginId, 'invocations')
      const rt: HookRuntime = {
        pluginId: e.pluginId,
        aborted: false,
        reason: undefined,
        hostCtx,
        abort: (msg?: string) => {
          aborted = true
          reason = msg || 'aborted'
          rt.aborted = true
          rt.reason = reason
        }
      }
      try {
        const next = await withTimeout(
          Promise.resolve((e.fn as FilterHookFn)(cur, rt)),
          this.timeoutMs,
          `${name}@${e.pluginId}`
        )
        if (next !== undefined) cur = next
        if (rt.aborted) {
          aborted = true
          if (cur && typeof cur === 'object') {
            ;(cur as Record<string, unknown>).__aborted = true
            ;(cur as Record<string, unknown>).__abort_reason = reason
          }
        }
        this.recordOk(e.pluginId)
      } catch (err) {
        const kind = err instanceof Error && err.message.includes('timeout') ? 'timeout' : 'error'
        this.recordFail(e.pluginId, name, err, kind)
        console.error(`[hook:${name}][${e.pluginId}]`, err)
      }
    }
    return cur as T
  }

  async emit(name: string, payload?: unknown, hostCtx?: unknown): Promise<void> {
    const list = this.hooks.get(name) || []
    let aborted = false
    for (const e of list) {
      if (aborted) break
      if (this.isOpen(e.pluginId)) continue
      this.bump(e.pluginId, 'invocations')
      const rt: HookRuntime = {
        pluginId: e.pluginId,
        aborted: false,
        hostCtx,
        abort: (msg?: string) => {
          aborted = true
          rt.aborted = true
          rt.reason = msg || 'aborted'
        }
      }
      try {
        await withTimeout(
          Promise.resolve((e.fn as ActionHookFn)(payload, rt)),
          this.timeoutMs,
          `${name}@${e.pluginId}`
        )
        this.recordOk(e.pluginId)
      } catch (err) {
        const kind = err instanceof Error && err.message.includes('timeout') ? 'timeout' : 'error'
        this.recordFail(e.pluginId, name, err, kind)
        console.error(`[hook:${name}][${e.pluginId}]`, err)
      }
    }
  }

  list(name?: string): Array<{ name: string; pluginId: string; priority: number }> {
    const out: Array<{ name: string; pluginId: string; priority: number }> = []
    for (const [n, list] of Array.from(this.hooks.entries())) {
      if (name && n !== name) continue
      for (const e of list) {
        out.push({ name: n, pluginId: e.pluginId, priority: e.priority })
      }
    }
    return out
  }
}
