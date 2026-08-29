import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Tabs, Typography } from 'antd'
import {
  AppstoreAddOutlined,
  AuditOutlined,
  BankOutlined,
  BellOutlined,
  ControlOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  MenuOutlined,
  PictureOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  SkinOutlined,
  TeamOutlined,
  DatabaseOutlined
} from '@ant-design/icons'
import { SoftSettingsGeneral } from './softSettings/SoftSettingsGeneral'
import { SoftSettingsBrand } from './softSettings/SoftSettingsBrand'
import { SoftSettingsNav } from './softSettings/SoftSettingsNav'
import { SoftSettingsFilamentSync } from './softSettings/SoftSettingsFilamentSync'
import { SoftSettingsEnterprise } from './softSettings/SoftSettingsEnterprise'
import { SoftSettingsAi } from './softSettings/SoftSettingsAi'
import { SoftSettingsAlerts } from './softSettings/SoftSettingsAlerts'
import { SoftSettingsPlugins } from './softSettings/SoftSettingsPlugins'
import { SoftSettingsThemes } from './softSettings/SoftSettingsThemes'
import { SoftSettingsMarketplace } from './softSettings/SoftSettingsMarketplace'
import { SoftSettingsAbout } from './softSettings/SoftSettingsAbout'
import {
  SoftSettingsPluginSettings,
  filterVisiblePluginSettingsTabs
} from './softSettings/SoftSettingsPluginSettings'
import { QuoteHistoryPage } from './QuoteHistoryPage'
import { UsersPage } from './UsersPage'
import { PrintApprovalPage } from './PrintApprovalPage'
import { isAdminUi, isRemoteDataMode } from '../utils/appMode'
import { isWebBrowser } from '@shared/platform'
import { useAuthGrants } from '../stores/authStore'
import { PluginSlot } from '../plugins/PluginSlot'
import {
  getHanyePlugin,
  SETTINGS_TAB_ORDER,
  type PluginSettingsTab
} from '../plugins/runtime'

export type SoftTab = string

type TabEntry = {
  key: string
  sort: number
  label: ReactNode
  children: ReactNode
}

const BUILTIN_TAB_KEYS = new Set(Object.keys(SETTINGS_TAB_ORDER))

