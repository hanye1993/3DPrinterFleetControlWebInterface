import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/pool'
import type { JsonArrayProvider } from '../../main/storage/jsonBridge'

const DEVICE_FILE = 'devices.json'
const FILAMENT_FILE = 'filament-spools.json'
const MONITOR_FILE = 'monitor-zones.json'
const SETTINGS_FILE = 'app-settings.json'

function parseJsonCell(raw: unknown): unknown {
  if (raw == null) return null
  if (typeof raw === 'string') return JSON.parse(raw)
  return raw
}

function endsWith(path: string, name: string): boolean {
  return path.replace(/\\/g, '/').endsWith(name)
}

export function createMysqlJsonProvider(): JsonArrayProvider {
  return {
    readArray: (logicalPath: string): unknown[] => {
      throw new Error(`Use async read — call readArrayAsync instead for ${logicalPath}`)
    },
    writeArray: (): void => {
      throw new Error('Use async write')
    }
  }
}

/** Synchronous wrapper cache — refreshed on each write */
const arrayCache = new Map<string, unknown[]>()

export async function readArrayAsync(logicalPath: string): Promise<unknown[]> {
  const cached = arrayCache.get(logicalPath)
  if (cached) return cached

  const p = getPool()
  if (endsWith(logicalPath, DEVICE_FILE)) {
    const [rows] = await p.query<RowDataPacket[]>('SELECT data FROM devices ORDER BY created_at')
    const list = rows.map((r) => parseJsonCell(r.data))
    arrayCache.set(logicalPath, list)
    return list
  }
  if (endsWith(logicalPath, FILAMENT_FILE)) {
    const [rows] = await p.query<RowDataPacket[]>('SELECT data FROM filament_spools')
    const list = rows.map((r) => parseJsonCell(r.data))
    arrayCache.set(logicalPath, list)
    return list
  }
  if (endsWith(logicalPath, MONITOR_FILE)) {
    const [rows] = await p.query<RowDataPacket[]>(
      'SELECT data FROM monitor_zones ORDER BY sort_order, updated_at'
    )
    const list = rows.map((r) => parseJsonCell(r.data))
    arrayCache.set(logicalPath, list)
    return list
  }
  return []
}

export async function writeArrayAsync(logicalPath: string, data: unknown[]): Promise<void> {
  const p = getPool()
  if (endsWith(logicalPath, DEVICE_FILE)) {
    await p.query('DELETE FROM devices')
    for (const row of data) {
      const obj = row as { id?: string }
      const id = String(obj.id || '')
      if (!id) continue
      await p.query('INSERT INTO devices (id, data) VALUES (?, ?)', [id, JSON.stringify(row)])
    }
    arrayCache.set(logicalPath, data)
    return
  }
  if (endsWith(logicalPath, FILAMENT_FILE)) {
    await p.query('DELETE FROM filament_spools')
    for (const row of data) {
      const obj = row as { id?: string }
      const id = String(obj.id || '')
      if (!id) continue
      await p.query('INSERT INTO filament_spools (id, data) VALUES (?, ?)', [id, JSON.stringify(row)])
    }
    arrayCache.set(logicalPath, data)
    return
  }
  if (endsWith(logicalPath, MONITOR_FILE)) {
    await p.query('DELETE FROM monitor_zones')
    let i = 0
    for (const row of data) {
      const obj = row as { id?: string }
      const id = String(obj.id || `zone-${i}`)
      await p.query('INSERT INTO monitor_zones (id, data, sort_order) VALUES (?, ?, ?)', [
        id,
        JSON.stringify(row),
        i++
      ])
    }
    arrayCache.set(logicalPath, data)
  }
}

export async function readSettingsAsync(): Promise<Record<string, unknown> | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT data FROM app_settings WHERE id = 1 LIMIT 1'
  )
  if (!rows[0]?.data) return null
  return parseJsonCell(rows[0].data) as Record<string, unknown>
}

export async function writeSettingsAsync(data: Record<string, unknown>): Promise<void> {
  await getPool().query(
    'INSERT INTO app_settings (id, data) VALUES (1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
    [JSON.stringify(data)]
  )
}

export function invalidateCache(): void {
  arrayCache.clear()
}

/** Sync provider for ApiServer — uses in-memory cache synced async at bootstrap */
export function createSyncMysqlJsonProvider(
  paths: { devices: string; filament: string; monitor: string }
): JsonArrayProvider {
  return {
    readArray: (logicalPath: string) => {
      const cached = arrayCache.get(logicalPath)
      if (cached) return cached
      if (endsWith(logicalPath, DEVICE_FILE)) return arrayCache.get(paths.devices) || []
      if (endsWith(logicalPath, FILAMENT_FILE)) return arrayCache.get(paths.filament) || []
      if (endsWith(logicalPath, MONITOR_FILE)) return arrayCache.get(paths.monitor) || []
      return []
    },
    writeArray: (logicalPath: string, data: unknown[]) => {
      arrayCache.set(logicalPath, data)
      void writeArrayAsync(logicalPath, data).catch((e) => console.error('[mysql] write failed', e))
    },
    readObject: (logicalPath: string) => {
      if (endsWith(logicalPath, SETTINGS_FILE)) {
        const cached = arrayCache.get(logicalPath)
        return (cached?.[0] as Record<string, unknown>) || null
      }
      return null
    },
    writeObject: (logicalPath: string, data: Record<string, unknown>) => {
      if (endsWith(logicalPath, SETTINGS_FILE)) {
        arrayCache.set(logicalPath, [data])
        void writeSettingsAsync(data).catch((e) => console.error('[mysql] settings write failed', e))
      }
    }
  }
}

export async function warmMysqlCache(paths: {
  devices: string
  filament: string
  monitor: string
  settings: string
}): Promise<void> {
  const devices = await readArrayAsync(paths.devices)
  const filament = await readArrayAsync(paths.filament)
  const monitor = await readArrayAsync(paths.monitor)
  const settings = await readSettingsAsync()
  arrayCache.set(paths.devices, devices)
  arrayCache.set(paths.filament, filament)
  arrayCache.set(paths.monitor, monitor)
  if (settings) arrayCache.set(paths.settings, [settings])
}
