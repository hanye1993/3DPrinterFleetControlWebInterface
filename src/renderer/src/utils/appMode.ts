import { isWebBrowser } from '@shared/platform'
import { useAuthStore } from '../stores/authStore'

/** Web SPA (or legacy remote client) — data via HTTP, no local printer IO */
export function isRemoteDataMode(): boolean {
  const { role } = useAuthStore.getState()
  return isWebBrowser() || role === 'client'
}

/** Admin management UI (users, soft settings sensitive tabs, etc.) */
export function isAdminUi(): boolean {
  if (!isWebBrowser()) {
    return useAuthStore.getState().role === 'server'
  }
  const { user, permissions } = useAuthStore.getState()
  if (!user) return false
  if (user.level === 'admin') return true
  if (permissions.includes('*')) return true
  return false
}

/**
 * Strict admin account (操作日志等敏感入口).
 * Electron 服务端本机 / Web 账号 level=admin（或 *）。
 */
export function isAdminAccount(): boolean {
  if (!isWebBrowser()) {
    return useAuthStore.getState().role === 'server'
  }
  const { user, permissions } = useAuthStore.getState()
  if (!user) return false
  if (user.level === 'admin') return true
  return permissions.includes('*')
}

/** Header title suffix — web only product */
export function appTitleSuffix(): string {
  return isAdminUi() ? '管理台' : '工作台'
}
