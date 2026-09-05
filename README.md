# hanye · 3D 打印机监控台（纯网页）

统一监控与控制多品牌 **FDM / 光固化** 3D 打印机。电脑、手机浏览器打开同一地址即可。

| 项目 | 说明 |
|------|------|
| 开源截止版本 | **4.3.3**（本仓库最后开源版；其后版本不开源） |
| 最新产品版本 | **5.0.0**（仅官网一键包） |
| 最新安装包 | 官网 **[https://3dmn.cn](https://3dmn.cn)** 一键包（始终最新） |
| 许可（≤4.3.3 源码） | MIT |
| 默认端口 | **17890** |
| 默认管理员 | **admin** / **admin123**（登录后请立刻改密） |

> **重要说明：** GitHub / Gitee / GitCode **源码仅保留至 v4.3.3**。**4.3.3 之后的新版本不再开源**，请到 [https://3dmn.cn](https://3dmn.cn) 下载一键安装包。三仓库仍会同步更新 **README / 更新日记 / 全部功能 / 竞品对照** 与版本说明，**不提供**新版源码与安装包。

- **管理员** → 管理台全功能（用户、设备、设置、主题、插件等）
- **普通用户** → 按权限的工作台

---

## 目录

1. [一键安装包（推荐）](#1-一键安装包推荐)
2. [Node 源码直装](#2-node-源码直装)
3. [Docker 安装](#3-docker-安装)
4. [功能与品牌](#4-功能与品牌)
5. [文档](#5-文档)

**代码仓库（开源归档 · 截止 v4.3.3）**

| 平台 | 仓库 | v4.3.3 标签 |
|------|------|-------------|
| GitHub | https://github.com/hanye1993/3DPrinterFleetControlWebInterface | [v4.3.3](https://github.com/hanye1993/3DPrinterFleetControlWebInterface/releases/tag/v4.3.3) |
| Gitee | https://gitee.com/hanye11/3DPrinterFleetControlWebInterface | [v4.3.3](https://gitee.com/hanye11/3DPrinterFleetControlWebInterface/releases/tag/v4.3.3) |
| GitCode | https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface | [v4.3.3](https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface/releases/tag/v4.3.3) |

---

## 1. 一键安装包（推荐）

**请到官网下载最新版：** [https://3dmn.cn](https://3dmn.cn)  
（Windows / macOS / 飞牛 / 群晖等；多数包已内置 Node，无需单独安装。）  
三端仓库**不提供**新版本安装包，也不再开源新版本源码。

### 安装包一览（官网最新；下表文件名以 5.0.0 为例）

| 平台 | 文件 | 说明 |
|------|------|------|
| **Windows** | `windows-5.0.0-amd64.exe` | 双击安装，可选目录；Win10/11 64 位，需管理员 |
| **macOS Apple Silicon** | `macos-5.0.0-arm64.dmg` | 打开 DMG → 运行 `install.command` |
| **macOS Intel** | `macos-5.0.0-amd64.dmg` | 同上 |
| **飞牛 fnOS x86** | `fnos-5.0.0-x86.fpk` | 应用中心先装 **Node.js 20/22**，再手动安装 fpk |
| **飞牛 fnOS ARM** | `fnos-5.0.0-arm.fpk` | 同上 |
| **群晖 x86_64** | `syno-5.0.0-x86_64.spk` | 套件中心先装 **Node.js 20/22**，再手动安装 spk |
| **群晖 aarch64** | `syno-5.0.0-aarch64.spk` | 同上 |

安装后浏览器打开：**http://127.0.0.1:17890/** ，默认 **admin / admin123**。

### 各平台简要步骤

**Windows**

1. 右键 `windows-5.0.0-amd64.exe` → **以管理员身份运行**
2. 选择安装目录（默认 `C:\Program Files\HanyeMonitor`）
3. 桌面打开 **hanye Printer Monitor** 控制面板 → 点「启动」

**macOS**

1. 打开对应芯片的 `.dmg`，双击 `install.command`
2. 浏览器访问 http://127.0.0.1:17890/

**Linux（deb / rpm）**

```bash
# Debian / Ubuntu
sudo dpkg -i ubuntu-4.3.3-amd64.deb && sudo apt-get install -f

# CentOS / RHEL / Rocky
sudo yum install ./centos-4.3.3-amd64.rpm
```

**飞牛 NAS**

1. 应用中心安装 **Node.js 22**（或 20）
2. 手动安装对应架构的 `.fpk` → 启用应用
3. 若启用失败，查看 `/vol*/@appdata/hanyemonitor/app.log`

**群晖 DSM**

1. 套件中心安装 **Node.js 20** 或 **22**
2. 套件中心 → 手动安装 → 选 `.spk`
3. 访问 `http://NAS的IP:17890/`

更细的说明见 [主程序/ops/docs/INSTALL.md](主程序/ops/docs/INSTALL.md) 与各平台 [一键包源码/](一键包源码/) 下 README。

---

## 2. Node 源码直装

适合开发调试、NAS 上扫局域网打印机、或需要自行改代码的场景。环境：**Node.js 20+**。  
**注意：** 仓库源码为开源归档 **≤4.3.3**；要最新功能请用 [官网一键包](https://3dmn.cn)。

### 获取源码

```bash
git clone https://gitee.com/hanye11/3DPrinterFleetControlWebInterface.git
cd 3DPrinterFleetControlWebInterface
git checkout v4.3.3   # 最后开源标签
cd 主程序             # 监控台工程目录（新布局；旧归档若无此目录则在仓库根执行）
```

也可从 Releases 下载 **v4.3.3** 源码 zip。

### 安装与启动

```bash
cd 主程序
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

详见 [主程序/ops/docs/NODE_DEPLOY.md](主程序/ops/docs/NODE_DEPLOY.md)、[主程序/ops/docs/MYSQL.md](主程序/ops/docs/MYSQL.md)。

### NAS（飞牛 / 群晖）SSH 直装

应用中心装好 Node 后，SSH 里 often 需要：

```bash
export PATH=/var/apps/nodejs_v20/target/bin:$PATH   # 飞牛
# 群晖常见：/var/packages/Node.js_v20/target/usr/local/bin
cd /你的解压目录/主程序
npm install && npm run build && npm start
```

飞牛日常启停 / 更新脚本见 [主程序/node.js20/README.md](主程序/node.js20/README.md)。

---

## 3. Docker 安装

适合已熟悉 Docker、希望 **MySQL + 应用** 一起容器化部署的环境。文件均在 [`主程序/docker/`](主程序/docker/) 目录。

### Windows

1. 安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. 进入 **`主程序/docker`** 文件夹，双击 **`install.bat`**
3. 浏览器：http://127.0.0.1:17890/
4. 清空重装：双击 **`reset.bat`**，输入 `YES`

### macOS / Linux

```bash
cd 主程序/docker
chmod +x install.sh reset.sh import.sh gen-env.sh
./install.sh
```

Linux 未装 Docker 时可先执行：`curl -fsSL https://get.docker.com | sh`

### 常用 Docker 命令（在 `主程序/` 目录）

```bash
npm run docker:up       # 构建并启动
npm run docker:down     # 停止
npm run docker:logs     # 查看日志
npm run docker:import   # 导入 ./data 到 MySQL
```

NAS 上若需扫局域网打印机，优先用 **Node 直装** 或 **一键 fpk/spk**；Docker 网络配置见 [主程序/docker/README.md](主程序/docker/README.md)、[主程序/ops/docs/INSTALL.md](主程序/ops/docs/INSTALL.md)。

---

## 4. 功能与品牌

监控与控制、耗材、打印审核队列、用户权限 / 按设备授权、监控墙与区域摄像头、代打报价、模型 / AI 入口、告警、**主题包**（含整站 `siteMode: full`）、**插件**（钩子 / 槽位 / 微内核 v2）、**应用集市**一键安装等。

**应用集市**：默认 [http://124.221.92.32:3001](http://124.221.92.32:3001/)（可用 `MARKET_BASE_URL` 覆盖）。

常见品牌协议：Klipper/Moonraker、拓竹、创想、Elegoo、Anycubic、Snapmaker、闪铸等。  
纯网页版由 **服务端** 连接打印机，请保证部署机与打印机网络可达。

---

## 5. 文档

| 文档 | 内容 |
|------|------|
| [INSTALL.md](主程序/ops/docs/INSTALL.md) | 分平台详细安装（一键包 + Node + Docker） |
| [node.js20/README.md](主程序/node.js20/README.md) | 飞牛 NAS Node 运维脚本 |
| [NODE_DEPLOY.md](主程序/ops/docs/NODE_DEPLOY.md) | Node 生产部署 |
| [MYSQL.md](主程序/ops/docs/MYSQL.md) | MySQL |
| [BAOTA.md](主程序/ops/docs/BAOTA.md) | 宝塔面板 |

---

## License

MIT
