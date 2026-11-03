using System.Text.Json;
using System.Text.Json.Serialization;

namespace PcClipper.Core;

/// <summary>A global hotkey. <see cref="KeyCode"/> is a Windows virtual-key code (same values as WinForms Keys).</summary>
public sealed class HotkeyBinding
{
    public bool Ctrl { get; set; }
    public bool Alt { get; set; }
    public bool Shift { get; set; }
    public bool Win { get; set; }

    /// <summary>Virtual-key code; 0 means "not assigned".</summary>
    public int KeyCode { get; set; }

    [JsonIgnore]
    public bool IsAssigned => KeyCode != 0;

    public HotkeyBinding Clone() => (HotkeyBinding)MemberwiseClone();

    public bool SameAs(HotkeyBinding? other) =>
        other is not null && other.Ctrl == Ctrl && other.Alt == Alt && other.Shift == Shift && other.Win == Win && other.KeyCode == KeyCode;

    /// <summary>Ctrl+Alt+F-key: avoids NVIDIA (Alt+F), AMD (Ctrl+Shift+letter), Game Bar (Win+Alt), Steam (F12, Ctrl+F11)
    /// and AltGr characters on European keyboards (AltGr = Ctrl+Alt, but only with letters/digits).</summary>
    public static HotkeyBinding CtrlAltF(int fNumber) => new() { Ctrl = true, Alt = true, KeyCode = 0x6F + fNumber }; // VK_F1 = 0x70
}

/// <summary>Everything the user can change. Persisted as JSON in %LOCALAPPDATA%\PCClipper\settings.json.</summary>
public sealed class AppSettings
{
    // ---- Video ----
    /// <summary>DXGI/GDI device name like "\\.\DISPLAY1". Null or unknown = primary monitor.</summary>
    public string? MonitorDeviceName { get; set; }
    public ResolutionPreset Resolution { get; set; } = ResolutionPreset.Native;
    /// <summary>30, 60 or 120.</summary>
    public int Fps { get; set; } = 60;
    public QualityLevel Quality { get; set; } = QualityLevel.High;
    /// <summary>Used only when <see cref="Quality"/> is Custom.</summary>
    public int CustomBitrateMbps { get; set; } = 50;
    public EncoderVendor Encoder { get; set; } = EncoderVendor.Auto;
    public VideoCodec Codec { get; set; } = VideoCodec.Auto;
    public bool CaptureCursor { get; set; } = true;
    /// <summary>
    /// What the user picked, including <see cref="CaptureMethod.DesktopDuplicationClassic"/>. Not saved as such: the file
    /// keeps CaptureMethod to the three values 1.0.1 knows (an unknown name would make 1.0.1 throw the whole settings
    /// file away) plus <see cref="ClassicCaptureTiming"/>, which older versions ignore.
    /// </summary>
    [JsonIgnore]
    public CaptureMethod CaptureMethod
    {
        get => _classicTiming && _method == CaptureMethod.DesktopDuplication ? CaptureMethod.DesktopDuplicationClassic : _method;
        set
        {
            _classicTiming = value == CaptureMethod.DesktopDuplicationClassic;
            _method = _classicTiming ? CaptureMethod.DesktopDuplication : value;
        }
    }
    private CaptureMethod _method = CaptureMethod.Auto;
    private bool _classicTiming;

    /// <summary>Saved form of <see cref="CaptureMethod"/> (never DesktopDuplicationClassic).</summary>
    [JsonPropertyName("CaptureMethod")]
    public CaptureMethod SavedCaptureMethod
    {
        get => _method;
        set => _method = value == CaptureMethod.DesktopDuplicationClassic ? CaptureMethod.DesktopDuplication : value;
    }

    /// <summary>Desktop Duplication with the 1.0.1 timing (see <see cref="CaptureMethod.DesktopDuplicationClassic"/>).</summary>
    public bool ClassicCaptureTiming
    {
        get => _classicTiming;
        set => _classicTiming = value;
    }

    // ---- Replay ----
    /// <summary>How much gameplay is kept on disk, 1..60 minutes.</summary>
    public int BufferMinutes { get; set; } = 60;
    /// <summary>What the "save replay" hotkey saves, in seconds (15..3600).</summary>
    public int HotkeySaveSeconds { get; set; } = 900;
    public string BufferFolder { get; set; } = DefaultPaths.BufferFolder;
    public string ClipsFolder { get; set; } = DefaultPaths.ClipsFolder;
    public string ScreenshotsFolder { get; set; } = DefaultPaths.ScreenshotsFolder;

    // ---- Audio ----
    public bool RecordDesktopAudio { get; set; } = true;
    /// <summary>0.0 .. 2.0</summary>
    public float DesktopVolume { get; set; } = 1.0f;
    public bool RecordMicrophone { get; set; }
    /// <summary>MMDevice ID; null = the Windows default recording device (Console role).</summary>
    public string? MicrophoneDeviceId { get; set; }
    /// <summary>0.0 .. 2.0</summary>
    public float MicrophoneVolume { get; set; } = 1.0f;
    /// <summary>Shifts the sound against the picture (+ = sound later). Safety valve if a PC shows a constant offset.</summary>
    public int AudioSyncOffsetMs { get; set; }

    // ---- Hotkeys ----
    public HotkeyBinding SaveReplayHotkey { get; set; } = HotkeyBinding.CtrlAltF(9);
    public HotkeyBinding RecordHotkey { get; set; } = HotkeyBinding.CtrlAltF(10);
    public HotkeyBinding ScreenshotHotkey { get; set; } = HotkeyBinding.CtrlAltF(11);
    public HotkeyBinding ToggleReplayHotkey { get; set; } = HotkeyBinding.CtrlAltF(8);

