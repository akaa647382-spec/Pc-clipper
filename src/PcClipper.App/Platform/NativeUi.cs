using System.Reflection;
using System.Runtime.InteropServices;

namespace PcClipper.App.Platform;

/// <summary>Small window helpers (DWM title bar, capture exclusion, app icon). Every method ignores failure.</summary>
public static class NativeUi
{
    private static byte[]? s_iconBytes;

    /// <summary>Dark title bar (DWMWA_USE_IMMERSIVE_DARK_MODE); ignores failure.</summary>
    /// <remarks>Attribute 20 is the documented one (Windows 10 20H1+ and 11); builds 1809-1909 used the undocumented 19.</remarks>
    public static void UseDarkTitleBar(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        try
        {
            int on = 1;
            if (DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int)) != 0)
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1, ref on, sizeof(int));
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            // No DWM attribute support: the light title bar is fine.
        }
    }

    /// <summary>Exclude a window from screen capture (WDA_EXCLUDEFROMCAPTURE); ignores failure.</summary>
    /// <remarks>
    /// Only applied on Windows 10 2004 (build 19041) and later. Older builds treat the flag like WDA_MONITOR, which would
    /// put a black box into the clip instead of the window - worse than showing the window.
    /// </remarks>
    public static void ExcludeFromCapture(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero || !OperatingSystem.IsWindowsVersionAtLeast(10, 0, 19041)) return;
        try
        {
            if (!SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE))
                PlatformLog.Info($"Could not exclude a window from capture (Windows error {Marshal.GetLastWin32Error()}).");
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
        }
    }

    /// <summary>
    /// Shows <paramref name="reason"/> on Windows' "These apps are preventing shutdown" screen while PC Clipper holds up
    /// a shutdown (it returned FALSE to WM_QUERYENDSESSION to finish writing a video). Must be called on the thread that
    /// created <paramref name="hwnd"/> (a top-level window). Returns false on failure (ignored otherwise).
    /// </summary>
    public static bool BlockShutdown(IntPtr hwnd, string reason)
    {
        if (hwnd == IntPtr.Zero) return false;
        try
        {
            if (ShutdownBlockReasonCreate(hwnd, reason)) return true;
            PlatformLog.Info($"ShutdownBlockReasonCreate failed (Windows error {Marshal.GetLastWin32Error()}).");
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
        }
        return false;
    }

    /// <summary>Removes the reason set by <see cref="BlockShutdown"/> (same thread); ignores failure.</summary>
    public static void AllowShutdown(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        try { ShutdownBlockReasonDestroy(hwnd); }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
        }
    }

    /// <summary>The app icon from the embedded resource "pcclipper.ico" (closest size); the stock icon if that fails.</summary>
    public static Icon AppIcon(int size = 32)
    {
        try
        {
            var bytes = s_iconBytes ??= LoadIconBytes();
            if (bytes is not null)
            {
                using var ms = new MemoryStream(bytes, writable: false);
                return new Icon(ms, size, size);
            }
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("App icon could not be loaded: " + ex.Message);
        }
        return (Icon)SystemIcons.Application.Clone();
    }

    private static byte[]? LoadIconBytes()
    {
        using var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("pcclipper.ico");
        if (s is null) return null;
        using var ms = new MemoryStream();
        s.CopyTo(ms);
        return ms.ToArray();
    }

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE_BEFORE_20H1 = 19;
    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
    private const uint WDA_EXCLUDEFROMCAPTURE = 0x00000011;

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShutdownBlockReasonCreate(IntPtr hWnd, string pwszReason);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShutdownBlockReasonDestroy(IntPtr hWnd);
}
