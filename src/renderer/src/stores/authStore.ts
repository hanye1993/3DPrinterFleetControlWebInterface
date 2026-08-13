import { create } from 'zustand'
import type { AppRole } from '@shared/appRole'
import { isWebBrowser } from '@shared/platform'
import { normalizeServerBaseUrl } from '@shared/serverUrl'
import {
  canDeviceAction,
  canAccessDeviceControl,
  hasPerm,
  type AuthUserPublic,
  type DeviceAcl,
  type DeviceActionPerm,
  type UserLevel
} from '@shared/permissions'
import { userHasSsoBinding, type SsoProviderId } from '@shared/sso'

const TOKEN_KEY = 'hanye_client_jwt'
const SERVER_KEY = 'hanye_client_server'
const SERVER_SAVED_KEY = 'hanye_client_server_saved'
const CRED_USER_KEY = 'hanye_client_username'
const CRED_PASS_KEY = 'hanye_client_password'
const CRED_REMEMBER_KEY = 'hanye_client_remember'

export function loadSavedCredentials(): {
  username: string
  password: string
  remember: boolean
} {
  const remember = localStorage.getItem(CRED_REMEMBER_KEY) !== '0'
  if (!remember) return { username: '', password: '', remember: false }
  return {
    username: localStorage.getItem(CRED_USER_KEY) || '',
    password: localStorage.getItem(CRED_PASS_KEY) || '',
    remember: true
  }
}

export function saveCredentials(username: string, password: string, remember: boolean): void {
  if (remember) {
    localStorage.setItem(CRED_REMEMBER_KEY, '1')
    localStorage.setItem(CRED_USER_KEY, username)
    localStorage.setItem(CRED_PASS_KEY, password)
  } else {
    localStorage.setItem(CRED_REMEMBER_KEY, '0')
    localStorage.removeItem(CRED_USER_KEY)
    localStorage.removeItem(CRED_PASS_KEY)
  }
}

export function clearSavedCredentials(): void {
  localStorage.removeItem(CRED_USER_KEY)
  localStorage.removeItem(CRED_PASS_KEY)
  localStorage.setItem(CRED_REMEMBER_KEY, '0')
}

type AuthState = {
  role: AppRole
  ready: boolean
  serverUrl: string
  /** 是否已在本地保存过服务端地址 */
  serverSaved: boolean
  token: string | null
  user: AuthUserPublic | null
  permissions: string[]
  deviceAcl: DeviceAcl
  loginError: string | null
  requireBinding: boolean
  requireSsoLogin: boolean
  needsSsoBind: boolean
  init: () => Promise<void>
  setServerUrl: (url: string, opts?: { persist?: boolean }) => void
  clearServerUrl: () => void
  login: (username: string, password: string) => Promise<boolean>
  applySession: (data: {
    token: string
    user?: AuthUserPublic
    permissions?: string[]
    deviceAcl?: DeviceAcl
    needsSsoBind?: boolean
    requireBinding?: boolean
  }) => void
  logout: () => void
  refreshMe: () => Promise<void>
  bindSso: (opts: {
    provider: SsoProviderId
    externalId?: string
    username?: string
    password?: string
  }) => Promise<{ ok: boolean; message?: string }>
  can: (perm: string) => boolean
  canDevice: (deviceId: string, action: 'view' | DeviceActionPerm) => boolean
  canOpenDevice: (deviceId: string) => boolean
  isAuthed: () => boolean
}

