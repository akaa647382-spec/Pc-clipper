// Linux integration harness for PC Clipper's engine.
// Runs the real ReplayEngine against an ffmpeg test source that is stamped like ddagrab (wall clock since the first
// frame) and flashes white on every absolute 5-second wall-clock boundary, plus an audio source that beeps on the same
// boundaries. The A/V offset measured in saved clips is therefore the pipeline's true offset.
// Usage: dotnet run --project tests/PcClipper.Harness -- [quick]
using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using PcClipper.Core;

var quick = args.Contains("quick");
var root = Path.Combine(Path.GetTempPath(), "pcclipper-harness");
if (Directory.Exists(root)) Directory.Delete(root, true);
Directory.CreateDirectory(root);
var log = new ConsoleLog();
var results = new List<(string Name, bool Ok, string Detail)>();

void Check(string name, bool ok, string detail = "")
{
    results.Add((name, ok, detail));
    Console.ForegroundColor = ok ? ConsoleColor.Green : ConsoleColor.Red;
    Console.WriteLine($"{(ok ? "PASS" : "FAIL")}  {name}  {detail}");
    Console.ResetColor();
}

var clips = Path.Combine(root, "clips");
Directory.CreateDirectory(clips);
int autoNameCounter = 0;
long fakeFreeBytes = 0; // 0 = real free space
var env = new EngineEnvironment
{
    Log = log,
    GetFreeBytes = path => fakeFreeBytes > 0 && path.Contains("clips") ? fakeFreeBytes : EngineEnvironment.DefaultFreeBytes(path),
    CreatePcmSink = () => new FifoPcmSink(Path.Combine(root, $"audio-{Guid.NewGuid():N}.fifo")),
    CreateAudioSources = cfg => new IAudioSource[] { new BeepSource() },
    RecordingPathFactory = () => Path.Combine(clips, $"auto-recording-{Interlocked.Increment(ref autoNameCounter)}.mp4"),
};

var monitor = new MonitorInfo(0, 0, "TEST", "Test screen", 1280, 720, 60, 0, "Test GPU", true);
const string TestSource =
    "testsrc2=size=1280x720:rate=60,realtime,settb=1/1000000,setpts=RTCTIME," +
    "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,5),0.1)',setpts=PTS-STARTPTS";

// setpts strip_fps is FFmpeg 7.1+; the app requires 8.1, this box may have an older ffmpeg.
bool stripFps = Probe.SupportsStripFps();
Console.WriteLine($"ffmpeg setpts strip_fps: {(stripFps ? "yes" : "no (older ffmpeg; per-slot graphs run without it)")}");

CaptureConfig Config(VideoCodec codec, int bufferSeconds, bool audio = true) => new()
{
    StripFrameRateTag = stripFps,
    FfmpegPath = "ffmpeg",
    BufferRoot = Path.Combine(root, "buffer"),
    Monitor = monitor,
    Width = 1280,
    Height = 720,
    Fps = 60,
    Vendor = EncoderVendor.Cpu,
    Codec = codec,
    EncoderName = QualityMath.EncoderName(EncoderVendor.Cpu, codec),
    BitrateKbps = 4000,
    BufferSeconds = bufferSeconds,
    DesktopAudio = audio,
    TestVideoSource = TestSource,
};

