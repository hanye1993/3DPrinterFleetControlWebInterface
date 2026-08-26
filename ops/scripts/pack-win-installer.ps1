# Windows 一键安装包打包（在 Windows 上执行）
# 需要：Node.js、NSIS（https://nsis.sourceforge.io/Download）
# 用法：powershell -ExecutionPolicy Bypass -File ops\scripts\pack-win-installer.ps1

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..\')
$Win = Join-Path $Root 'packages-src\win'
$Staging = Join-Path $Win 'staging'
$Installer = Join-Path $Win 'installer'
$Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
$OutDir = Join-Path $Root 'packages'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutFile = "windows-$Version-amd64.exe"

function Find-Makensis {
  $candidates = @(
    'makensis',
    "${env:ProgramFiles(x86)}\NSIS\makensis.exe",
    "$env:ProgramFiles\NSIS\makensis.exe"
  )
  foreach ($c in $candidates) {
    if (Get-Command $c -ErrorAction SilentlyContinue) { return (Get-Command $c).Source }
  }
  throw '未找到 makensis。请安装 NSIS 并加入 PATH。'
}

Write-Host "==> npm run build"
Push-Location $Root
npm run build
Pop-Location

Write-Host "==> staging (bash script)"
$bash = Get-Command bash -ErrorAction SilentlyContinue
if ($bash) {
  & bash (Join-Path $Root 'ops/scripts/pack-win-installer.sh') --staging-only
} else {
  throw '需要 Git Bash 或 WSL 的 bash 来准备 staging 目录'
}

$defines = @"
!define APP_VERSION "$Version"
!define OUTFILE_NAME "$OutFile"
"@
Set-Content -Path (Join-Path $Installer 'defines.nsh') -Value $defines -Encoding UTF8

$makensis = Find-Makensis
Write-Host "==> NSIS: $makensis"
& $makensis -INPUTCHARSET UTF8 (Join-Path $Installer 'hanyemonitor.nsi')

Copy-Item -Force (Join-Path $Root $OutFile) (Join-Path $OutDir $OutFile) -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $Root $OutFile)) {
  Move-Item -Force (Join-Path $Root $OutFile) (Join-Path $OutDir $OutFile)
}
Write-Host "OK: $(Join-Path $OutDir $OutFile)"
