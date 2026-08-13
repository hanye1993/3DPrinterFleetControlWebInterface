/**
 * Browser plugin runtime — hooks, slots, and full UI extension.
 * Plugins' client.js / login.js call window.HanyePlugin.*
 */
import type { PluginUiAssets, PluginUiNavItem } from '@shared/plugin'
import { useAuthStore } from '../stores/authStore'

export type SlotRenderer =
  | string
  | ((host: HTMLElement, ctx: PluginSlotContext) => void | (() => void))

export type PluginSlotContext = {
  slot: string
  mode: 'public' | 'app'
  user: unknown
  /** Per-instance data from React (e.g. deviceId, chamberTemp) */
  context?: Record<string, unknown>
}

type SlotEntry = { id: string; order: number; render: SlotRenderer; plugin?: string }

type NavPatchFn = (items: PluginUiNavItem[]) => PluginUiNavItem[]
type PermPatchFn = (perms: string[], user: unknown) => string[]
type ThemePatch = Record<string, string>

export type PluginSettingsTab = {
  key: string
  label: string
  /** Render into the host element (HTML or DOM) */
  render: (host: HTMLElement) => void | (() => void)
  /**
   * Sort weight. With `after`/`before`, this is an offset from the anchor
   * (default 10). Without anchors, absolute order among all tabs
   * (built-ins: general=100 … plugins=600, about=10000).
   */
  order?: number
  plugin?: string
  /** Only show for admin UI when true (default true) */
  adminOnly?: boolean
  /**
   * Insert after a built-in or another plugin tab key
   * (`general` | `enterprise` | `ai` | `alerts` | `themes` | `plugins` | `about` | …).
   */
  after?: string
  /** Insert before a tab key (takes precedence over `after` when both set) */
  before?: string
}

/** Built-in Soft Settings tab order anchors (plugins insert relative to these) */
export const SETTINGS_TAB_ORDER: Record<string, number> = {
  general: 100,
  brand: 120,
  nav: 150,
  enterprise: 200,
  ai: 300,
  alerts: 400,
  themes: 500,
  marketplace: 550,
  plugins: 600,
  about: 10000
}

/** Context passed to add-device plugin render / submit handlers */
export type AddDeviceFormCtx = {
  tech: 'fdm' | 'resin'
  brand: string
  connectionMode?: string
  getFieldValue: (name: string) => unknown
  getFieldsValue: () => Record<string, unknown>
  setFieldsValue: (values: Record<string, unknown>) => void
  validateFields: (names?: string[]) => Promise<Record<string, unknown>>
  newId: () => string
}

export type AddDeviceConnectionDef = {
  id: string
  label: string
  default?: boolean
  /** Optional fields UI for this connection mode */
  render?: (el: HTMLElement, ctx: AddDeviceFormCtx) => void | (() => void)
}

/**
 * Register a custom printer brand in 添加设备.
 * `submit` is required for the brand to be savable (unless you only extend built-ins via fields).
 */
export type AddDeviceBrandDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  connections?: AddDeviceConnectionDef[]
  renderForm?: (el: HTMLElement, ctx: AddDeviceFormCtx) => void | (() => void)
  /**
   * Return device fields for storeAdd. Must include name/brand; may include secret/apiKey/accessCode,
   * pluginData, and x_* / plugin_* extras.
   */
  submit?: (
    ctx: AddDeviceFormCtx
  ) => Promise<{ device: Record<string, unknown>; secret?: string } | void>
}

/** Extra form blocks shown for matching brands (built-in or plugin) */
export type AddDeviceFieldDef = {
  id: string
  /** '*' or omit = all brands; else brand id list */
  brands?: string[] | '*'
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: AddDeviceFormCtx) => void | (() => void)
  /** Merge extras into device object after brand save payload is built */
  collect?: (
    ctx: AddDeviceFormCtx,
    device: Record<string, unknown>
  ) => Record<string, unknown> | void
}

/** Context for batch bar plugin actions / status */
export type BatchBarCtx = {
  tech: 'fdm' | 'resin'
  /** Checked ids in current tech workspace */
  checkedIds: string[]
  devices: Array<{ id: string; name: string; brand: string; tech?: string }>
  statuses: Record<string, unknown>
  busy: boolean
  clearChecked: () => void
  setCheckedIds: (ids: string[]) => void
  batchControl: (
    ids: string[],
    action: 'pause' | 'resume' | 'cancel'
  ) => Promise<Array<{ ok: boolean; skipped?: boolean; message?: string }>>
}

/** Extra button on 勾选后的批量操作栏 */
export type BatchActionDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  danger?: boolean
  /** Default true: disabled when nothing checked */
  requireChecked?: boolean
  disabled?: (ctx: BatchBarCtx) => boolean
  run: (ctx: BatchBarCtx) => void | Promise<void>
}

/** Status / info strip on the batch bar (plugin-driven) */
export type BatchStatusDef = {
  id: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: BatchBarCtx) => void | (() => void)
}

/** Filament form context (add / edit spool modal) */
export type FilamentFormCtx = {
  tech: 'fdm' | 'resin'
  mode: 'create' | 'edit'
  spool: Record<string, unknown> | null
  getFieldValue: (name: string) => unknown
  getFieldsValue: () => Record<string, unknown>
  setFieldsValue: (values: Record<string, unknown>) => void
  validateFields: (names?: string[]) => Promise<Record<string, unknown>>
}

export type FilamentBrandDef = {
  id: string
  name: string
  nameEn?: string
  kind?: 'fdm' | 'resin' | 'both'
  popular?: boolean
  plugin?: string
}

export type FilamentMaterialDef = {
  id: string
  label: string
  category: 'fdm' | 'resin'
  plugin?: string
}

export type FilamentFieldDef = {
  id: string
  tech?: 'fdm' | 'resin' | 'both'
  /** Default both */
  mode?: 'create' | 'edit' | 'both'
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: FilamentFormCtx) => void | (() => void)
  collect?: (
    ctx: FilamentFormCtx,
    spool: Record<string, unknown>
  ) => Record<string, unknown> | void
}

export type FilamentColumnDef = {
  id: string
  title: string
  width?: number
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  /** Return cell text (HTML escaped by host as textContent) */
  render: (spool: Record<string, unknown>, ctx: { tech: 'fdm' | 'resin' }) => string
}

export type FilamentRowActionDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  danger?: boolean
  run: (ctx: {
    tech: 'fdm' | 'resin'
    spool: Record<string, unknown>
  }) => void | Promise<void>
}

