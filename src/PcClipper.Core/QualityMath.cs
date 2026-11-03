namespace PcClipper.Core;

/// <summary>Pure helpers that turn user settings into concrete numbers. No I/O.</summary>
public static class QualityMath
{
    /// <summary>H.264 hardware encoders top out at 4096 pixels wide.</summary>
    public const int H264MaxWidth = 4096;

    private const double ReferencePixelRate = 1920.0 * 1080 * 60;

    public static int PresetHeight(ResolutionPreset preset) => preset switch
    {
        ResolutionPreset.P720 => 720,
        ResolutionPreset.P1080 => 1080,
        ResolutionPreset.P1440 => 1440,
        ResolutionPreset.P2160 => 2160,
        ResolutionPreset.P2880 => 2880,
        _ => 0,
    };

    public static string PresetLabel(ResolutionPreset preset) => preset switch
    {
        ResolutionPreset.Native => "Native (monitor)",
        ResolutionPreset.P720 => "720p",
        ResolutionPreset.P1080 => "1080p (Full HD)",
        ResolutionPreset.P1440 => "1440p (2K)",
        ResolutionPreset.P2160 => "2160p (4K)",
        ResolutionPreset.P2880 => "2880p (5K)",
        _ => preset.ToString(),
    };

    public static string CodecLabel(VideoCodec codec) => codec switch
    {
        VideoCodec.H264 => "H.264",
        VideoCodec.Hevc => "HEVC (H.265)",
        VideoCodec.Av1 => "AV1",
        _ => "Auto",
    };

    public static string VendorLabel(EncoderVendor vendor) => vendor switch
    {
        EncoderVendor.Nvidia => "NVIDIA",
        EncoderVendor.Amd => "AMD",
        EncoderVendor.Intel => "Intel",
        EncoderVendor.Cpu => "CPU",
        _ => "Auto",
    };

    /// <summary>Output size: the preset height with the monitor's aspect ratio, both rounded to even numbers.</summary>
    public static (int Width, int Height) TargetSize(ResolutionPreset preset, int nativeWidth, int nativeHeight)
    {
        if (nativeWidth <= 0 || nativeHeight <= 0) throw new ArgumentOutOfRangeException(nameof(nativeWidth));
        int h = PresetHeight(preset);
        if (h == 0 || h == nativeHeight) return (Even(nativeWidth), Even(nativeHeight));
        int w = (int)Math.Round(nativeWidth * (double)h / nativeHeight);
        return (Even(w), Even(h));
    }

    private static int Even(int v) => v % 2 == 0 ? v : v + 1;

    /// <summary>
    /// Video bitrate in kbit/s. Anchored on 1080p60 H.264 (Low 12, Medium 20, High 35, Ultra 50 Mbps),
    /// scaled by pixel rate^0.8 (bigger frames need fewer bits per pixel) and by codec efficiency.
    /// </summary>
    public static int BitrateKbps(QualityLevel level, int customMbps, int width, int height, int fps, VideoCodec codec)
    {
        if (level == QualityLevel.Custom) return Math.Clamp(customMbps, 2, 500) * 1000;
        double anchorMbps = level switch
        {
            QualityLevel.Low => 12,
            QualityLevel.Medium => 20,
            QualityLevel.Ultra => 50,
            _ => 35,
        };
        double scale = Math.Pow(width * (double)height * fps / ReferencePixelRate, 0.8);
        double codecFactor = codec switch
        {
            VideoCodec.Hevc => 0.7,
            VideoCodec.Av1 => 0.6,
            _ => 1.0,
        };
        double mbps = Math.Clamp(anchorMbps * scale * codecFactor, 4, 400);
        return (int)Math.Round(mbps) * 1000;
    }

    /// <summary>Bytes the ring buffer will use when full (video + audio + ~2% container overhead + 2 spare segments).</summary>
    public static long EstimateBufferBytes(int videoKbps, int audioKbps, int bufferSeconds, int segmentSeconds = 2)
    {
        double seconds = bufferSeconds + 2.0 * segmentSeconds;
        double bits = (videoKbps + audioKbps) * 1000.0 * seconds * 1.02;
        return (long)(bits / 8);
    }

    public static string FormatBytes(long bytes)
    {
        if (bytes >= 1L << 30) return $"{bytes / (double)(1L << 30):0.#} GB";
        if (bytes >= 1L << 20) return $"{bytes / (double)(1L << 20):0} MB";
        return $"{bytes / 1024.0:0} KB";
    }

