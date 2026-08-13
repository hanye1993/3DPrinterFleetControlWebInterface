import type { RowDataPacket } from 'mysql2/promise'
import type { OperationLog, OperationLogListOpts } from '../../shared/operationLog'
import { getPool } from '../db/pool'

const MAX_CACHE = 500

export class MysqlOperationLogStore {
  private cache: OperationLog[] = []

  async init(): Promise<void> {
    this.cache = await this.queryList({ limit: MAX_CACHE })
  }

  append(entry: OperationLog): void {
    this.cache.unshift(entry)
    if (this.cache.length > MAX_CACHE) this.cache.length = MAX_CACHE
    void getPool()
      .query(
        'INSERT INTO operation_logs (data, device_id, created_at) VALUES (?, ?, ?)',
        [JSON.stringify(entry), entry.deviceId || null, new Date(entry.time || Date.now())]
      )
      .catch((e) => console.error('[mysql] operation_logs append failed', e))
  }

  list(opts?: OperationLogListOpts): OperationLog[] {
    const limit = Math.min(500, Math.max(1, opts?.limit ?? 100))
    const deviceId = opts?.deviceId
    const filtered = deviceId
      ? this.cache.filter((e) => String(e.deviceId || '') === deviceId)
      : this.cache
    return filtered.slice(0, limit)
  }

  clear(): void {
    this.cache = []
    void getPool()
      .query('DELETE FROM operation_logs')
      .catch((e) => console.error('[mysql] operation_logs clear failed', e))
  }

  private async queryList(opts?: OperationLogListOpts): Promise<OperationLog[]> {
    const limit = Math.min(500, Math.max(1, opts?.limit ?? MAX_CACHE))
    const deviceId = opts?.deviceId
    const [rows] = deviceId
      ? await getPool().query<RowDataPacket[]>(
          'SELECT data FROM operation_logs WHERE device_id = ? ORDER BY created_at DESC LIMIT ?',
          [deviceId, limit]
        )
      : await getPool().query<RowDataPacket[]>(
          'SELECT data FROM operation_logs ORDER BY created_at DESC LIMIT ?',
          [limit]
        )
    return rows
      .map((r) => {
        const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data
        return data as OperationLog
      })
      .filter((e) => e && typeof e.time === 'string')
  }
}
