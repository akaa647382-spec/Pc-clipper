namespace PcClipper.Core;

/// <summary>One monitor as DXGI sees it. <see cref="OutputIndex"/> is what ddagrab's output_idx expects (per adapter).</summary>
public sealed record MonitorInfo(
    int AdapterIndex,
    int OutputIndex,
    string DeviceName,
    string FriendlyName,
    int Width,
    int Height,
    int RefreshHz,
    uint GpuVendorId,
    string AdapterName,
    bool IsPrimary)
{
    /// <summary>Desktop coordinates of the monitor's top-left corner (for placing the on-screen toast, GDI fallback).</summary>
    public int Left { get; init; }
    public int Top { get; init; }
    /// <summary>HMONITOR (DXGI_OUTPUT_DESC.Monitor), for gfxcapture's hmonitor option. 0 = unknown.</summary>
    public long MonitorHandle { get; init; }
    /// <summary>Windows HDR is on for this monitor (captures will look washed out).</summary>
    public bool IsHdr { get; init; }
    /// <summary>Screen rotation in degrees (0, 90, 180, 270) from DXGI_OUTPUT_DESC.Rotation.</summary>
    public int RotationDegrees { get; init; }

    public const uint VendorNvidia = 0x10DE;
    public const uint VendorAmd = 0x1002;
    public const uint VendorIntel = 0x8086;

    public override string ToString() =>
        $"{FriendlyName} - {Width}x{Height} @ {RefreshHz} Hz{(IsPrimary ? " (main)" : "")}";
}

/// <summary>What the installed ffmpeg build can do, and which hardware encoders actually opened on this PC.</summary>
public sealed class FfmpegCapabilities
{
    public string FfmpegPath { get; init; } = "";
    public string VersionLine { get; init; } = "";
    /// <summary>Major version (e.g. 7), or 0 for git/master builds where it cannot be parsed.</summary>
    public int MajorVersion { get; init; }
    public bool HasDdagrab { get; init; }
    public bool HasGfxCapture { get; init; }
    /// <summary>GPU scaler/format converter for D3D11 frames (FFmpeg 8.0+).</summary>
    public bool HasScaleD3D11 { get; init; }
    public IReadOnlySet<string> Filters { get; init; } = new HashSet<string>();
    /// <summary>Encoders compiled into the build.</summary>
    public IReadOnlySet<string> Encoders { get; init; } = new HashSet<string>();
    /// <summary>Encoders that successfully encoded a short test clip on this machine.</summary>
    public IReadOnlySet<string> WorkingEncoders { get; init; } = new HashSet<string>();

    /// <summary>Encoders that only opened with the minimal flag set (our tuned flags were rejected by this build/driver).</summary>
    public IReadOnlySet<string> MinimalFlagEncoders { get; init; } = new HashSet<string>();

    public bool Works(string encoder) => WorkingEncoders.Contains(encoder);

    /// <summary>
    /// PC Clipper needs ddagrab and scale_d3d11 (FFmpeg 8.0+); 8.1+ is recommended (AMD fixes, gfxcapture).
    /// Judged by features, not version text, so git builds work too.
    /// </summary>
    public bool IsSupported => HasDdagrab && HasScaleD3D11;
}

