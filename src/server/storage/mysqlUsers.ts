import { randomUUID } from 'crypto'
import type { RowDataPacket } from 'mysql2/promise'
import {
  defaultPermissions,
  type AuthUserPublic,
  type AuthUserRecord,
  type DeviceAcl,
  type UserLevel
} from '../../shared/permissions'
import { normalizeUserSsoBinding, type SsoProviderId } from '../../shared/sso'
import { hashPassword, verifyPassword } from '../../main/auth/jwt'
import { getPool, getConfigValue, setConfigValue } from '../db/pool'

function migrateUser(u: AuthUserRecord): AuthUserRecord {
  const bind = normalizeUserSsoBinding(u)
  const enabled = u.enabled !== false
  const groupIds = Array.isArray(u.groupIds)
    ? Array.from(new Set(u.groupIds.map((x) => String(x || '').trim()).filter(Boolean)))
    : undefined
  const next: AuthUserRecord = {
    ...u,
    enabled,
    ssoProvider: bind.ssoProvider,
    ssoExternalId: bind.ssoExternalId,
    permissions: Array.isArray(u.permissions) ? u.permissions : [],
    deviceAcl: u.deviceAcl && typeof u.deviceAcl === 'object' ? u.deviceAcl : {},
    groupIds: groupIds?.length ? groupIds : undefined
  }
  if (!next.groupIds) delete next.groupIds
  if (
    u.pluginData != null &&
    typeof u.pluginData === 'object' &&
    !Array.isArray(u.pluginData)
  ) {
    next.pluginData = u.pluginData
  }
  if (enabled) {
    delete next.bannedAt
    delete next.banReason
  } else if (typeof u.bannedAt === 'string' && u.bannedAt) {
    next.bannedAt = u.bannedAt
    if (typeof u.banReason === 'string' && u.banReason.trim()) next.banReason = u.banReason.trim()
  }
  return next
}

function publicUser(u: AuthUserRecord): AuthUserPublic {
  const { passwordHash: _h, passwordSalt: _s, ...rest } = migrateUser(u)
  return rest
}

function packPluginData(input: {
  pluginData?: Record<string, unknown>
  groupIds?: string[]
  [key: string]: unknown
}): Record<string, unknown> | null {
  const bag: Record<string, unknown> = {}
  if (
    input.pluginData != null &&
    typeof input.pluginData === 'object' &&
    !Array.isArray(input.pluginData)
  ) {
    bag.pluginData = input.pluginData
  }
  if (Array.isArray(input.groupIds)) {
    bag.groupIds = Array.from(
      new Set(input.groupIds.map((x) => String(x || '').trim()).filter(Boolean))
    )
  }
  for (const [k, v] of Object.entries(input)) {
    if (!(k.startsWith('x_') || k.startsWith('plugin_'))) continue
    if (v === undefined) continue
    bag[k] = v
  }
  return Object.keys(bag).length ? bag : null
}

function unpackPluginData(raw: unknown): Partial<AuthUserRecord> {
  if (raw == null) return {}
  let obj: Record<string, unknown>
  try {
    obj =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>)
  } catch {
    return {}
  }
  if (!obj || typeof obj !== 'object') return {}
  const out: Partial<AuthUserRecord> & Record<string, unknown> = {}
  if (
    obj.pluginData != null &&
    typeof obj.pluginData === 'object' &&
    !Array.isArray(obj.pluginData)
  ) {
    out.pluginData = obj.pluginData as Record<string, unknown>
  }
  if (Array.isArray(obj.groupIds)) {
    out.groupIds = obj.groupIds.map(String)
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('x_') || k.startsWith('plugin_')) out[k] = v
  }
  return out
}

function rowToUser(r: RowDataPacket): AuthUserRecord {
  const perms = r.permissions
  const acl = r.device_acl
  const extras = unpackPluginData(r.plugin_data)
  return migrateUser({
    id: String(r.id),
    username: String(r.username),
    displayName: String(r.display_name || ''),
    level: String(r.level) as UserLevel,
    enabled: Boolean(r.enabled),
    passwordHash: String(r.password_hash),
    passwordSalt: String(r.password_salt),
    permissions: typeof perms === 'string' ? JSON.parse(perms) : perms || [],
    deviceAcl: typeof acl === 'string' ? JSON.parse(acl) : acl || {},
    ssoProvider: (r.sso_provider || 'none') as SsoProviderId | 'none',
    ssoExternalId: String(r.sso_external_id || ''),
    bannedAt: r.banned_at ? new Date(r.banned_at).toISOString() : undefined,
    banReason: r.ban_reason ? String(r.ban_reason) : undefined,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    ...extras
  } as AuthUserRecord)
}

