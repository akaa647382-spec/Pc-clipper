using System.Drawing.Drawing2D;
using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// The Home page (SPEC "HOME page"): problem banner, "a recording wasn't saved" banner, replay card with the big ON/OFF button, the seven
/// "Save the last..." buttons, Record / Screenshot / Open clips folder, the Recent list and a hotkey hint (plus a line with
/// the controller shortcuts, in that controller's button names, while one is connected).
/// Plain language only; all state comes from <see cref="AppController"/>.
/// </summary>
internal sealed class HomeView : UserControl
{
    private const int RecentRows = 8;

    private readonly AppController _app;
    private readonly ToolTip _tips;

    private readonly CardPanel _banner;
    private readonly Label _bannerText;
    private readonly FlatButton _bannerButton;

    private readonly CardPanel _recBanner;
    private readonly Label _recBannerText;
    private readonly FlatButton _recPrimary;
    private readonly FlatButton _recSecondary;
    private bool _recBannerPending;

    private readonly Label _replayLine;
    private readonly Label _replayDetail;
    private readonly Label _replayHint;
    private readonly FlatButton _toggle;
    private ButtonKind _toggleKind = ButtonKind.Primary;
    private ButtonKind _recordKind = ButtonKind.Secondary;

    private readonly FlatButton[] _saveButtons;

    private readonly FlatButton _record;
    private readonly FlatButton _screenshot;
    private readonly FlatButton _openFolder;

    private readonly RecentRow[] _rows = new RecentRow[RecentRows];
    private readonly Label _recentEmpty;
    private readonly Label _footer;

