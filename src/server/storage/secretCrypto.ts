/**
 * Shared AES-256-GCM helpers for device secrets (MySQL + JSON file mode).
 *
 * Key resolution order:
 * 1. SECRETS_MASTER_KEY / JWT_SECRET env
 * 2. persisted file under DATA_ROOT (survives restart without .env)
 * 3. generate + persist a new key (first run only)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const KEY_FILE = '.secrets-master-key'

let dataRootForKey: string | null = null

/** Call once at process start (before loadFileSecrets) so the master key can persist. */
export function setSecretsDataRoot(root: string): void {
  dataRootForKey = root || null
}

function envMasterRaw(): string {
  const raw = process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || ''
  if (!raw || raw === 'change-me-in-production') return ''
  return raw
}

function persistPath(): string | null {
  return dataRootForKey ? join(dataRootForKey, KEY_FILE) : null
}

function masterKey(): Buffer {
  const fromEnv = envMasterRaw()
  if (fromEnv) return createHash('sha256').update(fromEnv).digest()

  const g = globalThis as { __hanyeSecretsEphemeralKey?: Buffer }
  if (g.__hanyeSecretsEphemeralKey) return g.__hanyeSecretsEphemeralKey

  const keyPath = persistPath()
  if (keyPath && existsSync(keyPath)) {
    try {
      const saved = readFileSync(keyPath, 'utf8').trim()
      if (saved) {
        g.__hanyeSecretsEphemeralKey = createHash('sha256').update(saved).digest()
        return g.__hanyeSecretsEphemeralKey
      }
    } catch {
      /* fall through and regenerate */
    }
  }

  const seed = randomBytes(32).toString('hex')
  if (keyPath) {
    try {
      mkdirSync(dirname(keyPath), { recursive: true })
      writeFileSync(keyPath, seed, { encoding: 'utf8', mode: 0o600 })
      console.info(
        '[secrets] 已写入本地主密钥 data/.secrets-master-key（重启可解密）。生产环境建议改设 SECRETS_MASTER_KEY。'
      )
    } catch (e) {
      console.warn(
        '[secrets] 无法持久化主密钥，重启后密文可能无法解密：',
        e instanceof Error ? e.message : e
      )
    }
  } else if (!(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned) {
    ;(globalThis as { __hanyeSecretsKeyWarned?: boolean }).__hanyeSecretsKeyWarned = true
    console.warn(
      '[secrets] 未设置 SECRETS_MASTER_KEY / JWT_SECRET，且未绑定 DATA_ROOT，使用内存临时密钥（重启后密文无法解密）。'
    )
  }

  g.__hanyeSecretsEphemeralKey = createHash('sha256').update(seed).digest()
  return g.__hanyeSecretsEphemeralKey
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':')
  if (parts[0] !== 'v1' || parts.length !== 4) throw new Error('Invalid secret blob')
  const iv = Buffer.from(parts[1]!, 'base64')
  const tag = Buffer.from(parts[2]!, 'base64')
  const data = Buffer.from(parts[3]!, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function isEncryptedSecretBlob(value: string): boolean {
  return value.startsWith('v1:') && value.split(':').length === 4
}

/** Decrypt if encrypted; on failure return empty (never return ciphertext as a password). */
export function decodeSecretValue(raw: string): string {
  if (isEncryptedSecretBlob(raw)) {
    try {
      return decryptSecret(raw)
    } catch {
      return ''
    }
  }
  return raw
}