export type FilamentToolbarActionDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  run: (ctx: { tech: 'fdm' | 'resin' }) => void | Promise<void>
}

/** 常用工具 / 代打报价页上下文 */
export type QuotePageCtx = {
  tech: 'fdm' | 'resin'
  getParam: (name: string) => unknown
  setParam: (name: string, value: unknown) => void
  getParams: () => Record<string, unknown>
  setParams: (patch: Record<string, unknown>) => void
  options: Record<string, unknown>[]
  results: Record<string, unknown>[]
  activeOptionId: string | null
  setActiveOptionId: (id: string) => void
  patchOption: (optionId: string, patch: Record<string, unknown>) => void
  pluginData: Record<string, unknown>
  setPluginData: (patch: Record<string, unknown>) => void
}

export type QuoteMaterialPresetDef = {
  id: string
  label: string
  tech: 'fdm' | 'resin'
  pricePerKg: number
  density?: number
  plugin?: string
}

export type QuotePrinterPresetDef = {
  id: string
  label: string
  watts: number
  plugin?: string
}

export type QuoteFieldDef = {
  id: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: QuotePageCtx) => void | (() => void)
}

export type QuoteOptionFieldDef = {
  id: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  render: (
    el: HTMLElement,
    ctx: QuotePageCtx & { option: Record<string, unknown>; optionIndex: number }
  ) => void | (() => void)
}

export type QuoteColumnDef = {
  id: string
  title: string
  width?: number
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  render: (row: Record<string, unknown>, ctx: QuotePageCtx) => string
}

export type QuoteActionDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  primary?: boolean
  danger?: boolean
  run: (ctx: QuotePageCtx) => void | Promise<void>
}

export type QuoteToolbarActionDef = {
  id: string
  label: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  run: (ctx: QuotePageCtx) => void | Promise<void>
}

/** Transform computed costs for an option (e.g. extra fee) */
export type QuoteCostAdjustDef = {
  id: string
  tech?: 'fdm' | 'resin' | 'both'
  order?: number
  plugin?: string
  adjust: (
    costs: Record<string, number>,
    ctx: QuotePageCtx & { option: Record<string, unknown> }
  ) => Record<string, number>
}

/** 报价记录页上下文 */
export type QuoteHistoryPageCtx = {
  q: string
  setQ: (q: string) => void
  action: string
  setAction: (action: string) => void
  records: Record<string, unknown>[]
  visibleRecords: Record<string, unknown>[]
  reload: () => void | Promise<void>
  openDetail: (record: Record<string, unknown>) => void
  detail: Record<string, unknown> | null
  pluginFilters: Record<string, unknown>
  setPluginFilter: (key: string, value: unknown) => void
  setPluginFilters: (patch: Record<string, unknown>) => void
}

export type QuoteHistoryColumnDef = {
  id: string
  title: string
  width?: number
  order?: number
  plugin?: string
  render: (record: Record<string, unknown>, ctx: QuoteHistoryPageCtx) => string
}

export type QuoteHistoryRowActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  danger?: boolean
  run: (ctx: QuoteHistoryPageCtx & { record: Record<string, unknown> }) => void | Promise<void>
}

export type QuoteHistoryToolbarActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  run: (ctx: QuoteHistoryPageCtx) => void | Promise<void>
}

export type QuoteHistoryFilterDef = {
  id: string
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: QuoteHistoryPageCtx) => void | (() => void)
  /** Client-side filter after API list (AND with others) */
  match?: (record: Record<string, unknown>, ctx: QuoteHistoryPageCtx) => boolean
}

export type QuoteHistoryDetailFieldDef = {
  id: string
  order?: number
  plugin?: string
  render: (
    el: HTMLElement,
    ctx: QuoteHistoryPageCtx & { record: Record<string, unknown> }
  ) => void | (() => void)
}

/** 监控墙 / 区域监控 */
export type MonitorScope = 'wall' | 'zones' | 'both'

export type MonitorTileCtx = {
  scope: 'wall' | 'zones'
  deviceId?: string
  deviceName?: string
  brand?: string
  zoneId?: string
  zoneName?: string
  cameraId?: string
  cameraName?: string
  title: string
  subtitle?: string
}

export type MonitorToolbarActionDef = {
  id: string
  label: string
  scope?: MonitorScope
  order?: number
  plugin?: string
  run: (ctx: {
    scope: 'wall' | 'zones'
    slotCount: number
    zoneId?: string | null
  }) => void | Promise<void>
}

export type MonitorTileActionDef = {
  id: string
  label: string
  scope?: MonitorScope
  order?: number
  plugin?: string
  danger?: boolean
  run: (ctx: MonitorTileCtx) => void | Promise<void>
}

export type MonitorTileExtraDef = {
  id: string
  scope?: MonitorScope
  order?: number
  plugin?: string
  /** Render into tile header / footer host */
  place?: 'header' | 'footer'
  render: (el: HTMLElement, ctx: MonitorTileCtx) => void | (() => void)
}

export type MonitorWallFilterDef = {
  id: string
  order?: number
  plugin?: string
  /** Return false to hide a wall slot */
  match: (slot: {
    deviceId: string
    deviceName: string
    brand: string
  }) => boolean
}

export type MonitorCameraFieldDef = {
  id: string
  order?: number
  plugin?: string
  render: (
    el: HTMLElement,
    ctx: {
      zoneId: string
      zoneName: string
      getFieldValue: (name: string) => unknown
      setFieldsValue: (values: Record<string, unknown>) => void
    }
  ) => void | (() => void)
  collect?: (
    ctx: {
      zoneId: string
      zoneName: string
      getFieldValue: (name: string) => unknown
    },
    camera: Record<string, unknown>
  ) => Record<string, unknown> | void
}

/** Form context when adding/editing a zone camera via a registered source */
export type MonitorCameraSourceFormCtx = {
  zoneId: string
  zoneName: string
  mode: 'create' | 'edit'
  camera: Record<string, unknown> | null
  getFieldValue: (name: string) => unknown
  getFieldsValue: () => Record<string, unknown>
  setFieldsValue: (values: Record<string, unknown>) => void
  validateFields: (names?: string[]) => Promise<Record<string, unknown>>
  newId: () => string
}

/**
 * Plugin camera / NVR / cloud source type for 区域监控.
 * Replaces plain URL form when selected.
 */
