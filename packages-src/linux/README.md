# Linux 一键安装包（.deb / .rpm）

内置 Node.js 20 + systemd 服务，**无需**另行安装 Node 或 Docker。

## 用户安装

### Ubuntu / Debian（amd64）

```bash
sudo dpkg -i ubuntu-4.3.1-amd64.deb
# 若提示依赖问题：
sudo apt-get install -f
```

### CentOS / RHEL / Rocky / Alma（amd64）

```bash
sudo yum install ./centos-4.3.1-amd64.rpm
# 或 Fedora / 新版：
sudo dnf install ./centos-4.3.1-amd64.rpm
```

### ARM64 服务器

使用文件名带 `arm64` 的 deb/rpm（如 `ubuntu-4.3.1-arm64.deb`）。

安装后访问 http://127.0.0.1:17890/ ，默认 **admin / admin123**。

| 项 | 说明 |
|----|------|
| 程序目录 | `/opt/hanye-printer-monitor` |
| 配置 | `/opt/hanye-printer-monitor/app.env` |
| 日志 | `/opt/hanye-printer-monitor/data/service.log` |
| 服务 | `systemctl status hanyemonitor` |
| 停止 | `sudo systemctl stop hanyemonitor` |
| 卸载 deb | `sudo dpkg -r hanyemonitor` |
| 卸载 rpm | `sudo yum remove hanyemonitor` |

## 开发者打包

```bash
# amd64 + arm64，同时产出 deb 与 rpm
npm run pack:linux

# 仅 x86_64
npm run pack:linux:amd64

# 仅 arm64
npm run pack:linux:arm64
```

产物在 `packages/`：

- `packages/ubuntu-<version>-amd64.deb`
- `packages/debian-<version>-amd64.deb`
- `packages/centos-<version>-amd64.rpm`

使用 [nfpm](https://github.com/goreleaser/nfpm) 打包；脚本会自动下载 nfpm。
