using System.Collections.Concurrent;

namespace PcClipper.Core;

/// <summary>
/// Base for PCM sinks: <see cref="Write"/> only queues (never blocks the mixer); a writer thread drains the queue
/// into the pipe as fast as ffmpeg reads. ffmpeg can pause its audio reader for a long time (its scheduler holds
/// back a stream that runs ahead, e.g. while a static screen produces no video), so the queue holds 60 s.
/// </summary>
public abstract class QueuedPcmSink : IPcmSink
{
    private const long BytesPerSecond = (long)AudioMixerPump.SampleRate * AudioMixerPump.Channels * sizeof(float);

    private readonly BlockingCollection<byte[]> _queue = new();
    private readonly CancellationTokenSource _cts = new();
    private Thread? _writer;
    private Stream? _stream;
    private long _queuedBytes;
    private volatile Exception? _failure;
    private int _disposed;

    public abstract string FfmpegInputPath { get; }

    /// <summary>
    /// How long ffmpeg may stop reading before the sink gives up (default 60 s). Windows Graphics Capture sends no video
    /// while the screen is still, and ffmpeg then holds back audio too, so those runs use a much larger value.
    /// </summary>
    public int MaxQueueSeconds { get; set; } = 60;

    /// <summary>Wait for ffmpeg to open the pipe and return the stream to write to.</summary>
    protected abstract Task<Stream> ConnectAsync(CancellationToken ct);

    public async Task WaitForConnectionAsync(CancellationToken ct)
    {
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _cts.Token);
        _stream = await ConnectAsync(linked.Token).ConfigureAwait(false);
        _writer = new Thread(WriterLoop) { IsBackground = true, Name = "PcClipper PCM writer", Priority = ThreadPriority.AboveNormal };
        _writer.Start();
    }

    public void Write(ReadOnlySpan<byte> data)
    {
        if (_failure is not null) throw new IOException("Audio pipe to ffmpeg failed: " + _failure.Message, _failure);
        if (Volatile.Read(ref _disposed) != 0) throw new IOException("Audio pipe closed.");
        if (Interlocked.Add(ref _queuedBytes, data.Length) > MaxQueueSeconds * BytesPerSecond)
        {
            _failure = new PcmQueueOverflowException(MaxQueueSeconds);
            throw _failure;
        }
        try { _queue.Add(data.ToArray()); }
        catch (InvalidOperationException) { throw new IOException("Audio pipe closed."); }
    }

    private void WriterLoop()
    {
        try
        {
            foreach (var chunk in _queue.GetConsumingEnumerable(_cts.Token))
            {
                _stream!.Write(chunk, 0, chunk.Length);
                Interlocked.Add(ref _queuedBytes, -chunk.Length);
            }
            _stream?.Flush();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _failure = ex; // broken pipe: ffmpeg is gone
        }
    }

    /// <summary>Flush what is queued (briefly), then close so ffmpeg sees end-of-file. Idempotent.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _queue.CompleteAdding();
        if (_writer is not null && !_writer.Join(500))
        {
            _cts.Cancel();
            try { _stream?.Dispose(); } catch { } // unblocks a write stuck on a full pipe
            _writer.Join(1000);
        }
        try { _stream?.Dispose(); } catch { }
        _cts.Cancel();
        OnDisposed();
        GC.SuppressFinalize(this);
    }

    /// <summary>Release the pipe object itself (after the stream is closed).</summary>
    protected virtual void OnDisposed() { }
}

/// <summary>ffmpeg stopped reading audio for longer than the sink's queue allows.</summary>
public sealed class PcmQueueOverflowException : IOException
{
    public PcmQueueOverflowException(int seconds) : base($"ffmpeg stopped reading audio for over {seconds} s.") => Seconds = seconds;
    public int Seconds { get; }
}
