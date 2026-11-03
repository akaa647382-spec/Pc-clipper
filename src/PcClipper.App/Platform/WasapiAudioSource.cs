using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// WASAPI capture (NAudio) delivering 48 kHz float stereo into the base class's drift-corrected FIFO (call Push from
/// the capture callback). Never throws from capture callbacks; restarts itself on device loss/default-device change.
/// </summary>
/// <remarks>
/// <para><b>Format.</b> Windows is asked for 48 kHz float stereo directly (WaveFormat set before StartRecording; NAudio
/// always adds AUTOCONVERTPCM | SRC_DEFAULT_QUALITY, so the audio engine resamples and down/up-mixes). If a device refuses
/// that, the capture is reopened in the device mix format and converted here (<see cref="PcmFormatConverter"/>).</para>
/// <para><b>Desktop sound</b> is event-driven loopback of the default playback device (Render/Multimedia), 20 ms buffer
/// (NAudio's own WasapiLoopbackCapture only polls every 50 ms with 100 ms buffers). Loopback delivers nothing while
/// nothing plays, so a silent WasapiOut "keep-alive" stream runs on the same device; gaps are filled with silence by the
/// FIFO anyway, so A/V sync never depends on it.</para>
/// <para><b>Microphone</b>: the chosen device, or the Windows default recording device (Role.Console, the "Default Device"
/// in the Sound control panel, not the "Default Communication Device") when the id is null.</para>
/// <para><b>Restarts.</b> Unplugging, a format change in the Sound control panel, exclusive-mode takeover or a Bluetooth
/// headset switching profile end the capture with RecordingStopped(exception) (AUDCLNT_E_DEVICE_INVALIDATED). A brand-new
/// capture object is opened after 1 s, then every 2 s until it works. Default-device changes arrive through
/// IMMNotificationClient. All restarts are debounced through one generation counter, run on thread-pool threads (so
/// NAudio captures no UI SynchronizationContext and COM objects live in the MTA), and call ResetBuffer().
/// While the device is down the mixer simply gets silence: the audio timeline never stops.</para>
/// <para>Notification callbacks run on a Windows audio thread: they must not block or (un)register callbacks, so they
/// only schedule work.</para>
/// </remarks>
public sealed class WasapiAudioSource : BufferedAudioSource
{
    private enum SourceKind { Desktop, Microphone }

    private const int CaptureBufferMs = 20;
    private const int KeepAliveLatencyMs = 50;
    private const int FirstRetryMs = 1000;
    private const int RetryMs = 2000;
    private const int DeviceChangeDelayMs = 500;
    private const int ComTimeoutMs = 5000;

    private readonly SourceKind _kind;
    private readonly string? _pinnedDeviceId; // null = follow the Windows default
    private readonly ILog _log;
    private readonly object _gate = new();     // serialises open/close of the capture
    private readonly object _notifyGate = new(); // serialises (un)registering the device-change callback
    private Session? _session;                 // under _gate
    private MMDeviceEnumerator? _notifyEnumerator;
    private DeviceNotifications? _notifications;
    private int _generation;
    private volatile bool _running;
    private volatile bool _disposed;
    private volatile string _deviceName = "";
    private volatile string? _activeDeviceId;
    private string? _lastProblem;
    private DateTime _lastProblemUtc;

    private WasapiAudioSource(SourceKind kind, string? deviceId, ILog log)
    {
        _kind = kind;
        _pinnedDeviceId = string.IsNullOrWhiteSpace(deviceId) ? null : deviceId;
        _log = log;
    }

    /// <summary>Loopback of the default playback device ("what you hear"); follows default-device changes.</summary>
    /// <exception cref="InvalidOperationException">No playback device is set up (plain-language message).</exception>
    public static WasapiAudioSource Desktop(ILog log, float volume)
    {
        var s = new WasapiAudioSource(SourceKind.Desktop, null, log) { Volume = volume };
        s.CheckDeviceAvailable();
        return s;
    }

