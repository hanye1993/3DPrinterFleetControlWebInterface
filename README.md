# hanye · 3D 打印机监控台（纯网页）

统一监控与控制多品牌 **FDM / 光固化** 3D 打印机。电脑、手机浏览器打开同一地址即可。

| 项目 | 说明 |
|------|------|
| 版本 | **4.1.9** |
| 许可 | MIT |
| 默认端口 | **17890** |
| 默认管理员 | **admin** / **admin123**（登录后请立刻改密） |

- **管理员** → 管理台全功能（用户、设备、设置、主题、插件等）
- **普通用户** → 按权限的工作台

---

## 目录

1. [快速开始（源码）](#1-快速开始源码)
2. [安装指南（Win / Mac / Linux / NAS）](#2-安装指南)
3. [功能与品牌](#3-功能与品牌)
4. [项目结构](#4-项目结构)
5. [常用命令](#5-常用命令)
6. [文档](#6-文档)

👉 **代码仓库（三端同步）**

| 平台 | 地址 |
|------|------|
| GitHub | https://github.com/hanye1993/3DPrinterFleetControlWebInterface |
| Gitee | https://gitee.com/hanye11/3DPrinterFleetControlWebInterface |
| GitCode | https://gitcode.com/hanye6666/3DPrinterFleetControlWebInterface |

用户在「软件设置 → 关于」里可选上述任一平台检查 / 下载更新（默认 Gitee，国内更稳）。

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

## 2. 安装指南

**两种安装方式**（Node 直装 / Docker），分 **Windows、macOS、Linux、NAS** 逐步说明：

👉 **[ops/docs/INSTALL.md](ops/docs/INSTALL.md)**（**推荐 Node 直装**，NAS 扫打印机更省事）

Docker 一键脚本仍在 **[`docker/`](docker/)**（`install.bat` / `install.sh`）。

---

## 3. 功能与品牌

监控与控制、耗材、打印审核队列、用户权限 / 按设备授权、监控墙与区域摄像头、代打报价、模型 / AI 入口、告警、**主题包**（含整站 `siteMode: full`）、**插件**（钩子 / 槽位 / 微内核 v2）、**应用集市**一键安装等。

**应用集市**：默认 [http://sc1.dpfrp.top:3000](http://sc1.dpfrp.top:3000/)（可用 `MARKET_BASE_URL` 覆盖）。管理员在「软件设置 → 应用集市」浏览并安装；插件 / 主题开发文档与示例见 [http://sc1.dpfrp.top:3000/docs](http://sc1.dpfrp.top:3000/docs)。

常见品牌协议：Klipper/Moonraker、拓竹、创想、Elegoo、Anycubic、Snapmaker、闪铸等。  
纯网页版由 **服务端** 连接打印机，请保证部署机与打印机网络可达。

---

## 4. 项目结构

```
├── src/                 # 源码（web React + Node 服务）
├── assets/              # 内置主题 / 插件 / 示例 / yolo
├── ops/                 # sql · scripts · docs
├── config/              # Vite / TypeScript
├── data/                # 运行时数据（勿提交）
├── dist/                # 构建产物
├── docker/              # Docker 安装（一键脚本 / compose / Dockerfile）
├── node.js20/           # 飞牛 NAS Node 20 直装：启停 / 自启 / 更新后 rebuild（见该目录 README）
├── package.json
└── README.md
```

---

## 5. 常用命令

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

## 6. 文档

| 文档 | 内容 |
|------|------|
| [INSTALL.md](ops/docs/INSTALL.md) | **安装指南（Win / Mac / Linux / NAS，Node + Docker）** |
| [node.js20/README.md](node.js20/README.md) | 飞牛 NAS Node 20 启停 / 自启 / 更新后重建脚本 |
| [NODE_DEPLOY.md](ops/docs/NODE_DEPLOY.md) | 无 Docker 的 Node 部署 |
| [MYSQL.md](ops/docs/MYSQL.md) | MySQL |
| [BAOTA.md](ops/docs/BAOTA.md) | 宝塔 |

插件 / 主题开发文档与官方示例请到应用集市查看： [http://sc1.dpfrp.top:3000/docs](http://sc1.dpfrp.top:3000/docs)。

---

## License

MIT
