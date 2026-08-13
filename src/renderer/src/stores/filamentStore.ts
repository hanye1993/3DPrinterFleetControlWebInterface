import { create } from 'zustand'
import { findBrand } from '../data/filamentBrands'
import type { SpoolAmsBinding, SpoolRecord } from '../types/filament'
import {
  migrateSpoolRecord,
  spoolBindings,
  spoolBindSlotsLeft,
  spoolRolls
} from '../utils/spoolBinding'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import { newId } from '../utils/id'

export type FilamentTechTab = 'fdm' | 'resin'

type FilamentState = {
  spools: SpoolRecord[]
  loading: boolean
  tech: FilamentTechTab
  search: string
  brandFilter: string | 'all'
  materialFilter: string | 'all'
  lowStockOnly: boolean
  showArchived: boolean
  lowStockThreshold: number
  addModalOpen: boolean
  init: () => Promise<void>
  /** Client: re-fetch spools from server (silent skips loading flash) */
  refreshFromServer: (opts?: { silent?: boolean }) => Promise<void>
  setTech: (t: FilamentTechTab) => void
  setSearch: (q: string) => void
  setBrandFilter: (id: string | 'all') => void
  setMaterialFilter: (id: string | 'all') => void
  setLowStockOnly: (v: boolean) => void
  setShowArchived: (v: boolean) => void
  setLowStockThreshold: (g: number) => void
  openAddModal: () => void
  closeAddModal: () => void
  addSpool: (spool: Omit<SpoolRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<SpoolRecord>
  updateSpool: (spool: SpoolRecord) => Promise<void>
  removeSpool: (id: string) => Promise<void>
  archiveSpool: (id: string, archived?: boolean) => Promise<void>
  bindSpoolAms: (spoolId: string, binding: SpoolAmsBinding) => Promise<boolean>
  unbindSpoolAms: (spoolId: string, deviceId: string, slotId: number) => Promise<void>
  clearSlotBinding: (deviceId: string, slotId: number) => Promise<void>
}

function persist(spools: SpoolRecord[]): void {
  if (isClientMode()) return
  void window.electronAPI?.filament?.save(spools)
}

function withSyncedBindings(s: SpoolRecord): SpoolRecord {
  const rolls = spoolRolls(s)
  let bindings = spoolBindings(s)
  if (bindings.length > rolls) bindings = bindings.slice(0, rolls)
  return {
    ...s,
    rolls,
    amsBindings: bindings,
    amsBinding: bindings[0] || null
  }
}

export function spoolRemainPct(s: SpoolRecord): number {
  const capacity = spoolCapacityGrams(s)
  if (!capacity) return 0
  return Math.max(0, Math.min(100, (s.remainGrams / capacity) * 100))
}

export function isLowStock(s: SpoolRecord, threshold: number): boolean {
  return !s.archived && s.remainGrams <= threshold
}

/** 库存总容量 = 单卷总重 × 卷数 */
export function spoolCapacityGrams(s: Pick<SpoolRecord, 'totalGrams' | 'rolls'>): number {
  const per = Math.max(0, Number(s.totalGrams) || 0)
  return Math.round(per * spoolRolls(s))
}

export const useFilamentStore = create<FilamentState>((set, get) => ({
  spools: [],
  loading: true,
  tech: 'fdm',
  search: '',
  brandFilter: 'all',
  materialFilter: 'all',
  lowStockOnly: false,
  showArchived: false,
  lowStockThreshold: 100,
  addModalOpen: false,

  init: async () => {
    if (isClientMode()) {
      await get().refreshFromServer()
      return
    }
    set({ loading: true })
    const raw = ((await window.electronAPI?.filament?.load()) || []) as SpoolRecord[]
    const spools = (Array.isArray(raw) ? raw : []).map((s) => migrateSpoolRecord(s))
    set({ spools, loading: false })
    persist(spools)
  },

  refreshFromServer: async (opts) => {
    if (!isClientMode()) return
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true })
    try {
      const data = await serverGet<{ filament?: SpoolRecord[]; spools?: SpoolRecord[] }>(
        '/api/v1/filament'
      )
      const raw = (data.spools || data.filament || []) as SpoolRecord[]
      const spools = (Array.isArray(raw) ? raw : []).map((s) => migrateSpoolRecord(s))
      const prev = get().spools
      if (JSON.stringify(prev) === JSON.stringify(spools)) {
        if (!silent) set({ loading: false })
        return
      }
      set({ spools, loading: false })
    } catch (e) {
      console.error(e)
      if (!silent) set({ spools: [], loading: false })
    }
  },

  setTech: (tech) => set({ tech, brandFilter: 'all', materialFilter: 'all' }),
  setSearch: (search) => set({ search }),
  setBrandFilter: (brandFilter) => set({ brandFilter }),
  setMaterialFilter: (materialFilter) => set({ materialFilter }),
  setLowStockOnly: (lowStockOnly) => set({ lowStockOnly }),
  setShowArchived: (showArchived) => set({ showArchived }),
  setLowStockThreshold: (lowStockThreshold) => set({ lowStockThreshold }),
  openAddModal: () => set({ addModalOpen: true }),
  closeAddModal: () => set({ addModalOpen: false }),

  addSpool: async (input) => {
    if (isClientMode()) {
      const data = await serverSend<{ spool?: SpoolRecord }>('/api/v1/filament', 'POST', input)
      await get().init()
      return data.spool || (get().spools[0] as SpoolRecord)
    }
    const now = new Date().toISOString()
    const spool = withSyncedBindings({
      ...input,
      id: newId(),
      rolls: spoolRolls(input),
      createdAt: now,
      updatedAt: now
    } as SpoolRecord)
    const spools = [spool, ...get().spools]
    set({ spools })
    persist(spools)
    return spool
  },

  updateSpool: async (spool) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/filament/${encodeURIComponent(spool.id)}`, 'PUT', spool)
      await get().init()
      return
    }
    const next = withSyncedBindings({
      ...spool,
      updatedAt: new Date().toISOString()
    })
    const spools = get().spools.map((s) => (s.id === next.id ? next : s))
    set({ spools })
    persist(spools)
  },

  removeSpool: async (id) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/filament/${encodeURIComponent(id)}`, 'DELETE')
      await get().init()
      return
    }
    const spools = get().spools.filter((s) => s.id !== id)
    set({ spools })
    persist(spools)
  },

  archiveSpool: async (id, archived = true) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/filament/${encodeURIComponent(id)}/archive`, 'POST', { archived })
      await get().init()
      return
    }
    const spools = get().spools.map((s) =>
      s.id === id ? { ...s, archived, updatedAt: new Date().toISOString() } : s
    )
    set({ spools })
    persist(spools)
  },

  bindSpoolAms: async (spoolId, binding) => {
    const now = new Date().toISOString()
    const target = get().spools.find((s) => s.id === spoolId)
    if (!target) return false

    const existing = spoolBindings(target)
    const already = existing.some(
      (b) => b.deviceId === binding.deviceId && Number(b.slotId) === Number(binding.slotId)
    )
    if (!already && spoolBindSlotsLeft(target) <= 0) return false

    if (isClientMode()) {
      try {
        await serverSend(`/api/v1/filament/${encodeURIComponent(spoolId)}/bind`, 'POST', {
          deviceId: binding.deviceId,
          slotId: Number(binding.slotId)
        })
        await get().init()
        return true
      } catch (e) {
        console.error(e)
        return false
      }
    }

    const before = get().spools
    const spools = before.map((s) => {
      let bindings = spoolBindings(s).filter(
        (b) => !(b.deviceId === binding.deviceId && Number(b.slotId) === Number(binding.slotId))
      )
      if (s.id === spoolId) {
        if (
          !bindings.some(
            (b) => b.deviceId === binding.deviceId && Number(b.slotId) === Number(binding.slotId)
          )
        ) {
          bindings = [...bindings, { deviceId: binding.deviceId, slotId: Number(binding.slotId) }]
        }
        const rolls = spoolRolls(s)
        if (bindings.length > rolls) bindings = bindings.slice(0, rolls)
      }
      return withSyncedBindings({ ...s, amsBindings: bindings, updatedAt: now })
    })

    set({ spools })
    persist(spools)
    return true
  },

  unbindSpoolAms: async (spoolId, deviceId, slotId) => {
    const slot = Number(slotId)
    if (isClientMode()) {
      await serverSend(`/api/v1/filament/${encodeURIComponent(spoolId)}/unbind`, 'POST', {
        deviceId,
        slotId: slot
      })
      await get().init()
      return
    }
    const now = new Date().toISOString()
    const before = get().spools
    const spools = before.map((s) => {
      if (s.id !== spoolId) return s
      const bindings = spoolBindings(s).filter(
        (b) => !(b.deviceId === deviceId && Number(b.slotId) === slot)
      )
      return withSyncedBindings({ ...s, amsBindings: bindings, updatedAt: now })
    })
    set({ spools })
    persist(spools)
  },

  clearSlotBinding: async (deviceId, slotId) => {
    const slot = Number(slotId)
    const before = get().spools
    const targets = before.filter((s) =>
      spoolBindings(s).some((b) => b.deviceId === deviceId && Number(b.slotId) === slot)
    )
    if (isClientMode()) {
      for (const s of targets) {
        await serverSend(`/api/v1/filament/${encodeURIComponent(s.id)}/unbind`, 'POST', {
          deviceId,
          slotId: slot
        })
      }
      await get().init()
      return
    }
    const now = new Date().toISOString()
    const spools = before.map((s) => {
      const prev = spoolBindings(s)
      const bindings = prev.filter(
        (b) => !(b.deviceId === deviceId && Number(b.slotId) === slot)
      )
      if (bindings.length === prev.length) return s
      return withSyncedBindings({ ...s, amsBindings: bindings, updatedAt: now })
    })
    set({ spools })
    persist(spools)
  }
}))

export function selectVisibleSpools(state: {
  spools: SpoolRecord[]
  tech: FilamentTechTab
  search: string
  brandFilter: string | 'all'
  materialFilter: string | 'all'
  lowStockOnly: boolean
  showArchived: boolean
  lowStockThreshold: number
}): SpoolRecord[] {
  const q = state.search.trim().toLowerCase()
  return state.spools.filter((s) => {
    if (s.tech !== state.tech) return false
    if (!state.showArchived && s.archived) return false
    if (state.brandFilter !== 'all' && s.brandId !== state.brandFilter) return false
    if (state.materialFilter !== 'all' && s.material !== state.materialFilter) return false
    if (state.lowStockOnly && !isLowStock(s, state.lowStockThreshold)) return false
    if (!q) return true
    const brand = findBrand(s.brandId)
    const brandText = `${brand?.name || ''} ${brand?.nameEn || ''} ${s.brandId}`.toLowerCase()
    return (
      s.color.toLowerCase().includes(q) ||
      s.material.toLowerCase().includes(q) ||
      brandText.includes(q) ||
      (s.location || '').toLowerCase().includes(q) ||
      (s.notes || '').toLowerCase().includes(q)
    )
  })
}
