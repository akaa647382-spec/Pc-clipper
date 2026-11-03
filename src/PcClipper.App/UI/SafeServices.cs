using System.Diagnostics;
using System.Globalization;
using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

// Thin wrappers around the platform services so that a failure in any of them (missing device, old Windows,
// broken driver) is logged and degrades gracefully instead of taking the app down.

/// <summary>An <see cref="ILog"/> that never throws. Wraps <see cref="FileLog"/>; falls back to the debugger output.</summary>
internal sealed class SafeLog : ILog, IDisposable
{
    private readonly ILog? _inner;
    private readonly IDisposable? _owned;

    private SafeLog(ILog? inner, IDisposable? owned, string? filePath)
    {
        _inner = inner;
        _owned = owned;
        FilePath = filePath;
    }

    /// <summary>Full path of the log file, or null if file logging is unavailable.</summary>
    public string? FilePath { get; }

    public static SafeLog Create(string folder)
    {
        try
        {
            var file = new FileLog(folder);
            string? path = null;
            try { path = file.FilePath; } catch { /* optional */ }
            return new SafeLog(file, file, path);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"PC Clipper: file log unavailable: {ex}");
            return new SafeLog(null, null, null);
        }
    }

    public void Info(string message)
    {
        try { _inner?.Info(message); } catch { /* never let logging break the app */ }
        Debug.WriteLine("INFO  " + message);
    }

    public void Warn(string message)
    {
        try { _inner?.Warn(message); } catch { }
        Debug.WriteLine("WARN  " + message);
    }

    public void Error(string message, Exception? ex = null)
    {
        try { _inner?.Error(message, ex); } catch { }
        Debug.WriteLine("ERROR " + message + " " + ex);
    }

    public void Dispose()
    {
        try { _owned?.Dispose(); } catch { }
    }
}

/// <summary>Uses the job-object guard when available; otherwise ffmpeg simply runs without it.</summary>
internal sealed class SafeProcessGuard : IProcessGuard
{
    private readonly ILog _log;
    private IProcessGuard? _inner;
    private int _warned;

    public SafeProcessGuard(ILog log) => _log = log;

    public void Attach(Process process)
    {
        try
        {
            _inner ??= JobObjectGuard.Instance;
            _inner.Attach(process);
        }
        catch (Exception ex)
        {
            if (Interlocked.Exchange(ref _warned, 1) == 0)
                _log.Warn($"Could not attach ffmpeg to the job object (it may outlive PC Clipper if it crashes): {ex.Message}");
        }
    }
}

/// <summary>Monitor enumeration with a Screen.AllScreens fallback, so there is always at least one monitor.</summary>
internal static class Monitors
{
    public static IReadOnlyList<MonitorInfo> Enumerate(ILog log)
    {
        try
        {
            var list = DxgiMonitors.Enumerate(log);
            if (list.Count > 0) return list;
        }
        catch (Exception ex)
        {
            log.Error("Monitor enumeration failed; using the basic screen list", ex);
        }
        return FromScreens();
    }

    public static IReadOnlyList<MonitorInfo> FromScreens()
    {
        var result = new List<MonitorInfo>();
        try
        {
            var screens = Screen.AllScreens.OrderByDescending(s => s.Primary).ToArray();
            for (int i = 0; i < screens.Length; i++)
            {
                var s = screens[i];
                result.Add(new MonitorInfo(0, i, s.DeviceName, $"Screen {i + 1}", s.Bounds.Width, s.Bounds.Height, 60, 0, "", s.Primary)
                {
                    Left = s.Bounds.Left,
                    Top = s.Bounds.Top,
                });
            }
        }
        catch
        {
            // Nothing else to try.
        }
        if (result.Count == 0)
            result.Add(new MonitorInfo(0, 0, @"\\.\DISPLAY1", "Main screen", 1920, 1080, 60, 0, "", true));
        return result;
    }

    public static MonitorInfo Pick(IReadOnlyList<MonitorInfo> monitors, string? deviceName)
    {
        try
        {
            return DxgiMonitors.Pick(monitors, deviceName);
        }
        catch
        {
            return monitors.FirstOrDefault(m => string.Equals(m.DeviceName, deviceName, StringComparison.OrdinalIgnoreCase))
                   ?? monitors.FirstOrDefault(m => m.IsPrimary)
                   ?? monitors.FirstOrDefault()
                   ?? FromScreens()[0];
        }
    }

    public static Rectangle Bounds(MonitorInfo m) => new(m.Left, m.Top, m.Width, m.Height);
}

/// <summary>Hotkey text ("Alt+F10") with a local fallback if the platform helper is unavailable.</summary>
internal static class HotkeyText
{
    public static string Describe(HotkeyBinding? b)
    {
        if (b is null || !b.IsAssigned) return "Not set";
        try
        {
            return HotkeyManager.Describe(b);
        }
        catch
        {
            var parts = new List<string>();
            if (b.Ctrl) parts.Add("Ctrl");
            if (b.Alt) parts.Add("Alt");
            if (b.Shift) parts.Add("Shift");
            if (b.Win) parts.Add("Win");
            parts.Add(KeyName(b.KeyCode));
            return string.Join("+", parts);
        }
    }