export type MonitorCameraSourceDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  /** Hide built-in URL fields when true (default true for plugin sources) */
  hideUrlFields?: boolean
  renderForm?: (el: HTMLElement, ctx: MonitorCameraSourceFormCtx) => void | (() => void)
  /**
   * Build camera JSON to save. Must include `name`; `url` optional if plugin
   * handles snapshots via `monitor_camera_snapshot` / `toSources`.
   */
  submit?: (
    ctx: MonitorCameraSourceFormCtx
  ) =>
    | { camera: Record<string, unknown> }
    | Promise<{ camera: Record<string, unknown> }>
  /**
   * Map saved camera → SnapshotCam sources (client).
   * Default: always use server zone snapshot API (plugin can resolve in main.js).
   */
  toSources?: (
    camera: Record<string, unknown>,
    ctx: { zoneId: string; zoneName?: string }
  ) => Array<{
    id: string
    name: string
    streamUrl?: string
    snapshotUrl?: string
    remoteSnapshotUrl?: string
    remoteStreamUrl?: string
  }>
}

/** Inject live tiles into a zone grid without storing as ZoneCamera (厂家云列表等) */
export type MonitorZoneProviderDef = {
  id: string
  label?: string
  order?: number
  plugin?: string
  listTiles: (ctx: {
    zoneId: string
    zoneName: string
  }) => Array<{
    id: string
    title: string
    subtitle?: string
    cameras: Array<{
      id: string
      name: string
      streamUrl?: string
      snapshotUrl?: string
      remoteSnapshotUrl?: string
      remoteStreamUrl?: string
    }>
  }>
}

/** 用户与权限页 */
export type UsersPageCtx = {
  users: Record<string, unknown>[]
  reload: () => void | Promise<void>
}

export type UserFormCtx = {
  mode: 'create' | 'edit'
  user: Record<string, unknown> | null
  getFieldValue: (name: string) => unknown
  getFieldsValue: () => Record<string, unknown>
  setFieldsValue: (values: Record<string, unknown>) => void
  validateFields: (names?: string[]) => Promise<Record<string, unknown>>
  getPermissions: () => string[]
  setPermissions: (perms: string[]) => void
  getDeviceAcl: () => Record<string, string[]>
  setDeviceAcl: (acl: Record<string, string[]>) => void
}

export type UserColumnDef = {
  id: string
  title: string
  width?: number
  order?: number
  plugin?: string
  render: (user: Record<string, unknown>, ctx: UsersPageCtx) => string
}

export type UserToolbarActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  run: (ctx: UsersPageCtx) => void | Promise<void>
}

export type UserRowActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  danger?: boolean
  run: (ctx: UsersPageCtx & { user: Record<string, unknown> }) => void | Promise<void>
}

export type UserFormFieldDef = {
  id: string
  mode?: 'create' | 'edit' | 'both'
  order?: number
  plugin?: string
  render: (el: HTMLElement, ctx: UserFormCtx) => void | (() => void)
  collect?: (
    ctx: UserFormCtx,
    user: Record<string, unknown>
  ) => Record<string, unknown> | void
}

/** Extra checkbox group under 全局权限 / 插件权限 */
export type UserPermGroupDef = {
  id: string
  title: string
  order?: number
  plugin?: string
  description?: string
  options: Array<{ code: string; label: string }>
}

/** 打印审核 / 队列 */
export type PrintPageCtx = {
  tab: string
  canManage: boolean
  jobs: Record<string, unknown>[]
  pendingCount: number
  queuedCount: number
  historyCount: number
  reload: () => void | Promise<void>
}

export type PrintColumnDef = {
  id: string
  title: string
  width?: number
  order?: number
  plugin?: string
  /** pending | queued | history | all */
  tabs?: Array<'pending' | 'queued' | 'history' | 'mine' | 'all'>
  render: (job: Record<string, unknown>, ctx: PrintPageCtx) => string
}

export type PrintToolbarActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  run: (ctx: PrintPageCtx) => void | Promise<void>
}

export type PrintRowActionDef = {
  id: string
  label: string
  order?: number
  plugin?: string
  danger?: boolean
  /** pending | queued | history | mine | all */
  tabs?: Array<'pending' | 'queued' | 'history' | 'mine' | 'all'>
  run: (ctx: PrintPageCtx & { job: Record<string, unknown> }) => void | Promise<void>
}

export type PrintFilterDef = {
  id: string
  order?: number
  plugin?: string
  match: (job: Record<string, unknown>, ctx: PrintPageCtx) => boolean
}

type Listener = (payload: unknown) => void

type PluginLoginExchangeResult = {
  ok?: boolean
  message?: string
  token?: string
  user?: unknown
  permissions?: string[]
  deviceAcl?: Record<string, string[]>
  needsSsoBind?: boolean
  requireBinding?: boolean
}

