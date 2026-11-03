using PcClipper.App.Platform;
using PcClipper.App.UI;

namespace PcClipper.App;

internal static class Program
{
    /// <summary>
    /// Entry point. One instance only (a second launch just shows the first one's window), DPI-aware,
    /// global exception handlers, then the <see cref="AppController"/> runs the app.
    /// "--minimized" (used by Start with Windows) starts hidden in the tray.
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        IDisposable? instanceHandle = null;
        bool first;
        try
        {
            first = SingleInstance.TryAcquire(out instanceHandle);
        }
        catch
        {
            // If the single-instance check itself fails, running is better than not starting at all.
            first = true;
        }
        if (!first)
        {
            try { SingleInstance.SignalExisting(); }
            catch { /* the other instance may be closing */ }
            return 0;
        }

        // No ApplicationConfiguration source generator in this build: configure WinForms by hand.
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        CrashReporter.Install(); // also sets UnhandledExceptionMode.CatchException; must precede any window

        // 1 ms timer resolution for the audio pacing thread and no EcoQoS throttling while a game has the focus.
        try { ProcessTuning.ApplyToCurrentProcess(); }
        catch { /* optional: PC Clipper still works, audio pacing is just a little coarser */ }

        bool minimized = args.Any(a => string.Equals(a, "--minimized", StringComparison.OrdinalIgnoreCase));
        try
        {
            using var app = new AppController(minimized);
            Application.Run(app);
            return 0;
        }
        catch (Exception ex)
        {
            CrashReporter.Report(ex, fatal: true, "start-up");
            return 1;
        }
        finally
        {
            try { instanceHandle?.Dispose(); } catch { }
        }
    }
}
