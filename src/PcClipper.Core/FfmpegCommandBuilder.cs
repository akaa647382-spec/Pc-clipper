using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PcClipper.Core;

/// <summary>
/// Builds ffmpeg argument lists (for ProcessStartInfo.ArgumentList - never a single quoted string).
/// The command lines follow what was verified against the FFmpeg 8.1 sources and tested with real ffmpeg:
/// see SPEC.md "FFmpeg command lines" for the reasoning behind each flag.
/// </summary>
public static partial class FfmpegCommandBuilder
{
    /// <summary>
    /// Prints the wall-clock time (Unix µs) that matches video pts 0, so the audio clock can be anchored to it.
    /// setpts is metadata-only, so it passes D3D11 hardware frames through untouched.
    /// </summary>
    public const string AnchorFilter = "setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'";

    /// <summary>Matches the anchor line (with or without ffmpeg's "[context] [level]" prefixes).</summary>
    [GeneratedRegex(@"^(?:\[[^\]]*\]\s*)*(\d{13,20})\.\d+\s*$")]
    public static partial Regex AnchorLineRegex();

    public const string SegmentListName = "segments.csv";

    private const double PixelRate1440p60 = 2560.0 * 1440 * 60;
    private const double PixelRate4K60 = 3840.0 * 2160 * 60;
    private const double PixelRate1080p60 = 1920.0 * 1080 * 60;

    private static string Inv(double v) => v.ToString("0.######", CultureInfo.InvariantCulture);
    private static string Inv(int v) => v.ToString(CultureInfo.InvariantCulture);
    private static string Inv(long v) => v.ToString(CultureInfo.InvariantCulture);

    /// <summary>AV1 can't go in MPEG-TS (no FFmpeg version maps it), so AV1 uses Matroska segments.</summary>
    public static string SegmentExtension(VideoCodec codec) => codec == VideoCodec.Av1 ? ".mkv" : ".ts";

    // ------------------------------------------------------------------ capture

    /// <summary>
    /// The long-running capture. Run it with WorkingDirectory = the run folder: segment names are relative because a
    /// '%' anywhere in an absolute path would break the segment filename template.
    /// </summary>
    public static IReadOnlyList<string> BuildCaptureArgs(CaptureConfig cfg, string? audioInputPath)
    {
        var a = new List<string>
        {
            "-hide_banner", "-nostats",
            "-loglevel", "level+info",
            "-progress", "pipe:1", "-stats_period", "1",
        };
        AddHwDevice(a, cfg);

        if (audioInputPath is not null)
        {
            // -nofind_stream_info: otherwise ffmpeg reads ~1 s of audio before it even starts the video graph.
            a.AddRange(new[]
            {
                "-nofind_stream_info", "-f", "f32le",
                "-ar", Inv(AudioMixerPump.SampleRate), "-ac", Inv(AudioMixerPump.Channels),
                "-i", audioInputPath,
            });
        }

        a.AddRange(new[] { "-filter_complex", VideoGraph(cfg, anchor: true, uniqueFramesProbe: false) + "[v]", "-map", "[v]" });
        if (audioInputPath is not null) a.AddRange(new[] { "-map", "0:a" });
        // The graph already put every frame on the 1/F grid; the CLI's own CFR mode would shift the picture ~2 frames
        // late (it only corrects jittery wall-clock timestamps once they drift more than 1.1 frames).
        AddFrameTiming(a, cfg);

        AddEncoder(a, cfg);

        if (audioInputPath is not null)
        {
            // Drop the 0.25 s lead-in again: atrim removes the samples, setts moves timestamps back to 0 after the
            // scheduler has seen them (so audio still counts as "ahead" and never throttles the video pull).
            a.AddRange(new[]
            {
                "-c:a", "aac", "-b:a", $"{Inv(cfg.AudioBitrateKbps)}k",
                "-af", $"atrim=start_sample={Inv(AudioMixerPump.LeadInFrames)}",
                "-bsf:a", $"setts=ts=TS-{Inv(AudioMixerPump.LeadInSeconds)}/TB",
            });
        }

        a.AddRange(new[] { "-max_muxing_queue_size", "4096" });
        AddSegmentOutput(a, cfg);
        return a;
    }