class HanyePluginRuntime {
  readonly version = '2.1.0'
  private slots = new Map<string, SlotEntry[]>()
  private navPatches: NavPatchFn[] = []
  private permPatches: PermPatchFn[] = []
  private theme: ThemePatch = {}
  private hideNav = new Set<string>()
  private settingsTabs: PluginSettingsTab[] = []
  private pluginRegistry: Array<{
    id: string
    name: string
    version: string
    available: boolean
    modules?: unknown[]
  }> = []
  private i18nMaps: Record<string, Record<string, string>> = {}
  private kernelVersion = '2.1.0'
  private addDeviceBrands: AddDeviceBrandDef[] = []
  private addDeviceFields: AddDeviceFieldDef[] = []
  private batchActions: BatchActionDef[] = []
  private batchStatuses: BatchStatusDef[] = []
  private filamentBrands: FilamentBrandDef[] = []
  private filamentMaterials: FilamentMaterialDef[] = []
  private filamentFields: FilamentFieldDef[] = []
  private filamentColumns: FilamentColumnDef[] = []
  private filamentRowActions: FilamentRowActionDef[] = []
  private filamentToolbarActions: FilamentToolbarActionDef[] = []
  private quoteMaterialPresets: QuoteMaterialPresetDef[] = []
  private quotePrinterPresets: QuotePrinterPresetDef[] = []
  private quoteFields: QuoteFieldDef[] = []
  private quoteOptionFields: QuoteOptionFieldDef[] = []
  private quoteColumns: QuoteColumnDef[] = []
  private quoteActions: QuoteActionDef[] = []
  private quoteToolbarActions: QuoteToolbarActionDef[] = []
  private quoteCostAdjusts: QuoteCostAdjustDef[] = []
  private quoteHistoryColumns: QuoteHistoryColumnDef[] = []
  private quoteHistoryRowActions: QuoteHistoryRowActionDef[] = []
  private quoteHistoryToolbarActions: QuoteHistoryToolbarActionDef[] = []
  private quoteHistoryFilters: QuoteHistoryFilterDef[] = []
  private quoteHistoryDetailFields: QuoteHistoryDetailFieldDef[] = []
  private monitorToolbarActions: MonitorToolbarActionDef[] = []
  private monitorTileActions: MonitorTileActionDef[] = []
  private monitorTileExtras: MonitorTileExtraDef[] = []
  private monitorWallFilters: MonitorWallFilterDef[] = []
  private monitorCameraFields: MonitorCameraFieldDef[] = []
  private monitorCameraSources: MonitorCameraSourceDef[] = []
  private monitorZoneProviders: MonitorZoneProviderDef[] = []
  private userColumns: UserColumnDef[] = []
  private userToolbarActions: UserToolbarActionDef[] = []
  private userRowActions: UserRowActionDef[] = []
  private userFormFields: UserFormFieldDef[] = []
  private userPermGroups: UserPermGroupDef[] = []
  private printColumns: PrintColumnDef[] = []
  private printToolbarActions: PrintToolbarActionDef[] = []
  private printRowActions: PrintRowActionDef[] = []
  private printFilters: PrintFilterDef[] = []
  private listeners = new Map<string, Set<Listener>>()
  private slotSeq = 0
  mode: 'public' | 'app' = 'app'
  user: unknown = null
  assets: PluginUiAssets = {}