    // ---- Controller (Xbox / PlayStation) ----
    /// <summary>Use controller button combos as shortcuts (they work while a game is in front).</summary>
    public bool ControllerShortcuts { get; set; } = true;
    /// <summary>Defaults: hold View (Xbox) / Create-Share (PlayStation) and press a face button.</summary>
    public PadChord PadSaveReplay { get; set; } = PadChord.Of(PadButtons.View, PadButtons.A);
    public PadChord PadRecord { get; set; } = PadChord.Of(PadButtons.View, PadButtons.X);
    public PadChord PadScreenshot { get; set; } = PadChord.Of(PadButtons.View, PadButtons.Y);
    public PadChord PadToggleReplay { get; set; } = PadChord.Off;
    /// <summary>Short rumble when a controller shortcut did something (useful when the on-screen notice can't show).</summary>
    public bool ControllerVibrate { get; set; } = true;

    // ---- General ----
    public bool StartWithWindows { get; set; }
    public bool StartReplayOnLaunch { get; set; } = true;
    public bool MinimizeToTrayOnClose { get; set; } = true;
    public bool ShowOverlay { get; set; } = true;
    /// <summary>Off by default: desktop-audio capture would record the beeps into later clips.</summary>
    public bool PlaySounds { get; set; }
    /// <summary>Earlier buffer folders that may still hold a recording waiting to be recovered (checked at startup).</summary>
    public List<string> KeptRecordingRoots { get; set; } = new();
    /// <summary>Explicit ffmpeg.exe path chosen by the user; null = auto-locate.</summary>
    public string? FfmpegPath { get; set; }

    public static readonly int[] AllowedFps = { 30, 60, 120 };
    public static readonly int[] SaveLengthsSeconds = { 15, 30, 60, 300, 900, 1800, 3600 };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Clamp every value into its legal range (call after loading or editing).</summary>
    public AppSettings Normalize()
    {
        if (Array.IndexOf(AllowedFps, Fps) < 0) Fps = 60;
        BufferMinutes = Math.Clamp(BufferMinutes, 1, 60);
        HotkeySaveSeconds = Math.Clamp(HotkeySaveSeconds, 15, 3600);
        CustomBitrateMbps = Math.Clamp(CustomBitrateMbps, 2, 500);
        DesktopVolume = Math.Clamp(DesktopVolume, 0f, 2f);
        MicrophoneVolume = Math.Clamp(MicrophoneVolume, 0f, 2f);
        AudioSyncOffsetMs = Math.Clamp(AudioSyncOffsetMs, -2000, 2000);
        if (string.IsNullOrWhiteSpace(BufferFolder)) BufferFolder = DefaultPaths.BufferFolder;
        if (string.IsNullOrWhiteSpace(ClipsFolder)) ClipsFolder = DefaultPaths.ClipsFolder;
        if (string.IsNullOrWhiteSpace(ScreenshotsFolder)) ScreenshotsFolder = DefaultPaths.ScreenshotsFolder;
        SaveReplayHotkey ??= HotkeyBinding.CtrlAltF(9);
        RecordHotkey ??= HotkeyBinding.CtrlAltF(10);
        ScreenshotHotkey ??= HotkeyBinding.CtrlAltF(11);
        ToggleReplayHotkey ??= HotkeyBinding.CtrlAltF(8);
        KeptRecordingRoots = (KeptRecordingRoots ?? new()).Where(p => !string.IsNullOrWhiteSpace(p))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        PadSaveReplay ??= PadChord.Of(PadButtons.View, PadButtons.A);
        PadRecord ??= PadChord.Of(PadButtons.View, PadButtons.X);
        PadScreenshot ??= PadChord.Of(PadButtons.View, PadButtons.Y);
        PadToggleReplay ??= PadChord.Off;
        return this;
    }

    public AppSettings Clone() => JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(this, JsonOptions), JsonOptions)!;

    public static AppSettings Load(string path)
    {
        try
        {
            if (File.Exists(path))
                return (JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path), JsonOptions) ?? new AppSettings()).Normalize();
        }
        catch (Exception)
        {
            // A broken settings file must never stop the app from starting; fall back to defaults.
        }
        return new AppSettings().Normalize();
    }

    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(this, JsonOptions));
        File.Move(tmp, path, overwrite: true);
    }

    /// <summary>True when a change between the two settings requires restarting the capture pipeline.
    /// (BufferMinutes is applied live with ReplayEngine.SetBufferSeconds.)</summary>
    public bool CaptureDiffers(AppSettings other) =>
        MonitorDeviceName != other.MonitorDeviceName || Resolution != other.Resolution || Fps != other.Fps ||
        Quality != other.Quality || CustomBitrateMbps != other.CustomBitrateMbps || Encoder != other.Encoder ||
        Codec != other.Codec || CaptureCursor != other.CaptureCursor || CaptureMethod != other.CaptureMethod ||
        BufferFolder != other.BufferFolder || RecordDesktopAudio != other.RecordDesktopAudio ||
        RecordMicrophone != other.RecordMicrophone || MicrophoneDeviceId != other.MicrophoneDeviceId ||
        AudioSyncOffsetMs != other.AudioSyncOffsetMs ||
        FfmpegPath != other.FfmpegPath;
}

public static class DefaultPaths
{
    public static string AppDataFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PCClipper");

    public static string SettingsFile => Path.Combine(AppDataFolder, "settings.json");
    public static string LogFolder => Path.Combine(AppDataFolder, "logs");
    public static string BufferFolder => Path.Combine(AppDataFolder, "Buffer");
    public static string FfmpegFolder => Path.Combine(AppDataFolder, "ffmpeg");

    public static string ClipsFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "PC Clipper");

    public static string ScreenshotsFolder =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "PC Clipper");
}
