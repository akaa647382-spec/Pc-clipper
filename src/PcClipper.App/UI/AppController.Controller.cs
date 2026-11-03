using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// What a controller is pressing, for the Settings tester. <see cref="Combo"/> is everything pressed together since that
/// controller last had all buttons up; it stays after the buttons are released, so a quick tap can still be read.
/// </summary>
internal sealed record PadInput(ControllerInfo Controller, PadButtons Held, PadButtons Combo);

/// <summary>
/// Controller shortcuts (SPEC "Controller shortcuts"): Xbox and PlayStation pads through <see cref="ControllerManager"/>,
/// button combos turned into actions by Core's <see cref="ChordDetector"/>.
/// Threading: the manager raises its events on its polling thread. The detector runs there (under <see cref="_padGate"/>);
/// everything else - the action itself, the toast, the controller list - is posted to the UI thread, where the action
/// runs exactly like the keyboard hotkey (<see cref="RunShortcut"/>), so it never shows or activates a window.
/// </summary>
internal sealed partial class AppController
{
    private const int PadRumbleMs = 150;
    /// <summary>The Settings tester is updated at most this often (about 20 times a second).</summary>
    private const int PadInputIntervalMs = 50;

    public static readonly PadAction[] AllPadActions =
        { PadAction.SaveReplay, PadAction.ToggleRecording, PadAction.Screenshot, PadAction.ToggleReplay };

    /// <summary>The running manager, or null (shortcuts off, or it couldn't start). Read on the polling thread too.</summary>
    private volatile ControllerManager? _pads;
    private readonly object _padGate = new();
    /// <summary>Guarded by <see cref="_padGate"/>; replaced when the manager restarts (no stale "held" buttons).</summary>
    private ChordDetector _chords = new();
    /// <summary>Connected controllers, in connection order. UI thread.</summary>
    private readonly List<ControllerInfo> _padList = new();
    /// <summary>Controllers whose "connected" notice was shown this session (once each). UI thread.</summary>
    private readonly HashSet<string> _padsAnnounced = new();
    private string? _padProblem;

    // Settings tester (guarded by _padGate)
    private PadInput? _padLatest;
    private bool _padInputQueued;
    private long _padInputLastMs;
    private string? _padComboId;
    private PadButtons _padCombo;
    private bool _padReleased = true;

    /// <summary>
    /// Raised on the UI thread with what a controller is pressing, at most about 20 times a second, while anything listens
    /// (the Settings page subscribes only while it is shown).
    /// </summary>
    public event Action<PadInput>? PadInputChanged;

    /// <summary>Controllers connected right now (empty while controller shortcuts are off). UI thread.</summary>
    public IReadOnlyList<ControllerInfo> Controllers => _padList;

    /// <summary>The controller reader is running (controller shortcuts are on and it started).</summary>
    public bool ControllersActive => _pads is not null;

    /// <summary>Why controllers can't be used right now (the reader failed to start), or null.</summary>
    public string? ControllerProblem => _padProblem;

    public static PadChord PadChordFor(AppSettings s, PadAction action) => action switch
    {
        PadAction.SaveReplay => s.PadSaveReplay,
        PadAction.ToggleRecording => s.PadRecord,
        PadAction.Screenshot => s.PadScreenshot,
        _ => s.PadToggleReplay,
    };

    private static HotkeyAction ToHotkeyAction(PadAction action) => action switch
    {
        PadAction.SaveReplay => HotkeyAction.SaveReplay,
        PadAction.ToggleRecording => HotkeyAction.ToggleRecording,
        PadAction.Screenshot => HotkeyAction.Screenshot,
        _ => HotkeyAction.ToggleReplay,
    };

    // =====================================================================================================
    // Start / stop / bindings (UI thread)
    // =====================================================================================================

    /// <summary>At start-up and after Settings are applied: current bindings; reader on or off as the setting says.</summary>
    private void ApplyControllerSettings()
    {
        ApplyPadBindings();
        if (_settings.ControllerShortcuts && !_exiting) StartControllers();
        else StopControllers();
    }

