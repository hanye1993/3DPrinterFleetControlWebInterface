# hanye · 3D 打印机监控台（纯网页）

统一监控与控制多品牌 **FDM / 光固化** 3D 打印机。电脑、手机浏览器打开同一地址即可。

| 项目 | 说明 |
|------|------|
| 版本 | **4.3.0** |
| 许可 | MIT |
| 默认端口 | **17890** |
| 默认管理员 | **admin** / **admin123**（登录后请立刻改密） |

- **管理员** → 管理台全功能（用户、设备、设置、主题、插件等）
- **普通用户** → 按权限的工作台

---

## 目录

1. [一键安装包（推荐）](#1-一键安装包推荐)
2. [Node 源码直装](#2-node-源码直装)
3. [Docker 安装](#3-docker-安装)
4. [功能与品牌](#4-功能与品牌)
5. [项目结构](#5-项目结构)
6. [文档](#6-文档)

**代码仓库（三端同步）**

| 平台 | 仓库 | v4.3.0 发布页 |
|------|------|----------------|
| GitHub | https://github.com/hanye1993/3DPrinterFleetControlWebInterface | [Releases](https://github.com/hanye1993/3DPrinterFleetControlWebInterface/releases/tag/v4.3.0) |
| Gitee | https://gitee.com/hanye11/3DPrinterFleetControlWebInterface | [Releases](https://gitee.com/hanye11/3DPrinterFleetControlWebInterface/releases/tag/v4.3.0) |
| GitCode | https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface | [Releases](https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface/releases/tag/v4.3.0) |

用户在「软件设置 → 关于」里可选上述任一平台检查 / 下载更新（默认 Gitee，国内更稳）。

---

## 1. 一键安装包（推荐）

从上面 **Releases / 发行版** 下载对应文件，**无需单独安装 Node.js**（Windows / macOS / Linux 包已内置 Node 20）。

### 安装包一览（v4.3.0）

| 平台 | 文件 | 说明 |
|------|------|------|
| **Windows** | `windows-4.3.0-amd64.exe` | 双击安装，可选目录；Win10/11 64 位，需管理员 |
| **macOS Apple Silicon** | `macos-4.3.0-arm64.dmg` | 打开 DMG → 运行 `install.command`（Gitee 单文件 ≤100MB，请从 **GitHub / GitCode** 下载） |
| **macOS Intel** | `macos-4.3.0-amd64.dmg` | 同上 |
| **Ubuntu / Debian x64** | `ubuntu-4.3.0-amd64.deb` / `debian-4.3.0-amd64.deb` | `sudo dpkg -i xxx.deb` |
| **Ubuntu / Debian arm64** | `ubuntu-4.3.0-arm64.deb` / `debian-4.3.0-arm64.deb` | 同上 |
| **CentOS / RHEL x64** | `centos-4.3.0-amd64.rpm` | `sudo yum install ./centos-4.3.0-amd64.rpm` |
| **CentOS / RHEL arm64** | `centos-4.3.0-arm64.rpm` | 同上 |
| **飞牛 fnOS x86** | `fnos-4.3.0-x86.fpk` | 应用中心先装 **Node.js 20/22**，再手动安装 fpk |
| **飞牛 fnOS ARM** | `fnos-4.3.0-arm.fpk` | 同上 |
| **群晖 x86_64** | `syno-4.3.0-x86_64.spk` | 套件中心先装 **Node.js 20/22**，再手动安装 spk |
| **群晖 aarch64** | `syno-4.3.0-aarch64.spk` | 同上 |
| **安装包源码** | `installer-src-4.3.0.zip` | 各平台打包骨架（`packages-src/`），供二次打包 |

安装后浏览器打开：**http://127.0.0.1:17890/** ，默认 **admin / admin123**。

### 各平台简要步骤

**Windows**

1. 右键 `windows-4.3.0-amd64.exe` → **以管理员身份运行**
2. 选择安装目录（默认 `C:\Program Files\HanyeMonitor`）
3. 桌面打开 **hanye Printer Monitor** 控制面板 → 点「启动」

**macOS**

1. 打开对应芯片的 `.dmg`，双击 `install.command`
2. 浏览器访问 http://127.0.0.1:17890/

**Linux（deb / rpm）**

```bash
# Debian / Ubuntu
sudo dpkg -i ubuntu-4.3.0-amd64.deb && sudo apt-get install -f

# CentOS / RHEL / Rocky
sudo yum install ./centos-4.3.0-amd64.rpm
```

**飞牛 NAS**

1. 应用中心安装 **Node.js 22**（或 20）
2. 手动安装对应架构的 `.fpk` → 启用应用
3. 若启用失败，查看 `/vol*/@appdata/hanyemonitor/app.log`

**群晖 DSM**

1. 套件中心安装 **Node.js 20** 或 **22**
2. 套件中心 → 手动安装 → 选 `.spk`
3. 访问 `http://NAS的IP:17890/`

更细的说明见 [ops/docs/INSTALL.md](ops/docs/INSTALL.md) 与各平台 [packages-src/](packages-src/) 下 README。

---

## 2. Node 源码直装

适合开发调试、NAS 上扫局域网打印机、或需要自行改代码的场景。环境：**Node.js 20+**。

### 获取源码

```bash
git clone https://gitee.com/hanye11/3DPrinterFleetControlWebInterface.git
cd 3DPrinterFleetControlWebInterface
```

也可从 Releases 下载源码 zip，或解压仓库根目录打包的源码包。

### 安装与启动

```bash
npm install
npm run build
mkdir -p data
cp .env.example .env    # 按需编辑
npm start
```

浏览器打开：**http://127.0.0.1:17890/**

### 最小 `.env`（试用，JSON 存储）

```env
PORT=17890
DATA_ROOT=./data
LAN_SCAN_SUBNETS=192.168.1    # 改成你的网段，如 192.168.10
```

### 生产可选 MySQL

```bash
export USE_MYSQL=1
export MYSQL_HOST=127.0.0.1
export MYSQL_USER=hanye
export MYSQL_PASSWORD=你的密码
export MYSQL_DATABASE=hanye_printer
export SECRETS_MASTER_KEY=长随机串
npm start
```

详见 [ops/docs/NODE_DEPLOY.md](ops/docs/NODE_DEPLOY.md)、[ops/docs/MYSQL.md](ops/docs/MYSQL.md)。

### NAS（飞牛 / 群晖）SSH 直装

应用中心装好 Node 后，SSH 里 often 需要：

```bash
export PATH=/var/apps/nodejs_v20/target/bin:$PATH   # 飞牛
# 群晖常见：/var/packages/Node.js_v20/target/usr/local/bin
cd /你的解压目录
npm install && npm run build && npm start
```

飞牛日常启停 / 更新脚本见 [node.js20/README.md](node.js20/README.md)。

---

## 3. Docker 安装

适合已熟悉 Docker、希望 **MySQL + 应用** 一起容器化部署的环境。文件均在 [`docker/`](docker/) 目录。

### Windows

1. 安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. 进入仓库 **`docker`** 文件夹，双击 **`install.bat`**
3. 浏览器：http://127.0.0.1:17890/
4. 清空重装：双击 **`reset.bat`**，输入 `YES`

### macOS / Linux

```bash
cd docker
chmod +x install.sh reset.sh import.sh gen-env.sh
./install.sh
```

Linux 未装 Docker 时可先执行：`curl -fsSL https://get.docker.com | sh`

### 常用 Docker 命令（仓库根目录）

```bash
npm run docker:up       # 构建并启动
npm run docker:down     # 停止
npm run docker:logs     # 查看日志
npm run docker:import   # 导入 ./data 到 MySQL
```

NAS 上若需扫局域网打印机，优先用 **Node 直装** 或 **一键 fpk/spk**；Docker 网络配置见 [docker/README.md](docker/README.md)、[ops/docs/INSTALL.md](ops/docs/INSTALL.md)。

---

## 4. 功能与品牌

监控与控制、耗材、打印审核队列、用户权限 / 按设备授权、监控墙与区域摄像头、代打报价、模型 / AI 入口、告警、**主题包**（含整站 `siteMode: full`）、**插件**（钩子 / 槽位 / 微内核 v2）、**应用集市**一键安装等。

**应用集市**：默认 [http://sc1.dpfrp.top:3000](http://sc1.dpfrp.top:3000/)（可用 `MARKET_BASE_URL` 覆盖）。

常见品牌协议：Klipper/Moonraker、拓竹、创想、Elegoo、Anycubic、Snapmaker、闪铸等。  
纯网页版由 **服务端** 连接打印机，请保证部署机与打印机网络可达。

---

## 5. 项目结构

```
├── src/                 # 源码（web React + Node 服务）
├── assets/              # 内置主题 / 插件 / 示例 / yolo
├── packages-src/        # 各平台一键安装包源码（mac/linux/win/fnos/syno）
├── ops/                 # sql · scripts · docs
├── config/              # Vite / TypeScript
├── data/                # 运行时数据（勿提交）
├── dist/                # 构建产物
├── docker/              # Docker 一键脚本 / compose / Dockerfile
├── node.js20/           # 飞牛 NAS Node 20 启停 / 更新脚本
├── package.json
└── README.md
```

---

## 6. 文档

| 文档 | 内容 |
|------|------|
| [INSTALL.md](ops/docs/INSTALL.md) | 分平台详细安装（一键包 + Node + Docker） |
| [node.js20/README.md](node.js20/README.md) | 飞牛 NAS Node 运维脚本 |
| [NODE_DEPLOY.md](ops/docs/NODE_DEPLOY.md) | Node 生产部署 |
| [MYSQL.md](ops/docs/MYSQL.md) | MySQL |
| [BAOTA.md](ops/docs/BAOTA.md) | 宝塔面板 |

---

## License

MIT
