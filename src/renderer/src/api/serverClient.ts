import { isWebBrowser } from '@shared/platform'
import { useAuthStore, apiFetch } from '../stores/authStore'

/** Browser SPA or Electron client — data via HTTP API, no local printer IO */
export function isClientMode(): boolean {
  if (isWebBrowser()) return true
  return useAuthStore.getState().role === 'client'
}

export async function serverGet<T = unknown>(path: string): Promise<T> {
  const { serverUrl, token } = useAuthStore.getState()
  if (!token) throw new Error('未登录')
  const res = await apiFetch(serverUrl, path, { token })
  const data = (await res.json()) as T & { ok?: boolean; message?: string }
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { message?: string }).message || `请求失败 ${res.status}`)
  }
  return data
}

export async function serverSend<T = unknown>(
  path: string,
  method: string,
  body?: unknown
): Promise<T> {
  const { serverUrl, token } = useAuthStore.getState()
  if (!token) throw new Error('未登录')
  const res = await apiFetch(serverUrl, path, {
    method,
    token,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const data = (await res.json()) as T & { ok?: boolean; message?: string }
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    throw new Error((data as { message?: string }).message || `请求失败 ${res.status}`)
  }
  return data
}

/** Ask server to reconnect printers, then return fresh device list payload */
export async function serverReconnectAndFetchDevices(): Promise<{
  devices: unknown[]
}> {
  await serverSend('/api/v1/devices/reconnect', 'POST', {})
  // small delay so server adapters can start reconnecting
  await new Promise((r) => setTimeout(r, 400))
  const data = await serverGet<{ devices?: unknown[] }>('/api/v1/devices')
  return { devices: data.devices || [] }
}

export async function serverFetchDevices(): Promise<{ devices: unknown[] }> {
  const data = await serverGet<{ devices?: unknown[] }>('/api/v1/devices')
  return { devices: data.devices || [] }
}

export async function serverListDeviceFiles(deviceId: string): Promise<
  Array<{ path: string; size: number; modified?: number }>
> {
  const data = await serverGet<{ files?: Array<{ path: string; size: number; modified?: number }> }>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/files`
  )
  return data.files || []
}

export async function serverUploadDeviceFile(deviceId: string, file: File): Promise<void> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  await serverSend(`/api/v1/devices/${encodeURIComponent(deviceId)}/files`, 'POST', {
    filename: file.name,
    contentBase64: btoa(binary)
  })
}

export async function serverDownloadDeviceFile(
  deviceId: string,
  remotePath: string
): Promise<ArrayBuffer> {
  const data = await serverGet<{ contentBase64?: string }>(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/files/content?path=${encodeURIComponent(remotePath)}`
  )
  const b64 = data.contentBase64 || ''
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export async function serverListDeviceCameras(deviceId: string): Promise<
  Array<{ id: string; name: string; streamUrl: string; snapshotUrl?: string }>
> {
  const data = await serverGet<{
    cameras?: Array<{ id: string; name: string; streamUrl: string; snapshotUrl?: string }>
  }>(`/api/v1/devices/${encodeURIComponent(deviceId)}/cameras`)
  return data.cameras || []
}

export async function serverBatchPrint(opts: {
  deviceIds: string[]
  filename: string
  contentBase64?: string
}): Promise<Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>> {
  const data = await serverSend<{
    results?: Array<{ deviceId: string; deviceName: string; ok: boolean; message?: string }>
  }>('/api/v1/batch/print', 'POST', opts)
  return data.results || []
}