  reset(): void {
    this.slots.clear()
    this.navPatches = []
    this.permPatches = []
    this.theme = {}
    this.hideNav.clear()
    this.settingsTabs = []
    this.pluginRegistry = []
    this.i18nMaps = {}
    this.addDeviceBrands = []
    this.addDeviceFields = []
    this.batchActions = []
    this.batchStatuses = []
    this.filamentBrands = []
    this.filamentMaterials = []
    this.filamentFields = []
    this.filamentColumns = []
    this.filamentRowActions = []
    this.filamentToolbarActions = []
    this.quoteMaterialPresets = []
    this.quotePrinterPresets = []
    this.quoteFields = []
    this.quoteOptionFields = []
    this.quoteColumns = []
    this.quoteActions = []
    this.quoteToolbarActions = []
    this.quoteCostAdjusts = []
    this.quoteHistoryColumns = []
    this.quoteHistoryRowActions = []
    this.quoteHistoryToolbarActions = []
    this.quoteHistoryFilters = []
    this.quoteHistoryDetailFields = []
    this.monitorToolbarActions = []
    this.monitorTileActions = []
    this.monitorTileExtras = []
    this.monitorWallFilters = []
    this.monitorCameraFields = []
    this.monitorCameraSources = []
    this.monitorZoneProviders = []
    this.userColumns = []
    this.userToolbarActions = []
    this.userRowActions = []
    this.userFormFields = []
    this.userPermGroups = []
    this.printColumns = []
    this.printToolbarActions = []
    this.printRowActions = []
    this.printFilters = []
    this.assets = {}
  }

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event)!.add(fn)
    return () => this.listeners.get(event)?.delete(fn)
  }

  emit(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload)
      } catch (e) {
        console.error('[HanyePlugin]', event, e)
      }
    })
  }

  async exchangeLoginGrant(
    grantToken: string,
    opts?: { serverUrl?: string; applySession?: boolean }
  ): Promise<PluginLoginExchangeResult> {
    const token = String(grantToken || '').trim()
    if (!token) return { ok: false, message: '缺少 grantToken' }
    const auth = useAuthStore.getState()
    const serverUrl = String(opts?.serverUrl || auth.serverUrl || '').replace(/\/$/, '')
    const res = await fetch(`${serverUrl}/api/v1/auth/plugin-login/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantToken: token })
    })
    const data = (await res.json()) as PluginLoginExchangeResult
    if (!res.ok || !data.ok || !data.token) {
      return { ok: false, message: data.message || '插件登录失败' }
    }
    if (opts?.applySession !== false) {
      useAuthStore.getState().applySession({
        token: data.token,
        user: data.user as never,
        permissions: data.permissions,
        deviceAcl: data.deviceAcl,
        needsSsoBind: data.needsSsoBind,
        requireBinding: data.requireBinding
      })
    }
    return data
  }

  registerSlot(
    name: string,
    render: SlotRenderer,
    opts?: { order?: number; plugin?: string }
  ): string {
    const id = `s${++this.slotSeq}`
    const list = this.slots.get(name) || []
    list.push({ id, order: opts?.order ?? 0, render, plugin: opts?.plugin })
    list.sort((a, b) => a.order - b.order)
    this.slots.set(name, list)
    this.emit('slot:change', { name })
    return id
  }

  unregisterSlot(name: string, id: string): void {
    const list = (this.slots.get(name) || []).filter((x) => x.id !== id)
    this.slots.set(name, list)
    this.emit('slot:change', { name })
  }

  getSlotEntries(name: string): SlotEntry[] {
    return (this.slots.get(name) || []).slice()
  }

  hasReplace(name: string): boolean {
    const replace = `${name}.replace`.replace(/\.replace\.replace$/, '.replace')
    // also check exact *.replace slots
    return this.getSlotEntries(name).length > 0 && name.endsWith('.replace')
      ? true
      : this.getSlotEntries(replace).length > 0 || this.getSlotEntries(name).some(() => false)
  }

  /** True if a replace-slot has content for this area (e.g. login.page → login.page.replace) */
  shouldReplace(base: string): boolean {
    const key = base.endsWith('.replace') ? base : `${base}.replace`
    return this.getSlotEntries(key).length > 0
  }

  patchNav(fn: NavPatchFn): void {
    this.navPatches.push(fn)
    this.emit('nav:change', null)
  }

  applyNav(items: PluginUiNavItem[]): PluginUiNavItem[] {
    let cur = items.filter((i) => !this.hideNav.has(i.key))
    for (const fn of this.navPatches) {
      try {
        cur = fn(cur) || cur
      } catch (e) {
        console.error('[HanyePlugin] patchNav', e)
      }
    }
    return cur
  }

  hideNavKeys(keys: string[]): void {
    keys.forEach((k) => this.hideNav.add(k))
    this.emit('nav:change', null)
  }

  getHiddenNavKeys(): string[] {
    return Array.from(this.hideNav)
  }

  patchPermissions(fn: PermPatchFn): void {
    this.permPatches.push(fn)
    this.emit('permissions:change', null)
  }

  applyPermissions(perms: string[], user: unknown): string[] {
    let cur = perms.slice()
    for (const fn of this.permPatches) {
      try {
        cur = fn(cur, user) || cur
      } catch (e) {
        console.error('[HanyePlugin] patchPermissions', e)
      }
    }
    return cur
  }

  patchTheme( partial: ThemePatch): void {
    this.theme = { ...this.theme, ...partial }
    this.emit('theme:change', this.theme)
  }

  getTheme(): ThemePatch {
    return { ...this.theme }
  }

  /** Register Soft Settings nav tab; use after/before/order to place anywhere */
  registerSettingsTab(tab: PluginSettingsTab): void {
    const key = String(tab.key || '').trim()
    if (!key) return
    const reserved = new Set(Object.keys(SETTINGS_TAB_ORDER))
    if (reserved.has(key)) {
      console.warn('[HanyePlugin] registerSettingsTab: reserved built-in key', key)
      return
    }
    this.settingsTabs = this.settingsTabs.filter((t) => t.key !== key)
    this.settingsTabs.push({
      ...tab,
      key,
      order: tab.order,
      adminOnly: tab.adminOnly !== false,
      after: tab.after ? String(tab.after).trim() : undefined,
      before: tab.before ? String(tab.before).trim() : undefined
    })
    this.emit('settings-tabs:change', this.settingsTabs.slice())
  }

  getSettingsTabs(): PluginSettingsTab[] {
    return this.settingsTabs.slice()
  }

  /** Resolve numeric sort key for a plugin settings tab */
  resolveSettingsTabOrder(tab: PluginSettingsTab): number {
    const offset = typeof tab.order === 'number' ? tab.order : 10
    const before = tab.before ? String(tab.before).trim() : ''
    const after = tab.after ? String(tab.after).trim() : ''
    if (before && SETTINGS_TAB_ORDER[before] != null) {
      return SETTINGS_TAB_ORDER[before]! - Math.max(1, offset)
    }
    if (after && SETTINGS_TAB_ORDER[after] != null) {
      return SETTINGS_TAB_ORDER[after]! + Math.max(1, offset)
    }
    // Absolute order when no anchor (e.g. 150 = between general=100 and enterprise=200)
    if (typeof tab.order === 'number' && !before && !after) return tab.order
    // Default: after 插件, before 说明
    return SETTINGS_TAB_ORDER.plugins + 50 + offset
  }

  /** Add / override a custom brand in 添加设备 dialog */
  registerAddDeviceBrand(def: AddDeviceBrandDef): void {
    const id = String(def.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
    if (!id) return
    this.addDeviceBrands = this.addDeviceBrands.filter((b) => b.id !== id)
    this.addDeviceBrands.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.addDeviceBrands.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('add-device:change', null)
  }

  getAddDeviceBrands(tech?: 'fdm' | 'resin'): AddDeviceBrandDef[] {
    const list = this.addDeviceBrands.slice()
    if (!tech) return list
    return list.filter((b) => !b.tech || b.tech === 'both' || b.tech === tech)
  }

  getAddDeviceBrand(id: string): AddDeviceBrandDef | undefined {
    const key = String(id || '')
      .trim()
      .toLowerCase()
    return this.addDeviceBrands.find((b) => b.id === key)
  }

  /** Extra form sections for any brand (built-in or plugin) */
  registerAddDeviceField(def: AddDeviceFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.addDeviceFields = this.addDeviceFields.filter((f) => f.id !== id)
    this.addDeviceFields.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both',
      brands: def.brands ?? '*'
    })
    this.addDeviceFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('add-device:change', null)
  }

  getAddDeviceFields(opts: { tech: 'fdm' | 'resin'; brand: string }): AddDeviceFieldDef[] {
    const brand = String(opts.brand || '')
      .trim()
      .toLowerCase()
    return this.addDeviceFields.filter((f) => {
      if (f.tech && f.tech !== 'both' && f.tech !== opts.tech) return false
      if (!f.brands || f.brands === '*') return true
      return f.brands.map((b) => String(b).toLowerCase()).includes(brand)
    })
  }

  /** Extra buttons on 勾选设备后的批量操作栏 */
  registerBatchAction(def: BatchActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.run !== 'function') return
    this.batchActions = this.batchActions.filter((a) => a.id !== id)
    this.batchActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both',
      requireChecked: def.requireChecked !== false
    })
    this.batchActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('batch:change', null)
  }

  getBatchActions(tech?: 'fdm' | 'resin'): BatchActionDef[] {
    const list = this.batchActions.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  /** Status / info widgets on the batch bar */
  registerBatchStatus(def: BatchStatusDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.batchStatuses = this.batchStatuses.filter((s) => s.id !== id)
    this.batchStatuses.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.batchStatuses.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('batch:change', null)
  }

  getBatchStatuses(tech?: 'fdm' | 'resin'): BatchStatusDef[] {
    const list = this.batchStatuses.slice()
    if (!tech) return list
    return list.filter((s) => !s.tech || s.tech === 'both' || s.tech === tech)
  }

  /** Extra brands in 耗材管理 brand filter / form select */
  registerFilamentBrand(def: FilamentBrandDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.name) return
    this.filamentBrands = this.filamentBrands.filter((b) => b.id !== id)
    this.filamentBrands.push({
      ...def,
      id,
      kind: def.kind || 'both'
    })
    this.emit('filament:change', null)
  }

  getFilamentBrands(tech?: 'fdm' | 'resin'): FilamentBrandDef[] {
    const list = this.filamentBrands.slice()
    if (!tech) return list
    return list.filter((b) => !b.kind || b.kind === 'both' || b.kind === tech)
  }

  /** Extra materials in 耗材管理 */
  registerFilamentMaterial(def: FilamentMaterialDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || (def.category !== 'fdm' && def.category !== 'resin')) return
    this.filamentMaterials = this.filamentMaterials.filter((m) => m.id !== id)
    this.filamentMaterials.push({ ...def, id })
    this.emit('filament:change', null)
  }

  getFilamentMaterials(tech?: 'fdm' | 'resin'): FilamentMaterialDef[] {
    const list = this.filamentMaterials.slice()
    if (!tech) return list
    return list.filter((m) => m.category === tech)
  }

  /** Extra fields in add/edit spool modal */
  registerFilamentField(def: FilamentFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.filamentFields = this.filamentFields.filter((f) => f.id !== id)
    this.filamentFields.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both',
      mode: def.mode || 'both'
    })
    this.filamentFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('filament:change', null)
  }

  getFilamentFields(opts: {
    tech: 'fdm' | 'resin'
    mode: 'create' | 'edit'
  }): FilamentFieldDef[] {
    return this.filamentFields.filter((f) => {
      if (f.tech && f.tech !== 'both' && f.tech !== opts.tech) return false
      if (f.mode && f.mode !== 'both' && f.mode !== opts.mode) return false
      return true
    })
  }

  /** Extra table columns */
  registerFilamentColumn(def: FilamentColumnDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || typeof def.render !== 'function') return
    this.filamentColumns = this.filamentColumns.filter((c) => c.id !== id)
    this.filamentColumns.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.filamentColumns.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('filament:change', null)
  }

  getFilamentColumns(tech?: 'fdm' | 'resin'): FilamentColumnDef[] {
    const list = this.filamentColumns.slice()
    if (!tech) return list
    return list.filter((c) => !c.tech || c.tech === 'both' || c.tech === tech)
  }

  /** Extra row action buttons */
  registerFilamentRowAction(def: FilamentRowActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.filamentRowActions = this.filamentRowActions.filter((a) => a.id !== id)
    this.filamentRowActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.filamentRowActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('filament:change', null)
  }

  getFilamentRowActions(tech?: 'fdm' | 'resin'): FilamentRowActionDef[] {
    const list = this.filamentRowActions.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  /** Extra toolbar buttons (next to FDM/树脂 tabs) */
  registerFilamentToolbarAction(def: FilamentToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.filamentToolbarActions = this.filamentToolbarActions.filter((a) => a.id !== id)
    this.filamentToolbarActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.filamentToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('filament:change', null)
  }

  getFilamentToolbarActions(tech?: 'fdm' | 'resin'): FilamentToolbarActionDef[] {
    const list = this.filamentToolbarActions.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  registerQuoteMaterialPreset(def: QuoteMaterialPresetDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || (def.tech !== 'fdm' && def.tech !== 'resin')) return
    this.quoteMaterialPresets = this.quoteMaterialPresets.filter((m) => m.id !== id)
    this.quoteMaterialPresets.push({
      ...def,
      id,
      pricePerKg: Math.max(0, Number(def.pricePerKg) || 0)
    })
    this.emit('quote:change', null)
  }

  getQuoteMaterialPresets(tech?: 'fdm' | 'resin'): QuoteMaterialPresetDef[] {
    const list = this.quoteMaterialPresets.slice()
    if (!tech) return list
    return list.filter((m) => m.tech === tech)
  }

  registerQuotePrinterPreset(def: QuotePrinterPresetDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label) return
    this.quotePrinterPresets = this.quotePrinterPresets.filter((p) => p.id !== id)
    this.quotePrinterPresets.push({
      ...def,
      id,
      watts: Math.max(1, Number(def.watts) || 1)
    })
    this.emit('quote:change', null)
  }

  getQuotePrinterPresets(): QuotePrinterPresetDef[] {
    return this.quotePrinterPresets.slice()
  }

  registerQuoteField(def: QuoteFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.quoteFields = this.quoteFields.filter((f) => f.id !== id)
    this.quoteFields.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteFields(tech?: 'fdm' | 'resin'): QuoteFieldDef[] {
    const list = this.quoteFields.slice()
    if (!tech) return list
    return list.filter((f) => !f.tech || f.tech === 'both' || f.tech === tech)
  }

  registerQuoteOptionField(def: QuoteOptionFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.quoteOptionFields = this.quoteOptionFields.filter((f) => f.id !== id)
    this.quoteOptionFields.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteOptionFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteOptionFields(tech?: 'fdm' | 'resin'): QuoteOptionFieldDef[] {
    const list = this.quoteOptionFields.slice()
    if (!tech) return list
    return list.filter((f) => !f.tech || f.tech === 'both' || f.tech === tech)
  }

  registerQuoteColumn(def: QuoteColumnDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || typeof def.render !== 'function') return
    this.quoteColumns = this.quoteColumns.filter((c) => c.id !== id)
    this.quoteColumns.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteColumns.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteColumns(tech?: 'fdm' | 'resin'): QuoteColumnDef[] {
    const list = this.quoteColumns.slice()
    if (!tech) return list
    return list.filter((c) => !c.tech || c.tech === 'both' || c.tech === tech)
  }

  registerQuoteAction(def: QuoteActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.quoteActions = this.quoteActions.filter((a) => a.id !== id)
    this.quoteActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteActions(tech?: 'fdm' | 'resin'): QuoteActionDef[] {
    const list = this.quoteActions.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  registerQuoteToolbarAction(def: QuoteToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.quoteToolbarActions = this.quoteToolbarActions.filter((a) => a.id !== id)
    this.quoteToolbarActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteToolbarActions(tech?: 'fdm' | 'resin'): QuoteToolbarActionDef[] {
    const list = this.quoteToolbarActions.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  registerQuoteCostAdjust(def: QuoteCostAdjustDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.adjust !== 'function') return
    this.quoteCostAdjusts = this.quoteCostAdjusts.filter((a) => a.id !== id)
    this.quoteCostAdjusts.push({
      ...def,
      id,
      order: def.order ?? 100,
      tech: def.tech || 'both'
    })
    this.quoteCostAdjusts.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote:change', null)
  }

  getQuoteCostAdjusts(tech?: 'fdm' | 'resin'): QuoteCostAdjustDef[] {
    const list = this.quoteCostAdjusts.slice()
    if (!tech) return list
    return list.filter((a) => !a.tech || a.tech === 'both' || a.tech === tech)
  }

  registerQuoteHistoryColumn(def: QuoteHistoryColumnDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || typeof def.render !== 'function') return
    this.quoteHistoryColumns = this.quoteHistoryColumns.filter((c) => c.id !== id)
    this.quoteHistoryColumns.push({ ...def, id, order: def.order ?? 100 })
    this.quoteHistoryColumns.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote-history:change', null)
  }

  getQuoteHistoryColumns(): QuoteHistoryColumnDef[] {
    return this.quoteHistoryColumns.slice()
  }

  registerQuoteHistoryRowAction(def: QuoteHistoryRowActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.quoteHistoryRowActions = this.quoteHistoryRowActions.filter((a) => a.id !== id)
    this.quoteHistoryRowActions.push({ ...def, id, order: def.order ?? 100 })
    this.quoteHistoryRowActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote-history:change', null)
  }

  getQuoteHistoryRowActions(): QuoteHistoryRowActionDef[] {
    return this.quoteHistoryRowActions.slice()
  }

  registerQuoteHistoryToolbarAction(def: QuoteHistoryToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.quoteHistoryToolbarActions = this.quoteHistoryToolbarActions.filter((a) => a.id !== id)
    this.quoteHistoryToolbarActions.push({ ...def, id, order: def.order ?? 100 })
    this.quoteHistoryToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote-history:change', null)
  }

  getQuoteHistoryToolbarActions(): QuoteHistoryToolbarActionDef[] {
    return this.quoteHistoryToolbarActions.slice()
  }

  registerQuoteHistoryFilter(def: QuoteHistoryFilterDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.quoteHistoryFilters = this.quoteHistoryFilters.filter((f) => f.id !== id)
    this.quoteHistoryFilters.push({ ...def, id, order: def.order ?? 100 })
    this.quoteHistoryFilters.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote-history:change', null)
  }

  getQuoteHistoryFilters(): QuoteHistoryFilterDef[] {
    return this.quoteHistoryFilters.slice()
  }

  registerQuoteHistoryDetailField(def: QuoteHistoryDetailFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.quoteHistoryDetailFields = this.quoteHistoryDetailFields.filter((f) => f.id !== id)
    this.quoteHistoryDetailFields.push({ ...def, id, order: def.order ?? 100 })
    this.quoteHistoryDetailFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('quote-history:change', null)
  }

  getQuoteHistoryDetailFields(): QuoteHistoryDetailFieldDef[] {
    return this.quoteHistoryDetailFields.slice()
  }

  registerMonitorToolbarAction(def: MonitorToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.monitorToolbarActions = this.monitorToolbarActions.filter((a) => a.id !== id)
    this.monitorToolbarActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      scope: def.scope || 'both'
    })
    this.monitorToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorToolbarActions(scope: 'wall' | 'zones'): MonitorToolbarActionDef[] {
    return this.monitorToolbarActions.filter(
      (a) => !a.scope || a.scope === 'both' || a.scope === scope
    )
  }

  registerMonitorTileAction(def: MonitorTileActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.monitorTileActions = this.monitorTileActions.filter((a) => a.id !== id)
    this.monitorTileActions.push({
      ...def,
      id,
      order: def.order ?? 100,
      scope: def.scope || 'both'
    })
    this.monitorTileActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorTileActions(scope: 'wall' | 'zones'): MonitorTileActionDef[] {
    return this.monitorTileActions.filter(
      (a) => !a.scope || a.scope === 'both' || a.scope === scope
    )
  }

  registerMonitorTileExtra(def: MonitorTileExtraDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.monitorTileExtras = this.monitorTileExtras.filter((e) => e.id !== id)
    this.monitorTileExtras.push({
      ...def,
      id,
      order: def.order ?? 100,
      scope: def.scope || 'both',
      place: def.place || 'footer'
    })
    this.monitorTileExtras.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorTileExtras(
    scope: 'wall' | 'zones',
    place?: 'header' | 'footer'
  ): MonitorTileExtraDef[] {
    return this.monitorTileExtras.filter((e) => {
      if (e.scope && e.scope !== 'both' && e.scope !== scope) return false
      if (place && (e.place || 'footer') !== place) return false
      return true
    })
  }

  registerMonitorWallFilter(def: MonitorWallFilterDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.match !== 'function') return
    this.monitorWallFilters = this.monitorWallFilters.filter((f) => f.id !== id)
    this.monitorWallFilters.push({ ...def, id, order: def.order ?? 100 })
    this.monitorWallFilters.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorWallFilters(): MonitorWallFilterDef[] {
    return this.monitorWallFilters.slice()
  }

  registerMonitorCameraField(def: MonitorCameraFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.monitorCameraFields = this.monitorCameraFields.filter((f) => f.id !== id)
    this.monitorCameraFields.push({ ...def, id, order: def.order ?? 100 })
    this.monitorCameraFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorCameraFields(): MonitorCameraFieldDef[] {
    return this.monitorCameraFields.slice()
  }

  /** Manufacturer / cloud / custom camera source type for 区域监控 */
  registerMonitorCameraSource(def: MonitorCameraSourceDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label) return
    if (id === 'http' || id === 'stream') return
    this.monitorCameraSources = this.monitorCameraSources.filter((s) => s.id !== id)
    this.monitorCameraSources.push({
      ...def,
      id,
      order: def.order ?? 100,
      hideUrlFields: def.hideUrlFields !== false
    })
    this.monitorCameraSources.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorCameraSources(): MonitorCameraSourceDef[] {
    return this.monitorCameraSources.slice()
  }

  getMonitorCameraSource(id: string): MonitorCameraSourceDef | undefined {
    const key = String(id || '')
      .trim()
      .toLowerCase()
    return this.monitorCameraSources.find((s) => s.id.toLowerCase() === key)
  }

  /** Inject extra live tiles into a zone (e.g. vendor cloud list) */
  registerMonitorZoneProvider(def: MonitorZoneProviderDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.listTiles !== 'function') return
    this.monitorZoneProviders = this.monitorZoneProviders.filter((p) => p.id !== id)
    this.monitorZoneProviders.push({ ...def, id, order: def.order ?? 100 })
    this.monitorZoneProviders.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('monitor:change', null)
  }

  getMonitorZoneProviders(): MonitorZoneProviderDef[] {
    return this.monitorZoneProviders.slice()
  }

  registerUserColumn(def: UserColumnDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || typeof def.render !== 'function') return
    this.userColumns = this.userColumns.filter((c) => c.id !== id)
    this.userColumns.push({ ...def, id, order: def.order ?? 100 })
    this.userColumns.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('users:change', null)
  }

  getUserColumns(): UserColumnDef[] {
    return this.userColumns.slice()
  }

  registerUserToolbarAction(def: UserToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.userToolbarActions = this.userToolbarActions.filter((a) => a.id !== id)
    this.userToolbarActions.push({ ...def, id, order: def.order ?? 100 })
    this.userToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('users:change', null)
  }

  getUserToolbarActions(): UserToolbarActionDef[] {
    return this.userToolbarActions.slice()
  }

  registerUserRowAction(def: UserRowActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.userRowActions = this.userRowActions.filter((a) => a.id !== id)
    this.userRowActions.push({ ...def, id, order: def.order ?? 100 })
    this.userRowActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('users:change', null)
  }

  getUserRowActions(): UserRowActionDef[] {
    return this.userRowActions.slice()
  }

  registerUserFormField(def: UserFormFieldDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.render !== 'function') return
    this.userFormFields = this.userFormFields.filter((f) => f.id !== id)
    this.userFormFields.push({
      ...def,
      id,
      order: def.order ?? 100,
      mode: def.mode || 'both'
    })
    this.userFormFields.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('users:change', null)
  }

  getUserFormFields(mode: 'create' | 'edit'): UserFormFieldDef[] {
    return this.userFormFields.filter(
      (f) => !f.mode || f.mode === 'both' || f.mode === mode
    )
  }

  registerUserPermGroup(def: UserPermGroupDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || !Array.isArray(def.options) || !def.options.length) return
    this.userPermGroups = this.userPermGroups.filter((g) => g.id !== id)
    this.userPermGroups.push({ ...def, id, order: def.order ?? 100 })
    this.userPermGroups.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('users:change', null)
  }

  getUserPermGroups(): UserPermGroupDef[] {
    return this.userPermGroups.slice()
  }

  registerPrintColumn(def: PrintColumnDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.title || typeof def.render !== 'function') return
    this.printColumns = this.printColumns.filter((c) => c.id !== id)
    this.printColumns.push({ ...def, id, order: def.order ?? 100 })
    this.printColumns.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('print:change', null)
  }

  getPrintColumns(tab?: string): PrintColumnDef[] {
    const list = this.printColumns.slice()
    if (!tab) return list
    return list.filter((c) => {
      const tabs = c.tabs || ['all']
      return tabs.includes('all') || tabs.includes(tab as 'pending')
    })
  }

  registerPrintToolbarAction(def: PrintToolbarActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.printToolbarActions = this.printToolbarActions.filter((a) => a.id !== id)
    this.printToolbarActions.push({ ...def, id, order: def.order ?? 100 })
    this.printToolbarActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('print:change', null)
  }

  getPrintToolbarActions(): PrintToolbarActionDef[] {
    return this.printToolbarActions.slice()
  }

  registerPrintRowAction(def: PrintRowActionDef): void {
    const id = String(def.id || '').trim()
    if (!id || !def.label || typeof def.run !== 'function') return
    this.printRowActions = this.printRowActions.filter((a) => a.id !== id)
    this.printRowActions.push({ ...def, id, order: def.order ?? 100 })
    this.printRowActions.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('print:change', null)
  }

  getPrintRowActions(tab?: string): PrintRowActionDef[] {
    const list = this.printRowActions.slice()
    if (!tab) return list
    return list.filter((a) => {
      const tabs = a.tabs || ['all']
      return tabs.includes('all') || tabs.includes(tab as 'pending')
    })
  }

  registerPrintFilter(def: PrintFilterDef): void {
    const id = String(def.id || '').trim()
    if (!id || typeof def.match !== 'function') return
    this.printFilters = this.printFilters.filter((f) => f.id !== id)
    this.printFilters.push({ ...def, id, order: def.order ?? 100 })
    this.printFilters.sort((a, b) => (a.order || 0) - (b.order || 0))
    this.emit('print:change', null)
  }

  getPrintFilters(): PrintFilterDef[] {
    return this.printFilters.slice()
  }

  /** Seed slots/assets from server manifest */
  hydrateFromAssets(assets: PluginUiAssets, mode: 'public' | 'app'): void {
    this.mode = mode
    this.assets = assets || {}
    if (assets?.theme) this.patchTheme(assets.theme)
    if (assets?.hideNavKeys?.length) this.hideNavKeys(assets.hideNavKeys)
    const slots = assets?.slots || {}
    for (const [name, htmls] of Object.entries(slots)) {
      for (const html of htmls || []) {
        this.registerSlot(name, html, { order: 0, plugin: 'server' })
      }
    }
  }

  /** Discuz $_G['setting']['plugins'] equivalent */
  hydratePlugins(
    plugins: Array<{
      identifier?: string
      id?: string
      name: string
      version: string
      available?: boolean
      modules?: unknown[]
    }>,
    i18n?: Record<string, Record<string, string>>,
    kernelVersion?: string
  ): void {
    this.pluginRegistry = (plugins || []).map((p) => ({
      id: String(p.identifier || p.id || ''),
      name: p.name,
      version: p.version,
      available: p.available !== false,
      modules: p.modules
    }))
    if (i18n) this.i18nMaps = i18n
    if (kernelVersion) this.kernelVersion = kernelVersion
  }

  getPlugins(): Array<{
    id: string
    name: string
    version: string
    available: boolean
    modules?: unknown[]
  }> {
    return this.pluginRegistry.slice()
  }

  getKernelVersion(): string {
    return this.kernelVersion
  }

  /** Translate plugin language key (language/*.json) */
  t(pluginId: string, key: string, fallback?: string): string {
    const map = this.i18nMaps[pluginId]
    if (!map) return fallback ?? key
    return map[key] ?? fallback ?? key
  }

  /** Open Discuz-style module URL helper */
  pluginModuleUrl(pluginId: string, moduleName: string): string {
    return `/plugin.php?id=${encodeURIComponent(pluginId)}:${encodeURIComponent(moduleName)}`
  }
}

export type HanyePluginApi = HanyePluginRuntime

declare global {
  interface Window {
    HanyePlugin?: HanyePluginRuntime
  }
}

let singleton: HanyePluginRuntime | null = null

export function getHanyePlugin(): HanyePluginRuntime {
  if (typeof window !== 'undefined' && window.HanyePlugin) {
    return window.HanyePlugin
  }
  if (!singleton) singleton = new HanyePluginRuntime()
  if (typeof window !== 'undefined') window.HanyePlugin = singleton
  return singleton
}

export function ensureHanyePlugin(): HanyePluginRuntime {
  return getHanyePlugin()
}
