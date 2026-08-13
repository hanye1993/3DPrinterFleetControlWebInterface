/**
 * Theme pack model — installable Discuz-style skin + .htm template packs.
 *
 *   themes/{identifier}/
 *     theme.json
 *     style.css
 *     login.css
 *     layout.js              — optional browser script (HanyeTheme API)
 *     templates/             — Discuz-like .htm (extends/block/include/{$var})
 *       app.shell.replace.htm
 *       common/header.htm
 *     slots/                 — alias of templates/ for slot HTML
 */

export type ThemeStyleDef = {
  id: string
  name: string
  desc: string
  swatch: [string, string, string]
  css: Record<string, string>
  antd?: {
    colorPrimary?: string
    colorBgBase?: string
    algorithm?: 'dark' | 'default'
    borderRadius?: number
  }
}

/** Built-in React shell engines (layout / device / login modes) */
export type ThemeLayoutId = 'classic' | 'topnav' | 'workspace' | 'custom'

/** How device lists are composed */
export type ThemeDeviceView = 'grid' | 'list' | 'table'

export type ThemeLoginLayout = 'classic' | 'split' | 'custom'

/**
 * skin — CSS + layout engines + slot inject (default)
 * full — theme .htm owns whole-site DOM; React mounts into data-hanye-mount islands
 */
export type ThemeSiteMode = 'skin' | 'full'

/** Mount points themes must provide in app.shell.replace / login.page.replace */
export const THEME_FULLSITE_MOUNTS = [
  'header-brand',
  'header-actions',
  'nav',
  'main',
  'footer',
  'mobile-toolbar',
  'login-form',
  'login-hero'
] as const

export type ThemeFullSiteMount = (typeof THEME_FULLSITE_MOUNTS)[number]

export type ThemePackManifest = {
  identifier: string
  name: string
  version: string
  description: string
  copyright: string
  author: string
  builtin: boolean
  styles: ThemeStyleDef[]
  defaultStyle: string
  cssFiles: string[]
  loginCssFiles: string[]
  /** Shell layout engine — default classic (= current UI); ignored when siteMode=full */
  layout: ThemeLayoutId
  /** Device page composition */
  deviceView: ThemeDeviceView
  /** Login page composition */
  loginLayout: ThemeLoginLayout
  /**
   * skin = overlay React shell; full = theme HTML is the site (data-hanye-mount islands)
   */
  siteMode: ThemeSiteMode
  /** Browser scripts relative to pack root */
  layoutJs: string[]
  /**
   * Optional explicit template map: slot name → relative path.
   * Prefer auto-discovery of templates/ .htm files (filename = slot name).
   */
  templates: Record<string, string>
  /**
   * Parent theme id (Discuz-style inheritance).
   * Parent templates register first; child overrides same-name files.
   */
  parent?: string
  preview?: string
}

export type ThemePackRuntime = ThemePackManifest & {
  installedAt: string
  updatedAt: string
  directory: string
  error?: string
}

/** SPA payload from GET /api/v1/themes/active */
export type ActiveThemeUiPayload = {
  packId: string
  styleId: string
  pack: ThemePackManifest
  style: ThemeStyleDef
  layout: ThemeLayoutId
  deviceView: ThemeDeviceView
  loginLayout: ThemeLoginLayout
  /** Effective site mode (full requires app.shell.replace template) */
  siteMode: ThemeSiteMode
  css: string[]
  loginCss: string[]
  layoutJs: string[]
  /** @deprecated Raw asset URLs; prefer templateHtml (server-compiled). */
  templates: Record<string, string>
  /** Discuz TemplateEngine output: slot name → HTML */
  templateHtml: Record<string, string>
  /** True when .htm engine compiled templates for this pack */
  templateEngine: boolean
}

export type ThemesStateFile = {
  active: string
  installed: Record<string, ThemePackRuntime>
}

export const DEFAULT_THEME_ID = 'default'
export const THEME_LAYOUTS: ThemeLayoutId[] = ['classic', 'topnav', 'workspace', 'custom']
export const THEME_DEVICE_VIEWS: ThemeDeviceView[] = ['grid', 'list', 'table']
export const THEME_LOGIN_LAYOUTS: ThemeLoginLayout[] = ['classic', 'split', 'custom']

export function defaultThemesState(): ThemesStateFile {
  return { active: DEFAULT_THEME_ID, installed: {} }
}

