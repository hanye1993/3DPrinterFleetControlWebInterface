import {
  type CameraCandidate,
  discoveredUrlsForLogicalCam,
  isExtraCameraId
} from './deviceExtraCameras'

export type WallDiscoveredCam = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
}

export type WallSnapshotProbe = (url: string) => Promise<{ ok: boolean }>

/** Ordered URLs to try when validating a wall tile can display a frame. */
export function probeUrlsForWallCamera(
  discovered: WallDiscoveredCam[],
  cam: CameraCandidate
): string[] {
  if (isExtraCameraId(cam.id)) {
    const u = String(cam.snapshotUrl || cam.streamUrl || '').trim()
    return u ? [u] : []
  }
  const urls = discoveredUrlsForLogicalCam(discovered, cam.id)
  if (urls.length) return urls
  const fallback = String(cam.snapshotUrl || cam.streamUrl || '').trim()
  return fallback ? [fallback] : []
}

/** Keep only cameras that yield at least one JPEG/snapshot frame. */
export async function filterCamerasWithWorkingSnapshot(opts: {
  discovered: WallDiscoveredCam[]
  cams: CameraCandidate[]
  probe: WallSnapshotProbe
}): Promise<CameraCandidate[]> {
  const out: CameraCandidate[] = []
  for (const cam of opts.cams || []) {
    const urls = probeUrlsForWallCamera(opts.discovered, cam)
    let ok = false
    for (const u of urls) {
      const shot = await opts.probe(u)
      if (shot.ok) {
        ok = true
        break
      }
    }
    if (ok) out.push(cam)
  }
  return out
}
