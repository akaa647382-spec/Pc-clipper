using System.Runtime.InteropServices;

namespace PcClipper.App.Platform;

/// <summary>
/// One PC Clipper per Windows logon session. The first instance owns the named mutex
/// <c>Local\PCClipper.SingleInstance</c> and, immediately (so a second launch can never race it), the auto-reset event
/// <c>Local\PCClipper.Show</c>. A second launch sets the event and exits; the first instance's
/// <see cref="ListenForShow"/> callback then shows its window.
/// </summary>
/// <remarks>
/// The second launch was just started by the user, so it may hand its foreground right on:
/// AllowSetForegroundWindow(ASFW_ANY) lets the first instance bring its window to the front. A registered window message
/// broadcast is not used because a ShowInTaskbar=false form is an owned window and never receives broadcasts.
/// </remarks>
public static class SingleInstance
{
    private const string MutexName = @"Local\PCClipper.SingleInstance";
    private const string ShowEventName = @"Local\PCClipper.Show";

    private static readonly object s_gate = new();
    // Static references so the kernel objects live as long as the app, whatever the caller does with the handle.
    private static Mutex? s_mutex;
    private static EventWaitHandle? s_showEvent;
    private static RegisteredWaitHandle? s_registration;

    /// <summary>True if we are the first instance (keep the returned handle alive for the app's lifetime).</summary>
    /// <remarks>Never throws: if the check itself fails, it answers true (running twice beats not starting).</remarks>
    public static bool TryAcquire(out IDisposable? handle)
    {
        handle = null;
        try
        {
            var mutex = new Mutex(initiallyOwned: false, MutexName, out bool createdNew);
            if (!createdNew)
            {
                mutex.Dispose();
                return false;
            }
            lock (s_gate)
            {
                s_mutex = mutex;
                try { s_showEvent ??= new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName); }
                catch (Exception ex) { PlatformLog.Warn("Second-launch signal unavailable: " + ex.Message); }
            }
            handle = new Releaser();
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            // The mutex exists but belongs to an instance running with other rights (e.g. "Run as administrator").
            return false;
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("Single-instance check failed; starting anyway: " + ex.Message);
            return true;
        }
    }

    /// <summary>Ask the running instance to show its window. Never throws.</summary>
    public static void SignalExisting()
    {
        try { AllowSetForegroundWindow(ASFW_ANY); } catch { /* best effort */ }
        try
        {
            using var ev = EventWaitHandle.OpenExisting(ShowEventName);
            ev.Set();
        }
        catch (Exception)
        {
            // The first instance is shutting down, or runs with other rights: nothing to do.
        }
    }

    /// <summary>Calls <paramref name="onShow"/> (on a background thread) whenever another launch signals us.</summary>
    /// <remarks>Never throws: if the signal can't be set up, a second launch just won't bring this window forward.</remarks>
    public static void ListenForShow(Action onShow)
    {
        try
        {
            lock (s_gate)
            {
                s_showEvent ??= new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
                s_registration?.Unregister(null);
                s_registration = ThreadPool.RegisterWaitForSingleObject(s_showEvent, (_, _) =>
                {
                    try { onShow(); }
                    catch (Exception ex) { PlatformLog.Error("Showing the window for a second launch failed", ex); }
                }, null, Timeout.Infinite, executeOnlyOnce: false);
            }
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("Second-launch listener unavailable: " + ex.Message);
        }
    }

    /// <summary>Releases the mutex, the event and the listener (app exit).</summary>
    private sealed class Releaser : IDisposable
    {
        private int _done;

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _done, 1) != 0) return;
            lock (s_gate)
            {
                try { s_registration?.Unregister(null); } catch { }
                s_registration = null;
                try { s_showEvent?.Dispose(); } catch { }
                s_showEvent = null;
                try { s_mutex?.Dispose(); } catch { }
                s_mutex = null;
            }
        }
    }

    private const uint ASFW_ANY = unchecked((uint)-1);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AllowSetForegroundWindow(uint dwProcessId);
}
