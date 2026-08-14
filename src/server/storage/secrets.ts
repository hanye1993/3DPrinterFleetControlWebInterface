import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { getPool } from '../db/pool'

function masterKey(): Buffer {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || ''
  if (!raw || raw === 'change-me-in-production') {
    if (!(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned) {
      ;(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned = true
      console.warn(
        '[secrets] 未设置 SECRETS_MASTER_KEY / JWT_SECRET，使用临时随机密钥（重启后已存密文可能无法解密）。生产环境请配置强密钥。'
      )
    }
    // Ephemeral key per process when unset — avoids a shared public default.
    const g = globalThis as { __hanyeSecretsEphemeralKey?: Buffer }
    if (!g.__hanyeSecretsEphemeralKey) g.__hanyeSecretsEphemeralKey = randomBytes(32)
    return g.__hanyeSecretsEphemeralKey
  }
  return createHash('sha256').update(raw).digest()
}

function encrypt(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

function decrypt(blob: string): string {
  const parts = blob.split(':')
  if (parts[0] !== 'v1' || parts.length !== 4) throw new Error('Invalid secret blob')
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const data = Buffer.from(parts[3]!, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export async function getSecret(secretKey: string): Promise<string | null> {
  const [rows] = await getPool().query<RowDataPacket[]>(
    'SELECT value_enc FROM device_secrets WHERE secret_key = ? LIMIT 1',
    [secretKey]
  )
  const blob = rows[0]?.value_enc
  if (!blob) return null
  try {
    return decrypt(String(blob))
  } catch {
    return null
  }
}

export async function setSecret(secretKey: string, value: string): Promise<void> {
  await getPool().query(
    'INSERT INTO device_secrets (secret_key, value_enc) VALUES (?, ?) ON DUPLICATE KEY UPDATE value_enc = VALUES(value_enc)',
    [secretKey, encrypt(value)]
  )
}

export async function deleteSecret(secretKey: string): Promise<void> {
  await getPool().query('DELETE FROM device_secrets WHERE secret_key = ?', [secretKey])
}

export async function listSecretKeys(): Promise<string[]> {
  const [rows] = await getPool().query<RowDataPacket[]>('SELECT secret_key FROM device_secrets')
  return rows.map((r) => String(r.secret_key))
}

export async function getAllSecretsMap(): Promise<Record<string, string>> {
  const keys = await listSecretKeys()
  const out: Record<string, string> = {}
  for (const k of keys) {
    const v = await getSecret(k)
    if (v != null) out[k] = v
  }
  return out
}
