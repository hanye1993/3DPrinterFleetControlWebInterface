import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Space,
  Table,
  Typography,
  Upload,
  message,
  Tag,
  Modal
} from 'antd'
import { InboxOutlined, ReloadOutlined, SkinOutlined } from '@ant-design/icons'
import { serverGet, serverSend } from '../../api/serverClient'
import { useSettingsStore } from '../../stores/settingsStore'
import { refreshActiveThemePack } from '../../theme/ThemeLoader'
import { applyAppearance, resolveUiTheme } from '../../theme/appearance'
import { useThemePackStore } from '../../theme/themePackStore'
import { DEFAULT_THEME_ID } from '@shared/themePack'
import { DocsPanel } from './DocsPanel'
import { PluginSlot } from '../../plugins/PluginSlot'

type ThemeRow = {
  identifier: string
  name: string
  version: string
  description: string
  copyright: string
  author: string
  builtin: boolean
  defaultStyle: string
  styles: Array<{ id: string; name: string }>
}

type Bundled = { identifier: string; name: string; version: string }

type ActivePayload = {
  packId: string
  styleId: string
}

export function SoftSettingsThemes() {
  const [themes, setThemes] = useState<ThemeRow[]>([])
  const [bundled, setBundled] = useState<Bundled[]>([])
  const [active, setActive] = useState<ActivePayload | null>(null)
  const [loading, setLoading] = useState(false)
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await serverGet<{
        themes?: ThemeRow[]
        bundled?: Bundled[]
        active?: ActivePayload | null
      }>('/api/v1/themes')
      setThemes(data.themes || [])
      setBundled(data.bundled || [])
      setActive(data.active || null)
      await refreshActiveThemePack()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const applyLocal = async (packId: string, styleId?: string) => {
    const nextStyle = styleId || settings.uiTheme
    await save({
      uiThemePack: packId,
      ...(styleId ? { uiTheme: styleId } : {})
    })
    const pack = await refreshActiveThemePack()
    const styles = pack?.pack.styles
    const def = resolveUiTheme(nextStyle, styles)
    applyAppearance({
      themeId: def.id,
      packId,
      styleCss: def.css,
      bgMode: settings.uiBgMode,
      bgColor: settings.uiBgColor,
      bgImage: settings.uiBgImage
    })
    useThemePackStore.getState().bump()
  }

  const enable = async (id: string, defaultStyle?: string) => {
    try {
      const res = await serverSend<{
        theme?: ThemeRow
        active?: ActivePayload
      }>(`/api/v1/themes/${encodeURIComponent(id)}/enable`, 'POST', {})
      const styleId =
        res.active?.styleId ||
        res.theme?.defaultStyle ||
        defaultStyle ||
        settings.uiTheme
      message.success('已启用主题')
      await applyLocal(id, styleId)
      await refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
  }

  const installBundled = async (id: string) => {
    try {
      await serverSend('/api/v1/themes/install-bundled', 'POST', { identifier: id })
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
      await serverSend('/api/v1/themes/install-zip', 'POST', { zipBase64 })
      message.success('主题包已安装')
      await refresh()
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e))
    }
    return false
  }

  const uninstall = (r: ThemeRow) => {
    if (r.identifier === DEFAULT_THEME_ID || r.builtin) {
      message.warning('内置主题不可卸载')
      return
    }
    Modal.confirm({
      title: `卸载主题「${r.name}」？`,
      content: '卸载后若正在使用将回退到默认主题。',
      okType: 'danger',
      onOk: async () => {
        try {
          await serverSend(`/api/v1/themes/${encodeURIComponent(r.identifier)}`, 'DELETE', {})
          message.success('已卸载')
          await refreshActiveThemePack()
          await refresh()
        } catch (e) {
          message.error(e instanceof Error ? e.message : String(e))
        }
      }
    })
  }

  const activeId = active?.packId || settings.uiThemePack || DEFAULT_THEME_ID

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        className="settings-card"
        title={
          <span>
            <SkinOutlined /> 主题中心
          </span>
        }
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Discuz 式<strong>.htm 模板引擎</strong>（extends / block / include / {'{$var}'}）+ 排版引擎（layout /
          deviceView / loginLayout）+ 多套配色 styles。支持<strong>整站模板模式</strong>（
          <code>siteMode: full</code>：主题 HTML 骨架 + <code>data-hanye-mount</code> 交互岛）。内置{' '}
          <code>default</code>（skin）与 <code>fullsite_board</code>（full）。开发示例请下载：
          <Typography.Link href="/api/v1/docs/downloads/hanye-theme-sample-topnav.zip">
            hanye-theme-sample-topnav.zip
          </Typography.Link>
          （顶栏 + .htm 槽位示例），上传 ZIP 后启用。完整说明见页底文档。
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
          <p className="ant-upload-text">拖拽或点击上传主题 ZIP</p>
          <p className="ant-upload-hint">包根目录须含 theme.json</p>
        </Upload.Dragger>
        <PluginSlot name="settings.themes.upload.after" />

        {bundled.length ? (
          <>
            <Typography.Title level={5}>内置主题</Typography.Title>
            <Space wrap style={{ marginBottom: 16 }}>
              {bundled.map((b) => (
                <Button key={b.identifier} onClick={() => void installBundled(b.identifier)}>
                  同步 {b.name} v{b.version}
                </Button>
              ))}
            </Space>
            <PluginSlot name="settings.themes.bundled.after" />
          </>
        ) : null}

        <PluginSlot name="settings.themes.list.before" />
        <Table
          rowKey="identifier"
          loading={loading}
          dataSource={themes}
          pagination={false}
          columns={[
            {
              title: '主题',
              render: (_, r) => (
                <div>
                  <Typography.Text strong>{r.name}</Typography.Text>
                  {r.identifier === activeId ? (
                    <Tag color="processing" style={{ marginLeft: 8 }}>
                      使用中
                    </Tag>
                  ) : null}
                  <div>
                    <Typography.Text type="secondary" code>
                      {r.identifier}
                    </Typography.Text>{' '}
                    <Tag>v{r.version}</Tag>
                    {r.builtin ? <Tag>内置</Tag> : null}
                  </div>
                  <Typography.Text type="secondary">{r.description}</Typography.Text>
                  {r.styles?.length ? (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary">
                        样式：{r.styles.map((s) => s.name).join('、')}
                      </Typography.Text>
                    </div>
                  ) : null}
                </div>
              )
            },
            {
              title: '操作',
              width: 200,
              render: (_, r) => (
                <Space wrap>
                  <Button
                    type={r.identifier === activeId ? 'default' : 'primary'}
                    size="small"
                    disabled={r.identifier === activeId}
                    onClick={() => void enable(r.identifier, r.defaultStyle)}
                  >
                    {r.identifier === activeId ? '已启用' : '启用'}
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={r.builtin || r.identifier === DEFAULT_THEME_ID}
                    onClick={() => uninstall(r)}
                  >
                    卸载
                  </Button>
                  <PluginSlot name="settings.themes.row.actions" context={{ theme: r }} />
                </Space>
              )
            }
          ]}
        />
        <PluginSlot name="settings.themes.list.after" />
      </Card>

      <DocsPanel doc="THEME" defaultOpen />
    </Space>
  )
}
