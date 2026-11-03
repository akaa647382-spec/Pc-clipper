using System.Media;
using System.Text;

namespace PcClipper.App.Platform;

public enum SoundKind { Saved, RecordStart, RecordStop, Screenshot, Error }

/// <summary>
/// Short feedback tones, generated in memory as 16-bit mono WAV (no sound files to ship).
/// save = two rising beeps, record start = one high beep, record stop = one low beep, screenshot = a short click,
/// error = low double beep. Each plays on its own background thread through SoundPlayer.PlaySync (PlaySync, because
/// asynchronous SND_MEMORY playback needs the buffer to stay pinned until the end). A new sound cuts off the previous
/// one (PlaySound plays one sound per process). Off by default in the settings: desktop-audio capture records them.
/// </summary>
public static class Sounds
{
    private const int Rate = 44100;
    private static readonly object s_gate = new();
    private static readonly Dictionary<SoundKind, byte[]> s_cache = new();

    /// <summary>Plays a short generated tone asynchronously. Never throws.</summary>
    public static void Play(SoundKind kind)
    {
        try
        {
            byte[] wav;
            lock (s_gate)
            {
                if (!s_cache.TryGetValue(kind, out wav!))
                    s_cache[kind] = wav = Build(kind);
            }
            var t = new Thread(() =>
            {
                try
                {
                    using var ms = new MemoryStream(wav, writable: false);
                    using var player = new SoundPlayer(ms);
                    player.PlaySync();
                }
                catch (Exception ex)
                {
                    PlatformLog.Warn($"Sound '{kind}' could not be played: {ex.Message}");
                }
            })
            { IsBackground = true, Name = "PcClipper sound" };
            t.Start();
        }
        catch (Exception ex)
        {
            PlatformLog.Warn($"Sound '{kind}' could not be played: {ex.Message}");
        }
    }

    private static byte[] Build(SoundKind kind)
    {
        var samples = new List<short>(Rate / 2);
        switch (kind)
        {
            case SoundKind.Saved:
                Tone(samples, 880, 90);
                Silence(samples, 35);
                Tone(samples, 1320, 120);
                break;
            case SoundKind.RecordStart:
                Tone(samples, 1046.5, 150);
                break;
            case SoundKind.RecordStop:
                Tone(samples, 523.25, 170);
                break;
            case SoundKind.Screenshot:
                Click(samples, 22);
                break;
            default: // Error
                Tone(samples, 330, 110);
                Silence(samples, 60);
                Tone(samples, 330, 110);
                break;
        }
        Silence(samples, 20); // a short tail so the driver doesn't clip the end
        return Wav(samples);
    }

    /// <summary>Sine with a soft second harmonic and 6 ms raised-cosine attack/release (no clicks).</summary>
    private static void Tone(List<short> dst, double hz, int ms, double gain = 0.32)
    {
        int n = Rate * ms / 1000;
        int ramp = Math.Min(n / 2, Rate * 6 / 1000);
        for (int i = 0; i < n; i++)
        {
            double t = i / (double)Rate;
            double env = 1;
            if (i < ramp) env = 0.5 - 0.5 * Math.Cos(Math.PI * i / ramp);
            else if (i >= n - ramp) env = 0.5 - 0.5 * Math.Cos(Math.PI * (n - i) / ramp);
            double v = Math.Sin(2 * Math.PI * hz * t) + 0.18 * Math.Sin(4 * Math.PI * hz * t);
            dst.Add((short)Math.Round(v / 1.18 * gain * env * short.MaxValue));
        }
    }

    /// <summary>Camera-like click: a burst of filtered noise that decays within a few milliseconds.</summary>
    private static void Click(List<short> dst, int ms)
    {
        var rng = new Random(7); // fixed seed: the same click every time
        int n = Rate * ms / 1000;
        double prev = 0;
        for (int i = 0; i < n; i++)
        {
            double noise = rng.NextDouble() * 2 - 1;
            prev = 0.55 * prev + 0.45 * noise; // gentle low-pass
            double env = Math.Exp(-i / (Rate * 0.004));
            double tone = Math.Sin(2 * Math.PI * 2200 * i / Rate) * 0.35;
            dst.Add((short)Math.Round((prev + tone) * 0.45 * env * short.MaxValue));
        }
    }

    private static void Silence(List<short> dst, int ms)
    {
        for (int i = Rate * ms / 1000; i > 0; i--) dst.Add(0);
    }

    private static byte[] Wav(List<short> samples)
    {
        int dataBytes = samples.Count * 2;
        using var ms = new MemoryStream(44 + dataBytes);
        using var w = new BinaryWriter(ms, Encoding.ASCII);
        w.Write(Encoding.ASCII.GetBytes("RIFF"));
        w.Write(36 + dataBytes);
        w.Write(Encoding.ASCII.GetBytes("WAVE"));
        w.Write(Encoding.ASCII.GetBytes("fmt "));
        w.Write(16);             // PCM fmt chunk size
        w.Write((short)1);       // PCM
        w.Write((short)1);       // mono
        w.Write(Rate);
        w.Write(Rate * 2);       // byte rate
        w.Write((short)2);       // block align
        w.Write((short)16);      // bits per sample
        w.Write(Encoding.ASCII.GetBytes("data"));
        w.Write(dataBytes);
        foreach (var s in samples) w.Write(s);
        w.Flush();
        return ms.ToArray();
    }
}
