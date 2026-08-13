# 主题开发手册

主题包负责**站点长什么样**（壳层、排版、配色、`.htm` 模板）。  
业务逻辑、权限、自定义 API、设备实时数据 → 用**插件**，见 [PLUGIN.md](./PLUGIN.md)。

| 文档 | 内容 |
|------|------|
| **本文** | `siteMode`、theme.json、模板、layout 引擎、full 整站挂载、打包调试 |
| [PLUGIN.md](./PLUGIN.md) | 插件钩子 / 槽位 / SDK |
| [NODE_DEPLOY.md](./NODE_DEPLOY.md) | 部署与 `USE_MYSQL` |

---

## 目录

1. [两种站点模式](#1-两种站点模式-sitemode)
2. [主题能改什么](#2-主题能改什么)
3. [运行位置与落库](#3-运行位置与落库)
4. [包结构](#4-包结构)
5. [theme.json](#5-themejson)
6. [.htm 模板引擎](#6-htm-模板引擎)
7. [skin：排版引擎与槽位](#7-skin排版引擎与槽位)
8. [full：整站骨架与挂载点](#8-full整站骨架与挂载点)
9. [CSS / styles / layout.js](#9-css--styles--layoutjs)
10. [可选 server.js](#10-可选-serverjs)
11. [内置与示例](#11-内置与示例)
12. [开发与打包](#12-开发与打包)
13. [与插件协作](#13-与插件协作)
14. [FAQ 与检查清单](#14-faq-与检查清单)

---

## 1. 两种站点模式（siteMode）

`theme.json` → `siteMode`（默认 **`skin`**）：

| `siteMode` | 含义 | 宿主行为 |
|------------|------|----------|
| **`skin`** | 换皮 | React `ThemeAppShell` 管壳层；主题用 layout / deviceView / loginLayout + CSS + `.htm` 槽位注入 |
| **`full`** | **主题即整站** | 主题 `app.shell.replace.htm`（及可选 `login.page.replace.htm`）提供整站 HTML；React 只挂到 `data-hanye-mount` **交互岛** |

```
siteMode=skin                         siteMode=full
┌─────────────────────┐               ┌─────────────────────┐
│ ThemeAppShell       │               │ ThemeFullSiteHost   │
│  + ThemeSlot/CSS    │               │  innerHTML = .htm   │
│  + React 页面       │               │  portals → mounts   │
└─────────────────────┘               └─────────────────────┘
```

规则：

- `full` **必须**提供可编译的 `templates/app.shell.replace.htm`；否则服务端回退 `skin` 并打日志。
- 默认包 **`default` 永不改为 full**。
- `full` 下 `layout` 可忽略；设备列表仍可用 `deviceView`；登录可用 `login.page.replace`。
- 插件槽位（`PluginSlot`）仍在岛内 React 树中生效，与骨架 HTML 无关。

---

## 2. 主题能改什么

| 能力 | 说明 |
|------|------|
| **siteMode** | `skin` / `full` |
| **templates/\*.htm** | Discuz 式：extends / block / include / `{$var}`；服务端编译进 `templateHtml` |
| **parent** | 母主题继承：父模板先注册，子包同名覆盖 |
| **layout** | （skin）壳层：`classic` / `topnav` / `workspace` / `custom` |
| **deviceView** | 设备列表：`grid` / `list` / `table` |
| **loginLayout** | （skin）登录：`classic` / `split` / `custom` |
| **styles[]** | 多套配色（≈ Discuz styleid）：CSS 变量 + Ant Design token |
| **cssFiles / loginCssFiles** | 全局 / 登录页 CSS |
| **layoutJs** | 浏览器脚本（`window.HanyeTheme`） |
| **server.js** | 可选：安装/启用钩子 + `api.db` |

**不能**改：设备控制协议、权限模型、业务 API（请用插件）。

---

## 3. 运行位置与落库

| 层级 | 路径 |
|------|------|
| 内置源码 | 仓库 **`assets/themes/{id}/`** |
| 可下载示例 | **`assets/examples/theme-sample/`** |
| 已安装副本 | **`data/themes/{id}/`**（同步内置 / 上传 ZIP 写入） |
| 安装列表 | MySQL **`themes_state`**（`USE_MYSQL=1`）或 `data/themes-state.json` |
| 当前包 / 配色 | **`app_settings`**：`uiThemePack` / `uiTheme` |

`USE_MYSQL=1` 时：

| 数据 | 存储 |
|------|------|
| 已安装元数据 | `themes_state` |
| 启用包 / style id | `app_settings` |
| `server.js` → `api.db` 自建表 | `theme_{identifier}_*`，登记 `extension_schema` |
| CSS / JS / templates | 仍在磁盘 `data/themes/{id}/` |

管理入口：**软件设置 → 主题**（同步内置 / 上传 ZIP / 启用 / 卸载）。  
`default` 为内置保护包，一般不可卸载。

资源 URL：`/api/v1/themes/{id}/asset/{相对路径}`。  
激活载荷：`GET /api/v1/themes/active` → `siteMode`、`layout`、`templateHtml`、`css`、`layoutJs` 等。

---

## 4. 包结构

```
your_theme/
  theme.json                 # 必填
  style.css                  # 推荐：登录后全局样式
  login.css                  # 可选：登录页追加
  layout.js                  # 可选：HanyeTheme 脚本
  server.js                  # 可选：服务端钩子 + api.db
  preview.png                # 可选
  templates/                 # .htm 自动发现（推荐）
    common/header.htm
    common/footer.htm
    app.header.before.htm    # 槽位名 = 相对路径去扩展名
    app.shell.replace.htm    # full 必填；skin 下为整壳替换（高级）
    login.page.replace.htm   # full 登录页推荐
  slots/                     # 可选，与 templates/ 等价别名
```

`identifier` 建议小写字母、数字、下划线，并与目录名一致。

---

## 5. theme.json

### 5.1 示例（skin）

```json
{
  "identifier": "sample_topnav",
  "name": "示例·顶栏工单台",
  "version": "1.0.0",
  "description": "topnav + list + split",
  "copyright": "hanye",
  "author": "hanye",
  "builtin": false,
  "siteMode": "skin",
  "layout": "topnav",
  "deviceView": "list",
  "loginLayout": "split",
  "parent": "",
  "layoutJs": ["layout.js"],
  "cssFiles": ["style.css"],
  "loginCssFiles": ["login.css"],
  "defaultStyle": "day",
  "styles": [
    {
      "id": "day",
      "name": "昼间",
      "desc": "浅底海军顶栏",
      "swatch": ["#f3f0e8", "#0b1f3a", "#e85d04"],
      "antd": {
        "colorPrimary": "#0b1f3a",
        "colorBgBase": "#f3f0e8",
        "algorithm": "default",
        "borderRadius": 0
      },
      "css": {
        "--app-color-scheme": "light",
        "--app-text": "#0b1f3a",
        "--app-header-bg": "#0b1f3a",
        "--app-shell-bg": "#e8e4d9",
        "--app-card-bg": "#faf8f2"
      }
    }
  ]
}
```

### 5.2 示例（full）

```json
{
  "identifier": "fullsite_board",
  "name": "整站看板",
  "version": "1.0.0",
  "siteMode": "full",
  "deviceView": "grid",
  "cssFiles": ["style.css"],
  "loginCssFiles": ["login.css"],
  "layoutJs": ["layout.js"],
  "defaultStyle": "dockyard",
  "styles": [ { "id": "dockyard", "name": "船坞钢", "swatch": ["#12151a", "#2a313c", "#c47a3a"], "antd": { "colorPrimary": "#c47a3a", "algorithm": "dark" }, "css": { "--app-color-scheme": "dark" } } ]
}
```

`full` 时不必写 `layout`；务必提供 `templates/app.shell.replace.htm`。

### 5.3 根字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `identifier` | string | 唯一 ID |
| `name` / `version` / `description` | string | 展示 |
| `author` / `copyright` | string | 作者 |
| `builtin` | boolean | 是否内置 |
| `siteMode` | `skin`\|`full` | 站点模式，默认 skin |
| `parent` | string | 母主题 id |
| `layout` | enum | skin 壳层引擎 |
| `deviceView` | enum | 设备列表形态 |
| `loginLayout` | enum | skin 登录布局 |
| `cssFiles` | string[] | 登录后全局 CSS |
| `loginCssFiles` | string[] | 登录页额外 CSS（public 也会加载 cssFiles） |
| `layoutJs` | string[] | 浏览器脚本（按序） |
| `templates` | object | 可选显式映射；优先用自动发现 |
| `defaultStyle` | string | 默认 `styles[].id` |
| `styles` | array | 配色列表 |
| `preview` | string | 预览图相对路径 |

### 5.4 排版引擎（主要给 skin）

| 字段 | 取值 | 效果 |
|------|------|------|
| `layout` | `classic` | 顶栏 + 侧栏 + 主区 + 底栏 |
| | `topnav` | 顶栏 + 横向导航（无侧栏） |
| | `workspace` | 左侧图标轨 + 顶栏 + 主区 |
| | `custom` | 回退 classic；真正自定义用 `full` 或 `app.shell.replace` |
| `deviceView` | `grid` / `list` / `table` | 卡片墙 / 工单行 / 密表 |
| `loginLayout` | `classic` / `split` / `custom` | 居中卡 / 左右分栏 / class 钩子 |

**只改 `styles`/CSS、不改三个引擎，页面结构不会变。**

### 5.5 styles[] 项

| 字段 | 说明 |
|------|------|
| `id` | 写入设置 `uiTheme` |
| `name` / `desc` | UI 展示 |
| `swatch` | `[c1,c2,c3]` 色板 |
| `antd` | `colorPrimary`、`colorBgBase`、`algorithm`（`dark`\|`default`）、`borderRadius` |
| `css` | 写入根节点的 CSS 变量字典 |

---

## 6. .htm 模板引擎

与插件共用 `DefaultTemplateEngine`（`src/main/plugin/kernel/TemplateEngine.ts`）。

| 语法 | 作用 |
|------|------|
| `<!--{extends name}-->` | 继承母模板 |
| `<!--{block x}-->…<!--{/block}-->` | 定义/填充块 |
| `<!--{block x replace}-->` | 替换母模板同名块 |
| `<!--{include name}-->` | 嵌入另一模板 |
| `{$var}` / `{$a.b}` | 变量插值 |
| `<!--{if $var}-->…<!--{else}-->…<!--{/if}-->` | 条件 |
| `<!--{loop $arr $v}-->…<!--{/loop}-->` | 循环 |

自动发现：`templates/**/*.{htm,html}` → 槽位名（去扩展名）；`common/header` 亦暴露为 `common.header`。

服务端渲染上下文（精简）：`siteName`、`packName`、`styleName`、`packId`、`styleId`、`pack`、`style`、`settings`。

`GET /api/v1/themes/active` 返回已编译的 **`templateHtml`**（前端不再裸拉模板文件）。

覆盖顺序：**母主题 → 子主题 → 插件槽位**。  
替换优先级：**插件 `.replace` > 主题 `.replace` > 默认 UI**。

`siteMode=full` 时，`app.shell.replace` / `login.page.replace` **不**再走 `HanyeTheme.replaceSlot` 双渲染，由 `ThemeFullSiteHost` 独占。

---

## 7. skin：排版引擎与槽位

### 7.1 推荐路径

1. 定 `layout` / `deviceView` / `loginLayout`
2. 写 `styles[]` + `style.css`（用 `[data-theme-pack='your_id']` 限定）
3. 需要条带/角标时加 `templates/app.header.before.htm` 等局部槽位
4. 慎用整壳 `app.shell.replace`（会替换 React 壳；要整站 DOM 请改用 **`siteMode: full`**）

### 7.2 常用槽位（与插件同名）

| 区域 | 示例 |
|------|------|
| 壳 / 顶 / 导航 / 底 | `app.shell`、`app.header.*`、`app.nav.*`、`app.main.*`、`app.footer.*` |
| 登录 | `login.page`、`login.header`、`login.form.*`、`login.footer` |
| 设备 | `device.grid.*`、`device.card.*`、`device.detail.*`、`device.add.*` |
| 业务页 | `filament.*`、`tools.*`、`quote.history.*`、`monitor.*`、`users.*`、`settings.*` |

完整列表见 [PLUGIN.md §6](./PLUGIN.md#6-ui-嵌入点pluginslot)（`PLUGIN_UI_SLOTS`）。

主题优先做 **注入**（before / after / 局部 HTML）。`.replace` 会藏掉 React 子树。

### 7.3 layout.js（HanyeTheme）

```js
;(function () {
  var T = window.HanyeTheme
  if (!T) return
  T.registerSlot('app.header.before', function (el) {
    el.innerHTML = '<div class="my-banner">OPS BOARD</div>'
  })
  T.on('ready', function (p) {
    console.log('theme ready', p && p.packId)
  })
})()
```

| 方法 | 说明 |
|------|------|
| `registerSlot(name, html\|fn, opts?)` | 注入 |
| `replaceSlot(name, html\|fn)` | 注册 `name.replace` |
| `shouldReplace` / `getSlotEntries` | 查询 |
| `on` / `emit` | `ready` / `slot:change` / `reset` |
| `mode` | `'public'` \| `'app'` |

业务导航 / 权限请用插件 `window.HanyePlugin`，不要塞进主题脚本。

---

## 8. full：整站骨架与挂载点

### 8.1 必备模板

| 模板 | 要求 |
|------|------|
| `templates/app.shell.replace.htm` | **必填**；整站登录后骨架 |
| `templates/login.page.replace.htm` | 强烈建议；无则登录页回退 skin 布局 |

### 8.2 挂载点（`data-hanye-mount`）

| Mount | 宿主挂载内容 |
|-------|----------------|
| `header-brand` | Logo / 标题 |
| `header-actions` | 搜索、重连、添加等 |
| `nav` | SideNav |
| `main` | 路由主内容（设备墙、设置等） |
| `footer` | 页脚文案 |
| `mobile-toolbar` | 移动端搜索条 |
| `login-form` | 登录表单 Card |
| `login-hero` | 登录装饰区（可选） |

骨架示例：

```html
<!--{include common/header}-->
<div class="fs-shell">
  <aside class="fs-rail" data-hanye-mount="nav"></aside>
  <div class="fs-body">
    <header class="fs-header">
      <div data-hanye-mount="header-brand"></div>
      <div data-hanye-mount="header-actions"></div>
    </header>
    <div data-hanye-mount="mobile-toolbar"></div>
    <main class="fs-main" data-hanye-mount="main"></main>
    <footer data-hanye-mount="footer"></footer>
  </div>
</div>
<!--{include common/footer}-->
```

登录页示例：

```html
<div class="fs-login">
  <aside data-hanye-mount="login-hero"></aside>
  <section data-hanye-mount="login-form"></section>
</div>
```

主题 CSS 完全控制壳层；岛内仍是 Ant Design + 现有 class，可用 `.fs-shell …` 覆盖。

参考实现：仓库 **`assets/examples/theme-fullsite-board/`**。

### 8.3 边界（本轮不做）

- 不做 DIY 可视化拖拽编辑器
- 不做主题内 `eval` / 任意服务端脚本渲染业务页面
- 缺 `app.shell.replace` 时回退 skin

---

## 9. CSS / styles / layout.js

### 9.1 推荐 CSS 变量

```css
[data-theme-pack="your_id"] {
  --app-color-scheme: dark; /* 或 light */
  --app-text: #e8eaed;
  --app-header-bg: #101218;
  --app-header-border: rgba(255, 255, 255, 0.08);
  --app-header-title: #f0f3f8;
  --app-shell-bg: #0f1115;
  --app-sidebar-bg: transparent;
  --app-footer-bg: rgba(16, 18, 24, 0.92);
  --app-card-bg: rgba(22, 24, 30, 0.88);
  --app-control-color: rgba(232, 234, 237, 0.75);
}
```

### 9.2 宿主写在 `<html>` 上的属性

- `data-theme-pack="{identifier}"`
- `data-theme-layout="{layout}"`
- `data-theme-device-view="{deviceView}"`
- `data-theme-site-mode="{skin|full}"`
- `data-theme="{styleId}"`（配色）

```css
[data-theme-layout="topnav"] .app-shell { … }
[data-theme-site-mode="full"] .fs-shell { … }
[data-theme-pack="fullsite_board"] .fs-rail { … }
```

### 9.3 登录页

| 方式 | 说明 |
|------|------|
| skin + `loginLayout: split` | 分栏 + `login.css` |
| skin + 槽位 | `login.header` / `login.form.*` |
| full + `login.page.replace` | 整页骨架 + `login-form` / `login-hero` 岛 |

---

## 10. 可选 server.js

与插件 `main.js` 类似，在 **安装 / 启用 / 加载 / 卸载** 时运行：

| 导出 | 时机 |
|------|------|
| `install(api)` | 安装 ZIP / 内置同步后 |
| `register(api)` | 启动已安装主题、以及安装后 |
| `enable(api)` | 设为当前启用主题时 |
| `uninstall(api)` | 卸载前 |

`api`：`identifier`、`themeDir`、`log`、`getSettings()`、`db`（表前缀 `theme_{id}_`）。

CRUD 与插件一致：`insert` / `select` / `getOne` / `update` / `remove` / `count` / `upsert`（见 [PLUGIN.md](./PLUGIN.md) `api.db` 节）。

纯外观主题可不写 `server.js`。不要改宿主核心表。

---

## 11. 内置与示例

| 包 | 路径 | siteMode | 特点 |
|----|------|----------|------|
| `default` | `assets/themes/default/` | skin | **唯一内置**：经典侧栏 + 卡片墙；多套 styles |
| `lineboard` | `assets/examples/theme-lineboard/` | skin | 示例：workspace + table + split 登录（上传 ZIP） |
| `fullsite_board` | `assets/examples/theme-fullsite-board/` | **full** | 示例：整站 `.htm` 骨架 + islands（上传 ZIP） |
| `sample_topnav` | `assets/examples/theme-sample/` | skin | 可下载：topnav + list + split |

**本机下载**：[hanye-theme-sample-topnav.zip](/api/v1/docs/downloads/hanye-theme-sample-topnav.zip)

安装：软件设置 → **主题** → 上传 ZIP → **启用**。仅 `default` 为内置；其它开发主题放 `assets/examples/`，不要放进 `assets/themes/`。

选型：

- 只换颜色 → 改 `styles` / CSS，保持引擎不变  
- 换结构但仍用 React 壳 → 改 `layout` / `deviceView` / `loginLayout`（参考 `theme-lineboard` / `theme-sample`）  
- 主题完全掌控 DOM → `siteMode: full`（参考 `theme-fullsite-board`）

---

## 12. 开发与打包

### 12.1 流程

1. 在 `assets/examples/theme-your_id/` 编写 `theme.json` 与资源（**不要**放进 `assets/themes/`，以免被当成内置）。
2. 打成 ZIP（根目录含 `theme.json`）→ 软件设置 → 主题 → **上传**（写入 `data/themes/`）。
3. **启用**该包；在样式列表选 `styles[].id`。
4. 改 CSS：硬刷新。改 `theme.json` / `.htm`：重新上传或重启后刷新。
5. 调试：`document.documentElement.dataset.themePack` / `themeSiteMode`。

```bash
npm run build && npm start
# http://127.0.0.1:17890/
```

主题包多为静态文件；**通常只需同步到 `data/themes` 并刷新**。改宿主 React（`ThemeFullSiteHost` 等）才需重新 `build:web-app`。

### 12.2 ZIP

- 根目录含 `theme.json`，或单层目录内含 `theme.json`。
- 上传：软件设置 → 主题；或管理端安装接口。

### 12.3 API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/themes` | 已安装列表 |
| GET | `/api/v1/themes/active` | 当前包 UI 载荷 |
| POST | `/api/v1/themes/install-bundled` | 同步内置 `{ identifier }` |
| POST | `/api/v1/themes/install-zip` | 上传 ZIP |
| POST | `/api/v1/themes/{id}/enable` | 启用 |
| DELETE | `/api/v1/themes/{id}` | 卸载（非 builtin） |
| GET | `/api/v1/themes/{id}/asset/...` | 静态资源 |

---

## 13. 与插件协作

| 需求 | 建议 |
|------|------|
| 整站换皮 / 换顶栏侧栏结构 | 主题 `layout` / CSS，或 `siteMode: full` |
| 顶底导航/各页装饰条 | 主题或插件**同名槽位** |
| 隐藏菜单、权限、设置 Tab、业务 API | **插件** |
| 卡片仓温等强依赖实时数据 | 插件 `device.card.*`（主题也可读 `ctx.context`） |
| 登录品牌化 | 主题 `loginLayout` / `login.page.replace`（full） |
| full 骨架上叠业务 UI | 插件继续挂岛内 `PluginSlot` |

**注入顺序**：主题 → 插件 → 默认 UI。  
**替换优先级**：插件 `.replace` > 主题 `.replace`。避免两边同时 replace 同一区域。

---

## 14. FAQ 与检查清单

**Q: 启用了主题但看起来没变？**  
A: 是否只改了 CSS 而三个引擎仍与 default 相同？硬刷新并确认 `data-theme-pack`。

**Q: `custom` 布局为什么像 classic？**  
A: 引擎回退。请用 `siteMode: full` 或高级 `app.shell.replace`。

**Q: full 启用后仍是旧壳？**  
A: 检查 `templateHtml['app.shell.replace']` 是否非空、是否含 `data-hanye-mount`；服务端日志是否回退 skin。

**Q: 主题能否改设备控制逻辑？**  
A: 不能。用插件钩子 `control_before` 等。

**Q: 同步内置会覆盖 data/themes 修改？**  
A: 会。开发改仓库 `assets/themes/` 再同步，或改前备份。

### 发布前检查

- [ ] `identifier` 稳定唯一，与目录名一致  
- [ ] `defaultStyle` 存在于 `styles`  
- [ ] 深/浅色均设置 `--app-color-scheme` 与对比度  
- [ ] `siteMode: full` 时有 `app.shell.replace.htm` 且含关键 mount（至少 `nav` / `main`）  
- [ ] 登录页在 classic / split / full 下均可登录  
- [ ] 未在主题里写死需 JWT 的业务接口（应放插件）  
- [ ] `description` 便于设置页识别  