/// <summary>A fully resolved capture session: nothing here is "Auto" any more.</summary>
public sealed class CaptureConfig
{
    public required string FfmpegPath { get; init; }
    /// <summary>Folder that holds the session sub-folders (settings.BufferFolder).</summary>
    public required string BufferRoot { get; init; }
    public required MonitorInfo Monitor { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required int Fps { get; init; }
    public required EncoderVendor Vendor { get; init; }
    public required VideoCodec Codec { get; init; }
    /// <summary>ffmpeg encoder name, e.g. "hevc_nvenc", "libx264".</summary>
    public required string EncoderName { get; init; }
    public required int BitrateKbps { get; init; }
    public bool CaptureCursor { get; init; } = true;
    /// <summary>Resolved: DesktopDuplication or WindowsGraphicsCapture (never Auto).</summary>
    public CaptureMethod Method { get; init; } = CaptureMethod.DesktopDuplication;
    /// <summary>Use only basic encoder flags (set when the tuned ones were rejected during probing).</summary>
    public bool MinimalEncoderFlags { get; init; }
    /// <summary>
    /// The encoder runs on a different GPU than the one driving the monitor (e.g. a desktop monitor plugged into the
    /// motherboard, NVENC on the graphics card). Frames are converted on the capture GPU, copied to system memory and
    /// uploaded by the encoder. Only supported for NVENC (it gets its own CUDA device).
    /// </summary>
    public bool CrossAdapter => Vendor == EncoderVendor.Nvidia && Monitor.GpuVendorId != 0 &&
                                QualityMath.VendorOf(Monitor.GpuVendorId) != EncoderVendor.Nvidia;
    public required int BufferSeconds { get; init; }
    /// <summary>Length of one ring-buffer segment.</summary>
    public int SegmentSeconds { get; init; } = 2;

    public bool DesktopAudio { get; init; }
    public float DesktopVolume { get; init; } = 1f;
    public bool Microphone { get; init; }
    public string? MicrophoneDeviceId { get; init; }
    public float MicrophoneVolume { get; init; } = 1f;
    public bool AudioEnabled => DesktopAudio || Microphone;
    public int AudioBitrateKbps { get; init; } = 192;
    /// <summary>User correction, + = sound later than picture.</summary>
    public int AudioSyncOffsetMs { get; init; }
    /// <summary>
    /// Capture-to-mixer latency estimate. Audio offset ≈ (DriftFifo fill ~38 ms + age of a capture packet on arrival)
    /// − this value. Linux harness (packet age ~7 ms): 45 gives ~7 ms early; WASAPI packets arrive older (~10-20 ms), so
    /// on Windows this lands at roughly 0 to +10 ms (slightly late is less noticeable than early).
    /// </summary>
    public int AudioLatencyMs { get; init; } = 45;

    /// <summary>
    /// Test hook (Linux harness): a filtergraph source chain used instead of ddagrab/gfxcapture. It must stamp frames
    /// like ddagrab does (pts = wall clock since the first frame, time base 1/1000000).
    /// </summary>
    public string? TestVideoSource { get; init; }

    /// <summary>Codec, size and rate: runs with equal signatures can be stream-copied together.</summary>
    public string Signature => $"{EncoderName}|{Width}x{Height}|{Fps}|{(AudioEnabled ? "a" : "-")}";

    /// <summary>Human readable one-liner for the UI, e.g. "HEVC (NVIDIA) - 2560x1440 - 60 fps - 39 Mbps".</summary>
    public string Describe() =>
        $"{QualityMath.CodecLabel(Codec)} ({QualityMath.VendorLabel(Vendor)}) - {Width}x{Height} - {Fps} fps - {BitrateKbps / 1000.0:0.#} Mbps";

    public CaptureConfig With(Action<CaptureConfigBuilder> edit)
    {
        var b = new CaptureConfigBuilder(this);
        edit(b);
        return b.Build();
    }
}

/// <summary>A completed ring-buffer segment as reported by ffmpeg's segment list.</summary>
public sealed record SegmentInfo(int Index, string Path, double StartSeconds, double EndSeconds)
{
    public double Duration => EndSeconds - StartSeconds;
}

public sealed record SaveResult(bool Success, string? Path, TimeSpan Duration, string? ErrorMessage, bool ShorterThanRequested)
{
    public static SaveResult Fail(string message) => new(false, null, TimeSpan.Zero, message, false);
}

public sealed record EngineStats(
    double Fps,
    double Speed,
    long DroppedFrames,
    long DuplicatedFrames,
    TimeSpan Buffered,
    long BufferBytesOnDisk,
    TimeSpan Uptime);

/// <summary>"Test my PC" outcome. UniqueFps is how many different frames per second the capture really delivered.</summary>
public sealed record BenchmarkResult(bool Ok, double AchievedFps, double Speed, double UniqueFps, string Message);

/// <summary>Mutable copy of a <see cref="CaptureConfig"/> (for small variations such as tests and fallbacks).</summary>
public sealed class CaptureConfigBuilder
{
    private readonly CaptureConfig _src;
    public CaptureConfigBuilder(CaptureConfig src)
    {
        _src = src;
        Method = src.Method;
        MinimalEncoderFlags = src.MinimalEncoderFlags;
        Width = src.Width;
        Height = src.Height;
        BitrateKbps = src.BitrateKbps;
        Fps = src.Fps;
        EncoderName = src.EncoderName;
        Vendor = src.Vendor;
        Codec = src.Codec;
        DesktopAudio = src.DesktopAudio;
        Microphone = src.Microphone;
        TestVideoSource = src.TestVideoSource;
    }
    public CaptureMethod Method { get; set; }
    public bool MinimalEncoderFlags { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public int BitrateKbps { get; set; }
    public int Fps { get; set; }
    public string EncoderName { get; set; }
    public EncoderVendor Vendor { get; set; }
    public VideoCodec Codec { get; set; }
    public bool DesktopAudio { get; set; }
    public bool Microphone { get; set; }
    public string? TestVideoSource { get; set; }

    public CaptureConfig Build() => new()
    {
        FfmpegPath = _src.FfmpegPath, BufferRoot = _src.BufferRoot, Monitor = _src.Monitor, Width = Width, Height = Height,
        Fps = Fps, Vendor = Vendor, Codec = Codec, EncoderName = EncoderName, BitrateKbps = BitrateKbps,
        CaptureCursor = _src.CaptureCursor, Method = Method, MinimalEncoderFlags = MinimalEncoderFlags,
        BufferSeconds = _src.BufferSeconds, SegmentSeconds = _src.SegmentSeconds, DesktopAudio = DesktopAudio,
        DesktopVolume = _src.DesktopVolume, Microphone = Microphone, MicrophoneDeviceId = _src.MicrophoneDeviceId,
        MicrophoneVolume = _src.MicrophoneVolume, AudioBitrateKbps = _src.AudioBitrateKbps,
        AudioSyncOffsetMs = _src.AudioSyncOffsetMs, AudioLatencyMs = _src.AudioLatencyMs, TestVideoSource = TestVideoSource,
    };
}
