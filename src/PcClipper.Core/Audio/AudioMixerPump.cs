using System.Diagnostics;
using System.Runtime.InteropServices;

namespace PcClipper.Core;

/// <summary>
/// Clock-driven mixer. After a 0.25 s silent lead-in (which keeps audio ahead of video in ffmpeg's scheduler, so the
/// video is never throttled), it emits exactly 48000 stereo frames per QPC second, anchored to the moment that
/// matches video timestamp 0. Because output length follows the clock, audio cannot drift against the video,
/// whatever the sound card clocks or WASAPI's "nothing is playing" gaps do.
/// </summary>
public sealed class AudioMixerPump : IDisposable
{
    public const int SampleRate = 48000;
    public const int Channels = 2;
    /// <summary>Silent lead-in written as soon as ffmpeg connects; ffmpeg trims it with atrim + setts.</summary>
    public const int LeadInFrames = 12000;
    public const double LeadInSeconds = LeadInFrames / (double)SampleRate;

    private const int MaxFramesPerChunk = SampleRate / 10;
    /// <summary>Owing more than this means the PC slept or hung: the session must restart rather than burst silence.</summary>
    private const double MaxBacklogSeconds = 5;

    private readonly IReadOnlyList<IAudioSource> _sources;
    private readonly IPcmSink _sink;
    private readonly ILog _log;
    private readonly ManualResetEventSlim _anchorSet = new(false);
    private Thread? _thread;
    private volatile bool _stop;
    private long _anchorTicks;
    private long _framesWritten;
    private int _faultRaised;

    public AudioMixerPump(IReadOnlyList<IAudioSource> sources, IPcmSink sink, ILog log)
    {
        _sources = sources;
        _sink = sink;
        _log = log;
    }

    /// <summary>Real (post lead-in) stereo frames written so far.</summary>
    public long FramesWritten => Interlocked.Read(ref _framesWritten);

    /// <summary>Raised once if the sink breaks (ffmpeg exited) or the clock jumped.</summary>
    public event Action<Exception>? Faulted;

    /// <summary>Start the thread and write the lead-in right away (call as soon as ffmpeg has connected).</summary>
    public void BeginLeadIn()
    {
        if (_thread is not null) throw new InvalidOperationException("Pump already started.");
        _thread = new Thread(Run) { IsBackground = true, Name = "PcClipper audio pump", Priority = ThreadPriority.Highest };
        _thread.Start();
    }

    /// <summary>
    /// Begin real audio: the first sample after the lead-in is emitted at Stopwatch timestamp
    /// <paramref name="anchorTimestamp"/> (video pts 0 plus the capture latency).
    /// </summary>
    public void StartAt(long anchorTimestamp)
    {
        Interlocked.Exchange(ref _anchorTicks, anchorTimestamp);
        _anchorSet.Set();
    }

    public bool IsAnchored => _anchorSet.IsSet;

    public void Stop()
    {
        _stop = true;
        _anchorSet.Set();
        var t = _thread;
        if (t is not null && t != Thread.CurrentThread) t.Join(2000);
    }

    public void Dispose() => Stop();

    private void Run()
    {
        var mix = new float[MaxFramesPerChunk * Channels];
        var scratch = new float[MaxFramesPerChunk * Channels];
        try
        {
            // Lead-in: silence that ffmpeg trims away again.
            for (int left = LeadInFrames; left > 0 && !_stop;)
            {
                int n = Math.Min(left, MaxFramesPerChunk);
                _sink.Write(MemoryMarshal.AsBytes(mix.AsSpan(0, n * Channels)));
                left -= n;
            }

            _anchorSet.Wait();
            if (_stop) return;
            long anchor = Interlocked.Read(ref _anchorTicks);
            double ticksPerFrame = Stopwatch.Frequency / (double)SampleRate;

            while (!_stop)
            {
                long now = Stopwatch.GetTimestamp();
                long target = now <= anchor ? 0 : (long)((now - anchor) / ticksPerFrame);
                long due = target - _framesWritten;
                if (due > SampleRate * MaxBacklogSeconds)
                    throw new AudioClockJumpException(due / SampleRate);

                while (due > 0 && !_stop)
                {
                    int frames = (int)Math.Min(due, MaxFramesPerChunk);
                    int samples = frames * Channels;
                    var mixSpan = mix.AsSpan(0, samples);
                    mixSpan.Clear();
                    foreach (var source in _sources)
                    {
                        var buf = scratch.AsSpan(0, samples);
                        source.Pull(buf);
                        float vol = source.Volume;
                        for (int i = 0; i < samples; i++) mixSpan[i] += buf[i] * vol;
                    }
                    for (int i = 0; i < samples; i++)
                    {
                        float v = mixSpan[i];
                        mixSpan[i] = v > 1f ? 1f : v < -1f ? -1f : v;
                    }
                    _sink.Write(MemoryMarshal.AsBytes(mixSpan));
                    Interlocked.Add(ref _framesWritten, frames);
                    due -= frames;
                }
                Thread.Sleep(5);
            }
        }
        catch (Exception ex)
        {
            if (!_stop && Interlocked.Exchange(ref _faultRaised, 1) == 0)
            {
                _log.Warn($"Audio pump stopped: {ex.Message}");
                Faulted?.Invoke(ex);
            }
        }
    }
}

/// <summary>The PC slept or hung for seconds: the audio timeline can't be continued without a restart.</summary>
public sealed class AudioClockJumpException : Exception
{
    public AudioClockJumpException(long seconds) : base($"The audio clock jumped by {seconds} s (sleep/hibernate?).") { }
}
