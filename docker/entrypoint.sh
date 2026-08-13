#!/bin/sh
set -eu

echo "[entrypoint] hanye printer monitor starting…"

MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-hanye}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-}"
MYSQL_DATABASE="${MYSQL_DATABASE:-hanye_printer}"
DATA_ROOT="${DATA_ROOT:-/app/data}"
WAIT_MYSQL_SECONDS="${WAIT_MYSQL_SECONDS:-120}"
AUTO_IMPORT="${AUTO_IMPORT:-1}"
IMPORT_FORCE="${IMPORT_FORCE:-0}"

mkdir -p "$DATA_ROOT"

wait_mysql() {
  echo "[entrypoint] Waiting for MySQL at ${MYSQL_HOST}:${MYSQL_PORT}…"
  i=0
  while [ "$i" -lt "$WAIT_MYSQL_SECONDS" ]; do
    if node -e "
const net = require('net');
const s = net.connect({ host: process.env.MYSQL_HOST || 'mysql', port: Number(process.env.MYSQL_PORT || 3306) });
s.on('connect', () => { s.end(); process.exit(0); });
s.on('error', () => process.exit(1));
setTimeout(() => process.exit(1), 2000);
" 2>/dev/null; then
      # TCP open — try an actual mysql handshake via mysql2
      if node -e "
const mysql = require('mysql2/promise');
(async () => {
  try {
    const c = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'mysql',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'hanye',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'hanye_printer',
      connectTimeout: 3000
    });
    await c.query('SELECT 1');
    await c.end();
    process.exit(0);
  } catch (e) {
    process.exit(1);
  }
})();
" 2>/dev/null; then
        echo "[entrypoint] MySQL is ready"
        return 0
      fi
    fi
    i=$((i + 2))
    sleep 2
  done
  echo "[entrypoint] ERROR: MySQL not ready after ${WAIT_MYSQL_SECONDS}s" >&2
  exit 1
}

has_importable_data() {
  [ -f "$DATA_ROOT/users.json" ] \
    || [ -f "$DATA_ROOT/devices.json" ] \
    || [ -f "$DATA_ROOT/app-settings.json" ] \
    || [ -f "$DATA_ROOT/filament-spools.json" ] \
    || [ -f "$DATA_ROOT/monitor-zones.json" ] \
    || [ -f "$DATA_ROOT/print-requests.json" ] \
    || [ -f "$DATA_ROOT/quote-history.json" ] \
    || [ -f "$DATA_ROOT/quote-schemes.json" ] \
    || [ -f "$DATA_ROOT/secrets.json" ] \
    || [ -f "$DATA_ROOT/operation-logs.jsonl" ]
}

marker="$DATA_ROOT/.mysql-imported"

if [ "${USE_MYSQL:-1}" = "1" ]; then
  wait_mysql
  if [ "$AUTO_IMPORT" = "1" ] && has_importable_data; then
    if [ "$IMPORT_FORCE" = "1" ] || [ ! -f "$marker" ]; then
      echo "[entrypoint] Importing JSON from DATA_ROOT into MySQL…"
      node /app/ops/scripts/import-mysql.mjs
      touch "$marker"
      echo "[entrypoint] Import finished"
    else
      echo "[entrypoint] Skip import (already imported; set IMPORT_FORCE=1 to re-run)"
    fi
  else
    echo "[entrypoint] No local JSON to import (fresh install — schema applied on app start)"
  fi
fi

export USE_MYSQL="${USE_MYSQL:-1}"
export PORT="${PORT:-17890}"
export DATA_ROOT

echo "[entrypoint] Starting Node server on port ${PORT}"
exec node /app/dist/server/server/nodeServer.js
