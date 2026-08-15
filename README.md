# hanye · 3D 打印机监控台（纯网页）

统一监控与控制多品牌 **FDM / 光固化** 3D 打印机。电脑、手机浏览器打开同一地址即可。

| 项目 | 说明 |
|------|------|
| 版本 | **2.0.0** |
| 许可 | MIT |
| 默认端口 | **17890** |
| 默认管理员 | **admin** / **admin123**（登录后请立刻改密） |

- **管理员** → 管理台全功能（用户、设备、设置、主题、插件等）
- **普通用户** → 按权限的工作台

---

## 目录

1. [快速开始（源码）](#1-快速开始源码)
2. [Docker 安装](#2-docker-安装)
3. [部署怎么选](#3-部署怎么选)
4. [功能与品牌](#4-功能与品牌)
5. [项目结构](#5-项目结构)
6. [常用命令](#6-常用命令)
7. [文档](#7-文档)

---

## 1. 快速开始（源码）

环境：Node.js **20+**。本机试用可不启用 MySQL（数据在 `./data` JSON）。

```bash
npm install
npm run build
npm start
```

打开：http://127.0.0.1:17890/

生产建议开启 MySQL（环境变量见 [ops/docs/NODE_DEPLOY.md](ops/docs/NODE_DEPLOY.md)）：

```bash
export USE_MYSQL=1
export MYSQL_HOST=127.0.0.1
export MYSQL_USER=hanye
export MYSQL_PASSWORD=你的密码
export MYSQL_DATABASE=hanye_printer
export SECRETS_MASTER_KEY=长随机串
npm start
```

宝塔面板逐步说明：[ops/docs/BAOTA.md](ops/docs/BAOTA.md)。

---

## 2. Docker 安装

所有 Docker 相关文件都在 **[`docker/`](docker/)** 目录，进入该目录即可安装（说明见 [`docker/README.md`](docker/README.md)）。

会启动两个容器：**mysql** + **app**（端口默认 **17890**）。

网页登录只用 **用户名 + 密码**；`docker/.env` 里的密钥给数据库 / 设备加密用。

### 2.1 Windows 电脑

1. 安装并启动 [Docker Desktop](https://www.docker.com/products/docker-desktop/)。  
2. 打开仓库里的 **`docker`** 文件夹，双击 **`install.bat`**。  
3. 浏览器打开 http://127.0.0.1:17890/ ，登录 **admin / admin123**，立刻改密。  
4. 手机用电脑局域网 IP，例如 `http://192.168.1.10:17890/`。

清空重装：在 `docker/` 里双击 **`reset.bat`**，输入 `YES`。

### 2.2 macOS / Linux / NAS（SSH）

```bash
cd docker
chmod +x install.sh reset.sh import.sh gen-env.sh
./install.sh
```

打开 http://127.0.0.1:17890/ （服务器放行 **TCP 17890**）。

Linux 若未装 Docker：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # 重新登录后再用 docker
```

### 2.3 飞牛 NAS（fnOS）

```bash
cd /vol1/1000/docker   # 按共享目录修改
git clone <本仓库地址>
cd <仓库目录>/docker
chmod +x install.sh gen-env.sh
./install.sh
```

浏览器：`http://NAS的IP:17890/`。

图形界面：Compose 项目目录选仓库的 **`docker/`**（含 `docker-compose.yml`），先执行 `./gen-env.sh` 生成 `.env`。

**搜不到局域网打印机：**

1. 确认网段（如 `192.168.1.23` → `192.168.1`）。  
2. 编辑 **`docker/.env`**：`LAN_SCAN_SUBNETS=192.168.1`  
3. 在 `docker/` 下使用 host 网络编排：

```bash
cd docker
docker compose -f docker-compose.fnos.yml up -d --build
```

仍搜不到时可在网页里 **手动添加** 打印机 IP。

### 2.4 群晖 NAS（Synology）

```bash
cd /volume1/docker/<仓库目录>/docker
chmod +x install.sh gen-env.sh
./install.sh
```

或 Container Manager「项目」路径选 **`docker/`**。扫网困难时用 `docker-compose.fnos.yml`，并填写 `LAN_SCAN_SUBNETS`。

### 2.5 宝塔（Docker 方式）

1. 安装 Docker / Docker 管理器。  
2. 源码放到如 `/www/wwwroot/hanye`。  
3. SSH：`cd /www/wwwroot/hanye/docker && ./install.sh`  
4. 可选：反向代理到 `http://127.0.0.1:17890` 并开 HTTPS。  

详见 [ops/docs/BAOTA.md](ops/docs/BAOTA.md)。

### 2.6 常用命令（均在 `docker/` 下执行）

```bash
cd docker
docker compose ps
docker compose logs -f app
docker compose down
docker compose up -d --build
./import.sh          # 仓库 data/ 旧 JSON → MySQL
./reset.sh           # 清空重装（输入 YES）
```

本机有 npm：`npm run docker:up` / `docker:down` / `docker:logs` / `docker:import`。

### 2.7 排错

| 现象 | 建议 |
|------|------|
| 构建失败 | 磁盘/网络；Docker Desktop 是否 Running |
| 健康检查失败 | `cd docker && docker compose logs -f app` |
| 端口占用 | 改 `docker/.env` 的 `PORT=`，重建 |
| NAS 权限 | 给仓库与 `data/` 读写权限 |
| 扫不到打印机 | `LAN_SCAN_SUBNETS` + `docker-compose.fnos.yml` |

---

## 3. 部署怎么选

| 场景 | 推荐 |
|------|------|
| 家里电脑 Windows / Mac | 进入 `docker/` 运行 `install.bat` / `install.sh` |
| 云服务器 / Linux | `cd docker && ./install.sh` 或宝塔 |
| 飞牛 / 群晖 | 同上；扫打印机用 `docker-compose.fnos.yml` |
| 本机开发调试 | `npm run build && npm start`（可不用 MySQL） |

---

## 4. 功能与品牌

监控与控制、耗材、打印审核队列、用户权限 / 按设备授权、监控墙与区域摄像头、代打报价、模型 / AI 入口、告警、**主题包**（含整站 `siteMode: full`）、**插件**（钩子 / 槽位 / 微内核 v2）、**应用市场**一键安装等。

**应用市场**源仓库：[hanye1993/ck3dckkzt11](https://github.com/hanye1993/ck3dckkzt11)（`plugins/`、`themes/` 分目录；每项含 `tu.png`、`js.txt`、同名 `.zip`）。管理员在「软件设置 → 应用市场」浏览并安装。

常见品牌协议：Klipper/Moonraker、拓竹、创想、Elegoo、Anycubic、Snapmaker、闪铸等。  
纯网页版由 **服务端** 连接打印机，请保证部署机与打印机网络可达。

---

## 5. 项目结构

```
├── src/                 # 源码（web React + Node 服务）
├── assets/              # 内置主题 / 插件 / 示例 / yolo
├── ops/                 # sql · scripts · docs
├── config/              # Vite / TypeScript
├── data/                # 运行时数据（勿提交）
├── dist/                # 构建产物
├── docker/              # Docker 安装（一键脚本 / compose / Dockerfile）
├── package.json
└── README.md
```

---

## 6. 常用命令

| 命令 | 说明 |
|------|------|
| `npm run build` | 构建 web + server |
| `npm start` | 启动 17890 |
| `npm run dev` | 构建并启动 |
| `npm run setup:mysql` | 本机 MySQL 辅助 |
| `npm run import:mysql` | JSON → MySQL |
| `npm run docker:up` | Compose 构建启动 |
| `npm run docker:down` | 停止 Compose |
| `npm run docker:logs` | 跟踪 app 日志 |
| `npm run docker:import` | 容器内强制导入 `./data` |

---

## 7. 文档

均在 [`ops/docs/`](ops/docs/)：

| 文档 | 内容 |
|------|------|
| [THEME.md](ops/docs/THEME.md) | 主题开发（skin / full 整站） |
| [PLUGIN.md](ops/docs/PLUGIN.md) | 插件开发 |
| [PLUGIN_KERNEL_V2.md](ops/docs/PLUGIN_KERNEL_V2.md) | 微内核 v2 |
| 应用市场仓库 | [ck3dckkzt11](https://github.com/hanye1993/ck3dckkzt11) |
| [NODE_DEPLOY.md](ops/docs/NODE_DEPLOY.md) | 无 Docker 的 Node 部署 |
| [MYSQL.md](ops/docs/MYSQL.md) | MySQL |
| [BAOTA.md](ops/docs/BAOTA.md) | 宝塔 |

软件设置页也可在线查看主题 / 插件手册。

---

## License

MIT