    private static void AddHwDevice(List<string> a, CaptureConfig cfg)
    {
        if (cfg.TestVideoSource is not null) return;
        // Bind the D3D11 device to the adapter that drives the monitor: ddagrab's output_idx is per adapter, and the
        // frames then stay on that GPU for the encoder (zero copy).
        a.AddRange(new[] { "-init_hw_device", $"d3d11va=dda:{Inv(cfg.Monitor.AdapterIndex)}" });
        // Cross-GPU NVENC: give the encoder its own CUDA device, otherwise ffmpeg would hand it the capture GPU's D3D11
        // device (NVENC lists CUDA before D3D11, so the CUDA device wins).
        if (cfg.CrossAdapter) a.AddRange(new[] { "-init_hw_device", "cuda=nv" });
        a.AddRange(new[] { "-filter_hw_device", "dda" });
    }

    /// <summary>
    /// ddagrab "framerate" for event-driven capture: the highest value whose AcquireNextFrame timeout is still 1 ms
    /// (half a slot, rounded); 667 and up give a 0 ms timeout, i.e. a busy loop.
    /// </summary>
    public const int DdaEventFramerate = 666;

    /// <summary>
    /// Keep at most one picture per 1/F slot: the first frame whose rounded slot number is new. Unlike fps=F it never
    /// repeats a frame to fill an empty slot. That matters after a still screen: fps=F would emit the whole pause as
    /// repeats in one burst, and while the encoder worked through them nobody read the capture, so the first seconds
    /// after the pause came out frozen (measured with a pausing test source: a 20 s still gave ~8 s of slideshow).
    /// Metadata only, so it works on GPU frames.
    /// </summary>
    public static string SlotSelectFilter(int fps) =>
        $"select='isnan(prev_selected_t)+gt(round(t*{Inv(fps)}),round(prev_selected_t*{Inv(fps)}))'";

    /// <summary>Puts each picked frame exactly on its slot (k/F), the same rounding fps=F used.</summary>
    public static string SlotSnapFilter(int fps) => $"setpts='round(T*{Inv(fps)})/({Inv(fps)}*TB)'";

    /// <summary>
    /// "-fps_mode passthrough" (frames go to the encoder exactly as the graph timed them) and, for per-slot graphs, an
    /// encoder time base of 1/F: with the frame-rate tag cleared (strip_fps) every encoder (NVENC, AMF, Quick Sync,
    /// x264) then derives its rate control frame rate from that time base. "-r F" can't be used: FFmpeg 8 rejects -r
    /// together with passthrough.
    /// </summary>
    private static void AddFrameTiming(List<string> a, CaptureConfig cfg, bool constantRate = false)
    {
        a.AddRange(new[] { "-fps_mode", "passthrough" });
        if (cfg.PicksFramesPerSlot && !constantRate) a.AddRange(new[] { "-enc_time_base:v", $"1/{Inv(cfg.Fps)}" });
    }

    /// <summary>
    /// Keyframe once a second by time. -g counts frames, and a per-slot stream only has the frames the screen really
    /// had: a 30 fps game recorded at 120 fps would get a keyframe (and a segment cut) only every 4 s, so saves could miss
    /// the newest seconds. prev_forced_t (not n_forced) so a long still is followed by one keyframe, not a run of them.
    /// Forced frames become IDRs only with the encoder's forced-IDR switch.
    /// </summary>
    private static void AddKeyframeTiming(List<string> a, CaptureConfig cfg)
    {
        a.AddRange(new[] { "-force_key_frames:v", "expr:isnan(prev_forced_t)+gte(t,prev_forced_t+1)" });
        switch (cfg.EncoderName)
        {
            case "h264_nvenc": case "hevc_nvenc": case "av1_nvenc": case "libx264": case "libx265":
                a.AddRange(new[] { "-forced-idr", "1" });
                break;
            case "h264_amf": case "hevc_amf": case "av1_amf": case "h264_qsv": case "hevc_qsv": case "av1_qsv":
                a.AddRange(new[] { "-forced_idr", "1" });
                break;
            // libsvtav1 turns a forced I frame into a key frame by itself.
        }
    }

    /// <summary>gfxcapture's frame-rate cap: 25% above the target and the monitor refresh, at most 1000.</summary>
    public static int GfxCaptureMaxFramerate(CaptureConfig cfg) =>
        Math.Min(1000, (int)Math.Ceiling(Math.Max(cfg.Fps, cfg.Monitor.RefreshHz) * 1.25));

