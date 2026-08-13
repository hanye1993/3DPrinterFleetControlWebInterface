import type { QuoteSchemeRecord, QuoteSchemeSummary } from '@shared/quoteSchemes'
import { serverGet, serverSend } from './serverClient'

export async function listQuoteSchemes(): Promise<QuoteSchemeSummary[]> {
  const data = await serverGet<{ schemes?: QuoteSchemeSummary[] }>('/api/v1/quote/schemes')
  return data.schemes || []
}

export async function getQuoteScheme(id: string): Promise<QuoteSchemeRecord> {
  const data = await serverGet<{ scheme?: QuoteSchemeRecord }>(
    `/api/v1/quote/schemes/${encodeURIComponent(id)}`
  )
  if (!data.scheme) throw new Error('方案不存在')
  return data.scheme
}

export async function readQuoteSchemeGcode(
  id: string
): Promise<{ ok: boolean; text?: string; fileName?: string; message?: string }> {
  try {
    return await serverGet<{ ok: boolean; text?: string; fileName?: string; message?: string }>(
      `/api/v1/quote/schemes/${encodeURIComponent(id)}/gcode`
    )
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export type SaveQuoteSchemePayload = {
  id?: string
  name: string
  customer?: string
  jobName?: string
  tech: 'fdm' | 'resin'
  weightG: number
  hours: number
  minutesExtra: number
  wastePct: number
  printerId: string
  watts: number
  electricity: number
  wearPerHour: number
  laborMinutes: number
  laborRate: number
  packaging: number
  shipping: number
  failPct: number
  pricingMode: 'markup' | 'margin'
  markupPct: number
  marginPct: number
  minPrice: number
  qty: number
  options: QuoteSchemeRecord['options']
  gcodeText?: string
  gcodeFileName?: string
  gcodeNote?: string
  clearGcode?: boolean
}

export async function saveQuoteScheme(
  payload: SaveQuoteSchemePayload
): Promise<QuoteSchemeRecord> {
  const data = await serverSend<{ scheme?: QuoteSchemeRecord }>(
    '/api/v1/quote/schemes',
    'POST',
    payload
  )
  if (!data.scheme) throw new Error('保存失败')
  return data.scheme
}

export async function deleteQuoteScheme(id: string): Promise<void> {
  await serverSend(`/api/v1/quote/schemes/${encodeURIComponent(id)}`, 'DELETE')
}