// ---------------------------------------------------------------- pure checks
{
    var (w, h) = QualityMath.TargetSize(ResolutionPreset.P2880, 5120, 2880);
    Check("5K target size on a 5K monitor", w == 5120 && h == 2880, $"{w}x{h}");
    var (nw, nh) = QualityMath.TargetSize(ResolutionPreset.P2880, 2560, 1440);
    Check("never upscales: 5K on a 1440p monitor records at 1440p", nw == 2560 && nh == 1440, $"{nw}x{nh}");
    var (uw, uh) = QualityMath.TargetSize(ResolutionPreset.P1080, 3440, 1440);
    Check("ultrawide aspect kept", uw == 2580 && uh == 1080, $"{uw}x{uh}");
    int kbps = QualityMath.BitrateKbps(QualityLevel.High, 0, 1920, 1080, 60, VideoCodec.H264);
    Check("bitrate anchor 1080p60 H.264 High = 35 Mbps", kbps == 35000, $"{kbps}");
    var gpuCaps = new FfmpegCapabilities
    {
        Encoders = new HashSet<string> { "libx264", "hevc_nvenc", "h264_nvenc" },
        WorkingEncoders = new HashSet<string> { "hevc_nvenc", "h264_nvenc", "libx264" },
        HasDdagrab = true, HasScaleD3D11 = true, HasGfxCapture = true,
    };
    Check("5K never uses H.264", QualityMath.ResolveCodec(VideoCodec.H264, EncoderVendor.Nvidia, 5120, gpuCaps) == VideoCodec.Hevc);
    Check("Auto vendor follows monitor GPU", QualityMath.ResolveVendor(EncoderVendor.Auto, MonitorInfo.VendorNvidia, gpuCaps) == EncoderVendor.Nvidia);
    Check("fps capped at monitor refresh",
        QualityMath.EffectiveFps(120, monitor with { RefreshHz = 60 }) == 60 && QualityMath.EffectiveFps(120, monitor with { RefreshHz = 144 }) == 120);
    Check("Auto capture method off Windows 11 stays Desktop Duplication",
        QualityMath.ResolveMethod(CaptureMethod.Auto, 120, monitor with { MonitorHandle = 1 }, gpuCaps) == CaptureMethod.DesktopDuplication);
    Check("WGC needs a monitor handle", QualityMath.ResolveMethod(CaptureMethod.WindowsGraphicsCapture, 60, monitor, gpuCaps) == CaptureMethod.DesktopDuplication);
    Check("Explain ignores info lines", ReplayEngine.Explain("[Parsed_ddagrab_0 @ 1] [info] Opened\n[hevc_nvenc @ 2] [error] OpenEncodeSessionEx failed: out of memory (10)", 1).Message.Contains("busy"));
    Check("Explain: ACCESS_LOST is retryable", ReplayEngine.Explain("[Parsed_ddagrab_0 @ 1] [error] AcquireNextFrame failed: 887a0026", 1).Retryable);
    Check("Explain: driver too old", ReplayEngine.Explain("[h264_nvenc @ 1] [error] The minimum required Nvidia driver for nvenc is 570.0 or newer", 1).Message.Contains("570"));
    Check("anchor line regex", FfmpegCommandBuilder.AnchorLineRegex().IsMatch("[warning] 1762101234567890.000000") &&
                               FfmpegCommandBuilder.AnchorLineRegex().IsMatch("1762101234567890.000000"));

    // A real 5K NVIDIA command line must contain the pieces the research says are required.
    var nv = new CaptureConfig
    {
        FfmpegPath = "ffmpeg.exe", BufferRoot = "C:/b", Monitor = monitor with { Width = 2560, Height = 1440, AdapterIndex = 1, OutputIndex = 0 },
        Width = 5120, Height = 2880, Fps = 120, Vendor = EncoderVendor.Nvidia, Codec = VideoCodec.Hevc, EncoderName = "hevc_nvenc",
        BitrateKbps = 200000, BufferSeconds = 3600, DesktopAudio = true,
    };
    var cmd = string.Join(" ", FfmpegCommandBuilder.BuildCaptureArgs(nv, @"\\.\pipe\x"));
    Check("NVENC 5K command line", cmd.Contains("d3d11va=dda:1") && cmd.Contains("ddagrab=output_idx=0:framerate=666:") && cmd.Contains("round(t*120)") &&
        cmd.Contains("scale_d3d11=width=5120:height=2880:format=nv12") && cmd.Contains("split_encode_mode") &&
        cmd.Contains("-nofind_stream_info") && cmd.Contains("atrim=start_sample=12000") && cmd.Contains("setts=ts=TS-0.25/TB") &&
        !cmd.Contains("thread_queue_size") && cmd.Contains(FfmpegCommandBuilder.AnchorFilter), cmd.Length > 160 ? cmd[..160] + "..." : cmd);
    var ddaGraph = FfmpegCommandBuilder.VideoGraph(nv.With(b => b.Fps = 60), anchor: true, uniqueFramesProbe: false);
    Check("Desktop Duplication is event-driven and picks one frame per slot (no fps filter, no repeats)",
        ddaGraph.Contains("framerate=666:") && ddaGraph.Contains("dup_frames=0") && !ddaGraph.Contains(",fps=") &&
        ddaGraph.Contains("round(t*60)") && ddaGraph.Contains("round(T*60)") && ddaGraph.EndsWith("setpts=PTS:strip_fps=1") &&
        nv.PausesOnStillScreen && cmd.Contains("-enc_time_base:v 1/120"), ddaGraph);
    var classic = nv.With(b => { b.Fps = 60; b.TimerPacedCapture = true; b.PausesOnStillScreen = false; });
    var classicGraph = FfmpegCommandBuilder.VideoGraph(classic, anchor: true, uniqueFramesProbe: false);
    Check("classic timing is the 1.0.1 graph", classicGraph.Contains("framerate=60:") && classicGraph.Contains("dup_frames=1") &&
        classicGraph.Contains(",fps=60") && !classicGraph.Contains("select=") && !classic.PausesOnStillScreen && !classic.PicksFramesPerSlot,
        classicGraph);
    Check("concatf list quoting", FfmpegCommandBuilder.ConcatfList(new[] { @"C:\it's\seg.ts" }) == "'C:/it'\\''s/seg.ts'\n");
}

// ---------------------------------------------------------------- controller chords
{
    var det = new ChordDetector();
    det.SetBindings(new Dictionary<PadAction, PadChord>
    {
        [PadAction.SaveReplay] = PadChord.Of(PadButtons.View, PadButtons.A),
        [PadAction.ToggleRecording] = PadChord.Of(PadButtons.View, PadButtons.X),
        [PadAction.Screenshot] = PadChord.Off,
    });
    bool none1 = det.Update("p1", PadButtons.A, 0).Count == 0;                        // A alone: nothing
    bool none2 = det.Update("p1", PadButtons.None, 10).Count == 0;
    bool none3 = det.Update("p1", PadButtons.View, 20).Count == 0;                    // hold View
    var fire = det.Update("p1", PadButtons.View | PadButtons.A, 30);                  // + A -> save
    bool noRepeat = det.Update("p1", PadButtons.View | PadButtons.A, 40).Count == 0;   // still held: no repeat
    var otherPad = det.Update("p2", PadButtons.View | PadButtons.X, 50);                  // other pad, same instant: record
    bool guard = det.Update("p1", PadButtons.View, 60).Count == 0 && det.Update("p1", PadButtons.View | PadButtons.A, 70).Count == 0; // within guard
    var later = det.Update("p1", PadButtons.View, 2000).Concat(det.Update("p1", PadButtons.View | PadButtons.A, 2010)).ToList();
    Check("controller chord: hold View + press A saves, once, per pad, with repeat guard",
        none1 && none2 && none3 && fire.SequenceEqual(new[] { PadAction.SaveReplay }) && noRepeat &&
        otherPad.SequenceEqual(new[] { PadAction.ToggleRecording }) && guard && later.SequenceEqual(new[] { PadAction.SaveReplay }));
    Check("PlayStation labels", PadLabels.Describe(PadChord.Of(PadButtons.View, PadButtons.A), true) == "Hold Create/Share + press Cross" &&
                                PadLabels.Describe(PadChord.Of(PadButtons.View, PadButtons.A), false) == "Hold View + press A",
        PadLabels.Describe(PadChord.Of(PadButtons.View, PadButtons.A), true));
    var json = System.Text.Json.JsonSerializer.Serialize(new AppSettings());
    var back = System.Text.Json.JsonSerializer.Deserialize<AppSettings>(json)!;
    Check("clip length names", QualityMath.FormatClipLength(TimeSpan.FromSeconds(40.9)) == "40 sec" &&
        QualityMath.FormatClipLength(TimeSpan.FromSeconds(432.2)) == "7 min 12 sec" && QualityMath.FormatClipLength(TimeSpan.FromSeconds(900)) == "15 min" &&
        QualityMath.FormatClipLength(TimeSpan.FromSeconds(3600)) == "1 hour");
    Check("controller shortcuts survive settings save/load", back.PadSaveReplay.SameAs(PadChord.Of(PadButtons.View, PadButtons.A)) && back.ControllerShortcuts);
}

