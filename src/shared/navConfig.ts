/**
 * Custom navigation config (labels, links, folders, HTML pages).
 */

export type NavItemType = 'builtin' | 'link' | 'page' | 'folder'

export type NavConfigItem = {
  id: string
  type: NavItemType
  /** Display name */
  label: string
  /**
   * builtin → AppSection key (fdm / resin / …)
   * plugin keys stay as plugin:id:module
   */
  target?: string
  /** type=link: http(s) or path */
  href?: string
  openInNewTab?: boolean
  /** type=page: HTML body for 单页 */
  html?: string
  /** Nested items (max depth 3) */
  children?: NavConfigItem[]
  /** Start collapsed (folder) */
  defaultCollapsed?: boolean
  /** Hide from nav */
  hidden?: boolean
}

export type NavConfig = {
  /** Use custom tree instead of built-in SideNav list */
  enabled: boolean
  /** Allow collapsing the sidebar rail */
  collapsible: boolean
  /** Remember collapsed state client-side; default start collapsed */
  startCollapsed: boolean
  items: NavConfigItem[]
}

export const BUILTIN_NAV_DEFAULTS: Array<{
  target: string
  label: string
  perm?: string
  serverOnly?: boolean
}> = [
  { target: 'fdm', label: 'FDM', perm: 'nav.devices' },
  { target: 'resin', label: '光固化', perm: 'nav.devices' },
  { target: 'filament', label: '耗材管理', perm: 'nav.filament' },
  { target: 'tools', label: '常用工具', perm: 'nav.tools' },
  { target: 'quoteHistory', label: '报价记录', perm: 'nav.tools', serverOnly: true },
  { target: 'monitorWall', label: '内部监控', perm: 'nav.monitor' },
  { target: 'monitorZones', label: '区域监控', perm: 'nav.monitor' },
  { target: 'models', label: '模型网站' },
  { target: 'aiModels', label: 'AI 建模网' },
  { target: 'users', label: '用户权限', perm: 'nav.users', serverOnly: true },
  { target: 'printApprove', label: '打印审核/队列', perm: 'nav.printApprove' },
  { target: 'settings', label: '软件设置', perm: 'nav.settings' }
]

export function defaultNavConfig(): NavConfig {
  return {
    enabled: false,
    collapsible: true,
    startCollapsed: false,
    items: BUILTIN_NAV_DEFAULTS.map((b, i) => ({
      id: `builtin_${b.target}`,
      type: 'builtin' as const,
      label: b.label,
      target: b.target,
      hidden: false
    }))
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createNavItem(
  partial: Partial<NavConfigItem> & { type: NavItemType; label: string }
): NavConfigItem {
  return {
    id: partial.id || newId(partial.type),
    type: partial.type,
    label: String(partial.label || '').trim() || '未命名',
    target: partial.target,
    href: partial.href,
    openInNewTab: partial.openInNewTab !== false,
    html: partial.html,
    children: Array.isArray(partial.children) ? partial.children.map((c) => normalizeNavItem(c)) : undefined,
    defaultCollapsed: partial.defaultCollapsed === true,
    hidden: partial.hidden === true
  }
}

export function normalizeNavItem(raw: unknown, depth = 1): NavConfigItem {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const type = (['builtin', 'link', 'page', 'folder'].includes(String(o.type))
    ? String(o.type)
    : 'link') as NavItemType
  const children =
    depth < 3 && Array.isArray(o.children)
      ? o.children.map((c) => normalizeNavItem(c, depth + 1))
      : undefined
  return {
    id: String(o.id || newId(type)),
    type,
    label: String(o.label || '').trim() || '未命名',
    target: o.target != null ? String(o.target) : undefined,
    href: o.href != null ? String(o.href) : undefined,
    openInNewTab: o.openInNewTab !== false,
    html: typeof o.html === 'string' ? o.html : undefined,
    children: children?.length ? children : undefined,
    defaultCollapsed: o.defaultCollapsed === true,
    hidden: o.hidden === true
  }
}

export function normalizeNavConfig(raw: unknown): NavConfig {
  const base = defaultNavConfig()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Record<string, unknown>
  const items = Array.isArray(o.items)
    ? o.items.map((x) => normalizeNavItem(x))
    : base.items
  return {
    enabled: o.enabled === true,
    collapsible: o.collapsible !== false,
    startCollapsed: o.startCollapsed === true,
    items
  }
}

/** Section key for custom HTML pages */
export function pageSectionKey(id: string): string {
  return `page:${id}`
}

export function isPageSection(section: string): boolean {
  return typeof section === 'string' && section.startsWith('page:')
}

export function pageIdFromSection(section: string): string {
  return section.slice('page:'.length)
}

export function findNavItemById(items: NavConfigItem[], id: string): NavConfigItem | null {
  for (const it of items) {
    if (it.id === id) return it
    if (it.children?.length) {
      const hit = findNavItemById(it.children, id)
      if (hit) return hit
    }
  }
  return null
}

export function findPageItem(items: NavConfigItem[], pageId: string): NavConfigItem | null {
  for (const it of items) {
    if (it.type === 'page' && it.id === pageId) return it
    if (it.children?.length) {
      const hit = findPageItem(it.children, pageId)
      if (hit) return hit
    }
  }
  return null
}