export function SoftSettingsPage({ initialTab }: { initialTab?: SoftTab } = {}) {
  const [tab, setTab] = useState<SoftTab>(initialTab || 'general')
  const [pluginSubTab, setPluginSubTab] = useState<string | undefined>()
  const [pluginTabs, setPluginTabs] = useState<PluginSettingsTab[]>(() =>
    getHanyePlugin().getSettingsTabs()
  )
  const { can } = useAuthGrants()
  const isClient = isRemoteDataMode()
  const isWeb = isWebBrowser()
  const adminUi = isAdminUi()
  const showEnterprise = !isClient || (isWeb && adminUi)
  const showAi = adminUi
  const showAlerts = adminUi
  const showPlugins = adminUi
  const showThemes = adminUi
  const showMarketplace = adminUi
  /** Branding + nav are core Soft Settings tabs — always visible when this page is open */
  const showBrand = true
  const showNav = true
  const showFilamentSync = adminUi && can('filament.edit')
  const showQuoteHistory = adminUi && can('nav.tools')
  const showUsers = adminUi && can('nav.users')
  const showPrintApprove =
    can('nav.printApprove') ||
    can('print.approve') ||
    can('device.action.print.request') ||
    can('device.action.print')

  const visiblePluginTabs = useMemo(
    () => filterVisiblePluginSettingsTabs(pluginTabs),
    [pluginTabs]
  )
  const showPluginSettings = visiblePluginTabs.length > 0
  const pluginTabKeys = useMemo(
    () => new Set(visiblePluginTabs.map((t) => t.key)),
    [visiblePluginTabs]
  )

  useEffect(() => {
    if (!initialTab) return
    if (pluginTabKeys.has(initialTab)) {
      setTab('pluginSettings')
      setPluginSubTab(initialTab)
      return
    }
    setTab(initialTab)
  }, [initialTab, pluginTabKeys])

  useEffect(() => {
    const runtime = getHanyePlugin()
    setPluginTabs(runtime.getSettingsTabs())
    return runtime.on('settings-tabs:change', (p) => {
      setPluginTabs(Array.isArray(p) ? (p as PluginSettingsTab[]) : runtime.getSettingsTabs())
    })
  }, [])

  // Deep-link / stale state: plugin tab keys open under 插件设置
  useEffect(() => {
    if (pluginTabKeys.has(tab)) {
      setPluginSubTab(tab)
      setTab('pluginSettings')
    }
  }, [tab, pluginTabKeys])

  const activeKey =
    (tab === 'enterprise' && !showEnterprise) ||
    (tab === 'ai' && !showAi) ||
    (tab === 'alerts' && !showAlerts) ||
    (tab === 'plugins' && !showPlugins) ||
    (tab === 'themes' && !showThemes) ||
    (tab === 'marketplace' && !showMarketplace) ||
    (tab === 'pluginSettings' && !showPluginSettings) ||
    (tab === 'brand' && !showBrand) ||
    (tab === 'nav' && !showNav) ||
    (tab === 'filamentSync' && !showFilamentSync) ||
    (tab === 'quoteHistory' && !showQuoteHistory) ||
    (tab === 'users' && !showUsers) ||
    (tab === 'printApprove' && !showPrintApprove)
      ? 'general'
      : tab === 'general' ||
          tab === 'brand' ||
          tab === 'nav' ||
          tab === 'filamentSync' ||
          tab === 'quoteHistory' ||
          tab === 'users' ||
          tab === 'printApprove' ||
          tab === 'enterprise' ||
          tab === 'ai' ||
          tab === 'alerts' ||
          tab === 'plugins' ||
          tab === 'themes' ||
          tab === 'marketplace' ||
          tab === 'pluginSettings' ||
          tab === 'about' ||
          BUILTIN_TAB_KEYS.has(tab)
        ? tab
        : pluginTabKeys.has(tab)
          ? 'pluginSettings'
          : 'general'

  const items = useMemo(() => {
    const entries: TabEntry[] = [
      {
        key: 'general',
        sort: SETTINGS_TAB_ORDER.general,
        label: (
          <span>
            <SettingOutlined /> 设置
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.general.before" />
            <PluginSlot name="settings.tab.general" replace>
              <SoftSettingsGeneral />
            </PluginSlot>
            <PluginSlot name="settings.tab.general.after" />
          </div>
        )
      }
    ]

    if (showBrand) {
      entries.push({
        key: 'brand',
        sort: SETTINGS_TAB_ORDER.brand,
        label: (
          <span>
            <PictureOutlined /> 品牌
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.brand.before" />
            <PluginSlot name="settings.tab.brand" replace>
              <SoftSettingsBrand />
            </PluginSlot>
            <PluginSlot name="settings.tab.brand.after" />
          </div>
        )
      })
    }

    if (showNav) {
      entries.push({
        key: 'nav',
        sort: SETTINGS_TAB_ORDER.nav,
        label: (
          <span>
            <MenuOutlined /> 导航
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.nav.before" />
            <PluginSlot name="settings.tab.nav" replace>
              <SoftSettingsNav />
            </PluginSlot>
            <PluginSlot name="settings.tab.nav.after" />
          </div>
        )
      })
    }

    if (showFilamentSync) {
      entries.push({
        key: 'filamentSync',
        sort: SETTINGS_TAB_ORDER.filamentSync,
        label: (
          <span>
            <DatabaseOutlined /> 耗材库同步
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.filamentSync.before" />
            <PluginSlot name="settings.tab.filamentSync" replace>
              <SoftSettingsFilamentSync />
            </PluginSlot>
            <PluginSlot name="settings.tab.filamentSync.after" />
          </div>
        )
      })
    }

    if (showQuoteHistory) {
      entries.push({
        key: 'quoteHistory',
        sort: SETTINGS_TAB_ORDER.quoteHistory,
        label: (
          <span>
            <HistoryOutlined /> 报价记录
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.quoteHistory.before" />
            <PluginSlot name="settings.tab.quoteHistory" replace>
              <PluginSlot name="quote.history.before" />
              <PluginSlot name="quote.history" replace>
                <QuoteHistoryPage />
              </PluginSlot>
              <PluginSlot name="quote.history.after" />
            </PluginSlot>
            <PluginSlot name="settings.tab.quoteHistory.after" />
          </div>
        )
      })
    }

    if (showUsers) {
      entries.push({
        key: 'users',
        sort: SETTINGS_TAB_ORDER.users,
        label: (
          <span>
            <TeamOutlined /> 用户权限
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.users.before" />
            <PluginSlot name="settings.tab.users" replace>
              <PluginSlot name="users.page.before" />
              <PluginSlot name="users.page" replace>
                <UsersPage />
              </PluginSlot>
              <PluginSlot name="users.page.after" />
            </PluginSlot>
            <PluginSlot name="settings.tab.users.after" />
          </div>
        )
      })
    }

    if (showPrintApprove) {
      entries.push({
        key: 'printApprove',
        sort: SETTINGS_TAB_ORDER.printApprove,
        label: (
          <span>
            <AuditOutlined /> 打印审核/队列
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.printApprove.before" />
            <PluginSlot name="settings.tab.printApprove" replace>
              <PluginSlot name="print.approve.before" />
              <PluginSlot name="print.approve" replace>
                <PrintApprovalPage />
              </PluginSlot>
              <PluginSlot name="print.approve.after" />
            </PluginSlot>
            <PluginSlot name="settings.tab.printApprove.after" />
          </div>
        )
      })
    }

    if (showEnterprise) {
      entries.push({
        key: 'enterprise',
        sort: SETTINGS_TAB_ORDER.enterprise,
        label: (
          <span>
            <BankOutlined /> 企业软件对接
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.enterprise.before" />
            <PluginSlot name="settings.tab.enterprise" replace>
              <SoftSettingsEnterprise />
            </PluginSlot>
            <PluginSlot name="settings.tab.enterprise.after" />
          </div>
        )
      })
    }

    if (showAi) {
      entries.push({
        key: 'ai',
        sort: SETTINGS_TAB_ORDER.ai,
        label: (
          <span>
            <RobotOutlined /> AI 对接
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.ai.before" />
            <PluginSlot name="settings.tab.ai" replace>
              <SoftSettingsAi />
            </PluginSlot>
            <PluginSlot name="settings.tab.ai.after" />
          </div>
        )
      })
    }

    if (showAlerts) {
      entries.push({
        key: 'alerts',
        sort: SETTINGS_TAB_ORDER.alerts,
        label: (
          <span>
            <BellOutlined /> 异常对接
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.alerts.before" />
            <PluginSlot name="settings.tab.alerts" replace>
              <SoftSettingsAlerts />
            </PluginSlot>
            <PluginSlot name="settings.tab.alerts.after" />
          </div>
        )
      })
    }

    if (showThemes) {
      entries.push({
        key: 'themes',
        sort: SETTINGS_TAB_ORDER.themes,
        label: (
          <span>
            <SkinOutlined /> 主题
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.themes.before" />
            <PluginSlot name="settings.tab.themes" replace>
              <SoftSettingsThemes />
            </PluginSlot>
            <PluginSlot name="settings.tab.themes.after" />
          </div>
        )
      })
    }

    if (showMarketplace) {
      entries.push({
        key: 'marketplace',
        sort: SETTINGS_TAB_ORDER.marketplace,
        label: (
          <span>
            <ShopOutlined /> 应用集市
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.marketplace.before" />
            <PluginSlot name="settings.tab.marketplace" replace>
              <SoftSettingsMarketplace />
            </PluginSlot>
            <PluginSlot name="settings.tab.marketplace.after" />
          </div>
        )
      })
    }

    if (showPlugins) {
      entries.push({
        key: 'plugins',
        sort: SETTINGS_TAB_ORDER.plugins,
        label: (
          <span>
            <AppstoreAddOutlined /> 插件
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.plugins.before" />
            <PluginSlot name="settings.tab.plugins" replace>
              <SoftSettingsPlugins />
            </PluginSlot>
            <PluginSlot name="settings.tab.plugins.after" />
          </div>
        )
      })
    }

    if (showPluginSettings) {
      entries.push({
        key: 'pluginSettings',
        sort: SETTINGS_TAB_ORDER.pluginSettings,
        label: (
          <span>
            <ControlOutlined /> 插件设置
          </span>
        ),
        children: (
          <div className="settings-tab-panel">
            <PluginSlot name="settings.tab.pluginSettings.before" />
            <PluginSlot name="settings.tab.pluginSettings" replace>
              <SoftSettingsPluginSettings
                tabs={visiblePluginTabs}
                activeSubKey={pluginSubTab}
                onSubKeyChange={setPluginSubTab}
              />
            </PluginSlot>
            <PluginSlot name="settings.tab.pluginSettings.after" />
          </div>
        )
      })
    }

    entries.push({
      key: 'about',
      sort: SETTINGS_TAB_ORDER.about,
      label: (
        <span>
          <InfoCircleOutlined /> 关于
        </span>
      ),
      children: (
        <div className="settings-tab-panel">
          <PluginSlot name="settings.tab.about.before" />
          <PluginSlot name="settings.tab.about" replace>
            <SoftSettingsAbout />
          </PluginSlot>
          <PluginSlot name="settings.tab.about.after" />
        </div>
      )
    })

    entries.sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    return entries.map(({ key, label, children }) => ({ key, label, children }))
  }, [
    visiblePluginTabs,
    showPluginSettings,
    pluginSubTab,
    showEnterprise,
    showAi,
    showAlerts,
    showThemes,
    showMarketplace,
    showPlugins,
    showBrand,
    showNav,
    showFilamentSync,
    showQuoteHistory,
    showUsers,
    showPrintApprove
  ])

  return (
    <div className="settings-page">
      <PluginSlot name="settings.tabs.before" />
      <PluginSlot name="settings.header.before" />
      <Typography.Title level={4} className="settings-page-title">
        软件设置
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-page-desc">
        纯网页版（电脑 / 手机自适应）。品牌、导航、对接与应用集市等；已开启插件的设置统一在「插件设置」。
      </Typography.Paragraph>
      <PluginSlot name="settings.header.after" />
      <PluginSlot name="settings.content" replace>
        <Tabs
          className="soft-settings-tabs"
          size="middle"
          activeKey={activeKey}
          onChange={(k) => setTab(k)}
          destroyInactiveTabPane
          items={items}
        />
      </PluginSlot>
      <PluginSlot name="settings.tabs.after" />
    </div>
  )
}
