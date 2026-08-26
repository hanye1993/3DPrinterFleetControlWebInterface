package main

import (
	"archive/zip"
	"bytes"
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
	appName     = "hanye Printer Monitor"
	serviceName = "HanyeMonitor"
	controlExe  = "HanyeMonitorControl.exe"
	webHostPort = "127.0.0.1:17890"
	webURL      = "http://127.0.0.1:17890/"
)

func main() {
	if !isAdmin() {
		_ = runAsAdmin()
		return
	}

	version := strings.TrimSpace(string(versionText))
	installDir := filepath.Join(os.Getenv("ProgramFiles"), appName)
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
		"即将安装 %s %s\n\n安装目录：\n%s\n\n安装后可用「启动 / 重启 / 关闭」控制面板，并可最小化到系统托盘。",
		appName, version, installDir,
	), false)

	_ = os.Remove(logPath)
	logf("install start version=%s dir=%s", version, installDir)

	if err := doInstall(installDir, version, logf); err != nil {
		logf("FAIL: %v", err)
		showMsg("安装失败：\n"+err.Error()+"\n\n详细日志：\n"+logPath, true)
		os.Exit(1)
	}

	_ = copyFile(logPath, filepath.Join(installDir, "install.log"))
	_ = startDetached(filepath.Join(installDir, controlExe), installDir)
	time.Sleep(800 * time.Millisecond)
	_ = openURL(webURL)

	showMsg("安装完成！\n\n控制面板已打开（启动 / 重启 / 关闭）\n关闭窗口后会收到系统托盘。\n\n网页："+webURL+"\n默认账号 admin / admin123\n\n若网页打不开，请在控制面板点「启动」，或运行安装目录下的 diagnose.cmd。", false)
}

func doInstall(installDir, version string, logf func(string, ...interface{})) error {
	nssmOld := filepath.Join(installDir, "nssm.exe")
	if _, err := os.Stat(nssmOld); err == nil {
		_ = runHidden(nssmOld, "stop", serviceName)
		_ = runHidden(nssmOld, "remove", serviceName, "confirm")
	}

	_ = os.RemoveAll(installDir)
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}
	if err := extractZip(stagingZip, installDir); err != nil {
		return fmt.Errorf("解压失败: %w", err)
	}
	logf("extracted ok")

	dataDir := filepath.Join(installDir, "data")
	_ = os.MkdirAll(dataDir, 0755)

	envExample := filepath.Join(installDir, "app.env.example")
	envFile := filepath.Join(installDir, "app.env")
	if _, err := os.Stat(envFile); err != nil {
		_ = copyFile(envExample, envFile)
	}
	_ = copyFile(envFile, filepath.Join(installDir, "app", ".env"))

	nssm := filepath.Join(installDir, "nssm.exe")
	node := filepath.Join(installDir, "node", "node.exe")
	entry := filepath.Join(installDir, "app", "dist", "server", "server", "nodeServer.js")
	for _, p := range []string{nssm, node, entry, filepath.Join(installDir, controlExe)} {
		if _, err := os.Stat(p); err != nil {
			return fmt.Errorf("缺少文件: %s", p)
		}
	}

	appDir := filepath.Join(installDir, "app")
	stdoutLog := filepath.Join(dataDir, "service.log")
	stderrLog := filepath.Join(dataDir, "service-error.log")

	_ = runHidden(nssm, "stop", serviceName)
	_ = runHidden(nssm, "remove", serviceName, "confirm")
	if err := runHidden(nssm, "install", serviceName, node, entry); err != nil {
		return fmt.Errorf("注册服务失败: %w", err)
	}
	logf("service installed")

	_ = runHidden(nssm, "set", serviceName, "AppDirectory", appDir)
	_ = runHidden(nssm, "set", serviceName, "AppStdout", stdoutLog)
	_ = runHidden(nssm, "set", serviceName, "AppStderr", stderrLog)
	_ = runHidden(nssm, "set", serviceName, "AppRotateFiles", "1")
	_ = runHidden(nssm, "set", serviceName, "AppRotateBytes", "2097152")

	envBlock := strings.Join([]string{
		"PORT=17890",
		"DATA_ROOT=" + dataDir,
		"USE_MYSQL=0",
		"NODE_ENV=production",
		"LAN_SCAN_SUBNETS=192.168.1",
		"LICENSE_REQUIRED=0",
	}, "\r\n")
	_ = runHidden(nssm, "set", serviceName, "AppEnvironmentExtra", envBlock)
	_ = runHidden(nssm, "set", serviceName, "DisplayName", appName)
	_ = runHidden(nssm, "set", serviceName, "Description", "hanye 3D printer monitor")
	_ = runHidden(nssm, "set", serviceName, "Start", "SERVICE_AUTO_START")
	_ = runHidden(nssm, "set", serviceName, "AppExit", "Default", "Restart")
	_ = runHidden(nssm, "set", serviceName, "AppRestartDelay", "3000")

	if err := runHidden(nssm, "start", serviceName); err != nil {
		logf("nssm start err: %v", err)
	}

	if !waitServiceRunning(15 * time.Second) {
		logf("service not running, trying direct node fallback")
		_ = startDetached(node, appDir, entry)
	}

	if !waitPort(webHostPort, 45*time.Second) {
		tail := readTail(stderrLog, 1800)
		if tail == "" {
			tail = readTail(stdoutLog, 1800)
		}
		if tail == "" {
			tail = "（无服务日志，可能 node 未能启动）"
		}
		return fmt.Errorf("服务未能在 45 秒内监听 %s\n\n请查看：\n%s\n%s\n\n日志摘要：\n%s",
			webHostPort, stdoutLog, stderrLog, tail)
	}
	logf("port %s ready", webHostPort)

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
	_ = os.WriteFile(uninst, []byte(uninstallScript(installDir)), 0644)
	_ = createShortcut(filepath.Join(startMenu, "卸载 "+appName+".lnk"), uninst, iconPath, installDir)
	_ = os.WriteFile(filepath.Join(installDir, "diagnose.cmd"), []byte(diagnoseScript()), 0644)

	key := `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\HanyeMonitor`
	_ = runHidden("reg", "add", key, "/v", "DisplayName", "/t", "REG_SZ", "/d", appName, "/f")
	_ = runHidden("reg", "add", key, "/v", "UninstallString", "/t", "REG_SZ", "/d", uninst, "/f")
	_ = runHidden("reg", "add", key, "/v", "Publisher", "/t", "REG_SZ", "/d", "hanye", "/f")
	_ = runHidden("reg", "add", key, "/v", "DisplayVersion", "/t", "REG_SZ", "/d", version, "/f")
	if _, err := os.Stat(iconPath); err == nil {
		_ = runHidden("reg", "add", key, "/v", "DisplayIcon", "/t", "REG_SZ", "/d", iconPath, "/f")
	}
	return nil
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

