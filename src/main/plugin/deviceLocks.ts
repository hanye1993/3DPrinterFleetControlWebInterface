/**
 * Cross-plugin device claim locks (scheduling).
 * Persisted under dataRoot/device-locks.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type DeviceLockRecord = {
  deviceId: string
  ownerPluginId: string
  ownerLabel?: string
  claimedAt: string
  expiresAt: string
}

type LockFile = { locks: Record<string, DeviceLockRecord> }

function empty(): LockFile {
  return { locks: {} }
}

export class DeviceLockStore {
  private filePath: string
  private mem: LockFile = empty()

  constructor(dataRoot: string) {
    this.filePath = join(dataRoot, 'device-locks.json')
    this.reload()
  }

  private reload(): void {
    try {
      if (!existsSync(this.filePath)) {
        this.mem = empty()
        return
      }
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as LockFile
      this.mem = raw && typeof raw === 'object' && raw.locks ? raw : empty()
    } catch {
      this.mem = empty()
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.mem, null, 2), 'utf8')
  }

  private purgeExpired(now = Date.now()): void {
    let changed = false
    for (const [id, lock] of Object.entries(this.mem.locks)) {
      if (new Date(lock.expiresAt).getTime() <= now) {
        delete this.mem.locks[id]
        changed = true
      }
    }
    if (changed) this.persist()
  }

  get(deviceId: string): DeviceLockRecord | null {
    this.purgeExpired()
    return this.mem.locks[deviceId] || null
  }

  claim(
    deviceId: string,
    ownerPluginId: string,
    opts?: { ttlSec?: number; ownerLabel?: string; force?: boolean }
  ): { ok: true; lock: DeviceLockRecord } | { ok: false; message: string; lock?: DeviceLockRecord } {
    this.purgeExpired()
    const id = String(deviceId || '').trim()
    if (!id) return { ok: false, message: '缺少 deviceId' }
    const existing = this.mem.locks[id]
    if (existing && existing.ownerPluginId !== ownerPluginId && !opts?.force) {
      return { ok: false, message: '设备已被其他插件锁定', lock: existing }
    }
    const ttl = Math.max(30, Math.min(86400, Math.floor(opts?.ttlSec || 3600)))
    const now = new Date()
    const lock: DeviceLockRecord = {
      deviceId: id,
      ownerPluginId,
      ownerLabel: opts?.ownerLabel,
      claimedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl * 1000).toISOString()
    }
    this.mem.locks[id] = lock
    this.persist()
    return { ok: true, lock }
  }

  release(
    deviceId: string,
    ownerPluginId: string,
    opts?: { force?: boolean }
  ): { ok: boolean; message?: string } {
    this.purgeExpired()
    const id = String(deviceId || '').trim()
    const existing = this.mem.locks[id]
    if (!existing) return { ok: true }
    if (existing.ownerPluginId !== ownerPluginId && !opts?.force) {
      return { ok: false, message: '无权释放他人锁定' }
    }
    delete this.mem.locks[id]
    this.persist()
    return { ok: true }
  }

  list(): DeviceLockRecord[] {
    this.purgeExpired()
    return Object.values(this.mem.locks)
  }
}
