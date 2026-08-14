# 设备第三方摄像头（extra_cameras）

为每台打印机绑定额外的 **HTTP / MJPEG** 摄像头。

## 能力

- **设备详情**：摄像头下方设置面板（添加 / 删除 / 保存）
- **左右切换**：详情画面左右滑动或箭头切换（宿主 `CameraPanel`；详情控制台插件同步支持）
- **内部监控**：第三方摄像头单独成瓦片显示
- **AI 巡检**：默认参与设备 AI 巡检（可在设置中关闭单路）

## 依赖

需要宿主 **≥ 1.4.2**（合并 `device.pluginData.extraCameras` 到摄像头列表 / 监控墙 / AI）。

## 配置

软件设置 → 插件 → `extra_cameras` 变量：

| 键 | 说明 | 默认 |
|----|------|------|
| `show_settings` | 详情页显示设置面板 | 开 |
| `default_ai` | 新增摄像头默认 AI 巡检 | 开 |

## API

- `GET /api/v1/extra-cameras/list?deviceId=`
- `PUT /api/v1/extra-cameras/save` body `{ deviceId, cameras: [{ name, streamUrl, snapshotUrl?, aiEnabled? }] }`

数据写入 `device.pluginData.extraCameras`，摄像头 id 形如 `extra:…`。
