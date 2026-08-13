import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Input,
  Space,
  Switch,
  Table,
  Typography,
  Upload,
  message,
  Modal,
  Tag,
  Collapse,
  Form
} from 'antd'
import { InboxOutlined, ReloadOutlined } from '@ant-design/icons'
import { serverGet, serverSend } from '../../api/serverClient'
import { useDeviceStore, type AppSection } from '../../stores/deviceStore'
import { DocsPanel } from './DocsPanel'
import { PluginSlot } from '../../plugins/PluginSlot'

type KernelDebug = {
  kernelVersion?: string
  hooks?: Array<{ name: string; pluginId: string; priority: number }>
  hookStats?: {
    invocations?: number
    errors?: number
    timeouts?: number
    circuitOpens?: number
    lastError?: { hook: string; pluginId: string; message: string; at: string }
    byPlugin?: Record<string, { invocations: number; errors: number; timeouts: number; openUntil?: number }>
  }
  cron?: Array<{
    pluginId: string
    module: string
    schedule: string
    lastRunAt?: string
    lastOkAt?: string
    lastError?: string
    lastDurationMs?: number
    running: boolean
    skippedBusy: number
  }>
  extensionPoints?: Array<{ slot: string; section: string; required: boolean; kind: string }>
}

type PluginRow = {
  identifier: string
  name: string
  version: string
  description: string
  copyright: string
  available: boolean
  error?: string
  vars: Record<string, string>
  modules: Array<{ name: string; menu: string; type: string }>
  apiVersion?: string
  requires?: { kernel?: string; plugins?: Record<string, string> }
  conflicts?: string[]
  capabilities?: string[]
  enabledModules?: Record<string, boolean>
}

type Bundled = { identifier: string; name: string; version: string }

type ModuleRef = { pluginId: string; module: string }

type UserGroup = {
  id: string
  name: string
  description?: string
  permissions: string[]
  moduleAccess: ModuleRef[]
}

