import { useEffect, useReducer, useRef, type ReactNode } from 'react'
import { Button, Space, message } from 'antd'
import type { CameraSource } from '../../adapters/base'
import type { ZoneCamera } from '../../types/monitor'
import {
  getHanyePlugin,
  type MonitorTileCtx
} from '../../plugins/runtime'

export function MonitorTilePluginHeader({
  ctx,
  extra
}: {
  ctx: MonitorTileCtx
  extra?: ReactNode
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const actions = getHanyePlugin().getMonitorTileActions(ctx.scope)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const extras = getHanyePlugin().getMonitorTileExtras(ctx.scope, 'header')
    const cleanups: Array<() => void> = []
    for (const e of extras) {
      const wrap = document.createElement('span')
      wrap.dataset.pluginMonitorTile = e.id
      wrap.style.display = 'inline-flex'
      wrap.style.alignItems = 'center'
      el.appendChild(wrap)
      try {
        const ret = e.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (err) {
        console.error('[MonitorTilePluginHeader]', e.id, err)
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

  return (
    <Space size={4} wrap className="plugin-monitor-tile-header">
      {actions.map((a) => (
        <Button
          key={a.id}
          size="small"
          type="link"
          danger={a.danger}
          className="monitor-tile-remove-btn"
          onClick={() => {
            void Promise.resolve(a.run(ctx)).catch((err) =>
              message.error(err instanceof Error ? err.message : '插件动作失败')
            )
          }}
        >
          {a.label}
        </Button>
      ))}
      <span ref={hostRef} />
      {extra}
    </Space>
  )
}

export function MonitorTilePluginFooter({ ctx }: { ctx: MonitorTileCtx }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const extras = getHanyePlugin().getMonitorTileExtras(ctx.scope, 'footer')
    if (!extras.length) return
    const cleanups: Array<() => void> = []
    for (const e of extras) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginMonitorTile = e.id
      wrap.style.padding = '4px 8px'
      wrap.style.fontSize = '12px'
      el.appendChild(wrap)
      try {
        const ret = e.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (err) {
        console.error('[MonitorTilePluginFooter]', e.id, err)
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

  return <div ref={hostRef} className="plugin-monitor-tile-footer" />
}

export function MonitorCameraPluginFields({
  zoneId,
  zoneName,
  getFieldValue,
  setFieldsValue
}: {
  zoneId: string
  zoneName: string
  getFieldValue: (name: string) => unknown
  setFieldsValue: (values: Record<string, unknown>) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    el.innerHTML = ''
    const fields = getHanyePlugin().getMonitorCameraFields()
    if (!fields.length) return
    const ctx = { zoneId, zoneName, getFieldValue, setFieldsValue }
    const cleanups: Array<() => void> = []
    for (const f of fields) {
      const wrap = document.createElement('div')
      wrap.dataset.pluginMonitorCamField = f.id
      wrap.style.marginBottom = '12px'
      el.appendChild(wrap)
      try {
        const ret = f.render(wrap, ctx)
        if (typeof ret === 'function') cleanups.push(ret)
      } catch (e) {
        console.error('[MonitorCameraPluginFields]', f.id, e)
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
  }, [zoneId, zoneName, getFieldValue, setFieldsValue, tick])

  return <div ref={hostRef} className="plugin-monitor-camera-fields" />
}

export function applyMonitorCameraFieldCollect(
  zoneId: string,
  zoneName: string,
  getFieldValue: (name: string) => unknown,
  camera: Record<string, unknown>
): Record<string, unknown> {
  let cur = { ...camera }
  const ctx = { zoneId, zoneName, getFieldValue }
  for (const f of getHanyePlugin().getMonitorCameraFields()) {
    if (typeof f.collect !== 'function') continue
    try {
      const next = f.collect(ctx, cur)
      if (next && typeof next === 'object') cur = next
    } catch (e) {
      console.error('[monitor camera collect]', f.id, e)
    }
  }
  return cur
}

export function applyMonitorWallFilters(
  slots: Array<{ deviceId: string; deviceName: string; brand: string }>
): Array<{ deviceId: string; deviceName: string; brand: string }> {
  const filters = getHanyePlugin().getMonitorWallFilters()
  if (!filters.length) return slots
  return slots.filter((s) => {
    for (const f of filters) {
      try {
        if (!f.match(s)) return false
      } catch (e) {
        console.error('[monitor wall filter]', f.id, e)
      }
    }
    return true
  })
}

export function MonitorCameraSourceForm({
  sourceId,
  zoneId,
  zoneName,
  mode,
  camera,
  getFieldValue,
  getFieldsValue,
  setFieldsValue,
  validateFields,
  newId
}: {
  sourceId: string
  zoneId: string
  zoneName: string
  mode: 'create' | 'edit'
  camera: Record<string, unknown> | null
  getFieldValue: (name: string) => unknown
  getFieldsValue: () => Record<string, unknown>
  setFieldsValue: (values: Record<string, unknown>) => void
  validateFields: (names?: string[]) => Promise<Record<string, unknown>>
  newId: () => string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  const def = getHanyePlugin().getMonitorCameraSource(sourceId)

  useEffect(() => {
    return getHanyePlugin().on('monitor:change', () => bump())
  }, [])

  useEffect(() => {
    const el = hostRef.current
    if (!el || !def?.renderForm) {
      if (el) el.innerHTML = ''
      return
    }
    el.innerHTML = ''
    const ctx = {
      zoneId,
      zoneName,
      mode,
      camera,
      getFieldValue,
      getFieldsValue,
      setFieldsValue,
      validateFields,
      newId
    }
    const cleanups: Array<() => void> = []
    try {
      const ret = def.renderForm(el, ctx)
      if (typeof ret === 'function') cleanups.push(ret)
    } catch (e) {
      console.error('[MonitorCameraSourceForm]', def.id, e)
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
    def,
    sourceId,
    zoneId,
    zoneName,
    mode,
    camera,
    getFieldValue,
    getFieldsValue,
    setFieldsValue,
    validateFields,
    newId,
    tick
  ])

  if (!def?.renderForm) return null
  return <div ref={hostRef} className="plugin-monitor-camera-source-form" />
}

export function resolveZoneCameraSources(
  cam: ZoneCamera,
  zoneId: string,
  zoneName?: string
): CameraSource[] {
  const sourceType = String(cam.sourceType || 'http')
  const def = getHanyePlugin().getMonitorCameraSource(sourceType)
  if (def?.toSources) {
    try {
      return def.toSources(cam as unknown as Record<string, unknown>, {
        zoneId,
        zoneName
      }) as CameraSource[]
    } catch (e) {
      console.error('[toSources]', sourceType, e)
    }
  }
  const isPlugin = sourceType !== 'http' && sourceType !== 'stream'
  if (isPlugin || String(cam.url || '').startsWith('plugin://')) {
    return [
      {
        id: cam.id,
        name: cam.name,
        streamUrl: '',
        remoteSnapshotUrl: `server-api:/api/v1/monitor/zones/${encodeURIComponent(zoneId)}/cameras/${encodeURIComponent(cam.id)}/snapshot?format=json`
      }
    ]
  }
  return []
}

export function listPluginZoneTiles(zoneId: string, zoneName: string) {
  const out: Array<{
    id: string
    title: string
    subtitle?: string
    cameras: CameraSource[]
    providerId: string
  }> = []
  for (const p of getHanyePlugin().getMonitorZoneProviders()) {
    try {
      const tiles = p.listTiles({ zoneId, zoneName }) || []
      for (const t of tiles) {
        out.push({
          id: `${p.id}:${t.id}`,
          title: t.title,
          subtitle: t.subtitle || p.label || p.id,
          cameras: (t.cameras || []) as CameraSource[],
          providerId: p.id
        })
      }
    } catch (e) {
      console.error('[zone provider]', p.id, e)
    }
  }
  return out
}
