import { create } from 'zustand'
import type { MonitorZone, ZoneCamera } from '../types/monitor'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import { newId } from '../utils/id'

type MonitorState = {
  zones: MonitorZone[]
  loading: boolean
  activeZoneId: string | null
  init: () => Promise<void>
  refreshFromServer: (opts?: { silent?: boolean }) => Promise<void>
  setActiveZoneId: (id: string | null) => void
  addZone: (name: string) => Promise<MonitorZone>
  renameZone: (id: string, name: string) => Promise<void>
  removeZone: (id: string) => Promise<void>
  addCamera: (
    zoneId: string,
    cam: Omit<ZoneCamera, 'id'>
  ) => Promise<ZoneCamera | null>
  updateCamera: (zoneId: string, cam: ZoneCamera) => Promise<void>
  removeCamera: (zoneId: string, cameraId: string) => Promise<void>
}

function persist(zones: MonitorZone[]): void {
  if (isClientMode()) return
  void window.electronAPI?.monitor?.save(zones)
}

let externalSyncBound = false

export const useMonitorStore = create<MonitorState>((set, get) => ({
  zones: [],
  loading: true,
  activeZoneId: null,

  init: async () => {
    set({ loading: true })
    if (isClientMode()) {
      try {
        const data = await serverGet<{ zones?: MonitorZone[] }>('/api/v1/monitor/zones')
        const zones = Array.isArray(data.zones) ? data.zones : []
        set({
          zones,
          loading: false,
          activeZoneId: get().activeZoneId || zones[0]?.id || null
        })
      } catch (e) {
        console.error(e)
        set({ zones: [], loading: false })
      }
      return
    }
    const raw = ((await window.electronAPI?.monitor?.load()) || []) as MonitorZone[]
    const zones = Array.isArray(raw) ? raw : []
    set({
      zones,
      loading: false,
      activeZoneId: get().activeZoneId || zones[0]?.id || null
    })
    if (!externalSyncBound) {
      externalSyncBound = true
      window.electronAPI?.monitor?.onChanged?.(() => {
        void get().init()
      })
    }
  },

  refreshFromServer: async (opts) => {
    if (!isClientMode()) return
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true })
    try {
      const data = await serverGet<{ zones?: MonitorZone[] }>('/api/v1/monitor/zones')
      const zones = Array.isArray(data.zones) ? data.zones : []
      const prev = get().zones
      if (JSON.stringify(prev) === JSON.stringify(zones)) {
        if (!silent) set({ loading: false })
        return
      }
      set({
        zones,
        loading: false,
        activeZoneId: get().activeZoneId || zones[0]?.id || null
      })
    } catch (e) {
      console.error(e)
      if (!silent) set({ loading: false })
    }
  },

  setActiveZoneId: (activeZoneId) => set({ activeZoneId }),

  addZone: async (name) => {
    if (isClientMode()) {
      const data = await serverSend<{ zone: MonitorZone }>('/api/v1/monitor/zones', 'POST', {
        name
      })
      await get().init()
      if (data.zone?.id) set({ activeZoneId: data.zone.id })
      return data.zone
    }
    const now = new Date().toISOString()
    const zone: MonitorZone = {
      id: newId(),
      name: name.trim() || '未命名区域',
      cameras: [],
      createdAt: now,
      updatedAt: now
    }
    const zones = [...get().zones, zone]
    set({ zones, activeZoneId: zone.id })
    persist(zones)
    return zone
  },

  renameZone: async (id, name) => {
    const n = name.trim()
    if (!n) return
    if (isClientMode()) {
      await serverSend(`/api/v1/monitor/zones/${encodeURIComponent(id)}`, 'PATCH', { name: n })
      await get().init()
      return
    }
    const zones = get().zones.map((z) =>
      z.id === id ? { ...z, name: n, updatedAt: new Date().toISOString() } : z
    )
    set({ zones })
    persist(zones)
  },

  removeZone: async (id) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/monitor/zones/${encodeURIComponent(id)}`, 'DELETE')
      await get().init()
      return
    }
    const zones = get().zones.filter((z) => z.id !== id)
    const activeZoneId =
      get().activeZoneId === id ? zones[0]?.id || null : get().activeZoneId
    set({ zones, activeZoneId })
    persist(zones)
  },

  addCamera: async (zoneId, input) => {
    if (isClientMode()) {
      const data = await serverSend<{ camera?: ZoneCamera }>(
        `/api/v1/monitor/zones/${encodeURIComponent(zoneId)}/cameras`,
        'POST',
        input
      )
      await get().init()
      return data.camera || null
    }
    const sourceType = input.sourceType || 'http'
    const isPlugin = sourceType !== 'http' && sourceType !== 'stream'
    let url = String(input.url || '').trim()
    if (!url && isPlugin) url = `plugin://${sourceType}`
    if (!url) return null
    const cam: ZoneCamera = {
      ...input,
      id: newId(),
      name: String(input.name || '').trim() || '摄像头',
      url,
      sourceType: isPlugin ? sourceType : 'http'
    }
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: [...z.cameras, cam],
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
    return cam
  },

  updateCamera: async (zoneId, cam) => {
    if (isClientMode()) {
      await serverSend(
        `/api/v1/monitor/zones/${encodeURIComponent(zoneId)}/cameras/${encodeURIComponent(cam.id)}`,
        'PUT',
        cam
      )
      await get().init()
      return
    }
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: z.cameras.map((c) => (c.id === cam.id ? cam : c)),
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
  },

  removeCamera: async (zoneId, cameraId) => {
    if (isClientMode()) {
      await serverSend(
        `/api/v1/monitor/zones/${encodeURIComponent(zoneId)}/cameras/${encodeURIComponent(cameraId)}`,
        'DELETE'
      )
      await get().init()
      return
    }
    const zones = get().zones.map((z) =>
      z.id === zoneId
        ? {
            ...z,
            cameras: z.cameras.filter((c) => c.id !== cameraId),
            updatedAt: new Date().toISOString()
          }
        : z
    )
    set({ zones })
    persist(zones)
  }
}))
