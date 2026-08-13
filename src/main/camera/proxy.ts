import http from 'http'
import axios from 'axios'

export type CameraCandidate = {
  id: string
  name: string
  streamUrl: string
  snapshotUrl?: string
}

export type CameraDiscoverOpts = {
  brand: string
  baseUrl?: string
  host?: string
  apiKey?: string
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

function originOf(raw?: string): string {
  if (!raw) return ''
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`)
    return u.origin
  } catch {
    return ''
  }
}

function rewriteLocalHost(url: string, printerHost: string): string {
  if (!url || !printerHost) return url
  try {
    const u = new URL(url)
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '0.0.0.0') {
      u.hostname = printerHost
      return u.toString()
    }
  } catch {
    // ignore
  }
  return url
}

function absolutize(origin: string, path?: string | null): string {
  if (!path) return ''
  const p = String(path).trim()
  if (!p) return ''
  if (/^https?:\/\//i.test(p)) return p
  if (p.startsWith('//')) return `http:${p}`
  if (p.startsWith('/')) return `${origin}${p}`
  return `${origin}/${p}`
}

/** Moonraker API ports that usually do NOT host the MJPEG webcam */
function isMoonrakerApiPort(port: string): boolean {
  return port === '7125' || port === '4408' || port === '4409'
}

/**
 * Relative webcam paths from /server/webcams/list must be tried on Fluidd/nginx (:80),
 * not only on the Moonraker API origin (:7125) — that combination returns 404.
 */
function webcamOrigins(apiOrigin: string, host: string): string[] {
  const out: string[] = []
  if (host) {
    out.push(`http://${host}`)
    out.push(`http://${host}:80`)
  }
  try {
    const u = new URL(apiOrigin)
    if (!isMoonrakerApiPort(u.port)) {
      out.unshift(apiOrigin)
    } else if (apiOrigin) {
      out.push(apiOrigin)
    }
  } catch {
    if (apiOrigin) out.push(apiOrigin)
  }
  return Array.from(new Set(out.filter(Boolean)))
}

function expandWebcamUrls(
  apiOrigin: string,
  host: string,
  streamPath?: string | null,
  snapPath?: string | null
): Array<{ streamUrl: string; snapshotUrl?: string }> {
  const streamRaw = String(streamPath || '').trim()
  const snapRaw = String(snapPath || '').trim()
  const origins = webcamOrigins(apiOrigin, host)
  const pairs: Array<{ streamUrl: string; snapshotUrl?: string }> = []

  const absAll = (path: string): string[] => {
    if (!path) return []
    if (/^https?:\/\//i.test(path) || path.startsWith('//')) {
      return [rewriteLocalHost(absolutize(apiOrigin, path), host)]
    }
    // relative: expand across preferred origins
    return origins.map((o) => absolutize(o, path.startsWith('/') ? path : `/${path}`))
  }

  const streams = absAll(streamRaw)
  const snaps = absAll(snapRaw)
  const n = Math.max(streams.length, snaps.length, origins.length ? 1 : 0)
  for (let i = 0; i < n; i++) {
    const streamUrl = streams[i] || streams[0] || snaps[i] || snaps[0] || ''
    const snapshotUrl = snaps[i] || snaps[0] || streams[i] || streams[0] || undefined
    if (!streamUrl && !snapshotUrl) continue
    pairs.push({ streamUrl: streamUrl || snapshotUrl!, snapshotUrl })
  }
  return pairs
}

function moonrakerHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {}
  if (apiKey.split('.').length >= 3) return { Authorization: `Bearer ${apiKey}` }
  return { 'X-Api-Key': apiKey }
}

