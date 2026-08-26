@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=17890"
set "DATA_ROOT=%~dp0data"
set "USE_MYSQL=0"
set "NODE_ENV=production"
set "LAN_SCAN_SUBNETS=192.168.1"

if exist "%~dp0app.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0app.env") do (
    if not "%%a"=="" set "%%a=%%b"
  )
)

if not exist "%DATA_ROOT%" mkdir "%DATA_ROOT%"

rem 已在运行则只打开浏览器
for /f "tokens=5" %%p in ('netstat -aon ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)

start "" "http://127.0.0.1:%PORT%/"
"%~dp0node\node.exe" "%~dp0app\dist\server\server\nodeServer.js"
