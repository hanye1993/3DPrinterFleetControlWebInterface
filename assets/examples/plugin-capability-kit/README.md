# 能力原语示例（capability_kit）

演示宿主 **v1.1 / Kernel 2.2** 提供的插件原语（非业务成品）：

- `GET /api/v1/plugins/capability_kit/probe` — 公共 URL、样例设备 `getCapabilities`、历史条数
- `POST .../demo-lock` — `claimDevice`
- 监听 `action:print.finished` → 写入插件 `history.json`

## 安装

打 ZIP（根含 `plugin.json`）→ 软件设置 → 插件 → 上传 → 启用。
