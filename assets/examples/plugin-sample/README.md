# 示例插件说明

这是 **hanye 监控台** 可下载的插件开发示例（`demo_hello` / 全站改造示例）。

## 安装

1. 下载 ZIP：`hanye-plugin-sample-hello.zip`
2. 打开监控台 → **软件设置 → 插件**
3. 拖拽上传 ZIP → **启用**「全站改造示例」
4. 可在「变量」里开关：问候语、设备名前缀、登录页改造、隐藏模型网站导航

## 包内容

| 文件 | 作用 |
|------|------|
| `plugin.json` | 清单：钩子、模块、vars、client/login 脚本 |
| `main.js` | 服务端钩子（设备列表、权限、主题、自定义路由） |
| `client.js` | 登录后 SPA：`window.HanyePlugin` |
| `login.js` | 登录页改造 |
| `theme.css` | 全局轻量皮肤补丁 |
| `slots/login.header.html` | 文件型 UI 嵌入点 |
| `modules/admin.js` / `page.js` | 管理页与演示页 |
| `install.js` / `uninstall.js` | 安装/卸载生命周期 |

另有仓温卡片示例源码：仓库 `examples/plugin-chamber-temp/`（可自行打包上传）。

开发手册见仓库 `docs/PLUGIN.md`。
