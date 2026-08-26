@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if exist "nssm.exe" (
  nssm.exe stop HanyeMonitor >nul 2>&1
)
set "PORT=17890"
for /f "tokens=5" %%p in ('netstat -aon ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)
echo 已关闭
