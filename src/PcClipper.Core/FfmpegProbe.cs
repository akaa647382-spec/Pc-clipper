using System.Globalization;
using System.Text.RegularExpressions;

namespace PcClipper.Core;

/// <summary>Finds out what an ffmpeg build can do on this machine.</summary>
public static partial class FfmpegProbe
{
    private static readonly (string Name, EncoderVendor Vendor, VideoCodec Codec)[] HardwareEncoders =
    {
        ("h264_nvenc", EncoderVendor.Nvidia, VideoCodec.H264), ("hevc_nvenc", EncoderVendor.Nvidia, VideoCodec.Hevc), ("av1_nvenc", EncoderVendor.Nvidia, VideoCodec.Av1),
        ("h264_amf", EncoderVendor.Amd, VideoCodec.H264), ("hevc_amf", EncoderVendor.Amd, VideoCodec.Hevc), ("av1_amf", EncoderVendor.Amd, VideoCodec.Av1),
        ("h264_qsv", EncoderVendor.Intel, VideoCodec.H264), ("hevc_qsv", EncoderVendor.Intel, VideoCodec.Hevc), ("av1_qsv", EncoderVendor.Intel, VideoCodec.Av1),
    };

    private static readonly string[] CpuEncoders = { "libx264", "libx265", "libsvtav1" };

    /// <summary>
    /// Run -version, -filters, -encoders, then test-encode with every hardware encoder present: first with the exact
    /// tuned flags the capture uses, then (if a flag was rejected) with the minimal flag set.
    /// </summary>
    public static async Task<FfmpegCapabilities> ProbeAsync(string ffmpegPath, ILog log, CancellationToken ct = default)
    {
        var timeout = TimeSpan.FromSeconds(15);
        var version = await FfmpegRunner.RunAsync(ffmpegPath, new[] { "-hide_banner", "-nostdin", "-version" }, timeout, null, null, ct).ConfigureAwait(false);
        if (!version.Ok)
            throw new InvalidOperationException($"This ffmpeg does not run: {version.Tail(3)}");
        var versionLine = version.StdOut.Split('\n').FirstOrDefault()?.Trim() ?? "";

        var filtersRun = await FfmpegRunner.RunAsync(ffmpegPath, new[] { "-hide_banner", "-nostdin", "-filters" }, timeout, null, null, ct).ConfigureAwait(false);
        var encodersRun = await FfmpegRunner.RunAsync(ffmpegPath, new[] { "-hide_banner", "-nostdin", "-encoders" }, timeout, null, null, ct).ConfigureAwait(false);
        var filters = ParseNames(filtersRun.StdOut);
        var encoders = ParseNames(encodersRun.StdOut);

        var working = new HashSet<string>(CpuEncoders.Where(encoders.Contains));
        var minimal = new HashSet<string>();
        foreach (var (name, vendor, codec) in HardwareEncoders.Where(e => encoders.Contains(e.Name)))
        {
            ct.ThrowIfCancellationRequested();
            var tuned = TestConfig(ffmpegPath, name, vendor, codec, minimalFlags: false);
            var r = await FfmpegRunner.RunAsync(ffmpegPath, FfmpegCommandBuilder.BuildEncoderTestArgs(tuned), TimeSpan.FromSeconds(12), null, null, ct).ConfigureAwait(false);
            if (r.Ok)
            {
                working.Add(name);
                continue;
            }
            var basic = TestConfig(ffmpegPath, name, vendor, codec, minimalFlags: true);
            var r2 = await FfmpegRunner.RunAsync(ffmpegPath, FfmpegCommandBuilder.BuildEncoderTestArgs(basic), TimeSpan.FromSeconds(12), null, null, ct).ConfigureAwait(false);
            if (r2.Ok)
            {
                working.Add(name);
                minimal.Add(name);
                log.Warn($"Encoder {name} rejected the tuned flags ({r.Tail(2).Replace(Environment.NewLine, " | ")}); using basic flags.");
            }
            else log.Info($"Encoder {name} not usable here: {r2.Tail(2).Replace(Environment.NewLine, " | ")}");
        }

        var caps = new FfmpegCapabilities
        {
            FfmpegPath = ffmpegPath,
            VersionLine = versionLine,
            MajorVersion = ParseMajor(versionLine),
            HasDdagrab = filters.Contains("ddagrab"),
            HasGfxCapture = filters.Contains("gfxcapture"),
            HasScaleD3D11 = filters.Contains("scale_d3d11"),
            Filters = filters,
            Encoders = encoders,
            WorkingEncoders = working,
            MinimalFlagEncoders = minimal,
        };
        log.Info($"FFmpeg: {versionLine}; ddagrab={caps.HasDdagrab} gfxcapture={caps.HasGfxCapture} scale_d3d11={caps.HasScaleD3D11}; " +
                 $"working encoders: {string.Join(", ", working.OrderBy(x => x))}");
        return caps;
    }

