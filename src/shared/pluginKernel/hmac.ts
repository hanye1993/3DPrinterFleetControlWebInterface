import { createHmac, timingSafeEqual } from 'crypto'

/** Hex HMAC-SHA256 of body with secret */
export function signHmacSha256(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
}

/** Constant-time compare of hex signatures (also accepts sha256= prefix) */
export function verifyHmacSha256(rawBody: string, signature: string, secret: string): boolean {
  const expected = signHmacSha256(rawBody, secret)
  const got = String(signature || '')
    .trim()
    .replace(/^sha256=/i, '')
  if (!got || got.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(expected, 'utf8'))
  } catch {
    return false
  }
}
