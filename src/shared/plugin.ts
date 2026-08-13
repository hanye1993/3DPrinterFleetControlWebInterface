/**
 * Plugin package model — hooks / modules / install / UI slots.
 *
 *   plugin.json
 *   main.js                 — server hooks (same-name functions)
 *   client.js               — browser SDK script (full UI power)
 *   login.js                — public script on login page
 *   theme.css
 *   slots/{slotId}.html     — HTML embedding points
 *   modules/{name}.js
 *   static/
 */

export type PluginModuleType = 'admin' | 'page' | 'api' | 'cron' | 'hook'

export type PluginModuleDef = {
  name: string
  menu: string
  type: PluginModuleType
  displayOrder: number
  url?: string
  adminOnly?: boolean
  /**
   * Optional permission code for this nav module.
   * Appears in 用户权限勾选；侧栏仅有该权限（或管理员）可见。
   */
  perm?: string
  /**
   * Cron module schedule. Examples: every:1m / every:5m / every:1h, or 5-field cron like star-slash-5 * * * *.
   */
  schedule?: string
  /** type=api: HTTP method or * (default *) */
  method?: string
  /** type=api: allow unauthenticated access */
  public?: boolean
}

/** Extra permission codes plugins contribute to the user admin UI */
export type PluginPermissionDef = {
  code: string
  label: string
  plugin?: string
  description?: string
}

export type PluginVarDef = {
  key: string
  title: string
  type: 'text' | 'number' | 'boolean' | 'textarea' | 'select'
  value: string
  description?: string
  options?: Array<{ label: string; value: string }>
}

export type PluginManifest = {
  identifier: string
  name: string
  version: string
  description: string
  copyright: string
  availableDefault: boolean
  modules: PluginModuleDef[]
  vars: PluginVarDef[]
  hooks: string[]
  installFile: string
  uninstallFile: string
  upgradeFile: string
  mainFile: string
  /** Authed SPA scripts (paths relative to plugin root) */
  clientJs: string[]
  /** Login-page scripts (no JWT) */
  publicClientJs: string[]
  themeCss: string
}

export type PluginRuntimeState = {
  identifier: string
  name: string
  version: string
  description: string
  copyright: string
  available: boolean
  installedAt: string
  updatedAt: string
  vars: Record<string, string>
  modules: PluginModuleDef[]
  hooks: string[]
  directory: string
  error?: string
  /** Kernel v2 */
  apiVersion?: '1' | '2'
  requires?: { kernel?: string; plugins?: Record<string, string> }
  conflicts?: string[]
  capabilities?: string[]
  /** Last applied SQL migration version (from migrations/manifest) */
  dbSchemaVersion?: number
  /** Last cron run timestamps by module name */
  cronLastRun?: Record<string, string>
  /**
   * Per-module enable map (Discuz-like module switch).
   * Missing key = enabled. `false` disables nav / cron / api / runModule for that module.
   * Whole-plugin `available` remains the master switch.
   */
  enabledModules?: Record<string, boolean>
}

export type PluginsStateFile = {
  installed: Record<string, PluginRuntimeState>
}

export const PLUGIN_HOOKS = [
  'common',
  'api_before',
  'api_after',
  'devices_list',
  'devices_save',
  'device_create',
  'device_update',
  'device_delete',
  'statuses_publish',
  'settings_get',
  'settings_patch',
  'control_before',
  'control_after',
  'alert_notify',
  'login_before',
  'login_after',
  'auth_me',
  'users_list',
  'user_create',
  'user_update',
  'user_delete',
  'ai_vision_before',
  'ai_vision_after',
  'ai_settings_get',
  'ui_nav',
  'ui_assets',
  'ui_slots',
  'permissions_effective',
  /** Contribute extra permission codes shown in 用户权限勾选 */
  'permissions_catalog',
  'theme_resolve',
  'filament_list',
  'filament_create',
  'filament_update',
  'filament_delete',
  'quote_presets',
  'quote_calculate',
  'quote_parse_gcode',
  'quote_history_list',
  'quote_history_create',
  'quote_history_delete',
  'quote_schemes_list',
  'quote_schemes_save',
  'quote_schemes_delete',
  'monitor_wall',
  'monitor_zones_list',
  'monitor_zone_create',
  'monitor_zone_update',
  'monitor_zone_delete',
  'monitor_camera_create',
  'monitor_camera_update',
  'monitor_camera_delete',
  'monitor_camera_snapshot',
  'print_request_list',
  'print_request_create',
  'print_approve',
  'print_reject',
  'print_start',
  'print_cancel',
  'control_batch_before',
  'control_batch_after',
  'print_batch_before',
  'print_batch_after',
  'files_list',
  'files_upload',
  'files_download',
  'discover_lan_before',
  'discover_lan_after',
  'onboard_before',
  'onboard_after',
  'nav_config_save',
  'theme_activate',
  'theme_install',
  'logs_list',
  'logs_append',
  'webhook_outbound',
  'sso_before',
  'sso_after',
  'login_grant_exchange',
  'logout',
  'cache_get',
  'cache_set',
  'cache_delete',
  'register'
] as const

