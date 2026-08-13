/**
 * MySQL persistence for singleton JSON docs + plugin private JSON.
 * Used when USE_MYSQL=1: nav_config / plugins_state / themes_state / plugin_data.
 * Package assets (ZIP contents under data/plugins|themes) remain on disk.
 */
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/pool'

export type SingletonTable = 'nav_config' | 'plugins_state' | 'themes_state'

export type JsonStatePersistence = {
  load: () => unknown | null
  save: (data: unknown) => void
}

export type PluginDataPersistence = {
  readJson: (pluginId: string, rel: string, fallback?: unknown) => unknown
  writeJson: (pluginId: string, rel: string, data: unknown) => void
}

const singletonCache = new Map<SingletonTable, unknown>()
const pluginDataCache = new Map<string, unknown>()

function parseJsonCell(raw: unknown): unknown {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }
  return raw
}

function pluginCacheKey(pluginId: string, rel: string): string {
  return `${pluginId}\0${normalizeRel(rel)}`
}

export function normalizeRel(rel: string): string {
  return String(rel || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
    .slice(0, 255)
}

async function readSingletonAsync(table: SingletonTable): Promise<unknown | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `SELECT data FROM ${table} WHERE id = 1 LIMIT 1`
  )
  if (!rows[0]?.data) return null
  return parseJsonCell(rows[0].data)
}

async function writeSingletonAsync(table: SingletonTable, data: unknown): Promise<void> {
  await getPool().query(
    `INSERT INTO ${table} (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [JSON.stringify(data ?? {})]
  )
}

async function readAllPluginDataAsync(): Promise<void> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT plugin_id, rel_path, data FROM plugin_data'
  )
  pluginDataCache.clear()
  for (const r of rows) {
    const id = String(r.plugin_id || '')
    const rel = normalizeRel(String(r.rel_path || ''))
    if (!id || !rel) continue
    pluginDataCache.set(pluginCacheKey(id, rel), parseJsonCell(r.data))
  }
}

async function writePluginDataAsync(
  pluginId: string,
  rel: string,
  data: unknown
): Promise<void> {
  const path = normalizeRel(rel)
  await getPool().query(
    `INSERT INTO plugin_data (plugin_id, rel_path, data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE data = VALUES(data)`,
    [pluginId, path, JSON.stringify(data ?? null)]
  )
}

/** Load all meta tables into sync cache (call once at Node boot). */
export async function warmMysqlMetaCaches(): Promise<void> {
  for (const table of ['nav_config', 'plugins_state', 'themes_state'] as SingletonTable[]) {
    const data = await readSingletonAsync(table)
    if (data != null) singletonCache.set(table, data)
    else singletonCache.delete(table)
  }
  await readAllPluginDataAsync()
}

export function createMysqlSingletonPersistence(table: SingletonTable): JsonStatePersistence {
  return {
    load: () => {
      if (!singletonCache.has(table)) return null
      return singletonCache.get(table) ?? null
    },
    save: (data) => {
      singletonCache.set(table, data)
      void writeSingletonAsync(table, data).catch((e) =>
        console.error(`[mysql] ${table} write failed`, e)
      )
    }
  }
}

export function createMysqlPluginDataPersistence(): PluginDataPersistence {
  return {
    readJson: (pluginId, rel, fallback = null) => {
      const key = pluginCacheKey(pluginId, rel)
      if (!pluginDataCache.has(key)) return fallback
      return pluginDataCache.get(key)
    },
    writeJson: (pluginId, rel, data) => {
      const path = normalizeRel(rel)
      if (!path || path.includes('..')) throw new Error('path escape')
      const key = pluginCacheKey(pluginId, path)
      pluginDataCache.set(key, data)
      void writePluginDataAsync(pluginId, path, data).catch((e) =>
        console.error('[mysql] plugin_data write failed', e)
      )
    }
  }
}
