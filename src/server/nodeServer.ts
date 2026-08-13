import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { ApiServer, defaultSettings, normalizeSettings, type AppSettings } from '../main/api/server'
import { UserStore } from '../main/auth/users'
import { PrintRequestStore } from '../main/auth/printRequests'
import { PresenceStore } from '../main/auth/presence'
import { newJwtSecret } from '../main/auth/jwt'
import { QuoteHistoryStore } from '../main/quote/historyStore'
import { QuoteSchemesStore } from '../main/quote/schemesStore'
import { setJsonProvider, readJsonArray, readJsonObject, writeJsonObject, writeJsonArray } from '../main/storage/jsonBridge'
import { setDevicePollMsGetter } from '../main/pollInterval'
import { initMysql, runSchemaMigration, getPool } from './db/pool'
import { createSyncMysqlJsonProvider, warmMysqlCache } from './storage/mysqlJson'
import {
  createMysqlPluginDataPersistence,
  createMysqlSingletonPersistence,
  warmMysqlMetaCaches
} from './storage/mysqlMetaStore'
import { createExtensionDbApi } from '../main/plugin/extensionDb'
import { MysqlUserStore } from './storage/mysqlUsers'
import { MysqlPrintRequestStore } from './storage/mysqlPrintRequests'
import { MysqlQuoteHistoryStore } from './storage/mysqlQuoteHistory'
import { MysqlQuoteSchemesStore } from './storage/mysqlQuoteSchemes'
import { getSecret, setSecret, deleteSecret } from './storage/secrets'
import { DeviceHost } from './device/host'
import { scanLanPrinters, cancelLanDiscover, type LanDiscoverOpts } from '../main/discover/lanScan'
import { discoverCameras, fetchSnapshot } from '../main/camera/proxy'
import { grabBambuJpegFrame, parseBambuCameraUrl } from '../main/bambu/camera'
import { createFileOperationLogStore } from '../main/operationLogs/fileStore'
import { MysqlOperationLogStore } from './storage/mysqlOperationLogs'
import { VisionMonitor } from '../main/ai/visionMonitor'
import { mergeAiVisionSettings } from '../shared/aiVision'
import { mergeAlertNotifySettings } from '../shared/alertNotify'
import { PluginManager } from '../main/plugin/manager'
import { DeviceLockStore } from '../main/plugin/deviceLocks'
import { resolvePublicBaseUrl } from '../main/plugin/kernel/ContextFactory'
import { setPluginDbHooks, patchPoolWithPluginHooks } from '../main/plugin/kernel/dbHooks'
import { setPluginJsonHooks } from '../main/plugin/kernel/jsonHooks'
import { ThemeManager } from '../main/theme/manager'
import { NavConfigStore } from '../main/nav/navConfigStore'
import { DEFAULT_THEME_ID } from '../shared/themePack'
import { bundledPluginsDir, bundledThemesDir } from '../shared/repoLayout'
import { dispatchAlertNotify } from '../main/alert/dispatcher'
import type { AlertEventKind } from '../shared/alertNotify'

const DATA_ROOT = resolve(process.env.DATA_ROOT || join(process.cwd(), 'data'))
const DEVICES_PATH = join(DATA_ROOT, 'devices.json')
const FILAMENT_PATH = join(DATA_ROOT, 'filament-spools.json')
const MONITOR_ZONES_PATH = join(DATA_ROOT, 'monitor-zones.json')
const SETTINGS_PATH = join(DATA_ROOT, 'app-settings.json')
const LOGS_PATH = join(DATA_ROOT, 'operation-logs.jsonl')
const USE_MYSQL = process.env.USE_MYSQL === '1'

function readPackageVersion(): string {
  try {
    const candidates = [
      join(process.cwd(), 'package.json'),
      join(__dirname, '../../../package.json'),
      join(__dirname, '../../../../package.json')
    ]
    for (const p of candidates) {
      if (!existsSync(p)) continue
      const j = JSON.parse(readFileSync(p, 'utf8')) as { version?: string }
      const v = String(j.version || '').trim()
      if (v) return v
    }
  } catch {
    /* ignore */
  }
  return '1.2.0'
}

const APP_VERSION = process.env.APP_VERSION || readPackageVersion()

type LanDiscoverState = {
  phase: 'idle' | 'scanning' | 'done' | 'cancelled' | 'error'
  scanned: number
  total: number
  found: number
  message?: string
  hits: unknown[]
}

