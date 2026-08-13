@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

echo ========================================
echo  hanye 3D 监控台 · Docker 一键安装
echo ========================================
echo.
echo  进入目录: %CD%
echo  纯网页版：电脑 / 手机浏览器打开即可
echo  网页登录 = 用户名 + 密码（无需 API 密钥）
echo.
echo  若需清空旧数据重装，请改用 reset.bat
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Docker。请先安装并启动 Docker Desktop。
  pause
  exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo [错误] 需要 Docker Compose 插件（Docker Desktop 自带）。
  pause
  exit /b 1
)

call "%~dp0gen-env.bat"
if not exist "%~dp0..\data" mkdir "%~dp0..\data"

echo [..] 构建并启动 MySQL + 网页服务（首次较慢，请稍候）...
docker compose up -d --build
if errorlevel 1 (
  echo [错误] 启动失败，请检查上方日志。
  pause
  exit /b 1
)

echo.
echo ========================================
echo  安装完成
echo  浏览器打开: http://127.0.0.1:17890/
echo  登录账号: admin / admin123  （请立即改密）
echo.
echo  旧数据导入: 把 JSON 放到仓库 data\ 后双击 import.bat
echo  清空重装:   双击 reset.bat（输入 YES）
echo ========================================
echo.
pause
