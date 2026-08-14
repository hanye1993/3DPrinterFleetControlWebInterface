# 插件开发手册

插件负责**站点能做什么**：钩子、自定义 API、权限、导航、设置 Tab、设备卡/详情增强、登录改造等。  
整站排版与配色优先用**主题包**，见 [THEME.md](./THEME.md)。

| 文档 | 内容 |
|------|------|
| **本文** | 包结构、PluginApi、钩子、UI 槽位、浏览器 SDK、模块权限、打包 |
| [PLUGIN_KERNEL_V2.md](./PLUGIN_KERNEL_V2.md) | **推荐**：`apiVersion: "2"` + `activate(ctx)` 微内核 |
| [THEME.md](./THEME.md) | 主题 skin / full、`.htm`、挂载点 |

> **推荐新插件走微内核 v2.2**（`apiVersion: "2"`，宿主 ≥ **1.2.0**）。旧版 `main.js` 导出同名钩子（v1）经 CompatAdapter 仍可用。  
> 领域事件、HMAC 回调、cron、SQL migrations、设备文件/锁机/快照原语 → 见下文与内核文档。

> **安全**：插件在服务端与浏览器双端运行，权限极高。只安装可信来源。

`USE_MYSQL=1` 时业务数据进 MySQL，包文件仍在磁盘。部署见 [NODE_DEPLOY.md](./NODE_DEPLOY.md)。

### 示例包下载

| 包 | 下载 | 说明 |
|----|------|------|
| 全站改造示例 | [hanye-plugin-sample-hello.zip](/api/v1/docs/downloads/hanye-plugin-sample-hello.zip) | 登录 / 导航 / 权限 / 槽位 / 自定义路由 |
| Kernel v2 示例 | [hanye-plugin-kernel-v2.zip](/api/v1/docs/downloads/hanye-plugin-kernel-v2.zip) | `activate(ctx)` / hooks / templates / cron |
| 能力原语示例 | （源码打包） | 文件/开打/锁机/快照/print.finished 历史 |

源码：`assets/examples/plugin-sample/`、`assets/examples/plugin-kernel-v2/`、`assets/examples/plugin-capability-kit/`、`assets/examples/plugin-chamber-temp/`（仓温，可自行打包）。

安装：软件设置 → **插件** → 上传 ZIP → **启用**。

---

## 目录

