export type OperationLog = {
  time: string
  deviceId: string
  deviceName: string
  action: string
  result: 'ok' | 'error' | string
  detail?: string
}

export type OperationLogListOpts = {
  limit?: number
  deviceId?: string
}
