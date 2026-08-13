import { Button, Card, Input, Space, Switch, Typography, message } from 'antd'
import { useSettingsStore } from '../../stores/settingsStore'
import { PluginSlot } from '../../plugins/PluginSlot'

export function SoftSettingsEnterprise() {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const patchLocal = useSettingsStore((s) => s.patchLocal)
  const save = useSettingsStore((s) => s.save)

  return (
    <Card className="settings-card" title="企微 / 钉钉 / AD 对接">
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            启用并配置后，会出现在「用户与权限」创建用户时的对接绑定选项。企微、钉钉支持扫码登录；AD
            使用域账号密码登录。未启用任何对接时，下方强制策略不可用。
          </Typography.Paragraph>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <div className="settings-row-label">
              <Typography.Text strong>强制绑定对接账号</Typography.Text>
              <Typography.Text type="secondary">
                开启后用户必须绑定企微/钉钉/AD，未绑定无法登录；关闭则可不绑定。
              </Typography.Text>
            </div>
            <Switch
              disabled={!(settings.sso.wecom.enabled || settings.sso.dingtalk.enabled || settings.sso.ad.enabled)}
              checked={settings.sso.requireBinding}
              onChange={(v) => patchLocal({ sso: { ...settings.sso, requireBinding: v } })}
            />
          </div>
          <div className="settings-row" style={{ marginBottom: 12 }}>
            <div className="settings-row-label">
              <Typography.Text strong>强制对接登录</Typography.Text>
              <Typography.Text type="secondary">
                开启后禁止本地账号密码登录，须企微/钉钉扫码或 AD 域密码；关闭则可用账号密码。
              </Typography.Text>
            </div>
            <Switch
              disabled={!(settings.sso.wecom.enabled || settings.sso.dingtalk.enabled || settings.sso.ad.enabled)}
              checked={settings.sso.requireSsoLogin}
              onChange={(v) => patchLocal({ sso: { ...settings.sso, requireSsoLogin: v } })}
            />
          </div>
          <div className="settings-row" style={{ marginBottom: 16 }}>
            <div className="settings-row-label">
              <Typography.Text strong>允许开发确认</Typography.Text>
              <Typography.Text type="secondary">
                无真实扫码时可用 externalId 模拟确认（仅内网测试）
              </Typography.Text>
            </div>
            <Switch
              checked={settings.sso.allowDevConfirm}
              onChange={(v) => patchLocal({ sso: { ...settings.sso, allowDevConfirm: v } })}
            />
          </div>
          <PluginSlot name="settings.enterprise.policy.after" />

          <PluginSlot name="settings.enterprise.wecom.before" />
          <Typography.Title level={5}>企业微信</Typography.Title>
          <div className="settings-row" style={{ marginBottom: 8 }}>
            <Typography.Text>启用</Typography.Text>
            <Switch
              checked={settings.sso.wecom.enabled}
              onChange={(v) => {
                const next = {
                  ...settings.sso,
                  wecom: { ...settings.sso.wecom, enabled: v }
                }
                if (!(next.wecom.enabled || next.dingtalk.enabled || next.ad.enabled)) {
                  next.requireBinding = false
                  next.requireSsoLogin = false
                }
                patchLocal({ sso: next })
              }}
            />
          </div>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
            <Input
              addonBefore="CorpId"
              value={settings.sso.wecom.corpId}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, wecom: { ...settings.sso.wecom, corpId: e.target.value } }
                })
              }
            />
            <Input
              addonBefore="AgentId"
              value={settings.sso.wecom.agentId}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, wecom: { ...settings.sso.wecom, agentId: e.target.value } }
                })
              }
            />
            <Input.Password
              addonBefore="Secret"
              value={settings.sso.wecom.secret}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, wecom: { ...settings.sso.wecom, secret: e.target.value } }
                })
              }
            />
            <Input
              addonBefore="回调 URL"
              placeholder="空则自动用 API 公网地址 + /api/v1/auth/sso/callback/wecom"
              value={settings.sso.wecom.redirectUri}
              onChange={(e) =>
                patchLocal({
                  sso: {
                    ...settings.sso,
                    wecom: { ...settings.sso.wecom, redirectUri: e.target.value }
                  }
                })
              }
            />
          </Space>
          <PluginSlot name="settings.enterprise.wecom.after" />

          <PluginSlot name="settings.enterprise.dingtalk.before" />
          <Typography.Title level={5}>钉钉</Typography.Title>
          <div className="settings-row" style={{ marginBottom: 8 }}>
            <Typography.Text>启用</Typography.Text>
            <Switch
              checked={settings.sso.dingtalk.enabled}
              onChange={(v) => {
                const next = {
                  ...settings.sso,
                  dingtalk: { ...settings.sso.dingtalk, enabled: v }
                }
                if (!(next.wecom.enabled || next.dingtalk.enabled || next.ad.enabled)) {
                  next.requireBinding = false
                  next.requireSsoLogin = false
                }
                patchLocal({ sso: next })
              }}
            />
          </div>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
            <Input
              addonBefore="AppKey"
              value={settings.sso.dingtalk.appKey}
              onChange={(e) =>
                patchLocal({
                  sso: {
                    ...settings.sso,
                    dingtalk: { ...settings.sso.dingtalk, appKey: e.target.value }
                  }
                })
              }
            />
            <Input.Password
              addonBefore="AppSecret"
              value={settings.sso.dingtalk.appSecret}
              onChange={(e) =>
                patchLocal({
                  sso: {
                    ...settings.sso,
                    dingtalk: { ...settings.sso.dingtalk, appSecret: e.target.value }
                  }
                })
              }
            />
            <Input
              addonBefore="CorpId"
              value={settings.sso.dingtalk.corpId}
              onChange={(e) =>
                patchLocal({
                  sso: {
                    ...settings.sso,
                    dingtalk: { ...settings.sso.dingtalk, corpId: e.target.value }
                  }
                })
              }
            />
            <Input
              addonBefore="回调 URL"
              placeholder="空则自动 /api/v1/auth/sso/callback/dingtalk"
              value={settings.sso.dingtalk.redirectUri}
              onChange={(e) =>
                patchLocal({
                  sso: {
                    ...settings.sso,
                    dingtalk: { ...settings.sso.dingtalk, redirectUri: e.target.value }
                  }
                })
              }
            />
          </Space>
          <PluginSlot name="settings.enterprise.dingtalk.after" />

          <PluginSlot name="settings.enterprise.ad.before" />
          <Typography.Title level={5}>AD 域</Typography.Title>
          <div className="settings-row" style={{ marginBottom: 8 }}>
            <Typography.Text>启用</Typography.Text>
            <Switch
              checked={settings.sso.ad.enabled}
              onChange={(v) => {
                const next = {
                  ...settings.sso,
                  ad: { ...settings.sso.ad, enabled: v }
                }
                if (!(next.wecom.enabled || next.dingtalk.enabled || next.ad.enabled)) {
                  next.requireBinding = false
                  next.requireSsoLogin = false
                }
                patchLocal({ sso: next })
              }}
            />
          </div>
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
            <Input
              addonBefore="LDAP"
              placeholder="ldap://dc.example.com:389"
              value={settings.sso.ad.ldapUrl}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, ad: { ...settings.sso.ad, ldapUrl: e.target.value } }
                })
              }
            />
            <Input
              addonBefore="Base DN"
              placeholder="DC=example,DC=com"
              value={settings.sso.ad.baseDn}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, ad: { ...settings.sso.ad, baseDn: e.target.value } }
                })
              }
            />
            <Input
              addonBefore="域名"
              placeholder="example.com（UPN 后缀）"
              value={settings.sso.ad.domain}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, ad: { ...settings.sso.ad, domain: e.target.value } }
                })
              }
            />
            <Input
              addonBefore="Bind DN"
              placeholder="可选服务账号"
              value={settings.sso.ad.bindDn}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, ad: { ...settings.sso.ad, bindDn: e.target.value } }
                })
              }
            />
            <Input.Password
              addonBefore="Bind 密码"
              value={settings.sso.ad.bindPassword}
              onChange={(e) =>
                patchLocal({
                  sso: { ...settings.sso, ad: { ...settings.sso.ad, bindPassword: e.target.value } }
                })
              }
            />
          </Space>
          <PluginSlot name="settings.enterprise.ad.after" />

          <PluginSlot name="settings.enterprise.fields" />
          <Button
            type="primary"
            loading={saving}
            onClick={() => {
              void (async () => {
                await save({ sso: settings.sso })
                message.success('对接配置已保存')
              })()
            }}
          >
            保存对接配置
          </Button>
          <PluginSlot name="settings.enterprise.footer" />
        </Card>
  )
}
