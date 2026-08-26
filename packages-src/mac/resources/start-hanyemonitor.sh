#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PORT="${PORT:-17890}"
export DATA_ROOT="${DATA_ROOT:-$ROOT/data}"
export USE_MYSQL="${USE_MYSQL:-0}"
export NODE_ENV="${NODE_ENV:-production}"
export LAN_SCAN_SUBNETS="${LAN_SCAN_SUBNETS:-192.168.1}"
export LICENSE_REQUIRED="${LICENSE_REQUIRED:-0}"

if [ -f "$ROOT/app.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/app.env" || true
  set +a
fi

# 空 DATA_ROOT 回退（避免 app.env 写 DATA_ROOT= 覆盖）
if [ -z "${DATA_ROOT:-}" ]; then
  export DATA_ROOT="$ROOT/data"
fi
if [ -z "${PORT:-}" ]; then
  export PORT=17890
fi

mkdir -p "$DATA_ROOT"
xattr -cr "$ROOT" 2>/dev/null || true

NODE_BIN="$ROOT/node/bin/node"
ENTRY="$ROOT/app/dist/server/server/nodeServer.js"
PLIST="$HOME/Library/LaunchAgents/com.hanye.hanyemonitor.plist"

if [ -x "$NODE_BIN" ] && [ -f "$ENTRY" ]; then
  if [ -f "$PLIST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
    launchctl kickstart -k "gui/$(id -u)/com.hanye.hanyemonitor" 2>/dev/null || true
    sleep 2
  fi
  if ! curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    (
      cd "$ROOT/app"
      nohup "$NODE_BIN" "$ENTRY" >>"$DATA_ROOT/service.log" 2>>"$DATA_ROOT/service-error.log" &
    )
    sleep 2
  fi
fi

open "http://127.0.0.1:${PORT}/"