export type PluginHookName = (typeof PLUGIN_HOOKS)[number] | string

/** UI embedding points (template hooks). `*.replace` can replace host UI. */
export const PLUGIN_UI_SLOTS = [
  'login.page.replace',
  'login.header',
  'login.form.replace',
  'login.form.before',
  'login.form.after',
  'login.sso.before',
  'login.sso.after',
  'login.footer',
  'app.shell.replace',
  'app.header.before',
  'app.header.after',
  'app.header.brand',
  'app.header.actions',
  'app.nav.before',
  'app.nav.after',
  'app.nav.replace',
  'app.main.before',
  'app.main.after',
  'app.footer.before',
  'app.footer.after',
  'app.footer.replace',
  'settings.page.before',
  'settings.page.after',
  'settings.page.replace',
  'settings.tabs.before',
  'settings.tabs.after',
  'settings.tab.ai.before',
  'settings.tab.ai.after',
  'settings.tab.ai.replace',
  'settings.tab.alerts.before',
  'settings.tab.alerts.after',
  'settings.tab.alerts.replace',
  'settings.tab.plugins.before',
  'settings.tab.plugins.after',
  'settings.tab.plugins.replace',
  'settings.tab.themes.before',
  'settings.tab.themes.after',
  'settings.tab.themes.replace',
  'settings.tab.general.before',
  'settings.tab.general.after',
  'settings.tab.general.replace',
  'settings.tab.enterprise.before',
  'settings.tab.enterprise.after',
  'settings.tab.enterprise.replace',
  'settings.tab.about.before',
  'settings.tab.about.after',
  'settings.tab.about.replace',
  'settings.tab.brand.before',
  'settings.tab.brand.after',
  'settings.tab.brand.replace',
  'settings.tab.nav.before',
  'settings.tab.nav.after',
  'settings.tab.nav.replace',
  'users.page.before',
  'users.page.after',
  'users.page.replace',
  'users.toolbar.before',
  'users.toolbar.after',
  'users.list.before',
  'users.list.after',
  'users.form.before',
  'users.form.fields',
  'users.form.footer',
  'users.form.after',
  'users.form.replace',
  'users.row.actions',
  'device.grid.before',
  'device.grid.after',
  'device.grid.replace',
  'device.batch.before',
  'device.batch.after',
  'device.batch.actions',
  'device.batch.status',
  'device.card.after-name',
  'device.card.temps',
  'device.card.extra',
  'device.card.footer',
  'device.add.before',
  'device.add.after',
  'device.add.replace',
  'device.add.scan.after',
  'device.add.brand.after',
  'device.add.form',
  'device.add.fields',
  'device.add.footer',
  'device.detail.before',
  'device.detail.after',
  'device.detail.replace',
  'device.detail.camera.after',
  'device.detail.control.before',
  'device.detail.footer',
  'filament.page.before',
  'filament.page.after',
  'filament.page.replace',
  'filament.toolbar.before',
  'filament.toolbar.after',
  'filament.filters.after',
  'filament.list.before',
  'filament.list.after',
  'filament.form.before',
  'filament.form.after',
  'filament.form.fields',
  'filament.form.footer',
  'filament.form.replace',
  'monitor.page.before',
  'monitor.page.after',
  'monitor.page.replace',
  'monitor.header.before',
  'monitor.header.after',
  'monitor.alerts.after',
  'monitor.grid.before',
  'monitor.grid.after',
  'monitor.tile.before',
  'monitor.tile.after',
  'monitor.tile.footer',
  'monitor.zones.before',
  'monitor.zones.after',
  'monitor.zones.replace',
  'monitor.zones.header.before',
  'monitor.zones.header.after',
  'monitor.zones.toolbar.after',
  'monitor.zones.grid.before',
  'monitor.zones.grid.after',
  'monitor.zones.form.camera.fields',
  'monitor.zones.form.camera.footer',
  'tools.page.before',
  'tools.page.after',
  'tools.page.replace',
  'tools.header.before',
  'tools.header.after',
  'tools.params.before',
  'tools.params.after',
  'tools.params.fields',
  'tools.gcode.after',
  'tools.options.before',
  'tools.options.after',
  'tools.option.extra',
  'tools.result.before',
  'tools.result.after',
  'tools.result.breakdown.after',
  'tools.actions.before',
  'tools.actions.after',
  'quote.history.before',
  'quote.history.after',
  'quote.history.replace',
  'quote.history.header.before',
  'quote.history.header.after',
  'quote.history.toolbar.before',
  'quote.history.toolbar.after',
  'quote.history.filters.after',
  'quote.history.list.before',
  'quote.history.list.after',
  'quote.history.detail.before',
  'quote.history.detail.after',
  'quote.history.detail.footer',
  'quote.history.detail.replace',
  'quote.history.detail.options.after',
  'print.approve.before',
  'print.approve.after',
  'print.approve',
  'print.approve.replace',
  'print.approve.toolbar.before',
  'print.approve.toolbar.after',
  'print.approve.filters.after',
  'print.approve.pending.before',
  'print.approve.pending.after',
  'print.approve.queued.before',
  'print.approve.queued.after',
  'print.approve.history.before',
  'print.approve.history.after',
  'print.approve.row.actions',
  'models.page.before',
  'models.page.after',
  'models.page.replace',
  'models.header.before',
  'models.header',
  'models.header.after',
  'models.groups.before',
  'models.groups.after',
  'models.group.before',
  'models.group.after',
  'models.group.grid.before',
  'models.group.grid.after',
  'models.card.before',
  'models.card',
  'models.card.replace',
  'models.card.actions',
  'models.card.after',
  'models.footer',
  'aiModels.page.before',
  'aiModels.page.after',
  'aiModels.page.replace',
  'aiModels.header.before',
  'aiModels.header',
  'aiModels.header.after',
  'aiModels.groups.before',
  'aiModels.groups.after',
  'aiModels.group.before',
  'aiModels.group.after',
  'aiModels.group.grid.before',
  'aiModels.group.grid.after',
  'aiModels.card.before',
  'aiModels.card',
  'aiModels.card.replace',
  'aiModels.card.actions',
  'aiModels.card.after',
  'aiModels.footer',
  'settings.content.replace',
  'settings.header.before',
  'settings.header.after',
  'settings.general.before',
  'settings.general.after',
  'settings.general.prefs.before',
  'settings.general.prefs.after',
  'settings.general.fields',
  'settings.general.theme.before',
  'settings.general.theme.after',
  'settings.general.bg.before',
  'settings.general.bg.after',
  'settings.general.data.before',
  'settings.general.data.after',
  'settings.brand.form.before',
  'settings.brand.form.after',
  'settings.brand.fields',
  'settings.brand.logo.after',
  'settings.brand.favicon.after',
  'settings.brand.actions',
  'settings.nav.switches.before',
  'settings.nav.switches.after',
  'settings.nav.tree.before',
  'settings.nav.tree.after',
  'settings.nav.tree.toolbar',
  'settings.nav.edit.before',
  'settings.nav.edit.fields',
  'settings.nav.edit.footer',
  'settings.nav.edit.after',
  'settings.enterprise.policy.after',
  'settings.enterprise.wecom.before',
  'settings.enterprise.wecom.after',
  'settings.enterprise.dingtalk.before',
  'settings.enterprise.dingtalk.after',
  'settings.enterprise.ad.before',
  'settings.enterprise.ad.after',
  'settings.enterprise.fields',
  'settings.enterprise.footer',
  'settings.ai.main.before',
  'settings.ai.main.after',
  'settings.ai.devices.after',
  'settings.ai.actions.after',
  'settings.ai.yolo.after',
  'settings.ai.cloud.after',
  'settings.ai.alerts.before',
  'settings.ai.alerts.after',
  'settings.ai.fields',
  'settings.alerts.main.before',
  'settings.alerts.main.after',
  'settings.alerts.wechat.before',
  'settings.alerts.wechat.after',
  'settings.alerts.sms.before',
  'settings.alerts.sms.after',
  'settings.alerts.webhook.before',
  'settings.alerts.webhook.after',
  'settings.alerts.toolbar',
  'settings.alerts.fields',
  'settings.themes.upload.after',
  'settings.themes.bundled.after',
  'settings.themes.list.before',
  'settings.themes.list.after',
  'settings.themes.row.actions',
  'settings.plugins.upload.after',
  'settings.plugins.installUrl.after',
  'settings.plugins.bundled.after',
  'settings.plugins.list.before',
  'settings.plugins.list.after',
  'settings.plugins.vars.before',
  'settings.plugins.vars.after',
  'settings.plugins.debug.before',
  'settings.plugins.debug.after',
  'settings.about.content.before',
  'settings.about.content.after',
  'settings.about.links.after',
  'settings.about.footer',
  'sso.bind.before',
  'sso.bind.after',
  'sso.bind.replace',
  'device.batch.modal.before',
  'device.batch.modal',
  'device.batch.modal.replace',
  'device.batch.modal.after',
  'device.batch.modal.alert.after',
  'device.batch.modal.devices.before',
  'device.batch.modal.devices.after',
  'device.batch.modal.upload.before',
  'device.batch.modal.upload.after',
  'device.batch.modal.progress.after',
  'device.batch.modal.footer.actions',
  'logs.drawer.before',
  'logs.drawer',
  'logs.drawer.replace',
  'logs.drawer.after',
  'logs.toolbar.before',
  'logs.toolbar.after',
  'logs.table.before',
  'logs.table.after',
  'app.nav.collapse.before',
  'app.nav.collapse.after',
  'app.nav.menu.before',
  'app.nav.menu.after',
  'app.nav.footer',
  'device.filter.before',
  'device.filter',
  'device.filter.replace',
  'device.filter.after',
  'device.filter.tags.after',
  'device.card.before',
  'device.card',
  'device.card.replace',
  'device.card.after',
  'device.card.head.before',
  'device.card.head.after',
  'device.card.progress.after',
  'device.card.meta.before',
  'device.card.meta.actions',
  'device.card.footer.before',
  'device.grid.toolbar.before',
  'device.grid.toolbar.after',
  'device.grid.statusFilters.after',
  'device.grid.pagination.after',
  'device.grid.empty.replace',
  'device.detail.header.extra',
  'device.detail.camera.before',
  'device.detail.ai.after',
  'device.detail.status.before',
  'device.detail.status.after',
  'device.detail.filament.before',
  'device.detail.filament.after',
  'device.detail.control',
  'device.detail.control.replace',
  'device.detail.control.after',
  'device.detail.temps.after',
  'device.detail.filament.load.before',
  'device.detail.filament.load.after',
  'device.detail.fans.after',
  'device.detail.queue.before',
  'device.detail.queue.after',
  'device.detail.files.before',
  'device.detail.files.after',
  'device.detail.files.toolbar',
  'device.detail.files.row.actions',
  'device.camera.before',
  'device.camera',
  'device.camera.replace',
  'device.camera.after',
  'device.camera.overlay',
  'plugin.host.before',
  'plugin.host',
  'plugin.host.replace',
  'plugin.host.after',
  'custom.page.before',
  'custom.page',
  'custom.page.replace',
  'custom.page.after',
  'custom.page.empty.replace',
  'tools.scheme.save.before',
  'tools.scheme.save.fields',
  'tools.scheme.save.footer',
  'tools.scheme.save.after',
  'tools.scheme.list.before',
  'tools.scheme.list.after',
  'tools.scheme.row.actions',
  'tools.params.replace',
  'tools.params.power.after',
  'tools.params.labor.after',
  'tools.options.replace',
  'tools.options.toolbar',
  'tools.result.replace',
  'tools.result.hero.after',
  'tools.result.compare.after',
  'filament.header.before',
  'filament.header',
  'filament.header.replace',
  'filament.header.after',
  'filament.filters.before',
  'filament.list.empty.replace',
  'filament.row.actions',
  'login.header.before',
  'login.header.replace',
  'login.header.after',
  'login.form.fields',
  'login.actions',
  'device.add.scan.before',
  'device.add.brand.before',
  'device.add.form.before',
  'device.add.form.after',
  'device.add.mode.after',
  'device.add.actions',
  'users.header.before',
  'users.header.after',
  'users.list.empty.replace',
  'users.form.sso.after',
  'users.form.perms.before',
  'users.form.perms.after',
  'users.form.deviceAcl.before',
  'users.form.deviceAcl.after',
  'monitor.toolbar.before',
  'monitor.toolbar.after',
  'monitor.alerts.before',
  'monitor.tile.replace',
  'monitor.empty.replace',
  'monitor.zones.form.before',
  'monitor.zones.form.after',
  'monitor.zones.empty.replace',
  'quote.history.empty.replace',
  'quote.history.detail.actions',
  'quote.history.row.actions',
  'print.approve.header.before',
  'print.approve.header.after',
  'print.approve.empty.replace',
  'print.approve.filters.before',
  'ai.page.before',
  'ai.page.after'
] as const

