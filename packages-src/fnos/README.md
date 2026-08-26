# 飞牛 fnOS 应用包（`.fpk`）— Node 原生直装

依据官方文档用 **`fnpack create` + `fnpack build`** 打包：

- [创建应用](https://developer.fnnas.com/docs/quick-started/create-application)
- [测试应用](https://developer.fnnas.com/docs/quick-started/test-application)
- [Native 案例](https://developer.fnnas.com/docs/examples/native)
- [fnpack](https://developer.fnnas.com/docs/cli/fnpack)

已确认：`HelloFnos-official.fpk` 可在本机 NAS 正常安装。业务包按同一官方结构打包。

## 架构

飞牛 `manifest` 的 `platform` 须为 **`x86`** 或 **`arm`**（不要用 `all`，旧版 fnpack 会失败）。

| NAS 芯片 | 安装包（在 `packages/`） |
|----------|--------|
| Intel / x86 | `fnos-4.2.0-x86.fpk` |
| ARM（R 系列等） | `fnos-4.2.0-arm.fpk` |

## 安装

1. 应用中心先装好 **Node.js 22**（或 20；启停脚本会自动探测）
2. 手动安装对应架构的 `.fpk`
3. 打开桌面图标，默认 **admin / admin123**，立刻改密

## 打包

```bash
# 同时打 x86 + arm
npm run pack:fnos

# 仅 x86
npm run pack:fnos:x86

# 仅 ARM
npm run pack:fnos:arm
```

## 曾失败原因（已排除）

此前「应用包不符合系统要求」主要是包不合规（缺 `privilege.username/groupname`、缺 UI 图标、误用 conversun 布局、`platform=all` 等）。**不要用 conversun 布局。**
