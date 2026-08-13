import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  QRCode,
  Checkbox,
  Space,
  Tabs,
  Typography,
  message
} from 'antd'
import { useAuthStore, apiFetch, loadSavedCredentials, saveCredentials } from '../stores/authStore'
import { isWebBrowser } from '@shared/platform'
import { normalizeServerBaseUrl } from '@shared/serverUrl'
import type { SsoProviderOption } from '@shared/sso'
import appIcon from '../assets/icon.png'
import {
  applySiteBranding,
  resolveSiteDisplayName,
  resolveSiteLogoUrl
} from '../theme/siteBranding'
import { PluginLoader } from '../plugins/PluginLoader'
import { PluginSlot } from '../plugins/PluginSlot'
import { ThemeLoader } from '../theme/ThemeLoader'
import { ThemeSlot } from '../theme/ThemeSlot'
import { ThemeFullSiteHost, hasFullSiteLogin } from '../theme/ThemeFullSiteHost'
import { useThemePackStore } from '../theme/themePackStore'

type QrSession = {
  id: string
  provider: 'wecom' | 'dingtalk'
  status: string
  authorizeUrl: string
  message?: string
}

export function LoginPage() {
  const serverUrl = useAuthStore((s) => s.serverUrl)
  const serverSaved = useAuthStore((s) => s.serverSaved)
  const setServerUrl = useAuthStore((s) => s.setServerUrl)
  const clearServerUrl = useAuthStore((s) => s.clearServerUrl)
  const login = useAuthStore((s) => s.login)
  const applySession = useAuthStore((s) => s.applySession)
  const loginError = useAuthStore((s) => s.loginError)

  const loginLayout = useThemePackStore((s) => s.active?.loginLayout || 'classic')
  const themeSiteMode = useThemePackStore((s) => s.active?.siteMode || 'skin')
  const themeTemplateHtml = useThemePackStore((s) => s.templateHtml)
  const useFullSiteLogin =
    themeSiteMode === 'full' && hasFullSiteLogin(themeTemplateHtml)
  const fullLoginHtml = themeTemplateHtml['login.page.replace'] || ''
  const [loading, setLoading] = useState(false)
  const [providers, setProviders] = useState<SsoProviderOption[]>([])
  const [allowDevConfirm, setAllowDevConfirm] = useState(false)
  const [requireSsoLogin, setRequireSsoLogin] = useState(false)
  const [requireBinding, setRequireBinding] = useState(false)
  const [qr, setQr] = useState<QrSession | null>(null)
  const [qrBusy, setQrBusy] = useState(false)
  const [devExternalId, setDevExternalId] = useState('')
  const [tab, setTab] = useState('password')
  const [serverDraft, setServerDraft] = useState(serverUrl)
  const [editingServer, setEditingServer] = useState(!serverSaved)
  const [serverModalOpen, setServerModalOpen] = useState(false)
  const savedCreds = loadSavedCredentials()
  const [rememberCreds, setRememberCreds] = useState(savedCreds.remember)
  const [brandName, setBrandName] = useState('hanye-3D打印机监控台')
  const [brandLogo, setBrandLogo] = useState('')

  const scanProviders = providers.filter((p) => p.scanLogin && p.enabled)
  const adEnabled = providers.some((p) => p.id === 'ad' && p.enabled)

  useEffect(() => {
    setServerDraft(serverUrl)
  }, [serverUrl])

  useEffect(() => {
    if (!serverSaved || editingServer) return
    let cancelled = false
    const loadBrand = async () => {
      try {
        const res = await apiFetch(serverUrl, '/api/v1/branding')
        const data = (await res.json()) as {
          ok?: boolean
          siteName?: string
          siteTitle?: string
          siteLogo?: string
          siteFavicon?: string
        }
        if (cancelled || !data.ok) return
        setBrandName(resolveSiteDisplayName(data.siteName))
        setBrandLogo(String(data.siteLogo || ''))
        applySiteBranding({
          siteName: data.siteName || '',
          siteTitle: data.siteTitle || '',
          siteFavicon: data.siteFavicon || ''
        })
      } catch {
        /* ignore */
      }
    }
    void loadBrand()
    return () => {
      cancelled = true
    }
  }, [serverUrl, serverSaved, editingServer])

  useEffect(() => {
    if (!serverSaved || editingServer) return
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(serverUrl, '/api/v1/auth/sso/providers')
        const data = (await res.json()) as {
          ok?: boolean
          providers?: SsoProviderOption[]
          allowDevConfirm?: boolean
          requireSsoLogin?: boolean
          requireBinding?: boolean
        }
        if (!cancelled && data.ok) {
          setProviders(data.providers || [])
          setAllowDevConfirm(Boolean(data.allowDevConfirm))
          setRequireSsoLogin(Boolean(data.requireSsoLogin))
          setRequireBinding(Boolean(data.requireBinding))
          if (data.requireSsoLogin) {
            const firstScan = (data.providers || []).find((p) => p.scanLogin)
            if (firstScan) setTab(firstScan.id)
            else if ((data.providers || []).some((p) => p.id === 'ad')) setTab('password')
          }
        }
      } catch {
        if (!cancelled) setProviders([])
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [serverUrl, serverSaved, editingServer])

  useEffect(() => {
    if (!qr || qr.status !== 'pending') return
    const t = window.setInterval(() => {
      void (async () => {
        try {
          const res = await apiFetch(
            serverUrl,
            `/api/v1/auth/sso/qr/${encodeURIComponent(qr.id)}/status`
          )
          const data = (await res.json()) as {
            ok?: boolean
            session?: QrSession
            token?: string
            user?: Parameters<typeof applySession>[0]['user']
            permissions?: string[]
            deviceAcl?: Parameters<typeof applySession>[0]['deviceAcl']
            needsSsoBind?: boolean
            requireBinding?: boolean
          }
          if (!data.ok || !data.session) return
          setQr(data.session)
          if (data.session.status === 'ok' && data.token) {
            applySession({
              token: data.token,
              user: data.user,
              permissions: data.permissions,
              deviceAcl: data.deviceAcl,
              needsSsoBind: data.needsSsoBind,
              requireBinding: data.requireBinding
            })
            message.success('扫码登录成功')
          }
        } catch {
          /* ignore */
        }
      })()
    }, 1500)
    return () => window.clearInterval(t)
  }, [qr, serverUrl, applySession])

  const saveServer = () => {
    const normalized = normalizeServerBaseUrl(serverDraft)
    if (!normalized) {
      message.error('系统地址无效，IPv6 请使用 http://[地址]:端口 格式')
      return
    }
    useAuthStore.getState().logout()
    setServerUrl(normalized, { persist: true })
    setServerDraft(normalized)
    setEditingServer(false)
    setServerModalOpen(false)
    setProviders([])
    message.success('系统地址已保存')
  }

  const startQr = async (provider: 'wecom' | 'dingtalk') => {
    setQrBusy(true)
    setQr(null)
    try {
      const res = await apiFetch(serverUrl, '/api/v1/auth/sso/qr/start', {
        method: 'POST',
        body: JSON.stringify({ provider })
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; session?: QrSession }
      if (!res.ok || !data.ok || !data.session) {
        message.error(data.message || '无法创建扫码会话')
        return
      }
      setQr(data.session)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '网络错误')
    } finally {
      setQrBusy(false)
    }
  }

  // 首次：先录入服务端（Electron 客户端；浏览器直接登录当前站点）
  if ((!serverSaved || editingServer) && !isWebBrowser()) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
          background: 'radial-gradient(1200px 600px at 20% 0%, #1a2332, #0f1115 55%)'
        }}
      >
        <Card style={{ width: 440, maxWidth: '100%' }} className="login-card">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <img
              src={resolveSiteLogoUrl(brandLogo, appIcon)}
              alt=""
              width={56}
              height={56}
              style={{ borderRadius: 12 }}
            />
            <Typography.Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
              连接系统
            </Typography.Title>
            <Typography.Text type="secondary">首次使用请填写并保存系统访问地址</Typography.Text>
          </div>
          <Form layout="vertical" onFinish={saveServer}>
            <Form.Item label="系统地址" required>
              <Input
                autoFocus
                placeholder="http://192.168.1.10:17890 或 http://[2001:db8::1]:17890"
                value={serverDraft}
                onChange={(e) => setServerDraft(e.target.value)}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              保存并继续
            </Button>
            {serverSaved ? (
              <Button type="link" block style={{ marginTop: 8 }} onClick={() => setEditingServer(false)}>
                取消
              </Button>
            ) : null}
          </Form>
        </Card>
      </div>
    )
  }

  const passwordForm = (
    <Form
      layout="vertical"
      initialValues={{
        username: savedCreds.username,
        password: savedCreds.password
      }}
      onFinish={async (vals) => {
        if (requireSsoLogin && !adEnabled) {
          message.error('已开启强制对接登录，请使用企微/钉钉扫码')
          return
        }
        setLoading(true)
        try {
          const ok = await login(vals.username, vals.password)
          if (ok) {
            saveCredentials(vals.username, vals.password, rememberCreds)
          }
        } finally {
          setLoading(false)
        }
      }}
    >
      {requireSsoLogin && !adEnabled ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="系统已开启强制对接登录，请改用企微/钉钉扫码"
        />
      ) : (
        <>
          <Form.Item
            label={requireSsoLogin && adEnabled ? 'AD 域账号' : '用户名'}
            name="username"
            rules={[{ required: true }]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            label={requireSsoLogin && adEnabled ? '域密码' : adEnabled ? '密码（本地或 AD）' : '密码'}
            name="password"
            rules={[{ required: true }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 12 }}>
            <Checkbox checked={rememberCreds} onChange={(e) => setRememberCreds(e.target.checked)}>
              记住用户名和密码
            </Checkbox>
          </Form.Item>
          <PluginSlot name="login.form.fields" />
          <PluginSlot name="login.actions" />
          <Button type="primary" htmlType="submit" block loading={loading}>
            {requireSsoLogin && adEnabled ? 'AD 登录' : '登录'}
          </Button>
        </>
      )}
      {requireBinding ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          首次登录后若未绑定对接账号，将进入绑定界面。
        </Typography.Paragraph>
      ) : null}
    </Form>
  )

  const tabItems = [
    ...(requireSsoLogin && !adEnabled
      ? []
      : requireSsoLogin
        ? [
            {
              key: 'password',
              label: 'AD 域登录',
              children: passwordForm
            }
          ]
        : [
            {
              key: 'password',
              label: '账号密码',
              children: passwordForm
            }
          ]),
    ...scanProviders.map((p) => ({
      key: p.id,
      label: `${p.label}扫码`,
      children: (
        <Space direction="vertical" style={{ width: '100%' }} align="center">
          <Button
            type="primary"
            loading={qrBusy}
            onClick={() => void startQr(p.id as 'wecom' | 'dingtalk')}
          >
            生成{p.label}登录码
          </Button>
          {qr && qr.provider === p.id ? (
            <>
              {qr.authorizeUrl ? <QRCode value={qr.authorizeUrl} size={200} /> : null}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {qr.status === 'pending'
                  ? '请使用手机扫码，确认后自动登录'
                  : qr.status === 'ok'
                    ? '已确认'
                    : qr.message || qr.status}
              </Typography.Text>
              {allowDevConfirm && qr.status === 'pending' ? (
                <Space.Compact style={{ width: '100%', maxWidth: 360 }}>
                  <Input
                    placeholder="开发：外部 UserId"
                    value={devExternalId}
                    onChange={(e) => setDevExternalId(e.target.value)}
                  />
                  <Button
                    onClick={() => {
                      void (async () => {
                        const res = await apiFetch(
                          serverUrl,
                          `/api/v1/auth/sso/qr/${encodeURIComponent(qr.id)}/dev-confirm`,
                          {
                            method: 'POST',
                            body: JSON.stringify({ externalId: devExternalId })
                          }
                        )
                        const data = (await res.json()) as {
                          ok?: boolean
                          message?: string
                          token?: string
                          user?: Parameters<typeof applySession>[0]['user']
                          permissions?: string[]
                          deviceAcl?: Parameters<typeof applySession>[0]['deviceAcl']
                          needsSsoBind?: boolean
                        }
                        if (!res.ok || !data.ok || !data.token) {
                          message.error(data.message || '确认失败')
                          return
                        }
                        applySession({
                          token: data.token,
                          user: data.user,
                          permissions: data.permissions,
                          deviceAcl: data.deviceAcl,
                          needsSsoBind: data.needsSsoBind
                        })
                        message.success('登录成功')
                      })()
                    }}
                  >
                    模拟确认
                  </Button>
                </Space.Compact>
              ) : null}
            </>
          ) : null}
          {!p.configured ? (
            <Alert type="warning" showIcon message="该对接凭证未配完，可开启「开发确认」测试" />
          ) : null}
        </Space>
      )
    }))
  ]

  // 强制对接登录且没有任何可用方式
  if (requireSsoLogin && tabItems.length === 0) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24
        }}
      >
        <Card style={{ width: 420, maxWidth: '100%' }}>
          <Alert type="error" showIcon message="已开启强制对接登录，但未启用企微/钉钉/AD" />
          <Button type="link" block onClick={() => setServerModalOpen(true)}>
            更换服务器
          </Button>
        </Card>
      </div>
    )
  }

  const loginFormIsland = (
    <Card style={{ width: 440, maxWidth: '100%' }} className="login-card">
      <PluginSlot name="login.header.before" />
      <PluginSlot name="login.header" replace>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <img
            src={resolveSiteLogoUrl(brandLogo, appIcon)}
            alt=""
            width={56}
            height={56}
            style={{ borderRadius: 12 }}
          />
          <Typography.Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
            {brandName}
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {serverUrl}
          </Typography.Text>
          {!isWebBrowser() ? (
            <div>
              <Button type="link" size="small" onClick={() => setServerModalOpen(true)}>
                更换服务器
              </Button>
            </div>
          ) : null}
        </div>
      </PluginSlot>
      <PluginSlot name="login.header.after" />
      {loginError ? (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message={loginError} />
      ) : null}
      {requireSsoLogin ? (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="已开启强制对接登录" />
      ) : null}
      <PluginSlot name="login.form.before" />
      <PluginSlot name="login.form" replace>
        <PluginSlot name="login.sso.before" />
        {tabItems.length > 1 ? (
          <Tabs activeKey={tab} onChange={setTab} items={tabItems} />
        ) : (
          tabItems[0]?.children || passwordForm
        )}
        <PluginSlot name="login.sso.after" />
      </PluginSlot>
      <PluginSlot name="login.form.after" />
      <PluginSlot name="login.footer" />
    </Card>
  )

  const loginHeroIsland = (
    <div className="login-split-hero" aria-hidden>
      <div className="login-split-hero-text">
        OPS
        <br />
        BOARD
        <br />
        ──
        <br />
        3D PRINT
        <br />
        YARD
      </div>
    </div>
  )

  const serverModal = (
    <Modal
      title="更换服务器"
      open={serverModalOpen}
      onCancel={() => setServerModalOpen(false)}
      onOk={saveServer}
      okText="保存"
    >
      <Typography.Paragraph type="secondary">
        更换后需重新登录。将清除当前登录状态。
      </Typography.Paragraph>
      <Input
        placeholder="http://192.168.1.10:17890"
        value={serverDraft}
        onChange={(e) => setServerDraft(e.target.value)}
      />
      <Button
        danger
        type="link"
        style={{ paddingLeft: 0, marginTop: 8 }}
        onClick={() => {
          clearServerUrl()
          setServerDraft('http://127.0.0.1:17890')
          setEditingServer(true)
          setServerModalOpen(false)
        }}
      >
        清除并重新配置
      </Button>
    </Modal>
  )

  if (useFullSiteLogin) {
    return (
      <div className="login-page-root login-layout-fullsite theme-fullsite-login">
        <ThemeLoader mode="public" />
        <PluginLoader mode="public" />
        <ThemeFullSiteHost
          className="login-fullsite"
          html={fullLoginHtml}
          islands={{
            'login-form': loginFormIsland,
            'login-hero': loginHeroIsland
          }}
        />
        {serverModal}
      </div>
    )
  }

  return (
    <div
      className={`login-page-root login-layout-${loginLayout}`}
      style={
        loginLayout === 'split'
          ? undefined
          : {
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 12,
              background: 'radial-gradient(1200px 600px at 20% 0%, #1a2332, #0f1115 55%)'
            }
      }
    >
      <ThemeLoader mode="public" />
      <PluginLoader mode="public" />
      {loginLayout === 'split' ? loginHeroIsland : null}
      <ThemeSlot name="login.page" replace>
        <PluginSlot name="login.page" replace>
          {loginFormIsland}
        </PluginSlot>
      </ThemeSlot>
      {serverModal}
    </div>
  )
}
