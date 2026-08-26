; hanye Printer Monitor — Windows 安装包（NSIS）
; 安装后桌面快捷方式打开「控制面板」：启动 / 重启 / 关闭，可最小化到托盘

!include "MUI2.nsh"
!include "x64.nsh"

!define APP_NAME "hanye Printer Monitor"
!define APP_PUBLISHER "hanye"
!define APP_CONTROL "HanyeMonitorControl.exe"
!define STAGING "..\\staging"

!include "defines.nsh"

Name "${APP_NAME}"
OutFile "..\\..\\..\\packages\\${OUTFILE_NAME}"
InstallDir "$PROGRAMFILES64\\hanye Printer Monitor"
InstallDirRegKey HKLM "Software\\${APP_PUBLISHER}\\HanyeMonitor" "InstallDir"
RequestExecutionLevel admin
ShowInstDetails show

!define MUI_ABORTWARNING
!ifdef APP_ICON
  !define MUI_ICON "${APP_ICON}"
  !define MUI_UNICON "${APP_ICON}"
!endif

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\\${APP_CONTROL}"
!define MUI_FINISHPAGE_RUN_TEXT "打开控制面板（启动 / 重启 / 关闭）"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

Section "MainSection" SEC01
  SetOutPath "$INSTDIR"
  File /r "${STAGING}\\node"
  SetOutPath "$INSTDIR\\app"
  File /r "${STAGING}\\app\\*"
  SetOutPath "$INSTDIR"
  File "${STAGING}\\start-hanyemonitor.bat"
  File "${STAGING}\\stop-hanyemonitor.bat"
  File "${STAGING}\\restart-hanyemonitor.bat"
  File "${STAGING}\\app.env.example"
  File "${STAGING}\\nssm.exe"
  File "${STAGING}\\HanyeMonitorControl.exe"
  File "${STAGING}\\HanyeMonitorControl.ps1"
  IfFileExists "${STAGING}\\app-icon.ico" 0 +2
    File "${STAGING}\\app-icon.ico"

  CreateDirectory "$INSTDIR\\data"
  IfFileExists "$INSTDIR\\app.env" +2 0
    CopyFiles "$INSTDIR\\app.env.example" "$INSTDIR\\app.env"

  ; 注册 Windows 服务（内置 NSSM，无需用户装 Node）
  ExecWait '"$INSTDIR\\nssm.exe" stop HanyeMonitor' $0
  ExecWait '"$INSTDIR\\nssm.exe" remove HanyeMonitor confirm' $0
  ExecWait '"$INSTDIR\\nssm.exe" install HanyeMonitor "$INSTDIR\\node\\node.exe" "$INSTDIR\\app\\dist\\server\\server\\nodeServer.js"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor AppDirectory "$INSTDIR\\app"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor AppStdout "$INSTDIR\\data\\service.log"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor AppStderr "$INSTDIR\\data\\service-error.log"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor AppEnvironmentExtra "PORT=17890" "DATA_ROOT=$INSTDIR\\data" "USE_MYSQL=0" "NODE_ENV=production" "LAN_SCAN_SUBNETS=192.168.1"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor DisplayName "${APP_NAME}"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor Description "hanye 3D printer monitor"' $0
  ExecWait '"$INSTDIR\\nssm.exe" set HanyeMonitor Start SERVICE_AUTO_START' $0
  ExecWait '"$INSTDIR\\nssm.exe" start HanyeMonitor' $0

  CreateDirectory "$SMPROGRAMS\\hanye"
  CreateShortCut "$SMPROGRAMS\\hanye\\${APP_NAME}.lnk" "$INSTDIR\\${APP_CONTROL}" "" "$INSTDIR\\app-icon.ico" 0
  CreateShortCut "$SMPROGRAMS\\hanye\\卸载 ${APP_NAME}.lnk" "$INSTDIR\\uninstall.exe"
  CreateShortCut "$DESKTOP\\${APP_NAME}.lnk" "$INSTDIR\\${APP_CONTROL}" "" "$INSTDIR\\app-icon.ico" 0

  ; 登录后自动打开托盘控制面板
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "HanyeMonitorControl" '"$INSTDIR\\${APP_CONTROL}"'

  WriteRegStr HKLM "Software\\${APP_PUBLISHER}\\HanyeMonitor" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor" "UninstallString" "$INSTDIR\\uninstall.exe"
  IfFileExists "$INSTDIR\\app-icon.ico" 0 +2
    WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor" "DisplayIcon" "$INSTDIR\\app-icon.ico"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor" "DisplayVersion" "${APP_VERSION}"
  WriteUninstaller "$INSTDIR\\uninstall.exe"

  Sleep 2000
  ExecShell "open" "http://127.0.0.1:17890/"
SectionEnd

Section "Uninstall"
  DeleteRegValue HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "HanyeMonitorControl"
  ExecWait '"$INSTDIR\\nssm.exe" stop HanyeMonitor' $0
  ExecWait '"$INSTDIR\\nssm.exe" remove HanyeMonitor confirm' $0

  Delete "$DESKTOP\\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\\hanye\\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\\hanye\\卸载 ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\\hanye"

  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor"
  DeleteRegKey HKLM "Software\\${APP_PUBLISHER}\\HanyeMonitor"
SectionEnd
