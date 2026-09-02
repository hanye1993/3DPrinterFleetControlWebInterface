# 安装指南（Windows / macOS / Linux / NAS）

hanye 3D 打印机监控台支持 **两种安装方式**。默认端口 **17890**，登录 **admin / admin123**（请立刻改密）。

| 方式 | 说明 | 推荐场景 |
|------|------|----------|
| **方式一：Node 直装（推荐）** | 本机装 Node.js 20+，数据默认在 `./data`（JSON） | 家里电脑、飞牛/群晖 NAS、Linux 服务器；**扫局域网打印机更省事** |
| **方式二：Docker** | `docker/` 一键脚本，MySQL + 应用容器 | 不想装 Node、或习惯容器运维的环境 |

---

## 方式一：Node 直装（推荐）

**优点：** 不依赖 Docker；NAS 上扫打印机、连拓竹局域网通常更稳定；占用更小。  
**数据：** 默认 `./data` 目录（JSON），生产可开 MySQL（见 [NODE_DEPLOY.md](./NODE_DEPLOY.md)）。

### 通用步骤（所有平台）

1. 安装 **Node.js 20+**（含 npm）
2. 获取源码：GitHub 克隆，或解压 `hanye-printer-monitor-x.x.x-src.zip`
3. 在项目根目录执行：

```bash
npm install
npm run build
mkdir -p data
cp .env.example .env    # 按需编辑
npm start
```

4. 浏览器打开：`http://本机IP:17890/`

**.env 最小配置（试用）：**

```env
PORT=17890
DATA_ROOT=./data
LAN_SCAN_SUBNETS=192.168.1    # 改成你的网段，如 192.168.10
```

**生产可选 MySQL：** 见 [NODE_DEPLOY.md](./NODE_DEPLOY.md)。

---

### Windows

**推荐：一键安装包（无需单独装 Node）**

1. 双击 `packages/windows-4.3.1-amd64.exe`（需管理员权限；Win10/11 64 位）
2. 选择安装目录（默认 `C:\Program Files\HanyeMonitor`，可改到 D 盘等）
3. 确认后开始安装；控制面板可启停服务
4. 访问 http://127.0.0.1:17890/ ，默认 **admin / admin123**

开发者打包：`npm run pack:win`（产物在 `packages/`）。详见 [packages-src/win/README.md](../packages-src/win/README.md)。

---

**手动 Node 直装（开发调试）**