/** Probe URL from main process (no CORS). MJPEG truncated body = alive. */
export async function probeUrl(url: string, timeoutMs = 4000): Promise<boolean> {
  if (!url) return false
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      responseType: 'arraybuffer',
      maxContentLength: 96 * 1024,
      maxBodyLength: 96 * 1024,
      validateStatus: (s) => s >= 200 && s < 500,
      headers: { Accept: 'image/*, multipart/x-mixed-replace, */*' }
    })
    if (res.status >= 400) return false
    const ct = String(res.headers['content-type'] || '').toLowerCase()
    if (ct.includes('image') || ct.includes('multipart') || ct.includes('mjpeg') || ct.includes('octet')) {
      return true
    }
    return ((res.data as ArrayBuffer)?.byteLength ?? 0) > 0 || res.status === 200
  } catch (err) {
    if (!axios.isAxiosError(err)) return false
    if (
      err.code === 'ERR_FR_TOO_LARGE_MAX_CONTENT_LENGTH' ||
      /maxContentLength|max body/i.test(err.message || '')
    ) {
      return true
    }
    if (err.response && err.response.status >= 200 && err.response.status < 400) return true
    return false
  }
}

async function firstAlive(
  list: CameraCandidate[],
  apiKey?: string
): Promise<CameraCandidate[]> {
  // Prefer candidates that can actually yield a JPEG frame
  for (const c of list) {
    const targets = [c.snapshotUrl, c.streamUrl].filter(Boolean) as string[]
    for (const t of targets) {
      const shot = await fetchSnapshot(t, apiKey)
      if (shot.ok) {
        return [
          {
            ...c,
            streamUrl: c.streamUrl || c.snapshotUrl!,
            // Prefer working URL as snapshot source for UI polling
            snapshotUrl: c.snapshotUrl || t
          }
        ]
      }
    }
  }
  return []
}

async function fromMoonrakerList(
  origin: string,
  host: string,
  apiKey?: string
): Promise<CameraCandidate[]> {
  try {
    const { data } = await axios.get(`${origin}/server/webcams/list`, {
      timeout: 6000,
      headers: moonrakerHeaders(apiKey)
    })
    const list = (data?.result?.webcams || []) as Array<{
      name?: string
      stream_url?: string
      snapshot_url?: string
      enabled?: boolean
      service?: string
    }>
    const out: CameraCandidate[] = []
    for (let i = 0; i < list.length; i++) {
      const w = list[i]
      if (w.enabled === false) continue
      const expanded = expandWebcamUrls(origin, host, w.stream_url, w.snapshot_url)
      for (let j = 0; j < expanded.length; j++) {
        let stream = expanded[j]!.streamUrl
        let snap = expanded[j]!.snapshotUrl
        const svc = `${w.service || ''} ${stream}`.toLowerCase()
        if (svc.includes('webrtc') || svc.includes('whep')) {
          if (!snap) continue
          stream = snap
        }
        if (!stream && !snap) continue
        out.push({
          id: j === 0 ? `webcam-${i}` : `webcam-${i}-alt${j}`,
          name: w.name || `摄像头 ${i + 1}`,
          streamUrl: stream || snap!,
          snapshotUrl: snap || undefined
        })
      }
    }
    return out
  } catch {
    return []
  }
}

