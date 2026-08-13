import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  copyFileSync
} from 'fs'
import { createHash, randomBytes } from 'crypto'
import { join, resolve, basename, dirname } from 'path'
import { createRequire } from 'module'
import { unzipSync } from 'fflate'
import {
  type PluginHookName,
  type PluginManifest,
  type PluginModuleDef,
  type PluginRuntimeState,
  type PluginUiAssets,
  type PluginUiNavItem,
  type PluginPermissionDef,
  type PluginsStateFile,
  normalizePluginsState,
  parsePluginJson
} from '../../shared/plugin'
import type { AuthUserPublic, AuthUserRecord, UserLevel } from '../../shared/permissions'
import { signJwt } from '../auth/jwt'
import {
  createDisabledExtensionDbApi,
  type ExtensionDbApi
} from './extensionDb'
import {
  DefaultHookBus,
  DefaultTemplateEngine,
  DefaultContextFactory,
  DependencyResolver,
  registerLegacyHooks,
  hookApplyNames,
  isV2Module,
  KERNEL_VERSION,
  CronScheduler,
  applyPluginSqlMigrations,
  applyPluginInstallSql,
  applyPluginUninstallSql
} from './kernel'
import { UserGroupStore, type UserGroup, type PermissionPack } from './permissionPacks'
import {
  extensionPointCatalog,
  toManifestV2,
  type HostCapabilities,
  type LoadedPluginRecord,
  KERNEL_HOOKS
} from '../../shared/pluginKernel'
import { groupAllowsModule } from '../../shared/permissions'
import { isPluginModuleEnabled } from '../../shared/plugin'
import { PluginNoticeStore } from './notices'

export type PluginUserStoreLike = {
  getById(id: string): AuthUserRecord | undefined
  getByUsername(username: string): AuthUserRecord | undefined
  getJwtSecret(): string
  create(input: {
    username: string
    password: string
    displayName?: string
    level: UserLevel
  }): AuthUserPublic | Promise<AuthUserPublic>
  update?(
    id: string,
    patch: Partial<{ pluginData: Record<string, unknown> }> & Record<string, unknown>
  ): AuthUserPublic | Promise<AuthUserPublic>
}

export type PluginHostDeps = {
  dataRoot: string
  /** Optional bundled sample plugins directory (repo ./plugins) */
  bundledPluginsDir?: string
  /** Optional examples root (repo ./assets/examples) — scanned for plugin-* */
  examplePluginsDir?: string
  /** When set (MySQL mode), plugins-state.json is not used */
  statePersistence?: {
    load: () => unknown | null
    save: (data: unknown) => void
  }
  /** When set (MySQL mode), api.readJson/writeJson use plugin_data table */
  pluginDataPersistence?: {
    readJson: (pluginId: string, rel: string, fallback?: unknown) => unknown
    writeJson: (pluginId: string, rel: string, data: unknown) => void
  }
  /** Build scoped MySQL API for this plugin (Node USE_MYSQL=1) */
  getDbApi?: (identifier: string) => ExtensionDbApi
  getSettings: () => Record<string, unknown>
  patchSettings: (patch: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>
  getDevices: () => unknown[]
  saveDevices: (devices: unknown[]) => void
  getStatuses: () => Record<string, unknown>
  controlDevice: (
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
  snapshotCamera?: (opts: {
    deviceId?: string
    zoneId?: string
    cameraId?: string
    target?: string
  }) => Promise<{ ok: boolean; message?: string; contentType?: string; base64?: string }>
  getPublicBaseUrl?: () => string
  deviceLocks?: import('./deviceLocks').DeviceLockStore
  dispatchAlert?: (payload: {
    kind: string
    title: string
    content: string
    deviceId?: string
    deviceName?: string
  }) => Promise<unknown>
  appendLog?: (entry: Record<string, unknown>) => void
  version?: string
  /** Optional user store for login / SSO-style plugins */
  getUserStore?: () => PluginUserStoreLike | null
  touchPresence?: (user: { id: string; username: string; displayName?: string }) => void
}

export type PluginRouteOptions = {
  /** When true, route is reachable without JWT (OAuth callback / login start) */
  public?: boolean
}

/** Special handler return to bypass `{ ok, data }` JSON wrapping */
export type PluginHttpResponse = {
  __pluginHttp: {
    status?: number
    headers?: Record<string, string>
    body?: string
    json?: unknown
  }
}

export type PluginRequestCtx = {
  method: string
  path: string
  url: URL
  query: Record<string, string>
  headers: Record<string, string | string[] | undefined>
  auth: unknown
  body?: unknown
}

export type PluginApi = {
  identifier: string
  version: string
  vars: Record<string, string>
  /** Plugin data directory (writable) */
  dataDir: string
  /** Plugin package directory (read mostly) */
  pluginDir: string
  log: (...args: unknown[]) => void
  getVar: (key: string, fallback?: string) => string
  setVar: (key: string, value: string) => void
  readJson: (rel: string, fallback?: unknown) => unknown
  writeJson: (rel: string, data: unknown) => void
  getSettings: () => Record<string, unknown>
  patchSettings: (patch: Record<string, unknown>) => Promise<{ ok: boolean; message?: string }>
  getDevices: () => unknown[]
  saveDevices: (devices: unknown[]) => void
  getStatuses: () => Record<string, unknown>
  controlDevice: (
    deviceId: string,
    payload: unknown
  ) => Promise<{ ok: boolean; message?: string }>
  listFiles: (
    deviceId: string
  ) => Promise<{
    ok: boolean
    message?: string
    files?: Array<{ path: string; size: number; modified?: number }>
  }>
  uploadFile: (
    deviceId: string,
    opts: { filename: string; contentBase64: string }
  ) => Promise<{ ok: boolean; message?: string; remotePath?: string }>
  downloadFile: (
    deviceId: string,
    remotePath: string
  ) => Promise<{ ok: boolean; message?: string; filename?: string; contentBase64?: string }>
  startPrint: (
    deviceId: string,
    opts: { filename: string; contentBase64?: string }
  ) => Promise<{ ok: boolean; message?: string; remotePath?: string }>
  getDeviceCapabilities: (deviceId: string) => unknown
  sendGcode: (deviceId: string, script: string) => Promise<{ ok: boolean; message?: string }>
  moonrakerRequest: (
    deviceId: string,
    req: {
      method: string
      path: string
      query?: Record<string, string | number | boolean | null | undefined>
      body?: unknown
    }
  ) => Promise<{ ok: boolean; status?: number; data?: unknown; message?: string }>
  claimDevice: (
    deviceId: string,
    opts?: { ttlSec?: number; ownerLabel?: string; force?: boolean }
  ) => Promise<{ ok: boolean; message?: string; lock?: unknown }>
  releaseDevice: (
    deviceId: string,
    opts?: { force?: boolean }
  ) => Promise<{ ok: boolean; message?: string }>
  getDeviceLock: (deviceId: string) => unknown | null
  snapshotCamera: (opts: {
    deviceId?: string
    zoneId?: string
    cameraId?: string
    target?: string
  }) => Promise<{ ok: boolean; message?: string; contentType?: string; base64?: string }>
  writeMedia: (
    rel: string,
    data: string | Uint8Array,
    opts?: { encoding?: 'base64' | 'utf8' | 'binary' }
  ) => { ok: boolean; path?: string; message?: string }
  getPublicBaseUrl: () => string
  getUserPluginData: (userId: string) => Record<string, unknown>
  patchUserPluginData: (
    userId: string,
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; message?: string; pluginData?: Record<string, unknown> }>
  notify: (payload: {
    kind?: string
    title: string
    content: string
    deviceId?: string
    deviceName?: string
  }) => Promise<unknown>
  fetch: typeof fetch
  /** Register extra HTTP route under /api/v1/plugins/{id}/… or absolute path */
  registerRoute: (
    method: string,
    pathPattern: string,
    handler: (req: PluginRequestCtx, api: PluginApi) => Promise<unknown> | unknown,
    opts?: PluginRouteOptions
  ) => void
  /** Find public user by id / username */
  findUser: (query: { id?: string; username?: string }) => AuthUserPublic | null
  /** Issue JWT for an existing user (for SSO plugins) */
  issueLoginToken: (userId: string) => { token: string; user: AuthUserPublic }
  /**
   * Create a one-time host login grant for public/login-page plugins.
   * Browser then exchanges it at /api/v1/auth/plugin-login/exchange for a normal JWT session.
   */
  createLoginGrant: (
    userId: string,
    opts?: { ttlSec?: number }
  ) => { grantToken: string; expiresAt: string; user: AuthUserPublic }
  /** Create local user (password optional → random) */
  createUser: (input: {
    username: string
    password?: string
    displayName?: string
    level?: UserLevel
  }) => Promise<AuthUserPublic>
  /**
   * MySQL access (USE_MYSQL=1). Create own tables via ensureTable; prefix plugin_{id}_.
   * Unavailable when file-storage mode — check api.db.available.
   */
  db: ExtensionDbApi
}

type CustomRoute = {
  identifier: string
  method: string
  pattern: string
  public: boolean
  handler: (req: PluginRequestCtx, api: PluginApi) => Promise<unknown> | unknown
}

type HookFn = (api: PluginApi, value: unknown, ctx?: unknown) => unknown | Promise<unknown>

type LoginGrant = {
  pluginId: string
  userId: string
  expiresAt: number
}

type LoadedPlugin = {
  state: PluginRuntimeState
  manifest: PluginManifest
  api: PluginApi
  hooks: Record<string, HookFn>
  moduleHandlers: Record<
    string,
    (api: PluginApi, ctx: PluginRequestCtx) => Promise<unknown> | unknown
  >
  /** Kernel v2 context when activated via activate(ctx) */
  kernelCtx?: import('../../shared/pluginKernel').PluginContext
}

function safeId(id: string): string {
  const s = String(id || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
  if (!s || s === '_' || s.includes('..')) throw new Error('非法插件 identifier')
  return s
}

function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true })
}

