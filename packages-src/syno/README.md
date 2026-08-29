# 群晖 DSM 应用包（`.spk`）— Node 直装

与飞牛 `fpk` 并列，面向 **Synology DSM 7** 的第三方套件（SPK）。

参考：[Synology 套件脚本说明](https://help.synology.com/developer-guide/synology_package/scripts.html)

## 安装前

1. 套件中心安装 **Node.js 20** 或 **Node.js 22**（Synology 官方套件）
2. 控制面板 → 终端机：允许 SSH（可选，排错用）

## 打包

```bash
npm run pack:syno
# ARM 群晖（如部分 Plus 型号）：
SPK_ARCH=aarch64 bash ops/scripts/pack-syno-spk.sh
```

产物在 `packages/`：

- `packages/syno-4.3.0-x86_64.spk`

## 安装

1. DSM → **套件中心** → **手动安装** → 选 `.spk`
2. 安装完成后在套件中心 **启动**
3. 桌面打开 **hanye Printer Monitor**，或浏览器访问 `http://NAS_IP:17890`
4. 默认 **admin / admin123**，立刻改密

## 配置

编辑 `/var/packages/hanyemonitor/etc/app.env`：

| 变量 | 说明 |
|------|------|
| `LAN_SCAN_SUBNETS` | 打印机扫描网段，如 `192.168.10` |
| `PORT` | 默认 `17890` |
| `DATA_ROOT` | 数据目录，默认 `var/data` |

日志：`/var/packages/hanyemonitor/var/app.log`

## 与飞牛包差异

| 项 | 飞牛 fpk | 群晖 spk |
|----|----------|----------|
| 包格式 | `.fpk` + `fnpack` | `.spk` + `tar` |
| 启停 | `cmd/main` | `scripts/start-stop-status` |
| 配置 | `TRIM_PKGETC/app.env` | `SYNOPKG_PKGETC/app.env` |
| Node 路径 | `/var/apps/nodejs_v20/...` | `/var/packages/Node.js_v20/...` |
