@echo off
setlocal EnableExtensions
cd /d "%~dp0\..\.."

set "MAKENSIS="
for %%p in (
  "C:\Program Files (x86)\NSIS\makensis.exe"
  "C:\Program Files\NSIS\makensis.exe"
) do if exist %%~p set "MAKENSIS=%%~p"

if not defined MAKENSIS (
  where makensis >nul 2>&1 && for /f "delims=" %%i in ('where makensis') do set "MAKENSIS=%%i"
)

if not defined MAKENSIS (
  echo [错误] 未找到 makensis。请先安装 NSIS：
  echo   winget install NSIS.NSIS
  exit /b 1
)

if not exist "packages-src\win\staging\HanyeMonitorControl.exe" (
  echo [错误] 缺少托盘控制面板。请先执行：
  echo   npm run pack:win:staging
  exit /b 1
)
if not exist "packages-src\win\staging\node\node.exe" (
  echo [错误] 缺少 packages-src\win\staging。请先执行：
  echo   npm run pack:win:staging
  exit /b 1
)

for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
set OUTFILE=windows-%VERSION%-amd64.exe
set "OUTDIR=packages"
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

(
  echo !define APP_VERSION "%VERSION%"
  echo !define OUTFILE_NAME "%OUTFILE%"
  if exist "packages-src\win\staging\app-icon.ico" echo !define APP_ICON "..\staging\app-icon.ico"
) > "packages-src\win\installer\defines.nsh"

echo ==^> NSIS 编译 %OUTFILE%
"%MAKENSIS%" -INPUTCHARSET UTF8 "packages-src\win\installer\hanyemonitor.nsi"
if errorlevel 1 exit /b 1

if exist "%OUTFILE%" move /Y "%OUTFILE%" "%OUTDIR%\%OUTFILE%" >nul
echo OK: %CD%\%OUTDIR%\%OUTFILE%
echo.
echo 用户安装后，桌面图标打开控制面板：
echo   [启动] [重启] [关闭] — 可最小化到系统托盘
exit /b 0