func startDetached(exe, dir string, args ...string) error {
	cmd := exec.Command(exe, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"PORT=17890",
		"DATA_ROOT="+filepath.Join(filepath.Dir(dir), "data"),
		"USE_MYSQL=0",
		"NODE_ENV=production",
		"LICENSE_REQUIRED=0",
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func uninstallScript(installDir string) string {
	return "@echo off\r\n" +
		"cd /d \"%~dp0\"\r\n" +
		"nssm.exe stop HanyeMonitor >nul 2>&1\r\n" +
		"nssm.exe remove HanyeMonitor confirm >nul 2>&1\r\n" +
		"reg delete \"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\" /v HanyeMonitorControl /f >nul 2>&1\r\n" +
		"reg delete \"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\HanyeMonitor\" /f >nul 2>&1\r\n" +
		"del \"%PUBLIC%\\Desktop\\hanye Printer Monitor.lnk\" >nul 2>&1\r\n" +
		"rmdir /s /q \"%ProgramData%\\Microsoft\\Windows\\Start Menu\\Programs\\hanye\" >nul 2>&1\r\n" +
		"cd /d \"%TEMP%\"\r\n" +
		"rmdir /s /q \"" + installDir + "\"\r\n" +
		"echo Uninstalled.\r\n" +
		"pause\r\n"
}

func diagnoseScript() string {
	return "@echo off\r\nchcp 65001 >nul\r\ncd /d \"%~dp0\"\r\n" +
		"echo ==== service ====\r\nsc query HanyeMonitor\r\n" +
		"echo ==== port 17890 ====\r\nnetstat -ano | findstr :17890\r\n" +
		"echo ==== service-error.log ====\r\ntype data\\service-error.log 2>nul\r\n" +
		"echo ==== service.log (tail) ====\r\npowershell -NoP -Command \"if(Test-Path data\\service.log){Get-Content data\\service.log -Tail 40}\"\r\n" +
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
