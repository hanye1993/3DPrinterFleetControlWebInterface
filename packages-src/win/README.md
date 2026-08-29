# Windows 一键安装包（exe）

双击 **`packages/windows-4.3.0-amd64.exe`** 安装，**无需**另装 Node.js。

## 用户怎么用

1. 双击 `windows-4.3.0-amd64.exe`（需管理员权限）完成安装  
2. **选择安装目录**（默认 `C:\Program Files\HanyeMonitor`，可改到其他盘）  
3. 桌面会出现 **hanye Printer Monitor** 图标  
3. 打开后是控制面板，三个按钮：

| 按钮 | 作用 |
|------|------|
| **启动** | 启动监控服务并打开网页 |
| **重启** | 重启服务 |
| **关闭** | 停止服务 |

关闭窗口后程序会**收到系统托盘**；托盘图标右键同样可以启动 / 重启 / 关闭。

4. 浏览器 http://127.0.0.1:17890/ ，默认 **admin / admin123**

| 项 | 说明 |
|----|------|
| 程序目录 | 安装时自选（默认 `C:\Program Files\HanyeMonitor`） |
| 数据目录 | 装到 Program Files 时：`C:\ProgramData\HanyeMonitor\data`；其他目录：`安装目录\data` |
| 控制面板 | `HanyeMonitorControl.exe`（带托盘） |
| 配置 | `app.env` |
| 日志 | `C:\ProgramData\HanyeMonitor\data\service.log` |
| 卸载 | 开始菜单 → hanye → 卸载 |

## 开发者打包

```bash
npm run pack:win
# 产出：packages/windows-<version>-amd64.exe
```

可在 macOS 上交叉编译，无需 Windows / NSIS。
