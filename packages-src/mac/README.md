# macOS 一键安装包

双击 DMG 内的 **`install.command`** 完成安装，**无需**另行安装 Node.js。

安装包内已包含：Node.js 20、监控台程序、launchd 用户服务（登录自启）。

## 用户安装

| 芯片 | 安装包 |
|------|--------|
| Apple Silicon（M 系列） | `macos-4.2.0-arm64.dmg` |
| Intel | `macos-4.2.0-amd64.dmg` |

1. 打开对应 DMG，双击 `install.command`
2. 按提示完成（自动注册后台服务并打开浏览器）
3. 访问 http://127.0.0.1:17890/ ，默认 **admin / admin123**

| 项 | 说明 |
|----|------|
| 程序目录 | `/Applications/hanye Printer Monitor` |
| 配置 | `app.env`（网段 `LAN_SCAN_SUBNETS=192.168.1`） |
| 日志 | `data/service.log` |
| 停止 | 运行 `stop-hanyemonitor.sh` 或 `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hanye.hanyemonitor.plist` |

## 开发者打包

```bash
# 同时打 arm64 + x64
npm run pack:mac

# 仅 Apple Silicon
npm run pack:mac:arm64

# 仅 Intel
npm run pack:mac:x64
```

产物在 `packages/`：

- `packages/macos-<version>-arm64.dmg`
- `packages/macos-<version>-amd64.dmg`

可在 Apple Silicon Mac 上交叉打出 Intel 版（脚本使用 `--platform=darwin --arch=x64`）。