    /// <summary>Source + anchor + scaling/format conversion for the encoder.</summary>
    public static string VideoGraph(CaptureConfig cfg, bool anchor, bool uniqueFramesProbe, bool constantRate = false)
    {
        // constantRate ("Test my PC" pass 1): fps=F instead of the per-slot picking, so the encoder gets F frames a second
        // and a slow encoder shows up as speed below 1 (per-slot frames are stamped on arrival, so speed would stay ~1).
        // The test card never stops moving, so fps=F has no still-screen burst there.
        bool perSlot = cfg.PicksFramesPerSlot && !constantRate;
        var f = new List<string>();
        int cursor = cfg.CaptureCursor ? 1 : 0;

        if (cfg.TestVideoSource is not null)
        {
            f.Add(cfg.TestVideoSource);
        }
        else if (cfg.Method == CaptureMethod.WindowsGraphicsCapture)
        {
            // max_framerate is only a cap (Windows 11 24H2+ MinUpdateInterval). Exactly 1/F would make Windows skip a
            // composed frame that comes a little early, so leave headroom above both the target and the panel; the
            // per-slot select below picks the frames.
            f.Add($"gfxcapture=hmonitor={Inv(cfg.Monitor.MonitorHandle)}:max_framerate={Inv(GfxCaptureMaxFramerate(cfg))}:capture_cursor={cursor}:display_border=0:capture_border=0");
        }
        else
        {
            // Event-driven Desktop Duplication: take every picture Windows presents, stamped the moment it arrives.
            // With framerate=F ddagrab paces itself with Sleep(), and ffmpeg.exe never asks Windows for a fine timer
            // (PC Clipper's timeBeginPeriod doesn't reach a child process since Windows 10 2004), so it woke on the
            // 15.6 ms tick: uneven grabs that fps=F turned into repeated and skipped frames several times a second
            // (and at most ~64 different frames/s at 120 fps). At framerate=666 its frame clock falls behind at once,
            // so it never sleeps and waits in AcquireNextFrame instead (1 ms timeout; 667+ would make it 0 = busy
            // polling). dup_frames=0 keeps waiting until a new picture comes; the cost is that a completely still
            // screen sends nothing (see CaptureConfig.PausesOnStillScreen).
            if (cfg.TimerPacedCapture)
            {
                // Classic (1.0.1) timing, a fallback: ddagrab's own timer; dup_frames=1 keeps frames (and segments)
                // flowing on a static screen.
                f.Add($"ddagrab=output_idx={Inv(cfg.Monitor.OutputIndex)}:framerate={Inv(cfg.Fps)}:draw_mouse={cursor}:dup_frames={(uniqueFramesProbe ? 0 : 1)}");
            }
            else
            {
                f.Add($"ddagrab=output_idx={Inv(cfg.Monitor.OutputIndex)}:framerate={Inv(DdaEventFramerate)}:draw_mouse={cursor}:dup_frames=0");
            }
        }

        if (anchor) f.Add(AnchorFilter);
        if (perSlot)
        {
            // At most one picture per 1/F slot, put exactly on the slot. ddagrab stamps frames with the QPC clock when
            // they arrive, gfxcapture with the compositor's time. A slot without a new picture stays empty (the player
            // keeps showing the last one), so the stream is variable-rate only where the screen didn't change.
            f.Add(SlotSelectFilter(cfg.Fps));
            f.Add(SlotSnapFilter(cfg.Fps));
        }
        else if (!uniqueFramesProbe || constantRate)
        {
            // Classic timing (and the encoder test): constant frame rate by repeating/dropping to the nearest slot.
            f.Add($"fps={Inv(cfg.Fps)}");
        }

        bool scale = cfg.Width != cfg.Monitor.Width || cfg.Height != cfg.Monitor.Height;
        // scale_d3d11's video processor converts with BT.601 limited range but copies the RGB tags of its input;
        // setparams fixes the tags (metadata only) so players don't show a green/purple tint.
        const string fixTags = "setparams=range=tv:colorspace=smpte170m:color_primaries=bt709:color_trc=iec61966-2-1";
        string d3dScale = $"scale_d3d11=width={Inv(cfg.Width)}:height={Inv(cfg.Height)}:format=nv12";

        if (cfg.TestVideoSource is not null)
        {
            if (scale) f.Add($"scale={Inv(cfg.Width)}:{Inv(cfg.Height)}");
            f.Add("format=yuv420p");
        }
        else if (cfg.CrossAdapter)
        {
            // Encoder on another GPU: convert/scale on the capture GPU, then hand system-memory NV12 to the encoder.
            f.Add(d3dScale);
            f.Add("hwdownload");
            f.Add("format=nv12");
            f.Add(fixTags);
        }
        else
        {
            switch (cfg.Vendor)
            {
                case EncoderVendor.Nvidia:
                case EncoderVendor.Amd:
                    // NVENC and AMF (FFmpeg 8.0+) take ddagrab's D3D11 BGRA frames directly.
                    if (scale)
                    {
                        f.Add(d3dScale);
                        f.Add(fixTags);
                    }
                    break;
                case EncoderVendor.Intel:
                    f.Add("hwmap=derive_device=qsv");
                    f.Add("format=qsv");
                    f.Add($"vpp_qsv=w={Inv(cfg.Width)}:h={Inv(cfg.Height)}:format=nv12:out_color_matrix=bt709:out_range=tv");
                    break;
                default:
                    // CPU: convert/scale on the GPU so only NV12 crosses the bus.
                    f.Add(d3dScale);
                    f.Add("hwdownload");
                    f.Add("format=nv12");
                    f.Add(fixTags);
                    break;
            }
        }
        // Last, after any scaler (vpp_qsv sets its own rate from its input): drop the source's nominal frame rate (666
        // for ddagrab), or the encoder would budget its bitrate for 666 frames per second. See AddFrameTiming.
        if (perSlot && cfg.StripFrameRateTag) f.Add("setpts=PTS:strip_fps=1");
        return string.Join(",", f);
    }

