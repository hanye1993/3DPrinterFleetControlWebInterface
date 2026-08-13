#!/usr/bin/env bash
# Wipe Docker volumes + repo data/, then reinstall
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

echo "========================================"
echo " hanye 监控台 · Docker 清空重装"
echo "========================================"
echo ""
echo " 将删除："
echo "   - Docker 容器与 MySQL 数据卷"
echo "   - 仓库 data/ 业务数据（保留空目录）"
echo "   - docker/.env（随后重新生成随机密码）"
echo ""
read -r -p "确认清空并重装？输入 YES 继续: " CONFIRM
if [ "$CONFIRM" != "YES" ]; then
  echo "已取消。"
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] 未检测到 Docker。" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[错误] 需要 docker compose。" >&2
  exit 1
fi

echo "[..] 停止并删除容器 + MySQL 卷…"
"${COMPOSE[@]}" down -v --remove-orphans || true

rm -f "$DOCKER_DIR/.env"
mkdir -p "$REPO_ROOT/data"
find "$REPO_ROOT/data" -mindepth 1 ! -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true

bash "$DOCKER_DIR/gen-env.sh"

echo "[..] 重新构建并启动…"
"${COMPOSE[@]}" up -d --build

echo ""
echo "========================================"
echo " 已清空并重装完成"
echo " 浏览器打开: http://127.0.0.1:17890/"
echo " 登录账号: admin / admin123  （请立即改密）"
echo "========================================"