    /// <summary>A microphone; null id = the default recording device.</summary>
    /// <exception cref="InvalidOperationException">The microphone is missing, unplugged or disabled (plain-language message).</exception>
    public static WasapiAudioSource Microphone(string? deviceId, ILog log, float volume)
    {
        var s = new WasapiAudioSource(SourceKind.Microphone, deviceId, log) { Volume = volume };
        s.CheckDeviceAvailable();
        return s;
    }

    public override string Name
    {
        get
        {
            string what = _kind == SourceKind.Desktop ? "PC sound" : "Microphone";
            string dev = _deviceName;
            return dev.Length > 0 ? $"{what} ({dev})" : what;
        }
    }

    /// <summary>Begins capturing in the background (returns at once; audio arrives a few ms later). Never throws.</summary>
    public override void Start()
    {
        if (_disposed) return;
        lock (_gate)
        {
            if (_running) return;
            _running = true;
        }
        ResetBuffer();
        ScheduleOpen(0, "start");
    }

    /// <summary>Stops capturing and releases the device (waits at most a few seconds for the driver). Never throws.</summary>
    public override void Stop()
    {
        _running = false;
        Interlocked.Increment(ref _generation); // cancels pending restarts
        try
        {
            RunOffUiThread(() =>
            {
                lock (_gate) CloseLocked();
                UnregisterNotifications();
                return true;
            }, ComTimeoutMs, "stopping audio capture");
        }
        catch (Exception ex)
        {
            _log.Warn($"{Label}: stopping took too long or failed ({ex.Message}); it finishes in the background.");
        }
        ResetBuffer();
    }

    public override void Dispose()
    {
        _disposed = true;
        base.Dispose(); // calls Stop()
    }

    private string Label => _kind == SourceKind.Desktop ? "PC sound" : "Microphone";

    // ------------------------------------------------------------------------------------------------ open / close

    /// <summary>Debounced (re)open: only the most recent request runs. Safe from any thread, never blocks.</summary>
    private void ScheduleOpen(int delayMs, string reason)
    {
        if (!_running || _disposed) return;
        int gen = Interlocked.Increment(ref _generation);
        _ = Task.Run(async () =>
        {
            try
            {
                if (delayMs > 0) await Task.Delay(delayMs).ConfigureAwait(false);
                if (!IsCurrent(gen)) return;
                EnsureNotifications();
                lock (_gate)
                {
                    if (!IsCurrent(gen)) return;
                    OpenLocked(reason);
                    if (!IsCurrent(gen)) CloseLocked(); // stopped while we were opening
                }
                _lastProblem = null;
            }
            catch (Exception ex)
            {
                ReportProblem($"{Label}: can't capture right now ({Plain(ex)}); trying again every {RetryMs / 1000} s.", ex);
                if (IsCurrent(gen)) ScheduleOpen(RetryMs, "retry");
            }
        });
    }

    private bool IsCurrent(int gen) => _running && !_disposed && gen == Volatile.Read(ref _generation);

