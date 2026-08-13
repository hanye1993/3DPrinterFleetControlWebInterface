/**
 * Theme runtime — layout hooks for installable theme packs.
 * Themes' layout.js call window.HanyeTheme.*
 */
export type ThemeSlotRender =
  | string
  | ((
      el: HTMLElement,
      ctx: { slot: string; mode: string; context?: Record<string, unknown> }
    ) => void | (() => void))

type SlotEntry = { id: string; render: ThemeSlotRender; order: number }

type Listener = (payload?: unknown) => void

class HanyeThemeRuntime {
  mode: 'public' | 'app' = 'app'
  private slots = new Map<string, SlotEntry[]>()
  private listeners = new Map<string, Set<Listener>>()
  private scriptMarks: HTMLElement[] = []

  reset(): void {
    this.slots.clear()
    for (const el of this.scriptMarks) {
      try {
        el.remove()
      } catch {
        /* ignore */
      }
    }
    this.scriptMarks = []
    this.emit('reset')
  }

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return () => this.listeners.get(event)?.delete(fn)
  }

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload)
      } catch (e) {
        console.error('[HanyeTheme]', event, e)
      }
    })
  }

  registerSlot(name: string, render: ThemeSlotRender, opts?: { order?: number; id?: string }): void {
    const list = this.slots.get(name) || []
    const id = opts?.id || `theme-${name}-${list.length}`
    list.push({ id, render, order: opts?.order ?? 0 })
    list.sort((a, b) => a.order - b.order)
    this.slots.set(name, list)
    this.emit('slot:change', { name })
  }

  /** Replace a named region (e.g. app.shell.replace) */
  replaceSlot(name: string, render: ThemeSlotRender): void {
    this.registerSlot(`${name}.replace`, render, { order: 0, id: `replace-${name}` })
    this.emit('slot:change', { name: `${name}.replace` })
  }

  shouldReplace(name: string): boolean {
    return (this.slots.get(`${name}.replace`) || []).length > 0
  }

  getSlotEntries(name: string): SlotEntry[] {
    return this.slots.get(name) || []
  }

  trackScript(el: HTMLElement): void {
    this.scriptMarks.push(el)
  }
}

export type HanyeThemeApi = HanyeThemeRuntime

declare global {
  interface Window {
    HanyeTheme?: HanyeThemeRuntime
  }
}

let singleton: HanyeThemeRuntime | null = null

export function getHanyeTheme(): HanyeThemeRuntime {
  if (typeof window !== 'undefined' && window.HanyeTheme) return window.HanyeTheme
  if (!singleton) singleton = new HanyeThemeRuntime()
  if (typeof window !== 'undefined') window.HanyeTheme = singleton
  return singleton
}

export function ensureHanyeTheme(): HanyeThemeRuntime {
  return getHanyeTheme()
}