    private void ApplyPadBindings()
    {
        var bindings = PadBindings(_settings);
        lock (_padGate) _chords.SetBindings(bindings);
    }

    /// <summary>A private copy of the four chords (the detector reads them on the polling thread).</summary>
    private static Dictionary<PadAction, PadChord> PadBindings(AppSettings s) =>
        AllPadActions.ToDictionary(a => a, a => (PadChordFor(s, a) ?? PadChord.Off).Clone());

    private void StartControllers()
    {
        if (_pads is not null) return;
        ControllerManager? manager = null;
        try
        {
            manager = new ControllerManager(_log);
            var m = manager;
            m.Connected += info => OnPadConnectedRaw(m, info);
            m.Disconnected += info => OnPadDisconnectedRaw(m, info);
            m.ButtonsChanged += (info, buttons) => OnPadButtonsRaw(m, info, buttons);
            // Set before Start: Start reports the controllers that are already plugged in, and events from any other
            // manager instance are ignored.
            _pads = m;
            m.Start();
            _padProblem = null;
            _log.Info("Controller shortcuts are on (Xbox and PlayStation controllers).");
        }
        catch (Exception ex)
        {
            _pads = null;
            _padProblem = "Controllers can't be used on this PC right now. Details are in the log (Settings > Open log folder).";
            _log.Error("Controller shortcuts are unavailable", ex);
            if (manager is not null) DisposeControllersInBackground(manager);
        }
        RaiseChanged();
    }

    private void StopControllers()
    {
        _padProblem = null;
        var m = _pads;
        if (m is null) return;
        _pads = null;
        ResetPadState();
        _log.Info("Controller shortcuts are off.");
        DisposeControllersInBackground(m);
        RaiseChanged();
    }

    /// <summary>Exit: stop reading controllers (waits briefly so a rumble isn't left running).</summary>
    private void StopControllersForExit()
    {
        var m = _pads;
        _pads = null;
        if (m is null) return;
        try
        {
            if (!Task.Run(m.Dispose).Wait(TimeSpan.FromMilliseconds(500)))
                _log.Warn("The controller reader took long to stop; closing anyway.");
        }
        catch (Exception ex)
        {
            _log.Warn($"Controller cleanup: {Fmt.FirstParagraph(ex.InnerException?.Message ?? ex.Message)}");
        }
    }

    /// <summary>Disposing may wait for the polling thread: never on the UI thread.</summary>
    private void DisposeControllersInBackground(ControllerManager m) =>
        _ = Task.Run(() =>
        {
            try { m.Dispose(); }
            catch (Exception ex) { _log.Warn($"Controller cleanup: {ex.Message}"); }
        });

    private void ResetPadState()
    {
        var bindings = PadBindings(_settings);
        lock (_padGate)
        {
            _chords = new ChordDetector();
            _chords.SetBindings(bindings);
            _padLatest = null;
            _padComboId = null;
            _padCombo = PadButtons.None;
            _padReleased = true;
        }
        _padList.Clear();
    }

    // =====================================================================================================
    // Manager events (polling thread -> UI thread)
    // =====================================================================================================

    private void OnPadConnectedRaw(ControllerManager m, ControllerInfo info)
    {
        if (!ReferenceEquals(m, _pads)) return;
        lock (_padGate) _chords.Forget(info.Id);
        Post(() => OnPadConnected(m, info));
    }

    private void OnPadDisconnectedRaw(ControllerManager m, ControllerInfo info)
    {
        if (!ReferenceEquals(m, _pads)) return;
        lock (_padGate)
        {
            _chords.Forget(info.Id);
            if (_padComboId == info.Id) _padReleased = true;
        }
        Post(() => OnPadDisconnected(m, info));
    }

