import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import type { OperationLog, OperationLogListOpts } from '../../shared/operationLog'

export type OperationLogStore = {
  append: (entry: OperationLog) => void
  list: (opts?: OperationLogListOpts) => OperationLog[]
  clear: () => void
}

export function createFileOperationLogStore(logsPath: string): OperationLogStore {
  return {
    append(entry: OperationLog) {
      appendFileSync(logsPath, `${JSON.stringify(entry)}\n`, 'utf8')
    },
    list(opts?: OperationLogListOpts) {
      if (!existsSync(logsPath)) return []
      const limit = opts?.limit ?? 100
      const deviceId = opts?.deviceId
      const lines = readFileSync(logsPath, 'utf8').split('\n').filter(Boolean)
      const parsed = lines
        .map((line) => {
          try {
            return JSON.parse(line) as OperationLog
          } catch {
            return null
          }
        })
        .filter(Boolean) as OperationLog[]
      const filtered = deviceId
        ? parsed.filter((e) => String(e.deviceId || '') === deviceId)
        : parsed
      return filtered.reverse().slice(0, limit)
    },
    clear() {
      writeFileSync(logsPath, '', 'utf8')
    }
  }
}
