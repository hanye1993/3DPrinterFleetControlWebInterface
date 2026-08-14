import { create } from 'zustand'
import { createAdapter, type PrinterAdapter } from '../adapters'
import type {
  ControlPayload,
  DeviceConfig,
  PrinterLiveStatus,
  PrinterTech
} from '../types/printer'
import { onStatusBatchForAmsDeduct } from '../utils/amsDeduct'
import { useAuthStore, apiFetch } from './authStore'
import {
  isClientMode,
  serverBatchPrint,
  serverFetchDevices,
  serverReconnectAndFetchDevices,
  serverSend
} from '../api/serverClient'

export function deviceTech(device: DeviceConfig): PrinterTech {
  return device.tech || 'fdm'
}

export type BrandFilter =
  | 'all'
  | 'klipper'
  | 'bambu'
  | 'creality'
  | 'elegoo'
  | 'anycubic'
  | 'snapmaker'
  | 'flashforge'
  | 'qidi'

export type AppSection =
  | 'fdm'
  | 'resin'
  | 'filament'
  | 'tools'
  | 'quoteHistory'
  | 'monitorWall'
  | 'monitorZones'
  | 'models'
  | 'aiModels'
  | 'settings'
  | 'users'
  | 'printApprove'
  | `plugin:${string}`
  | `page:${string}`
  | string

/** 每页卡片数；0 = 全部 */
export type DevicePageSize = 10 | 20 | 50 | 100 | 0

export type DeviceStatusKind = import('../utils/statusLabel').DeviceStatusKind

export type BatchPrintResult = {
  deviceId: string
  deviceName: string
  ok: boolean
  /** true = skipped due to incompatible state / policy (not a hard failure) */
  skipped?: boolean
  message?: string
}

interface DeviceState {
  devices: DeviceConfig[]
  statuses: Record<string, PrinterLiveStatus>
  selectedId: string | null
  /** multi-select for batch print */
  checkedIds: string[]
  section: AppSection
  filter: BrandFilter
  search: string
  pageSize: DevicePageSize
  page: number
  /** empty = show all statuses */
  statusFilters: DeviceStatusKind[]
  loading: boolean
  bambuPluginHint: string | null
  adapters: Record<string, PrinterAdapter>
  init: () => Promise<void>
  setSection: (s: AppSection) => void
  setFilter: (f: BrandFilter) => void
  setSearch: (q: string) => void
  setPageSize: (n: DevicePageSize) => void
  setPage: (n: number) => void
  setStatusFilters: (kinds: DeviceStatusKind[]) => void
  toggleStatusFilter: (kind: DeviceStatusKind) => void
  selectDevice: (id: string | null) => void
  toggleChecked: (id: string) => void
  setCheckedIds: (ids: string[]) => void
  clearChecked: () => void
  addDevice: (device: DeviceConfig, apiKey?: string) => Promise<void>
  removeDevice: (id: string) => Promise<void>
  updateDevice: (device: DeviceConfig) => Promise<void>
  reconnectAll: () => Promise<void>
  /** Client: pull latest devices/statuses from server (no local printer IO) */
  refreshFromServer: (opts?: { silent?: boolean }) => Promise<void>
  /** Merge status map from SSE without refetching device list */
  applyStatusesFromServer: (incoming: Record<string, PrinterLiveStatus>) => void
  control: (deviceId: string, payload: ControlPayload) => Promise<void>
  /** pause / resume / cancel on many devices */
  batchControl: (
    deviceIds: string[],
    action: 'pause' | 'resume' | 'cancel'
  ) => Promise<BatchPrintResult[]>
  /** Upload G-code then start print on each device (1 file→all, or 1:1 file list) */
  batchUploadAndPrint: (
    deviceIds: string[],
    files: File[],
    onProgress?: (done: number, total: number, result: BatchPrintResult) => void
  ) => Promise<BatchPrintResult[]>
}

/** FDM: Moonraker upload+print. Resin file push is brand-specific (not yet). */
export function canBatchPrint(device: DeviceConfig): boolean {
  if (device.connectionMode === 'cloud') return false
  if (deviceTech(device) === 'resin') return false
  return device.brand === 'klipper' || device.brand === 'creality' || device.brand === 'qidi'
}

function persistDevices(devices: DeviceConfig[]): void {
  void window.electronAPI?.devices.save(
    devices.map(({ ...d }) => {
      // never persist raw secrets here
      return d
    })
  )
}