let lanDiscoverState: LanDiscoverState = {
  phase: 'idle',
  scanned: 0,
  total: 0,
  found: 0,
  hits: []
}
let lanDiscoverRunning = false

function ensureDirs(): void {
  mkdirSync(DATA_ROOT, { recursive: true })
}

function deviceHost(d: Record<string, unknown>): string {
  if (typeof d.bambuHost === 'string' && d.bambuHost.trim()) return d.bambuHost.trim()
  const base = typeof d.baseUrl === 'string' ? d.baseUrl : ''
  if (!base) return ''
  try {
    return new URL(base.includes('://') ? base : `http://${base}`).hostname
  } catch {
    return base.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]
  }
}

function loadAppSettings(): AppSettings {
  ensureDirs()
  const raw = readJsonObject(SETTINGS_PATH)
  if (!raw) {
    const next = defaultSettings()
    writeJsonObject(SETTINGS_PATH, next as unknown as Record<string, unknown>)
    return next
  }
  return normalizeSettings(raw)
}

function saveAppSettings(v: AppSettings): void {
  writeJsonObject(SETTINGS_PATH, v as unknown as Record<string, unknown>)
}

function readDeviceRows(): Array<Record<string, unknown>> {
  return readJsonArray(DEVICES_PATH) as Array<Record<string, unknown>>
}

function getLogRows(opts?: { limit?: number; deviceId?: string }): unknown[] {
  return operationLogStore.list(opts)
}

function clearLogs(): void {
  operationLogStore.clear()
}

function appendLog(entry: import('../shared/operationLog').OperationLog): void {
  operationLogStore.append(entry)
}

let operationLogStore: ReturnType<typeof createFileOperationLogStore> | MysqlOperationLogStore =
  createFileOperationLogStore(LOGS_PATH)

