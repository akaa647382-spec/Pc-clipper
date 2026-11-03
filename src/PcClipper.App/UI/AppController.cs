using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;
using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

internal enum FfmpegState
{
    /// <summary>Looking for ffmpeg / testing the graphics card's encoders.</summary>
    Checking,
    Ready,
    /// <summary>No ffmpeg found.</summary>
    Missing,
    /// <summary>Found one but it does not work, or it is too old (no ddagrab / scale_d3d11).</summary>
    Broken,
}

/// <summary>What the replay buffer looks like to the user (combines engine state, ffmpeg state and supervision).</summary>
internal enum ReplayUiState
{
    CheckingFfmpeg,
    NeedsFfmpeg,
    Off,
    Starting,
    On,
    Stopping,
    /// <summary>Capture was interrupted (UAC prompt, fullscreen switch...); restarting automatically, the buffer is kept.</summary>
    Resuming,
    /// <summary>Stopped by a problem a restart can't fix, or failed to start; waiting for the user.</summary>
    Problem,
}

/// <summary>Why the replay buffer is being started. Decides dialogs, buffer reuse and automatic retries.</summary>
internal enum StartKind
{
    /// <summary>Window, tray or banner: may open the FFmpeg setup dialog; failures are shown.</summary>
    User,
    /// <summary>Like <see cref="User"/>, but never opens a window (focus theft can minimize a fullscreen game); confirms with a toast.</summary>
    Hotkey,
    /// <summary>"Turn replay on when PC Clipper starts": no dialogs; failures a restart can fix are retried.</summary>
    Launch,
    /// <summary>Supervised restart after a fault: continues the same buffer; failures a restart can fix are retried.</summary>
    Resume,
    /// <summary>After applying capture settings or "Test my PC": a fresh buffer; failures are shown.</summary>
    Restart,
}

internal sealed record Notice(string Text, ToastKind Kind, DateTime When);

internal sealed record ApplyResult(bool Applied, IReadOnlyDictionary<HotkeyAction, string> HotkeyErrors, IReadOnlyList<string> Warnings)
{
    public static readonly ApplyResult Cancelled = new(false, new Dictionary<HotkeyAction, string>(), Array.Empty<string>());
}

/// <summary>
/// The app's brain. Owns settings, log, monitors, ffmpeg capabilities, the replay engine, hotkeys, controller shortcuts
/// (AppController.Controller.cs), tray icon and main window, and turns every user action into engine calls plus feedback
/// (toast, sound, window).
/// Threading: everything here runs on the UI thread. Engine events arrive on background threads and are posted here;
/// engine/ffmpeg work is started with Task.Run so the UI never waits on disk or processes; nothing blocks on a task.
/// Every platform call is wrapped so a failure only disables that one feature.
/// </summary>
internal sealed partial class AppController : ApplicationContext
{
    /// <summary>A run that lasted this long counts as healthy: the restart backoff starts again at 1 s.</summary>
    private static readonly TimeSpan HealthyRun = TimeSpan.FromSeconds(20);
    private const int MaxBackoffSeconds = 30;
    /// <summary>Capture interruptions are quiet; if resuming keeps failing this long, the user is told once.</summary>
    private static readonly TimeSpan PersistentProblemNotice = TimeSpan.FromSeconds(60);
    /// <summary>
    /// A second Record press this soon after the first is ignored: FlatButton (a Button) raises Click twice on a
    /// double-click, which would start and immediately stop a recording.
    /// </summary>
    private const long RecordToggleDebounceMs = 600;
    /// <summary>A second "save the last N" of the same length this soon after the first is the same clip: ignored.</summary>
    private const long SaveDebounceMs = 1000;
    /// <summary>
    /// A buffer that has not run at all since it was turned on gives up after this many failed starts (~30 s of tries)
    /// and shows the problem; once it has run, interruptions are retried indefinitely (SPEC).
    /// </summary>
    private const int MaxStartsBeforeFirstRun = 6;
    private const int RecentLimit = 8;

    private static readonly JsonSerializerOptions LogJson = new() { Converters = { new JsonStringEnumConverter() } };

    private readonly SynchronizationContext _ui;
    private readonly int _uiThread;
    private readonly bool _startedMinimized;
    private readonly SafeLog _log;
    private readonly ReplayEngine _engine;
    private readonly System.Windows.Forms.Timer _tick;
    private AppSettings _settings;
    private IReadOnlyList<MonitorInfo> _monitors;

    // FFmpeg
    private FfmpegCapabilities? _caps;
    private FfmpegState _ffmpegState = FfmpegState.Checking;
    private string? _ffmpegProblem;
    private bool _ffmpegDialogOpen;
    /// <summary>The last ffmpeg.exe that was checked and its version line (shown in Settings even when it was rejected).</summary>
    private string? _ffmpegCandidatePath;
    private string? _ffmpegCandidateVersion;

    // Platform pieces (each may be null if it failed to initialise)
    private TrayController? _tray;
    private HotkeyManager? _hotkeys;
    private IReadOnlyDictionary<HotkeyAction, string> _hotkeyErrors = new Dictionary<HotkeyAction, string>();
    private bool _hotkeysPaused;
    private MainForm? _form;

    // Replay lifecycle + supervision (SPEC "Engine supervision")
    private bool _wantReplayOn;
    private bool _lifecycleBusy;
    private string? _replayProblem;
    private bool _resuming;
    /// <summary>The buffer reached Running at least once since the user (or start-up) turned it on.</summary>
    private bool _ranSinceOn;
    private string? _interruptReason;
    private int _failStreak;
    /// <summary>When the current failure streak began (Environment.TickCount64: immune to clock changes).</summary>
    private long? _streakStartedMs;
    private bool _persistentNoticeShown;
    /// <summary>When the scheduled resume fires (Environment.TickCount64), or null.</summary>
    private long? _restartAtMs;
    private CancellationTokenSource? _restartCts;
    /// <summary>A start is waiting for the start-up recovery of kept recordings to finish (the buffer comes after it).</summary>
    private bool _startWaitingForRecovery;

    // Actions in flight
    private readonly Dictionary<int, int> _savesInFlight = new();
    /// <summary>Clip saves and recording retries being written right now (exit and shutdown wait for these).</summary>
    private readonly HashSet<Task> _saveTasks = new();
    /// <summary>When each "save the last N" was last started (Environment.TickCount64: a clock change can't swallow presses).</summary>
    private readonly Dictionary<int, long> _lastSaveRequestMs = new();
    private bool _recordingSaving;
    private Task<bool> _recordingSaveTask = Task.FromResult(true);
    /// <summary>When Record was last pressed (Environment.TickCount64), or null.</summary>
    private long? _lastRecordToggleMs;
    /// <summary>Record was pressed while the buffer was off: the buffer is starting and the recording follows.</summary>
    private bool _recordStartPending;
    private bool _retryingRecordings;
    /// <summary>
    /// How many recordings the running retry is saving. The engine takes them out of its pending list while it saves them
    /// (and puts back the ones that fail), so its count reads 0 meanwhile; this keeps the banner, the tray item and the
    /// "a recording isn't saved yet" checks in place until the retry is over.
    /// </summary>
    private int _retryingCount;
    /// <summary>Why the last recording save failed (its footage is kept by the engine as a pending recording).</summary>
    private string? _pendingRecordingReason;
    /// <summary>A recording that couldn't be saved is kept in the buffer folder (recovered on the next start), until dismissed.</summary>
    private string? _keptRecordingNotice;
    /// <summary>The session folder that holds that kept recording (the banner's Open folder).</summary>
    private string? _keptRecordingFolder;
    /// <summary>The buffer folder at start-up: where an earlier session's kept recordings are.</summary>
    private readonly string _startupBufferFolder;
    /// <summary>
    /// Earlier buffer folders that may still hold kept recordings (settings KeptRecordingRoots, as at start-up): the buffer
    /// folder was changed while a recording waited to be saved there. Recovered from like the start-up buffer folder.
    /// </summary>
    private readonly IReadOnlyList<string> _startupKeptRoots;
    private readonly IProcessGuard _processGuard;
    /// <summary>Start-up recovery of recordings an earlier session couldn't save (crash, power cut, failed save).</summary>
    private Task _recoveryTask = Task.CompletedTask;
    private bool _recoveryStarted;
    private bool _recoveringRecordings;
    private bool _screenshotBusy;
    private bool _benchmarkRunning;
    private bool _exiting;
    /// <summary>Exit is waiting for clips/recordings to finish writing.</summary>
    private bool _waitingForSaves;
    /// <summary>The user chose "Close anyway" while exit was waiting for a save.</summary>
    private bool _forceExit;
    private bool _exitDialogOpen;
    /// <summary>ShutdownBlockReasonCreate is active on the main window's handle.</summary>
    private bool _shutdownBlocked;
    /// <summary>
    /// Windows asked to end the session while something was being written: PC Clipper answered "not yet" and is finishing
    /// it, then closes so the shutdown continues - unless WM_ENDSESSION(FALSE) says the shutdown was cancelled.
    /// </summary>
    private bool _shutdownPending;
    /// <summary>WM_ENDSESSION(TRUE) arrived: the session is really ending.</summary>
    private bool _sessionEnded;
    private bool _shutDown;
    /// <summary>The engine stop started by ExitAsync (WM_ENDSESSION waits for it instead of starting another).</summary>
    private Task? _exitStopTask;
    private bool _trayHintShown;
    private EngineStats? _stats;
    private bool _statsPolling;

    // Audio sources of the running session, so volume changes apply without a restart.
    private readonly object _sourcesGate = new();
    private List<(bool IsMic, IAudioSource Source)> _liveSources = new();

    private readonly List<RecentItem> _recent = new();

    public AppController(bool startMinimized)
    {
        _startedMinimized = startMinimized;
        if (SynchronizationContext.Current is not WindowsFormsSynchronizationContext)
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        _ui = SynchronizationContext.Current!;
        _uiThread = Environment.CurrentManagedThreadId;

        _log = SafeLog.Create(DefaultPaths.LogFolder);
        CrashReporter.Attach(_log, _log.FilePath, _ui, QuietCrashNotice);
        _settings = LoadSettings();
        _startupBufferFolder = _settings.BufferFolder;
        _startupKeptRoots = (_settings.KeptRecordingRoots ?? new List<string>()).ToList();
        _monitors = Monitors.Enumerate(_log);
        LogStartupInfo();

        _processGuard = new SafeProcessGuard(_log);
        _engine = new ReplayEngine(new EngineEnvironment
        {
            Log = _log,
            CreatePcmSink = () => new NamedPipePcmSink(),
            CreateAudioSources = CreateAudioSources,
            ProcessGuard = _processGuard,
            RecordingPathFactory = AutoRecordingPath,
        });
        // Engine events fire on engine threads: read what we need there, then continue on the UI thread.
        _engine.StateChanged += s => Post(() => OnEngineStateChanged(s));
        _engine.Problem += OnEngineProblemRaised;
        _engine.RecordingAutoSaved += r => Post(() => OnRecordingAutoSaved(r));

        CreateHotkeys();
        CreateTray();

        _form = new MainForm(this);
        // Create the (hidden) window now, also when starting minimized: a top-level window is what receives
        // WM_QUERYENDSESSION / WM_ENDSESSION, so the form can hold up a Windows shutdown while a recording or clip is still
        // being written (MainForm.OnFormClosing), notice a cancelled shutdown (MainForm.WndProc), and it is the window
        // ShutdownBlockReasonCreate needs.
        try { _ = _form.Handle; }
        catch (Exception ex) { _log.Warn($"Main window handle unavailable: {ex.Message}"); }
        if (!startMinimized) _form.ShowAndActivate();
        else if (_tray is null)
        {
            // Without a tray icon a hidden window could never be found again: start minimized to the taskbar instead.
            _form.WindowState = FormWindowState.Minimized;
            _form.Show();
        }

        _tick = new System.Windows.Forms.Timer { Interval = 1000 };
        _tick.Tick += (_, _) => OnTick();
        _tick.Start();

        try { SingleInstance.ListenForShow(() => Post(ShowMainWindow)); }
        catch (Exception ex) { _log.Warn($"Second-launch listener unavailable: {ex.Message}"); }
        try
        {
            SystemEvents.SessionEnding += OnSessionEnding;
            SystemEvents.SessionEnded += OnSessionEnded;
            SystemEvents.DisplaySettingsChanged += OnDisplaySettingsChanged;
        }
        catch (Exception ex)
        {
            _log.Warn($"System events unavailable: {ex.Message}");
        }

        // Continue once the message loop runs (everything below is async).
        Post(() => Fire(StartupAsync, "Starting PC Clipper"));
    }

    // =====================================================================================================
    // State the window, tray and views read
    // =====================================================================================================

    /// <summary>Raised on the UI thread whenever something visible changed.</summary>
    public event Action? Changed;

    /// <summary>Raised on the UI thread for every user-facing message (mirrors the on-screen toast).</summary>
    public event Action<Notice>? NoticePosted;

    /// <summary>The active settings. Treat as read-only; change them through <see cref="ApplySettingsAsync"/>.</summary>
    public AppSettings Settings => _settings;
    public ILog Log => _log;
    public ReplayEngine Engine => _engine;
    public FfmpegCapabilities? Caps => _caps;
    public FfmpegState FfmpegStatus => _ffmpegState;
    public string? FfmpegProblem => _ffmpegProblem;
    /// <summary>The ffmpeg.exe last checked (also when it was rejected) and its version line.</summary>
    public string? FfmpegCandidatePath => _ffmpegCandidatePath;
    public string? FfmpegCandidateVersion => _ffmpegCandidateVersion;
    public IReadOnlyList<MonitorInfo> MonitorList => _monitors;
    public MonitorInfo CurrentMonitor => PickMonitor(_settings.MonitorDeviceName);
    public MonitorInfo PickMonitor(string? deviceName) => Monitors.Pick(_monitors, deviceName);
    public IReadOnlyDictionary<HotkeyAction, string> HotkeyErrors => _hotkeyErrors;
    public IReadOnlyList<RecentItem> Recent => _recent;
    public bool IsRecording => _engine.IsRecording;
    public TimeSpan RecordingElapsed => _engine.RecordingElapsed;
    public bool IsRecordingSaving => _recordingSaving;
    /// <summary>Record was pressed while the buffer was off; the recording starts once the buffer is on.</summary>
    public bool IsRecordStartPending => _recordStartPending;
    public bool IsRetryingRecordings => _retryingRecordings;
    /// <summary>Recordings PC Clipper kept from an earlier session are being saved (start-up recovery).</summary>
    public bool IsRecoveringRecordings => _recoveringRecordings;
    /// <summary>Recordings whose save failed (also while "Try again" is saving them); the engine keeps their footage until a retry works.</summary>
    public int PendingRecordingCount => PendingCount();

    /// <summary>
    /// True while anything is being written that ending the process would destroy: a running recording (it is saved on
    /// exit), a recording being saved, clip saves, recording retries, and saves the engine started on its own.
    /// </summary>
    public bool IsAnySaveInFlight =>
        _engine.IsRecording || _recordingSaving || _retryingRecordings || _saveTasks.Count > 0 || SafeActiveOperations() > 0;

    /// <summary><see cref="IsAnySaveInFlight"/> or the start-up recovery of kept recordings (exit and shutdown wait for both).</summary>
    private bool IsAnythingBeingWritten => IsAnySaveInFlight || _recoveringRecordings;

    /// <summary>Clips (not recordings) are being saved right now.</summary>
    public bool IsSavingClips => _saveTasks.Count > 0;

    /// <summary>A Windows shutdown should wait for PC Clipper: something is being written, or a recording still needs saving.</summary>
    public bool ShouldBlockShutdown => IsAnythingBeingWritten || PendingCount() > 0;
    public bool IsTakingScreenshot => _screenshotBusy;
    public bool IsBenchmarkRunning => _benchmarkRunning;
    public bool IsExiting => _exiting;
    /// <summary>False when the notification-area icon could not be created.</summary>
    public bool HasTray => _tray is not null;
    public bool IsSaving(int seconds) => _savesInFlight.TryGetValue(seconds, out var n) && n > 0;

    /// <summary>The shortest clip (the first save length): nothing shorter is ever saved, not even from a shortcut.</summary>
    public static int MinClipSeconds => AppSettings.SaveLengthsSeconds[0];

