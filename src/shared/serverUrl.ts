/** Format host for use in http(s) URL (wrap raw IPv6 in brackets). */
export function formatHostForUrl(host: string): string {
  const h = host.trim()
  if (!h) return h
  if (h.startsWith('[')) return h
  // IPv6 literals contain ":" but not "." (unless IPv4-mapped, which includes dots)
  if (h.includes(':') && !h.includes('.')) return `[${h}]`
  return h
}

export function buildHttpUrl(host: string, port: number, protocol: 'http' | 'https' = 'http'): string {
  const h = formatHostForUrl(host.replace(/^https?:\/\//i, '').split('/')[0] || host)
  return `${protocol}://${h}:${port}`
}

export function isLoopbackAddress(addr: string): boolean {
  const a = addr.trim().toLowerCase()
  if (!a) return false
  if (a === '127.0.0.1' || a === 'localhost' || a === '::1') return true
  if (a.startsWith('::ffff:127.')) return true
  return false
}

/**
 * Normalize client/server base URL (origin only).
 * Supports IPv4, bracketed IPv6, and common bare IPv6 with port.
 */
export function normalizeServerBaseUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  let v = raw.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`

  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return u.origin
  } catch {
    // e.g. http://2001:db8::1:17890 → http://[2001:db8::1]:17890
    const m = v.match(/^(https?):\/\/([^/?#]+)(.*)$/i)
    if (!m) return null
    const hostPort = m[2]
    const tail = m[3] || ''
    const split = hostPort.match(/^(.+):(\d{1,5})$/)
    if (!split) return null
    const hostPart = split[1]
    const port = split[2]
    if (!hostPart.includes(':') || hostPart.startsWith('[')) return null
    try {
      return new URL(`${m[1]}://[${hostPart}]:${port}${tail}`).origin
    } catch {
      return null
    }
  }
}

export function isIpv4Family(family: string | number): boolean {
  return family === 'IPv4' || family === 4
}

export function isIpv6Family(family: string | number): boolean {
  return family === 'IPv6' || family === 6
}

/** Global / ULA IPv6 suitable for LAN or WAN URLs (skip link-local/multicast). */
export function isPublicIpv6Address(addr: string): boolean {
  const lower = addr.toLowerCase().split('%')[0]!
  if (lower.startsWith('fe80:')) return false
  if (lower.startsWith('ff')) return false
  if (lower === '::1') return false
  return true
}