function commonMoonPaths(origin: string, host: string): CameraCandidate[] {
  // Prefer :80 / host-default first — Moonraker :7125 almost never serves /webcam
  const list: CameraCandidate[] = []
  if (host) {
    list.push(
      {
        id: 'h80',
        name: '摄像头',
        streamUrl: `http://${host}/webcam/?action=stream`,
        snapshotUrl: `http://${host}/webcam/?action=snapshot`
      },
      {
        id: 'h80-ns',
        name: '摄像头',
        streamUrl: `http://${host}:80/webcam/?action=stream`,
        snapshotUrl: `http://${host}:80/webcam/?action=snapshot`
      }
    )
  }
  try {
    const u = new URL(origin)
    if (!isMoonrakerApiPort(u.port)) {
      list.push(
        {
          id: 'webcam',
          name: '摄像头',
          streamUrl: `${origin}/webcam/?action=stream`,
          snapshotUrl: `${origin}/webcam/?action=snapshot`
        },
        {
          id: 'webcam-ns',
          name: '摄像头',
          streamUrl: `${origin}/webcam?action=stream`,
          snapshotUrl: `${origin}/webcam?action=snapshot`
        }
      )
    }
  } catch {
    /* ignore */
  }
  if (host) {
    list.push(
      {
        id: 'h4408',
        name: '摄像头',
        streamUrl: `http://${host}:4408/webcam/?action=stream`,
        snapshotUrl: `http://${host}:4408/webcam/?action=snapshot`
      },
      {
        id: 'h8080',
        name: '摄像头',
        streamUrl: `http://${host}:8080/?action=stream`,
        snapshotUrl: `http://${host}:8080/?action=snapshot`
      },
      {
        id: 'h8080-webcam',
        name: '摄像头',
        streamUrl: `http://${host}:8080/webcam/?action=stream`,
        snapshotUrl: `http://${host}:8080/webcam/?action=snapshot`
      }
    )
  }
  // Last resort: API origin /webcam (often 404 on :7125, kept for odd setups)
  if (origin) {
    list.push(
      {
        id: 'webcam-api',
        name: '摄像头',
        streamUrl: `${origin}/webcam/?action=stream`,
        snapshotUrl: `${origin}/webcam/?action=snapshot`
      },
      {
        id: 'webcam2',
        name: '摄像头',
        streamUrl: `${origin}/webcam2/?action=stream`,
        snapshotUrl: `${origin}/webcam2/?action=snapshot`
      }
    )
  }
  return list
}

/**
 * Build camera URL candidates quickly (no blocking validation).
 * UI / snapshot polling will prove which URL works.
 * Returns [] only when there is no host/baseUrl to try.
 */
