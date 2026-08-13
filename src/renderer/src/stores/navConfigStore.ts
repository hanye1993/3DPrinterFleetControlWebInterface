import { create } from 'zustand'
import {
  defaultNavConfig,
  normalizeNavConfig,
  type NavConfig
} from '@shared/navConfig'
import { isWebBrowser } from '@shared/platform'
import { isRemoteDataMode } from '../utils/appMode'
import { serverGet, serverSend } from '../api/serverClient'
import { useAuthStore } from './authStore'

type NavConfigState = {
  config: NavConfig
  loaded: boolean
  saving: boolean
  /** Sidebar rail collapsed */
  collapsed: boolean
  init: () => Promise<void>
  reload: () => Promise<void>
  save: (next: NavConfig) => Promise<{ ok: boolean; message?: string }>
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void
}

const COLLAPSE_KEY = 'hanye-nav-collapsed'

function readCollapsed(fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* ignore */
  }
  return fallback
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

async function fetchConfig(): Promise<NavConfig> {
  const authed = useAuthStore.getState().isAuthed()
  if (authed && (isRemoteDataMode() || isWebBrowser())) {
    const data = await serverGet<{ config?: unknown }>('/api/v1/nav-config')
    return normalizeNavConfig(data.config)
  }
  const api = window.electronAPI as
    | { navConfig?: { get: () => Promise<{ ok: boolean; config?: unknown; message?: string }> } }
    | undefined
  if (api?.navConfig?.get) {
    const res = await api.navConfig.get()
    if (res.ok) return normalizeNavConfig(res.config)
    throw new Error(res.message || '读取导航配置失败')
  }
  // Fallback: try HTTP when local Electron has token (server UI talking to self)
  if (authed) {
    const data = await serverGet<{ config?: unknown }>('/api/v1/nav-config')
    return normalizeNavConfig(data.config)
  }
  return defaultNavConfig()
}

async function persistConfig(next: NavConfig): Promise<NavConfig> {
  const authed = useAuthStore.getState().isAuthed()
  if (authed && (isRemoteDataMode() || isWebBrowser())) {
    const data = await serverSend<{ config?: unknown }>('/api/v1/nav-config', 'PUT', {
      config: next
    })
    return normalizeNavConfig(data.config ?? next)
  }
  const api = window.electronAPI as
    | {
        navConfig?: {
          save: (c: unknown) => Promise<{ ok: boolean; config?: unknown; message?: string }>
        }
      }
    | undefined
  if (api?.navConfig?.save) {
    const res = await api.navConfig.save(next)
    if (!res.ok) throw new Error(res.message || '保存失败')
    return normalizeNavConfig(res.config ?? next)
  }
  if (authed) {
    const data = await serverSend<{ config?: unknown }>('/api/v1/nav-config', 'PUT', {
      config: next
    })
    return normalizeNavConfig(data.config ?? next)
  }
  throw new Error('无法保存导航配置')
}

export const useNavConfigStore = create<NavConfigState>((set, get) => ({
  config: defaultNavConfig(),
  loaded: false,
  saving: false,
  collapsed: false,
  init: async () => {
    try {
      const config = await fetchConfig()
      set({
        config,
        loaded: true,
        collapsed: readCollapsed(config.startCollapsed)
      })
    } catch {
      const config = defaultNavConfig()
      set({ config, loaded: true, collapsed: readCollapsed(config.startCollapsed) })
    }
  },
  reload: async () => {
    const config = await fetchConfig()
    set({ config, loaded: true })
  },
  save: async (next) => {
    set({ saving: true })
    try {
      const config = await persistConfig(normalizeNavConfig(next))
      set({ config, saving: false })
      return { ok: true }
    } catch (e) {
      set({ saving: false })
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  },
  setCollapsed: (v) => {
    writeCollapsed(v)
    set({ collapsed: v })
  },
  toggleCollapsed: () => {
    const v = !get().collapsed
    writeCollapsed(v)
    set({ collapsed: v })
  }
}))
