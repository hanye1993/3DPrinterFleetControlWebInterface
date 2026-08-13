import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

export type PrintRequestStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'done'
  | 'rejected'
  | 'cancelled'
  | 'failed'
  /** @deprecated migrated to queued/done */
  | 'approved'

export type PrintRequest = {
  id: string
  status: PrintRequestStatus
  requesterId: string
  requesterName: string
  deviceId: string
  deviceName: string
  filename: string
  /** uploaded G-code for later dispatch */
  contentBase64?: string
  note?: string
  createdAt: string
  updatedAt: string
  queuedAt?: string
  startedAt?: string
  errorMessage?: string
  /** Free-form plugin payload */
  pluginData?: Record<string, unknown>
  reviewedById?: string
  reviewedByName?: string
  reviewNote?: string
  startedById?: string
  startedByName?: string
}

export type PrintRequestPublic = Omit<PrintRequest, 'contentBase64'> & {
  queuePosition?: number
  hasContent?: boolean
}

function stripContent(row: PrintRequest): PrintRequestPublic {
  const { contentBase64, ...rest } = row
  return { ...rest, hasContent: Boolean(contentBase64) }
}

function migrateStatus(s: string): PrintRequestStatus {
  if (s === 'approved') return 'queued'
  if (
    s === 'pending' ||
    s === 'queued' ||
    s === 'printing' ||
    s === 'done' ||
    s === 'rejected' ||
    s === 'cancelled' ||
    s === 'failed'
  ) {
    return s
  }
  return 'pending'
}

