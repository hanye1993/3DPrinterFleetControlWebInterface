@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  hanye 监控台 · Docker 清空重装
echo ========================================
echo.
echo  将删除：容器、MySQL 卷、仓库 data\、docker\.env
echo.
set /p CONFIRM=确认清空并重装？输入 YES 继续: 
if /I not "%CONFIRM%"=="YES" (
  echo 已取消。
  pause
  exit /b 0
)

where docker >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Docker。
  pause
  exit /b 1
)

echo [..] 停止并删除容器 + MySQL 卷…
docker compose down -v --remove-orphans

if exist "%~dp0.env" del /f /q "%~dp0.env"
if not exist "%~dp0..\data" mkdir "%~dp0..\data"
del /q "%~dp0..\data\*" >nul 2>&1
for /d %%D in ("%~dp0..\data\*") do rd /s /q "%%D" >nul 2>&1

call "%~dp0gen-env.bat"

echo [..] 重新构建并启动…
docker compose up -d --build
if errorlevel 1 (
  echo [错误] 启动失败。
  pause
  exit /b 1
)

echo.
echo ========================================
echo  已清空并重装完成
echo  浏览器打开: http://127.0.0.1:17890/
echo ========================================
pause