// ---------------------------------------------------------------- drift correction (simulated, faster than real time)
{
    var fifo = new DriftFifo();
    var buf = new float[480 * 2];
    double owed = 0;
    for (int tick = 0; tick < 30000; tick++) // 5 minutes of 10 ms ticks
    {
        owed += 480 * 1.0005; // device clock 500 ppm fast
        int n = (int)owed;
        owed -= n;
        fifo.Write(new float[n * 2]);
        fifo.Read(buf, 480);
    }
    Check("drift FIFO holds a +500 ppm device steady", fifo.FillMs < 60 && fifo.UnderrunCount <= 1 && fifo.OverflowDroppedFrames == 0,
        $"fill {fifo.FillMs:0.0} ms, ratio {fifo.CurrentRatio:0.000000}, underruns {fifo.UnderrunCount}");
}

// ---------------------------------------------------------------- sync diagnostics only: dotnet run -- sync
if (args.Contains("sync"))
{
    BeepSource? beep = null;
    var tapPath = Path.Combine(root, "tap.f32");
    var diagEnv = new EngineEnvironment
    {
        Log = log, CreatePcmSink = () => new TeeSink(env.CreatePcmSink(), tapPath),
        CreateAudioSources = cfg => new IAudioSource[] { beep = new BeepSource() },
    };
    var e = new ReplayEngine(diagEnv);
    int latency = int.TryParse(Environment.GetEnvironmentVariable("PCCLIPPER_LATENCY"), out var l) ? l : 45;
    var cfgSync = new CaptureConfig
    {
        FfmpegPath = "ffmpeg", BufferRoot = Path.Combine(root, "buffer"), Monitor = monitor, Width = 1280, Height = 720, Fps = 60,
        Vendor = EncoderVendor.Cpu, Codec = VideoCodec.H264, EncoderName = "libx264", BitrateKbps = 4000, BufferSeconds = 60,
        DesktopAudio = true, TestVideoSource = TestSource, StripFrameRateTag = stripFps, AudioLatencyMs = latency,
    };
    await e.StartAsync(cfgSync);
    int samples = int.TryParse(Environment.GetEnvironmentVariable("PCCLIPPER_SYNC_TICKS"), out var t) ? t : 30;
    for (int i = 0; i < samples; i++)
    {
        await Task.Delay(2000);
        if (beep is not null) Console.WriteLine($"SYNC fill {beep.FillMs:0.0} ms ratio {beep.Ratio:0.000000} underruns {beep.Underruns}");
    }
    var r = await e.SaveLastAsync(TimeSpan.FromSeconds(samples * 2 - 6), Path.Combine(clips, "sync.mp4"));
    var offs = Probe.AvOffsets(r.Path!);
    Console.WriteLine("SYNC offsets ms: " + string.Join(", ", offs.Select(o => (o * 1000).ToString("0"))));
    await e.StopAsync();
    return 0;
}

// ---------------------------------------------------------------- main scenario (H.264 + audio)
var engine = new ReplayEngine(env);
var problems = new List<string>();
var autoSaved = new List<SaveResult>();
engine.Problem += p => { lock (problems) problems.Add(p); };
engine.RecordingAutoSaved += r => { lock (autoSaved) autoSaved.Add(r); };

int bufferSeconds = quick ? 20 : 40;
int runSeconds = quick ? 30 : 70;

var stale = Path.Combine(root, "buffer", "session_20200101_000000_deadbeef");
Directory.CreateDirectory(stale);
File.WriteAllText(Path.Combine(stale, "x.ts"), "x");

var sw = Stopwatch.StartNew();
await engine.StartAsync(Config(VideoCodec.H264, bufferSeconds));
Check("engine running", engine.State == EngineState.Running, $"start took {sw.ElapsedMilliseconds} ms");
Check("stale session removed", !Directory.Exists(stale));

// Like PlayStation: a length can't be saved before that much has been recorded (the UI greys it out; the engine refuses).
bool earlyNamed = false;
var earlyPath = Path.Combine(clips, "early.mp4");
var early = await engine.SaveLastAsync(TimeSpan.FromSeconds(15), _ => { earlyNamed = true; return earlyPath; }, TimeSpan.FromSeconds(15));
Check("a save before 15 s are recorded is refused and writes nothing",
    !early.Success && early.NotEnoughRecorded && !earlyNamed && !File.Exists(earlyPath) && early.Available.TotalSeconds < 15 &&
    engine.Buffered.TotalSeconds < 15,
    $"{early.ErrorMessage} available={early.Available.TotalSeconds:0.0} buffered={engine.Buffered.TotalSeconds:0.0}");

await Task.Delay(TimeSpan.FromSeconds(runSeconds / 2.0));
Check("recording starts", engine.StartRecording());
await Task.Delay(TimeSpan.FromSeconds(12));
var rec = await engine.StopRecordingAsync(Path.Combine(clips, "recording.mp4"));
var recDur = rec.Success ? Probe.Duration(rec.Path!) : 0;
Check("recording saved ~12-16 s", rec.Success && recDur >= 11.5 && recDur <= 17, $"{rec.ErrorMessage} dur={recDur:0.00}");

