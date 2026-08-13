import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Tabs, Typography } from 'antd'
import {
  AppstoreAddOutlined,
  BankOutlined,
  BellOutlined,
  InfoCircleOutlined,
  MenuOutlined,
  PictureOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  SkinOutlined
} from '@ant-design/icons'
import { SoftSettingsGeneral } from './softSettings/SoftSettingsGeneral'
import { SoftSettingsBrand } from './softSettings/SoftSettingsBrand'
import { SoftSettingsNav } from './softSettings/SoftSettingsNav'
import { SoftSettingsEnterprise } from './softSettings/SoftSettingsEnterprise'
import { SoftSettingsAi } from './softSettings/SoftSettingsAi'
import { SoftSettingsAlerts } from './softSettings/SoftSettingsAlerts'
import { SoftSettingsPlugins } from './softSettings/SoftSettingsPlugins'
import { SoftSettingsThemes } from './softSettings/SoftSettingsThemes'
import { SoftSettingsMarketplace } from './softSettings/SoftSettingsMarketplace'
import { SoftSettingsAbout } from './softSettings/SoftSettingsAbout'
import { isAdminUi, isRemoteDataMode } from '../utils/appMode'
import { isWebBrowser } from '@shared/platform'
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

function PluginSettingsTabPane({ tab }: { tab: PluginSettingsTab }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    let cleanup: (() => void) | void
    try {
      cleanup = tab.render(el)
    } catch (e) {
      console.error('[settings tab]', tab.key, e)
      el.textContent = '插件设置页渲染失败'
    }
    return () => {
      if (typeof cleanup === 'function') {
        try {
          cleanup()
        } catch {
          /* ignore */
        }
      }
      el.innerHTML = ''
    }
  }, [tab])
  return (
    <>
      <PluginSlot name={`settings.tab.${tab.key}.before`} />
      <PluginSlot name={`settings.tab.${tab.key}`} replace>
        <div ref={ref} className="settings-tab-panel plugin-settings-tab" />
      </PluginSlot>
      <PluginSlot name={`settings.tab.${tab.key}.after`} />
    </>
  )
}

export function SoftSettingsPage({ initialTab }: { initialTab?: SoftTab } = {}) {
  const [tab, setTab] = useState<SoftTab>(initialTab || 'general')
  const [pluginTabs, setPluginTabs] = useState<PluginSettingsTab[]>(() =>
    getHanyePlugin().getSettingsTabs()
  )
  const isClient = isRemoteDataMode()
  const isWeb = isWebBrowser()
  const showEnterprise = !isClient || (isWeb && isAdminUi())
  const showAi = isAdminUi()
  const showAlerts = isAdminUi()
  const showPlugins = isAdminUi()
  const showThemes = isAdminUi()
  const showMarketplace = isAdminUi()
  /** Branding + nav are core Soft Settings tabs — always visible when this page is open */
  const showBrand = true
  const showNav = true

  useEffect(() => {
    if (initialTab) setTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const runtime = getHanyePlugin()
    setPluginTabs(runtime.getSettingsTabs())
    return runtime.on('settings-tabs:change', (p) => {
      setPluginTabs(Array.isArray(p) ? (p as PluginSettingsTab[]) : runtime.getSettingsTabs())
    })
  }, [])

  const pluginTabKeys = useMemo(
    () => new Set(pluginTabs.map((t) => t.key)),
    [pluginTabs]
  )

  const activeKey =
    (tab === 'enterprise' && !showEnterprise) ||
    (tab === 'ai' && !showAi) ||
    (tab === 'alerts' && !showAlerts) ||
    (tab === 'plugins' && !showPlugins) ||
    (tab === 'themes' && !showThemes) ||
    (tab === 'marketplace' && !showMarketplace) ||
    (tab === 'brand' && !showBrand) ||
    (tab === 'nav' && !showNav)
      ? 'general'
      : tab === 'general' ||
          tab === 'brand' ||
          tab === 'nav' ||
          tab === 'enterprise' ||
          tab === 'ai' ||
          tab === 'alerts' ||
          tab === 'plugins' ||
          tab === 'themes' ||
          tab === 'marketplace' ||
          tab === 'about' ||
          pluginTabKeys.has(tab)
        ? tab
        : 'general'

  const items = useMemo(() => {
    const runtime = getHanyePlugin()
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
            <ShopOutlined /> 应用市场
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

    for (const pt of pluginTabs) {
      if (pt.adminOnly && !isAdminUi()) continue
      entries.push({
        key: pt.key,
        sort: runtime.resolveSettingsTabOrder(pt),
        label: <span>{pt.label}</span>,
        children: <PluginSettingsTabPane tab={pt} />
      })
    }

    entries.sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key))
    return entries.map(({ key, label, children }) => ({ key, label, children }))
  }, [
    pluginTabs,
    showEnterprise,
    showAi,
    showAlerts,
    showThemes,
    showMarketplace,
    showPlugins,
    showBrand,
    showNav
  ])

  return (
    <div className="settings-page">
      <PluginSlot name="settings.tabs.before" />
      <PluginSlot name="settings.header.before" />
      <Typography.Title level={4} className="settings-page-title">
        软件设置
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-page-desc">
        纯网页版（电脑 / 手机自适应）。顶部「品牌」改网站名/Logo/标题/底部/ICO；「导航」改菜单与
        HTML 单页；「应用市场」一键安装插件/主题；「主题」「插件」管理本地扩展。
      </Typography.Paragraph>
      <PluginSlot name="settings.header.after" />
      <PluginSlot name="settings.content" replace>
        <Tabs
          className="soft-settings-tabs"
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
