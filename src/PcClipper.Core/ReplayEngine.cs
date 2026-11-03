using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace PcClipper.Core;

/// <summary>
/// The replay buffer. Each ffmpeg process ("run") writes ~2 s segments into its own folder; saves and recordings are
/// stream-copied from them, so saving even an hour takes seconds and never touches the encoder.
/// A buffer ("session") can span several runs: when capture is interrupted (UAC prompt, fullscreen switch, driver
/// reset...) the next run continues the same buffer, and saves join compatible runs together.
/// All public methods are thread-safe. Events may fire on any thread.
/// </summary>
public sealed class ReplayEngine : IDisposable
{
    private static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan AudioConnectTimeout = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan AnchorTimeout = TimeSpan.FromSeconds(8);
    private const long MinFreeBytesWhileRunning = 2L << 30;
    private const long StartupHeadroomBytes = 2L << 30;
    /// <summary>Clips longer than this skip +faststart (it rewrites the whole file once more).</summary>
    private const double FaststartMaxSeconds = 600;

    private readonly EngineEnvironment _env;
    private readonly ILog _log;
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly SemaphoreSlim _saveLock = new(1, 1);
    private readonly object _gate = new();

    private EngineState _state = EngineState.Off;
    private Session? _session;
    private string? _lastError;
    private bool _lastFaultRetryable;
    private Recording? _recording;

    public ReplayEngine(EngineEnvironment env)
    {
        _env = env;
        _log = env.Log;
    }

    public EngineState State { get { lock (_gate) return _state; } }
    public CaptureConfig? ActiveConfig { get { lock (_gate) return _session?.Current?.Config; } }

    /// <summary>Last fatal error message (plain language), if State is Faulted.</summary>
    public string? LastError { get { lock (_gate) return _lastError; } }

    /// <summary>True when the last fault is the kind a restart usually fixes (capture interrupted, encoder busy...).</summary>
    public bool LastFaultRetryable { get { lock (_gate) return _lastFaultRetryable; } }

    /// <summary>How long the current ffmpeg run lasted (supervisors use it to tell a flapping run from a healthy one).</summary>
    public TimeSpan CurrentRunUptime { get { lock (_gate) return _session?.Current?.Uptime.Elapsed ?? TimeSpan.Zero; } }

    public event Action<EngineState>? StateChanged;
    /// <summary>A plain-language problem for the user (also logged).</summary>
    public event Action<string>? Problem;
    /// <summary>A recording was saved without the user pressing stop (buffer turned off, or capture restarted with
    /// different settings). Uses <see cref="EngineEnvironment.RecordingPathFactory"/>.</summary>
    public event Action<SaveResult>? RecordingAutoSaved;

    /// <summary>
    /// How much can be saved right now, capped at the buffer length: exactly the footage a save of the whole buffer would
    /// pick (<see cref="CoverableSeconds"/>, the same walk as <see cref="SaveLastAsync(TimeSpan, Func{TimeSpan, string}, TimeSpan, CancellationToken)"/>),
    /// so a length the UI offers once this reaches it really saves that much. Never across a gap (e.g. an old block kept
    /// for an unsaved recording). The segment being written isn't counted yet, so it trails the live picture by up to one
    /// segment; a save waits for that segment, so it gets at least this much.
    /// </summary>
    public TimeSpan Buffered
    {
        get
        {
            var s = CurrentSession();
            if (s is null) return TimeSpan.Zero;
            return TimeSpan.FromSeconds(Math.Min(CoverableSeconds(s, s.BufferSeconds), s.BufferSeconds));
        }
    }

    /// <summary>Seconds a save asking for <paramref name="want"/> would select now (without pinning): the newest contiguous
    /// segments of each compatible run, newest run first, until <paramref name="want"/> is covered.</summary>
    private static double CoverableSeconds(Session s, double want)
    {
        double covered = 0;
        foreach (var run in s.CompatibleRunsNewestFirst())
        {
            if (covered >= want - SegmentStore.SelectionSlackSeconds) break;
            foreach (var seg in run.Store.SelectLast(want - covered)) covered += seg.Duration;
        }
        return covered;
    }

    public bool IsRecording { get { lock (_gate) return _recording is not null; } }
    public TimeSpan RecordingElapsed { get { lock (_gate) return _recording is { } r ? r.ClockOffset + r.Clock.Elapsed : TimeSpan.Zero; } }

    private Session? CurrentSession() { lock (_gate) return _session; }

    // ------------------------------------------------------------------ lifecycle

    /// <summary>
    /// Start capturing. With <paramref name="keepBuffer"/> (the default) a buffer left over from an interrupted run is
    /// continued; otherwise it is cleared first. Throws InvalidOperationException with a user-facing message on failure.
    /// </summary>
    public Task StartAsync(CaptureConfig cfg, bool keepBuffer = true, CancellationToken ct = default) =>
        StartCoreAsync(cfg, keepBuffer, keepFormat: false, ct);

    /// <summary>
    /// Automatic resume after an interruption: continues the buffer AND keeps its video format (size, fps, encoder), so a
    /// game that changed the screen mode doesn't make the earlier footage un-joinable. Use StartAsync for user starts, so
    /// settings the user changed meanwhile are respected.
    /// </summary>
    public Task ResumeAsync(CaptureConfig cfg, CancellationToken ct = default) => StartCoreAsync(cfg, keepBuffer: true, keepFormat: true, ct);