    private void OpenLocked(string reason)
    {
        CloseLocked();
        MMDevice device;
        using (var en = new MMDeviceEnumerator())
            device = ResolveDevice(en);
        var session = new Session(device);
        try
        {
            _deviceName = SafeName(device);
            _activeDeviceId = device.ID;

            // 1) Let Windows convert to 48 kHz float stereo.
            // Each capture is attached to the session before it starts, so a failure below still disposes it.
            string format;
            var cap = session.Capture = CreateCapture(device, session);
            try
            {
                cap.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(AudioMixerPump.SampleRate, AudioMixerPump.Channels);
                cap.StartRecording();
                format = "48000 Hz float stereo (converted by Windows)";
            }
            catch (Exception first)
            {
                // 2) Device refused: capture its own mix format and convert here.
                session.Capture = null;
                SafeDispose(cap);
                cap = session.Capture = CreateCapture(device, session);
                session.Converter = new PcmFormatConverter(cap.WaveFormat);
                cap.StartRecording();
                format = $"{session.Converter.Describe()} (converted by PC Clipper; Windows refused 48 kHz float: {first.Message})";
            }

            if (_kind == SourceKind.Desktop)
            {
                try
                {
                    var keepAlive = new WasapiOut(device, AudioClientShareMode.Shared, true, KeepAliveLatencyMs);
                    keepAlive.Init(new SilenceProvider(WaveFormat.CreateIeeeFloatWaveFormat(AudioMixerPump.SampleRate, AudioMixerPump.Channels)));
                    keepAlive.Play();
                    session.KeepAlive = keepAlive;
                }
                catch (Exception ex)
                {
                    // Not fatal: silent stretches just become FIFO underruns (= silence).
                    _log.Info($"{Label}: silent keep-alive stream unavailable ({ex.Message}).");
                }
            }

            ResetBuffer();
            session.Live = true;
            _session = session;
            _log.Info($"{Label}: capturing '{_deviceName}' ({reason}) as {format}.");
        }
        catch
        {
            CloseSession(session);
            throw;
        }
    }

    private WasapiCapture CreateCapture(MMDevice device, Session session)
    {
        WasapiCapture cap = _kind == SourceKind.Desktop
            ? new EventLoopbackCapture(device, CaptureBufferMs)
            : new WasapiCapture(device, true, CaptureBufferMs);
        cap.DataAvailable += (_, e) => OnData(session, e);
        cap.RecordingStopped += (_, e) => OnStopped(session, e);
        return cap;
    }

