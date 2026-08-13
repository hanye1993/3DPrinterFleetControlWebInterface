/**
 * Closed-loop UI extension point registry.
 * Every primary SPA section MUST declare page.replace (+ before/after).
 * Used by docs, SoftSettings debug, and optional CI scripts.
 */

export type ExtensionPoint = {
  /** Slot base name (without .replace) */
  slot: string
  /** App section key or special surface */
  section: string
  required: boolean
  kind: 'page' | 'shell' | 'login' | 'partial'
  note?: string
}

/** Primary routes that must support full page replace */
export const REQUIRED_PAGE_EXTENSION_POINTS: ExtensionPoint[] = [
  { slot: 'login.page', section: 'login', required: true, kind: 'login' },
  { slot: 'app.shell', section: 'shell', required: true, kind: 'shell' },
  { slot: 'app.nav', section: 'shell', required: true, kind: 'shell' },
  { slot: 'device.grid', section: 'fdm|resin', required: true, kind: 'page' },
  { slot: 'tools.page', section: 'tools', required: true, kind: 'page' },
  { slot: 'filament.page', section: 'filament', required: true, kind: 'page' },
  { slot: 'quote.history', section: 'quoteHistory', required: true, kind: 'page' },
  { slot: 'monitor.page', section: 'monitorWall', required: true, kind: 'page' },
  { slot: 'monitor.zones', section: 'monitorZones', required: true, kind: 'page' },
  { slot: 'models.page', section: 'models', required: true, kind: 'page' },
  { slot: 'aiModels.page', section: 'aiModels', required: true, kind: 'page' },
  { slot: 'users.page', section: 'users', required: true, kind: 'page' },
  { slot: 'print.approve', section: 'printApprove', required: true, kind: 'page' },
  { slot: 'settings.page', section: 'settings', required: true, kind: 'page' },
  { slot: 'sso.bind', section: 'ssoBind', required: true, kind: 'page' },
  { slot: 'plugin.host', section: 'plugin', required: true, kind: 'page' },
  { slot: 'custom.page', section: 'custom', required: true, kind: 'page' },
  { slot: 'app.footer', section: 'shell', required: true, kind: 'shell' }
]

/** High-value partials (drawer/modal/card) — dense hook surface for plugins */
export const PARTIAL_EXTENSION_POINTS: ExtensionPoint[] = [
  { slot: 'device.card', section: 'fdm|resin', required: true, kind: 'partial' },
  { slot: 'device.detail', section: 'fdm|resin', required: true, kind: 'partial' },
  { slot: 'device.batch.modal', section: 'fdm|resin', required: true, kind: 'partial' },
  { slot: 'device.filter', section: 'fdm|resin', required: true, kind: 'partial' },
  { slot: 'device.camera', section: 'fdm|resin', required: true, kind: 'partial' },
  { slot: 'logs.drawer', section: 'shell', required: true, kind: 'partial' },
  { slot: 'models.card', section: 'models', required: true, kind: 'partial' },
  { slot: 'aiModels.card', section: 'aiModels', required: true, kind: 'partial' }
]

export function extensionPointCatalog(): ExtensionPoint[] {
  return [...REQUIRED_PAGE_EXTENSION_POINTS, ...PARTIAL_EXTENSION_POINTS]
}

/** Names that App.tsx / Login / BindSso must host as <PluginSlot replace> */
export function requiredReplaceSlotNames(): string[] {
  return REQUIRED_PAGE_EXTENSION_POINTS.map((p) => p.slot)
}
