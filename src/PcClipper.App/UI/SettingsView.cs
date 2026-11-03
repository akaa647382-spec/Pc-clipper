using System.Text.Json;
using System.Text.Json.Serialization;
using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// The Settings page (SPEC "SETTINGS page"): grouped cards bound to a working copy of <see cref="AppSettings"/>.
/// Nothing applies until Save; Cancel throws the edits away. Shows a live size estimate and plain-language
/// warnings, encoder availability, "Test my PC", hotkey capture boxes, controller shortcuts (with the connected controllers
/// and a live button tester) and FFmpeg / log helpers.
/// </summary>
internal sealed class SettingsView : UserControl, IMessageFilter
{
    private const int WM_MOUSEWHEEL = 0x020A;
    private const string BufferTip = "Tip: put the buffer on a big HDD to spare your SSD.";
    private static readonly JsonSerializerOptions CompareJson = new() { Converters = { new JsonStringEnumConverter() } };
    private static readonly VideoCodec[] RealCodecs = { VideoCodec.H264, VideoCodec.Hevc, VideoCodec.Av1 };

    private readonly AppController _app;
    private readonly Panel _scroll;
    private readonly ToolTip _tips;
    private AppSettings _pending;
    private bool _loading;
    private bool _saving;
    private bool _testing;
    private int _freeSpaceRequest;
    private long? _bufferFreeBytes;
    private FfmpegCapabilities? _capsShown;
    private string _monitorSignature = "";

    // Video
    private readonly DarkComboBox _monitor, _resolution, _fps, _quality, _encoder, _codec, _method;
    private readonly Label _methodHint;
    private readonly NumericUpDown _customMbps;
    private readonly Label _mbpsUnit;
    private readonly CheckBox _cursor;
    private readonly Label _estimate, _resolved, _warnings;
    private readonly FlatButton _test;
    private readonly Label _testResult;
    // Replay
    private readonly NumericUpDown _bufferMinutes;
    private readonly DarkComboBox _hotkeyLength;
    private readonly TextBox _bufferFolder;
    private readonly Label _bufferFree;
    // Saving
    private readonly TextBox _clipsFolder, _shotsFolder;
    // Audio
    private readonly CheckBox _desktop, _mic;
    private readonly TrackBar _desktopVol, _micVol;
    private readonly Label _desktopVolText, _micVolText;
    private readonly DarkComboBox _micDevice;
    private readonly NumericUpDown _syncOffset;
    // Hotkeys
    private readonly Dictionary<HotkeyAction, HotkeyBox> _hotkeyBoxes = new();
    private readonly Dictionary<HotkeyAction, Label> _hotkeyErrorLabels = new();
    // Controller
    private readonly CheckBox _padEnable, _padVibrate;
    private readonly Label _padList, _padTester, _padError;
    private readonly Dictionary<PadAction, DarkComboBox> _padBoxes = new();
    private PadInput? _padInput;
    private bool _padListening;
    // General
    private readonly CheckBox _startWithWindows, _replayOnLaunch, _trayOnClose, _overlay, _sounds;
    private readonly Label _soundsNote;
    // FFmpeg & help
    private readonly Label _ffPath, _ffVersion, _ffEncoders, _ffStatus, _liveStats;
    // Bottom bar
    private readonly Label _status;
    private readonly FlatButton _save, _cancel;

    public SettingsView(AppController app)
    {
        _app = app;
        _pending = app.Settings.Clone();
        BackColor = Theme.Background;
        ForeColor = Theme.Text;
        _tips = Theme.MakeToolTip();

        _scroll = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Background, Padding = new Padding(Theme.Space3, Theme.Space2 + 4, Theme.Space3, Theme.Space1) };
        Theme.VerticalScrollOnly(_scroll);
        Theme.UseDarkScrollBars(_scroll);
        var stack = Theme.Stack();
        stack.Dock = DockStyle.Top;
        stack.BackColor = Theme.Background;

        var title = Theme.MakeLabel("Settings", 18f, semibold: true);
        title.Margin = new Padding(0, 0, 0, 2);
        var subtitle = Theme.MakeLabel("Changes apply when you press Save at the bottom.", 9.5f, color: Theme.TextSecondary);
        subtitle.Margin = new Padding(0, 0, 0, Theme.Space2);
        Theme.AddRow(stack, title);
        Theme.AddRow(stack, subtitle);

        // ================================================================ Video
        var video = Section(stack, "Video", "How your clips look. Higher settings need a stronger graphics card and more disk space.");

        _monitor = Combo(380);
        _monitor.SelectedIndexChanged += (_, _) => Edit(() => _pending.MonitorDeviceName = _monitor.SelectedValueOf<string>());
        Field(video, "Monitor", _monitor);

        _resolution = Combo(240);
        foreach (var p in Enum.GetValues<ResolutionPreset>()) _resolution.Items.Add(new Choice<ResolutionPreset>(p, QualityMath.PresetLabel(p)));
        _resolution.SelectedIndexChanged += (_, _) => Edit(() => _pending.Resolution = _resolution.SelectedValueOf<ResolutionPreset>());
        Field(video, "Resolution", _resolution);

        _fps = Combo(140);
        foreach (var f in AppSettings.AllowedFps) _fps.Items.Add(new Choice<int>(f, $"{f} fps"));
        _fps.SelectedIndexChanged += (_, _) => Edit(() => _pending.Fps = _fps.SelectedValueOf<int>());
        Field(video, "Frame rate", _fps);

        _quality = Combo(200);
        _quality.Items.Add(new Choice<QualityLevel>(QualityLevel.Low, "Low (small files)"));
        _quality.Items.Add(new Choice<QualityLevel>(QualityLevel.Medium, "Medium"));
        _quality.Items.Add(new Choice<QualityLevel>(QualityLevel.High, "High (recommended)"));
        _quality.Items.Add(new Choice<QualityLevel>(QualityLevel.Ultra, "Ultra (big files)"));
        _quality.Items.Add(new Choice<QualityLevel>(QualityLevel.Custom, "Custom"));
        _quality.SelectedIndexChanged += (_, _) => Edit(() => _pending.Quality = _quality.SelectedValueOf<QualityLevel>());
        _customMbps = Theme.StyleNumeric(new NumericUpDown { Minimum = 2, Maximum = 500, Width = 80, Increment = 5 });
        _customMbps.ValueChanged += (_, _) => Edit(() => _pending.CustomBitrateMbps = (int)_customMbps.Value);
        _mbpsUnit = Theme.MakeLabel("Mbps", 10f, color: Theme.TextSecondary);
        _mbpsUnit.Margin = new Padding(0, 8, 0, 0);
        Field(video, "Quality", Theme.Inline(_quality, _customMbps, _mbpsUnit));

        _encoder = Combo(300);
        foreach (var v in Enum.GetValues<EncoderVendor>()) _encoder.Items.Add(new Choice<EncoderVendor>(v, v.ToString()));
        _encoder.SelectedIndexChanged += (_, _) => Edit(() => _pending.Encoder = _encoder.SelectedValueOf<EncoderVendor>());
        Field(video, "Encoder", _encoder);
        _tips.SetToolTip(_encoder, "The part of your PC that compresses the video. Auto picks the graphics card that shows your game.");

        _codec = Combo(300);
        foreach (var c in Enum.GetValues<VideoCodec>()) _codec.Items.Add(new Choice<VideoCodec>(c, c.ToString()));
        _codec.SelectedIndexChanged += (_, _) => Edit(() => _pending.Codec = _codec.SelectedValueOf<VideoCodec>());
        Field(video, "Codec", _codec);
        _tips.SetToolTip(_codec, "The video format. H.264 plays everywhere; HEVC and AV1 make smaller files at the same quality.");

        _method = Combo(380);
        foreach (var m in Enum.GetValues<CaptureMethod>()) _method.Items.Add(new Choice<CaptureMethod>(m, Fmt.MethodLabel(m)));
        _method.SelectedIndexChanged += (_, _) => Edit(() => _pending.CaptureMethod = _method.SelectedValueOf<CaptureMethod>());
        Field(video, "Capture method", _method);
        _tips.SetToolTip(_method, "How PC Clipper grabs the picture from Windows. Auto (Desktop Duplication) is right for almost everyone.");
        _methodHint = Theme.MakeLabel("", 9f, color: Theme.TextSecondary, wrap: true);
        _methodHint.Margin = new Padding(0, 0, 0, 6);
        Field(video, "", _methodHint);

