# 宝塔面板安装指南

在 **宝塔（BT Panel）** 上部署 hanye 纯网页版。

- 端口：**17890**
- 默认登录：**admin** / **admin123**（请立即改密）

---

## 安装前准备

1. 已安装宝塔面板（Linux）。
2. 软件商店安装：**Nginx**、**MySQL**（建议 8.0）、**Node.js 20.x**；可选 **PM2 管理器**。
3. 打印机与服务器网络可达。
4. 防火墙 / 安全组放行 **17890**（或仅用 Nginx 反代时放行 80/443）。

---

## 1. 创建数据库

宝塔 → **数据库** → 添加：

- 数据库名：`hanye_printer`
- 用户名：例如 `hanye`
- 密码：强密码
- 字符集：`utf8mb4`

```sql
CREATE DATABASE hanye_printer CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```

表结构由程序启动时自动迁移（`ops/sql/schema.sql`）。

---

## 2. 部署源码

```bash
cd /www/wwwroot
git clone https://github.com/hanye1993/3DPrinterFleetControlWebInterface.git hanye
cd hanye
npm install
npm run build
mkdir -p data
```

确认存在：

- `dist/web/`（前端）
- `dist/server/server/nodeServer.js`（后端）

---

## 3. 环境变量

```bash
export USE_MYSQL=1
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=hanye
export MYSQL_PASSWORD='你的数据库密码'
export MYSQL_DATABASE=hanye_printer
export SECRETS_MASTER_KEY='请换成很长的随机字符串'
export PORT=17890
export DATA_ROOT=/www/wwwroot/hanye/data
```

生成密钥：`openssl rand -hex 32`

也可复制 `.env.example` 为 `.env` 后填写。

---

## 4. 用 PM2 启动

```bash
cd /www/wwwroot/hanye
pm2 start dist/server/server/nodeServer.js --name hanye-web
pm2 save
pm2 startup
```

宝塔 **PM2 管理器**：

- 项目路径：`/www/wwwroot/hanye`
- 启动文件：`dist/server/server/nodeServer.js`
- 环境变量填入上一节

验证：

```bash
curl -fsS http://127.0.0.1:17890/api/health
```

浏览器：`http://服务器IP:17890/`

---

## 5. 更新

```bash
cd /www/wwwroot/hanye
git pull
npm install
npm run build
pm2 restart hanye-web
```

---

## 6. 旧 JSON 导入（可选）

旧版 `users.json`、`devices.json` 等放到 `DATA_ROOT` 后：

```bash
cd /www/wwwroot/hanye
npm run import:mysql
```

详见 [NODE_DEPLOY.md](./NODE_DEPLOY.md)。

---

## Nginx 反向代理

宝塔 → **网站** → 添加站点 → **反向代理**：

- 目标 URL：`http://127.0.0.1:17890`
- 发送域名：`$host`

如需 WebSocket / SSE，在站点配置中保留 Upgrade 相关头（宝塔反代模板一般已带）。

启用 HTTPS：站点 → SSL → 申请证书。

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 打不开页面 | `pm2 status` / 日志；端口与防火墙 |
| `api/health` 失败 | MySQL 是否就绪、环境变量是否正确 |
| 搜不到打印机 | 服务器与打印机同网段；可设 `LAN_SCAN_SUBNETS` |
| 忘记库密码 | 查 `.env`；勿丢失 `SECRETS_MASTER_KEY` |

更多： [NODE_DEPLOY.md](./NODE_DEPLOY.md)、[MYSQL.md](./MYSQL.md)、根目录 [README.md](../README.md)。
