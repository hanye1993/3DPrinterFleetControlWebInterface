#!/bin/bash
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="hanye Printer Monitor"
INSTALL_DIR="/Applications/${APP_NAME}"
PLIST_DST="$HOME/Library/LaunchAgents/com.hanye.hanyemonitor.plist"
PORT_DEFAULT="17890"

echo "正在安装 ${APP_NAME} 到 ${INSTALL_DIR} ..."

# 停止可能残留的手动进程
pkill -f "${APP_NAME}/app/dist/server/server/nodeServer.js" 2>/dev/null || true

if [ -d "$INSTALL_DIR" ]; then
  echo "检测到旧版本，先停止服务..."
  if [ -f "$PLIST_DST" ]; then
    launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || launchctl unload "$PLIST_DST" 2>/dev/null || true
  fi
  rm -rf "$INSTALL_DIR"
fi

mkdir -p "$INSTALL_DIR"
ditto "$SRC/${APP_NAME}" "$INSTALL_DIR"

# 清除隔离属性，避免 Gatekeeper 拦截内置 node
xattr -cr "$INSTALL_DIR" 2>/dev/null || true

if [ ! -f "$INSTALL_DIR/app.env" ] && [ -f "$INSTALL_DIR/app.env.example" ]; then
  cp "$INSTALL_DIR/app.env.example" "$INSTALL_DIR/app.env"
fi

# 固定数据目录；忽略 app.env 里空的 DATA_ROOT=
DATA_ROOT="$INSTALL_DIR/data"
PORT="$PORT_DEFAULT"
LAN_SCAN_SUBNETS="192.168.1"
if [ -f "$INSTALL_DIR/app.env" ]; then
  # shellcheck disable=SC1090
  set +u
  source "$INSTALL_DIR/app.env" || true
  set -u
fi
# 空值回退（app.env 里写 DATA_ROOT= 时不能覆盖）
if [ -z "${DATA_ROOT:-}" ]; then
  DATA_ROOT="$INSTALL_DIR/data"
fi
if [ -z "${PORT:-}" ]; then
  PORT="$PORT_DEFAULT"
fi
if [ -z "${LAN_SCAN_SUBNETS:-}" ]; then
  LAN_SCAN_SUBNETS="192.168.1"
fi

mkdir -p "$DATA_ROOT"
chmod +x "$INSTALL_DIR/start-hanyemonitor.sh" "$INSTALL_DIR/stop-hanyemonitor.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/node/bin/node" 2>/dev/null || true

NODE_BIN="$INSTALL_DIR/node/bin/node"
ENTRY="$INSTALL_DIR/app/dist/server/server/nodeServer.js"

if [ ! -x "$NODE_BIN" ]; then
  echo "错误：缺少可执行的 Node：$NODE_BIN" >&2
  read -r -p "按回车键关闭此窗口..."
  exit 1
fi
if [ ! -f "$ENTRY" ]; then
  echo "错误：缺少主程序：$ENTRY" >&2
  read -r -p "按回车键关闭此窗口..."
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"
sed \
  -e "s|__NODE_BIN__|$NODE_BIN|g" \
  -e "s|__ENTRY__|$ENTRY|g" \
  -e "s|__APP_DIR__|$INSTALL_DIR/app|g" \
  -e "s|__DATA_ROOT__|$DATA_ROOT|g" \
  -e "s|__PORT__|$PORT|g" \
  -e "s|__LAN_SCAN_SUBNETS__|$LAN_SCAN_SUBNETS|g" \
  "$INSTALL_DIR/com.hanye.hanyemonitor.plist" >"$PLIST_DST"

launchctl bootout "gui/$(id -u)" "$PLIST_DST" 2>/dev/null || true
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_DST" 2>/dev/null; then
  launchctl load "$PLIST_DST" 2>/dev/null || true
fi
launchctl enable "gui/$(id -u)/com.hanye.hanyemonitor" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/com.hanye.hanyemonitor" 2>/dev/null || true

echo "等待服务启动（最多 45 秒）..."
READY=0
for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    READY=1
    break
  fi
  # 若 launchd 起不来，尝试直接拉起一次
  if [ "$_" = "8" ] && ! curl -fsS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "launchd 尚未就绪，尝试直接启动..."
    (
      cd "$INSTALL_DIR/app"
      export PORT DATA_ROOT USE_MYSQL=0 NODE_ENV=production LICENSE_REQUIRED=0 LAN_SCAN_SUBNETS
      nohup "$NODE_BIN" "$ENTRY" >>"$DATA_ROOT/service.log" 2>>"$DATA_ROOT/service-error.log" &
    )
  fi
  sleep 1
done

echo ""
if [ "$READY" = "1" ]; then
  open "http://127.0.0.1:${PORT}/"
  echo "安装完成！"
  echo "  程序目录: $INSTALL_DIR"
  echo "  浏览器: http://127.0.0.1:${PORT}/"
  echo "  默认账号: admin / admin123"
  echo "  日志: $DATA_ROOT/service.log"
else
  echo "安装已完成，但服务未能在 ${PORT} 端口就绪。"
  echo "请查看日志："
  echo "  $DATA_ROOT/service-error.log"
  echo "  $DATA_ROOT/service.log"
  echo ""
  if [ -f "$DATA_ROOT/service-error.log" ]; then
    echo "----- service-error.log（末尾）-----"
    tail -40 "$DATA_ROOT/service-error.log" || true
  fi
  if [ -f "$DATA_ROOT/service.log" ]; then
    echo "----- service.log（末尾）-----"
    tail -40 "$DATA_ROOT/service.log" || true
  fi
  launchctl print "gui/$(id -u)/com.hanye.hanyemonitor" 2>&1 | head -30 || true
fi

echo ""
read -r -p "按回车键关闭此窗口..."
