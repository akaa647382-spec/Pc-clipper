using PcClipper.App.Platform;

namespace PcClipper.App.UI;

/// <summary>
/// The main window (SPEC "Main window"): a top bar with the app name, status pill and Home/Settings navigation,
/// then the Home or Settings page, and a notice bar at the bottom that mirrors the on-screen toasts.
/// Closing it hides to the tray (when that setting is on) instead of exiting.
/// </summary>
internal sealed class MainForm : Form
{
    private readonly AppController _app;
    private readonly HomeView _home;
    private readonly SettingsView _settings;
    private readonly StatusPill _pill;
    private readonly FlatButton _navHome;
    private readonly FlatButton _navSettings;
    private readonly NoticeBar _notice;
    private readonly System.Windows.Forms.Timer _timer;
    private bool _allowClose;

    public MainForm(AppController app)
    {
        _app = app;
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "PC Clipper";
        Font = Theme.MakeFont(10f);
        BackColor = Theme.Background;
        ForeColor = Theme.Text;
        // Tall enough for the whole Home page (banner-free) without scrolling at 100%; OnLoad shrinks it to fit the
        // screen's working area on small displays.
        ClientSize = new Size(820, 700);
        MinimumSize = new Size(760, 560);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Theme.AppIcon(32);

        // ---- Top bar ----
        var top = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 5,
            RowCount = 1,
            Padding = new Padding(Theme.Space3, Theme.Space2 - 4, Theme.Space3 - Theme.Space1, Theme.Space2 - 4),
            BackColor = Theme.Background,
        };
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        top.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        top.Paint += (_, e) =>
        {
            using var pen = new Pen(Theme.Border);
            e.Graphics.DrawLine(pen, 0, top.Height - 1, top.Width, top.Height - 1);
        };

        var logo = new PictureBox
        {
            Size = new Size(28, 28),
            SizeMode = PictureBoxSizeMode.Zoom,
            Anchor = AnchorStyles.Left,
            Margin = new Padding(0, 0, Theme.Space1 + 2, 0),
            BackColor = Color.Transparent,
        };
        try
        {
            using var big = Theme.AppIcon(48);
            logo.Image = big.ToBitmap();
        }
        catch
        {
            logo.Visible = false;
        }

        var title = Theme.MakeLabel("PC Clipper", 16f, semibold: true);
        title.Anchor = AnchorStyles.Left;
        title.Margin = new Padding(0);

        _pill = new StatusPill();
        _navHome = Theme.MakeButton("Home", ButtonKind.Ghost, minWidth: 84, height: 36);
        _navSettings = Theme.MakeButton("Settings", ButtonKind.Ghost, minWidth: 84, height: 36);
        _navHome.Margin = new Padding(0, 0, 4, 0);
        _navSettings.Margin = new Padding(0);
        _navHome.Click += (_, _) => ShowPage(settings: false);
        _navSettings.Click += (_, _) => ShowPage(settings: true);
        var nav = Theme.Inline(_navHome, _navSettings);
        nav.Anchor = AnchorStyles.Right;

        top.Controls.Add(logo, 0, 0);
        top.Controls.Add(title, 1, 0);
        top.Controls.Add(_pill, 3, 0);
        top.Controls.Add(nav, 4, 0);