export async function discoverCameras(opts: CameraDiscoverOpts): Promise<CameraCandidate[]> {
  const brand = (opts.brand || '').toLowerCase()
  const host = opts.host || hostOf(opts.baseUrl)
  const origin = originOf(opts.baseUrl) || (host ? `http://${host}` : '')
  const apiKey = opts.apiKey

  if (!host && !origin) return []

  let candidates: CameraCandidate[] = []

  if (brand === 'bambu') {
    // Official LAN chamber cam (P1/A1/…): TLS :6000 + access code
    if (host && apiKey && apiKey.length > 0 && apiKey.length <= 64) {
      const { bambuCameraUrl } = await import('../bambu/camera')
      const camUrl = bambuCameraUrl(host, apiKey)
      candidates.push({
        id: 'bambu-tls-6000',
        name: '机舱摄像头',
        streamUrl: camUrl,
        snapshotUrl: camUrl
      })
    }
    // No fake HTTP candidates — they only delay failure when :6000 is the real path
  } else if (brand === 'elegoo') {
    candidates = [
      {
        id: 'elegoo-3031',
        name: '摄像头',
        streamUrl: `http://${host}:3031/video`,
        snapshotUrl: `http://${host}:3031/video`
      },
      {
        id: 'elegoo-3031s',
        name: '摄像头',
        streamUrl: `http://${host}:3031/stream`,
        snapshotUrl: `http://${host}:3031/snapshot`
      },
      {
        id: 'elegoo-8080',
        name: '摄像头',
        streamUrl: `http://${host}:8080/?action=stream`,
        snapshotUrl: `http://${host}:8080/?action=snapshot`
      }
    ]
  } else if (brand === 'anycubic') {
    candidates = [
      {
        id: 'ac-8080',
        name: '摄像头',
        streamUrl: `http://${host}:8080/?action=stream`,
        snapshotUrl: `http://${host}:8080/?action=snapshot`
      },
      {
        id: 'ac-webcam',
        name: '摄像头',
        streamUrl: `http://${host}/webcam/?action=stream`,
        snapshotUrl: `http://${host}/webcam/?action=snapshot`
      },
      {
        id: 'ac-18088',
        name: '摄像头',
        streamUrl: `http://${host}:18088/?action=stream`,
        snapshotUrl: `http://${host}:18088/?action=snapshot`
      }
    ]
  } else if (brand === 'flashforge') {
    candidates = [
      {
        id: 'ff-8080',
        name: '摄像头',
        streamUrl: `http://${host}:8080/?action=stream`,
        snapshotUrl: `http://${host}:8080/?action=snapshot`
      },
      {
        id: 'ff-8081',
        name: '摄像头',
        streamUrl: `http://${host}:8081/?action=stream`,
        snapshotUrl: `http://${host}:8081/?action=snapshot`
      }
    ]
  } else if (brand === 'snapmaker') {
    candidates = [
      {
        id: 'sm-webcam',
        name: '摄像头',
        streamUrl: `http://${host}/webcam/?action=stream`,
        snapshotUrl: `http://${host}/webcam/?action=snapshot`
      },
      {
        id: 'sm-9090',
        name: '摄像头',
        streamUrl: `http://${host}:9090/?action=stream`,
        snapshotUrl: `http://${host}:9090/?action=snapshot`
      }
    ]
  } else {
    // klipper / creality / qidi
    if (origin) {
      const listed = await fromMoonrakerList(origin, host, apiKey)
      candidates.push(...listed)
      // Always merge common paths (:80 first) — list entries alone often point at :7125/404
      candidates.push(...commonMoonPaths(origin, host))
    }
    if (brand === 'creality' && host) {
      candidates.push(
        {
          id: 'cr-8080',
          name: '摄像头',
          streamUrl: `http://${host}:8080/?action=stream`,
          snapshotUrl: `http://${host}:8080/?action=snapshot`
        },
        {
          id: 'cr-4409',
          name: '摄像头',
          streamUrl: `http://${host}:4409/?action=stream`,
          snapshotUrl: `http://${host}:4409/?action=snapshot`
        }
      )
    }
    if (brand === 'qidi' && host) {
      candidates.unshift(
        {
          id: 'qidi-10088',
          name: '摄像头',
          streamUrl: `http://${host}:10088/webcam/?action=stream`,
          snapshotUrl: `http://${host}:10088/webcam/?action=snapshot`
        },
        {
          id: 'qidi-10088r',
          name: '摄像头',
          streamUrl: `http://${host}:10088/?action=stream`,
          snapshotUrl: `http://${host}:10088/?action=snapshot`
        }
      )
    }
  }

  // Deduplicate by streamUrl — return immediately (UI validates by pulling frames)
  const seen = new Set<string>()
  const unique: CameraCandidate[] = []
  for (const c of candidates) {
    const key = c.streamUrl || c.snapshotUrl || ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(c)
  }
  return unique
}

/**
 * Fetch one JPEG frame. Works for both snapshot URLs and MJPEG streams
 * (reads until first complete JPEG, then aborts — never waits for stream end).
 */
export async function fetchSnapshot(
  url: string,
  apiKey?: string
): Promise<{ ok: true; contentType: string; base64: string } | { ok: false; message: string }> {
  try {
    const res = await axios.get(url, {
      timeout: 12000,
      responseType: 'stream',
      headers: {
        ...moonrakerHeaders(apiKey),
        Accept: 'image/*, multipart/x-mixed-replace, */*'
      },
      validateStatus: (s) => s >= 200 && s < 400
    })

    const ct = String(res.headers['content-type'] || '').toLowerCase()
    const stream = res.data as NodeJS.ReadableStream
    const jpeg = await readFirstJpegFromStream(stream, 12_000)
    try {
      ;(stream as { destroy?: () => void }).destroy?.()
    } catch {
      // ignore
    }
    if (!jpeg || jpeg.length < 100) {
      return { ok: false, message: '未获取到有效 JPEG 帧' }
    }
    return {
      ok: true,
      contentType: ct.includes('image/') && !ct.includes('multipart') ? ct.split(';')[0] : 'image/jpeg',
      base64: jpeg.toString('base64')
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

function extractFirstJpeg(buf: Buffer): Buffer | null {
  const soi = buf.indexOf(Buffer.from([0xff, 0xd8]))
  if (soi < 0) return null
  const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2)
  if (eoi < 0) return null
  return buf.subarray(soi, eoi + 2)
}

function readFirstJpegFromStream(
  stream: NodeJS.ReadableStream,
  timeoutMs: number
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const done = (buf: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.removeListener('data', onData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onErr)
      try {
        ;(stream as { destroy?: () => void }).destroy?.()
      } catch {
        // ignore
      }
      resolve(buf)
    }
    const timer = setTimeout(() => {
      const merged = Buffer.concat(chunks)
      done(extractFirstJpeg(merged))
    }, timeoutMs)

    const onData = (chunk: Buffer) => {
      chunks.push(Buffer.from(chunk))
      total += chunk.length
      const merged = Buffer.concat(chunks)
      const jpeg = extractFirstJpeg(merged)
      if (jpeg) {
        done(jpeg)
        return
      }
      // safety cap
      if (total > 4 * 1024 * 1024) done(null)
    }
    const onEnd = () => {
      const merged = Buffer.concat(chunks)
      done(extractFirstJpeg(merged) || (merged.length > 100 ? merged : null))
    }
    const onErr = () => {
      const merged = Buffer.concat(chunks)
      done(extractFirstJpeg(merged))
    }
    stream.on('data', onData)
    stream.on('end', onEnd)
    stream.on('error', onErr)
  })
}

