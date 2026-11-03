using NAudio.Dsp;

namespace PcClipper.Core;

/// <summary>
/// Jitter buffer for ONE capture device (48 kHz float stereo, interleaved). The capture thread pushes whatever
/// WASAPI delivers; the clocked mixer pulls EXACTLY n frames per tick. Sound-card clocks never match the PC clock
/// exactly (±500 ppm is ~1.8 s per hour), so a tiny resampling-ratio change holds the fill level at its target
/// instead. Underrun gives silence and re-primes to the target before playing again. Never blocks.
/// </summary>
public sealed class DriftFifo
{
    public const int Rate = 48000;
    private const int Ch = 2;

    private readonly object _lock = new();
    private readonly float[] _ring; // interleaved stereo
    private readonly int _capFrames;
    private int _readFrame, _countFrames;
    private bool _starved = true;
    private double _errEma; // smoothed fill error (seconds)
    private double _ratio = 1.0;
    private readonly WdlResampler _rs = new();
    private float[] _tmp = new float[4800 * Ch];

    public DriftFifo(int targetMs = 40, int capacityMs = 2000)
    {
        TargetFrames = Rate * targetMs / 1000;
        _capFrames = Rate * capacityMs / 1000;
        _ring = new float[_capFrames * Ch];
        _rs.SetMode(false, 0, true, 64, 32); // windowed sinc; the ratio stays ~1.0 so the cost is trivial
        _rs.SetFeedMode(false); // output driven
        _rs.SetRates(Rate, Rate);
    }

    public int TargetFrames { get; }
    public long UnderrunCount { get; private set; }
    public long OverflowDroppedFrames { get; private set; }
    public double CurrentRatio { get { lock (_lock) return _ratio; } }
    public double FillMs { get { lock (_lock) return _countFrames * 1000.0 / Rate; } }

    /// <summary>Capture thread: append interleaved stereo float samples.</summary>
    public void Write(ReadOnlySpan<float> interleaved)
    {
        int frames = interleaved.Length / Ch;
        if (frames == 0) return;
        lock (_lock)
        {
            if (frames > _capFrames)
            {
                interleaved = interleaved[((frames - _capFrames) * Ch)..];
                frames = _capFrames;
            }
            int overflow = _countFrames + frames - _capFrames;
            if (overflow > 0)
            {
                Skip(overflow);
                OverflowDroppedFrames += overflow;
            }
            int writeFrame = (_readFrame + _countFrames) % _capFrames;
            int first = Math.Min(frames, _capFrames - writeFrame);
            interleaved[..(first * Ch)].CopyTo(_ring.AsSpan(writeFrame * Ch));
            if (first < frames) interleaved[(first * Ch)..].CopyTo(_ring.AsSpan(0));
            _countFrames += frames;
        }
    }

    /// <summary>Call when the device is (re)started: forget old data and re-prime.</summary>
    public void Reset()
    {
        lock (_lock)
        {
            _countFrames = 0;
            _readFrame = 0;
            _starved = true;
            _errEma = 0;
            _ratio = 1.0;
            _rs.Reset();
            _rs.SetRates(Rate, Rate);
        }
    }

    /// <summary>Mixer thread: produce exactly <paramref name="frames"/> frames into dst (interleaved stereo).</summary>
    public void Read(Span<float> dst, int frames)
    {
        dst = dst[..(frames * Ch)];
        lock (_lock)
        {
            if (_starved)
            {
                if (_countFrames < TargetFrames)
                {
                    dst.Clear();
                    return;
                }
                _starved = false;
                _errEma = 0;
                _ratio = 1.0;
                _rs.Reset();
                _rs.SetRates(Rate, Rate);
                // Start exactly at the target (the mixer may begin pulling long after the device started), so the
                // latency is right from the first second instead of after the slow controller has drained the excess.
                if (_countFrames > TargetFrames) Skip(_countFrames - TargetFrames);
            }

            // Large excursion (capture thread stalled, then a burst): jump straight back to the target.
            if (_countFrames > TargetFrames + Rate / 5) Skip(_countFrames - TargetFrames);

            // P-controller on the smoothed fill error: 1 ms of error -> 50 ppm faster/slower consumption, clamped to
            // ±2000 ppm (pitch change under 3.5 cents, inaudible). 200 ppm of device drift settles at ~4 ms of error.
            double err = (_countFrames - TargetFrames) / (double)Rate;
            _errEma += (err - _errEma) * 0.02;
            double want = 1.0 + Math.Clamp(_errEma * 0.05, -0.002, 0.002);
            if (Math.Abs(want - _ratio) > 5e-6)
            {
                _ratio = want;
                _rs.SetRates(Rate * _ratio, Rate);
            }

            int need = _rs.ResamplePrepare(frames, Ch, out float[] inBuf, out int inOff);
            int got = Math.Min(need, _countFrames);
            CopyOut(inBuf.AsSpan(inOff, got * Ch), got);
            if (got < need)
            {
                // Underrun: pad with silence so the resampler is not flushed, then re-prime next time.
                Array.Clear(inBuf, inOff + got * Ch, (need - got) * Ch);
                _starved = true;
                UnderrunCount++;
            }
            if (_tmp.Length < frames * Ch) _tmp = new float[frames * Ch];
            int outFrames = _rs.ResampleOut(_tmp, 0, need, frames, Ch);
            _tmp.AsSpan(0, outFrames * Ch).CopyTo(dst);
            if (outFrames < frames) dst[(outFrames * Ch)..].Clear();
        }
    }

    private void Skip(int frames)
    {
        frames = Math.Min(frames, _countFrames);
        _readFrame = (_readFrame + frames) % _capFrames;
        _countFrames -= frames;
    }

    private void CopyOut(Span<float> dst, int frames)
    {
        int first = Math.Min(frames, _capFrames - _readFrame);
        _ring.AsSpan(_readFrame * Ch, first * Ch).CopyTo(dst);
        if (first < frames) _ring.AsSpan(0, (frames - first) * Ch).CopyTo(dst[(first * Ch)..]);
        Skip(frames);
    }
}