    private void OnPadButtonsRaw(ControllerManager m, ControllerInfo info, PadButtons buttons)
    {
        if (!ReferenceEquals(m, _pads)) return;
        IReadOnlyList<PadAction> fired;
        lock (_padGate)
        {
            fired = _chords.Update(info.Id, buttons, Environment.TickCount64);
            TrackTesterInput(info, buttons);
        }
        foreach (var action in fired)
        {
            var a = action;
            Post(() => OnPadAction(m, info, a));
        }
        if (PadInputChanged is not null) QueuePadInput();
    }

    /// <summary>The tester's "combo": everything pressed together since this controller last had all buttons up.</summary>
    private void TrackTesterInput(ControllerInfo info, PadButtons buttons)
    {
        if (buttons != PadButtons.None && (_padReleased || _padComboId != info.Id))
        {
            // A new press after everything was up (or on another controller) starts a new combo.
            _padCombo = PadButtons.None;
            _padComboId = info.Id;
            _padReleased = false;
        }
        if (_padComboId != info.Id) return; // another controller letting go: the shown combo stays
        _padCombo |= buttons;
        if (buttons == PadButtons.None) _padReleased = true;
        _padLatest = new PadInput(info, buttons, _padCombo);
    }

    /// <summary>Coalesces button changes into at most one UI update per <see cref="PadInputIntervalMs"/>. Any thread.</summary>
    private void QueuePadInput()
    {
        int delay;
        lock (_padGate)
        {
            if (_padInputQueued || _padLatest is null) return;
            _padInputQueued = true;
            delay = (int)Math.Clamp(PadInputIntervalMs - (Environment.TickCount64 - _padInputLastMs), 0, PadInputIntervalMs);
        }
        if (delay == 0) Post(FlushPadInput);
        else _ = Task.Delay(delay).ContinueWith(_ => Post(FlushPadInput), TaskScheduler.Default);
    }

    private void FlushPadInput()
    {
        PadInput? input;
        lock (_padGate)
        {
            input = _padLatest;
            _padInputQueued = false;
            _padInputLastMs = Environment.TickCount64;
        }
        if (input is null || _pads is null || _exiting) return;
        try { PadInputChanged?.Invoke(input); }
        catch (Exception ex) { _log.Error("Showing the controller test failed", ex); }
    }

    private void OnPadConnected(ControllerManager m, ControllerInfo info)
    {
        if (!ReferenceEquals(m, _pads) || _exiting) return;
        _padList.RemoveAll(p => p.Id == info.Id);
        _padList.Add(info);
        // (ControllerManager already logs the connect; add only what it doesn't say.)
        _log.Info($"Controller {info.Kind} ready for shortcuts (id {info.Id}).");
        // Recognition: say once per controller and session which family it is and how to save with it.
        if (_padsAnnounced.Add(info.Id)) Notify(ConnectedNotice(info), ToastKind.Info);
        RaiseChanged();
    }

    private void OnPadDisconnected(ControllerManager m, ControllerInfo info)
    {
        if (!ReferenceEquals(m, _pads)) return;
        _padList.RemoveAll(p => p.Id == info.Id);
        _log.Info($"Controller disconnected: {info.Name} - {info.Connection}.");
        RaiseChanged();
    }

    /// <summary>A shortcut fired (UI thread): exactly the keyboard hotkey's action; a short rumble once it worked.</summary>
    private void OnPadAction(ControllerManager m, ControllerInfo pad, PadAction action)
    {
        if (_exiting || !ReferenceEquals(m, _pads) || !_settings.ControllerShortcuts) return;
        var chord = PadChordFor(_settings, action);
        _log.Info($"Controller shortcut {PadText.Short(chord, pad.IsPlayStation)} on {pad.Name}: {action}.");
        RunShortcut(ToHotkeyAction(action), () => RumbleIfWanted(m, pad));
    }

    private void RumbleIfWanted(ControllerManager m, ControllerInfo pad)
    {
        if (!_settings.ControllerVibrate || !ReferenceEquals(m, _pads)) return;
        // Only queues the request (the polling thread runs the motors); Xbox pads only - PlayStation pads are never written to.
        try { m.Vibrate(pad, PadRumbleMs); }
        catch (Exception ex) { _log.Warn($"Controller rumble failed: {ex.Message}"); }
    }