await Task.Delay(TimeSpan.FromSeconds(runSeconds / 2.0));
var stats = engine.GetStats();
var sessionDir = Directory.GetDirectories(Path.Combine(root, "buffer")).Single();
var run0 = Path.Combine(sessionDir, "run_000");
int segFiles = Directory.GetFiles(run0, "seg_*").Length;
int maxExpected = bufferSeconds / 2 + 2 + 2 + 1;
Check("janitor keeps the buffer bounded", segFiles <= maxExpected, $"{segFiles} segment files (max {maxExpected}), fps={stats.Fps} speed={stats.Speed}");
Check("video keeps full frame rate with audio attached", stats.Fps >= 57, $"fps={stats.Fps}");
Check("buffered capped at buffer length", Math.Abs(engine.Buffered.TotalSeconds - bufferSeconds) < 2.5, $"{engine.Buffered.TotalSeconds:0.0}s");
// The longest length unlocks once the buffer is full: Buffered must reach it exactly, not stop just short.
Check("a full buffer reports its whole length (the longest button unlocks)",
    engine.Buffered.TotalSeconds >= bufferSeconds - SegmentStore.SelectionSlackSeconds, $"{engine.Buffered.TotalSeconds:0.000}s");
TimeSpan? wholePicked = null;
var whole = await engine.SaveLastAsync(TimeSpan.FromSeconds(bufferSeconds),
    got => { wholePicked = got; return Path.Combine(clips, "whole.mp4"); }, TimeSpan.FromSeconds(bufferSeconds));
var dWhole = whole.Success ? Probe.Duration(whole.Path!) : 0;
Check("a strict save of the whole buffer works and is named from the footage it picked",
    whole.Success && Math.Abs(dWhole - bufferSeconds) <= 3 && wholePicked is { } wp && Math.Abs(wp.TotalSeconds - dWhole) < 0.6,
    $"{whole.ErrorMessage} dur={dWhole:0.00} picked={wholePicked?.TotalSeconds:0.00}");
TimeSpan? shortcutPicked = null;
var shortcut = await engine.SaveLastAsync(TimeSpan.FromMinutes(15),
    got => { shortcutPicked = got; return Path.Combine(clips, "shortcut.mp4"); }, TimeSpan.FromSeconds(15));
var dShortcut = shortcut.Success ? Probe.Duration(shortcut.Path!) : 0;
Check("a shortcut asking for more than is recorded saves all of it and names it by its real length",
    shortcut.Success && shortcut.ShorterThanRequested && shortcutPicked is { } sp && Math.Abs(sp.TotalSeconds - dShortcut) < 0.6 &&
    QualityMath.FormatClipLength(sp) != QualityMath.FormatSaveLength(900),
    $"{shortcut.ErrorMessage} dur={dShortcut:0.00} name={(shortcutPicked is { } spn ? QualityMath.FormatClipLength(spn) : "-")}");
var someSeg = Directory.GetFiles(run0, "seg_*").OrderBy(f => f).SkipLast(2).Last(); // recent: old ones get deleted
Check("a single segment decodes on its own (headers repeated)", Probe.DecodeErrors(someSeg).Length == 0 && Probe.Frames(someSeg) > 60, Path.GetFileName(someSeg));

var short15 = await engine.SaveLastAsync(TimeSpan.FromSeconds(15), Path.Combine(clips, "last15.mp4"));
var d15 = short15.Success ? Probe.Duration(short15.Path!) : 0;
Check("save last 15 s", short15.Success && d15 >= 14.5 && d15 <= 18.5 && !short15.ShorterThanRequested, $"{short15.ErrorMessage} dur={d15:0.00}");

var longAsk = await engine.SaveLastAsync(TimeSpan.FromMinutes(5), Path.Combine(clips, "last5min.mp4"));
var dLong = longAsk.Success ? Probe.Duration(longAsk.Path!) : 0;
Check("save longer than buffer gives the whole buffer", longAsk.Success && longAsk.ShorterThanRequested && Math.Abs(dLong - bufferSeconds) <= 3.5, $"dur={dLong:0.00}");

var t1 = engine.SaveLastAsync(TimeSpan.FromSeconds(10), Path.Combine(clips, "a.mp4"));
var t2 = engine.SaveLastAsync(TimeSpan.FromSeconds(10), Path.Combine(clips, "a.mp4"));
var both = await Task.WhenAll(t1, t2);
Check("concurrent saves both succeed with unique names", both.All(r => r.Success) && both[0].Path != both[1].Path, string.Join(" | ", both.Select(b => Path.GetFileName(b.Path))));

if (longAsk.Success)
{
    var streams = Probe.Streams(longAsk.Path!);
    Check("clip has h264 video + aac audio", streams.Contains("h264") && streams.Contains("aac"), streams);
    var decodeErrors = Probe.DecodeErrors(longAsk.Path!);
    Check("clip decodes without errors", decodeErrors.Length == 0, decodeErrors.Length > 200 ? decodeErrors[..200] : decodeErrors);
    Check("clip starts at 0", Math.Abs(Probe.StartTime(longAsk.Path!)) < 0.1, $"start={Probe.StartTime(longAsk.Path!)}");
    Check("no audio gaps at segment joins", Probe.AudioGaps(longAsk.Path!) == 0, $"{Probe.AudioGaps(longAsk.Path!)} gaps");
    var sync = Probe.AvOffsets(longAsk.Path!);
    if (sync.Count >= 2)
    {
        var median = sync.OrderBy(o => o).ElementAt(sync.Count / 2);
        var core = sync.Where(o => Math.Abs(o - median) < 0.1).ToList();
        double spread = core.Max() - core.Min();
        Check("A/V offset stable across the clip (no drift)", spread < 0.015 && core.Count >= sync.Count * 0.7,
            $"offsets ms: {string.Join(", ", sync.Select(o => (o * 1000).ToString("0")))}");
        // The meter itself reads ~8 ms negative (a flash is only seen on the next 60 fps frame).
        Check("A/V offset within ±30 ms (anchored to video pts 0)", Math.Abs(median) < 0.030, $"median {median * 1000:0} ms (audio minus video, meter bias ~-8)");
    }
    else Check("A/V markers found", false, $"found {sync.Count}");
}

