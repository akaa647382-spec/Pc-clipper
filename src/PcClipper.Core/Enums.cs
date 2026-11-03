namespace PcClipper.Core;

/// <summary>Which hardware (or CPU) encoder family to use.</summary>
public enum EncoderVendor
{
    Auto,
    Nvidia,
    Amd,
    Intel,
    Cpu,
}

public enum VideoCodec
{
    Auto,
    H264,
    Hevc,
    Av1,
}

/// <summary>Output height preset. Width follows the monitor's aspect ratio (rounded to an even number).</summary>
public enum ResolutionPreset
{
    Native,
    P720,
    P1080,
    P1440,
    P2160,
    P2880,
}

public enum QualityLevel
{
    Low,
    Medium,
    High,
    Ultra,
    Custom,
}

public enum EngineState
{
    Off,
    Starting,
    Running,
    Stopping,
    Faulted,
}

/// <summary>How the screen is grabbed.</summary>
public enum CaptureMethod
{
    /// <summary>Desktop Duplication (Windows Graphics Capture only for rotated monitors or when picked explicitly).</summary>
    Auto,
    /// <summary>DXGI Desktop Duplication (ffmpeg ddagrab), event driven: each presented picture when it arrives; a still
    /// screen sends nothing.</summary>
    DesktopDuplication,
    /// <summary>Windows.Graphics.Capture (ffmpeg gfxcapture, FFmpeg 8.1+): event driven too; yellow border on Windows 10.</summary>
    WindowsGraphicsCapture,
    /// <summary>Desktop Duplication timed the 1.0.1 way (ddagrab's own timer, repeats on still screens). A fallback: motion
    /// is less even because ffmpeg.exe's timer wakes on the 15.6 ms Windows tick.</summary>
    DesktopDuplicationClassic,
}