export type PluginUiSlotName = (typeof PLUGIN_UI_SLOTS)[number] | string

export type PluginUiNavItem = {
  key: string
  label: string
  identifier: string
  module?: string
  icon?: string
  order?: number
  hideKeys?: string[]
  /** When set, SideNav requires this permission (admins always see) */
  perm?: string
  adminOnly?: boolean
}

export type PluginUiAssets = {
  css?: string[]
  js?: string[]
  publicJs?: string[]
  publicCss?: string[]
  htmlHeader?: string
  htmlFooter?: string
  /** slotId → HTML fragments from slots/ + hooks */
  slots?: Record<string, string[]>
  theme?: Record<string, string>
  /** built-in nav keys to hide */
  hideNavKeys?: string[]
}

export function defaultPluginsState(): PluginsStateFile {
  return { installed: {} }
}

export function normalizePluginsState(raw: unknown): PluginsStateFile {
  const base = defaultPluginsState()
  if (!raw || typeof raw !== 'object') return base
  const o = raw as { installed?: Record<string, unknown> }
  if (!o.installed || typeof o.installed !== 'object') return base
  for (const [id, v] of Object.entries(o.installed)) {
    if (!v || typeof v !== 'object') continue
    const p = v as Record<string, unknown>
    base.installed[id] = {
      identifier: String(p.identifier || id),
      name: String(p.name || id),
      version: String(p.version || '0.0.0'),
      description: String(p.description || ''),
      copyright: String(p.copyright || ''),
      available: p.available !== false,
      installedAt: String(p.installedAt || new Date().toISOString()),
      updatedAt: String(p.updatedAt || new Date().toISOString()),
      vars:
        p.vars && typeof p.vars === 'object'
          ? Object.fromEntries(
              Object.entries(p.vars as Record<string, unknown>).map(([k, val]) => [k, String(val ?? '')])
            )
          : {},
      modules: Array.isArray(p.modules) ? (p.modules as PluginModuleDef[]) : [],
      hooks: Array.isArray(p.hooks) ? p.hooks.map(String) : [],
      directory: String(p.directory || id),
      error: typeof p.error === 'string' ? p.error : undefined,
      apiVersion: p.apiVersion === '2' || p.apiVersion === 2 ? '2' : p.apiVersion === '1' ? '1' : undefined,
      requires:
        p.requires && typeof p.requires === 'object'
          ? (p.requires as PluginRuntimeState['requires'])
          : undefined,
      conflicts: Array.isArray(p.conflicts) ? p.conflicts.map(String) : undefined,
      capabilities: Array.isArray(p.capabilities) ? p.capabilities.map(String) : undefined,
      dbSchemaVersion:
        typeof p.dbSchemaVersion === 'number' && Number.isFinite(p.dbSchemaVersion)
          ? Math.max(0, Math.floor(p.dbSchemaVersion))
          : undefined,
      cronLastRun:
        p.cronLastRun && typeof p.cronLastRun === 'object'
          ? Object.fromEntries(
              Object.entries(p.cronLastRun as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v || '')
              ])
            )
          : undefined,
      enabledModules:
        p.enabledModules && typeof p.enabledModules === 'object'
          ? Object.fromEntries(
              Object.entries(p.enabledModules as Record<string, unknown>).map(([k, v]) => [
                k,
                v !== false
              ])
            )
          : undefined
    }
  }
  return base
}

