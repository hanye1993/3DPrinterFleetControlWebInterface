import { useEffect, useState } from 'react'
import { Alert, Button, Card, Form, Input, QRCode, Radio, Space, Typography, message } from 'antd'
import { useAuthStore, apiFetch } from '../stores/authStore'
import { SSO_PROVIDER_LABELS, type SsoProviderId, type SsoProviderOption } from '@shared/sso'
import { PluginSlot } from '../plugins/PluginSlot'
import appIcon from '../assets/icon.png'

type QrSession = {
  id: string
  provider: 'wecom' | 'dingtalk'
  status: string
  authorizeUrl: string
  message?: string
}

/**
 * Shown after login when server requires SSO binding and the user has none yet.
 */
export function BindSsoPage() {
  const serverUrl = useAuthStore((s) => s.serverUrl)
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const bindSso = useAuthStore((s) => s.bindSso)
  const logout = useAuthStore((s) => s.logout)
  const refreshMe = useAuthStore((s) => s.refreshMe)

  const [providers, setProviders] = useState<SsoProviderOption[]>([])
  const [provider, setProvider] = useState<SsoProviderId | null>(null)
  const [externalId, setExternalId] = useState('')
  const [adUser, setAdUser] = useState('')
  const [adPass, setAdPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState<QrSession | null>(null)
  const [allowDevConfirm, setAllowDevConfirm] = useState(false)
  const [devExternalId, setDevExternalId] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const res = await apiFetch(serverUrl, '/api/v1/auth/sso/providers')
        const data = (await res.json()) as {
          ok?: boolean
          providers?: SsoProviderOption[]
          allowDevConfirm?: boolean
        }
        if (data.ok) {
          const list = data.providers || []
          setProviders(list)
          setAllowDevConfirm(Boolean(data.allowDevConfirm))
          if (list[0]) setProvider(list[0].id)
        }
      } catch {
        /* ignore */
      }
    })()
  }, [serverUrl])

  useEffect(() => {
    if (!qr || qr.status !== 'pending' || !token) return
    const t = window.setInterval(() => {
      void (async () => {
        try {
          const res = await apiFetch(
            serverUrl,
            `/api/v1/me/sso-bind/qr/${encodeURIComponent(qr.id)}/status`,
            { token }
          )
          const data = (await res.json()) as {
            ok?: boolean
            session?: QrSession
            needsSsoBind?: boolean
            user?: unknown
          }
          if (!data.session) return
          setQr(data.session)
          if (data.session.status === 'ok') {
            await refreshMe()
            message.success('绑定成功')
          }
        } catch {
          /* ignore */
        }
      })()
    }, 1500)
    return () => window.clearInterval(t)
  }, [qr, serverUrl, token, refreshMe])

  const startQrBind = async () => {
    if (!token || (provider !== 'wecom' && provider !== 'dingtalk')) return
    setBusy(true)
    setQr(null)
    try {
      const res = await apiFetch(serverUrl, '/api/v1/me/sso-bind/qr/start', {
        method: 'POST',
        token,
        body: JSON.stringify({ provider })
      })
      const data = (await res.json()) as { ok?: boolean; message?: string; session?: QrSession }
      if (!res.ok || !data.ok || !data.session) {
        message.error(data.message || '无法创建扫码绑定')
        return
      }
      setQr(data.session)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '网络错误')
    } finally {
      setBusy(false)
    }
  }

  const submitManual = async () => {
    if (!provider) {
      message.error('请选择对接方式')
      return
    }
    setBusy(true)
    try {
      const result =
        provider === 'ad'
          ? await bindSso({ provider: 'ad', username: adUser, password: adPass })
          : await bindSso({ provider, externalId })
      if (!result.ok) {
        message.error(result.message || '绑定失败')
        return
      }
      message.success('绑定成功，正在进入…')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'radial-gradient(1200px 600px at 20% 0%, #1a2332, #0f1115 55%)'
      }}
    >
      <PluginSlot name="sso.bind.before" />
      <PluginSlot name="sso.bind" replace>
        <Card style={{ width: 480, maxWidth: '100%' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <img src={appIcon} alt="" width={48} height={48} style={{ borderRadius: 10 }} />
            <Typography.Title level={4} style={{ marginTop: 12, marginBottom: 4 }}>
              绑定对接账号
            </Typography.Title>
            <Typography.Text type="secondary">
              系统要求强制绑定。当前用户：{user?.displayName || user?.username}
            </Typography.Text>
          </div>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="请绑定企微 / 钉钉 / AD 后才能进入监控台。绑定信息将写入你的用户资料。"
          />

          {providers.length === 0 ? (
            <Alert type="warning" showIcon message="尚未启用任何对接模块，请联系管理员。" />
          ) : (
            <>
              <Typography.Text strong>选择对接</Typography.Text>
              <Radio.Group
                style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0 16px' }}
                value={provider || undefined}
                onChange={(e) => {
                  setProvider(e.target.value)
                  setQr(null)
                }}
                options={providers.map((p) => ({
                  value: p.id,
                  label: `${SSO_PROVIDER_LABELS[p.id]}${p.scanLogin ? '（可扫码）' : '（域账号）'}`
                }))}
              />

              {provider === 'ad' ? (
                <Form layout="vertical">
                  <Form.Item label="AD 域账号" required>
                    <Input value={adUser} onChange={(e) => setAdUser(e.target.value)} />
                  </Form.Item>
                  <Form.Item label="域密码" required>
                    <Input.Password value={adPass} onChange={(e) => setAdPass(e.target.value)} />
                  </Form.Item>
                  <Button type="primary" block loading={busy} onClick={() => void submitManual()}>
                    校验并绑定
                  </Button>
                </Form>
              ) : provider === 'wecom' || provider === 'dingtalk' ? (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Button type="primary" block loading={busy} onClick={() => void startQrBind()}>
                    扫码绑定{SSO_PROVIDER_LABELS[provider]}
                  </Button>
                  {qr ? (
                    <div style={{ textAlign: 'center' }}>
                      {qr.authorizeUrl ? <QRCode value={qr.authorizeUrl} size={180} /> : null}
                      <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                        {qr.status === 'pending' ? '请扫码确认绑定' : qr.message || qr.status}
                      </Typography.Text>
                      {allowDevConfirm && qr.status === 'pending' ? (
                        <Space.Compact style={{ width: '100%', marginTop: 12 }}>
                          <Input
                            placeholder="开发：外部 UserId"
                            value={devExternalId}
                            onChange={(e) => setDevExternalId(e.target.value)}
                          />
                          <Button
                            onClick={() => {
                              void (async () => {
                                const r = await bindSso({
                                  provider,
                                  externalId: devExternalId
                                })
                                if (!r.ok) message.error(r.message || '失败')
                                else message.success('绑定成功')
                              })()
                            }}
                          >
                            手动确认
                          </Button>
                        </Space.Compact>
                      ) : null}
                    </div>
                  ) : null}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    也可手动填写外部 ID：
                  </Typography.Text>
                  <Space.Compact style={{ width: '100%' }}>
                    <Input
                      placeholder={provider === 'wecom' ? '企微 UserId' : '钉钉 unionId'}
                      value={externalId}
                      onChange={(e) => setExternalId(e.target.value)}
                    />
                    <Button loading={busy} onClick={() => void submitManual()}>
                      绑定
                    </Button>
                  </Space.Compact>
                </Space>
              ) : null}
            </>
          )}

          <Button type="link" block style={{ marginTop: 16 }} onClick={() => logout()}>
            退出登录
          </Button>
        </Card>
      </PluginSlot>
      <PluginSlot name="sso.bind.after" />
    </div>
  )
}
