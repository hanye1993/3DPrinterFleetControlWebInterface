import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Typography,
  message,
  Popconfirm
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  FileTextOutlined,
  FolderOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined
} from '@ant-design/icons'
import {
  BUILTIN_NAV_DEFAULTS,
  createNavItem,
  defaultNavConfig,
  type NavConfig,
  type NavConfigItem,
  type NavItemType
} from '@shared/navConfig'
import { useNavConfigStore } from '../../stores/navConfigStore'
import { PluginSlot } from '../../plugins/PluginSlot'

type EditState = {
  path: number[]
  item: NavConfigItem
}

function cloneConfig(c: NavConfig): NavConfig {
  return JSON.parse(JSON.stringify(c)) as NavConfig
}

function getAt(items: NavConfigItem[], path: number[]): NavConfigItem | null {
  let cur: NavConfigItem[] | undefined = items
  let node: NavConfigItem | null = null
  for (const idx of path) {
    if (!cur || !cur[idx]) return null
    node = cur[idx]!
    cur = node.children
  }
  return node
}

function setAt(items: NavConfigItem[], path: number[], next: NavConfigItem): NavConfigItem[] {
  if (path.length === 0) return items
  const [head, ...rest] = path
  return items.map((it, i) => {
    if (i !== head) return it
    if (rest.length === 0) return next
    return { ...it, children: setAt(it.children || [], rest, next) }
  })
}

function removeAt(items: NavConfigItem[], path: number[]): NavConfigItem[] {
  if (path.length === 1) return items.filter((_, i) => i !== path[0])
  const [head, ...rest] = path
  return items.map((it, i) => {
    if (i !== head) return it
    return { ...it, children: removeAt(it.children || [], rest) }
  })
}

function moveAt(items: NavConfigItem[], path: number[], dir: -1 | 1): NavConfigItem[] {
  if (path.length === 1) {
    const i = path[0]!
    const j = i + dir
    if (j < 0 || j >= items.length) return items
    const next = items.slice()
    const tmp = next[i]!
    next[i] = next[j]!
    next[j] = tmp
    return next
  }
  const [head, ...rest] = path
  return items.map((it, i) => {
    if (i !== head) return it
    return { ...it, children: moveAt(it.children || [], rest, dir) }
  })
}

function addChild(items: NavConfigItem[], path: number[], child: NavConfigItem): NavConfigItem[] {
  if (path.length === 0) return [...items, child]
  const [head, ...rest] = path
  return items.map((it, i) => {
    if (i !== head) return it
    if (rest.length === 0) {
      return { ...it, type: it.type === 'folder' ? it.type : 'folder', children: [...(it.children || []), child] }
    }
    return { ...it, children: addChild(it.children || [], rest, child) }
  })
}

function depthOf(path: number[]): number {
  return path.length
}

function ItemRow({
  item,
  path,
  onEdit,
  onAddChild,
  onRemove,
  onMove
}: {
  item: NavConfigItem
  path: number[]
  onEdit: (path: number[]) => void
  onAddChild: (path: number[]) => void
  onRemove: (path: number[]) => void
  onMove: (path: number[], dir: -1 | 1) => void
}) {
  const depth = depthOf(path)
  const typeIcon =
    item.type === 'folder' ? (
      <FolderOutlined />
    ) : item.type === 'page' ? (
      <FileTextOutlined />
    ) : item.type === 'link' ? (
      <LinkOutlined />
    ) : null
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          marginLeft: (depth - 1) * 20,
          borderRadius: 6,
          background: 'rgba(255,255,255,0.03)',
          marginBottom: 4
        }}
      >
        <span style={{ opacity: 0.7, minWidth: 18 }}>{typeIcon}</span>
        <Typography.Text
          delete={item.hidden}
          style={{ flex: 1, cursor: 'pointer' }}
          onClick={() => onEdit(path)}
        >
          {item.label}
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {item.type === 'builtin'
              ? `内置 · ${item.target || ''}`
              : item.type === 'link'
                ? `链接 · ${item.href || ''}`
                : item.type === 'page'
                  ? '单页 HTML'
                  : '目录'}
            {item.hidden ? ' · 已隐藏' : ''}
          </Typography.Text>
        </Typography.Text>
        <Space size={4}>
          <Button size="small" type="text" icon={<ArrowUpOutlined />} onClick={() => onMove(path, -1)} />
          <Button size="small" type="text" icon={<ArrowDownOutlined />} onClick={() => onMove(path, 1)} />
          {depth < 3 ? (
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => onAddChild(path)} title="添加子项" />
          ) : null}
          <Button size="small" type="text" onClick={() => onEdit(path)}>
            编辑
          </Button>
          <Popconfirm title="删除该项及其子项？" onConfirm={() => onRemove(path)}>
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>
      {(item.children || []).map((ch, i) => (
        <ItemRow
          key={ch.id}
          item={ch}
          path={[...path, i]}
          onEdit={onEdit}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onMove={onMove}
        />
      ))}
    </div>
  )
}

