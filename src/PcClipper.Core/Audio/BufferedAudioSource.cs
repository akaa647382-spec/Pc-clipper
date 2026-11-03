namespace PcClipper.Core;

/// <summary>
/// Base for live audio inputs: the capture side calls <see cref="Push"/> with 48 kHz float stereo,
/// the mixer calls <see cref="Pull"/>. Drift correction and underrun handling live in the <see cref="DriftFifo"/>.
/// </summary>
public abstract class BufferedAudioSource : IAudioSource
{
    /// <summary>40 ms target fill. The mixer's output-latency estimate assumes this value.</summary>
    protected readonly DriftFifo Fifo = new(targetMs: 40, capacityMs: 2000);

    public abstract string Name { get; }
    public float Volume { get; set; } = 1f;
    public abstract void Start();
    public abstract void Stop();

    /// <summary>Capture thread: append converted samples (48 kHz, stereo, interleaved float).</summary>
    protected void Push(ReadOnlySpan<float> stereo48k) => Fifo.Write(stereo48k);

    /// <summary>Forget buffered audio, e.g. after the device was restarted.</summary>
    protected void ResetBuffer() => Fifo.Reset();

    public void Pull(Span<float> dest) => Fifo.Read(dest, dest.Length / AudioMixerPump.Channels);

    public virtual void Dispose()
    {
        try { Stop(); } catch { /* best effort */ }
        GC.SuppressFinalize(this);
    }
}