    private static void AddEncoder(List<string> a, CaptureConfig cfg)
    {
        int kbps = cfg.BitrateKbps;
        string br = $"{Inv(kbps)}k", max = $"{Inv((int)(kbps * 1.5))}k", buf = $"{Inv(kbps * 2)}k";
        string gop = Inv(cfg.Fps); // an IDR every second; segments are cut on them
        double pixelRate = cfg.Width * (double)cfg.Height * cfg.Fps;
        var enc = cfg.EncoderName;

        a.AddRange(new[] { "-c:v", enc, "-b:v", br, "-maxrate", max, "-bufsize", buf, "-g", gop, "-bf", "0" });
        // -g is only a cap now: keyframes come once a second by time (AddKeyframeTiming).
        AddKeyframeTiming(a, cfg);

        if (!cfg.MinimalEncoderFlags)
        {
            switch (enc)
            {
                case "h264_nvenc":
                case "hevc_nvenc":
                case "av1_nvenc":
                {
                    bool heavy = pixelRate > PixelRate4K60;
                    string preset = pixelRate <= PixelRate1440p60 ? "p5" : "p4";
                    a.AddRange(new[] { "-preset", preset, "-tune", heavy ? "ll" : "hq", "-rc", "vbr", "-rc-lookahead", "0" });
                    if (enc != "av1_nvenc") a.AddRange(new[] { "-no-scenecut", "1" });
                    if (enc == "h264_nvenc") a.AddRange(new[] { "-profile:v", "high" });
                    if (enc == "hevc_nvenc") a.AddRange(new[] { "-profile:v", "main", "-tier", "high" });
                    // Split-frame encoding across two NVENC chips (RTX 40/50) for 4K120/5K; HEVC/AV1 only.
                    if (heavy && enc != "h264_nvenc") a.AddRange(new[] { "-split_encode_mode", "auto" });
                    break;
                }
                case "h264_amf":
                case "hevc_amf":
                case "av1_amf":
                {
                    a.AddRange(new[] { "-usage", "transcoding", "-quality", pixelRate > PixelRate4K60 ? "speed" : "balanced", "-rc", "vbr_peak", "-preanalysis", "0" });
                    if (enc == "h264_amf") a.AddRange(new[] { "-profile:v", "high" });
                    if (enc == "hevc_amf") a.AddRange(new[] { "-gops_per_idr", "1", "-header_insertion_mode", "idr", "-profile_tier", "high" });
                    if (enc == "av1_amf") a.AddRange(new[] { "-header_insertion_mode", "frame" });
                    break;
                }
                case "h264_qsv":
                case "hevc_qsv":
                case "av1_qsv":
                {
                    string preset = pixelRate <= PixelRate1080p60 ? "medium" : pixelRate <= PixelRate4K60 ? "faster" : "veryfast";
                    a.AddRange(new[] { "-preset", preset, "-async_depth", "4" });
                    if (enc != "av1_qsv") a.AddRange(new[] { "-idr_interval", "0" });
                    break;
                }
                case "libx264":
                    a.AddRange(new[] { "-preset", "veryfast", "-profile:v", "high", "-keyint_min", gop, "-sc_threshold", "0" });
                    break;
                case "libx265":
                    a.AddRange(new[] { "-preset", "veryfast", "-x265-params", $"keyint={gop}:min-keyint={gop}:scenecut=0:open-gop=0:bframes=0:log-level=error" });
                    break;
                case "libsvtav1":
                    a.AddRange(new[] { "-preset", "10" });
                    break;
            }
        }

        if (cfg.Codec != VideoCodec.Av1)
        {
            // Every saved clip starts mid-stream, so each keyframe must carry the codec headers (SPS/PPS/VPS):
            // ask for them as extradata and repeat them on every keyframe. Closed GOPs for QSV.
            a.AddRange(new[] { "-flags:v", cfg.Vendor == EncoderVendor.Intel ? "+global_header+cgop" : "+global_header" });
            a.AddRange(new[] { "-bsf:v", "dump_extra=freq=keyframe" });
        }
    }