1. [概念与运行位置](#1-概念与运行位置)
2. [包结构](#2-包结构)
3. [plugin.json](#3-pluginjson)
4. [服务端 main.js 与 PluginApi](#4-服务端mainjs-与-pluginapi)
5. [服务端钩子一览](#5-服务端钩子一览)
6. [UI 嵌入点 PluginSlot](#6-ui-嵌入点pluginslot)
7. [浏览器 SDK HanyePlugin](#7-浏览器-sdkwindowhanyeplugin)
8. [模块页与用户权限](#8-模块页与用户权限对接)
9. [生命周期](#9-生命周期)
10. [典型做法速查](#10-典型插件类型怎么做)
11. [开发调试与打包](#11-开发调试与打包)
12. [与主题的分工](#12-与主题的分工)
13. [检查清单](#13-检查清单)

---

## 1. 概念与运行位置

| 层级 | 位置 | 作用 |
|------|------|------|
| 开发示例 | `assets/examples/plugin-*/` | 学习与二次打包 |
| 可选内置 | `assets/plugins/{id}/` | 存在则出现「同步内置」 |
| 已安装包 | `data/plugins/{id}/` | 运行时加载的代码副本 |
| 私有 JSON | MySQL `plugin_data` 或 `data/plugin-data/{id}/` | `api.readJson` / `writeJson` |
| 安装状态 | MySQL `plugins_state` 或 `data/plugins-state.json` | 启用、vars、模块、cron 状态 |
| 服务端 | `main.js`（v1）或 `activate(ctx)`（v2） | 拦截 API、改数据、自定义路由 |
| 登录页 | `login.js` + `publicClientJs` | 无 JWT，改登录 UI |
| 登录后 SPA | `client.js` + `clientJs` | 全站 UI / 导航 / 设置 Tab |

管理入口：**软件设置 → 插件**。

---

## 2. 包结构

```
your_plugin/
  plugin.json                 # 必填
  main.js                     # v1：导出钩子；v2：可 export activate
  client.js                   # 登录后 SPA（window.HanyePlugin）
  login.js                    # 登录页（可选）
  theme.css                   # 全局 CSS（可选）
  install.js / uninstall.js / upgrade.js
  install.sql / uninstall.sql # 可选（MySQL）
  migrations/                 # v2：v1.sql, v2.sql …
    v1.sql
  language/                   # v2：i18n
    zh-CN.json
  templates/                  # v2：.htm（与主题同引擎）
    banner.htm
  slots/
    login.header.html         # 文件名 = 槽位名
  modules/
    page.js                   # type=page → 侧栏 iframe 页
    admin.js                  # type=admin
    tick.js                   # type=cron（配合 schedule）
  static/
    page.css
```

`identifier`：小写字母、数字、下划线（会规范化）。

---

## 3. plugin.json

### 3.1 v1 完整示例

```json
{
  "identifier": "chamber_temp",
  "name": "仓内温度显示",
  "version": "1.0.0",
  "description": "在设备卡片与专用页显示仓内温度",
  "copyright": "hanye",
  "available": true,
  "hooks": ["register", "common", "permissions_catalog"],
  "modules": [
    {
      "name": "page",
      "menu": "仓内温度",
      "type": "page",
      "displayOrder": 25,
      "perm": "plugin.chamber_temp.page"
    },
    {
      "name": "admin",
      "menu": "仓温插件设置",
      "type": "admin",
      "displayOrder": 0,
      "adminOnly": true
    }
  ],
  "vars": [
    {
      "key": "show_on_cards",
      "title": "设备卡片显示仓温",
      "type": "boolean",
      "value": "1"
    }
  ],
  "clientJs": ["client.js"],
  "publicClientJs": ["login.js"],
  "themeCss": "theme.css",
  "mainFile": "main.js",
  "installFile": "install.js",
  "uninstallFile": "uninstall.js",
  "upgradeFile": "upgrade.js"
}
```

### 3.2 v2 增量字段

```json
{
  "apiVersion": "2",
  "requires": { "kernel": ">=2.2.0" },
  "capabilities": [
    "log", "config.vars", "hooks", "http.route", "http.callback", "http.fetch",
    "devices.read", "devices.control", "devices.files", "devices.print",
    "devices.capabilities", "devices.gcode", "devices.moonraker", "devices.lock",
    "camera.snapshot", "media.write", "settings.publicUrl", "users.pluginData",
    "templates", "alert.dispatch", "users.read", "auth.login",
    "cache", "plugins.call", "i18n", "db.scoped"
  ],
  "dbSchemaVersion": 1,
  "modules": [
    { "name": "tick", "menu": "定时", "type": "cron", "schedule": "every:5m", "displayOrder": 0 }
  ]
}
```

完整 Context / 领域事件 / 回调 → [PLUGIN_KERNEL_V2.md](./PLUGIN_KERNEL_V2.md)。

### 3.3 字段说明

| 字段 | 说明 |
|------|------|
| `identifier` | 唯一 ID，安装目录名 |
| `available` | 安装后默认是否启用 |
| `apiVersion` | `"1"`（默认）或 `"2"` |
| `hooks` | 声明用；实际以导出函数 / `activate` 为准 |
| `modules` | `type`：`page` / `admin` / `cron`（`schedule`）/ `api` |
| `modules[].perm` | 权限码；进「用户权限 → 插件权限」并控制侧栏 |
| `modules[].adminOnly` | 仅管理员 |
| `vars` | 设置页可改配置；值一律字符串 |
| `vars[].type` | `text` / `number` / `boolean` / `textarea` / `select` |
| `clientJs` / `publicClientJs` | 登录后 / 登录页脚本 |
| `themeCss` | 全局 CSS |
| `capabilities` | v2：Context 能力门控 |
| `dbSchemaVersion` | v2：配合 `migrations/vN.sql` |

布尔 vars：`"1"` / `"0"`。  
权限码建议：`plugin.{identifier}.{name}`。

---

## 4. 服务端：`main.js` 与 PluginApi

### 4.1 导出方式

```js
// CommonJS
module.exports = {
  async register(api) { /* 注册自定义路由 */ },
  async devices_list(api, devices, ctx) { return devices },
  async api_before(api, payload, ctx) { return payload }
}

// 或 class
module.exports = class {
  async register(api) {}
  async devices_list(api, devices) { return devices }
}
```

钩子签名：`(api, value, ctx?) => nextValue | Promise`  
返回 `undefined` 表示不修改；返回新值则传给下一个插件。

### 4.2 PluginApi（钩子内可用）

| 方法 | 作用 |
|------|------|
| `api.identifier` / `api.version` | 插件身份 |
| `api.vars` / `getVar(key, fallback)` / `setVar(key, value)` | 读写配置 |
| `api.dataDir` | 可写数据目录 |
| `api.pluginDir` | 插件包目录（只读为主） |
| `api.log(...)` | 日志 |
| `api.readJson(rel, fallback)` / `writeJson(rel, data)` | 插件私有 JSON（MySQL 下进 `plugin_data`） |
| `api.db` | **MySQL**：建自有表、查询、写入（见下节） |
| `api.getSettings()` / `patchSettings(patch)` | 全局设置 |
| `api.getDevices()` / `saveDevices(list)` | 设备列表 |
| `api.getStatuses()` | 当前状态快照 |
| `api.controlDevice(id, payload)` | 下发控制 |
| `api.listFiles(id)` / `uploadFile` / `downloadFile` | 机内文件（Moonraker + 拓竹 LAN FTPS） |
| `api.startPrint(id, { filename, contentBase64? })` | 上传（可选）并开打 |
| `api.getDeviceCapabilities(id)` | 控制/文件/摄像头/G-code/Moonraker 透传能力探测 |
| `api.sendGcode(id, script)` | Moonraker 任意脚本 |
| `api.moonrakerRequest(id, { method, path, query?, body? })` | Moonraker HTTP 透传（宿主 ≥ 1.3.1） |
| `api.claimDevice` / `releaseDevice` / `getDeviceLock` | 跨插件设备锁（排程） |
| `api.snapshotCamera({ deviceId?, target?, cameraId? })` | 拉一帧 JPEG（base64） |
| `api.writeMedia(rel, data)` | 写入插件 `dataDir/media`（延时摄影归档） |
| `api.getPublicBaseUrl()` | 公网入口 URL（`publicBaseUrl` / domain / IP） |
| `api.getUserPluginData` / `patchUserPluginData` | 用户扩展字段（车间/多租户标签） |
| `api.notify({ title, content, kind?, deviceId? })` | 走告警通道 |
| `api.fetch` | 同全局 fetch |
| `api.registerRoute(method, pattern, handler)` | 自定义 HTTP |
| `api.findUser({ id / username })` | 查宿主用户 |
| `api.issueLoginToken(userId)` | **服务端直接签发**宿主 JWT（适合插件自定义回调接口） |
| `api.createLoginGrant(userId, { ttlSec? })` | 生成**一次性登录授权码**，供登录页插件换宿主 JWT |
| `api.createUser({ username, ... })` | 创建宿主本地用户 |

### 4.2.0 功能 → 原语矩阵（宿主 1.2+）

以下业务均可**只写插件**完成（协议细节由宿主桥接；用 `getDeviceCapabilities` 降级）：

| 目标功能 | 所需 capability / API | 说明 |
|----------|----------------------|------|
| 打印历史 / 统计 | `hooks` + `action:print.*` + `storage.json`/`db` | 事件含 filename、durationSec、filamentUsedGrams |
| 文件柜 + 远程开打 | `devices.files` + `devices.print` | Moonraker；拓竹需 LAN+访问码 |
| 空闲排程 / 自动接单 | `devices.lock` + `devices.print` + cron | claim 防抢机 |
| 维保寿命 | `hooks` print 事件 + 自存计数 | 无需新协议 |
| 延时摄影 | `camera.snapshot` + `media.write` + cron | 定时拉帧归档 |
| 多租户/车间 | `users.pluginData` + `filter:devices.list` | 标签写在用户 pluginData |
| 远程入口页 | `settings.publicUrl` | 读 `publicBaseUrl`；隧道仍用外部 frpc 等 |
| Klipper 宏/深控 | `devices.gcode` | 仅 Moonraker 类 |
| Moonraker 全量 API | `devices.moonraker` | `moonrakerRequest` / `POST …/moonraker`（宿主 ≥ 1.3.1） |
| 光固化 / 品牌差异 UI | `devices.capabilities` | 按 caps 显隐按钮 |
| HTTP 能力探测 | `GET /api/v1/devices/:id/capabilities` | 浏览器端同权 |

示例：`assets/examples/plugin-capability-kit/`。

### 4.2.0a 设备控制全量原语（宿主 ≥ 1.4.0）

主体详情页已按**权限 + capabilities**提供 jog / 仓温 / 挤出回抽 / 流量 / Z 偏移 / 重启 / 任意 G-code。插件仍可用同一套 `controlDevice` / HTTP。

#### 统一 `controlDevice` / `POST /api/v1/devices/:id/control`

| action | extras | Moonraker | 拓竹 | 其它厂 |
|--------|--------|-----------|------|--------|
| `pause` / `resume` / `cancel` | — | ✓ | ✓ | 多数 ✓ |
| `emergency_stop` | — | ✓ | ✓(=stop) | 视 caps |
| `home` | — | ✓ | ✓ | 视 caps |
| `jog` | `axis` X/Y/Z/E, `amount` mm | ✓ | ✓ | 视 caps |
| `set_temp` | `temperature`, `heater` extruder/bed | ✓ | ✓ | 视 caps |
| `set_fan` | `percent`, `fan` part/chamber, `fanName?` | ✓ | ✓ | 视 caps |
| `set_speed` | `percent` | ✓ | ✓ | 视 caps |
| `set_flow` | `percent` | ✓ | ✓ | ✗ |
| `set_z_offset` | `amount` ±2mm | ✓ | ✗ | ✗ |
| `set_chamber_temp` | `temperature` | ✓ | ✓ | ✗ |
| `extrude` / `retract` | `amount` 0.1–50, `temperature?` | ✓ | ✓ | ✗ |
| `restart` / `firmware_restart` | — | ✓ | ✗ | ✗ |
| `print_file` | `filename` | ✓ | LAN ✓ | 视 caps |
| `load_filament` / `unload_filament` | `temperature?`, `slot?` | ✓ | ✓ | 视 caps |

调用前务必 `getDeviceCapabilities(id)`，看 `control.*` / `gcode` / `moonrakerProxy`。

#### Moonraker 透传

```js
// v1
await api.moonrakerRequest(deviceId, {
  method: 'GET',
  path: '/printer/objects/query',
  query: { extruder: '', heater_bed: '' }
})

// v2
await ctx.devices.moonrakerRequest(deviceId, {
  method: 'POST',
  path: '/printer/gcode/script',
  query: { script: 'BED_MESH_CALIBRATE' }
})
```

HTTP（需登录 + `device.action.moonraker`）：

`POST /api/v1/devices/:id/moonraker`  
body: `{ "method": "GET"|"POST"|"DELETE", "path": "/…", "query"?: {}, "body"?: any }`

#### 任意 G-code HTTP

`POST /api/v1/devices/:id/gcode`（需 `device.action.gcode`；仅 Moonraker 类）  
body: `{ "script": "G28\\nM118 hi" }` 或 `{ "gcode": "…" }`

插件侧亦可 `devices.gcode` → `sendGcode(deviceId, script)`。

约束：仅 Moonraker 类设备（klipper / qidi / 创想局域网）；path 必须 `/` 开头、禁止 `..`；只转发到该设备已连接的 baseUrl。

`sendGcode` 适合短脚本；完整 Moonraker REST（文件元数据、对象查询、电源等）用 `moonrakerRequest`。

### 4.2.1 `api.db`（MySQL，推荐）

`USE_MYSQL=1` 时可用。插件**不能**新建 MySQL 库（DATABASE），但可在当前库内创建**自有表**并读写。

| 方法 | 说明 |
|------|------|
| `api.db.available` | 是否已接上 MySQL |
| `api.db.table('sessions')` | 物理表名，如 `plugin_qq_login_sessions` |
| `api.db.ensureTable('sessions', 'id VARCHAR(64) PRIMARY KEY, data JSON')` | 建表 |
| `api.db.dropTable('sessions')` | 删表 |
| **增** `api.db.insert('sessions', { id, data })` | 插入一行 |
| **查** `api.db.select('sessions', { where, limit, orderBy })` | 查多行 |
| **查** `api.db.getOne('sessions', { id })` | 查一行 |
| **查** `api.db.count('sessions', { status: 'ok' })` | 计数 |
| **改** `api.db.update('sessions', { data }, { id })` | 按条件更新 |
| **删** `api.db.remove('sessions', { id })` | 按条件删除 |
| `api.db.upsert('map', row, ['openid'])` | 有则改、无则增 |
| `api.db.query` / `api.db.execute` | 底层 SQL（高级） |

规则：

- 表名强制前缀 `plugin_{identifier}_`
- 禁止 `CREATE/DROP DATABASE`、改宿主核心表（users/devices…）
- `update` / `remove` **必须**带 `where`，防止误伤全表
- 一次一条 SQL；底层参数请用 `?` 占位

```js
// main.js — 增查改删示例
async function register(api) {
  if (!api.db.available) return
  await api.db.ensureTable(
    'openid_map',
    'openid VARCHAR(128) PRIMARY KEY, user_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL'
  )
}

async function bindOpenid(api, openid, userId) {
  // 增 / 改（upsert）
  await api.db.upsert(
    'openid_map',
    { openid, user_id: userId, created_at: new Date() },
    ['openid']
  )
  // 查
  const row = await api.db.getOne('openid_map', { openid })
  const list = await api.db.select('openid_map', { limit: 50, orderBy: 'created_at DESC' })
  // 改
  await api.db.update('openid_map', { user_id: userId }, { openid })
  // 删
  // await api.db.remove('openid_map', { openid })
  return { row, total: await api.db.count('openid_map') }
}

module.exports = { register }
```

建表会登记到宿主表 `extension_schema`，便于运维查看。

### 4.2.2 MySQL 部署与插件数据落库

`USE_MYSQL=1`（`npm start` 网页服务）时：

| 数据 | 存储 |
|------|------|
| 启用开关、vars、模块列表 | 表 **`plugins_state`** |
| `api.readJson` / `writeJson` | 表 **`plugin_data`**（`plugin_id` + `rel_path`） |
| `api.db.ensureTable` 自建表 | 物理名 `plugin_{identifier}_*`，登记 **`extension_schema`** |
| 包内 JS/CSS/HTML | 仍在磁盘 **`data/plugins/{id}/`**（代码资源，不是业务表） |

要点：

1. **制作**：按本手册打包 ZIP（`plugin.json` + `main.js` / `client.js`…）。
2. **安装**：软件设置 → **插件** → 上传 ZIP → 解压到 `data/plugins/{id}/`。
3. **状态**：启用 / vars 写入 `plugins_state`，**不要**只改本地 `plugins-state.json` 指望网页端生效。
4. **私有 JSON**：`api.writeJson('foo.json', obj)` → `plugin_data`；**不要**假定 `data/plugin-data/` 里一定有文件。
5. **自有表**：只用 `api.db.*`；**禁止** `CREATE DATABASE`；勿改宿主核心表（`users` / `devices` / `app_settings`…）。
6. **卸载**：删包目录并更新 `plugins_state`；建议在 `uninstall.js` 里 `dropTable` / 清理自己的 `plugin_data` 键。

环境变量与全站表清单、从旧 JSON 导入：见 [NODE_DEPLOY.md](./NODE_DEPLOY.md)。主题包落库见 [THEME.md](./THEME.md) §3。

### 4.3 自定义路由（推荐）

在 `register` 钩子中注册。**不要**挂在 `/api/v1/plugins/...` 保留路径下做业务 API（管理接口占用）；业务接口用独立路径，例如：

```js
async register(api) {
  api.registerRoute('GET', '/api/v1/chamber-temp/temps', async (req, api) => {
    const devices = api.getDevices()
    const statuses = api.getStatuses()
    return {
      ok: true,
      rows: devices.map((d) => ({
        id: d.id,
        name: d.name,
        chamberTemp: statuses[d.id]?.chamberTemp ?? null
      })),
      warnCelsius: Number(api.getVar('warn_celsius', '45'))
    }
  })
}
```

成功响应会被包装为 `{ ok: true, data: ... }`（以实际 `pluginApi` 行为为准）。前端用 JWT 调用即可。

### 4.4 请求上下文 `ctx`

常见字段：`method`、`path`、`url`、`query`、`headers`、`auth`（`user` / `apiKey` / `local` 等）。

### 4.5 插件完成第三方授权后，换宿主 JWT

这是给 **登录页插件 / OAuth / 企业微信扫码 / 自定义 SSO** 用的标准宿主流程。

#### 方案 A：推荐，走一次性授权码

1. 插件服务端（`main.js` 的 `registerRoute(..., { public: true })`）先完成第三方授权校验  
2. 校验通过后，用 `api.findUser` / `api.createUser` 找到或创建宿主用户  
3. 调 `api.createLoginGrant(user.id, { ttlSec })` 生成一次性 `grantToken`  
4. 浏览器登录页插件拿到 `grantToken` 后，请求：

```http
POST /api/v1/auth/plugin-login/exchange
Content-Type: application/json

{ "grantToken": "..." }
```

5. 宿主返回正常登录态：`token`、`user`、`permissions`、`deviceAcl`

也可以直接在登录页脚本里调用浏览器 SDK：

```js
const login = await HanyePlugin.exchangeLoginGrant(grantToken)
if (!login.ok) throw new Error(login.message || '登录失败')
```

返回成功后会自动写入宿主登录态并进入正常页面。

#### 方案 B：服务端直接签发 JWT

若你的插件自定义回调本身就由插件服务端处理，也可直接：

```js
const { token, user } = api.issueLoginToken(user.id)
return { ok: true, token, user }
```

这种方式适合插件自己的后端回调链路；但对于 **登录页 `login.js`**，仍推荐方案 A，因为它把“第三方校验”和“宿主会话落地”分成两步，更清晰，也更容易复用宿主现有登录页状态流转。

#### 最小示例

```js
// main.js
async register(api) {
  api.registerRoute(
    'POST',
    '/api/v1/my-oauth/callback',
    async (req) => {
      const body = req.body || {}
      const externalId = String(body.externalId || '').trim()
      if (!externalId) throw new Error('缺少 externalId')

      let user = api.findUser({ username: 'sso_' + externalId })
      if (!user) {
        user = await api.createUser({
          username: 'sso_' + externalId,
          displayName: 'SSO 用户 ' + externalId,
          level: 'viewer'
        })
      }
      return {
        ok: true,
        ...api.createLoginGrant(user.id, { ttlSec: 120 })
      }
    },
    { public: true }
  )
}
```

```js
// login.js
const res = await fetch('/api/v1/my-oauth/callback', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ externalId: 'abc123' })
})
const data = await res.json()
await HanyePlugin.exchangeLoginGrant(data.grantToken)
```

---

## 5. 服务端钩子一览

按执行场景分类。未列出的名字也可导出，但只有下表会由宿主调用。

### 5.1 通用 API 管线

| 钩子 | 时机 | 入参 / 返回 |
|------|------|-------------|
| `common` | 每个已认证请求入口 | `(api, null, ctx)`，返回值忽略 |
| `api_before` | 业务处理前 | `{ proceed, method, path }` → 可设 `proceed:false` + `status`/`body` 短路 |
| `api_after` | `sendJson` 时 | `{ status, body, method, path }` → 可改 `status`/`body`（同步返回立即生效；异步仅副作用） |
| `register` | 插件加载时 | 用于 `registerRoute` |

### 5.2 登录 / 用户 / 权限

| 钩子 | 时机 | 说明 |
|------|------|------|
| `login_before` | 登录校验前 | 可改 `username`/`password`，或 `proceed:false` 拒绝 |
| `login_after` | 登录成功后 | 可改返回的 me/token 载荷 |
| `auth_me` | `/me` 与登录 me 组装后 | 扩展用户信息、权限之外字段 |
| `permissions_effective` | 生效权限列表（登录 /me） | `(api, perms[], ctx)` → 新权限数组；可运行时强制加减权限 |
| `permissions_catalog` | **用户管理勾选目录** | `(api, defs[])` → 追加 `{ code, label, plugin?, description? }`；与模块 `perm` 合并后出现在「插件权限」 |
| `users_list` | `GET /api/v1/users` | 可过滤/ enrich 用户列表 |
| `user_create` / `user_update` / `user_delete` | 用户 CRUD 前 | `{ proceed, body? }` / `{ proceed, id }`；可改写 body 或拦截 |

#### `permissions_catalog` 示例

```js
// main.js
async permissions_catalog(api, list) {
  const rows = Array.isArray(list) ? list.slice() : []
  // 模块上写了 perm 的项已由宿主预先放入 list，此处可追加「非导航」能力码
  if (!rows.some((r) => r && r.code === 'plugin.myplug.export')) {
    rows.push({
      code: 'plugin.myplug.export',
      label: '允许导出报表',
      plugin: 'myplug',
      description: '业务 API 内自行校验'
    })
  }
  return rows
}
```

勾选后码写入该用户的 `permissions[]`；前端可用 auth store 的 `can(code)`，服务端自定义路由里读 `ctx.auth` 校验。完整说明见 **§8.2**。

### 5.3 设备 / 状态 / 控制

| 钩子 | 时机 | 说明 |
|------|------|------|
| `devices_list` | `GET /api/v1/devices` | 改名称、过滤、附加字段 |
| `device_create` / `device_update` / `device_delete` | 设备增改删前 | `{ proceed, device/patch/deviceId }` |
| `devices_save` | 整表保存滤镜（`api.saveDevices` / `ctx.devices.save`） | devices[] |
| `statuses_publish` | SSE/Webhook 广播前 | 改状态 map |
| `control_before` | 控制指令前 | 可拦截 `proceed:false` |
| `control_after` | 控制结果后 | 可改返回结果 |

### 5.3.1 耗材

| 钩子 | 时机 | 说明 |
|------|------|------|
| `filament_list` | `GET /api/v1/filament` | `{ spools }` → 可过滤/改写列表 |
| `filament_create` | POST 入库前 | `{ proceed, spool }` |
| `filament_update` | PUT/PATCH 前 | `{ proceed, spoolId, spool, prev }` |
| `filament_delete` | DELETE 前 | `{ proceed, spoolId, spool }` |

### 5.3.2 常用工具 / 报价

| 钩子 | 时机 | 说明 |
|------|------|------|
| `quote_presets` | GET 预设 | 可追加 materials/printers |
| `quote_calculate` | POST 计算 | 前：`{ proceed, body }`；后：`{ ok, options/costs }`（`ctx.phase==='after'`） |
| `quote_parse_gcode` | 解析 G-code | `{ proceed, text }`，可直接返回 `result` |
| `quote_history_list` / `create` / `delete` | 报价记录 | 列表改写 / 入库拦截 / 删除拦截 |
| `quote_schemes_list` / `save` / `delete` | 计算方案 | 列表改写 / 保存拦截 / 删除拦截 |

### 5.3.3 内部监控 / 区域监控

| 钩子 | 时机 | 说明 |
|------|------|------|
| `monitor_wall` | GET 摄像头墙 | `{ devices }` → 可改写列表 |
| `monitor_zones_list` | GET 区域列表 | `{ zones }` |
| `monitor_zone_create` / `update` / `delete` | 区域 CRUD | `{ proceed, … }` |
| `monitor_camera_create` / `update` / `delete` | 区域摄像头 CRUD | `{ proceed, … }` |
| `monitor_camera_snapshot` | 区域摄像头取帧 | 入参 `{ handled:false, zone, camera }`；返回 `handled:true` + `{ ok, base64, contentType }`，或改写 `url` 再由宿主拉取 |

### 5.3.4 打印审核 / 队列

| 钩子 | 时机 | 说明 |
|------|------|------|
| `print_request_list` | GET 打印申请列表 | 可过滤 / enrich |
| `print_request_create` | POST 提交申请前 | `{ proceed, body }` |
| `print_approve` / `print_reject` / `print_start` / `print_cancel` | 审核 / 开打 / 取消前 | `{ proceed, id, body? }` |

### 5.4 设置 / 告警 / AI

| 钩子 | 时机 | 说明 |
|------|------|------|
| `settings_get` | `GET /api/v1/settings` | 改对外 settings 载荷 |
| `settings_patch` | `PATCH` 前 | 可改 `patch` 或拦截 |
| `alert_notify` | 告警真正发送前 | `{ proceed, payload }`，可改文案或取消 |
| `ai_settings_get` | AI vision status | 改状态载荷 |
| `ai_vision_before` / `ai_vision_after` | YOLO 测试 / 立即巡检 | 拦截或改结果 |

### 5.5 UI 资产（服务端拼装，前端加载）

| 钩子 | 说明 |
|------|------|
| `ui_assets` | 合并 CSS/JS/`htmlHeader`/`htmlFooter`/slots/theme/hideNavKeys |
| `ui_slots` | 再改一次 slots 等 |
| `theme_resolve` | 改 theme 键值（给前端 `patchTheme`） |
| `ui_nav` | 改插件模块导航项列表 |

---

## 6. UI 嵌入点（PluginSlot）

> 主题 `siteMode: full` 时，壳层由主题 HTML 提供；插件槽位仍挂在岛内 React 树上（`nav`/`main`/`login-form` 等），写法不变。见 [THEME.md §8](./THEME.md#8-full整站骨架与挂载点)。

宿主用 `<PluginSlot name="..." replace? context? />`。插件两种注入：

1. **文件**：`slots/{槽位名}.html`（登录相关槽位会出现在 public-ui）
2. **脚本**：`HanyePlugin.registerSlot(name, html | fn, { order, plugin })`

### 6.1 `*.replace` 规则

对基名 `foo`，若存在 `foo.replace` 的注册内容，且槽位组件开了 `replace`，则**隐藏 children，只显示插件内容**。

示例：`login.page` + `login.page.replace`、`users.page` + `users.page.replace`、`device.grid` + `device.grid.replace`。

### 6.2 带 `context` 的卡片 / 详情槽位

设备卡片、详情抽屉会传入实时数据，例如：

```js
HanyePlugin.registerSlot('device.card.temps', (el, ctx) => {
  const c = (ctx && ctx.context) || {}
  const t = c.chamberTemp
  el.innerHTML =
    '<div class="temp-pill">仓内 <strong>' +
    (t == null ? '--' : Math.round(Number(t)) + '°') +
    '</strong></div>'
}, { order: 0, plugin: 'chamber_temp' })
```

常见 `context` 字段：`deviceId`、`deviceName`、`brand`、`chamberTemp`、`boardTemp`、`health`、`state`、`tech`。

渲染函数可返回 **cleanup** `() => void`，在槽位重绘时调用。

### 6.3 槽位全表

#### 登录

| 槽位 | 说明 |
|------|------|
| `login.page` / `.replace` | 整页 |
| `login.header` | 标题区上 |
| `login.form` / `.replace` | 表单本体（含 SSO Tab） |
| `login.form.before` / `after` | 表单前后 |
| `login.sso.before` / `after` | SSO 区域 |
| `login.footer` | 页脚 |

#### 壳层

| 槽位 | 说明 |
|------|------|
| `app.shell` / `.replace` | 整站外壳 |
| `app.header.before` / `after` | 顶栏 |
| `app.header.brand` | 品牌标题区 |
| `app.header.actions` | 顶栏按钮区 |
| `app.nav` / `.replace` / `before` / `after` | 导航 |
| `app.main.before` / `after` | 主内容区 |
| `app.footer` / `.replace` / `before` / `after` | 底栏 |

#### 业务页

| 槽位 | 说明 |
|------|------|
| `device.grid` / `.replace` / `before` / `after` | 设备列表 |
| `device.batch.before` / `after` | 勾选后批量操作栏外 |
| `device.batch.actions` / `status` | 批量栏按钮旁 / 状态区 |
| `device.card.after-name` / `temps` / `extra` / `footer` | 单卡 |
| `device.add` / `.replace` | 添加设备整表 |
| `device.add.before` / `after` | 添加设备表单首尾 |
| `device.add.scan.after` | 局域网扫描区后 |
| `device.add.brand.after` | 品牌选择后 |
| `device.add.form` / `fields` / `footer` | 品牌表单 / 附加字段 / 底栏 |
| `device.detail` / `.replace` / `before` / `after` | 详情抽屉 |
| `device.detail.camera.after` | 摄像头后 |
| `device.detail.control.before` | 控制按钮前 |
| `device.detail.footer` | 详情底 |
| `filament.page` / `.replace` / `before` / `after` | 耗材整页 |
| `filament.toolbar.*` / `filters.after` / `list.*` | 工具栏、筛选、列表 |
| `filament.form.*` / `.replace` | 添加/编辑弹窗 |
| `monitor.page` / `.replace` / `before` / `after` | 内部监控整页 |
| `monitor.header.*` / `alerts.after` / `grid.*` | 标题、告警、网格 |
| `monitor.tile.before` / `after` / `footer` | 单路画面 |
| `monitor.zones` / `.replace` / `before` / `after` | 区域监控整页 |
| `monitor.zones.header.*` / `toolbar.after` / `grid.*` | 区域标题与网格 |
| `monitor.zones.form.camera.*` | 添加摄像头表单 |
| `tools.page` / `.replace` / `before` / `after` | 常用工具整页 |
| `tools.header.*` / `params.*` / `gcode.after` | 标题、共用参数、G-code |
| `tools.options.*` / `option.extra` | 耗材方案区 |
| `tools.result.*` / `actions.*` | 对比结果与导出按钮区 |
| `quote.history` / `.replace` / `before` / `after` | 报价记录整页 |
| `quote.history.header.*` / `toolbar.*` / `filters.after` | 标题、工具栏、筛选 |
| `quote.history.list.*` | 列表前后 |
| `quote.history.detail.*` / `.replace` | 详情弹窗 |
| `print.approve` / `.replace` / `before` / `after` | 打印审核整页 |
| `print.approve.toolbar.*` / `filters.after` | 标题栏 / 筛选 |
| `print.approve.pending|queued|history.*` | 各 Tab 表格前后 |
| `print.approve.row.actions` | 行操作旁 |
| `models.page.before` / `aiModels.page.before` | 模型站 |
| `users.page` / `.replace` / `before` / `after` | 用户页外壳 |
| `users.toolbar.before` / `after` | 标题工具栏 |
| `users.list.before` / `after` | 用户表格前后 |
| `users.form` / `.replace` / `before` / `fields` / `footer` / `after` | 新建/编辑弹窗 |
| `users.row.actions` | 行操作按钮旁 |
| `settings.page` / `.replace` / `before` / `after` | 软件设置 |
| `settings.tabs.before` / `after` | Tab 条外 |
| `settings.tab.general|enterprise|ai|alerts|plugins|themes|about.before/after` | 各内置 Tab 内 |

自定义名字也可注册；需宿主已挂对应 `PluginSlot` 才会显示。

---

## 7. 浏览器 SDK：`window.HanyePlugin`

登录后由 `PluginLoader` 注入；登录页同样可用（`mode: 'public'`）。

### 7.1 槽位

```js
const id = HanyePlugin.registerSlot('app.main.before', (el, ctx) => {
  el.textContent = 'Hello ' + ((ctx.user && ctx.user.username) || '')
  return () => { /* cleanup */ }
}, { order: 10, plugin: 'demo' })

HanyePlugin.unregisterSlot('app.main.before', id)
HanyePlugin.emit('slot:change', { name: 'app.main.before' }) // 强制刷新
```

### 7.2 导航 / 权限 / 主题

```js
HanyePlugin.hideNavKeys(['models', 'aiModels'])
HanyePlugin.patchNav((items) =>
  items.concat([{ key: 'plugin:demo:page', label: '演示', identifier: 'demo', module: 'page', order: 50 }])
)

HanyePlugin.patchPermissions((perms, user) => perms.concat(['nav.tools']))
HanyePlugin.patchTheme({ uiTheme: 'ocean' })
```

说明：`patchPermissions` / 服务端 `permissions_effective` 是**运行时改生效列表**；要让管理员在 **用户权限** 页能勾选插件码，请用模块 `perm` 或钩子 `permissions_catalog`（见 §8.2）。

内置导航 key 示例：`fdm`、`resin`、`filament`、`tools`、`monitor`、`users`、`settings`、`models`、`aiModels` 等（以侧栏实现为准）。

### 7.3 添加设备扩展（完整说明）

在 **添加 FDM / 光固化设备** 弹窗中，插件可新增品牌、连接方式、表单字段与 UI 区块。请在登录后加载的 `client.js` 中注册（每次 `PluginLoader` 会先 `reset` 再执行脚本）。

事件：`add-device:change`（品牌/字段注册列表变化时触发）。

---

#### 7.3.1 能力总览

| 能力 | API | 作用 |
|------|-----|------|
| 自定义品牌 | `registerAddDeviceBrand(def)` | 品牌单选项 + 可选连接方式 + 表单 + 保存 |
| 附加字段 | `registerAddDeviceField(def)` | 对内置或插件品牌追加表单项，保存前 `collect` 合并进设备 |
| UI 槽位 | `registerSlot('device.add…')` | 在弹窗固定位置插入 HTML/DOM（见下表） |
| 服务端拦截 | `device_create` 钩子 | 创建前改写/拒绝设备 JSON |

查询：`getAddDeviceBrands(tech?)`、`getAddDeviceBrand(id)`、`getAddDeviceFields({ tech, brand })`。

---

#### 7.3.2 UI 槽位（`device.add.*`）

| 槽位 | 位置 |
|------|------|
| `device.add` / `device.add.replace` | 整段弹窗表单（`replace` 可替换内置内容） |
| `device.add.before` | 表单最前（工作区说明之上） |
| `device.add.scan.after` | 「扫描局域网」区域之后 |
| `device.add.brand.after` | 品牌单选之后 |
| `device.add.form` | 品牌相关表单区（`context` 含 `tech` / `brand` / `connectionMode`） |
| `device.add.fields` | 附加字段区（与 `registerAddDeviceField` 相邻） |
| `device.add.footer` | 分组/标签字段之后 |
| `device.add.after` | 表单最末 |

```js
HanyePlugin.registerSlot(
  'device.add.form',
  (el, ctx) => {
    const c = (ctx && ctx.context) || {}
    el.innerHTML = '<div style="opacity:.7">插件提示：当前品牌 ' + (c.brand || '') + '</div>'
  },
  { order: 10, plugin: 'my_plugin' }
)
```

---

#### 7.3.3 `registerAddDeviceBrand` 字段

```js
HanyePlugin.registerAddDeviceBrand({
  id: 'my_vendor',
  label: '我的品牌',
  tech: 'fdm',
  order: 90,
  plugin: 'my_plugin',
  connections: [
    {
      id: 'lan',
      label: '局域网',
      default: true,
      render(el, ctx) {
        el.innerHTML = '<label>打印机地址</label><input class="ant-input" data-host style="width:100%" />'
        const input = el.querySelector('[data-host]')
        input.value = String(ctx.getFieldValue('host') || '')
        input.onchange = () => ctx.setFieldsValue({ host: input.value })
      }
    },
    { id: 'cloud', label: '云端' }
  ],
  renderForm(el, ctx) {
    el.insertAdjacentHTML(
      'beforeend',
      '<p style="font-size:12px;opacity:.7">连接方式：' + (ctx.connectionMode || '') + '</p>'
    )
  },
  async submit(ctx) {
    const v = await ctx.validateFields(['name'])
    return {
      device: {
        id: ctx.newId(),
        name: String(v.name || ''),
        brand: 'my_vendor',
        tech: ctx.tech,
        connectionMode: ctx.connectionMode || 'lan',
        baseUrl: String(ctx.getFieldValue('host') || '') || undefined,
        pluginData: { vendor: 'my_vendor', ver: 1 },
        x_custom_flag: true,
        createdAt: new Date().toISOString()
      },
      secret: String(ctx.getFieldValue('apiKey') || '') || undefined
    }
  }
})
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 品牌码，写入设备 `brand`；仅小写 `a-z0-9_`（非法字符会规范化） |
| `label` | 是 | 单选项文案；设备卡片品牌角标也会优先显示此名 |
| `tech` | 否 | `'fdm'` \| `'resin'` \| `'both'`，默认 `both` |
| `order` | 否 | 排序，默认 `100`（排在多数内置品牌后） |
| `plugin` | 否 | 来源插件 id，便于排查 |
| `connections` | 否 | 有则显示「连接方式」单选；选中值写入 Form `connectionMode` |
| `connections[].id` | 是 | 连接方式码 |
| `connections[].label` | 是 | 显示名 |
| `connections[].default` | 否 | 切换到该品牌时的默认连接 |
| `connections[].render` | 否 | `(el, ctx) => cleanup?`，仅当前连接被选中时渲染 |
| `renderForm` | 否 | `(el, ctx) => cleanup?`，选中该品牌时渲染（连接专用 UI 之外） |
| `submit` | **保存必填** | `async (ctx) => { device, secret? }`；未实现则无法添加该品牌设备 |

`render` / `renderForm` 可返回 cleanup 函数，宿主在卸载时调用。

---

#### 7.3.4 表单上下文 `ctx`（`AddDeviceFormCtx`）

| 成员 | 类型 | 说明 |
|------|------|------|
| `tech` | `'fdm'` \| `'resin'` | 当前工作区 |
| `brand` | string | 当前品牌 id |
| `connectionMode` | string? | 当前连接方式 |
| `getFieldValue(name)` | fn | 读 Ant Design Form 字段 |
| `getFieldsValue()` | fn | 读全部字段 |
| `setFieldsValue(obj)` | fn | 写字段；**自定义 input 务必在 change 时同步**，否则 `submit`/`collect` 读不到 |
| `validateFields(names?)` | async fn | 校验；失败抛出 Ant Design 校验错误 |
| `newId()` | fn | 生成设备 UUID |

---

#### 7.3.5 `registerAddDeviceField`（附加字段）

不替换品牌流程，在表单后部追加区块；**内置品牌与插件品牌**保存前都会走 `collect`。

```js
HanyePlugin.registerAddDeviceField({
  id: 'rack_slot',
  brands: '*',                 // '*' / 省略 = 全部；或 ['klipper','bambu','my_vendor']
  tech: 'both',
  order: 50,
  plugin: 'my_plugin',
  render(el, ctx) {
    el.innerHTML =
      '<label>机架位</label><input class="ant-input" data-rack style="width:100%;margin-top:4px" />'
    const input = el.querySelector('[data-rack]')
    input.value = String(ctx.getFieldValue('rack') || '')
    input.onchange = () => ctx.setFieldsValue({ rack: input.value })
  },
  collect(ctx, device) {
    const rack = String(ctx.getFieldValue('rack') || '').trim()
    if (!rack) return device
    device.pluginData = Object.assign({}, device.pluginData || {}, { rack })
    return device
  }
})
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一键，重复注册会覆盖 |
| `render` | 是 | 画 UI |
| `collect` | 否 | `(ctx, device) => device`，合并进即将保存的对象 |
| `brands` | 否 | `'*'` 或品牌 id 数组 |
| `tech` | 否 | `'fdm'` \| `'resin'` \| `'both'` |

---

#### 7.3.6 保存与持久化规则

**插件品牌保存顺序**

1. 用户点「添加」  
2. 调用该品牌 `submit(ctx)`  
3. 对返回的 `device` 执行所有匹配的 `registerAddDeviceField.collect`  
4. `POST /api/v1/devices`（或本地等价写入）  
5. 服务端钩子 `device_create` 仍可改写/拦截  

**内置品牌**：走原有探测/登录逻辑后，同样会经过 `collect`，再入库。

**服务端品牌与字段**

- 品牌 id：内置集合，**或** 匹配 `^[a-z][a-z0-9_]{0,63}$` 的插件品牌  
- 自动保留：`pluginData`（对象）  
- 额外键：名称以 `x_` 或 `plugin_` 开头的字段会原样写入设备 JSON  
- 密钥：`submit` 返回的 `secret`，或 device 上的 `apiKey` / `accessCode` / `secret`，会进入加密存储  

**设备对象建议字段**

| 字段 | 说明 |
|------|------|
| `id` / `name` / `brand` / `tech` | 必填语义 |
| `connectionMode` | 连接方式 |
| `baseUrl` / `bambuHost` 等 | 按协议需要 |
| `pluginData` | 推荐放结构化扩展数据 |
| `x_*` / `plugin_*` | 扁平扩展字段 |
| `createdAt` | ISO 时间；可省略由宿主补 |

卡片 / 详情要展示扩展数据：用 `device.card.*` / `device.detail.*` 槽位读 `context`，或自行请求设备列表后用 `pluginData`。

---

#### 7.3.7 与服务端钩子配合

```js
// main.js
async device_create(api, payload) {
  const device = payload && payload.device
  if (device && device.brand === 'my_vendor') {
    // 校验、补默认值、拒绝创建等
    if (!device.baseUrl) {
      return { proceed: false, status: 400, body: { ok: false, message: '缺少地址' } }
    }
  }
  return payload
}
```

也可 `registerRoute` 提供探测/OAuth 接口，在 `renderForm` 里 `fetch` 调用。

---

#### 7.3.8 完整示例与注意点

- 可运行示例：`assets/examples/plugin-sample/client.js`（品牌 `demo_vendor` + 全品牌备注字段）  
- 自定义 DOM 必须 `setFieldsValue`，不要只改 input.value  
- 同一 `id` 重复 `registerAddDeviceBrand` / `Field` 会覆盖旧定义  
- 插件禁用后脚本不再加载，自定义品牌按钮消失；已入库设备仍保留原 `brand` / `pluginData`  
- 实时状态 / 控制需另接适配器或自定义路由；本 API 只管「添加与落库」

### 7.4 软件设置自定义 Tab（插件设置页）

无需改 React 源码即可增加设置导航；可用 **`after` / `before` / `order`** 插入到任意位置：

内置导航锚点（`order`）：

| key | 导航 | order |
|-----|------|-------|
| `general` | 设置 | 100 |
| `enterprise` | 企业软件对接 | 200 |
| `ai` | AI 对接 | 300 |
| `alerts` | 异常对接 | 400 |
| `themes` | 主题 | 500 |
| `plugins` | 插件 | 600 |
| `about` | 说明 | 10000 |

```js
// 插在「设置」后面（企业对接前面）
HanyePlugin.registerSettingsTab({
  key: 'my_vendor',
  label: '厂家对接',
  after: 'general',
  order: 10, // → sort = 100 + 10 = 110
  adminOnly: true,
  render(el) {
    el.innerHTML = '<div class="settings-tab-panel"><h3>厂家配置</h3></div>'
  }
})

// 插在「企业软件对接」前面
HanyePlugin.registerSettingsTab({
  key: 'hr_bridge',
  label: '人事同步',
  before: 'enterprise',
  order: 5 // → sort = 200 - 5 = 195
})

// 或直接用绝对 order（150 = 设置与企业对接之间）
HanyePlugin.registerSettingsTab({
  key: 'mid',
  label: '中间页',
  order: 150
})
```

不写 `after`/`before` 时，默认出现在「插件」与「说明」之间。  
槽位：`settings.tab.general|enterprise|ai|alerts|themes|plugins|about.before/after`。

### 7.5 事件

| 事件 | 含义 |
|------|------|
| `ready` | 资源与脚本加载完成 `{ mode }` |
| `slot:change` | 槽位变更 `{ name }` |
| `nav:change` | 导航补丁变更 |
| `permissions:change` | 权限补丁变更（会写回 auth store） |
| `theme:change` | 主题补丁 |
| `settings-tabs:change` | 自定义设置 Tab 列表变更 |
| `add-device:change` | 添加设备品牌/字段注册表变更 |
| `batch:change` | 批量栏动作/状态注册表变更 |
| `filament:change` | 耗材品牌/材质/字段/列/动作注册表变更 |
| `quote:change` | 报价预设/字段/列/动作/成本改写注册表变更 |
| `quote-history:change` | 报价记录列/筛选/动作注册表变更 |
| `monitor:change` | 监控工具栏/画面动作/滤镜注册表变更 |
| `users:change` | 用户页列/工具栏/表单/权限组注册表变更 |
| `print:change` | 打印审核列/工具栏/行操作/过滤注册表变更 |

```js
HanyePlugin.on('ready', () => { /* … */ })
```

### 7.5.1 登录页插件：换宿主登录态

`login.js` / `publicClientJs` 里可直接调用：

```js
const result = await HanyePlugin.exchangeLoginGrant(grantToken)
if (!result.ok) {
  throw new Error(result.message || '登录失败')
}
```

说明：

- 默认会自动把返回的 `token` 写入宿主登录态
- 可选：`HanyePlugin.exchangeLoginGrant(grantToken, { applySession: false })`
- 它内部调用宿主公开接口 `POST /api/v1/auth/plugin-login/exchange`

### 7.6 文档头尾 HTML

服务端 `ui_assets` 可返回 `htmlHeader` / `htmlFooter`，由 `PluginLoader` 注入到 `document.body`。

### 7.7 批量操作栏与插件状态（勾选设备后）

设备列表上方的 **批量操作栏**（已选 N 台 · 暂停/继续/停止/导入）支持插件扩展。

#### 7.7.1 注册批量按钮

```js
HanyePlugin.registerBatchAction({
  id: 'demo_ping',
  label: '插件批量动作',
  tech: 'both',              // fdm | resin | both
  order: 50,
  requireChecked: true,      // 默认 true：无勾选则禁用
  // danger: true,
  // disabled: (ctx) => ctx.checkedIds.length > 10,
  async run(ctx) {
    // ctx.checkedIds / ctx.devices / ctx.statuses / ctx.tech
    // ctx.batchControl(ids, 'pause'|'resume'|'cancel')
    // ctx.clearChecked() / ctx.setCheckedIds(ids)
    alert('已选 ' + ctx.checkedIds.length + ' 台')
  }
})
```

| 字段 | 说明 |
|------|------|
| `id` / `label` | 按钮标识与文案 |
| `run(ctx)` | 点击回调（可 async） |
| `requireChecked` | 默认需有勾选 |
| `disabled(ctx)` | 额外禁用条件 |
| `danger` | 红色危险按钮样式 |

#### 7.7.2 注册状态显示

在「已选 N 台」旁渲染插件状态（随勾选/实时状态刷新）：

```js
HanyePlugin.registerBatchStatus({
  id: 'demo_sel_status',
  tech: 'both',
  order: 10,
  render(el, ctx) {
    const online = ctx.checkedIds.filter((id) => {
      const st = ctx.statuses[id]
      return st && st.health === 'online'
    }).length
    el.innerHTML =
      '<span style="font-size:12px;opacity:.8">插件状态：在线 ' +
      online +
      ' / 已选 ' +
      ctx.checkedIds.length +
      '</span>'
  }
})
```

#### 7.7.3 UI 槽位

| 槽位 | 位置 |
|------|------|
| `device.batch.before` / `after` | 整栏前后 |
| `device.batch.status` | 状态区（与 `registerBatchStatus` 相邻） |
| `device.batch.actions` | 内置按钮与插件按钮之间 |

`context`：`tech`、`checkedIds`、`checkedCount`、`busy`。

事件：`batch:change`。查询：`getBatchActions(tech)`、`getBatchStatuses(tech)`。

### 7.8 耗材管理扩展（列表 + 添加/编辑）

耗材页（FDM / 树脂料卷）支持插件深度扩展：自定义品牌/材质、表单字段、表格列、行/工具栏动作，以及服务端 CRUD 钩子。

#### 7.8.1 能力总览

| API | 作用 |
|-----|------|
| `registerFilamentBrand` | 品牌筛选与表单下拉增加品牌 |
| `registerFilamentMaterial` | 材质下拉增加材质 |
| `registerFilamentField` | 添加/编辑弹窗附加字段（`collect` 写入 `pluginData` / `x_*`） |
| `registerFilamentColumn` | 列表增加列 |
| `registerFilamentRowAction` | 行操作区增加按钮 |
| `registerFilamentToolbarAction` | Tabs 旁工具栏按钮 |
| 槽位 `filament.*` | 工具栏 / 筛选 / 列表 / 表单插入点 |
| 钩子 `filament_list/create/update/delete` | 服务端拦截与改写 |

#### 7.8.2 UI 槽位

| 槽位 | 位置 |
|------|------|
| `filament.page` / `.replace` / `before` / `after` | 整页（App 壳） |
| `filament.toolbar.before` / `after` | FDM/树脂 Tabs 前后 |
| `filament.filters.after` | 品牌/材质筛选后 |
| `filament.list.before` / `after` | 表格前后 |
| `filament.form` / `.replace` | 整表单可替换 |
| `filament.form.before` / `after` / `fields` / `footer` | 表单内插入 |

`context`：`tech`、`mode`（`create`\|`edit`）、`spoolId`。

#### 7.8.3 注册示例

```js
HanyePlugin.registerFilamentBrand({
  id: 'demo_filament_brand',
  name: '演示线材品牌',
  kind: 'fdm',
  popular: true
})

HanyePlugin.registerFilamentMaterial({
  id: 'demo_cf',
  label: '演示 CF 料',
  category: 'fdm'
})

HanyePlugin.registerFilamentField({
  id: 'batch_no',
  tech: 'both',
  mode: 'both',
  order: 20,
  render(el, ctx) {
    el.innerHTML =
      '<label style="display:block;margin-bottom:4px">批次号</label>' +
      '<input class="ant-input" data-batch style="width:100%" />'
    const input = el.querySelector('[data-batch]')
    input.value = String(ctx.getFieldValue('batchNo') || '')
    input.onchange = () => ctx.setFieldsValue({ batchNo: input.value })
  },
  collect(ctx, spool) {
    const batchNo = String(ctx.getFieldValue('batchNo') || '').trim()
    spool.pluginData = Object.assign({}, spool.pluginData || {}, { batchNo })
    spool.x_batch_no = batchNo || undefined
    return spool
  }
})

HanyePlugin.registerFilamentColumn({
  id: 'batch',
  title: '批次',
  width: 100,
  render(spool) {
    const pd = spool.pluginData || {}
    return String(pd.batchNo || spool.x_batch_no || '—')
  }
})

HanyePlugin.registerFilamentRowAction({
  id: 'copy_id',
  label: '复制 ID',
  run({ spool }) {
    navigator.clipboard?.writeText(String(spool.id || ''))
  }
})

HanyePlugin.registerFilamentToolbarAction({
  id: 'export_hint',
  label: '插件导出',
  run({ tech }) {
    alert('当前分区：' + tech)
  }
})
```

#### 7.8.4 持久化

料卷 JSON 会保存：

- `pluginData` 对象
- 任意 `x_*` / `plugin_*` 字段

编辑时宿主会保留既有 extras，再与 `collect` 合并。

#### 7.8.5 服务端钩子

| 钩子 | 时机 | 载荷 |
|------|------|------|
| `filament_list` | GET 列表后 | `{ spools }` → 可改 `spools` |
| `filament_create` | POST 入库前 | `{ proceed, spool }`，`proceed:false` 拦截 |
| `filament_update` | PUT/PATCH 前 | `{ proceed, spoolId, spool, prev }` |
| `filament_delete` | DELETE 前 | `{ proceed, spoolId, spool }` |

事件：`filament:change`。查询：`getFilamentBrands` / `Materials` / `Fields` / `Columns` / `RowActions` / `ToolbarActions`。

### 7.9 常用工具 / 代打报价扩展

「常用工具」页（价格计算器）与「报价记录」支持页内插件扩展。

#### 7.9.1 能力总览

| API | 作用 |
|-----|------|
| `registerQuoteMaterialPreset` | 材料类型下拉追加预设 |
| `registerQuotePrinterPreset` | 打印机功率预设 |
| `registerQuoteField` | 共用参数区附加字段（读写 `ctx.getParam` / `setParam` / `pluginData`） |
| `registerQuoteOptionField` | 每个耗材方案卡片内附加字段 |
| `registerQuoteColumn` | 方案对比表增加列 |
| `registerQuoteAction` | 复制/导出旁增加按钮 |
| `registerQuoteToolbarAction` | 标题旁工具栏按钮 |
| `registerQuoteCostAdjust` | 改写每方案 `costs`（加费、折扣等） |
| 槽位 `tools.*` / `quote.history.*` | 页内插入点 |
| 钩子 `quote_*` | 服务端拦截 |

#### 7.9.2 UI 槽位

| 槽位 | 位置 |
|------|------|
| `tools.page` / `.replace` / `before` / `after` | 整页 |
| `tools.header.before` / `after` | 标题区 |
| `tools.params.before` / `after` / `fields` | 共用参数卡 |
| `tools.gcode.after` | G-code 导入后 |
| `tools.options.before` / `after` | 耗材方案区 |
| `tools.option.extra` | 单个方案内（`context.optionId`） |
| `tools.result.before` / `after` / `breakdown.after` | 结果卡 |
| `tools.actions.before` / `after` | 复制/导出按钮区 |
| `quote.history` / `.replace` / `before` / `after` | 报价记录页 |
| `quote.history.header.before` / `after` | 标题区 |
| `quote.history.toolbar.before` / `after` | 搜索工具栏 |
| `quote.history.filters.after` | 筛选区后 |
| `quote.history.list.before` / `after` | 表格前后 |
| `quote.history.detail` / `.replace` / `before` / `after` / `footer` | 详情弹窗 |
| `quote.history.detail.options.after` | 详情方案表后 |

#### 7.9.3 注册示例

```js
HanyePlugin.registerQuoteMaterialPreset({
  id: 'demo_silk',
  label: '演示丝绸 PLA',
  tech: 'fdm',
  pricePerKg: 88
})

HanyePlugin.registerQuoteField({
  id: 'rush_fee',
  tech: 'both',
  order: 20,
  render(el, ctx) {
    el.innerHTML =
      '<label style="display:block;margin-bottom:4px">加急费（元）</label>' +
      '<input class="ant-input" data-rush type="number" style="width:100%" />'
    const input = el.querySelector('[data-rush]')
    input.value = String(ctx.getParam('rushFee') || 0)
    input.onchange = () => ctx.setParam('rushFee', Number(input.value) || 0)
  }
})

HanyePlugin.registerQuoteCostAdjust({
  id: 'rush_adjust',
  order: 10,
  adjust(costs, ctx) {
    const rush = Number(ctx.getParam('rushFee') || 0)
    if (!rush) return costs
    const next = Object.assign({}, costs)
    next.fixed = (Number(next.fixed) || 0) + rush
    next.perUnit = (Number(next.perUnit) || 0) + rush
    next.grand = (Number(next.grand) || 0) + rush * (Number(ctx.getParam('qty')) || 1)
    return next
  }
})

HanyePlugin.registerQuoteAction({
  id: 'demo_summary',
  label: '插件汇总',
  run(ctx) {
    alert('方案数 ' + ctx.options.length + ' · 工艺 ' + ctx.tech)
  }
})
```

#### 7.9.4 报价记录扩展

| API | 作用 |
|-----|------|
| `registerQuoteHistoryColumn` | 列表增加列 |
| `registerQuoteHistoryRowAction` | 行操作按钮 |
| `registerQuoteHistoryToolbarAction` | 标题旁工具栏 |
| `registerQuoteHistoryFilter` | 搜索栏旁筛选 UI；可选 `match` 客户端过滤 |
| `registerQuoteHistoryDetailField` | 详情弹窗附加块 |

```js
HanyePlugin.registerQuoteHistoryColumn({
  id: 'opt_count_badge',
  title: '方案标记',
  width: 90,
  render(r) {
    const n = (r.options || []).length
    return n >= 3 ? '多方案' : String(n)
  }
})

HanyePlugin.registerQuoteHistoryFilter({
  id: 'tech_only',
  render(el, ctx) {
    el.innerHTML = '<select class="ant-input" data-tech style="width:100px"><option value="">工艺</option><option value="fdm">FDM</option><option value="resin">树脂</option></select>'
    const sel = el.querySelector('[data-tech]')
    sel.value = String(ctx.pluginFilters.tech || '')
    sel.onchange = () => ctx.setPluginFilter('tech', sel.value || undefined)
  },
  match(r, ctx) {
    const t = ctx.pluginFilters.tech
    if (!t) return true
    return r.tech === t
  }
})

HanyePlugin.registerQuoteHistoryRowAction({
  id: 'copy_id',
  label: '复制 ID',
  run({ record }) {
    navigator.clipboard?.writeText(String(record.id || ''))
  }
})
```

事件：`quote:change`（计算器）、`quote-history:change`（记录页）。服务端钩子见 **§5.3.2**。

### 7.10 内部监控 / 区域监控扩展

#### 7.10.1 能力总览

| API | 作用 |
|-----|------|
| `registerMonitorToolbarAction` | 监控墙 / 区域页标题旁按钮（`scope: wall\|zones\|both`） |
| `registerMonitorTileAction` | 每路画面标题栏操作按钮 |
| `registerMonitorTileExtra` | 画面 header/footer 自定义 DOM（`place`） |
| `registerMonitorWallFilter` | 过滤监控墙设备格 |
| `registerMonitorCameraField` | 区域「添加摄像头」表单附加字段（任意 source） |
| `registerMonitorCameraSource` | **厂家 / 云平台 / 自定义对接类型**（替换裸 URL 表单） |
| `registerMonitorZoneProvider` | 向区域网格注入实时画面格（不必落库为 ZoneCamera） |

#### 7.10.2 槽位

| 槽位 | 位置 |
|------|------|
| `monitor.page` / `.replace` / `before` / `after` | 内部监控整页 |
| `monitor.header.*` / `alerts.after` / `grid.*` | 标题、告警、网格 |
| `monitor.tile.before` / `after` / `footer` | 单格（`context.deviceId` / `cameraId`） |
| `monitor.zones` / `.replace` / … | 区域监控 |
| `monitor.zones.form.camera.fields` / `footer` | 添加摄像头弹窗 |

#### 7.10.3 厂家 / 自定义监控源（重点）

区域监控默认是「HTTP 流 / 快照 URL」。插件用 `registerMonitorCameraSource` 注册新的「对接方式」，用户在添加摄像头时可选：

1. **前端** `renderForm` + `submit`：收集厂家账号、通道号、设备序列号等，写入 `sourceType` + `pluginData`（及 `x_*` / `plugin_*`）。
2. **前端** `toSources`（可选）：把已保存的摄像头映射为 `SnapshotCam` 源；默认走服务端  
   `GET /api/v1/monitor/zones/{zoneId}/cameras/{id}/snapshot`。
3. **服务端** `monitor_camera_snapshot`：用 `pluginData` 调厂家 API / 云平台，返回 JPEG base64，或改写可拉取的 `url`。

```js
// client.js
HanyePlugin.registerMonitorCameraSource({
  id: 'acme_nvr',
  label: 'Acme NVR / 云平台',
  hideUrlFields: true, // 隐藏内置 URL 输入（默认 true）
  renderForm(el, ctx) {
    el.innerHTML =
      '<label>通道号</label><input class="ant-input" data-ch style="width:100%" />'
    const input = el.querySelector('[data-ch]')
    input?.addEventListener('change', () =>
      ctx.setFieldsValue({ channel: input.value })
    )
  },
  async submit(ctx) {
    const channel = String(ctx.getFieldValue('channel') || '').trim()
    const name = String(ctx.getFieldValue('name') || '').trim() || `通道 ${channel}`
    if (!channel) throw new Error('请填写通道号')
    return {
      camera: {
        name,
        sourceType: 'acme_nvr',
        pluginData: { channel, site: 'cn' }
        // url 可省略；宿主会存 plugin://acme_nvr
      }
    }
  }
  // toSources 可选：直接给 HLS/WebRTC 地址时自行返回
})

// main.js
async monitor_camera_snapshot(api, payload) {
  const cam = payload.camera
  if (!cam || cam.sourceType !== 'acme_nvr') return payload
  const channel = cam.pluginData?.channel
  // 调厂家 SDK / HTTP，得到 jpeg buffer → base64
  const base64 = await fetchFromAcme(channel)
  return { handled: true, ok: true, contentType: 'image/jpeg', base64 }
  // 或：return { handled: false, url: 'http://nvr/snap?ch=' + channel }
}
```

动态列表（不落库）可用：

```js
HanyePlugin.registerMonitorZoneProvider({
  id: 'acme_live',
  label: 'Acme 在线列表',
  listTiles({ zoneId }) {
    return [
      {
        id: 'ch1',
        title: '一号机位',
        cameras: [{ id: 'ch1', name: '一号', remoteSnapshotUrl: 'https://…' }]
      }
    ]
  }
})
```

持久化字段：`sourceType`、`pluginData`、`x_*`、`plugin_*` 会随摄像头 JSON 存盘/入库。

#### 7.10.4 其它示例

```js
HanyePlugin.registerMonitorToolbarAction({
  id: 'demo_wall_ping',
  label: '插件监控',
  scope: 'both',
  run(ctx) {
    alert(ctx.scope + ' · 画面数 ' + ctx.slotCount)
  }
})

HanyePlugin.registerMonitorTileAction({
  id: 'demo_tile_info',
  label: '信息',
  scope: 'both',
  run(ctx) {
    alert((ctx.deviceName || ctx.cameraName || '') + '\n' + (ctx.deviceId || ctx.cameraId || ''))
  }
})

HanyePlugin.registerMonitorTileExtra({
  id: 'demo_tile_footer',
  place: 'footer',
  scope: 'wall',
  render(el, ctx) {
    el.textContent = '插件：' + (ctx.brand || '')
  }
})
```

事件：`monitor:change`。服务端钩子见 **§5.3.3**。

### 7.11 用户与权限扩展

#### 7.11.1 能力总览

| API | 作用 |
|-----|------|
| `registerUserToolbarAction` | 标题旁按钮 |
| `registerUserColumn` | 用户表额外列 |
| `registerUserRowAction` | 行操作按钮 |
| `registerUserFormField` | 新建/编辑表单字段（`collect` → `pluginData` / `x_*`） |
| `registerUserPermGroup` | 额外权限勾选分组（写入 `permissions[]`） |
| `patchPermissions` | 运行时改生效权限列表 |
| 模块 `perm` / `permissions_catalog` | 「插件权限」勾选项 |

#### 7.11.2 槽位

| 槽位 | 位置 |
|------|------|
| `users.page*` | 整页（App 外壳） |
| `users.toolbar.before` / `after` | 标题栏 |
| `users.list.before` / `after` | 表格前后 |
| `users.form` / `.replace` / `before` / `fields` / `footer` / `after` | 编辑弹窗 |
| `users.row.actions` | 行按钮旁 |

#### 7.11.3 示例

```js
HanyePlugin.registerUserColumn({
  id: 'dept',
  title: '部门',
  render(user) {
    return String(user.pluginData?.dept || '—')
  }
})

HanyePlugin.registerUserFormField({
  id: 'dept_field',
  render(el, ctx) {
    el.innerHTML = '<input class="ant-input" data-dept style="width:100%" />'
    const input = el.querySelector('[data-dept]')
    input.value = String(ctx.getFieldValue('dept') || '')
    input.onchange = () => ctx.setFieldsValue({ dept: input.value })
  },
  collect(ctx, user) {
    const dept = String(ctx.getFieldValue('dept') || '').trim()
    user.pluginData = { ...(user.pluginData || {}), dept }
    return user
  }
})

HanyePlugin.registerUserPermGroup({
  id: 'warehouse',
  title: '仓管扩展',
  options: [{ code: 'plugin.wh.view', label: '查看仓库' }]
})
```

持久化：`pluginData`、`x_*`、`plugin_*` 随用户 JSON / MySQL `plugin_data` 保存。  
服务端钩子：`users_list`、`user_create` / `user_update` / `user_delete`、`permissions_catalog`、`permissions_effective`、`auth_me`。  
事件：`users:change`。

### 7.12 打印审核 / 队列扩展

#### 7.12.1 能力总览

| API | 作用 |
|-----|------|
| `registerPrintToolbarAction` | 标题旁按钮 |
| `registerPrintColumn` | 表格额外列（`tabs`: pending/queued/history/mine/all） |
| `registerPrintRowAction` | 行操作按钮 |
| `registerPrintFilter` | 过滤各 Tab 列表行 |

#### 7.12.2 槽位

| 槽位 | 位置 |
|------|------|
| `print.approve` / `.replace` / `before` / `after` | 整页 |
| `print.approve.toolbar.before` / `after` | 标题栏 |
| `print.approve.filters.after` | 队列设备筛选旁 |
| `print.approve.pending|queued|history.before/after` | 各列表前后 |
| `print.approve.row.actions` | 行按钮旁（`context.job`） |

#### 7.12.3 示例

```js
HanyePlugin.registerPrintColumn({
  id: 'priority',
  title: '优先级',
  tabs: ['pending', 'queued'],
  render(job) {
    return String(job.pluginData?.priority || '—')
  }
})

HanyePlugin.registerPrintRowAction({
  id: 'ping',
  label: '插件详情',
  tabs: ['all'],
  run(ctx) {
    alert(JSON.stringify(ctx.job.pluginData || {}))
  }
})

HanyePlugin.registerPrintFilter({
  id: 'hide_failed_noise',
  match(job, ctx) {
    if (ctx.tab !== 'history') return true
    return job.status !== 'cancelled'
  }
})
```

持久化：提交时可带 `pluginData` / `x_*`（随 print-requests JSON / MySQL `data`）。  
服务端钩子：`print_request_list|create`、`print_approve|reject|start|cancel`。  
事件：`print:change`。

---

## 8. 模块页与用户权限对接

### 8.1 模块页（modules）

`type: page|admin` 的模块会出现在侧栏；点击后打开 `PluginHostPage`（iframe），请求：

`GET|POST /api/v1/plugins/{id}/modules/{name}`

模块文件导出 async 函数，返回 HTML 字符串或带 `__html` 的对象：

```js
module.exports = async function page(api) {
  const warn = api.getVar('warn_celsius', '45')
  return `<!doctype html><html><body>
    <link rel="stylesheet" href="/api/v1/plugins/chamber_temp/static/page.css" />
    <h1>仓温一览（阈值 ${warn}℃）</h1>
  </body></html>`
}
```

静态文件：`/api/v1/plugins/{id}/static/...` 或 `/asset/...`。

### 8.2 注册到「用户权限」勾选

插件权限有两种注册方式（可同时用）：

| 方式 | 写法 | 效果 |
|------|------|------|
| 模块 `perm` | `plugin.json` → `modules[].perm` | 自动进勾选；侧栏按该权限过滤（管理员始终可见） |
| 钩子 `permissions_catalog` | `main.js` 导出同名函数 | 追加任意码（含非导航能力） |

```json
{
  "name": "page",
  "menu": "插件演示页",
  "type": "page",
  "displayOrder": 10,
  "perm": "plugin.demo_hello.page"
}
```

```js
async permissions_catalog(api, list) {
  return list.concat([
    { code: 'plugin.demo_hello.extra', label: '演示扩展能力', plugin: 'demo_hello' }
  ])
}
```

| 字段 | 说明 |
|------|------|
| `perm` / `code` | 权限码字符串（勿用 `device.action.*` 前缀） |
| `adminOnly` | 仅管理员可见模块，不产生勾选项 |
| `label` | 勾选列表显示名（模块默认用 `menu`） |

**宿主行为**

1. **用户权限** 编辑弹窗 → 「插件权限」分组可勾选  
2. 侧栏：有 `perm` 的模块，无权限且非管理员则隐藏；`adminOnly` 仅管理员  
3. 勾选结果写入用户 `permissions`，随登录 `/me` 下发  

**查询接口**

| 接口 | 字段 |
|------|------|
| `GET /api/v1/auth/meta` | `pluginPerms[]`、合并后的 `permLabels` |
| `GET /api/v1/plugins/ui` | `permissions[]`（与上同源）、`nav[].perm` |

示例见 `assets/examples/plugin-sample/`（演示页 `plugin.demo_hello.page` + 扩展码 `plugin.demo_hello.extra`）。

---

## 9. 生命周期

`install.js` / `uninstall.js` / `upgrade.js`：

```js
module.exports = async function install(api) {
  api.writeJson('installed.json', { at: new Date().toISOString() })
  api.log('installed')
}
```

---

## 10. 典型插件类型怎么做

### 10.1 登录插件

- `publicClientJs` + `login.js`
- 槽位：`login.header` / `login.form.replace` / `login.page.replace`
- 服务端：`login_before` / `login_after`
- 第三方授权完成后：
  `api.findUser` / `createUser` + `api.createLoginGrant` + `HanyePlugin.exchangeLoginGrant(...)`

仓库示例：`assets/examples/plugin-sample/` 已包含一个“模拟第三方授权后直登宿主”的最小流程。

### 10.2 导航插件

- `client.js`：`hideNavKeys` / `patchNav`
- 或 `modules` 增加 page，并设 `perm` 对接用户勾选
- 服务端：`ui_nav` / `permissions_catalog` / `permissions_effective`

### 10.3 用户 / 权限插件

- 前端：`registerUserColumn` / `ToolbarAction` / `RowAction` / `FormField` / `PermGroup`（详 **§7.11**）
- 槽位：`users.toolbar.*` / `users.list.*` / `users.form.*` / `users.page.replace`
- 钩子：`users_list`、`user_create` / `update` / `delete`、`permissions_catalog`、`permissions_effective`、`auth_me`
- 自定义 `plugin.*` 码：业务接口内 `hasPerm` / 前端 `can(code)`

### 10.4 AI 插件

- `registerSettingsTab` 或 `settings.tab.ai.*` 槽位
- 钩子：`ai_vision_before` / `after` / `ai_settings_get`
- 自定义路由调用外部模型

### 10.5 设备卡片增强（如仓温）

- `device.card.temps` / `after-name` + `context.chamberTemp`
- 可选 `device.grid.before` 总览条
- `registerRoute` 拉聚合数据
- 参考：`assets/examples/plugin-chamber-temp/`

### 10.6 告警插件

- `alert_notify` 改写/转发
- 或 `api.notify` 主动发

### 10.7 添加设备扩展（品牌 / 连接 / 字段）

目标：在不改宿主源码的前提下，支持新打印机品牌、新连接方式、自定义表单数据。

**推荐组合**

1. `client.js` → `registerAddDeviceBrand`（品牌 + 连接 + `submit`）  
2. 需要「所有品牌都填一项」→ 再加 `registerAddDeviceField`  
3. 仅要插入提示/按钮 → `device.add.*` 槽位  
4. 入库校验/补字段 → `main.js` 的 `device_create`  

字段级、槽位表、`ctx`、持久化规则见 **§7.3（完整说明）**。最小可运行代码：

```js
// client.js
HanyePlugin.registerAddDeviceBrand({
  id: 'my_vendor',
  label: '我的品牌',
  tech: 'both',
  connections: [
    { id: 'lan', label: '局域网', default: true },
    { id: 'cloud', label: '云端' }
  ],
  renderForm(el, ctx) {
    el.innerHTML =
      '<label>地址</label><input class="ant-input" id="mv-url" style="width:100%" />'
    const input = el.querySelector('#mv-url')
    input.value = String(ctx.getFieldValue('host') || '')
    input.onchange = () => ctx.setFieldsValue({ host: input.value })
  },
  async submit(ctx) {
    const v = await ctx.validateFields(['name'])
    return {
      device: {
        id: ctx.newId(),
        name: v.name,
        brand: 'my_vendor',
        tech: ctx.tech,
        connectionMode: ctx.connectionMode,
        baseUrl: ctx.getFieldValue('host') || undefined,
        pluginData: { ok: true },
        createdAt: new Date().toISOString()
      }
    }
  }
})
```

仓库示例：`assets/examples/plugin-sample/`（`demo_vendor` + 全品牌「插件备注」）。

### 10.8 批量操作 / 插件状态

- `registerBatchAction`：勾选后加自定义批量按钮  
- `registerBatchStatus`：在批量栏显示插件状态文案/指示  
- 槽位：`device.batch.before|after|actions|status`  
- 详表与 `ctx` 见 **§7.7**

### 10.9 耗材管理扩展

- `registerFilamentBrand` / `Material` / `Field` / `Column` / `RowAction` / `ToolbarAction`
- 槽位：`filament.toolbar|filters|list|form.*`
- 服务端：`filament_list|create|update|delete`
- 持久化：`pluginData`、`x_*`、`plugin_*`
- 详表见 **§7.8**；示例见 `assets/examples/plugin-sample/client.js`

### 10.10 常用工具 / 报价扩展

- `registerQuoteMaterialPreset` / `PrinterPreset` / `Field` / `OptionField` / `Column` / `Action` / `ToolbarAction` / `CostAdjust`
- 槽位：`tools.header|params|gcode|options|option|result|actions.*`
- 报价记录：`registerQuoteHistoryColumn|RowAction|ToolbarAction|Filter|DetailField` + `quote.history.*`
- 服务端：`quote_presets|calculate|parse_gcode|history_*|schemes_*`
- 详表见 **§7.9**

### 10.11 内部监控 / 区域监控

- `registerMonitorToolbarAction` / `TileAction` / `TileExtra` / `WallFilter` / `CameraField` / `CameraSource` / `ZoneProvider`
- 槽位：`monitor.header|alerts|grid|tile.*`、`monitor.zones.*`
- 服务端：`monitor_wall`、`monitor_zones_*`、`monitor_camera_*`（含 `monitor_camera_snapshot`）
- 详表见 **§7.10**

### 10.12 用户与权限扩展

- `registerUserColumn` / `ToolbarAction` / `RowAction` / `FormField` / `PermGroup`
- 槽位：`users.toolbar|list|form.*|row.actions`
- 服务端：`users_list`、`user_create|update|delete`、`permissions_catalog|effective`、`auth_me`
- 持久化：`pluginData`、`x_*`、`plugin_*`
- 详表见 **§7.11**

### 10.13 打印审核 / 队列扩展

- `registerPrintColumn` / `ToolbarAction` / `RowAction` / `Filter`
- 槽位：`print.approve.*`
- 服务端：`print_request_list|create`、`print_approve|reject|start|cancel`
- 持久化：`pluginData`、`x_*`、`plugin_*`
- 详表见 **§7.12**

---


## 11. 开发调试与打包

### 11.1 流程

1. 在 `assets/plugins/your_id/` 或 `assets/examples/` 写好包。
2. 软件设置 → 插件 → **同步内置** / 上传 ZIP → 解压到 `data/plugins/`。
3. **启用**；改 vars 后必要时刷新。
4. 改 `client.js` / `theme.css` / `login.js`：硬刷新（Ctrl+F5）。
5. 改 `main.js` / `activate`：设置页重载插件，或重启 `npm start`。
6. 控制台看 `[HanyePlugin]`；服务端看 `[plugin:id]`。
7. v2 调试：`GET /api/v1/plugins/kernel-debug`（扩展点 / cron / 熔断统计）。

```bash
npm run build && npm start
# http://127.0.0.1:17890/
```

### 11.2 打包 ZIP

- ZIP 根目录直接是 `plugin.json`，或唯一顶层文件夹内含 `plugin.json`。
- 安装后：`data/plugins/{identifier}/`。
- URL 安装（管理端）：`POST /api/v1/plugins/install-url`（可带 sha256）。

### 11.3 常用 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/plugins` | 列表 |
| POST | `/api/v1/plugins/install-zip` | 上传 |
| POST | `/api/v1/plugins/install-bundled` | 同步内置 |
| POST | `/api/v1/plugins/{id}/enable` | 启用 |
| POST | `/api/v1/plugins/{id}/disable` | 禁用 |
| PATCH | `/api/v1/plugins/{id}/vars` | 改配置 |
| PATCH | `/api/v1/plugins/{id}/modules-enabled` | 模块级启停 |
| DELETE | `/api/v1/plugins/{id}` | 卸载 |
| GET | `/api/v1/plugins/{id}/asset/...` | 静态资源 |
| GET | `/plugin.php?id=foo:bar` | 模块页入口 |

### 11.4 示例对照

| 源码 | 下载 ZIP | 要点 |
|------|----------|------|
| `assets/examples/plugin-sample/` | hanye-plugin-sample-hello.zip | 登录、导航、permissions_catalog、主题补丁、路由 |
| `assets/examples/plugin-kernel-v2/` | hanye-plugin-kernel-v2.zip | activate、hooks、templates、cron、i18n |
| `assets/examples/plugin-chamber-temp/` | （自行打包） | 卡片仓温、temps API、page 模块 |

---

## 12. 与主题的分工

| 能力 | 主题包 | 插件 |
|------|--------|------|
| skin 壳层引擎 / 多套配色 | ✅ 主责 | `patchTheme` / `theme.css` 微调 |
| full 整站 HTML 骨架 | ✅ `siteMode: full` + mounts | 岛内继续挂 PluginSlot |
| 全站 UI 槽位 | ✅ 同名可注入 | ✅ 同名；**replace 优先于主题** |
| 业务逻辑 / API / 权限 / 模块页 | ❌ | ✅ |
| 设备卡实时数据 | 可读 `context` | ✅ 主责 |
| 设置 Tab / 自定义页 | 装饰槽位 | ✅ `registerSettingsTab` / modules |
| 第三方登录换 JWT | ❌ | ✅ grant / `issueLoginToken` |

先选主题定「长什么样」，再用插件定「能做什么」。  
主题手册：[THEME.md](./THEME.md)。内核能力：[PLUGIN_KERNEL_V2.md](./PLUGIN_KERNEL_V2.md)。

**注入顺序**：主题 → 插件 → 默认 UI。  
**替换优先级**：插件 `.replace` > 主题 `.replace`。

---

## 13. 检查清单

- [ ] `identifier` 稳定唯一；权限码带 `plugin.` 前缀  
- [ ] 可信来源；无任意远程代码执行  
- [ ] 自有表只用 `api.db` / `ctx.db`，前缀隔离；卸载时清理  
- [ ] 公开路由用 HMAC 回调或严格校验（v2 `callbacks.register`）  
- [ ] 模块 `perm` / `permissions_catalog` 已对接用户权限页  
- [ ] `client.js` 在 `PluginLoader` reset 后可重复注册  
- [ ] 槽位 render 返回 cleanup，避免泄漏  
- [ ] 未与主题同时 replace 同一关键壳层区域  
- [ ] 附带 README / description，便于设置页识别  
