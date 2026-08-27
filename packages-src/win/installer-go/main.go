package main

import (
	"archive/zip"
	"bytes"
	"errors"
	_ "embed"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed staging.zip
var stagingZip []byte

//go:embed version.txt
var versionText []byte

const (
	appName       = "hanye Printer Monitor"
	installFolder = "HanyeMonitor"
	serviceName   = "HanyeMonitor"
	controlExe    = "HanyeMonitorControl.exe"
	webHostPort   = "127.0.0.1:17890"
	webURL        = "http://127.0.0.1:17890/"
)

func main() {
	if !isAdmin() {
		if err := runAsAdmin(); err != nil {
			showMsg("需要管理员权限才能安装。\n\n请右键安装包 →「以管理员身份运行」。\n\n"+err.Error(), true)
		}
		return
	}

	version := strings.TrimSpace(string(versionText))
	logPath := filepath.Join(os.TempDir(), "hanye-install.log")

	logf := func(format string, args ...interface{}) {
		line := fmt.Sprintf(format, args...) + "\r\n"
		f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
		if err == nil {
			_, _ = f.WriteString(time.Now().Format("15:04:05 ") + line)
			_ = f.Close()
		}
	}

	showMsg(fmt.Sprintf(
		"欢迎安装 %s %s\n\n点击「确定」后请选择安装目录。",
		appName, version,
	), false)

	defaultDir := defaultInstallDir()
	installDir, err := pickInstallDir(defaultDir)
	if err != nil {
		if err == errPickCancelled {
			showMsg("已取消安装。", false)
			return
		}
		showMsg("无法选择安装目录：\n"+err.Error(), true)
		os.Exit(1)
	}
	installDir = filepath.Clean(installDir)
	dataDir := resolveDataDir(installDir)

	if !confirmInstall(installDir, dataDir, version) {
		showMsg("已取消安装。", false)
		return
	}

	_ = os.Remove(logPath)
	logf("install start version=%s dir=%s data=%s", version, installDir, dataDir)

	warn, err := doInstall(installDir, dataDir, version, logf)
	if err != nil {
		logf("FAIL: %v", err)
		showMsg("安装失败：\n"+err.Error()+"\n\n详细日志：\n"+logPath, true)
		os.Exit(1)
	}

	_ = copyFile(logPath, filepath.Join(installDir, "install.log"))
	_ = startDetached(filepath.Join(installDir, controlExe), installDir)
	time.Sleep(800 * time.Millisecond)
	_ = openURL(webURL)

	msg := "安装完成！\n\n控制面板已打开（启动 / 重启 / 关闭）\n关闭窗口后会收到系统托盘。\n\n网页：" + webURL + "\n默认账号 admin / admin123"
	if warn != "" {
		msg += "\n\n注意：\n" + warn + "\n\n可在控制面板点「启动」，或运行安装目录下的 diagnose.cmd。"
	} else {
		msg += "\n\n若网页打不开，请在控制面板点「启动」，或运行 diagnose.cmd。"
	}
	showMsg(msg, false)
}

func doInstall(installDir, dataDir, version string, logf func(string, ...interface{})) (warn string, err error) {
	cleanupLegacy(installDir, logf)

	nssmOld := filepath.Join(installDir, "nssm.exe")
	if _, statErr := os.Stat(nssmOld); statErr == nil {
		_ = runHidden(nssmOld, "stop", serviceName)
		_ = runHidden(nssmOld, "remove", serviceName, "confirm")
	}

	_ = os.RemoveAll(installDir)
	if err = os.MkdirAll(installDir, 0755); err != nil {
		return "", fmt.Errorf("创建程序目录失败: %w", err)
	}
	if err = os.MkdirAll(dataDir, 0755); err != nil {
		return "", fmt.Errorf("创建数据目录失败: %w", err)
	}
	if err = extractZip(stagingZip, installDir); err != nil {
		return "", fmt.Errorf("解压失败: %w", err)
	}
	logf("extracted ok")

	if err = writeAppEnv(installDir, dataDir); err != nil {
		return "", err
	}

	nssm := filepath.Join(installDir, "nssm.exe")
	node := filepath.Join(installDir, "node", "node.exe")
	entry := filepath.Join(installDir, "app", "dist", "server", "server", "nodeServer.js")
	for _, p := range []string{nssm, node, entry, filepath.Join(installDir, controlExe)} {
		if _, statErr := os.Stat(p); statErr != nil {
			return "", fmt.Errorf("缺少文件: %s", p)
		}
	}

	if busy, pid := portInUse(17890); busy {
		logf("warn port 17890 in use pid=%s", pid)
		warn = fmt.Sprintf("端口 17890 已被占用（PID %s）。\n请关闭占用程序后，在控制面板点「启动」。", pid)
	}

	appDir := filepath.Join(installDir, "app")
	stdoutLog := filepath.Join(dataDir, "service.log")
	stderrLog := filepath.Join(dataDir, "service-error.log")

	_ = runHidden(nssm, "stop", serviceName)
	_ = runHidden(nssm, "remove", serviceName, "confirm")
	if err = runHidden(nssm, "install", serviceName, node, entry); err != nil {
		return warn, fmt.Errorf("注册 Windows 服务失败（部分电脑需关闭安全软件后重试）: %w", err)
	}
	logf("service installed")

	_ = runHidden(nssm, "set", serviceName, "Application", node)
	_ = runHidden(nssm, "set", serviceName, "AppParameters", entry)
	_ = runHidden(nssm, "set", serviceName, "AppDirectory", appDir)
	_ = runHidden(nssm, "set", serviceName, "AppStdout", stdoutLog)
	_ = runHidden(nssm, "set", serviceName, "AppStderr", stderrLog)
	_ = runHidden(nssm, "set", serviceName, "AppRotateFiles", "1")
	_ = runHidden(nssm, "set", serviceName, "AppRotateBytes", "2097152")
	_ = runHidden(nssm, "set", serviceName, "DisplayName", appName)
	_ = runHidden(nssm, "set", serviceName, "Description", "hanye 3D printer monitor")
	_ = runHidden(nssm, "set", serviceName, "Start", "SERVICE_AUTO_START")
	_ = runHidden(nssm, "set", serviceName, "ObjectName", "LocalSystem")
	_ = runHidden(nssm, "set", serviceName, "AppThrottle", "1500")
	_ = runHidden(nssm, "set", serviceName, "AppRestartDelay", "5000")

	if err = setServiceEnv(nssm, serviceName, dataDir); err != nil {
		logf("warn set env: %v", err)
	}

	ensureFirewallRule(logf)

	if err = runHidden(nssm, "start", serviceName); err != nil {
		logf("nssm start err: %v", err)
	}

	if !waitServiceRunning(20 * time.Second) {
		logf("service not running, trying direct node fallback")
		_ = startNodeDirect(node, appDir, dataDir, stdoutLog, stderrLog)
	}

	if !waitPort(webHostPort, 60*time.Second) {
		tail := readTail(stderrLog, 1800)
		if tail == "" {
			tail = readTail(stdoutLog, 1800)
		}
		if tail == "" {
			tail = "（无服务日志，可能 node 未能启动或被安全软件拦截）"
		}
		portWarn := fmt.Sprintf(
			"服务未在 60 秒内监听 %s（不影响文件已安装）。\n日志摘要：\n%s",
			webHostPort, tail,
		)
		if warn != "" {
			warn += "\n\n" + portWarn
		} else {
			warn = portWarn
		}
		logf("warn port not ready: %s", tail)
	} else {
		logf("port %s ready", webHostPort)
	}

	controlPath := filepath.Join(installDir, controlExe)
	iconPath := filepath.Join(installDir, "app-icon.ico")
	_ = createShortcut(filepath.Join(desktopDir(), appName+".lnk"), controlPath, iconPath, installDir)

	startMenu := filepath.Join(os.Getenv("ProgramData"), "Microsoft", "Windows", "Start Menu", "Programs", "hanye")
	_ = os.MkdirAll(startMenu, 0755)
	_ = createShortcut(filepath.Join(startMenu, appName+".lnk"), controlPath, iconPath, installDir)

	_ = runHidden("reg", "add",
		`HKLM\Software\Microsoft\Windows\CurrentVersion\Run`,
		"/v", "HanyeMonitorControl", "/t", "REG_SZ", "/d", controlPath, "/f")

	uninst := filepath.Join(installDir, "uninstall.cmd")
	_ = os.WriteFile(uninst, []byte(uninstallScript(installDir, dataDir)), 0644)
	_ = createShortcut(filepath.Join(startMenu, "卸载 "+appName+".lnk"), uninst, iconPath, installDir)
	_ = os.WriteFile(filepath.Join(installDir, "diagnose.cmd"), []byte(diagnoseScript(dataDir)), 0644)

	key := `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\HanyeMonitor`
	_ = runHidden("reg", "add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", appName, "/f")
	_ = runHidden("reg", "add", key, "/v", "UninstallString", "/t", "REG_SZ", "/d", uninst, "/f")
	_ = runHidden("reg", "add", key, "/v", "Publisher", "/t", "REG_SZ", "/d", "hanye", "/f")
	_ = runHidden("reg", "add", key, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f")
	_ = runHidden("reg", "add", key, "/v", "InstallLocation", "/t", "REG_SZ", "/d", installDir, "/f")
	if _, statErr := os.Stat(iconPath); statErr == nil {
		_ = runHidden("reg", "add", key, "/v", "DisplayIcon", "/t", "REG_SZ", "/d", iconPath, "/f")
	}
	return warn, nil
}

func cleanupLegacy(installDir string, logf func(string, ...interface{})) {
	legacyDirs := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "hanye Printer Monitor"),
	}
	for _, d := range legacyDirs {
		if d == installDir {
			continue
		}
		if _, err := os.Stat(d); err != nil {
			continue
		}
		logf("cleanup legacy dir %s", d)
		if nssm := filepath.Join(d, "nssm.exe"); fileExists(nssm) {
			_ = runHidden(nssm, "stop", serviceName)
			_ = runHidden(nssm, "remove", serviceName, "confirm")
		}
		_ = os.RemoveAll(d)
	}
}