    public HomeView(AppController app)
    {
        _app = app;
        BackColor = Theme.Background;
        ForeColor = Theme.Text;
        Padding = new Padding(Theme.Space3, Theme.Space2 + 4, Theme.Space3, Theme.Space1);
        Theme.VerticalScrollOnly(this);
        Theme.UseDarkScrollBars(this);
        _tips = Theme.MakeToolTip();

        var stack = Theme.Stack();
        stack.Dock = DockStyle.Top;
        stack.BackColor = Theme.Background;

        // ---- Problem banner (amber) ----
        _banner = new CardPanel
        {
            ColumnCount = 3,
            FillColor = Theme.Tint(Theme.Amber, Theme.Card, 0.12),
            EdgeColor = Theme.Tint(Theme.Amber, Theme.Card, 0.45),
            Visible = false,
        };
        _banner.ColumnStyles.Clear();
        _banner.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _banner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _banner.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var bannerIcon = new MarkIcon(Mark.Warning, Theme.Amber) { Anchor = AnchorStyles.Left | AnchorStyles.Top, Margin = new Padding(0, 5, Theme.Space1 + 4, 0) };
        _bannerText = Theme.MakeLabel("", 10f, color: Theme.Text, wrap: true);
        _bannerText.Margin = new Padding(0, 4, Theme.Space2, 4);
        _bannerButton = Theme.MakeButton("Try again", ButtonKind.Secondary, minWidth: 120, height: 38);
        _bannerButton.Fill = Theme.Amber;
        _bannerButton.FillHover = Theme.Mix(Theme.Amber, Color.White, 0.15);
        _bannerButton.FillPressed = Theme.Mix(Theme.Amber, Color.Black, 0.15);
        _bannerButton.TextColor = Theme.Background;
        _bannerButton.EdgeColor = null;
        _bannerButton.Anchor = AnchorStyles.Right;
        _bannerButton.Margin = new Padding(0);
        _bannerButton.Click += (_, _) => _app.ResolveProblem();
        Theme.AddRow(_banner, bannerIcon, _bannerText, _bannerButton);

        // ---- "A recording wasn't saved" banner (amber): Try again / Pick another folder, or the "recording kept" notice ----
        _recBanner = new CardPanel
        {
            ColumnCount = 4,
            FillColor = Theme.Tint(Theme.Amber, Theme.Card, 0.12),
            EdgeColor = Theme.Tint(Theme.Amber, Theme.Card, 0.45),
            Visible = false,
        };
        _recBanner.ColumnStyles.Clear();
        _recBanner.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _recBanner.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _recBanner.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        _recBanner.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var recIcon = new MarkIcon(Mark.Warning, Theme.Amber) { Anchor = AnchorStyles.Left | AnchorStyles.Top, Margin = new Padding(0, 5, Theme.Space1 + 4, 0) };
        _recBannerText = Theme.MakeLabel("", 10f, color: Theme.Text, wrap: true);
        _recBannerText.Margin = new Padding(0, 4, Theme.Space2, 4);
        _recPrimary = Theme.MakeButton("Try again", ButtonKind.Secondary, minWidth: 110, height: 38);
        _recPrimary.Fill = Theme.Amber;
        _recPrimary.FillHover = Theme.Mix(Theme.Amber, Color.White, 0.15);
        _recPrimary.FillPressed = Theme.Mix(Theme.Amber, Color.Black, 0.15);
        _recPrimary.TextColor = Theme.Background;
        _recPrimary.EdgeColor = null;
        _recPrimary.Anchor = AnchorStyles.Right;
        _recPrimary.Margin = new Padding(0, 0, Theme.Space1, 0);
        _recPrimary.Click += (_, _) =>
        {
            if (_recBannerPending) _app.RetryPendingRecordings();
            else _app.OpenKeptRecordingFolder();
        };
        _recSecondary = Theme.MakeButton("Pick another folder", ButtonKind.Secondary, height: 38);
        _recSecondary.Anchor = AnchorStyles.Right;
        _recSecondary.Margin = new Padding(0);
        _recSecondary.Click += (_, _) =>
        {
            if (_recBannerPending) PickClipsFolderRequested?.Invoke(this, EventArgs.Empty);
            else _app.DismissKeptRecordingNotice();
        };
        Theme.AddRow(_recBanner, recIcon, _recBannerText, _recPrimary, _recSecondary);

        // ---- Replay card ----
        var replay = new CardPanel { ColumnCount = 2 };
        replay.ColumnStyles.Clear();
        replay.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        replay.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var replayTitle = Theme.MakeLabel("Replay buffer", 18f, semibold: true);
        replayTitle.Margin = new Padding(0, 0, 0, 2);
        _replayLine = Theme.MakeLabel("", 11f, color: Theme.Text, wrap: true);
        _replayLine.Margin = new Padding(0, 0, Theme.Space2, 2);
        _replayDetail = Theme.MakeLabel("", 9f, color: Theme.TextSecondary, wrap: true);
        _replayDetail.Margin = new Padding(0, 0, Theme.Space2, 0);
        _replayHint = Theme.MakeLabel("", 9f, color: Theme.Amber, wrap: true);
        _replayHint.Margin = new Padding(0, 4, Theme.Space2, 0);
        _replayHint.Visible = false;
        _toggle = Theme.MakeButton("Turn ON", ButtonKind.Primary, minWidth: 168, height: 54, points: 12f);
        _toggle.Anchor = AnchorStyles.Right;
        _toggle.Margin = new Padding(0);
        _toggle.CornerRadius = 10;
        _toggle.Click += (_, _) => _app.ToggleReplay();
        Theme.AddRow(replay, replayTitle, _toggle);
        Theme.AddRow(replay, _replayLine);
        Theme.AddRow(replay, _replayDetail);
        Theme.AddRow(replay, _replayHint);
        replay.SetRowSpan(_toggle, 4);

        // ---- Save card ----
        var save = new CardPanel();
        var saveTitle = Theme.MakeLabel("Save the last...", 14f, semibold: true);
        saveTitle.Margin = new Padding(0, 0, 0, 2);
        var saveSub = Theme.MakeLabel("Saves a video of what just happened to your clips folder. You can keep playing while it saves.",
            9.5f, color: Theme.TextSecondary, wrap: true);
        saveSub.Margin = new Padding(0, 0, 0, Theme.Space2 - 4);
        var lengths = AppSettings.SaveLengthsSeconds;
        var grid = new TableLayoutPanel
        {
            ColumnCount = lengths.Length,
            RowCount = 1,
            Dock = DockStyle.Fill,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _saveButtons = new FlatButton[lengths.Length];
        for (int i = 0; i < lengths.Length; i++)
        {
            int seconds = lengths[i];
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / lengths.Length));
            var b = Theme.MakeButton(QualityMath.FormatSaveLength(seconds), ButtonKind.Secondary, height: 58, points: 11.5f);
            b.Dock = DockStyle.Fill;
            b.AutoSize = false;
            b.Padding = new Padding(2, 6, 2, 6);
            b.Margin = new Padding(i == 0 ? 0 : 4, 0, i == lengths.Length - 1 ? 0 : 4, 0);
            b.Tag = seconds;
            b.Click += (_, _) => _app.SaveLast(seconds);
            b.DimmedClick += (s, _) => ExplainUnavailable((FlatButton)s!);
            grid.Controls.Add(b, i, 0);
            _saveButtons[i] = b;
        }
        Theme.AddRow(save, saveTitle);
        Theme.AddRow(save, saveSub);
        Theme.AddRow(save, grid);