    /// <summary>
    /// "PS5 controller connected - Create/Share + Cross saves the last 15 min". The on-screen notice is one line of
    /// about 65 characters, so this uses the short form of the shortcut; Settings and the Home page show the rest.
    /// </summary>
    private string ConnectedNotice(ControllerInfo pad)
    {
        var s = _settings;
        bool ps = pad.IsPlayStation;
        var head = $"{PadText.Family(pad.Kind)} connected";
        if (s.PadSaveReplay.IsAssigned)
            return $"{head} - {PadText.Short(s.PadSaveReplay, ps)} saves the last {QualityMath.FormatSaveLength(s.HotkeySaveSeconds)}";
        foreach (var action in AllPadActions)
        {
            var chord = PadChordFor(s, action);
            if (chord.IsAssigned) return $"{head} - {PadText.Short(chord, ps)}: {PadText.ActionName(action).ToLowerInvariant()}";
        }
        return $"{head}. Pick its shortcuts in Settings > Controller.";
    }
}

/// <summary>Controller words and shortcut texts for the window, the notices and the log.</summary>
internal static class PadText
{
    /// <summary>Menu and shoulder buttons (what you hold) before face buttons and the d-pad (what you press).</summary>
    private static readonly PadButtons[] ReadingOrder =
    {
        PadButtons.View, PadButtons.Menu, PadButtons.Guide, PadButtons.LeftBumper, PadButtons.RightBumper,
        PadButtons.LeftTrigger, PadButtons.RightTrigger, PadButtons.LeftStick, PadButtons.RightStick, PadButtons.Touchpad,
        PadButtons.Mute, PadButtons.A, PadButtons.B, PadButtons.X, PadButtons.Y,
        PadButtons.DpadUp, PadButtons.DpadDown, PadButtons.DpadLeft, PadButtons.DpadRight,
    };

    /// <summary>"View + A" / "Create/Share + Cross" / "Off" (shorter than <see cref="PadLabels.Describe"/>).</summary>
    public static string Short(PadChord? chord, bool playStation)
    {
        if (chord is not { IsAssigned: true }) return "Off";
        var press = PadLabels.Name(chord.Press, playStation);
        return chord.Hold == PadButtons.None ? press : $"{Combo(chord.Hold, playStation)} + {press}";
    }

    /// <summary>The pressed buttons in reading order, e.g. "Create/Share + Cross"; "Nothing pressed" for none.</summary>
    public static string Combo(PadButtons buttons, bool playStation)
    {
        var names = ReadingOrder.Where(b => buttons.HasFlag(b)).Select(b => PadLabels.Name(b, playStation)).ToList();
        // Anything not in the list (a button added later) goes last.
        foreach (var b in Enum.GetValues<PadButtons>())
            if (b != PadButtons.None && buttons.HasFlag(b) && Array.IndexOf(ReadingOrder, b) < 0) names.Add(PadLabels.Name(b, playStation));
        return names.Count == 0 ? "Nothing pressed" : string.Join(" + ", names);
    }

    /// <summary>"Xbox controller", "PS4 controller", "PS5 controller".</summary>
    public static string Family(ControllerKind kind) => kind switch
    {
        ControllerKind.PlayStation4 => "PS4 controller",
        ControllerKind.PlayStation5 => "PS5 controller",
        _ => "Xbox controller",
    };

    /// <summary>The name used for an action in Settings (same as the Hotkeys card).</summary>
    public static string ActionName(PadAction action) => action switch
    {
        PadAction.SaveReplay => "Save the replay",
        PadAction.ToggleRecording => "Start/stop recording",
        PadAction.Screenshot => "Screenshot",
        _ => "Turn replay on/off",
    };

    /// <summary>"DualSense Wireless Controller - Bluetooth".</summary>
    public static string Describe(ControllerInfo pad) =>
        string.IsNullOrWhiteSpace(pad.Connection) ? pad.Name : $"{pad.Name} - {pad.Connection}";
}
