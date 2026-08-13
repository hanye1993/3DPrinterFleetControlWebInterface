import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
  message
} from 'antd'
import {
  ALERT_EVENT_KINDS,
  ALERT_EVENT_LABELS,
  SMS_PROVIDER_LABELS,
  defaultAlertNotifySettings,
  normalizeAlertNotifySettings,
  type AlertEventKind,
  type AlertNotifySettings,
  type SmsProviderId
} from '@shared/alertNotify'
import { useSettingsStore } from '../../stores/settingsStore'
import { isClientMode, serverSend } from '../../api/serverClient'
import { PluginSlot } from '../../plugins/PluginSlot'

const SMS_PRESETS: Partial<
  Record<
    SmsProviderId,
    Partial<Pick<AlertNotifySettings, 'smsApiUrl' | 'smsApiMethod' | 'smsApiBodyTemplate' | 'smsApiHeaders'>>
  >
> = {
  chuanglan: {
    smsApiUrl: 'https://smssh1.253.com/msg/v1/send/json',
    smsApiMethod: 'POST',
    smsApiBodyTemplate: ''
  },
  custom: {
    smsApiUrl: '',
    smsApiMethod: 'POST',
    smsApiBodyTemplate:
      '{"mobile":"{{phone}}","content":"{{content}}","apikey":"{{key}}"}',
    smsApiHeaders: '{"Content-Type":"application/json"}'
  }
}

function secretPlaceholder(set?: boolean): string {
  return set ? '（已保存，留空不修改）' : ''
}