        // ---- Action row ----
        var actions = new TableLayoutPanel
        {
            ColumnCount = 3,
            RowCount = 1,
            Dock = DockStyle.Fill,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Margin = new Padding(0, 0, 0, Theme.Space2),
        };
        actions.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        _record = ActionButton("Record", 0);
        _record.Glyph = Mark.Dot;
        _record.GlyphColor = Theme.Red;
        _record.Click += (_, _) => _app.ToggleRecording();
        _record.DimmedClick += (s, _) => ExplainUnavailable((FlatButton)s!);
        _screenshot = ActionButton("Screenshot", 1);
        _screenshot.Click += (_, _) => _app.TakeScreenshot();
        _openFolder = ActionButton("Open clips folder", 2);
        _openFolder.Click += (_, _) => _app.OpenClipsFolder();
        actions.Controls.Add(_record, 0, 0);
        actions.Controls.Add(_screenshot, 1, 0);
        actions.Controls.Add(_openFolder, 2, 0);
        _tips.SetToolTip(_screenshot, "Saves a picture of your screen to the screenshots folder.");
        _tips.SetToolTip(_openFolder, "Opens the folder where your clips and recordings are saved.");

        FlatButton ActionButton(string text, int col)
        {
            actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f / 3));
            var b = Theme.MakeButton(text, ButtonKind.Secondary, height: 50, points: 11f);
            b.Dock = DockStyle.Fill;
            b.AutoSize = false;
            b.Margin = new Padding(col == 0 ? 0 : 6, 0, col == 2 ? 0 : 6, 0);
            return b;
        }

        // ---- Recent ----
        var recent = new CardPanel();
        var recentTitle = Theme.MakeLabel("Recent", 14f, semibold: true);
        recentTitle.Margin = new Padding(0, 0, 0, Theme.Space1);
        Theme.AddRow(recent, recentTitle);
        _recentEmpty = Theme.MakeLabel("Nothing saved yet. Your clips, recordings and screenshots will show up here.",
            9.5f, color: Theme.TextSecondary, wrap: true);
        _recentEmpty.Margin = new Padding(0, 0, 0, 4);
        Theme.AddRow(recent, _recentEmpty);
        for (int i = 0; i < RecentRows; i++)
        {
            var row = new RecentRow { Dock = DockStyle.Fill, Visible = false, Margin = new Padding(0, 0, 0, 2) };
            row.OpenRequested += (_, item) => OpenItem(item);
            row.ShowRequested += (_, item) => ShowItem(item);
            _rows[i] = row;
            Theme.AddRow(recent, row);
        }

        // ---- Footer ----
        _footer = Theme.MakeLabel("", 9f, color: Theme.TextSecondary, wrap: true);
        _footer.Margin = new Padding(4, 0, 0, Theme.Space1);

        Theme.AddRow(stack, _banner);
        Theme.AddRow(stack, _recBanner);
        Theme.AddRow(stack, replay);
        Theme.AddRow(stack, save);
        Theme.AddRow(stack, actions);
        Theme.AddRow(stack, recent);
        Theme.AddRow(stack, _footer);
        Controls.Add(stack);
    }

    /// <summary>"Change it in Settings" links on Home ask the window to switch pages.</summary>
    public event EventHandler? OpenSettingsRequested;

    /// <summary>"Pick another folder" on the recording banner: open Settings at the clips folder.</summary>
    public event EventHandler? PickClipsFolderRequested;

    /// <summary>Re-reads everything from the controller. Cheap: only changed texts are touched.</summary>
    public void RefreshState()
    {
        var state = _app.ReplayState;
        bool recording = _app.IsRecording;
        var settings = _app.Settings;

        // Banner
        var problem = _app.ProblemText;
        Theme.SetVisible(_banner, problem is not null);
        if (problem is not null)
        {
            Theme.SetText(_bannerText, problem);
            var action = _app.ProblemActionText;
            Theme.SetVisible(_bannerButton, action is not null);
            if (action is not null) Theme.SetText(_bannerButton, action);
        }

        // Recording banner
        var recText = _app.RecordingBannerText;
        Theme.SetVisible(_recBanner, recText is not null);
        if (recText is not null)
        {
            Theme.SetText(_recBannerText, recText);
            _recBannerPending = _app.RecordingBannerIsPending;
            // While the start-up recovery saves a kept recording there is nothing to press.
            bool recovering = !_recBannerPending && _app.IsRecoveringRecordings;
            Theme.SetVisible(_recPrimary, !recovering);
            Theme.SetVisible(_recSecondary, !recovering);
            Theme.SetText(_recPrimary, _recBannerPending ? "Try again" : "Open folder");
            Theme.SetText(_recSecondary, _recBannerPending ? "Pick another folder" : "OK");
            bool retrying = _app.IsRetryingRecordings;
            _recPrimary.Dimmed = retrying;
            _recSecondary.Dimmed = retrying;
            Theme.SetTip(_tips, _recPrimary, _recBannerPending ? "Save the recording into your clips folder again." : "Open the folder where PC Clipper keeps the recording.");
            Theme.SetTip(_tips, _recSecondary, _recBannerPending ? "Choose a clips folder on a drive with free space (Settings > Saving), then press Try again." : null);
        }

        // Replay card
        int bufferSeconds = _app.BufferSeconds;
        var cfg = _app.Engine.ActiveConfig;
        string line, detail = "";
        switch (state)
        {
            case ReplayUiState.On:
                line = $"On — {Fmt.MinSec(_app.SafeBuffered())} saved of {Fmt.MinSec(TimeSpan.FromSeconds(bufferSeconds))}";
                if (recording) line += $" · recording {Fmt.Clock(_app.RecordingElapsed)}";
                detail = cfg is null ? "" : cfg.Describe();
                if (cfg is { Method: CaptureMethod.WindowsGraphicsCapture }) detail += " - Windows Graphics Capture";
                else if (cfg is { TimerPacedCapture: true }) detail += " - classic timing";
                break;
            case ReplayUiState.Resuming:
                line = "Capture interrupted — resuming...";
                detail = (_app.ResumeDetail ?? "") +
                         (_app.CanSave ? $" Your last {Fmt.MinSec(_app.SafeBuffered())} is kept and can still be saved." : "");
                detail = detail.Trim();
                break;
            case ReplayUiState.Starting:
                line = "Starting...";
                detail = _app.IsRecoveringRecordings
                    ? "Saving a recording from last time first; the replay turns on right after."
                    : "Getting the screen capture and your graphics card ready. This takes a few seconds.";
                break;
            case ReplayUiState.Stopping:
                line = _app.IsRecordingSaving ? "Saving your recording, then turning off..."
                    : _app.IsAnySaveInFlight ? "Saving your clip, then turning off..."
                    : "Turning off...";
                break;
            case ReplayUiState.CheckingFfmpeg:
                line = "Getting ready — checking your graphics card...";
                detail = "This only takes a few seconds.";
                break;
            case ReplayUiState.NeedsFfmpeg:
                line = "Off — PC Clipper needs FFmpeg before it can record.";
                detail = "Press Turn ON (or Set up FFmpeg above) and PC Clipper will set it up for you.";
                break;
            case ReplayUiState.Problem:
                line = "Off — something went wrong (see above).";
                detail = "Press Turn ON to try again.";
                break;
            default:
                line = $"Off — turn it on to start keeping your last {Fmt.Minutes(settings.BufferMinutes)}";
                detail = "Nothing is saved until you press a save button or hotkey.";
                break;
        }
        Theme.SetText(_replayLine, line);
        Theme.SetText(_replayDetail, detail);
        Theme.SetVisible(_replayDetail, detail.Length > 0);

        string? hint = null;
        if (state == ReplayUiState.On)
        {
            try
            {
                // ffmpeg's speed lags while a still screen sends no video (it catches up with the next picture), so
                // that is no sign of a slow PC.
                bool still = cfg is { PausesOnStillScreen: true } && _app.Stats is { } st && st.SinceNewVideo > TimeSpan.FromSeconds(2);
                if (!still && _app.Stats is { } stats && stats.Uptime > TimeSpan.FromSeconds(15) && stats.Speed > 0 && stats.Speed < 0.93)
                    hint = "Your PC is struggling to keep up right now, so clips may look choppy. Lower the quality or frame rate in Settings.";
            }
            catch
            {
                // Stats are optional.
            }
        }
        if (hint is not null) Theme.SetText(_replayHint, hint);
        Theme.SetVisible(_replayHint, hint is not null);

        bool active = state is ReplayUiState.On or ReplayUiState.Starting or ReplayUiState.Resuming;
        bool busy = state is ReplayUiState.Starting or ReplayUiState.Stopping or ReplayUiState.CheckingFfmpeg;
        Theme.SetText(_toggle, state switch
        {
            ReplayUiState.Starting => "Starting...",
            ReplayUiState.Stopping => "Turning off...",
            ReplayUiState.CheckingFfmpeg => "Please wait...",
            _ => active ? "Turn OFF" : "Turn ON",
        });
        // Dimmed (not disabled) so keyboard focus stays put while it is busy.
        _toggle.Dimmed = busy || _app.IsBenchmarkRunning;
        SetKind(_toggle, ref _toggleKind, active && !busy ? ButtonKind.Secondary : ButtonKind.Primary);

        // Save buttons: like on PlayStation, each length unlocks once that much is recorded (greyed out until then, with a
        // bar filling up towards it). The same number drives the "0:40 saved of 15:00" line above.
        bool canSave = _app.CanSave;
        var buffered = _app.SafeBuffered();
        bool capturing = state == ReplayUiState.On;
        foreach (var b in _saveButtons)
        {
            int seconds = (int)b.Tag!;
            string label = QualityMath.FormatSaveLength(seconds);
            bool tooLong = seconds > bufferSeconds;
            bool recorded = _app.HasRecorded(seconds, buffered);
            Theme.SetText(b, _app.IsSaving(seconds) ? "Saving..." : label);
            b.Dimmed = !canSave || tooLong || !recorded;
            b.Progress = canSave && !tooLong && !recorded ? buffered.TotalSeconds / seconds : null;
            Theme.SetTip(_tips, b,
                tooLong ? $"Your buffer keeps {QualityMath.FormatSaveLength(bufferSeconds)}. Increase it in Settings."
                : !canSave ? "Turn the replay buffer on first."
                : recorded ? $"Save the last {label} as a video"
                : capturing ? $"Unlocks once {label} is recorded ({AppController.UnlocksIn(seconds, buffered)}). So far: {Fmt.MinSec(buffered)}."
                : $"Only {Fmt.MinSec(buffered)} was recorded before the capture stopped.");
        }

        // Action row
        if (recording)
        {
            Theme.SetText(_record, $"Stop {Fmt.Clock(_app.RecordingElapsed)}");
            SetKind(_record, ref _recordKind, ButtonKind.Danger);
            _record.Glyph = Mark.Square;
            _record.GlyphColor = null;
            _record.Dimmed = false;
            Theme.SetTip(_tips, _record, "Stop and save the recording.");
        }
        else
        {
            bool pending = _app.IsRecordStartPending;
            bool saving = _app.IsRecordingSaving;
            Theme.SetText(_record, saving ? "Saving recording..." : pending ? "Starting recording..." : "Record");
            SetKind(_record, ref _recordKind, ButtonKind.Secondary);
            _record.Glyph = saving || pending ? Mark.None : Mark.Dot;
            _record.GlyphColor = Theme.Red;
            _record.Dimmed = saving || pending || state is ReplayUiState.CheckingFfmpeg or ReplayUiState.Stopping;
            Theme.SetTip(_tips, _record,
                saving ? "Still saving your last recording - press Record again in a moment."
                : pending ? "The replay buffer is starting; the recording begins as soon as it is on."
                : "Record until you press Stop (turns the replay buffer on if it's off).");
        }
        Theme.SetText(_screenshot, _app.IsTakingScreenshot ? "Taking screenshot..." : "Screenshot");
        _screenshot.Dimmed = _app.IsTakingScreenshot;

        // Recent
        var items = _app.Recent;
        Theme.SetVisible(_recentEmpty, items.Count == 0);
        for (int i = 0; i < _rows.Length; i++)
        {
            var item = i < items.Count ? items[i] : null;
            _rows[i].Item = item;
            Theme.SetVisible(_rows[i], item is not null);
        }

        // Footer
        Theme.SetText(_footer, FooterText(settings, out bool hasErrors));
        Theme.SetFore(_footer, hasErrors ? Theme.Amber : Theme.TextSecondary);
    }

    private static void SetKind(FlatButton b, ref ButtonKind current, ButtonKind kind)
    {
        if (current == kind) return;
        current = kind;
        b.ApplyKind(kind);
    }

    private string FooterText(AppSettings s, out bool hasErrors)
    {
        var errors = _app.HotkeyErrors;
        hasErrors = errors.Count > 0;
        var parts = new List<string>();
        void Add(HotkeyBinding b, HotkeyAction action, string what)
        {
            if (!b.IsAssigned) return;
            var text = $"{HotkeyText.Describe(b)} {what}";
            if (errors.ContainsKey(action)) text += " (not working)";
            parts.Add(text);
        }
        Add(s.SaveReplayHotkey, HotkeyAction.SaveReplay, $"save last {QualityMath.FormatSaveLength(s.HotkeySaveSeconds)}");
        Add(s.RecordHotkey, HotkeyAction.ToggleRecording, "record");
        Add(s.ScreenshotHotkey, HotkeyAction.Screenshot, "screenshot");
        Add(s.ToggleReplayHotkey, HotkeyAction.ToggleReplay, "replay on/off");
        string text;
        if (parts.Count == 0) text = "Tip: set up hotkeys in Settings to save clips without leaving your game.";
        else
        {
            text = "Hotkeys: " + string.Join(" · ", parts);
            if (hasErrors) text += " — some hotkeys aren't working right now; see Settings > Hotkeys.";
        }
        var pads = ControllerFooter(s);
        return pads is null ? text : text + Environment.NewLine + pads;
    }

    /// <summary>
    /// "PS5 controller: Create/Share + Cross save last 15 min · Create/Share + Square record · ..." while a controller is
    /// connected, in its own button names (one line per family when an Xbox and a PlayStation pad are both connected).
    /// </summary>
    private string? ControllerFooter(AppSettings s)
    {
        var pads = _app.Controllers;
        if (!s.ControllerShortcuts || pads.Count == 0) return null;
        var lines = new List<string>();
        foreach (var family in pads.GroupBy(p => p.IsPlayStation))
        {
            bool ps = family.Key;
            var kinds = family.Select(p => p.Kind).Distinct().ToList();
            string who = kinds.Count == 1 ? PadText.Family(kinds[0]) : "PlayStation controllers";
            var parts = new List<string>();
            void Add(PadChord chord, string what)
            {
                if (chord.IsAssigned) parts.Add($"{PadText.Short(chord, ps)} {what}");
            }
            Add(s.PadSaveReplay, $"save last {QualityMath.FormatSaveLength(s.HotkeySaveSeconds)}");
            Add(s.PadRecord, "record");
            Add(s.PadScreenshot, "screenshot");
            Add(s.PadToggleReplay, "replay on/off");
            lines.Add(parts.Count == 0
                ? $"{who} connected - pick its shortcuts in Settings > Controller."
                : $"{who}: " + string.Join(" · ", parts));
        }
        return string.Join(Environment.NewLine, lines);
    }

    private void ExplainUnavailable(FlatButton b)
    {
        var tip = _tips.GetToolTip(b);
        if (b.Tag is int seconds && seconds > _app.BufferSeconds)
        {
            if (MessageDialog.Confirm(FindForm(), "Your buffer is shorter than that",
                    $"{tip}\n\nWant to open Settings now?", "Open Settings", "Not now"))
                OpenSettingsRequested?.Invoke(this, EventArgs.Empty);
            return;
        }
        if (!string.IsNullOrEmpty(tip)) _tips.Show(tip, b, b.Width / 2, b.Height + 4, 3000);
    }

    private void OpenItem(RecentItem item)
    {
        if (!Shell.Open(item.Path, out var err)) Fail(item, err);
    }

    private void ShowItem(RecentItem item)
    {
        if (!Shell.ShowInFolder(item.Path, out var err)) Fail(item, err);
    }

    private void Fail(RecentItem item, string? err)
    {
        _app.Notify(err ?? "That didn't work.", ToastKind.Warning);
        if (!File.Exists(item.Path)) _app.ForgetRecent(item.Path);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _tips.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>One line of the Recent list: icon, name, details, and "Open" / "Show in folder" links. Double-click opens.</summary>
internal sealed class RecentRow : Control
{
    private readonly Font _nameFont = Theme.MakeFont(10f, semibold: true);
    private readonly Font _metaFont = Theme.MakeFont(9f);
    private readonly Font _linkFont = Theme.MakeFont(9.5f);
    private RecentItem? _item;
    private bool _hover;
    private int _hoverLink = -1; // 0 = Open, 1 = Show in folder
    private Rectangle _openRect, _showRect;

    public RecentRow()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.Selectable | ControlStyles.StandardDoubleClick, true);
        TabStop = true;
        BackColor = Theme.Card;
        AutoSize = true; // height comes from GetPreferredSize (font based, so it follows DPI)
        Height = 48;
    }

    public event EventHandler<RecentItem>? OpenRequested;
    public event EventHandler<RecentItem>? ShowRequested;

    public RecentItem? Item
    {
        get => _item;
        set
        {
            if (Equals(_item, value)) return;
            _item = value;
            Invalidate();
        }
    }

    public override Size GetPreferredSize(Size proposedSize)
    {
        int h = TextRenderer.MeasureText("Ag", _nameFont).Height + TextRenderer.MeasureText("Ag", _metaFont).Height + LogicalToDeviceUnits(14);
        return new Size(Math.Max(proposedSize.Width, LogicalToDeviceUnits(200)), h);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        var back = Theme.EffectiveBackColor(Parent);
        g.Clear(back);
        if (_item is null) return;
        g.SmoothingMode = SmoothingMode.AntiAlias;

        if (_hover || Focused)
        {
            using var path = Theme.RoundedRect(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), LogicalToDeviceUnits(8));
            using var b = new SolidBrush(Theme.RowHover);
            g.FillPath(b, path);
        }

        int pad = LogicalToDeviceUnits(10);
        int icon = Math.Min(Height - pad * 2 + LogicalToDeviceUnits(6), LogicalToDeviceUnits(32));
        var iconRect = new Rectangle(pad, (Height - icon) / 2, icon, icon);
        DrawKindIcon(g, iconRect, _item.Kind);

        // Links on the right
        const TextFormatFlags one = TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
        var showSize = TextRenderer.MeasureText(g, "Show in folder", _linkFont, Size.Empty, one);
        var openSize = TextRenderer.MeasureText(g, "Open", _linkFont, Size.Empty, one);
        int gap = LogicalToDeviceUnits(18);
        _showRect = new Rectangle(Width - pad - showSize.Width, (Height - showSize.Height) / 2, showSize.Width, showSize.Height);
        _openRect = new Rectangle(_showRect.Left - gap - openSize.Width, _showRect.Top, openSize.Width, openSize.Height);
        DrawLink(g, "Open", _openRect, _hoverLink == 0);
        DrawLink(g, "Show in folder", _showRect, _hoverLink == 1);

        // Name + details
        int textLeft = iconRect.Right + LogicalToDeviceUnits(12);
        int textWidth = Math.Max(10, _openRect.Left - gap - textLeft);
        int nameH = TextRenderer.MeasureText(g, "Ag", _nameFont, Size.Empty, one).Height;
        int metaH = TextRenderer.MeasureText(g, "Ag", _metaFont, Size.Empty, one).Height;
        int top = (Height - nameH - metaH - LogicalToDeviceUnits(2)) / 2;
        TextRenderer.DrawText(g, _item.Name, _nameFont, new Rectangle(textLeft, top, textWidth, nameH), Theme.Text, one | TextFormatFlags.EndEllipsis);
        TextRenderer.DrawText(g, Meta(_item), _metaFont, new Rectangle(textLeft, top + nameH + LogicalToDeviceUnits(2), textWidth, metaH),
            Theme.TextSecondary, one | TextFormatFlags.EndEllipsis);
    }

    private static string Meta(RecentItem item)
    {
        var parts = new List<string>();
        parts.Add(item.Kind switch { RecentKind.Recording => "Recording", RecentKind.Screenshot => "Screenshot", _ => "Clip" });
        if (item.Duration is { } d) parts.Add(Fmt.Clock(d));
        if (item.Bytes > 0) parts.Add(QualityMath.FormatBytes(item.Bytes));
        parts.Add(Fmt.When(item.When));
        return string.Join("  ·  ", parts);
    }

    private void DrawLink(Graphics g, string text, Rectangle r, bool hover)
    {
        var font = hover ? new Font(_linkFont, FontStyle.Underline) : _linkFont;
        try
        {
            TextRenderer.DrawText(g, text, font, r, hover ? Theme.AccentHover : Theme.Accent,
                TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding);
        }
        finally
        {
            if (!ReferenceEquals(font, _linkFont)) font.Dispose();
        }
    }

    private void DrawKindIcon(Graphics g, Rectangle r, RecentKind kind)
    {
        var color = kind switch { RecentKind.Recording => Theme.Red, RecentKind.Screenshot => Theme.Green, _ => Theme.Accent };
        using (var path = Theme.RoundedRect(r, LogicalToDeviceUnits(7)))
        using (var b = new SolidBrush(Theme.Tint(color, Theme.Card, 0.2)))
            g.FillPath(b, path);
        using var fg = new SolidBrush(color);
        float cx = r.X + r.Width / 2f, cy = r.Y + r.Height / 2f, s = r.Width * 0.22f;
        switch (kind)
        {
            case RecentKind.Screenshot:
            {
                // A little picture frame with a mountain.
                using var pen = new Pen(color, Math.Max(1.5f, r.Width / 16f));
                var frame = new RectangleF(cx - s * 1.3f, cy - s, s * 2.6f, s * 2f);
                g.DrawRectangle(pen, frame.X, frame.Y, frame.Width, frame.Height);
                g.FillPolygon(fg, new[]
                {
                    new PointF(frame.Left + 1, frame.Bottom - 1), new PointF(cx - s * 0.3f, cy - s * 0.1f),
                    new PointF(cx + s * 0.2f, cy + s * 0.4f), new PointF(cx + s * 0.6f, cy), new PointF(frame.Right - 1, frame.Bottom - 1),
                });
                break;
            }
            case RecentKind.Recording:
                g.FillEllipse(fg, cx - s, cy - s, s * 2, s * 2);
                break;
            default:
                g.FillPolygon(fg, new[] { new PointF(cx - s * 0.8f, cy - s), new PointF(cx + s, cy), new PointF(cx - s * 0.8f, cy + s) });
                break;
        }
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        int link = _openRect.Contains(e.Location) ? 0 : _showRect.Contains(e.Location) ? 1 : -1;
        if (link != _hoverLink)
        {
            _hoverLink = link;
            Cursor = link >= 0 ? Cursors.Hand : Cursors.Default;
            Invalidate();
        }
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        _hoverLink = -1;
        Cursor = Cursors.Default;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseClick(MouseEventArgs e)
    {
        base.OnMouseClick(e);
        if (_item is null || e.Button != MouseButtons.Left) return;
        if (_openRect.Contains(e.Location)) OpenRequested?.Invoke(this, _item);
        else if (_showRect.Contains(e.Location)) ShowRequested?.Invoke(this, _item);
    }

    protected override void OnMouseDoubleClick(MouseEventArgs e)
    {
        base.OnMouseDoubleClick(e);
        if (_item is null || e.Button != MouseButtons.Left) return;
        if (_openRect.Contains(e.Location) || _showRect.Contains(e.Location)) return; // the single click already acted
        OpenRequested?.Invoke(this, _item);
    }

    protected override bool IsInputKey(Keys keyData) => keyData == Keys.Enter || base.IsInputKey(keyData);

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (_item is not null && e.KeyCode == Keys.Enter)
        {
            OpenRequested?.Invoke(this, _item);
            e.Handled = true;
        }
    }

    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _nameFont.Dispose();
            _metaFont.Dispose();
            _linkFont.Dispose();
        }
        base.Dispose(disposing);
    }
}