func writeAppEnv(installDir, dataDir string) error {
	envExample := filepath.Join(installDir, "app.env.example")
	envFile := filepath.Join(installDir, "app.env")
	content := fmt.Sprintf(
		"PORT=17890\r\nDATA_ROOT=%s\r\nUSE_MYSQL=0\r\nNODE_ENV=production\r\nLAN_SCAN_SUBNETS=192.168.1\r\nLICENSE_REQUIRED=0\r\n",
		dataDir,
	)
	if err := os.WriteFile(envFile, []byte(content), 0644); err != nil {
		return fmt.Errorf("写入 app.env 失败: %w", err)
	}
	_ = copyFile(envExample, envFile+".bak")
	return os.WriteFile(filepath.Join(installDir, "app", ".env"), []byte(content), 0644)
}

func setServiceEnv(nssm, service, dataDir string) error {
	// 数据放 ProgramData，避免 Program Files 空格路径 + 服务写权限问题
	block := strings.Join([]string{
		":PORT=17890",
		"DATA_ROOT=" + dataDir,
		"USE_MYSQL=0",
		"NODE_ENV=production",
		"LAN_SCAN_SUBNETS=192.168.1",
		"LICENSE_REQUIRED=0",
	}, "\r\n")
	return runHidden(nssm, "set", service, "AppEnvironmentExtra", block)
}

