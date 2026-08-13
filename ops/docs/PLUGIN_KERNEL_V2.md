# 插件微内核 v2 · 开发指南

面向 Discuz 风格深度定制：微内核负责生命周期与扩展点；业务通过 **Hook / Context / 模板 / 回调 / 领域事件** 接入。

| 项 | 值 |
|----|-----|
| Kernel | **2.2.0**（`KERNEL_VERSION`） |
| 类型 | `src/shared/pluginKernel/` |
| 运行时 | `src/main/plugin/kernel/` |
| 管理器 | `src/main/plugin/manager.ts` |
| 总手册 | [PLUGIN.md](./PLUGIN.md) |
| 主题 | [THEME.md](./THEME.md) |

旧版 `main.js` 导出同名钩子（`apiVersion` 1）经 **CompatAdapter** 继续可用。

**示例包**：[hanye-plugin-kernel-v2.zip](/api/v1/docs/downloads/hanye-plugin-kernel-v2.zip) · 源码 `assets/examples/plugin-kernel-v2/`。

---

## 目录

1. [架构](#1-架构)
2. [plugin.json（v2）](#2-pluginjsonv2)
3. [activate(ctx) 入门](#3-activatectx-入门)
4. [Context 能力](#4-context-能力v21)
5. [领域事件](#5-领域事件action)
6. [第三方回调](#6-第三方回调推荐)
7. [Host 钩子](#7-host-钩子覆盖)
8. [Cron / SQL / 模板 / i18n](#8-cron--sql--模板--i18n)
9. [与 Discuz / v1 对照](#9-与-discuz--v1-对照)
10. [已补齐与明确不做](#10-已补齐与明确不做)

---

## 1. 架构

```
Host (ApiServer / Domain events)
        │  runHook · emitDomainEvent · templates
        ▼
┌─────────────────────────────────┐
│  Plugin Kernel v2.1             │
│  HookBus · Cron · SQL migrate   │
│  TemplateEngine · Context       │
│  Callbacks (HMAC) · Cache/i18n  │
└────────────────┬────────────────┘
                 ▼
          data/plugins/{id}/
```

Node 网页服务共用 PluginManager；JSON 存储可挂 db 风格钩子；`USE_MYSQL=1` 时包装连接池。

---

## 2. plugin.json（v2）

```json
{
  "identifier": "demo_kernel",
  "name": "Kernel v2 示例",
  "version": "1.1.0",
  "apiVersion": "2",
  "available": true,
  "requires": { "kernel": ">=2.2.0" },
  "capabilities": [
    "log", "config.vars", "hooks", "http.route", "http.callback", "http.fetch",
    "devices.read", "devices.control", "devices.files", "devices.print",
    "devices.capabilities", "devices.gcode", "devices.moonraker", "devices.lock",
    "camera.snapshot", "media.write",
    "settings.publicUrl", "templates", "alert.dispatch", "users.read", "auth.login",
    "cache", "plugins.call", "i18n", "db.scoped"
  ],
  "dbSchemaVersion": 1,
  "modules": [
    { "name": "tick", "menu": "定时", "type": "cron", "schedule": "every:5m", "displayOrder": 0 }
  ],
  "clientJs": ["client.js"],
  "themeCss": "theme.css"
}
```

| 字段 | 说明 |
|------|------|
| `apiVersion` | 必须 `"2"` |
| `capabilities` | Context 能力门控；未声明则对应 API 不可用。v1 默认宽权限 |
| `dbSchemaVersion` | 配合 `migrations/v1.sql`… 自动升级 |
| `modules[].type=cron` + `schedule` | `every:1m` / `every:5m` / 标准 cron |
| `modules[].type=api` | 可自动 `registerRoute`（`url` / `method` / `public`） |

语言包：`language/zh-CN.json` → `ctx.i18n.t(key)` / 前端 `HanyePlugin.t`。

---

## 3. activate(ctx) 入门

```js
// main.js
async function activate(ctx) {
  ctx.log.info('kernel demo up', ctx.plugin.version)

  ctx.hooks.on('filter:devices.list', (devices) => {
    // 改写设备列表
    return devices
  })

  ctx.hooks.on('action:print.finished', (p) => {
    ctx.log.info('print finished', p && p.deviceId)
  })

  ctx.http.registerRoute('GET', '/api/v1/demo-kernel/ping', async () => {
    return { ok: true, t: Date.now() }
  })

  // 可选：导出给其它插件
  ctx.plugins.registerMethod('ping', async () => ({ pong: true }))
}

module.exports = { activate }
```

停用时可导出 `deactivate(ctx)`（若宿主调用）。生命周期另见 `install.js` / `upgrade.js` / `uninstall.js`。

v1 写法对照：导出 `devices_list(api, devices)` ≈ v2 `ctx.hooks.on('filter:devices.list', …)`。映射表：`LEGACY_HOOK_TO_V2`（`src/shared/pluginKernel/types.ts`）。

---

## 4. Context 能力（v2.1）

| Capability | API |
|------------|-----|
| `log` | `ctx.log.info/warn/error` |
| `config.vars` | `ctx.vars.get/set` |
| `storage.json` | `ctx.storage.readJson/writeJson` |
| `db.scoped` | `ctx.db`（前缀表 + migrations） |
| `http.route` | `ctx.http.registerRoute` |
| `http.fetch` | `ctx.http.fetch` |
| `http.callback` | `ctx.callbacks.register`（HMAC） |
| `settings.*` | `ctx.settings.get/patch` |
| `devices.*` | `ctx.devices.list/control/files/print/getCapabilities/sendGcode/moonrakerRequest/lock` |
| `alert.dispatch` | `ctx.alert.dispatch` |
| `users.*` / `auth.login` | `ctx.users` / `ctx.auth`（grant / JWT） |
| `plugins.call` | `ctx.plugins.call(id, method, args)` |
| `cache` | `ctx.cache.get/set/delete` |
| `i18n` | `ctx.i18n.t` |
| `hooks` / `templates` | `ctx.hooks` / `ctx.templates` |
| （通知） | `ctx.notices.push` → `/api/v1/plugin-notices` |

未列入 `capabilities` 的能力在运行时会被拒绝（安全门控）。

---

## 5. 领域事件（action）

宿主在状态机 / 登录 / 告警后 `emit`：

| 事件 | 触发 |
|------|------|
| `action:device.online` / `offline` | 在线状态翻转 |
| `action:print.started` / `finished` / `failed` | 打印态变化 |
| `action:alert.fired` | 告警渠道发送后 |
| `action:auth.session.created` / `revoked` | 登录 / 登出 / SSO / grant |
| `action:plugin.lifecycle` | 启用 / 禁用 |

```js
ctx.hooks.on('action:print.finished', (p) => {
  // 对接 ERP / 钉钉 …
})
```

过滤器类钩子（可改写返回值）以 `filter:` 前缀为主，完整短名见 `KERNEL_HOOKS` / `LEGACY_HOOK_TO_V2`。

---

## 6. 第三方回调（推荐）

```js
ctx.callbacks.register({
  path: '/api/v1/my-plugin/erp-hook',
  secretVar: 'erp_secret',
  verify: 'hmac-sha256', // Header: X-Hanye-Signature
  handler: async (req) => ({ ok: true })
})
```

所有**公开**插件路由进入 handler 前会走 `filter:http.callback.before`。  
出站 webhook：`filter:webhook.outbound`。

OAuth / 第三方登录：`registerRoute(..., { public: true })` + `ctx.auth.createLoginGrant`（流程见 [PLUGIN.md](./PLUGIN.md)「换宿主 JWT」）。

---

## 7. Host 钩子覆盖

除 CRUD 外，2.1 已接线例如：

- SSO / grant exchange / logout  
- batch control / batch print  
- files list/upload/download  
- discover LAN / onboard  
- nav config / theme install·activate  
- logs list/append  
- `devices_save`、webhook outbound  
- UI render / template.fetch  

完整短名：[PLUGIN.md §5](./PLUGIN.md#5-服务端钩子一览) 与源码 `LEGACY_HOOK_TO_V2`。

---

## 8. Cron / SQL / 模板 / i18n

| 能力 | 用法 |
|------|------|
| **Cron** | `modules` 中 `type: "cron"` + `schedule`；管理器约 30s tick；互斥 busy 跳过 |
| **SQL 迁移** | `migrations/vN.sql`，升到 `dbSchemaVersion`（需 MySQL） |
| **install.sql / uninstall.sql** | 安装 / 卸载自动执行 |
| **模板** | `templates/*.htm`，语法同主题（extends/block/include/`{$var}`/`{if}`/`{loop}`） |
| **语言包** | `language/{locale}.json` |
| **模块页** | `/plugin.php?id={identifier}:{module}`；校验 `perm` / `adminOnly` / 模块启停 |
| **跨插件** | `registerMethod` + `call` |
| **用户组** | `/api/v1/user-groups`；有效权限 = 直接勾选 ∪ 组权限 |
| **权限包** | `/api/v1/permission-packs` |
| **模块启停** | `PATCH /api/v1/plugins/:id/modules-enabled` |

调试：`GET /api/v1/plugins/kernel-debug`（扩展点目录、cron 状态、钩子熔断统计）。

Hook 默认超时约 5s；连续失败打开约 30s 熔断。

---

## 9. 与 Discuz / v1 对照

| Discuz / 需求 | hanye 2.1 |
|---------------|-----------|
| filter / action + 优先级 | ✅ |
| 依赖 / 冲突 | ✅ |
| 模板 extends/block | ✅（与主题共用引擎） |
| 独立表 + 迁移 | ✅ scoped + migrations |
| 第三方回调 + 签名 | ✅ HMAC |
| 领域事件 | ✅ |
| Cron | ✅ |
| 语言包 | ✅ JSON |
| 跨插件调用 | ✅ `plugins.call` |
| 缓存钩子 | ✅ |
| `plugin.php?id=` | ✅ |
| 站内通知 | ✅ `ctx.notices` |
| 手机 touch 模板 / XML 清单 | ❌（用响应式 SPA slot） |

v1 → v2：把 `async devices_list(api, list)` 改为在 `activate` 里 `ctx.hooks.on('filter:devices.list', …)`；`api.*` 改为 `ctx.*` 对应能力。

---

## 10. 已补齐与明确不做

### 已补齐（摘要）

- 一级路由整页 `*.page` replace 闭环  
- 扩展点登记表 `extensionPoints.ts` + kernel-debug  
- Hook 超时 / 熔断 / 统计  
- 模板 compile + 短 TTL render cache  
- `type=api` 自动挂载路由  
- Cron 互斥 + 状态面板  
- URL 安装 + sha256  
- UI Slot 密铺（与 `PLUGIN_UI_SLOTS` 对齐）  
- 用户组 / 权限包 / 模块级启停  

### 明确不做

- XML 清单  
- 手机 touch 独立模板链  
- Worker/VM 进程沙箱（同进程信任模型；靠超时熔断隔离）

UI 扩展点以 `PLUGIN_UI_SLOTS`（`src/shared/plugin.ts`）与 `extensionPointCatalog()` 为准。  
主题整站模式不影响插件槽位写法，见 [THEME.md §8](./THEME.md#8-full整站骨架与挂载点)。
