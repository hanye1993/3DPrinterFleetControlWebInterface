using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

namespace HanyeMonitorControl
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }
    }

    internal sealed class MainForm : Form
    {
        private const string ServiceName = "HanyeMonitor";
        private const string WebUrl = "http://127.0.0.1:17890/";

        private readonly NotifyIcon _tray;
        private readonly Label _status;
        private readonly Button _btnStart;
        private readonly Button _btnRestart;
        private readonly Button _btnStop;
        private readonly Button _btnOpen;
        private readonly Timer _timer;
        private readonly string _installDir;
        private readonly string _nssmPath;
        private bool _exiting;

        public MainForm()
        {
            _installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(
                Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            _nssmPath = Path.Combine(_installDir, "nssm.exe");

            Text = "hanye Printer Monitor";
            ClientSize = new Size(340, 260);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 10F);

            var iconPath = Path.Combine(_installDir, "app-icon.ico");
            if (File.Exists(iconPath))
            {
                try { Icon = new Icon(iconPath); } catch { /* ignore */ }
            }

            _status = new Label
            {
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Dock = DockStyle.Top,
                Height = 44,
                Text = "正在检测服务状态…"
            };

            var panel = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.TopDown,
                WrapContents = false,
                Padding = new Padding(28, 8, 28, 12)
            };

            _btnStart = MakeButton("启动", Color.FromArgb(22, 163, 74));
            _btnRestart = MakeButton("重启", Color.FromArgb(37, 99, 235));
            _btnStop = MakeButton("关闭", Color.FromArgb(220, 38, 38));
            _btnOpen = MakeButton("打开网页", Color.FromArgb(71, 85, 105));

            _btnStart.Click += (_, __) => RunService("start");
            _btnRestart.Click += (_, __) => RunService("restart");
            _btnStop.Click += (_, __) => RunService("stop");
            _btnOpen.Click += (_, __) => OpenWeb();

            panel.Controls.Add(_btnStart);
            panel.Controls.Add(_btnRestart);
            panel.Controls.Add(_btnStop);
            panel.Controls.Add(_btnOpen);

            Controls.Add(panel);
            Controls.Add(_status);

            var menu = new ContextMenuStrip();
            menu.Items.Add("启动", null, (_, __) => RunService("start"));
            menu.Items.Add("重启", null, (_, __) => RunService("restart"));
            menu.Items.Add("关闭", null, (_, __) => RunService("stop"));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("打开网页", null, (_, __) => OpenWeb());
            menu.Items.Add("显示窗口", null, (_, __) => ShowMain());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, (_, __) => ExitApp());

            _tray = new NotifyIcon
            {
                Visible = true,
                Text = "hanye Printer Monitor",
                ContextMenuStrip = menu,
                Icon = Icon ?? SystemIcons.Application
            };
            _tray.DoubleClick += (_, __) => ShowMain();

            Resize += (_, __) =>
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    Hide();
                    ShowInTaskbar = false;
                    _tray.ShowBalloonTip(1200, "hanye", "已收到托盘图标，右键可启停服务", ToolTipIcon.Info);
                }
            };

            FormClosing += (_, e) =>
            {
                if (_exiting) return;
                if (e.CloseReason == CloseReason.UserClosing)
                {
                    e.Cancel = true;
                    WindowState = FormWindowState.Minimized;
                }
            };

            _timer = new Timer { Interval = 3000 };
            _timer.Tick += (_, __) => RefreshStatus();
            _timer.Start();
            Load += (_, __) => RefreshStatus();
        }

        private static Button MakeButton(string text, Color back)
        {
            var btn = new Button
            {
                Text = text,
                Width = 280,
                Height = 38,
                Margin = new Padding(0, 0, 0, 10),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                BackColor = back,
                Cursor = Cursors.Hand
            };
            btn.FlatAppearance.BorderSize = 0;
            return btn;
        }

        private void ShowMain()
        {
            Show();
            ShowInTaskbar = true;
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ExitApp()
        {
            _exiting = true;
            _tray.Visible = false;
            _timer.Stop();
            Application.Exit();
        }

        private void OpenWeb()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = WebUrl,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "无法打开浏览器：\n" + ex.Message, Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void RunService(string action)
        {
            try
            {
                if (!File.Exists(_nssmPath))
                {
                    MessageBox.Show(this, "未找到 nssm.exe，请重新安装。", Text,
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                SetBusy(true);
                _status.Text = action == "start" ? "正在启动…"
                    : action == "restart" ? "正在重启…" : "正在关闭…";
                Application.DoEvents();

                var psi = new ProcessStartInfo
                {
                    FileName = _nssmPath,
                    Arguments = action + " " + ServiceName,
                    WorkingDirectory = _installDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (var p = Process.Start(psi))
                {
                    if (p == null) throw new InvalidOperationException("无法启动 nssm");
                    p.WaitForExit(60000);
                }

                if (action == "start" || action == "restart")
                {
                    System.Threading.Thread.Sleep(1500);
                    OpenWeb();
                }

                RefreshStatus();
                _tray.ShowBalloonTip(1200, "hanye",
                    action == "start" ? "服务已启动"
                    : action == "restart" ? "服务已重启" : "服务已关闭",
                    ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "操作失败：\n" + ex.Message, Text,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                RefreshStatus();
            }
            finally
            {
                SetBusy(false);
            }
        }

        private void SetBusy(bool busy)
        {
            _btnStart.Enabled = !busy;
            _btnRestart.Enabled = !busy;
            _btnStop.Enabled = !busy;
            _btnOpen.Enabled = !busy;
            UseWaitCursor = busy;
        }

        private void RefreshStatus()
        {
            try
            {
                var running = IsServiceRunning();
                _status.Text = running ? "状态：运行中（端口 17890）" : "状态：已停止";
                _status.ForeColor = running
                    ? Color.FromArgb(22, 163, 74)
                    : Color.FromArgb(220, 38, 38);
                _tray.Text = running ? "hanye — 运行中" : "hanye — 已停止";
            }
            catch
            {
                _status.Text = "状态：未知";
                _status.ForeColor = Color.Gray;
            }
        }

        private static bool IsServiceRunning()
        {
            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "sc.exe",
                    Arguments = "query " + ServiceName,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (var p = Process.Start(psi))
                {
                    if (p == null) return false;
                    var output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(5000);
                    return output.IndexOf("RUNNING", StringComparison.OrdinalIgnoreCase) >= 0;
                }
            }
            catch
            {
                return false;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _timer?.Dispose();
                if (_tray != null)
                {
                    _tray.Visible = false;
                    _tray.Dispose();
                }
            }
            base.Dispose(disposing);
        }
    }
}