func ensureFirewallRule(logf func(string, ...interface{})) {
	err := runHidden("netsh", "advfirewall", "firewall", "add", "rule",
		"name=HanyeMonitor Web",
		"dir=in", "action=allow", "protocol=TCP", "localport=17890",
		"profile=private,domain", "enable=yes")
	if err != nil {
		logf("firewall rule skip: %v", err)
	}
}

func portInUse(port int) (bool, string) {
	cmd := exec.Command("netstat", "-ano")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return false, ""
	}
	suffix := fmt.Sprintf(":%d", port)
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, suffix) || !strings.Contains(strings.ToUpper(line), "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) > 0 {
			return true, fields[len(fields)-1]
		}
		return true, "?"
	}
	return false, ""
}

func waitServiceRunning(timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		cmd := exec.Command("sc.exe", "query", serviceName)
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
		out, _ := cmd.CombinedOutput()
		if strings.Contains(string(out), "RUNNING") {
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func waitPort(addr string, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, time.Second)
		if err == nil {
			_ = conn.Close()
			return true
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func readTail(path string, max int) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return ""
	}
	if len(b) > max {
		b = b[len(b)-max:]
	}
	return strings.TrimSpace(string(b))
}

func startNodeDirect(node, appDir, dataDir, stdoutLog, stderrLog string) error {
	stdout, _ := os.OpenFile(stdoutLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	stderr, _ := os.OpenFile(stderrLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	cmd := exec.Command(node, filepath.Join(appDir, "dist", "server", "server", "nodeServer.js"))
	cmd.Dir = appDir
	cmd.Env = []string{
		"PORT=17890",
		"DATA_ROOT=" + dataDir,
		"USE_MYSQL=0",
		"NODE_ENV=production",
		"LAN_SCAN_SUBNETS=192.168.1",
		"LICENSE_REQUIRED=0",
		"SystemRoot=" + os.Getenv("SystemRoot"),
		"PATH=" + os.Getenv("PATH"),
	}
	if stdout != nil {
		cmd.Stdout = stdout
	}
	if stderr != nil {
		cmd.Stderr = stderr
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x00000008} // DETACHED_PROCESS
	return cmd.Start()
}

func startDetached(exe, dir string, args ...string) error {
	cmd := exec.Command(exe, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func uninstallScript(installDir, dataDir string) string {
	return "@echo off\r\n" +
		"cd /d \"%~dp0\"\r\n" +
		"nssm.exe stop HanyeMonitor >nul 2>&1\r\n" +
		"nssm.exe remove HanyeMonitor confirm >nul 2>&1\r\n" +
		"reg delete \"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\" /v HanyeMonitorControl /f >nul 2>&1\r\n" +
		"reg delete \"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor\" /f >nul 2>&1\r\n" +
		"netsh advfirewall firewall delete rule name=\"HanyeMonitor Web\" >nul 2>&1\r\n" +
		"del \"%PUBLIC%\\Desktop\\hanye Printer Monitor.lnk\" >nul 2>&1\r\n" +
		"rmdir /s /q \"%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\hanye\" >nul 2>&1\r\n" +
		"cd /d \"%TEMP%\"\r\n" +
		"rmdir /s /q \"" + dataDir + "\" >nul 2>&1\r\n" +
		"rmdir /s /q \"" + installDir + "\"\r\n" +
		"echo Uninstalled.\r\n" +
		"pause\r\n"
}

func diagnoseScript(dataDir string) string {
	return "@echo off\r\nchcp 65001 >nul\r\ncd /d \"%~dp0\"\r\n" +
		"echo ==== service ====\r\nsc query HanyeMonitor\r\n" +
		"echo ==== port 17890 ====\r\nnetstat -ano | findstr :17890\r\n" +
		"echo ==== app.env ====\r\ntype app.env 2>nul\r\n" +
		"echo ==== service-error.log ====\r\ntype \"" + dataDir + "\\service-error.log\" 2>nul\r\n" +
		"echo ==== service.log (tail) ====\r\npowershell -NoP -Command \"if(Test-Path '" + dataDir + "\\service.log'){Get-Content '" + dataDir + "\\service.log' -Tail 40}\"\r\n" +
		"pause\r\n"
}

func extractZip(data []byte, dest string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	destClean := filepath.Clean(dest)
	for _, f := range r.File {
		name := filepath.FromSlash(f.Name)
		target := filepath.Join(destClean, name)
		rel, err := filepath.Rel(destClean, target)
		if err != nil || strings.HasPrefix(rel, "..") {
			return fmt.Errorf("非法路径: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0755)
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err != nil {
			rc.Close()
			return err
		}
		_, copyErr := io.Copy(out, rc)
		out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
	}
	return nil
}

func createShortcut(lnk, target, icon, workDir string) error {
	ps := fmt.Sprintf(
		"$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%s'); $s.TargetPath='%s'; $s.WorkingDirectory='%s'; if(Test-Path '%s'){$s.IconLocation='%s'}; $s.Save()",
		escapePS(lnk), escapePS(target), escapePS(workDir), escapePS(icon), escapePS(icon),
	)
	return runHidden("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps)
}

func escapePS(s string) string { return strings.ReplaceAll(s, "'", "''") }

func desktopDir() string {
	if d := os.Getenv("PUBLIC"); d != "" {
		return filepath.Join(d, "Desktop")
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "Desktop")
}

func runHidden(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%v: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	_ = os.MkdirAll(filepath.Dir(dst), 0755)
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

var errPickCancelled = errors.New("cancelled")

func defaultInstallDir() string {
	if pf := os.Getenv("ProgramFiles"); pf != "" {
		return filepath.Join(pf, installFolder)
	}
	return filepath.Join(`C:\Program Files`, installFolder)
}

func resolveDataDir(installDir string) string {
	lower := strings.ToLower(filepath.Clean(installDir))
	if strings.Contains(lower, `\program files`) || strings.Contains(lower, `\program files (x86)`) {
		return filepath.Join(os.Getenv("ProgramData"), installFolder, "data")
	}
	return filepath.Join(installDir, "data")
}

func pickInstallDir(defaultDir string) (string, error) {
	ps := fmt.Sprintf(
		`Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '选择 %s 的安装目录（文件将安装到此文件夹）'
$dlg.SelectedPath = '%s'
$dlg.ShowNewFolderButton = $true
if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 2 }
$p = $dlg.SelectedPath.TrimEnd('\')
if ([string]::IsNullOrWhiteSpace($p)) { exit 3 }
Write-Output $p`,
		appName, escapePS(defaultDir),
	)
	cmd := exec.Command("powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps)
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == 2 {
			return "", errPickCancelled
		}
		if text != "" {
			return "", fmt.Errorf("%w: %s", err, text)
		}
		return "", err
	}
	if text == "" {
		return "", fmt.Errorf("未选择目录")
	}
	return text, nil
}

func confirmInstall(installDir, dataDir, version string) bool {
	text := fmt.Sprintf(
		"即将安装 %s %s\n\n程序目录：\n%s\n数据目录：\n%s\n\n是否继续？",
		appName, version, installDir, dataDir,
	)
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString(appName)
	body, _ := syscall.UTF16PtrFromString(text)
	const mbYesNo = 0x00000004
	const mbIconQuestion = 0x00000020
	ret, _, _ := proc.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), uintptr(mbYesNo|mbIconQuestion))
	const idYes = 6
	return ret == idYes
}

func showMsg(text string, isError bool) {
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	title, _ := syscall.UTF16PtrFromString(appName)
	body, _ := syscall.UTF16PtrFromString(text)
	flag := uintptr(0x40)
	if isError {
		flag = 0x10
	}
	proc.Call(0, uintptr(unsafe.Pointer(body)), uintptr(unsafe.Pointer(title)), flag)
}

func openURL(u string) error {
	shell32 := syscall.NewLazyDLL("shell32.dll")
	proc := shell32.NewProc("ShellExecuteW")
	path, _ := syscall.UTF16PtrFromString(u)
	op, _ := syscall.UTF16PtrFromString("open")
	r, _, _ := proc.Call(0, uintptr(unsafe.Pointer(op)), uintptr(unsafe.Pointer(path)), 0, 0, 1)
	if r <= 32 {
		return fmt.Errorf("ShellExecute failed: %d", r)
	}
	return nil
}

func isAdmin() bool {
	cmd := exec.Command("net", "session")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run() == nil
}

func runAsAdmin() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	shell32 := syscall.NewLazyDLL("shell32.dll")
	proc := shell32.NewProc("ShellExecuteW")
	verb, _ := syscall.UTF16PtrFromString("runas")
	file, _ := syscall.UTF16PtrFromString(exe)
	r, _, err2 := proc.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(file)), 0, 0, 1)
	if r <= 32 {
		return fmt.Errorf("无法提权: %v (%d)", err2, r)
	}
	return nil
}
