import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message
} from 'antd'
import {
  defaultPermissions,
  DEVICE_ACTION_PERMS,
  DEVICE_GLOBAL_PERMS,
  FILAMENT_PERMS,
  LEVEL_LABELS,
  NAV_PERMS,
  PERM_LABELS,
  PRINT_APPROVE_PERMS,
  type AuthUserPublic,
  type UserLevel
} from '@shared/permissions'
import { SSO_PROVIDER_LABELS, type SsoProviderId, type SsoProviderOption } from '@shared/sso'
import { useDeviceStore } from '../stores/deviceStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { isAdminUi, isRemoteDataMode } from '../utils/appMode'
import { isClientMode } from '../api/serverClient'
import { serverGet } from '../api/serverClient'
import * as usersApi from '../api/usersApi'
import { PluginSlot } from '../plugins/PluginSlot'
import { getHanyePlugin } from '../plugins/runtime'
import {
  UsersPluginFields,
  applyUserFieldCollect,
  pickUserPluginPayload,
  userPluginFormSeed,
  userPreserveExtras
} from './UsersPluginHosts'

const ALL_GLOBAL = [
  ...NAV_PERMS,
  ...DEVICE_GLOBAL_PERMS,
  ...FILAMENT_PERMS,
  ...PRINT_APPROVE_PERMS
]

function globalPermsOnly(list: string[]): string[] {
  return list.filter((p) => !p.startsWith('device.action.'))
}

type PluginPermRow = { code: string; label: string; plugin?: string; description?: string }

type UserRow = AuthUserPublic & {
  online?: boolean
  lastSeenAt?: string
  connectedAt?: string
  [key: string]: unknown
}

