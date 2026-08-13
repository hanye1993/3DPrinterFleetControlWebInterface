import type { QuoteHistoryOption, QuoteHistoryRecord } from '@shared/quoteHistory'
import { isAdminUi, isRemoteDataMode } from '../utils/appMode'
import { isClientMode, serverGet, serverSend } from './serverClient'

export type QuoteHistoryListFilter = {
  q?: string
  userId?: string
  username?: string
  action?: string
  limit?: number
}

type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string }

const RESTART_HINT = '请刷新页面或重启后台服务后再试；若仍失败，请确认已部署最新网页版。'

async function listViaIpc(
  filter?: QuoteHistoryListFilter
): Promise<ApiResult<QuoteHistoryRecord[]>> {
  const list = window.electronAPI?.quoteHistory?.list
  if (!list) {
    return { ok: false, message: `报价记录模块未加载。${RESTART_HINT}` }
  }
  try {
    const res = await list(filter)
    if (!res?.ok) {
      return { ok: false, message: res?.message || `加载失败。${RESTART_HINT}` }
    }
    return { ok: true, data: (res.records || []) as QuoteHistoryRecord[] }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (/no handler registered/i.test(detail)) {
      return { ok: false, message: `报价记录接口不可用。${RESTART_HINT}` }
    }
    return { ok: false, message: detail || `加载失败。${RESTART_HINT}` }
  }
}

async function listViaHttp(
  filter?: QuoteHistoryListFilter
): Promise<ApiResult<QuoteHistoryRecord[]>> {
  try {
    const params = new URLSearchParams()
    if (filter?.q) params.set('q', filter.q)
    if (filter?.userId) params.set('userId', filter.userId)
    if (filter?.username) params.set('username', filter.username)
    if (filter?.action) params.set('action', filter.action)
    if (filter?.limit != null) params.set('limit', String(filter.limit))
    const qs = params.toString()
    const data = await serverGet<{ records?: QuoteHistoryRecord[] }>(
      `/api/v1/quote/history${qs ? `?${qs}` : ''}`
    )
    return { ok: true, data: data.records || [] }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

async function deleteViaIpc(id: string): Promise<ApiResult<void>> {
  const del = window.electronAPI?.quoteHistory?.delete
  if (!del) {
    return { ok: false, message: `报价记录模块未加载。${RESTART_HINT}` }
  }
  try {
    const res = await del(id)
    if (!res?.ok) {
      return { ok: false, message: res?.message || '删除失败' }
    }
    return { ok: true, data: undefined }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (/no handler registered/i.test(detail)) {
      return { ok: false, message: `报价记录接口不可用。${RESTART_HINT}` }
    }
    return { ok: false, message: detail || '删除失败' }
  }
}

async function deleteViaHttp(id: string): Promise<ApiResult<void>> {
  try {
    await serverSend(`/api/v1/quote/history/${encodeURIComponent(id)}`, 'DELETE')
    return { ok: true, data: undefined }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '删除失败' }
  }
}

/** Server UI: list all quote copy/export records via IPC or HTTP (web admin). */
export async function fetchQuoteHistoryList(
  filter?: QuoteHistoryListFilter
): Promise<ApiResult<QuoteHistoryRecord[]>> {
  if (isRemoteDataMode() && !isAdminUi()) {
    return { ok: false, message: '报价记录仅在管理端查看' }
  }
  if (isRemoteDataMode()) {
    return listViaHttp(filter)
  }
  return listViaIpc(filter)
}

export async function deleteQuoteHistoryRecord(id: string): Promise<ApiResult<void>> {
  if (isRemoteDataMode() && !isAdminUi()) {
    return { ok: false, message: '报价记录仅在管理端管理' }
  }
  if (isRemoteDataMode()) {
    return deleteViaHttp(id)
  }
  return deleteViaIpc(id)
}

export type QuoteHistoryAppendInput = {
  action: 'copy' | 'export'
  customer?: string
  jobName?: string
  tech: 'fdm' | 'resin'
  weightG: number
  printHours: number
  qty: number
  options: QuoteHistoryOption[]
  textPreview?: string
  gcodeFileName?: string
  userId?: string
  username?: string
  displayName?: string
}

/** Persist one copy/export event (client → HTTP, server → IPC). */
export async function appendQuoteHistory(
  input: QuoteHistoryAppendInput
): Promise<ApiResult<QuoteHistoryRecord>> {
  const payload = {
    action: input.action,
    customer: input.customer,
    jobName: input.jobName,
    tech: input.tech,
    weightG: input.weightG,
    printHours: input.printHours,
    qty: input.qty,
    options: input.options,
    textPreview: input.textPreview,
    gcodeFileName: input.gcodeFileName
  }
  if (isClientMode()) {
    try {
      const data = await serverSend<{ record?: QuoteHistoryRecord }>(
        '/api/v1/quote/history',
        'POST',
        payload
      )
      if (!data.record) {
        return { ok: false, message: '未返回记录' }
      }
      return { ok: true, data: data.record }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e)
      }
    }
  }

  const append = window.electronAPI?.quoteHistory?.append
  if (!append) {
    return { ok: false, message: `报价记录模块未加载。${RESTART_HINT}` }
  }
  try {
    const res = await append({
      ...payload,
      userId: input.userId || 'local-server',
      username: input.username || 'server',
      displayName: input.displayName || input.username || '本机服务端'
    })
    if (!res?.ok) {
      return { ok: false, message: res?.message || '写入失败' }
    }
    if (!res.record) {
      return { ok: false, message: '写入失败' }
    }
    return { ok: true, data: res.record as QuoteHistoryRecord }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (/no handler registered/i.test(detail)) {
      return { ok: false, message: `报价记录接口不可用。${RESTART_HINT}` }
    }
    return { ok: false, message: detail || '写入失败' }
  }
}