    private static CaptureConfig TestConfig(string ffmpegPath, string encoder, EncoderVendor vendor, VideoCodec codec, bool minimalFlags) => new()
    {
        FfmpegPath = ffmpegPath,
        BufferRoot = Path.GetTempPath(),
        Monitor = new MonitorInfo(0, 0, "", "", 1280, 720, 60, 0, "", true),
        Width = 1280,
        Height = 720,
        Fps = 30,
        Vendor = vendor,
        Codec = codec,
        EncoderName = encoder,
        BitrateKbps = 8000,
        BufferSeconds = 60,
        MinimalEncoderFlags = minimalFlags,
    };

    /// <summary>Parses the name column of "ffmpeg -filters" / "ffmpeg -encoders" (both end their legend with " ------").</summary>
    internal static HashSet<string> ParseNames(string listing)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        bool pastHeader = false;
        foreach (var raw in listing.Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (!pastHeader)
            {
                if (line.TrimStart().StartsWith("---", StringComparison.Ordinal)) pastHeader = true;
                continue;
            }
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            // filters: " T.. name   A->V   description"; encoders: " V....D name   description"
            if (parts.Length >= 2) set.Add(parts[1]);
        }
        return set;
    }

    internal static int ParseMajor(string versionLine)
    {
        // "ffmpeg version 8.1.1-essentials_build-www.gyan.dev ...", "ffmpeg version n8.1.3-27-g...", "N-117000-g..." (git)
        var m = MajorRegex().Match(versionLine);
        return m.Success ? int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) : 0;
    }

    [GeneratedRegex(@"ffmpeg version n?(\d+)\.")]
    private static partial Regex MajorRegex();

    /// <summary>
    /// "Test my PC". Pass 1 runs the real capture + encoder and checks the encoder keeps up. The per-slot graph never
    /// repeats frames, so its frame rate already is the number of DIFFERENT frames per second that arrived (keep something
    /// moving on screen meanwhile - the app shows an animated test card). Classic timing repeats frames, so it needs pass
    /// 2 without repeats to count them. Both are judged on the steady-state window only: ffmpeg's own totals include
    /// start-up and shut-down time, which would make any PC look "too heavy".
    /// </summary>
    public static async Task<BenchmarkResult> BenchmarkAsync(CaptureConfig cfg, int seconds, ILog log, CancellationToken ct = default)
    {
        seconds = Math.Max(seconds, 6);
        string what = $"{cfg.Width}x{cfg.Height} at {cfg.Fps} fps with {QualityMath.CodecLabel(cfg.Codec)} ({QualityMath.VendorLabel(cfg.Vendor)})";
        string method = cfg.Method == CaptureMethod.WindowsGraphicsCapture ? "Windows Graphics Capture" : "Desktop Duplication";

        var r1 = await FfmpegRunner.RunAsync(cfg.FfmpegPath, FfmpegCommandBuilder.BuildThroughputTestArgs(cfg, seconds),
            TimeSpan.FromSeconds(seconds + 25), log, null, ct).ConfigureAwait(false);
        var blocks1 = ProgressBlocks(r1.StdOut);
        if (!r1.Ok && (blocks1.Count == 0 || Num(blocks1[^1], "frame") == 0))
        {
            var (msg, _) = ReplayEngine.Explain(r1.StdErr, r1.ExitCode);
            return new BenchmarkResult(false, 0, 0, 0, $"The test could not run {what}. {msg}");
        }
        var (fps, speed) = SteadyState(blocks1);
        // Per-slot: fewer frames than slots is a capture limit (judged below), not the encoder, as long as speed holds.
        bool encoderOk = speed >= 0.97 && (cfg.PicksFramesPerSlot || fps >= cfg.Fps * 0.95);

        // A per-slot graph never repeats frames, so pass 1's frame rate already is the number of different frames.
        double unique = fps;
        if (!cfg.PicksFramesPerSlot)
        {
            var r2 = await FfmpegRunner.RunAsync(cfg.FfmpegPath, FfmpegCommandBuilder.BuildUniqueFramesTestArgs(cfg, seconds),
                TimeSpan.FromSeconds(seconds + 25), log, null, ct).ConfigureAwait(false);
            (unique, _) = SteadyState(ProgressBlocks(r2.StdOut));
        }
        bool captureOk = unique >= cfg.Fps * 0.9;

        string message;
        if (encoderOk && captureOk)
            message = $"Your PC handled {what}: the encoder ran at {speed:0.00}x real time, and the screen capture delivered {unique:0} different frames per second.";
        else if (!encoderOk)
            message = $"Too heavy: the encoder only managed {fps:0.#} of {cfg.Fps} fps ({speed:0.00}x real time) for {what}. Try a lower resolution or frame rate.";
        else
            message = $"The encoder keeps up, but {method} only delivered {unique:0} different frames per second (of {cfg.Fps})." +
                      (cfg.Fps > 60
                          ? $" Your monitor may not really refresh at {cfg.Fps} Hz (check Windows display settings), or record at 60 fps."
                          : " Something may be slowing down the screen capture; try the other capture method in Settings.");
        return new BenchmarkResult(encoderOk && captureOk, fps, speed, unique, message);
    }

    /// <summary>
    /// Frames per second and speed between the first block after start-up and the last periodic block. ffmpeg writes a
    /// block every second of wall time (-stats_period 1), so block distance is wall time.
    /// </summary>
    internal static (double Fps, double Speed) SteadyState(IReadOnlyList<Dictionary<string, string>> blocks)
    {
        var periodic = blocks.Where(b => b.GetValueOrDefault("progress") == "continue").ToList();
        if (periodic.Count < 3)
        {
            // Too short to separate start-up: fall back to ffmpeg's totals.
            var last = blocks.Count > 0 ? blocks[^1] : new Dictionary<string, string>();
            return (Num(last, "fps"), Num(last, "speed"));
        }
        var first = periodic[1]; // the first block still contains start-up
        var end = periodic[^1];
        double wall = periodic.Count - 2;
        double frames = Num(end, "frame") - Num(first, "frame");
        double outTime = (Num(end, "out_time_us") - Num(first, "out_time_us")) / 1e6;
        return (frames / wall, outTime / wall);
    }

    private static double Num(Dictionary<string, string> fields, string key) =>
        fields.TryGetValue(key, out var v) && double.TryParse(v.TrimEnd('x'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : 0;

    /// <summary>All "-progress" blocks in order (each ends with a progress=continue/end line, which is kept in the block).</summary>
    internal static List<Dictionary<string, string>> ProgressBlocks(string progressOutput)
    {
        var blocks = new List<Dictionary<string, string>>();
        var current = new Dictionary<string, string>();
        foreach (var raw in progressOutput.Split('\n'))
        {
            var line = raw.Trim();
            int eq = line.IndexOf('=');
            if (eq <= 0) continue;
            current[line[..eq]] = line[(eq + 1)..];
            if (line.StartsWith("progress=", StringComparison.Ordinal))
            {
                blocks.Add(current);
                current = new Dictionary<string, string>();
            }
        }
        return blocks;
    }

    /// <summary>Take a PNG screenshot with ffmpeg. Returns false on failure (caller falls back to GDI).</summary>
    public static async Task<bool> ScreenshotAsync(string ffmpegPath, MonitorInfo monitor, string outputPng, bool drawMouse, ILog log, CancellationToken ct = default)
    {
        var r = await FfmpegRunner.RunAsync(ffmpegPath, FfmpegCommandBuilder.BuildScreenshotArgs(monitor, outputPng, drawMouse),
            TimeSpan.FromSeconds(10), log, null, ct).ConfigureAwait(false);
        bool ok = r.Ok && File.Exists(outputPng) && new FileInfo(outputPng).Length > 0;
        if (!ok) log.Warn($"ffmpeg screenshot failed: {r.Tail(3)}");
        return ok;
    }
}