    private async Task StartCoreAsync(CaptureConfig cfg, bool keepBuffer, bool keepFormat, CancellationToken ct)
    {
        await _lifecycle.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            if (State is EngineState.Running or EngineState.Starting)
                throw new InvalidOperationException("The replay buffer is already on.");

            var session = CurrentSession();
            if (session is not null && (!keepBuffer || session.BufferRoot != Path.GetFullPath(cfg.BufferRoot)))
            {
                await FinishRecordingIfAnyAsync("the buffer was restarted").ConfigureAwait(false);
                await TearDownSessionAsync(session).ConfigureAwait(false);
                session = null;
            }

            lock (_gate) { _lastError = null; _lastFaultRetryable = false; }
            SetState(EngineState.Starting);
            try
            {
                if (session is null)
                {
                    Directory.CreateDirectory(cfg.BufferRoot);
                    SegmentStore.CleanupStaleSessions(cfg.BufferRoot, null, _log);
                    CheckFreeSpace(cfg);
                    session = new Session(SegmentStore.CreateSessionDir(cfg.BufferRoot), cfg.BufferRoot, cfg.BufferSeconds);
                    lock (_gate) _session = session;
                }
                else
                {
                    session.BufferSeconds = cfg.BufferSeconds;
                    if (keepFormat) cfg = KeepBufferFormat(session, cfg);
                    else if (session.Current?.Config.Signature != cfg.Signature) CheckFreeSpace(cfg); // new format: needs its own space
                }

                var run = await LaunchRunAsync(session, cfg, ct).ConfigureAwait(false);
                session.AddRun(run);
                AfterRunAdded(run);
                session.Janitor ??= new Timer(_ => JanitorTick(session), null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
                SetState(EngineState.Running);
                // ffmpeg may have died between its first segment and now; its exit handler ignored it (it wasn't current yet).
                if (run.ExitedTask.IsCompleted) HandleRunExit(session, run);
                _log.Info($"Replay buffer running (run {run.Number}): {cfg.Describe()}, {cfg.Method}, buffer {QualityMath.FormatDuration(TimeSpan.FromSeconds(cfg.BufferSeconds))}");
            }
            catch (Exception ex)
            {
                var msg = ex is InvalidOperationException ? ex.Message : $"Could not start the replay buffer: {ex.Message}";
                _log.Error("Start failed: " + msg, ex is InvalidOperationException ? null : ex);
                lock (_gate) { _lastError = msg; _lastFaultRetryable = ex is RetryableStartException; }
                SetState(EngineState.Faulted);
                if (ex is OperationCanceledException) throw;
                throw new InvalidOperationException(msg, ex);
            }
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    /// <summary>
    /// A resume continues the existing buffer, so it must produce the same format: a game switching resolution or refresh
    /// rate changes the "native" size, and a different size/codec/rate could not be joined (the old footage would be
    /// thrown away). Keep the previous run's output and scale the new picture into it instead.
    /// </summary>
    private CaptureConfig KeepBufferFormat(Session session, CaptureConfig cfg)
    {
        var prev = session.Current?.Config;
        if (prev is null || prev.Signature == cfg.Signature) return cfg;
        if (prev.AudioEnabled != cfg.AudioEnabled) return cfg; // audio toggled: genuinely different, start a new format
        // The monitor moved to another GPU (hybrid laptops): AMF/Quick Sync can't read frames from a different GPU, so
        // their old encoder can't be kept. NVENC (cross-GPU capable) and CPU can.
        if (cfg.Monitor.GpuVendorId != prev.Monitor.GpuVendorId && prev.Vendor is EncoderVendor.Amd or EncoderVendor.Intel &&
            QualityMath.VendorOf(cfg.Monitor.GpuVendorId) != prev.Vendor)
        {
            _log.Warn("The screen is now driven by another graphics chip; the buffer's encoder can't follow, so a new format starts.");
            return cfg;
        }
        _log.Info($"Resuming in the buffer's format {prev.Width}x{prev.Height} {prev.Fps} fps {prev.EncoderName} " +
                  $"(the screen is now {cfg.Monitor.Width}x{cfg.Monitor.Height}).");
        return cfg.With(b =>
        {
            b.Width = prev.Width;
            b.Height = prev.Height;
            b.Fps = prev.Fps;
            b.BitrateKbps = prev.BitrateKbps;
            b.Vendor = prev.Vendor;
            b.Codec = prev.Codec;
            b.EncoderName = prev.EncoderName;
            b.MinimalEncoderFlags = prev.MinimalEncoderFlags;
        });
    }

    private void CheckFreeSpace(CaptureConfig cfg)
    {
        long need = QualityMath.EstimateBufferBytes(cfg.BitrateKbps, cfg.AudioEnabled ? cfg.AudioBitrateKbps : 0, cfg.BufferSeconds, cfg.SegmentSeconds);
        long free = _env.GetFreeBytes(cfg.BufferRoot);
        if (free < need + StartupHeadroomBytes)
        {
            var drive = Path.GetPathRoot(Path.GetFullPath(cfg.BufferRoot));
            throw new InvalidOperationException(
                $"Not enough free space on {drive} ({QualityMath.FormatBytes(free)} free, the buffer needs about " +
                $"{QualityMath.FormatBytes(need + StartupHeadroomBytes)}). Lower the buffer length or quality, or pick another drive in Settings.");
        }
    }

    private async Task<Run> LaunchRunAsync(Session session, CaptureConfig cfg, CancellationToken ct)
    {
        int number = session.NextRunNumber++;
        var runDir = Path.Combine(session.Dir, $"run_{number:000}");
        Directory.CreateDirectory(runDir);
        var store = new SegmentStore(runDir, FfmpegCommandBuilder.SegmentExtension(cfg.Codec), _log);
        var run = new Run(number, cfg, store);

        try
        {
            if (cfg.AudioEnabled)
            {
                // The pipe must exist before ffmpeg starts, or ffmpeg fails to open it.
                run.Sink = _env.CreatePcmSink();
                // Windows Graphics Capture sends no video while the screen is still, and ffmpeg then stops reading audio
                // too; let the audio wait up to 10 minutes (about 230 MB) instead of 1.
                if (cfg.Method == CaptureMethod.WindowsGraphicsCapture && run.Sink is QueuedPcmSink q) q.MaxQueueSeconds = 600;
                run.SinkConnected = run.Sink.WaitForConnectionAsync(run.Cts.Token);
            }

            var args = FfmpegCommandBuilder.BuildCaptureArgs(cfg, run.Sink?.FfmpegInputPath);
            _log.Info("Capture: " + FfmpegRunner.FormatCommandLine(cfg.FfmpegPath, args));
            var psi = FfmpegRunner.CreateStartInfo(cfg.FfmpegPath, args, redirectStdin: true, redirectStdout: true);
            psi.WorkingDirectory = runDir;

            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            run.Process = p;
            p.ErrorDataReceived += (_, e) => OnStderr(run, e.Data);
            p.OutputDataReceived += (_, e) => run.OnProgress(e.Data);
            p.Exited += (_, _) => OnProcessExited(session, run);
            try
            {
                if (!p.Start()) throw new InvalidOperationException("ffmpeg did not start.");
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                throw new InvalidOperationException(ExplainLaunchFailure(ex, cfg.FfmpegPath), ex);
            }
            _env.ProcessGuard.Attach(p);
            p.BeginErrorReadLine();
            p.BeginOutputReadLine();

            if (run.SinkConnected is not null)
            {
                var first = await Task.WhenAny(run.SinkConnected, run.ExitedTask, Task.Delay(AudioConnectTimeout, ct)).ConfigureAwait(false);
                ct.ThrowIfCancellationRequested();
                if (first != run.SinkConnected || run.SinkConnected.IsFaulted)
                    throw StartFailure(run, "ffmpeg never opened the audio input.");
                StartAudio(run);
            }

            // Running once the first segment is finished (proves capture + encode + mux all work).
            var startClock = Stopwatch.StartNew(); // monotonic: immune to clock steps
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                store.Refresh();
                if (run.ExitedTask.IsCompleted) throw StartFailure(run, "ffmpeg stopped right after starting.");
                if (store.Completed.Count > 0) break;
                // Windows Graphics Capture produces nothing until the screen changes: a still screen is not a failure.
                if (cfg.Method == CaptureMethod.WindowsGraphicsCapture && run.Uptime.Elapsed > TimeSpan.FromSeconds(8) &&
                    (run.SinkConnected is null || run.SinkConnected.IsCompletedSuccessfully))
                {
                    _log.Info("Windows Graphics Capture is running but the screen hasn't changed yet.");
                    break;
                }
                if (run.Pump is { IsAnchored: false } && run.ConnectedClock.Elapsed > AnchorTimeout)
                {
                    _log.Warn("No video anchor line from ffmpeg; starting audio unanchored (sync may be off by a constant).");
                    run.Pump.StartAt(Stopwatch.GetTimestamp());
                }
                if (startClock.Elapsed > StartTimeout) throw StartFailure(run, "No video arrived within 20 seconds (is the monitor asleep?).");
                await Task.Delay(200, ct).ConfigureAwait(false);
            }
            run.LastNewSegmentMs = Environment.TickCount64;
            return run;
        }
        catch
        {
            run.Stopping = true;
            await StopRunAsync(run).ConfigureAwait(false);
            store.DeleteSession();
            throw;
        }
    }

    private static string ExplainLaunchFailure(System.ComponentModel.Win32Exception ex, string exe) => ex.NativeErrorCode switch
    {
        4551 => "Windows (Smart App Control / application control) blocked ffmpeg.exe. Allow it, or turn that protection off for it.",
        225 => "Windows Defender reported ffmpeg.exe as unsafe and blocked it. Download FFmpeg again from Settings.",
        2 or 3 => $"ffmpeg.exe is missing ({exe}). It may have been quarantined by antivirus. Download FFmpeg again from Settings.",
        _ => $"Could not run ffmpeg ({exe}): {ex.Message}. Check the FFmpeg setting.",
    };

    private void StartAudio(Run run)
    {
        var sources = _env.CreateAudioSources(run.Config);
        run.Sources = sources.ToList();
        foreach (var s in run.Sources)
        {
            try { s.Start(); }
            catch (Exception ex) { _log.Warn($"Audio source '{s.Name}' failed to start: {ex.Message}"); }
        }
        run.ConnectedClock.Restart();
        run.Pump = new AudioMixerPump(run.Sources, run.Sink!, _log);
        run.Pump.Faulted += ex => OnPumpFaulted(run, ex);
        run.Pump.BeginLeadIn();
        // The anchor line may already have arrived (it usually comes right after the lead-in is read).
        long anchor = Interlocked.Read(ref run.AnchorTimestamp);
        if (anchor != 0) run.Pump.StartAt(anchor);
    }

    private void OnStderr(Run run, string? line)
    {
        if (line is null) return;
        line = line.TrimEnd();
        if (line.Length == 0) return;

        var m = FfmpegCommandBuilder.AnchorLineRegex().Match(line);
        if (m.Success && Interlocked.Read(ref run.AnchorTimestamp) == 0)
        {
            long anchor = AnchorFromRtc(run, m.Groups[1].Value);
            Interlocked.Exchange(ref run.AnchorTimestamp, anchor);
            run.Pump?.StartAt(anchor);
            _log.Info("Audio anchored: " + run.AnchorInfo);
            return;
        }
        run.AddStderr(line);
        _log.Info("ffmpeg> " + line);
    }

    /// <summary>
    /// Convert ffmpeg's "wall clock of video pts 0" (Unix µs) into our Stopwatch timeline, then add the capture latency:
    /// audio sample k is emitted when the data that belongs to video time k/48000 has just arrived.
    /// </summary>
    private static long AnchorFromRtc(Run run, string rtcText)
    {
        long qpcNow = Stopwatch.GetTimestamp();
        long utcNowUs = (DateTime.UtcNow - DateTime.UnixEpoch).Ticks / 10;
        long v0;
        if (long.TryParse(rtcText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var rtcUs) &&
            utcNowUs - rtcUs is >= -2000 and <= 500_000)
            v0 = qpcNow - (long)((utcNowUs - rtcUs) * (Stopwatch.Frequency / 1e6));
        else
            v0 = qpcNow; // implausible clock reading: the line's arrival time is within a millisecond or so anyway
        long latencyMs = run.Config.AudioLatencyMs - run.Config.AudioSyncOffsetMs;
        run.AnchorInfo = $"video pts 0 = unix {rtcText} us, {(qpcNow - v0) * 1000.0 / Stopwatch.Frequency:0.0} ms before the anchor line arrived; " +
                         $"audio clock starts {latencyMs} ms after it";
        return v0 + latencyMs * Stopwatch.Frequency / 1000;
    }

    private void OnPumpFaulted(Run run, Exception ex)
    {
        if (run.Stopping) return;
        // Faults the audio side causes itself end the run with their own explanation. A broken pipe is usually just a
        // symptom of ffmpeg exiting (its real error is in stderr), so give ffmpeg a moment to exit on its own first.
        if (ex is AudioClockJumpException)
            run.FaultReason ??= "The PC slept or paused, so capture was restarted.";
        else if (ex is PcmQueueOverflowException overflow)
            run.FaultReason ??= run.Config.Method == CaptureMethod.WindowsGraphicsCapture
                ? $"Nothing changed on screen for {overflow.Seconds / 60} minutes, so capture was restarted."
                : "The video engine stopped reading the sound, so capture was restarted.";
        else
        {
            _ = Task.Run(async () =>
            {
                await Task.WhenAny(run.ExitedTask, Task.Delay(3000)).ConfigureAwait(false);
                if (run.ExitedTask.IsCompleted || run.Stopping) return;
                run.FaultReason ??= "The audio connection to the video engine broke.";
                try { run.Process?.Kill(entireProcessTree: true); } catch { }
            });
            return;
        }
        try { run.Process?.Kill(entireProcessTree: true); } catch { }
    }

    /// <summary>Stop capturing and delete the buffer. Safe to call in any state.
    /// A running recording is saved first via <see cref="EngineEnvironment.RecordingPathFactory"/> when one is set.</summary>
    public async Task StopAsync()
    {
        await _lifecycle.WaitAsync().ConfigureAwait(false);
        try
        {
            var s = CurrentSession();
            if (s is null)
            {
                if (State != EngineState.Off) SetState(EngineState.Off);
                return;
            }
            SetState(EngineState.Stopping);
            await FinishRecordingIfAnyAsync("the replay buffer was turned off").ConfigureAwait(false);
            await TearDownSessionAsync(s).ConfigureAwait(false);
            lock (_gate) _lastError = null;
            SetState(EngineState.Off);
            _log.Info("Replay buffer stopped.");
        }
        finally
        {
            _lifecycle.Release();
        }
    }

    private async Task TearDownSessionAsync(Session s)
    {
        s.Janitor?.Dispose();
        s.Janitor = null;
        foreach (var run in s.RunsSnapshot())
        {
            run.Stopping = true;
            await StopRunAsync(run).ConfigureAwait(false);
        }
        // Let in-flight saves finish reading their segments before the folder goes (each save has its own timeout,
        // scaled to its size, so this can't wait forever).
        while (Volatile.Read(ref s.ActiveOps) > 0)
            await Task.Delay(100).ConfigureAwait(false);
        await RescuePendingRecordingsAsync(s).ConfigureAwait(false);
        lock (_gate)
        {
            if (_session == s) _session = null;
            _recording?.Dispose();
            _recording = null;
        }
        if (s.KeepFolder) _log.Warn($"Kept {s.Dir}: it holds a recording that could not be saved (it is recovered on the next start).");
        else DeleteDirectory(s.Dir);
    }

    /// <summary>Graceful stop of one run: stop audio, 'q', close the pipe (ffmpeg's reader would block on it), wait, kill.</summary>
    private async Task StopRunAsync(Run run)
    {
        run.Pump?.Stop();
        var p = run.Process;
        try
        {
            if (p is not null && !p.HasExited)
            {
                try
                {
                    await p.StandardInput.WriteAsync("q\n").ConfigureAwait(false);
                    await p.StandardInput.FlushAsync().ConfigureAwait(false);
                }
                catch { /* stdin already closed */ }
                run.Sink?.Dispose();

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                try { await p.WaitForExitAsync(cts.Token).ConfigureAwait(false); }
                catch (OperationCanceledException)
                {
                    _log.Warn("ffmpeg did not stop on 'q'; killing it.");
                    try { p.Kill(entireProcessTree: true); } catch { }
                    try { p.WaitForExit(3000); } catch { }
                }
            }
        }
        catch (InvalidOperationException) { /* never started */ }
        finally
        {
            run.DisposeAudio();
            try { p?.Dispose(); } catch { }
        }
    }

    private void OnProcessExited(Session s, Run run)
    {
        run.MarkExited();
        if (run.Stopping) return;
        bool isCurrent;
        lock (_gate) isCurrent = _session == s && s.Current == run && _state != EngineState.Starting;
        // Still starting: StartAsync reports it, or checks ExitedTask right after it set Running and calls HandleRunExit.
        if (!isCurrent) return;
        HandleRunExit(s, run);
    }

    /// <summary>The current run's ffmpeg is gone without us asking: fault (once) and tell the user.</summary>
    private void HandleRunExit(Session s, Run run)
    {
        if (run.Stopping) return;
        lock (_gate) if (_session != s || s.Current != run || _state == EngineState.Starting) return; // don't use up ExitHandled
        if (Interlocked.Exchange(ref run.ExitHandled, 1) != 0) return;
        int code = -1;
        try { code = run.Process!.ExitCode; } catch { }
        var (msg, retryable) = run.FaultReason is { } reason ? (reason, !run.FaultNotRetryable) : Explain(run.StderrTail(), code);
        _log.Error($"ffmpeg exited unexpectedly (code {code}). {msg}\n{run.StderrTail(20)}");
        run.Pump?.Stop();
        run.DisposeAudio();
        // The segments stay on disk: they can still be saved, and the next start continues this buffer.
        lock (_gate) { _lastError = msg; _lastFaultRetryable = retryable; }
        SetState(EngineState.Faulted);
        Problem?.Invoke(msg);
    }

    private void JanitorTick(Session s)
    {
        if (Interlocked.Exchange(ref s.InJanitor, 1) != 0) return;
        try
        {
            var runs = s.RunsSnapshot();
            var current = s.Current;
            if (current is not null && !current.Stopping && current.ExitedTask.IsCompleted && State == EngineState.Running)
                HandleRunExit(s, current); // safety net: an exit nobody reported
            if (current is not null && !current.Stopping && !current.ExitedTask.IsCompleted)
            {
                current.Store.Refresh();
                // Watchdog: Desktop Duplication duplicates frames on a static screen, so silence means a hang.
                // (Windows Graphics Capture legitimately pauses while nothing changes, so it is exempt.)
                // The store timestamps new segments itself, so saves refreshing it in between can't hide progress.
                long lastNew = Math.Max(current.Store.LastNewSegmentMs, current.LastNewSegmentMs);
                long stallLimitMs = Math.Max(15, current.Config.SegmentSeconds * 6) * 1000L;
                if (current.Config.Method == CaptureMethod.DesktopDuplication && Environment.TickCount64 - lastNew > stallLimitMs)
                {
                    current.FaultReason ??= "Screen capture froze (no new video for 15 seconds), so it was restarted.";
                    _log.Warn(current.FaultReason);
                    try { current.Process?.Kill(entireProcessTree: true); } catch { }
                }
            }

            // Keep BufferSeconds (+2 spare segments) across runs, newest first; older incompatible runs are useless.
            double keep = s.BufferSeconds + 2.0 * (current?.Config.SegmentSeconds ?? 2);
            var compatible = new HashSet<Run>(s.CompatibleRunsNewestFirst());
            foreach (var run in runs.AsEnumerable().Reverse())
            {
                run.Store.Refresh();
                if (!compatible.Contains(run)) run.Store.DeleteExpired(double.NegativeInfinity);
                else
                {
                    run.Store.DeleteExpired(keep);
                    keep -= run.Store.TotalDuration;
                    if (keep < 0) keep = double.NegativeInfinity; // everything in older runs is beyond the window
                }
                if (run != current && run.Store.Completed.Count == 0 && !run.Store.HasPins)
                {
                    s.RemoveRun(run);
                    DeleteDirectory(run.Store.SessionDir);
                }
            }

            if (++s.JanitorTicks % 5 == 0) CheckRecordingSpace(s);
            if (s.JanitorTicks % 5 == 0 && current is not null && !current.Stopping)
            {
                long free = _env.GetFreeBytes(s.BufferRoot);
                long floor = Volatile.Read(ref s.ActiveOps) > 0 ? 512L << 20 : MinFreeBytesWhileRunning;
                if (free < floor)
                {
                    var drive = Path.GetPathRoot(Path.GetFullPath(s.BufferRoot));
                    current.FaultReason = $"Drive {drive} is almost full ({QualityMath.FormatBytes(free)} left), so the replay buffer was stopped. Free up space or pick another drive in Settings.";
                    current.FaultNotRetryable = true;
                    try { current.Process?.Kill(entireProcessTree: true); } catch { }
                }
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"Janitor: {ex.Message}");
        }
        finally
        {
            Volatile.Write(ref s.InJanitor, 0);
        }
    }

    // ------------------------------------------------------------------ saving

    /// <summary>Saves and recordings currently being written (the app waits for these before exiting).</summary>
    public int ActiveOperations => CurrentSession() is { } s ? Volatile.Read(ref s.ActiveOps) : 0;

    /// <summary>Recordings whose save failed; their footage stays pinned until <see cref="RetryPendingRecordingsAsync"/> succeeds.</summary>
    public int PendingRecordingCount { get { lock (_gate) return _session?.PendingRecordings.Count ?? 0; } }

    /// <summary>Change how much is kept without restarting capture (nothing about the video changes).</summary>
    public void SetBufferSeconds(int seconds)
    {
        var s = CurrentSession();
        if (s is null) return;
        s.BufferSeconds = Math.Clamp(seconds, 10, 3600); // settings enforce 1..60 min; tests use shorter
        _log.Info($"Buffer length changed to {QualityMath.FormatDuration(TimeSpan.FromSeconds(s.BufferSeconds))}.");
    }

    /// <summary>Save the last <paramref name="length"/> (or less if not buffered yet) to <paramref name="outputMp4"/>.</summary>
    public Task<SaveResult> SaveLastAsync(TimeSpan length, string outputMp4, CancellationToken ct = default) =>
        SaveLastAsync(length, _ => outputMp4, TimeSpan.Zero, ct);

    /// <summary>
    /// Save the last <paramref name="length"/> (or less if not buffered yet). <paramref name="outputFor"/> names the file
    /// once the footage is picked and gets its length, so a name can say how long the clip really is. With less than
    /// <paramref name="minimum"/> recorded, nothing is saved and the result has <see cref="SaveResult.NotEnoughRecorded"/>
    /// set and <see cref="SaveResult.Available"/> = what there was.
    /// </summary>
    public async Task<SaveResult> SaveLastAsync(TimeSpan length, Func<TimeSpan, string> outputFor, TimeSpan minimum, CancellationToken ct = default)
    {
        var s = CurrentSession();
        if (s is null) return SaveResult.Fail("The replay buffer is off. Turn it on first.");
        Interlocked.Increment(ref s.ActiveOps);
        var pins = new List<IDisposable>();
        try
        {
            // Pick (and pin) the footage for the moment the user pressed the button, BEFORE queueing behind other saves:
            // a long recording copy can hold the save slot for minutes.
            await WaitForCurrentSegmentAsync(s, ct).ConfigureAwait(false);
            double want = Math.Min(length.TotalSeconds, s.BufferSeconds);
            var parts = new List<SavePart>();
            double covered = 0;
            // Same walk as CoverableSeconds (which Buffered reports), plus pinning.
            foreach (var run in s.CompatibleRunsNewestFirst())
            {
                if (covered >= want - SegmentStore.SelectionSlackSeconds) break;
                var segs = run.Store.SelectLastAndPin(want - covered, out var pin);
                pins.Add(pin);
                if (segs.Count == 0) continue;
                parts.Insert(0, new SavePart(run, segs));
                covered += segs.Sum(x => x.Duration);
            }
            if (parts.Count == 0)
                return SaveResult.NotEnough(TimeSpan.Zero, s.Current?.Config.Method == CaptureMethod.WindowsGraphicsCapture
                    ? "Nothing recorded yet. With Windows Graphics Capture the picture only records once something on screen changes."
                    : "Nothing recorded yet - wait a few seconds and try again.");
            if (covered < minimum.TotalSeconds - SegmentStore.SelectionSlackSeconds)
            {
                _log.Info($"Not saving: {QualityMath.FormatDuration(TimeSpan.FromSeconds(covered))} recorded, at least {QualityMath.FormatDuration(minimum)} needed.");
                return SaveResult.NotEnough(TimeSpan.FromSeconds(covered),
                    $"Only {QualityMath.FormatDuration(TimeSpan.FromSeconds(covered))} recorded so far - wait a little and try again.");
            }
            string outputMp4 = outputFor(TimeSpan.FromSeconds(covered));

            await _saveLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var result = await ConcatAsync(s, parts, outputMp4, bufferLive: true, ct).ConfigureAwait(false);
                if (!result.Success) return result;
                bool shorter = result.Duration.TotalSeconds < length.TotalSeconds - parts[0].Run.Config.SegmentSeconds - 0.5;
                _log.Info($"Saved {QualityMath.FormatDuration(result.Duration)} (asked {QualityMath.FormatDuration(length)}) from {parts.Count} run(s) to {result.Path}");
                return result with { ShorterThanRequested = shorter };
            }
            finally
            {
                _saveLock.Release();
            }
        }
        catch (OperationCanceledException)
        {
            return SaveResult.Fail("Save cancelled.");
        }
        catch (Exception ex)
        {
            _log.Error("Save failed", ex);
            return SaveResult.Fail(ex is UnauthorizedAccessException
                ? "Windows blocked saving to the clips folder (Controlled folder access?). Allow PC Clipper and ffmpeg.exe, or pick another folder in Settings."
                : $"Saving failed: {ex.Message}");
        }
        finally
        {
            foreach (var pin in pins) pin.Dispose();
            Interlocked.Decrement(ref s.ActiveOps);
        }
    }

