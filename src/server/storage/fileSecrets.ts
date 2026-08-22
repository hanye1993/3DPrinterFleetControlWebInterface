/**
 * Encrypted secrets.json for file-storage mode (AES-256-GCM via secretCrypto).
 * Legacy plaintext maps are migrated on next write.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { decodeSecretValue, encryptSecret, isEncryptedSecretBlob } from './secretCrypto'

export type LoadFileSecretsResult = {
  secrets: Record<string, string>
  /** Encrypted entries that could not be decrypted (master key lost / rotated). */
  lostKeys: string[]
  /** True if the on-disk file still had any plaintext values (needs migrate encrypt). */
  hadPlaintext: boolean
}

function readRawMap(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const obj = raw as { secrets?: unknown }
    if (obj.secrets && typeof obj.secrets === 'object' && !Array.isArray(obj.secrets)) {
      return obj.secrets as Record<string, unknown>
    }
    return raw as Record<string, unknown>
  } catch {
    return {}
  }
}

export function loadFileSecretsDetailed(path: string): LoadFileSecretsResult {
  const map = readRawMap(path)
  const out: Record<string, string> = {}
  const lostKeys: string[] = []
  let hadPlaintext = false
  for (const [k, v] of Object.entries(map)) {
    if (k === '__format' || k === 'secrets') continue
    if (typeof v !== 'string' || !v) continue
    if (isEncryptedSecretBlob(v)) {
      const decoded = decodeSecretValue(v)
      if (!decoded) {
        lostKeys.push(k)
        continue
      }
      out[k] = decoded
    } else {
      hadPlaintext = true
      out[k] = v
    }
  }
  return { secrets: out, lostKeys, hadPlaintext }
}

export function loadFileSecrets(path: string): Record<string, string> {
  return loadFileSecretsDetailed(path).secrets
}

export function saveFileSecrets(path: string, secrets: Record<string, string>): void {
  const enc: Record<string, string> = {}
  for (const [k, v] of Object.entries(secrets)) {
    if (!k || typeof v !== 'string' || !v) continue
    // Never re-wrap an undecryptable blob as if it were a password
    if (isEncryptedSecretBlob(v)) continue
    enc[k] = encryptSecret(v)
  }
  writeFileSync(
    path,
    JSON.stringify({ __format: 'enc-v1', secrets: enc }, null, 2),
    'utf8'
  )
}
