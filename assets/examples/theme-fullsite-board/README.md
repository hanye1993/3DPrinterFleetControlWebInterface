# fullsite_board · 整站看板

`siteMode: "full"` 示范主题（**不内置**）：整站 DOM 由 `templates/app.shell.replace.htm` /
`login.page.replace.htm` 提供，业务 React 挂到 `data-hanye-mount` 节点。

## 挂载点

| `data-hanye-mount` | 内容 |
|--------------------|------|
| `nav` | SideNav |
| `header-brand` | Logo / 标题 |
| `header-actions` | 搜索 / 重连 / 添加 |
| `mobile-toolbar` | 移动端搜索 |
| `main` | 路由页面 |
| `footer` | 页脚 |
| `login-form` / `login-hero` | 登录表单与装饰区 |

## 启用

将本目录打成 ZIP（根目录含 `theme.json`）→ 软件设置 → 主题 → 上传 → 启用。