/** Module enabled unless explicitly set to false */
export function isPluginModuleEnabled(
  state: { enabledModules?: Record<string, boolean> } | null | undefined,
  moduleName: string
): boolean {
  if (!state?.enabledModules) return true
  return state.enabledModules[moduleName] !== false
}

function asModuleType(v: unknown): PluginModuleType {
  if (v === 'admin' || v === 'page' || v === 'api' || v === 'cron' || v === 'hook') return v
  return 'page'
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean)
  if (typeof v === 'string' && v.trim()) return [v.trim()]
  return []
}

/** Parse native plugin.json */
export function parsePluginJson(raw: unknown, fallbackId?: string): PluginManifest {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const modulesIn = Array.isArray(o.modules) ? o.modules : []
  const modules: PluginModuleDef[] = modulesIn.map((m) => {
    const row = m && typeof m === 'object' ? (m as Record<string, unknown>) : {}
    return {
      name: String(row.name || 'main'),
      menu: String(row.menu || row.name || '模块'),
      type: asModuleType(row.type),
      displayOrder: Number(row.displayOrder ?? row.order ?? 0) || 0,
      url: typeof row.url === 'string' ? row.url : undefined,
      adminOnly: row.adminOnly === true,
      perm: typeof row.perm === 'string' && row.perm.trim() ? row.perm.trim() : undefined,
      schedule: typeof row.schedule === 'string' && row.schedule.trim() ? row.schedule.trim() : undefined,
      method: typeof row.method === 'string' && row.method.trim() ? row.method.trim() : undefined,
      public: row.public === true
    }
  })
  const varsIn = Array.isArray(o.vars) ? o.vars : []
  const vars: PluginVarDef[] = varsIn
    .map((v): PluginVarDef | null => {
      const row = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
      const typeRaw = String(row.type || 'text')
      const type: PluginVarDef['type'] =
        typeRaw === 'number' || typeRaw === 'boolean' || typeRaw === 'textarea' || typeRaw === 'select'
          ? typeRaw
          : 'text'
      const key = String(row.key || '')
      if (!key) return null
      return {
        key,
        title: String(row.title || key),
        type,
        value: String(row.value ?? ''),
        description: typeof row.description === 'string' ? row.description : undefined,
        options: Array.isArray(row.options)
          ? (row.options as Array<{ label: string; value: string }>)
          : undefined
      }
    })
    .filter((v): v is PluginVarDef => v != null)

  return {
    identifier: String(o.identifier || fallbackId || 'unknown'),
    name: String(o.name || o.identifier || 'plugin'),
    version: String(o.version || '1.0.0'),
    description: String(o.description || ''),
    copyright: String(o.copyright || ''),
    availableDefault: o.available !== false && o.available !== 0 && o.available !== '0',
    modules,
    vars,
    hooks: Array.isArray(o.hooks) ? o.hooks.map(String) : [],
    installFile: String(o.installFile || 'install.js'),
    uninstallFile: String(o.uninstallFile || 'uninstall.js'),
    upgradeFile: String(o.upgradeFile || 'upgrade.js'),
    mainFile: String(o.mainFile || 'main.js'),
    clientJs: asStringList(o.clientJs ?? o.client),
    publicClientJs: asStringList(o.publicClientJs ?? o.loginJs),
    themeCss: String(o.themeCss || '')
  }
}
