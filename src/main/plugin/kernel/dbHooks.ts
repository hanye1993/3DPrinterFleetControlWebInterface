/**
 * Optional MySQL query facade with Kernel v2 db hooks.
 * Host calls setPluginDbHooks once after PluginManager.init().
 */
import type { Pool, QueryResult, FieldPacket } from 'mysql2/promise'
import { KERNEL_HOOKS } from '../../../shared/pluginKernel'

export type DbHookRunner = {
  runHook: <T>(name: string, value: T, ctx?: unknown) => Promise<T>
}

let runner: DbHookRunner | null = null
const patched = new WeakSet<object>()

export function setPluginDbHooks(r: DbHookRunner | null): void {
  runner = r
}

/** Patch pool.query once to fire filter:db.query.before / action:db.query.after */
export function patchPoolWithPluginHooks(pool: Pool): Pool {
  if (patched.has(pool as object)) return pool
  patched.add(pool as object)
  const original = pool.query.bind(pool)
  ;(pool as { query: Pool['query'] }).query = (async (
    sql: unknown,
    values?: unknown
  ): Promise<[QueryResult, FieldPacket[]]> => {
    let payload: { sql: unknown; values?: unknown; proceed: boolean } = {
      sql,
      values,
      proceed: true
    }
    if (runner) {
      payload = await runner.runHook(KERNEL_HOOKS.dbQueryBefore, payload)
      if (payload.proceed === false) {
        throw new Error('db.query aborted by plugin')
      }
    }
    const result = (await original(payload.sql as never, payload.values as never)) as [
      QueryResult,
      FieldPacket[]
    ]
    if (runner) {
      await runner.runHook(KERNEL_HOOKS.dbQueryAfter, {
        sql: payload.sql,
        ok: true
      })
    }
    return result
  }) as Pool['query']
  return pool
}
