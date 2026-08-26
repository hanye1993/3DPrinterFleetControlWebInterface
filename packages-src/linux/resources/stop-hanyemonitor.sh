#!/bin/bash
set -euo pipefail
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop hanyemonitor.service 2>/dev/null || true
fi
echo "hanye Printer Monitor 已停止"