    /// <summary>
    /// Like on PlayStation, a save length unlocks once that much has been recorded: true when <paramref name="buffered"/>
    /// (<see cref="SafeBuffered"/>) covers <paramref name="seconds"/> and the buffer is long enough to ever hold it.
    /// Says nothing about whether saving is possible at all (<see cref="CanSave"/>).
    /// </summary>
    public bool HasRecorded(int seconds, TimeSpan buffered) =>
        seconds <= BufferSeconds && buffered.TotalSeconds >= seconds - SegmentStore.SelectionSlackSeconds;

    /// <summary>"in 12 s" / "in about 14 min": how long until <paramref name="seconds"/> is recorded.</summary>
    public static string UnlocksIn(int seconds, TimeSpan buffered)
    {
        double left = Math.Max(1, Math.Ceiling(seconds - buffered.TotalSeconds));
        return left < 60 ? $"in {left:0} s" : $"in about {Math.Ceiling(left / 60):0} min";
    }
    /// <summary>Latest capture statistics (polled in the background every second while running), or null.</summary>
    public EngineStats? Stats => _engine.State == EngineState.Running ? _stats : null;

    /// <summary>
    /// Length of the buffer that is running (or would run), in seconds. Always the setting: a change of length is applied
    /// to a running buffer live (ReplayEngine.SetBufferSeconds), so the running config's own value can be out of date.
    /// </summary>
    public int BufferSeconds => _settings.BufferMinutes * 60;

    /// <summary>
    /// Saving works while running, and also while capture is interrupted or stopped by a fault: the footage recorded
    /// before that is still on disk.
    /// </summary>
    public bool CanSave
    {
        get
        {
            var s = _engine.State;
            if (s == EngineState.Running) return true;
            return s is EngineState.Faulted or EngineState.Starting && _engine.ActiveConfig is not null && SafeBuffered() > TimeSpan.Zero;
        }
    }

    public ReplayUiState ReplayState
    {
        get
        {
            var s = _engine.State;
            if (s == EngineState.Stopping || (_lifecycleBusy && !_wantReplayOn)) return ReplayUiState.Stopping;
            if (s == EngineState.Running) return ReplayUiState.On;
            // Faulted while the user wants it on: the Problem handler decides in a moment whether to resume.
            if (_wantReplayOn && (_resuming || (s == EngineState.Faulted && !_lifecycleBusy))) return ReplayUiState.Resuming;
            if (s == EngineState.Starting || ((_lifecycleBusy || _startWaitingForRecovery) && _wantReplayOn)) return ReplayUiState.Starting;
            if (_caps is null && _ffmpegState == FfmpegState.Checking) return ReplayUiState.CheckingFfmpeg;
            if (_caps is null) return ReplayUiState.NeedsFfmpeg;
            if (s == EngineState.Faulted || _replayProblem is not null) return ReplayUiState.Problem;
            return ReplayUiState.Off;
        }
    }

    /// <summary>The method the running (or last) capture uses.</summary>
    public CaptureMethod? ActiveMethod => _engine.ActiveConfig?.Method;

    /// <summary>One quiet line about an interruption ("... Trying again in 4 s."), or null when not resuming.</summary>
    public string? ResumeDetail
    {
        get
        {
            if (ReplayState != ReplayUiState.Resuming) return null;
            var reason = _interruptReason is null ? "" : Fmt.Sentence(_interruptReason) + " ";
            if (_restartAtMs is { } at)
            {
                int s = Math.Max(1, (int)Math.Ceiling((at - Environment.TickCount64) / 1000.0));
                return $"{reason}Trying again in {s} s.";
            }
            return reason + "Trying again now...";
        }
    }

    /// <summary>The amber banner text on the Home page, or null when everything is fine.</summary>
    public string? ProblemText
    {
        get
        {
            if (_caps is null && _ffmpegState == FfmpegState.Missing)
                return "PC Clipper needs FFmpeg, a free video engine, to record your screen. Set it up once and you're done.";
            if (_caps is null && _ffmpegState == FfmpegState.Broken)
                return _ffmpegProblem ?? "The FFmpeg video engine isn't working. Set it up again.";
            var state = ReplayState;
            if (state == ReplayUiState.Resuming && _persistentNoticeShown)
                return $"Replay keeps getting interrupted: {Fmt.Sentence(_interruptReason ?? "the screen capture stopped")} PC Clipper keeps trying.";
            if (state == ReplayUiState.Problem && _replayProblem is not null)
                return CanSave ? _replayProblem + " What was recorded before that can still be saved." : _replayProblem;
            return null;
        }
    }

    /// <summary>Button text for the banner action, or null for none.</summary>
    public string? ProblemActionText
    {
        get
        {
            if (_caps is null && _ffmpegState is FfmpegState.Missing or FfmpegState.Broken) return "Set up FFmpeg";
            var state = ReplayState;
            if (state == ReplayUiState.Resuming) return _restartAtMs is not null ? "Try now" : null;
            if (state == ReplayUiState.Problem && _replayProblem is not null) return "Try again";
            return null;
        }
    }

    public string StatusSummary()
    {
        if (IsRecording) return $"recording {Fmt.Clock(RecordingElapsed)}";
        return ReplayState switch
        {
            ReplayUiState.On => $"replay on, {Fmt.MinSec(SafeBuffered())} buffered",
            ReplayUiState.Starting => "replay starting",
            ReplayUiState.Stopping => "turning off",
            ReplayUiState.Resuming => "replay resuming",
            ReplayUiState.CheckingFfmpeg => "getting ready",
            ReplayUiState.NeedsFfmpeg => "needs FFmpeg",
            ReplayUiState.Problem => "replay stopped (problem)",
            _ => "replay off",
        };
    }

    public string TrayTooltip() => "PC Clipper - " + StatusSummary();

    public TimeSpan SafeBuffered()
    {
        try { return _engine.Buffered; }
        catch { return TimeSpan.Zero; }
    }

    private int SafeActiveOperations()
    {
        try { return _engine.ActiveOperations; }
        catch { return 0; }
    }

    private int SafePendingRecordings()
    {
        try { return _engine.PendingRecordingCount; }
        catch { return 0; }
    }

    /// <summary>
    /// Recordings that still need saving. While "Try again" runs, the ones it is saving count too (the engine's own count
    /// is 0 until a failed one is put back), so nothing that relies on this vanishes or skips its warning meanwhile.
    /// </summary>
    private int PendingCount()
    {
        int n = SafePendingRecordings();
        return _retryingRecordings ? Math.Max(n, _retryingCount) : n;
    }

    /// <summary>
    /// The Home page's second banner: a recording whose save failed (kept by the engine until a retry works), the
    /// start-up recovery of recordings kept by an earlier session, or the notice that such a recording is kept in the
    /// buffer folder. Null when there is nothing to say.
    /// </summary>
    public string? RecordingBannerText
    {
        get
        {
            int n = PendingCount();
            if (n > 0)
            {
                if (_retryingRecordings) return n == 1 ? "Saving your recording again..." : $"Saving your {n} recordings again...";
                var reason = Fmt.Sentence(_pendingRecordingReason ?? "the save didn't work");
                return n == 1
                    ? $"A recording wasn't saved: {reason} PC Clipper is keeping it until it can be saved."
                    : $"{n} recordings weren't saved: {reason} PC Clipper is keeping them until they can be saved.";
            }
            if (_recoveringRecordings) return "Saving a recording that PC Clipper kept from last time...";
            return _keptRecordingNotice;
        }
    }

    /// <summary>True when the recording banner offers Try again / Pick another folder (else it shows the "kept" notice).</summary>
    public bool RecordingBannerIsPending => PendingCount() > 0;

    // =====================================================================================================
    // User actions (safe to call from any UI handler; they never throw and never block)
    // =====================================================================================================

    /// <summary>
    /// Turn ON / Turn OFF. From a hotkey (or controller shortcut) it never opens a window and confirms with a toast instead.
    /// <paramref name="onSuccess"/> runs (UI thread) once the replay really is on, or off.
    /// </summary>
    public void ToggleReplay(bool fromHotkey = false, Action? onSuccess = null)
    {
        if (_exiting) return;
        bool on = _wantReplayOn || _engine.State is EngineState.Running or EngineState.Starting || _restartAtMs is not null;
        if (on && !fromHotkey && PendingCount() > 0 &&
            !MessageDialog.Confirm(OwnerWindow(), "A recording isn't saved yet",
                (_retryingRecordings
                    ? "PC Clipper is saving the recording that wasn't saved; the replay turns off when that is done. "
                    : "Turning the replay buffer off tries once more to save the recording that wasn't saved. ") +
                "If that still doesn't work, PC Clipper keeps the recording in the buffer folder and saves it the next " +
                "time it starts.\n\nTurn the replay off anyway?", "Turn off", "Cancel", warning: true))
            return;
        if (on)
            Fire(async () =>
            {
                await StopReplayAsync(announce: fromHotkey);
                if (!ReplayWanted) onSuccess?.Invoke();
            }, "Turning the replay buffer off");
        else if (!_lifecycleBusy)
            Fire(async () =>
            {
                if (await StartReplayAsync(fromHotkey ? StartKind.Hotkey : StartKind.User)) onSuccess?.Invoke();
            }, "Turning the replay buffer on");
    }

    /// <param name="onSuccess">Runs (UI thread) after the clip was saved; used by controller shortcuts for their rumble.</param>
    /// <param name="fromShortcut">A hotkey or controller shortcut (see <see cref="SaveLastAsync"/>), not a button or menu item.</param>
    public void SaveLast(int seconds, Action? onSuccess = null, bool fromShortcut = false) =>
        Fire(async () => { if (await SaveLastAsync(seconds, fromShortcut)) onSuccess?.Invoke(); }, "Saving the clip");

    /// <param name="onSuccess">Runs (UI thread) once a recording started, or was stopped and saved.</param>
    public void ToggleRecording(bool fromHotkey = false, Action? onSuccess = null) =>
        Fire(async () => { if (await ToggleRecordingAsync(fromHotkey)) onSuccess?.Invoke(); }, "Recording");

    /// <param name="onSuccess">Runs (UI thread) after the screenshot was saved.</param>
    public void TakeScreenshot(Action? onSuccess = null) =>
        Fire(async () => { if (await TakeScreenshotAsync()) onSuccess?.Invoke(); }, "Taking the screenshot");

    public void OpenClipsFolder() => OpenFolder(_settings.ClipsFolder);

    public void OpenFolder(string folder)
    {
        if (!Shell.OpenFolder(folder, out var err)) Notify(err ?? "That folder couldn't be opened.", ToastKind.Warning, SoundKind.Error);
    }

    public void OpenLogFolder() => OpenFolder(DefaultPaths.LogFolder);

    /// <summary>The banner's action button.</summary>
    public void ResolveProblem()
    {
        if (_caps is null && _ffmpegState is FfmpegState.Missing or FfmpegState.Broken)
            Fire(() => SetupFfmpegAsync(_ffmpegState == FfmpegState.Broken ? _ffmpegProblem : null), "Setting up FFmpeg");
        else if (ReplayState == ReplayUiState.Resuming)
            ResumeNow();
        else
            Fire(() => StartReplayAsync(StartKind.User), "Turning the replay buffer on");
    }

    /// <summary>Skips the remaining backoff wait and tries to resume capture right away.</summary>
    public void ResumeNow()
    {
        if (!_wantReplayOn || _lifecycleBusy || _exiting) return;
        CancelPendingRestart();
        Fire(ResumeAsync, "Resuming the replay buffer");
        RaiseChanged();
    }

    public void ShowMainWindow()
    {
        // While exit waits for a save, the existing window may still be shown (it says what is being saved).
        if (_exiting && (!_waitingForSaves || _form is not { IsDisposed: false })) return;
        try
        {
            if (_form is null || _form.IsDisposed) _form = new MainForm(this);
            _form.ShowAndActivate();
        }
        catch (Exception ex)
        {
            _log.Error("Could not show the main window", ex);
        }
    }

    /// <summary>Tray / window Exit. Pressed again while exit waits for a save, it offers to close anyway.</summary>
    public void ExitApp()
    {
        if (_exiting)
        {
            if (_waitingForSaves && !_forceExit && !_exitDialogOpen) ConfirmCloseAnyway();
            return;
        }
        if (_exitDialogOpen) return;
        if (PendingCount() > 0 && !_retryingRecordings)
        {
            _exitDialogOpen = true;
            bool exit;
            try
            {
                exit = MessageDialog.Confirm(OwnerWindow(), "A recording isn't saved yet",
                    "PC Clipper tries once more to save the recording that wasn't saved before it closes. If that still " +
                    "doesn't work, it keeps the recording in the buffer folder and saves it the next time PC Clipper starts.\n\n" +
                    "Close PC Clipper anyway?", "Close", "Cancel", warning: true);
            }
            finally
            {
                _exitDialogOpen = false;
            }
            if (!exit || _exiting) return;
        }
        Fire(() => ExitAsync(sessionEnding: false), "Closing PC Clipper");
    }

    private void ConfirmCloseAnyway()
    {
        _exitDialogOpen = true;
        try
        {
            if (MessageDialog.Confirm(OwnerWindow(), "Still saving",
                    "PC Clipper is still writing your video and closes as soon as it is done. If you close it now, that " +
                    "video is lost.\n\nClose anyway?", "Close anyway", "Keep saving", warning: true) && _waitingForSaves)
            {
                _forceExit = true;
                _log.Warn("The user chose to close while a save was still running.");
            }
        }
        finally
        {
            _exitDialogOpen = false;
        }
    }

    /// <summary>The recording banner's "Try again": saves the recordings whose save failed into the clips folder.</summary>
    public void RetryPendingRecordings()
    {
        if (_exiting) return;
        Fire(RetryPendingRecordingsAsync, "Saving the recording");
    }

    /// <summary>The "recording kept" banner's "Open folder": the session folder that holds it (else the buffer folder).</summary>
    public void OpenKeptRecordingFolder()
    {
        var dir = _keptRecordingFolder;
        bool exists;
        try { exists = dir is not null && Directory.Exists(dir); }
        catch { exists = false; }
        OpenFolder(exists ? dir! : _settings.BufferFolder);
    }

    public void DismissKeptRecordingNotice()
    {
        _keptRecordingNotice = null;
        _keptRecordingFolder = null;
        RaiseChanged();
    }

    /// <summary>
    /// Re-reads "Start with Windows" from the registry (Task Manager > Startup apps can turn it off or on while PC Clipper
    /// runs) so the Settings checkbox shows the truth. Returns true when the setting changed.
    /// </summary>
    public bool SyncStartWithWindows()
    {
        if (StartupRegistration.ReadState() is not { } actual || actual == _settings.StartWithWindows) return false;
        _log.Info($"Start with Windows was turned {(actual ? "on" : "off")} outside PC Clipper (Task Manager / Startup apps).");
        _settings.StartWithWindows = actual;
        SaveSettings();
        RaiseChanged();
        return true;
    }

    /// <summary>Shown the first time the window is closed to the tray.</summary>
    public void ShowTrayHint()
    {
        if (_trayHintShown) return;
        _trayHintShown = true;
        const string text = "PC Clipper is still running in the tray";
        if (_settings.ShowOverlay) Notify(text, ToastKind.Info);
        else _tray?.ShowBalloon("PC Clipper", text + ". Right-click its icon for options.");
    }

