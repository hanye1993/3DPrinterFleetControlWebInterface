import { randomUUID } from 'crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type {
  QuoteSchemeMaterialOption,
  QuoteSchemeRecord,
  QuoteSchemeSummary
} from '../../shared/quoteSchemes'
import { getPool } from '../db/pool'

function safeName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80)
}

function rowToRecord(r: RowDataPacket): QuoteSchemeRecord {
  const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
  const record = data as QuoteSchemeRecord
  record.id = String(r.id)
  if (r.gcode) {
    record.gcodeRelativePath = `mysql://${record.id}`
    record.gcodeFileName = String(r.gcode_file_name || record.gcodeFileName || '')
  }
  return record
}

export class MysqlQuoteSchemesStore {
  private schemes: QuoteSchemeRecord[] = []
  private gcodeCache = new Map<string, string>()

  async init(): Promise<void> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT id, name, data, gcode, gcode_file_name, updated_at FROM quote_schemes ORDER BY updated_at DESC'
    )
    this.schemes = rows.map(rowToRecord)
    for (const r of rows) {
      if (r.gcode) this.gcodeCache.set(String(r.id), String(r.gcode))
    }
  }

  list(): QuoteSchemeSummary[] {
    return this.schemes
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((s) => ({
        id: s.id,
        name: s.name,
        customer: s.customer || '',
        jobName: s.jobName || '',
        tech: s.tech,
        weightG: s.weightG,
        hours: s.hours,
        minutesExtra: s.minutesExtra,
        wastePct: s.wastePct,
        printerId: s.printerId,
        watts: s.watts,
        electricity: s.electricity,
        wearPerHour: s.wearPerHour,
        laborMinutes: s.laborMinutes,
        laborRate: s.laborRate,
        packaging: s.packaging,
        shipping: s.shipping,
        failPct: s.failPct,
        pricingMode: s.pricingMode,
        markupPct: s.markupPct,
        marginPct: s.marginPct,
        minPrice: s.minPrice,
        qty: s.qty,
        gcodeFileName: s.gcodeFileName,
        gcodeRelativePath: s.gcodeRelativePath,
        gcodeNote: s.gcodeNote,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        optionCount: Array.isArray(s.options) ? s.options.length : 0,
        hasGcode: Boolean(s.gcodeRelativePath)
      }))
  }

  get(id: string): QuoteSchemeRecord | null {
    return this.schemes.find((x) => x.id === id) || null
  }

  readGcode(id: string): { ok: true; text: string; fileName?: string } | { ok: false; message: string } {
    const s = this.get(id)
    if (!s) return { ok: false, message: '方案不存在' }
    const text = this.gcodeCache.get(id)
    if (!text) return { ok: false, message: '该方案未保存 G-code' }
    return { ok: true, text, fileName: s.gcodeFileName }
  }

  save(input: {
    id?: string
    name: string
    customer?: string
    jobName?: string
    tech: QuoteSchemeRecord['tech']
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
    pricingMode: QuoteSchemeRecord['pricingMode']
    markupPct: number
    marginPct: number
    minPrice: number
    qty: number
    options: QuoteSchemeMaterialOption[]
    gcodeText?: string | null
    gcodeFileName?: string | null
    gcodeNote?: string | null
    clearGcode?: boolean
  }): QuoteSchemeRecord {
    const name = String(input.name || '').trim()
    if (!name) throw new Error('请填写方案名称')
    if (!Array.isArray(input.options) || !input.options.length) {
      throw new Error('至少保留一条耗材方案')
    }

    const now = new Date().toISOString()
    const existing = input.id ? this.schemes.find((x) => x.id === input.id) : undefined
    const id = existing?.id || randomUUID()

    let gcodeFileName = existing?.gcodeFileName
    let gcodeRelativePath = existing?.gcodeRelativePath
    let gcodeText: string | null = this.gcodeCache.get(id) || null

    if (input.clearGcode) {
      gcodeFileName = undefined
      gcodeRelativePath = undefined
      gcodeText = null
      this.gcodeCache.delete(id)
    } else if (typeof input.gcodeText === 'string' && input.gcodeText.length > 0) {
      gcodeText = input.gcodeText
      gcodeRelativePath = `mysql://${id}`
      gcodeFileName =
        safeName(input.gcodeFileName || existing?.gcodeFileName || 'model.gcode') || 'model.gcode'
      this.gcodeCache.set(id, gcodeText)
    }

    const record: QuoteSchemeRecord = {
      id,
      name,
      customer: String(input.customer || '').trim(),
      jobName: String(input.jobName || '').trim(),
      tech: input.tech === 'resin' ? 'resin' : 'fdm',
      weightG: Number(input.weightG) || 0,
      hours: Number(input.hours) || 0,
      minutesExtra: Number(input.minutesExtra) || 0,
      wastePct: Number(input.wastePct) || 0,
      printerId: String(input.printerId || 'custom'),
      watts: Number(input.watts) || 0,
      electricity: Number(input.electricity) || 0,
      wearPerHour: Number(input.wearPerHour) || 0,
      laborMinutes: Number(input.laborMinutes) || 0,
      laborRate: Number(input.laborRate) || 0,
      packaging: Number(input.packaging) || 0,
      shipping: Number(input.shipping) || 0,
      failPct: Number(input.failPct) || 0,
      pricingMode: input.pricingMode === 'margin' ? 'margin' : 'markup',
      markupPct: Number(input.markupPct) || 0,
      marginPct: Number(input.marginPct) || 0,
      minPrice: Number(input.minPrice) || 0,
      qty: Math.max(1, Math.floor(Number(input.qty) || 1)),
      options: input.options.map((o) => ({
        id: String(o.id || randomUUID()),
        name: String(o.name || ''),
        brandId: String(o.brandId || ''),
        materialId: String(o.materialId || ''),
        color: String(o.color || ''),
        colorHex: String(o.colorHex || '#1a1a1a'),
        pricePerKg: Number(o.pricePerKg) || 0,
        spoolId: o.spoolId ? String(o.spoolId) : null,
        note: String(o.note || '')
      })),
      gcodeFileName,
      gcodeRelativePath,
      gcodeNote: input.gcodeNote != null ? String(input.gcodeNote) : existing?.gcodeNote,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }

    if (existing) {
      this.schemes = this.schemes.map((x) => (x.id === id ? record : x))
    } else {
      this.schemes = [record, ...this.schemes]
    }

    const { gcodeRelativePath: _rp, ...dataForJson } = record
    void getPool()
      .query(
        `INSERT INTO quote_schemes (id, name, data, gcode, gcode_file_name, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), data = VALUES(data),
           gcode = VALUES(gcode), gcode_file_name = VALUES(gcode_file_name), updated_at = VALUES(updated_at)`,
        [
          id,
          record.name,
          JSON.stringify({ ...dataForJson, gcodeRelativePath: gcodeRelativePath || null }),
          gcodeText,
          gcodeFileName || null,
          new Date(now)
        ]
      )
      .catch((e) => console.error('[mysql] quote_schemes save failed', e))

    return record
  }

  remove(id: string): void {
    const target = this.schemes.find((x) => x.id === id)
    if (!target) throw new Error('方案不存在')
    this.schemes = this.schemes.filter((x) => x.id !== id)
    this.gcodeCache.delete(id)
    void getPool()
      .query('DELETE FROM quote_schemes WHERE id = ?', [id])
      .catch((e) => console.error('[mysql] quote_schemes delete failed', e))
  }
}