async function apiFetch(
  serverUrl: string,
  path: string,
  opts: RequestInit & { token?: string | null } = {}
): Promise<Response> {
  const base = serverUrl.replace(/\/$/, '')
  const headers = new Headers(opts.headers || {})
  if (opts.token) headers.set('Authorization', `Bearer ${opts.token}`)
  if (opts.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(`${base}${path}`, { ...opts, headers })
}

export const useAuthStore = create<AuthState>((set, get) => ({
  role: 'server',
  ready: false,
  serverUrl: localStorage.getItem(SERVER_KEY) || 'http://127.0.0.1:17890',
  serverSaved: localStorage.getItem(SERVER_SAVED_KEY) === '1',
  token: localStorage.getItem(TOKEN_KEY),
  user: null,
  permissions: [],
  deviceAcl: {},
  loginError: null,
  requireBinding: false,
  requireSsoLogin: false,
  needsSsoBind: false,

  init: async () => {
    if (isWebBrowser()) {
      const origin = window.location.origin.replace(/\/$/, '')
      localStorage.setItem(SERVER_KEY, origin)
      localStorage.setItem(SERVER_SAVED_KEY, '1')
      set({ role: 'client', serverUrl: origin, serverSaved: true })
      const token = get().token
      if (token) {
        try {
          await get().refreshMe()
        } catch {
          localStorage.removeItem(TOKEN_KEY)
          set({ token: null, user: null, permissions: [], deviceAcl: {}, needsSsoBind: false })
        }
      }
      set({ ready: true })
      return
    }
    const role = ((await window.electronAPI?.app?.getRole?.()) || 'server') as AppRole
    set({ role })
    if (role === 'server') {
      set({
        ready: true,
        user: {
          id: 'local-admin',
          username: 'local',
          displayName: '本机管理',
          level: 'admin' as UserLevel,
          enabled: true,
          permissions: ['*'],
          deviceAcl: {},
          ssoProvider: 'none',
          ssoExternalId: '',
          createdAt: '',
          updatedAt: ''
        },
        permissions: ['*'],
        deviceAcl: {},
        token: null,
        needsSsoBind: false
      })
      return
    }
    const token = get().token
    if (token) {
      try {
        await get().refreshMe()
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        set({ token: null, user: null, permissions: [], deviceAcl: {}, needsSsoBind: false })
      }
    }
    set({ ready: true })
  },

  setServerUrl: (url, opts) => {
    const raw = url.trim()
    const v = normalizeServerBaseUrl(raw) || raw
    const persist = opts?.persist !== false
    if (persist && v) {
      localStorage.setItem(SERVER_KEY, v)
      localStorage.setItem(SERVER_SAVED_KEY, '1')
      set({ serverUrl: v, serverSaved: true })
    } else {
      set({ serverUrl: v })
    }
  },

  clearServerUrl: () => {
    localStorage.removeItem(SERVER_KEY)
    localStorage.removeItem(SERVER_SAVED_KEY)
    localStorage.removeItem(TOKEN_KEY)
    clearSavedCredentials()
    set({
      serverUrl: 'http://127.0.0.1:17890',
      serverSaved: false,
      token: null,
      user: null,
      permissions: [],
      deviceAcl: {},
      needsSsoBind: false,
      loginError: null
    })
  },

  login: async (username, password) => {
    set({ loginError: null })
    try {
      const res = await apiFetch(get().serverUrl, '/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
        token?: string
        user?: AuthUserPublic
        permissions?: string[]
        deviceAcl?: DeviceAcl
        needsSsoBind?: boolean
        requireBinding?: boolean
      }
      if (!res.ok || !data.ok || !data.token) {
        set({ loginError: data.message || '登录失败' })
        return false
      }
      // 首次成功连接：固化服务端地址
      localStorage.setItem(SERVER_KEY, get().serverUrl.replace(/\/$/, ''))
      localStorage.setItem(SERVER_SAVED_KEY, '1')
      localStorage.setItem(TOKEN_KEY, data.token)
      const needs =
        data.needsSsoBind === true ||
        (Boolean(data.requireBinding) && data.user && !userHasSsoBinding(data.user))
      set({
        token: data.token,
        user: data.user || null,
        permissions: data.permissions || [],
        deviceAcl: data.deviceAcl || {},
        loginError: null,
        serverSaved: true,
        requireBinding: Boolean(data.requireBinding),
        needsSsoBind: Boolean(needs)
      })
      return true
    } catch (e) {
      set({ loginError: e instanceof Error ? e.message : '无法连接系统' })
      return false
    }
  },

  applySession: (data) => {
    localStorage.setItem(SERVER_KEY, get().serverUrl.replace(/\/$/, ''))
    localStorage.setItem(SERVER_SAVED_KEY, '1')
    localStorage.setItem(TOKEN_KEY, data.token)
    const needs =
      data.needsSsoBind === true ||
      (Boolean(data.requireBinding) && data.user && !userHasSsoBinding(data.user)) ||
      (get().requireBinding && data.user && !userHasSsoBinding(data.user))
    set({
      token: data.token,
      user: data.user || null,
      permissions: data.permissions || [],
      deviceAcl: data.deviceAcl || {},
      loginError: null,
      serverSaved: true,
      needsSsoBind: Boolean(needs)
    })
  },

  logout: () => {
    const { serverUrl, token } = get()
    if (token && serverUrl) {
      void apiFetch(serverUrl, '/api/v1/auth/logout', { method: 'POST', token }).catch(() => undefined)
    }
    localStorage.removeItem(TOKEN_KEY)
    set({ token: null, user: null, permissions: [], deviceAcl: {}, needsSsoBind: false })
  },

  refreshMe: async () => {
    const { serverUrl, token } = get()
    if (!token) throw new Error('no token')
    const res = await apiFetch(serverUrl, '/api/v1/me', { token })
    const data = (await res.json()) as {
      ok?: boolean
      user?: AuthUserPublic
      permissions?: string[]
      deviceAcl?: DeviceAcl
      message?: string
      needsSsoBind?: boolean
      requireBinding?: boolean
      requireSsoLogin?: boolean
    }
    if (res.status === 401 || !res.ok || !data.ok) {
      localStorage.removeItem(TOKEN_KEY)
      set({ token: null, user: null, permissions: [], deviceAcl: {}, needsSsoBind: false })
      throw new Error(data.message || '会话失效')
    }
    const needs =
      data.needsSsoBind === true ||
      (Boolean(data.requireBinding) && data.user && !userHasSsoBinding(data.user))
    const permissions = data.permissions || []
    const deviceAcl = data.deviceAcl || {}
    const prev = get()
    const unchanged =
      JSON.stringify(prev.permissions) === JSON.stringify(permissions) &&
      JSON.stringify(prev.deviceAcl) === JSON.stringify(deviceAcl) &&
      prev.user?.id === data.user?.id &&
      prev.user?.level === data.user?.level &&
      prev.user?.updatedAt === data.user?.updatedAt &&
      prev.requireBinding === Boolean(data.requireBinding) &&
      prev.requireSsoLogin === Boolean(data.requireSsoLogin) &&
      prev.needsSsoBind === Boolean(needs)
    if (unchanged) return
    set({
      user: data.user || null,
      permissions,
      deviceAcl,
      requireBinding: Boolean(data.requireBinding),
      requireSsoLogin: Boolean(data.requireSsoLogin),
      needsSsoBind: Boolean(needs)
    })
  },

  bindSso: async (opts) => {
    const { serverUrl, token } = get()
    if (!token) return { ok: false, message: '未登录' }
    try {
      const res = await apiFetch(serverUrl, '/api/v1/me/sso-bind', {
        method: 'POST',
        token,
        body: JSON.stringify(opts)
      })
      const data = (await res.json()) as {
        ok?: boolean
        message?: string
        user?: AuthUserPublic
        permissions?: string[]
        deviceAcl?: DeviceAcl
        needsSsoBind?: boolean
      }
      if (!res.ok || data.ok === false) {
        return { ok: false, message: data.message || '绑定失败' }
      }
      set({
        user: data.user || get().user,
        permissions: data.permissions || get().permissions,
        deviceAcl: data.deviceAcl || get().deviceAcl,
        needsSsoBind: false
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '绑定失败' }
    }
  },

  can: (perm) => {
    const { role, permissions } = get()
    if (role === 'server') return true
    return hasPerm(permissions, perm)
  },

  canDevice: (deviceId, action) => {
    const { role, user, permissions, deviceAcl } = get()
    if (role === 'server') return true
    if (!user) return false
    return canDeviceAction(
      { level: user.level, permissions, deviceAcl },
      deviceId,
      action
    )
  },

  canOpenDevice: (deviceId) => {
    const { role, user, permissions, deviceAcl } = get()
    if (role === 'server') return true
    if (!user) return false
    return canAccessDeviceControl(
      { level: user.level, permissions, deviceAcl },
      deviceId
    )
  },

  isAuthed: () => {
    const { role, user, token } = get()
    if (isWebBrowser()) return !!(token && user)
    if (role === 'server') return true
    return !!(token && user)
  }
}))

export { apiFetch }

/** Subscribe to ACL/permissions so UI re-renders when admin changes grants */
export function useAuthGrants(): {
  permissions: string[]
  deviceAcl: DeviceAcl
  can: AuthState['can']
  canDevice: AuthState['canDevice']
  canOpenDevice: AuthState['canOpenDevice']
} {
  const permissions = useAuthStore((s) => s.permissions)
  const deviceAcl = useAuthStore((s) => s.deviceAcl)
  const can = useAuthStore((s) => s.can)
  const canDevice = useAuthStore((s) => s.canDevice)
  const canOpenDevice = useAuthStore((s) => s.canOpenDevice)
  return { permissions, deviceAcl, can, canDevice, canOpenDevice }
}
