import { useEffect, useReducer, useRef } from 'react'
import { getHanyePlugin, type QuotePageCtx } from '../plugins/runtime'

/** Extra shared-param fields from registerQuoteField */
export function QuotePluginFields({
  ctx
}: {
  ctx: QuotePageCtx
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('quote:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getQuoteFields(ctx.tech)
    if (!fields.length) return
    const cleanups: Array<() => void> = []
    for (const field of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginQuoteField = field.id
      wrap.style.marginBottom = '12px'
      el.appendChild(wrap)
      try {
        const ret = field.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[QuotePluginFields]', field.id, e)
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
    // Only rebuild when field registry / tech changes — not on every quoteCtx identity change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.tech, tick])

  return <div ref={hostRef} className="plugin-quote-fields" />
}

/** Per material-option extra fields */
export function QuoteOptionPluginFields({
  ctx,
  option,
  optionIndex
}: {
  ctx: QuotePageCtx
  option: Record<string, unknown>
  optionIndex: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('quote:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getQuoteOptionFields(ctx.tech)
    if (!fields.length) return
    const cleanups: Array<() => void> = []
    const fieldCtx = { ...ctx, option, optionIndex }
    for (const field of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginQuoteOptionField = field.id
      wrap.style.marginBottom = '8px'
      el.appendChild(wrap)
      try {
        const ret = field.render(wrap, fieldCtx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[QuoteOptionPluginFields]', field.id, e)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.tech, String(option.id ?? ''), optionIndex, tick])

  return <div ref={hostRef} className="plugin-quote-option-fields" />
}

export function applyQuoteCostAdjusts(
  costs: Record<string, number>,
  ctx: QuotePageCtx,
  option: Record<string, unknown>
): Record<string, number> {
  let cur = { ...costs }
  for (const adj of getHanyePlugin().getQuoteCostAdjusts(ctx.tech)) {
    try {
      const next = adj.adjust(cur, { ...ctx, option })
      if (next && typeof next === 'object') cur = next as Record<string, number>
    } catch (e) {
      console.error('[quote cost adjust]', adj.id, e)
    }
  }
  return cur
}
