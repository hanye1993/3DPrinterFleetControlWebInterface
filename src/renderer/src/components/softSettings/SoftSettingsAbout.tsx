import { Card, Space, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { openExternal } from '../../utils/openExternal'
import { PluginSlot } from '../../plugins/PluginSlot'

const APP_VERSION = '1.0.0'

export function SoftSettingsAbout() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <PluginSlot name="settings.about.content.before" />
      <Card className="settings-card" title="说明">
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div className="settings-row">
            <div className="settings-row-label">
              <Typography.Text strong>hanye-3D打印机监控台</Typography.Text>
              <Typography.Text type="secondary">版本 v{APP_VERSION}</Typography.Text>
            </div>
            <InfoCircleOutlined style={{ fontSize: 18, opacity: 0.55 }} />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              介绍
            </Typography.Text>
            <Typography.Text>
              纯网页版监控台：电脑与手机浏览器打开同一地址即可使用（手机自适应布局）。统一管理
              Klipper / 拓竹 / 创想等设备与耗材；可通过「主题」换排版与配色，通过「插件」扩展功能。
            </Typography.Text>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              开发者
            </Typography.Text>
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              B站：
              <Typography.Link
                onClick={() =>
                  openExternal(
                    'https://search.bilibili.com/all?keyword=%E5%B0%8F%E6%B1%89%E6%95%85%E4%BA%8B'
                  )
                }
              >
                @小汉故事
              </Typography.Link>
              <br />
              QQ：
              <Typography.Text copyable={{ text: '2500689358' }}>2500689358</Typography.Text>
              <br />
              群号：
              <Typography.Text copyable={{ text: '1053838529' }}>1053838529</Typography.Text>
            </Typography.Paragraph>
            <PluginSlot name="settings.about.links.after" />
          </div>
          <div>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              感谢
            </Typography.Text>
            <Typography.Text>时空之树测试反馈</Typography.Text>
          </div>
          <PluginSlot name="settings.about.footer" />
        </Space>
      </Card>
      <PluginSlot name="settings.about.content.after" />
    </Space>
  )
}
