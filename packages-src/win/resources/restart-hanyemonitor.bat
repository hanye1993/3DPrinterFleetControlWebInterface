@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if exist "nssm.exe" (
  nssm.exe restart HanyeMonitor
) else (
  call "%~dp0stop-hanyemonitor.bat"
  call "%~dp0start-hanyemonitor.bat"
  exit /b 0
)
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:17890/"
exit /b 0