    /// <summary>Start a manual recording (the buffer must be running). Returns false if not running or already recording.</summary>
    public bool StartRecording()
    {
        Recording rec;
        Session s;
        lock (_gate)
        {
            if (_state != EngineState.Running || _session?.Current is not { } run || _recording is not null) return false;
            s = _session;
            run.Store.Refresh();
            rec = _recording = new Recording(run, run.Store.CurrentWritingIndex, DateTime.Now);
        }
        WriteManifest(s, rec);
        _log.Info($"Recording started (run {rec.StartRun.Number}, segment {rec.StartIndex}).");
        return true;
    }

    /// <summary>
    /// Stop the manual recording and write it to <paramref name="outputMp4"/>. If writing fails (disk full, folder blocked),
    /// the footage stays on disk as a pending recording: free some space and call <see cref="RetryPendingRecordingsAsync"/>.
    /// </summary>
    public async Task<SaveResult> StopRecordingAsync(string outputMp4, CancellationToken ct = default)
    {
        Recording? rec;
        Session? s;
        lock (_gate)
        {
            rec = _recording;
            _recording = null;
            s = _session;
        }
        if (rec is null) return SaveResult.Fail("Not recording.");
        rec.Clock.Stop();
        if (s is null)
        {
            rec.Dispose();
            return SaveResult.Fail("The replay buffer stopped, so the recording was lost.");
        }
        // From here until it is saved or pending, the recording is "in flight": teardown waits for it.
        Interlocked.Increment(ref s.ActiveOps);
        try
        {
            // Include the moment Stop was pressed, then freeze the footage right now - not when the save slot frees.
            try { await WaitForCurrentSegmentAsync(s, ct).ConfigureAwait(false); } catch (OperationCanceledException) { }
            if (!Freeze(s, rec))
                return SaveResult.Fail("The recording was too short - nothing to save.");
            return await SaveRecordingAsync(s, rec, outputMp4, bufferLive: true, ct).ConfigureAwait(false);
        }
        finally
        {
            Interlocked.Decrement(ref s.ActiveOps);
        }
    }