/** 合并同一帧内的多台状态更新，避免 100+ 次 set 卡死 UI */
let pendingStatuses: Record<string, PrinterLiveStatus> = {}
let statusFlushRaf = 0
let statusNotifyDevice: DeviceConfig | null = null
let flushStatusBatch: ((batch: Record<string, PrinterLiveStatus>) => void) | null = null

function queueDeviceStatus(device: DeviceConfig, status: PrinterLiveStatus): void {
  const prev = pendingStatuses[device.id] ?? useDeviceStore.getState().statuses[device.id]
  if (
    status.health === 'error' &&
    status.message &&
    prev?.health !== 'error' &&
    !statusNotifyDevice
  ) {
    statusNotifyDevice = device
  }
  pendingStatuses[status.deviceId] = status
  if (statusFlushRaf) return
  statusFlushRaf = requestAnimationFrame(() => {
    statusFlushRaf = 0
    const batch = pendingStatuses
    pendingStatuses = {}
    const notify = statusNotifyDevice
    statusNotifyDevice = null
    if (notify?.name && batch[notify.id]?.message) {
      void window.electronAPI?.notify.show(notify.name, batch[notify.id].message!)
    }
    flushStatusBatch?.(batch)
  })
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  flushStatusBatch = (batch) => {
    set((s) => {
      // 只在有变化时合并；同引用跳过通知风暴
      let changed = false
      for (const id of Object.keys(batch)) {
        if (s.statuses[id] !== batch[id]) {
          changed = true
          break
        }
      }
      if (!changed) return s
      return { statuses: { ...s.statuses, ...batch } }
    })
    const devices = useDeviceStore.getState().devices
    const byId: Record<string, { id: string; name: string; brand: string }> = {}
    for (const d of devices) {
      byId[d.id] = { id: d.id, name: d.name, brand: d.brand }
    }
    try {
      onStatusBatchForAmsDeduct(batch, byId)
    } catch {
      /* ignore deduct errors */
    }
    // Keep API snapshot fresh for remote clients (do not wait for App interval)
    if (!isClientMode()) {
      void window.electronAPI?.api?.pushStatuses(useDeviceStore.getState().statuses)
    }
  }

  return {
  devices: [],
  statuses: {},
  selectedId: null,
  checkedIds: [],
  section: 'fdm',
  filter: 'all',
  search: '',
  pageSize: 20,
  page: 1,
  statusFilters: [],
  loading: true,
  bambuPluginHint: null,
  adapters: {},

  init: async () => {
    set({ loading: true })
    if (isClientMode()) {
      try {
        await get().refreshFromServer()
      } catch (e) {
        console.error(e)
        set({ loading: false, devices: [], adapters: {} })
      }
      return
    }

    const raw = ((await window.electronAPI?.devices.load()) || []) as DeviceConfig[]
    let loaded = raw
      .filter(
        (d) =>
          !d.id.startsWith('virtual-') &&
          !d.tags?.includes('virtual') &&
          !d.baseUrl?.startsWith('virtual://')
      )
      .map((d) => ({ ...d, tech: d.tech || ('fdm' as const) }))

    // Drop non-Bambu cloud devices (云端创想/纵维等仅局域网可靠)
    loaded = loaded.filter(
      (d) => !(d.connectionMode === 'cloud' && d.brand !== 'bambu')
    )

    if (loaded.length !== raw.length) persistDevices(loaded)
    const plugin = await window.electronAPI?.bambu.checkPlugin()
    set({
      devices: loaded,
      loading: false,
      bambuPluginHint: plugin && !plugin.installed ? plugin.hint : null
    })
    await get().reconnectAll()
  },

  refreshFromServer: async (opts) => {
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true })
    try {
      const { devices: rawList } = await serverFetchDevices()
      const loaded: DeviceConfig[] = []
      const incoming: Record<string, PrinterLiveStatus> = {}
      for (const row of rawList as Array<DeviceConfig & { status?: PrinterLiveStatus }>) {
        const { status, ...rest } = row
        loaded.push({ ...rest, tech: rest.tech || 'fdm' })
        if (status && rest.id) incoming[rest.id] = status
      }

      const prev = get()
      const devicesChanged =
        prev.devices.length !== loaded.length ||
        JSON.stringify(prev.devices) !== JSON.stringify(loaded)

      const nextStatuses: Record<string, PrinterLiveStatus> = { ...prev.statuses }
      let statusesChanged = false
      const keepIds = new Set(loaded.map((d) => d.id))
      for (const id of Object.keys(nextStatuses)) {
        if (!keepIds.has(id)) {
          delete nextStatuses[id]
          statusesChanged = true
        }
      }
      for (const [id, st] of Object.entries(incoming)) {
        const old = nextStatuses[id]
        if (
          !old ||
          old.health !== st.health ||
          old.state !== st.state ||
          old.progress !== st.progress ||
          old.updatedAt !== st.updatedAt ||
          JSON.stringify(old) !== JSON.stringify(st)
        ) {
          nextStatuses[id] = st
          statusesChanged = true
        }
      }

      if (!devicesChanged && !statusesChanged) {
        if (!silent) set({ loading: false })
        return
      }

      // Status-only updates must keep adapters reference stable (monitor wall / UI deps).
      set({
        devices: devicesChanged ? loaded : prev.devices,
        statuses: statusesChanged ? nextStatuses : prev.statuses,
        loading: false,
        ...(devicesChanged ? { adapters: {}, bambuPluginHint: null } : {})
      })
    } catch (e) {
      if (!silent) set({ loading: false })
      throw e
    }
  },

  applyStatusesFromServer: (incoming) => {
    if (!incoming || typeof incoming !== 'object') return
    const prev = get()
    const nextStatuses: Record<string, PrinterLiveStatus> = { ...prev.statuses }
    let changed = false
    for (const [id, st] of Object.entries(incoming)) {
      if (!st || typeof st !== 'object') continue
      const old = nextStatuses[id]
      if (
        !old ||
        old.health !== st.health ||
        old.state !== st.state ||
        old.progress !== st.progress ||
        old.updatedAt !== st.updatedAt ||
        JSON.stringify(old) !== JSON.stringify(st)
      ) {
        nextStatuses[id] = st
        changed = true
      }
    }
    if (changed) set({ statuses: nextStatuses })
  },

  setSection: (section) => {
    const apply = () =>
      set({
        section,
        selectedId: null,
        checkedIds: [],
        filter: 'all',
        search: '',
        page: 1,
        statusFilters: []
      })
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(apply)
    } else {
      apply()
    }
  },
  setFilter: (filter) => set({ filter, page: 1 }),
  setSearch: (search) => set({ search, page: 1 }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  setPage: (page) => set({ page: Math.max(1, page) }),
  setStatusFilters: (statusFilters) => set({ statusFilters, page: 1 }),
  toggleStatusFilter: (kind) =>
    set((s) => {
      const has = s.statusFilters.includes(kind)
      const statusFilters = has
        ? s.statusFilters.filter((k) => k !== kind)
        : [...s.statusFilters, kind]
      return { statusFilters, page: 1 }
    }),
  selectDevice: (selectedId) => set({ selectedId }),
  toggleChecked: (id) =>
    set((s) => ({
      checkedIds: s.checkedIds.includes(id)
        ? s.checkedIds.filter((x) => x !== id)
        : [...s.checkedIds, id]
    })),
  setCheckedIds: (checkedIds) => set({ checkedIds }),
  clearChecked: () => set({ checkedIds: [] }),

  addDevice: async (device, apiKey) => {
    if (isClientMode()) {
      await serverSend('/api/v1/devices', 'POST', {
        ...device,
        secret: apiKey
      })
      await get().refreshFromServer()
      return
    }
    if (apiKey && device.secretKey) {
      await window.electronAPI?.secrets.set(device.secretKey, apiKey)
    }
    const devices = [...get().devices, device]
    set({ devices })
    persistDevices(devices)

    const key = device.secretKey
      ? await window.electronAPI?.secrets.get(device.secretKey)
      : null
    const adapter = createAdapter(device, key)
    adapter.subscribe((status) => {
      queueDeviceStatus(device, status)
    })
    try {
      await adapter.connect()
    } catch {
      // status already emitted
    }
    set((s) => ({ adapters: { ...s.adapters, [device.id]: adapter } }))
  },

  removeDevice: async (id) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/devices/${encodeURIComponent(id)}`, 'DELETE')
      await get().refreshFromServer()
      return
    }
    const { devices, adapters } = get()
    const device = devices.find((d) => d.id === id)
    const adapter = adapters[id]
    await adapter?.disconnect()
    const next = devices.filter((d) => d.id !== id)
    if (device?.secretKey) {
      const stillUsed = next.some((d) => d.secretKey === device.secretKey)
      if (!stillUsed) await window.electronAPI?.secrets.delete(device.secretKey)
    }
    const { [id]: _a, ...restAdapters } = adapters
    const { [id]: _s, ...restStatuses } = get().statuses
    set({
      devices: next,
      adapters: restAdapters,
      statuses: restStatuses,
      selectedId: get().selectedId === id ? null : get().selectedId,
      checkedIds: get().checkedIds.filter((x) => x !== id)
    })
    persistDevices(next)
  },

  updateDevice: async (device) => {
    if (isClientMode()) {
      await serverSend(`/api/v1/devices/${encodeURIComponent(device.id)}`, 'PATCH', device)
      await get().refreshFromServer()
      return
    }
    const devices = get().devices.map((d) => (d.id === device.id ? device : d))
    set({ devices })
    persistDevices(devices)
  },

  reconnectAll: async () => {
    // Client: never talk to printers — ask server to reconnect, then pull snapshot
    if (isClientMode()) {
      set({ loading: true })
      try {
        const { devices: rawList } = await serverReconnectAndFetchDevices()
        const loaded: DeviceConfig[] = []
        const statuses: Record<string, PrinterLiveStatus> = {}
        for (const row of rawList as Array<DeviceConfig & { status?: PrinterLiveStatus }>) {
          const { status, ...rest } = row
          loaded.push({ ...rest, tech: rest.tech || 'fdm' })
          if (status && rest.id) statuses[rest.id] = status
        }
        set({
          devices: loaded,
          statuses: { ...get().statuses, ...statuses },
          loading: false,
          adapters: {}
        })
      } catch (e) {
        set({ loading: false })
        throw e
      }
      return
    }

    const { devices, adapters: old } = get()
    await Promise.all(Object.values(old).map((a) => a.disconnect().catch(() => undefined)))
    const adapters: Record<string, PrinterAdapter> = {}
    await Promise.all(
      devices.map(async (device) => {
        const key = device.secretKey
          ? await window.electronAPI?.secrets.get(device.secretKey)
          : null
        const adapter = createAdapter(device, key)
        adapter.subscribe((status) => {
          queueDeviceStatus(device, status)
        })
        adapters[device.id] = adapter
        void adapter.connect().catch(() => undefined)
      })
    )
    set({ adapters })
    // Snapshot may still be empty until first WS tick — push whatever we have, then again shortly
    void window.electronAPI?.api?.pushStatuses(get().statuses)
    window.setTimeout(() => {
      void window.electronAPI?.api?.pushStatuses(useDeviceStore.getState().statuses)
    }, 1500)
  },

  control: async (deviceId, payload) => {
    const device = get().devices.find((d) => d.id === deviceId)
    if (!device) throw new Error('设备不存在')

    if (isClientMode()) {
      const { serverUrl, token, canDevice } = useAuthStore.getState()
      if (payload.action === 'print_file' && !canDevice(deviceId, 'print') && canDevice(deviceId, 'print.request')) {
        throw new Error('请在设备面板使用「发送 G 文件打印」提交文件；审核通过后进入队列，由管理员开打')
      }
      const res = await apiFetch(serverUrl, `/api/v1/devices/${encodeURIComponent(deviceId)}/control`, {
        method: 'POST',
        token,
        body: JSON.stringify(payload)
      })
      const data = (await res.json()) as { ok?: boolean; message?: string }
      if (!res.ok || !data.ok) throw new Error(data.message || '控制失败')
      return
    }

    const adapter = get().adapters[deviceId]
    if (!adapter) throw new Error('设备未连接')
    try {
      await adapter.control(payload)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId,
        deviceName: device.name,
        action: payload.action,
        result: 'ok'
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await window.electronAPI?.logs.append({
        time: new Date().toISOString(),
        deviceId,
        deviceName: device.name,
        action: payload.action,
        result: 'error',
        detail
      })
      void window.electronAPI?.notify.show(device.name, `控制失败: ${detail}`)
      throw err
    }
  },

  batchControl: async (deviceIds, action) => {
    const { canApplyBatchControl } = await import('../utils/controlCompatibility')
    const results: BatchPrintResult[] = []
    for (const deviceId of deviceIds) {
      const device = get().devices.find((d) => d.id === deviceId)
      const deviceName = device?.name || deviceId
      const st = get().statuses[deviceId]
      const gate = canApplyBatchControl(action, st)
      if (!gate.ok) {
        results.push({
          deviceId,
          deviceName,
          ok: false,
          skipped: true,
          message: gate.reason
        })
        continue
      }
      try {
        await get().control(deviceId, { action })
        results.push({ deviceId, deviceName, ok: true })
      } catch (err) {
        results.push({
          deviceId,
          deviceName,
          ok: false,
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
    return results
  },

  batchUploadAndPrint: async (deviceIds, files, onProgress) => {
    if (!files.length) throw new Error('请选择 G-code 文件')

    const { assertSameBrandAndModel } = await import('../utils/batchPrintGroup')
    const picked = deviceIds
      .map((id) => get().devices.find((d) => d.id === id))
      .filter((d): d is DeviceConfig => !!d && canBatchPrint(d))
    const group = assertSameBrandAndModel(picked)
    if (!group.ok) throw new Error(group.message)

    if (isClientMode()) {
      const results: BatchPrintResult[] = []
      const total = deviceIds.length
      for (let i = 0; i < deviceIds.length; i++) {
        const deviceId = deviceIds[i]
        const device = get().devices.find((d) => d.id === deviceId)
        const file = files.length === 1 ? files[0] : files[i] || files[files.length - 1]
        const deviceName = device?.name || deviceId
        try {
          const buf = await file.arrayBuffer()
          const bytes = new Uint8Array(buf)
          let binary = ''
          for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]!)
          const list = await serverBatchPrint({
            deviceIds: [deviceId],
            filename: file.name,
            contentBase64: btoa(binary)
          })
          const one = list[0] || { deviceId, deviceName, ok: false, message: '无结果' }
          const r: BatchPrintResult = {
            deviceId,
            deviceName: one.deviceName || deviceName,
            ok: one.ok,
            message: one.message || file.name
          }
          results.push(r)
          onProgress?.(i + 1, total, r)
        } catch (err) {
          const r: BatchPrintResult = {
            deviceId,
            deviceName,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          }
          results.push(r)
          onProgress?.(i + 1, total, r)
        }
      }
      return results
    }

    const { devices, adapters } = get()
    const results: BatchPrintResult[] = []
    const total = deviceIds.length

    for (let i = 0; i < deviceIds.length; i++) {
      const deviceId = deviceIds[i]
      const device = devices.find((d) => d.id === deviceId)
      const adapter = adapters[deviceId]
      const file = files.length === 1 ? files[0] : files[i] || files[files.length - 1]
      const deviceName = device?.name || deviceId

      if (!device || !adapter) {
        const r: BatchPrintResult = {
          deviceId,
          deviceName,
          ok: false,
          message: '设备未连接'
        }
        results.push(r)
        onProgress?.(i + 1, total, r)
        continue
      }
      if (!canBatchPrint(device)) {
        const r: BatchPrintResult = {
          deviceId,
          deviceName,
          ok: false,
          message: '该品牌暂不支持批量上传打印（需 Moonraker/Fluidd）'
        }
        results.push(r)
        onProgress?.(i + 1, total, r)
        continue
      }

      try {
        await adapter.uploadFile(file)
        await adapter.printFile(file.name)
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId,
          deviceName,
          action: 'batch_print',
          result: 'ok',
          detail: file.name
        })
        const r: BatchPrintResult = { deviceId, deviceName, ok: true, message: file.name }
        results.push(r)
        onProgress?.(i + 1, total, r)
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        await window.electronAPI?.logs.append({
          time: new Date().toISOString(),
          deviceId,
          deviceName,
          action: 'batch_print',
          result: 'error',
          detail: `${file.name}: ${detail}`
        })
        const r: BatchPrintResult = { deviceId, deviceName, ok: false, message: detail }
        results.push(r)
        onProgress?.(i + 1, total, r)
      }
    }
    return results
  }
}})

export function selectVisibleDevices(state: {
  devices: DeviceConfig[]
  filter: BrandFilter
  search: string
  tech?: PrinterTech
}): DeviceConfig[] {
  const q = state.search.trim().toLowerCase()
  return state.devices.filter((d) => {
    if (state.tech && deviceTech(d) !== state.tech) return false
    if (state.filter !== 'all' && d.brand !== state.filter) return false
    if (!q) return true
    return (
      d.name.toLowerCase().includes(q) ||
      (d.group || '').toLowerCase().includes(q) ||
      (d.tags || []).some((t) => t.toLowerCase().includes(q))
    )
  })
}