    public static string KeyName(int keyCode)
    {
        var k = (Keys)keyCode;
        if (k >= Keys.D0 && k <= Keys.D9) return ((char)('0' + (k - Keys.D0))).ToString();
        if (k >= Keys.NumPad0 && k <= Keys.NumPad9) return "Num " + (k - Keys.NumPad0);
        return k switch
        {
            Keys.Next => "PageDown",
            Keys.Prior => "PageUp",
            Keys.Snapshot => "PrintScreen",
            Keys.Oemtilde => "`",
            Keys.OemMinus => "-",
            Keys.Oemplus => "=",
            Keys.OemOpenBrackets => "[",
            Keys.OemCloseBrackets => "]",
            Keys.OemPipe => "\\",
            Keys.OemSemicolon => ";",
            Keys.OemQuotes => "'",
            Keys.Oemcomma => ",",
            Keys.OemPeriod => ".",
            Keys.OemQuestion => "/",
            _ => k.ToString(),
        };
    }
}

/// <summary>Opening files and folders with Explorer. Every method reports failure instead of throwing.</summary>
internal static class Shell
{
    public static bool Open(string path, out string? error)
    {
        error = null;
        try
        {
            if (!File.Exists(path) && !Directory.Exists(path))
            {
                error = "That file was moved or deleted.";
                return false;
            }
            Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            return true;
        }
        catch (Exception ex)
        {
            error = $"Windows couldn't open it: {ex.Message}";
            return false;
        }
    }

    public static bool ShowInFolder(string path, out string? error)
    {
        error = null;
        try
        {
            if (!File.Exists(path))
            {
                error = "That file was moved or deleted.";
                return false;
            }
            Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{path}\"") { UseShellExecute = true });
            return true;
        }
        catch (Exception ex)
        {
            error = $"Windows couldn't open the folder: {ex.Message}";
            return false;
        }
    }

    public static bool OpenFolder(string folder, out string? error)
    {
        error = null;
        try
        {
            Directory.CreateDirectory(folder);
            Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
            return true;
        }
        catch (Exception ex)
        {
            error = $"Couldn't open {folder}: {ex.Message}";
            return false;
        }
    }
}

/// <summary>Plain-language formatting used across the UI.</summary>
internal static class Fmt
{
    /// <summary>"03:21", or "1:02:03" past an hour (recording timers).</summary>
    public static string Clock(TimeSpan t) =>
        t.TotalHours >= 1 ? $"{(int)t.TotalHours}:{t.Minutes:00}:{t.Seconds:00}" : $"{t.Minutes:00}:{t.Seconds:00}";

    /// <summary>"12:34" / "60:00" (minutes may exceed 59), used for "12:34 saved of 60:00".</summary>
    public static string MinSec(TimeSpan t) => $"{(int)t.TotalMinutes}:{t.Seconds:00}";

    public static string Minutes(int minutes) => minutes == 1 ? "1 minute" : $"{minutes} minutes";

    public static string When(DateTime t)
    {
        var time = t.ToString("t", CultureInfo.CurrentCulture);
        if (t.Date == DateTime.Today) return "Today " + time;
        if (t.Date == DateTime.Today.AddDays(-1)) return "Yesterday " + time;
        return t.ToString("d MMM", CultureInfo.CurrentCulture) + " " + time;
    }

    /// <summary>The text before the first blank line (engine errors append raw ffmpeg output after one).</summary>
    public static string FirstParagraph(string text)
    {
        var normalized = text.Replace("\r\n", "\n").Trim();
        int i = normalized.IndexOf("\n\n", StringComparison.Ordinal);
        return (i < 0 ? normalized : normalized[..i]).Replace('\n', ' ').Trim();
    }

    public static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..Math.Max(0, max - 3)].TrimEnd() + "...";

    /// <summary>Ensures a sentence ends with punctuation so another sentence can follow it.</summary>
    public static string Sentence(string text)
    {
        text = text.Trim();
        return text.Length == 0 || ".!?\u2026".Contains(text[^1]) ? text : text + ".";
    }

    /// <summary>"hevc_nvenc" -> "HEVC (NVIDIA)".</summary>
    public static string EncoderLabel(string encoder) => encoder switch
    {
        "libx264" => "H.264 (CPU)",
        "libx265" => "HEVC (CPU)",
        "libsvtav1" => "AV1 (CPU)",
        _ => $"{CodecPart(encoder)} ({VendorPart(encoder)})",
    };

    private static string CodecPart(string e) =>
        e.StartsWith("h264", StringComparison.Ordinal) ? "H.264" :
        e.StartsWith("hevc", StringComparison.Ordinal) ? "HEVC" :
        e.StartsWith("av1", StringComparison.Ordinal) ? "AV1" : e;

    private static string VendorPart(string e) =>
        e.EndsWith("nvenc", StringComparison.Ordinal) ? "NVIDIA" :
        e.EndsWith("amf", StringComparison.Ordinal) ? "AMD" :
        e.EndsWith("qsv", StringComparison.Ordinal) ? "Intel" : "other";

    public static string MethodLabel(CaptureMethod method) => method switch
    {
        CaptureMethod.DesktopDuplication => "Desktop Duplication",
        CaptureMethod.WindowsGraphicsCapture => "Windows Graphics Capture",
        _ => "Auto",
    };

    /// <summary>Drive letter of a folder, e.g. "D:".</summary>
    public static string Drive(string folder)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(folder)) ?? folder;
            return root.TrimEnd('\\', '/');
        }
        catch
        {
            return folder;
        }
    }
}

