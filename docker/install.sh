#!/usr/bin/env bash
# One-click Docker install — run from anywhere; always uses this docker/ folder
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

echo "========================================"
echo " hanye 3D 监控台 · Docker 一键安装"
echo "========================================"
echo " 目录: $DOCKER_DIR"
echo " 纯网页版：电脑 / 手机浏览器打开即可"
echo " 网页登录 = 用户名 + 密码（无需 API 密钥）"
echo ""
echo " 若需清空旧数据重装，请改用 ./reset.sh"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] 未检测到 Docker。请先安装 Docker Desktop 或 Docker Engine。" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[错误] 需要 docker compose 插件或 docker-compose。" >&2
  exit 1
fi

bash "$DOCKER_DIR/gen-env.sh"
mkdir -p "$REPO_ROOT/data"

echo "[..] 构建并启动 MySQL + 网页服务（首次较慢）…"
"${COMPOSE[@]}" up -d --build

echo ""
echo "========================================"
echo " 安装完成"
echo " 浏览器打开: http://127.0.0.1:17890/"
echo " 登录账号: admin / admin123  （请立即改密）"
echo ""
echo " 旧数据导入: 把 JSON 放到仓库 data/ 后运行 ./import.sh"
echo " 清空重装:   ./reset.sh（输入 YES）"
echo " NAS 扫打印机: docker compose -f docker-compose.fnos.yml up -d --build"
echo "========================================"
