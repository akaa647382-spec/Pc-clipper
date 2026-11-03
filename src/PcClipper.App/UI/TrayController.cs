using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// The notification-area icon (SPEC "Tray icon"): always visible while running, double-click shows the window,
/// a menu with every action, a state tooltip (max 63 chars) and a red-dot icon while recording.
/// </summary>
internal sealed class TrayController : IDisposable
{
    private readonly AppController _app;
    private readonly NotifyIcon _icon;
    private readonly ContextMenuStrip _menu;
    private readonly Icon _normalIcon;
    private readonly Icon _recordingIcon;
    private readonly ToolStripMenuItem _toggleReplay;
    private readonly ToolStripMenuItem _saveMenu;
    private readonly ToolStripMenuItem _record;
    private readonly ToolStripMenuItem _retryRecording;
    private readonly ToolStripMenuItem _screenshot;
    private bool _showingRecordingIcon;
    private bool _disposed;

    public TrayController(AppController app)
    {
        _app = app;
        int size = Math.Max(16, SystemInformation.SmallIconSize.Width);
        _normalIcon = Theme.AppIcon(size);
        _recordingIcon = MakeRecordingIcon(_normalIcon, size);

        _menu = new ContextMenuStrip
        {
            Renderer = new DarkMenuRenderer(),
            ShowImageMargin = false,
            Font = Theme.MakeFont(10f),
            ForeColor = Theme.Text,
            BackColor = Theme.Card,
        };
        _toggleReplay = Item("Turn replay on", (_, _) => _app.ToggleReplay());
        _saveMenu = new ToolStripMenuItem("Save the last") { ForeColor = Theme.Text };
        _saveMenu.DropDown.BackColor = Theme.Card;
        if (_saveMenu.DropDown is ToolStripDropDownMenu dd) dd.ShowImageMargin = false;
        _saveMenu.DropDown.Renderer = new DarkMenuRenderer();
        foreach (var seconds in AppSettings.SaveLengthsSeconds)
        {
            int s = seconds;
            var item = Item(QualityMath.FormatSaveLength(s), (_, _) => _app.SaveLast(s));
            item.Tag = s;
            _saveMenu.DropDownItems.Add(item);
        }
        _record = Item("Start recording", (_, _) => _app.ToggleRecording());
        _retryRecording = Item("Save the unsaved recording again", (_, _) => _app.RetryPendingRecordings());
        _retryRecording.Visible = false;
        _screenshot = Item("Take screenshot", (_, _) => _app.TakeScreenshot());
        var openClips = Item("Open clips folder", (_, _) => _app.OpenClipsFolder());
        var show = Item("Show PC Clipper", (_, _) => _app.ShowMainWindow());
        show.Font = Theme.MakeFont(10f, semibold: true);
        var exit = Item("Exit", (_, _) => _app.ExitApp());

        _menu.Items.AddRange(new ToolStripItem[]
        {
            _toggleReplay, _saveMenu, _record, _retryRecording, _screenshot, new ToolStripSeparator(), openClips, show, new ToolStripSeparator(), exit,
        });
        _menu.Opening += (_, _) => UpdateMenu();

        _icon = new NotifyIcon
        {
            Icon = _normalIcon,
            Text = "PC Clipper",
            ContextMenuStrip = _menu,
            Visible = true,
        };
        _icon.MouseDoubleClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) _app.ShowMainWindow();
        };
        _icon.BalloonTipClicked += (_, _) => _app.ShowMainWindow();
    }

    private static ToolStripMenuItem Item(string text, EventHandler onClick)
    {
        var item = new ToolStripMenuItem(text) { ForeColor = Theme.Text };
        item.Click += onClick;
        return item;
    }

    /// <summary>Refresh tooltip and icon (called every second and on every state change).</summary>
    public void Refresh()
    {
        if (_disposed) return;
        try
        {
            var tip = Fmt.Truncate(_app.TrayTooltip(), 63);
            if (_icon.Text != tip) _icon.Text = tip;
            bool rec = _app.IsRecording;
            if (rec != _showingRecordingIcon)
            {
                _showingRecordingIcon = rec;
                _icon.Icon = rec ? _recordingIcon : _normalIcon;
            }
        }
        catch
        {
            // The shell can refuse updates while Explorer restarts; the next tick tries again.
        }
    }

    private void UpdateMenu()
    {
        var state = _app.ReplayState;
        bool on = state is ReplayUiState.On or ReplayUiState.Starting or ReplayUiState.Resuming;
        _toggleReplay.Text = on ? "Turn replay off" : "Turn replay on";
        _toggleReplay.Enabled = state is not (ReplayUiState.Starting or ReplayUiState.Stopping or ReplayUiState.CheckingFfmpeg);

        // Like the Home buttons: a length is offered once that much is recorded.
        bool canSave = _app.CanSave;
        int buffer = _app.BufferSeconds;
        var buffered = _app.SafeBuffered();
        _saveMenu.Enabled = canSave;
        foreach (ToolStripItem item in _saveMenu.DropDownItems)
        {
            if (item.Tag is not int s) continue;
            bool recorded = _app.HasRecorded(s, buffered);
            item.Enabled = canSave && recorded;
            string label = QualityMath.FormatSaveLength(s);
            item.Text = canSave && !recorded && s <= buffer && state == ReplayUiState.On
                ? $"{label}  (unlocks {AppController.UnlocksIn(s, buffered)})"
                : label;
        }

        _record.Text = _app.IsRecording ? $"Stop recording ({Fmt.Clock(_app.RecordingElapsed)})"
            : _app.IsRecordingSaving ? "Saving recording..."
            : _app.IsRecordStartPending ? "Starting recording..." : "Start recording";
        _record.Enabled = !_app.IsRecordingSaving && !_app.IsRecordStartPending &&
                          state is not (ReplayUiState.CheckingFfmpeg or ReplayUiState.Stopping);
        int pending = _app.PendingRecordingCount;
        _retryRecording.Visible = pending > 0;
        _retryRecording.Text = _app.IsRetryingRecordings ? "Saving the recording again..."
            : pending > 1 ? $"Save the {pending} unsaved recordings again" : "Save the unsaved recording again";
        _retryRecording.Enabled = !_app.IsRetryingRecordings;
        _screenshot.Enabled = !_app.IsTakingScreenshot;
    }

    /// <summary>A Windows notification balloon (used when on-screen notifications are turned off).</summary>
    public void ShowBalloon(string title, string text)
    {
        if (_disposed) return;
        try { _icon.ShowBalloonTip(4000, title, text, ToolTipIcon.Info); }
        catch { /* notifications disabled */ }
    }

    /// <summary>The app icon with a small red dot in the bottom-right corner. GDI handles are released immediately.</summary>
    private static Icon MakeRecordingIcon(Icon baseIcon, int size)
    {
        try
        {
            using var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);
                g.DrawIcon(baseIcon, new Rectangle(0, 0, size, size));
                int d = Math.Max(7, size * 9 / 16);
                var dot = new Rectangle(size - d, size - d, d - 1, d - 1);
                using (var ring = new SolidBrush(Theme.Background)) g.FillEllipse(ring, Rectangle.Inflate(dot, 1, 1));
                using (var red = new SolidBrush(Theme.Red)) g.FillEllipse(red, dot);
            }
            IntPtr h = bmp.GetHicon();
            try
            {
                using var temp = Icon.FromHandle(h);
                return (Icon)temp.Clone(); // the clone owns its own copy of the handle
            }
            finally
            {
                Theme.DestroyIcon(h);
            }
        }
        catch
        {
            return (Icon)baseIcon.Clone();
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try
        {
            _icon.Visible = false;
            _icon.Dispose();
        }
        catch { }
        _menu.Dispose();
        _normalIcon.Dispose();
        _recordingIcon.Dispose();
    }
}