        _cursor = Theme.MakeCheck("Show the mouse cursor in videos");
        _cursor.CheckedChanged += (_, _) => Edit(() => _pending.CaptureCursor = _cursor.Checked);
        Field(video, "", _cursor);

        _estimate = Theme.MakeLabel("", 10f, semibold: true, wrap: true);
        _estimate.Margin = new Padding(0, Theme.Space1, 0, 2);
        _resolved = Theme.MakeLabel("", 9f, color: Theme.TextSecondary, wrap: true);
        _warnings = Theme.MakeLabel("", 9.5f, color: Theme.Amber, wrap: true);
        _warnings.Margin = new Padding(0, 4, 0, 0);
        Theme.AddSpanRow(video, _estimate);
        Theme.AddSpanRow(video, _resolved);
        Theme.AddSpanRow(video, _warnings);

        _test = Theme.MakeButton("Test my PC", ButtonKind.Secondary, minWidth: 130, height: 38);
        _test.Margin = new Padding(0, 0, Theme.Space2, 0);
        _test.Anchor = AnchorStyles.Left;
        _test.Click += async (_, _) => await RunTestAsync();
        _test.DimmedClick += (_, _) =>
        {
            if (_app.Caps is null && !_testing && !_app.IsBenchmarkRunning)
                _tips.Show("Set up FFmpeg first (see \"FFmpeg & help\" below).", _test, 0, _test.Height + 4, 3500);
        };
        _tips.SetToolTip(_test, "Captures and encodes a moving test picture for a few seconds (nothing is saved) to check that your PC keeps up with these settings.");
        _testResult = Theme.MakeLabel("Checks whether your PC keeps up with these settings (takes about 20 seconds).", 9.5f, color: Theme.TextSecondary, wrap: true);
        _testResult.Margin = new Padding(0, 6, 0, 0);
        var testRow = TwoColumn(_test, _testResult);
        testRow.Margin = new Padding(0, Theme.Space2 - 4, 0, 0);
        Theme.AddSpanRow(video, testRow);

        // ================================================================ Replay
        var replay = Section(stack, "Replay", "How much gameplay PC Clipper keeps ready to save.");
        _bufferMinutes = Theme.StyleNumeric(new NumericUpDown { Minimum = 1, Maximum = 60, Width = 70 });
        _bufferMinutes.ValueChanged += (_, _) => Edit(() => _pending.BufferMinutes = (int)_bufferMinutes.Value);
        var minutesLabel = Theme.MakeLabel("minutes (1 to 60)", 10f, color: Theme.TextSecondary);
        minutesLabel.Margin = new Padding(0, 8, 0, 0);
        Field(replay, "Keep the last", Theme.Inline(_bufferMinutes, minutesLabel));

        _hotkeyLength = Combo(200);
        foreach (var s in AppSettings.SaveLengthsSeconds) _hotkeyLength.Items.Add(new Choice<int>(s, $"Last {QualityMath.FormatSaveLength(s)}"));
        _hotkeyLength.SelectedIndexChanged += (_, _) => Edit(() => _pending.HotkeySaveSeconds = _hotkeyLength.SelectedValueOf<int>());
        Field(replay, "Hotkey saves", _hotkeyLength);
        _tips.SetToolTip(_hotkeyLength, "How much the save hotkey and the controller shortcut save.");

        _bufferFolder = Theme.StyleTextBox(new TextBox());
        _bufferFolder.TextChanged += (_, _) => Edit(() => _pending.BufferFolder = _bufferFolder.Text.Trim());
        _bufferFolder.Leave += (_, _) => RequestFreeSpace();
        Field(replay, "Buffer folder", PathRow(_bufferFolder, "Choose where PC Clipper keeps the replay buffer", openButton: false));
        _bufferFree = Theme.MakeLabel(BufferTip, 9f, color: Theme.TextSecondary, wrap: true);
        Field(replay, "", _bufferFree);

        // ================================================================ Saving
        var saving = Section(stack, "Saving", "Where your clips, recordings and screenshots go.");
        _clipsFolder = Theme.StyleTextBox(new TextBox());
        _clipsFolder.TextChanged += (_, _) => Edit(() => _pending.ClipsFolder = _clipsFolder.Text.Trim());
        Field(saving, "Clips folder", PathRow(_clipsFolder, "Choose where clips and recordings are saved", openButton: true));
        _shotsFolder = Theme.StyleTextBox(new TextBox());
        _shotsFolder.TextChanged += (_, _) => Edit(() => _pending.ScreenshotsFolder = _shotsFolder.Text.Trim());
        Field(saving, "Screenshots folder", PathRow(_shotsFolder, "Choose where screenshots are saved", openButton: true));

        // ================================================================ Audio
        var audio = Section(stack, "Audio", null);
        _desktop = Theme.MakeCheck("Record game/PC sound");
        _desktop.CheckedChanged += (_, _) => Edit(() => _pending.RecordDesktopAudio = _desktop.Checked);
        Field(audio, "", _desktop);
        _desktopVol = VolumeBar();
        _desktopVolText = VolumeText();
        _desktopVol.ValueChanged += (_, _) => Edit(() => _pending.DesktopVolume = _desktopVol.Value / 100f);
        Field(audio, "PC sound volume", Theme.Inline(_desktopVol, _desktopVolText));

        _mic = Theme.MakeCheck("Record microphone");
        _mic.CheckedChanged += (_, _) => Edit(() => _pending.RecordMicrophone = _mic.Checked);
        Field(audio, "", _mic);
        _micDevice = Combo(380);
        _micDevice.SelectedIndexChanged += (_, _) => Edit(() => _pending.MicrophoneDeviceId = _micDevice.SelectedValueOf<string?>());
        Field(audio, "Microphone", _micDevice);
        _micVol = VolumeBar();
        _micVolText = VolumeText();
        _micVol.ValueChanged += (_, _) => Edit(() => _pending.MicrophoneVolume = _micVol.Value / 100f);
        Field(audio, "Mic volume", Theme.Inline(_micVol, _micVolText));

        _syncOffset = Theme.StyleNumeric(new NumericUpDown { Minimum = -500, Maximum = 500, Increment = 10, Width = 80 });
        _syncOffset.ValueChanged += (_, _) => Edit(() => _pending.AudioSyncOffsetMs = (int)_syncOffset.Value);
        var msLabel = Theme.MakeLabel("ms", 10f, color: Theme.TextSecondary);
        msLabel.Margin = new Padding(0, 8, Theme.Space2, 0);
        var syncHint = Theme.MakeLabel("Advanced: only if sound and picture don't line up. More = sound later.", 9f, color: Theme.TextSecondary);
        syncHint.Margin = new Padding(0, 9, 0, 0);
        Field(audio, "Sound sync", Theme.Inline(_syncOffset, msLabel, syncHint));

        // ================================================================ Hotkeys
        var hotkeys = Section(stack, "Hotkeys", "Work everywhere, even inside games. Click a box, then press the keys you want. Esc cancels, Backspace clears.");
        HotkeyField(hotkeys, HotkeyAction.SaveReplay, "Save the replay");
        HotkeyField(hotkeys, HotkeyAction.ToggleRecording, "Start/stop recording");
        HotkeyField(hotkeys, HotkeyAction.Screenshot, "Screenshot");
        HotkeyField(hotkeys, HotkeyAction.ToggleReplay, "Turn replay on/off");
        var hotkeyNote = Theme.MakeLabel("A few games block every app's hotkeys while they are in front. In those, use a controller shortcut or the tray icon's menu instead.",
            9f, color: Theme.TextSecondary, wrap: true);
        hotkeyNote.Margin = new Padding(0, Theme.Space1, 0, 0);
        Theme.AddSpanRow(hotkeys, hotkeyNote);