    /// <summary>Fix a stopped recording's footage to exactly what exists now (exact pins replace the open-ended ones, so the
    /// live buffer can expire normally even while the recording waits to be saved). False if there is nothing.</summary>
    private bool Freeze(Session s, Recording rec)
    {
        var parts = RecordingParts(s, rec);
        if (parts.Count == 0)
        {
            rec.Dispose();
            return false;
        }
        rec.Freeze(parts);
        WriteManifest(s, rec);
        return true;
    }

    /// <summary>Try again to save recordings whose save failed. Returns one result per recording.</summary>
    public async Task<IReadOnlyList<SaveResult>> RetryPendingRecordingsAsync(Func<Recording, string> pathFor, CancellationToken ct = default)
    {
        var s = CurrentSession();
        if (s is null) return Array.Empty<SaveResult>();
        return await RetryPendingCoreAsync(s, pathFor, bufferLive: s.Current is { Stopping: false } c && !c.ExitedTask.IsCompleted, ct).ConfigureAwait(false);
    }

    private async Task<IReadOnlyList<SaveResult>> RetryPendingCoreAsync(Session s, Func<Recording, string> pathFor, bool bufferLive, CancellationToken ct)
    {
        List<Recording> pending;
        lock (_gate)
        {
            pending = s.PendingRecordings.ToList();
            s.PendingRecordings.Clear();
        }
        var results = new List<SaveResult>();
        foreach (var rec in pending)
            results.Add(await SaveRecordingAsync(s, rec, pathFor(rec), bufferLive, ct).ConfigureAwait(false));
        return results;
    }