export function SoftSettingsAlerts() {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const patchLocal = useSettingsStore((s) => s.patchLocal)
  const save = useSettingsStore((s) => s.save)

  const [draft, setDraft] = useState<AlertNotifySettings>(() =>
    normalizeAlertNotifySettings(settings.alertNotify)
  )
  const [testing, setTesting] = useState(false)
  const [secretTouched, setSecretTouched] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setDraft(normalizeAlertNotifySettings(settings.alertNotify))
    setSecretTouched({})
  }, [settings.alertNotify])

  const pub = settings.alertNotify as
    | {
        pushplusTokenSet?: boolean
        serverchanSendKeySet?: boolean
        smsAccessKeySecretSet?: boolean
        smsAppSecretSet?: boolean
        smsApiKeySet?: boolean
        dingtalkSecretSet?: boolean
        dingtalkWebhookSet?: boolean
        webhookNotifyUrlSet?: boolean
      }
    | undefined

  const smsOptions = useMemo(
    () =>
      (Object.keys(SMS_PROVIDER_LABELS) as SmsProviderId[]).map((id) => ({
        value: id,
        label: SMS_PROVIDER_LABELS[id]
      })),
    []
  )

  const patchDraft = (partial: Partial<AlertNotifySettings>) => {
    setDraft((d) => ({ ...d, ...partial }))
  }

  const setEvent = (kind: AlertEventKind, v: boolean) => {
    setDraft((d) => ({ ...d, events: { ...d.events, [kind]: v } }))
  }

  const onProviderChange = (id: SmsProviderId) => {
    const preset = SMS_PRESETS[id]
    patchDraft({
      smsProvider: id,
      ...(preset || {})
    })
  }

  const buildSavePayload = (): AlertNotifySettings => {
    const next = { ...draft }
    // Keep empty secrets so mergeAlertNotifySettings on server preserves disk values
    if (!secretTouched.pushplusToken && pub?.pushplusTokenSet) next.pushplusToken = ''
    if (!secretTouched.serverchanSendKey && pub?.serverchanSendKeySet) next.serverchanSendKey = ''
    if (!secretTouched.smsAccessKeySecret && pub?.smsAccessKeySecretSet) next.smsAccessKeySecret = ''
    if (!secretTouched.smsAppSecret && pub?.smsAppSecretSet) next.smsAppSecret = ''
    if (!secretTouched.smsApiKey && pub?.smsApiKeySet) next.smsApiKey = ''
    if (!secretTouched.dingtalkSecret && pub?.dingtalkSecretSet) next.dingtalkSecret = ''
    if (!secretTouched.dingtalkWebhook && pub?.dingtalkWebhookSet) next.dingtalkWebhook = ''
    if (!secretTouched.webhookNotifyUrl && pub?.webhookNotifyUrlSet) next.webhookNotifyUrl = ''
    return normalizeAlertNotifySettings(next)
  }

  const onSave = async () => {
    const next = buildSavePayload()
    patchLocal({ alertNotify: next })
    await save({ alertNotify: next })
    message.success('异常对接已保存')
  }

  const onTest = async () => {
    setTesting(true)
    try {
      // Persist draft first so server uses latest channel config
      const next = buildSavePayload()
      patchLocal({ alertNotify: next })
      await save({ alertNotify: next })
      if (!isClientMode() && !window.electronAPI) {
        message.warning('请通过网页端或已连接的服务端测试')
        return
      }
      const data = await serverSend<{
        ok?: boolean
        reason?: string
        results?: Array<{ channel: string; ok: boolean; message?: string }>
      }>('/api/v1/alert-notify/test', 'POST', { kind: 'printerError' })
      if (data.ok) {
        const detail = (data.results || [])
          .map((r) => `${r.channel}: ${r.ok ? '成功' : r.message || '失败'}`)
          .join('；')
        message.success(detail || '测试通知已发送')
      } else {
        const detail = (data.results || [])
          .map((r) => `${r.channel}: ${r.message || '失败'}`)
          .join('；')
        message.error(detail || data.reason || '测试失败')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const d = draft

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.alerts.main.before" />
      <Card
        className="settings-card"
        title="异常对接"
        extra={
          <Space>
            <PluginSlot name="settings.alerts.toolbar" />
            <Button onClick={() => setDraft(defaultAlertNotifySettings())}>重置草稿</Button>
            <Button loading={testing} onClick={() => void onTest()}>
              发送测试
            </Button>
            <Button type="primary" loading={saving} onClick={() => void onSave()}>
              保存
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          打印机报错、打印完成、空闲、耗材偏低、AI 监控异常时，可推送到微信（PushPlus /
          Server酱）、国内短信商、企业微信应用消息、钉钉机器人或自定义 Webhook。企微凭证复用「企业软件对接」；AD
          用于身份登录，通知请走企微/钉钉/短信/微信推送。
        </Typography.Paragraph>

        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>启用异常对接</Typography.Text>
            <Typography.Text type="secondary">总开关；关闭后所有渠道不发送</Typography.Text>
          </div>
          <Switch checked={d.enabled} onChange={(v) => patchDraft({ enabled: v })} />
        </div>

        <div className="settings-row" style={{ marginBottom: 16 }}>
          <div className="settings-row-label">
            <Typography.Text strong>冷却时间（秒）</Typography.Text>
            <Typography.Text type="secondary">同一设备同类事件最短间隔，防刷屏</Typography.Text>
          </div>
          <InputNumber
            min={30}
            max={3600}
            value={d.cooldownSec}
            onChange={(v) => patchDraft({ cooldownSec: Number(v) || 120 })}
          />
        </div>

        <Typography.Title level={5}>触发事件</Typography.Title>
        {ALERT_EVENT_KINDS.map((kind) => (
          <div key={kind} className="settings-row" style={{ marginBottom: 8 }}>
            <Typography.Text>{ALERT_EVENT_LABELS[kind]}</Typography.Text>
            <Switch checked={d.events[kind]} onChange={(v) => setEvent(kind, v)} />
          </div>
        ))}
        <PluginSlot name="settings.alerts.fields" />
      </Card>
      <PluginSlot name="settings.alerts.main.after" />

      <PluginSlot name="settings.alerts.wechat.before" />
      <Card className="settings-card" title="微信推送（PushPlus / Server酱）">
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>PushPlus</Typography.Text>
          <Switch
            checked={d.pushplusEnabled}
            onChange={(v) => patchDraft({ pushplusEnabled: v })}
          />
        </div>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
          <Input.Password
            addonBefore="Token"
            placeholder={secretPlaceholder(pub?.pushplusTokenSet)}
            value={d.pushplusToken}
            onChange={(e) => {
              setSecretTouched((t) => ({ ...t, pushplusToken: true }))
              patchDraft({ pushplusToken: e.target.value })
            }}
          />
          <Input
            addonBefore="群组 Topic"
            placeholder="可选，一对多"
            value={d.pushplusTopic}
            onChange={(e) => patchDraft({ pushplusTopic: e.target.value })}
          />
        </Space>

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>Server酱</Typography.Text>
          <Switch
            checked={d.serverchanEnabled}
            onChange={(v) => patchDraft({ serverchanEnabled: v })}
          />
        </div>
        <Input.Password
          addonBefore="SendKey"
          placeholder={secretPlaceholder(pub?.serverchanSendKeySet) || 'SCT… 或 sctp…'}
          value={d.serverchanSendKey}
          onChange={(e) => {
            setSecretTouched((t) => ({ ...t, serverchanSendKey: true }))
            patchDraft({ serverchanSendKey: e.target.value })
          }}
        />
      </Card>
      <PluginSlot name="settings.alerts.wechat.after" />

      <PluginSlot name="settings.alerts.sms.before" />
      <Card className="settings-card" title="短信通知">
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>启用短信</Typography.Text>
          <Switch checked={d.smsEnabled} onChange={(v) => patchDraft({ smsEnabled: v })} />
        </div>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Select
            style={{ width: '100%' }}
            options={smsOptions}
            value={d.smsProvider}
            onChange={onProviderChange}
          />
          <Input.TextArea
            rows={2}
            placeholder="接收手机号，多个用逗号或换行分隔"
            value={d.smsPhones}
            onChange={(e) => patchDraft({ smsPhones: e.target.value })}
          />
          {(d.smsProvider === 'aliyun' || d.smsProvider === 'tencent') && (
            <>
              <Input
                addonBefore={d.smsProvider === 'tencent' ? 'SecretId' : 'AccessKeyId'}
                value={d.smsAccessKeyId}
                onChange={(e) => patchDraft({ smsAccessKeyId: e.target.value })}
              />
              <Input.Password
                addonBefore={d.smsProvider === 'tencent' ? 'SecretKey' : 'AccessKeySecret'}
                placeholder={secretPlaceholder(pub?.smsAccessKeySecretSet)}
                value={d.smsAccessKeySecret}
                onChange={(e) => {
                  setSecretTouched((t) => ({ ...t, smsAccessKeySecret: true }))
                  patchDraft({ smsAccessKeySecret: e.target.value })
                }}
              />
              <Input
                addonBefore="签名"
                value={d.smsSignName}
                onChange={(e) => patchDraft({ smsSignName: e.target.value })}
              />
              <Input
                addonBefore="模板 Code"
                value={d.smsTemplateCode}
                onChange={(e) => patchDraft({ smsTemplateCode: e.target.value })}
              />
              {d.smsProvider === 'aliyun' ? (
                <Input
                  addonBefore="Region"
                  value={d.smsRegion}
                  onChange={(e) => patchDraft({ smsRegion: e.target.value })}
                />
              ) : (
                <Input
                  addonBefore="SdkAppId"
                  value={d.smsSdkAppId}
                  onChange={(e) => patchDraft({ smsSdkAppId: e.target.value })}
                />
              )}
            </>
          )}
          {d.smsProvider === 'huawei' && (
            <>
              <Input
                addonBefore="AppKey"
                value={d.smsAppKey}
                onChange={(e) => patchDraft({ smsAppKey: e.target.value })}
              />
              <Input.Password
                addonBefore="AppSecret"
                placeholder={secretPlaceholder(pub?.smsAppSecretSet)}
                value={d.smsAppSecret}
                onChange={(e) => {
                  setSecretTouched((t) => ({ ...t, smsAppSecret: true }))
                  patchDraft({ smsAppSecret: e.target.value })
                }}
              />
              <Input
                addonBefore="通道号"
                value={d.smsChannel}
                onChange={(e) => patchDraft({ smsChannel: e.target.value })}
              />
              <Input
                addonBefore="签名"
                value={d.smsSignName}
                onChange={(e) => patchDraft({ smsSignName: e.target.value })}
              />
              <Input
                addonBefore="模板 ID"
                value={d.smsTemplateCode}
                onChange={(e) => patchDraft({ smsTemplateCode: e.target.value })}
              />
              <Input
                addonBefore="Endpoint"
                value={d.smsEndpoint}
                onChange={(e) => patchDraft({ smsEndpoint: e.target.value })}
              />
            </>
          )}
          {(d.smsProvider === 'yunpian' ||
            d.smsProvider === 'smsbao' ||
            d.smsProvider === 'chuanglan' ||
            d.smsProvider === 'ihuyi' ||
            d.smsProvider === 'juhe' ||
            d.smsProvider === 'submail' ||
            d.smsProvider === 'custom') && (
            <>
              {(d.smsProvider === 'smsbao' ||
                d.smsProvider === 'chuanglan' ||
                d.smsProvider === 'ihuyi' ||
                d.smsProvider === 'submail') && (
                <Input
                  addonBefore={d.smsProvider === 'submail' ? 'AppId' : '账号'}
                  value={d.smsApiUser}
                  onChange={(e) => patchDraft({ smsApiUser: e.target.value })}
                />
              )}
              <Input.Password
                addonBefore={
                  d.smsProvider === 'yunpian'
                    ? 'ApiKey'
                    : d.smsProvider === 'juhe'
                      ? 'Key'
                      : d.smsProvider === 'submail'
                        ? 'AppKey'
                        : 'API 密钥'
                }
                placeholder={secretPlaceholder(pub?.smsApiKeySet)}
                value={d.smsApiKey}
                onChange={(e) => {
                  setSecretTouched((t) => ({ ...t, smsApiKey: true }))
                  patchDraft({ smsApiKey: e.target.value })
                }}
              />
              {(d.smsProvider === 'yunpian' || d.smsProvider === 'submail') && (
                <Input
                  addonBefore="签名"
                  value={d.smsSignName}
                  onChange={(e) => patchDraft({ smsSignName: e.target.value })}
                />
              )}
              {d.smsProvider === 'juhe' && (
                <Input
                  addonBefore="模板 ID"
                  value={d.smsTemplateCode}
                  onChange={(e) => patchDraft({ smsTemplateCode: e.target.value })}
                />
              )}
              {(d.smsProvider === 'chuanglan' ||
                d.smsProvider === 'ihuyi' ||
                d.smsProvider === 'custom') && (
                <>
                  <Input
                    addonBefore="API URL"
                    value={d.smsApiUrl}
                    onChange={(e) => patchDraft({ smsApiUrl: e.target.value })}
                  />
                  {d.smsProvider === 'custom' && (
                    <>
                      <Select
                        style={{ width: '100%' }}
                        value={d.smsApiMethod}
                        options={[
                          { value: 'POST', label: 'POST' },
                          { value: 'GET', label: 'GET' }
                        ]}
                        onChange={(v) => patchDraft({ smsApiMethod: v })}
                      />
                      <Input.TextArea
                        rows={2}
                        placeholder="Headers JSON，可选"
                        value={d.smsApiHeaders}
                        onChange={(e) => patchDraft({ smsApiHeaders: e.target.value })}
                      />
                      <Input.TextArea
                        rows={3}
                        placeholder="Body 模板，支持 {{phone}} {{content}} {{key}} {{sign}} {{user}} {{tpl}}"
                        value={d.smsApiBodyTemplate}
                        onChange={(e) => patchDraft({ smsApiBodyTemplate: e.target.value })}
                      />
                    </>
                  )}
                </>
              )}
            </>
          )}
          <Typography.Text type="secondary">
            阿里云/腾讯云/华为云走官方 API；云片、短信宝、创蓝、互亿、聚合、赛邮已内置；其余短信商选「自定义
            HTTP」按对方文档填 URL 与模板即可覆盖绝大多数网关。
          </Typography.Text>
        </Space>
      </Card>
      <PluginSlot name="settings.alerts.sms.after" />

      <PluginSlot name="settings.alerts.webhook.before" />
      <Card className="settings-card" title="企微 / 钉钉 / 自定义 Webhook">
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          企微应用消息使用「企业软件对接」里的 CorpId / AgentId / Secret。钉钉推荐自定义机器人文档 Webhook（可加签）。AD
          域负责账号身份，不直接推送；可将通知发到企微/钉钉群或短信。
        </Typography.Paragraph>

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>企微应用消息</Typography.Text>
          <Switch
            checked={d.wecomNotifyEnabled}
            onChange={(v) => patchDraft({ wecomNotifyEnabled: v })}
          />
        </div>
        <Input
          style={{ marginBottom: 16 }}
          addonBefore="接收人"
          placeholder="@all 或 userid，多个用逗号"
          value={d.wecomNotifyTouser}
          onChange={(e) => patchDraft({ wecomNotifyTouser: e.target.value })}
        />

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>钉钉机器人</Typography.Text>
          <Switch
            checked={d.dingtalkNotifyEnabled}
            onChange={(v) => patchDraft({ dingtalkNotifyEnabled: v })}
          />
        </div>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
          <Input.Password
            addonBefore="Webhook"
            placeholder={secretPlaceholder(pub?.dingtalkWebhookSet)}
            value={d.dingtalkWebhook}
            onChange={(e) => {
              setSecretTouched((t) => ({ ...t, dingtalkWebhook: true }))
              patchDraft({ dingtalkWebhook: e.target.value })
            }}
          />
          <Input.Password
            addonBefore="加签 Secret"
            placeholder={secretPlaceholder(pub?.dingtalkSecretSet) || '可选'}
            value={d.dingtalkSecret}
            onChange={(e) => {
              setSecretTouched((t) => ({ ...t, dingtalkSecret: true }))
              patchDraft({ dingtalkSecret: e.target.value })
            }}
          />
        </Space>

        <div className="settings-row" style={{ marginBottom: 8 }}>
          <Typography.Text strong>告警 Webhook</Typography.Text>
          <Switch
            checked={d.webhookNotifyEnabled}
            onChange={(v) => patchDraft({ webhookNotifyEnabled: v })}
          />
        </div>
        <Input.Password
          addonBefore="URL"
          placeholder={secretPlaceholder(pub?.webhookNotifyUrlSet) || 'POST JSON'}
          value={d.webhookNotifyUrl}
          onChange={(e) => {
            setSecretTouched((t) => ({ ...t, webhookNotifyUrl: true }))
            patchDraft({ webhookNotifyUrl: e.target.value })
          }}
        />
      </Card>
      <PluginSlot name="settings.alerts.webhook.after" />
    </Space>
  )
}