function parseModuleAccessLines(text: string): ModuleRef[] {
  const out: ModuleRef[] = []
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const raw = line.trim()
    if (!raw) continue
    const idx = raw.indexOf(':')
    if (idx <= 0) continue
    const pluginId = raw.slice(0, idx).trim()
    const module = raw.slice(idx + 1).trim()
    if (!pluginId || !module) continue
    const key = `${pluginId}:${module}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ pluginId, module })
  }
  return out
}

function moduleAccessToLines(list: ModuleRef[] | undefined): string {
  return (list || []).map((m) => `${m.pluginId}:${m.module}`).join('\n')
}

function normalizeGroupsFromResponse(data: {
  groups?: unknown[]
  packs?: unknown[]
}): UserGroup[] {
  const raw = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray(data.packs)
      ? data.packs
      : []
  const out: UserGroup[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = String(o.id || '').trim()
    if (!id) continue
    out.push({
      id,
      name: String(o.name || id),
      description: o.description ? String(o.description) : undefined,
      permissions: Array.isArray(o.permissions) ? o.permissions.map(String) : [],
      moduleAccess: Array.isArray(o.moduleAccess)
        ? (o.moduleAccess as ModuleRef[])
            .filter((m) => m && typeof m === 'object')
            .map((m) => ({
              pluginId: String((m as ModuleRef).pluginId || ''),
              module: String((m as ModuleRef).module || '')
            }))
            .filter((m) => m.pluginId && m.module)
        : []
    })
  }
  return out
}

export function SoftSettingsPlugins() {
  const [plugins, setPlugins] = useState<PluginRow[]>([])
  const [bundled, setBundled] = useState<Bundled[]>([])
  const [kernelVersion, setKernelVersion] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [varsOpen, setVarsOpen] = useState<PluginRow | null>(null)
  const [varsDraft, setVarsDraft] = useState<Record<string, string>>({})
  const [modulesOpen, setModulesOpen] = useState<PluginRow | null>(null)
  const [modulesDraft, setModulesDraft] = useState<Record<string, boolean>>({})
  const [debug, setDebug] = useState<KernelDebug | null>(null)
  const [urlInstall, setUrlInstall] = useState({ url: '', sha256: '' })
  const [groups, setGroups] = useState<UserGroup[]>([])
  const [groupModal, setGroupModal] = useState<'new' | UserGroup | null>(null)
  const [groupForm] = Form.useForm()
  const [groupsSaving, setGroupsSaving] = useState(false)

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await serverGet<{
        plugins?: PluginRow[]
        bundled?: Bundled[]
        kernelVersion?: string
      }>('/api/v1/plugins')
      setPlugins(data.plugins || [])
      setBundled(data.bundled || [])
      setKernelVersion(data.kernelVersion || '')
      try {
        const dbg = await serverGet<KernelDebug>('/api/v1/plugins/kernel-debug')
        setDebug(dbg)
      } catch {
        setDebug(null)
      }
      try {
        const ug = await serverGet<{ groups?: unknown[]; packs?: unknown[] }>(
          '/api/v1/user-groups'
        )
        setGroups(normalizeGroupsFromResponse(ug))
      } catch {
        try {
          const packs = await serverGet<{ groups?: unknown[]; packs?: unknown[] }>(
            '/api/v1/permission-packs'
          )
          setGroups(normalizeGroupsFromResponse(packs))
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const saveGroups = async (next: UserGroup[]) => {
    setGroupsSaving(true)
    try {
      try {
        const res = await serverSend<{ groups?: unknown[]; packs?: unknown[] }>(
          '/api/v1/user-groups',
          'PUT',
          { groups: next }
        )
        setGroups(normalizeGroupsFromResponse(res))
      } catch {
        const res = await serverSend<{ groups?: unknown[]; packs?: unknown[] }>(
          '/api/v1/permission-packs',
          'PUT',
          { packs: next.map((g) => ({ ...g, permissions: g.permissions })) }
        )
        setGroups(normalizeGroupsFromResponse(res))
      }
      message.success('用户组已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      setGroupsSaving(false)
    }
  }

  const openGroupModal = (g: 'new' | UserGroup) => {
    setGroupModal(g)
    if (g === 'new') {
      groupForm.setFieldsValue({
        id: '',
        name: '',
        description: '',
        permissionsText: '',
        moduleAccessText: ''
      })
    } else {
      groupForm.setFieldsValue({
        id: g.id,
        name: g.name,
        description: g.description || '',
        permissionsText: (g.permissions || []).join('\n'),
        moduleAccessText: moduleAccessToLines(g.moduleAccess)
      })
    }
  }

  const installBundled = async (id: string) => {
    try {
      await serverSend('/api/v1/plugins/install-bundled', 'POST', { identifier: id })
      message.success('已安装')
      await refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const onZip = async (file: File) => {
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const zipBase64 = btoa(binary)
      await serverSend('/api/v1/plugins/install-zip', 'POST', { zipBase64 })
      message.success('插件包已安装')
      await refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
    return false
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        className="settings-card"
        title="插件中心"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          插件微内核 <Tag color="blue">v{kernelVersion || '2'}</Tag>：推荐{' '}
          <code>apiVersion: &quot;2&quot;</code> + <code>activate(ctx)</code>（Hook / Context / 模板 / HMAC 回调 /
          cron）。旧版 <code>main.js</code> 同名钩子仍兼容。包结构：
          <code>plugin.json</code> + 服务端 + <code>client.js</code>/<code>login.js</code> + 槽位/模板 +{' '}
          <code>theme.css</code>。只安装可信来源。示例：
          <Typography.Link href="/api/v1/docs/downloads/hanye-plugin-sample-hello.zip">
            sample-hello.zip
          </Typography.Link>
          、
          <Typography.Link href="/api/v1/docs/downloads/hanye-plugin-kernel-v2.zip">
            kernel-v2.zip
          </Typography.Link>
          。手册见页底「插件开发文档」与「微内核 v2」；主题换皮见主题页文档。
        </Typography.Paragraph>

        <Upload.Dragger
          accept=".zip"
          showUploadList={false}
          beforeUpload={(file) => {
            void onZip(file)
            return false
          }}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">拖拽或点击上传插件 ZIP</p>
          <p className="ant-upload-hint">包根目录须含 plugin.json</p>
        </Upload.Dragger>
        <PluginSlot name="settings.plugins.upload.after" />

        <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
          <Input
            placeholder="从 URL 安装 ZIP（http/https）"
            value={urlInstall.url}
            onChange={(e) => setUrlInstall((s) => ({ ...s, url: e.target.value }))}
          />
          <Input
            style={{ width: 200 }}
            placeholder="可选 sha256"
            value={urlInstall.sha256}
            onChange={(e) => setUrlInstall((s) => ({ ...s, sha256: e.target.value }))}
          />
          <Button
            type="primary"
            onClick={() => {
              void (async () => {
                try {
                  await serverSend('/api/v1/plugins/install-url', 'POST', {
                    url: urlInstall.url,
                    sha256: urlInstall.sha256 || undefined
                  })
                  message.success('已从 URL 安装')
                  setUrlInstall({ url: '', sha256: '' })
                  await refresh()
                } catch (e) {
                  message.error(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            安装
          </Button>
        </Space.Compact>
        <PluginSlot name="settings.plugins.installUrl.after" />

        {bundled.length ? (
          <>
            <Typography.Title level={5}>内置示例</Typography.Title>
            <Space wrap style={{ marginBottom: 16 }}>
              {bundled.map((b) => (
                <Button key={b.identifier} onClick={() => void installBundled(b.identifier)}>
                  安装 {b.name} v{b.version}
                </Button>
              ))}
            </Space>
            <PluginSlot name="settings.plugins.bundled.after" />
          </>
        ) : null}

        <PluginSlot name="settings.plugins.list.before" />
        <Table
          rowKey="identifier"
          loading={loading}
          dataSource={plugins}
          pagination={false}
          columns={[
            {
              title: '插件',
              render: (_, r) => (
                <div>
                  <Typography.Text strong>{r.name}</Typography.Text>
                  <div>
                    <Typography.Text type="secondary" code>
                      {r.identifier}
                    </Typography.Text>{' '}
                    <Tag>v{r.version}</Tag>
                    <Tag color={r.apiVersion === '2' ? 'processing' : 'default'}>
                      API {r.apiVersion || '1'}
                    </Tag>
                    {r.error ? <Tag color="error">{r.error}</Tag> : null}
                  </div>
                  <Typography.Text type="secondary">{r.description}</Typography.Text>
                  {r.requires?.kernel || (r.requires?.plugins && Object.keys(r.requires.plugins).length) ? (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        依赖：
                        {r.requires.kernel ? ` kernel ${r.requires.kernel}` : ''}
                        {r.requires.plugins
                          ? Object.entries(r.requires.plugins)
                              .map(([k, v]) => ` ${k}@${v}`)
                              .join('')
                          : ''}
                      </Typography.Text>
                    </div>
                  ) : null}
                  {r.conflicts?.length ? (
                    <div>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        冲突：{r.conflicts.join(', ')}
                      </Typography.Text>
                    </div>
                  ) : null}
                </div>
              )
            },
            {
              title: '启用',
              width: 90,
              render: (_, r) => (
                <Switch
                  checked={r.available}
                  onChange={(v) => {
                    void (async () => {
                      try {
                        await serverSend(
                          `/api/v1/plugins/${encodeURIComponent(r.identifier)}/${v ? 'enable' : 'disable'}`,
                          'POST',
                          {}
                        )
                        await refresh()
                      } catch (e) {
                        message.error(e instanceof Error ? e.message : String(e))
                      }
                    })()
                  }}
                />
              )
            },
            {
              title: '操作',
              width: 340,
              render: (_, r) => (
                <Space wrap>
                  <Button
                    size="small"
                    onClick={() => {
                      setVarsDraft({ ...r.vars })
                      setVarsOpen(r)
                    }}
                  >
                    变量
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      const draft: Record<string, boolean> = {}
                      for (const m of r.modules || []) {
                        draft[m.name] = r.enabledModules?.[m.name] !== false
                      }
                      setModulesDraft(draft)
                      setModulesOpen(r)
                    }}
                  >
                    模块
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      const admin =
                        r.modules.find((m) => m.type === 'admin')?.name ||
                        r.modules[0]?.name ||
                        'admin'
                      useDeviceStore
                        .getState()
                        .setSection(`plugin:${r.identifier}:${admin}` as AppSection)
                      message.success('已打开插件模块页')
                    }}
                  >
                    打开模块
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      Modal.confirm({
                        title: `卸载 ${r.name}？`,
                        onOk: async () => {
                          await serverSend(
                            `/api/v1/plugins/${encodeURIComponent(r.identifier)}`,
                            'DELETE'
                          )
                          message.success('已卸载')
                          await refresh()
                        }
                      })
                    }}
                  >
                    卸载
                  </Button>
                </Space>
              )
            }
          ]}
        />
        <PluginSlot name="settings.plugins.list.after" />
      </Card>

      <Modal
        title={varsOpen ? `变量 · ${varsOpen.name}` : '变量'}
        open={!!varsOpen}
        onCancel={() => setVarsOpen(null)}
        onOk={() => {
          void (async () => {
            if (!varsOpen) return
            try {
              await serverSend(
                `/api/v1/plugins/${encodeURIComponent(varsOpen.identifier)}/vars`,
                'PATCH',
                { vars: varsDraft }
              )
              message.success('已保存')
              setVarsOpen(null)
              await refresh()
            } catch (e) {
              message.error(e instanceof Error ? e.message : String(e))
            }
          })()
        }}
      >
        <PluginSlot name="settings.plugins.vars.before" />
        <Space direction="vertical" style={{ width: '100%' }}>
          {Object.keys(varsDraft).length === 0 ? (
            <Typography.Text type="secondary">无变量</Typography.Text>
          ) : (
            Object.keys(varsDraft).map((k) => (
              <Input
                key={k}
                addonBefore={k}
                value={varsDraft[k]}
                onChange={(e) => setVarsDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
            ))
          )}
        </Space>
        <PluginSlot name="settings.plugins.vars.after" />
      </Modal>

      <Modal
        title={modulesOpen ? `模块 · ${modulesOpen.name}` : '模块'}
        open={!!modulesOpen}
        onCancel={() => setModulesOpen(null)}
        onOk={() => {
          void (async () => {
            if (!modulesOpen) return
            try {
              await serverSend(
                `/api/v1/plugins/${encodeURIComponent(modulesOpen.identifier)}/modules-enabled`,
                'PATCH',
                { enabledModules: modulesDraft }
              )
              message.success('模块开关已保存')
              setModulesOpen(null)
              await refresh()
            } catch (e) {
              message.error(e instanceof Error ? e.message : String(e))
            }
          })()
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          {(modulesOpen?.modules || []).length === 0 ? (
            <Typography.Text type="secondary">无模块</Typography.Text>
          ) : (
            (modulesOpen?.modules || []).map((m) => (
              <div
                key={m.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12
                }}
              >
                <div>
                  <Typography.Text strong>{m.menu || m.name}</Typography.Text>
                  <div>
                    <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
                      {m.name}
                    </Typography.Text>{' '}
                    <Tag>{m.type}</Tag>
                  </div>
                </div>
                <Switch
                  checked={modulesDraft[m.name] !== false}
                  onChange={(v) => setModulesDraft((d) => ({ ...d, [m.name]: v }))}
                />
              </div>
            ))
          )}
        </Space>
      </Modal>

      <Card
        className="settings-card"
        title="用户组"
        extra={
          <Button type="primary" onClick={() => openGroupModal('new')}>
            新增
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          用户组提供权限码与插件模块访问白名单；用户可同时归属多个组，有效权限为直接勾选 ∪
          用户组权限。
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={loading || groupsSaving}
          dataSource={groups}
          pagination={false}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 120 },
            { title: '名称', dataIndex: 'name', width: 140 },
            {
              title: '说明',
              dataIndex: 'description',
              ellipsis: true,
              render: (v?: string) => v || '—'
            },
            {
              title: '权限数',
              width: 90,
              render: (_, r) => r.permissions?.length || 0
            },
            {
              title: '模块访问',
              width: 100,
              render: (_, r) => r.moduleAccess?.length || 0
            },
            {
              title: '操作',
              width: 140,
              render: (_, r) => (
                <Space>
                  <Button size="small" onClick={() => openGroupModal(r)}>
                    编辑
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      Modal.confirm({
                        title: `删除用户组 ${r.name}？`,
                        content: `id: ${r.id}`,
                        okType: 'danger',
                        onOk: async () => {
                          await saveGroups(groups.filter((g) => g.id !== r.id))
                        }
                      })
                    }}
                  >
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Modal
        title={groupModal === 'new' ? '新增用户组' : `编辑用户组 · ${groupModal?.id || ''}`}
        open={!!groupModal}
        confirmLoading={groupsSaving}
        onCancel={() => setGroupModal(null)}
        onOk={() => {
          void (async () => {
            try {
              const vals = await groupForm.validateFields()
              const id = String(vals.id || '')
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9_]+/g, '_')
              if (!id) {
                message.error('请填写 id')
                return
              }
              const nextGroup: UserGroup = {
                id,
                name: String(vals.name || id).trim() || id,
                description: String(vals.description || '').trim() || undefined,
                permissions: String(vals.permissionsText || '')
                  .split('\n')
                  .map((s: string) => s.trim())
                  .filter(Boolean),
                moduleAccess: parseModuleAccessLines(String(vals.moduleAccessText || ''))
              }
              const isNew = groupModal === 'new'
              if (isNew && groups.some((g) => g.id === id)) {
                message.error('该 id 已存在')
                return
              }
              const next = isNew
                ? [...groups, nextGroup]
                : groups.map((g) => (g.id === (groupModal as UserGroup).id ? nextGroup : g))
              await saveGroups(next)
              setGroupModal(null)
            } catch (e) {
              if (e && typeof e === 'object' && 'errorFields' in e) return
            }
          })()
        }}
        width={640}
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item
            label="ID"
            name="id"
            rules={[{ required: true, message: '请填写 id' }]}
            extra="小写字母、数字、下划线；新建后建议勿改"
          >
            <Input disabled={groupModal !== 'new'} placeholder="例如 operator" />
          </Form.Item>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请填写名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label="权限码"
            name="permissionsText"
            extra="每行一个权限码，例如 nav.devices"
          >
            <Input.TextArea rows={8} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
          <Form.Item
            label="模块访问 (moduleAccess)"
            name="moduleAccessText"
            extra="每行 pluginId:moduleName，例如 demo_kernel_v2:admin"
          >
            <Input.TextArea rows={4} style={{ fontFamily: 'monospace', fontSize: 12 }} />
          </Form.Item>
        </Form>
      </Modal>

      <PluginSlot name="settings.plugins.debug.before" />
      <Card className="settings-card" title="内核调试 / 扩展点 / Cron">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Hook 超时默认 5s，连续失败熔断 30s；Cron 同任务互斥（跳过 busy）。扩展点清单用于整页覆盖闭环。
        </Typography.Paragraph>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button loading={loading} onClick={() => void refresh()}>
            刷新调试信息
          </Button>
          <Button
            onClick={() => {
              void (async () => {
                try {
                  const dbg = await serverSend<KernelDebug>(
                    '/api/v1/plugins/kernel-debug/reset-stats',
                    'POST',
                    {}
                  )
                  setDebug(dbg)
                  message.success('已重置 Hook 统计')
                } catch (e) {
                  message.error(e instanceof Error ? e.message : String(e))
                }
              })()
            }}
          >
            重置 Hook 统计
          </Button>
        </Space>
        {debug?.hookStats ? (
          <Typography.Paragraph>
            调用 {debug.hookStats.invocations ?? 0} · 错误 {debug.hookStats.errors ?? 0} · 超时{' '}
            {debug.hookStats.timeouts ?? 0} · 熔断打开 {debug.hookStats.circuitOpens ?? 0}
            {debug.hookStats.lastError ? (
              <>
                <br />
                最近错误：[{debug.hookStats.lastError.pluginId}] {debug.hookStats.lastError.hook} —{' '}
                {debug.hookStats.lastError.message}
              </>
            ) : null}
          </Typography.Paragraph>
        ) : null}
        <Collapse
          items={[
            {
              key: 'hooks',
              label: `已注册钩子 (${debug?.hooks?.length ?? 0})`,
              children: (
                <Table
                  size="small"
                  rowKey={(r) => `${r.name}:${r.pluginId}:${r.priority}`}
                  pagination={{ pageSize: 8 }}
                  dataSource={debug?.hooks || []}
                  columns={[
                    { title: 'Hook', dataIndex: 'name' },
                    { title: '插件', dataIndex: 'pluginId', width: 160 },
                    { title: '优先级', dataIndex: 'priority', width: 80 }
                  ]}
                />
              )
            },
            {
              key: 'cron',
              label: `Cron 任务 (${debug?.cron?.length ?? 0})`,
              children: (
                <Table
                  size="small"
                  rowKey={(r) => `${r.pluginId}:${r.module}`}
                  pagination={false}
                  dataSource={debug?.cron || []}
                  columns={[
                    { title: '插件', dataIndex: 'pluginId' },
                    { title: '模块', dataIndex: 'module' },
                    { title: '调度', dataIndex: 'schedule' },
                    {
                      title: '状态',
                      render: (_, r) =>
                        r.running ? (
                          <Tag color="processing">运行中</Tag>
                        ) : r.lastError ? (
                          <Tag color="error">失败</Tag>
                        ) : (
                          <Tag color="success">空闲</Tag>
                        )
                    },
                    { title: '上次', dataIndex: 'lastRunAt', ellipsis: true },
                    { title: '跳过(busy)', dataIndex: 'skippedBusy', width: 100 },
                    {
                      title: '错误',
                      dataIndex: 'lastError',
                      ellipsis: true
                    }
                  ]}
                />
              )
            },
            {
              key: 'ext',
              label: `扩展点目录 (${debug?.extensionPoints?.length ?? 0})`,
              children: (
                <Table
                  size="small"
                  rowKey="slot"
                  pagination={false}
                  dataSource={debug?.extensionPoints || []}
                  columns={[
                    { title: 'Slot', dataIndex: 'slot' },
                    { title: '分区', dataIndex: 'section' },
                    { title: '类型', dataIndex: 'kind', width: 90 },
                    {
                      title: '必填',
                      dataIndex: 'required',
                      width: 70,
                      render: (v: boolean) => (v ? '是' : '否')
                    }
                  ]}
                />
              )
            }
          ]}
        />
      </Card>
      <PluginSlot name="settings.plugins.debug.after" />

      <DocsPanel doc="PLUGIN" defaultOpen />
      <DocsPanel doc="PLUGIN_KERNEL_V2" defaultOpen={false} />
    </Space>
  )
}
