import { randomUUID } from 'crypto'
import type { RowDataPacket } from 'mysql2/promise'
import type { QuoteHistoryOption, QuoteHistoryRecord } from '../../shared/quoteHistory'
import { getPool } from '../db/pool'

const MAX_RECORDS = 5000

export class MysqlQuoteHistoryStore {
  private records: QuoteHistoryRecord[] = []

  async init(): Promise<void> {
    const [rows] = await getPool().query<RowDataPacket[]>(
      'SELECT data FROM quote_history ORDER BY created_at DESC LIMIT ?',
      [MAX_RECORDS]
    )
    this.records = rows
      .map((r) => {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
        return data as QuoteHistoryRecord
      })
      .filter((r) => r && typeof r.id === 'string')
  }

  private async persist(record: QuoteHistoryRecord): Promise<void> {
    await getPool().query(
      `INSERT INTO quote_history (id, data, user_id, username, action, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE data = VALUES(data)`,
      [
        record.id,
        JSON.stringify(record),
        record.userId || null,
        record.username || null,
        record.action || null,
        new Date(record.createdAt)
      ]
    )
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
      grand: Number(o.grand) || 0
    }))
    const grands = options.map((o) => o.grand).filter((n) => Number.isFinite(n))
    const record: QuoteHistoryRecord = {
      id: randomUUID(),
      action: input.action,
      userId: input.userId || '',
      username: input.username || '',
      displayName: input.displayName || '',
      customer: input.customer || '',
      jobName: input.jobName || '',
      tech: input.tech || 'fdm',
      weightG: input.weightG ?? 0,
      printHours: input.printHours ?? 0,
      qty: input.qty ?? 1,
      options,
      minGrand: grands.length ? Math.min(...grands) : 0,
      maxGrand: grands.length ? Math.max(...grands) : 0,
      textPreview: input.textPreview,
      gcodeFileName: input.gcodeFileName,
      createdAt: new Date().toISOString()
    }
    this.records.unshift(record)
    if (this.records.length > MAX_RECORDS) this.records.length = MAX_RECORDS
    void this.persist(record).catch((e) => console.error('[mysql] quote_history save failed', e))
    return record
  }

  list(filter?: {
    q?: string
    userId?: string
    username?: string
    action?: string
    limit?: number
  }): QuoteHistoryRecord[] {
    let list = [...this.records]
    const q = String(filter?.q || '')
      .trim()
      .toLowerCase()
    if (filter?.userId) list = list.filter((r) => r.userId === filter.userId)
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
    const before = this.records.length
    this.records = this.records.filter((r) => r.id !== id)
    if (this.records.length === before) throw new Error('记录不存在')
    void getPool()
      .query('DELETE FROM quote_history WHERE id = ?', [id])
      .catch((e) => console.error('[mysql] quote_history delete failed', e))
  }

  clear(): void {
    this.records = []
    void getPool()
      .query('DELETE FROM quote_history')
      .catch((e) => console.error('[mysql] quote_history clear failed', e))
  }
}
