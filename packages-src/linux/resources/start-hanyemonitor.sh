#!/bin/bash
set -euo pipefail
ROOT="/opt/hanye-printer-monitor"
if command -v systemctl >/dev/null 2>&1; then
  systemctl start hanyemonitor.service 2>/dev/null || true
fi
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://127.0.0.1:${PORT:-17890}/" 2>/dev/null || true
fi