/// <summary>
/// Last line of defence: logs every unhandled exception and tells the user in plain words. Never a silent crash.
/// </summary>
internal static class CrashReporter
{
    private static ILog? s_log;
    private static string? s_logPath;
    private static SynchronizationContext? s_ui;
    private static Func<string, bool>? s_quiet;
    private static int s_showing;
    private static string? s_lastText;
    private static DateTime s_lastShownUtc;

    public static void Install()
    {
        try { Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException); }
        catch (InvalidOperationException) { /* a window already exists; the handlers below still work */ }
        Application.ThreadException += (_, e) => Report(e.Exception, fatal: false, "the window");
        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            Report(e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString() ?? "unknown error"), e.IsTerminating, "a background thread");
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            e.SetObserved();
            // Abandoned pipe/process tasks fault with these during normal shutdown of a capture session: log only.
            bool noise = e.Exception.InnerExceptions.All(x => x is OperationCanceledException or ObjectDisposedException or IOException);
            if (noise) Log($"Ignored background task error: {e.Exception.InnerException?.Message}", e.Exception);
            else Report(e.Exception, fatal: false, "a background task", onUiThread: true);
        };
    }

    /// <summary>
    /// Called once the log and the UI thread exist. <paramref name="quiet"/> (UI thread) may report a non-fatal error
    /// without a message box (returns true): a message box takes focus, which can minimize a fullscreen game.
    /// </summary>
    public static void Attach(ILog log, string? logPath, SynchronizationContext ui, Func<string, bool>? quiet = null)
    {
        s_log = log;
        s_logPath = logPath;
        s_ui = ui;
        s_quiet = quiet;
    }

    public static void Report(Exception ex, bool fatal, string where, bool onUiThread = false)
    {
        Log($"Unhandled exception in {where}{(fatal ? " (fatal)" : "")}", ex);

        var inner = ex is AggregateException agg && agg.InnerExceptions.Count == 1 ? agg.InnerExceptions[0] : ex;
        string text = fatal
            ? "Sorry, PC Clipper ran into a serious problem and has to close.\n\n" +
              $"What happened: {inner.Message}\n\n" +
              "Your saved clips are safe. Start PC Clipper again to keep recording." + LogHint()
            : "Sorry, something went wrong inside PC Clipper.\n\n" +
              $"What happened: {inner.Message}\n\n" +
              "PC Clipper is still running. If this keeps happening, restart it." + LogHint();

        if (onUiThread && s_ui is not null && !fatal)
        {
            s_ui.Post(_ => ShowOrQuiet(inner.Message, text, fatal), null);
            return;
        }
        ShowOrQuiet(inner.Message, text, fatal);
    }

    private static void ShowOrQuiet(string what, string text, bool fatal)
    {
        if (!fatal && s_quiet is { } quiet)
        {
            try
            {
                if (quiet($"Something went wrong inside PC Clipper ({what}). It is still running; details are in the log.")) return;
            }
            catch
            {
                // Fall back to the message box.
            }
        }
        Show(text, fatal);
    }

    private static string LogHint() =>
        s_logPath is null ? "" : $"\n\nDetails were saved to the log file:\n{s_logPath}";

    private static void Show(string text, bool fatal)
    {
        // One box at a time, and don't repeat the same box over and over.
        if (Interlocked.Exchange(ref s_showing, 1) == 1) return;
        try
        {
            if (!fatal && text == s_lastText && DateTime.UtcNow - s_lastShownUtc < TimeSpan.FromSeconds(30)) return;
            s_lastText = text;
            s_lastShownUtc = DateTime.UtcNow;
            MessageBox.Show(text, "PC Clipper", MessageBoxButtons.OK, fatal ? MessageBoxIcon.Error : MessageBoxIcon.Warning);
        }
        catch
        {
            // Can't even show a message box; the log has it.
        }
        finally
        {
            Interlocked.Exchange(ref s_showing, 0);
        }
    }

    private static void Log(string message, Exception ex)
    {
        try
        {
            if (s_log is not null)
            {
                s_log.Error(message, ex);
                return;
            }
            // Before the real log exists: write next to where it would be.
            var folder = DefaultPaths.LogFolder;
            Directory.CreateDirectory(folder);
            File.AppendAllText(Path.Combine(folder, "crash.log"), $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}: {ex}{Environment.NewLine}");
        }
        catch
        {
            Debug.WriteLine($"{message}: {ex}");
        }
    }
}
