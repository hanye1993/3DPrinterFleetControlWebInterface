import { readJsonArray } from '../storage/jsonBridge'
import type { OperationLog } from '../../shared/operationLog'

export function deviceNameFromPath(
  getDevicesPath: () => string,
  deviceId: string
): string {
  const rows = readJsonArray(getDevicesPath()) as Array<{ id?: string; name?: string }>
  return rows.find((d) => String(d.id || '') === deviceId)?.name || deviceId
}

export function makeOperationLog(
  deviceId: string,
  deviceName: string,
  action: string,
  result: OperationLog['result'],
  detail?: string
): OperationLog {
  return {
    time: new Date().toISOString(),
    deviceId,
    deviceName,
    action,
    result,
    detail
  }
}
