using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace PcClipper.App.Platform;

/// <summary>
/// "Test my PC" helper: a borderless window on the tested monitor that animates every display refresh (DwmFlush loop on
/// its own UI thread), so the capture test has a new frame every vsync. Shows "Testing your PC..." text. NOT excluded from
/// capture (the capture must see it). Dispose closes it. Never throws.
/// </summary>
/// <remarks>
/// The card covers the centre third of the monitor (not the whole screen: the user still sees their desktop and the
/// PC Clipper window). Desktop Duplication only reports a new frame when something on screen changed, so the card
/// redraws once per DWM composition: DwmFlush() blocks until the next present, which paces the loop at the monitor's
/// refresh rate (120 Hz monitor = 120 different frames per second). Without DWM it falls back to Thread.Sleep(1).
/// The loop runs on a dedicated STA thread with its own message pump, so a busy main UI thread can't stall it.
/// </remarks>
public static class TestCard
{
    public static IDisposable Show(Rectangle monitorBounds)
    {
        try
        {
            var card = new CardThread(monitorBounds);
            card.Start();
            return card;
        }
        catch (Exception ex)
        {
            PlatformLog.Error("The test card could not be shown", ex);
            return new Nothing();
        }
    }

    private sealed class Nothing : IDisposable
    {
        public void Dispose() { }
    }

    private sealed class CardThread : IDisposable
    {
        private readonly Rectangle _bounds;
        private readonly ManualResetEventSlim _shown = new(false);
        private volatile bool _stop;
        private Thread? _thread;

        public CardThread(Rectangle monitorBounds)
        {
            var m = monitorBounds.Width > 0 && monitorBounds.Height > 0
                ? monitorBounds
                : Screen.PrimaryScreen?.Bounds ?? new Rectangle(0, 0, 1920, 1080);
            _bounds = new Rectangle(m.Left + m.Width / 3, m.Top + m.Height / 3, Math.Max(64, m.Width / 3), Math.Max(64, m.Height / 3));
        }

        public void Start()
        {
            _thread = new Thread(Run) { IsBackground = true, Name = "PcClipper test card" };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            // Give it a moment to appear so the benchmark's first frames already see the animation.
            _shown.Wait(3000);
        }

        private void Run()
        {
            CardForm? form = null;
            try
            {
                form = new CardForm(_bounds);
                form.Show();
                _shown.Set();
                var clock = Stopwatch.StartNew();
                long frame = 0;
                bool dwmOk = true;
                while (!_stop && !form.IsDisposed)
                {
                    Application.DoEvents();
                    if (_stop || form.IsDisposed) break;
                    form.RenderFrame(clock.Elapsed.TotalSeconds, frame++);
                    if (dwmOk)
                    {
                        long before = Stopwatch.GetTimestamp();
                        try { dwmOk = DwmFlush() >= 0; }
                        catch (Exception) { dwmOk = false; }
                        // DwmFlush returning at once (nothing composed) must not turn this into a busy loop.
                        if (Stopwatch.GetElapsedTime(before) < TimeSpan.FromMilliseconds(0.5)) Thread.Sleep(1);
                    }
                    else
                    {
                        Thread.Sleep(1);
                    }
                }
            }
            catch (Exception ex)
            {
                PlatformLog.Error("Test card failed", ex);
            }
            finally
            {
                try { _shown.Set(); } catch { }
                try { form?.Close(); } catch { }
                try { form?.Dispose(); } catch { }
            }
        }

        public void Dispose()
        {
            _stop = true;
            try
            {
                if (_thread is not null && _thread != Thread.CurrentThread) _thread.Join(3000);
            }
            catch (Exception) { }
            // _shown is not disposed: the card thread may still touch it if it took longer than the join timeout.
        }
    }

    private sealed class CardForm : Form
    {
        private static readonly Color Back = Color.FromArgb(0x0F, 0x11, 0x15);
        private static readonly Color[] BarColors =
        {
            Color.FromArgb(0x4F, 0x7C, 0xFF), Color.FromArgb(0x3D, 0xD6, 0x8C), Color.FromArgb(0xF5, 0xB8, 0x3D),
            Color.FromArgb(0xFF, 0x4D, 0x5A), Color.FromArgb(0xB0, 0x7C, 0xFF), Color.FromArgb(0x3D, 0xC8, 0xE8),
        };

        private readonly Font _title;
        private readonly Font _small;
        private BufferedGraphics? _buffer;

        public CardForm(Rectangle bounds)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            ShowInTaskbar = false;
            TopMost = true; // user-initiated test: it may come to the front
            BackColor = Back;
            Bounds = bounds;
            Text = "PC Clipper test";
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.Opaque, true);
            float px = Math.Clamp(bounds.Height / 14f, 14f, 64f);
            _title = new Font("Segoe UI Semibold", px, FontStyle.Regular, GraphicsUnit.Pixel);
            _small = new Font("Segoe UI", Math.Max(11f, px * 0.45f), FontStyle.Regular, GraphicsUnit.Pixel);
        }

        protected override bool ShowWithoutActivation => true;

        protected override void OnPaint(PaintEventArgs e) => RenderFrame(0, 0);

        public void RenderFrame(double t, long frame)
        {
            if (IsDisposed || !IsHandleCreated) return;
            var rc = ClientRectangle;
            if (rc.Width <= 0 || rc.Height <= 0) return;
            if (_buffer is null)
            {
                using var screen = CreateGraphics();
                _buffer = BufferedGraphicsManager.Current.Allocate(screen, rc);
            }
            var g = _buffer.Graphics;
            g.SmoothingMode = SmoothingMode.HighSpeed;
            g.Clear(Back);

            // Vertical bars sweeping sideways: large areas change every frame.
            int bars = BarColors.Length;
            float barW = rc.Width / (float)(bars * 2);
            float span = rc.Width + barW;
            for (int i = 0; i < bars; i++)
            {
                float x = (float)((t * rc.Width * 0.35 + i * span / bars) % span) - barW;
                using var b = new SolidBrush(BarColors[i]);
                g.FillRectangle(b, x, 0, barW, rc.Height);
            }

            // A rotating square in the middle.
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float cx = rc.Width / 2f, cy = rc.Height / 2f, size = Math.Min(rc.Width, rc.Height) * 0.28f;
            var state = g.Save();
            g.TranslateTransform(cx, cy);
            g.RotateTransform((float)(t * 180 % 360));
            using (var b = new SolidBrush(Color.FromArgb(230, 0xE8, 0xEA, 0xF0)))
                g.FillRectangle(b, -size / 2, -size / 2, size, size);
            g.Restore(state);

            // Text on a dark band so it stays readable over the bars.
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            int bandH = (int)(_title.Height * 1.6f);
            using (var band = new SolidBrush(Color.FromArgb(220, Back)))
                g.FillRectangle(band, 0, 0, rc.Width, bandH);
            using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center, Trimming = StringTrimming.EllipsisCharacter };
            using (var tb = new SolidBrush(Color.FromArgb(0xE8, 0xEA, 0xF0)))
                g.DrawString("Testing your PC... please don't touch anything", _title, tb, new RectangleF(0, 0, rc.Width, bandH), sf);
            using (var sb = new SolidBrush(Color.FromArgb(0x9A, 0xA3, 0xB2)))
                g.DrawString($"frame {frame}", _small, sb, new RectangleF(0, rc.Height - _small.Height * 1.6f, rc.Width, _small.Height * 1.6f), sf);

            using var target = CreateGraphics();
            _buffer.Render(target);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _buffer?.Dispose();
                _title.Dispose();
                _small.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmFlush();
}
