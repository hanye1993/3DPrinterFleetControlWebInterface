/**
 * Plugin Kernel v2 — shared types, hook catalog, semver.
 * Discuz-style microkernel contracts for host + plugins.
 */

import type { PluginModuleDef, PluginVarDef } from '../plugin'

export const KERNEL_VERSION = '2.2.0'

export type SemverRange = string
export type PluginApiVersion = '1' | '2'

export type PluginCapability =
  | 'log'
  | 'config.vars'
  | 'storage.json'
  | 'db.scoped'
  | 'http.route'
  | 'http.fetch'
  | 'http.callback'
  | 'settings.read'
  | 'settings.patch'
  | 'settings.publicUrl'
  | 'devices.read'
  | 'devices.control'
  | 'devices.files'
  | 'devices.print'
  | 'devices.capabilities'
  | 'devices.gcode'
  | 'devices.moonraker'
  | 'devices.lock'
  | 'camera.snapshot'
  | 'media.write'
  | 'users.read'
  | 'users.write'
  | 'users.pluginData'
  | 'auth.login'
  | 'plugins.call'
  | 'cache'
  | 'i18n'
  | 'hooks'
  | 'templates'
  | 'alert.dispatch'

/** Broad defaults for apiVersion 1 / missing capabilities */
export const LEGACY_CAPABILITIES: PluginCapability[] = [
  'log',
  'config.vars',
  'storage.json',
  'db.scoped',
  'http.route',
  'http.fetch',
  'http.callback',
  'settings.read',
  'settings.patch',
  'settings.publicUrl',
  'devices.read',
  'devices.control',
  'devices.files',
  'devices.print',
  'devices.capabilities',
  'devices.gcode',
  'devices.moonraker',
  'devices.lock',
  'camera.snapshot',
  'media.write',
  'users.read',
  'users.write',
  'users.pluginData',
  'auth.login',
  'plugins.call',
  'cache',
  'i18n',
  'hooks',
  'templates',
  'alert.dispatch'
]

export type PluginManifestV2 = {
  identifier: string
  name: string
  version: string
  apiVersion: PluginApiVersion
  description?: string
  copyright?: string
  available?: boolean
  requires?: {
    kernel?: SemverRange
    plugins?: Record<string, SemverRange>
  }
  conflicts?: string[]
  capabilities?: PluginCapability[]
  hooks?: string[]
  templates?: { overrides?: string[]; provides?: string[] }
  mainFile?: string
  clientJs?: string[]
  publicClientJs?: string[]
  themeCss?: string
  modules?: PluginModuleDef[]
  vars?: PluginVarDef[]
  installFile?: string
  uninstallFile?: string
  upgradeFile?: string
  /** Target SQL schema version; migrations/vN.sql applied up to this */
  dbSchemaVersion?: number
}

export type HookPriority = number

export type HookRuntime = {
  pluginId: string
  abort: (reason?: string) => void
  aborted: boolean
  reason?: string
  /** Host request / domain context (login payload, etc.) */
  hostCtx?: unknown
}

export type FilterHookFn<T = unknown> = (value: T, rt: HookRuntime) => T | Promise<T>
export type ActionHookFn = (payload: unknown, rt: HookRuntime) => void | Promise<void>

export type HookBus = {
  on(
    name: string,
    fn: FilterHookFn | ActionHookFn,
    opts?: { priority?: HookPriority; pluginId?: string }
  ): () => void
  off(name: string, fn: FilterHookFn | ActionHookFn): void
  clearPlugin(pluginId: string): void
  apply<T>(name: string, value: T, hostCtx?: unknown): Promise<T>
  applySync?<T>(name: string, value: T, hostCtx?: unknown): T
  emit(name: string, payload?: unknown, hostCtx?: unknown): Promise<void>
  list(name?: string): Array<{ name: string; pluginId: string; priority: number }>
  /** Optional debug / circuit-breaker stats (DefaultHookBus) */
  getStats?(): unknown
  resetStats?(): void
}

