using System.Diagnostics;
using System.Text;

namespace PcClipper.Core;

public sealed record FfmpegRunResult(int ExitCode, bool TimedOut, string StdErr, string StdOut)
{
    public bool Ok => !TimedOut && ExitCode == 0;

    /// <summary>The last few non-empty stderr lines (what usually explains a failure).</summary>
    public string Tail(int lines = 6) =>
        string.Join(Environment.NewLine, StdErr.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0).TakeLast(lines));
}

/// <summary>Runs short-lived ffmpeg commands (probe, concat, screenshot) and captures their output.</summary>
public static class FfmpegRunner
{
    public static ProcessStartInfo CreateStartInfo(string exe, IEnumerable<string> args, bool redirectStdin = false, bool redirectStdout = true)
    {
        var psi = new ProcessStartInfo(exe)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = redirectStdout,
            RedirectStandardInput = redirectStdin,
            StandardErrorEncoding = Encoding.UTF8,
            StandardOutputEncoding = redirectStdout ? Encoding.UTF8 : null,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        return psi;
    }

    public static string FormatCommandLine(string exe, IEnumerable<string> args) =>
        string.Join(' ', new[] { exe }.Concat(args).Select(a => a.Length == 0 || a.Any(char.IsWhiteSpace) || a.Contains('"') ? "\"" + a.Replace("\"", "\\\"") + "\"" : a));

    public static async Task<FfmpegRunResult> RunAsync(string exe, IReadOnlyList<string> args, TimeSpan timeout, ILog? log = null,
        IProcessGuard? guard = null, CancellationToken ct = default, ProcessPriorityClass? priority = null)
    {
        log?.Info("ffmpeg: " + FormatCommandLine(exe, args));
        using var p = new Process { StartInfo = CreateStartInfo(exe, args) };
        var err = new StringBuilder();
        var outp = new StringBuilder();
        p.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (err) err.AppendLine(e.Data); };
        p.OutputDataReceived += (_, e) => { if (e.Data is not null) lock (outp) outp.AppendLine(e.Data); };
        try
        {
            if (!p.Start()) return new FfmpegRunResult(-1, false, "ffmpeg did not start", "");
        }
        catch (Exception ex)
        {
            return new FfmpegRunResult(-1, false, $"Could not start ffmpeg: {ex.Message}", "");
        }
        guard?.Attach(p);
        if (priority is { } pc)
        {
            // Saves run below normal so they never compete with the game or the live capture: CPU, and (a save is
            // mostly reading and writing gigabytes) disk and memory too.
            try { p.PriorityClass = pc; } catch { /* not permitted / already exited */ }
            if (pc is ProcessPriorityClass.BelowNormal or ProcessPriorityClass.Idle) guard?.LowerToBackground(p);
        }
        p.BeginErrorReadLine();
        p.BeginOutputReadLine();

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(timeout);
        bool timedOut = false;
        try
        {
            await p.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            timedOut = !ct.IsCancellationRequested;
            try { p.Kill(entireProcessTree: true); } catch { /* already gone */ }
            try { p.WaitForExit(2000); } catch { }
            if (ct.IsCancellationRequested) throw;
        }
        // Make sure the async readers have drained (bounded, in case a grandchild keeps the pipe open).
        try { p.WaitForExit(5000); } catch { }

        string e2, o2;
        lock (err) e2 = err.ToString();
        lock (outp) o2 = outp.ToString();
        return new FfmpegRunResult(timedOut ? -1 : p.ExitCode, timedOut, e2, o2);
    }
}
