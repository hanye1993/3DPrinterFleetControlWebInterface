# Docker 安装（本目录自包含）

在本目录操作即可，无需到仓库根目录找脚本。

## 一键安装

```bash
cd docker
chmod +x install.sh reset.sh import.sh gen-env.sh
./install.sh
```

Windows：进入本目录，双击 **`install.bat`**。

打开 http://127.0.0.1:17890/ ，登录 **admin / admin123**（请立刻改密）。

## 本目录文件

| 文件 | 作用 |
|------|------|
| `install.sh` / `install.bat` | 一键安装 |
| `reset.sh` / `reset.bat` | 清空数据重装 |
| `import.sh` / `import.bat` | 把仓库 `data/` 旧 JSON 导入 MySQL |
| `gen-env.sh` / `gen-env.bat` | 生成 `docker/.env` |
| `docker-compose.yml` | 默认编排（电脑 / 服务器） |
| `docker-compose.fnos.yml` | NAS host 网络（扫打印机） |
| `Dockerfile` | 应用镜像 |
| `entrypoint.sh` | 容器启动 |

业务数据在仓库根目录 **`../data`**；密钥在 **`docker/.env`**（勿提交）。

软件设置「更新」：容器会把新源码写到挂载的 **`/host-repo`（即仓库根目录）**，然后需在飞牛里 **重新构建并启动** 才进容器。

## 常用命令

```bash
cd docker
docker compose ps
docker compose logs -f app
docker compose down
docker compose up -d --build
# NAS：
docker compose -f docker-compose.fnos.yml up -d --build
```

更完整的平台说明见仓库根目录 [README.md](../README.md) 第 2 节。
