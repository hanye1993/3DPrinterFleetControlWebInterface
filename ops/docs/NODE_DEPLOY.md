# 网页部署（Node + MySQL）

纯网页版 — 电脑与手机浏览器访问同一地址。管理员进管理台，普通用户进工作台。

> 插件开发见 [PLUGIN.md](./PLUGIN.md)；主题见 [THEME.md](./THEME.md)；宝塔见 [BAOTA.md](./BAOTA.md)。

## 1) 准备 MySQL（可选，生产推荐）

```sql
CREATE DATABASE hanye_printer CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
```

表结构：`ops/sql/schema.sql`（启动时 `runSchemaMigration` 可自动执行）。  
也可：`npm run setup:mysql`（见 `ops/scripts`）。

### 1.1 环境变量

| Variable | Required | Description |
|----------|----------|-------------|
| `USE_MYSQL` | 生产建议 | `1` |
| `MYSQL_HOST` | MySQL 时 | e.g. `127.0.0.1` |
| `MYSQL_PORT` | no | Default `3306` |
| `MYSQL_USER` | MySQL 时 | DB user |
| `MYSQL_PASSWORD` | MySQL 时 | DB password |
| `MYSQL_DATABASE` | MySQL 时 | e.g. `hanye_printer` |
| `SECRETS_MASTER_KEY` | MySQL 时 | 设备密钥 AES 主密钥 |
| `DATA_ROOT` | no | 插件/主题包目录（默认 `./data`） |
| `PORT` | no | 默认 `17890` |

`USE_MYSQL=1` 时：业务可写数据进 MySQL。  
插件 / 主题的 **JS/CSS/HTML 包**仍在 `DATA_ROOT/plugins/`、`DATA_ROOT/themes/`。

未开 MySQL 时使用 `DATA_ROOT` 下 JSON 文件存储（适合本机试用）。

### 1.2 从旧 JSON 导入

把旧数据放到 `DATA_ROOT`（默认 `./data`）后：

```bash
export USE_MYSQL=1
export MYSQL_HOST=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=hanye
export MYSQL_PASSWORD=你的密码
export MYSQL_DATABASE=hanye_printer
export SECRETS_MASTER_KEY=与运行一致
npm run import:mysql
```

## 2) 构建运行

```bash
npm install
npm run build
npm start
```

打开：`http://主机:17890/`

默认管理员：**admin / admin123** — 请立即改密。

## 3) PM2 示例

```bash
pm2 start dist/server/server/nodeServer.js --name hanye-web
pm2 save
```
