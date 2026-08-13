import type { DeviceConfig } from '../types/printer'

export type CameraSource = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
  remoteStreamUrl?: string
  remoteSnapshotUrl?: string
}

function hostOf(raw?: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    return u.hostname
  } catch {
    return raw.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

/** Discover via main-process probe + localhost proxy (reliable in Electron) */
export async function discoverDeviceCameras(
  config: DeviceConfig,
  apiKey?: string
): Promise<CameraSource[]> {
  const host =
    config.bambuHost ||
    hostOf(config.baseUrl) ||
    ''
  const list = await window.electronAPI?.camera?.discover({
    brand: config.brand,
    baseUrl: config.baseUrl,
    host: host || undefined,
    apiKey: apiKey || undefined
  })
  return (list || []).map((c) => ({
    id: c.id,
    name: c.name,
    streamUrl: c.streamUrl,
    snapshotUrl: c.snapshotUrl,
    remoteStreamUrl: c.remoteStreamUrl,
    remoteSnapshotUrl: c.remoteSnapshotUrl
  }))
}
