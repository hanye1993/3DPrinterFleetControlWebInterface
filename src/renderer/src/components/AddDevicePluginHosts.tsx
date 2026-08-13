import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { FormInstance } from 'antd'
import type { PrinterTech } from '../types/printer'
import {
  getHanyePlugin,
  type AddDeviceBrandDef,
  type AddDeviceFormCtx
} from '../plugins/runtime'
import { newId } from '../utils/id'

function buildCtx(
  form: FormInstance,
  tech: PrinterTech,
  brand: string,
  connectionMode?: string
): AddDeviceFormCtx {
  return {
    tech,
    brand,
    connectionMode,
    getFieldValue: (name) => form.getFieldValue(name),
    getFieldsValue: () => form.getFieldsValue(true) as Record<string, unknown>,
    setFieldsValue: (values) => form.setFieldsValue(values),
    validateFields: async (names) =>
      (await form.validateFields(names)) as Record<string, unknown>,
    newId
  }
}

/** Renders plugin brand form + connection-mode fields into a host div */
export function AddDeviceBrandPluginForm({
  form,
  tech,
  brand,
  connectionMode,
  brandDef
}: {
  form: FormInstance
  tech: PrinterTech
  brand: string
  connectionMode?: string
  brandDef?: AddDeviceBrandDef
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const conn = useMemo(() => {
    if (!brandDef?.connections?.length) return undefined
    const mode =
      connectionMode ||
      brandDef.connections.find((c) => c.default)?.id ||
      brandDef.connections[0]?.id
    return brandDef.connections.find((c) => c.id === mode)
  }, [brandDef, connectionMode])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !brandDef) {
      if (el) el.innerHTML = ''
      return
    }
    el.innerHTML = ''
    const ctx = buildCtx(form, tech, brand, connectionMode)
    const cleanups: Array<() => void> = []
    try {
      if (typeof brandDef.renderForm === 'function') {
        const ret = brandDef.renderForm(el, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      }
      if (conn && typeof conn.render === 'function') {
        const wrap = document.createElement('div')
        wrap.dataset.pluginAddConn = conn.id
        el.appendChild(wrap)
        const ret = conn.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      }
    } catch (e) {
      console.error('[AddDeviceBrandPluginForm]', e)
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
  }, [form, tech, brand, connectionMode, brandDef, conn])

  if (!brandDef) return null
  return <div ref={hostRef} className="plugin-add-device-brand-form" style={{ marginBottom: 12 }} />
}

/** Extra field blocks from registerAddDeviceField */
export function AddDevicePluginFields({
  form,
  tech,
  brand,
  connectionMode
}: {
  form: FormInstance
  tech: PrinterTech
  brand: string
  connectionMode?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('add-device:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getAddDeviceFields({ tech, brand })
    if (!fields.length) return
    const ctx = buildCtx(form, tech, brand, connectionMode)
    const cleanups: Array<() => void> = []
    for (const field of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginAddField = field.id
      wrap.style.marginBottom = '12px'
      el.appendChild(wrap)
      try {
        const ret = field.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[AddDevicePluginFields]', field.id, e)
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
  }, [form, tech, brand, connectionMode, tick])

  return <div ref={hostRef} className="plugin-add-device-fields" />
}

export function applyAddDeviceFieldCollect(
  form: FormInstance,
  tech: PrinterTech,
  brand: string,
  connectionMode: string | undefined,
  device: Record<string, unknown>
): Record<string, unknown> {
  let cur = { ...device }
  const ctx = buildCtx(form, tech, brand, connectionMode)
  for (const field of getHanyePlugin().getAddDeviceFields({ tech, brand })) {
    if (typeof field.collect !== 'function') continue
    try {
      const next = field.collect(ctx, cur)
      if (next && typeof next === 'object') cur = next
    } catch (e) {
      console.error('[addDevice collect]', field.id, e)
    }
  }
  return cur
}

export { buildCtx as buildAddDeviceFormCtx }