// ---------------------------------------------------------------- chunked saves (long recordings / Windows open-file limit)
FfmpegCommandBuilder.MaxFilesPerConcatf = 5;
int chunkAsk = Math.Min(30, bufferSeconds);
var chunked = await engine.SaveLastAsync(TimeSpan.FromSeconds(chunkAsk), Path.Combine(clips, "chunked.mp4"));
FfmpegCommandBuilder.MaxFilesPerConcatf = 1000;
var dChunk = chunked.Success ? Probe.Duration(chunked.Path!) : 0;
Check("save in 5-segment chunks: right length, decodes, no audio gaps",
    chunked.Success && dChunk >= chunkAsk - 0.5 && dChunk <= chunkAsk + 3 && Probe.DecodeErrors(chunked.Path!).Length == 0 && Probe.AudioGaps(chunked.Path!) == 0,
    $"{chunked.ErrorMessage} dur={dChunk:0.00} gaps={(chunked.Success ? Probe.AudioGaps(chunked.Path!) : -1)}");

// ---------------------------------------------------------------- a failed recording save keeps the footage
Check("recording for the failure test", engine.StartRecording());
await Task.Delay(TimeSpan.FromSeconds(6));
fakeFreeBytes = 1L << 20; // "1 MB free" on the clips drive
var failedRec = await engine.StopRecordingAsync(Path.Combine(clips, "should-fail.mp4"));
Check("recording save fails cleanly when the drive is full", !failedRec.Success && failedRec.ErrorMessage!.Contains("Not enough space") && engine.PendingRecordingCount == 1,
    failedRec.ErrorMessage ?? "");
await Task.Delay(TimeSpan.FromSeconds(bufferSeconds + 6)); // long enough for the janitor to delete unpinned footage
{
    // The pending recording's few segments stay, but the buffer around them must keep expiring normally.
    var liveRun = Directory.GetDirectories(Directory.GetDirectories(Path.Combine(root, "buffer")).Single(), "run_*").OrderBy(d => d).Last();
    int onDisk = Directory.GetFiles(liveRun, "seg_*").Length;
    Check("a pending recording doesn't stop the buffer from expiring", onDisk <= bufferSeconds / 2 + 12, $"{onDisk} segment files");
}
fakeFreeBytes = 0;
var retried = await engine.RetryPendingRecordingsAsync(_ => Path.Combine(clips, "retried.mp4"));
var dRetry = retried.Count == 1 && retried[0].Success ? Probe.Duration(retried[0].Path!) : 0;
// Upper bound: a stopped recording must not grow with footage recorded after Stop.
Check("pending recording survives the janitor, saves on retry, and ends where Stop was pressed",
    dRetry >= 5.5 && dRetry <= 12 && engine.PendingRecordingCount == 0, $"dur={dRetry:0.0}");

// ---------------------------------------------------------------- live buffer length
engine.SetBufferSeconds(bufferSeconds + 20);
await Task.Delay(TimeSpan.FromSeconds(6));
Check("buffer length change applies without a restart", engine.Buffered.TotalSeconds > bufferSeconds + 1 && engine.State == EngineState.Running,
    $"{engine.Buffered.TotalSeconds:0}s");
engine.SetBufferSeconds(bufferSeconds);

// ---------------------------------------------------------------- crash -> restart keeps the buffer
Check("recording starts before the crash", engine.StartRecording());
await Task.Delay(TimeSpan.FromSeconds(4));
KillCapture(sessionDir);
await Task.Delay(1500);
Check("unexpected ffmpeg exit -> Faulted + Problem", engine.State == EngineState.Faulted && problems.Count > 0, problems.LastOrDefault() ?? "");
var afterCrash = await engine.SaveLastAsync(TimeSpan.FromSeconds(10), Path.Combine(clips, "after-crash.mp4"));
Check("can still save while faulted", afterCrash.Success, afterCrash.ErrorMessage ?? "");
var bufferedBefore = engine.Buffered;
// Simulate a game that switched the screen to 1600x900: a fresh resolve would now ask for 1600x900.
var changedScreen = new CaptureConfig
{
    FfmpegPath = "ffmpeg", BufferRoot = Path.Combine(root, "buffer"), Monitor = monitor with { Width = 1600, Height = 900 },
    Width = 1600, Height = 900, Fps = 60, Vendor = EncoderVendor.Cpu, Codec = VideoCodec.H264, EncoderName = "libx264",
    BitrateKbps = 4000, BufferSeconds = bufferSeconds, DesktopAudio = true, TestVideoSource = TestSource, StripFrameRateTag = stripFps,
};
await engine.ResumeAsync(changedScreen); // supervised resume: keeps the buffer and its format
Check("resume keeps the buffer's format when the screen changed", engine.ActiveConfig is { Width: 1280, Height: 720 },
    $"{engine.ActiveConfig?.Width}x{engine.ActiveConfig?.Height}");
await Task.Delay(TimeSpan.FromSeconds(8));
Check("restart continues the buffer", engine.Buffered > bufferedBefore - TimeSpan.FromSeconds(1) && Directory.Exists(Path.Combine(sessionDir, "run_001")),
    $"before {bufferedBefore.TotalSeconds:0}s after {engine.Buffered.TotalSeconds:0}s");
var spanning = await engine.SaveLastAsync(TimeSpan.FromSeconds(bufferSeconds), Path.Combine(clips, "spanning.mp4"));
var dSpan = spanning.Success ? Probe.Duration(spanning.Path!) : 0;
Check("save spans the restart", spanning.Success && dSpan >= bufferSeconds - 4 && Probe.DecodeErrors(spanning.Path!).Length == 0, $"{spanning.ErrorMessage} dur={dSpan:0.0}");
var recAcross = await engine.StopRecordingAsync(Path.Combine(clips, "recording-across-crash.mp4"));
var dRecAcross = recAcross.Success ? Probe.Duration(recAcross.Path!) : 0;
Check("recording survives the restart", recAcross.Success && dRecAcross >= 10, $"{recAcross.ErrorMessage} dur={dRecAcross:0.0}");

