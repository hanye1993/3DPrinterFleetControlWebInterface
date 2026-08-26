# hanye Printer Monitor — 托盘控制面板（启动 / 重启 / 关闭）
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
} catch {
  [System.Windows.Forms.MessageBox]::Show("无法加载 Windows Forms：`n$($_.Exception.Message)", 'hanye') | Out-Null
  exit 1
}

$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NssmPath = Join-Path $InstallDir 'nssm.exe'
$ServiceName = 'HanyeMonitor'
$WebUrl = 'http://127.0.0.1:17890/'
$IconPath = Join-Path $InstallDir 'app-icon.ico'
$script:Exiting = $false

function Show-Error([string]$text) {
  [void][System.Windows.Forms.MessageBox]::Show($text, 'hanye Printer Monitor', 'OK', 'Error')
}

try {
$form = New-Object System.Windows.Forms.Form
$form.Text = 'hanye Printer Monitor'
$form.ClientSize = New-Object System.Drawing.Size(340, 280)
$form.FormBorderStyle = 'FixedSingle'
$form.MaximizeBox = $false
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)

$appIcon = $null
if (Test-Path $IconPath) {
  try {
    $appIcon = New-Object System.Drawing.Icon($IconPath)
    $form.Icon = $appIcon
  } catch {}
}

$status = New-Object System.Windows.Forms.Label
$status.Dock = 'Top'
$status.Height = 48
$status.TextAlign = 'MiddleCenter'
$status.Text = '正在检测服务状态…'
$form.Controls.Add($status)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Dock = 'Fill'
$panel.FlowDirection = 'TopDown'
$panel.WrapContents = $false
$panel.Padding = New-Object System.Windows.Forms.Padding(28, 8, 28, 12)
$form.Controls.Add($panel)

function New-ActionButton([string]$text, [System.Drawing.Color]$back) {
  $b = New-Object System.Windows.Forms.Button
  $b.Text = $text
  $b.Width = 280
  $b.Height = 38
  $b.Margin = New-Object System.Windows.Forms.Padding(0, 0, 0, 10)
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.ForeColor = [System.Drawing.Color]::White
  $b.BackColor = $back
  $b.Cursor = [System.Windows.Forms.Cursors]::Hand
  return $b
}

$btnStart = New-ActionButton '启动' ([System.Drawing.Color]::FromArgb(22, 163, 74))
$btnRestart = New-ActionButton '重启' ([System.Drawing.Color]::FromArgb(37, 99, 235))
$btnStop = New-ActionButton '关闭' ([System.Drawing.Color]::FromArgb(220, 38, 38))
$btnOpen = New-ActionButton '打开网页' ([System.Drawing.Color]::FromArgb(71, 85, 105))
[void]$panel.Controls.Add($btnStart)
[void]$panel.Controls.Add($btnRestart)
[void]$panel.Controls.Add($btnStop)
[void]$panel.Controls.Add($btnOpen)

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Visible = $true
$tray.Text = 'hanye Printer Monitor'
if ($null -ne $appIcon) { $tray.Icon = $appIcon } else { $tray.Icon = [System.Drawing.SystemIcons]::Application }

function Show-MainWindow {
  $form.Show()
  $form.ShowInTaskbar = $true
  $form.WindowState = 'Normal'
  $form.Activate()
}

function Open-Web {
  try { Start-Process $WebUrl } catch {
    Show-Error "无法打开浏览器：`n$($_.Exception.Message)"
  }
}

function Test-ServiceRunning {
  try {
    $out = & sc.exe query $ServiceName 2>$null | Out-String
    return [bool]($out -match 'RUNNING')
  } catch { return $false }
}

function Test-PortOpen {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $iar = $c.BeginConnect('127.0.0.1', 17890, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(800)
    if ($ok -and $c.Connected) { $c.Close(); return $true }
    try { $c.Close() } catch {}
    return $false
  } catch { return $false }
}

function Update-Status {
  $running = Test-ServiceRunning
  $portOk = Test-PortOpen
  if ($portOk) {
    $status.Text = '状态：运行中（端口 17890 可访问）'
    $status.ForeColor = [System.Drawing.Color]::FromArgb(22, 163, 74)
    $tray.Text = 'hanye — 运行中'
  } elseif ($running) {
    $status.Text = '状态：服务已启动，网页尚未就绪…'
    $status.ForeColor = [System.Drawing.Color]::FromArgb(202, 138, 4)
    $tray.Text = 'hanye — 启动中'
  } else {
    $status.Text = '状态：已停止（请点「启动」）'
    $status.ForeColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
    $tray.Text = 'hanye — 已停止'
  }
}

