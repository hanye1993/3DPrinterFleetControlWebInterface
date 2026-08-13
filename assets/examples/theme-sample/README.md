# 示例主题包说明

这是 **hanye 监控台** 可下载的主题开发示例（`sample_topnav`），演示 Discuz 式 `.htm` 模板 + 排版引擎。

## 安装

1. 下载 ZIP：`hanye-theme-sample-topnav.zip`
2. 打开监控台 → **软件设置 → 主题**
3. 拖拽上传 ZIP → **启用**「示例·顶栏工单台」
4. 可在样式里切换「昼间 / 夜间」

## 包内容

| 文件 | 作用 |
|------|------|
| `theme.json` | 清单：`layout=topnav`、`deviceView=list`、`loginLayout=split` |
| `style.css` / `login.css` | 全局 / 登录皮肤 |
| `layout.js` | `window.HanyeTheme` 槽位脚本示例 |
| `templates/common/header.htm` | 可被 include / extends 的公共片段 |
| `templates/app.header.before.htm` | 顶栏前槽位（extends + block replace） |

`templates/` 下 `.htm` **自动发现**为槽位名（服务端 TemplateEngine 编译后注入）。  
可选 `theme.json.parent` 继承母主题同名模板。开发手册见 `ops/docs/THEME.md`。
