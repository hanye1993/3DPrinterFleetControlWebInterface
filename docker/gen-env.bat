@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

if exist ".env" (
  echo [OK] docker\.env already exists
  exit /b 0
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r = -join ((48..57)+(97..102) | Get-Random -Count 32 | ForEach-Object {[char]$_});" ^
  "$u = -join ((48..57)+(97..102) | Get-Random -Count 32 | ForEach-Object {[char]$_});" ^
  "$s = -join ((48..57)+(97..102) | Get-Random -Count 48 | ForEach-Object {[char]$_});" ^
  @"
# Auto-generated — browser login uses username/password only
MYSQL_ROOT_PASSWORD=hanye_$r
MYSQL_DATABASE=hanye_printer
MYSQL_USER=hanye
MYSQL_PASSWORD=hanye_$u
PORT=17890
SECRETS_MASTER_KEY=sk_$s
AUTO_IMPORT=1
IMPORT_FORCE=0
LAN_SCAN_SUBNETS=192.168.1
"@ | Set-Content -Encoding utf8 .env

echo [OK] Wrote docker\.env with random MySQL password + encryption key
exit /b 0
