using System.ComponentModel;
using System.IO.Compression;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using PcClipper.Core;

namespace PcClipper.App.Platform;

public sealed record DownloadProgress(long BytesDone, long? BytesTotal, string Status);

/// <summary>
/// Finds ffmpeg.exe, or downloads a pinned, SHA-256-verified build on first run (we never redistribute it ourselves).
/// </summary>
/// <remarks>
/// <para>Search order: settings.FfmpegPath, &lt;exe dir&gt;\ffmpeg.exe, &lt;exe dir&gt;\ffmpeg\bin\ffmpeg.exe,
/// %LOCALAPPDATA%\PCClipper\ffmpeg\bin\ffmpeg.exe, then PATH.</para>
/// <para>Download: primary = gyan.dev 8.1.1 "essentials" (static single exe), fallback = BtbN n8.1.3 static GPL. Each zip is
/// streamed to a temp file while its SHA-256 is computed, compared with the pinned hash, then ONLY the
/// <c>*/bin/ffmpeg.exe</c> entry is extracted (to ffmpeg.exe.tmp, then moved into place; an ffmpeg.exe that is running is
/// renamed out of the way first). Finally the new exe must run and have ddagrab + scale_d3d11. A file fetched by our own
/// HttpClient carries no Mark-of-the-Web, so SmartScreen doesn't prompt; Defender and Smart App Control still apply.</para>
/// <para>Errors are plain sentences (the setup dialog adds "check your internet connection ... or browse").</para>
/// </remarks>
public static class FfmpegLocator
{
    private sealed record Source(string Label, string Url, string Sha256, long ApproxZipBytes);

    private static readonly Source[] Sources =
    {
        new("gyan.dev FFmpeg 8.1.1 essentials",
            "https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip",
            "6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541", 109L * 1024 * 1024),
        new("BtbN FFmpeg n8.1.3 static",
            "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip",
            "401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f", 185L * 1024 * 1024),
    };

    /// <summary>Room for the extracted exe (~100-200 MB) next to the zip, plus slack.</summary>
    private const long ExtraSpaceBytes = 350L * 1024 * 1024;
    private static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(30);