        // ================================================================ Controller
        var pad = Section(stack, "Controller",
            "Hold one button and press another on your Xbox or PlayStation controller. Works while you play, also in fullscreen games.");
        _padEnable = Theme.MakeCheck("Use controller shortcuts (Xbox and PlayStation)");
        _padEnable.CheckedChanged += (_, _) => Edit(() => _pending.ControllerShortcuts = _padEnable.Checked);
        Field(pad, "", _padEnable);
        _padList = Theme.MakeLabel("", 10f, wrap: true);
        _padList.Margin = new Padding(0, 4, 0, 4);
        Field(pad, "Connected", _padList);
        foreach (var action in AppController.AllPadActions) PadField(pad, action);
        _padError = Theme.MakeLabel("", 9.5f, color: Theme.Red, wrap: true);
        _padError.Visible = false;
        _padError.Margin = new Padding(0, 0, 0, 4);
        Field(pad, "", _padError);
        _padTester = Theme.MakeLabel("", 10f, color: Theme.TextSecondary, wrap: true);
        _padTester.Margin = new Padding(0, 4, 0, 4);
        Field(pad, "Test", _padTester);
        _padVibrate = Theme.MakeCheck("Vibrate when a controller shortcut works (Xbox)");
        _padVibrate.CheckedChanged += (_, _) => Edit(() => _pending.ControllerVibrate = _padVibrate.Checked);
        Field(pad, "", _padVibrate);
        _tips.SetToolTip(_padVibrate, "A short rumble once the clip, recording or screenshot worked - handy when a fullscreen game hides the on-screen notice.");
        var padNote = Theme.MakeLabel("Some games also use these buttons; pick another combo if one clashes. The Xbox / PS button " +
                                      "isn't offered: Xbox Game Bar and Steam react to it and take the focus from your game. " +
                                      "PlayStation pads used through Steam or DS4Windows may appear as Xbox controllers - that works too. " +
                                      "With DS4Windows, hide the controller with HidHide (add PC Clipper to HidHide's allowed apps, or " +
                                      "leave it out and PC Clipper uses DS4Windows' virtual Xbox controller): DS4Windows' old " +
                                      "\"Hide DS4 Controller\" (exclusive) option can't work while PC Clipper or Steam has the controller open.",
            9f, color: Theme.TextSecondary, wrap: true);
        padNote.Margin = new Padding(0, Theme.Space1, 0, 0);
        Theme.AddSpanRow(pad, padNote);

        // ================================================================ General
        var general = Section(stack, "General", null);
        _startWithWindows = Theme.MakeCheck("Start PC Clipper with Windows (it waits quietly in the tray)");
        _startWithWindows.CheckedChanged += (_, _) => Edit(() => _pending.StartWithWindows = _startWithWindows.Checked);
        _replayOnLaunch = Theme.MakeCheck("Turn the replay buffer on when PC Clipper starts");
        _replayOnLaunch.CheckedChanged += (_, _) => Edit(() => _pending.StartReplayOnLaunch = _replayOnLaunch.Checked);
        _trayOnClose = Theme.MakeCheck("Closing the window keeps PC Clipper running in the tray");
        _trayOnClose.CheckedChanged += (_, _) => Edit(() => _pending.MinimizeToTrayOnClose = _trayOnClose.Checked);
        _overlay = Theme.MakeCheck("Show on-screen notifications (\"Saved last 15:00\")");
        _overlay.CheckedChanged += (_, _) => Edit(() => _pending.ShowOverlay = _overlay.Checked);
        _sounds = Theme.MakeCheck("Play sounds (save, record, screenshot)");
        _sounds.CheckedChanged += (_, _) => Edit(() => _pending.PlaySounds = _sounds.Checked);
        foreach (var c in new[] { _startWithWindows, _replayOnLaunch, _trayOnClose, _overlay, _sounds }) Theme.AddSpanRow(general, c);
        _soundsNote = Theme.MakeLabel("While \"Record game/PC sound\" is on, these sounds are recorded into later clips too.", 9f,
            color: Theme.TextSecondary, wrap: true);
        _soundsNote.Margin = new Padding(22, 0, 0, 4);
        Theme.AddSpanRow(general, _soundsNote);

        // ================================================================ FFmpeg & help
        var engine = Section(stack, "FFmpeg & help", "FFmpeg is the free video engine PC Clipper uses to talk to your graphics card.");
        _ffStatus = Theme.MakeLabel("", 9.5f, color: Theme.Amber, wrap: true);
        _ffStatus.Visible = false;
        Theme.AddSpanRow(engine, _ffStatus);
        _ffPath = Theme.MakeLabel("", 9.5f, wrap: true);
        Field(engine, "FFmpeg", _ffPath);
        _ffVersion = Theme.MakeLabel("", 9.5f, color: Theme.TextSecondary, wrap: true);
        Field(engine, "Version", _ffVersion);
        _ffEncoders = Theme.MakeLabel("", 9.5f, color: Theme.TextSecondary, wrap: true);
        Field(engine, "Works on this PC", _ffEncoders);
        _liveStats = Theme.MakeLabel("", 9.5f, color: Theme.TextSecondary, wrap: true);
        Field(engine, "Right now", _liveStats);
        var download = Theme.MakeButton("Download FFmpeg", ButtonKind.Secondary, height: 36);
        download.Click += async (_, _) =>
        {
            try { await _app.SetupFfmpegAsync(null); }
            catch (Exception ex) { _app.Log.Error("FFmpeg setup failed", ex); }
        };
        var browse = Theme.MakeButton("Browse...", ButtonKind.Secondary, height: 36);
        browse.Click += async (_, _) => await BrowseFfmpegAsync();
        var openLog = Theme.MakeButton("Open log folder", ButtonKind.Secondary, height: 36);
        openLog.Click += (_, _) => _app.OpenLogFolder();
        _tips.SetToolTip(openLog, "The log helps if you need to report a problem.");
        var buttons = Theme.Inline(download, browse, openLog);
        buttons.Margin = new Padding(0, Theme.Space1, 0, 0);
        Theme.AddSpanRow(engine, buttons);

        _scroll.Controls.Add(stack);

        // ================================================================ Bottom bar
        var bottom = new TableLayoutPanel
        {
            Dock = DockStyle.Bottom,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            ColumnCount = 3,
            RowCount = 1,
            BackColor = Theme.Background,
            Padding = new Padding(Theme.Space3, Theme.Space1 + 4, Theme.Space3, Theme.Space1 + 4),
        };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        bottom.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        bottom.Paint += (_, e) =>
        {
            using var pen = new Pen(Theme.Border);
            e.Graphics.DrawLine(pen, 0, 0, bottom.Width, 0);
        };
        _status = Theme.MakeLabel("", 9.5f, color: Theme.TextSecondary, wrap: true);
        _status.Margin = new Padding(0, 0, Theme.Space2, 0);
        _status.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        _cancel = Theme.MakeButton("Cancel", ButtonKind.Secondary, minWidth: 100, height: 40);
        _cancel.Click += (_, _) => CancelEdits();
        _save = Theme.MakeButton("Save", ButtonKind.Primary, minWidth: 120, height: 40);
        _save.Margin = new Padding(0);
        _save.Click += async (_, _) => await SaveAsync();
        Theme.AddRow(bottom, _status, _cancel, _save);

        Controls.Add(_scroll);
        Controls.Add(bottom);
        _scroll.BringToFront();