await engine.StopAsync();
Check("stop deletes the buffer", !Directory.Exists(sessionDir) && engine.State == EngineState.Off);

await engine.StartAsync(Config(VideoCodec.H264, 30));
Check("recording before stop", engine.StartRecording());
await Task.Delay(TimeSpan.FromSeconds(6));
await engine.StopAsync();
Check("turning the buffer off auto-saves a running recording", autoSaved.Count == 1 && autoSaved[0].Success && File.Exists(autoSaved[0].Path),
    autoSaved.FirstOrDefault()?.Path ?? "none");

// ---------------------------------------------------------------- still screen
// Real capture sends nothing while the screen is still. Emulate it: a writer feeds a FIFO at 60 fps, frames are stamped
// on arrival (like ddagrab), and the writer is frozen with SIGSTOP. With fps=F after such a source (the first 1.0.2 draft)
// the pause came out as a burst of repeats afterwards and the first seconds of motion after it were lost; the per-slot
// graph must not do that.
if (!quick && OperatingSystem.IsLinux())
{
    var fifo = Path.Combine(root, "still.fifo");
    File.Delete(fifo);
    Process.Start("mkfifo", fifo)!.WaitForExit();
    // ffmpeg 6.1 opens a movie source twice (probe, then for real), which kills a single writer with SIGPIPE: keep
    // respawning it. Signals go to every process whose command line has the marker (the loop and its ffmpeg, never
    // the capture ffmpeg that reads the FIFO).
    const string writerMarker = "pcclipper-still-writer";
    using var writer = Process.Start("bash", new[] { "-c",
        $"while :; do ffmpeg -nostdin -hide_banner -loglevel error -re -f lavfi -i testsrc2=size=640x360:rate=60 " +
        $"-c:v rawvideo -pix_fmt yuv420p -metadata comment={writerMarker} -f nut -y '{fifo}'; sleep 0.05; done" })!;
    void Signal(string sig) => Process.Start("pkill", new[] { $"-{sig}", "-f", writerMarker })!.WaitForExit();

    var stillCfg = Config(VideoCodec.H264, 60).With(b =>
    {
        b.TestVideoSource = $"movie={fifo}:f=nut,settb=1/1000000,setpts=RTCTIME,setpts=PTS-STARTPTS";
        b.Width = 640;
        b.Height = 360;
        b.PausesOnStillScreen = true;
    });
    var e5 = new ReplayEngine(env);
    try
    {
        await e5.StartAsync(stillCfg);
        await Task.Delay(TimeSpan.FromSeconds(8));
        Signal("STOP"); // the screen goes still
        await Task.Delay(TimeSpan.FromSeconds(1));
        var swStill = Stopwatch.StartNew();
        var duringStill = await e5.SaveLastAsync(TimeSpan.FromSeconds(10), Path.Combine(clips, "during-still.mp4"));
        Check("a save on a still screen doesn't wait for a segment that can't finish",
            duringStill.Success && swStill.Elapsed < TimeSpan.FromSeconds(5), $"{duringStill.ErrorMessage} took {swStill.Elapsed.TotalSeconds:0.0}s");
        await Task.Delay(TimeSpan.FromSeconds(13));
        Check("a still screen is not a fault", e5.State == EngineState.Running && e5.GetStats().SinceNewVideo > TimeSpan.FromSeconds(10),
            $"{e5.State} since={e5.GetStats().SinceNewVideo.TotalSeconds:0}s");
        Signal("CONT"); // motion again
        await Task.Delay(TimeSpan.FromSeconds(7));
        var afterStill = await e5.SaveLastAsync(TimeSpan.FromSeconds(30), Path.Combine(clips, "after-still.mp4"));
        if (afterStill.Success)
        {
            var pts = Probe.VideoPacketTimes(afterStill.Path!);
            double end = pts.Count > 0 ? pts[^1] : 0;
            double maxGap = 0;
            for (int i = 1; i < pts.Count; i++) maxGap = Math.Max(maxGap, pts[i] - pts[i - 1]);
            int lastFive = pts.Count(t => t > end - 5);
            Check("after a still the picture holds (one long frame), with no burst of repeats",
                maxGap >= 10 && maxGap <= 16, $"longest frame {maxGap:0.00}s, {pts.Count} frames");
            Check("motion right after the still is recorded live (no slideshow while catching up)",
                lastFive >= 270, $"{lastFive} frames in the last 5 s (60 fps = 300)");
            Check("sound keeps running through the still", Probe.AudioGaps(afterStill.Path!) == 0 && Probe.DecodeErrors(afterStill.Path!).Length == 0,
                $"{Probe.AudioGaps(afterStill.Path!)} audio gaps");
        }
        else Check("save after a still", false, afterStill.ErrorMessage ?? "");
        Signal("STOP");
        await Task.Delay(TimeSpan.FromSeconds(4));
        var swStop = Stopwatch.StartNew();
        await e5.StopAsync();
        Check("turning off on a still screen doesn't hang for 10 s", swStop.Elapsed < TimeSpan.FromSeconds(6) && e5.State == EngineState.Off,
            $"took {swStop.Elapsed.TotalSeconds:0.0}s");
    }
    finally
    {
        try { Signal("CONT"); } catch { }
        try { if (e5.State != EngineState.Off) await e5.StopAsync(); } catch { }
        try { Signal("KILL"); } catch { }
    }
}

