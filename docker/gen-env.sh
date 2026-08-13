#!/usr/bin/env bash
# Generate docker/.env with random passwords
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

rand() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n' | head -c 48
  fi
}

if [ -f .env ]; then
  echo "[OK] docker/.env already exists"
  exit 0
fi

ROOT_PW="hanye_$(rand)"
USER_PW="hanye_$(rand)"
SECRETS="sk_$(rand)$(rand)"

cat > .env <<EOF
# Auto-generated — browser login uses username/password only
MYSQL_ROOT_PASSWORD=${ROOT_PW}
MYSQL_DATABASE=hanye_printer
MYSQL_USER=hanye
MYSQL_PASSWORD=${USER_PW}
PORT=17890
SECRETS_MASTER_KEY=${SECRETS}
AUTO_IMPORT=1
IMPORT_FORCE=0
# NAS：按实际局域网修改
LAN_SCAN_SUBNETS=192.168.1
EOF

echo "[OK] Wrote docker/.env with random MySQL password + encryption key"