export function SoftSettingsNav() {
  const loaded = useNavConfigStore((s) => s.loaded)
  const saving = useNavConfigStore((s) => s.saving)
  const storeConfig = useNavConfigStore((s) => s.config)
  const init = useNavConfigStore((s) => s.init)
  const reload = useNavConfigStore((s) => s.reload)
  const save = useNavConfigStore((s) => s.save)

  const [draft, setDraft] = useState<NavConfig>(() => cloneConfig(storeConfig))
  const [edit, setEdit] = useState<EditState | null>(null)

  useEffect(() => {
    if (!loaded) void init()
  }, [loaded, init])

  useEffect(() => {
    if (loaded) setDraft(cloneConfig(storeConfig))
  }, [loaded, storeConfig])

  const editItem = edit?.item

  const openEdit = (path: number[]) => {
    const item = getAt(draft.items, path)
    if (!item) return
    setEdit({ path, item: { ...item, children: item.children } })
  }

  const applyEdit = () => {
    if (!edit) return
    const nextItem: NavConfigItem = {
      ...edit.item,
      label: String(edit.item.label || '').trim() || '未命名'
    }
    setDraft({
      ...draft,
      items: setAt(draft.items, edit.path, nextItem)
    })
    setEdit(null)
  }

  const addRoot = (type: NavItemType) => {
    const item = createNavItem({
      type,
      label:
        type === 'folder'
          ? '新目录'
          : type === 'page'
            ? '新单页'
            : type === 'link'
              ? '新链接'
              : '内置项',
      target: type === 'builtin' ? 'fdm' : undefined,
      href: type === 'link' ? 'https://' : undefined,
      html:
        type === 'page'
          ? '<div style="padding:24px;font-family:sans-serif"><h1>空白单页</h1><p>在此编写 HTML。</p></div>'
          : undefined,
      children: type === 'folder' ? [] : undefined
    })
    setDraft({ ...draft, items: [...draft.items, item] })
    setEdit({ path: [draft.items.length], item })
  }

  const doAddChild = (path: number[]) => {
    if (depthOf(path) >= 3) {
      message.warning('最多支持三级导航')
      return
    }
    if (!getAt(draft.items, path)) return
    const child = createNavItem({
      type: 'page',
      label: '子单页',
      html: '<div style="padding:24px"><h2>子页面</h2></div>'
    })
    setDraft({ ...draft, items: addChild(draft.items, path, child) })
  }

  const onSave = async () => {
    const res = await save(draft)
    if (res.ok) message.success('导航已保存')
    else message.error(res.message || '保存失败')
  }

  const resetDefaults = () => {
    Modal.confirm({
      title: '恢复默认导航？',
      content: '将清空自定义项，恢复为内置列表（仍需点保存才写入）。',
      onOk: () => setDraft(defaultNavConfig())
    })
  }

  const builtinOptions = useMemo(
    () =>
      BUILTIN_NAV_DEFAULTS.map((b) => ({
        value: b.target,
        label: `${b.label} (${b.target})`
      })),
    []
  )

  return (
    <div className="settings-nav-panel">
      <PluginSlot name="settings.nav.switches.before" />
      <Card size="small" title="导航总开关" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <span>启用自定义导航</span>
            <Switch
              checked={draft.enabled}
              onChange={(v) => setDraft({ ...draft, enabled: v })}
            />
            <Typography.Text type="secondary">
              关闭时使用系统默认菜单；开启后按下方树形结构显示
            </Typography.Text>
          </Space>
          <Space wrap>
            <span>允许收缩侧栏</span>
            <Switch
              checked={draft.collapsible}
              onChange={(v) => setDraft({ ...draft, collapsible: v })}
            />
            <span>默认收缩</span>
            <Switch
              checked={draft.startCollapsed}
              onChange={(v) => setDraft({ ...draft, startCollapsed: v })}
            />
          </Space>
        </Space>
      </Card>
      <PluginSlot name="settings.nav.switches.after" />

      <PluginSlot name="settings.nav.tree.before" />
      <Card
        size="small"
        title="导航树（最多三级）"
        extra={
          <Space wrap>
            <PluginSlot name="settings.nav.tree.toolbar" />
            <Button icon={<ReloadOutlined />} onClick={() => void reload().then(() => message.success('已刷新'))}>
              刷新
            </Button>
            <Button onClick={resetDefaults}>恢复默认</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Button icon={<PlusOutlined />} onClick={() => addRoot('builtin')}>
            内置页
          </Button>
          <Button icon={<LinkOutlined />} onClick={() => addRoot('link')}>
            外链
          </Button>
          <Button icon={<FileTextOutlined />} onClick={() => addRoot('page')}>
            单页 HTML
          </Button>
          <Button icon={<FolderOutlined />} onClick={() => addRoot('folder')}>
            目录
          </Button>
        </Space>

        {draft.items.map((item, i) => (
          <ItemRow
            key={item.id}
            item={item}
            path={[i]}
            onEdit={openEdit}
            onAddChild={doAddChild}
            onRemove={(path) => setDraft({ ...draft, items: removeAt(draft.items, path) })}
            onMove={(path, dir) => setDraft({ ...draft, items: moveAt(draft.items, path, dir) })}
          />
        ))}

        {!draft.items.length ? (
          <Typography.Text type="secondary">暂无导航项，请添加。</Typography.Text>
        ) : null}
      </Card>
      <PluginSlot name="settings.nav.tree.after" />

      <Modal
        title="编辑导航项"
        open={!!edit}
        onCancel={() => setEdit(null)}
        onOk={applyEdit}
        width={720}
        destroyOnClose
      >
        <PluginSlot name="settings.nav.edit.before" />
        {editItem ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Typography.Text type="secondary">显示名称</Typography.Text>
              <Input
                value={editItem.label}
                onChange={(e) =>
                  setEdit((prev) =>
                    prev ? { ...prev, item: { ...prev.item, label: e.target.value } } : prev
                  )
                }
              />
            </div>
            <div>
              <Typography.Text type="secondary">类型</Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={editItem.type}
                options={[
                  { value: 'builtin', label: '内置功能页' },
                  { value: 'link', label: '自定义链接' },
                  { value: 'page', label: '空白单页（HTML）' },
                  { value: 'folder', label: '目录（可含子导航）' }
                ]}
                onChange={(type: NavItemType) =>
                  setEdit((prev) =>
                    prev
                      ? {
                          ...prev,
                          item: {
                            ...prev.item,
                            type,
                            children:
                              type === 'folder'
                                ? prev.item.children || []
                                : prev.item.children
                          }
                        }
                      : prev
                  )
                }
              />
            </div>
            {editItem.type === 'builtin' ? (
              <div>
                <Typography.Text type="secondary">目标页面 / 插件键</Typography.Text>
                <Select
                  style={{ width: '100%' }}
                  showSearch
                  allowClear
                  value={editItem.target}
                  options={builtinOptions}
                  onChange={(target) =>
                    setEdit((prev) =>
                      prev ? { ...prev, item: { ...prev.item, target } } : prev
                    )
                  }
                />
                <Input
                  style={{ marginTop: 8 }}
                  placeholder="或手动填写，如 plugin:xxx:page"
                  value={editItem.target}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, item: { ...prev.item, target: e.target.value } } : prev
                    )
                  }
                />
              </div>
            ) : null}
            {editItem.type === 'link' ? (
              <>
                <div>
                  <Typography.Text type="secondary">链接地址</Typography.Text>
                  <Input
                    value={editItem.href}
                    placeholder="https://… 或 /path"
                    onChange={(e) =>
                      setEdit((prev) =>
                        prev ? { ...prev, item: { ...prev.item, href: e.target.value } } : prev
                      )
                    }
                  />
                </div>
                <Space>
                  <span>新窗口打开</span>
                  <Switch
                    checked={editItem.openInNewTab !== false}
                    onChange={(v) =>
                      setEdit((prev) =>
                        prev ? { ...prev, item: { ...prev.item, openInNewTab: v } } : prev
                      )
                    }
                  />
                </Space>
              </>
            ) : null}
            {editItem.type === 'page' ? (
              <div>
                <Typography.Text type="secondary">单页 HTML（自定义内容）</Typography.Text>
                <Input.TextArea
                  rows={12}
                  value={editItem.html || ''}
                  placeholder="<h1>标题</h1><p>内容…</p>"
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev ? { ...prev, item: { ...prev.item, html: e.target.value } } : prev
                    )
                  }
                  style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                />
              </div>
            ) : null}
            {editItem.type === 'folder' ? (
              <Space>
                <span>默认折叠</span>
                <Switch
                  checked={!!editItem.defaultCollapsed}
                  onChange={(v) =>
                    setEdit((prev) =>
                      prev ? { ...prev, item: { ...prev.item, defaultCollapsed: v } } : prev
                    )
                  }
                />
              </Space>
            ) : null}
            <Space>
              <span>隐藏此项</span>
              <Switch
                checked={!!editItem.hidden}
                onChange={(v) =>
                  setEdit((prev) =>
                    prev ? { ...prev, item: { ...prev.item, hidden: v } } : prev
                  )
                }
              />
            </Space>
            <PluginSlot name="settings.nav.edit.fields" />
          </Space>
        ) : null}
        <PluginSlot name="settings.nav.edit.footer" />
        <PluginSlot name="settings.nav.edit.after" />
      </Modal>
    </div>
  )
}
