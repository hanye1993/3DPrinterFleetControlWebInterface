/**
 * Third-party / plugin cameras stored on device.pluginData.extraCameras.
 * Host merges these into discoverCameras results for detail, wall, and AI.
 */

export const EXTRA_CAM_ID_PREFIX = 'extra:'

export type DeviceExtraCamera = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
  /** When false, skip AI patrol for this cam. Default true. */
  aiEnabled?: boolean
}

export type CameraCandidate = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
  /** Present on extras; omit/true = eligible for AI when device AI is on */
  aiEnabled?: boolean
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function normalizeUrl(raw: unknown): string {
  let s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
  if (!s) return ''
  if (/^https?:\/\//i.test(s) || s.startsWith('bambu-cam://')) return s
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(s) || s.startsWith('/')) {
    return `http://${s.replace(/^\/+/, '')}`
  }
  return s
}

/** Stable id: keep existing extra:* or mint from URL hash-ish */
export function ensureExtraCameraId(rawId: unknown, url: string, index: number): string {
  const id = String(rawId ?? '').trim()
  if (id.startsWith(EXTRA_CAM_ID_PREFIX) && id.length > EXTRA_CAM_ID_PREFIX.length) return id
  if (id && !id.includes('/') && id.length < 80) return `${EXTRA_CAM_ID_PREFIX}${id}`
  const base = url.replace(/^https?:\/\//i, '').slice(0, 40).replace(/[^a-zA-Z0-9._-]+/g, '_')
  return `${EXTRA_CAM_ID_PREFIX}${base || 'cam'}_${index}`
}

export function isExtraCameraId(id: string): boolean {
  return String(id || '').startsWith(EXTRA_CAM_ID_PREFIX)
}

export function parseDeviceExtraCameras(device: unknown): DeviceExtraCamera[] {
  const row = asRecord(device)
  if (!row) return []
  const pd = asRecord(row.pluginData)
  if (!pd) return []
  const list = pd.extraCameras
  if (!Array.isArray(list)) return []
  const out: DeviceExtraCamera[] = []
  const seen = new Set<string>()
  for (let i = 0; i < list.length; i++) {
    const item = asRecord(list[i])
    if (!item) continue
    const streamUrl = normalizeUrl(item.streamUrl ?? item.url ?? item.snapshotUrl)
    if (!streamUrl) continue
    if (!/^https?:\/\//i.test(streamUrl) && !streamUrl.startsWith('bambu-cam://')) continue
    const snapshotRaw = normalizeUrl(item.snapshotUrl)
    const snapshotUrl =
      snapshotRaw && (/^https?:\/\//i.test(snapshotRaw) || snapshotRaw.startsWith('bambu-cam://'))
        ? snapshotRaw
        : undefined
    const id = ensureExtraCameraId(item.id, streamUrl, i)
    if (seen.has(id)) continue
    seen.add(id)
    const name = String(item.name ?? '').trim() || `第三方摄像头 ${out.length + 1}`
    const aiEnabled = item.aiEnabled === false ? false : true
    out.push({
      id,
      name,
      streamUrl,
      snapshotUrl,
      aiEnabled
    })
  }
  return out
}

/** Append extras after discovered cams; skip duplicate URLs. */
export function mergeDiscoveredWithExtra(
  discovered: Array<{ id: string; name: string; streamUrl: string; snapshotUrl?: string }>,
  extras: DeviceExtraCamera[]
): CameraCandidate[] {
  const out: CameraCandidate[] = []
  const urlSeen = new Set<string>()
  const idSeen = new Set<string>()

  const push = (c: CameraCandidate) => {
    const id = String(c.id || '').trim()
    if (!id || idSeen.has(id)) return
    const u = normalizeUrl(c.snapshotUrl || c.streamUrl)
    if (u && urlSeen.has(u)) return
    idSeen.add(id)
    if (u) urlSeen.add(u)
    out.push(c)
  }

  for (const c of discovered || []) {
    if (!c?.streamUrl && !c?.snapshotUrl) continue
    push({
      id: String(c.id),
      name: String(c.name || '摄像头'),
      streamUrl: String(c.streamUrl || c.snapshotUrl || ''),
      snapshotUrl: c.snapshotUrl
    })
  }
  for (const e of extras || []) {
    push({
      id: e.id,
      name: e.name,
      streamUrl: e.streamUrl,
      snapshotUrl: e.snapshotUrl,
      aiEnabled: e.aiEnabled
    })
  }
  return out
}

export function camerasForAiPatrol(cams: CameraCandidate[]): CameraCandidate[] {
  return (cams || []).filter((c) => c.aiEnabled !== false)
}
