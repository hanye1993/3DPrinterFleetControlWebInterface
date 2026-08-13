@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "%~dp0..\data" mkdir "%~dp0..\data"

if not exist "%~dp0..\data\users.json" if not exist "%~dp0..\data\devices.json" if not exist "%~dp0..\data\app-settings.json" (
  echo [提示] 仓库 data\ 下未找到 users.json / devices.json / app-settings.json
  echo       请先把旧版数据复制到 data\ 后再运行。
  pause
  exit /b 1
)

echo [..] 强制导入 data\ → MySQL…
docker compose exec -e IMPORT_FORCE=1 -e AUTO_IMPORT=1 app sh -c "rm -f /app/data/.mysql-imported; node /app/ops/scripts/import-mysql.mjs; touch /app/data/.mysql-imported"
if errorlevel 1 (
  echo [错误] 导入失败。
  pause
  exit /b 1
)
echo [OK] 导入完成。可刷新网页查看。
pause