/** MySQL-backed user store — same public API as file UserStore */
export class MysqlUserStore {
  private jwtSecret: string
  private users: AuthUserRecord[] = []

  constructor(jwtSecretFallback: string) {
    this.jwtSecret = jwtSecretFallback
  }

  async init(): Promise<void> {
    const existing = await getConfigValue('jwt_secret')
    if (existing) this.jwtSecret = existing
    else await setConfigValue('jwt_secret', this.jwtSecret)

    try {
      await getPool().query('ALTER TABLE users ADD COLUMN plugin_data JSON NULL')
    } catch {
      /* column already exists */
    }

    const [rows] = await getPool().query<RowDataPacket[]>('SELECT COUNT(*) AS c FROM users')
    if (Number(rows[0]?.c) === 0) {
      const { hash, salt } = hashPassword('admin123')
      const now = new Date()
      const id = randomUUID()
      await getPool().query(
        `INSERT INTO users (id, username, display_name, level, enabled, password_hash, password_salt,
          permissions, device_acl, sso_provider, sso_external_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          'admin',
          '管理员',
          'admin',
          1,
          hash,
          salt,
          JSON.stringify(defaultPermissions('admin')),
          JSON.stringify({}),
          'none',
          '',
          now,
          now
        ]
      )
      console.log('[mysql] Created default admin: admin / admin123（首次登录须改密）')
      // Flag in memory after reload — row may not have mustChangePassword column; login detects admin123
    }
    await this.reload()
  }

  async reload(): Promise<void> {
    const [rows] = await getPool().query<RowDataPacket[]>('SELECT * FROM users')
    this.users = rows.map(rowToUser)
  }

  reloadFromDiskIfNeeded(): void {
    /* no-op */
  }

  getJwtSecret(): string {
    return this.jwtSecret
  }

  list(): AuthUserPublic[] {
    return this.users.map(publicUser)
  }

  getById(id: string): AuthUserRecord | undefined {
    const u = this.users.find((x) => x.id === id)
    return u ? migrateUser(u) : undefined
  }

  getByUsername(username: string): AuthUserRecord | undefined {
    const name = username.trim().toLowerCase()
    const u = this.users.find((x) => x.username.toLowerCase() === name)
    return u ? migrateUser(u) : undefined
  }

  getBySso(provider: SsoProviderId, externalId: string): AuthUserRecord | undefined {
    const id = externalId.trim()
    if (!id) return undefined
    const u = this.users.find((x) => x.ssoProvider === provider && x.ssoExternalId === id)
    return u ? migrateUser(u) : undefined
  }

  authenticate(username: string, password: string): AuthUserRecord | null {
    const u = this.getByUsername(username)
    if (!u || !u.enabled) return null
    if (!verifyPassword(password, u.passwordHash, u.passwordSalt)) return null
    return u
  }

  /** Look up local user for login messaging (does not verify password). */
  findLoginCandidate(username: string): AuthUserRecord | undefined {
    return this.getByUsername(username)
  }

  async create(input: {
    username: string
    password: string
    displayName?: string
    level: UserLevel
    permissions?: string[]
    deviceAcl?: DeviceAcl
    ssoProvider?: SsoProviderId | 'none'
    ssoExternalId?: string
    pluginData?: Record<string, unknown>
    [key: string]: unknown
  }): Promise<AuthUserPublic> {
    if (this.getByUsername(input.username)) throw new Error('用户名已存在')
    const { hash, salt } = hashPassword(input.password)
    const now = new Date()
    const id = randomUUID()
    const pluginBag = packPluginData(input)
    await getPool().query(
      `INSERT INTO users (id, username, display_name, level, enabled, password_hash, password_salt,
        permissions, device_acl, plugin_data, sso_provider, sso_external_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.username.trim(),
        input.displayName?.trim() || input.username.trim(),
        input.level,
        hash,
        salt,
        JSON.stringify(input.permissions ?? defaultPermissions(input.level)),
        JSON.stringify(input.deviceAcl ?? {}),
        pluginBag ? JSON.stringify(pluginBag) : null,
        input.ssoProvider || 'none',
        input.ssoExternalId || '',
        now,
        now
      ]
    )
    await this.reload()
    return publicUser(this.getById(id)!)
  }

  async update(
    id: string,
    patch: {
      displayName?: string
      level?: UserLevel
      enabled?: boolean
      permissions?: string[]
      deviceAcl?: DeviceAcl
      password?: string
      ssoProvider?: SsoProviderId | 'none'
      ssoExternalId?: string
      pluginData?: Record<string, unknown>
      [key: string]: unknown
    }
  ): Promise<AuthUserPublic> {
    if (!this.getById(id)) throw new Error('用户不存在')
    const fields: string[] = []
    const vals: unknown[] = []
    if (patch.displayName != null) {
      fields.push('display_name = ?')
      vals.push(patch.displayName)
    }
    if (patch.level != null) {
      fields.push('level = ?')
      vals.push(patch.level)
    }
    if (patch.enabled != null) {
      fields.push('enabled = ?')
      vals.push(patch.enabled ? 1 : 0)
      if (!patch.enabled) {
        fields.push('banned_at = ?')
        vals.push(new Date())
      } else {
        fields.push('banned_at = NULL', 'ban_reason = NULL')
      }
    }
    if (patch.permissions != null) {
      fields.push('permissions = ?')
      vals.push(JSON.stringify(patch.permissions))
    }
    if (patch.deviceAcl != null) {
      fields.push('device_acl = ?')
      vals.push(JSON.stringify(patch.deviceAcl))
    }
    if (patch.password) {
      const { hash, salt } = hashPassword(patch.password)
      fields.push('password_hash = ?', 'password_salt = ?')
      vals.push(hash, salt)
    }
    if (patch.ssoProvider != null) {
      fields.push('sso_provider = ?')
      vals.push(patch.ssoProvider)
    }
    if (patch.ssoExternalId != null) {
      fields.push('sso_external_id = ?')
      vals.push(patch.ssoExternalId)
    }
    const hasPluginExtras =
      patch.pluginData !== undefined ||
      patch.groupIds !== undefined ||
      Object.keys(patch).some((k) => k.startsWith('x_') || k.startsWith('plugin_'))
    if (hasPluginExtras) {
      const prev = this.getById(id)!
      const merged: Record<string, unknown> = {
        ...(prev.pluginData ? { pluginData: prev.pluginData } : {}),
        ...(prev.groupIds ? { groupIds: prev.groupIds } : {}),
        ...Object.fromEntries(
          Object.entries(prev).filter(
            ([k]) => k.startsWith('x_') || k.startsWith('plugin_')
          )
        ),
        ...patch
      }
      const bag = packPluginData(merged)
      fields.push('plugin_data = ?')
      vals.push(bag ? JSON.stringify(bag) : null)
    }
    fields.push('updated_at = ?')
    vals.push(new Date(), id)
    await getPool().query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, vals)
    await this.reload()
    return publicUser(this.getById(id)!)
  }

  async remove(id: string): Promise<void> {
    await getPool().query('DELETE FROM users WHERE id = ?', [id])
    await this.reload()
  }

  async ban(id: string, reason?: string): Promise<AuthUserPublic> {
    await getPool().query(
      'UPDATE users SET enabled = 0, banned_at = ?, ban_reason = ?, updated_at = ? WHERE id = ?',
      [new Date(), reason || null, new Date(), id]
    )
    await this.reload()
    const u = this.getById(id)
    if (!u) throw new Error('用户不存在')
    return publicUser(u)
  }

  async unban(id: string): Promise<AuthUserPublic> {
    await getPool().query(
      'UPDATE users SET enabled = 1, banned_at = NULL, ban_reason = NULL, updated_at = ? WHERE id = ?',
      [new Date(), id]
    )
    await this.reload()
    const u = this.getById(id)
    if (!u) throw new Error('用户不存在')
    return publicUser(u)
  }
}
