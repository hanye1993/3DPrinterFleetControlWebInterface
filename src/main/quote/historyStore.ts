import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { QuoteHistoryOption, QuoteHistoryRecord } from '../../shared/quoteHistory'

type FileShape = { records: QuoteHistoryRecord[] }

const MAX_RECORDS = 5000

export class QuoteHistoryStore {
  private path: string

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'quote-history.json')
  }

  private ensure(): void {
    mkdirSync(dirname(this.path), { recursive: true })
  }

  private readAll(): QuoteHistoryRecord[] {
    this.ensure()
    if (!existsSync(this.path)) return []
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as FileShape | QuoteHistoryRecord[]
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.records) ? raw.records : []
      return list.filter((r) => r && typeof r === 'object' && typeof (r as QuoteHistoryRecord).id === 'string')
    } catch {
      return []
    }
  }

  private writeAll(records: QuoteHistoryRecord[]): void {
    this.ensure()
    writeFileSync(this.path, JSON.stringify({ records }, null, 2), 'utf8')
  }

  append(input: {
    action: 'copy' | 'export'
    userId?: string
    username?: string
    displayName?: string
    customer?: string
    jobName?: string
    tech?: 'fdm' | 'resin'
    weightG?: number
    printHours?: number
    qty?: number
    options?: QuoteHistoryOption[]
    textPreview?: string
    gcodeFileName?: string
  }): QuoteHistoryRecord {
    const options = (input.options || []).map((o) => ({
      name: String(o.name || ''),
      brandLabel: String(o.brandLabel || ''),
      materialLabel: String(o.materialLabel || ''),
      color: String(o.color || ''),
      pricePerKg: Number(o.pricePerKg) || 0,
      perUnit: Number(o.perUnit) || 0,
      grand: Number(o.grand) || 0,
      profit: o.profit != null ? Number(o.profit) || 0 : undefined,
      note: o.note ? String(o.note) : undefined
    }))
    if (!options.length) throw new Error('缺少报价方案')

    const grands = options.map((o) => o.grand)
    const record: QuoteHistoryRecord = {
      id: randomUUID(),
      action: input.action === 'export' ? 'export' : 'copy',
      createdAt: new Date().toISOString(),
      userId: String(input.userId || ''),
      username: String(input.username || 'unknown'),
      displayName: String(input.displayName || input.username || '未知用户'),
      customer: String(input.customer || '').trim(),
      jobName: String(input.jobName || '').trim(),
      tech: input.tech === 'resin' ? 'resin' : 'fdm',
      weightG: Number(input.weightG) || 0,
      printHours: Number(input.printHours) || 0,
      qty: Math.max(1, Math.floor(Number(input.qty) || 1)),
      options,
      minGrand: Math.min(...grands),
      maxGrand: Math.max(...grands),
      textPreview: input.textPreview ? String(input.textPreview).slice(0, 4000) : undefined,
      gcodeFileName: input.gcodeFileName ? String(input.gcodeFileName) : undefined
    }

    const all = this.readAll()
    all.unshift(record)
    this.writeAll(all.slice(0, MAX_RECORDS))
    return record
  }

  list(filter?: {
    q?: string
    userId?: string
    username?: string
    action?: string
    limit?: number
  }): QuoteHistoryRecord[] {
    let list = this.readAll()
    const q = String(filter?.q || '')
      .trim()
      .toLowerCase()
    if (filter?.userId) {
      list = list.filter((r) => r.userId === filter.userId)
    }
    if (filter?.username) {
      const u = filter.username.trim().toLowerCase()
      list = list.filter((r) => {
        const username = String(r.username || '').toLowerCase()
        const displayName = String(r.displayName || '').toLowerCase()
        return username === u || displayName.includes(u)
      })
    }
    if (filter?.action === 'copy' || filter?.action === 'export') {
      list = list.filter((r) => r.action === filter.action)
    }
    if (q) {
      list = list.filter((r) => {
        const options = Array.isArray(r.options) ? r.options : []
        const hay = [
          r.username,
          r.displayName,
          r.customer,
          r.jobName,
          r.tech,
          r.action,
          r.gcodeFileName,
          r.textPreview,
          String(r.minGrand),
          String(r.maxGrand),
          ...options.map(
            (o) =>
              `${o.name} ${o.brandLabel} ${o.materialLabel} ${o.color} ${o.pricePerKg} ${o.perUnit} ${o.grand}`
          )
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return hay.includes(q)
      })
    }
    const limit = Math.min(1000, Math.max(1, Number(filter?.limit) || 200))
    return list.slice(0, limit)
  }

  remove(id: string): void {
    const all = this.readAll()
    const next = all.filter((r) => r.id !== id)
    if (next.length === all.length) throw new Error('记录不存在')
    this.writeAll(next)
  }

  clear(): void {
    this.writeAll([])
  }
}
