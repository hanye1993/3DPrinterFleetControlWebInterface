import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Switch,
  Typography,
  message
} from 'antd'
import { CloudSyncOutlined, ApiOutlined, SaveOutlined } from '@ant-design/icons'
import {
  fetchFilamentSyncSources,
  runFilamentSyncSources,
  saveFilamentSyncSources,
  testFilamentSyncSource,
  type FilamentSyncDirection,
  type FilamentSyncSource,
  type FilamentSyncSourceType
} from '../../api/filamentSyncApi'

const DIRECTION_OPTS: { value: FilamentSyncDirection; label: string }[] = [
  { value: 'mutual', label: '双向同步' },
  { value: 'pull', label: '仅拉取到本地' },
  { value: 'push', label: '仅推送到外部' }
]

/** 软件设置：最多 3 个外部耗材库（Spoolman）与本地互相同步 */
export function SoftSettingsFilamentSync() {
  const [sources, setSources] = useState<FilamentSyncSource[]>([])
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const r = await fetchFilamentSyncSources()
      setSources(Array.isArray(r.sources) ? r.sources : [])
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const patch = (index: number, partial: Partial<FilamentSyncSource>) => {
    setSources((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s
        const next = { ...s, ...partial }
        if (partial.type === 'none') {
          next.enabled = false
        }
        if (partial.type === 'spoolman' && !s.baseUrl && !partial.baseUrl) {
          next.baseUrl = 'http://127.0.0.1:7912'
        }
        return next
      })
    )
  }

  const save = async () => {
    setBusy(true)
    try {
      const r = await saveFilamentSyncSources(sources)
      setSources(r.sources || sources)
      message.success('已保存（最多 3 个外部耗材库）')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const test = async (id: string) => {
    setBusy(true)
    try {
      const r = await testFilamentSyncSource(id)
      if (!r.ok) throw new Error(r.message || '测试失败')
      message.success(r.message || '连接正常')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '测试失败')
    } finally {
      setBusy(false)
    }
  }

  const syncOne = async (id: string) => {
    setBusy(true)
    try {
      await saveFilamentSyncSources(sources)
      const r = await runFilamentSyncSources({ id })
      if (!r.ok) throw new Error(r.message || '同步失败')
      message.success(r.message || '同步完成')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  const syncAll = async () => {
    setBusy(true)
    try {
      await saveFilamentSyncSources(sources)
      const r = await runFilamentSyncSources({ all: true })
      if (!r.ok) throw new Error(r.message || '同步失败')
      const detail = (r.results || [])
        .map((x: { name: string; message: string }) => `${x.name}: ${x.message}`)
        .join('；')
      message.success((r.message || '同步完成') + (detail ? `（${detail}）` : ''))
    } catch (e) {
      message.error(e instanceof Error ? e.message : '同步失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="soft-settings-panel">
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        耗材库同步
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        本地耗材库可对接最多 <strong>3</strong> 个外部库（当前支持{' '}
        <a href="https://github.com/Donkie/Spoolman" target="_blank" rel="noreferrer">
          Spoolman
        </a>
        ）。按「品牌 + 材质 + 色值」匹配；拓竹 Studio 云端仍在「耗材管理」页单独对接。
      </Typography.Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="建议先「保存」再「测试连接 / 同步」。双向同步会推送本地缺的卷、拉取外部缺的卷，并更新已配对卷的余量。"
      />
      <Space wrap style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => void save()}>
          保存配置
        </Button>
        <Button icon={<CloudSyncOutlined />} loading={busy} onClick={() => void syncAll()}>
          同步全部已启用库
        </Button>
      </Space>
      {sources.map((s, i) => (
        <Card
          key={s.id}
          size="small"
          title={`${s.name || `耗材库 ${i + 1}`}（${s.id}）`}
          style={{ marginBottom: 12 }}
          extra={
            <Switch
              checked={s.enabled && s.type !== 'none'}
              disabled={s.type === 'none'}
              onChange={(v) => patch(i, { enabled: v })}
              checkedChildren="启用"
              unCheckedChildren="关闭"
            />
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Typography.Text type="secondary">显示名称</Typography.Text>
              <Input
                value={s.name}
                onChange={(e) => patch(i, { name: e.target.value })}
                placeholder={`耗材库 ${i + 1}`}
              />
            </div>
            <div>
              <Typography.Text type="secondary">类型</Typography.Text>
              <Select
                style={{ width: '100%' }}
                value={s.type}
                options={[
                  { value: 'none', label: '未使用' },
                  { value: 'spoolman', label: 'Spoolman' }
                ]}
                onChange={(v: FilamentSyncSourceType) => patch(i, { type: v })}
              />
            </div>
            {s.type === 'spoolman' ? (
              <>
                <div>
                  <Typography.Text type="secondary">Spoolman 地址</Typography.Text>
                  <Input
                    value={s.baseUrl}
                    onChange={(e) => patch(i, { baseUrl: e.target.value })}
                    placeholder="http://192.168.1.10:7912"
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">同步方向</Typography.Text>
                  <Select
                    style={{ width: '100%' }}
                    value={s.direction}
                    options={DIRECTION_OPTS}
                    onChange={(v: FilamentSyncDirection) => patch(i, { direction: v })}
                  />
                </div>
                <Space wrap>
                  <Button
                    icon={<ApiOutlined />}
                    loading={busy}
                    onClick={() => void test(s.id)}
                    disabled={!s.baseUrl}
                  >
                    测试连接
                  </Button>
                  <Button
                    icon={<CloudSyncOutlined />}
                    loading={busy}
                    onClick={() => void syncOne(s.id)}
                    disabled={!s.enabled}
                  >
                    立即同步
                  </Button>
                </Space>
              </>
            ) : null}
          </Space>
        </Card>
      ))}
    </div>
  )
}