export function UsersPage() {
  const role = useAuthStore((s) => s.role)
  const devices = useDeviceStore((s) => s.devices)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<AuthUserPublic | null>(null)
  const [creating, setCreating] = useState(false)
  const [pluginPerms, setPluginPerms] = useState<PluginPermRow[]>([])
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    return getHanyePlugin().on('users:change', () => bumpPlugin())
  }, [])

  const reload = async () => {
    setLoading(true)
    try {
      if (!isClientMode()) {
        const res = await window.electronAPI?.auth?.localUsers?.()
        if (res?.ok) setUsers((res.users || []) as UserRow[])
        else message.error(res?.message || '加载失败')
      } else if (isAdminUi()) {
        setUsers(await usersApi.fetchUsers())
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
    const canPoll = !isClientMode() || isAdminUi()
    if (!canPoll) return
    const t = window.setInterval(() => void reload(), 8000)
    return () => window.clearInterval(t)
  }, [role])

  useEffect(() => {
    let cancelled = false
    void serverGet<{ pluginPerms?: PluginPermRow[] }>('/api/v1/auth/meta')
      .then((data) => {
        if (!cancelled) setPluginPerms(Array.isArray(data.pluginPerms) ? data.pluginPerms : [])
      })
      .catch(() => {
        if (!cancelled) setPluginPerms([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const pageCtx = useMemo(
    () => ({
      users: users as unknown as Record<string, unknown>[],
      reload: () => void reload()
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [users, pluginTick]
  )

  const toolbarActions = useMemo(
    () => getHanyePlugin().getUserToolbarActions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const pluginColumns = useMemo(
    () => getHanyePlugin().getUserColumns(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const rowActions = useMemo(
    () => getHanyePlugin().getUserRowActions(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const columns = useMemo(() => {
    const base = [
      { title: '用户名', dataIndex: 'username' as const },
      { title: '显示名', dataIndex: 'displayName' as const },
      {
        title: '等级',
        dataIndex: 'level' as const,
        render: (lv: UserLevel) => LEVEL_LABELS[lv] || lv
      },
      {
        title: '账号',
        dataIndex: 'enabled' as const,
        render: (v: boolean, r: UserRow) =>
          v ? (
            <Tag color="green">正常</Tag>
          ) : (
            <Space direction="vertical" size={0}>
              <Tag color="error">已封号</Tag>
              {r.banReason ? (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {r.banReason}
                </Typography.Text>
              ) : null}
            </Space>
          )
      },
      {
        title: '在线',
        render: (_: unknown, r: UserRow) =>
          r.online ? <Tag color="processing">在线</Tag> : <Tag>离线</Tag>
      },
      {
        title: '最近活动',
        render: (_: unknown, r: UserRow) =>
          r.lastSeenAt ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {String(r.lastSeenAt).replace('T', ' ').slice(0, 19)}
            </Typography.Text>
          ) : (
            <Typography.Text type="secondary">—</Typography.Text>
          )
      },
      {
        title: '权限数',
        render: (_: unknown, r: UserRow) => r.permissions?.length || 0
      },
      {
        title: '对接',
        render: (_: unknown, r: UserRow) => {
          const p = r.ssoProvider || 'none'
          if (p === 'none') return <Typography.Text type="secondary">本地</Typography.Text>
          return (
            <Tag>
              {SSO_PROVIDER_LABELS[p as SsoProviderId] || p}
              {r.ssoExternalId ? ` · ${r.ssoExternalId}` : ''}
            </Tag>
          )
        }
      },
      ...pluginColumns.map((c) => ({
        title: c.title,
        width: c.width,
        render: (_: unknown, r: UserRow) =>
          c.render(r as unknown as Record<string, unknown>, pageCtx)
      })),
      {
        title: '操作',
        render: (_: unknown, r: UserRow) => (
          <Space wrap>
            <Button size="small" onClick={() => setEdit(r)}>
              编辑
            </Button>
            <Button
              size="small"
              onClick={async () => {
                const res =
                  isRemoteDataMode() && isAdminUi()
                    ? await usersApi.kickUser(r.id)
                    : await window.electronAPI?.auth?.localKickUser?.(r.id)
                if (res?.ok) {
                  message.success(res.message || '已踢下线')
                  void reload()
                } else message.error(res?.message || '踢下线失败')
              }}
            >
              踢下线
            </Button>
            {r.enabled ? (
              <Button
                size="small"
                danger
                onClick={() => {
                  let reason = ''
                  Modal.confirm({
                    title: `封号 ${r.username}？`,
                    content: (
                      <div>
                        <Typography.Paragraph style={{ marginBottom: 8 }}>
                          封号后该用户无法登录，在线会话会立即被踢下线。
                        </Typography.Paragraph>
                        <Input.TextArea
                          rows={2}
                          placeholder="封号原因（可选）"
                          onChange={(e) => {
                            reason = e.target.value
                          }}
                        />
                      </div>
                    ),
                    okText: '确认封号',
                    okType: 'danger',
                    onOk: async () => {
                      const res =
                        isRemoteDataMode() && isAdminUi()
                          ? await usersApi.banUser(r.id, reason.trim() || undefined)
                          : await window.electronAPI?.auth?.localBanUser?.({
                              id: r.id,
                              reason: reason.trim() || undefined
                            })
                      if (res?.ok) {
                        message.success(res.message || '已封号')
                        void reload()
                      } else {
                        message.error(res?.message || '封号失败')
                        return Promise.reject()
                      }
                    }
                  })
                }}
              >
                封号
              </Button>
            ) : (
              <Button
                size="small"
                type="primary"
                ghost
                onClick={async () => {
                  Modal.confirm({
                    title: `解封 ${r.username}？`,
                    content: '解封后用户可重新登录。',
                    okText: '确认解封',
                    onOk: async () => {
                      const res =
                        isRemoteDataMode() && isAdminUi()
                          ? await usersApi.unbanUser(r.id)
                          : await window.electronAPI?.auth?.localUnbanUser?.(r.id)
                      if (res?.ok) {
                        message.success(res.message || '已解封')
                        void reload()
                      } else {
                        message.error(res?.message || '解封失败')
                        return Promise.reject()
                      }
                    }
                  })
                }}
              >
                解封
              </Button>
            )}
            <Button
              size="small"
              danger
              onClick={async () => {
                Modal.confirm({
                  title: `删除用户 ${r.username}？`,
                  content: r.online
                    ? '该用户当前在线，删除后将立即踢下线并吊销令牌。'
                    : '删除后不可恢复。',
                  okType: 'danger',
                  onOk: async () => {
                    const res =
                      isRemoteDataMode() && isAdminUi()
                        ? await usersApi.deleteUser(r.id)
                        : await window.electronAPI?.auth?.localDeleteUser?.(r.id)
                    if (res?.ok) {
                      message.success('已删除')
                      void reload()
                    } else message.error(res?.message || '删除失败')
                  }
                })
              }}
            >
              删除
            </Button>
            {rowActions.map((a) => (
              <Button
                key={a.id}
                size="small"
                danger={a.danger}
                onClick={() => {
                  void Promise.resolve(
                    a.run({
                      ...pageCtx,
                      user: r as unknown as Record<string, unknown>
                    })
                  ).catch((e) =>
                    message.error(e instanceof Error ? e.message : String(e))
                  )
                }}
              >
                {a.label}
              </Button>
            ))}
            <PluginSlot
              name="users.row.actions"
              context={{ user: r, reload: pageCtx.reload }}
            />
          </Space>
        )
      }
    ]
    return base
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginColumns, rowActions, pageCtx, pluginTick])

  return (
    <div style={{ padding: 16 }}>
      <PluginSlot name="users.header.before" context={pageCtx} />
      <PluginSlot name="users.toolbar.before" context={pageCtx} />
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>
          用户与权限
        </Typography.Title>
        <Button type="primary" onClick={() => setCreating(true)}>
          新建用户
        </Button>
        <Button onClick={() => void reload()}>刷新</Button>
        {toolbarActions.map((a) => (
          <Button
            key={a.id}
            onClick={() => {
              void Promise.resolve(a.run(pageCtx)).catch((e) =>
                message.error(e instanceof Error ? e.message : String(e))
              )
            }}
          >
            {a.label}
          </Button>
        ))}
      </Space>
      <PluginSlot name="users.toolbar.after" context={pageCtx} />
      <Typography.Paragraph type="secondary">
        可新建用户、分配权限，并按设备单独授权。默认管理员 admin / admin123，首次登录会强制改密。在线状态来自网页登录心跳（约
        90 秒无活动视为离线）；踢下线会吊销令牌；封号后无法登录。插件可通过列 / 工具栏 /
        表单字段扩展本页。
      </Typography.Paragraph>
      <PluginSlot name="users.header.after" context={pageCtx} />
      <PluginSlot name="users.list.before" context={pageCtx} />
      <Table
        rowKey="id"
        loading={loading}
        dataSource={users}
        pagination={false}
        columns={columns}
        locale={{
          emptyText: (
            <PluginSlot name="users.list.empty" replace context={pageCtx}>
              <Empty description="暂无用户" />
            </PluginSlot>
          )
        }}
      />
      <PluginSlot name="users.list.after" context={pageCtx} />

      <UserEditor
        open={creating || !!edit}
        user={edit}
        devices={devices.map((d) => ({ id: d.id, name: d.name }))}
        pluginPerms={pluginPerms}
        onCancel={() => {
          setCreating(false)
          setEdit(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEdit(null)
          void reload()
        }}
      />
    </div>
  )
}

function UserEditor(props: {
  open: boolean
  user: AuthUserPublic | null
  devices: Array<{ id: string; name: string }>
  pluginPerms: PluginPermRow[]
  onCancel: () => void
  onSaved: () => void
}) {
  const isNew = !props.user
  const formMode = isNew ? 'create' : 'edit'
  const [form] = Form.useForm()
  const [perms, setPerms] = useState<string[]>([])
  const [deviceAcl, setDeviceAcl] = useState<Record<string, string[]>>({})
  const [ssoProvider, setSsoProvider] = useState<'none' | SsoProviderId>('none')
  const [ssoExternalId, setSsoExternalId] = useState('')
  const [saving, setSaving] = useState(false)
  const [pluginTick, bumpPlugin] = useReducer((n: number) => n + 1, 0)
  const [userGroups, setUserGroups] = useState<
    Array<{ id: string; name: string; description?: string; permissions: string[] }>
  >([])
  const [groupIds, setGroupIds] = useState<string[]>([])
  const sso = useSettingsStore((s) => s.settings.sso)

  useEffect(() => {
    return getHanyePlugin().on('users:change', () => bumpPlugin())
  }, [])

  useEffect(() => {
    if (!props.open) return
    void (async () => {
      try {
        const data = await serverGet<{
          groups?: Array<{ id: string; name: string; description?: string; permissions: string[] }>
          packs?: Array<{ id: string; name: string; description?: string; permissions: string[] }>
        }>('/api/v1/user-groups')
        const list = Array.isArray(data.groups)
          ? data.groups
          : Array.isArray(data.packs)
            ? data.packs
            : []
        setUserGroups(
          list.map((g) => ({
            id: String(g.id),
            name: String(g.name || g.id),
            description: g.description ? String(g.description) : undefined,
            permissions: Array.isArray(g.permissions) ? g.permissions.map(String) : []
          }))
        )
      } catch {
        try {
          const data = await serverGet<{
            groups?: Array<{ id: string; name: string; description?: string; permissions: string[] }>
            packs?: Array<{ id: string; name: string; description?: string; permissions: string[] }>
          }>('/api/v1/permission-packs')
          const list = Array.isArray(data.groups)
            ? data.groups
            : Array.isArray(data.packs)
              ? data.packs
              : []
          setUserGroups(
            list.map((g) => ({
              id: String(g.id),
              name: String(g.name || g.id),
              description: g.description ? String(g.description) : undefined,
              permissions: Array.isArray(g.permissions) ? g.permissions.map(String) : []
            }))
          )
        } catch {
          setUserGroups([])
        }
      }
    })()
  }, [props.open])

  const pluginCodes = useMemo(
    () => new Set(props.pluginPerms.map((p) => p.code).filter(Boolean)),
    [props.pluginPerms]
  )

  const permGroups = useMemo(
    () => getHanyePlugin().getUserPermGroups(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pluginTick]
  )

  const groupCodes = useMemo(() => {
    const s = new Set<string>()
    for (const g of permGroups) {
      for (const o of g.options) s.add(o.code)
    }
    return s
  }, [permGroups])

  const ssoOptions = useMemo(() => {
    const list: SsoProviderOption[] = []
    if (sso.wecom.enabled) {
      list.push({
        id: 'wecom',
        label: SSO_PROVIDER_LABELS.wecom,
        scanLogin: true,
        enabled: true,
        configured: Boolean(sso.wecom.corpId && sso.wecom.secret)
      })
    }
    if (sso.dingtalk.enabled) {
      list.push({
        id: 'dingtalk',
        label: SSO_PROVIDER_LABELS.dingtalk,
        scanLogin: true,
        enabled: true,
        configured: Boolean(sso.dingtalk.appKey && sso.dingtalk.appSecret)
      })
    }
    if (sso.ad.enabled) {
      list.push({
        id: 'ad',
        label: SSO_PROVIDER_LABELS.ad,
        scanLogin: false,
        enabled: true,
        configured: Boolean(sso.ad.ldapUrl && sso.ad.baseDn)
      })
    }
    return list
  }, [sso])

  useEffect(() => {
    if (!props.open) return
    if (props.user) {
      const row = props.user as unknown as Record<string, unknown>
      form.setFieldsValue({
        username: props.user.username,
        displayName: props.user.displayName,
        level: props.user.level,
        enabled: props.user.enabled,
        password: '',
        ...userPluginFormSeed(row)
      })
      setPerms(globalPermsOnly(props.user.permissions || []))
      setDeviceAcl(props.user.deviceAcl || {})
      setSsoProvider((props.user.ssoProvider as 'none' | SsoProviderId) || 'none')
      setSsoExternalId(props.user.ssoExternalId || '')
      setGroupIds(
        Array.isArray(props.user.groupIds)
          ? props.user.groupIds.map(String).filter(Boolean)
          : []
      )
    } else {
      form.setFieldsValue({
        username: '',
        displayName: '',
        level: 'viewer',
        enabled: true,
        password: ''
      })
      setPerms(globalPermsOnly(defaultPermissions('viewer')))
      setDeviceAcl({})
      setSsoProvider('none')
      setSsoExternalId('')
      setGroupIds([])
    }
  }, [props.open, props.user, form])

  const deviceOptions = useMemo(() => props.devices, [props.devices])

  const getPermissions = () => perms
  const getDeviceAcl = () => deviceAcl

  const formSlotCtx = {
    mode: formMode,
    user: props.user as unknown as Record<string, unknown> | null,
    isNew
  }

  return (
    <Modal
      title={isNew ? '新建用户' : `编辑用户 · ${props.user?.username}`}
      open={props.open}
      onCancel={props.onCancel}
      width={820}
      confirmLoading={saving}
      onOk={async () => {
        const vals = await form.validateFields()
        if (sso.requireBinding && (ssoProvider === 'none' || !ssoExternalId.trim())) {
          message.error('已开启强制绑定，请选择企微/钉钉/AD 并填写对接账号')
          return
        }
        setSaving(true)
        try {
          let payload: Record<string, unknown> = {
            ...userPreserveExtras(
              props.user ? (props.user as unknown as Record<string, unknown>) : null
            ),
            id: props.user?.id,
            username: vals.username,
            displayName: vals.displayName,
            level: vals.level as UserLevel,
            enabled: vals.enabled !== false,
            password: vals.password || undefined,
            permissions: globalPermsOnly(perms),
            deviceAcl,
            ssoProvider,
            ssoExternalId: ssoProvider === 'none' ? '' : ssoExternalId,
            groupIds
          }
          payload = applyUserFieldCollect(
            form,
            formMode,
            props.user as unknown as Record<string, unknown> | null,
            getPermissions,
            setPerms,
            getDeviceAcl,
            setDeviceAcl,
            payload
          )
          const picked = pickUserPluginPayload(payload)
          const upsert: usersApi.UpsertUserPayload = {
            id: props.user?.id,
            username: String(payload.username || ''),
            displayName:
              payload.displayName != null ? String(payload.displayName) : undefined,
            level: payload.level as UserLevel,
            enabled: payload.enabled !== false,
            password:
              typeof payload.password === 'string' && payload.password
                ? payload.password
                : undefined,
            permissions: Array.isArray(payload.permissions)
              ? (payload.permissions as string[])
              : globalPermsOnly(perms),
            deviceAcl:
              payload.deviceAcl && typeof payload.deviceAcl === 'object'
                ? (payload.deviceAcl as Record<string, string[]>)
                : deviceAcl,
            ssoProvider: (payload.ssoProvider as SsoProviderId | 'none') || 'none',
            ssoExternalId: String(payload.ssoExternalId || ''),
            groupIds: Array.isArray(payload.groupIds)
              ? (payload.groupIds as string[])
              : groupIds,
            pluginData: picked.pluginData,
            ...picked.extras
          }
          const res =
            isRemoteDataMode() && isAdminUi()
              ? await usersApi.upsertUser(upsert)
              : await window.electronAPI?.auth?.localUpsertUser?.(upsert)
          if (!res?.ok) {
            message.error(res?.message || '保存失败')
            return
          }
          message.success('已保存')
          props.onSaved()
        } finally {
          setSaving(false)
        }
      }}
    >
      <PluginSlot name="users.form.before" context={formSlotCtx} />
      <PluginSlot name="users.form" replace context={formSlotCtx}>
        <Form form={form} layout="vertical">
          {isNew ? (
            <Form.Item label="用户名" name="username" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          ) : null}
          <Form.Item label="显示名" name="displayName">
            <Input />
          </Form.Item>
          <Form.Item label="等级" name="level" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(LEVEL_LABELS) as UserLevel[]).map((k) => ({
                value: k,
                label: LEVEL_LABELS[k]
              }))}
              onChange={(lv: UserLevel) => {
                const kept = perms.filter(
                  (p) => pluginCodes.has(p) || groupCodes.has(p)
                )
                setPerms([...globalPermsOnly(defaultPermissions(lv)), ...kept])
              }}
            />
          </Form.Item>
          <Form.Item
            label={isNew ? '密码' : '新密码（留空不改）'}
            name="password"
            rules={isNew ? [{ required: true }] : []}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item
            label="账号状态"
            name="enabled"
            valuePropName="checked"
            extra="关闭等同于封号：无法登录；也可在列表用「封号 / 解封」操作。"
          >
            <Switch checkedChildren="正常" unCheckedChildren="封号" />
          </Form.Item>
          <PluginSlot name="users.form.fields" context={formSlotCtx} />
          <UsersPluginFields
            form={form}
            mode={formMode}
            user={props.user as unknown as Record<string, unknown> | null}
            getPermissions={getPermissions}
            setPermissions={setPerms}
            getDeviceAcl={getDeviceAcl}
            setDeviceAcl={setDeviceAcl}
          />
        </Form>

        <Typography.Text strong>账号对接（单选）</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
          {sso.requireBinding
            ? '已开启强制绑定：必须选择一种对接并填写外部账号。'
            : '在软件设置 → 企业软件对接中启用企微 / 钉钉 / AD 后可选。绑定后可用对应方式登录（扫码或域密码）。'}
        </Typography.Paragraph>
        <Radio.Group
          style={{ marginBottom: 8 }}
          value={ssoProvider}
          onChange={(e) => {
            setSsoProvider(e.target.value)
            if (e.target.value === 'none') setSsoExternalId('')
          }}
          options={[
            { value: 'none', label: '不对接（仅本地密码）' },
            ...ssoOptions.map((p) => ({
              value: p.id,
              label: `${p.label}${p.scanLogin ? ' · 可扫码' : ' · 域密码'}${p.configured ? '' : '（未配完）'}`
            }))
          ]}
        />
        {ssoProvider !== 'none' ? (
          <Input
            style={{ marginBottom: 16 }}
            placeholder={
              ssoProvider === 'ad'
                ? 'AD 账号（sAMAccountName）'
                : ssoProvider === 'wecom'
                  ? '企微 UserId'
                  : '钉钉 unionId / userId'
            }
            value={ssoExternalId}
            onChange={(e) => setSsoExternalId(e.target.value)}
          />
        ) : (
          <div style={{ marginBottom: 16 }} />
        )}
        {ssoOptions.length === 0 ? (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            尚未启用任何对接模块，请到「软件设置 → 企业软件对接」配置。
          </Typography.Paragraph>
        ) : null}
        <PluginSlot name="users.form.sso.after" context={formSlotCtx} />

        <PluginSlot name="users.form.perms.before" context={formSlotCtx} />
        <Typography.Text strong>用户组</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
          有效权限 = 直接勾选 ∪ 用户组权限。可在软件设置 → 插件 → 用户组中维护。
        </Typography.Paragraph>
        <Select
          mode="multiple"
          allowClear
          placeholder="选择用户组…"
          style={{ width: '100%', marginBottom: 8 }}
          value={groupIds}
          options={userGroups.map((g) => ({
            value: g.id,
            label: g.description ? `${g.name}（${g.description}）` : g.name
          }))}
          onChange={(ids) => setGroupIds(ids as string[])}
        />
        <Button
          size="small"
          style={{ marginBottom: 16 }}
          disabled={!groupIds.length}
          onClick={() => {
            const union = new Set(perms)
            for (const id of groupIds) {
              const g = userGroups.find((x) => x.id === id)
              if (!g) continue
              for (const p of g.permissions) union.add(String(p))
            }
            setPerms(Array.from(union))
            message.success('已将所选用户组权限合并到勾选')
          }}
        >
          从用户组套用权限到勾选
        </Button>

        <Typography.Text strong>全局权限（可单独勾选）</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
          导航、设备管理、耗材与审核等；打印机上的暂停/归零/进料等操作请在下方按设备勾选。
        </Typography.Paragraph>
        <div
          style={{
            maxHeight: 220,
            overflow: 'auto',
            margin: '8px 0 16px',
            border: '1px solid #333',
            padding: 8
          }}
        >
          <Checkbox.Group
            style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            value={perms.filter((p) => ALL_GLOBAL.includes(p as (typeof ALL_GLOBAL)[number]))}
            onChange={(v) => {
              const pluginKept = perms.filter(
                (p) => pluginCodes.has(p) || groupCodes.has(p)
              )
              const next = (v as string[]).filter((p) => !p.startsWith('device.action.'))
              setPerms([...next, ...pluginKept])
            }}
            options={ALL_GLOBAL.map((p) => ({
              value: p,
              label: PERM_LABELS[p] || p
            }))}
          />
        </div>

        {props.pluginPerms.length ? (
          <>
            <Typography.Text strong>插件权限</Typography.Text>
            <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
              由已启用插件通过模块 <code>perm</code> 或钩子 <code>permissions_catalog</code>{' '}
              注册。
            </Typography.Paragraph>
            <div
              style={{
                maxHeight: 180,
                overflow: 'auto',
                margin: '8px 0 16px',
                border: '1px solid #333',
                padding: 8
              }}
            >
              <Checkbox.Group
                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                value={perms.filter((p) => pluginCodes.has(p))}
                onChange={(v) => {
                  const coreKept = perms.filter((p) => !pluginCodes.has(p))
                  setPerms([...coreKept, ...(v as string[])])
                }}
                options={props.pluginPerms.map((p) => ({
                  value: p.code,
                  label: p.plugin ? `${p.label}（${p.plugin}）` : p.label
                }))}
              />
            </div>
          </>
        ) : null}

        {permGroups.map((g) => {
          const codes = new Set(g.options.map((o) => o.code))
          return (
            <div key={g.id}>
              <Typography.Text strong>{g.title}</Typography.Text>
              {g.description ? (
                <Typography.Paragraph
                  type="secondary"
                  style={{ margin: '4px 0 8px', fontSize: 12 }}
                >
                  {g.description}
                </Typography.Paragraph>
              ) : (
                <div style={{ marginBottom: 8 }} />
              )}
              <div
                style={{
                  maxHeight: 160,
                  overflow: 'auto',
                  margin: '0 0 16px',
                  border: '1px solid #333',
                  padding: 8
                }}
              >
                <Checkbox.Group
                  style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                  value={perms.filter((p) => codes.has(p))}
                  onChange={(v) => {
                    const other = perms.filter((p) => !codes.has(p))
                    setPerms([...other, ...(v as string[])])
                  }}
                  options={g.options.map((o) => ({
                    value: o.code,
                    label: o.label
                  }))}
                />
              </div>
            </div>
          )
        })}
        <PluginSlot name="users.form.perms.after" context={formSlotCtx} />

        <PluginSlot name="users.form.deviceAcl.before" context={formSlotCtx} />
        <Typography.Text strong>按设备授权</Typography.Text>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 8px', fontSize: 12 }}>
          开启设备后，该用户只能看到已开启的设备；暂停、归零、急停、进料等
          <Typography.Text strong> 操作权限只在该设备下方勾选 </Typography.Text>
          。全部关闭设备开关时，若有「查看设备」全局权限则可看到全部设备，但仍须开启设备并勾选操作才能控制。
        </Typography.Paragraph>
        <div style={{ maxHeight: 240, overflow: 'auto', marginTop: 8 }}>
          {deviceOptions.map((d) => {
            const selected = deviceAcl[d.id] || []
            const active = d.id in deviceAcl
            return (
              <div
                key={d.id}
                style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #2a2a2a' }}
              >
                <Space wrap>
                  <Switch
                    size="small"
                    checked={active}
                    onChange={(on) => {
                      setDeviceAcl((prev) => {
                        const next = { ...prev }
                        if (on) next[d.id] = ['view']
                        else delete next[d.id]
                        return next
                      })
                    }}
                  />
                  <Typography.Text>{d.name}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {d.id}
                  </Typography.Text>
                  {active ? (
                    <>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setDeviceAcl((prev) => ({
                            ...prev,
                            [d.id]: ['view', ...DEVICE_ACTION_PERMS]
                          }))
                        }}
                      >
                        全选操作
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => {
                          setDeviceAcl((prev) => ({ ...prev, [d.id]: ['view'] }))
                        }}
                      >
                        仅查看
                      </Button>
                    </>
                  ) : null}
                </Space>
                {active ? (
                  <Checkbox.Group
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}
                    value={selected}
                    onChange={(v) => {
                      const list = v as string[]
                      const next = list.includes('view') ? list : ['view', ...list]
                      setDeviceAcl((prev) => ({ ...prev, [d.id]: next }))
                    }}
                    options={[
                      { value: 'view', label: '查看（仅卡片，不可进控制）' },
                      ...DEVICE_ACTION_PERMS.map((a) => ({
                        value: a,
                        label: PERM_LABELS[`device.action.${a}`] || a
                      }))
                    ]}
                  />
                ) : null}
              </div>
            )
          })}
          {!deviceOptions.length ? (
            <Typography.Text type="secondary">暂无设备</Typography.Text>
          ) : null}
        </div>
        <PluginSlot name="users.form.deviceAcl.after" context={formSlotCtx} />
        <PluginSlot name="users.form.footer" context={formSlotCtx} />
      </PluginSlot>
      <PluginSlot name="users.form.after" context={formSlotCtx} />
    </Modal>
  )
}
