import { create } from 'zustand'
import { isClientMode, serverGet, serverSend } from '../api/serverClient'
import { useAuthStore } from './authStore'

export type PrintJobStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'done'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  | 'approved'

export type PrintJob = {
  id: string
  status: PrintJobStatus
  requesterId: string
  requesterName: string
  deviceId: string
  deviceName: string
  filename: string
  note?: string
  createdAt: string
  updatedAt: string
  queuedAt?: string
  startedAt?: string
  errorMessage?: string
  reviewedByName?: string
  reviewNote?: string
  startedByName?: string
  queuePosition?: number
  hasContent?: boolean
  pluginData?: Record<string, unknown>
  [key: string]: unknown
}

type PrintQueueState = {
  jobs: PrintJob[]
  loading: boolean
  lastError: string | null
  refresh: (opts?: { silent?: boolean; deviceId?: string; status?: string }) => Promise<void>
  submitGcode: (opts: {
    deviceId: string
    deviceName?: string
    file: File
    note?: string
    pluginData?: Record<string, unknown>
  }) => Promise<{ queued: boolean; queuePosition?: number; job: PrintJob }>
  approve: (id: string, note?: string) => Promise<void>
  reject: (id: string, note?: string) => Promise<void>
  start: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  jobsForDevice: (deviceId: string, statuses?: PrintJobStatus[]) => PrintJob[]
  canManageQueue: () => boolean
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk)
    binary += String.fromCharCode.apply(null, Array.from(slice) as number[])
  }
  return btoa(binary)
}

export const usePrintQueueStore = create<PrintQueueState>((set, get) => ({
  jobs: [],
  loading: false,
  lastError: null,

  canManageQueue: () => {
    const auth = useAuthStore.getState()
    if (!isClientMode()) return true
    if (auth.user?.level === 'admin') return true
    return auth.can('print.approve') || auth.can('nav.printApprove')
  },

  jobsForDevice: (deviceId, statuses) => {
    let list = get().jobs.filter((j) => j.deviceId === deviceId)
    if (statuses?.length) {
      const setS = new Set(statuses)
      list = list.filter((j) => setS.has(j.status))
    }
    return list
  },

  refresh: async (opts) => {
    const silent = Boolean(opts?.silent)
    if (!silent) set({ loading: true, lastError: null })
    try {
      const auth = useAuthStore.getState()
      if (!isClientMode()) {
        const res = await window.electronAPI?.auth?.localPrintRequests?.({
          deviceId: opts?.deviceId,
          status: opts?.status
        })
        if (!res?.ok) throw new Error(res?.message || '加载失败')
        set({ jobs: (res.requests || []) as PrintJob[], loading: false })
        return
      }
      if (!isClientMode() || !auth.token) {
        set({ loading: false })
        return
      }
      const qs = new URLSearchParams()
      if (opts?.deviceId) qs.set('deviceId', opts.deviceId)
      if (opts?.status) qs.set('status', opts.status)
      const q = qs.toString()
      const data = await serverGet<{ requests?: PrintJob[] }>(
        `/api/v1/print-requests${q ? `?${q}` : ''}`
      )
      set({ jobs: data.requests || [], loading: false })
    } catch (e) {
      set({
        loading: false,
        lastError: e instanceof Error ? e.message : String(e)
      })
    }
  },

  submitGcode: async ({ deviceId, deviceName, file, note, pluginData }) => {
    const filename = String(file.name || '').trim()
    if (!/\.gcode$/i.test(filename)) {
      throw new Error('仅支持上传 .gcode 文件')
    }
    const contentBase64 = await fileToBase64(file)
    const auth = useAuthStore.getState()
    if (!isClientMode()) {
      const res = await window.electronAPI?.auth?.localSubmitPrint?.({
        deviceId,
        deviceName,
        filename: file.name,
        contentBase64,
        note,
        pluginData,
        status: 'queued'
      })
      if (!res?.ok || !res.request) throw new Error(res?.message || '提交失败')
      await get().refresh({ silent: true })
      return {
        queued: Boolean(res.queued),
        queuePosition: res.queuePosition,
        job: res.request as PrintJob
      }
    }
    const body: Record<string, unknown> = {
      deviceId,
      filename: file.name,
      contentBase64,
      note
    }
    if (pluginData && typeof pluginData === 'object') body.pluginData = pluginData
    const data = await serverSend<{
      request: PrintJob
      queued?: boolean
      queuePosition?: number
    }>('/api/v1/print-requests', 'POST', body)
    await get().refresh({ silent: true })
    return {
      queued: Boolean(data.queued),
      queuePosition: data.queuePosition ?? data.request.queuePosition,
      job: data.request
    }
  },

  approve: async (id, note) => {
    const auth = useAuthStore.getState()
    if (!isClientMode()) {
      const res = await window.electronAPI?.auth?.localReviewPrint?.({
        id,
        action: 'approve',
        note
      })
      if (!res?.ok) throw new Error(res?.message || '通过失败')
    } else {
      await serverSend(`/api/v1/print-requests/${encodeURIComponent(id)}/approve`, 'POST', {
        note
      })
    }
    await get().refresh({ silent: true })
  },

  reject: async (id, note) => {
    const auth = useAuthStore.getState()
    if (!isClientMode()) {
      const res = await window.electronAPI?.auth?.localReviewPrint?.({
        id,
        action: 'reject',
        note
      })
      if (!res?.ok) throw new Error(res?.message || '拒绝失败')
    } else {
      await serverSend(`/api/v1/print-requests/${encodeURIComponent(id)}/reject`, 'POST', {
        note
      })
    }
    await get().refresh({ silent: true })
  },

  start: async (id) => {
    const auth = useAuthStore.getState()
    if (!isClientMode()) {
      const res = await window.electronAPI?.auth?.localReviewPrint?.({
        id,
        action: 'start'
      })
      if (!res?.ok) throw new Error(res?.message || '开始打印失败')
    } else {
      await serverSend(`/api/v1/print-requests/${encodeURIComponent(id)}/start`, 'POST', {})
    }
    await get().refresh({ silent: true })
  },

  cancel: async (id) => {
    const auth = useAuthStore.getState()
    if (!isClientMode()) {
      const res = await window.electronAPI?.auth?.localReviewPrint?.({
        id,
        action: 'cancel'
      })
      if (!res?.ok) throw new Error(res?.message || '取消失败')
    } else {
      await serverSend(`/api/v1/print-requests/${encodeURIComponent(id)}/cancel`, 'POST', {})
    }
    await get().refresh({ silent: true })
  }
}))