    /// <summary>Write a (frozen) recording; on failure keep its segments pinned as a pending recording instead of losing them.</summary>
    private async Task<SaveResult> SaveRecordingAsync(Session s, Recording rec, string outputMp4, bool bufferLive, CancellationToken ct)
    {
        Interlocked.Increment(ref s.ActiveOps);
        bool saved = false;
        try
        {
            await _saveLock.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var parts = rec.Frozen ?? RecordingParts(s, rec);
                var result = await ConcatAsync(s, parts, outputMp4, bufferLive, ct).ConfigureAwait(false);
                saved = result.Success;
                if (result.Success) _log.Info($"Recording saved: {QualityMath.FormatDuration(result.Duration)} to {result.Path}");
                return result.Success ? result : result with { ErrorMessage = result.ErrorMessage + " PC Clipper kept the recording - fix that and press Try again." };
            }
            finally
            {
                _saveLock.Release();
            }
        }
        catch (Exception ex)
        {
            _log.Error("Saving the recording failed", ex);
            return SaveResult.Fail($"Saving the recording failed: {ex.Message} PC Clipper kept the recording - press Try again.");
        }
        finally
        {
            if (saved) rec.Dispose(); // also deletes its crash-recovery manifest
            else lock (_gate) s.PendingRecordings.Add(rec); // pins + manifest stay: neither the janitor nor a crash loses it
            Interlocked.Decrement(ref s.ActiveOps);
        }
    }

    private static List<SavePart> RecordingParts(Session s, Recording rec)
    {
        var parts = new List<SavePart>();
        foreach (var run in s.RunsSnapshot())
        {
            if (run.Number < rec.StartRun.Number || run.Config.Signature != rec.StartRun.Config.Signature) continue;
            run.Store.Refresh();
            var segs = run == rec.StartRun ? run.Store.SelectFrom(rec.StartIndex) : run.Store.SelectFrom(0);
            if (segs.Count > 0) parts.Add(new SavePart(run, segs));
        }
        return parts;
    }

    private async Task<SaveResult?> FinishRecordingIfAnyAsync(string why)
    {
        if (!IsRecording) return null;
        if (_env.RecordingPathFactory is null)
        {
            lock (_gate) { _recording?.Dispose(); _recording = null; }
            _log.Warn($"A recording was discarded because {why} (no RecordingPathFactory).");
            return null;
        }
        var result = await StopRecordingAsync(_env.RecordingPathFactory()).ConfigureAwait(false);
        _log.Info($"Recording saved automatically because {why}: {(result.Success ? result.Path : result.ErrorMessage)}");
        try { RecordingAutoSaved?.Invoke(result); } catch (Exception ex) { _log.Error("RecordingAutoSaved handler threw", ex); }
        return result;
    }

    /// <summary>
    /// Before the buffer folder is deleted, give pending recordings one last chance - after freeing everything else, since
    /// nothing is capturing any more. If that still fails, keep only their footage (and its manifest), so the next launch
    /// recovers it, rather than delete someone's recording.
    /// </summary>
    private async Task RescuePendingRecordingsAsync(Session s)
    {
        if (PendingRecordingCountOf(s) == 0) return;
        foreach (var run in s.RunsSnapshot())
        {
            run.Store.Refresh();
            run.Store.DeleteAllUnpinned();
        }
        if (_env.RecordingPathFactory is not null)
            await RetryPendingCoreAsync(s, _ => _env.RecordingPathFactory(), bufferLive: false, CancellationToken.None).ConfigureAwait(false);
        if (PendingRecordingCountOf(s) == 0) return;
        s.KeepFolder = true;
        foreach (var run in s.RunsSnapshot())
            if (!run.Store.HasPins) DeleteDirectory(run.Store.SessionDir);
        Problem?.Invoke($"A recording couldn't be saved. PC Clipper kept it and will try again next time it starts ({s.Dir}).");
    }

    private int PendingRecordingCountOf(Session s) { lock (_gate) return s.PendingRecordings.Count; }

    // ---- crash-recovery manifests: a recording's footage is described on disk from the moment it starts, so a crash,
    // power cut or failed save never loses it (RecoverKeptRecordingsAsync re-saves it on the next launch).

    private sealed record ManifestPart(string RunDir, int FromIndex, int ToIndex);
    private sealed record Manifest(DateTime StartedLocal, VideoCodec Codec, List<ManifestPart> Parts);

    private void WriteManifest(Session s, Recording rec)
    {
        try
        {
            var parts = rec.Frozen is { } frozen
                ? frozen.Select(p => new ManifestPart(Path.GetFileName(p.Run.Store.SessionDir), p.Segments[0].Index, p.Segments[^1].Index)).ToList()
                : s.RunsSnapshot().Where(r => r.Number >= rec.StartRun.Number && r.Config.Signature == rec.StartRun.Config.Signature)
                    .Select(r => new ManifestPart(Path.GetFileName(r.Store.SessionDir), r == rec.StartRun ? rec.StartIndex : 0, -1)).ToList();
            var json = System.Text.Json.JsonSerializer.Serialize(new Manifest(rec.StartedLocal, rec.StartRun.Config.Codec, parts));
            var tmp = rec.ManifestPath(s.Dir) + ".tmp";
            File.WriteAllText(tmp, json);
            File.Move(tmp, rec.ManifestPath(s.Dir), overwrite: true);
            rec.ManifestDir = s.Dir;
        }
        catch (Exception ex)
        {
            _log.Warn($"Could not write the recording's recovery note: {ex.Message}");
        }
    }

    /// <summary>
    /// Re-save recordings left behind by a crash, power cut or failed save (their session folders hold a recovery note).
    /// Call at startup before the buffer is turned on. Folders are deleted once everything in them is saved.
    /// </summary>
    public static async Task<IReadOnlyList<SaveResult>> RecoverKeptRecordingsAsync(string bufferRoot, string ffmpegPath,
        Func<DateTime, string> pathFor, ILog log, IProcessGuard? guard = null, CancellationToken ct = default)
    {
        var results = new List<SaveResult>();
        if (!Directory.Exists(bufferRoot)) return results;
        foreach (var dir in Directory.EnumerateDirectories(bufferRoot, "session_*"))
        {
            var notes = Directory.GetFiles(dir, "*" + SegmentStore.KeepMarkerSuffix);
            foreach (var note in notes)
            {
                try
                {
                    var m = System.Text.Json.JsonSerializer.Deserialize<Manifest>(File.ReadAllText(note));
                    if (m is null) continue;
                    var parts = new List<IReadOnlyList<SegmentInfo>>();
                    foreach (var p in m.Parts)
                    {
                        var store = new SegmentStore(Path.Combine(dir, p.RunDir), FfmpegCommandBuilder.SegmentExtension(m.Codec), log);
                        store.Refresh();
                        var segs = store.SelectFrom(p.FromIndex).Where(x => p.ToIndex < 0 || x.Index <= p.ToIndex).ToList();
                        if (segs.Count > 0) parts.Add(segs);
                    }
                    if (parts.Count == 0) { File.Delete(note); continue; }
                    var r = await ConcatPartsAsync(ffmpegPath, m.Codec, parts, dir, pathFor(m.StartedLocal), log, guard, ct).ConfigureAwait(false);
                    results.Add(r);
                    if (r.Success)
                    {
                        File.Delete(note);
                        log.Info($"Recovered a recording from {m.StartedLocal:g}: {r.Path}");
                    }
                    else log.Warn($"Could not recover the recording in {dir}: {r.ErrorMessage}");
                }
                catch (Exception ex)
                {
                    log.Warn($"Recovery note {note} unreadable: {ex.Message}");
                }
            }
            if (notes.Length > 0 && Directory.GetFiles(dir, "*" + SegmentStore.KeepMarkerSuffix).Length == 0)
            {
                try { Directory.Delete(dir, recursive: true); } catch { }
            }
        }
        return results;
    }

    /// <summary>
    /// Saving a recording needs about as much free space again as the recording itself. Stop and save it while that is
    /// still possible, instead of filling the drive and losing it.
    /// </summary>
    private void CheckRecordingSpace(Session s)
    {
        Recording? rec;
        lock (_gate) rec = _recording;
        if (rec is null || _env.RecordingPathFactory is null || rec.SpaceStopRequested || s.Current is not { } run) return;
        string? clipsDir;
        try { clipsDir = Path.GetDirectoryName(_env.RecordingPathFactory()); } catch { return; }
        if (clipsDir is null) return;
        long recBytes = RecordingParts(s, rec).Sum(p => SegmentStore.BytesOf(p.Segments));
        // It keeps growing until the save starts: janitor period + waiting for the current segment + a margin.
        long growth = (long)(LiveBytesPerSecond(run) * (10 + 2 * run.Config.SegmentSeconds + 3));
        long need = (long)(BytesNeededToSave(s, recBytes + growth, clipsDir, bufferLive: true) * 1.05);
        long free = _env.GetFreeBytes(clipsDir);
        if (free >= need) return;
        rec.SpaceStopRequested = true;
        _log.Warn($"Stopping the recording early: {QualityMath.FormatBytes(free)} free, saving it needs about {QualityMath.FormatBytes(need)}.");
        _ = Task.Run(async () =>
        {
            var result = await FinishRecordingIfAnyAsync("the drive is almost full").ConfigureAwait(false);
            if (result is null) return;
            Problem?.Invoke(result.Success
                ? "The drive was almost full, so the recording was stopped and saved."
                : $"The drive was almost full, so the recording was stopped, but saving it failed: {result.ErrorMessage}");
        });
    }

    private static double LiveBytesPerSecond(Run run) =>
        (run.Config.BitrateKbps + (run.Config.AudioEnabled ? run.Config.AudioBitrateKbps : 0)) * 1000 / 8.0;

    /// <summary>
    /// Free space a save needs on its destination: the clip (+1% MP4 overhead) and a small margin; on the buffer's own
    /// drive while capture runs, also the buffer's 2 GB floor plus what the buffer grows by during the copy (the save's
    /// pins stop old footage from being recycled meanwhile).
    /// </summary>
    private static long BytesNeededToSave(Session s, long clipBytes, string outDir, bool bufferLive)
    {
        long need = (long)(clipBytes * 1.01) + (256L << 20);
        if (bufferLive && SameDrive(outDir, s.BufferRoot) && s.Current is { } run)
        {
            double copySeconds = Math.Max(30, clipBytes / (50.0 * 1024 * 1024));
            need += MinFreeBytesWhileRunning + (long)(LiveBytesPerSecond(run) * copySeconds);
        }
        return need;
    }

    private static bool SameDrive(string a, string b)
    {
        try { return string.Equals(Path.GetPathRoot(Path.GetFullPath(a)), Path.GetPathRoot(Path.GetFullPath(b)), StringComparison.OrdinalIgnoreCase); }
        catch { return true; }
    }

    /// <summary>Called when a run joins the session: extend a recording into it, or - if the new run can't be joined to it
    /// (different format) - continue recording in the new run right away and save the earlier part in the background.</summary>
    private void AfterRunAdded(Run run)
    {
        Recording? old;
        Session? s;
        Recording? next = null;
        lock (_gate)
        {
            old = _recording;
            s = _session;
            if (old is null || s is null) return;
            if (old.StartRun.Config.Signature == run.Config.Signature)
            {
                old.Pins.Add(run.Store.PinFrom(0));
            }
            else
            {
                // Swap atomically: nothing of the new run is missed, IsRecording stays true, and a Stop pressed meanwhile
                // simply stops the new part.
                next = _recording = new Recording(run, 0, old.StartedLocal) { ClockOffset = old.ClockOffset + old.Clock.Elapsed };
            }
        }
        if (next is null)
        {
            WriteManifest(s, old); // now also covers the new run
            return;
        }
        WriteManifest(s, next);
        old.Clock.Stop();
        if (!Freeze(s, old)) return; // the earlier runs are finished, so this is final
        if (_env.RecordingPathFactory is null)
        {
            lock (_gate) s.PendingRecordings.Add(old); // stays pending (and recoverable)
            return;
        }
        Interlocked.Increment(ref s.ActiveOps); // in flight until the background save below holds its own count
        _ = Task.Run(async () =>
        {
            SaveResult result;
            try { result = await SaveRecordingAsync(s, old, _env.RecordingPathFactory(), bufferLive: true, CancellationToken.None).ConfigureAwait(false); }
            finally { Interlocked.Decrement(ref s.ActiveOps); }
            _log.Info($"Recording part saved because capture restarted with a different format: {(result.Success ? result.Path : result.ErrorMessage)}");
            try { RecordingAutoSaved?.Invoke(result); } catch (Exception ex) { _log.Error("RecordingAutoSaved handler threw", ex); }
        });
    }

    /// <summary>Wait until the segment being written when the user pressed the button is finished, so the clip includes that moment.</summary>
    private static async Task WaitForCurrentSegmentAsync(Session s, CancellationToken ct)
    {
        var run = s.Current;
        if (run is null) return;
        run.Store.Refresh();
        if (run.ExitedTask.IsCompleted || run.Stopping) return;
        int writing = run.Store.CurrentWritingIndex;
        var waited = Stopwatch.StartNew();
        var limit = TimeSpan.FromSeconds(run.Config.SegmentSeconds * 2 + 3);
        while (waited.Elapsed < limit && !run.ExitedTask.IsCompleted)
        {
            await Task.Delay(100, ct).ConfigureAwait(false);
            run.Store.Refresh();
            if (run.Store.CurrentWritingIndex > writing) return;
        }
    }

    internal sealed record SavePart(Run Run, IReadOnlyList<SegmentInfo> Segments);

    private async Task<SaveResult> ConcatAsync(Session s, IReadOnlyList<SavePart> parts, string outputMp4, bool bufferLive, CancellationToken ct)
    {
        var outDir = Path.GetDirectoryName(Path.GetFullPath(outputMp4))!;
        Directory.CreateDirectory(outDir);
        long clipBytes = parts.Sum(p => SegmentStore.BytesOf(p.Segments));
        bufferLive &= s.Current is { Stopping: false } c && !c.ExitedTask.IsCompleted;
        long need = BytesNeededToSave(s, clipBytes, outDir, bufferLive);
        long free = _env.GetFreeBytes(outDir);
        if (free < need)
        {
            var drive = Path.GetPathRoot(outDir);
            return SaveResult.Fail($"Not enough space on {drive} to save this ({QualityMath.FormatBytes(need)} needed, " +
                                   $"{QualityMath.FormatBytes(free)} free). Free up space or pick another clips folder in Settings.");
        }
        return await ConcatPartsAsync(parts[^1].Run.Config.FfmpegPath, parts[^1].Run.Config.Codec, parts.Select(p => p.Segments).ToList(),
            s.Dir, outputMp4, _log, _env.ProcessGuard, ct).ConfigureAwait(false);
    }

    /// <summary>Stream-copy segment lists (one per capture run, oldest first) into one MP4.</summary>
    private static async Task<SaveResult> ConcatPartsAsync(string ffmpegPath, VideoCodec codec, IReadOnlyList<IReadOnlyList<SegmentInfo>> parts,
        string tempDir, string outputMp4, ILog log, IProcessGuard? guard, CancellationToken ct)
    {
        var finalPath = UniquePath(outputMp4);
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(finalPath))!);
        var partPath = finalPath + ".part";
        long clipBytes = parts.Sum(p => SegmentStore.BytesOf(p));
        var tempFiles = new List<string>();
        string Temp(string ext)
        {
            var path = Path.Combine(tempDir, $"save_{Guid.NewGuid():N}{ext}");
            tempFiles.Add(path);
            return path;
        }
        var utf8 = new UTF8Encoding(false); // a BOM breaks concatf lists

        try
        {
            string inputUrl;
            bool isFfconcat;
            if (codec == VideoCodec.Av1)
            {
                // Matroska: concat demuxer with explicit durations (the files' own durations are absolute). It opens one
                // file at a time, so any number of segments is fine.
                var entries = new List<(string, double?)>();
                foreach (var segs in parts)
                    for (int i = 0; i < segs.Count; i++)
                    {
                        var seg = segs[i];
                        double d = i + 1 < segs.Count ? segs[i + 1].StartSeconds - seg.StartSeconds : seg.Duration;
                        entries.Add((seg.Path, d));
                    }
                inputUrl = Temp(".ffconcat");
                await File.WriteAllTextAsync(inputUrl, FfmpegCommandBuilder.FfconcatList(entries), utf8, ct).ConfigureAwait(false);
                isFfconcat = true;
            }
            else
            {
                // MPEG-TS: byte-join segments with concatf (exact timestamps, gapless). concatf opens every file at once
                // and Windows allows ~8000 open files, so long saves use chunks of <= MaxFilesPerConcatf segments, and
                // several chunks or runs are joined by an ffconcat file with each chunk's exact duration.
                var chunks = new List<(string Url, double Duration)>();
                foreach (var segs in parts)
                {
                    for (int start = 0; start < segs.Count; start += FfmpegCommandBuilder.MaxFilesPerConcatf)
                    {
                        int end = Math.Min(start + FfmpegCommandBuilder.MaxFilesPerConcatf, segs.Count); // exclusive
                        var list = Temp(".txt");
                        await File.WriteAllTextAsync(list, FfmpegCommandBuilder.ConcatfList(segs.Skip(start).Take(end - start).Select(x => x.Path)), utf8, ct).ConfigureAwait(false);
                        double duration = end < segs.Count ? segs[end].StartSeconds - segs[start].StartSeconds : segs[end - 1].EndSeconds - segs[start].StartSeconds;
                        chunks.Add((FfmpegCommandBuilder.ConcatfUrl(list), duration));
                    }
                }
                if (chunks.Count == 1)
                {
                    inputUrl = chunks[0].Url;
                    isFfconcat = false;
                }
                else
                {
                    inputUrl = Temp(".ffconcat");
                    await File.WriteAllTextAsync(inputUrl, FfmpegCommandBuilder.FfconcatList(chunks.Select(c => (c.Url, (double?)c.Duration))), utf8, ct).ConfigureAwait(false);
                    isFfconcat = true;
                }
            }

            double seconds = parts.Sum(p => p.Sum(x => x.Duration));
            var args = FfmpegCommandBuilder.BuildSaveArgs(inputUrl, isFfconcat, partPath, codec, faststart: seconds <= FaststartMaxSeconds);
            // Copy time grows with size (an hour of 5K is ~90 GB; a long recording can be far more): allow 40 minutes
            // or 15 MB/s, whichever is longer.
            var timeout = TimeSpan.FromSeconds(Math.Max(40 * 60, clipBytes / (15.0 * 1024 * 1024)));
            var r = await FfmpegRunner.RunAsync(ffmpegPath, args, timeout, log, guard, ct, ProcessPriorityClass.BelowNormal).ConfigureAwait(false);
            if (!r.Ok || !File.Exists(partPath) || new FileInfo(partPath).Length == 0)
            {
                TryDelete(partPath);
                log.Error($"Saving failed (exit {r.ExitCode}{(r.TimedOut ? ", timed out" : "")}):\n{r.Tail(12)}");
                return SaveResult.Fail(ExplainSaveFailure(r));
            }
            File.Move(partPath, finalPath);
            return new SaveResult(true, finalPath, TimeSpan.FromSeconds(seconds), null, false);
        }
        finally
        {
            foreach (var f in tempFiles) TryDelete(f);
        }
    }

    private static string ExplainSaveFailure(FfmpegRunResult r)
    {
        var t = r.StdErr;
        if (t.Contains("No space left", StringComparison.OrdinalIgnoreCase) || t.Contains("disk full", StringComparison.OrdinalIgnoreCase))
            return "Saving failed: the clips drive is full.";
        if (t.Contains("Permission denied", StringComparison.OrdinalIgnoreCase) || t.Contains("Access is denied", StringComparison.OrdinalIgnoreCase))
            return "Saving failed: Windows didn't let PC Clipper write to the clips folder (Controlled folder access?). Allow PC Clipper and ffmpeg.exe, or pick another folder in Settings.";
        if (r.TimedOut) return "Saving took too long and was stopped (is the clips drive very slow or disconnected?).";
        return "Saving failed. Details are in the log (Settings > Open log folder).";
    }

    public static string UniquePath(string path)
    {
        if (!File.Exists(path) && !File.Exists(path + ".part")) return path;
        var dir = Path.GetDirectoryName(path) ?? "";
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        for (int i = 2; ; i++)
        {
            var candidate = Path.Combine(dir, $"{name} ({i}){ext}");
            if (!File.Exists(candidate) && !File.Exists(candidate + ".part")) return candidate;
        }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }

    private void DeleteDirectory(string dir)
    {
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(200);
            }
        }
        _log.Warn($"Could not fully delete {dir}; it will be cleaned up next time.");
    }

    // ------------------------------------------------------------------ stats & errors

    public EngineStats GetStats()
    {
        var s = CurrentSession();
        var run = s?.Current;
        if (s is null || run is null) return new EngineStats(0, 0, 0, 0, TimeSpan.Zero, 0, TimeSpan.Zero);
        var p = run.Progress;
        if (DateTime.UtcNow - s.BytesCheckedUtc > TimeSpan.FromSeconds(5))
        {
            s.CachedBytes = s.RunsSnapshot().Sum(r => r.Store.BytesOnDisk());
            s.BytesCheckedUtc = DateTime.UtcNow;
        }
        return new EngineStats(p.Fps, p.Speed, p.Dropped, p.Duplicated, Buffered, s.CachedBytes, run.Uptime.Elapsed);
    }

    private static Exception StartFailure(Run run, string what)
    {
        int code = -1;
        try { if (run.Process is { HasExited: true }) code = run.Process.ExitCode; } catch { }
        var (msg, retryable) = Explain(run.StderrTail(), code);
        var tail = string.Join("\n", run.StderrTail().Split('\n').Where(l => l.Contains("[error]") || l.Contains("[fatal]")).TakeLast(4));
        var text = tail.Length == 0 ? $"{msg} ({what})" : $"{msg}\n\nffmpeg said:\n{tail}";
        return retryable ? new RetryableStartException(text) : new InvalidOperationException(text);
    }

    private sealed class RetryableStartException : InvalidOperationException
    {
        public RetryableStartException(string message) : base(message) { }
    }

    /// <summary>Turn ffmpeg's last words into advice a gamer can act on, and whether a restart is worth trying.</summary>
    public static (string Message, bool Retryable) Explain(string stderrTail, int exitCode)
    {
        // The capture runs with "-loglevel level+info", so real problems are tagged [error]/[fatal]. Judge by those
        // when present; info lines mention ddagrab/pipes all the time and would cause false matches.
        var lines = stderrTail.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
        var errors = lines.Where(l => l.Contains("[error]") || l.Contains("[fatal]")).ToList();
        var focus = string.Join("\n", errors.Count > 0 ? errors : lines);
        bool Has(string s) => focus.Contains(s, StringComparison.OrdinalIgnoreCase);

        if (Has("No space left") || Has("disk full") || Has("There is not enough space"))
            return ("The buffer drive is full. Free up space or pick another drive in Settings.", false);
        if (Has("Desktop duplication access denied"))
            return ("Windows is showing a secure screen (UAC prompt or lock screen); capture resumes when it closes.", true);
        if (Has("Too many open duplication sessions"))
            return ("Too many apps are capturing the screen at once (OBS, Discord, NVIDIA overlay...). Close one of them.", true);
        if (Has("AcquireNextFrame failed") || Has("887a0026") || Has("ACCESS_LOST") || Has("ReleaseFrame failed") ||
            Has("Output parameters changed") || Has("Capture item closed") || Has("887a0005"))
            return ("Screen capture was interrupted (a resolution change, a UAC prompt or a fullscreen switch).", true);
        if (Has("Selected output not supported") || Has("Invalid output duplication argument") || Has("887a0004"))
            return ("This monitor is driven by a different graphics chip than the one PC Clipper used (common on laptops). Try Settings > Capture method > Windows Graphics Capture, or pick the encoder of the GPU this screen is plugged into.", false);
        if (Has("Failed to enumerate DXGI output"))
            return ("The selected monitor wasn't found. Pick the monitor again in Settings.", false);
        if (Has("Device creation failed") || Has("Failed to create Direct3D device") || Has("Failed to create D3D11"))
            return ("PC Clipper couldn't open your graphics card for capture. Update the graphics driver, or pick another monitor in Settings.", false);
        if (Has("Error parsing global options") || Has("Unrecognized option") || Has("Option not found") || Has("No such filter") ||
            Has("Error initializing complex filters") || Has("Error parsing filterchain") || Has("Invalid argument") && Has("filter"))
            return ("This FFmpeg build doesn't support something PC Clipper needs. Download FFmpeg again from Settings (8.1 or newer).", false);
        if (Has("Unknown encoder") || Has("Encoder not found"))
            return ("This FFmpeg build doesn't include the selected encoder. Pick another encoder in Settings, or download FFmpeg again.", false);
        if (Has("minimum required Nvidia driver") || Has("required nvenc API version") || Has("No NVENC capable devices") || Has("Cannot load nvcuda") || Has("Cannot load nvEncodeAPI"))
            return ("The NVIDIA video encoder needs a newer driver (version 570 or later). Update your NVIDIA driver, or pick another encoder in Settings.", false);
        if (Has("OpenEncodeSessionEx failed") || Has("incompatible client key") || Has("out of memory (10)"))
            return ("The NVIDIA encoder is busy (another recorder such as the NVIDIA overlay, OBS or Discord may be using it) or these settings are too heavy. Close other recorders or lower the quality.", true);
        if (Has("Format of input frames context") && Has("AMF"))
            return ("This FFmpeg is too old for AMD capture. Download FFmpeg again from Settings (8.1 or newer).", false);
        if (Has("Provided device doesn't support") || Has("exceeds") || Has("InitializeEncoder failed") || Has("Error while opening encoder") ||
            Has("Error initializing output stream") || Has("Width") && Has("not supported"))
            return ("Your graphics card's encoder can't handle these settings (size, frame rate or codec). Lower the resolution or frame rate, or switch codec in Settings.", false);
        if (Has("AMF") && (Has("failed") || Has("error")))
            return ("The AMD video encoder could not start. Update your AMD driver, or pick another encoder in Settings.", false);
        if ((Has("qsv") || Has("MFX") || Has("libvpl")) && (Has("failed") || Has("error")))
            return ("The Intel Quick Sync encoder could not start. Update your Intel graphics driver, or pick another encoder in Settings.", false);
        if (Has("Could not open duplication") || Has("DuplicateOutput") || Has("DXGI_ERROR_UNSUPPORTED") || Has("Failed to create D3D11"))
            return ("Windows refused to share this monitor's picture. Update your graphics driver, or choose another monitor or capture method in Settings.", true);
        if (Has("Permission denied") || Has("Error opening output") || Has("Access is denied"))
            return ("PC Clipper can't write to the buffer folder. Pick another folder in Settings.", false);
        // Only quote ffmpeg when it actually reported an error; an info line would just confuse.
        var last = errors.LastOrDefault() ?? "";
        return (last.Length == 0
            ? $"The video engine stopped unexpectedly (code {exitCode})."
            : $"The video engine stopped unexpectedly: {last}", true);
    }

    private void SetState(EngineState state)
    {
        lock (_gate)
        {
            if (_state == state) return;
            _state = state;
        }
        try { StateChanged?.Invoke(state); }
        catch (Exception ex) { _log.Error("StateChanged handler threw", ex); }
    }

    public void Dispose()
    {
        try { StopAsync().Wait(TimeSpan.FromSeconds(30)); }
        catch (Exception ex) { _log.Warn($"Dispose: {ex.Message}"); }
    }

    // ------------------------------------------------------------------ session / run state

    /// <summary>One buffer: a folder with one sub-folder per ffmpeg run.</summary>
    private sealed class Session
    {
        private readonly List<Run> _runs = new();
        private readonly object _lock = new();

        public Session(string dir, string bufferRoot, int bufferSeconds)
        {
            Dir = dir;
            BufferRoot = Path.GetFullPath(bufferRoot);
            BufferSeconds = bufferSeconds;
        }

        public string Dir { get; }
        public string BufferRoot { get; }
        public int BufferSeconds { get; set; }
        public int NextRunNumber;
        public Timer? Janitor;
        public int InJanitor;
        public int JanitorTicks;
        public int ActiveOps;
        public bool KeepFolder;
        public readonly List<Recording> PendingRecordings = new();
        public long CachedBytes;
        public DateTime BytesCheckedUtc = DateTime.MinValue;

        public Run? Current { get { lock (_lock) return _runs.Count == 0 ? null : _runs[^1]; } }
        public void AddRun(Run run) { lock (_lock) _runs.Add(run); }
        public void RemoveRun(Run run) { lock (_lock) _runs.Remove(run); }
        public IReadOnlyList<Run> RunsSnapshot() { lock (_lock) return _runs.ToArray(); }

        /// <summary>The newest run and the runs before it that can be stream-copied together with it.</summary>
        public IReadOnlyList<Run> CompatibleRunsNewestFirst()
        {
            lock (_lock)
            {
                var result = new List<Run>();
                if (_runs.Count == 0) return result;
                var sig = _runs[^1].Config.Signature;
                for (int i = _runs.Count - 1; i >= 0 && _runs[i].Config.Signature == sig; i--) result.Add(_runs[i]);
                return result;
            }
        }
    }

    /// <summary>One ffmpeg process and its segments.</summary>
    internal sealed class Run
    {
        public Run(int number, CaptureConfig cfg, SegmentStore store)
        {
            Number = number;
            Config = cfg;
            Store = store;
        }

        public int Number { get; }
        public CaptureConfig Config { get; }
        public SegmentStore Store { get; }
        public Process? Process;
        public IPcmSink? Sink;
        public Task? SinkConnected;
        public List<IAudioSource> Sources = new();
        public AudioMixerPump? Pump;
        public long AnchorTimestamp;
        public int ExitHandled;
        public string AnchorInfo = "";
        public readonly Stopwatch ConnectedClock = new();
        public readonly CancellationTokenSource Cts = new();
        public readonly Stopwatch Uptime = Stopwatch.StartNew();
        public volatile bool Stopping;
        public string? FaultReason;
        public bool FaultNotRetryable;
        public long LastNewSegmentMs = Environment.TickCount64;
        public ProgressInfo Progress = new(0, 0, 0, 0);

        private readonly TaskCompletionSource _exited = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task ExitedTask => _exited.Task;
        public void MarkExited()
        {
            _exited.TrySetResult();
            try { Cts.Cancel(); } catch { }
        }

        private readonly LinkedList<string> _tail = new();
        private readonly Dictionary<string, string> _progressFields = new();

        public void AddStderr(string line)
        {
            lock (_tail)
            {
                _tail.AddLast(line);
                while (_tail.Count > 60) _tail.RemoveFirst();
            }
        }

        public string StderrTail(int lines = 60)
        {
            lock (_tail) return string.Join("\n", _tail.TakeLast(lines));
        }

        /// <summary>Parses "-progress pipe:1" key=value blocks.</summary>
        public void OnProgress(string? line)
        {
            if (string.IsNullOrEmpty(line)) return;
            int eq = line.IndexOf('=');
            if (eq <= 0) return;
            var key = line[..eq].Trim();
            var value = line[(eq + 1)..].Trim();
            if (key != "progress")
            {
                _progressFields[key] = value;
                return;
            }
            double Num(string k)
            {
                if (!_progressFields.TryGetValue(k, out var v)) return 0;
                v = v.TrimEnd('x');
                return double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;
            }
            Progress = new ProgressInfo(Num("fps"), Num("speed"), (long)Num("drop_frames"), (long)Num("dup_frames"));
        }

        public void DisposeAudio()
        {
            try { Pump?.Stop(); } catch { }
            foreach (var src in Sources)
            {
                try { src.Stop(); } catch { }
                try { src.Dispose(); } catch { }
            }
            Sources = new();
            try { Sink?.Dispose(); } catch { }
        }
    }

    internal sealed record ProgressInfo(double Fps, double Speed, long Dropped, long Duplicated);

    /// <summary>A manual recording: where it began, and the pins that keep its segments on disk.</summary>
    public sealed class Recording : IDisposable
    {
        private readonly Guid _id = Guid.NewGuid();

        internal Recording(Run startRun, int startIndex, DateTime startedLocal)
        {
            StartRun = startRun;
            StartIndex = startIndex;
            StartedLocal = startedLocal;
            Pins.Add(startRun.Store.PinFrom(startIndex));
            Clock.Start();
        }
        internal Run StartRun { get; }
        internal int StartIndex { get; }
        /// <summary>When the user pressed Record (for the file name).</summary>
        public DateTime StartedLocal { get; }
        internal List<IDisposable> Pins { get; } = new();
        internal Stopwatch Clock { get; } = new();
        internal TimeSpan ClockOffset { get; init; }
        internal bool SpaceStopRequested { get; set; }
        /// <summary>Set once the recording stopped: exactly the footage it contains.</summary>
        internal IReadOnlyList<SavePart>? Frozen { get; private set; }
        internal string? ManifestDir { get; set; }

        internal string ManifestPath(string sessionDir) => Path.Combine(sessionDir, $"recording-{_id:N}{SegmentStore.KeepMarkerSuffix}");

        /// <summary>Swap the open-ended pins for exact ones, so footage after Stop isn't held.</summary>
        internal void Freeze(IReadOnlyList<SavePart> parts)
        {
            var exact = parts.Select(p => p.Run.Store.Pin(p.Segments)).ToList();
            foreach (var p in Pins) p.Dispose();
            Pins.Clear();
            Pins.AddRange(exact);
            Frozen = parts;
        }

        /// <summary>The recording is saved (or not needed): release its footage and its recovery note.</summary>
        public void Dispose()
        {
            foreach (var p in Pins) p.Dispose();
            Pins.Clear();
            if (ManifestDir is { } dir)
            {
                try { File.Delete(ManifestPath(dir)); } catch { }
            }
        }
    }
}
