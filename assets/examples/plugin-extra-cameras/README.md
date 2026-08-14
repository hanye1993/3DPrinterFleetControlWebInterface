# 设备第三方摄像头（extra_cameras）

为每台打印机绑定额外的 **HTTP / MJPEG** 摄像头。

## 能力

- **设备详情**：一行工具条 +「添加摄像头」按钮（弹窗填写）；已添加显示为可删除标签
- **左右切换**：详情画面左右滑动或箭头切换
- **内部监控**：第三方摄像头单独成瓦片
- **AI 巡检**：默认参与（弹窗内可关）

## 依赖

需要宿主 **≥ 1.4.2**。

## 配置

软件设置 → 插件 → `extra_cameras` 变量：

| 键 | 说明 | 默认 |
|----|------|------|
| `show_settings` | 详情页显示工具条 | 开 |
| `default_ai` | 新增默认 AI 巡检 | 开 |

## API

- `GET /api/v1/extra-cameras/list?deviceId=`
- `PUT /api/v1/extra-cameras/save` body `{ deviceId, cameras: [{ name, streamUrl, snapshotUrl?, aiEnabled? }] }`

数据写入 `device.pluginData.extraCameras`。URL 可省略 `http://`（自动补全）。