// ---------------------------------------------------------------- other codecs
foreach (var codec in new[] { VideoCodec.Hevc, VideoCodec.Av1 })
{
    var e2 = new ReplayEngine(env);
    try
    {
        await e2.StartAsync(Config(codec, 20, audio: codec == VideoCodec.Hevc));
        await Task.Delay(TimeSpan.FromSeconds(10));
        var r = await e2.SaveLastAsync(TimeSpan.FromSeconds(6), Path.Combine(clips, $"{codec}.mp4"));
        var d = r.Success ? Probe.Duration(r.Path!) : 0;
        var streams = r.Success ? Probe.Streams(r.Path!) : "";
        var err = r.Success ? Probe.DecodeErrors(r.Path!) : "";
        Check($"{codec} segments save + decode with the right length", r.Success && d >= 5.5 && d <= 9 && err.Length == 0, $"{r.ErrorMessage} dur={d:0.00} streams={streams} {err}");
        if (codec == VideoCodec.Hevc) Check("HEVC tagged hvc1 (plays on Windows/Apple)", r.Success && Probe.CodecTag(r.Path!) == "hvc1", r.Success ? Probe.CodecTag(r.Path!) : "");
    }
    catch (Exception ex)
    {
        Check($"{codec} segments save + decode with the right length", false, ex.Message);
    }
    finally
    {
        await e2.StopAsync();
    }
}

// ---------------------------------------------------------------- crash during a recording -> recovered on next launch
{
    var crashRoot = Path.Combine(root, "crash-buffer");
    var crashEngine = new ReplayEngine(env);
    var crashCfg = new CaptureConfig
    {
        FfmpegPath = "ffmpeg", BufferRoot = crashRoot, Monitor = monitor, Width = 1280, Height = 720, Fps = 60,
        Vendor = EncoderVendor.Cpu, Codec = VideoCodec.H264, EncoderName = "libx264", BitrateKbps = 4000, BufferSeconds = 30,
        DesktopAudio = true, TestVideoSource = TestSource, StripFrameRateTag = stripFps,
    };
    await crashEngine.StartAsync(crashCfg);
    crashEngine.StartRecording();
    await Task.Delay(TimeSpan.FromSeconds(8));
    var crashSession = Directory.GetDirectories(crashRoot).Single();
    KillCapture(crashSession); // the "PC crashed": no StopRecording, no teardown
    await Task.Delay(1500);
    Check("a running recording leaves a recovery note on disk", Directory.GetFiles(crashSession, "*" + SegmentStore.KeepMarkerSuffix).Length == 1);
    SegmentStore.CleanupStaleSessions(crashRoot, null, log); // what the next launch does first
    Check("cleanup at the next launch keeps the unsaved recording", Directory.Exists(crashSession));
    var recovered = await ReplayEngine.RecoverKeptRecordingsAsync(crashRoot, "ffmpeg", t => Path.Combine(clips, $"Recovered {t:HH-mm-ss}.mp4"), log);
    var dRec = recovered.Count == 1 && recovered[0].Success ? Probe.Duration(recovered[0].Path!) : 0;
    Check("the next launch recovers the recording and removes the old folder", dRec >= 5 && dRec <= 11 && !Directory.Exists(crashSession),
        $"{recovered.FirstOrDefault()?.ErrorMessage} dur={dRec:0.0}");
}

// ---------------------------------------------------------------- Test my PC (steady state)
{
    var bench = await FfmpegProbe.BenchmarkAsync(Config(VideoCodec.H264, 60, audio: false), 6, log);
    Check("Test my PC passes a PC that keeps up (start-up time excluded)", bench.Ok && bench.Speed > 0.97 && bench.UniqueFps > 54,
        $"{bench.Message} fps={bench.AchievedFps:0.0} speed={bench.Speed:0.000} unique={bench.UniqueFps:0.0}");
}

// ---------------------------------------------------------------- start failures are explained
{
    var e3 = new ReplayEngine(env);
    var bad = Config(VideoCodec.H264, 20, audio: false).With(b => b.EncoderName = "h264_doesnotexist");
    try
    {
        await e3.StartAsync(bad);
        Check("bad encoder fails cleanly", false, "started?!");
    }
    catch (InvalidOperationException ex)
    {
        Check("bad encoder fails cleanly", e3.State == EngineState.Faulted && ex.Message.Contains("encoder"), ex.Message.Split('\n')[0]);
    }
    await e3.StopAsync();
}
{
    var e4 = new ReplayEngine(new EngineEnvironment
    {
        Log = log, CreatePcmSink = env.CreatePcmSink, CreateAudioSources = env.CreateAudioSources, GetFreeBytes = _ => 1L << 30,
    });
    try
    {
        await e4.StartAsync(Config(VideoCodec.H264, 3600));
        Check("refuses to start without disk space", false);
    }
    catch (InvalidOperationException ex)
    {
        Check("refuses to start without disk space", ex.Message.Contains("Not enough free space"), ex.Message);
    }
}

Console.WriteLine();
int failed = results.Count(r => !r.Ok);
Console.WriteLine($"{results.Count - failed}/{results.Count} checks passed.");
return failed == 0 ? 0 : 1;

static void KillCapture(string sessionDir)
{
    // Only our capture process (other ffmpeg jobs may be running on this machine): its working directory is a run folder.
    foreach (var p in Process.GetProcessesByName("ffmpeg"))
    {
        try
        {
            var cwd = new DirectoryInfo($"/proc/{p.Id}/cwd").ResolveLinkTarget(true)?.FullName ?? "";
            if (cwd.StartsWith(sessionDir, StringComparison.Ordinal)) p.Kill();
        }
        catch { }
    }
}

// ---------------------------------------------------------------- test doubles

/// <summary>Diagnostics: copies everything written to the pipe into a raw f32le file.</summary>
sealed class TeeSink : IPcmSink
{
    private readonly IPcmSink _inner;
    private readonly FileStream _tap;
    public TeeSink(IPcmSink inner, string tapPath) { _inner = inner; _tap = File.Create(tapPath); }
    public string FfmpegInputPath => _inner.FfmpegInputPath;
    public Task WaitForConnectionAsync(CancellationToken ct) => _inner.WaitForConnectionAsync(ct);
    public void Write(ReadOnlySpan<byte> data) { lock (_tap) _tap.Write(data); _inner.Write(data); }
    public void Dispose() { lock (_tap) _tap.Dispose(); _inner.Dispose(); }
}

