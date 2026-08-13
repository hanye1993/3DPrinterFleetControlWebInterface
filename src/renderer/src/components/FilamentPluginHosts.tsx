import { useEffect, useReducer, useRef } from 'react'
import type { FormInstance } from 'antd'
import {
  getHanyePlugin,
  type FilamentFormCtx
} from '../plugins/runtime'
import type { SpoolRecord } from '../types/filament'

function buildCtx(
  form: FormInstance,
  tech: 'fdm' | 'resin',
  mode: 'create' | 'edit',
  spool: Record<string, unknown> | null
): FilamentFormCtx {
  return {
    tech,
    mode,
    spool,
    getFieldValue: (name) => form.getFieldValue(name),
    getFieldsValue: () => form.getFieldsValue(true) as Record<string, unknown>,
    setFieldsValue: (values) => form.setFieldsValue(values),
    validateFields: async (names) =>
      (await form.validateFields(names)) as Record<string, unknown>
  }
}

/** Extra field blocks from registerFilamentField */
export function FilamentPluginFields({
  form,
  tech,
  mode,
  spool
}: {
  form: FormInstance
  tech: 'fdm' | 'resin'
  mode: 'create' | 'edit'
  spool: SpoolRecord | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('filament:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getFilamentFields({ tech, mode })
    if (!fields.length) return
    const ctx = buildCtx(form, tech, mode, spool as Record<string, unknown> | null)
    const cleanups: Array<() => void> = []
    for (const field of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginFilamentField = field.id
      wrap.style.marginBottom = '12px'
      el.appendChild(wrap)
      try {
        const ret = field.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[FilamentPluginFields]', field.id, e)
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
  }, [form, tech, mode, spool, tick])

  return <div ref={hostRef} className="plugin-filament-fields" />
}

export function applyFilamentFieldCollect(
  form: FormInstance,
  tech: 'fdm' | 'resin',
  mode: 'create' | 'edit',
  spool: SpoolRecord | null,
  payload: Record<string, unknown>
): Record<string, unknown> {
  let cur = { ...payload }
  const ctx = buildCtx(form, tech, mode, spool as Record<string, unknown> | null)
  for (const field of getHanyePlugin().getFilamentFields({ tech, mode })) {
    if (typeof field.collect !== 'function') continue
    try {
      const next = field.collect(ctx, cur)
      if (next && typeof next === 'object') cur = next
    } catch (e) {
      console.error('[filament collect]', field.id, e)
    }
  }
  return cur
}

/** Seed form values from spool pluginData / x_* / plugin_* */
export function filamentPluginFormSeed(row: SpoolRecord | null): Record<string, unknown> {
  if (!row) return {}
  const out: Record<string, unknown> = {
    ...((row.pluginData && typeof row.pluginData === 'object' ? row.pluginData : {}) as Record<
      string,
      unknown
    >)
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('x_') || k.startsWith('plugin_')) out[k] = v
  }
  return out
}

/** Keep prior plugin extras when editing, unless collect overwrites */
export function filamentPreserveExtras(row: SpoolRecord | null): Record<string, unknown> {
  if (!row) return {}
  const out: Record<string, unknown> = {}
  if (row.pluginData && typeof row.pluginData === 'object') {
    out.pluginData = { ...row.pluginData }
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('x_') || k.startsWith('plugin_')) out[k] = v
  }
  return out
}

export { buildCtx as buildFilamentFormCtx }