    public static string FormatDuration(TimeSpan t) =>
        t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes}:{t.Seconds:00}";

    public static string FormatSaveLength(int seconds) => seconds switch
    {
        < 60 => $"{seconds} sec",
        3600 => "1 hour",
        _ when seconds % 60 == 0 => $"{seconds / 60} min",
        _ => $"{seconds / 60}:{seconds % 60:00}",
    };

    /// <summary>A clip's real length for its file name: "40 sec", "7 min", "7 min 12 sec", "1 hour" (whole seconds, rounded down).</summary>
    public static string FormatClipLength(TimeSpan t)
    {
        int s = Math.Max(0, (int)Math.Floor(t.TotalSeconds + 1e-6));
        if (s < 60) return $"{s} sec";
        if (s == 3600) return "1 hour";
        if (s > 3600) return $"{s / 3600} h {s / 60 % 60} min";
        return s % 60 == 0 ? $"{s / 60} min" : $"{s / 60} min {s % 60} sec";
    }

    public static EncoderVendor VendorOf(uint gpuVendorId) => gpuVendorId switch
    {
        MonitorInfo.VendorNvidia => EncoderVendor.Nvidia,
        MonitorInfo.VendorAmd => EncoderVendor.Amd,
        MonitorInfo.VendorIntel => EncoderVendor.Intel,
        _ => EncoderVendor.Auto,
    };

    /// <summary>Largest even size with the same aspect ratio that fits within <paramref name="maxWidth"/>.</summary>
    public static (int Width, int Height) FitWidth(int width, int height, int maxWidth)
    {
        if (width <= maxWidth) return (width, height);
        int h = (int)Math.Round(height * (double)maxWidth / width);
        return (maxWidth - maxWidth % 2, h + h % 2);
    }

    /// <summary>ffmpeg encoder name for a vendor + codec pair.</summary>
    public static string EncoderName(EncoderVendor vendor, VideoCodec codec) => (vendor, codec) switch
    {
        (EncoderVendor.Nvidia, VideoCodec.H264) => "h264_nvenc",
        (EncoderVendor.Nvidia, VideoCodec.Hevc) => "hevc_nvenc",
        (EncoderVendor.Nvidia, VideoCodec.Av1) => "av1_nvenc",
        (EncoderVendor.Amd, VideoCodec.H264) => "h264_amf",
        (EncoderVendor.Amd, VideoCodec.Hevc) => "hevc_amf",
        (EncoderVendor.Amd, VideoCodec.Av1) => "av1_amf",
        (EncoderVendor.Intel, VideoCodec.H264) => "h264_qsv",
        (EncoderVendor.Intel, VideoCodec.Hevc) => "hevc_qsv",
        (EncoderVendor.Intel, VideoCodec.Av1) => "av1_qsv",
        (EncoderVendor.Cpu, VideoCodec.H264) => "libx264",
        (EncoderVendor.Cpu, VideoCodec.Hevc) => "libx265",
        (EncoderVendor.Cpu, VideoCodec.Av1) => "libsvtav1",
        _ => throw new ArgumentException($"Unresolved encoder {vendor}/{codec}"),
    };

    /// <summary>
    /// Pick the encoder family. Captured frames live on the GPU that drives the monitor, and AMF/Quick Sync can only read
    /// frames from their own GPU; NVENC can also take frames copied through system memory (a CUDA device of its own).
    /// So: the monitor's GPU vendor first, then NVIDIA (cross-GPU), then CPU. A specific choice that can't work falls
    /// back the same way.
    /// </summary>
    public static EncoderVendor ResolveVendor(EncoderVendor requested, uint monitorGpuVendorId, FfmpegCapabilities caps)
    {
        var monitorVendor = VendorOf(monitorGpuVendorId);
        bool Usable(EncoderVendor v)
        {
            if (v == EncoderVendor.Cpu) return true;
            bool works = new[] { VideoCodec.H264, VideoCodec.Hevc, VideoCodec.Av1 }.Any(c => caps.Works(EncoderName(v, c)));
            if (!works) return false;
            // Unknown monitor GPU (id 0): assume the same GPU. A GPU of another make: only NVENC can cross GPUs.
            return monitorGpuVendorId == 0 || v == monitorVendor || v == EncoderVendor.Nvidia;
        }

        if (requested != EncoderVendor.Auto && Usable(requested)) return requested;
        if (monitorVendor != EncoderVendor.Auto && Usable(monitorVendor)) return monitorVendor;
        foreach (var v in new[] { EncoderVendor.Nvidia, EncoderVendor.Amd, EncoderVendor.Intel })
            if (Usable(v)) return v;
        return EncoderVendor.Cpu;
    }

    /// <summary>
    /// Pick the codec. Auto = HEVC when it works, else H.264. H.264 is never used above 4096 px wide
    /// (5K needs HEVC or AV1). A specific choice that does not work falls back to HEVC, then H.264.
    /// </summary>
    public static VideoCodec ResolveCodec(VideoCodec requested, EncoderVendor vendor, int width, FfmpegCapabilities caps)
    {
        bool Ok(VideoCodec c) =>
            (c != VideoCodec.H264 || width <= H264MaxWidth) &&
            (vendor == EncoderVendor.Cpu ? caps.Encoders.Contains(EncoderName(vendor, c)) : caps.Works(EncoderName(vendor, c)));

        if (requested != VideoCodec.Auto && Ok(requested)) return requested;
        // CPU: H.264 first - x265 and SVT-AV1 are several times slower and would steal the game's CPU time.
        var order = vendor == EncoderVendor.Cpu
            ? new[] { VideoCodec.H264, VideoCodec.Hevc, VideoCodec.Av1 }
            : new[] { VideoCodec.Hevc, VideoCodec.H264, VideoCodec.Av1 };
        foreach (var c in order)
            if (Ok(c)) return c;
        // Nothing qualified (e.g. CPU-only build without libx265 at 5K): H.264 is the last resort.
        return VideoCodec.H264;
    }

    /// <summary>Plain-language warnings about the chosen settings (shown under the quality options).</summary>
    public static IReadOnlyList<string> Warnings(AppSettings s, MonitorInfo monitor, CaptureConfig? resolved)
    {
        var list = new List<string>();
        var (w, h) = TargetSize(s.Resolution, monitor.Width, monitor.Height);
        if (h > monitor.Height)
            list.Add($"Your monitor is {monitor.Width}x{monitor.Height}. {PresetLabel(s.Resolution)} will be upscaled: bigger files, no extra detail.");
        if (monitor.RefreshHz > 0 && s.Fps > monitor.RefreshHz + 1)
            list.Add($"Your monitor runs at {monitor.RefreshHz} Hz, so PC Clipper records at {EffectiveFps(s.Fps, monitor)} fps (more would only repeat frames).");
        if (monitor.RotationDegrees != 0 && (resolved is null || resolved.Method == CaptureMethod.DesktopDuplication))
            list.Add("This monitor is rotated. Desktop Duplication may record it sideways; use Capture method > Windows Graphics Capture (FFmpeg 8.1+).");
        else if (monitor.RotationDegrees != 0 && s.CaptureMethod == CaptureMethod.Auto)
            list.Add("This monitor is rotated, so PC Clipper uses Windows Graphics Capture for it (it only records while something on screen changes).");
        if (monitor.IsHdr)
            list.Add("Windows HDR is on for this monitor, so clips will look washed out. Turn HDR off in Windows display settings for accurate colours.");
        if (resolved is not null)
        {
            if (resolved.Fps > 60 && resolved.Method == CaptureMethod.DesktopDuplication)
                list.Add("Above 60 fps, Desktop Duplication may only catch about 60 different frames per second on Windows. 'Test my PC' shows the real number; Capture method > Windows Graphics Capture avoids the limit.");
            if (resolved.Method == CaptureMethod.WindowsGraphicsCapture && !IsWindows11)
                list.Add("On Windows 10, Windows Graphics Capture draws a yellow border around the screen while recording.");
            if (s.CaptureMethod == CaptureMethod.WindowsGraphicsCapture && resolved.Method != CaptureMethod.WindowsGraphicsCapture)
                list.Add("Windows Graphics Capture needs FFmpeg 8.1 or newer; using Desktop Duplication.");
            if (resolved.Method == CaptureMethod.WindowsGraphicsCapture)
                list.Add("Windows Graphics Capture only records while something on screen changes (a frozen screen pauses the buffer).");
            if (s.Codec != VideoCodec.Auto && resolved.Codec != s.Codec)
                list.Add($"{CodecLabel(s.Codec)} is not available for this size/encoder; using {CodecLabel(resolved.Codec)}.");
            if (s.Encoder != EncoderVendor.Auto && resolved.Vendor != s.Encoder)
                list.Add($"{VendorLabel(s.Encoder)} encoder did not work on this PC; using {VendorLabel(resolved.Vendor)}.");
            if (resolved.CrossAdapter)
                list.Add($"This monitor is plugged into the {(VendorOf(monitor.GpuVendorId) == EncoderVendor.Auto ? monitor.AdapterName : VendorLabel(VendorOf(monitor.GpuVendorId)))} graphics, but the encoder is {VendorLabel(resolved.Vendor)}. That works, but costs extra performance - plugging the monitor into the graphics card is better.");
            if (resolved.Vendor == EncoderVendor.Cpu && s.Encoder != EncoderVendor.Cpu && (resolved.Height < TargetSize(s.Resolution, monitor.Width, monitor.Height).Height || resolved.Fps < EffectiveFps(s.Fps, monitor)))
                list.Add($"No graphics-card encoder works on this PC, so PC Clipper records with the CPU at {resolved.Width}x{resolved.Height} {resolved.Fps} fps to keep your game smooth.");
            if (resolved.Vendor == EncoderVendor.Cpu)
            {
                double pixelRate = resolved.Width * (double)resolved.Height * resolved.Fps;
                list.Add(pixelRate > ReferencePixelRate
                    ? "CPU encoding above 1080p60 will very likely stutter and slow your game. Use a GPU encoder."
                    : "No GPU encoder found; CPU encoding costs game performance.");
            }
        }
        if (w * (double)h * EffectiveFps(s.Fps, monitor) >= 5120.0 * 2880 * 120 * 0.99)
            list.Add("5K at 120 fps needs a top-end GPU encoder (e.g. RTX 40/50 series). Use 'Test my PC' before relying on it.");
        return list;
    }

    /// <summary>Resolve settings into a concrete capture session.</summary>
    public static bool IsWindows11 => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000);

    /// <summary>Never record faster than the monitor refreshes: the extra frames would only be copies.</summary>
    public static int EffectiveFps(int requested, MonitorInfo monitor)
    {
        if (monitor.RefreshHz <= 0 || requested <= monitor.RefreshHz + 1) return requested;
        int best = AppSettings.AllowedFps.Where(f => f <= monitor.RefreshHz + 1).DefaultIfEmpty(30).Max();
        return best;
    }

    /// <summary>
    /// Desktop Duplication is the default (Auto): it keeps recording on a still screen. Windows Graphics Capture is
    /// event driven (no ~64 fps pacing limit) but delivers nothing while the screen is still and shows a yellow border on
    /// Windows 10, so it is only used when the user picks it.
    /// </summary>
    public static CaptureMethod ResolveMethod(CaptureMethod requested, int fps, MonitorInfo monitor, FfmpegCapabilities caps)
    {
        bool wgcPossible = caps.HasGfxCapture && monitor.MonitorHandle != 0;
        return requested switch
        {
            CaptureMethod.WindowsGraphicsCapture when wgcPossible => CaptureMethod.WindowsGraphicsCapture,
            // Desktop Duplication hands over a portrait screen's picture unrotated; Windows Graphics Capture rotates it.
            CaptureMethod.Auto when wgcPossible && monitor.RotationDegrees != 0 => CaptureMethod.WindowsGraphicsCapture,
            _ => CaptureMethod.DesktopDuplication,
        };
    }

    public static CaptureConfig Resolve(AppSettings s, MonitorInfo monitor, FfmpegCapabilities caps)
    {
        var (w, h) = TargetSize(s.Resolution, monitor.Width, monitor.Height);
        int fps = EffectiveFps(s.Fps, monitor);
        var vendor = ResolveVendor(s.Encoder, monitor.GpuVendorId, caps);
        if (vendor == EncoderVendor.Cpu && s.Encoder != EncoderVendor.Cpu)
        {
            // No usable GPU encoder: CPU encoding above 1080p60 would make games stutter, so cap it.
            if (h > 1080) (w, h) = TargetSize(ResolutionPreset.P1080, monitor.Width, monitor.Height);
            fps = Math.Min(fps, 60);
        }
        var codec = ResolveCodec(s.Codec, vendor, w, caps);
        if (codec == VideoCodec.H264 && w > H264MaxWidth)
        {
            // H.264 cannot go wider than 4096 and nothing else works: shrink to fit instead of failing.
            (w, h) = FitWidth(w, h, H264MaxWidth);
        }
        return new CaptureConfig
        {
            FfmpegPath = caps.FfmpegPath,
            BufferRoot = s.BufferFolder,
            Monitor = monitor,
            Width = w,
            Height = h,
            Fps = fps,
            Vendor = vendor,
            Codec = codec,
            EncoderName = EncoderName(vendor, codec),
            BitrateKbps = BitrateKbps(s.Quality, s.CustomBitrateMbps, w, h, fps, codec),
            CaptureCursor = s.CaptureCursor,
            Method = ResolveMethod(s.CaptureMethod, fps, monitor, caps),
            MinimalEncoderFlags = caps.MinimalFlagEncoders.Contains(EncoderName(vendor, codec)),
            BufferSeconds = s.BufferMinutes * 60,
            DesktopAudio = s.RecordDesktopAudio,
            DesktopVolume = s.DesktopVolume,
            Microphone = s.RecordMicrophone,
            MicrophoneDeviceId = s.MicrophoneDeviceId,
            MicrophoneVolume = s.MicrophoneVolume,
            AudioSyncOffsetMs = s.AudioSyncOffsetMs,
        };
    }
}