export class PluginManager {
  private readonly deps: PluginHostDeps
  private state: PluginsStateFile = { installed: {} }
  private loaded = new Map<string, LoadedPlugin>()
  private customRoutes: CustomRoute[] = []
  private loginGrants = new Map<string, LoginGrant>()
  private readonly require = createRequire(__filename)
  /** Kernel v2 */
  readonly hookBus = new DefaultHookBus()
  readonly templates = new DefaultTemplateEngine()
  private readonly contextFactory = new DefaultContextFactory()
  private readonly depResolver = new DependencyResolver()
  readonly kernelVersion = KERNEL_VERSION
  private readonly cron = new CronScheduler({
    getLastRun: (pluginId, module) => this.state.installed[pluginId]?.cronLastRun?.[module],
    onPersist: (pluginId, module, at) => {
      const st = this.state.installed[pluginId]
      if (!st) return
      st.cronLastRun = { ...(st.cronLastRun || {}), [module]: at }
      this.saveState()
    }
  })
  private readonly memCache = new Map<string, { value: unknown; expiresAt?: number }>()
  private readonly i18nMaps = new Map<string, Record<string, string>>()
  private readonly exportedMethods = new Map<string, Map<string, (args?: unknown) => unknown | Promise<unknown>>>()
  private noticeStore: PluginNoticeStore | null = null
  private userGroups: UserGroupStore | null = null
  private readyPromise: Promise<void> = Promise.resolve()

  constructor(deps: PluginHostDeps) {
    this.deps = deps
  }

  getNoticeStore(): PluginNoticeStore {
    if (!this.noticeStore) this.noticeStore = new PluginNoticeStore(this.deps.dataRoot)
    return this.noticeStore
  }

  getUserGroupStore(): UserGroupStore {
    if (!this.userGroups) this.userGroups = new UserGroupStore(this.deps.dataRoot)
    return this.userGroups
  }

  /** @deprecated use getUserGroupStore */
  getPermissionPackStore(): UserGroupStore {
    return this.getUserGroupStore()
  }

  /** Wait until last reload/activate finished */
  whenReady(): Promise<void> {
    return this.readyPromise
  }

  get pluginsRoot(): string {
    return join(this.deps.dataRoot, 'plugins')
  }

  get statePath(): string {
    return join(this.deps.dataRoot, 'plugins-state.json')
  }

  init(): void {
    ensureDir(this.pluginsRoot)
    ensureDir(join(this.deps.dataRoot, 'plugin-data'))
    this.noticeStore = new PluginNoticeStore(this.deps.dataRoot)
    this.userGroups = new UserGroupStore(this.deps.dataRoot)
    this.loadState()
    this.readyPromise = this.reloadAll().then(() => {
      this.cron.start(30_000)
    })
  }

  /** Kernel debug snapshot for SoftSettings / ops */
  getKernelDebug(): {
    kernelVersion: string
    hooks: Array<{ name: string; pluginId: string; priority: number }>
    hookStats: unknown
    cron: ReturnType<CronScheduler['listStatus']>
    extensionPoints: ReturnType<typeof extensionPointCatalog>
    plugins: Array<{ identifier: string; available: boolean; error?: string; apiVersion?: string }>
  } {
    return {
      kernelVersion: this.kernelVersion,
      hooks: this.hookBus.list(),
      hookStats: this.hookBus.getStats?.() ?? null,
      cron: this.cron.listStatus(),
      extensionPoints: extensionPointCatalog(),
      plugins: this.list().map((p) => ({
        identifier: p.identifier,
        available: p.available,
        error: p.error,
        apiVersion: p.apiVersion
      }))
    }
  }

  resetHookStats(): void {
    this.hookBus.resetStats?.()
  }

  private readonly domainPrev = new Map<string, Record<string, unknown>>()

  /** Emit a domain / lifecycle event to all plugins */
  async emitDomainEvent(name: string, payload?: unknown): Promise<void> {
    await this.hookBus.emit(name, payload)
  }

  async emitDomainEventsFromStatuses(statuses: Record<string, unknown>): Promise<void> {
    const { detectDomainEvents } = await import('./kernel/domainEvents')
    const brandById: Record<string, string> = {}
    for (const d of this.deps.getDevices() as Array<{ id?: string; brand?: string }>) {
      if (d?.id) brandById[String(d.id)] = String(d.brand || '')
    }
    const events = detectDomainEvents(this.domainPrev, statuses, brandById)
    for (const ev of events) {
      await this.emitDomainEvent(ev.name, ev.payload)
    }
  }

  list(): PluginRuntimeState[] {
    return Object.values(this.state.installed).sort((a, b) => a.identifier.localeCompare(b.identifier))
  }

  get(identifier: string): PluginRuntimeState | null {
    return this.state.installed[identifier] || null
  }

  private loadState(): void {
    try {
      if (this.deps.statePersistence) {
        const raw = this.deps.statePersistence.load()
        if (raw != null) {
          this.state = normalizePluginsState(raw)
          return
        }
        this.state = { installed: {} }
        this.saveState()
        return
      }
      if (!existsSync(this.statePath)) {
        this.state = { installed: {} }
        this.saveState()
        return
      }
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8'))
      this.state = normalizePluginsState(raw)
    } catch {
      this.state = { installed: {} }
    }
  }

  private saveState(): void {
    if (this.deps.statePersistence) {
      this.deps.statePersistence.save(this.state)
      return
    }
    ensureDir(dirname(this.statePath))
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
  }

  private pluginDir(identifier: string): string {
    return join(this.pluginsRoot, identifier)
  }

  private pluginDataDir(identifier: string): string {
    return join(this.deps.dataRoot, 'plugin-data', identifier)
  }

  private pruneLoginGrants(): void {
    const now = Date.now()
    for (const [token, grant] of Array.from(this.loginGrants.entries())) {
      if (grant.expiresAt <= now) this.loginGrants.delete(token)
    }
  }

  createLoginGrant(
    pluginId: string,
    userId: string,
    opts?: { ttlSec?: number }
  ): { grantToken: string; expiresAt: string } {
    this.pruneLoginGrants()
    const ttlSec = Math.max(15, Math.min(600, Math.round(Number(opts?.ttlSec) || 120)))
    const grantToken = randomBytes(24).toString('hex')
    const expiresAt = Date.now() + ttlSec * 1000
    this.loginGrants.set(grantToken, { pluginId, userId, expiresAt })
    return { grantToken, expiresAt: new Date(expiresAt).toISOString() }
  }

  consumeLoginGrant(grantToken: string): { pluginId: string; userId: string } | null {
    this.pruneLoginGrants()
    const token = String(grantToken || '').trim()
    if (!token) return null
    const hit = this.loginGrants.get(token)
    if (!hit) return null
    this.loginGrants.delete(token)
    if (hit.expiresAt <= Date.now()) return null
    return { pluginId: hit.pluginId, userId: hit.userId }
  }

  readManifest(dir: string, fallbackId?: string): PluginManifest {
    const jsonPath = join(dir, 'plugin.json')
    if (!existsSync(jsonPath)) {
      throw new Error('未找到 plugin.json（插件包根目录须含 plugin.json）')
    }
    return parsePluginJson(JSON.parse(readFileSync(jsonPath, 'utf8')), fallbackId || basename(dir))
  }

