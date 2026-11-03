using System.Runtime.InteropServices;

namespace PcClipper.App.Platform;

/// <summary>
/// Process-wide tuning for PC Clipper itself (call once at startup): timeBeginPeriod(1) for the audio pacing thread,
/// and no EcoQoS power throttling (including PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION on Windows 11).
/// Never throws.
/// </summary>
/// <remarks>
/// Why: since Windows 10 2004 the timer resolution is per process, so without timeBeginPeriod(1) Sleep() in the audio
/// pump rounds up to ~15.6 ms (more jitter, never drift). EcoQoS can park a background process on efficiency cores and
/// (Windows 11) ignore its timer-resolution request while it has no visible window, i.e. whenever PC Clipper sits in
/// the tray during a game. Both are undone here. The same throttling opt-out is applied to ffmpeg by
/// <see cref="JobObjectGuard"/>.
/// </remarks>
public static class ProcessTuning
{
    private static int s_applied;

    public static void ApplyToCurrentProcess()
    {
        if (Interlocked.Exchange(ref s_applied, 1) != 0) return;
        try
        {
            // Never matched by timeEndPeriod: the request lives as long as the process (Windows drops it at exit).
            uint r = timeBeginPeriod(1);
            if (r != 0) PlatformLog.Warn($"timeBeginPeriod(1) failed (code {r}); audio timing may be a little less precise.");
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            PlatformLog.Warn("timeBeginPeriod is unavailable: " + ex.Message);
        }
        DisablePowerThrottling(GetCurrentProcess(), "PC Clipper");
    }

    /// <summary>
    /// Opt <paramref name="hProcess"/> out of EcoQoS (Windows 10 1709+) and, separately, out of "ignore timer resolution
    /// while invisible" (Windows 11; unknown flag on Windows 10, so it is its own call). Returns false if the main
    /// opt-out failed. Never throws.
    /// </summary>
    internal static bool DisablePowerThrottling(IntPtr hProcess, string what)
    {
        bool ok = TrySet(hProcess, PROCESS_POWER_THROTTLING_EXECUTION_SPEED, out int err1);
        TrySet(hProcess, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, out _); // expected to fail before Windows 11
        if (!ok) PlatformLog.Info($"Power throttling opt-out for {what} not applied (Windows error {err1}).");
        return ok;
    }

    private static bool TrySet(IntPtr hProcess, uint mechanism, out int error)
    {
        error = 0;
        try
        {
            // ControlMask = the mechanism we take control of; StateMask = 0 means "off" (HighQoS / honour timer requests).
            var state = new PROCESS_POWER_THROTTLING_STATE { Version = PROCESS_POWER_THROTTLING_CURRENT_VERSION, ControlMask = mechanism, StateMask = 0 };
            if (SetProcessInformation(hProcess, ProcessPowerThrottling, ref state, (uint)Marshal.SizeOf<PROCESS_POWER_THROTTLING_STATE>()))
                return true;
            error = Marshal.GetLastWin32Error();
            return false;
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException)
        {
            error = -1; // Windows older than 8: no SetProcessInformation
            return false;
        }
    }

    private const int ProcessPowerThrottling = 4; // PROCESS_INFORMATION_CLASS
    private const uint PROCESS_POWER_THROTTLING_CURRENT_VERSION = 1;
    private const uint PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 0x1;
    private const uint PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION = 0x4;

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_POWER_THROTTLING_STATE // 12 bytes
    {
        public uint Version;
        public uint ControlMask;
        public uint StateMask;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetProcessInformation(IntPtr hProcess, int processInformationClass,
        ref PROCESS_POWER_THROTTLING_STATE processInformation, uint processInformationSize);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("winmm.dll")]
    private static extern uint timeBeginPeriod(uint uPeriod);
}
