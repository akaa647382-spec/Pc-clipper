using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Where platform services that have no <see cref="ILog"/> parameter (toast, hotkeys, sounds, registry, ...) report
/// what went wrong. <see cref="FileLog"/> registers itself here when it is created, so no wiring is needed; the UI may
/// also call <see cref="Attach"/> with its own (never-throwing) log. Until then messages go to the debugger output.
/// Every method here is safe to call from any thread and never throws.
/// </summary>
public static class PlatformLog
{
    private static volatile ILog? s_log;

    /// <summary>Use <paramref name="log"/> for platform diagnostics from now on.</summary>
    public static void Attach(ILog log) => s_log = log;

    /// <summary>Called by a <see cref="FileLog"/> that is being disposed: stop using it.</summary>
    internal static void Detach(ILog log)
    {
        if (ReferenceEquals(s_log, log)) s_log = null;
    }

    /// <summary>Register <paramref name="log"/> only if nothing is attached yet (FileLog's constructor).</summary>
    internal static void AttachIfNone(ILog log)
    {
        if (s_log is null) s_log = log;
    }

    internal static void Info(string message)
    {
        try
        {
            if (s_log is { } l) l.Info(message);
            else System.Diagnostics.Debug.WriteLine("INFO  " + message);
        }
        catch { /* logging must never break the caller */ }
    }

    internal static void Warn(string message)
    {
        try
        {
            if (s_log is { } l) l.Warn(message);
            else System.Diagnostics.Debug.WriteLine("WARN  " + message);
        }
        catch { }
    }

    internal static void Error(string message, Exception? ex = null)
    {
        try
        {
            if (s_log is { } l) l.Error(message, ex);
            else System.Diagnostics.Debug.WriteLine("ERROR " + message + " " + ex);
        }
        catch { }
    }
}
