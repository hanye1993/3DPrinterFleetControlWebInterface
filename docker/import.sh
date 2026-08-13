#!/usr/bin/env bash
# Re-import ../data JSON into MySQL
set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DOCKER_DIR/.." && pwd)"
cd "$DOCKER_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "[错误] 需要 docker compose" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/data"

if [ ! -f "$REPO_ROOT/data/users.json" ] \
  && [ ! -f "$REPO_ROOT/data/devices.json" ] \
  && [ ! -f "$REPO_ROOT/data/app-settings.json" ]; then
  echo "[提示] 仓库 data/ 下未找到 users.json / devices.json / app-settings.json"
  echo "      请先把旧版数据文件复制到 data/ 后再运行本脚本。"
  exit 1
fi

echo "[..] 强制导入 data/ → MySQL…"
"${COMPOSE[@]}" exec -e IMPORT_FORCE=1 -e AUTO_IMPORT=1 app \
  sh -c 'rm -f /app/data/.mysql-imported; node /app/ops/scripts/import-mysql.mjs; touch /app/data/.mysql-imported'
echo "[OK] 导入完成。可刷新网页查看。"
