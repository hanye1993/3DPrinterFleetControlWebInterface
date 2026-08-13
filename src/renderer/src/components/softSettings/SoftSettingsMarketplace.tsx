import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  message
} from 'antd'
import {
  AppstoreOutlined,
  CloudDownloadOutlined,
  ReloadOutlined,
  ShopOutlined
} from '@ant-design/icons'
import { serverGet, serverSend } from '../../api/serverClient'
import { PluginSlot } from '../../plugins/PluginSlot'
import { openExternal } from '../../utils/openExternal'

type MarketRow = {
  kind: 'plugin' | 'theme'
  identifier: string
  name: string
  version: string
  description?: string
  icon?: string
  intro?: string
  installed: boolean
  installedVersion: string | null
  updateAvailable: boolean
  iconUrls?: string[]
}

type MarketPayload = {
  ok?: boolean
  reachable?: boolean
  message?: string
  repo?: string
  name?: string
  updatedAt?: string
  packages?: MarketRow[]
}

const REPO_FALLBACK = 'https://github.com/hanye1993/ck3dckkzt11'

function introLines(text?: string): string {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith('版本：') && !s.startsWith('标识：'))
    .slice(0, 3)
    .join('\n')
}

function MarketCover({ row }: { row: MarketRow }) {
  const urls = row.iconUrls || []
  const [idx, setIdx] = useState(0)
  const src = urls[idx]
  if (!src) {
    return (
      <div
        className="market-card-cover market-card-cover--empty"
        style={{ background: row.kind === 'theme' ? '#5b21b6' : '#1d4ed8' }}
      >
        <AppstoreOutlined style={{ fontSize: 42, color: '#fff', opacity: 0.9 }} />
      </div>
    )
  }
  return (
    <div className="market-card-cover">
      <img
        src={src}
        alt={row.name}
        onError={() => {
          if (idx + 1 < urls.length) setIdx(idx + 1)
        }}
      />
    </div>
  )
}

function MarketAppCard({
  row,
  installing,
  onInstall
}: {
  row: MarketRow
  installing: string | null
  onInstall: (row: MarketRow) => void
}) {
  const key = `${row.kind}:${row.identifier}`
  const label = !row.installed ? '安装' : row.updateAvailable ? '更新' : '重装'
  const desc = introLines(row.description)

  return (
    <Card
      className="market-app-card"
      hoverable
      cover={<MarketCover row={row} />}
      actions={[
        <Button
          key="install"
          type="primary"
          block
          icon={<CloudDownloadOutlined />}
          loading={installing === key}
          disabled={Boolean(installing) && installing !== key}
          onClick={() => onInstall(row)}
          style={{ margin: '0 12px 4px' }}
        >
          {label}
        </Button>
      ]}
    >
      <div className="market-app-card-body">
        <div className="market-app-card-title-row">
          <Typography.Text strong ellipsis={{ tooltip: row.name }} className="market-app-card-title">
            {row.name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ flexShrink: 0 }}>
            v{row.version}
          </Typography.Text>
        </div>
        <Space size={6} wrap style={{ margin: '6px 0 8px' }}>
          {row.kind === 'theme' ? <Tag color="purple">主题</Tag> : <Tag color="blue">插件</Tag>}
          {!row.installed ? (
            <Tag>未安装</Tag>
          ) : row.updateAvailable ? (
            <Tag color="orange">可更新</Tag>
          ) : (
            <Tag color="green">已安装</Tag>
          )}
        </Space>
        <Typography.Paragraph
          type="secondary"
          ellipsis={{ rows: 3, tooltip: desc }}
          style={{ marginBottom: 0, minHeight: 66, whiteSpace: 'pre-wrap' }}
        >
          {desc || '暂无介绍'}
        </Typography.Paragraph>
      </div>
    </Card>
  )
}

