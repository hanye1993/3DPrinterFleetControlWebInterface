import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  ConfigProvider,
  Drawer,
  Input,
  Layout,
  Space,
  Spin,
  Typography,
  message
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  FileSearchOutlined,
  MenuOutlined,
  LogoutOutlined
} from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import { deviceTech, selectVisibleDevices, useDeviceStore } from './stores/deviceStore'
import { SideNav } from './components/SideNav'
import { CustomHtmlPage } from './components/CustomHtmlPage'
import { BrandFilterBar } from './components/BrandFilterBar'
import { BatchPrintBar } from './components/BatchPrintBar'
import { BatchPrintModal } from './components/BatchPrintModal'
import { DeviceGrid } from './components/DeviceGrid'
import { AddDeviceModal } from './components/AddDeviceModal'
import { ForceChangePasswordGate } from './components/ForceChangePasswordGate'
import { DeviceDetailDrawer } from './components/DeviceDetailDrawer'
import { LogDrawer } from './components/LogDrawer'
import { WindowControls } from './components/WindowControls'
import { LoginPage } from './components/LoginPage'
import { BindSsoPage } from './components/BindSsoPage'
import { useFilamentStore, selectVisibleSpools } from './stores/filamentStore'
import { usePrintQueueStore } from './stores/printQueueStore'
import { useSettingsStore, resolveDeviceRefreshMs } from './stores/settingsStore'
import { useAuthStore, useAuthGrants } from './stores/authStore'
import { useMonitorStore } from './stores/monitorStore'
import { useNavConfigStore } from './stores/navConfigStore'
import { usePeriodicUpdateCheck } from './components/softSettings/SoftSettingsAbout'
import { applyAppearance, resolveUiTheme } from './theme/appearance'
import { ThemeLoader } from './theme/ThemeLoader'
import { ThemeAppShell } from './theme/ThemeAppShell'
import { ThemeSlot } from './theme/ThemeSlot'
import { ThemeFullSiteHost, hasFullSiteShell } from './theme/ThemeFullSiteHost'
import { useThemePackStore } from './theme/themePackStore'
import { isWebBrowser } from '@shared/platform'
import { appTitleSuffix, isRemoteDataMode } from './utils/appMode'
import { useIsMobile } from './hooks/useIsMobile'
import type { ControlPayload, PrinterTech } from './types/printer'
import appIcon from './assets/icon.png'
import {
  applySiteBranding,
  resolveSiteDisplayName,
  resolveSiteLogoUrl
} from './theme/siteBranding'
import { PluginLoader } from './plugins/PluginLoader'
import { PluginSlot } from './plugins/PluginSlot'
import { getHanyePlugin } from './plugins/runtime'

const FilamentManager = lazy(() =>
  import('./components/FilamentManager').then((m) => ({ default: m.FilamentManager }))
)
const MonitorWallPage = lazy(() =>
  import('./components/monitor/MonitorWallPage').then((m) => ({ default: m.MonitorWallPage }))
)
const MonitorZonesPage = lazy(() =>
  import('./components/monitor/MonitorZonesPage').then((m) => ({ default: m.MonitorZonesPage }))
)
const SoftSettingsPage = lazy(() =>
  import('./components/SoftSettingsPage').then((m) => ({ default: m.SoftSettingsPage }))
)
const PluginHostPage = lazy(() =>
  import('./components/PluginHostPage').then((m) => ({ default: m.PluginHostPage }))
)
const ToolsPage = lazy(() =>
  import('./components/ToolsPage').then((m) => ({ default: m.ToolsPage }))
)
const QuoteHistoryPage = lazy(() =>
  import('./components/QuoteHistoryPage').then((m) => ({ default: m.QuoteHistoryPage }))
)
const ModelSitesPage = lazy(() =>
  import('./components/ModelSitesPage').then((m) => ({ default: m.ModelSitesPage }))
)
const AiModelSitesPage = lazy(() =>
  import('./components/AiModelSitesPage').then((m) => ({ default: m.AiModelSitesPage }))
)
const UsersPage = lazy(() =>
  import('./components/UsersPage').then((m) => ({ default: m.UsersPage }))
)
const PrintApprovalPage = lazy(() =>
  import('./components/PrintApprovalPage').then((m) => ({ default: m.PrintApprovalPage }))
)

const { Header } = Layout

function PageFallback() {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <Spin tip="加载页面…" />
    </div>
  )
}