        Application.AddMessageFilter(this);
        // The button tester listens only while this page is on screen (VisibleChanged also fires when the window hides).
        VisibleChanged += (_, _) => UpdatePadListening();
        LoadFrom(_app.Settings);
    }

    // =====================================================================================================
    // Building blocks
    // =====================================================================================================

    private static CardPanel Section(TableLayoutPanel stack, string title, string? subtitle)
    {
        var card = new CardPanel { ColumnCount = 2 };
        card.ColumnStyles.Clear();
        card.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        card.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        var heading = Theme.MakeLabel(title, 13f, semibold: true);
        heading.Margin = new Padding(0, 0, 0, subtitle is null ? Theme.Space1 : 2);
        Theme.AddSpanRow(card, heading);
        if (subtitle is not null)
        {
            var sub = Theme.MakeLabel(subtitle, 9.5f, color: Theme.TextSecondary, wrap: true);
            sub.Margin = new Padding(0, 0, 0, Theme.Space1 + 4);
            Theme.AddSpanRow(card, sub);
        }
        Theme.AddRow(stack, card);
        return card;
    }

    private static void Field(TableLayoutPanel card, string label, Control control)
    {
        Label? l = null;
        if (label.Length > 0)
        {
            l = Theme.MakeLabel(label, 10f, color: Theme.TextSecondary);
            l.Anchor = AnchorStyles.Left;
            l.Margin = new Padding(0, 4, Theme.Space2, 4);
        }
        // Keep the label column a consistent width across cards.
        var holder = l ?? new Label { AutoSize = true, Text = "", Margin = new Padding(0, 0, Theme.Space2, 0) };
        holder.MinimumSize = new Size(150, 0);
        if (!control.AutoSize && control.Dock == DockStyle.None &&
            (control.Anchor & (AnchorStyles.Left | AnchorStyles.Right)) != (AnchorStyles.Left | AnchorStyles.Right))
        {
            // Fixed-size controls (drop-downs, hotkey boxes) go into an auto-sized strip. Placed directly in a table
            // cell, the table clips them to the cell while the hidden page is still tiny, and DPI scaling then keeps
            // that clipped size: in testing at 150% they ended up 1 pixel wide (invisible).
            var strip = Theme.Inline(control);
            strip.Anchor = AnchorStyles.Left;
            control = strip;
        }
        if (control is Label or CheckBox) control.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        else if (control.Dock != DockStyle.Fill && control.Anchor == (AnchorStyles.Top | AnchorStyles.Left)) control.Anchor = AnchorStyles.Left;
        Theme.AddRow(card, holder, control);
    }

    private static TableLayoutPanel TwoColumn(Control left, Control right)
    {
        var t = new TableLayoutPanel { ColumnCount = 2, RowCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Margin = new Padding(0) };
        t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        t.Controls.Add(left, 0, 0);
        t.Controls.Add(right, 1, 0);
        return t;
    }

    private DarkComboBox Combo(int width)
    {
        var c = new DarkComboBox { Width = width };
        c.Anchor = AnchorStyles.Left;
        return c;
    }

    private static TrackBar VolumeBar() =>
        Theme.StyleTrackBar(new TrackBar { Minimum = 0, Maximum = 200, SmallChange = 5, LargeChange = 25, TickFrequency = 25, Value = 100 });

    private static Label VolumeText()
    {
        var l = Theme.MakeLabel("100%", 10f, semibold: true);
        l.Margin = new Padding(0, 7, 0, 0);
        l.MinimumSize = new Size(48, 0);
        return l;
    }

    private TableLayoutPanel PathRow(TextBox box, string browseTitle, bool openButton)
    {
        var t = new TableLayoutPanel { ColumnCount = openButton ? 3 : 2, RowCount = 1, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Dock = DockStyle.Fill, Margin = new Padding(0) };
        t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        if (openButton) t.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        box.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        var browse = Theme.MakeButton("Browse...", ButtonKind.Secondary, height: 32);
        browse.Anchor = AnchorStyles.Left;
        browse.Click += (_, _) => BrowseFolder(box, browseTitle);
        t.Controls.Add(box, 0, 0);
        t.Controls.Add(browse, 1, 0);
        if (openButton)
        {
            var open = Theme.MakeButton("Open", ButtonKind.Secondary, height: 32);
            open.Anchor = AnchorStyles.Left;
            open.Margin = new Padding(0);
            open.Click += (_, _) => _app.OpenFolder(box.Text.Trim());
            t.Controls.Add(open, 2, 0);
        }
        else browse.Margin = new Padding(0);
        return t;
    }

    private void HotkeyField(TableLayoutPanel card, HotkeyAction action, string label)
    {
        var box = new HotkeyBox { Anchor = AnchorStyles.Left };
        box.BindingChanged += (_, _) =>
        {
            var b = box.Binding;
            Edit(() =>
            {
                switch (action)
                {
                    case HotkeyAction.SaveReplay: _pending.SaveReplayHotkey = b; break;
                    case HotkeyAction.ToggleRecording: _pending.RecordHotkey = b; break;
                    case HotkeyAction.Screenshot: _pending.ScreenshotHotkey = b; break;
                    case HotkeyAction.ToggleReplay: _pending.ToggleReplayHotkey = b; break;
                }
            });
            box.HasError = false;
            Theme.SetVisible(_hotkeyErrorLabels[action], false);
        };
        box.CapturingChanged += (_, capturing) => _app.PauseHotkeys(capturing);
        var error = Theme.MakeLabel("", 9.5f, color: Theme.Red, wrap: true);
        error.Visible = false;
        error.Margin = new Padding(0, 0, 0, 4);
        _hotkeyBoxes[action] = box;
        _hotkeyErrorLabels[action] = error;
        Field(card, label, box);
        Field(card, "", error);
    }

    private void PadField(TableLayoutPanel card, PadAction action)
    {
        var box = Combo(400);
        box.SelectedIndexChanged += (_, _) =>
        {
            if (_loading || box.SelectedItem is not Choice<PadChord> choice) return;
            Edit(() => SetPadChord(_pending, action, choice.Value.Clone()));
            Theme.SetVisible(_padError, false);
            ShowPadInput();
        };
        _padBoxes[action] = box;
        Field(card, PadText.ActionName(action), box);
    }

    private static void SetPadChord(AppSettings s, PadAction action, PadChord chord)
    {
        switch (action)
        {
            case PadAction.SaveReplay: s.PadSaveReplay = chord; break;
            case PadAction.ToggleRecording: s.PadRecord = chord; break;
            case PadAction.Screenshot: s.PadScreenshot = chord; break;
            case PadAction.ToggleReplay: s.PadToggleReplay = chord; break;
        }
    }

    /// <summary>
    /// "Off" and the preset combos (both namings); a saved combo that isn't a preset is added as its own item. The presets
    /// leave out the Xbox / PS button (Xbox Game Bar and Steam react to it and pull the focus from the game); a combo with it
    /// saved by an earlier version still shows and keeps working, with that caveat in its name.
    /// </summary>
    private void FillPadBox(DarkComboBox box, PadChord? chord)
    {
        var current = chord is { IsAssigned: true } ? chord : PadChord.Off;
        bool was = _loading;
        _loading = true;
        try
        {
            box.BeginUpdate();
            box.Items.Clear();
            int selected = -1;
            foreach (var preset in PadChord.Presets)
            {
                if (selected < 0 && preset.SameAs(current)) selected = box.Items.Count;
                box.Items.Add(new Choice<PadChord>(preset, PadLabels.DescribeBoth(preset)));
            }
            if (selected < 0)
            {
                selected = box.Items.Count;
                var label = PadLabels.DescribeBoth(current);
                if (((current.Hold | current.Press) & PadButtons.Guide) != 0) label += " (may open Xbox Game Bar or Steam)";
                box.Items.Add(new Choice<PadChord>(current.Clone(), label));
            }
            box.EndUpdate();
            box.SelectedIndex = selected;
        }
        finally
        {
            _loading = was;
        }
    }

    // =====================================================================================================
    // Loading / editing
    // =====================================================================================================

    private void LoadFrom(AppSettings s)
    {
        _loading = true;
        try
        {
            _pending = s.Clone();
            FillMonitors();
            _resolution.SelectValue(_pending.Resolution);
            _fps.SelectValue(_pending.Fps);
            _quality.SelectValue(_pending.Quality);
            _customMbps.Value = Math.Clamp(_pending.CustomBitrateMbps, (int)_customMbps.Minimum, (int)_customMbps.Maximum);
            RelabelEncoders();
            _encoder.SelectValue(_pending.Encoder);
            RelabelCodecs();
            _codec.SelectValue(_pending.Codec);
            RelabelMethods();
            _method.SelectValue(_pending.CaptureMethod);
            _cursor.Checked = _pending.CaptureCursor;

            _bufferMinutes.Value = Math.Clamp(_pending.BufferMinutes, 1, 60);
            if (!_hotkeyLength.Items.OfType<Choice<int>>().Any(c => c.Value == _pending.HotkeySaveSeconds))
                _hotkeyLength.Items.Add(new Choice<int>(_pending.HotkeySaveSeconds, $"Last {QualityMath.FormatSaveLength(_pending.HotkeySaveSeconds)}"));
            _hotkeyLength.SelectValue(_pending.HotkeySaveSeconds);
            _bufferFolder.Text = _pending.BufferFolder;
            _clipsFolder.Text = _pending.ClipsFolder;
            _shotsFolder.Text = _pending.ScreenshotsFolder;

            _desktop.Checked = _pending.RecordDesktopAudio;
            _desktopVol.Value = Math.Clamp((int)Math.Round(_pending.DesktopVolume * 100), 0, 200);
            _mic.Checked = _pending.RecordMicrophone;
            FillMicrophones();
            _micVol.Value = Math.Clamp((int)Math.Round(_pending.MicrophoneVolume * 100), 0, 200);
            // The setting allows a wider range than the box shows by default; never clip a saved value.
            _syncOffset.Minimum = Math.Min(-500, _pending.AudioSyncOffsetMs);
            _syncOffset.Maximum = Math.Max(500, _pending.AudioSyncOffsetMs);
            _syncOffset.Value = _pending.AudioSyncOffsetMs;

            foreach (var (action, box) in _hotkeyBoxes) box.Binding = AppController.BindingFor(_pending, action);

            _padEnable.Checked = _pending.ControllerShortcuts;
            foreach (var (action, box) in _padBoxes) FillPadBox(box, AppController.PadChordFor(_pending, action));
            _padVibrate.Checked = _pending.ControllerVibrate;
            Theme.SetVisible(_padError, false);

            _startWithWindows.Checked = _pending.StartWithWindows;
            _replayOnLaunch.Checked = _pending.StartReplayOnLaunch;
            _trayOnClose.Checked = _pending.MinimizeToTrayOnClose;
            _overlay.Checked = _pending.ShowOverlay;
            _sounds.Checked = _pending.PlaySounds;
        }
        finally
        {
            _loading = false;
        }
        ShowHotkeyErrors(_app.HotkeyErrors);
        RefreshFfmpegInfo();
        RefreshControllers();
        UpdateDerived();
        UpdateDirty();
        RequestFreeSpace();
    }

    private void Edit(Action apply)
    {
        if (_loading) return;
        apply();
        UpdateDerived();
        UpdateDirty();
    }

    private bool IsDirty
    {
        get
        {
            var a = _pending.Clone();
            a.FfmpegPath = _app.Settings.FfmpegPath;
            // Kept by the app itself (buffer folders that may hold a kept recording), not edited here.
            a.KeptRecordingRoots = _app.Settings.KeptRecordingRoots.ToList();
            return JsonSerializer.Serialize(a, CompareJson) != JsonSerializer.Serialize(_app.Settings, CompareJson);
        }
    }

    private void UpdateDirty()
    {
        bool dirty = IsDirty;
        // Dimmed rather than disabled: disabling the focused button would move focus to the first field and
        // scroll the page back to the top right after the user pressed Save.
        _save.Dimmed = !dirty || _saving;
        _cancel.Dimmed = !dirty || _saving;
        if (dirty) SetStatus("You have unsaved changes.", Theme.Amber);
        else if (_status.ForeColor == Theme.Amber && _status.Text == "You have unsaved changes.") SetStatus("", Theme.TextSecondary);
    }

    private void SetStatus(string text, Color color)
    {
        Theme.SetText(_status, text);
        Theme.SetFore(_status, color);
    }

    private void FillMonitors()
    {
        var monitors = _app.MonitorList;
        _monitorSignature = string.Join("|", monitors.Select(m => m.ToString() + m.DeviceName));
        bool was = _loading;
        _loading = true;
        try
        {
            _monitor.BeginUpdate();
            _monitor.Items.Clear();
            foreach (var m in monitors) _monitor.Items.Add(new Choice<string>(m.DeviceName, m.ToString()));
            _monitor.EndUpdate();
            _monitor.SelectValue(_app.PickMonitor(_pending.MonitorDeviceName).DeviceName);
        }
        finally
        {
            _loading = was;
        }
    }

    private void FillMicrophones()
    {
        IReadOnlyList<AudioDeviceInfo> mics;
        try { mics = AudioDevices.Microphones(); }
        catch (Exception ex)
        {
            _app.Log.Warn($"Listing microphones failed: {ex.Message}");
            mics = Array.Empty<AudioDeviceInfo>();
        }
        bool was = _loading;
        _loading = true;
        try
        {
            _micDevice.BeginUpdate();
            _micDevice.Items.Clear();
            _micDevice.Items.Add(new Choice<string?>(null, "Default microphone"));
            foreach (var m in mics) _micDevice.Items.Add(new Choice<string?>(m.Id, m.IsDefault ? $"{m.Name} (Windows default)" : m.Name));
            if (_pending.MicrophoneDeviceId is { } id && !mics.Any(m => m.Id == id))
                _micDevice.Items.Add(new Choice<string?>(id, "Your saved microphone (not connected)"));
            _micDevice.EndUpdate();
            _micDevice.SelectValue(_pending.MicrophoneDeviceId);
        }
        finally
        {
            _loading = was;
        }
    }

    private void RelabelEncoders()
    {
        var caps = _app.Caps;
        var monitor = _app.PickMonitor(_pending.MonitorDeviceName);
        Relabel(_encoder, (EncoderVendor v) =>
        {
            string name = v switch
            {
                EncoderVendor.Auto => "Auto (recommended)",
                EncoderVendor.Nvidia => "NVIDIA",
                EncoderVendor.Amd => "AMD",
                EncoderVendor.Intel => "Intel",
                EncoderVendor.Cpu => "CPU (no graphics card, slow)",
                _ => v.ToString(),
            };
            if (caps is null) return name;
            if (v == EncoderVendor.Auto)
                return $"{name} - uses {QualityMath.VendorLabel(SafeResolveVendor(EncoderVendor.Auto, monitor, caps))}";
            bool works = v == EncoderVendor.Cpu
                ? RealCodecs.Any(c => caps.Encoders.Contains(QualityMath.EncoderName(v, c)))
                : RealCodecs.Any(c => caps.Works(QualityMath.EncoderName(v, c)));
            return $"{name} - {(works ? "works" : "not available")}";
        });
    }

    private void RelabelCodecs()
    {
        var caps = _app.Caps;
        var monitor = _app.PickMonitor(_pending.MonitorDeviceName);
        EncoderVendor vendor = caps is null ? EncoderVendor.Auto : SafeResolveVendor(_pending.Encoder, monitor, caps);
        int width = SafeTargetSize(monitor).Width;
        Relabel(_codec, (VideoCodec c) =>
        {
            string name = c switch
            {
                VideoCodec.Auto => "Auto (recommended)",
                VideoCodec.H264 => "H.264 (plays everywhere)",
                VideoCodec.Hevc => "HEVC / H.265 (smaller files)",
                VideoCodec.Av1 => "AV1 (smallest files, newest GPUs)",
                _ => c.ToString(),
            };
            if (caps is null) return name;
            if (c == VideoCodec.Auto)
            {
                try { return $"{name} - uses {QualityMath.CodecLabel(QualityMath.ResolveCodec(VideoCodec.Auto, vendor, width, caps))}"; }
                catch { return name; }
            }
            var encoder = QualityMath.EncoderName(vendor, c);
            bool works = vendor == EncoderVendor.Cpu ? caps.Encoders.Contains(encoder) : caps.Works(encoder);
            if (c == VideoCodec.H264 && width > QualityMath.H264MaxWidth) works = false;
            return works ? name : $"{name} - not available";
        });
    }

    private void RelabelMethods()
    {
        var caps = _app.Caps;
        var monitor = _app.PickMonitor(_pending.MonitorDeviceName);
        bool wgcPossible = caps is null || (caps.HasGfxCapture && monitor.MonitorHandle != 0);
        // Auto is always Desktop Duplication (QualityMath.ResolveMethod); Windows Graphics Capture is only used when picked.
        Relabel(_method, (CaptureMethod m) => m switch
        {
            CaptureMethod.Auto when caps is not null =>
                $"Auto (recommended) - uses {Fmt.MethodLabel(SafeResolveMethod(monitor, caps))}",
            CaptureMethod.Auto => "Auto (recommended) - uses Desktop Duplication",
            CaptureMethod.DesktopDuplication => "Desktop Duplication (recommended)",
            CaptureMethod.WindowsGraphicsCapture when !wgcPossible => "Windows Graphics Capture - not available",
            CaptureMethod.WindowsGraphicsCapture => "Windows Graphics Capture",
            _ => Fmt.MethodLabel(m),
        });
        const string ddaHint =
            "Recommended: takes every picture Windows shows, the moment it appears, so clips move smoothly at 60 and " +
            "120 fps. While nothing at all moves on screen it records nothing new; the clip just holds the still picture.";
        string hint = _pending.CaptureMethod switch
        {
            CaptureMethod.WindowsGraphicsCapture =>
                "Try it if Desktop Duplication gives you trouble (some laptops with two graphics chips). Best on Windows 11; " +
                "Windows 10 shows a yellow border around the screen. A still screen pauses it the same way." +
                (wgcPossible ? "" : " Needs FFmpeg 8.1 or newer."),
            _ => ddaHint,
        };
        Theme.SetText(_methodHint, hint);
    }

    private CaptureMethod SafeResolveMethod(MonitorInfo monitor, FfmpegCapabilities caps)
    {
        try { return QualityMath.ResolveMethod(CaptureMethod.Auto, QualityMath.EffectiveFps(_pending.Fps, monitor), monitor, caps); }
        catch { return CaptureMethod.DesktopDuplication; }
    }

    private static EncoderVendor SafeResolveVendor(EncoderVendor requested, MonitorInfo monitor, FfmpegCapabilities caps)
    {
        try { return QualityMath.ResolveVendor(requested, monitor.GpuVendorId, caps); }
        catch { return EncoderVendor.Cpu; }
    }

    private (int Width, int Height) SafeTargetSize(MonitorInfo monitor)
    {
        try { return QualityMath.TargetSize(_pending.Resolution, monitor.Width, monitor.Height); }
        catch { return (1920, 1080); }
    }

    private void Relabel<T>(DarkComboBox combo, Func<T, string> label)
    {
        bool was = _loading;
        _loading = true;
        try
        {
            int selected = combo.SelectedIndex;
            for (int i = 0; i < combo.Items.Count; i++)
            {
                if (combo.Items[i] is not Choice<T> c) continue;
                var text = label(c.Value);
                if (c.Label != text) combo.Items[i] = c with { Label = text };
            }
            if (combo.SelectedIndex != selected && selected < combo.Items.Count) combo.SelectedIndex = selected;
            combo.Invalidate();
        }
        finally
        {
            _loading = was;
        }
    }

    /// <summary>Everything computed from the pending settings: visibility, estimate, warnings, labels.</summary>
    private void UpdateDerived()
    {
        bool custom = _pending.Quality == QualityLevel.Custom;
        Theme.SetVisible(_customMbps, custom);
        Theme.SetVisible(_mbpsUnit, custom);
        Theme.SetEnabled(_desktopVol, _pending.RecordDesktopAudio);
        Theme.SetEnabled(_micDevice, _pending.RecordMicrophone);
        Theme.SetEnabled(_micVol, _pending.RecordMicrophone);
        Theme.SetText(_desktopVolText, $"{_desktopVol.Value}%");
        Theme.SetText(_micVolText, $"{_micVol.Value}%");
        foreach (var box in _padBoxes.Values) Theme.SetEnabled(box, _pending.ControllerShortcuts);
        Theme.SetEnabled(_padVibrate, _pending.ControllerShortcuts);
        RefreshControllers();
        RelabelEncoders();
        RelabelCodecs();
        RelabelMethods();

        var monitor = _app.PickMonitor(_pending.MonitorDeviceName);
        CaptureConfig? cfg = null;
        if (_app.Caps is { } caps)
        {
            try { cfg = QualityMath.Resolve(_pending, monitor, caps); }
            catch (Exception ex) { _app.Log.Warn($"Settings preview: {ex.Message}"); }
        }

        int videoKbps;
        string resolvedText;
        if (cfg is not null)
        {
            videoKbps = cfg.BitrateKbps;
            resolvedText = $"Will record: {cfg.Describe()} - {Fmt.MethodLabel(cfg.Method)}";
        }
        else
        {
            var (w, h) = SafeTargetSize(monitor);
            var codecGuess = _pending.Codec == VideoCodec.Auto ? VideoCodec.Hevc : _pending.Codec;
            videoKbps = QualityMath.BitrateKbps(_pending.Quality, _pending.CustomBitrateMbps, w, h, _pending.Fps, codecGuess);
            resolvedText = $"Will record {w}x{h} at {_pending.Fps} fps. The exact encoder is picked once FFmpeg is set up.";
        }
        int audioKbps = _pending.RecordDesktopAudio || _pending.RecordMicrophone ? cfg?.AudioBitrateKbps ?? 192 : 0;
        long bytes = QualityMath.EstimateBufferBytes(videoKbps, audioKbps, _pending.BufferMinutes * 60);
        Theme.SetText(_estimate, $"\u2248 {videoKbps / 1000.0:0.#} Mbps \u00B7 a {_pending.BufferMinutes}-minute buffer uses about {QualityMath.FormatBytes(bytes)}");
        Theme.SetText(_resolved, resolvedText);

        var warnings = new List<string>();
        try { warnings.AddRange(QualityMath.Warnings(_pending, monitor, cfg)); }
        catch (Exception ex) { _app.Log.Warn($"Settings warnings: {ex.Message}"); }
        const long headroom = 2L << 30;
        // The running buffer's own files count as available: a new length reuses that space (and the engine applies a
        // new length live, so these files stay).
        long reusable = 0;
        if (_app.Stats is { } running && _app.Engine.ActiveConfig is { } active &&
            string.Equals(Fmt.Drive(active.BufferRoot), Fmt.Drive(_pending.BufferFolder), StringComparison.OrdinalIgnoreCase))
            reusable = running.BufferBytesOnDisk;
        if (_bufferFreeBytes is { } free && free + reusable < bytes + headroom)
        {
            var have = reusable > 0
                ? $"{QualityMath.FormatBytes(free)} free plus {QualityMath.FormatBytes(reusable)} the running buffer already uses"
                : $"{QualityMath.FormatBytes(free)} free";
            warnings.Add($"Not enough free space on {Fmt.Drive(_pending.BufferFolder)} ({have}; this buffer needs about " +
                         $"{QualityMath.FormatBytes(bytes + headroom)}). Lower the buffer length or quality, or pick another buffer folder.");
        }
        Theme.SetText(_warnings, string.Join(Environment.NewLine, warnings.Select(w => warnings.Count > 1 ? "\u2022 " + w : w)));
        Theme.SetVisible(_warnings, warnings.Count > 0);
    }

    private async void RequestFreeSpace()
    {
        try
        {
            var folder = _pending.BufferFolder;
            int request = ++_freeSpaceRequest;
            var lookup = Task.Run(() => EngineEnvironment.DefaultFreeBytes(folder));
            long free = await Task.WhenAny(lookup, Task.Delay(3000)) == lookup ? await lookup : long.MaxValue;
            if (request != _freeSpaceRequest || IsDisposed) return;
            _bufferFreeBytes = free == long.MaxValue ? null : free;
            Theme.SetText(_bufferFree, _bufferFreeBytes is { } f
                ? $"{Fmt.Drive(folder)} {QualityMath.FormatBytes(f)} free \u00B7 {BufferTip}"
                : BufferTip);
            UpdateDerived();
        }
        catch (Exception ex)
        {
            _app.Log.Warn($"Free space lookup failed: {ex.Message}");
        }
    }

    private void BrowseFolder(TextBox box, string title)
    {
        try
        {
            using var dlg = new FolderBrowserDialog
            {
                Description = title,
                UseDescriptionForTitle = true,
                ShowNewFolderButton = true,
            };
            var current = box.Text.Trim();
            if (Directory.Exists(current)) dlg.InitialDirectory = current;
            if (dlg.ShowDialog(FindForm()) == DialogResult.OK)
            {
                box.Text = dlg.SelectedPath;
                if (box == _bufferFolder) RequestFreeSpace();
            }
        }
        catch (Exception ex)
        {
            _app.Log.Error("Folder picker failed", ex);
        }
    }

    // =====================================================================================================
    // Save / Cancel / Test
    // =====================================================================================================

    private string? ValidatePending()
    {
        foreach (var (name, path) in new[]
                 {
                     ("buffer folder", _pending.BufferFolder), ("clips folder", _pending.ClipsFolder), ("screenshots folder", _pending.ScreenshotsFolder),
                 })
        {
            bool ok;
            try { ok = !string.IsNullOrWhiteSpace(path) && Path.IsPathFullyQualified(path) && path.IndexOfAny(Path.GetInvalidPathChars()) < 0; }
            catch { ok = false; }
            if (!ok) return $"The {name} needs a full folder path, like D:\\PC Clipper. Use Browse... to pick one.";
        }

        var keys = new (HotkeyAction Action, HotkeyBinding Binding, string Name)[]
        {
            (HotkeyAction.SaveReplay, _pending.SaveReplayHotkey, "Save the replay"),
            (HotkeyAction.ToggleRecording, _pending.RecordHotkey, "Start/stop recording"),
            (HotkeyAction.Screenshot, _pending.ScreenshotHotkey, "Screenshot"),
            (HotkeyAction.ToggleReplay, _pending.ToggleReplayHotkey, "Turn replay on/off"),
        };
        for (int i = 0; i < keys.Length; i++)
        for (int j = i + 1; j < keys.Length; j++)
        {
            if (!keys[i].Binding.IsAssigned || !keys[i].Binding.SameAs(keys[j].Binding)) continue;
            _hotkeyBoxes[keys[j].Action].HasError = true;
            return $"{HotkeyText.Describe(keys[i].Binding)} is set for both \"{keys[i].Name}\" and \"{keys[j].Name}\". Pick a different key for one of them.";
        }

        // Two actions on one controller combo: the detector would run both. (Only matters while the shortcuts are on: with
        // them off the drop-downs can't be changed.)
        Theme.SetVisible(_padError, false);
        if (_pending.ControllerShortcuts)
        {
            var pads = AppController.AllPadActions;
            for (int i = 0; i < pads.Length; i++)
            for (int j = i + 1; j < pads.Length; j++)
            {
                var a = AppController.PadChordFor(_pending, pads[i]);
                if (a is not { IsAssigned: true } || !a.SameAs(AppController.PadChordFor(_pending, pads[j]))) continue;
                var text = $"{PadLabels.DescribeBoth(a)} is set for both \"{PadText.ActionName(pads[i])}\" and " +
                           $"\"{PadText.ActionName(pads[j])}\". Pick a different combo for one of them.";
                Theme.SetText(_padError, text);
                Theme.SetVisible(_padError, true);
                return text;
            }
        }
        return null;
    }

    private async Task SaveAsync()
    {
        if (_saving) return;
        var problem = ValidatePending();
        if (problem is not null)
        {
            SetStatus(problem, Theme.Amber);
            return;
        }
        _saving = true;
        _save.Dimmed = true;
        _cancel.Dimmed = true;
        SetStatus("Saving...", Theme.TextSecondary);
        try
        {
            var result = await _app.ApplySettingsAsync(_pending.Clone(), FindForm());
            if (!result.Applied)
            {
                SetStatus("Not saved. Your changes are still here; press Save when you're ready.", Theme.TextSecondary);
                return;
            }
            LoadFrom(_app.Settings);
            ShowHotkeyErrors(result.HotkeyErrors);
            if (result.HotkeyErrors.Count > 0)
                SetStatus("Saved, but some hotkeys don't work. See Hotkeys above.", Theme.Amber);
            else if (result.Warnings.Count > 0)
                SetStatus("Saved. " + string.Join(" ", result.Warnings), Theme.Amber);
            else
                SetStatus("Settings saved.", Theme.Green);
        }
        catch (Exception ex)
        {
            _app.Log.Error("Saving settings failed", ex);
            SetStatus($"Couldn't save: {Fmt.FirstParagraph(ex.Message)}", Theme.Amber);
        }
        finally
        {
            _saving = false;
            UpdateDirty();
        }
    }

    private void CancelEdits()
    {
        LoadFrom(_app.Settings);
        SetStatus("Changes discarded.", Theme.TextSecondary);
    }

    private void ShowHotkeyErrors(IReadOnlyDictionary<HotkeyAction, string> errors)
    {
        foreach (var (action, label) in _hotkeyErrorLabels)
        {
            bool has = errors.TryGetValue(action, out var text);
            Theme.SetText(label, has ? text! : "");
            Theme.SetVisible(label, has);
            _hotkeyBoxes[action].HasError = has;
        }
    }

    private async Task RunTestAsync()
    {
        if (_testing || _app.IsBenchmarkRunning) return;
        if (_app.Caps is null)
        {
            _tips.Show("Set up FFmpeg first (see \"FFmpeg & help\" below).", _test, 0, _test.Height + 4, 3500);
            return;
        }
        _testing = true;
        UpdateTestButton();
        _testResult.ForeColor = Theme.TextSecondary;
        _testResult.Text = "Testing your PC with these settings (two short passes, about 20 seconds in all). A moving test picture covers the screen meanwhile...";
        try
        {
            var result = await _app.TestPcAsync(_pending.Clone(), FindForm());
            if (IsDisposed) return;
            if (result is null)
            {
                _testResult.Text = "Test cancelled.";
                return;
            }
            _testResult.ForeColor = result.Ok ? Theme.Green : Theme.Amber;
            var text = result.Message;
            if (result.AchievedFps > 0 || result.UniqueFps > 0)
                text += Environment.NewLine +
                        $"Encoder: {result.AchievedFps:0.#} fps (speed {result.Speed:0.00}x) \u00B7 Screen capture: {result.UniqueFps:0} different frames per second";
            _testResult.Text = text;
        }
        catch (Exception ex)
        {
            _app.Log.Error("Test my PC failed", ex);
            if (IsDisposed) return;
            _testResult.ForeColor = Theme.Amber;
            _testResult.Text = $"The test couldn't run: {Fmt.FirstParagraph(ex.Message)}";
        }
        finally
        {
            _testing = false;
            if (!IsDisposed) UpdateTestButton();
        }
    }

    /// <summary>Dimmed (it can't be clicked) while a test runs or FFmpeg is missing; dimming instead of disabling keeps the
    /// keyboard focus and the scroll position where they are.</summary>
    private void UpdateTestButton()
    {
        bool busy = _testing || _app.IsBenchmarkRunning;
        Theme.SetText(_test, busy ? "Testing..." : "Test my PC");
        _test.Dimmed = busy || _app.Caps is null || _app.IsExiting;
    }

    private async Task BrowseFfmpegAsync()
    {
        string? file = null;
        try
        {
            using var ofd = new OpenFileDialog
            {
                Title = "Find ffmpeg.exe",
                Filter = "FFmpeg (ffmpeg.exe)|ffmpeg.exe|Programs (*.exe)|*.exe",
                CheckFileExists = true,
                RestoreDirectory = true,
            };
            if (ofd.ShowDialog(FindForm()) == DialogResult.OK) file = ofd.FileName;
        }
        catch (Exception ex)
        {
            _app.Log.Error("ffmpeg browse failed", ex);
        }
        if (file is null) return;
        try { await _app.UseFfmpegFileAsync(file); }
        catch (Exception ex) { _app.Log.Error("Using the chosen ffmpeg failed", ex); }
    }

    // =====================================================================================================
    // Live refresh
    // =====================================================================================================

    /// <summary>"Pick another folder" on Home's recording banner: scroll to the clips folder and put the cursor there.</summary>
    public void FocusClipsFolder()
    {
        try
        {
            _scroll.ScrollControlIntoView(_clipsFolder);
            // ScrollControlIntoView leaves it at the bottom edge: bring the "Saving" card's heading into view too.
            var top = _scroll.PointToClient(_clipsFolder.PointToScreen(Point.Empty)).Y;
            int y = Math.Max(0, -_scroll.AutoScrollPosition.Y + top - LogicalToDeviceUnits(110));
            _scroll.AutoScrollPosition = new Point(0, y);
            _clipsFolder.Focus();
            _clipsFolder.SelectAll();
            SetStatus("Pick a clips folder on a drive with enough free space (Browse...), press Save, then press Try again on Home.", Theme.Amber);
        }
        catch (Exception ex)
        {
            _app.Log.Warn($"Could not show the clips folder setting: {ex.Message}");
        }
    }

    /// <summary>Called when the user opens the Settings page.</summary>
    public void OnPageShown()
    {
        // Task Manager > Startup apps may have turned "Start with Windows" off (or on) meanwhile: show the real state.
        if (_app.SyncStartWithWindows() && !_saving)
        {
            bool was = _loading;
            _loading = true;
            try
            {
                _pending.StartWithWindows = _app.Settings.StartWithWindows;
                _startWithWindows.Checked = _pending.StartWithWindows;
            }
            finally
            {
                _loading = was;
            }
        }
        if (!IsDirty && !_saving) LoadFrom(_app.Settings);
        else
        {
            FillMicrophones();
            RequestFreeSpace();
        }
        _scroll.Focus();
    }

    /// <summary>Called whenever the controller's state changes.</summary>
    public void OnAppChanged()
    {
        if (IsDisposed || !Visible) return;
        RefreshLive();
    }

    /// <summary>1 s refresh while visible: live stats, FFmpeg info, test button, monitor list.</summary>
    public void RefreshLive()
    {
        if (!ReferenceEquals(_capsShown, _app.Caps) || _app.FfmpegStatus != FfmpegState.Ready)
        {
            RefreshFfmpegInfo();
            UpdateDerived();
        }
        var signature = string.Join("|", _app.MonitorList.Select(m => m.ToString() + m.DeviceName));
        if (signature != _monitorSignature)
        {
            FillMonitors();
            UpdateDerived();
        }
        UpdateTestButton();
        RefreshControllers();

        string live;
        var state = _app.ReplayState;
        if (state == ReplayUiState.On)
        {
            var method = _app.ActiveMethod is { } m ? $" \u00B7 {Fmt.MethodLabel(m)}" : "";
            live = _app.Stats is { } st
                ? $"{st.Fps:0.#} fps \u00B7 speed {st.Speed:0.00}x \u00B7 {st.DroppedFrames} dropped frames \u00B7 buffer uses {QualityMath.FormatBytes(st.BufferBytesOnDisk)} on disk{method}"
                : "Replay is on." + method;
        }
        else if (state == ReplayUiState.Resuming) live = "Capture was interrupted and is resuming.";
        else live = "Replay is off.";
        Theme.SetText(_liveStats, live);
    }

    private void RefreshFfmpegInfo()
    {
        var caps = _app.Caps;
        _capsShown = caps;
        switch (_app.FfmpegStatus)
        {
            case FfmpegState.Checking:
                Theme.SetText(_ffStatus, "Checking FFmpeg and your graphics card...");
                Theme.SetFore(_ffStatus, Theme.TextSecondary);
                Theme.SetVisible(_ffStatus, true);
                break;
            case FfmpegState.Missing when caps is null:
                Theme.SetText(_ffStatus, "FFmpeg isn't set up yet. Press \"Download FFmpeg\" (about 100 MB) or \"Browse...\" if you already have it.");
                Theme.SetFore(_ffStatus, Theme.Amber);
                Theme.SetVisible(_ffStatus, true);
                break;
            case FfmpegState.Broken when caps is null:
                Theme.SetText(_ffStatus, _app.FfmpegProblem ?? "FFmpeg isn't working. Download it again.");
                Theme.SetFore(_ffStatus, Theme.Amber);
                Theme.SetVisible(_ffStatus, true);
                break;
            default:
                if (caps is { HasGfxCapture: false })
                {
                    Theme.SetText(_ffStatus, "This FFmpeg works, but has no Windows Graphics Capture (FFmpeg 8.1 or newer has it). Press \"Download FFmpeg\" to get the recommended version.");
                    Theme.SetFore(_ffStatus, Theme.TextSecondary);
                    Theme.SetVisible(_ffStatus, true);
                }
                else Theme.SetVisible(_ffStatus, false);
                break;
        }
        var candidate = _app.FfmpegCandidatePath;
        Theme.SetText(_ffPath, caps?.FfmpegPath ?? candidate ?? _app.Settings.FfmpegPath ?? "Not found");
        string version = caps is not null
            ? (string.IsNullOrWhiteSpace(caps.VersionLine) ? "unknown" : caps.VersionLine)
            : candidate is not null && !string.IsNullOrWhiteSpace(_app.FfmpegCandidateVersion) ? _app.FfmpegCandidateVersion + " (can't be used)"
            : "-";
        Theme.SetText(_ffVersion, version);
        Theme.SetText(_ffEncoders, caps is null ? "-"
            : caps.WorkingEncoders.Count == 0 ? "No video encoders worked. Update your graphics driver."
            : string.Join(", ", caps.WorkingEncoders.OrderBy(EncoderOrder).Select(Fmt.EncoderLabel)));
    }

    // =====================================================================================================
    // Controllers: connected list and button tester
    // =====================================================================================================

    /// <summary>The "Connected" line: the controllers found right now, or why there are none.</summary>
    private void RefreshControllers()
    {
        string text;
        Color color = Theme.Text;
        var pads = _app.Controllers;
        if (!_app.Settings.ControllerShortcuts)
        {
            text = _pending.ControllerShortcuts ? "Press Save to start looking for controllers." : "Controller shortcuts are off.";
            color = Theme.TextSecondary;
        }
        else if (_app.ControllerProblem is { } problem)
        {
            text = problem;
            color = Theme.Amber;
        }
        else if (pads.Count == 0)
        {
            text = "No controller found - plug one in or connect it by Bluetooth";
            color = Theme.TextSecondary;
        }
        else text = string.Join(Environment.NewLine, pads.Select(PadText.Describe));
        Theme.SetText(_padList, text);
        Theme.SetFore(_padList, color);

        // A controller that went away no longer shows in the tester.
        if (_padInput is { } input && !pads.Any(p => p.Id == input.Controller.Id)) _padInput = null;
        ShowPadInput();
    }

    /// <summary>"Press buttons to test: Create/Share + Cross → Save the replay", in that controller's own button names.</summary>
    private void ShowPadInput()
    {
        string text;
        Color color = Theme.TextSecondary;
        if (!_app.ControllersActive)
            text = "Turn on controller shortcuts (and press Save) to test your controller's buttons here.";
        else if (_app.Controllers.Count == 0)
            text = "Connect a controller, then press buttons here to test them.";
        else if (_padInput is not { } input)
            text = "Press buttons to test: nothing pressed yet";
        else
        {
            bool ps = input.Controller.IsPlayStation;
            var match = AppController.AllPadActions.FirstOrDefault(a => IsChordOf(AppController.PadChordFor(_pending, a), input.Combo), (PadAction)(-1));
            if (match >= 0)
            {
                text = $"Press buttons to test: {PadText.Short(AppController.PadChordFor(_pending, match), ps)} \u2192 {PadText.ActionName(match)}";
                color = Theme.Green;
            }
            else
            {
                text = $"Press buttons to test: {PadText.Combo(input.Combo, ps)}";
                color = Theme.Text;
            }
            if (_app.Controllers.Count > 1) text += $" ({PadText.Family(input.Controller.Kind)})";
        }
        Theme.SetText(_padTester, text);
        Theme.SetFore(_padTester, color);
    }

    /// <summary>The buttons pressed together are exactly this combo's (hold + press).</summary>
    private static bool IsChordOf(PadChord? chord, PadButtons combo) =>
        chord is { IsAssigned: true } && (chord.Hold | chord.Press) == combo;

    private void OnPadInput(PadInput input)
    {
        if (IsDisposed) return;
        _padInput = input;
        ShowPadInput();
    }

    private void UpdatePadListening()
    {
        bool listen = Visible && !IsDisposed;
        if (listen == _padListening) return;
        _padListening = listen;
        if (listen) _app.PadInputChanged += OnPadInput;
        else _app.PadInputChanged -= OnPadInput;
    }

    private static int EncoderOrder(string encoder) =>
        (encoder.StartsWith("lib", StringComparison.Ordinal) ? 100 : 0) + (encoder.StartsWith("hevc", StringComparison.Ordinal) ? 0 : encoder.StartsWith("h264", StringComparison.Ordinal) ? 1 : 2);

    // =====================================================================================================
    // Mouse wheel: scroll the page instead of changing whatever box is under the cursor
    // =====================================================================================================

    public bool PreFilterMessage(ref Message m)
    {
        if (m.Msg != WM_MOUSEWHEEL || !Visible || !_scroll.IsHandleCreated) return false;
        var target = FromChildHandle(m.HWnd);
        if (target is null) return false;
        bool inside = false;
        for (var c = target; c is not null; c = c.Parent)
        {
            if (c is ComboBox { DroppedDown: true }) return false; // let an open list scroll itself
            if (c == _scroll) inside = true;
        }
        if (!inside) return false;
        int delta = unchecked((short)(((long)m.WParam >> 16) & 0xFFFF));
        int lines = SystemInformation.MouseWheelScrollLines;
        if (lines <= 0) lines = 3;
        int step = (int)(delta / 120.0 * lines * Font.Height * 1.2);
        int y = Math.Max(0, -_scroll.AutoScrollPosition.Y - step);
        _scroll.AutoScrollPosition = new Point(0, y);
        return true;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Application.RemoveMessageFilter(this);
            if (_padListening) _app.PadInputChanged -= OnPadInput;
            _padListening = false;
            _tips.Dispose();
        }
        base.Dispose(disposing);
    }
}
