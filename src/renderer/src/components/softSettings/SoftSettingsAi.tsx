import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Typography,
  message
} from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import {
  AI_FAULT_KINDS,
  AI_FAULT_LABELS,
  normalizeAiVisionSettings,
  type AiFaultAction,
  type AiFaultKind,
  type AiVisionAlert,
  type AiVisionSettings
} from '@shared/aiVision'
import { useSettingsStore } from '../../stores/settingsStore'
import { useDeviceStore } from '../../stores/deviceStore'
import { isClientMode, serverGet, serverSend } from '../../api/serverClient'
import { isAdminUi } from '../../utils/appMode'
import { PluginSlot } from '../../plugins/PluginSlot'

const ACTION_OPTS: { value: AiFaultAction; label: string }[] = [
  { value: 'none', label: '仅告警' },
  { value: 'pause', label: '暂停打印' },
  { value: 'stop', label: '停止打印' }
]

export function SoftSettingsAi() {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const patchLocal = useSettingsStore((s) => s.patchLocal)
  const save = useSettingsStore((s) => s.save)
  const devices = useDeviceStore((s) => s.devices)
  const canAdmin = isAdminUi()

  const initial = useMemo(
    () => normalizeAiVisionSettings(settings.aiVision),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.aiVision]
  )
  const [draft, setDraft] = useState<AiVisionSettings>(initial)
  const [keyTouched, setKeyTouched] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [alerts, setAlerts] = useState<AiVisionAlert[]>([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setDraft(normalizeAiVisionSettings(settings.aiVision))
    setKeyTouched(false)
  }, [settings.aiVision])

  useEffect(() => {
    if (!canAdmin || !isClientMode()) return
    let cancelled = false
    const pull = async () => {
      try {
        const data = await serverGet<{
          lastError?: string | null
          yoloReady?: boolean
          yoloMessage?: string | null
          yoloWeightsExists?: boolean
          alerts?: AiVisionAlert[]
          enabled?: boolean
        }>('/api/v1/ai/vision/status')
        if (cancelled) return
        const parts = [
          data.enabled ? '巡检开' : '巡检关',
          data.yoloWeightsExists ? '权重OK' : '权重缺失',
          data.yoloReady ? 'YOLO就绪' : '',
          data.yoloMessage || '',
          data.lastError || ''
        ].filter(Boolean)
        setStatusText(parts.join(' · '))
        setAlerts(data.alerts || [])
      } catch {
        /* ignore */
      }
    }
    void pull()
    const t = window.setInterval(() => void pull(), 8000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [canAdmin])

  const patchDraft = (partial: Partial<AiVisionSettings>) => {
    setDraft((d) => ({ ...d, ...partial }))
  }

  const onSave = async () => {
    const next: AiVisionSettings = {
      ...draft,
      cloudApiKey: keyTouched ? draft.cloudApiKey : draft.cloudApiKey || ''
    }
    // If key not touched and was set, send empty so server keeps previous
    if (!keyTouched && (settings.aiVision as { cloudApiKeySet?: boolean } | undefined)?.cloudApiKeySet) {
      next.cloudApiKey = ''
    }
    patchLocal({ aiVision: next })
    await save({ aiVision: next })
    message.success('AI 对接已保存')
  }

  const testYolo = async () => {
    if (!isClientMode()) {
      message.warning('请在网页版后台服务运行时测试')
      return
    }
    const target = devices[0]
    if (!target) {
      message.warning('请先添加带摄像头的设备')
      return
    }
    setTesting(true)
    try {
      // Prefer live device check (snapshot + YOLO + optional cloud)
      const res = await serverSend<{
        ok?: boolean
        message?: string
        alerts?: AiVisionAlert[]
      }>('/api/v1/ai/vision/check', 'POST', { deviceId: target.id })
      if (res.ok === false) {
        message.error(res.message || '检测失败')
        return
      }
      const hits = res.alerts || []
      if (!hits.length) message.success(`已检测 ${target.name}：未发现异常`)
      else {
        message.warning(
          `检测到：${hits.map((h) => `${h.label}(${(h.confidence * 100).toFixed(0)}%)`).join('、')}`
        )
      }
      setAlerts((prev) => [...hits, ...prev].slice(0, 40))
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  if (!canAdmin) {
    return <Alert type="info" showIcon message="仅管理员可配置 AI 对接" />
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.ai.main.before" />
      <Card
        className="settings-card"
        title={
          <span>
            <RobotOutlined /> AI 对接 · 内部监控
          </span>
        }
        extra={
          <Button type="primary" loading={saving} onClick={() => void onSave()}>
            保存
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          用于内部监控画面巡检：炒面、空打、模型掉落、翘边。可对每种异常设置「仅告警 /
          暂停 / 停止」。本地 YOLOv8（
          <Typography.Text code>yolo/best.pt</Typography.Text>
          ）只负责炒面；云端视觉模型可识别全部类型。
        </Typography.Paragraph>

        <div className="settings-row" style={{ marginBottom: 12 }}>
          <div className="settings-row-label">
            <Typography.Text strong>启用 AI 巡检</Typography.Text>
            <Typography.Text type="secondary">开启后后台周期抓拍内部监控摄像头</Typography.Text>
          </div>
          <Switch checked={draft.enabled} onChange={(v) => patchDraft({ enabled: v })} />
        </div>

        <Typography.Title level={5}>按设备开关</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          总开关开启后，可对每台打印机单独开启/关闭 AI 视频巡检。也可在「内部监控」画面上直接切换。
        </Typography.Paragraph>
        {devices.length ? (
          <div style={{ marginBottom: 16 }}>
            {devices.map((d) => (
              <div key={d.id} className="settings-row" style={{ marginBottom: 8 }}>
                <div className="settings-row-label">
                  <Typography.Text strong>{d.name}</Typography.Text>
                  <Typography.Text type="secondary">{d.brand}</Typography.Text>
                </div>
                <Switch
                  checked={d.aiVisionEnabled !== false}
                  onChange={(v) => {
                    void useDeviceStore
                      .getState()
                      .updateDevice({ ...d, aiVisionEnabled: v })
                      .then(() =>
                        message.success(v ? `${d.name}：已开启` : `${d.name}：已关闭`)
                      )
                      .catch((e) =>
                        message.error(e instanceof Error ? e.message : '保存失败')
                      )
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="暂无设备，添加打印机后可在此单独开关"
          />
        )}
        <PluginSlot name="settings.ai.devices.after" />

        <Space wrap style={{ marginBottom: 16 }}>
          <div>
            <Typography.Text type="secondary">巡检间隔（秒）</Typography.Text>
            <InputNumber
              min={5}
              max={600}
              value={draft.intervalSec}
              onChange={(v) => patchDraft({ intervalSec: Number(v) || 20 })}
              style={{ width: 120, display: 'block', marginTop: 4 }}
            />
          </div>
          <div>
            <Typography.Text type="secondary">最低置信度</Typography.Text>
            <InputNumber
              min={0.05}
              max={0.99}
              step={0.05}
              value={draft.minConfidence}
              onChange={(v) => patchDraft({ minConfidence: Number(v) || 0.45 })}
              style={{ width: 120, display: 'block', marginTop: 4 }}
            />
          </div>
        </Space>

        <Typography.Title level={5}>异常动作</Typography.Title>
        <Table
          size="small"
          pagination={false}
          rowKey="kind"
          style={{ marginBottom: 16 }}
          dataSource={AI_FAULT_KINDS.map((kind) => ({ kind }))}
          columns={[
            {
              title: '异常',
              dataIndex: 'kind',
              render: (k: AiFaultKind) => AI_FAULT_LABELS[k]
            },
            {
              title: '执行',
              render: (_: unknown, r: { kind: AiFaultKind }) => (
                <Select
                  style={{ width: 140 }}
                  value={draft.actions[r.kind]}
                  options={ACTION_OPTS}
                  onChange={(v: AiFaultAction) =>
                    patchDraft({
                      actions: { ...draft.actions, [r.kind]: v }
                    })
                  }
                />
              )
            },
            {
              title: '说明',
              render: (_: unknown, r: { kind: AiFaultKind }) =>
                r.kind === 'spaghetti'
                  ? '本地 YOLO 可检；云端也可检'
                  : '需开启云端视觉 AI'
            }
          ]}
        />
        <PluginSlot name="settings.ai.actions.after" />

        <Typography.Title level={5}>本地 YOLOv8（仅炒面）</Typography.Title>
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div className="settings-row-label">
            <Typography.Text strong>启用本地 YOLO</Typography.Text>
            <Typography.Text type="secondary">
              使用项目 <Typography.Text code>yolo/</Typography.Text> 目录权重，需本机安装 Python +
              ultralytics
            </Typography.Text>
          </div>
          <Switch checked={draft.yoloEnabled} onChange={(v) => patchDraft({ yoloEnabled: v })} />
        </div>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }} size={8}>
          <Input
            addonBefore="权重路径"
            value={draft.yoloWeights}
            onChange={(e) => patchDraft({ yoloWeights: e.target.value })}
            placeholder="assets/yolo/best.pt"
          />
          <Input
            addonBefore="Python"
            value={draft.yoloPython}
            onChange={(e) => patchDraft({ yoloPython: e.target.value })}
            placeholder="python 或 python3"
          />
          <Button loading={testing} onClick={() => void testYolo()}>
            用第一台设备试检一次
          </Button>
        </Space>
        <PluginSlot name="settings.ai.yolo.after" />

        <Typography.Title level={5}>云端视觉 AI（全部异常）</Typography.Title>
        <div className="settings-row" style={{ marginBottom: 8 }}>
          <div className="settings-row-label">
            <Typography.Text strong>启用云端 AI</Typography.Text>
            <Typography.Text type="secondary">OpenAI 兼容接口（含国内中转）</Typography.Text>
          </div>
          <Switch checked={draft.cloudEnabled} onChange={(v) => patchDraft({ cloudEnabled: v })} />
        </div>
        <Space direction="vertical" style={{ width: '100%', marginBottom: 8 }} size={8}>
          <Input
            addonBefore="Base URL"
            value={draft.cloudBaseUrl}
            onChange={(e) => patchDraft({ cloudBaseUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
          <Input
            addonBefore="模型"
            value={draft.cloudModel}
            onChange={(e) => patchDraft({ cloudModel: e.target.value })}
            placeholder="gpt-4o-mini"
          />
          <Input.Password
            addonBefore="API Key"
            value={draft.cloudApiKey}
            placeholder={
              (settings.aiVision as { cloudApiKeySet?: boolean } | undefined)?.cloudApiKeySet
                ? '已配置（留空保存则保持不变）'
                : '填写密钥'
            }
            onChange={(e) => {
              setKeyTouched(true)
              patchDraft({ cloudApiKey: e.target.value })
            }}
          />
        </Space>
        <PluginSlot name="settings.ai.cloud.after" />

        {statusText ? (
          <Alert type="info" showIcon style={{ marginTop: 12 }} message={statusText} />
        ) : null}
        <PluginSlot name="settings.ai.fields" />
      </Card>
      <PluginSlot name="settings.ai.main.after" />

      <PluginSlot name="settings.ai.alerts.before" />
      <Card className="settings-card" title="最近告警">
        <Table
          size="small"
          rowKey="id"
          pagination={{ pageSize: 8 }}
          dataSource={alerts}
          locale={{ emptyText: '暂无告警' }}
          columns={[
            { title: '时间', dataIndex: 'at', width: 170, render: (v: string) => v?.replace('T', ' ').slice(0, 19) },
            { title: '设备', dataIndex: 'deviceName' },
            { title: '异常', dataIndex: 'label' },
            {
              title: '置信度',
              dataIndex: 'confidence',
              width: 80,
              render: (v: number) => `${Math.round((v || 0) * 100)}%`
            },
            { title: '来源', dataIndex: 'source', width: 70 },
            {
              title: '动作',
              width: 120,
              render: (_: unknown, r: AiVisionAlert) =>
                r.action === 'none'
                  ? '仅告警'
                  : `${r.action === 'pause' ? '暂停' : '停止'}${
                      r.actionOk === false ? '失败' : r.actionOk ? '成功' : ''
                    }`
            }
          ]}
        />
      </Card>
      <PluginSlot name="settings.ai.alerts.after" />
    </Space>
  )
}