    private static void AddSegmentOutput(List<string> a, CaptureConfig cfg)
    {
        var ext = SegmentExtension(cfg.Codec);
        a.AddRange(new[] { "-f", "segment", "-segment_time", Inv(cfg.SegmentSeconds), "-reset_timestamps", "0" });
        if (ext == ".ts")
            // +initial_discontinuity: no "Packet corrupt" warnings when segments are byte-joined later.
            a.AddRange(new[] { "-segment_format", "mpegts", "-segment_format_options", "mpegts_flags=+initial_discontinuity" });
        else
            a.AddRange(new[] { "-segment_format", "matroska" });
        // Append-mode CSV (never -segment_list_size: its rename-over fails while we have the file open on Windows).
        a.AddRange(new[] { "-segment_list", SegmentListName, "-segment_list_type", "csv", "seg_%08d" + ext });
    }

    // ------------------------------------------------------------------ saving

    private static string Quote(string path) => "'" + path.Replace('\\', '/').Replace("'", "'\\''") + "'";

    /// <summary>List for the concatf: protocol (byte-joins MPEG-TS segments: exact timestamps, no gaps at joins).</summary>
    public static string ConcatfList(IEnumerable<string> absolutePaths)
    {
        var sb = new StringBuilder();
        foreach (var p in absolutePaths) sb.Append(Quote(p)).Append('\n');
        return sb.ToString();
    }

    /// <summary>ffconcat list; durations are required for Matroska segments (their stored duration is absolute).</summary>
    public static string FfconcatList(IEnumerable<(string Url, double? Duration)> entries)
    {
        var sb = new StringBuilder("ffconcat version 1.0\n");
        foreach (var (url, duration) in entries)
        {
            sb.Append("file ").Append(Quote(url)).Append('\n');
            if (duration is double d) sb.Append("duration ").Append(d.ToString("0.000000", CultureInfo.InvariantCulture)).Append('\n');
        }
        return sb.ToString();
    }

    /// <summary>
    /// concatf opens every listed file at once, and the Windows C runtime allows ~8000 open files, so long recordings are
    /// split into lists of at most this many segments (joined by an ffconcat file).
    /// </summary>
    public static int MaxFilesPerConcatf { get; set; } = 1000;

    /// <summary>Path of a concatf list as a URL for ffmpeg ("concatf:C:/.../list.txt").</summary>
    public static string ConcatfUrl(string listPath) => "concatf:" + listPath.Replace('\\', '/');

