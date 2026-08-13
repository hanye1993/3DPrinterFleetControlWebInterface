/**
 * In-app plugin notices (Discuz-like operator inbox, not external alert channels).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'

export type PluginNotice = {
  id: string
  pluginId: string
  level: 'info' | 'warn' | 'error' | 'success'
  title: string
  body: string
  userId?: string
  createdAt: string
  readAt?: string
}

type StoreFile = { notices: PluginNotice[] }

export class PluginNoticeStore {
  private path: string
  private data: StoreFile = { notices: [] }

  constructor(dataRoot: string) {
    this.path = join(dataRoot, 'plugin-notices.json')
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.path)) return
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile
      this.data = { notices: Array.isArray(raw.notices) ? raw.notices : [] }
    } catch {
      this.data = { notices: [] }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true })
    // keep last 500
    if (this.data.notices.length > 500) {
      this.data.notices = this.data.notices.slice(-500)
    }
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), 'utf8')
  }

  push(input: {
    pluginId: string
    level?: PluginNotice['level']
    title: string
    body?: string
    userId?: string
  }): PluginNotice {
    const row: PluginNotice = {
      id: randomBytes(8).toString('hex'),
      pluginId: input.pluginId,
      level: input.level || 'info',
      title: String(input.title || '').slice(0, 200),
      body: String(input.body || '').slice(0, 4000),
      userId: input.userId,
      createdAt: new Date().toISOString()
    }
    this.data.notices.push(row)
    this.save()
    return row
  }

  list(opts?: { userId?: string; unreadOnly?: boolean; limit?: number }): PluginNotice[] {
    const limit = Math.min(200, Math.max(1, opts?.limit || 50))
    let rows = this.data.notices.slice().reverse()
    if (opts?.userId) {
      rows = rows.filter((n) => !n.userId || n.userId === opts.userId)
    } else {
      rows = rows.filter((n) => !n.userId)
    }
    if (opts?.unreadOnly) rows = rows.filter((n) => !n.readAt)
    return rows.slice(0, limit)
  }

  unreadCount(userId?: string): number {
    return this.list({ userId, unreadOnly: true, limit: 200 }).length
  }

  markRead(ids: string[], userId?: string): number {
    const set = new Set(ids)
    let n = 0
    const now = new Date().toISOString()
    for (const row of this.data.notices) {
      if (!set.has(row.id)) continue
      if (row.userId && userId && row.userId !== userId) continue
      if (!row.readAt) {
        row.readAt = now
        n++
      }
    }
    if (n) this.save()
    return n
  }

  markAllRead(userId?: string): number {
    const now = new Date().toISOString()
    let n = 0
    for (const row of this.data.notices) {
      if (row.readAt) continue
      if (row.userId && userId && row.userId !== userId) continue
      if (!row.userId || row.userId === userId) {
        row.readAt = now
        n++
      }
    }
    if (n) this.save()
    return n
  }
}