    private MMDevice ResolveDevice(MMDeviceEnumerator en)
    {
        if (_kind == SourceKind.Desktop)
        {
            if (!en.HasDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia))
                throw new InvalidOperationException("No speakers or headphones are set up in Windows.");
            return en.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        }
        if (_pinnedDeviceId is null)
        {
            // The Windows "Default Device" (Console/Multimedia role), as other recorders use - not the separate
            // "Default Communication Device" that VoIP apps follow.
            if (!en.HasDefaultAudioEndpoint(DataFlow.Capture, Role.Console))
                throw new InvalidOperationException("No microphone is set up in Windows.");
            return en.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Console);
        }
        MMDevice dev;
        try { dev = en.GetDevice(_pinnedDeviceId); }
        catch (Exception) { throw new InvalidOperationException("The chosen microphone isn't connected to this PC."); }
        if (dev.State != DeviceState.Active)
        {
            string name = SafeName(dev);
            throw new InvalidOperationException($"The microphone '{name}' is unplugged or turned off.");
        }
        return dev;
    }

    private void CloseLocked()
    {
        var s = _session;
        _session = null;
        if (s is not null) CloseSession(s);
    }

    private static void CloseSession(Session s)
    {
        s.Live = false;
        if (s.KeepAlive is { } ko)
        {
            try { ko.Stop(); } catch { }
            SafeDispose(ko);
        }
        if (s.Capture is { } cap)
        {
            try { cap.StopRecording(); } catch { }
            SafeDispose(cap); // joins NAudio's capture thread (exits within one buffer period)
        }
        SafeDispose(s.Device);
    }

    private static void SafeDispose(IDisposable? d)
    {
        try { d?.Dispose(); } catch { /* the device is already gone */ }
    }

    /// <summary>Factory check so the UI can say "no microphone" right away instead of recording silence.</summary>
    private void CheckDeviceAvailable()
    {
        _deviceName = RunOffUiThread(() =>
        {
            using var en = new MMDeviceEnumerator();
            using var dev = ResolveDevice(en);
            return SafeName(dev);
        }, ComTimeoutMs, "checking the audio device");
    }

    // ------------------------------------------------------------------------------------------------ capture callbacks

    private void OnData(Session session, WaveInEventArgs e)
    {
        // NAudio's capture thread. Copy and return: never throw here (an exception would end the capture).
        try
        {
            if (!session.Live || e.BytesRecorded <= 0) return;
            if (session.Converter is { } conv)
            {
                Push(conv.Convert(e.Buffer, e.BytesRecorded));
            }
            else
            {
                int bytes = e.BytesRecorded - e.BytesRecorded % (AudioMixerPump.Channels * sizeof(float));
                Push(MemoryMarshal.Cast<byte, float>(e.Buffer.AsSpan(0, bytes)));
            }
        }
        catch (Exception ex)
        {
            ReportProblem($"{Label}: an audio packet could not be used ({ex.Message}).", ex);
        }
    }

    private void OnStopped(Session session, StoppedEventArgs e)
    {
        try
        {
            if (!session.Live || !_running) return; // we closed it ourselves
            session.Live = false;
            string why = e.Exception is null ? "the capture ended" : Plain(e.Exception);
            ReportProblem($"{Label}: '{_deviceName}' stopped ({why}); reconnecting.", e.Exception);
            ScheduleOpen(e.Exception is null ? DeviceChangeDelayMs : FirstRetryMs, "device lost");
        }
        catch (Exception ex)
        {
            _log.Error($"{Label}: handling the end of capture failed", ex);
        }
    }

    // ------------------------------------------------------------------------------------------------ device notifications

    private void EnsureNotifications()
    {
        lock (_notifyGate)
        {
            // Stop() clears _running before it unregisters under this lock, so a late caller can't re-register.
            if (_notifications is not null || !_running) return;
            RegisterNotificationsLocked();
        }
    }

    private void RegisterNotificationsLocked()
    {
        try
        {
            var en = new MMDeviceEnumerator();
            var n = new DeviceNotifications(this);
            int hr = en.RegisterEndpointNotificationCallback(n);
            if (hr != 0)
            {
                SafeDispose(en);
                _log.Info($"{Label}: device change notifications unavailable (0x{hr:X8}); unplugging is still handled.");
                return;
            }
            _notifyEnumerator = en; // must stay alive while registered
            _notifications = n;
        }
        catch (Exception ex)
        {
            _log.Info($"{Label}: device change notifications unavailable ({ex.Message}); unplugging is still handled.");
        }
    }

    private void UnregisterNotifications()
    {
        lock (_notifyGate)
        {
            var en = _notifyEnumerator;
            var n = _notifications;
            _notifyEnumerator = null;
            _notifications = null;
            if (en is null || n is null) return;
            try { en.UnregisterEndpointNotificationCallback(n); } catch { }
            SafeDispose(en);
        }
    }

    private void OnDefaultDeviceChanged(DataFlow flow, Role role, string? newDefaultId)
    {
        if (!_running || _pinnedDeviceId is not null) return;
        // Windows sends one call per role; react to the role we follow.
        bool ours = _kind == SourceKind.Desktop
            ? flow == DataFlow.Render && role == Role.Multimedia
            : flow == DataFlow.Capture && role == Role.Console;
        if (!ours) return;
        if (newDefaultId is not null && newDefaultId == _activeDeviceId && SessionLooksLive()) return;
        _log.Info($"{Label}: the Windows default device changed; switching.");
        ScheduleOpen(DeviceChangeDelayMs, "default device changed");
    }

    private void OnDeviceChanged(string? deviceId, string what)
    {
        if (!_running || deviceId is null) return;
        if (deviceId == _pinnedDeviceId || deviceId == _activeDeviceId)
            ScheduleOpen(FirstRetryMs, what);
    }

    private bool SessionLooksLive()
    {
        // Lock-free peek; a stale answer only causes one extra (harmless) restart.
        var s = Volatile.Read(ref _session);
        return s is { Live: true };
    }

    /// <summary>
    /// IMMNotificationClient. Called on a Windows audio thread: must not block, wait on locks or (un)register callbacks,
    /// so every method only schedules work.
    /// </summary>
    private sealed class DeviceNotifications : IMMNotificationClient
    {
        private readonly WasapiAudioSource _owner;
        public DeviceNotifications(WasapiAudioSource owner) => _owner = owner;

        public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
        {
            try { _owner.OnDefaultDeviceChanged(flow, role, defaultDeviceId); } catch { }
        }

        public void OnDeviceStateChanged(string deviceId, DeviceState newState)
        {
            try { _owner.OnDeviceChanged(deviceId, $"device state changed to {newState}"); } catch { }
        }

        public void OnDeviceAdded(string pwstrDeviceId)
        {
            try { _owner.OnDeviceChanged(pwstrDeviceId, "device added"); } catch { }
        }

        public void OnDeviceRemoved(string deviceId)
        {
            try { _owner.OnDeviceChanged(deviceId, "device removed"); } catch { }
        }

        public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { }
    }

    // ------------------------------------------------------------------------------------------------ helpers

    /// <summary>Event-driven loopback: Windows 10 1703+ signals the event for loopback streams too.</summary>
    private sealed class EventLoopbackCapture : WasapiCapture
    {
        public EventLoopbackCapture(MMDevice renderDevice, int bufferMs) : base(renderDevice, true, bufferMs) { }

        protected override AudioClientStreamFlags GetAudioClientStreamFlags() =>
            AudioClientStreamFlags.Loopback | base.GetAudioClientStreamFlags(); // base = AutoConvertPcm | SrcDefaultQuality
    }

    /// <summary>One opened device. Callbacks of an old session check <see cref="Live"/> and do nothing.</summary>
    private sealed class Session
    {
        public Session(MMDevice device) => Device = device;
        public MMDevice Device { get; }
        public WasapiCapture? Capture { get; set; }
        public WasapiOut? KeepAlive { get; set; }
        public PcmFormatConverter? Converter { get; set; }
        public volatile bool Live;
    }

    private void ReportProblem(string message, Exception? ex)
    {
        // Same message at most once a minute (a missing device would otherwise log every 2 s).
        var now = DateTime.UtcNow;
        if (message == _lastProblem && now - _lastProblemUtc < TimeSpan.FromMinutes(1)) return;
        _lastProblem = message;
        _lastProblemUtc = now;
        try
        {
            if (ex is null or InvalidOperationException) _log.Warn(message);
            else _log.Warn(message + $" [{ex.GetType().Name} 0x{ex.HResult:X8}]");
        }
        catch { }
    }

    private static string Plain(Exception ex) => ex switch
    {
        InvalidOperationException => ex.Message.TrimEnd('.'),
        COMException c when (uint)c.HResult == 0x88890004 => "the device was unplugged or changed",
        COMException c when (uint)c.HResult == 0x8889000A => "another app is using it exclusively",
        COMException c when (uint)c.HResult == 0x80070490 => "the device was not found",
        TimeoutException => "Windows audio didn't respond",
        _ => ex.Message.TrimEnd('.'),
    };

    private static string SafeName(MMDevice dev)
    {
        try { return dev.FriendlyName; }
        catch { return "audio device"; }
    }

    /// <summary>
    /// Runs Windows audio (COM) work on a thread-pool thread and waits for it: NAudio objects must not be created on the
    /// UI thread (STA marshalling, and NAudio would post its events to the UI's SynchronizationContext).
    /// </summary>
    internal static T RunOffUiThread<T>(Func<T> work, int timeoutMs, string what)
    {
        var task = Task.Run(work);
        try
        {
            if (!task.Wait(timeoutMs)) throw new TimeoutException($"Windows audio didn't respond while {what}.");
        }
        catch (AggregateException ae) when (ae.InnerExceptions.Count == 1)
        {
            ExceptionDispatchInfo.Capture(ae.InnerExceptions[0]).Throw();
        }
        return task.Result;
    }
}
