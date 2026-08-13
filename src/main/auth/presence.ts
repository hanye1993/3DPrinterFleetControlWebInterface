/** In-memory online presence + JWT revoke-after-kick for client sessions */

export type PresenceInfo = {
  userId: string
  username: string
  displayName: string
  connectedAt: string
  lastSeenAt: string
}

/** Without heartbeat within this window, user shows as offline */
const ONLINE_TTL_MS = 90_000

export class PresenceStore {
  private online = new Map<string, PresenceInfo>()
  /** Tokens with iat <= value are rejected (set on kick / delete) */
  private revokedAtOrBefore = new Map<string, number>()

  touch(user: { id: string; username: string; displayName?: string }): void {
    const now = new Date().toISOString()
    const prev = this.online.get(user.id)
    this.online.set(user.id, {
      userId: user.id,
      username: user.username,
      displayName: user.displayName || user.username,
      connectedAt: prev?.connectedAt || now,
      lastSeenAt: now
    })
  }

  markOffline(userId: string): void {
    this.online.delete(userId)
  }

  isTokenRevoked(userId: string, iat: number): boolean {
    const cut = this.revokedAtOrBefore.get(userId)
    if (cut === undefined) return false
    return iat <= cut
  }

  /** Invalidate all current JWTs for this user and clear online flag */
  kick(userId: string): { ok: true; wasOnline: boolean } {
    const wasOnline = this.isOnline(userId)
    this.revokedAtOrBefore.set(userId, Math.floor(Date.now() / 1000))
    this.online.delete(userId)
    return { ok: true, wasOnline }
  }

  isOnline(userId: string): boolean {
    this.pruneOne(userId)
    return this.online.has(userId)
  }

  get(userId: string): PresenceInfo | null {
    this.pruneOne(userId)
    return this.online.get(userId) || null
  }

  listOnline(): PresenceInfo[] {
    this.pruneAll()
    return Array.from(this.online.values()).sort((a, b) =>
      a.username.localeCompare(b.username, 'zh-CN')
    )
  }

  private pruneOne(userId: string): void {
    const p = this.online.get(userId)
    if (!p) return
    const age = Date.now() - Date.parse(p.lastSeenAt)
    if (!Number.isFinite(age) || age > ONLINE_TTL_MS) {
      this.online.delete(userId)
    }
  }

  private pruneAll(): void {
    for (const id of Array.from(this.online.keys())) {
      this.pruneOne(id)
    }
  }
}
