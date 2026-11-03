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
    /// <summary>Desktop Duplication (Windows Graphics Capture is only used when picked explicitly).</summary>
    Auto,
    /// <summary>DXGI Desktop Duplication (ffmpeg ddagrab): reliable, keeps recording on static screens.</summary>
    DesktopDuplication,
    /// <summary>Windows.Graphics.Capture (ffmpeg gfxcapture, FFmpeg 8.1+): event driven, better above 60 fps.</summary>
    WindowsGraphicsCapture,
}
