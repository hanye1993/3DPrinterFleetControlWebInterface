# 设备卡片机型显示（plugin）

在设备列表卡片上显示机型；未设置时显示「未知」。

## 数据说明（重要）

按 [PLUGIN.md](../../../ops/docs/PLUGIN.md) §6.2，`device.card.*` 槽位 `context` **不包含机型**，只有：

`deviceId`、`deviceName`、`brand`、`chamberTemp`、`boardTemp`、`health`、`state`、`tech`

系统设备对象上有字段 **`model`**（添加设备 / 详情里可设置）。本插件通过：

1. `api.getDevices()` → 自定义路由 `GET /api/v1/device-model-card/models`
2. 前端用 `context.deviceId` 对照显示

若路由不可用，会兜底请求宿主 `GET /api/v1/devices`。

## 安装

将本目录打成 ZIP（根目录含 `plugin.json`），在 **软件设置 → 插件** 上传 → **启用**。（本插件不内置）

## 配置

| vars | 说明 |
|------|------|
| `show_on_cards` | 是否在卡片显示 |
| `place` | `after_name` / `extra` / `both` |
| `poll_sec` | 机型缓存刷新间隔 |