        // ---- Pages ----
        var content = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background };
        _home = new HomeView(app) { Dock = DockStyle.Fill };
        _settings = new SettingsView(app) { Dock = DockStyle.Fill, Visible = false };
        _home.OpenSettingsRequested += (_, _) => ShowPage(settings: true);
        _home.PickClipsFolderRequested += (_, _) =>
        {
            ShowPage(settings: true);
            _settings.FocusClipsFolder();
        };
        content.Controls.Add(_settings);
        content.Controls.Add(_home);

        _notice = new NoticeBar();

        // Dock order: the Fill control must be docked last, i.e. sit first in the z-order.
        Controls.Add(content);
        Controls.Add(_notice);
        Controls.Add(top);
        content.BringToFront();

        _timer = new System.Windows.Forms.Timer { Interval = 1000 };
        _timer.Tick += (_, _) => RefreshAll();

        ResumeLayout(false);
        PerformLayout();

        _app.Changed += OnAppChanged;
        _app.NoticePosted += OnNotice;
        UpdateNav(settings: false);
        RefreshAll();
    }

    /// <summary>Shows the window (from the tray, a second launch, etc.) and brings it to the front.</summary>
    public void ShowAndActivate()
    {
        if (!Visible) Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        // Windows may refuse to give focus to a background app; briefly going topmost still brings us forward.
        TopMost = true;
        TopMost = false;
        Activate();
        RefreshAll();
    }

    /// <summary>Lets the window really close (app exit).</summary>
    public void CloseForExit()
    {
        if (IsDisposed) return;
        _allowClose = true;
        _timer.Stop();
        Close();
    }

    /// <summary>A notice that stays until replaced (used while saving a recording on exit).</summary>
    public void ShowBusyNotice(string text)
    {
        if (IsDisposed) return;
        _notice.ShowNotice(text, Theme.Accent, sticky: true);
    }

    /// <summary>Removes the busy notice (a Windows shutdown that was waiting for a save got cancelled).</summary>
    public void HideBusyNotice()
    {
        if (IsDisposed) return;
        _notice.HideNotice();
    }

    private void ShowPage(bool settings)
    {
        if (settings == _settings.Visible) return;
        SuspendLayout();
        _settings.Visible = settings;
        _home.Visible = !settings;
        ResumeLayout(true);
        UpdateNav(settings);
        if (settings) _settings.OnPageShown();
        RefreshAll();
    }

    private void UpdateNav(bool settings)
    {
        Style(_navHome, active: !settings);
        Style(_navSettings, active: settings);

        static void Style(FlatButton b, bool active)
        {
            b.Fill = active ? Theme.Neutral : Color.Transparent;
            b.TextColor = active ? Theme.Text : Theme.TextSecondary;
            b.Invalidate();
        }
    }

    private void OnAppChanged()
    {
        if (IsDisposed) return;
        RefreshAll();
        _settings.OnAppChanged();
    }

    private void OnNotice(Notice n)
    {
        if (IsDisposed) return;
        var color = n.Kind switch
        {
            ToastKind.Success => Theme.Green,
            ToastKind.Warning => Theme.Amber,
            ToastKind.Recording => Theme.Red,
            _ => Theme.Accent,
        };
        _notice.ShowNotice(n.Text, color);
    }

    /// <summary>Refreshes the visible page and the status pill (1 s timer + every state change).</summary>
    private void RefreshAll()
    {
        if (IsDisposed || !Visible) return;
        try
        {
            UpdatePill();
            if (_home.Visible) _home.RefreshState();
            if (_settings.Visible) _settings.RefreshLive();
        }
        catch (Exception ex)
        {
            _app.Log.Error("Window refresh failed", ex);
        }
    }

    private void UpdatePill()
    {
        if (_app.IsRecording)
        {
            _pill.Set($"RECORDING {Fmt.Clock(_app.RecordingElapsed)}", Theme.Red, Mark.Dot);
            return;
        }
        switch (_app.ReplayState)
        {
            case ReplayUiState.On:
                _pill.Set("REPLAY ON", Theme.Green, Mark.Dot);
                break;
            case ReplayUiState.Starting:
                _pill.Set("STARTING...", Theme.Accent, Mark.Ring);
                break;
            case ReplayUiState.Resuming:
                // Quiet on purpose: UAC prompts and fullscreen switches interrupt capture all the time.
                _pill.Set("RESUMING...", Theme.Accent, Mark.Ring);
                break;
            case ReplayUiState.Stopping:
                _pill.Set("TURNING OFF...", Theme.TextSecondary, Mark.Ring);
                break;
            case ReplayUiState.CheckingFfmpeg:
                _pill.Set("GETTING READY", Theme.TextSecondary, Mark.Ring);
                break;
            case ReplayUiState.Problem:
            case ReplayUiState.NeedsFfmpeg:
                _pill.Set("PROBLEM", Theme.Amber, Mark.Warning);
                break;
            default:
                _pill.Set("REPLAY OFF", Theme.TextSecondary, Mark.Ring);
                break;
        }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.TryDarkTitleBar(this);
    }

    protected override void OnLoad(EventArgs e)
    {
        // First show (sizes are DPI-scaled by now): never taller or wider than the screen's working area, e.g. a
        // 1366x768 laptop. base.OnLoad then centres the window with the final size.
        try
        {
            var area = Screen.FromPoint(Cursor.Position).WorkingArea;
            int h = Math.Max(MinimumSize.Height, Math.Min(Height, area.Height));
            int w = Math.Max(MinimumSize.Width, Math.Min(Width, area.Width));
            if (h != Height || w != Width) Size = new Size(w, h);
        }
        catch
        {
            // Keep the default size.
        }
        base.OnLoad(e);
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        _timer.Enabled = Visible;
        if (Visible) RefreshAll();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_allowClose)
        {
            base.OnFormClosing(e);
            return;
        }
        if (e.CloseReason == CloseReason.WindowsShutDown)
        {
            // WM_QUERYENDSESSION: Windows only asks - the shutdown can still be cancelled - so this only answers. "Not yet"
            // while a recording runs or any clip/recording is being written (ending the process would kill the copy):
            // the controller shows the reason on Windows' "preventing shutdown" screen and closes once everything is
            // written, then Windows continues. Otherwise "yes", and nothing else happens until WM_ENDSESSION (WndProc).
            // (The window exists even when PC Clipper started minimized - the controller creates its handle - so this
            // always runs. WinForms only answers the query here; it doesn't close the window.)
            e.Cancel = _app.OnSessionEndQuery();
            base.OnFormClosing(e);
            return;
        }
        if (e.CloseReason == CloseReason.TaskManagerClosing)
        {
            // WM_CLOSE from outside (Task Manager's "End task", an installer): close PC Clipper, keeping the window
            // while a video is still being written.
            e.Cancel = _app.ShouldBlockShutdown;
            _app.OnClosedFromOutside();
            base.OnFormClosing(e);
            return;
        }
        e.Cancel = true;
        if (_app.Settings.MinimizeToTrayOnClose && !_app.IsExiting)
        {
            if (_app.HasTray)
            {
                Hide();
                _app.ShowTrayHint();
            }
            else WindowState = FormWindowState.Minimized; // no tray icon to come back from
        }
        else
        {
            _app.ExitApp();
        }
        base.OnFormClosing(e);
    }

    private const int WM_ENDSESSION = 0x0016;

    /// <summary>
    /// WM_ENDSESSION tells how the WM_QUERYENDSESSION round ended: wParam TRUE = the session really ends (stop and close
    /// now, before returning), FALSE = the shutdown was cancelled (keep running).
    /// </summary>
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_ENDSESSION && !_allowClose)
        {
            bool ending = m.WParam != IntPtr.Zero;
            try { _app.OnSessionEnd(ending); }
            catch { /* never let the session end fail in here */ }
            if (ending)
            {
                // Handled: PC Clipper has stopped and closed this window (WinForms' own handling would only raise
                // FormClosed on it again).
                m.Result = IntPtr.Zero;
                return;
            }
        }
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _app.Changed -= OnAppChanged;
            _app.NoticePosted -= OnNotice;
            _timer.Dispose();
        }
        base.Dispose(disposing);
    }
}