  private buildApi(identifier: string, vars: Record<string, string>): PluginApi {
    const pluginDir = this.pluginDir(identifier)
    const dataDir = this.pluginDataDir(identifier)
    ensureDir(dataDir)
    const self = this
    const api: PluginApi = {
      identifier,
      version: this.state.installed[identifier]?.version || '0.0.0',
      vars,
      dataDir,
      pluginDir,
      log: (...args) => {
        console.log(`[plugin:${identifier}]`, ...args)
        this.deps.appendLog?.({
          type: 'plugin',
          plugin: identifier,
          message: args.map(String).join(' '),
          at: new Date().toISOString()
        })
      },
      getVar: (key, fallback = '') => (vars[key] != null ? String(vars[key]) : fallback),
      setVar: (key, value) => {
        vars[key] = String(value)
        const st = self.state.installed[identifier]
        if (st) {
          st.vars = { ...vars }
          st.updatedAt = new Date().toISOString()
          self.saveState()
        }
      },
      readJson: (rel, fallback = null) => {
        if (self.deps.pluginDataPersistence) {
          return self.deps.pluginDataPersistence.readJson(identifier, rel, fallback)
        }
        const p = resolve(dataDir, rel)
        if (!p.startsWith(resolve(dataDir))) throw new Error('path escape')
        if (!existsSync(p)) return fallback
        try {
          return JSON.parse(readFileSync(p, 'utf8'))
        } catch {
          return fallback
        }
      },
      writeJson: (rel, data) => {
        if (self.deps.pluginDataPersistence) {
          self.deps.pluginDataPersistence.writeJson(identifier, rel, data)
          return
        }
        const p = resolve(dataDir, rel)
        if (!p.startsWith(resolve(dataDir))) throw new Error('path escape')
        ensureDir(dirname(p))
        writeFileSync(p, JSON.stringify(data, null, 2), 'utf8')
      },
      getSettings: () => this.deps.getSettings(),
      patchSettings: (patch) => this.deps.patchSettings(patch),
      getDevices: () => this.deps.getDevices(),
      saveDevices: (devices) => {
        const next = self.runHookSync('devices_save', devices) as unknown[]
        this.deps.saveDevices(Array.isArray(next) ? next : devices)
      },
      getStatuses: () => this.deps.getStatuses(),
      controlDevice: (deviceId, payload) => this.deps.controlDevice(deviceId, payload),
      listFiles: async (deviceId) => {
        if (!self.deps.deviceOp) return { ok: false, message: 'files 不可用' }
        return self.deps.deviceOp({ deviceId, op: 'listFiles' })
      },
      uploadFile: async (deviceId, opts) => {
        if (!self.deps.deviceOp) return { ok: false, message: 'files 不可用' }
        return self.deps.deviceOp({
          deviceId,
          op: 'uploadFile',
          filename: opts.filename,
          contentBase64: opts.contentBase64
        })
      },
      downloadFile: async (deviceId, remotePath) => {
        if (!self.deps.deviceOp) return { ok: false, message: 'files 不可用' }
        return self.deps.deviceOp({ deviceId, op: 'downloadFile', remotePath })
      },
      startPrint: async (deviceId, opts) => {
        if (!self.deps.startPrint) return { ok: false, message: 'print 不可用' }
        return self.deps.startPrint({
          deviceId,
          filename: opts.filename,
          contentBase64: opts.contentBase64
        })
      },
      getDeviceCapabilities: (deviceId) => self.deps.getDeviceCapabilities?.(deviceId) ?? null,
      sendGcode: async (deviceId, script) => {
        if (!self.deps.sendGcode) return { ok: false, message: 'gcode 不可用' }
        return self.deps.sendGcode(deviceId, script)
      },
      moonrakerRequest: async (deviceId, req) => {
        if (!self.deps.moonrakerRequest) {
          return { ok: false, message: 'moonraker 透传不可用' }
        }
        return self.deps.moonrakerRequest(deviceId, req)
      },
      claimDevice: async (deviceId, opts) => {
        const store = self.deps.deviceLocks
        if (!store) return { ok: false, message: 'lock 不可用' }
        return store.claim(deviceId, identifier, opts)
      },
      releaseDevice: async (deviceId, opts) => {
        const store = self.deps.deviceLocks
        if (!store) return { ok: false, message: 'lock 不可用' }
        return store.release(deviceId, identifier, opts)
      },
      getDeviceLock: (deviceId) => self.deps.deviceLocks?.get(deviceId) ?? null,
      snapshotCamera: async (opts) => {
        if (!self.deps.snapshotCamera) return { ok: false, message: 'camera.snapshot 不可用' }
        return self.deps.snapshotCamera(opts)
      },
      writeMedia: (rel, data, opts) => {
        const mediaRoot = resolve(dataDir, 'media')
        try {
          const safe = String(rel || '').replace(/^\/+/, '')
          if (!safe || safe.includes('..')) return { ok: false, message: '非法路径' }
          const full = resolve(mediaRoot, safe)
          if (!full.startsWith(resolve(mediaRoot))) return { ok: false, message: 'path escape' }
          ensureDir(dirname(full))
          const enc = opts?.encoding || (typeof data === 'string' ? 'base64' : 'binary')
          if (typeof data === 'string') {
            if (enc === 'base64') writeFileSync(full, Buffer.from(data, 'base64'))
            else writeFileSync(full, data, 'utf8')
          } else {
            writeFileSync(full, Buffer.from(data))
          }
          return { ok: true, path: full }
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) }
        }
      },
      getPublicBaseUrl: () => {
        if (self.deps.getPublicBaseUrl) return self.deps.getPublicBaseUrl()
        const s = self.deps.getSettings() as Record<string, unknown>
        const explicit = String(s.publicBaseUrl || '').trim()
        if (explicit) return explicit.replace(/\/$/, '')
        const domain = String(s.domain || '').trim()
        if (domain) {
          return (/^https?:\/\//i.test(domain) ? domain : `https://${domain}`).replace(/\/$/, '')
        }
        const ip = String(s.publicIp || '').trim()
        const port = Number(s.apiPort) || 17890
        return ip ? `http://${ip}:${port}` : ''
      },
      getUserPluginData: (userId) => {
        const store = self.deps.getUserStore?.()
        if (!store) return {}
        const u = store.getById(userId)
        const pd = u && (u as { pluginData?: Record<string, unknown> }).pluginData
        return pd && typeof pd === 'object' ? { ...pd } : {}
      },
      patchUserPluginData: async (userId, patch) => {
        const store = self.deps.getUserStore?.()
        if (!store) return { ok: false, message: '用户系统未配置' }
        if (!store.update) return { ok: false, message: '用户更新不可用' }
        try {
          const u = store.getById(userId)
          if (!u) return { ok: false, message: '用户不存在' }
          const prev =
            u.pluginData && typeof u.pluginData === 'object' && !Array.isArray(u.pluginData)
              ? { ...u.pluginData }
              : {}
          const next = { ...prev, ...patch }
          await Promise.resolve(store.update(userId, { pluginData: next }))
          return { ok: true, pluginData: next }
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) }
        }
      },
      notify: async (payload) => {
        if (!this.deps.dispatchAlert) return { ok: false, message: 'notify 未配置' }
        return this.deps.dispatchAlert({
          kind: payload.kind || 'printerError',
          title: payload.title,
          content: payload.content,
          deviceId: payload.deviceId,
          deviceName: payload.deviceName
        })
      },
      fetch,
      registerRoute: (method, pathPattern, handler, opts) => {
        self.customRoutes.push({
          identifier,
          method: method.toUpperCase(),
          pattern: pathPattern,
          public: Boolean(opts?.public),
          handler
        })
      },
      findUser: (query) => {
        const store = self.deps.getUserStore?.()
        if (!store) return null
        if (query.id) {
          const u = store.getById(query.id)
          if (!u) return null
          const { passwordHash: _h, passwordSalt: _s, ...pub } = u
          return pub
        }
        if (query.username) {
          const u = store.getByUsername(query.username)
          if (!u) return null
          const { passwordHash: _h, passwordSalt: _s, ...pub } = u
          return pub
        }
        return null
      },
      issueLoginToken: (userId) => {
        const store = self.deps.getUserStore?.()
        if (!store) throw new Error('用户系统未配置')
        const u = store.getById(userId)
        if (!u) throw new Error('用户不存在')
        if (!u.enabled) {
          throw new Error(
            u.banReason ? `账号已被封禁：${u.banReason}` : '账号已被封禁，请联系管理员解封'
          )
        }
        const { passwordHash: _h, passwordSalt: _s, ...pub } = u
        const token = signJwt(
          { sub: u.id, username: u.username, level: u.level },
          store.getJwtSecret()
        )
        self.deps.touchPresence?.(u)
        return { token, user: pub }
      },
      createLoginGrant: (userId, opts) => {
        const store = self.deps.getUserStore?.()
        if (!store) throw new Error('用户系统未配置')
        const u = store.getById(userId)
        if (!u) throw new Error('用户不存在')
        if (!u.enabled) {
          throw new Error(
            u.banReason ? `账号已被封禁：${u.banReason}` : '账号已被封禁，请联系管理员解封'
          )
        }
        const { passwordHash: _h, passwordSalt: _s, ...pub } = u
        const grant = self.createLoginGrant(identifier, userId, opts)
        return { ...grant, user: pub }
      },
      createUser: async (input) => {
        const store = self.deps.getUserStore?.()
        if (!store) throw new Error('用户系统未配置')
        const password =
          input.password && input.password.length >= 4
            ? input.password
            : `qq_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
        return await store.create({
          username: input.username,
          password,
          displayName: input.displayName,
          level: input.level || 'viewer'
        })
      },
      db:
        self.deps.getDbApi?.(identifier) ||
        createDisabledExtensionDbApi('plugin', identifier)
    }
    return api
  }

  private clearRoutesFor(identifier: string): void {
    this.customRoutes = this.customRoutes.filter((r) => r.identifier !== identifier)
  }

  private buildHostCapabilities(forPluginId: string, api: PluginApi): HostCapabilities {
    const self = this
    return {
      dataRoot: this.deps.dataRoot,
      appVersion: this.deps.version || '0.0.0',
      getSettings: () => this.deps.getSettings(),
      patchSettings: (patch) => this.deps.patchSettings(patch),
      getDevices: () => this.deps.getDevices(),
      getStatuses: () => this.deps.getStatuses(),
      controlDevice: (deviceId, payload) => this.deps.controlDevice(deviceId, payload),
      deviceOp: this.deps.deviceOp
        ? (req) => this.deps.deviceOp!(req)
        : undefined,
      startPrint: this.deps.startPrint
        ? (req) => this.deps.startPrint!(req)
        : undefined,
      getDeviceCapabilities: this.deps.getDeviceCapabilities
        ? (deviceId) => this.deps.getDeviceCapabilities!(deviceId)
        : undefined,
      sendGcode: this.deps.sendGcode
        ? (deviceId, script) => this.deps.sendGcode!(deviceId, script)
        : undefined,
      moonrakerRequest: this.deps.moonrakerRequest
        ? (deviceId, req) => this.deps.moonrakerRequest!(deviceId, req)
        : undefined,
      claimDevice: (pluginId, deviceId, opts) => {
        const store = this.deps.deviceLocks
        if (!store) return Promise.resolve({ ok: false, message: 'lock 不可用' })
        return Promise.resolve(store.claim(deviceId, pluginId, opts))
      },
      releaseDevice: (pluginId, deviceId, opts) => {
        const store = this.deps.deviceLocks
        if (!store) return Promise.resolve({ ok: false, message: 'lock 不可用' })
        return Promise.resolve(store.release(deviceId, pluginId, opts))
      },
      getDeviceLock: (deviceId) => this.deps.deviceLocks?.get(deviceId) ?? null,
      snapshotCamera: this.deps.snapshotCamera
        ? (opts) => this.deps.snapshotCamera!(opts)
        : undefined,
      getPublicBaseUrl: () => api.getPublicBaseUrl(),
      getUserPluginData: (userId) => api.getUserPluginData(userId),
      patchUserPluginData: (userId, patch) => api.patchUserPluginData(userId, patch),
      saveDevices: async (devices) => {
        const next = await self.runHook('devices_save', devices)
        self.deps.saveDevices(Array.isArray(next) ? (next as unknown[]) : devices)
      },
      getDbApi: (pluginId) =>
        this.deps.getDbApi?.(pluginId) || createDisabledExtensionDbApi('plugin', pluginId),
      registerHttpRoute: (method, pathPattern, handler, opts) => {
        api.registerRoute(method, pathPattern, (req, a) => handler(req, a), opts)
      },
      appendLog: this.deps.appendLog,
      readPluginJson: (pluginId, rel, fallback) => {
        const a = pluginId === forPluginId ? api : self.loaded.get(pluginId)?.api
        return a ? a.readJson(rel, fallback) : fallback
      },
      writePluginJson: (pluginId, rel, data) => {
        const a = pluginId === forPluginId ? api : self.loaded.get(pluginId)?.api
        a?.writeJson(rel, data)
      },
      getPluginVars: (pluginId) => self.state.installed[pluginId]?.vars || {},
      setPluginVar: async (pluginId, key, value) => {
        await self.setVars(pluginId, { [key]: value })
      },
      dispatchAlert: this.deps.dispatchAlert
        ? (payload) =>
            this.deps.dispatchAlert!({
              kind: payload.kind || 'plugin',
              title: payload.title,
              content: payload.content,
              deviceId: payload.deviceId,
              deviceName: payload.deviceName
            })
        : undefined,
      findUser: (query) => api.findUser(query),
      createUser: (input) =>
        api.createUser({
          username: input.username,
          password: input.password,
          displayName: input.displayName,
          level: input.level as never
        }),
      issueLoginToken: (userId) => api.issueLoginToken(userId),
      createLoginGrant: (userId, opts) => api.createLoginGrant(userId, opts),
      callPlugin: (fromId, targetId, method, args) => self.callPlugin(fromId, targetId, method, args),
      listPlugins: () =>
        self.list().map((p) => ({
          id: p.identifier,
          name: p.name,
          version: p.version,
          available: p.available,
          modules: (p.modules || []).map((m) => ({
            name: m.name,
            type: m.type,
            menu: m.menu
          }))
        })),
      getPluginInfo: (pluginId) => {
        const p = self.state.installed[safeId(pluginId)]
        if (!p) return null
        return {
          id: p.identifier,
          name: p.name,
          version: p.version,
          available: p.available,
          vars: { ...p.vars }
        }
      },
      registerPluginMethod: (pluginId, name, fn) => {
        const id = safeId(pluginId)
        if (!self.exportedMethods.has(id)) self.exportedMethods.set(id, new Map())
        self.exportedMethods.get(id)!.set(name, fn)
      },
      pushNotice: (input) => self.getNoticeStore().push(input),
      cacheGet: async (pluginId, key) => {
        const k = `${pluginId}:${key}`
        const hit = self.memCache.get(k)
        if (!hit) return undefined
        if (hit.expiresAt && Date.now() > hit.expiresAt) {
          self.memCache.delete(k)
          return undefined
        }
        return hit.value
      },
      cacheSet: async (pluginId, key, value, ttlMs) => {
        self.memCache.set(`${pluginId}:${key}`, {
          value,
          expiresAt: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : undefined
        })
      },
      cacheDelete: async (pluginId, key) => {
        self.memCache.delete(`${pluginId}:${key}`)
      },
      i18nGet: (pluginId, key, fallback) => {
        const map = self.i18nMaps.get(pluginId)
        if (map?.[key] != null) return map[key]
        // nested key a.b
        if (map && key.includes('.')) {
          const parts = key.split('.')
          let cur: unknown = map
          for (const p of parts) {
            if (cur == null || typeof cur !== 'object') return fallback ?? key
            cur = (cur as Record<string, unknown>)[p]
          }
          if (cur != null) return String(cur)
        }
        return fallback ?? key
      },
      i18nLocale: () => {
        const s = self.deps.getSettings() as { locale?: string; uiLocale?: string }
        return String(s.uiLocale || s.locale || 'zh-CN')
      },
      fetch: typeof fetch !== 'undefined' ? fetch : undefined
    }
  }

  async callPlugin(
    fromId: string,
    targetId: string,
    method: string,
    args?: unknown
  ): Promise<unknown> {
    const id = safeId(targetId)
    const plug = this.loaded.get(id)
    if (!plug?.state.available) throw new Error(`目标插件未启用: ${targetId}`)
    const exported = this.exportedMethods.get(id)?.get(method)
    if (exported) return exported(args)
    const mod = plug.moduleHandlers[method]
    if (mod) {
      return mod(plug.api, {
        method: 'CALL',
        path: `/plugin-call/${fromId}/${method}`,
        url: new URL(`http://local/plugin-call/${fromId}/${method}`),
        query: {},
        headers: {},
        auth: { kind: 'plugin', from: fromId },
        body: args
      })
    }
    const hook = plug.hooks[method]
    if (hook) return hook(plug.api, args, { from: fromId })
    throw new Error(`插件 ${targetId} 无方法/模块: ${method}`)
  }

  private loadI18n(identifier: string, dir: string): void {
    this.i18nMaps.delete(identifier)
    const locale = (() => {
      const s = this.deps.getSettings() as { locale?: string; uiLocale?: string }
      return String(s.uiLocale || s.locale || 'zh-CN')
    })()
    const candidates = [
      join(dir, 'language', `${locale}.json`),
      join(dir, 'language', locale.split('-')[0] + '.json'),
      join(dir, 'language', 'zh-CN.json'),
      join(dir, 'language', 'zh.json'),
      join(dir, 'language', 'en.json'),
      join(dir, 'lang', `${locale}.json`),
      join(dir, 'lang', 'zh-CN.json')
    ]
    for (const p of candidates) {
      if (!existsSync(p)) continue
      try {
        const raw = JSON.parse(readFileSync(p, 'utf8'))
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const map: Record<string, string> = {}
          const flatten = (obj: Record<string, unknown>, prefix = '') => {
            for (const [k, v] of Object.entries(obj)) {
              const key = prefix ? `${prefix}.${k}` : k
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                flatten(v as Record<string, unknown>, key)
              } else {
                map[key] = String(v)
                if (!prefix) map[k] = String(v)
              }
            }
          }
          flatten(raw as Record<string, unknown>)
          this.i18nMaps.set(identifier, map)
          return
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Flatten i18n maps for SPA */
  collectI18nMaps(): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {}
    for (const [id, map] of Array.from(this.i18nMaps.entries())) {
      out[id] = { ...map }
    }
    return out
  }

  private isModuleOn(identifier: string, moduleName: string): boolean {
    const st = this.state.installed[identifier] || this.loaded.get(identifier)?.state
    return isPluginModuleEnabled(st, moduleName)
  }

  private registerCronJobs(identifier: string): void {
    this.cron.clearPlugin(identifier)
    const plug = this.loaded.get(identifier)
    if (!plug?.state.available) return
    for (const m of plug.state.modules) {
      if (m.type !== 'cron') continue
      if (!this.isModuleOn(identifier, m.name)) continue
      const schedule = m.schedule || 'every:5m'
      const moduleName = m.name
      this.cron.register({
        pluginId: identifier,
        module: moduleName,
        schedule,
        run: async () => {
          const ctx: PluginRequestCtx = {
            method: 'CRON',
            path: `/cron/${identifier}/${moduleName}`,
            url: new URL(`http://local/cron/${identifier}/${moduleName}`),
            query: {},
            headers: {},
            auth: { kind: 'cron' }
          }
          await this.runModule(identifier, moduleName, ctx)
        }
      })
    }
  }

  /** Auto-mount modules with type=api as HTTP routes */
  private registerApiModules(identifier: string): void {
    const plug = this.loaded.get(identifier)
    if (!plug?.state.available) return
    const api = plug.api
    for (const m of plug.state.modules) {
      if (m.type !== 'api') continue
      if (!this.isModuleOn(identifier, m.name)) continue
      if (!plug.moduleHandlers[m.name]) continue
      const moduleName = m.name
      const pathPattern =
        (m.url && m.url.trim()) || `/api/v1/plugins/${identifier}/api/${moduleName}`
      const method = (m.method && m.method.trim()) || '*'
      const isPublic = m.public === true && m.adminOnly !== true
      api.registerRoute(
        method,
        pathPattern,
        async (req) => this.runModule(identifier, moduleName, req),
        { public: isPublic }
      )
    }
  }

  private async runSqlMigrations(identifier: string, dir: string, target: number): Promise<void> {
    const st = this.state.installed[identifier]
    if (!st) return
    const db = this.deps.getDbApi?.(identifier)
    if (!db?.available) return
    try {
      let current = st.dbSchemaVersion || 0
      // First enable with no schema version: prefer install.sql then migrations
      if (current === 0 && existsSync(join(dir, 'install.sql'))) {
        current = await applyPluginInstallSql({
          pluginDir: dir,
          targetVersion: Math.max(target, 1),
          db: db as never
        })
      } else if (target > current) {
        current = await applyPluginSqlMigrations({
          pluginDir: dir,
          currentVersion: current,
          targetVersion: target,
          db: db as never
        })
      }
      if (current !== (st.dbSchemaVersion || 0)) {
        st.dbSchemaVersion = current
        this.saveState()
      }
    } catch (e) {
      console.error(`[plugin:${identifier}] sql migrate failed:`, e)
      st.error = e instanceof Error ? e.message : String(e)
      this.saveState()
    }
  }

  private worldRecords(): LoadedPluginRecord[] {
    return Object.values(this.state.installed).map((st) => {
      const dir = this.pluginDir(st.identifier)
      let manifest
      try {
        const raw = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'))
        manifest = toManifestV2(raw, st.identifier)
      } catch {
        manifest = toManifestV2(
          {
            identifier: st.identifier,
            name: st.name,
            version: st.version,
            apiVersion: st.apiVersion || '1',
            requires: st.requires,
            conflicts: st.conflicts
          },
          st.identifier
        )
      }
      return {
        id: st.identifier,
        manifest,
        state: st.available ? ('enabled' as const) : ('disabled' as const),
        directory: dir
      }
    })
  }

  private async loadOne(identifier: string): Promise<void> {
    const st = this.state.installed[identifier]
    if (!st) return
    this.deactivateLoaded(identifier)
    this.clearRoutesFor(identifier)
    this.hookBus.clearPlugin(identifier)
    this.templates.unregister(identifier)
    this.cron.clearPlugin(identifier)
    this.i18nMaps.delete(identifier)
    this.exportedMethods.delete(identifier)
    this.loaded.delete(identifier)
    if (!st.available) {
      void this.emitDomainEvent(KERNEL_HOOKS.pluginLifecycle, {
        pluginId: identifier,
        action: 'disabled'
      })
      return
    }

    const dir = this.pluginDir(identifier)
    if (!existsSync(dir)) {
      st.error = '插件目录不存在'
      st.available = false
      this.saveState()
      return
    }

    try {
      const rawJson = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'))
      const manifestV2 = toManifestV2(rawJson, identifier)
      const manifest = this.readManifest(dir, identifier)
      const api = this.buildApi(identifier, { ...st.vars })
      const hooks: Record<string, HookFn> = {}
      const moduleHandlers: LoadedPlugin['moduleHandlers'] = {}

      st.apiVersion = manifestV2.apiVersion
      st.requires = manifestV2.requires
      st.conflicts = manifestV2.conflicts
      st.capabilities = manifestV2.capabilities

      this.templates.register(identifier, dir)
      this.loadI18n(identifier, dir)
      await this.runSqlMigrations(identifier, dir, manifestV2.dbSchemaVersion || 0)

      const mainPath = join(dir, manifest.mainFile || 'main.js')
      let exported: unknown = null
      let instance: Record<string, unknown> | null = null
      if (existsSync(mainPath)) {
        try {
          delete this.require.cache[mainPath]
        } catch {
          /* ignore */
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = this.require(mainPath)
        exported = mod?.default || mod
        instance =
          typeof exported === 'function'
            ? (new (exported as new () => object)() as Record<string, unknown>)
            : (exported as Record<string, unknown>)
        if (instance && typeof instance === 'object') {
          for (const [k, v] of Object.entries(instance)) {
            if (typeof v === 'function') {
              hooks[k] = (apiArg, value, ctx) =>
                (v as (this: unknown, api: PluginApi, value: unknown, ctx?: unknown) => unknown).call(
                  instance,
                  apiArg,
                  value,
                  ctx
                )
            }
          }
        }
      }

      for (const m of manifest.modules.length ? manifest.modules : st.modules) {
        const candidates = [
          join(dir, 'modules', `${m.name}.js`),
          join(dir, `${m.name}.js`)
        ]
        const modPath = candidates.find((p) => existsSync(p))
        if (!modPath) continue
        try {
          delete this.require.cache[modPath]
        } catch {
          /* ignore */
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = this.require(modPath)
        const fn = mod?.default || mod?.handle || mod
        if (typeof fn === 'function') {
          moduleHandlers[m.name] = (apiArg, ctx) => fn(apiArg, ctx)
        } else if (fn && typeof fn.handle === 'function') {
          moduleHandlers[m.name] = (apiArg, ctx) => fn.handle(apiArg, ctx)
        }
      }

      this.loaded.set(identifier, {
        state: st,
        manifest,
        api,
        hooks,
        moduleHandlers
      })

      const hostCaps = this.buildHostCapabilities(identifier, api)

      const kernelCtx = this.contextFactory.create(
        {
          id: identifier,
          version: st.version,
          manifest: manifestV2,
          vars: { ...st.vars }
        },
        hostCaps,
        this.hookBus,
        this.templates
      )

      const loaded = this.loaded.get(identifier)!
      loaded.kernelCtx = kernelCtx

      const useV2 = manifestV2.apiVersion === '2' || isV2Module(instance || exported)
      if (useV2 && isV2Module(instance || exported)) {
        const mod = (instance || exported) as {
          activate: (ctx: unknown) => unknown
          deactivate?: (ctx: unknown) => unknown
        }
        try {
          await Promise.resolve(mod.activate(kernelCtx))
        } catch (e) {
          console.error(`[plugin:${identifier}] activate failed:`, e)
          throw e
        }
      } else {
        registerLegacyHooks(
          this.hookBus,
          identifier,
          hooks as unknown as Record<string, import('./kernel/CompatAdapter').LegacyHookFn>,
          () => api
        )
        if (typeof hooks.register === 'function') {
          await Promise.resolve(hooks.register(api, null))
        }
      }

      this.registerCronJobs(identifier)
      this.registerApiModules(identifier)
      st.error = undefined
      st.hooks = Object.keys(hooks)
      st.modules = manifest.modules.length ? manifest.modules : st.modules
      this.saveState()
      void this.emitDomainEvent(KERNEL_HOOKS.pluginLifecycle, {
        pluginId: identifier,
        action: 'enabled',
        version: st.version
      })
    } catch (e) {
      st.error = e instanceof Error ? e.message : String(e)
      st.available = false
      this.saveState()
      console.error(`[plugin] load ${identifier} failed:`, e)
    }
  }

  async reloadAll(): Promise<void> {
    this.customRoutes = []
    for (const id of Array.from(this.loaded.keys())) {
      this.deactivateLoaded(id)
      this.cron.clearPlugin(id)
    }
    this.loaded.clear()
    this.i18nMaps.clear()
    this.exportedMethods.clear()
    for (const id of Object.keys(this.state.installed)) {
      this.hookBus.clearPlugin(id)
      this.templates.unregister(id)
    }
    const world = this.worldRecords().filter((p) => p.state === 'enabled')
    const ordered = this.depResolver.sortForLoad(world)
    const orderIds = ordered.map((p) => p.id)
    for (const id of orderIds) {
      await this.loadOne(id)
    }
    for (const id of Object.keys(this.state.installed)) {
      if (this.state.installed[id]?.available && !this.loaded.has(id)) {
        await this.loadOne(id)
      }
    }
  }

  async runHook<T = unknown>(name: PluginHookName, value: T, ctx?: unknown): Promise<T> {
    let cur: unknown = value
    const names = hookApplyNames(String(name))
    const seen = new Set<string>()
    for (const n of names) {
      if (seen.has(n)) continue
      seen.add(n)
      cur = await this.hookBus.apply(n, cur, ctx)
    }
    // Fallback: if bus empty for this hook, legacy per-plugin map (safety during transition)
    if ((this.hookBus.list(String(name)).length === 0) && names.every((n) => this.hookBus.list(n).length === 0)) {
      for (const [id, plug] of Array.from(this.loaded.entries())) {
        if (!plug.state.available) continue
        const fn = plug.hooks[name]
        if (!fn) continue
        try {
          const next = await fn(plug.api, cur, ctx)
          if (next !== undefined) cur = next
        } catch (e) {
          console.error(`[plugin:${id}] hook ${name} error:`, e)
        }
      }
    }
    return cur as T
  }

  /**
   * Sync-friendly hook runner for sendJson wrappers.
   * Prefer HookBus.applySync; legacy per-plugin map is fallback.
   */
  runHookSync<T = unknown>(name: PluginHookName, value: T, ctx?: unknown): T {
    let cur: unknown = value
    const names = hookApplyNames(String(name))
    const seen = new Set<string>()
    let ranBus = false
    for (const n of names) {
      if (seen.has(n)) continue
      seen.add(n)
      if (this.hookBus.list(n).length > 0) {
        ranBus = true
        cur = this.hookBus.applySync(n, cur, ctx)
      }
    }
    if (!ranBus && this.hookBus.list(String(name)).length === 0) {
      for (const [id, plug] of Array.from(this.loaded.entries())) {
        if (!plug.state.available) continue
        const fn = plug.hooks[name]
        if (!fn) continue
        try {
          const next = fn(plug.api, cur, ctx) as unknown
          if (next !== undefined && next !== null && typeof (next as { then?: unknown }).then === 'function') {
            void Promise.resolve(next).catch((e) =>
              console.error(`[plugin:${id}] hook ${name} async error:`, e)
            )
          } else if (next !== undefined) {
            cur = next
          }
        } catch (e) {
          console.error(`[plugin:${id}] hook ${name} error:`, e)
        }
      }
    }
    return cur as T
  }

  private deactivateLoaded(identifier: string): void {
    const prev = this.loaded.get(identifier)
    if (!prev?.kernelCtx) return
    try {
      const dir = this.pluginDir(identifier)
      const mainPath = join(dir, prev.manifest.mainFile || 'main.js')
      if (!existsSync(mainPath)) return
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const modRaw = this.require(mainPath)
      const exported = modRaw?.default || modRaw
      const instance =
        typeof exported === 'function'
          ? null
          : (exported as { deactivate?: (ctx: unknown) => unknown })
      const deactivate =
        instance && typeof instance.deactivate === 'function'
          ? instance.deactivate.bind(instance)
          : typeof exported?.deactivate === 'function'
            ? exported.deactivate.bind(exported)
            : null
      if (deactivate) {
        void Promise.resolve(deactivate(prev.kernelCtx)).catch((e) =>
          console.error(`[plugin:${identifier}] deactivate failed:`, e)
        )
      }
    } catch (e) {
      console.error(`[plugin:${identifier}] deactivate error:`, e)
    }
  }

  /** Kernel dependency check before enable */

  collectUiNav(): PluginUiNavItem[] {
    const items: PluginUiNavItem[] = []
    for (const plug of Array.from(this.loaded.values())) {
      if (!plug.state.available) continue
      for (const m of plug.state.modules) {
        if (m.type !== 'page' && m.type !== 'admin') continue
        if (!this.isModuleOn(plug.state.identifier, m.name)) continue
        items.push({
          key: `plugin:${plug.state.identifier}:${m.name}`,
          label: m.menu || m.name,
          identifier: plug.state.identifier,
          module: m.name,
          order: m.displayOrder,
          perm: m.perm,
          adminOnly: m.adminOnly === true
        })
      }
    }
    return items.sort((a, b) => (a.order || 0) - (b.order || 0))
  }

  /**
   * Permission codes plugins want shown in 用户权限勾选.
   * Sources: module.perm + hook `permissions_catalog`.
   */
  async collectPermissionsCatalog(): Promise<PluginPermissionDef[]> {
    const byCode = new Map<string, PluginPermissionDef>()
    const add = (row: PluginPermissionDef) => {
      const code = String(row.code || '')
        .trim()
        .replace(/\s+/g, '')
      if (!code || code.startsWith('device.action.')) return
      const label = String(row.label || code).trim() || code
      const prev = byCode.get(code)
      byCode.set(code, {
        code,
        label: label || prev?.label || code,
        plugin: row.plugin || prev?.plugin,
        description: row.description || prev?.description
      })
    }

    for (const plug of Array.from(this.loaded.values())) {
      if (!plug.state.available) continue
      for (const m of plug.state.modules) {
        if (!m.perm) continue
        add({
          code: m.perm,
          label: m.menu || m.perm,
          plugin: plug.state.identifier
        })
      }
    }

    const seeded = Array.from(byCode.values())
    let merged: PluginPermissionDef[] = seeded
    try {
      const hooked = await this.runHook('permissions_catalog', seeded)
      if (Array.isArray(hooked)) {
        merged = []
        byCode.clear()
        for (const row of hooked) {
          if (!row || typeof row !== 'object') continue
          const r = row as PluginPermissionDef
          add({
            code: r.code,
            label: r.label,
            plugin: r.plugin,
            description: r.description
          })
        }
        merged = Array.from(byCode.values())
      }
    } catch (e) {
      console.error('[plugin] permissions_catalog failed:', e)
    }
    return merged.sort((a, b) => a.code.localeCompare(b.code))
  }

  /** Full UI bundle for SPA / login (slots + css/js + theme + hideNav) */
  async collectUiAssets(opts?: { publicOnly?: boolean }): Promise<PluginUiAssets> {
    const publicOnly = opts?.publicOnly === true
    const base: PluginUiAssets = {
      css: [],
      js: [],
      publicJs: [],
      publicCss: [],
      htmlHeader: '',
      htmlFooter: '',
      slots: {},
      theme: {},
      hideNavKeys: []
    }

    for (const plug of Array.from(this.loaded.values())) {
      if (!plug.state.available) continue
      const id = plug.state.identifier
      const dir = this.pluginDir(id)
      const man = plug.manifest

      if (man.themeCss) {
        const url = `/api/v1/plugins/${encodeURIComponent(id)}/asset/${man.themeCss.replace(/^\/+/, '')}`
        base.css!.push(url)
        base.publicCss!.push(url)
      }
      for (const f of man.clientJs || []) {
        base.js!.push(
          `/api/v1/plugins/${encodeURIComponent(id)}/asset/${String(f).replace(/^\/+/, '')}`
        )
      }
      for (const f of man.publicClientJs || []) {
        const url = `/api/v1/plugins/${encodeURIComponent(id)}/asset/${String(f).replace(/^\/+/, '')}`
        base.publicJs!.push(url)
      }

      // slots/*.html
      const slotsDir = join(dir, 'slots')
      if (existsSync(slotsDir)) {
        try {
          for (const fname of readdirSync(slotsDir)) {
            if (!fname.endsWith('.html')) continue
            const slotId = fname.replace(/\.html$/i, '')
            if (publicOnly && !slotId.startsWith('login.')) continue
            const html = readFileSync(join(slotsDir, fname), 'utf8')
            if (!base.slots![slotId]) base.slots![slotId] = []
            base.slots![slotId].push(html)
          }
        } catch {
          /* ignore */
        }
      }
    }

    // Merge TemplateEngine slots (templates/ + slots/) — render extends/if/loop
    try {
      const tplSlots = this.templates.collectSlotsRendered
        ? await this.templates.collectSlotsRendered({
            vars: Object.fromEntries(
              Array.from(this.loaded.values()).map((p) => [p.state.identifier, p.state.vars])
            ),
            locale: (() => {
              const s = this.deps.getSettings() as { locale?: string; uiLocale?: string }
              return String(s.uiLocale || s.locale || 'zh-CN')
            })()
          })
        : this.templates.collectSlots()
      for (const [slotId, htmls] of Object.entries(tplSlots)) {
        if (publicOnly && !slotId.startsWith('login.')) continue
        if (!base.slots![slotId]) base.slots![slotId] = []
        for (const html of htmls) {
          if (!base.slots![slotId].includes(html)) base.slots![slotId].push(html)
        }
      }
    } catch {
      /* ignore */
    }

    await this.hookBus.emit(KERNEL_HOOKS.uiRenderBefore, { publicOnly, assets: base })

    // Formal: filter:ui.template.fetch — mutate slot HTML map
    const fetched = await this.runHook(KERNEL_HOOKS.uiTemplateFetch, {
      publicOnly,
      slots: base.slots || {}
    })
    if (fetched && typeof fetched === 'object' && (fetched as { slots?: unknown }).slots) {
      base.slots = (fetched as { slots: Record<string, string[]> }).slots
    }

    // Server hooks can add/override anything
    let merged = await this.runHook('ui_assets', base)
    merged = await this.runHook('ui_slots', merged)
    const theme = await this.runHook('theme_resolve', merged.theme || {})
    merged.theme = theme

    await this.hookBus.emit(KERNEL_HOOKS.uiRenderAfter, { publicOnly, assets: merged })

    if (publicOnly) {
      // Keep only login-related slots for public bundle
      const slots: Record<string, string[]> = {}
      for (const [k, v] of Object.entries(merged.slots || {})) {
        if (k.startsWith('login.')) slots[k] = v
      }
      return {
        ...merged,
        js: [],
        css: merged.publicCss || merged.css,
        slots,
        htmlHeader: '',
        htmlFooter: ''
      }
    }
    return merged
  }

  async collectUiNavAsync(): Promise<PluginUiNavItem[]> {
    const items = this.collectUiNav()
    return this.runHook('ui_nav', items)
  }

  /** Resolve any file under plugin package (for client assets) */
  resolvePluginAsset(identifier: string, relPath: string): string | null {
    const id = safeId(identifier)
    const base = this.pluginDir(id)
    const full = resolve(base, relPath)
    if (!full.startsWith(resolve(base))) return null
    if (!existsSync(full) || !statSync(full).isFile()) return null
    return full
  }

  async applyPermissionsHook(perms: string[], user: unknown): Promise<string[]> {
    return this.runHook('permissions_effective', perms, {
      method: 'GET',
      path: '/api/v1/me',
      url: new URL('http://local/api/v1/me'),
      query: {},
      headers: {},
      auth: user
    })
  }

  async runModule(
    identifier: string,
    moduleName: string,
    ctx: PluginRequestCtx
  ): Promise<unknown> {
    const plug = this.loaded.get(identifier)
    if (!plug || !plug.state.available) throw new Error('插件未启用或不存在')
    if (!this.isModuleOn(identifier, moduleName)) {
      throw new Error(`模块 ${moduleName} 已禁用`)
    }
    const modDef =
      plug.state.modules.find((m) => m.name === moduleName) ||
      plug.manifest.modules?.find((m) => m.name === moduleName)
    const auth = ctx.auth as {
      kind?: string
      user?: { level?: string; permissions?: string[]; groupIds?: string[] }
    } | null
    const isAdmin =
      auth?.kind === 'local' ||
      auth?.kind === 'apiKey' ||
      (auth?.kind === 'user' && auth.user?.level === 'admin')
    if (modDef?.adminOnly && !isAdmin) {
      throw new Error('需要管理员权限')
    }
    if (modDef?.perm && !isAdmin) {
      const direct = auth?.user?.permissions || []
      const fromGroups = this.getUserGroupStore().permissionsFor(auth?.user?.groupIds)
      const perms = new Set([...direct, ...fromGroups])
      if (!perms.has(modDef.perm) && !perms.has('*') && !perms.has('admin')) {
        throw new Error(`缺少权限: ${modDef.perm}`)
      }
    }
    // Group module allow-list (page/admin); empty policy = no extra gate
    if (!isAdmin && (modDef?.type === 'page' || modDef?.type === 'admin' || !modDef)) {
      const access = this.getUserGroupStore().moduleAccessFor(auth?.user?.groupIds)
      if (!groupAllowsModule(access, identifier, moduleName)) {
        throw new Error(`用户组未授权模块: ${identifier}/${moduleName}`)
      }
    }
    const fn = plug.moduleHandlers[moduleName]
    if (!fn) throw new Error(`模块 ${moduleName} 不存在`)
    return fn(plug.api, ctx)
  }

  matchCustomRoute(
    method: string,
    path: string,
    opts?: { publicOnly?: boolean }
  ): { route: CustomRoute; api: PluginApi } | null {
    const m = method.toUpperCase()
    for (const route of this.customRoutes) {
      if (opts?.publicOnly && !route.public) continue
      if (route.method !== m && route.method !== '*') continue
      const plug = this.loaded.get(route.identifier)
      if (!plug?.state.available) continue
      if (path === route.pattern || path.startsWith(route.pattern.replace(/\*$/, ''))) {
        return { route, api: plug.api }
      }
      // simple :param
      const re = new RegExp(
        '^' + route.pattern.replace(/:[^/]+/g, '[^/]+').replace(/\*/g, '.*') + '$'
      )
      if (re.test(path)) return { route, api: plug.api }
    }
    return null
  }

  async setAvailable(identifier: string, available: boolean): Promise<PluginRuntimeState> {
    const id = safeId(identifier)
    const st = this.state.installed[id]
    if (!st) throw new Error('插件未安装')
    if (available) {
      // Probe manifest for dep check with hypothetical enabled state
      const world = this.worldRecords().map((p) =>
        p.id === id ? { ...p, state: 'enabled' as const } : p
      )
      // Ensure target exists in world
      if (!world.find((p) => p.id === id)) {
        try {
          const raw = JSON.parse(readFileSync(join(this.pluginDir(id), 'plugin.json'), 'utf8'))
          world.push({
            id,
            manifest: toManifestV2(raw, id),
            state: 'enabled',
            directory: this.pluginDir(id)
          })
        } catch {
          /* ignore */
        }
      }
      const check = this.depResolver.checkEnable(id, world)
      if (!check.ok) {
        throw new Error(check.errors.join('; '))
      }
    }
    st.available = available
    st.updatedAt = new Date().toISOString()
    st.error = undefined
    this.saveState()
    await this.loadOne(id)
    return st
  }

  async setVars(identifier: string, vars: Record<string, string>): Promise<PluginRuntimeState> {
    const id = safeId(identifier)
    const st = this.state.installed[id]
    if (!st) throw new Error('插件未安装')
    st.vars = { ...st.vars, ...vars }
    st.updatedAt = new Date().toISOString()
    this.saveState()
    await this.loadOne(id)
    return st
  }

  /** Per-module enable/disable (does not unload whole plugin) */
  async setEnabledModules(
    identifier: string,
    enabledModules: Record<string, boolean>
  ): Promise<PluginRuntimeState> {
    const id = safeId(identifier)
    const st = this.state.installed[id]
    if (!st) throw new Error('插件未安装')
    const next: Record<string, boolean> = { ...(st.enabledModules || {}) }
    for (const [k, v] of Object.entries(enabledModules || {})) {
      const name = String(k || '').trim()
      if (!name) continue
      next[name] = v !== false
    }
    st.enabledModules = next
    st.updatedAt = new Date().toISOString()
    this.saveState()
    // Refresh cron/api mounts without full dependency re-check
    if (st.available) {
      await this.loadOne(id)
    }
    return st
  }

  private async runLifecycle(
    dir: string,
    file: string,
    api: PluginApi,
    extra?: unknown
  ): Promise<void> {
    const p = join(dir, file)
    if (!existsSync(p)) return
    try {
      delete this.require.cache[p]
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = this.require(p)
    const fn = mod?.default || mod?.install || mod?.uninstall || mod?.upgrade || mod
    if (typeof fn === 'function') await fn(api, extra)
  }

  async installFromDirectory(srcDir: string): Promise<PluginRuntimeState> {
    const manifest = this.readManifest(srcDir)
    const rawJson = JSON.parse(readFileSync(join(srcDir, 'plugin.json'), 'utf8'))
    const manifestV2 = toManifestV2(rawJson, manifest.identifier)
    const id = safeId(manifest.identifier)
    const dest = this.pluginDir(id)
    ensureDir(this.pluginsRoot)
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true })
    }
    copyDir(srcDir, dest)
    const vars: Record<string, string> = {}
    for (const v of manifest.vars) vars[v.key] = v.value
    const now = new Date().toISOString()
    const prev = this.state.installed[id]
    const st: PluginRuntimeState = {
      identifier: id,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      copyright: manifest.copyright,
      available: manifest.availableDefault,
      installedAt: prev?.installedAt || now,
      updatedAt: now,
      vars: { ...vars, ...(prev?.vars || {}) },
      modules: manifest.modules,
      hooks: manifest.hooks,
      directory: `${id}/`,
      apiVersion: manifestV2.apiVersion,
      requires: manifestV2.requires,
      conflicts: manifestV2.conflicts,
      capabilities: manifestV2.capabilities
    }
    this.state.installed[id] = st
    this.saveState()
    if (st.available) {
      const world = this.worldRecords()
      const check = this.depResolver.checkEnable(id, world)
      if (!check.ok) {
        st.available = false
        st.error = check.errors.join('; ')
        this.saveState()
      }
    }
    const api = this.buildApi(id, st.vars)
    const db = this.deps.getDbApi?.(id)
    if (prev) {
      await this.runLifecycle(dest, manifest.upgradeFile, api, {
        fromVersion: prev.version,
        toVersion: manifest.version,
        fromSchema: prev.dbSchemaVersion || 0,
        toSchema: manifestV2.dbSchemaVersion || 0
      })
      if (db?.available) {
        try {
          const applied = await applyPluginSqlMigrations({
            pluginDir: dest,
            currentVersion: prev.dbSchemaVersion || 0,
            targetVersion: manifestV2.dbSchemaVersion || prev.dbSchemaVersion || 0,
            db: db as never
          })
          st.dbSchemaVersion = applied
          this.saveState()
        } catch (e) {
          console.error(`[plugin:${id}] upgrade sql failed`, e)
        }
      }
    } else {
      await this.runLifecycle(dest, manifest.installFile, api)
      if (db?.available) {
        try {
          st.dbSchemaVersion = await applyPluginInstallSql({
            pluginDir: dest,
            targetVersion: manifestV2.dbSchemaVersion || 0,
            db: db as never
          })
          this.saveState()
        } catch (e) {
          console.error(`[plugin:${id}] install sql failed`, e)
        }
      }
    }
    await this.loadOne(id)
    return this.state.installed[id]
  }

  async installFromZip(buffer: Buffer): Promise<PluginRuntimeState> {
    const tmp = join(this.deps.dataRoot, '.plugin-upload-tmp')
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    ensureDir(tmp)
    const files = unzipSync(new Uint8Array(buffer))
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith('/')) continue
      const norm = name.replace(/^[/\\]+/, '').replace(/\\/g, '/')
      if (norm.includes('..')) continue
      const out = join(tmp, ...norm.split('/'))
      ensureDir(dirname(out))
      writeFileSync(out, data)
    }
    // If zip has single top-level folder, use it
    const top = readdirSync(tmp)
    let root = tmp
    if (top.length === 1 && statSync(join(tmp, top[0])).isDirectory()) {
      root = join(tmp, top[0])
    }
    try {
      return await this.installFromDirectory(root)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /**
   * Install plugin ZIP from remote URL with optional sha256 integrity check.
   * Only http(s) URLs; intended for admin-trusted sources (not a full app store).
   */
  async installFromUrl(url: string, sha256?: string): Promise<PluginRuntimeState> {
    const u = String(url || '').trim()
    if (!/^https?:\/\//i.test(u)) throw new Error('仅支持 http(s) 插件包 URL')
    const res = await fetch(u)
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    if (sha256 && sha256.trim()) {
      const dig = createHash('sha256').update(buf).digest('hex')
      if (dig.toLowerCase() !== sha256.trim().toLowerCase()) {
        throw new Error(`sha256 校验失败（期望 ${sha256.trim()}，实际 ${dig}）`)
      }
    }
    return this.installFromZip(buf)
  }

  listUserGroups(): UserGroup[] {
    return this.getUserGroupStore().list()
  }

  saveUserGroups(groups: UserGroup[]): UserGroup[] {
    return this.getUserGroupStore().saveAll(groups)
  }

  /** @deprecated use listUserGroups */
  listPermissionPacks(): PermissionPack[] {
    return this.getUserGroupStore().listAsPacks()
  }

  /** @deprecated use saveUserGroups */
  savePermissionPacks(packs: PermissionPack[]): PermissionPack[] {
    return this.getUserGroupStore()
      .saveAll(
        packs.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          permissions: p.permissions,
          moduleAccess: []
        }))
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        permissions: g.permissions
      }))
  }

  /** Resolve group permission union for a user */
  groupPermissionsFor(groupIds?: string[] | null): string[] {
    return this.getUserGroupStore().permissionsFor(groupIds)
  }

  groupModuleAccessFor(groupIds?: string[] | null) {
    return this.getUserGroupStore().moduleAccessFor(groupIds)
  }

  async installBundled(identifier: string): Promise<PluginRuntimeState> {
    const src = this.resolveBundledPluginDir(identifier)
    if (!src) throw new Error(`内置/示例插件不存在: ${identifier}`)
    return this.installFromDirectory(src)
  }

  private resolveBundledPluginDir(identifier: string): string | null {
    const id = String(identifier || '').trim()
    if (!id) return null
    const bundled = this.deps.bundledPluginsDir
    if (bundled) {
      const direct = join(bundled, id)
      if (existsSync(direct)) return direct
    }
    const examples = this.deps.examplePluginsDir
    if (examples && existsSync(examples)) {
      for (const name of readdirSync(examples)) {
        if (!name.startsWith('plugin-')) continue
        const dir = join(examples, name)
        if (!statSync(dir).isDirectory()) continue
        try {
          const m = this.readManifest(dir, name)
          if (m.identifier === id) return dir
        } catch {
          /* skip */
        }
      }
    }
    return null
  }

  listBundled(): Array<{ identifier: string; name: string; version: string }> {
    const out: Array<{ identifier: string; name: string; version: string }> = []
    const seen = new Set<string>()
    const pushDir = (dir: string, fallbackId: string) => {
      try {
        const m = this.readManifest(dir, fallbackId)
        if (seen.has(m.identifier)) return
        seen.add(m.identifier)
        out.push({ identifier: m.identifier, name: m.name, version: m.version })
      } catch {
        /* skip */
      }
    }
    const bundled = this.deps.bundledPluginsDir
    if (bundled && existsSync(bundled)) {
      for (const name of readdirSync(bundled)) {
        const dir = join(bundled, name)
        if (!statSync(dir).isDirectory()) continue
        pushDir(dir, name)
      }
    }
    const examples = this.deps.examplePluginsDir
    if (examples && existsSync(examples)) {
      for (const name of readdirSync(examples)) {
        if (!name.startsWith('plugin-')) continue
        const dir = join(examples, name)
        if (!statSync(dir).isDirectory()) continue
        pushDir(dir, name)
      }
    }
    return out
  }

  async uninstall(identifier: string): Promise<void> {
    const id = safeId(identifier)
    const st = this.state.installed[id]
    if (!st) throw new Error('插件未安装')
    const dir = this.pluginDir(id)
    try {
      const manifest = existsSync(dir) ? this.readManifest(dir, id) : null
      const api = this.buildApi(id, st.vars)
      if (manifest) await this.runLifecycle(dir, manifest.uninstallFile, api)
      const db = this.deps.getDbApi?.(id)
      if (db?.available && existsSync(dir)) {
        await applyPluginUninstallSql({ pluginDir: dir, db: db as never })
      }
    } catch (e) {
      console.error('[plugin] uninstall hook error', e)
    }
    this.deactivateLoaded(id)
    this.clearRoutesFor(id)
    this.cron.clearPlugin(id)
    this.hookBus.clearPlugin(id)
    this.templates.unregister(id)
    this.i18nMaps.delete(id)
    this.loaded.delete(id)
    delete this.state.installed[id]
    this.saveState()
    void this.emitDomainEvent(KERNEL_HOOKS.pluginLifecycle, {
      pluginId: id,
      action: 'uninstalled'
    })
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }

  /** Serve static file from plugin package */
  resolveStatic(identifier: string, relPath: string): string | null {
    const id = safeId(identifier)
    const base = join(this.pluginDir(id), 'static')
    const full = resolve(base, relPath)
    if (!full.startsWith(resolve(base))) return null
    if (!existsSync(full) || !statSync(full).isFile()) return null
    return full
  }
}

function copyDir(src: string, dest: string): void {
  ensureDir(dest)
  for (const name of readdirSync(src)) {
    const s = join(src, name)
    const d = join(dest, name)
    if (statSync(s).isDirectory()) copyDir(s, d)
    else copyFileSync(s, d)
  }
}

/** Decode data URL or base64 zip body */
export function decodeZipPayload(body: Record<string, unknown>): Buffer {
  const b64 = typeof body.zipBase64 === 'string' ? body.zipBase64 : ''
  if (b64) {
    const clean = b64.replace(/^data:.*?;base64,/, '')
    return Buffer.from(clean, 'base64')
  }
  throw new Error('请提供 zipBase64')
}