    public void ForgetRecent(string path)
    {
        _recent.RemoveAll(r => string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase));
        RaiseChanged();
    }

    /// <summary>Pauses global hotkeys while a hotkey box is capturing keys (so pressing Ctrl+Alt+F9 there doesn't save a clip).</summary>
    public void PauseHotkeys(bool pause)
    {
        if (_hotkeys is null || _hotkeysPaused == pause) return;
        _hotkeysPaused = pause;
        if (pause)
        {
            try { _hotkeys.Register(new Dictionary<HotkeyAction, HotkeyBinding>()); }
            catch (Exception ex) { _log.Warn($"Could not pause hotkeys: {ex.Message}"); }
        }
        else RegisterHotkeys();
    }

    // =====================================================================================================
    // Startup
    // =====================================================================================================

    private AppSettings LoadSettings()
    {
        AppSettings s;
        try { s = AppSettings.Load(DefaultPaths.SettingsFile); }
        catch (Exception ex)
        {
            _log.Error("Settings could not be loaded; using defaults", ex);
            s = new AppSettings().Normalize();
        }
        // "Start with Windows" can be changed outside PC Clipper (Task Manager > Startup apps "Disabled", a cleaner
        // deleting the entry): show the real state instead of silently turning it back on. Only the exe path is refreshed
        // (the exe may have moved); the Task Manager flag is cleared only when the user ticks the box in Settings.
        switch (StartupRegistration.ReadState())
        {
            case true:
                if (!s.StartWithWindows) _log.Info("Start with Windows is on (turned on outside PC Clipper); showing it as on.");
                s.StartWithWindows = true;
                StartupRegistration.RefreshPath();
                break;
            case false when s.StartWithWindows:
                _log.Info("Start with Windows was disabled or removed outside PC Clipper (Task Manager / Startup apps); showing it as off.");
                s.StartWithWindows = false;
                break;
        }
        return s;
    }

    private bool SaveSettings()
    {
        try
        {
            _settings.Save(DefaultPaths.SettingsFile);
            return true;
        }
        catch (Exception ex)
        {
            _log.Error("Settings could not be saved", ex);
            Notify("Your settings couldn't be saved to disk. They apply until PC Clipper closes.", ToastKind.Warning, SoundKind.Error);
            return false;
        }
    }

    private void LogStartupInfo()
    {
        try
        {
            var asm = Assembly.GetEntryAssembly() ?? typeof(AppController).Assembly;
            var version = asm.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? asm.GetName().Version?.ToString() ?? "?";
            _log.Info($"===== PC Clipper {version} starting{(_startedMinimized ? " (minimized)" : "")} =====");
            _log.Info($"OS: {RuntimeInformation.OSDescription} ({Environment.OSVersion.Version}), {RuntimeInformation.OSArchitecture}, .NET {Environment.Version}, {Environment.ProcessorCount} CPU threads");
            foreach (var m in _monitors)
                _log.Info($"Monitor: {m} | {m.DeviceName} | adapter {m.AdapterIndex} output {m.OutputIndex} | at {m.Left},{m.Top} | " +
                          $"HMONITOR 0x{m.MonitorHandle:X} | HDR {(m.IsHdr ? "on" : "off")} | GPU {m.AdapterName} (vendor 0x{m.GpuVendorId:X4})");
            var gpus = _monitors.Select(m => m.AdapterName).Where(n => !string.IsNullOrWhiteSpace(n)).Distinct().ToList();
            _log.Info("GPUs: " + (gpus.Count == 0 ? "unknown" : string.Join(", ", gpus)));
            _log.Info("Settings: " + JsonSerializer.Serialize(_settings, LogJson));
        }
        catch (Exception ex)
        {
            _log.Warn($"Startup info incomplete: {ex.Message}");
        }
    }

    private void CreateHotkeys()
    {
        try
        {
            _hotkeys = new HotkeyManager();
            _hotkeys.Pressed += OnHotkey;
        }
        catch (Exception ex)
        {
            _hotkeys = null;
            _log.Error("Global hotkeys are unavailable", ex);
        }
    }

    private void CreateTray()
    {
        try
        {
            _tray = new TrayController(this);
        }
        catch (Exception ex)
        {
            _tray = null;
            _log.Error("Tray icon is unavailable", ex);
        }
    }

    private async Task StartupAsync()
    {
        RegisterHotkeys();
        if (_hotkeyErrors.Count > 0 && _startedMinimized)
            Notify("Some hotkeys couldn't be set up. Open PC Clipper > Settings > Hotkeys.", ToastKind.Warning);
        ApplyControllerSettings();

        _ = LoadRecentFromDiskAsync();
        _ = CleanupStalePartFilesAsync();
        await CleanupStaleBufferAsync();

        // Interactive setup only when the user can see the window; at Windows start-up we just report it.
        // (Once FFmpeg works, recordings an earlier session couldn't save are recovered in the background - see
        // StartRecoveryOnce - and the buffer is turned on only after that.)
        await DiscoverFfmpegAsync(interactive: !_startedMinimized);
        if (_exiting) return;

        if (_caps is not null && _settings.StartReplayOnLaunch)
            await StartReplayAsync(StartKind.Launch);
        else if (_caps is null && _startedMinimized)
            Notify("PC Clipper needs FFmpeg before it can record. Open it from the tray to set it up.", ToastKind.Warning, SoundKind.Error);
    }

    /// <summary>
    /// Removes buffer folders left behind by a crash (the engine also does this on every start). Folders holding a
    /// recording's recovery note are skipped: <see cref="RecoverKeptRecordingsAsync"/> saves those.
    /// </summary>
    private async Task CleanupStaleBufferAsync()
    {
        // The current buffer folder, and earlier ones that may still hold a kept recording (their leftover buffers would
        // otherwise stay on that drive for good).
        foreach (var root in DistinctFolders(_startupKeptRoots.Prepend(_settings.BufferFolder)))
        {
            try
            {
                int removed = await Task.Run(() => Directory.Exists(root) ? SegmentStore.CleanupStaleSessions(root, null, _log) : 0);
                if (removed > 0) _log.Info($"Removed {removed} old buffer folder(s) from {root}.");
            }
            catch (Exception ex)
            {
                _log.Warn($"Old buffer folders in {root} could not be cleaned up: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Starts the recovery of recordings an earlier session couldn't save, once per launch, as soon as a working FFmpeg is
    /// known (at start-up, or when FFmpeg is set up later). Every start of the buffer waits for it (StartReplayAsync):
    /// it scans the buffer folder, and the live buffer must not be in there with a recording of its own meanwhile.
    /// </summary>
    private void StartRecoveryOnce()
    {
        if (_recoveryStarted || _exiting || _caps is not { } caps) return;
        _recoveryStarted = true;
        var task = RecoverKeptRecordingsAsync(caps.FfmpegPath);
        _recoveryTask = task;
        Fire(() => task, "Saving the recording kept from last time");
    }

    /// <summary>
    /// A crash, power cut, forced shutdown or a save that still failed when the buffer was turned off leaves a recording's
    /// footage in the buffer folder with a recovery note (the engine writes it from the moment a recording starts). Save
    /// each one as "Recording &lt;start&gt; (recovered).mp4" in the clips folder; report what could not be saved.
    /// </summary>
    private async Task RecoverKeptRecordingsAsync(string ffmpegPath)
    {
        // The buffer folder at start-up, and earlier buffer folders that may still hold a kept recording (the buffer folder
        // was changed while a recording waited to be saved in the old one).
        var roots = DistinctFolders(_startupKeptRoots.Prepend(_startupBufferFolder));
        List<KeptScan> scan;
        try { scan = await Task.Run(() => ScanKeptRecordings(roots)); }
        catch (Exception ex)
        {
            _log.Warn($"Looking for kept recordings failed: {ex.Message}");
            return;
        }
        int kept = scan.Sum(x => x.Notes.Count);
        if (_exiting) return;
        if (kept == 0)
        {
            ForgetEmptyKeptRoots(scan);
            return;
        }

        var folder = OutputFolder(_settings.ClipsFolder, DefaultPaths.ClipsFolder, "clips") ?? DefaultPaths.ClipsFolder;
        _log.Info($"Found {kept} recording(s) kept from an earlier session in " +
                  $"{string.Join(", ", scan.Where(x => x.Notes.Count > 0).Select(x => x.Root))}; saving them to {folder}.");
        _recoveringRecordings = true;
        RaiseChanged();
        var results = new List<SaveResult>();
        try
        {
            var guard = _processGuard;
            Func<DateTime, string> pathFor = started => Path.Combine(folder, $"Recording {started:yyyy-MM-dd HH-mm-ss} (recovered).mp4");
            foreach (var root in scan.Where(x => x.Notes.Count > 0).Select(x => x.Root))
            {
                if (_exiting) break; // the rest stays kept (and remembered) for the next start
                try { results.AddRange(await Task.Run(() => ReplayEngine.RecoverKeptRecordingsAsync(root, ffmpegPath, pathFor, _log, guard))); }
                catch (Exception ex) { _log.Error($"Recovering the kept recordings in {root} failed", ex); }
            }
        }
        catch (Exception ex)
        {
            _log.Error("Recovering the kept recordings failed", ex);
        }
        finally
        {
            _recoveringRecordings = false;
        }

        var saved = results.Where(r => r.Success && r.Path is not null).ToList();
        foreach (var r in saved) MergeRecent(RecentItem.FromFile(r.Path!, RecentKind.Recording, r.Duration));
        if (saved.Count == 1)
            Notify($"Recovered a recording from last time ({Fmt.Clock(saved[0].Duration)}). It's in your clips folder.", ToastKind.Success, SoundKind.Saved);
        else if (saved.Count > 1)
            Notify($"Recovered {saved.Count} recordings from last time. They're in your clips folder.", ToastKind.Success, SoundKind.Saved);

        // Whatever still has a recovery note couldn't be saved (the log says why): it stays kept for the next start. An
        // earlier buffer folder with nothing kept any more is forgotten.
        List<KeptScan> after;
        try { after = await Task.Run(() => ScanKeptRecordings(roots)); }
        catch { after = new List<KeptScan>(); }
        ForgetEmptyKeptRoots(after);
        var left = after.SelectMany(x => x.Notes).ToList();
        if (left.Count > 0)
        {
            var failure = results.FirstOrDefault(r => !r.Success)?.ErrorMessage;
            var reason = failure is null || failure.Contains("Details are in the log", StringComparison.OrdinalIgnoreCase)
                ? "." : $": {Fmt.Sentence(PendingReason(failure))}";
            _keptRecordingFolder = Path.GetDirectoryName(left[0]);
            _keptRecordingNotice = (left.Count == 1
                    ? $"A recording from last time couldn't be saved{reason} PC Clipper keeps it"
                    : $"{left.Count} recordings from last time couldn't be saved{reason} PC Clipper keeps them") +
                " and tries again the next time it starts (details are in the log).";
            Notify(left.Count == 1 ? "A recording from last time couldn't be saved yet. Open PC Clipper for details."
                    : $"{left.Count} recordings from last time couldn't be saved yet. Open PC Clipper for details.",
                ToastKind.Warning, SoundKind.Error);
        }
        RaiseChanged();
    }

    /// <summary>What one buffer folder holds: its kept recordings' notes; Forget = nothing is kept there for sure.</summary>
    private sealed record KeptScan(string Root, List<string> Notes, bool Forget);

    /// <summary>
    /// Looks for kept recordings in each folder. Any thread. A folder that can't be looked into, or whose drive isn't there
    /// (an unplugged external drive, an offline network share), is not "empty": it stays remembered.
    /// </summary>
    private List<KeptScan> ScanKeptRecordings(IEnumerable<string> roots)
    {
        var list = new List<KeptScan>();
        foreach (var root in roots)
        {
            try
            {
                var notes = FindKeptRecordingNotes(root);
                bool reachable = Directory.Exists(root) ||
                                 (Path.GetPathRoot(Path.GetFullPath(root)) is { Length: > 0 } drive && Directory.Exists(drive));
                list.Add(new KeptScan(root, notes, notes.Count == 0 && reachable));
            }
            catch (Exception ex)
            {
                _log.Warn($"Looking for kept recordings in {root} failed: {ex.Message}");
                list.Add(new KeptScan(root, new List<string>(), false));
            }
        }
        return list;
    }

    /// <summary>Drops remembered buffer folders that hold no kept recording any more (and saves the settings). UI thread.</summary>
    private void ForgetEmptyKeptRoots(IEnumerable<KeptScan> scan)
    {
        var list = _settings.KeptRecordingRoots;
        if (list is null || list.Count == 0) return;
        var forgotten = new List<string>();
        foreach (var x in scan.Where(x => x.Forget))
            if (list.RemoveAll(r => SameFolder(r, x.Root)) > 0) forgotten.Add(x.Root);
        if (forgotten.Count == 0) return;
        _log.Info($"No kept recordings are left in {string.Join(", ", forgotten)}; no longer checking there at start-up.");
        SaveSettings();
    }

    /// <summary>
    /// Remembers a buffer folder that may still hold a recording PC Clipper kept (settings KeptRecordingRoots), so the next
    /// start recovers it there even after the buffer folder was changed. True when it was added. UI thread.
    /// </summary>
    private bool AddKeptRecordingRoot(string? root)
    {
        if (string.IsNullOrWhiteSpace(root)) return false;
        var full = FullFolder(root);
        _settings.KeptRecordingRoots ??= new List<string>();
        if (_settings.KeptRecordingRoots.Any(r => SameFolder(r, full))) return false;
        _settings.KeptRecordingRoots.Add(full);
        _log.Info($"Remembering {full}: it may hold a kept recording, which the next start saves.");
        return true;
    }

    /// <summary>Remembers a buffer folder the user moved away from when it still holds a kept recording. UI thread.</summary>
    private async Task RememberBufferFolderIfKeptAsync(string root)
    {
        bool kept;
        try { kept = await Task.Run(() => FindKeptRecordingNotes(root).Count > 0); }
        catch { kept = true; } // can't tell: remembering it costs one look at the next start
        if (kept) RememberKeptRecordingRoot(root);
    }

    /// <summary><see cref="AddKeptRecordingRoot"/>, and save the settings right away.</summary>
    private void RememberKeptRecordingRoot(string? root)
    {
        if (!AddKeptRecordingRoot(root)) return;
        if (_exiting) SaveSettingsQuietly();
        else SaveSettings();
    }

    /// <summary>A folder as a full path without a trailing separator (as given if it isn't a valid path).</summary>
    private static string FullFolder(string path)
    {
        try { return Path.TrimEndingDirectorySeparator(Path.GetFullPath(path.Trim())); }
        catch { return path.Trim(); }
    }

    /// <summary>The same folder (Windows paths: case doesn't matter).</summary>
    private static bool SameFolder(string? a, string? b) =>
        a is not null && b is not null && string.Equals(FullFolder(a), FullFolder(b), StringComparison.OrdinalIgnoreCase);

    private static List<string> DistinctFolders(IEnumerable<string?> folders)
    {
        var list = new List<string>();
        foreach (var f in folders)
            if (!string.IsNullOrWhiteSpace(f) && !list.Any(x => SameFolder(x, f))) list.Add(f);
        return list;
    }

    /// <summary>
    /// The engine's own rule for continuing a buffer (ReplayEngine.StartAsync): only in the same buffer folder, compared as
    /// full paths, ordinal. A start in any other folder tears the old buffer down.
    /// </summary>
    private static bool BufferRootChanged(string previousRoot, string nextRoot)
    {
        try { return !string.Equals(Path.GetFullPath(previousRoot), Path.GetFullPath(nextRoot), StringComparison.Ordinal); }
        catch { return true; }
    }

    /// <summary>
    /// The replay stopped on a fault and still holds saveable footage, which a start in <paramref name="nextFolder"/> would
    /// discard (another buffer folder): how much, else null.
    /// </summary>
    private TimeSpan? SaveableBufferLostByFolder(string nextFolder)
    {
        try
        {
            if (_engine.State != EngineState.Faulted || _engine.ActiveConfig is not { } previous) return null;
            var buffered = SafeBuffered();
            if (buffered <= TimeSpan.Zero || !BufferRootChanged(previous.BufferRoot, nextFolder)) return null;
            return buffered;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>The recovery notes of recordings kept in the buffer folder's session folders. Any thread.</summary>
    private static List<string> FindKeptRecordingNotes(string bufferRoot)
    {
        var notes = new List<string>();
        if (!Directory.Exists(bufferRoot)) return notes;
        foreach (var dir in Directory.EnumerateDirectories(bufferRoot, "session_*"))
        {
            try { notes.AddRange(Directory.EnumerateFiles(dir, "*" + SegmentStore.KeepMarkerSuffix)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { /* gone or locked: skip */ }
        }
        return notes;
    }

    /// <summary>
    /// Deletes half-written "Clip ....mp4.part" / "Recording ....mp4.part" files that a killed save left in the clips folder
    /// (e.g. after a forced shutdown). Only PC Clipper's own names, and only files untouched for an hour.
    /// </summary>
    private async Task CleanupStalePartFilesAsync()
    {
        var folders = new[] { _settings.ClipsFolder, DefaultPaths.ClipsFolder }.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        try
        {
            int removed = await Task.Run(() =>
            {
                int n = 0;
                var cutoff = DateTime.UtcNow - TimeSpan.FromHours(1);
                foreach (var folder in folders)
                {
                    if (!Directory.Exists(folder)) continue;
                    foreach (var file in Directory.EnumerateFiles(folder, "*.mp4.part"))
                    {
                        var name = Path.GetFileName(file);
                        if (!name.StartsWith("Clip ", StringComparison.OrdinalIgnoreCase) &&
                            !name.StartsWith("Recording ", StringComparison.OrdinalIgnoreCase)) continue;
                        try
                        {
                            if (File.GetLastWriteTimeUtc(file) > cutoff) continue;
                            File.Delete(file);
                            n++;
                        }
                        catch (Exception) { /* in use or protected: leave it */ }
                    }
                }
                return n;
            });
            if (removed > 0) _log.Info($"Removed {removed} unfinished save file(s) (.mp4.part) left by an earlier session.");
        }
        catch (Exception ex)
        {
            _log.Warn($"Unfinished save files could not be cleaned up: {ex.Message}");
        }
    }

    private async Task LoadRecentFromDiskAsync()
    {
        string clips = _settings.ClipsFolder, shots = _settings.ScreenshotsFolder;
        try
        {
            var found = await Task.Run(() => RecentFiles.Scan(clips, shots, RecentLimit));
            foreach (var item in found) MergeRecent(item);
            RaiseChanged();
        }
        catch (Exception ex)
        {
            _log.Warn($"Could not list existing clips: {ex.Message}");
        }
    }

    private void MergeRecent(RecentItem item)
    {
        _recent.RemoveAll(r => string.Equals(r.Path, item.Path, StringComparison.OrdinalIgnoreCase));
        _recent.Add(item);
        _recent.Sort((a, b) => b.When.CompareTo(a.When));
        if (_recent.Count > RecentLimit) _recent.RemoveRange(RecentLimit, _recent.Count - RecentLimit);
    }

    // =====================================================================================================
    // FFmpeg discovery / setup
    // =====================================================================================================

    private async Task DiscoverFfmpegAsync(bool interactive)
    {
        SetFfmpegState(FfmpegState.Checking, null);
        var settings = _settings;
        string? path = null;
        try { path = await Task.Run(() => FfmpegLocator.Find(settings)); }
        catch (Exception ex) { _log.Error("Looking for FFmpeg failed", ex); }

        if (path is null)
        {
            _log.Warn("FFmpeg not found.");
            SetFfmpegState(FfmpegState.Missing, null);
            if (interactive) await SetupFfmpegAsync(null);
            return;
        }

        var (ok, why) = await ProbeAndAdoptAsync(path, remember: false);
        if (ok) return;
        if (interactive) await SetupFfmpegAsync(why);
        else SetFfmpegState(FfmpegState.Broken, why);
    }

    /// <summary>
    /// Shows the "download / browse" dialog until the user has a working ffmpeg or cancels.
    /// Returns true when a working ffmpeg is in place afterwards. Only call it from something the user clicked
    /// (never from a hotkey: the dialog would take focus from the game).
    /// </summary>
    public async Task<bool> SetupFfmpegAsync(string? reason)
    {
        if (_ffmpegDialogOpen || _exiting) return _caps is not null;
        for (int attempt = 0; attempt < 5; attempt++)
        {
            string? path;
            _ffmpegDialogOpen = true;
            try
            {
                using var dlg = new FfmpegSetupDialog(_log, reason);
                var owner = OwnerWindow();
                if (owner is null)
                {
                    dlg.StartPosition = FormStartPosition.CenterScreen;
                    dlg.ShowInTaskbar = true;
                }
                path = dlg.ShowDialog(owner) == DialogResult.OK ? dlg.FfmpegPath : null;
            }
            catch (Exception ex)
            {
                _log.Error("FFmpeg setup dialog failed", ex);
                path = null;
            }
            finally
            {
                _ffmpegDialogOpen = false;
            }

            if (path is null)
            {
                if (_caps is null) SetFfmpegState(reason is null ? FfmpegState.Missing : FfmpegState.Broken, reason);
                else RaiseChanged();
                return _caps is not null;
            }

            var (ok, why) = await ProbeAndAdoptAsync(path, remember: true);
            if (ok)
            {
                Notify("FFmpeg is ready. PC Clipper can record now.", ToastKind.Success);
                return true;
            }
            reason = why;
        }
        return _caps is not null;
    }

    /// <summary>Settings > "Browse..." for ffmpeg.exe.</summary>
    public async Task<bool> UseFfmpegFileAsync(string path)
    {
        var (ok, why) = await ProbeAndAdoptAsync(path, remember: true);
        if (ok) Notify("FFmpeg is ready.", ToastKind.Success);
        else if (why is not null)
        {
            if (MessageDialog.Confirm(OwnerWindow(), "That FFmpeg can't be used", why, "Download FFmpeg", "Not now", warning: true))
                await SetupFfmpegAsync(why);
        }
        return ok;
    }

    /// <summary>Text for an ffmpeg build without ddagrab + scale_d3d11 (FfmpegCapabilities.IsSupported).</summary>
    private static string TooOldText(FfmpegCapabilities caps)
    {
        var version = string.IsNullOrWhiteSpace(caps.VersionLine) ? "" : $" (found: {Fmt.Truncate(caps.VersionLine, 70)})";
        return $"This FFmpeg is too old (PC Clipper needs 8.1 or newer){version}. Download the recommended version (about 100 MB) to start recording.";
    }

    /// <summary>Probes <paramref name="path"/>; on success it becomes the active ffmpeg. Keeps the previous one on failure.</summary>
    private async Task<(bool Ok, string? Why)> ProbeAndAdoptAsync(string path, bool remember)
    {
        var previous = _caps;
        var previousState = _ffmpegState;
        var previousProblem = _ffmpegProblem;
        SetFfmpegState(FfmpegState.Checking, null);
        _log.Info($"Checking FFmpeg at {path}");

        FfmpegCapabilities? caps = null;
        string? why = null;
        try
        {
            // Probing runs several ffmpeg processes; keep even their start-up off the UI thread.
            caps = await Task.Run(() => FfmpegProbe.ProbeAsync(path, _log));
            _ffmpegCandidatePath = path;
            _ffmpegCandidateVersion = caps.VersionLine;
            if (!caps.IsSupported)
            {
                _log.Warn($"FFmpeg at {path} is not supported (ddagrab={caps.HasDdagrab}, scale_d3d11={caps.HasScaleD3D11}): {caps.VersionLine}");
                why = TooOldText(caps);
                caps = null;
            }
        }
        catch (Exception ex)
        {
            _log.Error($"FFmpeg at {path} failed the check", ex);
            _ffmpegCandidatePath = path;
            _ffmpegCandidateVersion = null;
            why = $"The FFmpeg at {path} didn't run on this PC ({Fmt.FirstParagraph(ex.Message)}). Download a fresh copy (about 100 MB) to start recording.";
        }

        if (caps is null)
        {
            if (previous is not null)
            {
                _caps = previous;
                SetFfmpegState(previousState == FfmpegState.Checking ? FfmpegState.Ready : previousState, previousProblem);
            }
            else SetFfmpegState(FfmpegState.Broken, why);
            return (false, why);
        }

        _caps = caps;
        _log.Info($"FFmpeg ready: {caps.FfmpegPath} | {caps.VersionLine} | gfxcapture={caps.HasGfxCapture} | " +
                  $"working encoders: {string.Join(", ", caps.WorkingEncoders.OrderBy(x => x))}");
        if (remember && !string.Equals(_settings.FfmpegPath, path, StringComparison.OrdinalIgnoreCase))
        {
            _settings.FfmpegPath = path;
            SaveSettings();
        }
        SetFfmpegState(FfmpegState.Ready, null);
        StartRecoveryOnce();
        return (true, null);
    }

    private void SetFfmpegState(FfmpegState state, string? problem)
    {
        _ffmpegState = state;
        _ffmpegProblem = problem;
        RaiseChanged();
    }

    // =====================================================================================================
    // Replay buffer lifecycle
    // =====================================================================================================

    /// <summary>Starts (or, for <see cref="StartKind.Resume"/>, continues) the buffer. Returns true when it is running.</summary>
    private async Task<bool> StartReplayAsync(StartKind kind)
    {
        if (_exiting) return false;
        if (_engine.State is EngineState.Running) return true;
        if (_lifecycleBusy || _engine.State is EngineState.Starting or EngineState.Stopping) return false;
        if (_benchmarkRunning)
        {
            Notify("Wait a moment: the PC test is still running.", ToastKind.Info);
            return false;
        }
        if (kind != StartKind.Resume)
        {
            // A new "on" period: forget earlier interruptions.
            CancelPendingRestart();
            ResetSupervision();
            _ranSinceOn = false;
        }

        if (_caps is null)
        {
            if (_ffmpegState == FfmpegState.Checking)
            {
                Notify("Still checking your graphics card. Try again in a few seconds.", ToastKind.Info);
                return false;
            }
            if (kind == StartKind.Hotkey)
            {
                Notify("PC Clipper needs FFmpeg before it can record. Open PC Clipper to set it up.", ToastKind.Warning, SoundKind.Error);
                return false;
            }
            if (kind != StartKind.User) return false;
            if (!await SetupFfmpegAsync(_ffmpegState == FfmpegState.Broken ? _ffmpegProblem : null)) return false;
            if (_engine.State is EngineState.Running) return true;
            if (_lifecycleBusy) return false;
        }

        // Recordings an earlier session couldn't save are recovered first (it scans the buffer folder, where the new
        // buffer would otherwise write a recording of its own). Turn OFF meanwhile cancels this start.
        if (!_recoveryTask.IsCompleted)
        {
            if (kind is StartKind.User or StartKind.Hotkey)
                Notify("PC Clipper is saving a recording from last time first. The replay turns on right after.", ToastKind.Info);
            _startWaitingForRecovery = true;
            _wantReplayOn = true;
            RaiseChanged();
            try { await AwaitQuietly(_recoveryTask); }
            finally
            {
                _startWaitingForRecovery = false;
                RaiseChanged();
            }
            if (_exiting || !_wantReplayOn) return false;
            if (_engine.State is EngineState.Running) return true;
            if (_lifecycleBusy || _engine.State is EngineState.Starting or EngineState.Stopping) return false;
        }
        var caps = _caps;
        if (caps is null) return false;

        // After a fault, a start the user asked for continues the buffer only if its format stays the same: settings the
        // user changed meanwhile (or a new screen mode) are used as they are now, so the earlier footage can't be joined
        // to the new run any more; in another buffer folder the old buffer is deleted. Ask before that makes what is still
        // saveable unsaveable (from a hotkey or controller there is no window to ask in: refuse with a notice instead).
        if ((kind is StartKind.User or StartKind.Hotkey) && !ConfirmNewBufferFormat(caps, kind)) return false;
        if (_lifecycleBusy || _exiting || _engine.State is EngineState.Running or EngineState.Starting or EngineState.Stopping)
            return _engine.State is EngineState.Running;

        _lifecycleBusy = true;
        _wantReplayOn = true;
        if (kind != StartKind.Resume) _replayProblem = null;
        RaiseChanged();
        string? error = null;
        bool retryable = false;
        CaptureConfig? cfg = null;
        // A resume continues the interrupted buffer: the engine keeps its output format (size, fps, encoder) and scales
        // the new picture into it, so a fullscreen game's mode switch doesn't make the earlier footage un-joinable.
        var interrupted = kind == StartKind.Resume ? _engine.ActiveConfig : null;
        try
        {
            // Monitors can change (resolution switch, new screen, HDR toggle): look again before every start.
            try { _monitors = await Task.Run(() => Monitors.Enumerate(_log)); }
            catch (Exception ex) { _log.Warn($"Monitor refresh failed: {ex.Message}"); }

            if (!TryEnsureFolder(_settings.BufferFolder, out var folderError))
            {
                error = $"PC Clipper can't use the buffer folder {_settings.BufferFolder} ({folderError}). Pick another folder in Settings > Replay.";
            }
            else
            {
                cfg = BuildConfig(caps, _settings);
                // A supervised resume continues the buffer AND keeps its format (ResumeAsync): never a fresh buffer just
                // because a game changed the display mode - that is exactly what resuming is for.
                // A start the user asked for after a fault continues the buffer too, but with the settings as they are now
                // (StartAsync re-checks free space when that is a new format): following "lower the resolution" or "pick
                // another encoder" must take effect. Anything else starts a fresh buffer.
                bool resume = kind == StartKind.Resume;
                bool keepBuffer = resume || (kind != StartKind.Restart && _engine.State == EngineState.Faulted);
                var startCfg = cfg;
                try
                {
                    // StartAsync does disk work and launches ffmpeg before its first await: keep it off the UI thread.
                    await Task.Run(() => resume ? _engine.ResumeAsync(startCfg) : _engine.StartAsync(startCfg, keepBuffer));
                }
                catch (Exception ex)
                {
                    error = Fmt.FirstParagraph(ex.Message);
                    retryable = _engine.LastFaultRetryable;
                    _log.Error($"Replay start failed ({kind}, {(retryable ? "retryable" : "not retryable")}): {ex.Message}",
                        ex is InvalidOperationException ? null : ex);
                }
            }
        }
        catch (Exception ex)
        {
            error = $"Could not start the replay buffer: {Fmt.FirstParagraph(ex.Message)}";
            _log.Error("Replay start failed", ex);
        }
        finally
        {
            _lifecycleBusy = false;
        }

        try
        {
            if (error is null)
            {
                // (If the user pressed Turn OFF meanwhile, StopReplayAsync is waiting for this start and stops it next.
                // If the new run already died, the Problem handler has scheduled the next attempt: leave that alone.)
                if (_engine.State == EngineState.Running)
                {
                    if (_resuming) _log.Info($"Replay resumed ({cfg?.Method}).");
                    _resuming = false;
                    _ranSinceOn = true;
                    _replayProblem = null;
                    if (interrupted is not null && cfg is not null) CheckResumedFormat(interrupted, cfg);
                }
                string onText = ReplayOnText();
                if (kind == StartKind.Hotkey) Notify(onText, ToastKind.Info, SoundKind.RecordStart);
                else if (kind == StartKind.Launch && (_form is null || !_form.Visible)) Notify(onText, ToastKind.Info);
                return true;
            }

            int attempts = _failStreak + 1;
            bool neverRan = !_ranSinceOn && attempts >= MaxStartsBeforeFirstRun;
            if (kind is StartKind.Resume or StartKind.Launch && retryable && _wantReplayOn && !_exiting && !neverRan)
            {
                // Capture can't start right now (secure desktop, mode switch...): keep trying quietly.
                _resuming = true;
                RegisterFailure(error, TimeSpan.Zero);
                ScheduleRestart();
                return false;
            }

            bool wanted = _wantReplayOn;
            _wantReplayOn = false;
            _resuming = false;
            CancelPendingRestart();
            ResetSupervision();
            if (!wanted || _exiting) return false; // the user turned it off (or is closing) meanwhile
            bool stoppedAfterRunning = kind == StartKind.Resume && _ranSinceOn;
            if (kind == StartKind.Resume) _log.Warn($"Giving up after {attempts} failed start(s) in a row.");
            _replayProblem = stoppedAfterRunning
                ? $"Replay stopped and couldn't resume: {Fmt.Sentence(error)}"
                : $"Replay couldn't start: {Fmt.Sentence(error)}";
            Notify((stoppedAfterRunning ? "Replay stopped: " : "Replay couldn't start: ") + Fmt.Truncate(error, 140), ToastKind.Warning, SoundKind.Error);
            // A recording that was carried across the interruption can't continue: save what it has.
            if (_engine.IsRecording) _ = FinishRecordingAsync();
            return false;
        }
        finally
        {
            RaiseChanged();
        }
    }

    /// <summary>
    /// A user (or hotkey) start after a fault whose buffer still holds saveable footage, when the capture format would
    /// change (the user changed capture settings, or the screen mode changed) or the buffer folder did: the new run can't
    /// be joined to that footage (in another folder the engine deletes it), so ask first. From a hotkey or controller
    /// there is no window to ask in: refuse with a notice. True to go ahead (also when nothing would be lost).
    /// </summary>
    private bool ConfirmNewBufferFormat(FfmpegCapabilities caps, StartKind kind)
    {
        try
        {
            if (_engine.State != EngineState.Faulted || _engine.ActiveConfig is not { } previous) return true;
            var buffered = SafeBuffered();
            if (buffered <= TimeSpan.Zero) return true;
            var next = BuildConfig(caps, _settings);
            // Exactly the engine's rule (StartAsync tears the old buffer down when its folder differs).
            bool rootChanged = BufferRootChanged(previous.BufferRoot, next.BufferRoot);
            if (next.Signature == previous.Signature && !rootChanged) return true;
            _log.Info(rootChanged
                ? $"Starting after a fault in another buffer folder ({previous.BufferRoot} -> {next.BufferRoot}); {(kind == StartKind.Hotkey ? "not from a hotkey" : "asking first")}."
                : $"Starting after a fault with a new format ({previous.Signature} -> {next.Signature}); {(kind == StartKind.Hotkey ? "not from a hotkey" : "asking first")}.");
            if (kind == StartKind.Hotkey)
            {
                Notify("Open PC Clipper to turn the replay on - the buffer from before can still be saved.", ToastKind.Warning, SoundKind.Error);
                return false;
            }
            var why = rootChanged
                ? "You changed the buffer folder since then, so turning the replay on starts a new buffer there"
                : "Your capture settings or the screen changed since then, so turning the replay on starts a new buffer";
            return MessageDialog.Confirm(OwnerWindow(), "Start a new replay buffer?",
                $"The replay buffer still holds {Fmt.MinSec(buffered)} from before it stopped, which you can save now. " +
                $"{why} and that footage can't be saved after that.\n\nTurn the replay on anyway?", "Turn on", "Cancel", warning: true);
        }
        catch (Exception ex)
        {
            _log.Warn($"Checking the buffer format failed: {ex.Message}");
            return true;
        }
    }

    /// <summary>
    /// Resolves the settings for this PC on the monitor as it is now (fresh MonitorInfo/HMONITOR after a mode switch).
    /// The capture method is exactly what the user picked: Auto is Desktop Duplication, and there is no automatic switch
    /// to Windows Graphics Capture (it pauses on still screens and draws a yellow border on Windows 10).
    /// </summary>
    private CaptureConfig BuildConfig(FfmpegCapabilities caps, AppSettings settings) =>
        QualityMath.Resolve(settings, PickMonitor(settings.MonitorDeviceName), caps);

    /// <summary>"Replay on - Ctrl+Alt+F9 saves the last 15 min", naming the save hotkey only when it is set and works.</summary>
    private string ReplayOnText()
    {
        var key = _settings.SaveReplayHotkey;
        if (_hotkeys is not null && key is { IsAssigned: true } && !_hotkeyErrors.ContainsKey(HotkeyAction.SaveReplay))
            return $"Replay on - {HotkeyText.Describe(key)} saves the last " +
                   QualityMath.FormatSaveLength(Math.Min(_settings.HotkeySaveSeconds, BufferSeconds));
        return _tray is not null ? "Replay on - save clips from the tray icon's menu" : "Replay on";
    }

    /// <summary>
    /// After a resume: the engine continues the buffer in its old format (scaling the new picture into it). Log a display
    /// change; and should the format ever have changed anyway, say that the earlier footage could not be kept.
    /// </summary>
    private void CheckResumedFormat(CaptureConfig before, CaptureConfig requested)
    {
        try
        {
            var now = _engine.ActiveConfig;
            if (now is null) return;
            if (now.Signature != before.Signature)
            {
                _log.Warn($"The resumed capture has a different format ({before.Signature} -> {now.Signature}); earlier footage can't be joined.");
                Notify("Your display changed, so the replay buffer had to start over. Footage from before the change couldn't be kept.",
                    ToastKind.Warning);
            }
            else if (requested.Monitor.Width != before.Monitor.Width || requested.Monitor.Height != before.Monitor.Height ||
                     requested.Monitor.RefreshHz != before.Monitor.RefreshHz)
            {
                _log.Info($"Display changed ({before.Monitor.Width}x{before.Monitor.Height} @ {before.Monitor.RefreshHz} Hz -> " +
                          $"{requested.Monitor.Width}x{requested.Monitor.Height} @ {requested.Monitor.RefreshHz} Hz); the replay continues " +
                          $"in its {now.Width}x{now.Height} {now.Fps} fps format, earlier footage kept.");
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"Checking the resumed format failed: {ex.Message}");
        }
    }

    /// <summary>Stops the buffer (which clears it), saving a running recording first.</summary>
    private async Task StopReplayAsync(bool announce)
    {
        bool wasOn = _wantReplayOn || _engine.State is EngineState.Running or EngineState.Starting;
        _wantReplayOn = false;
        _resuming = false;
        CancelPendingRestart();
        ResetSupervision();
        _replayProblem = null;
        RaiseChanged();
        // A start in progress can't be interrupted; let it finish, then stop.
        for (int i = 0; i < 400 && _lifecycleBusy; i++) await Task.Delay(100);
        if (_lifecycleBusy || _wantReplayOn) return; // someone turned it back on meanwhile
        _lifecycleBusy = true;
        RaiseChanged();
        try
        {
            if (_engine.IsRecording) await FinishRecordingAsync();
            await AwaitQuietly(_recordingSaveTask);
            // A recording whose save failed lives in this buffer: try it once more here (named after its start time, with
            // a toast and a Recent entry). If it still fails, StopAsync keeps it in the buffer folder (with its recovery
            // note) and the next start of PC Clipper saves it.
            if (PendingCount() > 0) await RetryPendingRecordingsAsync();
            // Clips still being written read from the buffer that StopAsync deletes: let them finish first (no time limit;
            // each save has its own size-based timeout in the engine). Home shows "Saving your clip, then turning off...".
            await WaitForSavesAsync();
            await Task.Run(() => _engine.StopAsync());
            if (announce && wasOn) Notify("Replay off", ToastKind.Info, SoundKind.RecordStop);
        }
        catch (Exception ex)
        {
            _log.Error("Stopping the replay buffer failed", ex);
        }
        finally
        {
            _lifecycleBusy = false;
            RaiseChanged();
        }
    }

    /// <summary>Applying changed capture settings: StopAsync + StartAsync, i.e. a fresh buffer.</summary>
    private async Task RestartReplayAsync()
    {
        await StopReplayAsync(announce: false);
        await StartReplayAsync(StartKind.Restart);
    }

    private void OnEngineStateChanged(EngineState state)
    {
        _log.Info($"Engine state: {state}");
        if (state != EngineState.Running) _stats = null;
        RaiseChanged();
    }

    // =====================================================================================================
    // Supervision (SPEC "Engine supervision")
    // =====================================================================================================

    /// <summary>Engine thread: capture the run's facts now (they change once a restart begins), then go to the UI thread.</summary>
    private void OnEngineProblemRaised(string message)
    {
        TimeSpan uptime = TimeSpan.Zero;
        bool retryable = false;
        bool isFault = true;
        try
        {
            uptime = _engine.CurrentRunUptime;
            retryable = _engine.LastFaultRetryable;
            // A capture fault always arrives with State = Faulted and LastError = this very message. The engine also uses
            // Problem for notices while capture keeps running or is being torn down ("the drive is almost full, so the
            // recording was stopped and saved", "a recording couldn't be saved. PC Clipper kept it and will try again
            // next time it starts"): those must not stop or restart the replay.
            isFault = _engine.State == EngineState.Faulted && string.Equals(_engine.LastError, message, StringComparison.Ordinal);
        }
        catch
        {
            // Treat as a quick, final failure.
        }
        if (isFault) Post(() => OnEngineProblem(message, uptime, retryable));
        else Post(() => OnEngineNotice(message));
    }

    /// <summary>A plain-language engine message that is not a capture fault.</summary>
    private void OnEngineNotice(string message)
    {
        _log.Info("Engine notice: " + message);
        // "A recording couldn't be saved. PC Clipper kept it and will try again next time it starts (<session folder>)."
        // (buffer turned off or restarted with a recording that still can't be saved): the banner keeps saying so, with
        // Open folder. The next launch saves it (RecoverKeptRecordingsAsync).
        const string keptMarker = "will try again next time it starts";
        int kept = message.IndexOf(keptMarker, StringComparison.OrdinalIgnoreCase);
        if (kept >= 0)
        {
            var text = message[..(kept + keptMarker.Length)].Trim();
            var rest = message[(kept + keptMarker.Length)..].Trim();
            int close = rest.LastIndexOf(')');
            if (rest.StartsWith('(') && close > 1)
            {
                _keptRecordingFolder = rest[1..close].Trim();
                // The session folder sits in the buffer folder that was in use then, which may not be the one the next
                // start finds in the settings (the user may change it, as the "pick another drive" advice suggests):
                // remember it, so the next start recovers the recording there (also while closing).
                try { RememberKeptRecordingRoot(Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(_keptRecordingFolder))); }
                catch (Exception ex) { _log.Warn($"Couldn't remember where the kept recording is: {ex.Message}"); }
            }
            _keptRecordingNotice = Fmt.Sentence(text);
            message = _keptRecordingNotice;
        }
        if (_exiting) return; // (logged by the engine with the folder; the next start reports and recovers it)
        Notify(Fmt.Truncate(Fmt.FirstParagraph(message), 160), ToastKind.Warning, SoundKind.Error);
        RaiseChanged();
    }

    /// <summary>The engine faulted while running.</summary>
    private void OnEngineProblem(string message, TimeSpan uptime, bool retryable)
    {
        if (_exiting) return;
        var reason = Fmt.FirstParagraph(message);
        _log.Warn($"Replay problem after {uptime.TotalSeconds:0.#} s ({(retryable ? "retryable" : "not retryable")}): {message}");
        if (!_wantReplayOn)
        {
            RaiseChanged();
            return;
        }

        if (retryable)
        {
            // Quiet: UAC prompts and fullscreen switches cause these all the time. The buffer (and a running
            // recording) is kept and continues when capture resumes.
            _resuming = true;
            _replayProblem = null;
            RegisterFailure(reason, uptime);
            ScheduleRestart();
        }
        else
        {
            _wantReplayOn = false;
            _resuming = false;
            CancelPendingRestart();
            ResetSupervision();
            _replayProblem = $"Replay stopped: {Fmt.Sentence(reason)}";
            Notify("Replay stopped: " + Fmt.Truncate(reason, 140), ToastKind.Warning, SoundKind.Error);
            // Capture won't continue, so wrap the recording up now with what it has.
            if (_engine.IsRecording) _ = FinishRecordingAsync();
        }
        RaiseChanged();
    }

    /// <summary>
    /// Counts a failed run or start for the backoff. (There is deliberately no automatic switch to Windows Graphics
    /// Capture: it would pause the buffer on still screens and draw a yellow border on Windows 10 for the rest of the
    /// session. The method is always the one the user picked; Auto = Desktop Duplication.)
    /// </summary>
    private void RegisterFailure(string reason, TimeSpan uptime)
    {
        if (uptime >= HealthyRun)
        {
            _failStreak = 0;
            _streakStartedMs = null;
            _persistentNoticeShown = false;
        }
        _failStreak++;
        _streakStartedMs ??= Environment.TickCount64;
        _interruptReason = reason;
    }

    /// <summary>1 s, 2 s, 4 s ... capped at 30 s; starts again at 1 s after a healthy run.</summary>
    private TimeSpan BackoffDelay()
    {
        int exponent = Math.Clamp(_failStreak - 1, 0, 5);
        return TimeSpan.FromSeconds(Math.Min(MaxBackoffSeconds, 1 << exponent));
    }

    private void ScheduleRestart()
    {
        var delay = BackoffDelay();
        _restartCts?.Cancel();
        var cts = new CancellationTokenSource();
        _restartCts = cts;
        _restartAtMs = Environment.TickCount64 + (long)delay.TotalMilliseconds;
        _log.Info($"Resuming capture in {delay.TotalSeconds:0} s (attempt {_failStreak}).");
        Fire(async () =>
        {
            try { await Task.Delay(delay, cts.Token); }
            catch (OperationCanceledException) { return; }
            if (!ReferenceEquals(_restartCts, cts)) return;
            _restartCts = null;
            _restartAtMs = null;
            await ResumeAsync();
        }, "Resuming the replay buffer");
        RaiseChanged();
    }

    private async Task ResumeAsync()
    {
        // Another lifecycle step (e.g. the user changing settings) finishes first.
        for (int i = 0; i < 400 && _lifecycleBusy; i++) await Task.Delay(100);
        if (_exiting || !_wantReplayOn) return;
        if (_engine.State == EngineState.Running)
        {
            _resuming = false;
            RaiseChanged();
            return;
        }
        if (_lifecycleBusy || _engine.State is EngineState.Starting or EngineState.Stopping)
        {
            ScheduleRestart(); // still busy: look again after the current backoff instead of giving up
            return;
        }
        RaiseChanged();
        await StartReplayAsync(StartKind.Resume);
    }

    private void CancelPendingRestart()
    {
        _restartCts?.Cancel();
        _restartCts = null;
        _restartAtMs = null;
    }

    private void ResetSupervision()
    {
        _failStreak = 0;
        _streakStartedMs = null;
        _persistentNoticeShown = false;
        _interruptReason = null;
    }

    /// <summary>Every second: notices a healthy run again, and tells the user once if resuming keeps failing.</summary>
    private void SuperviseTick()
    {
        if (_engine.State == EngineState.Running && _failStreak > 0 && _engine.CurrentRunUptime >= HealthyRun)
        {
            _log.Info($"Capture is healthy again after {_failStreak} interruption(s).");
            if (_persistentNoticeShown) Notify("Replay is back on", ToastKind.Success);
            _failStreak = 0;
            _streakStartedMs = null;
            _persistentNoticeShown = false;
            _interruptReason = null;
            RaiseChanged();
        }
        if (_wantReplayOn && _resuming && !_persistentNoticeShown && _streakStartedMs is { } since &&
            Environment.TickCount64 - since >= (long)PersistentProblemNotice.TotalMilliseconds)
        {
            _persistentNoticeShown = true;
            Notify($"Replay keeps getting interrupted: {Fmt.Truncate(Fmt.Sentence(_interruptReason ?? "the screen capture stopped"), 120)} PC Clipper keeps trying.",
                ToastKind.Warning);
            RaiseChanged();
        }
    }

    // =====================================================================================================
    // Engine callbacks
    // =====================================================================================================

    private IReadOnlyList<IAudioSource> CreateAudioSources(CaptureConfig cfg)
    {
        // Runs on an engine thread.
        var list = new List<IAudioSource>();
        var live = new List<(bool, IAudioSource)>();
        if (cfg.DesktopAudio)
        {
            try
            {
                var s = WasapiAudioSource.Desktop(_log, cfg.DesktopVolume);
                list.Add(s);
                live.Add((false, s));
            }
            catch (Exception ex)
            {
                _log.Error("PC sound capture unavailable", ex);
                Post(() => Notify("PC sound can't be recorded right now (no speakers or headset found?). The video still records.", ToastKind.Warning));
            }
        }
        if (cfg.Microphone)
        {
            try
            {
                var s = WasapiAudioSource.Microphone(cfg.MicrophoneDeviceId, _log, cfg.MicrophoneVolume);
                list.Add(s);
                live.Add((true, s));
            }
            catch (Exception ex)
            {
                _log.Error("Microphone capture unavailable", ex);
                Post(() => Notify("Your microphone isn't available, so it isn't being recorded. Pick another one in Settings > Audio.", ToastKind.Warning));
            }
        }
        lock (_sourcesGate) _liveSources = live;
        return list;
    }

    private void ApplyLiveVolumes()
    {
        List<(bool IsMic, IAudioSource Source)> live;
        lock (_sourcesGate) live = _liveSources;
        foreach (var (isMic, src) in live)
        {
            try { src.Volume = isMic ? _settings.MicrophoneVolume : _settings.DesktopVolume; }
            catch { /* source already disposed */ }
        }
    }

    /// <summary>
    /// Engine thread: where a recording goes when the engine has to finish it on its own (buffer turned off,
    /// capture restarted with different settings). Never throws; never touches the UI.
    /// </summary>
    private string AutoRecordingPath()
    {
        var started = RecordingStartTime();
        var settings = _settings;
        string folder = settings.ClipsFolder;
        if (!TryEnsureFolder(folder, out _))
        {
            folder = DefaultPaths.ClipsFolder;
            TryEnsureFolder(folder, out _);
        }
        return Path.Combine(folder, $"Recording {started:yyyy-MM-dd HH-mm-ss}.mp4");
    }

    /// <summary>When the current recording started (the engine's recording clock); now if not recording. Any thread.</summary>
    private DateTime RecordingStartTime()
    {
        TimeSpan elapsed;
        try { elapsed = _engine.RecordingElapsed; }
        catch { elapsed = TimeSpan.Zero; }
        return DateTime.Now - elapsed;
    }

    private void OnRecordingAutoSaved(SaveResult r)
    {
        if (r.Success && r.Path is not null)
        {
            Notify($"Recording saved ({Fmt.Clock(r.Duration)})", ToastKind.Success, SoundKind.RecordStop);
            MergeRecent(RecentItem.FromFile(r.Path, RecentKind.Recording, r.Duration));
        }
        else
        {
            ReportRecordingFailure(r.ErrorMessage);
        }
        RaiseChanged();
    }

    /// <summary>
    /// A recording save failed. When the engine kept its footage (a pending recording), the Home banner offers
    /// Try again / Pick another folder; the toast says where to go.
    /// </summary>
    private void ReportRecordingFailure(string? message)
    {
        var text = message ?? "The recording couldn't be saved.";
        if (SafePendingRecordings() > 0)
        {
            _pendingRecordingReason = PendingReason(text);
            Notify($"Recording not saved: {Fmt.Sentence(_pendingRecordingReason)} PC Clipper is keeping it - open PC Clipper and press Try again.",
                ToastKind.Warning, SoundKind.Error);
        }
        else Notify(text, ToastKind.Warning, SoundKind.Error);
        RaiseChanged();
    }

    /// <summary>"Saving failed: the clips drive is full. PC Clipper kept the recording - ..." -> "the clips drive is full."</summary>
    private static string PendingReason(string message)
    {
        int cut = message.IndexOf("PC Clipper kept the recording", StringComparison.OrdinalIgnoreCase);
        var reason = (cut > 0 ? message[..cut] : message).Trim();
        foreach (var prefix in new[] { "Saving the recording failed:", "Saving failed:" })
            if (reason.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) reason = reason[prefix.Length..].Trim();
        if (reason.Length == 0) return "the save didn't work.";
        // Lower-case the first letter so it reads on after "wasn't saved:" (but keep "D:", "PC", "AV1"...).
        if (reason.Length > 1 && char.IsUpper(reason[0]) && char.IsLower(reason[1]) &&
            !reason.StartsWith("Windows", StringComparison.Ordinal))
            reason = char.ToLowerInvariant(reason[0]) + reason[1..];
        return reason;
    }

    private void OnTick()
    {
        _tray?.Refresh();
        SuperviseTick();
        PollStats();
        // Keep the "Trying again in N s" countdown moving even when nothing else changes.
        if (_restartAtMs is not null) RaiseChanged();
    }

    /// <summary>Statistics read the buffer folder; fetch them in the background so the UI never waits on the disk.</summary>
    private async void PollStats()
    {
        if (_statsPolling) return;
        if (_engine.State != EngineState.Running)
        {
            _stats = null;
            return;
        }
        _statsPolling = true;
        try
        {
            _stats = await Task.Run(() => _engine.GetStats());
        }
        catch (Exception ex)
        {
            _stats = null;
            _log.Warn($"Stats unavailable: {ex.Message}");
        }
        finally
        {
            _statsPolling = false;
        }
    }

    // =====================================================================================================
    // Saving, recording, screenshots
    // =====================================================================================================

    /// <summary>
    /// Saves the last <paramref name="seconds"/>; true when the clip was written. Like on PlayStation a length can only be
    /// saved once that much is recorded: the buttons and the tray menu are greyed out until then (<see cref="HasRecorded"/>),
    /// and a press that still gets here (it raced a buffer restart) is refused. A hotkey or controller shortcut
    /// (<paramref name="fromShortcut"/>) can't be greyed out, and refusing it would make the default "save the last
    /// 15 min" do nothing for the first quarter hour of every session, so it saves everything recorded so far, at least
    /// <see cref="MinClipSeconds"/>, and the toast and file name say how long the clip really is.
    /// </summary>
    public async Task<bool> SaveLastAsync(int seconds, bool fromShortcut = false)
    {
        if (_exiting) return false;
        // A double-click (FlatButton raises Click twice) or a repeated hotkey press would queue the same clip twice.
        // Monotonic clock: with the wall clock, a time sync stepping it back would swallow every press for that long.
        long now = Environment.TickCount64;
        if (_lastSaveRequestMs.TryGetValue(seconds, out var last) && now - last < SaveDebounceMs)
        {
            _log.Info($"Save last {QualityMath.FormatSaveLength(seconds)} pressed twice within a second; ignoring the second press.");
            return false;
        }
        if (!CanSave)
        {
            var state = ReplayState;
            Notify(state is ReplayUiState.Starting or ReplayUiState.Resuming
                    ? "Replay is still starting. Try again in a few seconds."
                    : "Replay is off. Turn it on first, then PC Clipper keeps your gameplay.",
                ToastKind.Warning, SoundKind.Error);
            return false;
        }

        int buffer = BufferSeconds;
        int effective = Math.Min(seconds, buffer);
        var minimum = TimeSpan.FromSeconds(fromShortcut ? Math.Min(MinClipSeconds, effective) : effective);
        // Clearly not enough yet, even with the segment being written now (the engine waits for it): say so right away.
        var buffered = SafeBuffered();
        double segment = _engine.ActiveConfig?.SegmentSeconds ?? 2;
        if (buffered.TotalSeconds + segment < minimum.TotalSeconds - SegmentStore.SelectionSlackSeconds)
        {
            NotifyNotEnough(effective, fromShortcut, buffered, null);
            return false;
        }
        var folder = OutputFolder(_settings.ClipsFolder, DefaultPaths.ClipsFolder, "clips");
        if (folder is null) return false;
        // Only a save that really starts arms the debounce (a refused press must not swallow the next one).
        _lastSaveRequestMs[seconds] = now;
        var stamp = DateTime.Now;
        // Named once the footage is picked: "(last 15 min)", or the real length when less was recorded ("(last 7 min 12 sec)").
        string PathFor(TimeSpan got) => Path.Combine(folder, $"Clip {stamp:yyyy-MM-dd HH-mm-ss} (last " +
            (got.TotalSeconds >= effective - SegmentStore.SelectionSlackSeconds
                ? QualityMath.FormatSaveLength(effective)
                : QualityMath.FormatClipLength(got)) + ").mp4");

        _savesInFlight[seconds] = _savesInFlight.GetValueOrDefault(seconds) + 1;
        // Exit, Windows shutdown and Turn OFF wait for this (ending the process would kill the copy and lose the clip).
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _saveTasks.Add(done.Task);
        RaiseChanged();
        try
        {
            var length = TimeSpan.FromSeconds(effective);
            var r = await Task.Run(() => _engine.SaveLastAsync(length, PathFor, minimum));
            if (r.Success && r.Path is not null)
            {
                string text = $"Saved last {QualityMath.FormatDuration(r.Duration)}";
                if (r.ShorterThanRequested) text += $" - all that was recorded so far (you asked for {QualityMath.FormatSaveLength(effective)})";
                else if (seconds > buffer) text += $" (your whole {QualityMath.FormatSaveLength(buffer)} buffer)";
                Notify(text, ToastKind.Success, SoundKind.Saved);
                MergeRecent(RecentItem.FromFile(r.Path, RecentKind.Clip, r.Duration));
                return true;
            }
            if (r.NotEnoughRecorded)
            {
                NotifyNotEnough(effective, fromShortcut, r.Available, r.ErrorMessage);
                return false;
            }
            Notify(r.ErrorMessage ?? "Saving failed.", ToastKind.Warning, SoundKind.Error);
            return false;
        }
        finally
        {
            if (--_savesInFlight[seconds] <= 0) _savesInFlight.Remove(seconds);
            _saveTasks.Remove(done.Task);
            done.TrySetResult();
            RaiseChanged();
        }
    }

    /// <summary>A save refused because too little is recorded: how much there is and when the length unlocks.</summary>
    private void NotifyNotEnough(int effective, bool fromShortcut, TimeSpan available, string? engineMessage)
    {
        string text;
        if (available <= TimeSpan.Zero && engineMessage is not null) text = engineMessage; // "Nothing recorded yet..."
        else if (_engine.State != EngineState.Running) // capture interrupted or stopped: nothing is being added right now
            text = $"Only {Fmt.MinSec(available)} was recorded before the capture stopped" +
                   (fromShortcut ? $" - clips start at {QualityMath.FormatSaveLength(MinClipSeconds)}." : $", so \"{QualityMath.FormatSaveLength(effective)}\" can't be saved.");
        else if (fromShortcut)
            text = $"Only {Fmt.MinSec(available)} recorded so far - clips start at {QualityMath.FormatSaveLength(MinClipSeconds)}. " +
                   $"Try again {UnlocksIn(MinClipSeconds, available)}.";
        else
            text = $"Only {Fmt.MinSec(available)} recorded so far. \"{QualityMath.FormatSaveLength(effective)}\" unlocks " +
                   UnlocksIn(effective, available) + ".";
        Notify(text, ToastKind.Info, SoundKind.Error);
    }

    /// <summary>Starts or stops (and saves) a recording; true when a recording started, or was stopped and saved.</summary>
    public async Task<bool> ToggleRecordingAsync(bool fromHotkey = false)
    {
        if (_exiting) return false;
        // A double-click (FlatButton raises Click twice) must not start and immediately stop a recording.
        // Monotonic clock: with the wall clock, a time sync stepping it back would swallow the Stop press for that long.
        long now = Environment.TickCount64;
        if (_lastRecordToggleMs is { } last && now - last < RecordToggleDebounceMs)
        {
            _log.Info("Record pressed twice in a row; ignoring the second press.");
            return false;
        }
        _lastRecordToggleMs = now;
        if (_shutdownPending && !_engine.IsRecording)
        {
            // Windows is waiting for PC Clipper to finish writing so it can shut down: a new recording would hold it up.
            Notify("Windows is shutting down, so a new recording can't start.", ToastKind.Info, SoundKind.Error);
            return false;
        }

        if (_recordStartPending)
        {
            // The first press is still turning the buffer on; the recording starts right after. Don't cancel it, and
            // don't tell the user to press again (that press would stop the recording that is about to start).
            Notify("Recording starts as soon as the replay is on.", ToastKind.Info);
            return false;
        }
        if (_engine.IsRecording) return await FinishRecordingAsync();
        if (_recordingSaving)
        {
            Notify("Still saving your last recording - press Record again in a moment.", ToastKind.Info, SoundKind.Error);
            return false;
        }
        if (_engine.State != EngineState.Running)
        {
            if (_lifecycleBusy || _engine.State is EngineState.Starting or EngineState.Stopping)
            {
                Notify(_wantReplayOn ? "Replay is starting. Press Record again in a few seconds."
                    : "Replay is turning off. Press Record again in a moment.", ToastKind.Info);
                return false;
            }
            if (_wantReplayOn)
            {
                Notify("Capture was interrupted and is resuming. Press Record again in a few seconds.", ToastKind.Info);
                return false;
            }
            // Recording is cut from the replay buffer, so the buffer has to be on.
            _recordStartPending = true;
            RaiseChanged();
            bool started;
            try
            {
                started = await StartReplayAsync(fromHotkey ? StartKind.Hotkey : StartKind.User);
            }
            finally
            {
                _recordStartPending = false;
                RaiseChanged();
            }
            if (!started || _exiting || !_wantReplayOn) return false; // failed (already reported) or turned off meanwhile
            if (_engine.IsRecording) return false;
        }
        bool recordingStarted = _engine.StartRecording();
        if (recordingStarted)
        {
            Notify("Recording started", ToastKind.Recording, SoundKind.RecordStart);
        }
        else
        {
            Notify("Recording couldn't start because the replay buffer isn't running.", ToastKind.Warning, SoundKind.Error);
        }
        RaiseChanged();
        return recordingStarted;
    }

    /// <summary>
    /// Stops the recording and writes it; true when it was saved. Safe to call twice (the second call waits for the first).
    /// </summary>
    private Task<bool> FinishRecordingAsync()
    {
        if (_recordingSaving) return _recordingSaveTask;
        _recordingSaveTask = FinishRecordingCoreAsync();
        return _recordingSaveTask;
    }

    private async Task<bool> FinishRecordingCoreAsync()
    {
        _recordingSaving = true;
        RaiseChanged();
        try
        {
            var folder = OutputFolder(_settings.ClipsFolder, DefaultPaths.ClipsFolder, "clips") ?? DefaultPaths.ClipsFolder;
            var path = Path.Combine(folder, $"Recording {RecordingStartTime():yyyy-MM-dd HH-mm-ss}.mp4");
            var r = await Task.Run(() => _engine.StopRecordingAsync(path));
            if (r.Success && r.Path is not null)
            {
                Notify($"Recording saved ({Fmt.Clock(r.Duration)})", ToastKind.Success, SoundKind.RecordStop);
                MergeRecent(RecentItem.FromFile(r.Path, RecentKind.Recording, r.Duration));
                return true;
            }
            ReportRecordingFailure(r.ErrorMessage);
            return false;
        }
        catch (Exception ex)
        {
            _log.Error("Finishing the recording failed", ex);
            Notify($"The recording couldn't be saved: {ex.Message}", ToastKind.Warning, SoundKind.Error);
            return false;
        }
        finally
        {
            _recordingSaving = false;
            RaiseChanged();
        }
    }

    /// <summary>
    /// Saves the recordings whose save failed (disk full, folder blocked...). The engine kept their footage; each one is
    /// written as "Recording &lt;start time&gt;.mp4" into the clips folder as it is set now.
    /// </summary>
    private async Task RetryPendingRecordingsAsync()
    {
        if (_retryingRecordings) return;
        if (SafePendingRecordings() == 0)
        {
            RaiseChanged();
            return;
        }
        var folder = OutputFolder(_settings.ClipsFolder, DefaultPaths.ClipsFolder, "clips");
        if (folder is null) return; // OutputFolder told the user what to do
        // The engine takes the recordings out of its pending list while it saves them: keep counting them meanwhile.
        _retryingCount = SafePendingRecordings();
        _retryingRecordings = true;
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _saveTasks.Add(done.Task);
        RaiseChanged();
        try
        {
            var results = await Task.Run(() => _engine.RetryPendingRecordingsAsync(
                rec => Path.Combine(folder, $"Recording {rec.StartedLocal:yyyy-MM-dd HH-mm-ss}.mp4")));
            string? failure = null;
            foreach (var r in results)
            {
                if (r.Success && r.Path is not null)
                {
                    Notify($"Recording saved ({Fmt.Clock(r.Duration)})", ToastKind.Success, SoundKind.RecordStop);
                    MergeRecent(RecentItem.FromFile(r.Path, RecentKind.Recording, r.Duration));
                }
                else failure ??= r.ErrorMessage ?? "The recording couldn't be saved.";
            }
            if (failure is not null)
            {
                if (SafePendingRecordings() > 0)
                {
                    _pendingRecordingReason = PendingReason(failure);
                    Notify($"Still not saved: {Fmt.Sentence(_pendingRecordingReason)} PC Clipper keeps the recording - try again when that's fixed.",
                        ToastKind.Warning, SoundKind.Error);
                }
                else Notify(failure, ToastKind.Warning, SoundKind.Error);
            }
            if (SafePendingRecordings() == 0) _pendingRecordingReason = null;
        }
        catch (Exception ex)
        {
            _log.Error("Saving the kept recording failed", ex);
            Notify($"The recording couldn't be saved: {Fmt.FirstParagraph(ex.Message)}", ToastKind.Warning, SoundKind.Error);
        }
        finally
        {
            _retryingRecordings = false;
            _retryingCount = 0;
            _saveTasks.Remove(done.Task);
            done.TrySetResult();
            RaiseChanged();
        }
    }

    /// <summary>Saves a screenshot of the captured monitor; true when it was written.</summary>
    public async Task<bool> TakeScreenshotAsync()
    {
        if (_exiting || _screenshotBusy) return false;
        _screenshotBusy = true;
        RaiseChanged();
        try
        {
            var monitor = CurrentMonitor;
            var folder = OutputFolder(_settings.ScreenshotsFolder, DefaultPaths.ScreenshotsFolder, "screenshots");
            if (folder is null) return false;
            var path = ReplayEngine.UniquePath(Path.Combine(folder, $"Screenshot {DateTime.Now:yyyy-MM-dd HH-mm-ss}.png"));
            bool drawMouse = _settings.CaptureCursor;

            bool ok = false;
            // Desktop Duplication hands over a rotated (portrait) screen's picture unrotated, so ffmpeg's screenshot of
            // it would be sideways; GDI copies the desktop as it is shown.
            if (monitor.RotationDegrees != 0)
                _log.Info($"The screen is rotated {monitor.RotationDegrees} degrees; taking the screenshot with GDI.");
            else if (_caps is { } caps)
            {
                try { ok = await Task.Run(() => FfmpegProbe.ScreenshotAsync(caps.FfmpegPath, monitor, path, drawMouse, _log)); }
                catch (Exception ex) { _log.Warn($"ffmpeg screenshot failed: {ex.Message}"); }
            }
            if (!ok)
            {
                var bounds = Monitors.Bounds(monitor);
                ok = await Task.Run(() =>
                {
                    try { return GdiScreenshot.Capture(bounds, path); }
                    catch (Exception ex)
                    {
                        _log.Error("GDI screenshot failed", ex);
                        return false;
                    }
                });
            }

            if (ok)
            {
                Notify("Screenshot saved", ToastKind.Success, SoundKind.Screenshot);
                MergeRecent(RecentItem.FromFile(path, RecentKind.Screenshot, null));
            }
            else
            {
                Notify("The screenshot didn't work. Details are in the log (Settings > Open log folder).", ToastKind.Warning, SoundKind.Error);
            }
            return ok;
        }
        finally
        {
            _screenshotBusy = false;
            RaiseChanged();
        }
    }

    /// <summary>The folder to write into: the chosen one, else the default one (with a notice), else null (notice shown).</summary>
    private string? OutputFolder(string preferred, string fallback, string what)
    {
        if (TryEnsureFolder(preferred, out var err)) return preferred;
        _log.Warn($"Can't use the {what} folder {preferred}: {err}");
        if (!string.Equals(preferred, fallback, StringComparison.OrdinalIgnoreCase) && TryEnsureFolder(fallback, out _))
        {
            Notify($"Your {what} folder isn't available ({err}), so this was saved to {fallback} instead.", ToastKind.Warning);
            return fallback;
        }
        Notify($"PC Clipper can't write to the {what} folder ({err}). Pick another folder in Settings > Saving.", ToastKind.Warning, SoundKind.Error);
        return null;
    }

    private static bool TryEnsureFolder(string folder, out string? error)
    {
        error = null;
        try
        {
            if (string.IsNullOrWhiteSpace(folder) || !Path.IsPathFullyQualified(folder))
            {
                error = "it isn't a full folder path";
                return false;
            }
            Directory.CreateDirectory(folder);
            return true;
        }
        catch (Exception ex)
        {
            error = ex is UnauthorizedAccessException ? "access denied"
                : ex is DirectoryNotFoundException or IOException ? "the drive isn't available"
                : ex.Message;
            return false;
        }
    }

    // =====================================================================================================
    // Settings
    // =====================================================================================================

    /// <summary>True while the buffer is on or coming back (Applying capture settings would restart it).</summary>
    public bool ReplayWanted => _wantReplayOn || _engine.State is EngineState.Running or EngineState.Starting || _restartAtMs is not null;

    /// <summary>
    /// Applies new settings (SPEC "SETTINGS page"): asks before restarting a running buffer, saves to disk,
    /// updates Start-with-Windows, re-registers hotkeys, applies the controller shortcuts, applies volumes and the buffer length live and restarts capture
    /// (fresh buffer) when needed.
    /// </summary>
    public async Task<ApplyResult> ApplySettingsAsync(AppSettings next, IWin32Window? owner)
    {
        next = next.Clone().Normalize();
        next.FfmpegPath = _settings.FfmpegPath; // owned by the FFmpeg setup flow, not the form
        var old = _settings;
        bool bufferFolderChanged = !SameFolder(old.BufferFolder, next.BufferFolder);
        // (The buffer length is not part of CaptureDiffers: it is applied to the running buffer without clearing it.)
        bool captureChanged = old.CaptureDiffers(next);
        bool active = ReplayWanted;

        if (captureChanged && active)
        {
            var text = "Applying these settings restarts the replay buffer (the current buffer is cleared). Continue?";
            if (_engine.IsRecording) text += "\n\nYour recording is saved first.";
            if (IsSavingClips) text += "\n\nClips being saved right now are finished first.";
            if (PendingCount() > 0)
                text += "\n\nPC Clipper tries once more to save the recording that wasn't saved. If that still doesn't work, " +
                        $"it keeps the recording in the {(bufferFolderChanged ? "old " : "")}buffer folder and saves it the next time PC Clipper starts.";
            if (!MessageDialog.Confirm(owner, "Restart the replay buffer?", text, "Apply and restart")) return ApplyResult.Cancelled;
        }
        else if (!active && old.BufferFolder != next.BufferFolder && SaveableBufferLostByFolder(next.BufferFolder) is { } held)
        {
            // The replay stopped on a fault and its buffer can still be saved, but only from the folder it is in: the next
            // Turn ON in the new folder deletes it (the engine never moves a buffer).
            if (!MessageDialog.Confirm(owner, "Change the buffer folder?",
                    $"The replay buffer still holds {Fmt.MinSec(held)} from before it stopped, which you can still save. With " +
                    "a new buffer folder, turning the replay on starts a new buffer there, and that footage can't be saved after " +
                    "that. Save a clip from it first if you want to keep it.\n\nChange the buffer folder anyway?",
                    "Change folder", "Cancel", warning: true))
                return ApplyResult.Cancelled;
        }

        var warnings = new List<string>();
        // Owned by the app (where kept recordings may be), not the form: carry over what is known now.
        next.KeptRecordingRoots = (_settings.KeptRecordingRoots ?? new List<string>()).ToList();
        _settings = next;
        // Recordings that couldn't be saved stay in the buffer folder they were made in. When that folder is changed, remember
        // the old one, so the next start still recovers them (the start-up recovery otherwise only looks in the new one):
        // a recording waiting to be saved now (in the running or stopped buffer's folder), or one kept there earlier.
        if (bufferFolderChanged && PendingCount() > 0)
        {
            AddKeptRecordingRoot(_engine.ActiveConfig?.BufferRoot);
            AddKeptRecordingRoot(old.BufferFolder);
        }
        SaveSettings();
        if (bufferFolderChanged && PendingCount() == 0) _ = RememberBufferFolderIfKeptAsync(old.BufferFolder);
        _log.Info("Settings applied: " + JsonSerializer.Serialize(_settings, LogJson));
        if (captureChanged) ResetSupervision();

        if (old.BufferMinutes != next.BufferMinutes && !(captureChanged && active))
        {
            // Live: the janitor keeps the new length from its next tick; nothing about the video changes, so the buffer
            // stays. (Off: the next start uses the setting and checks the space itself.)
            try { _engine.SetBufferSeconds(next.BufferMinutes * 60); }
            catch (Exception ex) { _log.Warn($"Changing the buffer length live failed: {ex.Message}"); }
            if (next.BufferMinutes > old.BufferMinutes && _engine.ActiveConfig is { } running)
            {
                var spaceWarning = await BufferSpaceWarningAsync(running, next.BufferMinutes * 60);
                if (spaceWarning is not null) warnings.Add(spaceWarning);
            }
        }

        if (old.StartWithWindows != next.StartWithWindows)
        {
            try { StartupRegistration.Apply(next.StartWithWindows); }
            catch (Exception ex)
            {
                _log.Error("Start with Windows could not be changed", ex);
                warnings.Add("\"Start with Windows\" couldn't be changed (Windows refused). Try again, or check that no security tool is blocking it.");
            }
        }

        var hotkeyErrors = RegisterHotkeys();
        ApplyControllerSettings();
        ApplyLiveVolumes();

        if (!string.Equals(old.ClipsFolder, next.ClipsFolder, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(old.ScreenshotsFolder, next.ScreenshotsFolder, StringComparison.OrdinalIgnoreCase))
            _ = LoadRecentFromDiskAsync();

        RaiseChanged();
        if (captureChanged && active) await RestartReplayAsync();
        return new ApplyResult(true, hotkeyErrors, warnings);
    }

    /// <summary>
    /// A longer buffer on a running replay: warn (don't fail) when its drive can't hold it. The space the running buffer
    /// already uses counts as available; the engine stops the replay when less than 2 GB stays free.
    /// </summary>
    private async Task<string?> BufferSpaceWarningAsync(CaptureConfig cfg, int seconds)
    {
        try
        {
            var root = cfg.BufferRoot;
            var (free, used) = await Task.Run(() => (EngineEnvironment.DefaultFreeBytes(root), _engine.GetStats().BufferBytesOnDisk));
            long need = QualityMath.EstimateBufferBytes(cfg.BitrateKbps, cfg.AudioEnabled ? cfg.AudioBitrateKbps : 0, seconds, cfg.SegmentSeconds);
            const long floor = 2L << 30;
            if (free + used >= need + floor) return null;
            var text = $"Drive {Fmt.Drive(root)} may not have room for a {seconds / 60}-minute buffer: it needs about " +
                       $"{QualityMath.FormatBytes(need)} and {QualityMath.FormatBytes(free)} is free. If the drive gets almost full, " +
                       "the replay stops. Free up space, lower the buffer length, or pick another buffer folder.";
            _log.Warn(text);
            return text;
        }
        catch (Exception ex)
        {
            _log.Warn($"Free space check for the new buffer length failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// "Test my PC" (SPEC): pauses the buffer if it is on (after asking), shows the animated test card on the tested
    /// monitor, runs the capture pipeline with the pending settings, closes the card and turns the buffer back on.
    /// Returns null when the user cancelled.
    /// </summary>
    public async Task<BenchmarkResult?> TestPcAsync(AppSettings pending, IWin32Window? owner)
    {
        var caps = _caps;
        if (caps is null) return new BenchmarkResult(false, 0, 0, 0, "Set up FFmpeg first (Settings > FFmpeg & help), then run the test.");
        if (_benchmarkRunning || _exiting) return null;
        if (_engine.IsRecording || _recordingSaving)
            return new BenchmarkResult(false, 0, 0, 0, "Stop your recording first, then run the test.");
        if (PendingCount() > 0)
            return new BenchmarkResult(false, 0, 0, 0, _retryingRecordings
                ? "PC Clipper is still saving a recording. Run the test when that's done."
                : "A recording still needs saving. Press Try again on the Home page first, then run the test.");
        if (_lifecycleBusy)
            return new BenchmarkResult(false, 0, 0, 0, "The replay buffer is busy starting or stopping. Try again in a few seconds.");

        bool wasOn = ReplayWanted;
        if (wasOn)
        {
            if (!MessageDialog.Confirm(owner, "Pause the replay buffer?",
                    "The test uses the screen capture for about 20 seconds, so the replay buffer pauses while it runs " +
                    "(what it kept so far is cleared) and turns back on afterwards." +
                    (IsSavingClips ? " Clips being saved right now are finished first." : "") + " Continue?",
                    "Run the test"))
                return null;
        }

        _benchmarkRunning = true;
        RaiseChanged();
        IDisposable? card = null;
        try
        {
            if (wasOn) await StopReplayAsync(announce: false);

            var settings = pending.Clone().Normalize();
            var monitor = PickMonitor(settings.MonitorDeviceName);
            var cfg = QualityMath.Resolve(settings, monitor, caps);
            _log.Info($"Test my PC: {cfg.Describe()}, {cfg.Method}");

            // Something has to move on the tested screen, or the capture has no new frames to count. The card runs
            // its own UI thread; showing and closing it wait for that thread, so do both off ours.
            var bounds = Monitors.Bounds(monitor);
            try { card = await Task.Run(() => TestCard.Show(bounds)); }
            catch (Exception ex) { _log.Warn($"Test card unavailable: {ex.Message}"); }
            await Task.Delay(400); // let the card appear before the capture starts

            // Two ~6 s passes (encoder throughput, then distinct frames) plus start-up: about 15-20 s in all.
            var result = await Task.Run(() => FfmpegProbe.BenchmarkAsync(cfg, 6, _log));
            _log.Info($"Test result: ok={result.Ok} fps={result.AchievedFps:0.#} speed={result.Speed:0.00} unique={result.UniqueFps:0.#} | {result.Message}");
            return result;
        }
        catch (Exception ex)
        {
            _log.Error("Test my PC failed", ex);
            return new BenchmarkResult(false, 0, 0, 0, $"The test couldn't run: {Fmt.FirstParagraph(ex.Message)}");
        }
        finally
        {
            if (card is not null)
            {
                try { await Task.Run(card.Dispose); }
                catch (Exception ex) { _log.Warn($"Closing the test card failed: {ex.Message}"); }
            }
            _benchmarkRunning = false;
            RaiseChanged();
            if (wasOn && !_exiting) await StartReplayAsync(StartKind.Restart);
        }
    }

    private static readonly HotkeyAction[] AllHotkeyActions =
        { HotkeyAction.SaveReplay, HotkeyAction.ToggleRecording, HotkeyAction.Screenshot, HotkeyAction.ToggleReplay };

    public static HotkeyBinding BindingFor(AppSettings s, HotkeyAction action) => action switch
    {
        HotkeyAction.SaveReplay => s.SaveReplayHotkey,
        HotkeyAction.ToggleRecording => s.RecordHotkey,
        HotkeyAction.Screenshot => s.ScreenshotHotkey,
        _ => s.ToggleReplayHotkey,
    };

    private IReadOnlyDictionary<HotkeyAction, string> RegisterHotkeys()
    {
        if (_hotkeys is null)
        {
            _hotkeyErrors = AllHotkeyActions.ToDictionary(a => a, _ => "Hotkeys aren't available on this PC right now.");
            RaiseChanged();
            return _hotkeyErrors;
        }
        var bindings = AllHotkeyActions.ToDictionary(a => a, a => BindingFor(_settings, a));
        try
        {
            _hotkeyErrors = _hotkeys.Register(bindings);
            _hotkeysPaused = false;
        }
        catch (Exception ex)
        {
            _log.Error("Registering hotkeys failed", ex);
            _hotkeyErrors = bindings.Where(kv => kv.Value.IsAssigned)
                .ToDictionary(kv => kv.Key, _ => "This hotkey couldn't be set up. Try another combination.");
        }
        foreach (var (action, error) in _hotkeyErrors) _log.Warn($"Hotkey {action}: {error}");
        RaiseChanged();
        return _hotkeyErrors;
    }

    /// <summary>A global hotkey (UI thread).</summary>
    private void OnHotkey(HotkeyAction action) => RunShortcut(action, onSuccess: null);

    /// <summary>
    /// A keyboard hotkey or a controller shortcut (UI thread): both run exactly this. Only starts work and shows the
    /// non-activating toast: activating or showing a normal window here would take focus from the game and can minimize
    /// an exclusive-fullscreen game. <paramref name="onSuccess"/> runs once the action did what was asked.
    /// </summary>
    private void RunShortcut(HotkeyAction action, Action? onSuccess)
    {
        if (_exiting) return;
        switch (action)
        {
            case HotkeyAction.SaveReplay:
                SaveLast(_settings.HotkeySaveSeconds, onSuccess, fromShortcut: true);
                break;
            case HotkeyAction.ToggleRecording:
                ToggleRecording(fromHotkey: true, onSuccess);
                break;
            case HotkeyAction.Screenshot:
                TakeScreenshot(onSuccess);
                break;
            case HotkeyAction.ToggleReplay:
                ToggleReplay(fromHotkey: true, onSuccess);
                break;
        }
    }

    // =====================================================================================================
    // Feedback
    // =====================================================================================================

    /// <summary>Toast (if enabled) + sound (if enabled) + the window's notice bar. Never activates a window.</summary>
    public void Notify(string text, ToastKind kind, SoundKind? sound = null)
    {
        _log.Info("Notice: " + text);
        if (_settings.ShowOverlay)
        {
            try { OverlayToast.Show(text, kind, Monitors.Bounds(CurrentMonitor)); }
            catch (Exception ex) { _log.Warn($"On-screen notification failed: {ex.Message}"); }
        }
        if (sound is { } s && _settings.PlaySounds)
        {
            try { Sounds.Play(s); }
            catch (Exception ex) { _log.Warn($"Sound failed: {ex.Message}"); }
        }
        try { NoticePosted?.Invoke(new Notice(text, kind, DateTime.Now)); }
        catch (Exception ex) { _log.Error("Notice handler failed", ex); }
    }

    /// <summary>
    /// Crash reporter hook for non-fatal errors: while the window isn't in front (the user may be in a game), report
    /// with a toast instead of a message box that would take focus. Returns false to let the message box show.
    /// </summary>
    private bool QuietCrashNotice(string text)
    {
        try
        {
            if (_settings is null || _exiting) return false;
            if (_form is { IsDisposed: false, Visible: true } f && Form.ActiveForm == f) return false;
            Notify(Fmt.Truncate(text.Replace('\n', ' '), 160), ToastKind.Warning);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private void RaiseChanged()
    {
        try { Changed?.Invoke(); }
        catch (Exception ex) { _log.Error("Refreshing the window failed", ex); }
        _tray?.Refresh();
    }

    private IWin32Window? OwnerWindow() => _form is { IsDisposed: false, Visible: true } f ? f : null;

    // =====================================================================================================
    // Threading helpers
    // =====================================================================================================

    /// <summary>Runs <paramref name="action"/> on the UI thread (asynchronously).</summary>
    private void Post(Action action)
    {
        try
        {
            _ui.Post(_ =>
            {
                try { action(); }
                catch (Exception ex) { _log.Error("UI callback failed", ex); }
            }, null);
        }
        catch (Exception ex)
        {
            _log.Warn($"Could not reach the UI thread: {ex.Message}");
        }
    }

    /// <summary>Starts an async action from a click/hotkey; any exception is logged and shown as a toast, never lost.</summary>
    private void Fire(Func<Task> action, string what)
    {
        async void Run()
        {
            try
            {
                await action();
            }
            catch (Exception ex)
            {
                _log.Error($"{what} failed", ex);
                Notify($"{what} failed: {Fmt.FirstParagraph(ex.Message)}", ToastKind.Warning, SoundKind.Error);
            }
        }
        Run();
    }

    private static async Task AwaitQuietly(Task t)
    {
        try { await t; }
        catch { /* already reported */ }
    }

    private static async Task<bool> WithTimeout(Task t, TimeSpan timeout)
    {
        var done = await Task.WhenAny(t, Task.Delay(timeout));
        if (done == t)
        {
            await AwaitQuietly(t);
            return true;
        }
        return false;
    }

    // =====================================================================================================
    // Exit / Windows shutdown
    // =====================================================================================================

    /// <summary>
    /// Waits - without a time limit - until no clip, recording or recording retry is being written, including saves the
    /// engine started on its own (<see cref="ReplayEngine.ActiveOperations"/>) and, with <paramref name="includeRecovery"/>,
    /// the start-up recovery of kept recordings. Each save has its own size-based timeout in the engine, so this ends.
    /// </summary>
    private async Task WaitForSavesAsync(bool includeRecovery = false)
    {
        while (_saveTasks.Count > 0 || _recordingSaving || _retryingRecordings || SafeActiveOperations() > 0 ||
               (includeRecovery && _recoveringRecordings))
            await Task.Delay(200);
    }

    /// <summary>
    /// Exit waits for <paramref name="work"/> without a time limit, unless the user picks "Close anyway" (Exit again).
    /// Returns false when forced.
    /// </summary>
    private async Task<bool> UnlessForcedAsync(Task work)
    {
        _waitingForSaves = true;
        try
        {
            while (!work.IsCompleted)
            {
                if (_forceExit) return false;
                await Task.WhenAny(work, Task.Delay(200));
            }
            await AwaitQuietly(work);
            return true;
        }
        finally
        {
            _waitingForSaves = false;
        }
    }

    /// <summary>"Saving your clip before closing..." in the window (sticky), and as a toast while the window is hidden.</summary>
    private void ShowClosingNotice(bool recording)
    {
        var text = recording ? "Saving your recording before closing..." : "Saving your clip before closing...";
        if (_form is not { IsDisposed: false, Visible: true }) Notify(text, recording ? ToastKind.Recording : ToastKind.Info);
        try { if (_form is { IsDisposed: false }) _form.ShowBusyNotice(text); }
        catch (Exception ex) { _log.Warn($"Busy notice failed: {ex.Message}"); }
    }

    /// <param name="sessionEnding">Windows is shutting down (or something outside closes PC Clipper): no questions.</param>
    /// <param name="pendingRetried">A blocked shutdown already gave the unsaved recordings their extra try.</param>
    private async Task ExitAsync(bool sessionEnding, bool pendingRetried = false)
    {
        if (_exiting) return;
        _exiting = true;
        _log.Info(sessionEnding ? "Windows is shutting down; closing." : "Exit requested.");
        CancelPendingRestart();
        _wantReplayOn = false;
        _resuming = false;
        try { _tick.Stop(); } catch { }
        RaiseChanged();
        try
        {
            // 1. SPEC "On exit": a running recording is stopped and written first.
            bool recording = _engine.IsRecording || _recordingSaving || _retryingRecordings || _recoveringRecordings;
            if (_engine.IsRecording) _ = FinishRecordingAsync();

            // 2. Everything being written finishes - with no time limit: ending the process kills the copy (the job object
            //    ends ffmpeg with us) and the clip or recording would be lost. A normal exit can be forced by choosing Exit
            //    again ("Close anyway"); at shutdown Windows offers "Shut down anyway" (the shutdown is held meanwhile).
            //    (A recording cut off that way is not lost: its recovery note makes the next start save it.)
            if (IsAnythingBeingWritten)
            {
                ShowClosingNotice(recording);
                bool finished = await UnlessForcedAsync(WaitForSavesAsync(includeRecovery: true));
                _log.Info(finished ? "Saves finished; closing." : "Closing while a save was still running (the user chose Close anyway).");
            }

            // 3. A recording whose save failed earlier: one more try, named after its start time.
            if (PendingCount() > 0 && !_forceExit && !pendingRetried)
            {
                ShowClosingNotice(recording: true);
                await UnlessForcedAsync(RetryPendingRecordingsAsync());
            }

            // 4. Stop capture: quick, unless a recording still couldn't be saved - then the engine tries once more (after
            //    freeing the rest of the buffer) and otherwise keeps it with its recovery note for the next start; that may
            //    take as long as the copy.
            // (Should the stop be cut short, the recording stays in its session folder with its recovery note: remember that
            // buffer folder, which may not be the current one, so the next start finds it. The engine's notice says the same.)
            if (PendingCount() > 0)
            {
                try { RememberKeptRecordingRoot(_engine.ActiveConfig?.BufferRoot); }
                catch (Exception ex) { _log.Warn($"Couldn't remember where the kept recording is: {ex.Message}"); }
            }
            var stop = Task.Run(() => _engine.StopAsync());
            _exitStopTask = stop;
            if (PendingCount() > 0 && !_forceExit)
            {
                ShowClosingNotice(recording: true);
                await UnlessForcedAsync(stop);
            }
            else
            {
                try { if (_form is { IsDisposed: false }) _form.ShowBusyNotice("Closing..."); } catch { }
                if (!await WithTimeout(stop, sessionEnding ? TimeSpan.FromSeconds(3) : TimeSpan.FromSeconds(30)))
                    _log.Warn("The replay buffer took too long to stop; exiting anyway (ffmpeg is ended with PC Clipper).");
            }
        }
        catch (Exception ex)
        {
            _log.Error("Error while closing", ex);
        }
        finally
        {
            // A "Close anyway?" / "isn't saved yet" question still open is answered first (closing under it would end the
            // message loop from inside its modal loop). At shutdown, Windows closes it with everything else.
            while (_exitDialogOpen && !sessionEnding) await Task.Delay(100);
            Shutdown();
        }
    }

    private void Shutdown()
    {
        if (_shutDown) return;
        _shutDown = true;
        try
        {
            SystemEvents.SessionEnding -= OnSessionEnding;
            SystemEvents.SessionEnded -= OnSessionEnded;
            SystemEvents.DisplaySettingsChanged -= OnDisplaySettingsChanged;
        }
        catch { }
        try { _hotkeys?.Dispose(); } catch (Exception ex) { _log.Warn($"Hotkey cleanup: {ex.Message}"); }
        _hotkeys = null;
        StopControllersForExit();
        try { _tray?.Dispose(); } catch (Exception ex) { _log.Warn($"Tray cleanup: {ex.Message}"); }
        _tray = null;
        SaveSettingsQuietly();
        AllowShutdown();
        try { _form?.CloseForExit(); } catch (Exception ex) { _log.Warn($"Window cleanup: {ex.Message}"); }
        _log.Info("Goodbye.");
        ExitThread();
    }

    private void SaveSettingsQuietly()
    {
        try { _settings.Save(DefaultPaths.SettingsFile); }
        catch (Exception ex) { _log.Warn($"Settings not saved on exit: {ex.Message}"); }
    }

    /// <summary>
    /// WM_QUERYENDSESSION (the window's, or SystemEvents.SessionEnding), on the UI thread. Windows only ASKS here: another
    /// app can still veto the shutdown, or the user can press Cancel on its "apps are preventing shutdown" screen, so
    /// nothing is stopped or closed yet - that waits for WM_ENDSESSION(TRUE) (<see cref="OnSessionEnd"/>).
    /// Returns true for "not yet" while something is being written (<see cref="ShouldBlockShutdown"/>): then the reason is
    /// shown on Windows' screen, the recording is stopped and written, and once nothing is left PC Clipper closes so the
    /// shutdown continues - unless WM_ENDSESSION(FALSE) says meanwhile that it was cancelled.
    /// </summary>
    public bool OnSessionEndQuery()
    {
        if (_sessionEnded || _shutDown) return false;
        if (!ShouldBlockShutdown) return false;
        BlockShutdown();
        if (!_exiting && !_shutdownPending)
        {
            _shutdownPending = true;
            _log.Info("Windows asked to shut down while a video is being written; finishing it first.");
            Fire(FinishForShutdownAsync, "Saving before Windows shuts down");
        }
        return true;
    }

    /// <summary>
    /// Something outside PC Clipper closes its window (Task Manager's "End task", an installer's WM_CLOSE): there is no
    /// WM_ENDSESSION to wait for, so close like Exit, without questions (MainForm keeps the window while saves finish).
    /// </summary>
    public void OnClosedFromOutside()
    {
        _log.Info("The window was closed from outside PC Clipper; closing.");
        Fire(() => ExitAsync(sessionEnding: true), "Closing PC Clipper");
    }

    /// <summary>A blocked shutdown: write what is in flight (and retry unsaved recordings once), then close - unless cancelled.</summary>
    private async Task FinishForShutdownAsync()
    {
        try
        {
            bool recording = _engine.IsRecording || _recordingSaving || _retryingRecordings || _recoveringRecordings || PendingCount() > 0;
            ShowClosingNotice(recording);
            // The recording has to end for the shutdown to go on: stop and write it now (the buffer itself keeps running,
            // in case the shutdown is cancelled).
            if (_engine.IsRecording) await FinishRecordingAsync();
            while (_shutdownPending && !_exiting && IsAnythingBeingWritten) await Task.Delay(200);
            if (_shutdownPending && !_exiting && PendingCount() > 0) await RetryPendingRecordingsAsync();
        }
        catch (Exception ex)
        {
            _log.Error("Finishing the saves for the Windows shutdown failed", ex);
        }
        if (!_shutdownPending || _exiting || _sessionEnded) return; // cancelled meanwhile (or already closing): keep running
        _log.Info("Everything is written; closing so the Windows shutdown can continue.");
        await ExitAsync(sessionEnding: true, pendingRetried: true);
    }

    /// <summary>
    /// WM_ENDSESSION (the window's WndProc, or SystemEvents.SessionEnded), on the UI thread.
    /// TRUE: the session really ends and Windows may end the process as soon as this returns, so stop the buffer
    /// synchronously (best effort, about 3 s) and close. A recording still being written then is not lost: its recovery
    /// note makes the next start save it.
    /// FALSE: the shutdown was cancelled (an app vetoed it, the user pressed Cancel, "shutdown /a"): drop the shutdown
    /// block and keep running - the buffer was never stopped.
    /// </summary>
    public void OnSessionEnd(bool ending)
    {
        if (_sessionEnded || _shutDown) return;
        if (!ending)
        {
            bool waited = _shutdownPending;
            _shutdownPending = false;
            AllowShutdown(); // (an Exit the user chose goes on: it still closes once its saves are written)
            if (waited)
            {
                _log.Info("The Windows shutdown was cancelled; PC Clipper keeps running.");
                try { if (_form is { IsDisposed: false } f && !_exiting) f.HideBusyNotice(); } catch { }
                RaiseChanged();
            }
            return;
        }
        _sessionEnded = true;
        _log.Info("Windows is ending the session; stopping the replay buffer.");
        _exiting = true;
        _wantReplayOn = false;
        _resuming = false;
        CancelPendingRestart();
        try { _tick.Stop(); } catch { }
        try
        {
            // Blocking the UI thread is intended: after WM_ENDSESSION returns, the process can be ended at any moment.
            // (The engine never waits for the UI thread: its events are posted.)
            var stop = _exitStopTask ?? Task.Run(() => _engine.StopAsync());
            if (!stop.Wait(TimeSpan.FromSeconds(3)))
                _log.Warn("The replay buffer didn't stop within 3 s; closing anyway (ffmpeg ends with PC Clipper; a recording " +
                          "being written is kept and saved the next time PC Clipper starts).");
        }
        catch (Exception ex)
        {
            _log.Warn($"Stopping at the end of the session: {Fmt.FirstParagraph(ex.InnerException?.Message ?? ex.Message)}");
        }
        Shutdown();
    }

    private void BlockShutdown()
    {
        if (_shutdownBlocked) return;
        var form = _form;
        if (form is not { IsDisposed: false, IsHandleCreated: true }) return;
        bool recording = _engine.IsRecording || _recordingSaving || _retryingRecordings || _recoveringRecordings || PendingCount() > 0;
        var reason = recording ? "Saving your recording..." : "Saving your clip...";
        _shutdownBlocked = NativeUi.BlockShutdown(form.Handle, reason);
        _log.Info($"Holding up the Windows shutdown until the video is written ({reason}).");
    }

    private void AllowShutdown()
    {
        if (!_shutdownBlocked) return;
        _shutdownBlocked = false;
        try
        {
            if (_form is { IsDisposed: false, IsHandleCreated: true } f) NativeUi.AllowShutdown(f.Handle);
        }
        catch (Exception ex)
        {
            _log.Warn($"Shutdown block cleanup: {ex.Message}");
        }
    }

    /// <summary>SystemEvents' WM_QUERYENDSESSION: only answers (see <see cref="OnSessionEndQuery"/>).</summary>
    private void OnSessionEnding(object? sender, SessionEndingEventArgs e)
    {
        try
        {
            _log.Info($"Windows asks to end the session ({e.Reason}).");
            if (Environment.CurrentManagedThreadId == _uiThread)
            {
                // SystemEvents normally runs on this STA UI thread (it was first used on it, in the constructor).
                e.Cancel = OnSessionEndQuery();
                return;
            }
            // SystemEvents on its own thread (rare): answer from here, act on the UI thread.
            bool block = ShouldBlockShutdown;
            e.Cancel = block;
            if (block) Post(() => OnSessionEndQuery());
        }
        catch (Exception ex)
        {
            _log.Warn($"Shutdown handling: {ex.Message}");
        }
    }

    /// <summary>SystemEvents' WM_ENDSESSION(TRUE) (it raises nothing for FALSE; MainForm.WndProc sees both).</summary>
    private void OnSessionEnded(object? sender, SessionEndedEventArgs e)
    {
        try
        {
            if (Environment.CurrentManagedThreadId == _uiThread)
            {
                OnSessionEnd(ending: true);
                return;
            }
            // Own thread: the window's WM_ENDSESSION normally does this on the UI thread already; in case the window is
            // missing, do it there and hold this thread meanwhile (Windows may end the process once it returns).
            var done = new ManualResetEventSlim();
            Post(() =>
            {
                try { OnSessionEnd(ending: true); }
                finally { try { done.Set(); } catch (ObjectDisposedException) { } }
            });
            done.Wait(TimeSpan.FromSeconds(4));
        }
        catch (Exception ex)
        {
            _log.Warn($"Session end handling: {ex.Message}");
        }
    }

    private void OnDisplaySettingsChanged(object? sender, EventArgs e)
    {
        Post(() => Fire(async () =>
        {
            var list = await Task.Run(() => Monitors.Enumerate(_log));
            _monitors = list;
            _log.Info("Displays changed: " + string.Join("; ", list.Select(m => m.ToString())));
            RaiseChanged();
        }, "Refreshing the monitor list"));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            try { _tick.Dispose(); } catch { }
            try { _hotkeys?.Dispose(); } catch { }
            StopControllersForExit();
            try { _tray?.Dispose(); } catch { }
            try { _restartCts?.Cancel(); } catch { }
            // The engine was stopped by ExitAsync. If that timed out, ffmpeg ends with our process (job object) and
            // the leftover buffer folder is removed on the next start; never block the UI thread waiting for it here.
            try { if (_form is { IsDisposed: false }) _form.Dispose(); } catch { }
            _log.Dispose();
        }
        base.Dispose(disposing);
    }
}
