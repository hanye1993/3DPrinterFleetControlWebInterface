import { useEffect, useReducer, useRef } from 'react'
import { getHanyePlugin, type QuoteHistoryPageCtx } from '../plugins/runtime'

export function QuoteHistoryPluginFilters({ ctx }: { ctx: QuoteHistoryPageCtx }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('quote-history:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const filters = getHanyePlugin().getQuoteHistoryFilters()
    if (!filters.length) return
    const cleanups: Array<() => void> = []
    for (const f of filters) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginQuoteHistoryFilter = f.id
      wrap.style.display = 'inline-block'
      wrap.style.marginRight = '8px'
      wrap.style.verticalAlign = 'middle'
      el.appendChild(wrap)
      try {
        const ret = f.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[QuoteHistoryPluginFilters]', f.id, e)
      }
    }
    return () => {
      cleanups.forEach((fn) => {
        try {
          fn()
        } catch {
          /* ignore */
        }
      })
      el.innerHTML = ''
    }
  }, [ctx, tick])

  return <span ref={hostRef} className="plugin-quote-history-filters" />
}

export function QuoteHistoryPluginDetailFields({
  ctx,
  record
}: {
  ctx: QuoteHistoryPageCtx
  record: Record<string, unknown>
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('quote-history:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getQuoteHistoryDetailFields()
    if (!fields.length) return
    const cleanups: Array<() => void> = []
    const fieldCtx = { ...ctx, record }
    for (const f of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginQuoteHistoryDetail = f.id
      wrap.style.marginBottom = '8px'
      el.appendChild(wrap)
      try {
        const ret = f.render(wrap, fieldCtx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[QuoteHistoryPluginDetailFields]', f.id, e)
      }
    }
    return () => {
      cleanups.forEach((fn) => {
        try {
          fn()
        } catch {
          /* ignore */
        }
      })
      el.innerHTML = ''
    }
  }, [ctx, record, tick])

  return <div ref={hostRef} className="plugin-quote-history-detail-fields" />
}

export function applyQuoteHistoryClientFilters(
  records: Record<string, unknown>[],
  ctx: QuoteHistoryPageCtx
): Record<string, unknown>[] {
  const filters = getHanyePlugin().getQuoteHistoryFilters().filter((f) => typeof f.match === 'function')
  if (!filters.length) return records
  return records.filter((r) => {
    for (const f of filters) {
      try {
        if (f.match && !f.match(r, ctx)) return false
      } catch (e) {
        console.error('[quote history filter]', f.id, e)
      }
    }
    return true
  })
}
