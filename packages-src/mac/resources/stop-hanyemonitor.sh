#!/bin/bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.hanye.hanyemonitor.plist"
if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
fi
pkill -f "hanye Printer Monitor/app/dist/server/server/nodeServer.js" 2>/dev/null || true
echo "hanye Printer Monitor 已停止"