export default function App() {
  const init = useDeviceStore((s) => s.init)
  const reconnectAll = useDeviceStore((s) => s.reconnectAll)
  const setSearch = useDeviceStore((s) => s.setSearch)
  const search = useDeviceStore((s) => s.search)
  const filter = useDeviceStore((s) => s.filter)
  const section = useDeviceStore((s) => s.section)
  const loading = useDeviceStore((s) => s.loading)
  const bambuPluginHint = useDeviceStore((s) => s.bambuPluginHint)
  const devices = useDeviceStore((s) => s.devices)
  const selectedId = useDeviceStore((s) => s.selectedId)
  const selectDevice = useDeviceStore((s) => s.selectDevice)

  const printerTech: PrinterTech | null =
    section === 'fdm' ? 'fdm' : section === 'resin' ? 'resin' : null

  const { permissions, deviceAcl, can, canDevice, canOpenDevice } = useAuthGrants()

  const visible = useMemo(() => {
    if (!printerTech) return []
    const list = selectVisibleDevices({ devices, filter, search, tech: printerTech })
    return list.filter((d) => canDevice(d.id, 'view'))
  }, [devices, filter, search, printerTech, permissions, deviceAcl, canDevice])

  const sectionCount = useMemo(
    () =>
      printerTech
        ? devices.filter(
            (d) => deviceTech(d) === printerTech && canDevice(d.id, 'view')
          ).length
        : 0,
    [devices, printerTech, permissions, deviceAcl, canDevice]
  )

  const [addOpen, setAddOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const isMobile = useIsMobile(768)

  const control = useDeviceStore((s) => s.control)
  const settingsInit = useSettingsStore((s) => s.init)
  const deviceRefreshSec = useSettingsStore((s) => s.settings.deviceRefreshSec)
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme)
  const uiThemePack = useSettingsStore((s) => s.settings.uiThemePack)
  const uiBgMode = useSettingsStore((s) => s.settings.uiBgMode)
  const uiBgColor = useSettingsStore((s) => s.settings.uiBgColor)
  const uiBgImage = useSettingsStore((s) => s.settings.uiBgImage)
  const siteName = useSettingsStore((s) => s.settings.siteName)
  const siteTitle = useSettingsStore((s) => s.settings.siteTitle)
  const siteLogo = useSettingsStore((s) => s.settings.siteLogo)
  const siteFavicon = useSettingsStore((s) => s.settings.siteFavicon)
  const siteFooter = useSettingsStore((s) => s.settings.siteFooter)
  const themePackRevision = useThemePackStore((s) => s.revision)
  const packStyles = useThemePackStore((s) => s.active?.pack.styles)
  const activePackId = useThemePackStore((s) => s.active?.packId) || uiThemePack || 'default'
  const themeLayout = useThemePackStore((s) => s.active?.layout || 'classic')
  const themeSiteMode = useThemePackStore((s) => s.active?.siteMode || 'skin')
  const themeTemplateHtml = useThemePackStore((s) => s.templateHtml)
  const useFullSite = themeSiteMode === 'full' && hasFullSiteShell(themeTemplateHtml)
  const fullShellHtml = themeTemplateHtml['app.shell.replace'] || ''
  const uiThemeDef = useMemo(
    () => resolveUiTheme(uiTheme, packStyles),
    [uiTheme, packStyles, themePackRevision]
  )
  const navMode = themeLayout === 'topnav' && !useFullSite ? 'horizontal' : 'inline'

  const filamentSearch = useFilamentStore((s) => s.search)
  const setFilamentSearch = useFilamentStore((s) => s.setSearch)
  const openFilamentAdd = useFilamentStore((s) => s.openAddModal)
  const isFilament = section === 'filament'
  const isTools = section === 'tools'
  const isQuoteHistory = section === 'quoteHistory'
  const isMonitorWall = section === 'monitorWall'
  const isMonitorZones = section === 'monitorZones'
  const isModels = section === 'models'
  const isAiModels = section === 'aiModels'
  const isSettings = section === 'settings'
  const isUsers = section === 'users'
  const isPrintApprove = section === 'printApprove'
  const isPluginPage = typeof section === 'string' && section.startsWith('plugin:')
  const isCustomPage = typeof section === 'string' && section.startsWith('page:')
  const toolsVisitedRef = useRef(false)
  if (isTools) toolsVisitedRef.current = true
  const showToolsKeepAlive = toolsVisitedRef.current
  const pluginPageParts = isPluginPage ? section.slice('plugin:'.length).split(':') : []
  const pluginPageId = pluginPageParts[0] || ''
  const pluginPageModule = pluginPageParts[1] || 'page'

  const navCollapsed = useNavConfigStore((s) => s.collapsed)
  const navCollapsible = useNavConfigStore((s) => s.config.collapsible)
  const navInit = useNavConfigStore((s) => s.init)

  const filamentVisibleCount = useFilamentStore((s) =>
    isFilament
      ? selectVisibleSpools({
          spools: s.spools,
          tech: s.tech,
          search: s.search,
          brandFilter: s.brandFilter,
          materialFilter: s.materialFilter,
          lowStockOnly: s.lowStockOnly,
          showArchived: s.showArchived,
          lowStockThreshold: s.lowStockThreshold
        }).length
      : 0
  )
  const filamentActiveCount = useFilamentStore((s) =>
    isFilament ? s.spools.filter((x) => !x.archived).length : 0
  )

  const authReady = useAuthStore((s) => s.ready)
  const role = useAuthStore((s) => s.role)
  const authed = useAuthStore((s) => s.isAuthed())
  const needsSsoBind = useAuthStore((s) => s.needsSsoBind)
  const showLogsButton = useAuthStore((s) => {
    if (!isWebBrowser()) return s.role === 'server'
    if (!s.user) return false
    if (s.user.level === 'admin') return true
    return s.permissions.includes('*')
  })

  useEffect(() => {
    void useAuthStore.getState().init()
  }, [])

  useEffect(() => {
    if (!authReady || !authed) return
    void init()
    void settingsInit()
    void useFilamentStore.getState().init()
    void navInit()
  }, [authReady, authed, init, settingsInit, navInit])

  usePeriodicUpdateCheck(Boolean(authReady && authed))

  useEffect(() => {
    const root = document.documentElement
    if (navCollapsible && navCollapsed) root.classList.add('nav-rail-collapsed')
    else root.classList.remove('nav-rail-collapsed')
    return () => root.classList.remove('nav-rail-collapsed')
  }, [navCollapsible, navCollapsed])

  // Plugin theme patches → appearance
  useEffect(() => {
    const runtime = getHanyePlugin()
    const apply = () => {
      const t = runtime.getTheme()
      if (!t || !Object.keys(t).length) return
      const def = resolveUiTheme((t.uiTheme as string) || uiTheme, packStyles)
      applyAppearance({
        themeId: def.id,
        packId: activePackId,
        styleCss: def.css,
        bgMode: (t.uiBgMode as never) || uiBgMode,
        bgColor: t.uiBgColor || uiBgColor,
        bgImage: t.uiBgImage || uiBgImage
      })
    }
    apply()
    return runtime.on('theme:change', apply)
  }, [uiTheme, uiBgMode, uiBgColor, uiBgImage, packStyles, activePackId, authReady, authed])

  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.filament?.onChanged?.(() => {
      void useFilamentStore.getState().init()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  useEffect(() => {
    const def = resolveUiTheme(uiTheme, packStyles)
    applyAppearance({
      themeId: def.id,
      packId: activePackId,
      styleCss: def.css,
      bgMode: uiBgMode,
      bgColor: uiBgColor,
      bgImage: uiBgImage
    })
  }, [uiTheme, uiThemePack, uiBgMode, uiBgColor, uiBgImage, packStyles, activePackId, themePackRevision])

  useEffect(() => {
    applySiteBranding({ siteName, siteTitle, siteFavicon })
  }, [siteName, siteTitle, siteFavicon])

  // Server: push live device statuses into API for remote clients
  useEffect(() => {
    if (isRemoteDataMode()) return
    const push = () => {
      void window.electronAPI?.api?.pushStatuses(useDeviceStore.getState().statuses)
    }
    push()
    const t = window.setInterval(push, resolveDeviceRefreshMs({ deviceRefreshSec }))
    return () => window.clearInterval(t)
  }, [role, deviceRefreshSec])

  // Browser / client: SSE statuses when available; fallback poll for full device list.
  useEffect(() => {
    if (!isRemoteDataMode() || !authed) return
    const pullDevices = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void useDeviceStore
        .getState()
        .refreshFromServer({ silent: true })
        .catch(() => undefined)
    }
    pullDevices()

    let es: EventSource | null = null
    let pollTimer: number | null = null
    const token = useAuthStore.getState().token
    const base = useAuthStore.getState().serverUrl.replace(/\/$/, '')
    try {
      // EventSource cannot set Authorization header — pass token query for SSE only
      const qs = token ? `?access_token=${encodeURIComponent(token)}` : ''
      es = new EventSource(`${base}/api/v1/events${qs}`)
      es.addEventListener('statuses', (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            statuses?: Record<string, import('./types/printer').PrinterLiveStatus>
          }
          if (data.statuses) useDeviceStore.getState().applyStatusesFromServer(data.statuses)
        } catch {
          /* ignore */
        }
      })
      es.onerror = () => {
        /* keep poll as backup */
      }
      // Slower full refresh for device list / ACL changes
      pollTimer = window.setInterval(pullDevices, Math.max(15000, resolveDeviceRefreshMs({ deviceRefreshSec }) * 5))
    } catch {
      pollTimer = window.setInterval(pullDevices, resolveDeviceRefreshMs({ deviceRefreshSec }))
    }

    const onVis = () => {
      if (!document.hidden) pullDevices()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      es?.close()
      if (pollTimer) window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [role, authed, deviceRefreshSec])

  // Entering non-device pages: one-shot pull (mutate/save already updates; no deviceRefreshSec loop)
  useEffect(() => {
    if (!isRemoteDataMode() || !authed) return
    if (section === 'filament') {
      void useFilamentStore.getState().refreshFromServer({ silent: true }).catch(() => undefined)
    } else if (section === 'monitorWall' || section === 'monitorZones') {
      void useMonitorStore.getState().refreshFromServer({ silent: true }).catch(() => undefined)
    } else if (section === 'settings') {
      void useSettingsStore.getState().refreshFromServer({ silent: true }).catch(() => undefined)
    }
  }, [section, authed, role])

  // Occasional session/ACL check (kick / perm) — fixed cadence, not deviceRefreshSec
  useEffect(() => {
    if (!isRemoteDataMode() || !authed) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      void useAuthStore
        .getState()
        .refreshMe()
        .catch((err) => {
          if (!useAuthStore.getState().token) {
            message.warning(
              err instanceof Error && err.message
                ? err.message
                : '账号已被下线，请重新登录'
            )
          }
        })
    }
    tick()
    const t = window.setInterval(tick, 30_000)
    return () => window.clearInterval(t)
  }, [role, authed])

  // Print queue: refresh only while on that page (not tied to device interval)
  useEffect(() => {
    if (section !== 'printApprove' || !authed) return
    const pull = () => {
      void usePrintQueueStore
        .getState()
        .refresh({ silent: true })
        .catch(() => undefined)
    }
    pull()
    const t = window.setInterval(pull, 8_000)
    return () => window.clearInterval(t)
  }, [section, authed, role])

  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.api?.onControlRequest((req) => {
      void (async () => {
        try {
          await control(req.deviceId, req.payload as ControlPayload)
          window.electronAPI?.api?.replyControl({ requestId: req.requestId, ok: true })
        } catch (err) {
          window.electronAPI?.api?.replyControl({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [control, role])

  // Server: handle remote reconnect requests from API clients
  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.api?.onReconnectRequest?.((req) => {
      void (async () => {
        try {
          await reconnectAll()
          void window.electronAPI?.api?.pushStatuses(useDeviceStore.getState().statuses)
          window.electronAPI?.api?.replyReconnect?.({ requestId: req.requestId, ok: true })
        } catch (err) {
          window.electronAPI?.api?.replyReconnect?.({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [reconnectAll, role])

  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.devices?.onChanged?.(() => {
      void init()
    })
    return () => {
      unsub?.()
    }
  }, [init, role])

  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.api?.onDeviceOpRequest?.((req) => {
      void (async () => {
        const adapters = useDeviceStore.getState().adapters
        const adapter = adapters[req.deviceId]
        try {
          if (!adapter) throw new Error('设备未连接')
          if (req.op === 'listFiles') {
            const files = await adapter.listFiles()
            window.electronAPI?.api?.replyDeviceOp({
              requestId: req.requestId,
              ok: true,
              files
            })
            return
          }
          if (req.op === 'uploadFile') {
            const filename = req.filename || 'upload.bin'
            const bin = Uint8Array.from(atob(req.contentBase64 || ''), (c) => c.charCodeAt(0))
            const file = new File([bin], filename)
            await adapter.uploadFile(file)
            window.electronAPI?.api?.replyDeviceOp({ requestId: req.requestId, ok: true })
            return
          }
          if (req.op === 'downloadFile') {
            const remotePath = req.remotePath || ''
            const buf = await adapter.downloadFile(remotePath)
            const bytes = new Uint8Array(buf)
            let binary = ''
            for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
            window.electronAPI?.api?.replyDeviceOp({
              requestId: req.requestId,
              ok: true,
              filename: remotePath.split('/').pop() || 'download.bin',
              contentBase64: btoa(binary),
              contentType: 'application/octet-stream'
            })
            return
          }
          throw new Error(`Unknown op ${req.op}`)
        } catch (err) {
          window.electronAPI?.api?.replyDeviceOp({
            requestId: req.requestId,
            ok: false,
            message: err instanceof Error ? err.message : String(err)
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  useEffect(() => {
    if (isRemoteDataMode()) return
    const unsub = window.electronAPI?.api?.onBatchPrintRequest?.((req) => {
      void (async () => {
        try {
          const files: File[] = []
          if (req.contentBase64) {
            const bin = Uint8Array.from(atob(req.contentBase64), (c) => c.charCodeAt(0))
            files.push(new File([bin], req.filename))
          }
          if (!files.length) {
            // Print existing remote file on each device
            const results = []
            for (const deviceId of req.deviceIds) {
              const device = useDeviceStore.getState().devices.find((d) => d.id === deviceId)
              try {
                await useDeviceStore.getState().control(deviceId, {
                  action: 'print_file',
                  filename: req.filename
                })
                results.push({
                  deviceId,
                  deviceName: device?.name || deviceId,
                  ok: true
                })
              } catch (err) {
                results.push({
                  deviceId,
                  deviceName: device?.name || deviceId,
                  ok: false,
                  message: err instanceof Error ? err.message : String(err)
                })
              }
            }
            window.electronAPI?.api?.replyBatchPrint({
              requestId: req.requestId,
              ok: results.every((r) => r.ok),
              results
            })
            return
          }
          const results = await useDeviceStore
            .getState()
            .batchUploadAndPrint(req.deviceIds, files)
          window.electronAPI?.api?.replyBatchPrint({
            requestId: req.requestId,
            ok: results.every((r) => r.ok),
            results
          })
        } catch (err) {
          window.electronAPI?.api?.replyBatchPrint({
            requestId: req.requestId,
            ok: false,
            results: req.deviceIds.map((deviceId) => ({
              deviceId,
              deviceName: deviceId,
              ok: false,
              message: err instanceof Error ? err.message : String(err)
            }))
          })
        }
      })()
    })
    return () => {
      unsub?.()
    }
  }, [role])

  const selected = useMemo(
    () => devices.find((d) => d.id === selectedId) || null,
    [devices, selectedId]
  )

  const selectedMatchesSection =
    !!selected &&
    !!printerTech &&
    deviceTech(selected) === printerTech &&
    canOpenDevice(selected.id)

  useEffect(() => {
    if (selectedId && selected && !canOpenDevice(selected.id)) {
      selectDevice(null)
    }
  }, [selectedId, selected, canOpenDevice, selectDevice, permissions, deviceAcl])

  if (!authReady) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <div className="app-shell" style={{ padding: 48, textAlign: 'center' }}>
          <Typography.Text type="secondary">加载中…</Typography.Text>
        </div>
      </ConfigProvider>
    )
  }

  if (isRemoteDataMode() && !authed) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <LoginPage />
      </ConfigProvider>
    )
  }

  if (isRemoteDataMode() && authed && needsSsoBind) {
    return (
      <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
        <PluginLoader mode="app" />
        <BindSsoPage />
      </ConfigProvider>
    )
  }


  const shellHeader = (
          <>
            <PluginSlot name="app.header.before" />
            <Header className="app-header">
              <div className="app-header-brand">
                {isMobile ? (
                  <Button
                    type="text"
                    className="app-nav-toggle"
                    icon={<MenuOutlined />}
                    aria-label="打开菜单"
                    onClick={() => setNavOpen(true)}
                  />
                ) : null}
                <PluginSlot name="app.header.brand">
                  <img
                    src={resolveSiteLogoUrl(siteLogo, appIcon)}
                    alt=""
                    className="app-header-logo"
                    draggable={false}
                  />
                  <Typography.Title level={4} className="app-header-title">
                    {isMobile
                      ? `${resolveSiteDisplayName(siteName)} · ${appTitleSuffix()}`
                      : `${resolveSiteDisplayName(siteName)} · ${appTitleSuffix()}`}
                  </Typography.Title>
                </PluginSlot>
              </div>
              <Space className="app-header-actions" size={isMobile ? 4 : 8} align="center" wrap={false}>
                <PluginSlot name="app.header.actions" />
                {!isMobile && printerTech ? (
                  <Input.Search
                    placeholder={
                      printerTech === 'resin'
                        ? '搜索光固化设备 / 分组 / 标签'
                        : '搜索 FDM 设备 / 分组 / 标签'
                    }
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="app-header-search"
                  />
                ) : null}
                {!isMobile && isFilament ? (
                  <Input.Search
                    placeholder="搜索颜色 / 品牌 / 位置 / 备注"
                    allowClear
                    value={filamentSearch}
                    onChange={(e) => setFilamentSearch(e.target.value)}
                    className="app-header-search"
                  />
                ) : null}
                {printerTech ? (
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => void reconnectAll()}
                    aria-label="重连"
                  >
                    {isMobile ? null : '重连'}
                  </Button>
                ) : null}
                {showLogsButton ? (
                  <Button
                    icon={<FileSearchOutlined />}
                    onClick={() => setLogsOpen(true)}
                    aria-label="日志"
                  >
                    {isMobile ? null : '日志'}
                  </Button>
                ) : null}
                {printerTech && can('device.create') ? (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => setAddOpen(true)}
                    aria-label="添加设备"
                  >
                    {isMobile ? null : printerTech === 'resin' ? '添加光固化' : '添加 FDM'}
                  </Button>
                ) : null}
                {isFilament && can('filament.create') ? (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => openFilamentAdd()}
                    aria-label="添加料卷"
                  >
                    {isMobile ? null : '添加料卷'}
                  </Button>
                ) : null}
                {isRemoteDataMode() ? (
                  <Button
                    icon={isMobile ? <LogoutOutlined /> : undefined}
                    onClick={() => useAuthStore.getState().logout()}
                    aria-label="退出登录"
                  >
                    {isMobile ? null : '退出登录'}
                  </Button>
                ) : null}
              </Space>
              {!isWebBrowser() ? <WindowControls /> : null}
            </Header>
            <PluginSlot name="app.header.after" />
          </>
        )
  const shellNav = (
          <>
            {themeLayout === 'classic' || themeLayout === 'custom' ? (
              <Typography.Text
                type="secondary"
                style={{ fontSize: 12, display: 'block', marginBottom: 8 }}
              >
                功能
              </Typography.Text>
            ) : null}
            <PluginSlot name="app.nav.before" />
            <PluginSlot name="app.nav" replace>
              <SideNav mode={navMode} />
            </PluginSlot>
            <PluginSlot name="app.nav.after" />
          </>
        )
  const shellMobileToolbar = (
          isMobile && (printerTech || isFilament) ? (
            <div className="app-mobile-toolbar">
              {printerTech ? (
                <Input.Search
                  placeholder={printerTech === 'resin' ? '搜索光固化…' : '搜索 FDM…'}
                  allowClear
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              ) : null}
              {isFilament ? (
                <Input.Search
                  placeholder="搜索耗材…"
                  allowClear
                  value={filamentSearch}
                  onChange={(e) => setFilamentSearch(e.target.value)}
                />
              ) : null}
            </div>
          ) : null
        )
  const shellMain = (
          <>
            <PluginSlot name="app.main.before" />
            {printerTech ? (
              <>
                <PluginSlot name="device.grid.before" />
                <PluginSlot name="device.grid" replace>
                  <BrandFilterBar tech={printerTech} />
                  <BatchPrintBar tech={printerTech} onBatchPrint={() => setBatchOpen(true)} />
                  {printerTech === 'fdm' && bambuPluginHint ? (
                    <Alert
                      type="info"
                      showIcon
                      closable
                      style={{ marginBottom: 12 }}
                      message="Bambu 提示"
                      description={bambuPluginHint}
                    />
                  ) : null}
                  <DeviceGrid devices={visible} loading={loading} tech={printerTech} />
                </PluginSlot>
                <PluginSlot name="device.grid.after" />
              </>
            ) : (
              <Suspense fallback={<PageFallback />}>
                {showToolsKeepAlive ? (
                  <div
                    style={{ display: isTools ? undefined : 'none' }}
                    aria-hidden={!isTools}
                  >
                    <PluginSlot name="tools.page.before" />
                    <PluginSlot name="tools.page" replace>
                      <ToolsPage />
                    </PluginSlot>
                    <PluginSlot name="tools.page.after" />
                  </div>
                ) : null}
                {isTools ? null : isFilament ? (
                  <>
                    <PluginSlot name="filament.page.before" />
                    <PluginSlot name="filament.page" replace>
                      <FilamentManager />
                    </PluginSlot>
                    <PluginSlot name="filament.page.after" />
                  </>
                ) : isQuoteHistory ? (
                  <>
                    <PluginSlot name="quote.history.before" />
                    <PluginSlot name="quote.history" replace>
                      <QuoteHistoryPage />
                    </PluginSlot>
                    <PluginSlot name="quote.history.after" />
                  </>
                ) : isMonitorWall ? (
                  <>
                    <PluginSlot name="monitor.page.before" />
                    <PluginSlot name="monitor.page" replace>
                      <MonitorWallPage />
                    </PluginSlot>
                    <PluginSlot name="monitor.page.after" />
                  </>
                ) : isMonitorZones ? (
                  <>
                    <PluginSlot name="monitor.zones.before" />
                    <PluginSlot name="monitor.zones" replace>
                      <MonitorZonesPage />
                    </PluginSlot>
                    <PluginSlot name="monitor.zones.after" />
                  </>
                ) : isModels ? (
                  <>
                    <PluginSlot name="models.page.before" />
                    <PluginSlot name="models.page" replace>
                      <ModelSitesPage />
                    </PluginSlot>
                    <PluginSlot name="models.page.after" />
                  </>
                ) : isAiModels ? (
                  <>
                    <PluginSlot name="aiModels.page.before" />
                    <PluginSlot name="aiModels.page" replace>
                      <AiModelSitesPage />
                    </PluginSlot>
                    <PluginSlot name="aiModels.page.after" />
                  </>
                ) : isUsers ? (
                  <>
                    <PluginSlot name="users.page.before" />
                    <PluginSlot name="users.page" replace>
                      <UsersPage />
                    </PluginSlot>
                    <PluginSlot name="users.page.after" />
                  </>
                ) : isPrintApprove ? (
                  <>
                    <PluginSlot name="print.approve.before" />
                    <PluginSlot name="print.approve" replace>
                      <PrintApprovalPage />
                    </PluginSlot>
                    <PluginSlot name="print.approve.after" />
                  </>
                ) : isPluginPage && pluginPageId ? (
                  <PluginHostPage identifier={pluginPageId} moduleName={pluginPageModule} />
                ) : isCustomPage ? (
                  <CustomHtmlPage />
                ) : isSettings ? (
                  <>
                    <PluginSlot name="settings.page.before" />
                    <PluginSlot name="settings.page" replace>
                      <SoftSettingsPage />
                    </PluginSlot>
                    <PluginSlot name="settings.page.after" />
                  </>
                ) : null}
              </Suspense>
            )}
            <PluginSlot name="app.main.after" />
          </>
        )
  const shellFooter = (
          <PluginSlot name="app.footer" replace>
            <PluginSlot name="app.footer.before" />
            <footer className="app-footer">
              <span>
                {printerTech === 'fdm'
                  ? `FDM ${sectionCount} · 可见 ${visible.length}`
                  : printerTech === 'resin'
                    ? `光固化 ${sectionCount} · 可见 ${visible.length}`
                    : isFilament
                      ? `耗材 ${filamentActiveCount} · 可见 ${filamentVisibleCount}`
                      : isTools
                        ? '常用工具'
                        : isQuoteHistory
                          ? '报价记录'
                          : isMonitorWall
                            ? '内部监控 · 打印机摄像头墙'
                            : isMonitorZones
                              ? '区域监控 · 第三方摄像头'
                              : isModels
                                ? '模型网站'
                                : isAiModels
                                  ? 'AI 建模网'
                                  : '软件设置'}
                {' · v'}
                {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.4.1'}
              </span>
              <span>
                {siteFooter?.trim()
                  ? siteFooter.trim()
                  : isTools
                    ? '代打报价 · 材料电费折旧人工 · G-code'
                    : isQuoteHistory
                      ? '全部用户 · 复制/导出 · 时间价格可搜'
                      : isMonitorWall
                        ? '机舱摄像头 · 逐台加载 · 离开即停流'
                        : isMonitorZones
                          ? '分区管理 · HTTP/MJPEG · 离开即停流'
                          : isModels
                            ? '厂家库 · 综合站 · 国外模型平台'
                            : isAiModels
                              ? '文生3D · 图生3D · 扫描重建'
                              : isSettings
                                ? '设置 · 主题 · 插件 · 说明'
                                : section === 'filament'
                                  ? '本地料卷 · 低库存 · AMS/单色自动扣减'
                                  : printerTech === 'resin'
                                    ? '光固化 · 层进度监控 · 批量启停'
                                    : 'Moonraker 实时 · Bambu 局域网 / 官方账号'}
              </span>
            </footer>
            <PluginSlot name="app.footer.after" />
          </PluginSlot>
        )

  const fullHeaderBrand = (
              <>
                {isMobile ? (
                  <Button
                    type="text"
                    className="app-nav-toggle"
                    icon={<MenuOutlined />}
                    aria-label="打开菜单"
                    onClick={() => setNavOpen(true)}
                  />
                ) : null}
                <PluginSlot name="app.header.brand">
                  <img
                    src={resolveSiteLogoUrl(siteLogo, appIcon)}
                    alt=""
                    className="app-header-logo"
                    draggable={false}
                  />
                  <Typography.Title level={4} className="app-header-title">
                    {`${resolveSiteDisplayName(siteName)} · ${appTitleSuffix()}`}
                  </Typography.Title>
                </PluginSlot>
              </>
  )

  const fullHeaderActions = (
              <>
              <Space className="app-header-actions" size={isMobile ? 4 : 8} align="center" wrap={false}>
                <PluginSlot name="app.header.actions" />
                {!isMobile && printerTech ? (
                  <Input.Search
                    placeholder={
                      printerTech === 'resin'
                        ? '搜索光固化设备 / 分组 / 标签'
                        : '搜索 FDM 设备 / 分组 / 标签'
                    }
                    allowClear
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="app-header-search"
                  />
                ) : null}
                {!isMobile && isFilament ? (
                  <Input.Search
                    placeholder="搜索颜色 / 品牌 / 位置 / 备注"
                    allowClear
                    value={filamentSearch}
                    onChange={(e) => setFilamentSearch(e.target.value)}
                    className="app-header-search"
                  />
                ) : null}
                {printerTech ? (
                  <Button icon={<ReloadOutlined />} onClick={() => void reconnectAll()} aria-label="重连">
                    {isMobile ? null : '重连'}
                  </Button>
                ) : null}
                {showLogsButton ? (
                  <Button icon={<FileSearchOutlined />} onClick={() => setLogsOpen(true)} aria-label="日志">
                    {isMobile ? null : '日志'}
                  </Button>
                ) : null}
                {printerTech && can('device.create') ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)} aria-label="添加设备">
                    {isMobile ? null : printerTech === 'resin' ? '添加光固化' : '添加 FDM'}
                  </Button>
                ) : null}
                {isFilament && can('filament.create') ? (
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => openFilamentAdd()} aria-label="添加料卷">
                    {isMobile ? null : '添加料卷'}
                  </Button>
                ) : null}
                {isRemoteDataMode() ? (
                  <Button
                    icon={isMobile ? <LogoutOutlined /> : undefined}
                    onClick={() => useAuthStore.getState().logout()}
                    aria-label="退出登录"
                  >
                    {isMobile ? null : '退出登录'}
                  </Button>
                ) : null}
              </Space>
              {!isWebBrowser() ? <WindowControls /> : null}
              </>
  )

  return (
    <ConfigProvider locale={zhCN} theme={uiThemeDef.antd}>
      <ForceChangePasswordGate />
      <ThemeLoader mode="app" />
      <PluginLoader mode="app" />
      {useFullSite ? (
        <ThemeFullSiteHost
          className="app-shell theme-fullsite"
          html={fullShellHtml}
          islands={{
            'header-brand': fullHeaderBrand,
            'header-actions': fullHeaderActions,
            nav: shellNav,
            'mobile-toolbar': shellMobileToolbar,
            main: shellMain,
            footer: shellFooter
          }}
        />
      ) : (
      <PluginSlot name="app.shell" replace>
      <ThemeSlot name="app.shell" replace>
      <ThemeAppShell
        layout={themeLayout}
        mobile={isMobile}
        header={shellHeader}
        nav={shellNav}
        mobileToolbar={shellMobileToolbar}
        main={shellMain}
        footer={shellFooter}
      />
      </ThemeSlot>
      </PluginSlot>
      )}

      <Drawer
        title="功能菜单"
        placement="left"
        open={isMobile && navOpen}
        onClose={() => setNavOpen(false)}
        width={Math.min(300, typeof window !== 'undefined' ? window.innerWidth - 40 : 280)}
        className="app-mobile-nav-drawer"
        styles={{ body: { padding: 12 } }}
      >
        <SideNav onNavigate={() => setNavOpen(false)} />
      </Drawer>

      {printerTech ? (
        <AddDeviceModal open={addOpen} tech={printerTech} onClose={() => setAddOpen(false)} />
      ) : null}
      {printerTech ? (
        <BatchPrintModal open={batchOpen} tech={printerTech} onClose={() => setBatchOpen(false)} />
      ) : null}
      <DeviceDetailDrawer
        device={selectedMatchesSection ? selected : null}
        open={selectedMatchesSection}
        onClose={() => selectDevice(null)}
      />
      {showLogsButton ? (
        <LogDrawer open={logsOpen} onClose={() => setLogsOpen(false)} />
      ) : null}
    </ConfigProvider>
  )
}
