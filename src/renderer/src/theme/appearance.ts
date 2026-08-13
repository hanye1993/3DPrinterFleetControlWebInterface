import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'
import type { ThemeStyleDef } from '@shared/themePack'
import { DEFAULT_THEME_ID } from '@shared/themePack'

export type UiThemeId = string

export type UiBgMode = 'default' | 'color' | 'image'

export type UiThemeDef = {
  id: string
  name: string
  desc: string
  /** preview swatches */
  swatch: [string, string, string]
  antd: ThemeConfig
  /** CSS custom properties applied to :root */
  css: Record<string, string>
}

/** Built-in fallback when theme pack API unavailable (matches themes/default) */
export const UI_THEMES: UiThemeDef[] = [
  {
    id: 'midnight',
    name: '午夜蓝',
    desc: '默认深色，蓝灰径向氛围',
    swatch: ['#0f1115', '#1a2332', '#3d8bfd'],
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: { colorPrimary: '#3d8bfd', colorBgBase: '#141414', borderRadius: 8 }
    },
    css: {
      '--app-color-scheme': 'dark',
      '--app-text': '#e8eaed',
      '--app-header-bg': '#101218',
      '--app-header-border': 'rgba(255, 255, 255, 0.08)',
      '--app-header-title': '#f0f3f8',
      '--app-shell-bg':
        'radial-gradient(1200px 600px at 10% -10%, #1a2332 0%, transparent 55%), radial-gradient(900px 500px at 100% 0%, #1b1828 0%, transparent 50%), #0f1115',
      '--app-sidebar-bg': 'transparent',
      '--app-footer-bg': 'rgba(16, 18, 24, 0.92)',
      '--app-card-bg': 'rgba(22, 24, 30, 0.88)',
      '--app-control-color': 'rgba(232, 234, 237, 0.75)'
    }
  },
  {
    id: 'ocean',
    name: '深海青',
    desc: '冷青主色，偏监控台科技感',
    swatch: ['#07151c', '#0d3a45', '#14b8a6'],
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: { colorPrimary: '#14b8a6', colorBgBase: '#0a1a20', borderRadius: 8 }
    },
    css: {
      '--app-color-scheme': 'dark',
      '--app-text': '#e6f4f3',
      '--app-header-bg': '#0a171c',
      '--app-header-border': 'rgba(20, 184, 166, 0.18)',
      '--app-header-title': '#ecfeff',
      '--app-shell-bg':
        'radial-gradient(1100px 560px at 0% -5%, #0f3d4a 0%, transparent 55%), radial-gradient(800px 480px at 100% 10%, #102a3a 0%, transparent 50%), #07151c',
      '--app-sidebar-bg': 'transparent',
      '--app-footer-bg': 'rgba(10, 23, 28, 0.92)',
      '--app-card-bg': 'rgba(12, 28, 34, 0.9)',
      '--app-control-color': 'rgba(230, 244, 243, 0.78)'
    }
  },
  {
    id: 'forest',
    name: '松烟绿',
    desc: '墨绿底色，护眼偏稳重',
    swatch: ['#0d1410', '#1a3324', '#52c41a'],
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: { colorPrimary: '#52c41a', colorBgBase: '#121a14', borderRadius: 8 }
    },
    css: {
      '--app-color-scheme': 'dark',
      '--app-text': '#e8f0e9',
      '--app-header-bg': '#101812',
      '--app-header-border': 'rgba(82, 196, 26, 0.16)',
      '--app-header-title': '#f3faf4',
      '--app-shell-bg':
        'radial-gradient(1000px 520px at 15% -8%, #1e3a28 0%, transparent 55%), radial-gradient(820px 460px at 95% 0%, #1a2a1c 0%, transparent 48%), #0d1410',
      '--app-sidebar-bg': 'transparent',
      '--app-footer-bg': 'rgba(16, 24, 18, 0.92)',
      '--app-card-bg': 'rgba(18, 28, 20, 0.9)',
      '--app-control-color': 'rgba(232, 240, 233, 0.75)'
    }
  },
  {
    id: 'amber',
    name: '琥珀暖',
    desc: '暖色强调，车间夜班氛围',
    swatch: ['#14110e', '#3a2614', '#fa8c16'],
    antd: {
      algorithm: antdTheme.darkAlgorithm,
      token: { colorPrimary: '#fa8c16', colorBgBase: '#1a1510', borderRadius: 8 }
    },
    css: {
      '--app-color-scheme': 'dark',
      '--app-text': '#f3ebe3',
      '--app-header-bg': '#16120e',
      '--app-header-border': 'rgba(250, 140, 22, 0.18)',
      '--app-header-title': '#fff7ed',
      '--app-shell-bg':
        'radial-gradient(1000px 540px at 8% -10%, #3b2412 0%, transparent 55%), radial-gradient(780px 440px at 100% 5%, #2a1a12 0%, transparent 50%), #14110e',
      '--app-sidebar-bg': 'transparent',
      '--app-footer-bg': 'rgba(22, 18, 14, 0.92)',
      '--app-card-bg': 'rgba(28, 22, 16, 0.9)',
      '--app-control-color': 'rgba(243, 235, 227, 0.78)'
    }
  },
  {
    id: 'slate',
    name: '浅灰日间',
    desc: '浅色界面，适合亮环境',
    swatch: ['#f4f6f8', '#dce3ea', '#1677ff'],
    antd: {
      algorithm: antdTheme.defaultAlgorithm,
      token: { colorPrimary: '#1677ff', colorBgBase: '#f5f7fa', borderRadius: 8 }
    },
    css: {
      '--app-color-scheme': 'light',
      '--app-text': '#1f2329',
      '--app-header-bg': '#ffffff',
      '--app-header-border': 'rgba(15, 23, 42, 0.1)',
      '--app-header-title': '#111827',
      '--app-shell-bg':
        'radial-gradient(1100px 560px at 10% -10%, #e8eef6 0%, transparent 55%), radial-gradient(900px 500px at 100% 0%, #ebe4f5 0%, transparent 50%), #f4f6f8',
      '--app-sidebar-bg': 'transparent',
      '--app-footer-bg': 'rgba(255, 255, 255, 0.92)',
      '--app-card-bg': 'rgba(255, 255, 255, 0.92)',
      '--app-control-color': 'rgba(31, 35, 41, 0.65)'
    }
  }
]

