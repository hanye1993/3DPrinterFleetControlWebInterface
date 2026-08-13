import { serverGet, serverSend } from './serverClient'
import type { AuthUserPublic, DeviceAcl, UserLevel } from '@shared/permissions'
import type { SsoProviderId } from '@shared/sso'

export type UserRow = AuthUserPublic & {
  online?: boolean
  lastSeenAt?: string
  connectedAt?: string
}

export async function fetchUsers(): Promise<UserRow[]> {
  const data = await serverGet<{ users?: UserRow[] }>('/api/v1/users')
  return data.users || []
}

export type UpsertUserPayload = {
  id?: string
  username: string
  displayName?: string
  level: UserLevel
  enabled: boolean
  password?: string
  permissions: string[]
  deviceAcl: DeviceAcl
  ssoProvider: SsoProviderId | 'none'
  ssoExternalId: string
  groupIds?: string[]
  pluginData?: Record<string, unknown>
  [key: string]: unknown
}

export async function upsertUser(
  payload: UpsertUserPayload
): Promise<{ ok: boolean; message?: string }> {
  try {
    const body: Record<string, unknown> = {
      username: payload.username,
      displayName: payload.displayName,
      level: payload.level,
      enabled: payload.enabled,
      password: payload.password,
      permissions: payload.permissions,
      deviceAcl: payload.deviceAcl,
      ssoProvider: payload.ssoProvider,
      ssoExternalId: payload.ssoExternalId,
      groupIds: Array.isArray(payload.groupIds) ? payload.groupIds : []
    }
    if (payload.pluginData && typeof payload.pluginData === 'object') {
      body.pluginData = payload.pluginData
    }
    for (const [k, v] of Object.entries(payload)) {
      if ((k.startsWith('x_') || k.startsWith('plugin_')) && v !== undefined) {
        body[k] = v
      }
    }
    if (payload.id) {
      await serverSend(`/api/v1/users/${encodeURIComponent(payload.id)}`, 'PATCH', body)
    } else {
      await serverSend('/api/v1/users', 'POST', body)
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '保存失败' }
  }
}

export async function kickUser(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await serverSend<{ message?: string }>(
      `/api/v1/users/${encodeURIComponent(id)}/kick`,
      'POST',
      {}
    )
    return { ok: true, message: data.message }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '踢下线失败' }
  }
}

export async function banUser(
  id: string,
  reason?: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await serverSend<{ message?: string }>(
      `/api/v1/users/${encodeURIComponent(id)}/ban`,
      'POST',
      { reason }
    )
    return { ok: true, message: data.message }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '封号失败' }
  }
}

export async function unbanUser(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const data = await serverSend<{ message?: string }>(
      `/api/v1/users/${encodeURIComponent(id)}/unban`,
      'POST',
      {}
    )
    return { ok: true, message: data.message }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '解封失败' }
  }
}

export async function deleteUser(id: string): Promise<{ ok: boolean; message?: string }> {
  try {
    await serverSend(`/api/v1/users/${encodeURIComponent(id)}`, 'DELETE')
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '删除失败' }
  }
}