/** Local proxy so renderer <img> always loads from 127.0.0.1 */
export type CameraProxy = {
  port: number
  close: () => void
  streamUrlFor: (target: string, apiKey?: string) => string
  snapshotUrlFor: (target: string, apiKey?: string) => string
}

export function createCameraProxyServer(): Promise<CameraProxy> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1')
        const target = u.searchParams.get('url')
        if (!target) {
          res.writeHead(400)
          res.end('missing url')
          return
        }
        const isSnap = u.pathname === '/snapshot'
        const headers: Record<string, string> = {
          Accept: isSnap ? 'image/*' : 'multipart/x-mixed-replace, image/*, */*'
        }
        const apiKey = u.searchParams.get('key') || undefined
        Object.assign(headers, moonrakerHeaders(apiKey || undefined))

        if (isSnap) {
          const shot = await fetchSnapshot(target, apiKey || undefined)
          if (!shot.ok) {
            res.writeHead(502)
            res.end(shot.message)
            return
          }
          const body = Buffer.from(shot.base64, 'base64')
          res.writeHead(200, {
            'Content-Type': shot.contentType,
            'Content-Length': body.length,
            'Cache-Control': 'no-store'
          })
          res.end(body)
          return
        }

        const upstream = await axios.get(target, {
          responseType: 'stream',
          timeout: 15000,
          headers,
          validateStatus: (s) => s >= 200 && s < 400
        })
        const ct = String(upstream.headers['content-type'] || 'multipart/x-mixed-replace')
        res.writeHead(200, {
          'Content-Type': ct,
          'Cache-Control': 'no-store',
          Connection: 'keep-alive'
        })
        upstream.data.on('error', () => {
          try {
            res.end()
          } catch {
            // ignore
          }
        })
        req.on('close', () => {
          try {
            upstream.data.destroy?.()
          } catch {
            // ignore
          }
        })
        upstream.data.pipe(res)
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(502)
          res.end(err instanceof Error ? err.message : 'proxy error')
        } else {
          try {
            res.end()
          } catch {
            // ignore
          }
        }
      }
    })

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('camera proxy failed to bind'))
        return
      }
      const port = addr.port
      const withKey = (path: string, target: string, apiKey?: string) => {
        let q = `url=${encodeURIComponent(target)}`
        if (apiKey) q += `&key=${encodeURIComponent(apiKey)}`
        return `http://127.0.0.1:${port}${path}?${q}`
      }
      resolve({
        port,
        close: () => {
          try {
            server.close()
          } catch {
            // ignore
          }
        },
        streamUrlFor: (target: string, apiKey?: string) => withKey('/stream', target, apiKey),
        snapshotUrlFor: (target: string, apiKey?: string) => withKey('/snapshot', target, apiKey)
      })
    })
  })
}
