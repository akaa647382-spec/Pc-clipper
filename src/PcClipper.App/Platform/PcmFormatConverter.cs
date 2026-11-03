using System.Buffers.Binary;
using NAudio.Dsp;
using NAudio.Wave;
using PcClipper.Core;

namespace PcClipper.App.Platform;

/// <summary>
/// Fallback converter for <see cref="WasapiAudioSource"/> when Windows refuses to deliver 48 kHz float stereo itself
/// (AUTOCONVERTPCM not honoured): device mix format (float32 or 16/24/32-bit PCM, any channel count, any rate)
/// -> 48 kHz interleaved float stereo. Mono is copied to both sides; more than two channels keep the first two
/// (front-left/front-right in WAVEFORMATEXTENSIBLE order). The rate is converted with NAudio's WdlResampler in
/// windowed-sinc mode, input-driven (feed mode), so every captured packet produces its share of output right away.
/// Not thread-safe: one instance per capture, used only from that capture's thread.
/// </summary>
internal sealed class PcmFormatConverter
{
    private enum SampleType { Float32, Int16, Int24, Int32 }

    private const int OutRate = AudioMixerPump.SampleRate;

    private readonly SampleType _type;
    private readonly int _channels;
    private readonly int _rate;
    private readonly int _bytesPerSample;
    private readonly int _blockAlign;
    private readonly WdlResampler? _resampler;
    private float[] _stereo = new float[4800 * 2];
    private float[] _out = new float[4800 * 2];

    /// <exception cref="NotSupportedException">A sample format we can't read (e.g. compressed or 8-bit).</exception>
    public PcmFormatConverter(WaveFormat format)
    {
        _channels = format.Channels;
        _rate = format.SampleRate;
        _bytesPerSample = format.BitsPerSample / 8;
        _blockAlign = format.BlockAlign > 0 ? format.BlockAlign : _channels * _bytesPerSample;
        _type = (format.Encoding, format.BitsPerSample) switch
        {
            (WaveFormatEncoding.IeeeFloat, 32) => SampleType.Float32,
            (WaveFormatEncoding.Pcm, 16) => SampleType.Int16,
            (WaveFormatEncoding.Pcm, 24) => SampleType.Int24,
            (WaveFormatEncoding.Pcm, 32) => SampleType.Int32,
            _ => throw new NotSupportedException($"Unsupported audio format: {format.Encoding} {format.BitsPerSample}-bit."),
        };
        if (_channels < 1 || _rate < 8000 || _blockAlign < _channels * _bytesPerSample)
            throw new NotSupportedException($"Unsupported audio format: {_channels} channels at {_rate} Hz.");

        if (_rate != OutRate)
        {
            _resampler = new WdlResampler();
            _resampler.SetMode(false, 0, true, 64, 32); // windowed sinc, no IIR pre-filter (the sinc low-pass handles aliasing)
            _resampler.SetFeedMode(true);               // input driven: we hand over what we captured
            _resampler.SetRates(_rate, OutRate);
        }
    }

    public string Describe() => $"{_rate} Hz, {_channels} ch, {_type}";

    /// <summary>Converts one captured packet. The returned span is valid until the next call.</summary>
    public ReadOnlySpan<float> Convert(byte[] buffer, int bytes)
    {
        int frames = bytes / _blockAlign;
        if (frames <= 0) return ReadOnlySpan<float>.Empty;
        if (_stereo.Length < frames * 2) _stereo = new float[frames * 2];

        var src = buffer.AsSpan(0, frames * _blockAlign);
        int rightOffset = _channels > 1 ? _bytesPerSample : 0; // mono: the left sample again
        for (int f = 0; f < frames; f++)
        {
            var frame = src.Slice(f * _blockAlign, _blockAlign);
            _stereo[2 * f] = Read(frame);
            _stereo[2 * f + 1] = Read(frame[rightOffset..]);
        }
        if (_resampler is null) return _stereo.AsSpan(0, frames * 2);

        int accepted = _resampler.ResamplePrepare(frames, 2, out float[] inBuffer, out int inOffset);
        accepted = Math.Min(accepted, frames);
        Array.Copy(_stereo, 0, inBuffer, inOffset, accepted * 2);
        int capacity = (int)Math.Ceiling(accepted * (double)OutRate / _rate) + 64;
        if (_out.Length < capacity * 2) _out = new float[capacity * 2];
        int produced = _resampler.ResampleOut(_out, 0, accepted, capacity, 2);
        return _out.AsSpan(0, Math.Max(0, produced) * 2);
    }

    private float Read(ReadOnlySpan<byte> s) => _type switch
    {
        SampleType.Float32 => BinaryPrimitives.ReadSingleLittleEndian(s),
        SampleType.Int16 => BinaryPrimitives.ReadInt16LittleEndian(s) / 32768f,
        SampleType.Int24 => ((s[0] | (s[1] << 8) | ((sbyte)s[2] << 16))) / 8388608f,
        _ => BinaryPrimitives.ReadInt32LittleEndian(s) / 2147483648f,
    };
}
