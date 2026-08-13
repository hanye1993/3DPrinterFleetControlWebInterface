import { useEffect, useReducer, useRef } from 'react'
import type { FormInstance } from 'antd'
import {
  getHanyePlugin,
  type UserFormCtx,
  type UsersPageCtx
} from '../plugins/runtime'

export function buildUserFormCtx(
  form: FormInstance,
  mode: 'create' | 'edit',
  user: Record<string, unknown> | null,
  getPermissions: () => string[],
  setPermissions: (perms: string[]) => void,
  getDeviceAcl: () => Record<string, string[]>,
  setDeviceAcl: (acl: Record<string, string[]>) => void
): UserFormCtx {
  return {
    mode,
    user,
    getFieldValue: (name) => form.getFieldValue(name),
    getFieldsValue: () => form.getFieldsValue(true) as Record<string, unknown>,
    setFieldsValue: (values) => form.setFieldsValue(values),
    validateFields: async (names) =>
      (await form.validateFields(names)) as Record<string, unknown>,
    getPermissions,
    setPermissions,
    getDeviceAcl,
    setDeviceAcl
  }
}

export function UsersPluginFields({
  form,
  mode,
  user,
  getPermissions,
  setPermissions,
  getDeviceAcl,
  setDeviceAcl
}: {
  form: FormInstance
  mode: 'create' | 'edit'
  user: Record<string, unknown> | null
  getPermissions: () => string[]
  setPermissions: (perms: string[]) => void
  getDeviceAcl: () => Record<string, string[]>
  setDeviceAcl: (acl: Record<string, string[]>) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('users:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getUserFormFields(mode)
    if (!fields.length) return
    const ctx = buildUserFormCtx(
      form,
      mode,
      user,
      getPermissions,
      setPermissions,
      getDeviceAcl,
      setDeviceAcl
    )
    const cleanups: Array<() => void> = []
    for (const field of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginUserField = field.id
      wrap.style.marginBottom = '12px'
      el.appendChild(wrap)
      try {
        const ret = field.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[UsersPluginFields]', field.id, e)
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
  }, [
    form,
    mode,
    user,
    getPermissions,
    setPermissions,
    getDeviceAcl,
    setDeviceAcl,
    tick
  ])

  return <div ref={hostRef} className="plugin-user-fields" />
}

export function applyUserFieldCollect(
  form: FormInstance,
  mode: 'create' | 'edit',
  user: Record<string, unknown> | null,
  getPermissions: () => string[],
  setPermissions: (perms: string[]) => void,
  getDeviceAcl: () => Record<string, string[]>,
  setDeviceAcl: (acl: Record<string, string[]>) => void,
  payload: Record<string, unknown>
): Record<string, unknown> {
  let cur = { ...payload }
  const ctx = buildUserFormCtx(
    form,
    mode,
    user,
    getPermissions,
    setPermissions,
    getDeviceAcl,
    setDeviceAcl
  )
  for (const field of getHanyePlugin().getUserFormFields(mode)) {
    if (typeof field.collect !== 'function') continue
    try {
      const next = field.collect(ctx, cur)
      if (next && typeof next === 'object') cur = next
    } catch (e) {
      console.error('[user collect]', field.id, e)
    }
  }
  return cur
}

export function userPluginFormSeed(row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) return {}
  const out: Record<string, unknown> = {
    ...((row.pluginData && typeof row.pluginData === 'object'
      ? row.pluginData
      : {}) as Record<string, unknown>)
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('x_') || k.startsWith('plugin_')) out[k] = v
  }
  return out
}

export function userPreserveExtras(row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) return {}
  const out: Record<string, unknown> = {}
  if (row.pluginData && typeof row.pluginData === 'object') {
    out.pluginData = { ...(row.pluginData as Record<string, unknown>) }
  }
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('x_') || k.startsWith('plugin_')) out[k] = v
  }
  return out
}

export function pickUserPluginPayload(source: Record<string, unknown>): {
  pluginData?: Record<string, unknown>
  extras: Record<string, unknown>
} {
  const extras: Record<string, unknown> = {}
  let pluginData: Record<string, unknown> | undefined
  if (
    source.pluginData != null &&
    typeof source.pluginData === 'object' &&
    !Array.isArray(source.pluginData)
  ) {
    pluginData = { ...(source.pluginData as Record<string, unknown>) }
  }
  for (const [k, v] of Object.entries(source)) {
    if (!(k.startsWith('x_') || k.startsWith('plugin_'))) continue
    if (v === undefined) continue
    extras[k] = v
  }
  return { pluginData, extras }
}

export type { UsersPageCtx }
