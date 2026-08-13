import tls from 'tls'

/**
 * Bambu Lab P1 / A1 / A1 mini chamber camera:
 * TLS TCP :6000 → 80-byte auth → JPEG frames (often after a 16-byte header).
 * X1 series use RTSP :322 — not covered here.
 */

function buildAuthPacket(accessCode: string): Buffer {
  const buf = Buffer.alloc(80, 0)
  buf.writeUInt32LE(0x40, 0)
  buf.writeUInt32LE(0x3000, 4)
  buf.writeUInt32LE(0, 8)
  buf.writeUInt32LE(0, 12)
  Buffer.from('bblp', 'ascii').copy(buf, 16)
  Buffer.from(String(accessCode || '').trim(), 'ascii').copy(buf, 48)
  return buf
}

function extractJpeg(buf: Buffer): Buffer | null {
  // Prefer JFIF APP0 marker used by Bambu; fall back to any SOI
  let soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  if (soi < 0) soi = buf.indexOf(Buffer.from([0xff, 0xd8]))
  if (soi < 0) return null
  const eoi = buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 2)
  if (eoi < 0) return null
  return buf.subarray(soi, eoi + 2)
}

export async function grabBambuJpegFrame(
  host: string,
  accessCode: string,
  timeoutMs = 10000
): Promise<{ ok: true; contentType: string; base64: string } | { ok: false; message: string }> {
  const ip = host.trim()
  const code = String(accessCode || '').trim()
  if (!ip) return { ok: false, message: '缺少打印机 IP' }
  if (!code) return { ok: false, message: '缺少局域网访问码' }

  return await new Promise((resolve) => {
    let settled = false
    let sock: tls.TLSSocket | null = null
    const chunks: Buffer[] = []
    let total = 0

    const done = (result: Awaited<ReturnType<typeof grabBambuJpegFrame>>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        sock?.destroy()
      } catch {
        /* ignore */
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      const jpeg = extractJpeg(Buffer.concat(chunks))
      if (jpeg && jpeg.length > 200) {
        done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
      } else {
        done({
          ok: false,
          message: '摄像头取帧超时（确认同网、机舱摄像头已开、局域网访问码正确；X1 系列暂不支持）'
        })
      }
    }, timeoutMs)

    try {
      sock = tls.connect(
        {
          host: ip,
          port: 6000,
          rejectUnauthorized: false,
          minVersion: 'TLSv1.2'
        },
        () => {
          sock!.write(buildAuthPacket(code))
        }
      )
    } catch (err) {
      done({
        ok: false,
        message: err instanceof Error ? err.message : '摄像头 TLS 连接失败'
      })
      return
    }

    sock.setTimeout(timeoutMs)
    sock.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      const jpeg = extractJpeg(Buffer.concat(chunks))
      if (jpeg && jpeg.length > 200) {
        done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
        return
      }
      if (total > 6 * 1024 * 1024) {
        done({ ok: false, message: '摄像头数据异常过大' })
      }
    })
    sock.on('error', (err) => {
      done({
        ok: false,
        message: err.message || '无法连接摄像头端口 6000（需局域网 IP）'
      })
    })
    sock.on('timeout', () => {
      done({ ok: false, message: '摄像头连接超时' })
    })
    sock.on('close', () => {
      if (!settled) {
        const jpeg = extractJpeg(Buffer.concat(chunks))
        if (jpeg && jpeg.length > 200) {
          done({ ok: true, contentType: 'image/jpeg', base64: jpeg.toString('base64') })
        } else {
          done({ ok: false, message: '摄像头连接已关闭（访问码可能不正确）' })
        }
      }
    })
  })
}

/** Encode host+code into a pseudo URL for camera:snapshot */
export function bambuCameraUrl(host: string, accessCode: string): string {
  const u = new URL('bambu-cam://frame')
  u.searchParams.set('host', host.trim())
  u.searchParams.set('code', String(accessCode || '').trim())
  return u.toString()
}

export function parseBambuCameraUrl(
  url: string
): { host: string; code: string } | null {
  try {
    if (!url.startsWith('bambu-cam://')) return null
    const u = new URL(url)
    const host = u.searchParams.get('host') || ''
    const code = u.searchParams.get('code') || ''
    if (!host || !code) return null
    return { host, code }
  } catch {
    return null
  }
}
