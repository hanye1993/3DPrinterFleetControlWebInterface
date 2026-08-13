import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type {
  QuoteSchemeMaterialOption,
  QuoteSchemeRecord,
  QuoteSchemeSummary
} from '../../shared/quoteSchemes'

type SchemesFile = {
  schemes: QuoteSchemeRecord[]
}

function safeName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 80)
}

export class QuoteSchemesStore {
  private dataRoot: string
  private filePath: string
  private gcodeDir: string

  constructor(dataRoot: string) {
    this.dataRoot = dataRoot
    this.filePath = join(dataRoot, 'quote-schemes.json')
    this.gcodeDir = join(dataRoot, 'quote-schemes')
  }

  private ensure(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    mkdirSync(this.gcodeDir, { recursive: true })
  }

  private readAll(): QuoteSchemeRecord[] {
    this.ensure()
    if (!existsSync(this.filePath)) return []
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as SchemesFile | QuoteSchemeRecord[]
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.schemes) ? raw.schemes : []
      return list.filter((s) => s && typeof s === 'object' && typeof (s as QuoteSchemeRecord).id === 'string')
    } catch {
      return []
    }
  }

  private writeAll(schemes: QuoteSchemeRecord[]): void {
    this.ensure()
    writeFileSync(this.filePath, JSON.stringify({ schemes }, null, 2), 'utf8')
  }

  list(): QuoteSchemeSummary[] {
    return this.readAll()
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
    const s = this.readAll().find((x) => x.id === id)
    return s || null
  }

  readGcode(id: string): { ok: true; text: string; fileName?: string } | { ok: false; message: string } {
    const s = this.get(id)
    if (!s) return { ok: false, message: '方案不存在' }
    if (!s.gcodeRelativePath) return { ok: false, message: '该方案未保存 G-code' }
    const abs = join(this.dataRoot, s.gcodeRelativePath)
    if (!existsSync(abs)) return { ok: false, message: 'G-code 文件丢失' }
    try {
      return {
        ok: true,
        text: readFileSync(abs, 'utf8'),
        fileName: s.gcodeFileName
      }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
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
    /** If false and updating, keep existing gcode; if null clear gcode */
    clearGcode?: boolean
  }): QuoteSchemeRecord {
    const name = String(input.name || '').trim()
    if (!name) throw new Error('请填写方案名称')
    if (!Array.isArray(input.options) || !input.options.length) {
      throw new Error('至少保留一条耗材方案')
    }

    const all = this.readAll()
    const now = new Date().toISOString()
    const existing = input.id ? all.find((x) => x.id === input.id) : undefined
    const id = existing?.id || randomUUID()

    let gcodeFileName = existing?.gcodeFileName
    let gcodeRelativePath = existing?.gcodeRelativePath

    if (input.clearGcode) {
      if (gcodeRelativePath) {
        const abs = join(this.dataRoot, gcodeRelativePath)
        try {
          if (existsSync(abs)) unlinkSync(abs)
        } catch {
          /* ignore */
        }
      }
      gcodeFileName = undefined
      gcodeRelativePath = undefined
    } else if (typeof input.gcodeText === 'string' && input.gcodeText.length > 0) {
      this.ensure()
      const rel = `quote-schemes/${id}.gcode`
      const abs = join(this.dataRoot, rel)
      writeFileSync(abs, input.gcodeText, 'utf8')
      gcodeRelativePath = rel
      gcodeFileName =
        safeName(input.gcodeFileName || existing?.gcodeFileName || 'model.gcode') || 'model.gcode'
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

    const next = existing
      ? all.map((x) => (x.id === id ? record : x))
      : [record, ...all]
    this.writeAll(next)
    return record
  }

  remove(id: string): void {
    const all = this.readAll()
    const target = all.find((x) => x.id === id)
    if (!target) throw new Error('方案不存在')
    if (target.gcodeRelativePath) {
      const abs = join(this.dataRoot, target.gcodeRelativePath)
      try {
        if (existsSync(abs)) unlinkSync(abs)
      } catch {
        /* ignore */
      }
    }
    this.writeAll(all.filter((x) => x.id !== id))
  }
}
