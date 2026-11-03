using System.Diagnostics;
using System.Globalization;
using System.Text;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Append-only log file with 5 MB roll-over (pcclipper.log -> pcclipper.1.log). Thread-safe.
/// Lines look like "2026-11-02 17:45:12.345 INFO  [12] message"; Error adds the full exception text, indented.
/// </summary>
/// <remarks>
/// Each line is appended with its own short open/write/close, so the file is never held open: the user can open it in
/// Notepad (or delete it) while PC Clipper runs, and a crash loses nothing. PC Clipper logs a few lines per second at
/// most, so the cost is negligible. Writing never throws: if the disk is full or the file is locked, the line goes to
/// the debugger output instead.
/// </remarks>
public sealed class FileLog : ILog, IDisposable
{
    private const long MaxBytes = 5L * 1024 * 1024;
    private const string FileName = "pcclipper.log";
    private const string RolledFileName = "pcclipper.1.log";
    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    private readonly object _gate = new();
    private readonly string _folder = "";
    private bool _disposed;

    /// <summary>
    /// Uses (or creates) <c>pcclipper.log</c> in <paramref name="folder"/>. If that folder can't be written, falls back to
    /// %TEMP%\PCClipper\logs; throws <see cref="IOException"/> only if neither works.
    /// </summary>
    public FileLog(string folder)
    {
        Exception? first = null;
        foreach (var candidate in new[] { folder, Path.Combine(Path.GetTempPath(), "PCClipper", "logs") })
        {
            try
            {
                Directory.CreateDirectory(candidate);
                var path = Path.Combine(candidate, FileName);
                using (Open(path)) { } // proves we can write here
                _folder = candidate;
                FilePath = path;
                PlatformLog.AttachIfNone(this);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
            {
                first ??= ex;
            }
        }
        throw new IOException($"The log file can't be created in {folder}: {first?.Message}", first);
    }

    /// <summary>Full path of the current log file.</summary>
    public string FilePath { get; } = "";

    public void Info(string message) => Write("INFO ", message, null);
    public void Warn(string message) => Write("WARN ", message, null);
    public void Error(string message, Exception? ex = null) => Write("ERROR", message, ex);

    private void Write(string level, string message, Exception? ex)
    {
        string line;
        try
        {
            var sb = new StringBuilder((message?.Length ?? 0) + 64);
            sb.Append(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture))
              .Append(' ').Append(level).Append(" [").Append(Environment.CurrentManagedThreadId).Append("] ").Append(message);
            if (ex is not null)
                sb.Append(Environment.NewLine).Append("    ").Append(ex.ToString().Replace("\n", "\n    "));
            sb.Append(Environment.NewLine);
            line = sb.ToString();
        }
        catch (Exception)
        {
            return; // an exception whose ToString() throws: nothing sensible to write
        }

        try
        {
            lock (_gate)
            {
                if (_disposed) return;
                var bytes = Utf8NoBom.GetBytes(line);
                using (var fs = Open(FilePath))
                {
                    if (fs.Length + bytes.Length <= MaxBytes || fs.Length == 0)
                    {
                        fs.Write(bytes, 0, bytes.Length);
                        return;
                    }
                }
                RollOver();
                using (var fs = Open(FilePath)) fs.Write(bytes, 0, bytes.Length);
            }
        }
        catch (Exception)
        {
            // Never let logging take the app down (disk full, file locked by another program).
            Debug.Write(line);
        }
    }

    /// <summary>pcclipper.log -> pcclipper.1.log (replacing the older one). Caller holds the lock.</summary>
    private void RollOver()
    {
        try
        {
            File.Move(FilePath, Path.Combine(_folder, RolledFileName), overwrite: true);
        }
        catch (Exception)
        {
            // Someone holds the old file open without sharing: start over in place rather than grow forever.
            try { using var fs = new FileStream(FilePath, FileMode.Truncate, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete); } catch { }
        }
    }

    private static FileStream Open(string path) =>
        new(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete, 1, FileOptions.None);

    public void Dispose()
    {
        PlatformLog.Detach(this);
        lock (_gate) _disposed = true;
    }
}