async function bootstrap(): Promise<void> {
  ensureDirs()

  if (USE_MYSQL) {
    await initMysql()
    await runSchemaMigration()
    await warmMysqlCache({
      devices: DEVICES_PATH,
      filament: FILAMENT_PATH,
      monitor: MONITOR_ZONES_PATH,
      settings: SETTINGS_PATH
    })
    await warmMysqlMetaCaches()
    setJsonProvider(
      createSyncMysqlJsonProvider({
        devices: DEVICES_PATH,
        filament: FILAMENT_PATH,
        monitor: MONITOR_ZONES_PATH
      })
    )
    console.log('[node-server] MySQL storage enabled (incl. nav / plugins / themes / plugin_data)')
  } else {
    setJsonProvider(null)
    console.log('[node-server] File storage mode')
  }

  let appSettings = loadAppSettings()
  appSettings = normalizeSettings({
    ...appSettings,
    apiEnabled: true,
    apiMode: 'control'
  })
  saveAppSettings(appSettings)

  setDevicePollMsGetter(() => {
    const sec = Number(appSettings.deviceRefreshSec)
    if (!Number.isFinite(sec) || sec < 1) return 3000
    return Math.min(60_000, Math.max(1000, Math.round(sec * 1000)))
  })

  const userStore = USE_MYSQL
    ? await (async () => {
        const s = new MysqlUserStore(newJwtSecret())
        await s.init()
        return s
      })()
    : new UserStore(DATA_ROOT, newJwtSecret())

  const printRequestStore = USE_MYSQL
    ? await (async () => {
        const s = new MysqlPrintRequestStore()
        await s.init()
        return s
      })()
    : new PrintRequestStore(DATA_ROOT)

  const quoteHistoryStore = USE_MYSQL
    ? await (async () => {
        const s = new MysqlQuoteHistoryStore()
        await s.init()
        return s
      })()
    : new QuoteHistoryStore(DATA_ROOT)

  const quoteSchemesStore = USE_MYSQL
    ? await (async () => {
        const s = new MysqlQuoteSchemesStore()
        await s.init()
        return s
      })()
    : new QuoteSchemesStore(DATA_ROOT)

  operationLogStore = USE_MYSQL
    ? await (async () => {
        const s = new MysqlOperationLogStore()
        await s.init()
        return s
      })()
    : createFileOperationLogStore(LOGS_PATH)

  const presenceStore = new PresenceStore()

  const secretsCache: Record<string, string> = {}
  if (USE_MYSQL) {
    const { getAllSecretsMap } = await import('./storage/secrets')
    Object.assign(secretsCache, await getAllSecretsMap())
  } else {
    const secretsPath = join(DATA_ROOT, 'secrets.json')
    if (existsSync(secretsPath)) {
      try {
        Object.assign(secretsCache, JSON.parse(readFileSync(secretsPath, 'utf8')))
      } catch {
        /* ignore */
      }
    }
  }

  const resolveSecret = async (key: string): Promise<string | null> => {
    if (secretsCache[key]) return secretsCache[key]
    if (USE_MYSQL) {
      const v = await getSecret(key)
      if (v) secretsCache[key] = v
      return v
    }
    return null
  }

  const storeSecret = (key: string, value: string): void => {
    secretsCache[key] = value
    if (USE_MYSQL) {
      void setSecret(key, value).catch((e) => console.error('[secret] set failed', e))
      return
    }
    const secretsPath = join(DATA_ROOT, 'secrets.json')
    writeFileSync(secretsPath, JSON.stringify(secretsCache, null, 2), 'utf8')
  }

  const deviceHostEngine = new DeviceHost({
    readDevices: readDeviceRows,
    getSecret: resolveSecret,
    setSecret: storeSecret
  })

  let visionMonitor: VisionMonitor | null = null

  let pluginManager: import('../main/plugin/manager').PluginManager
  pluginManager = new PluginManager({
    dataRoot: DATA_ROOT,
    bundledPluginsDir: bundledPluginsDir(__dirname),
    statePersistence: USE_MYSQL ? createMysqlSingletonPersistence('plugins_state') : undefined,
    pluginDataPersistence: USE_MYSQL ? createMysqlPluginDataPersistence() : undefined,
    getDbApi: USE_MYSQL
      ? (identifier) =>
          createExtensionDbApi({
            kind: 'plugin',
            id: identifier,
            enabled: true,
            getPool: () => {
              try {
                return getPool()
              } catch {
                return null
              }
            }
          })
      : undefined,
    getSettings: () => appSettings as unknown as Record<string, unknown>,
    patchSettings: async (patch) => {
      try {
        appSettings = normalizeSettings({ ...appSettings, ...patch })
        saveAppSettings(appSettings)
        return { ok: true }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
    getDevices: () => readDeviceRows(),
    saveDevices: (devices) => {
      writeJsonArray(DEVICES_PATH, devices as unknown[])
      void deviceHostEngine.reconnectAll().catch((e) => console.error('[devices] reconnect failed', e))
    },
    getStatuses: () => deviceHostEngine.statuses as Record<string, unknown>,
    controlDevice: (deviceId, payload) => deviceHostEngine.control(deviceId, payload),
    deviceOp: (req) => deviceHostEngine.deviceOp(req),
    startPrint: (req) => deviceHostEngine.startPrint(req),
    getDeviceCapabilities: (deviceId) => deviceHostEngine.getCapabilities(deviceId),
    sendGcode: (deviceId, script) => deviceHostEngine.sendGcode(deviceId, script),
    deviceLocks: new DeviceLockStore(DATA_ROOT),
    getPublicBaseUrl: () =>
      resolvePublicBaseUrl(appSettings as unknown as Record<string, unknown>),
    snapshotCamera: async (opts) => {
      try {
        if (opts.target) {
          const bambu = parseBambuCameraUrl(opts.target)
          if (bambu) {
            const snap = await grabBambuJpegFrame(bambu.host, bambu.code, 12000)
            if (!snap.ok) return snap
            return { ok: true, contentType: snap.contentType, base64: snap.base64 }
          }
          const snap = await fetchSnapshot(opts.target)
          if (!snap.ok) return snap
          return { ok: true, contentType: snap.contentType, base64: snap.base64 }
        }
        if (opts.deviceId) {
          const d = readDeviceRows().find((x) => String(x.id) === String(opts.deviceId))
          if (!d) return { ok: false, message: '设备不存在' }
          const secretKey = typeof d.secretKey === 'string' ? d.secretKey : ''
          const apiKey = secretKey
            ? secretsCache[secretKey] || (await resolveSecret(secretKey))
            : null
          if (String(d.brand) === 'bambu' && d.connectionMode !== 'cloud') {
            const host = deviceHost(d)
            const code = apiKey || ''
            if (host && code) {
              const snap = await grabBambuJpegFrame(host, code, 12000)
              if (snap.ok) return { ok: true, contentType: snap.contentType, base64: snap.base64 }
            }
          }
          const cams = await discoverCameras({
            brand: String(d.brand || ''),
            host: deviceHost(d) || undefined,
            baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : undefined,
            apiKey: apiKey || undefined
          })
          const cam =
            (opts.cameraId && cams.find((c) => c.id === opts.cameraId)) || cams[0]
          const url = cam?.snapshotUrl || cam?.streamUrl
          if (!url) return { ok: false, message: '无可用摄像头' }
          const snap = await fetchSnapshot(url, apiKey || undefined)
          if (!snap.ok) return snap
          return { ok: true, contentType: snap.contentType, base64: snap.base64 }
        }
        return { ok: false, message: '请提供 deviceId 或 target' }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
    dispatchAlert: (payload) =>
      dispatchAlertNotify(
        () => appSettings as never,
        {
          kind: (payload.kind as AlertEventKind) || 'printerError',
          title: payload.title,
          content: payload.content,
          deviceId: payload.deviceId,
          deviceName: payload.deviceName,
          at: new Date().toISOString()
        },
        {
          bypassCooldown: true,
          bypassEventGate: true,
          getPluginManager: () => pluginManager
        }
      ),
    appendLog: (entry) => {
      try {
        appendLog({
          time: new Date().toISOString(),
          deviceId: '',
          deviceName: 'plugin',
          action: 'plugin',
          result: 'ok',
          detail: String((entry as { message?: string }).message || JSON.stringify(entry))
        })
      } catch {
        /* ignore */
      }
    },
    getUserStore: () => userStore,
    touchPresence: (user) => presenceStore.touch(user),
    version: APP_VERSION
  })
  pluginManager.init()
  setPluginDbHooks({
    runHook: (name, value, ctx) => pluginManager.runHook(name, value, ctx)
  })
  setPluginJsonHooks({
    runHook: (name, value, ctx) => pluginManager.runHook(name, value, ctx)
  })
  if (USE_MYSQL) {
    try {
      patchPoolWithPluginHooks(getPool())
    } catch {
      /* ignore */
    }
  }

  const themeManager = new ThemeManager({
    dataRoot: DATA_ROOT,
    bundledThemesDir: bundledThemesDir(__dirname),
    statePersistence: USE_MYSQL ? createMysqlSingletonPersistence('themes_state') : undefined,
    getDbApi: USE_MYSQL
      ? (identifier) =>
          createExtensionDbApi({
            kind: 'theme',
            id: identifier,
            enabled: true,
            getPool: () => {
              try {
                return getPool()
              } catch {
                return null
              }
            }
          })
      : undefined,
    getSettings: () => appSettings as unknown as Record<string, unknown>,
    getActivePackId: () => String(appSettings.uiThemePack || DEFAULT_THEME_ID),
    setActivePackId: async (id) => {
      appSettings = normalizeSettings({ ...appSettings, uiThemePack: id })
      saveAppSettings(appSettings)
    },
    getActiveStyleId: () => String(appSettings.uiTheme || 'midnight'),
    setActiveStyleId: async (id) => {
      appSettings = normalizeSettings({ ...appSettings, uiTheme: id })
      saveAppSettings(appSettings)
    }
  })
  themeManager.init()

  const navConfigStore = new NavConfigStore(
    DATA_ROOT,
    USE_MYSQL ? createMysqlSingletonPersistence('nav_config') : null
  )

  const apiServer = new ApiServer({
    getDevicesPath: () => DEVICES_PATH,
    getFilamentPath: () => FILAMENT_PATH,
    getMonitorZonesPath: () => MONITOR_ZONES_PATH,
    getSettings: () => appSettings,
    getStatuses: () => deviceHostEngine.statuses,
    onControl: (deviceId, payload) => deviceHostEngine.control(deviceId, payload),
    onDeviceOp: (req) => deviceHostEngine.deviceOp(req),
    onGetDeviceCapabilities: (deviceId) => deviceHostEngine.getCapabilities(deviceId),
    onBatchPrint: (payload) => deviceHostEngine.batchPrint(payload),
    onDevicesChanged: () => {
      void deviceHostEngine.reconnectAll().catch((e) => console.error('[devices] reconnect failed', e))
    },
    listWallCameras: async () => {
      const out: Array<{
        deviceId: string
        name: string
        brand: string
        cameras: Array<{ id: string; name: string; streamUrl: string; snapshotUrl?: string }>
      }> = []
      for (const d of readDeviceRows()) {
        const id = String(d.id || '')
        if (!id) continue
        try {
          const secretKey = typeof d.secretKey === 'string' ? d.secretKey : ''
          const apiKey = secretKey ? secretsCache[secretKey] || (await resolveSecret(secretKey)) : null
          const cams = await discoverCameras({
            brand: String(d.brand || ''),
            host: deviceHost(d) || undefined,
            baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : undefined,
            apiKey: apiKey || undefined
          })
          if (!cams.length) continue
          out.push({
            deviceId: id,
            name: String(d.name || id),
            brand: String(d.brand || ''),
            cameras: cams
          })
        } catch {
          /* ignore one device */
        }
      }
      return out
    },
    listDeviceCameras: async (deviceId) => {
      const d = readDeviceRows().find((x) => String(x.id || '') === deviceId)
      if (!d) return null
      const secretKey = typeof d.secretKey === 'string' ? d.secretKey : ''
      const apiKey = secretKey ? secretsCache[secretKey] || (await resolveSecret(secretKey)) : null
      const cams = await discoverCameras({
        brand: String(d.brand || ''),
        host: deviceHost(d) || undefined,
        baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : undefined,
        apiKey: apiKey || undefined
      })
      return {
        deviceId,
        name: String(d.name || deviceId),
        brand: String(d.brand || ''),
        cameras: cams
      }
    },
    takeCameraSnapshot: async (url, apiKey) => {
      try {
        let target = url
        try {
          const u = new URL(url)
          if (u.hostname === '127.0.0.1' && u.searchParams.get('url')) {
            target = u.searchParams.get('url') || target
          }
        } catch {
          /* ignore */
        }
        const bambu = parseBambuCameraUrl(target)
        if (bambu) {
          const snap = await grabBambuJpegFrame(bambu.host, bambu.code, 12000)
          if (!snap.ok) return snap
          return { ok: true as const, contentType: snap.contentType, base64: snap.base64 }
        }
        const snap = await fetchSnapshot(target, apiKey)
        if (!snap.ok) return snap
        return { ok: true as const, contentType: snap.contentType, base64: snap.base64 }
      } catch (e) {
        return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
      }
    },
    getDeviceApiKey: (deviceId) => {
      const d = readDeviceRows().find((x) => String(x.id || '') === deviceId)
      if (!d || typeof d.secretKey !== 'string' || !d.secretKey) return null
      return secretsCache[d.secretKey] ?? null
    },
    setDeviceSecret: (secretKey, value) => {
      storeSecret(secretKey, value)
    },
    deleteDeviceSecret: (secretKey) => {
      void deleteSecret(secretKey).catch((e) => console.error('[secret] delete failed', e))
    },
    startLanDiscover: async (opts) => {
      if (lanDiscoverRunning) return { ok: false, message: 'LAN discover already running' }
      lanDiscoverRunning = true
      lanDiscoverState = { phase: 'scanning', scanned: 0, total: 0, found: 0, hits: [], message: 'Scanning…' }
      void scanLanPrinters(
        { brands: opts?.brands as LanDiscoverOpts['brands'] },
        (progress) => {
          lanDiscoverState = {
            ...lanDiscoverState,
            phase: progress.phase === 'scanning' ? 'scanning' : progress.phase,
            scanned: progress.scanned,
            total: progress.total,
            found: progress.found,
            message: progress.message
          }
        }
      )
        .then((result) => {
          const hits = result.hits || []
          lanDiscoverState = {
            phase: result.ok ? 'done' : 'error',
            scanned: lanDiscoverState.scanned,
            total: lanDiscoverState.total,
            found: hits.length,
            hits,
            message: result.message || (result.ok ? `Found ${hits.length}` : 'Scan failed')
          }
        })
        .catch((err) => {
          lanDiscoverState = {
            ...lanDiscoverState,
            phase: 'error',
            message: err instanceof Error ? err.message : String(err),
            hits: []
          }
        })
        .finally(() => {
          lanDiscoverRunning = false
        })
      return { ok: true }
    },
    getLanDiscover: () => ({ ...lanDiscoverState }),
    cancelLanDiscover: () => {
      cancelLanDiscover()
      lanDiscoverState = { ...lanDiscoverState, phase: 'cancelled', message: 'Cancelled' }
      lanDiscoverRunning = false
    },
    getLogs: (opts) => getLogRows(opts),
    clearLogs: () => clearLogs(),
    appendLog: (entry) => appendLog(entry),
    patchSettings: async (patch) => {
      try {
        const mergedPatch = { ...patch } as Record<string, unknown>
        if ('aiVision' in mergedPatch) {
          mergedPatch.aiVision = mergeAiVisionSettings(
            appSettings.aiVision,
            mergedPatch.aiVision
          )
        }
        if ('alertNotify' in mergedPatch) {
          mergedPatch.alertNotify = mergeAlertNotifySettings(
            appSettings.alertNotify,
            mergedPatch.alertNotify
          )
        }
        appSettings = normalizeSettings({ ...appSettings, ...mergedPatch })
        saveAppSettings(appSettings)
        // Web server always stays up (Open API module removed; no toggle to stop HTTP)
        if (!apiServer.status().running) await apiServer.start()
        return { ok: true, settings: appSettings }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : String(e) }
      }
    },
    getUserStore: () => userStore as never,
    getPrintRequestStore: () => printRequestStore as never,
    getPresenceStore: () => presenceStore,
    onApprovedPrint: (req) => deviceHostEngine.approvedPrint(req),
    onStartPrintJob: (req) => deviceHostEngine.approvedPrint(req),
    allowLocalAdmin: true,
    onReconnectDevices: () => deviceHostEngine.reconnectAll(),
    getQuoteHistoryStore: () => quoteHistoryStore as never,
    getQuoteSchemesStore: () => quoteSchemesStore as never,
    getVisionMonitor: () => visionMonitor,
    getPluginManager: () => pluginManager,
    getThemeManager: () => themeManager,
    getNavConfigStore: () => navConfigStore,
    version: APP_VERSION
  })

  const listWallForAi = async () => {
    const out: Array<{
      deviceId: string
      name: string
      cameras: Array<{ id: string; name: string; streamUrl: string; snapshotUrl?: string }>
    }> = []
    for (const d of readDeviceRows()) {
      const id = String(d.id || '')
      if (!id) continue
      try {
        const secretKey = typeof d.secretKey === 'string' ? d.secretKey : ''
        const apiKey = secretKey ? secretsCache[secretKey] || (await resolveSecret(secretKey)) : null
        const cams = await discoverCameras({
          brand: String(d.brand || ''),
          host: deviceHost(d) || undefined,
          baseUrl: typeof d.baseUrl === 'string' ? d.baseUrl : undefined,
          apiKey: apiKey || undefined
        })
        if (!cams.length) continue
        out.push({
          deviceId: id,
          name: String(d.name || id),
          cameras: cams
        })
      } catch {
        /* ignore */
      }
    }
    return out
  }

  const takeSnapForAi = async (url: string) => {
    try {
      let target = url
      try {
        const u = new URL(url)
        if (u.hostname === '127.0.0.1' && u.searchParams.get('url')) {
          target = u.searchParams.get('url') || target
        }
      } catch {
        /* ignore */
      }
      const bambu = parseBambuCameraUrl(target)
      if (bambu) {
        const snap = await grabBambuJpegFrame(bambu.host, bambu.code, 12000)
        if (!snap.ok) return snap
        return { ok: true as const, contentType: snap.contentType, base64: snap.base64 }
      }
      const snap = await fetchSnapshot(target)
      if (!snap.ok) return snap
      return { ok: true as const, contentType: snap.contentType, base64: snap.base64 }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }

  visionMonitor = new VisionMonitor({
    getSettings: () => appSettings,
    getDevices: () =>
      (readJsonArray(DEVICES_PATH) as Array<{ id: string; name?: string; aiVisionEnabled?: boolean }>).map(
        (d) => ({
          id: String(d.id),
          name: typeof d.name === 'string' ? d.name : undefined,
          aiVisionEnabled: d.aiVisionEnabled === false ? false : d.aiVisionEnabled === true ? true : undefined
        })
      ),
    listWallCameras: listWallForAi,
    takeCameraSnapshot: takeSnapForAi,
    controlDevice: (deviceId, payload) => deviceHostEngine.control(deviceId, payload),
    onAlert: (alert) => {
      void import('../main/alert/dispatcher')
        .then(({ buildAiVisionAlertPayload, dispatchAlertNotify }) =>
          dispatchAlertNotify(() => appSettings as never, buildAiVisionAlertPayload(alert))
        )
        .catch(() => undefined)
    }
  })
  visionMonitor.start()

  const status = await apiServer.start()
  console.log('[node-server] API started:', status.localUrls.join(', '))
  console.log('[node-server] Connecting printers…')
  await deviceHostEngine.bootstrap()
  console.log('[node-server] Device host ready')
  console.log('[node-server] AI vision monitor started')
}

void bootstrap().catch((e) => {
  console.error('[node-server] startup failed:', e)
  process.exit(1)
})
