using System.Collections.Concurrent;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Finds game controllers and reports their buttons while any app (a game) is in front:
/// Xbox and XInput-compatible pads through XInput; PlayStation DualShock 4 / DualSense / DualSense Edge over USB and
/// Bluetooth by reading their HID input reports (shared access, read-only). Hot-plug aware. Polls on its own
/// background thread. Never throws.
/// </summary>
/// <remarks>
/// <para>Threading: <see cref="Start"/> creates one background thread ("PC Clipper controllers", normal priority) that
/// polls every 10 ms (~100 Hz; it relies on <see cref="ProcessTuning"/>'s timeBeginPeriod(1), without which it is
/// ~64 Hz). All three events are raised on that thread, never on the UI thread: handlers must be quick and marshal UI
/// work themselves (BeginInvoke). A handler that throws is logged (once per kind of error) and doesn't stop polling.
/// <see cref="Controllers"/> and <see cref="Vibrate"/> may be used from any thread.</para>
/// <para>Backends: <see cref="XInputPads"/> (slots "xinput:0".."xinput:3") and <see cref="SonyHidPads"/> (the HID
/// device path is the id). A PlayStation pad that DS4Windows or similar also turns into a virtual Xbox pad shows up
/// twice (HID and XInput) unless HidHide hides the real one; <see cref="ChordDetector"/>'s repeat guard keeps a press
/// on both from firing an action twice.</para>
/// <para><see cref="ButtonsChanged"/> is raised only when a controller's <see cref="PadButtons"/> value changes (stick
/// and trigger movement below the half-way point don't count). After <see cref="Dispose"/> no events are raised.</para>
/// </remarks>
public sealed class ControllerManager : IDisposable, IPadSink
{
    private const int PollIntervalMs = 10;
    private const int JoinTimeoutMs = 3000;
    private const int MaxVibrateMs = 5000;

    private readonly ILog _log;
    private readonly object _gate = new();
    private readonly ManualResetEvent _stop = new(false);
    private readonly ConcurrentQueue<(int Slot, int Milliseconds)> _rumbleRequests = new();
    private readonly HashSet<string> _loggedOnce = new();
    private Thread? _thread;
    private volatile bool _disposed;

    // Owned by the polling thread.
    private readonly Dictionary<string, (ControllerInfo Info, PadButtons Buttons)> _state = new(StringComparer.OrdinalIgnoreCase);
    private volatile ControllerInfo[] _snapshot = Array.Empty<ControllerInfo>();

    public ControllerManager(ILog log) => _log = log ?? new NullLog();

    /// <summary>Raised on the polling thread when a controller is found (also for those present at Start).</summary>
    public event Action<ControllerInfo>? Connected;
    /// <summary>Raised on the polling thread when a controller goes away.</summary>
    public event Action<ControllerInfo>? Disconnected;
    /// <summary>Raised on the polling thread whenever the pressed buttons of a controller change.</summary>
    public event Action<ControllerInfo, PadButtons>? ButtonsChanged;

    /// <summary>Controllers connected right now (a snapshot; safe from any thread).</summary>
    public IReadOnlyList<ControllerInfo> Controllers => _snapshot;

    /// <summary>Starts the polling thread (once). Controllers already plugged in are reported through <see cref="Connected"/>.</summary>
    public void Start()
    {
        try
        {
            lock (_gate)
            {
                if (_disposed || _thread is not null) return;
                var thread = new Thread(Run)
                {
                    IsBackground = true,
                    Name = "PC Clipper controllers",
                    // Normal, not BelowNormal: a game keeping every core busy must not delay a shortcut. The work is tiny.
                    Priority = ThreadPriority.Normal,
                };
                thread.Start();
                _thread = thread;
            }
        }
        catch (Exception ex)
        {
            _log.Error("Controller support couldn't start", ex);
        }
    }

    /// <summary>Short rumble on that controller where supported (Xbox via XInput). Never throws; no-op otherwise.</summary>
    /// <remarks>PlayStation pads are never written to (a game may be driving their rumble and lights), so they don't rumble.
    /// The request is carried out by the polling thread within ~10 ms; the length is capped at 5 s.</remarks>
    public void Vibrate(ControllerInfo controller, int milliseconds)
    {
        try
        {
            if (_disposed || _thread is null || controller is null || milliseconds <= 0) return;
            if (controller.Kind != ControllerKind.Xbox || !TryParseXInputSlot(controller.Id, out int slot)) return;
            _rumbleRequests.Enqueue((slot, Math.Min(milliseconds, MaxVibrateMs)));
        }
        catch { /* never throws */ }
    }

    private static bool TryParseXInputSlot(string id, out int slot)
    {
        slot = -1;
        const string prefix = "xinput:";
        return id is not null && id.StartsWith(prefix, StringComparison.Ordinal) &&
               int.TryParse(id.AsSpan(prefix.Length), out slot) && slot is >= 0 and < 4;
    }