export type TemplateEngine = {
  register(pluginId: string, rootDir: string): void
  unregister(pluginId: string): void
  /** Clear all registrations (theme parent-chain rebuild). */
  reset?(): void
  has(name: string): boolean
  render(name: string, data?: Record<string, unknown>): Promise<string>
  resolveChain(name: string): string[]
  /** Recursive template names under templates/ + slots/ */
  listTemplateNames?(): string[]
  /** slot name → rendered HTML fragments (for SPA assets) */
  collectSlots(): Record<string, string[]>
  collectSlotsRendered?(data?: Record<string, unknown>): Promise<Record<string, string[]>>
}

export type PluginLogger = {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export type PluginContextHttp = {
  registerRoute: (
    method: string,
    pathPattern: string,
    handler: (req: unknown, api: unknown) => unknown | Promise<unknown>,
    opts?: { public?: boolean }
  ) => void
  fetch?: (
    input: string | URL,
    init?: RequestInit
  ) => Promise<Response>
}

export type CallbackRegisterOpts = {
  /** Absolute path or under /api/v1/plugins/{id}/… */
  path: string
  method?: string
  /** Var key holding shared secret (HMAC) */
  secretVar?: string
  /** Inline secret (prefer secretVar) */
  secret?: string
  /** Header carrying signature; default X-Hanye-Signature */
  signatureHeader?: string
  /** hmac-sha256 of raw body (hex) */
  verify?: 'hmac-sha256' | 'none'
  public?: boolean
  handler: (req: unknown, api: unknown) => unknown | Promise<unknown>
}

export type PluginContextUsers = {
  find: (query: { id?: string; username?: string }) => unknown | null
  create?: (input: {
    username: string
    password?: string
    displayName?: string
    level?: string
  }) => Promise<unknown>
  getPluginData?: (userId: string) => Record<string, unknown>
  patchPluginData?: (
    userId: string,
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; message?: string; pluginData?: Record<string, unknown> }>
}

export type PluginContextAuth = {
  issueLoginToken: (userId: string) => { token: string; user: unknown }
  createLoginGrant: (
    userId: string,
    opts?: { ttlSec?: number }
  ) => { grantToken: string; expiresAt: string; user: unknown }
}

export type PluginContext = {
  readonly pluginId: string
  readonly version: string
  readonly manifest: PluginManifestV2
  log: PluginLogger
  vars: {
    get: (key: string, fallback?: string) => string
    set: (key: string, value: string) => Promise<void>
    all: () => Record<string, string>
  }
  storage: {
    readJson: <T = unknown>(rel: string, fallback?: T) => T
    writeJson: (rel: string, data: unknown) => void
  }
  db?: {
    available: boolean
    [key: string]: unknown
  }
  http: PluginContextHttp
  callbacks?: {
    register: (opts: CallbackRegisterOpts) => void
    verifyHmac: (rawBody: string, signature: string, secret: string) => boolean
    signHmac: (rawBody: string, secret: string) => string
  }
  settings: {
    get: () => Record<string, unknown>
    patch?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>
    getPublicBaseUrl?: () => string
  }
  devices: {
    list: () => unknown[]
    statuses: () => Record<string, unknown>
    control?: (deviceId: string, payload: unknown) => Promise<{ ok: boolean; message?: string }>
    save?: (devices: unknown[]) => Promise<unknown[]>
    listFiles?: (
      deviceId: string
    ) => Promise<{ ok: boolean; message?: string; files?: Array<{ path: string; size: number; modified?: number }> }>
    uploadFile?: (
      deviceId: string,
      opts: { filename: string; contentBase64: string }
    ) => Promise<{ ok: boolean; message?: string; remotePath?: string }>
    downloadFile?: (
      deviceId: string,
      remotePath: string
    ) => Promise<{ ok: boolean; message?: string; filename?: string; contentBase64?: string }>
    startPrint?: (
      deviceId: string,
      opts: { filename: string; contentBase64?: string }
    ) => Promise<{ ok: boolean; message?: string; remotePath?: string }>
    getCapabilities?: (deviceId: string) => unknown
    sendGcode?: (deviceId: string, script: string) => Promise<{ ok: boolean; message?: string }>
    moonrakerRequest?: (
      deviceId: string,
      req: {
        method: string
        path: string
        query?: Record<string, string | number | boolean | null | undefined>
        body?: unknown
      }
    ) => Promise<{ ok: boolean; status?: number; data?: unknown; message?: string }>
    claim?: (
      deviceId: string,
      opts?: { ttlSec?: number; ownerLabel?: string; force?: boolean }
    ) => Promise<{ ok: boolean; message?: string; lock?: unknown }>
    release?: (
      deviceId: string,
      opts?: { force?: boolean }
    ) => Promise<{ ok: boolean; message?: string }>
    getLock?: (deviceId: string) => unknown | null
  }
  camera?: {
    snapshot: (opts: {
      deviceId?: string
      zoneId?: string
      cameraId?: string
      target?: string
    }) => Promise<{ ok: boolean; message?: string; contentType?: string; base64?: string }>
  }
  media?: {
    write: (
      rel: string,
      data: string | Uint8Array,
      opts?: { encoding?: 'base64' | 'utf8' | 'binary' }
    ) => { ok: boolean; path?: string; message?: string }
  }
  alert?: {
    dispatch: (payload: {
      kind?: string
      title: string
      content: string
      deviceId?: string
      deviceName?: string
    }) => Promise<unknown>
  }
  users?: PluginContextUsers
  auth?: PluginContextAuth
  plugins?: {
    call: (pluginId: string, method: string, args?: unknown) => Promise<unknown>
    list: () => Array<{
      id: string
      name: string
      version: string
      available: boolean
      modules: Array<{ name: string; type: string; menu?: string }>
    }>
    get: (pluginId: string) => {
      id: string
      name: string
      version: string
      available: boolean
      vars: Record<string, string>
    } | null
    registerMethod?: (name: string, fn: (args?: unknown) => unknown | Promise<unknown>) => void
  }
  notices?: {
    push: (input: {
      level?: 'info' | 'warn' | 'error' | 'success'
      title: string
      body?: string
      userId?: string
    }) => unknown
  }
  cache?: {
    get: <T = unknown>(key: string) => Promise<T | undefined>
    set: (key: string, value: unknown, ttlMs?: number) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  i18n?: {
    t: (key: string, fallback?: string) => string
    locale: () => string
  }
  hooks: Pick<HookBus, 'on' | 'apply' | 'emit'>
  templates: Pick<TemplateEngine, 'render' | 'has'>
  meta: { appVersion: string; kernelVersion: string }
}

export type PluginModuleV2 = {
  activate: (ctx: PluginContext) => void | Promise<void>
  deactivate?: (ctx: PluginContext) => void | Promise<void>
}

export type PluginLifecycleState =
  | 'discovered'
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'uninstalled'

export type LoadedPluginRecord = {
  id: string
  manifest: PluginManifestV2
  state: PluginLifecycleState
  directory: string
  context?: PluginContext
}

/** Host injects only what Kernel is allowed to re-expose */
export type HostCapabilities = {
  dataRoot: string
  appVersion: string
  getSettings: () => Record<string, unknown>
  patchSettings?: (patch: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>
  getDevices: () => unknown[]
  getStatuses: () => Record<string, unknown>
  controlDevice?: (
    deviceId: string,
    payload: unknown
  ) => Promise<{ ok: boolean; message?: string }>
  deviceOp?: (req: {
    deviceId: string
    op: 'listFiles' | 'uploadFile' | 'downloadFile'
    filename?: string
    contentBase64?: string
    remotePath?: string
  }) => Promise<{
    ok: boolean
    message?: string
    files?: Array<{ path: string; size: number; modified?: number }>
    filename?: string
    remotePath?: string
    contentBase64?: string
    contentType?: string
  }>
  startPrint?: (req: {
    deviceId: string
    filename: string
    contentBase64?: string
  }) => Promise<{ ok: boolean; message?: string; remotePath?: string }>
  getDeviceCapabilities?: (deviceId: string) => unknown
  sendGcode?: (deviceId: string, script: string) => Promise<{ ok: boolean; message?: string }>
  moonrakerRequest?: (
    deviceId: string,
    req: {
      method: string
      path: string
      query?: Record<string, string | number | boolean | null | undefined>
      body?: unknown
    }
  ) => Promise<{ ok: boolean; status?: number; data?: unknown; message?: string }>
  claimDevice?: (
    pluginId: string,
    deviceId: string,
    opts?: { ttlSec?: number; ownerLabel?: string; force?: boolean }
  ) => Promise<{ ok: boolean; message?: string; lock?: unknown }>
  releaseDevice?: (
    pluginId: string,
    deviceId: string,
    opts?: { force?: boolean }
  ) => Promise<{ ok: boolean; message?: string }>
  getDeviceLock?: (deviceId: string) => unknown | null
  snapshotCamera?: (opts: {
    deviceId?: string
    zoneId?: string
    cameraId?: string
    target?: string
  }) => Promise<{ ok: boolean; message?: string; contentType?: string; base64?: string }>
  getPublicBaseUrl?: () => string
  getUserPluginData?: (userId: string) => Record<string, unknown>
  patchUserPluginData?: (
    userId: string,
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; message?: string; pluginData?: Record<string, unknown> }>
  saveDevices?: (devices: unknown[]) => void | Promise<void>
  getDbApi?: (pluginId: string) => { available: boolean; [key: string]: unknown }
  registerHttpRoute: PluginContextHttp['registerRoute']
  appendLog?: (entry: Record<string, unknown>) => void
  readPluginJson?: (pluginId: string, rel: string, fallback?: unknown) => unknown
  writePluginJson?: (pluginId: string, rel: string, data: unknown) => void
  getPluginVars?: (pluginId: string) => Record<string, string>
  setPluginVar?: (pluginId: string, key: string, value: string) => Promise<void>
  dispatchAlert?: (payload: {
    kind?: string
    title: string
    content: string
    deviceId?: string
    deviceName?: string
  }) => Promise<unknown>
  findUser?: (query: { id?: string; username?: string }) => unknown | null
  createUser?: (input: {
    username: string
    password?: string
    displayName?: string
    level?: string
  }) => Promise<unknown>
  issueLoginToken?: (userId: string) => { token: string; user: unknown }
  createLoginGrant?: (
    userId: string,
    opts?: { ttlSec?: number }
  ) => { grantToken: string; expiresAt: string; user: unknown }
  callPlugin?: (fromId: string, targetId: string, method: string, args?: unknown) => Promise<unknown>
  listPlugins?: () => Array<{
    id: string
    name: string
    version: string
    available: boolean
    modules: Array<{ name: string; type: string; menu?: string }>
  }>
  getPluginInfo?: (pluginId: string) => {
    id: string
    name: string
    version: string
    available: boolean
    vars: Record<string, string>
  } | null
  registerPluginMethod?: (
    pluginId: string,
    name: string,
    fn: (args?: unknown) => unknown | Promise<unknown>
  ) => void
  pushNotice?: (input: {
    pluginId: string
    level?: 'info' | 'warn' | 'error' | 'success'
    title: string
    body?: string
    userId?: string
  }) => unknown
  cacheGet?: (pluginId: string, key: string) => Promise<unknown>
  cacheSet?: (pluginId: string, key: string, value: unknown, ttlMs?: number) => Promise<void>
  cacheDelete?: (pluginId: string, key: string) => Promise<void>
  i18nGet?: (pluginId: string, key: string, fallback?: string) => string
  i18nLocale?: () => string
  fetch?: typeof fetch
}

export type DependencyResolver = {
  checkEnable: (
    id: string,
    world: LoadedPluginRecord[]
  ) => { ok: true } | { ok: false; errors: string[] }
  sortForLoad: (enabled: LoadedPluginRecord[]) => LoadedPluginRecord[]
}

export type PluginLoader = {
  loadFromDisk: (dir: string) => Promise<PluginManifestV2>
  activate: (id: string) => Promise<void>
  deactivate: (id: string) => Promise<void>
}

export type ContextFactory = {
  create: (
    plugin: {
      id: string
      version: string
      manifest: PluginManifestV2
      vars: Record<string, string>
    },
    caps: HostCapabilities,
    hooks: HookBus,
    templates: TemplateEngine
  ) => PluginContext
}

export type PluginKernel = {
  readonly version: string
  hooks: HookBus
  templates: TemplateEngine
  list: () => LoadedPluginRecord[]
  installFromZip: (buf: Uint8Array) => Promise<LoadedPluginRecord>
  uninstall: (id: string) => Promise<void>
  enable: (id: string) => Promise<void>
  disable: (id: string) => Promise<void>
  getUiAssets: () => unknown
}

/** Formal v2 hook names (host should wire these). */
export const KERNEL_HOOKS = {
  pluginCommon: 'action:plugin.common',
  pluginLifecycle: 'action:plugin.lifecycle',
  apiBefore: 'filter:http.api.before',
  apiAfter: 'filter:http.api.after',
  callbackBefore: 'filter:http.callback.before',
  loginBefore: 'filter:auth.login.before',
  loginAfter: 'action:auth.login.after',
  loginGrantExchange: 'filter:auth.login.grant.exchange',
  logout: 'action:auth.logout',
  ssoBefore: 'filter:auth.sso.before',
  ssoAfter: 'action:auth.sso.after',
  sessionCreated: 'action:auth.session.created',
  sessionRevoked: 'action:auth.session.revoked',
  permissionsEffective: 'filter:auth.permissions.effective',
  permissionsCatalog: 'filter:auth.permissions.catalog',
  dbQueryBefore: 'filter:db.query.before',
  dbQueryAfter: 'action:db.query.after',
  uiNav: 'filter:ui.nav',
  uiTemplateFetch: 'filter:ui.template.fetch',
  uiRenderBefore: 'action:ui.render.before',
  uiRenderAfter: 'action:ui.render.after',
  deviceOnline: 'action:device.online',
  deviceOffline: 'action:device.offline',
  printStarted: 'action:print.started',
  printFinished: 'action:print.finished',
  printFailed: 'action:print.failed',
  alertFired: 'action:alert.fired',
  cacheGet: 'filter:cache.get',
  cacheSet: 'filter:cache.set',
  cacheDelete: 'filter:cache.delete'
} as const

/** Domain event aliases for emitDomainEvent helpers */
export const DOMAIN_EVENTS = {
  deviceOnline: KERNEL_HOOKS.deviceOnline,
  deviceOffline: KERNEL_HOOKS.deviceOffline,
  printStarted: KERNEL_HOOKS.printStarted,
  printFinished: KERNEL_HOOKS.printFinished,
  printFailed: KERNEL_HOOKS.printFailed,
  alertFired: KERNEL_HOOKS.alertFired,
  sessionCreated: KERNEL_HOOKS.sessionCreated,
  sessionRevoked: KERNEL_HOOKS.sessionRevoked,
  pluginLifecycle: KERNEL_HOOKS.pluginLifecycle
} as const

/** Legacy short name → formal v2 name */
export const LEGACY_HOOK_TO_V2: Record<string, string> = {
  common: KERNEL_HOOKS.pluginCommon,
  api_before: KERNEL_HOOKS.apiBefore,
  api_after: KERNEL_HOOKS.apiAfter,
  login_before: KERNEL_HOOKS.loginBefore,
  login_after: KERNEL_HOOKS.loginAfter,
  permissions_effective: KERNEL_HOOKS.permissionsEffective,
  permissions_catalog: KERNEL_HOOKS.permissionsCatalog,
  ui_nav: KERNEL_HOOKS.uiNav,
  ui_assets: 'filter:ui.assets',
  ui_slots: 'filter:ui.slots',
  theme_resolve: 'filter:ui.theme.resolve',
  auth_me: 'filter:auth.me',
  devices_list: 'filter:devices.list',
  devices_save: 'filter:devices.save',
  device_create: 'filter:device.create',
  device_update: 'filter:device.update',
  device_delete: 'filter:device.delete',
  statuses_publish: 'filter:statuses.publish',
  settings_get: 'filter:settings.get',
  settings_patch: 'filter:settings.patch',
  control_before: 'filter:control.before',
  control_after: 'filter:control.after',
  control_batch_before: 'filter:control.batch.before',
  control_batch_after: 'filter:control.batch.after',
  alert_notify: 'filter:alert.notify',
  users_list: 'filter:users.list',
  user_create: 'filter:user.create',
  user_update: 'filter:user.update',
  user_delete: 'filter:user.delete',
  filament_list: 'filter:filament.list',
  filament_create: 'filter:filament.create',
  filament_update: 'filter:filament.update',
  filament_delete: 'filter:filament.delete',
  quote_presets: 'filter:quote.presets',
  quote_calculate: 'filter:quote.calculate',
  quote_parse_gcode: 'filter:quote.parse_gcode',
  quote_history_list: 'filter:quote.history.list',
  quote_history_create: 'filter:quote.history.create',
  quote_history_delete: 'filter:quote.history.delete',
  quote_schemes_list: 'filter:quote.schemes.list',
  quote_schemes_save: 'filter:quote.schemes.save',
  quote_schemes_delete: 'filter:quote.schemes.delete',
  monitor_wall: 'filter:monitor.wall',
  monitor_zones_list: 'filter:monitor.zones.list',
  monitor_zone_create: 'filter:monitor.zone.create',
  monitor_zone_update: 'filter:monitor.zone.update',
  monitor_zone_delete: 'filter:monitor.zone.delete',
  monitor_camera_create: 'filter:monitor.camera.create',
  monitor_camera_update: 'filter:monitor.camera.update',
  monitor_camera_delete: 'filter:monitor.camera.delete',
  monitor_camera_snapshot: 'filter:monitor.camera.snapshot',
  print_request_list: 'filter:print.request.list',
  print_request_create: 'filter:print.request.create',
  print_approve: 'filter:print.approve',
  print_reject: 'filter:print.reject',
  print_start: 'filter:print.start',
  print_cancel: 'filter:print.cancel',
  print_batch_before: 'filter:print.batch.before',
  print_batch_after: 'filter:print.batch.after',
  files_list: 'filter:files.list',
  files_upload: 'filter:files.upload',
  files_download: 'filter:files.download',
  discover_lan_before: 'filter:discover.lan.before',
  discover_lan_after: 'filter:discover.lan.after',
  onboard_before: 'filter:onboard.before',
  onboard_after: 'filter:onboard.after',
  nav_config_save: 'filter:nav.config.save',
  theme_activate: 'filter:theme.activate',
  theme_install: 'filter:theme.install',
  logs_list: 'filter:logs.list',
  logs_append: 'filter:logs.append',
  webhook_outbound: 'filter:webhook.outbound',
  sso_before: KERNEL_HOOKS.ssoBefore,
  sso_after: KERNEL_HOOKS.ssoAfter,
  login_grant_exchange: KERNEL_HOOKS.loginGrantExchange,
  logout: KERNEL_HOOKS.logout,
  callback_before: KERNEL_HOOKS.callbackBefore,
  cache_get: KERNEL_HOOKS.cacheGet,
  cache_set: KERNEL_HOOKS.cacheSet,
  cache_delete: KERNEL_HOOKS.cacheDelete,
  ai_vision_before: 'filter:ai.vision.before',
  ai_vision_after: 'filter:ai.vision.after',
  ai_settings_get: 'filter:ai.settings.get'
}

/** Resolve canonical hook name for apply (legacy short → formal). */
export function resolveHookName(name: string): string {
  return LEGACY_HOOK_TO_V2[name] || name
}

export function parseCapabilities(raw: unknown, apiVersion: PluginApiVersion): PluginCapability[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return apiVersion === '1'
      ? [...LEGACY_CAPABILITIES]
      : ['log', 'config.vars', 'hooks', 'templates', 'http.route', 'storage.json']
  }
  const allowed = new Set<string>(LEGACY_CAPABILITIES)
  return raw.map(String).filter((c): c is PluginCapability => allowed.has(c))
}
