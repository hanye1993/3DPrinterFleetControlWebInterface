import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const JWT_TTL_SEC = 60 * 60 * 12 // 12h

export type JwtPayload = {
  sub: string
  username: string
  level: string
  iat: number
  exp: number
}

function b64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8')
  return b
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || randomBytes(16).toString('hex')
  const hash = scryptSync(password, s, 64).toString('hex')
  return { hash, salt: s }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const next = scryptSync(password, salt, 64)
    const prev = Buffer.from(hash, 'hex')
    if (next.length !== prev.length) return false
    return timingSafeEqual(next, prev)
  } catch {
    return false
  }
}

export function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSec = JWT_TTL_SEC): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body: JwtPayload = { ...payload, iat: now, exp: now + ttlSec }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(body))
  const data = `${h}.${p}`
  const sig = createHmac('sha256', secret).update(data).digest()
  return `${data}.${b64url(sig)}`
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  const data = `${h}.${p}`
  const expected = createHmac('sha256', secret).update(data).digest()
  let actual: Buffer
  try {
    actual = fromB64url(s)
  } catch {
    return null
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const body = JSON.parse(fromB64url(p).toString('utf8')) as JwtPayload
    if (!body.exp || body.exp < Math.floor(Date.now() / 1000)) return null
    if (!body.sub || !body.username) return null
    return body
  } catch {
    return null
  }
}

export function newJwtSecret(): string {
  return randomBytes(32).toString('hex')
}