export function SoftSettingsMarketplace() {
  const [loading, setLoading] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [payload, setPayload] = useState<MarketPayload | null>(null)
  const [q, setQ] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'plugin' | 'theme'>('all')

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      if (force) {
        await serverGet(`/api/v1/marketplace/refresh`).catch(() => null)
      }
      const r = (await serverGet(
        force ? '/api/v1/marketplace?force=1' : '/api/v1/marketplace'
      )) as MarketPayload
      setPayload(r)
      if (r.ok === false || r.reachable === false) {
        message.warning(r.message || '无法读取应用市场，请确认服务器能访问 GitHub / jsDelivr')
      }
    } catch (e) {
      setPayload({
        ok: false,
        reachable: false,
        message: e instanceof Error ? e.message : '加载失败',
        packages: []
      })
      message.error(e instanceof Error ? e.message : '加载应用市场失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  const rows = useMemo(() => {
    const list = Array.isArray(payload?.packages) ? payload!.packages! : []
    const kw = q.trim().toLowerCase()
    return list.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (!kw) return true
      return (
        p.name.toLowerCase().includes(kw) ||
        p.identifier.toLowerCase().includes(kw) ||
        String(p.description || '')
          .toLowerCase()
          .includes(kw)
      )
    })
  }, [payload, q, kindFilter])

  const onInstall = async (row: MarketRow) => {
    const key = `${row.kind}:${row.identifier}`
    setInstalling(key)
    try {
      const r = (await serverSend('/api/v1/marketplace/install', 'POST', {
        kind: row.kind,
        identifier: row.identifier
      })) as { ok?: boolean; message?: string }
      if (!r.ok) throw new Error(r.message || '安装失败')
      message.success(r.message || '安装成功')
      await refresh(true)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '安装失败')
    } finally {
      setInstalling(null)
    }
  }

  const repo = payload?.repo || REPO_FALLBACK

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.marketplace.content.before" />
      <Card
        className="settings-card"
        title={
          <span>
            <ShopOutlined /> 应用市场
          </span>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh(true)}>
              刷新
            </Button>
            <Button onClick={() => openExternal(repo)}>打开仓库</Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          市场仓库按 <Typography.Text code>plugins/</Typography.Text>、
          <Typography.Text code>themes/</Typography.Text> 分目录；每个应用含{' '}
          <Typography.Text code>tu.png</Typography.Text>（图标）、
          <Typography.Text code>js.txt</Typography.Text>（介绍）、同名{' '}
          <Typography.Text code>.zip</Typography.Text> 本体。源：
          <Typography.Link onClick={() => openExternal(repo)}>{repo}</Typography.Link>
        </Typography.Paragraph>

        {payload && payload.reachable === false ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="读取不到应用市场"
            description={
              payload.message ||
              '请确认运行监控台的服务器能访问 github.com 或 cdn.jsdelivr.net。'
            }
          />
        ) : null}

        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜索名称 / 标识"
            style={{ width: 240 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button
            type={kindFilter === 'all' ? 'primary' : 'default'}
            onClick={() => setKindFilter('all')}
          >
            全部
          </Button>
          <Button
            type={kindFilter === 'plugin' ? 'primary' : 'default'}
            onClick={() => setKindFilter('plugin')}
          >
            插件
          </Button>
          <Button
            type={kindFilter === 'theme' ? 'primary' : 'default'}
            onClick={() => setKindFilter('theme')}
          >
            主题
          </Button>
        </Space>

        <Spin spinning={loading}>
          {rows.length === 0 ? (
            <Empty description={loading ? '加载中…' : '暂无应用'} />
          ) : (
            <Row gutter={[16, 16]}>
              {rows.map((row) => (
                <Col
                  key={`${row.kind}:${row.identifier}`}
                  xs={24}
                  sm={12}
                  md={8}
                  lg={8}
                  xl={6}
                >
                  <MarketAppCard row={row} installing={installing} onInstall={onInstall} />
                </Col>
              ))}
            </Row>
          )}
        </Spin>
      </Card>
      <PluginSlot name="settings.marketplace.content.after" />
      <style>{`
        .market-app-card {
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .market-app-card .ant-card-body {
          flex: 1;
          padding: 12px 14px 8px;
        }
        .market-app-card .ant-card-actions {
          background: transparent;
        }
        .market-app-card .ant-card-actions > li {
          margin: 8px 0;
        }
        .market-card-cover {
          height: 140px;
          background: rgba(0,0,0,.04);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .market-card-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .market-card-cover--empty {
          background: linear-gradient(145deg, #1d4ed8, #0ea5e9);
        }
        .market-app-card-title-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .market-app-card-title {
          font-size: 15px;
        }
      `}</style>
    </Space>
  )
}