function Set-Busy([bool]$busy) {
  $btnStart.Enabled = -not $busy
  $btnRestart.Enabled = -not $busy
  $btnStop.Enabled = -not $busy
  $btnOpen.Enabled = -not $busy
  $form.UseWaitCursor = $busy
}

function Invoke-ServiceAction([string]$action) {
  if (-not (Test-Path $NssmPath)) {
    Show-Error '未找到 nssm.exe，请重新安装。'
    return
  }
  try {
    Set-Busy $true
    $status.Text = switch ($action) {
      'start' { '正在启动…' }
      'restart' { '正在重启…' }
      default { '正在关闭…' }
    }
    [System.Windows.Forms.Application]::DoEvents()

    Start-Process -FilePath $NssmPath -ArgumentList @($action, $ServiceName) `
      -WorkingDirectory $InstallDir -WindowStyle Hidden -Wait | Out-Null

    if ($action -eq 'start' -or $action -eq 'restart') {
      $ok = $false
      for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-PortOpen) { $ok = $true; break }
        [System.Windows.Forms.Application]::DoEvents()
      }
      Update-Status
      if ($ok) {
        Open-Web
        $tray.ShowBalloonTip(1500, 'hanye', '服务已启动', [System.Windows.Forms.ToolTipIcon]::Info)
      } else {
        $errLog = Join-Path $InstallDir 'data\service-error.log'
        $hint = if (Test-Path $errLog) { Get-Content $errLog -Tail 20 -ErrorAction SilentlyContinue | Out-String } else { '' }
        Show-Error "服务启动后仍无法访问 17890 端口。`n请运行 diagnose.cmd 查看日志。`n`n$hint"
      }
    } else {
      Update-Status
      $tray.ShowBalloonTip(1200, 'hanye', '服务已关闭', [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } catch {
    Show-Error "操作失败：`n$($_.Exception.Message)"
    Update-Status
  } finally {
    Set-Busy $false
  }
}

function Exit-App {
  $script:Exiting = $true
  $tray.Visible = $false
  $timer.Stop()
  [System.Windows.Forms.Application]::Exit()
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
[void]$menu.Items.Add('启动', $null, { Invoke-ServiceAction 'start' })
[void]$menu.Items.Add('重启', $null, { Invoke-ServiceAction 'restart' })
[void]$menu.Items.Add('关闭', $null, { Invoke-ServiceAction 'stop' })
[void]$menu.Items.Add('-')
[void]$menu.Items.Add('打开网页', $null, { Open-Web })
[void]$menu.Items.Add('显示窗口', $null, { Show-MainWindow })
[void]$menu.Items.Add('-')
[void]$menu.Items.Add('退出', $null, { Exit-App })
$tray.ContextMenuStrip = $menu
$tray.add_DoubleClick({ Show-MainWindow })

$btnStart.add_Click({ Invoke-ServiceAction 'start' })
$btnRestart.add_Click({ Invoke-ServiceAction 'restart' })
$btnStop.add_Click({ Invoke-ServiceAction 'stop' })
$btnOpen.add_Click({ Open-Web })

# 确保 WorkingDirectory 变量名与定义一致（InstallDir）
# 若服务未装好，提示用户看 diagnose.cmd
if (-not (Test-Path $NssmPath)) {
  Show-Error "未找到 nssm.exe。`n请重新运行 windows 安装包。"
}

$form.add_Resize({
  if ($form.WindowState -eq 'Minimized') {
    $form.Hide()
    $form.ShowInTaskbar = $false
    $tray.ShowBalloonTip(1200, 'hanye', '已收到托盘图标，右键可启停服务', [System.Windows.Forms.ToolTipIcon]::Info)
  }
})

$form.add_FormClosing({
  param($sender, $e)
  if (-not $script:Exiting -and $e.CloseReason -eq 'UserClosing') {
    $e.Cancel = $true
    $form.WindowState = 'Minimized'
  }
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2500
$timer.add_Tick({ Update-Status })
$timer.Start()
Update-Status

# 首次打开：若服务未运行则自动尝试启动
if (-not (Test-PortOpen) -and (Test-Path $NssmPath)) {
  $status.Text = '首次打开，正在自动启动服务…'
  [System.Windows.Forms.Application]::DoEvents()
  try {
    Start-Process -FilePath $NssmPath -ArgumentList @('start', $ServiceName) `
      -WorkingDirectory $InstallDir -WindowStyle Hidden -Wait | Out-Null
  } catch {}
  Update-Status
}

[System.Windows.Forms.Application]::Run($form)
$tray.Dispose()
if ($null -ne $appIcon) { $appIcon.Dispose() }

} catch {
  $msg = $_.Exception.Message
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("控制面板启动失败：`n$msg", 'hanye Printer Monitor') | Out-Null
  } catch {
    Write-Error $msg
  }
  exit 1
}