    private static readonly Lazy<HttpClient> s_http = new(() =>
    {
        var handler = new SocketsHttpHandler
        {
            ConnectTimeout = TimeSpan.FromSeconds(20),
            AllowAutoRedirect = true, // GitHub release assets redirect to their CDN
            AutomaticDecompression = DecompressionMethods.None,
        };
        var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan }; // stalls are detected per read instead
        client.DefaultRequestHeaders.UserAgent.ParseAdd("PCClipper/1.0 (+ffmpeg first-run download)");
        return client;
    });

    /// <summary>Where a downloaded ffmpeg.exe lives: %LOCALAPPDATA%\PCClipper\ffmpeg\bin\ffmpeg.exe.</summary>
    public static string DownloadedExePath => Path.Combine(DefaultPaths.FfmpegFolder, "bin", "ffmpeg.exe");

    /// <summary>Find a usable ffmpeg.exe (settings path, next to the exe, %LOCALAPPDATA%\PCClipper\ffmpeg\bin, PATH). Null if none.</summary>
    /// <remarks>"Usable" here means an existing, non-empty file; the caller probes what it can do. Never throws.</remarks>
    public static string? Find(AppSettings settings)
    {
        foreach (var candidate in Candidates(settings))
        {
            try
            {
                var full = Path.GetFullPath(candidate);
                if (Directory.Exists(full)) full = Path.Combine(full, "ffmpeg.exe");
                var fi = new FileInfo(full);
                if (fi.Exists && fi.Length > 0) return fi.FullName;
            }
            catch (Exception)
            {
                // Malformed path (from settings or PATH): skip it.
            }
        }
        return null;
    }

    private static IEnumerable<string> Candidates(AppSettings settings)
    {
        if (!string.IsNullOrWhiteSpace(settings?.FfmpegPath))
            yield return Environment.ExpandEnvironmentVariables(settings.FfmpegPath.Trim().Trim('"'));

        string? exeDir = null;
        try { exeDir = Path.GetDirectoryName(Environment.ProcessPath); } catch { }
        if (string.IsNullOrEmpty(exeDir)) exeDir = AppContext.BaseDirectory;
        if (!string.IsNullOrEmpty(exeDir))
        {
            yield return Path.Combine(exeDir, "ffmpeg.exe");
            yield return Path.Combine(exeDir, "ffmpeg", "bin", "ffmpeg.exe");
        }

        yield return DownloadedExePath;

        string path = "";
        try { path = Environment.GetEnvironmentVariable("PATH") ?? ""; } catch { }
        foreach (var raw in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var dir = Environment.ExpandEnvironmentVariables(raw.Trim('"'));
            if (dir.Length > 0) yield return Path.Combine(dir, "ffmpeg.exe");
        }
    }

    /// <summary>Download + extract ffmpeg.exe into %LOCALAPPDATA%\PCClipper\ffmpeg\bin (tries each URL). Returns its path.</summary>
    /// <exception cref="OperationCanceledException">The user cancelled.</exception>
    /// <exception cref="InvalidOperationException">Every source failed; the message says why in plain words.</exception>
    public static async Task<string> DownloadAsync(IProgress<DownloadProgress> progress, ILog log, CancellationToken ct)
    {
        var failures = new List<DownloadFailure>();
        for (int i = 0; i < Sources.Length; i++)
        {
            ct.ThrowIfCancellationRequested();
            var src = Sources[i];
            if (i > 0) Report(progress, new DownloadProgress(0, null, "Trying another download server"));
            try
            {
                return await DownloadOneAsync(src, progress, log, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                log.Info("FFmpeg download cancelled.");
                throw;
            }
            catch (Exception ex)
            {
                var failure = Classify(ex);
                failures.Add(failure);
                log.Error($"FFmpeg download from {src.Label} failed: {failure.Message}", ex);
                if (failure.StopTrying) break; // e.g. disk full: the next (bigger) download can't work either
            }
        }
        // Report the problem the user can act on: local problems (disk, permissions) first, then the primary's error.
        var best = failures.FirstOrDefault(f => f.StopTrying) ?? failures.FirstOrDefault();
        throw new InvalidOperationException(best?.Message ?? "FFmpeg couldn't be downloaded.");
    }

    // ------------------------------------------------------------------------------------------------ one source

    private static async Task<string> DownloadOneAsync(Source src, IProgress<DownloadProgress> progress, ILog log, CancellationToken ct)
    {
        string root = DefaultPaths.FfmpegFolder;
        string workDir = Path.Combine(root, "download");
        string zipPath = Path.Combine(workDir, "ffmpeg-download.zip.part");
        Directory.CreateDirectory(workDir);
        CleanupOldExes();
        try
        {
            log.Info($"Downloading FFmpeg from {src.Url}");
            Report(progress, new DownloadProgress(0, null, "Connecting"));
            using var response = await s_http.Value.GetAsync(src.Url, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                throw new DownloadFailure($"The download server answered with an error ({(int)response.StatusCode} {response.ReasonPhrase}).");
            long? total = response.Content.Headers.ContentLength;
            EnsureFreeSpace(root, (total ?? src.ApproxZipBytes) + ExtraSpaceBytes);

            string hash;
            await using (var net = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false))
            await using (var file = new FileStream(zipPath, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
            using (var sha = IncrementalHash.CreateHash(HashAlgorithmName.SHA256))
            using (var stall = CancellationTokenSource.CreateLinkedTokenSource(ct))
            {
                var buffer = new byte[1 << 16];
                long done = 0;
                long lastReport = 0;
                while (true)
                {
                    stall.CancelAfter(StallTimeout); // restarts the timer for every read
                    int n;
                    try
                    {
                        n = await net.ReadAsync(buffer, stall.Token).ConfigureAwait(false);
                    }
                    catch (OperationCanceledException) when (!ct.IsCancellationRequested)
                    {
                        throw new DownloadFailure("The download stopped responding.");
                    }
                    if (n == 0) break;
                    sha.AppendData(buffer, 0, n);
                    await file.WriteAsync(buffer.AsMemory(0, n), ct).ConfigureAwait(false);
                    done += n;
                    if (Environment.TickCount64 - lastReport >= 150)
                    {
                        lastReport = Environment.TickCount64;
                        Report(progress, new DownloadProgress(done, total, "Downloading FFmpeg"));
                    }
                }
                Report(progress, new DownloadProgress(done, total, "Downloading FFmpeg"));
                if (total is long t && done != t)
                    throw new DownloadFailure("The download was cut off before it finished.");
                hash = Convert.ToHexString(sha.GetHashAndReset()).ToLowerInvariant();
                log.Info($"Downloaded {done:N0} bytes, SHA-256 {hash}");
            }

            Report(progress, new DownloadProgress(0, null, "Checking the download"));
            if (!string.Equals(hash, src.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new DownloadFailure("The download was damaged (its fingerprint didn't match), so it wasn't used.");

            Report(progress, new DownloadProgress(0, null, "Unpacking FFmpeg"));
            string exe = await ExtractAsync(zipPath, ct).ConfigureAwait(false);

            Report(progress, new DownloadProgress(0, null, "Testing FFmpeg"));
            try
            {
                await VerifyAsync(exe, log, ct).ConfigureAwait(false);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                TryDelete(exe); // never leave a broken ffmpeg.exe for Find() to pick up
                throw;
            }
            log.Info($"FFmpeg ready: {exe}");
            return exe;
        }
        finally
        {
            TryDelete(zipPath);
            try { Directory.Delete(workDir, recursive: true); } catch { }
        }
    }

    private static async Task<string> ExtractAsync(string zipPath, CancellationToken ct)
    {
        string binDir = Path.GetDirectoryName(DownloadedExePath)!;
        Directory.CreateDirectory(binDir);
        string tmp = Path.Combine(binDir, "ffmpeg.exe.tmp");

        using (var zip = ZipFile.OpenRead(zipPath))
        {
            // Exactly "<top folder>/bin/ffmpeg.exe"; nothing else from the archive is written.
            var entry = zip.Entries.FirstOrDefault(e =>
            {
                var n = e.FullName.Replace('\\', '/');
                return n.EndsWith("/bin/ffmpeg.exe", StringComparison.OrdinalIgnoreCase) && n.Count(c => c == '/') == 2;
            }) ?? zip.Entries.FirstOrDefault(e => e.FullName.Replace('\\', '/').EndsWith("bin/ffmpeg.exe", StringComparison.OrdinalIgnoreCase));
            if (entry is null || entry.Length < 1024 * 1024)
                throw new DownloadFailure("The downloaded package didn't contain ffmpeg.exe.");

            await using (var input = entry.Open())
            await using (var output = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, useAsync: true))
                await input.CopyToAsync(output, 1 << 16, ct).ConfigureAwait(false);
            if (new FileInfo(tmp).Length != entry.Length)
                throw new DownloadFailure("Unpacking FFmpeg went wrong (the file came out the wrong size).");
        }

        string final = DownloadedExePath;
        try
        {
            File.Move(tmp, final, overwrite: true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            // ffmpeg.exe is running (replay on): a running exe can't be replaced, but it can be renamed.
            string old = Path.Combine(binDir, $"ffmpeg.old-{DateTime.UtcNow.Ticks}.exe");
            try
            {
                File.Move(final, old);
                File.Move(tmp, final, overwrite: true);
            }
            catch (Exception)
            {
                TryDelete(tmp);
                throw new DownloadFailure("FFmpeg is in use right now. Turn the replay off and try again.");
            }
        }
        return final;
    }

    private static async Task VerifyAsync(string exe, ILog log, CancellationToken ct)
    {
        var version = await FfmpegRunner.RunAsync(exe, new[] { "-hide_banner", "-nostdin", "-version" }, TimeSpan.FromSeconds(30), log, null, ct)
            .ConfigureAwait(false);
        if (!version.Ok)
        {
            string detail = version.Tail(2);
            if (detail.Contains("4551", StringComparison.Ordinal) || detail.Contains("policy", StringComparison.OrdinalIgnoreCase))
                throw new DownloadFailure("Windows (Smart App Control or another protection) blocked the downloaded FFmpeg.", stopTrying: true);
            if (detail.Contains("225", StringComparison.Ordinal) || detail.Contains("virus", StringComparison.OrdinalIgnoreCase))
                throw new DownloadFailure("Your antivirus blocked the downloaded FFmpeg.", stopTrying: true);
            throw new DownloadFailure($"The downloaded FFmpeg doesn't start on this PC ({FirstLine(detail)}).");
        }
        log.Info("Downloaded FFmpeg: " + FirstLine(version.StdOut));

        var filters = await FfmpegRunner.RunAsync(exe, new[] { "-hide_banner", "-nostdin", "-filters" }, TimeSpan.FromSeconds(30), null, null, ct)
            .ConfigureAwait(false);
        bool Has(string name) => filters.StdOut.Split('\n').Any(l =>
            l.Split(' ', StringSplitOptions.RemoveEmptyEntries) is { Length: >= 2 } p && p[1] == name);
        if (!filters.Ok || !Has("ddagrab") || !Has("scale_d3d11"))
            throw new DownloadFailure("The downloaded FFmpeg is missing the screen-capture parts PC Clipper needs.");
    }

    // ------------------------------------------------------------------------------------------------ helpers

    private static void EnsureFreeSpace(string folder, long needed)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(folder));
            if (root is null) return;
            var drive = new DriveInfo(root);
            if (drive.IsReady && drive.AvailableFreeSpace < needed)
                throw new DownloadFailure(
                    $"There isn't enough free space on {root.TrimEnd('\\')} ({QualityMath.FormatBytes(drive.AvailableFreeSpace)} free, " +
                    $"FFmpeg needs about {QualityMath.FormatBytes(needed)}). Free up some space first.", stopTrying: true);
        }
        catch (DownloadFailure) { throw; }
        catch (Exception) { /* can't tell: just try */ }
    }

    private static DownloadFailure Classify(Exception ex)
    {
        if (ex is DownloadFailure f) return f;
        if (ex is AggregateException { InnerExceptions.Count: 1 } agg) return Classify(agg.InnerExceptions[0]);
        if (IsDiskFull(ex))
            return new DownloadFailure($"There isn't enough free space on {DriveOf(DefaultPaths.FfmpegFolder)} to save FFmpeg. Free up some space first.", stopTrying: true);
        if (ex is UnauthorizedAccessException)
            return new DownloadFailure($"Windows didn't let PC Clipper save files in {DefaultPaths.FfmpegFolder} (an antivirus may be blocking it).", stopTrying: true);
        if (ex is HttpRequestException hre)
        {
            if (hre.StatusCode is HttpStatusCode code)
                return new DownloadFailure($"The download server answered with an error ({(int)code}).");
            if (FindInner<SocketException>(ex) is not null || FindInner<IOException>(ex) is not null)
                return new DownloadFailure("PC Clipper couldn't connect to the download server (github.com).");
            return new DownloadFailure("PC Clipper couldn't connect to the download server.");
        }
        if (ex is OperationCanceledException or TimeoutException)
            return new DownloadFailure("The download stopped responding.");
        if (ex is InvalidDataException)
            return new DownloadFailure("The downloaded package couldn't be opened (it may be damaged).");
        if (ex is Win32Exception w)
            return new DownloadFailure($"The downloaded FFmpeg couldn't be started ({w.Message}).");
        if (ex is IOException io)
            return new DownloadFailure($"Saving FFmpeg failed ({io.Message}).");
        return new DownloadFailure($"Something went wrong ({ex.Message}).");
    }

    private static bool IsDiskFull(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException)
        {
            int code = e.HResult & 0xFFFF;
            if (e is IOException && (code == 112 /* ERROR_DISK_FULL */ || code == 39 /* ERROR_HANDLE_DISK_FULL */)) return true;
        }
        return false;
    }

    private static T? FindInner<T>(Exception ex) where T : Exception
    {
        for (var e = ex.InnerException; e is not null; e = e.InnerException)
            if (e is T t) return t;
        return null;
    }

    private static string DriveOf(string folder)
    {
        try { return (Path.GetPathRoot(Path.GetFullPath(folder)) ?? folder).TrimEnd('\\'); }
        catch { return folder; }
    }

    private static string FirstLine(string text)
    {
        var line = text.Replace("\r", "").Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        return line.Length > 160 ? line[..160] + "..." : line;
    }

    /// <summary>Remove ffmpeg.old-*.exe left behind by an update while ffmpeg was running (best effort).</summary>
    private static void CleanupOldExes()
    {
        try
        {
            var bin = Path.GetDirectoryName(DownloadedExePath)!;
            if (!Directory.Exists(bin)) return;
            foreach (var f in Directory.EnumerateFiles(bin, "ffmpeg.old-*.exe")) TryDelete(f);
        }
        catch { }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static void Report(IProgress<DownloadProgress> progress, DownloadProgress p)
    {
        try { progress?.Report(p); } catch { /* a broken progress handler must not stop the download */ }
    }

    /// <summary>A download problem already phrased for the user.</summary>
    private sealed class DownloadFailure : Exception
    {
        public DownloadFailure(string message, bool stopTrying = false) : base(message) => StopTrying = stopTrying;

        /// <summary>A local problem (disk full, blocked by Windows) that the next source can't fix either.</summary>
        public bool StopTrying { get; }
    }
}
