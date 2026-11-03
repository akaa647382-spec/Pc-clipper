using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;

namespace PcClipper.App.Platform;

public enum ToastKind { Success, Info, Recording, Warning }

/// <summary>
/// The small "✓ Saved last 15:00" card shown over the game. One window is reused: a new toast replaces the current one
/// and restarts its 2.5 s timer, then it fades out.
/// </summary>
/// <remarks>
/// It must never take focus from the game. The recipe (see docs/research/windows-shell.md, section 5):
/// <list type="bullet">
/// <item>ShowWithoutActivation (SW_SHOWNOACTIVATE), WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_TRANSPARENT,
/// MA_NOACTIVATE for WM_MOUSEACTIVATE, HTTRANSPARENT for hit tests, and SetWindowPos(HWND_TOPMOST, SWP_NOACTIVATE).</item>
/// <item>Trap 1: never set Form.TopMost - its setter calls SetWindowPos without SWP_NOACTIVATE and focuses the active
/// control when shown. WS_EX_TOPMOST in CreateParams plus our own SetWindowPos does the same job safely.</item>
/// <item>Trap 2: never add WS_EX_LAYERED by hand while Opacity == 1 (WinForms would never call SetLayeredWindowAttributes
/// and the window stays invisible). Opacity below 1 makes WinForms add WS_EX_LAYERED itself; with WS_EX_TRANSPARENT that
/// also makes the card click-through.</item>
/// <item>SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) keeps the card out of our own clips and screenshots.</item>
/// </list>
/// Sizes are computed in physical pixels for the target monitor's DPI (AutoScaleMode.None, WM_DPICHANGED ignored).
/// True exclusive-fullscreen games (no fullscreen optimizations) can't show any overlay; the optional sounds cover that.
/// </remarks>
public static class OverlayToast
{
    private static ToastWindow? s_window;

    /// <summary>Non-activating, click-through, topmost toast at the top-right of <paramref name="monitorBounds"/>
    /// (primary screen if null) for ~2.5 s. Call from the UI thread. Never steals focus.</summary>
    public static void Show(string text, ToastKind kind, Rectangle? monitorBounds)
    {
        try
        {
            var w = s_window;
            if (w is { IsDisposed: false } && w.IsHandleCreated && w.InvokeRequired)
            {
                w.BeginInvoke(() => Show(text, kind, monitorBounds));
                return;
            }
            if (w is null || w.IsDisposed)
            {
                // The window must belong to a thread with a message loop. If we're called elsewhere, hop to the UI thread.
                if (SynchronizationContext.Current is not WindowsFormsSynchronizationContext)
                {
                    var host = Application.OpenForms.Cast<Form>().FirstOrDefault(f => f.IsHandleCreated && !f.IsDisposed);
                    if (host is not null && host.InvokeRequired)
                    {
                        host.BeginInvoke(() => Show(text, kind, monitorBounds));
                        return;
                    }
                }
                s_window = w = new ToastWindow();
            }
            w.ShowToast(text, kind, monitorBounds);
        }
        catch (Exception ex)
        {
            PlatformLog.Warn("On-screen notification failed: " + ex.Message);
        }
    }

    private sealed class ToastWindow : Form
    {
        private const int WS_EX_TOPMOST = 0x00000008, WS_EX_TRANSPARENT = 0x00000020, WS_EX_TOOLWINDOW = 0x00000080,
                          WS_EX_NOACTIVATE = 0x08000000;
        private const int WM_MOUSEACTIVATE = 0x0021, MA_NOACTIVATE = 3, WM_NCHITTEST = 0x0084, HTTRANSPARENT = -1,
                          WM_DPICHANGED = 0x02E0;
        private const uint SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_NOOWNERZORDER = 0x0200;
        private static readonly IntPtr HWND_TOPMOST = new(-1);

        private const double FullOpacity = 0.94;
        private const int VisibleMs = 2500;
        private const int FadeMs = 300;

        private static readonly Color Back = Color.FromArgb(0x18, 0x1B, 0x22);
        private static readonly Color Border = Color.FromArgb(0x30, 0x35, 0x40);
        private static readonly Color TextColor = Color.FromArgb(0xE8, 0xEA, 0xF0);

        private readonly System.Windows.Forms.Timer _timer = new() { Interval = 30 };
        private string _text = "";
        private Color _accent = Color.FromArgb(0x4F, 0x7C, 0xFF);
        private Font? _font;
        private float _scale = 1f;
        private DateTime _shownAtUtc;

        public ToastWindow()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Back;
            ControlBox = false;
            MinimizeBox = false;
            MaximizeBox = false;
            Text = "PC Clipper notification";
            Opacity = FullOpacity; // < 1: WinForms makes the window layered and sets its alpha (trap 2)
            DoubleBuffered = true;
            SetStyle(ControlStyles.Selectable, false);
            _timer.Tick += (_, _) => OnTimer();
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT;
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeUi.ExcludeFromCapture(Handle);
        }

        protected override void WndProc(ref Message m)
        {
            switch (m.Msg)
            {
                case WM_MOUSEACTIVATE:
                    m.Result = (IntPtr)MA_NOACTIVATE;
                    return;
                case WM_NCHITTEST:
                    m.Result = (IntPtr)HTTRANSPARENT;
                    return;
                case WM_DPICHANGED:
                    m.Result = IntPtr.Zero; // we size ourselves for the target monitor; don't let WinForms rescale
                    return;
            }
            base.WndProc(ref m);
        }