    private void Run()
    {
        XInputPads? xinput = null;
        SonyHidPads? sony = null;
        try
        {
            xinput = XInputPads.TryLoad(_log);
            sony = new SonyHidPads(_log);
            _log.Info("Controller support started (Xbox/XInput" + (xinput is null ? " unavailable" : "") + ", PlayStation over USB/Bluetooth).");

            do
            {
                long now = Environment.TickCount64;
                if (xinput is not null)
                {
                    while (_rumbleRequests.TryDequeue(out var request)) Guard("XInput rumble", () => xinput.StartRumble(request.Slot, request.Milliseconds, now));
                    Guard("XInput", () => xinput.Poll(now, this));
                }
                else _rumbleRequests.Clear();
                Guard("PlayStation", () => sony.Poll(now, this));
            }
            while (!_stop.WaitOne(PollIntervalMs));
        }
        catch (Exception ex)
        {
            _log.Error("Controller support stopped unexpectedly", ex);
        }
        finally
        {
            try { xinput?.Dispose(); } catch { }
            try { sony?.Dispose(); } catch { }
            _state.Clear();
            _snapshot = Array.Empty<ControllerInfo>();
        }
    }

    /// <summary>Runs one backend step; an exception is logged once per kind (it may repeat at 100 Hz) and polling goes on.</summary>
    private void Guard(string what, Action step)
    {
        try { step(); }
        catch (Exception ex)
        {
            LogOnce($"{what}|{ex.GetType().FullName}|{ex.Message}", () => _log.Error($"Controller polling ({what}) failed; will keep trying", ex));
        }
    }

    private void LogOnce(string key, Action log)
    {
        bool first;
        lock (_loggedOnce) first = _loggedOnce.Count < 200 && _loggedOnce.Add(key);
        if (first)
        {
            try { log(); } catch { }
        }
    }

    // ---- IPadSink (called by the backends on the polling thread) ----

    void IPadSink.OnPadConnected(ControllerInfo pad)
    {
        if (_disposed || _state.ContainsKey(pad.Id)) return;
        _state[pad.Id] = (pad, PadButtons.None);
        _snapshot = _state.Values.Select(v => v.Info).ToArray();
        _log.Info($"Controller connected: {pad}");
        Raise("Connected", () => Connected?.Invoke(pad));
    }

    void IPadSink.OnPadDisconnected(ControllerInfo pad)
    {
        if (!_state.Remove(pad.Id)) return;
        _snapshot = _state.Values.Select(v => v.Info).ToArray();
        if (_disposed) return;
        _log.Info($"Controller disconnected: {pad}");
        Raise("Disconnected", () => Disconnected?.Invoke(pad));
    }

    void IPadSink.OnPadState(ControllerInfo pad, PadButtons buttons)
    {
        if (_disposed || !_state.TryGetValue(pad.Id, out var entry) || entry.Buttons == buttons) return;
        _state[pad.Id] = (entry.Info, buttons);
        Raise("ButtonsChanged", () => ButtonsChanged?.Invoke(entry.Info, buttons));
    }

    private void Raise(string name, Action invoke)
    {
        try { invoke(); }
        catch (Exception ex)
        {
            // Never let a handler error end the polling thread (an unhandled exception there would end the app).
            LogOnce($"handler|{name}|{ex.GetType().FullName}|{ex.Message}", () => _log.Error($"Controller {name} handler failed", ex));
        }
    }

    /// <summary>
    /// Stops polling, stops any rumble, cancels the pending reads and closes every device. Waits up to 3 s for the
    /// polling thread (not when called from a controller event handler, i.e. on that thread). Never throws.
    /// </summary>
    public void Dispose()
    {
        Thread? thread;
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            thread = _thread;
        }
        try { _stop.Set(); } catch { }
        if (thread is null || thread == Thread.CurrentThread) return; // the thread cleans up when it returns to its loop
        bool ended;
        try { ended = thread.Join(JoinTimeoutMs); }
        catch { ended = false; }
        if (!ended) _log.Warn("The controller polling thread didn't stop in time; it ends with the app.");
        // _stop is deliberately not disposed: a late thread may still wait on it.
    }

    private sealed class NullLog : ILog
    {
        public void Info(string message) { }
        public void Warn(string message) { }
        public void Error(string message, Exception? ex = null) { }
    }
}

/// <summary>What the controller backends report to <see cref="ControllerManager"/> (on its polling thread).</summary>
internal interface IPadSink
{
    /// <summary>A controller appeared (repeated calls for the same id are ignored).</summary>
    void OnPadConnected(ControllerInfo pad);
    /// <summary>A controller went away.</summary>
    void OnPadDisconnected(ControllerInfo pad);
    /// <summary>The controller's current buttons (sent for every report/poll; only changes are passed on).</summary>
    void OnPadState(ControllerInfo pad, PadButtons buttons);
}