1. 安装 [Node.js 20 LTS](https://nodejs.org/)（勾选 Add to PATH）
2. 解压源码到例如 `D:\hanye-printer-monitor`
3. **PowerShell** 或 **CMD**：

```powershell
cd D:\hanye-printer-monitor
npm install
npm run build
mkdir data
copy .env.example .env
npm start
```

4. 浏览器：http://127.0.0.1:17890/
5. 手机同 WiFi：`http://电脑局域网IP:17890/`

**长期运行（可选）：** 用 [PM2 for Windows](https://pm2.keymetrics.io/) 或「任务计划程序」开机执行 `npm start`。

**局域网扫描：** 在 `.env` 填 `LAN_SCAN_SUBNETS=192.168.x`；扫不到就网页里 **手动填 IP 添加** 打印机。

---

### macOS

**推荐：一键安装包（无需单独装 Node）**

| 芯片 | 安装包 |
|------|--------|
| Apple Silicon（M 系列） | `packages/macos-4.3.1-arm64.dmg` |
| Intel | `packages/macos-4.3.1-amd64.dmg` |

1. 打开对应 DMG，双击 `install.command`
2. 浏览器访问 http://127.0.0.1:17890/ ，默认 **admin / admin123**

开发者打包：`npm run pack:mac`（同时产出 arm64 + x64）。详见 [packages-src/mac/README.md](../packages-src/mac/README.md)。

---

**手动 Node 直装（开发调试）**

1. 安装 Node：`brew install node@20` 或从 [nodejs.org](https://nodejs.org/) 安装
2. 终端进入项目目录：

```bash
cd ~/hanye-printer-monitor
npm install
npm run build
mkdir -p data
cp .env.example .env
npm start
```

3. 浏览器：http://127.0.0.1:17890/

**长期运行：**

```bash
npm install -g pm2
pm2 start dist/server/server/nodeServer.js --name hanye-web
pm2 save
pm2 startup    # 按提示执行一条 sudo 命令
```

---

### Linux（云服务器 / 台式机）

**推荐：一键安装包（无需单独装 Node）**

| 系统 | 安装包 | 安装命令 |
|------|--------|----------|
| Ubuntu / Debian（x86_64） | `ubuntu-4.3.1-amd64.deb` | `sudo dpkg -i ubuntu-*-amd64.deb` |
| CentOS / RHEL / Rocky（x86_64） | `centos-4.3.1-amd64.rpm` | `sudo yum install ./centos-*-amd64.rpm` |
| ARM64 服务器 | 文件名带 `arm64` 的 deb/rpm | 同上 |

安装后访问 http://127.0.0.1:17890/ ，默认 **admin / admin123**。服务名 `hanyemonitor`，配置 `/opt/hanye-printer-monitor/app.env`。

开发者打包：`npm run pack:linux`。详见 [packages-src/linux/README.md](../packages-src/linux/README.md)。

---

**手动 Node 直装（开发调试）**

1. 安装 Node 20+（发行版包管理或 [nvm](https://github.com/nvm-sh/nvm)）
2. 部署源码：

```bash
cd /opt/hanye-printer-monitor
npm install
npm run build
mkdir -p data
cp .env.example .env
# 编辑 .env；生产建议 USE_MYSQL=1，见 NODE_DEPLOY.md
```

3. **PM2 常驻：**

```bash
npm install -g pm2
pm2 start dist/server/server/nodeServer.js --name hanye-web
pm2 save
pm2 startup
```

4. 防火墙放行 **TCP 17890**

宝塔面板逐步说明：[BAOTA.md](./BAOTA.md)（PM2 + Nginx 反代）。

---

### NAS（飞牛 fnOS / 群晖等）

**推荐 Node 直装**：Docker 在 NAS 里扫局域网打印机常需 host 网络，配置更麻烦。

#### 1. 安装 Node.js

- **飞牛：** 应用中心安装 **Node.js v20** → 手动安装对应架构 `.fpk`（x86 NAS 用 `*-x86.fpk`，ARM/R 系列用 `*-arm.fpk`；见 `packages-src/fnos/README.md`，`npm run pack:fnos`）
- **群晖：** 套件中心安装 **Node.js 20/22** → 可用手动安装 `.spk`（见 `packages-src/syno/README.md`，`npm run pack:syno`）

#### 群晖 DSM 套件（`.spk`）

1. 套件中心先装 **Node.js 20** 或 **22**
2. 本机打包：`npm run pack:syno`（ARM 机型：`SPK_ARCH=aarch64 bash ops/scripts/pack-syno-spk.sh`）
3. DSM → 套件中心 → **手动安装** → 选 `packages/syno-4.3.1-x86_64.spk`（或对应架构）
4. 启动套件后访问 `http://NAS:17890`，默认 **admin / admin123**
5. 网段等配置：`/var/packages/hanyemonitor/etc/app.env` 里改 `LAN_SCAN_SUBNETS`

#### 2. 上传并解压源码（Node 直装，非 SPK）

例如：`/vol2/1000/3d/hanye-printer-monitor-4.0.10`

#### 3. SSH 构建

**飞牛注意：** 应用中心装的 Node 默认不在 SSH PATH 里，先执行：

```bash
export PATH=/var/apps/nodejs_v20/target/bin:$PATH
# 若目录名不同：ls /var/apps/ | grep node
echo 'export PATH=/var/apps/nodejs_v20/target/bin:$PATH' >> ~/.bashrc
```

然后：

```bash
cd /vol2/1000/3d/hanye-printer-monitor-4.0.10
npm install
npm run build
mkdir -p data
cp .env.example .env
nano .env
```

`.env` 示例：

```env
PORT=17890
DATA_ROOT=./data
LAN_SCAN_SUBNETS=192.168.10
```

#### 4. 启动脚本（仓库 [`node.js20/`](../../node.js20/) 目录）

面向飞牛等 **Node.js 20 直装** 环境：启停、开机自启、网页更新后的 rebuild。说明见 [`node.js20/README.md`](../../node.js20/README.md) 与同目录 `自启说明.txt`。

| 脚本 | 作用 |
|------|------|
| `start-hanye.sh` | 启动服务 |
| `stop-hanye.sh` | 停止服务 |
| `update-hanye.sh` | 网页更新后 build + 重启 |

```bash
chmod +x /home/hanye/start-hanye.sh /home/hanye/stop-hanye.sh /home/hanye/update-hanye.sh
/home/hanye/start-hanye.sh
```

浏览器：`http://NAS的IP:17890/`

#### 5. 飞牛开机自启（root 计划任务）

```bash
sudo -i
crontab -l 2>/dev/null | grep -v start-hanye; echo "@reboot sleep 60 && su - hanye -c '/home/hanye/start-hanye.sh' >> /home/hanye/hanye-start.log 2>&1" | crontab -
crontab -l
exit
```

#### 6. 软件设置里在线更新

1. 网页：**软件设置 → 关于 → 检查更新 → 更新**（会下载覆盖源码，保留 `data/`）
2. SSH：`/home/hanye/update-hanye.sh`

> Node 直装 **不会** 像 Docker 那样自动 rebuild 容器；更新后必须执行 `update-hanye.sh`（或手动 `npm run build` + 重启）。

---

## 方式二：Docker 安装

所有文件在仓库 **`docker/`** 目录。会启动 **mysql + app** 两个容器。

详细文件说明：[docker/README.md](../docker/README.md)。

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

Linux 未装 Docker：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # 重新登录
```

### NAS（飞牛 / 群晖）

```bash
cd <仓库目录>/docker
chmod +x install.sh gen-env.sh
./gen-env.sh          # 生成 docker/.env
./install.sh
```

- 浏览器：`http://NAS的IP:17890/`
- **Compose 项目路径必须选 `docker/` 文件夹**（不要选仓库根目录）
- **扫不到局域网打印机：**
  1. 编辑 `docker/.env`：`LAN_SCAN_SUBNETS=192.168.x`
  2. 使用 host 网络编排：

```bash
cd docker
docker compose -f docker-compose.fnos.yml up -d --build
```

### Docker 常用命令

```bash
cd docker
docker compose ps
docker compose logs -f app
docker compose down
docker compose up -d --build
./import.sh          # 旧 JSON → MySQL
./reset.sh           # 清空重装
```

### Docker 在线更新

软件设置 **关于 → 更新**：会覆盖宿主机源码；若 compose 已挂载 **docker.sock**，可自动重建容器。  
否则需手动：`docker compose up -d --build`。

---

## 两种方式怎么选

| 场景 | 推荐 |
|------|------|
| 飞牛 / 群晖 NAS，要扫局域网打印机 | **Node 直装** |
| 家里 Windows / Mac 长期开着监控 | **Node 直装** 或 Docker 均可 |
| 云 Linux，熟悉 PM2 | **Node 直装** |
| 不想装 Node，只要一键环境 | **Docker** |
| 本机开发调试 | `npm run build && npm start` |

---

## 打包与上传

本机打源码包（不含 node_modules）：

```bash
npm run pack:source
# 输出：hanye-printer-monitor-<版本>-src.zip
```

NAS 辅助脚本目录：**`NAS上传/`**（含 zip、启动/更新脚本说明）。

---

## 排错

| 现象 | Node 直装 | Docker |
|------|-----------|--------|
| 打不开 17890 | `pm2 status` / 是否执行 start 脚本；防火墙 | `docker compose logs -f app` |
| 飞牛 `node: command not found` | `export PATH=/var/apps/nodejs_v20/target/bin:$PATH` | — |
| 扫不到打印机 | `.env` 里 `LAN_SCAN_SUBNETS`；手动加 IP | `LAN_SCAN_SUBNETS` + `docker-compose.fnos.yml` |
| 关于里更新后版本不变 | 执行 `update-hanye.sh` | `docker compose up -d --build` |
| MySQL 启动失败 | 可先用 JSON 模式（不开 USE_MYSQL） | `./recreate-db.sh` |

---

## 相关文档

| 文档 | 内容 |
|------|------|
| [NODE_DEPLOY.md](./NODE_DEPLOY.md) | MySQL、环境变量 |
| [BAOTA.md](./BAOTA.md) | 宝塔 + PM2 |
| [MYSQL.md](./MYSQL.md) | 数据库细节 |
| [README.md](../README.md) | 项目总览 |
