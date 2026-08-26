#!/bin/sh
set -e

INSTALL_DIR="/opt/hanye-printer-monitor"

if [ ! -f "$INSTALL_DIR/app.env" ] && [ -f "$INSTALL_DIR/app.env.example" ]; then
  cp "$INSTALL_DIR/app.env.example" "$INSTALL_DIR/app.env"
fi

mkdir -p "$INSTALL_DIR/data"
chmod +x "$INSTALL_DIR/start-hanyemonitor.sh" "$INSTALL_DIR/stop-hanyemonitor.sh" 2>/dev/null || true

if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl enable hanyemonitor.service
  systemctl restart hanyemonitor.service || systemctl start hanyemonitor.service
fi

echo ""
echo "hanye Printer Monitor 安装完成"
echo "  访问: http://127.0.0.1:17890/"
echo "  默认账号: admin / admin123"
echo "  配置: $INSTALL_DIR/app.env"
echo "  日志: $INSTALL_DIR/data/service.log"
echo ""