        public void ShowToast(string text, ToastKind kind, Rectangle? monitorBounds)
        {
            _text = text.Replace("\r", "").Replace('\n', ' ');
            _accent = kind switch
            {
                ToastKind.Success => Color.FromArgb(0x3D, 0xD6, 0x8C),
                ToastKind.Recording => Color.FromArgb(0xFF, 0x4D, 0x5A),
                ToastKind.Warning => Color.FromArgb(0xF5, 0xB8, 0x3D),
                _ => Color.FromArgb(0x4F, 0x7C, 0xFF),
            };

            var area = TargetArea(monitorBounds, out float scale);
            if (_font is null || Math.Abs(scale - _scale) > 0.01f)
            {
                _font?.Dispose();
                _scale = scale;
                // Pixel units: the size is exact for the target monitor whatever DPI the window currently has.
                _font = new Font("Segoe UI Semibold", 15f * _scale, FontStyle.Regular, GraphicsUnit.Pixel);
            }

            int padX = (int)(18 * _scale), accentW = (int)(5 * _scale), height = (int)(46 * _scale);
            int maxW = Math.Min((int)(560 * _scale), Math.Max(200, area.Width - (int)(48 * _scale)));
            var textSize = TextRenderer.MeasureText(_text, _font, new Size(int.MaxValue, height), TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
            int width = Math.Clamp(textSize.Width + accentW + padX * 2, (int)(200 * _scale), maxW);
            int margin = (int)(24 * _scale);
            var bounds = new Rectangle(area.Right - width - margin, area.Top + margin, width, height);

            Opacity = FullOpacity;
            if (!IsHandleCreated) CreateHandle();
            Bounds = bounds;
            SetRoundedRegion(bounds.Size, (int)(10 * _scale));
            if (!Visible) Show(); // SW_SHOWNOACTIVATE because ShowWithoutActivation is true
            Invalidate();
            // Re-assert topmost (a game may have become topmost meanwhile) without ever activating.
            SetWindowPos(Handle, HWND_TOPMOST, bounds.X, bounds.Y, bounds.Width, bounds.Height,
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER);
            _shownAtUtc = DateTime.UtcNow;
            _timer.Stop();
            _timer.Start();
        }

        private void OnTimer()
        {
            double ms = (DateTime.UtcNow - _shownAtUtc).TotalMilliseconds;
            if (ms < VisibleMs) return;
            double fade = (ms - VisibleMs) / FadeMs;
            if (fade >= 1)
            {
                _timer.Stop();
                Hide();
                Opacity = FullOpacity;
                return;
            }
            Opacity = Math.Max(0.01, FullOpacity * (1 - fade));
        }

        /// <summary>The working area of the target monitor (desktop pixels) and its DPI scale.</summary>
        private static Rectangle TargetArea(Rectangle? monitorBounds, out float scale)
        {
            Rectangle area;
            try
            {
                var screen = monitorBounds is { Width: > 0, Height: > 0 } b ? Screen.FromRectangle(b) : Screen.PrimaryScreen;
                area = screen?.WorkingArea ?? new Rectangle(0, 0, 1920, 1080);
                if (monitorBounds is { Width: > 0, Height: > 0 } mb)
                {
                    // Prefer the working area (avoids a top taskbar) but stay on the requested monitor.
                    var inter = Rectangle.Intersect(area, mb);
                    area = inter.Width > 200 && inter.Height > 100 ? inter : mb;
                }
            }
            catch (Exception)
            {
                area = monitorBounds ?? new Rectangle(0, 0, 1920, 1080);
            }

            scale = 1f;
            try
            {
                var hmon = MonitorFromPoint(new POINT { X = area.Left + area.Width / 2, Y = area.Top + area.Height / 2 }, MONITOR_DEFAULTTONEAREST);
                if (hmon != IntPtr.Zero && GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, out uint dx, out _) == 0 && dx >= 96)
                    scale = dx / 96f;
            }
            catch (Exception)
            {
                // shcore missing (very old Windows): 100 %.
            }
            return area;
        }

        private void SetRoundedRegion(Size size, int radius)
        {
            using var path = RoundedRect(new Rectangle(Point.Empty, size), radius);
            var old = Region;
            Region = new Region(path);
            old?.Dispose();
        }

        private static GraphicsPath RoundedRect(Rectangle r, int radius)
        {
            int d = Math.Max(2, radius * 2);
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var rc = ClientRectangle;
            g.Clear(Back);
            int accentW = (int)(5 * _scale);
            using (var b = new SolidBrush(_accent)) g.FillRectangle(b, 0, 0, accentW, rc.Height);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = RoundedRect(new Rectangle(0, 0, rc.Width - 1, rc.Height - 1), (int)(10 * _scale)))
            using (var pen = new Pen(Border, Math.Max(1f, _scale)))
                g.DrawPath(pen, path);
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            var textRect = new Rectangle(accentW + (int)(18 * _scale), 0, rc.Width - accentW - (int)(30 * _scale), rc.Height);
            TextRenderer.DrawText(g, _text, _font ?? Font, textRect, TextColor, Back,
                TextFormatFlags.SingleLine | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _timer.Dispose();
                _font?.Dispose();
            }
            base.Dispose(disposing);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X, Y; }

        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private const int MDT_EFFECTIVE_DPI = 0;

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(POINT pt, uint dwFlags);

        [DllImport("shcore.dll")]
        private static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);
    }
}
