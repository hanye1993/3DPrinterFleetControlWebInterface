/**
 * JSON storage facade hooks (file / MySQL json provider).
 * Host calls setPluginJsonHooks after PluginManager.init().
 */
import { KERNEL_HOOKS } from '../../../shared/pluginKernel'
import type { DbHookRunner } from './dbHooks'
import { setJsonStorageHooks } from '../../storage/jsonBridge'

let runner: DbHookRunner | null = null

export function setPluginJsonHooks(r: DbHookRunner | null): void {
  runner = r
  if (!r) {
    setJsonStorageHooks(null)
    return
  }
  setJsonStorageHooks({
    before: async (op, path, data) => {
      const payload = await runner!.runHook(KERNEL_HOOKS.dbQueryBefore, {
        sql: `json.${op} ${path}`,
        values: data,
        proceed: true,
        op,
        path
      })
      return {
        proceed: payload.proceed !== false,
        path: typeof (payload as { path?: string }).path === 'string'
          ? (payload as { path: string }).path
          : path,
        data: (payload as { values?: unknown }).values !== undefined
          ? (payload as { values?: unknown }).values
          : data
      }
    },
    after: async (op, path) => {
      await runner!.runHook(KERNEL_HOOKS.dbQueryAfter, {
        sql: `json.${op} ${path}`,
        ok: true,
        op,
        path
      })
    }
  })
}