export class PrintRequestStore {
  private path: string
  private items: PrintRequest[] = []

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'print-requests.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const raw = JSON.parse(readFileSync(this.path, 'utf8')) as PrintRequest[]
        if (Array.isArray(raw)) {
          let changed = false
          this.items = raw.map((row) => {
            const status = migrateStatus(String(row.status || 'pending'))
            if (status !== row.status) changed = true
            const next: PrintRequest = { ...row, status }
            if (status === 'queued' && !next.queuedAt) {
              next.queuedAt = next.updatedAt || next.createdAt
              changed = true
            }
            return next
          })
          if (changed) this.persist()
        }
      }
    } catch {
      this.items = []
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(this.items, null, 2), 'utf8')
  }

  /** 1-based position among queued jobs on the same device */
  queuePosition(id: string): number | undefined {
    const row = this.get(id)
    if (!row || row.status !== 'queued') return undefined
    const queued = this.items
      .filter((x) => x.deviceId === row.deviceId && x.status === 'queued')
      .sort((a, b) => (a.queuedAt || a.createdAt).localeCompare(b.queuedAt || b.createdAt))
    const idx = queued.findIndex((x) => x.id === id)
    return idx >= 0 ? idx + 1 : undefined
  }

  private withPosition(row: PrintRequest): PrintRequestPublic {
    const pub = stripContent(row)
    const pos = this.queuePosition(row.id)
    if (pos != null) pub.queuePosition = pos
    return pub
  }

  list(filter?: {
    status?: PrintRequestStatus | PrintRequestStatus[]
    deviceId?: string
    requesterId?: string
  }): PrintRequestPublic[] {
    let list = [...this.items]
    if (filter?.deviceId) list = list.filter((x) => x.deviceId === filter.deviceId)
    if (filter?.requesterId) list = list.filter((x) => x.requesterId === filter.requesterId)
    if (filter?.status) {
      const set = new Set(Array.isArray(filter.status) ? filter.status : [filter.status])
      list = list.filter((x) => set.has(x.status))
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return list.map((x) => this.withPosition(x))
  }

  /** Queued jobs for a device, FIFO by queuedAt */
  queueForDevice(deviceId: string): PrintRequestPublic[] {
    return this.items
      .filter((x) => x.deviceId === deviceId && x.status === 'queued')
      .sort((a, b) => (a.queuedAt || a.createdAt).localeCompare(b.queuedAt || b.createdAt))
      .map((x, i) => {
        const pub = stripContent(x)
        pub.queuePosition = i + 1
        return pub
      })
  }

  get(id: string): PrintRequest | undefined {
    return this.items.find((x) => x.id === id)
  }

  create(
    input: Omit<PrintRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'queuedAt'> & {
      status?: 'pending' | 'queued'
    }
  ): PrintRequestPublic {
    const now = new Date().toISOString()
    const status: PrintRequestStatus = input.status === 'queued' ? 'queued' : 'pending'
    const { status: _s, ...rest } = input as typeof input & { status?: string }
    const row: PrintRequest = {
      ...rest,
      id: randomUUID(),
      status,
      createdAt: now,
      updatedAt: now,
      queuedAt: status === 'queued' ? now : undefined
    }
    this.items.push(row)
    this.persist()
    return this.withPosition(row)
  }

  approve(
    id: string,
    reviewer: { id: string; name: string },
    reviewNote?: string
  ): PrintRequestPublic {
    const row = this.get(id)
    if (!row) throw new Error('申请不存在')
    if (row.status !== 'pending') throw new Error('仅待审核申请可通过')
    const now = new Date().toISOString()
    row.status = 'queued'
    row.queuedAt = now
    row.reviewedById = reviewer.id
    row.reviewedByName = reviewer.name
    row.reviewNote = reviewNote
    row.updatedAt = now
    this.persist()
    return this.withPosition(row)
  }

  reject(
    id: string,
    reviewer: { id: string; name: string },
    reviewNote?: string
  ): PrintRequestPublic {
    const row = this.get(id)
    if (!row) throw new Error('申请不存在')
    if (row.status !== 'pending') throw new Error('仅待审核申请可拒绝')
    row.status = 'rejected'
    row.reviewedById = reviewer.id
    row.reviewedByName = reviewer.name
    row.reviewNote = reviewNote
    row.updatedAt = new Date().toISOString()
    this.persist()
    return stripContent(row)
  }

  cancel(id: string, actorId: string, asAdmin: boolean): PrintRequestPublic {
    const row = this.get(id)
    if (!row) throw new Error('申请不存在')
    if (row.status !== 'pending' && row.status !== 'queued') {
      throw new Error('仅待审核或排队中的任务可取消')
    }
    if (!asAdmin && row.requesterId !== actorId) {
      throw new Error('只能取消自己的任务')
    }
    row.status = 'cancelled'
    row.updatedAt = new Date().toISOString()
    this.persist()
    return stripContent(row)
  }

  markPrinting(id: string, starter: { id: string; name: string }): PrintRequest {
    const row = this.get(id)
    if (!row) throw new Error('任务不存在')
    if (row.status !== 'queued') throw new Error('仅排队中的任务可开始打印')
    if (!row.contentBase64) throw new Error('任务缺少 G 文件内容，无法下发')
    const now = new Date().toISOString()
    row.status = 'printing'
    row.startedAt = now
    row.startedById = starter.id
    row.startedByName = starter.name
    row.updatedAt = now
    row.errorMessage = undefined
    this.persist()
    return row
  }

  markDone(id: string): PrintRequestPublic {
    const row = this.get(id)
    if (!row) throw new Error('任务不存在')
    row.status = 'done'
    row.updatedAt = new Date().toISOString()
    // Drop payload after successful dispatch to keep file small
    row.contentBase64 = undefined
    this.persist()
    return stripContent(row)
  }

  markFailed(id: string, message: string): PrintRequestPublic {
    const row = this.get(id)
    if (!row) throw new Error('任务不存在')
    row.status = 'failed'
    row.errorMessage = message
    row.updatedAt = new Date().toISOString()
    this.persist()
    return stripContent(row)
  }

  /** Legacy helper — prefer approve/reject/cancel */
  setStatus(
    id: string,
    status: PrintRequestStatus,
    reviewer: { id: string; name: string },
    reviewNote?: string
  ): PrintRequestPublic {
    if (status === 'queued' || status === 'approved') {
      return this.approve(id, reviewer, reviewNote)
    }
    if (status === 'rejected') return this.reject(id, reviewer, reviewNote)
    if (status === 'cancelled') return this.cancel(id, reviewer.id, true)
    throw new Error(`不支持的状态变更: ${status}`)
  }
}

export function appendPrintRequestLog(dataRoot: string, line: object): void {
  try {
    const p = join(dataRoot, 'print-requests.jsonl')
    mkdirSync(dirname(p), { recursive: true })
    appendFileSync(p, JSON.stringify(line) + '\n', 'utf8')
  } catch {
    /* ignore */
  }
}
