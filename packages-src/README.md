# 各平台安装包源码

本目录集中存放各系统安装包相关源码（不再放在仓库根目录）。

| 子目录 | 平台 | 产物（在 `packages/`） |
|--------|------|------------------------|
| `mac/` | macOS | `macos-*-arm64.dmg` / `macos-*-amd64.dmg` |
| `linux/` | Ubuntu / Debian / CentOS | `ubuntu-*.deb` / `debian-*.deb` / `centos-*.rpm` |
| `win/` | Windows | `windows-*-amd64.exe` |
| `fnos/` | 飞牛 fnOS | `fnos-*-x86.fpk` / `fnos-*-arm.fpk` |
| `syno/` | 群晖 DSM | `syno-*-x86_64.spk` |

打包命令仍在仓库根目录执行，例如：`npm run pack:mac`、`npm run pack:win`。

打源码压缩包：`npm run pack:installer-src` → `packages/installer-src-<version>.zip`