    /// <summary>
    /// Stream-copy into MP4. <paramref name="inputUrl"/> is either a concatf: URL or an ffconcat file
    /// (<paramref name="isFfconcat"/>), which may itself list concatf: URLs (one per capture run).
    /// </summary>
    public static IReadOnlyList<string> BuildSaveArgs(string inputUrl, bool isFfconcat, string outputMp4, VideoCodec codec, bool faststart)
    {
        // -copyts -start_at_zero: keep the recorded timestamps (shifted to start at 0). Without it ffmpeg treats any jump
        // of more than 10 s in MPEG-TS as a broken stream and closes it up - for a still screen of over 10 s (no video
        // then, sound keeps going) that would pull the picture up to 10+ s ahead of the sound for the rest of the clip.
        var a = new List<string> { "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-copyts", "-start_at_zero" };
        if (isFfconcat)
            a.AddRange(new[] { "-protocol_whitelist", "file,concatf,crypto,data", "-f", "concat", "-safe", "0", "-i", inputUrl });
        else
            a.AddRange(new[] { "-i", inputUrl });
        a.AddRange(new[] { "-map", "0", "-c", "copy" });
        // 'hvc1' is the HEVC tag Windows Explorer previews and Apple players accept; ffmpeg defaults to 'hev1'.
        if (codec == VideoCodec.Hevc) a.AddRange(new[] { "-tag:v", "hvc1" });
        // faststart rewrites the whole file a second time; worth it for short clips people share, not for 1-hour saves.
        if (faststart) a.AddRange(new[] { "-movflags", "+faststart" });
        a.AddRange(new[] { "-f", "mp4", outputMp4 });
        return a;
    }

    // ------------------------------------------------------------------ one-shots

    /// <summary>One-shot PNG of the monitor at native resolution.</summary>
    public static IReadOnlyList<string> BuildScreenshotArgs(MonitorInfo monitor, string outputPng, bool drawMouse) => new[]
    {
        "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
        "-init_hw_device", $"d3d11va=dda:{Inv(monitor.AdapterIndex)}", "-filter_hw_device", "dda",
        // DDA's alpha channel is undefined, so drop it before PNG.
        "-filter_complex", $"ddagrab=output_idx={Inv(monitor.OutputIndex)}:framerate=10:draw_mouse={(drawMouse ? 1 : 0)},hwdownload,format=bgra,format=rgb24[v]",
        "-map", "[v]", "-frames:v", "1", "-update", "1", "-compression_level", "3",
        "-f", "image2", "-c:v", "png", outputPng,
    };

    /// <summary>
    /// Encode 1 s of a synthetic picture with exactly the flags the capture would use (so an option this build or
    /// driver rejects is caught here, not when recording starts).
    /// </summary>
    public static IReadOnlyList<string> BuildEncoderTestArgs(CaptureConfig cfg)
    {
        bool hw = cfg.Vendor is EncoderVendor.Nvidia or EncoderVendor.Amd or EncoderVendor.Intel;
        var a = new List<string>
        {
            "-hide_banner", "-nostdin", "-loglevel", "error",
            "-f", "lavfi", "-i", $"color=c=black:s={Inv(cfg.Width)}x{Inv(cfg.Height)}:r={Inv(cfg.Fps)}:d=1",
            "-pix_fmt", hw ? "nv12" : "yuv420p",
        };
        AddEncoder(a, cfg);
        a.AddRange(new[] { "-f", "null", "-" });
        return a;
    }

    /// <summary>"Test my PC" pass 1: the real capture graph and encoder into the null muxer (can the encoder keep up?).</summary>
    public static IReadOnlyList<string> BuildThroughputTestArgs(CaptureConfig cfg, int seconds)
    {
        var a = new List<string> { "-hide_banner", "-nostdin", "-nostats", "-loglevel", "level+info", "-progress", "pipe:1", "-stats_period", "1" };
        AddHwDevice(a, cfg);
        a.AddRange(new[] { "-filter_complex", VideoGraph(cfg, anchor: false, uniqueFramesProbe: false, constantRate: true) + "[v]", "-map", "[v]" });
        AddFrameTiming(a, cfg, constantRate: true);
        AddEncoder(a, cfg);
        a.AddRange(new[] { "-t", Inv(seconds), "-an", "-f", "null", "-" });
        return a;
    }

    /// <summary>"Test my PC" pass 2 (per-slot: the real capture graph, which never repeats a frame; classic: no repeats): no duplicated frames, timestamps passed through, so frame count = real captured frames.</summary>
    public static IReadOnlyList<string> BuildUniqueFramesTestArgs(CaptureConfig cfg, int seconds)
    {
        var a = new List<string> { "-hide_banner", "-nostdin", "-nostats", "-loglevel", "level+info", "-progress", "pipe:1", "-stats_period", "1" };
        AddHwDevice(a, cfg);
        a.AddRange(new[] { "-filter_complex", VideoGraph(cfg, anchor: false, uniqueFramesProbe: true) + "[v]", "-map", "[v]" });
        AddFrameTiming(a, cfg);
        AddEncoder(a, cfg);
        a.AddRange(new[] { "-t", Inv(seconds), "-an", "-f", "null", "-" });
        return a;
    }
}
