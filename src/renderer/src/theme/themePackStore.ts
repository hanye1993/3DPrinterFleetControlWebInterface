import type { ActiveThemeUiPayload } from '@shared/themePack'
import type {
  ThemeDeviceView,
  ThemeLayoutId,
  ThemeLoginLayout
} from '@shared/themePack'
import { create } from 'zustand'

/** Alias kept for ThemeLoader consumers */
export type ActiveThemePayload = ActiveThemeUiPayload

type ThemePackState = {
  active: ActiveThemePayload | null
  /** Loaded / server-compiled HTML templates by slot name */
  templateHtml: Record<string, string>
  revision: number
  setActive: (payload: ActiveThemePayload | null) => void
  setTemplateHtml: (map: Record<string, string>) => void
  bump: () => void
}

export const useThemePackStore = create<ThemePackState>((set) => ({
  active: null,
  templateHtml: {},
  revision: 0,
  setActive: (payload) =>
    set((s) => ({
      active: payload,
      templateHtml: payload?.templateHtml || {},
      revision: s.revision + 1
    })),
  setTemplateHtml: (map) => set({ templateHtml: map }),
  bump: () => set((s) => ({ revision: s.revision + 1 }))
}))

export function getThemeLayout(): ThemeLayoutId {
  return useThemePackStore.getState().active?.layout || 'classic'
}

export function getThemeDeviceView(): ThemeDeviceView {
  return useThemePackStore.getState().active?.deviceView || 'grid'
}

export function getThemeLoginLayout(): ThemeLoginLayout {
  return useThemePackStore.getState().active?.loginLayout || 'classic'
}
