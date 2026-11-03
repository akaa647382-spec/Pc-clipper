using System.Diagnostics;

namespace PcClipper.Core;

public interface ILog
{
    void Info(string message);
    void Warn(string message);
    void Error(string message, Exception? ex = null);
}

/// <summary>Writes to the console; used by the Linux harness.</summary>
public sealed class ConsoleLog : ILog
{
    private readonly object _gate = new();
    public void Info(string message) { lock (_gate) Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] INFO  {message}"); }
    public void Warn(string message) { lock (_gate) Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] WARN  {message}"); }
    public void Error(string message, Exception? ex = null) { lock (_gate) Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] ERROR {message} {ex}"); }
}

/// <summary>
/// The place the audio pump writes raw PCM (f32le, 48 kHz, stereo) for ffmpeg to read.
/// Windows: a named pipe (\\.\pipe\...). Linux harness: a FIFO made with mkfifo.
/// </summary>
public interface IPcmSink : IDisposable
{
    /// <summary>Path ffmpeg opens as the audio input file.</summary>
    string FfmpegInputPath { get; }

    /// <summary>Completes once ffmpeg has opened the pipe for reading.</summary>
    Task WaitForConnectionAsync(CancellationToken ct);

    /// <summary>
    /// Queue data for ffmpeg. Must not block for long: ffmpeg may pause reading audio for many seconds (e.g. while
    /// the screen is static), so implementations buffer at least 60 s in memory. Throws IOException when ffmpeg has
    /// gone away or the queue overflowed.
    /// </summary>
    void Write(ReadOnlySpan<byte> data);
}

/// <summary>
/// A live audio input already converted to 48 kHz interleaved float stereo (see <see cref="BufferedAudioSource"/>).
/// </summary>
public interface IAudioSource : IDisposable
{
    string Name { get; }

    /// <summary>Linear gain applied by the mixer (0..2).</summary>
    float Volume { get; set; }

    void Start();
    void Stop();

    /// <summary>Fill ALL of <paramref name="dest"/>: real audio when available, silence otherwise, drift-corrected.</summary>
    void Pull(Span<float> dest);
}

/// <summary>Ties a child process's lifetime to ours (Windows job object) and raises its scheduling priority.</summary>
public interface IProcessGuard
{
    void Attach(Process process);
}

public sealed class NullProcessGuard : IProcessGuard
{
    public void Attach(Process process) { }
}

/// <summary>Platform services the engine needs. The Windows app and the Linux harness supply different ones.</summary>
public sealed class EngineEnvironment
{
    public required ILog Log { get; init; }

    /// <summary>Creates a fresh PCM sink for each capture session.</summary>
    public required Func<IPcmSink> CreatePcmSink { get; init; }

    /// <summary>Creates the audio sources enabled for this session (may return an empty list).</summary>
    public required Func<CaptureConfig, IReadOnlyList<IAudioSource>> CreateAudioSources { get; init; }

    public IProcessGuard ProcessGuard { get; init; } = new NullProcessGuard();

    /// <summary>Where to save a recording the engine has to finish on its own (buffer turned off, settings changed).</summary>
    public Func<string>? RecordingPathFactory { get; init; }

    /// <summary>Free bytes on the drive holding <paramref name="path"/>.</summary>
    public Func<string, long> GetFreeBytes { get; init; } = DefaultFreeBytes;

    public static long DefaultFreeBytes(string path)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(path));
            return root is null ? long.MaxValue : new DriveInfo(root).AvailableFreeSpace;
        }
        catch
        {
            return long.MaxValue;
        }
    }
}