/// <summary>A FIFO stands in for the Windows named pipe.</summary>
sealed class FifoPcmSink : QueuedPcmSink
{
    [System.Runtime.InteropServices.DllImport("libc", SetLastError = true)]
    private static extern int mkfifo(string path, uint mode);

    private readonly string _path;
    public FifoPcmSink(string path)
    {
        _path = path;
        if (mkfifo(path, 0x180 /*0600*/) != 0) throw new IOException("mkfifo failed");
    }
    public override string FfmpegInputPath => _path;
    // Opening a FIFO for writing blocks until ffmpeg opens it for reading - that is the "connection".
    protected override Task<Stream> ConnectAsync(CancellationToken ct) =>
        Task.Run<Stream>(() => new FileStream(_path, FileMode.Open, FileAccess.Write, FileShare.ReadWrite, 1, false), ct);
    protected override void OnDisposed()
    {
        try { File.Delete(_path); } catch { }
    }
}

/// <summary>Real-time 10 ms chunks: silence plus a 100 ms 1 kHz beep on every absolute 5 s wall-clock boundary.</summary>
sealed class BeepSource : BufferedAudioSource
{
    private Thread? _thread;
    private volatile bool _stop;
    public override string Name => "beep";
    public double FillMs => Fifo.FillMs;
    public double Ratio => Fifo.CurrentRatio;
    public long Underruns => Fifo.UnderrunCount;

    public override void Start()
    {
        _thread = new Thread(() =>
        {
            // Absolute time of each sample = UTC at start + stopwatch-based sample position.
            double t0 = (DateTime.UtcNow - DateTime.UnixEpoch).TotalSeconds;
            var clock = Stopwatch.StartNew();
            long frames = 0;
            var chunk = new float[480 * 2];
            while (!_stop)
            {
                long target = (long)(clock.Elapsed.TotalSeconds * 48000);
                while (frames + 480 <= target)
                {
                    for (int i = 0; i < 480; i++)
                    {
                        double t = t0 + (frames + i) / 48000.0;
                        float v = (t % 5.0) < 0.1 ? (float)(0.5 * Math.Sin(2 * Math.PI * 1000 * t)) : 0f;
                        chunk[2 * i] = v;
                        chunk[2 * i + 1] = v;
                    }
                    Push(chunk);
                    frames += 480;
                }
                Thread.Sleep(5);
            }
        }) { IsBackground = true };
        _thread.Start();
    }

    public override void Stop()
    {
        _stop = true;
        _thread?.Join(1000);
    }
}

static class Probe
{
    static string Run(string exe, params string[] args)
    {
        var psi = new ProcessStartInfo(exe) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)!;
        var o = p.StandardOutput.ReadToEndAsync();
        var e = p.StandardError.ReadToEndAsync();
        p.WaitForExit();
        return o.Result + e.Result;
    }

    static double Num(string s) => double.TryParse(s.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : -1;

    public static double Duration(string file) => Num(Run("ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file));
    public static double StartTime(string file) => Num(Run("ffprobe", "-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", file));
    // MPEG-TS lists the stream twice (under its program and under streams), so take the first number.
    public static int Frames(string file) => (int)Num(Run("ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file)
        .Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "");
    public static string Streams(string file) => Run("ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file).Replace("\n", " ").Trim();
    public static string CodecTag(string file) => Run("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_tag_string", "-of", "csv=p=0", file).Trim();
    public static string DecodeErrors(string file) => Run("ffmpeg", "-v", "error", "-i", file, "-f", "null", "-").Trim();

    public static bool SupportsStripFps() => Run("ffmpeg", "-hide_banner", "-h", "filter=setpts").Contains("strip_fps");

    /// <summary>Video packet presentation times in seconds, sorted.</summary>
    public static List<double> VideoPacketTimes(string file) =>
        Run("ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", file)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(Num).Where(t => t >= 0).OrderBy(t => t).ToList();

    /// <summary>Audio packets whose start doesn't follow the previous packet's end (holes or overlaps > 2 ms).</summary>
    public static int AudioGaps(string file)
    {
        int gaps = 0;
        double prevEnd = -1;
        foreach (var line in Run("ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "packet=pts_time,duration_time", "-of", "csv=p=0", file).Split('\n'))
        {
            var p = line.Trim().Split(',');
            if (p.Length < 2) continue;
            double pts = Num(p[0]), dur = Num(p[1]);
            if (prevEnd >= 0 && Math.Abs(pts - prevEnd) > 0.002) gaps++;
            prevEnd = pts + dur;
        }
        return gaps;
    }

    /// <summary>For each beep, audio onset minus the nearest video flash onset, in seconds.</summary>
    public static List<double> AvOffsets(string file)
    {
        var flashes = new List<double>();
        var vf = Run("ffprobe", "-v", "error", "-f", "lavfi", $"movie={file.Replace(":", "\\:")},signalstats",
            "-show_entries", "frame=pts_time:frame_tags=lavfi.signalstats.YAVG", "-of", "csv=p=0");
        bool prevBright = false;
        foreach (var line in vf.Split('\n'))
        {
            var parts = line.Trim().Split(',');
            if (parts.Length < 2) continue;
            double t = Num(parts[0]), y = Num(parts[1]);
            bool bright = y > 200;
            if (bright && !prevBright) flashes.Add(t);
            prevBright = bright;
        }

        var beeps = new List<double>();
        var af = Run("ffmpeg", "-v", "info", "-i", file, "-af", "silencedetect=n=-30dB:d=0.05", "-vn", "-f", "null", "-");
        foreach (Match m in Regex.Matches(af, @"silence_end: ([\d.]+)"))
            beeps.Add(double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture));

        var offsets = new List<double>();
        foreach (var b in beeps)
        {
            if (flashes.Count == 0) break;
            var nearest = flashes.OrderBy(f => Math.Abs(f - b)).First();
            if (Math.Abs(nearest - b) < 2.5) offsets.Add(b - nearest);
        }
        return offsets;
    }
}
