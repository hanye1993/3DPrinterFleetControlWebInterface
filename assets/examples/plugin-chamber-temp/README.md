# 仓内温度显示（chamber_temp）

在设备列表**卡片**上显示仓内温度与高温高亮。

- **不占用侧栏导航**（无独立页面 / 无管理页菜单）
- 配置：软件设置 → 插件 → `chamber_temp` 变量
- API：`GET /api/v1/chamber-temp/temps`

## 变量

| 键 | 说明 | 默认 |
|----|------|------|
| `show_on_cards` | 卡片温度条 | 开 |
| `show_badge` | 名称旁徽章 | 开 |
| `show_panel` | 列表上方总览条 | 关 |
| `warn_celsius` | 高温阈值 ℃ | 45 |
| `poll_sec` | 总览刷新秒 | 5 |
