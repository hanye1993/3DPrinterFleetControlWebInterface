import { startTransition, type ReactNode, useEffect, useMemo, useState } from 'react'
import { Button, Menu } from 'antd'
import type { MenuProps } from 'antd'
import {
  AppstoreAddOutlined,
  AppstoreOutlined,
  AuditOutlined,
  EnvironmentOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FolderOutlined,
  HistoryOutlined,
  InboxOutlined,
  LinkOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { useDeviceStore, type AppSection } from '../stores/deviceStore'
import { useAuthStore, useAuthGrants } from '../stores/authStore'
import { isAdminUi } from '../utils/appMode'
import { serverGet } from '../api/serverClient'
import { getHanyePlugin } from '../plugins/runtime'
import { useNavConfigStore } from '../stores/navConfigStore'
import {
  pageSectionKey,
  type NavConfigItem
} from '@shared/navConfig'
import { PluginSlot } from '../plugins/PluginSlot'

const BUILTIN_ICONS: Record<string, ReactNode> = {
  fdm: <AppstoreOutlined />,
  resin: <ExperimentOutlined />,
  filament: <InboxOutlined />,
  tools: <ToolOutlined />,
  quoteHistory: <HistoryOutlined />,
  monitorWall: <VideoCameraOutlined />,
  monitorZones: <EnvironmentOutlined />,
  models: <ShopOutlined />,
  aiModels: <RobotOutlined />,
  users: <TeamOutlined />,
  printApprove: <AuditOutlined />,
  settings: <SettingOutlined />
}

const ITEMS: {
  key: AppSection
  label: string
  icon: ReactNode
  perm?: string
  serverOnly?: boolean
  clientHide?: boolean
}[] = [
  { key: 'fdm', label: 'FDM', icon: <AppstoreOutlined />, perm: 'nav.devices' },
  { key: 'resin', label: '光固化', icon: <ExperimentOutlined />, perm: 'nav.devices' },
  { key: 'filament', label: '耗材管理', icon: <InboxOutlined />, perm: 'nav.filament' },
  { key: 'tools', label: '常用工具', icon: <ToolOutlined />, perm: 'nav.tools' },
  { key: 'quoteHistory', label: '报价记录', icon: <HistoryOutlined />, perm: 'nav.tools', serverOnly: true },
  { key: 'monitorWall', label: '内部监控', icon: <VideoCameraOutlined />, perm: 'nav.monitor' },
  { key: 'monitorZones', label: '区域监控', icon: <EnvironmentOutlined />, perm: 'nav.monitor' },
  { key: 'models', label: '模型网站', icon: <ShopOutlined /> },
  { key: 'aiModels', label: 'AI 建模网', icon: <RobotOutlined /> },
  { key: 'users', label: '用户权限', icon: <TeamOutlined />, perm: 'nav.users', serverOnly: true },
  { key: 'printApprove', label: '打印审核/队列', icon: <AuditOutlined />, perm: 'nav.printApprove' },
  { key: 'settings', label: '软件设置', icon: <SettingOutlined />, perm: 'nav.settings' }
]

type PluginNav = {
  key: string
  label: string
  identifier: string
  module?: string
  perm?: string
  adminOnly?: boolean
}

type MenuItem = Required<MenuProps>['items'][number]

function canShowBuiltin(
  key: string,
  opts: { adminUi: boolean; can: (p: string) => boolean }
): boolean {
  const meta = ITEMS.find((x) => x.key === key)
  if (!meta) {
    // plugin or unknown target — allow if looks like plugin
    if (key.startsWith('plugin:')) return true
    return true
  }
  if (meta.serverOnly && !opts.adminUi) return false
  if (meta.clientHide && !opts.adminUi) return false
  if (meta.key === 'printApprove') {
    return (
      opts.can('nav.printApprove') ||
      opts.can('print.approve') ||
      opts.can('device.action.print.request') ||
      opts.can('device.action.print')
    )
  }
  if (meta.perm && !opts.can(meta.perm)) return false
  return true
}

function openNavLink(href: string, newTab: boolean): void {
  const url = String(href || '').trim()
  if (!url || /^javascript:/i.test(url)) return
  if (newTab !== false) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  window.location.assign(url)
}

function buildCustomItems(
  nodes: NavConfigItem[],
  ctx: {
    adminUi: boolean
    can: (p: string) => boolean
    hidden: Set<string>
  }
): MenuItem[] {
  const out: MenuItem[] = []
  for (const node of nodes) {
    if (node.hidden) continue
    if (node.type === 'folder') {
      const children = buildCustomItems(node.children || [], ctx)
      if (!children.length) continue
      out.push({
        key: `folder:${node.id}`,
        icon: <FolderOutlined />,
        label: node.label,
        children
      })
      continue
    }
    if (node.type === 'link') {
      out.push({
        key: `link:${node.id}`,
        icon: <LinkOutlined />,
        label: node.label
      })
      continue
    }
    if (node.type === 'page') {
      out.push({
        key: pageSectionKey(node.id),
        icon: <FileTextOutlined />,
        label: node.label
      })
      continue
    }
    // builtin
    const target = String(node.target || '').trim()
    if (!target || ctx.hidden.has(target)) continue
    if (!canShowBuiltin(target, ctx)) continue
    out.push({
      key: target,
      icon: BUILTIN_ICONS[target] || (target.startsWith('plugin:') ? <AppstoreAddOutlined /> : <AppstoreOutlined />),
      label: node.label
    })
  }
  return out
}

function collectDefaultOpenKeys(nodes: NavConfigItem[]): string[] {
  const keys: string[] = []
  for (const n of nodes) {
    if (n.type === 'folder' && !n.hidden) {
      const k = `folder:${n.id}`
      if (!n.defaultCollapsed) keys.push(k)
      if (n.children?.length) keys.push(...collectDefaultOpenKeys(n.children))
    }
  }
  return keys
}

export function SideNav({
  onNavigate,
  mode = 'inline'
}: {
  onNavigate?: () => void
  mode?: 'inline' | 'horizontal' | 'vertical'
} = {}) {
  const section = useDeviceStore((s) => s.section)
  const setSection = useDeviceStore((s) => s.setSection)
  const role = useAuthStore((s) => s.role)
  const authed = useAuthStore((s) => s.isAuthed())
  const { permissions, deviceAcl, can } = useAuthGrants()
  const [pluginNav, setPluginNav] = useState<PluginNav[]>([])
  const [navTick, setNavTick] = useState(0)

  const navConfig = useNavConfigStore((s) => s.config)
  const navLoaded = useNavConfigStore((s) => s.loaded)
  const navInit = useNavConfigStore((s) => s.init)
  const collapsed = useNavConfigStore((s) => s.collapsed)
  const toggleCollapsed = useNavConfigStore((s) => s.toggleCollapsed)

  useEffect(() => {
    if (!navLoaded) void navInit()
  }, [navLoaded, navInit])

  useEffect(() => {
    return getHanyePlugin().on('nav:change', () => setNavTick((t) => t + 1))
  }, [])

  useEffect(() => {
    if (!authed) {
      setPluginNav([])
      return
    }
    let cancelled = false
    void serverGet<{ nav?: PluginNav[] }>('/api/v1/plugins/ui')
      .then((data) => {
        if (!cancelled) setPluginNav(data.nav || [])
      })
      .catch(() => {
        if (!cancelled) setPluginNav([])
      })
    return () => {
      cancelled = true
    }
  }, [authed, role])

  const defaultOpenKeys = useMemo(
    () => collectDefaultOpenKeys(navConfig.items),
    [navConfig.items]
  )
  const [openKeys, setOpenKeys] = useState<string[]>([])
  useEffect(() => {
    setOpenKeys(defaultOpenKeys)
  }, [defaultOpenKeys])

  const items = useMemo(() => {
    const adminUi = isAdminUi()
    const hidden = new Set(getHanyePlugin().getHiddenNavKeys())
    const ctx = { adminUi, can, hidden }

    if (navConfig.enabled) {
      const custom = buildCustomItems(navConfig.items, ctx)
      // Append plugin pages not already present
      const existing = new Set<string>()
      const walk = (list: MenuItem[]) => {
        for (const it of list) {
          if (!it || typeof it !== 'object') continue
          const k = 'key' in it ? String(it.key) : ''
          if (k) existing.add(k)
          if ('children' in it && Array.isArray(it.children)) walk(it.children as MenuItem[])
        }
      }
      walk(custom)
      const extras = pluginNav
        .filter((p) => p.key.startsWith('plugin:'))
        .filter((p) => !hidden.has(p.key) && !existing.has(p.key))
        .filter((p) => {
          if (p.adminOnly && !adminUi) return false
          if (p.perm && !adminUi && !can(p.perm)) return false
          return true
        })
        .map((p) => ({
          key: p.key,
          icon: <AppstoreAddOutlined />,
          label: p.label
        }))
      const settingsIdx = custom.findIndex((x) => x && typeof x === 'object' && 'key' in x && x.key === 'settings')
      const merged =
        extras.length === 0
          ? custom
          : settingsIdx >= 0
            ? [...custom.slice(0, settingsIdx), ...extras, ...custom.slice(settingsIdx)]
            : [...custom, ...extras]
      return getHanyePlugin()
        .applyNav(
          merged.map((x, i) => ({
            key: String(x && typeof x === 'object' && 'key' in x ? x.key : i),
            label: String(
              x && typeof x === 'object' && 'label' in x ? (x as { label?: unknown }).label : ''
            ),
            identifier: String(x && typeof x === 'object' && 'key' in x ? x.key : '').startsWith(
              'plugin:'
            )
              ? String((x as { key: string }).key).split(':')[1] || ''
              : 'core',
            order: 0
          }))
        )
        .map((n) => {
          const found = merged.find(
            (m) => m && typeof m === 'object' && 'key' in m && String(m.key) === n.key
          )
          return (
            found || {
              key: n.key,
              icon: <AppstoreAddOutlined />,
              label: n.label
            }
          )
        }) as MenuItem[]
    }

    const base = ITEMS.filter((item) => {
      if (hidden.has(item.key)) return false
      return canShowBuiltin(item.key, ctx)
    }).map((item) => ({
      key: item.key,
      icon: item.icon,
      label: item.label
    }))

    const extra = pluginNav
      .filter((p) => p.key.startsWith('plugin:'))
      .filter((p) => !hidden.has(p.key))
      .filter((p) => {
        if (p.adminOnly && !adminUi) return false
        if (p.perm && !adminUi && !can(p.perm)) return false
        return true
      })
      .map((p) => ({
        key: p.key as AppSection,
        icon: <AppstoreAddOutlined />,
        label: p.label
      }))

    const settingsIdx = base.findIndex((x) => x.key === 'settings')
    const merged =
      settingsIdx >= 0
        ? [...base.slice(0, settingsIdx), ...extra, ...base.slice(settingsIdx)]
        : [...base, ...extra]
    return getHanyePlugin()
      .applyNav(
        merged.map((x) => ({
          key: String(x.key),
          label: String(x.label),
          identifier: String(x.key).startsWith('plugin:')
            ? String(x.key).split(':')[1] || ''
            : 'core',
          order: 0
        }))
      )
      .map((n) => {
        const found = merged.find((m) => m.key === n.key)
        return found || { key: n.key as AppSection, icon: <AppstoreAddOutlined />, label: n.label }
      })
  }, [role, can, permissions, deviceAcl, pluginNav, navTick, navConfig])

  const findLinkHref = (id: string): { href: string; openInNewTab: boolean } | null => {
    const walk = (list: NavConfigItem[]): { href: string; openInNewTab: boolean } | null => {
      for (const n of list) {
        if (n.type === 'link' && n.id === id) {
          return { href: n.href || '', openInNewTab: n.openInNewTab !== false }
        }
        if (n.children?.length) {
          const hit = walk(n.children)
          if (hit) return hit
        }
      }
      return null
    }
    return walk(navConfig.items)
  }

  const inlineCollapsed = mode === 'inline' && navConfig.collapsible && collapsed

  return (
    <div className={`side-nav${inlineCollapsed ? ' side-nav-collapsed' : ''}`}>
      {mode === 'inline' && navConfig.collapsible ? (
        <>
          <PluginSlot name="app.nav.collapse.before" />
          <div className="side-nav-collapse-bar">
            <Button
              type="text"
              size="small"
              aria-label={collapsed ? '展开导航' : '收缩导航'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => toggleCollapsed()}
            />
          </div>
          <PluginSlot name="app.nav.collapse.after" />
        </>
      ) : null}
      <PluginSlot name="app.nav.menu.before" />
      <Menu
        mode={mode}
        inlineCollapsed={inlineCollapsed}
        selectedKeys={[section]}
        openKeys={mode === 'inline' && !inlineCollapsed ? openKeys : undefined}
        onOpenChange={(keys) => setOpenKeys(keys as string[])}
        onClick={({ key }) => {
          const k = String(key)
          if (k.startsWith('link:')) {
            const id = k.slice('link:'.length)
            const hit = findLinkHref(id)
            if (hit) openNavLink(hit.href, hit.openInNewTab)
            onNavigate?.()
            return
          }
          if (k.startsWith('folder:')) return
          startTransition(() => setSection(k as AppSection))
          onNavigate?.()
        }}
        style={{ background: 'transparent', border: 'none' }}
        items={items}
      />
      <PluginSlot name="app.nav.menu.after" />
      <PluginSlot name="app.nav.footer" />
    </div>
  )
}