export function normalizeThemesState(raw: unknown): ThemesStateFile {
  const base = defaultThemesState()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  if (typeof o.active === 'string' && o.active.trim()) base.active = o.active.trim()
  if (o.installed && typeof o.installed === 'object') {
    for (const [id, v] of Object.entries(o.installed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      try {
        const m = parseThemeJson(v, id)
        const p = v as Record<string, unknown>
        base.installed[id] = {
          ...m,
          installedAt: String(p.installedAt || new Date().toISOString()),
          updatedAt: String(p.updatedAt || new Date().toISOString()),
          directory: String(p.directory || id),
          error: typeof p.error === 'string' ? p.error : undefined
        }
      } catch {
        /* skip */
      }
    }
  }
  return base
}

function asStrList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

function asLayout(v: unknown): ThemeLayoutId {
  const s = String(v || '').trim()
  if (s === 'topnav' || s === 'workspace' || s === 'custom' || s === 'classic') return s
  return 'classic'
}

function asDeviceView(v: unknown): ThemeDeviceView {
  const s = String(v || '').trim()
  if (s === 'list' || s === 'table' || s === 'grid') return s
  return 'grid'
}

function asLoginLayout(v: unknown): ThemeLoginLayout {
  const s = String(v || '').trim()
  if (s === 'split' || s === 'custom' || s === 'classic') return s
  return 'classic'
}

function asSiteMode(v: unknown): ThemeSiteMode {
  return String(v || '').trim() === 'full' ? 'full' : 'skin'
}

function asTemplates(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[k] = val.trim().replace(/^\/+/, '')
  }
  return out
}

function asStyle(raw: unknown): ThemeStyleDef | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = String(o.id || '').trim()
  if (!id) return null
  const sw = Array.isArray(o.swatch) ? o.swatch.map(String) : []
  const swatch: [string, string, string] = [
    sw[0] || '#111',
    sw[1] || '#333',
    sw[2] || '#3d8bfd'
  ]
  const css =
    o.css && typeof o.css === 'object'
      ? Object.fromEntries(
          Object.entries(o.css as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
        )
      : {}
  const antdRaw = o.antd && typeof o.antd === 'object' ? (o.antd as Record<string, unknown>) : null
  return {
    id,
    name: String(o.name || id),
    desc: String(o.desc || o.description || ''),
    swatch,
    css,
    antd: antdRaw
      ? {
          colorPrimary: typeof antdRaw.colorPrimary === 'string' ? antdRaw.colorPrimary : undefined,
          colorBgBase: typeof antdRaw.colorBgBase === 'string' ? antdRaw.colorBgBase : undefined,
          algorithm:
            antdRaw.algorithm === 'default'
              ? 'default'
              : antdRaw.algorithm === 'dark'
                ? 'dark'
                : undefined,
          borderRadius:
            typeof antdRaw.borderRadius === 'number'
              ? antdRaw.borderRadius
              : Number(antdRaw.borderRadius) || undefined
        }
      : undefined
  }
}

export function parseThemeJson(raw: unknown, fallbackId?: string): ThemePackManifest {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const stylesIn = Array.isArray(o.styles) ? o.styles : []
  const styles = stylesIn.map(asStyle).filter((s): s is ThemeStyleDef => !!s)
  const identifier = String(o.identifier || fallbackId || 'unknown')
  const defaultStyle = String(o.defaultStyle || styles[0]?.id || 'default')
  const parentRaw = typeof o.parent === 'string' ? o.parent.trim() : ''
  return {
    identifier,
    name: String(o.name || identifier),
    version: String(o.version || '1.0.0'),
    description: String(o.description || ''),
    copyright: String(o.copyright || ''),
    author: String(o.author || ''),
    builtin: o.builtin === true,
    styles: styles.length
      ? styles
      : [
          {
            id: 'default',
            name: '默认',
            desc: '',
            swatch: ['#0f1115', '#1a2332', '#3d8bfd'],
            css: {}
          }
        ],
    defaultStyle,
    cssFiles: asStrList(o.cssFiles ?? o.css),
    loginCssFiles: asStrList(o.loginCssFiles ?? o.loginCss),
    layout: asLayout(o.layout),
    deviceView: asDeviceView(o.deviceView),
    loginLayout: asLoginLayout(o.loginLayout),
    siteMode: asSiteMode(o.siteMode),
    layoutJs: asStrList(o.layoutJs ?? o.layoutJS),
    templates: asTemplates(o.templates),
    parent: parentRaw && parentRaw !== identifier ? parentRaw : undefined,
    preview: typeof o.preview === 'string' ? o.preview : undefined
  }
}

export function resolveThemeStyle(
  pack: ThemePackManifest,
  styleId?: string
): ThemeStyleDef {
  const id = styleId || pack.defaultStyle
  return pack.styles.find((s) => s.id === id) || pack.styles[0]
}
