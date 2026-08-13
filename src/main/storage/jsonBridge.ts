import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export type JsonArrayProvider = {
  readArray: (logicalPath: string) => unknown[]
  writeArray: (logicalPath: string, data: unknown[]) => void
  readObject?: (logicalPath: string) => Record<string, unknown> | null
  writeObject?: (logicalPath: string, data: Record<string, unknown>) => void
}

/** Optional Kernel hooks around JSON storage (sync API; hooks are best-effort async). */
export type JsonStorageHooks = {
  before: (
    op: string,
    path: string,
    data?: unknown
  ) => Promise<{ proceed: boolean; path: string; data?: unknown }> | {
    proceed: boolean
    path: string
    data?: unknown
  }
  after: (op: string, path: string) => Promise<void> | void
}

let provider: JsonArrayProvider | null = null
let storageHooks: JsonStorageHooks | null = null

export function setJsonProvider(p: JsonArrayProvider | null): void {
  provider = p
}

export function getJsonProvider(): JsonArrayProvider | null {
  return provider
}

export function setJsonStorageHooks(h: JsonStorageHooks | null): void {
  storageHooks = h
}

function fireBefore(op: string, path: string, data?: unknown): string {
  if (!storageHooks) return path
  try {
    const r = storageHooks.before(op, path, data)
    if (r && typeof (r as Promise<unknown>).then === 'function') {
      void (r as Promise<{ proceed: boolean; path: string }>).then((p) => {
        if (p.proceed) void Promise.resolve(storageHooks?.after(op, p.path)).catch(() => undefined)
      })
      return path
    }
    const sync = r as { proceed: boolean; path: string }
    if (sync.proceed === false) return path
    void Promise.resolve(storageHooks.after(op, sync.path || path)).catch(() => undefined)
    return sync.path || path
  } catch {
    return path
  }
}

function readFileArray(path: string): unknown[] {
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeFileArray(path: string, data: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

function readFileObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function writeFileObject(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
}

export function readJsonArray(path: string): unknown[] {
  const p = fireBefore('readArray', path)
  if (provider) return provider.readArray(p)
  return readFileArray(p)
}

export function writeJsonArray(path: string, data: unknown[]): void {
  const p = fireBefore('writeArray', path, data)
  if (provider) {
    provider.writeArray(p, data)
    return
  }
  writeFileArray(p, data)
}

export function readJsonObject(path: string): Record<string, unknown> | null {
  const p = fireBefore('readObject', path)
  if (provider?.readObject) return provider.readObject(p)
  return readFileObject(p)
}

export function writeJsonObject(path: string, data: Record<string, unknown>): void {
  const p = fireBefore('writeObject', path, data)
  if (provider?.writeObject) {
    provider.writeObject(p, data)
    return
  }
  writeFileObject(p, data)
}