export function styleDefToUiTheme(style: ThemeStyleDef): UiThemeDef {
  const algo =
    style.antd?.algorithm === 'default' ? antdTheme.defaultAlgorithm : antdTheme.darkAlgorithm
  return {
    id: style.id,
    name: style.name,
    desc: style.desc,
    swatch: style.swatch,
    antd: {
      algorithm: algo,
      token: {
        colorPrimary: style.antd?.colorPrimary || '#3d8bfd',
        colorBgBase: style.antd?.colorBgBase || '#141414',
        borderRadius: style.antd?.borderRadius ?? 8
      }
    },
    css: { ...style.css }
  }
}

export function getUiTheme(id: string | undefined): UiThemeDef {
  return UI_THEMES.find((t) => t.id === id) || UI_THEMES[0]
}

/** Resolve style from active theme pack store, else built-in fallback */
export function resolveUiTheme(
  styleId: string | undefined,
  packStyles?: ThemeStyleDef[] | null
): UiThemeDef {
  if (packStyles?.length) {
    const hit = packStyles.find((s) => s.id === styleId) || packStyles[0]
    if (hit) return styleDefToUiTheme(hit)
  }
  return getUiTheme(styleId)
}

export function applyAppearance(opts: {
  themeId: string
  packId?: string
  styleCss?: Record<string, string>
  bgMode: UiBgMode
  bgColor?: string
  bgImage?: string
}): void {
  const root = document.documentElement
  const themeDef =
    opts.styleCss && Object.keys(opts.styleCss).length
      ? { id: opts.themeId, css: opts.styleCss }
      : getUiTheme(opts.themeId)
  root.setAttribute('data-theme', themeDef.id)
  root.setAttribute('data-theme-pack', opts.packId || DEFAULT_THEME_ID)
  root.style.colorScheme = themeDef.css['--app-color-scheme'] || 'dark'

  for (const [k, v] of Object.entries(themeDef.css)) {
    root.style.setProperty(k, v)
  }

  if (opts.bgMode === 'color' && opts.bgColor) {
    root.style.setProperty('--app-bg-solid', opts.bgColor)
  } else {
    root.style.removeProperty('--app-bg-solid')
  }

  if (opts.bgMode === 'image' && opts.bgImage) {
    root.style.setProperty('--app-bg-image', `url("${opts.bgImage.replace(/"/g, '\\"')}")`)
  } else {
    root.style.removeProperty('--app-bg-image')
  }
}
