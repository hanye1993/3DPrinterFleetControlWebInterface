import { randomUUID } from 'crypto'
import type { SsoProviderId } from '../../shared/sso'

export type SsoQrSession = {
  id: string
  provider: 'wecom' | 'dingtalk'
  /** login = 扫码登录；bind = 已登录用户绑定对接账号 */
  mode: 'login' | 'bind'
  status: 'pending' | 'ok' | 'expired' | 'error'
  message?: string
  externalId?: string
  userId?: string
  token?: string
  authorizeUrl: string
  createdAt: number
  expiresAt: number
}

const sessions = new Map<string, SsoQrSession>()
const TTL_MS = 5 * 60 * 1000

function sweep(): void {
  const now = Date.now()
  for (const id of Array.from(sessions.keys())) {
    const s = sessions.get(id)
    if (!s) continue
    if (s.expiresAt < now && s.status === 'pending') {
      s.status = 'expired'
    }
    if (s.expiresAt + 60_000 < now) sessions.delete(id)
  }
}

export function createSsoQrSession(opts: {
  provider: 'wecom' | 'dingtalk'
  authorizeUrl: string
  mode?: 'login' | 'bind'
  userId?: string
}): SsoQrSession {
  sweep()
  const now = Date.now()
  const mode = opts.mode || 'login'
  const session: SsoQrSession = {
    id: randomUUID(),
    provider: opts.provider,
    mode,
    status: 'pending',
    authorizeUrl: opts.authorizeUrl,
    userId: mode === 'bind' ? opts.userId : undefined,
    createdAt: now,
    expiresAt: now + TTL_MS
  }
  sessions.set(session.id, session)
  return session
}

export function getSsoQrSession(id: string): SsoQrSession | undefined {
  sweep()
  return sessions.get(id)
}

export function completeSsoQrSession(
  id: string,
  result: { externalId: string; userId: string; token?: string }
): SsoQrSession | null {
  const s = sessions.get(id)
  if (!s || s.status !== 'pending') return null
  if (Date.now() > s.expiresAt) {
    s.status = 'expired'
    return s
  }
  s.status = 'ok'
  s.externalId = result.externalId
  s.userId = result.userId
  if (result.token) s.token = result.token
  return s
}

export function failSsoQrSession(id: string, message: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.status = 'error'
  s.message = message
}

export function publicQrSession(s: SsoQrSession): Record<string, unknown> {
  return {
    id: s.id,
    provider: s.provider,
    mode: s.mode,
    status: s.status,
    message: s.message,
    authorizeUrl: s.authorizeUrl,
    expiresAt: s.expiresAt,
    externalId: s.status === 'ok' ? s.externalId : undefined,
    token: s.status === 'ok' ? s.token : undefined,
    userId: s.status === 'ok' ? s.userId : undefined
  }
}

export type ScanProvider = Extract<SsoProviderId, 'wecom' | 'dingtalk'>
