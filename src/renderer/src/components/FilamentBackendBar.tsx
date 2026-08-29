import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Typography,
  message
} from 'antd'
import { CloudSyncOutlined, LogoutOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  fetchFilamentBackend,
  filamentBambuAmsSync,
  filamentBambuLogin,
  filamentBambuLogout,
  filamentBambuSendCode,
  runFilamentMutualSync,
  type FilamentBackendState
} from '../api/filamentBackendApi'
import {
  fetchFilamentSyncSources,
  runFilamentSyncSources
} from '../api/filamentSyncApi'
import { useFilamentStore } from '../stores/filamentStore'

type LoginForm = {
  region: 'china' | 'global'
  account: string
  password?: string
  code?: string
}

/** 耗材管理页顶部：本地 / 拓竹 Studio 单选切换 */
export function FilamentBackendBar() {
  const activateLocal = useFilamentStore((s) => s.activateLocalFilament)
  const activateBambu = useFilamentStore((s) => s.activateBambuFilament)
  const source = useFilamentStore((s) => s.source)
  const backend = useFilamentStore((s) => s.backend)
  const [st, setSt] = useState<FilamentBackendState | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [needCode, setNeedCode] = useState(false)
  const [spoolmanEnabled, setSpoolmanEnabled] = useState(0)
  const [form] = Form.useForm<LoginForm>()

  const load = async () => {
    try {
      const s = await fetchFilamentBackend()
      setSt(s)
    } catch {
      /* ignore */
    }
    try {
      const sync = await fetchFilamentSyncSources()
      setSpoolmanEnabled(
        (sync.sources || []).filter((x) => x.enabled && x.type === 'spoolman').length
      )
    } catch {
      setSpoolmanEnabled(0)
    }
  }

  useEffect(() => {
    void load()
  }, [backend, source])

  const current: 'local' | 'bambu_studio' =
    source === 'bambu' || backend === 'bambu_studio' ? 'bambu_studio' : 'local'

  const onMode = async (v: string | number) => {
    const next = v as 'local' | 'bambu_studio'
    if (next === 'bambu_studio') {
      const loggedIn = st?.loggedIn
      if (!loggedIn) {
        setLoginOpen(true)
        return
      }
      setBusy(true)
      try {
        await activateBambu()
        await load()
        message.success('已切换到拓竹 Studio 云端耗材')
      } catch (e) {
        message.error(e instanceof Error ? e.message : '切换失败')
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      await activateLocal()
      await load()
      message.success('已切换到本地耗材管理')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '切换失败')
    } finally {
      setBusy(false)
    }
  }

  const reloadSpools = async () => {
    if (current === 'bambu_studio') await activateBambu()
    else await activateLocal()
  }

  const doLogin = async () => {
    const values = await form.validateFields()
    setBusy(true)
    try {
      const r = await filamentBambuLogin({
        region: values.region,
        account: values.account.trim(),
        password: values.password,
        code: values.code
      })
      if (!r.ok) {
        if (r.needCode) {
          setNeedCode(true)
          message.info(r.message || '请输入验证码')
          return
        }
        throw new Error(r.message || '登录失败')
      }
      setSt(r)
      setLoginOpen(false)
      setNeedCode(false)
      form.resetFields()
      await activateBambu()
      await load()
      message.success('已对接拓竹 Studio 耗材')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    const values = await form.validateFields(['region', 'account'])
    setBusy(true)
    try {
      const r = await filamentBambuSendCode(values.region, values.account.trim())
      if (!r.ok) throw new Error(r.message || '发送失败')
      setNeedCode(true)
      message.success(r.message || '验证码已发送')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  const doLogout = async () => {
    setBusy(true)
    try {
      const next = await filamentBambuLogout()
      setSt(next)
      await activateLocal()
      await load()
      message.success('已退出拓竹云，改回本地耗材')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '退出失败')
    } finally {
      setBusy(false)
    }
  }

  const doAms = async () => {
    setBusy(true)
    try {
      const r = await filamentBambuAmsSync()
      if (!r.ok) throw new Error(r.message || '同步失败')
      await reloadSpools()
      message.success(r.message || '已从 AMS 同步')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  const onMutualSync = async (checked: boolean) => {
    if (checked && !st?.loggedIn) {
      message.warning('请先登录拓竹账号后再开启互相同步')
      setLoginOpen(true)
      return
    }
    setBusy(true)
    try {
      const r = await runFilamentMutualSync(checked)
      setSt({
        backend: r.backend ?? 'local',
        region: r.region ?? 'china',
        account: r.account ?? '',
        loggedIn: Boolean(r.loggedIn),
        mutualSync: typeof r.mutualSync === 'boolean' ? r.mutualSync : checked
      })
      if (!r.ok) throw new Error(r.message || '互相同步失败')
      await reloadSpools()
      message.success(r.message || (checked ? '互相同步已开启' : '已关闭互相同步'))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '互相同步失败')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const syncSpoolman = async () => {
    setBusy(true)
    try {
      const r = await runFilamentSyncSources({ all: true })
      if (!r.ok) throw new Error(r.message || 'Spoolman 同步失败')
      await activateLocal()
      await load()
      message.success(r.message || 'Spoolman 同步完成')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Spoolman 同步失败')
    } finally {
      setBusy(false)
    }
  }

  const cloud = current === 'bambu_studio'

  return (
    <>
      <div className="filament-backend-bar">
        <Typography.Text type="secondary">数据源</Typography.Text>
        <Segmented
          value={current}
          disabled={busy}
          onChange={onMode}
          options={[
            { label: '本地耗材', value: 'local' },
            { label: '拓竹 Studio', value: 'bambu_studio' }
          ]}
        />
        <Checkbox
          checked={Boolean(st?.mutualSync)}
          disabled={busy}
          onChange={(e) => void onMutualSync(e.target.checked)}
        >
          拓竹互相同步
        </Checkbox>
        {!cloud && spoolmanEnabled > 0 ? (
          <Button
            size="small"
            icon={<CloudSyncOutlined />}
            loading={busy}
            onClick={() => void syncSpoolman()}
          >
            Spoolman 同步（{spoolmanEnabled}/3）
          </Button>
        ) : null}
        {cloud ? (
          <Space size={8} wrap>
            <Typography.Text type="secondary">
              {st?.loggedIn ? `已登录 ${st.account || '拓竹云'}` : '未登录'}
            </Typography.Text>
            <Button size="small" icon={<ReloadOutlined />} loading={busy} onClick={() => void reloadSpools()}>
              刷新
            </Button>
            <Button size="small" icon={<CloudSyncOutlined />} loading={busy} onClick={() => void doAms()}>
              从 AMS 读取
            </Button>
            {st?.loggedIn ? (
              <Button size="small" icon={<LogoutOutlined />} onClick={() => void doLogout()}>
                退出云端
              </Button>
            ) : (
              <Button size="small" type="primary" onClick={() => setLoginOpen(true)}>
                登录拓竹
              </Button>
            )}
          </Space>
        ) : null}
      </div>
      {st?.mutualSync ? (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 8 }}
          message="互相同步已开启"
          description="按「品牌 + 材质 + 色值」匹配 FDM 料卷：本地有云端无则推送，云端有本地无则拉取；两边都有时以较新余量为准。树脂与缺关键字段会跳过，不会自动删除。"
        />
      ) : null}
      {cloud ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message="拓竹 Studio 云端"
          description="界面与 Studio 耗材管理对齐：筛选、搜索、添加（手动 / AMS）、编辑、删除。计算器与设备绑定仅联动云端料卷。"
        />
      ) : null}

      <Modal
        title="登录拓竹账号（对接 Studio 耗材）"
        open={loginOpen}
        onCancel={() => {
          setLoginOpen(false)
          setNeedCode(false)
        }}
        onOk={() => void doLogin()}
        okText="登录并切换"
        confirmLoading={busy}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ region: 'china' }}>
          <Form.Item name="region" label="区域" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'china', label: '中国区' },
                { value: 'global', label: '国际区' }
              ]}
            />
          </Form.Item>
          <Form.Item name="account" label="手机号 / 邮箱" rules={[{ required: true, message: '请输入账号' }]}>
            <Input placeholder="中国区推荐手机号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码">
            <Input.Password placeholder="可空，改用验证码" autoComplete="current-password" />
          </Form.Item>
          <Space style={{ marginBottom: 12 }}>
            <Button onClick={() => void sendCode()} loading={busy}>
              发送验证码
            </Button>
          </Space>
          {needCode ? (
            <Form.Item name="code" label="验证码" rules={[{ required: true, message: '请输入验证码' }]}>
              <Input placeholder="短信或邮箱验证码" />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </>
  )
}
