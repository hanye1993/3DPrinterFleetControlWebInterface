import { useEffect, useState } from 'react'
import { Button, Card, Input, Space, Typography, message } from 'antd'
import { PictureOutlined, SaveOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../stores/settingsStore'
import { PluginSlot } from '../../plugins/PluginSlot'

export function SoftSettingsBrand() {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const save = useSettingsStore((s) => s.save)

  const [siteName, setSiteName] = useState(settings.siteName)
  const [siteTitle, setSiteTitle] = useState(settings.siteTitle)
  const [siteFooter, setSiteFooter] = useState(settings.siteFooter)
  const [dirty, setDirty] = useState(false)

  // Avoid silent settings refresh overwriting in-progress edits
  useEffect(() => {
    if (dirty) return
    setSiteName(settings.siteName)
    setSiteTitle(settings.siteTitle)
    setSiteFooter(settings.siteFooter)
  }, [settings.siteName, settings.siteTitle, settings.siteFooter, dirty])

  const persistText = async () => {
    try {
      await save({
        siteName: siteName.trim() || settings.siteName,
        siteTitle: siteTitle.trim(),
        siteFooter: siteFooter.trim()
      })
      setDirty(false)
      message.success('品牌文案已保存')
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <>
      <PluginSlot name="settings.brand.form.before" />
      <Card
        className="settings-card"
        title="网站品牌"
        extra={
          <Space wrap>
            <PluginSlot name="settings.brand.actions" />
            <Button
              type="primary"
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={() => void persistText()}
            >
              保存文案
            </Button>
          </Space>
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          自定义网站名称、Logo、浏览器标题、底部文案与 favicon（ico/png）。修改文案后请点「保存文案」；图片上传后立即保存。
        </Typography.Paragraph>
        <div className="settings-field" style={{ marginBottom: 12 }}>
          <Typography.Text strong>网站名字</Typography.Text>
          <Input
            style={{ marginTop: 8, maxWidth: 420 }}
            value={siteName}
            placeholder="hanye-3D打印机监控台"
            maxLength={80}
            onChange={(e) => {
              setDirty(true)
              setSiteName(e.target.value)
            }}
            onPressEnter={() => void persistText()}
          />
        </div>
        <div className="settings-field" style={{ marginBottom: 12 }}>
          <Typography.Text strong>网站标题（浏览器标签）</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            留空则使用网站名字
          </Typography.Paragraph>
          <Input
            style={{ maxWidth: 420 }}
            value={siteTitle}
            placeholder="可选，如：我的打印农场"
            maxLength={120}
            onChange={(e) => {
              setDirty(true)
              setSiteTitle(e.target.value)
            }}
            onPressEnter={() => void persistText()}
          />
        </div>
        <div className="settings-field" style={{ marginBottom: 12 }}>
          <Typography.Text strong>底部显示信息</Typography.Text>
          <Input.TextArea
            style={{ marginTop: 8, maxWidth: 520 }}
            rows={2}
            value={siteFooter}
            placeholder="显示在页面底部右侧，如版权 / 备案号"
            maxLength={500}
            onChange={(e) => {
              setDirty(true)
              setSiteFooter(e.target.value)
            }}
          />
        </div>
        <PluginSlot name="settings.brand.fields" />
        <div className="settings-row" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
          <div className="settings-row-label">
            <Typography.Text strong>网站 Logo</Typography.Text>
            <Typography.Text type="secondary">顶栏与登录页图标，建议正方形 PNG</Typography.Text>
          </div>
          <Space wrap>
            {settings.siteLogo ? (
              <img
                src={settings.siteLogo}
                alt="logo"
                style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover' }}
              />
            ) : null}
            <Button
              icon={<PictureOutlined />}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'
                input.onchange = () => {
                  const file = input.files?.[0]
                  if (!file) return
                  if (file.size > 1_500_000) {
                    message.error('Logo 请小于约 1.5MB')
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => {
                    void save({ siteLogo: String(reader.result || '') }).then(() =>
                      message.success('Logo 已保存')
                    )
                  }
                  reader.readAsDataURL(file)
                }
                input.click()
              }}
            >
              上传 Logo
            </Button>
            <Button
              disabled={!settings.siteLogo}
              onClick={() => {
                void save({ siteLogo: '' }).then(() => message.success('已恢复默认 Logo'))
              }}
            >
              清除
            </Button>
          </Space>
        </div>
        <PluginSlot name="settings.brand.logo.after" />
        <div className="settings-row" style={{ alignItems: 'flex-start' }}>
          <div className="settings-row-label">
            <Typography.Text strong>网站 ICO / Favicon</Typography.Text>
            <Typography.Text type="secondary">浏览器标签页小图标，支持 .ico / .png</Typography.Text>
          </div>
          <Space wrap>
            {settings.siteFavicon ? (
              <img
                src={settings.siteFavicon}
                alt="favicon"
                style={{ width: 24, height: 24, objectFit: 'contain' }}
              />
            ) : null}
            <Button
              icon={<PictureOutlined />}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept =
                  'image/x-icon,image/vnd.microsoft.icon,.ico,image/png,image/jpeg,image/webp,image/svg+xml'
                input.onchange = () => {
                  const file = input.files?.[0]
                  if (!file) return
                  if (file.size > 500_000) {
                    message.error('Favicon 请小于约 500KB')
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => {
                    let dataUrl = String(reader.result || '')
                    if (
                      dataUrl.startsWith('data:application/octet-stream') ||
                      dataUrl.startsWith('data:;')
                    ) {
                      const b64 = dataUrl.split(',')[1] || ''
                      dataUrl = `data:image/x-icon;base64,${b64}`
                    }
                    void save({ siteFavicon: dataUrl }).then(() =>
                      message.success('Favicon 已保存')
                    )
                  }
                  reader.readAsDataURL(file)
                }
                input.click()
              }}
            >
              上传 ICO
            </Button>
            <Button
              disabled={!settings.siteFavicon}
              onClick={() => {
                void save({ siteFavicon: '' }).then(() => message.success('已清除 Favicon'))
              }}
            >
              清除
            </Button>
          </Space>
        </div>
        <PluginSlot name="settings.brand.favicon.after" />
      </Card>
      <PluginSlot name="settings.brand.form.after" />
    </>
  )
}
