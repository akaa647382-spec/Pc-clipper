using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace PcClipper.App.UI;

/// <summary>A rounded "card": a TableLayoutPanel that paints a filled, bordered rounded rectangle behind its cells.</summary>
internal class CardPanel : TableLayoutPanel
{
    private Color _fill = Theme.Card;
    private Color _edge = Theme.Border;

    public CardPanel()
    {
        DoubleBuffered = true;
        SetStyle(ControlStyles.ResizeRedraw, true);
        BackColor = _fill;
        ForeColor = Theme.Text;
        Padding = new Padding(Theme.Space2 + 4, Theme.Space2, Theme.Space2 + 4, Theme.Space2);
        Margin = new Padding(0, 0, 0, Theme.Space2);
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Dock = DockStyle.Fill;
        ColumnCount = 1;
        ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
    }

    public Color FillColor
    {
        get => _fill;
        set { _fill = value; BackColor = value; Invalidate(); }
    }

    public Color EdgeColor
    {
        get => _edge;
        set { _edge = value; Invalidate(); }
    }

    /// <summary>Logical pixels.</summary>
    public int CornerRadius { get; set; } = 12;

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.EffectiveBackColor(Parent));
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var path = Theme.RoundedRect(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), LogicalToDeviceUnits(CornerRadius));
        using (var b = new SolidBrush(_fill)) g.FillPath(b, path);
        using (var p = new Pen(_edge)) g.DrawPath(p, path);
    }
}

/// <summary>
/// Small shapes drawn with GDI+ instead of symbol characters (a check mark, warning sign or record dot needs fonts that
/// not every PC has, and emoji fonts draw them in colour or as boxes).
/// </summary>
internal enum Mark
{
    None,
    /// <summary>Filled circle (on / recording).</summary>
    Dot,
    /// <summary>Hollow circle (off / waiting).</summary>
    Ring,
    /// <summary>Filled square (stop).</summary>
    Square,
    /// <summary>Triangle with an exclamation mark (problem).</summary>
    Warning,
    /// <summary>Tick (success).</summary>
    Check,
}

internal static class MarkPainter
{
    /// <summary>Draws <paramref name="mark"/> centred in <paramref name="r"/>. <paramref name="back"/> is used for cut-outs.</summary>
    public static void Draw(Graphics g, Mark mark, RectangleF r, Color color, Color back)
    {
        if (mark == Mark.None || r.Width < 2 || r.Height < 2) return;
        var oldMode = g.SmoothingMode;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float s = Math.Min(r.Width, r.Height);
        float cx = r.X + r.Width / 2f, cy = r.Y + r.Height / 2f;
        try
        {
            switch (mark)
            {
                case Mark.Dot:
                {
                    float d = s * 0.66f;
                    using var b = new SolidBrush(color);
                    g.FillEllipse(b, cx - d / 2, cy - d / 2, d, d);
                    break;
                }
                case Mark.Ring:
                {
                    float w = Math.Max(1.4f, s * 0.13f);
                    float d = s * 0.62f;
                    using var p = new Pen(color, w);
                    g.DrawEllipse(p, cx - d / 2, cy - d / 2, d, d);
                    break;
                }
                case Mark.Square:
                {
                    float d = s * 0.56f;
                    using var b = new SolidBrush(color);
                    using var path = Theme.RoundedRect(new RectangleF(cx - d / 2, cy - d / 2, d, d), Math.Max(1f, d * 0.15f));
                    g.FillPath(b, path);
                    break;
                }
                case Mark.Warning:
                {
                    float w = s * 0.92f, h = s * 0.82f;
                    float top = cy - h / 2, bottom = cy + h / 2;
                    using (var b = new SolidBrush(color))
                    using (var path = new GraphicsPath())
                    {
                        path.AddPolygon(new[] { new PointF(cx, top), new PointF(cx + w / 2, bottom), new PointF(cx - w / 2, bottom) });
                        g.FillPath(b, path);
                    }
                    using var cut = new SolidBrush(back);
                    float bar = Math.Max(1.2f, s * 0.11f);
                    g.FillRectangle(cut, cx - bar / 2, top + h * 0.34f, bar, h * 0.32f);
                    g.FillEllipse(cut, cx - bar * 0.6f, top + h * 0.74f, bar * 1.2f, bar * 1.2f);
                    break;
                }
                case Mark.Check:
                {
                    float w = Math.Max(1.6f, s * 0.15f);
                    using var p = new Pen(color, w) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
                    g.DrawLines(p, new[]
                    {
                        new PointF(cx - s * 0.30f, cy + s * 0.02f), new PointF(cx - s * 0.08f, cy + s * 0.24f), new PointF(cx + s * 0.32f, cy - s * 0.22f),
                    });
                    break;
                }
            }
        }
        finally
        {
            g.SmoothingMode = oldMode;
        }
    }
}

/// <summary>A small control that shows one <see cref="Mark"/> (e.g. the warning sign on the problem banner).</summary>
internal sealed class MarkIcon : Control
{
    private Mark _mark;
    private Color _color = Theme.Amber;

    public MarkIcon(Mark mark, Color color)
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        _mark = mark;
        _color = color;
        Size = new Size(20, 20); // logical; scaled with the form
        Margin = new Padding(0, 2, Theme.Space1 + 2, 0);
        TabStop = false;
    }

    public Mark Mark
    {
        get => _mark;
        set { if (_mark != value) { _mark = value; Invalidate(); } }
    }

    public Color MarkColor
    {
        get => _color;
        set { if (_color != value) { _color = value; Invalidate(); } }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var back = Theme.EffectiveBackColor(Parent);
        e.Graphics.Clear(back);
        MarkPainter.Draw(e.Graphics, _mark, new RectangleF(0, 0, Width, Height), _color, back);
    }
}

/// <summary>The status pill in the top bar: a drawn mark and "REPLAY ON".</summary>
internal sealed class StatusPill : Control
{
    private Color _color = Theme.TextSecondary;
    private Mark _mark = Mark.Ring;

    public StatusPill()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        BackColor = Color.Transparent;
        Font = Theme.MakeFont(9.5f, semibold: true);
        AutoSize = true;
        Margin = new Padding(0, 0, Theme.Space2, 0);
        Anchor = AnchorStyles.Right;
    }

    public void Set(string text, Color color, Mark mark)
    {
        if (Text == text && _color == color && _mark == mark) return;
        bool resize = Text.Length != text.Length || _mark != mark;
        Text = text;
        _color = color;
        _mark = mark;
        if (resize)
        {
            Size = GetPreferredSize(Size.Empty);
            Parent?.PerformLayout();
        }
        Invalidate();
    }

    private int MarkSize => (int)Math.Round(Font.Height * 0.7);

    public override Size GetPreferredSize(Size proposedSize)
    {
        // Measure with a fixed-width digit template so a running clock doesn't make the pill jitter.
        var template = new string(Text.Select(ch => char.IsDigit(ch) ? '0' : ch).ToArray());
        var t = TextRenderer.MeasureText(template.Length == 0 ? " " : template, Font, Size.Empty, TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
        int mark = _mark == Mark.None ? 0 : MarkSize + LogicalToDeviceUnits(6);
        return new Size(t.Width + mark + LogicalToDeviceUnits(22), t.Height + LogicalToDeviceUnits(10));
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        var back = Theme.EffectiveBackColor(Parent);
        g.Clear(back);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var r = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        var fill = Theme.Tint(_color, back, 0.16);
        using (var path = Theme.RoundedRect(r, r.Height / 2))
        {
            using (var b = new SolidBrush(fill)) g.FillPath(b, path);
            using (var p = new Pen(Theme.Tint(_color, back, 0.45))) g.DrawPath(p, path);
        }
        const TextFormatFlags flags = TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPadding;
        var textSize = TextRenderer.MeasureText(g, Text, Font, Size.Empty, flags);
        int markSize = _mark == Mark.None ? 0 : MarkSize;
        int gap = _mark == Mark.None ? 0 : LogicalToDeviceUnits(6);
        int x = (Width - markSize - gap - textSize.Width) / 2;
        if (markSize > 0) MarkPainter.Draw(g, _mark, new RectangleF(x, (Height - markSize) / 2f, markSize, markSize), _color, fill);
        TextRenderer.DrawText(g, Text, Font, new Rectangle(x + markSize + gap, 0, textSize.Width + 2, Height), _color, flags);
    }
}

/// <summary>A one-line message bar at the bottom of the window that mirrors the on-screen toasts.</summary>
internal sealed class NoticeBar : Control
{
    private readonly System.Windows.Forms.Timer _hide = new() { Interval = 7000 };
    private Color _accent = Theme.Accent;

    public NoticeBar()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Dock = DockStyle.Bottom;
        Visible = false;
        Cursor = Cursors.Hand;
        Font = Theme.MakeFont(10f);
        ForeColor = Theme.Text;
        BackColor = Theme.Card;
        _hide.Tick += (_, _) =>
        {
            _hide.Stop();
            Visible = false;
        };
    }

    /// <summary>Shows <paramref name="text"/>; a sticky notice stays until replaced or clicked.</summary>
    public void ShowNotice(string text, Color accent, bool sticky = false)
    {
        Text = text;
        _accent = accent;
        Height = TextRenderer.MeasureText("Ag", Font).Height + LogicalToDeviceUnits(18);
        Visible = true;
        Invalidate();
        _hide.Stop();
        if (!sticky) _hide.Start();
    }

    public void HideNotice()
    {
        _hide.Stop();
        Visible = false;
    }

    protected override void OnClick(EventArgs e)
    {
        HideNotice();
        base.OnClick(e);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.Card);
        using (var p = new Pen(Theme.Border)) g.DrawLine(p, 0, 0, Width, 0);
        int strip = LogicalToDeviceUnits(4);
        using (var b = new SolidBrush(_accent)) g.FillRectangle(b, 0, 1, strip, Height - 1);
        var area = new Rectangle(LogicalToDeviceUnits(Theme.Space3), 0, Width - LogicalToDeviceUnits(Theme.Space3 * 2), Height);
        TextRenderer.DrawText(g, Text, Font, area, Theme.Text,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _hide.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>A thin accent progress bar (determinate or animated "busy").</summary>
internal sealed class ProgressStrip : Control
{
    private readonly System.Windows.Forms.Timer _anim = new() { Interval = 30 };
    private double _value;
    private bool _indeterminate;
    private float _phase;

    public ProgressStrip()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        Height = 6;
        _anim.Tick += (_, _) =>
        {
            _phase = (_phase + 0.015f) % 1.4f;
            Invalidate();
        };
    }

    /// <summary>0..1</summary>
    public double Value
    {
        get => _value;
        set { _value = Math.Clamp(value, 0, 1); Invalidate(); }
    }

    public bool Indeterminate
    {
        get => _indeterminate;
        set
        {
            _indeterminate = value;
            if (value) _anim.Start(); else _anim.Stop();
            Invalidate();
        }
    }

    protected override void OnVisibleChanged(EventArgs e)
    {
        base.OnVisibleChanged(e);
        if (!Visible) _anim.Stop();
        else if (_indeterminate) _anim.Start();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Theme.EffectiveBackColor(Parent));
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var track = new RectangleF(0, 0, Width - 1, Height - 1);
        using (var path = Theme.RoundedRect(track, Height / 2f))
        using (var b = new SolidBrush(Theme.Neutral)) g.FillPath(b, path);

        RectangleF bar;
        if (_indeterminate)
        {
            float w = Width * 0.3f;
            float x = (_phase - 0.3f) * Width;
            bar = RectangleF.Intersect(new RectangleF(x, 0, w, Height - 1), track);
        }
        else bar = new RectangleF(0, 0, (float)((Width - 1) * _value), Height - 1);
        if (bar.Width < 1) return;
        using (var path = Theme.RoundedRect(bar, Height / 2f))
        using (var b = new SolidBrush(Theme.Accent)) g.FillPath(b, path);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _anim.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>An item for combo boxes: a value plus the text shown for it.</summary>
internal sealed record Choice<T>(T Value, string Label)
{
    public override string ToString() => Label;
}

/// <summary>
/// A dark drop-down list. The closed face is painted by us (WM_PAINT) because the stock flat style draws a
/// white border and a light arrow box; the list items are owner-drawn.
/// </summary>
internal sealed class DarkComboBox : ComboBox
{
    private const int WM_PAINT = 0x000F;
    private bool _hover;

    public DarkComboBox()
    {
        DropDownStyle = ComboBoxStyle.DropDownList;
        DrawMode = DrawMode.OwnerDrawFixed;
        FlatStyle = FlatStyle.Flat;
        BackColor = Theme.Input;
        ForeColor = Theme.Text;
        Font = Theme.MakeFont(10f);
        IntegralHeight = false;
        MaxDropDownItems = 12;
        Width = 260;
        Margin = new Padding(0, 4, Theme.Space1, 4);
        Cursor = Cursors.Hand;
    }

    /// <summary>Select the item whose <see cref="Choice{T}.Value"/> equals <paramref name="value"/> (first item if none).</summary>
    public void SelectValue<T>(T value)
    {
        for (int i = 0; i < Items.Count; i++)
        {
            if (Items[i] is Choice<T> c && EqualityComparer<T>.Default.Equals(c.Value, value))
            {
                SelectedIndex = i;
                return;
            }
        }
        if (Items.Count > 0) SelectedIndex = 0;
    }

    public T? SelectedValueOf<T>() => SelectedItem is Choice<T> c ? c.Value : default;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        UpdateItemHeight();
        // Dark scroll bar in the opened list (Windows 10 1809+; older builds ignore it). The closed face is ours.
        Theme.TrySetWindowTheme(Handle, "DarkMode_CFD");
        try
        {
            var info = new COMBOBOXINFO { cbSize = Marshal.SizeOf<COMBOBOXINFO>() };
            if (GetComboBoxInfo(Handle, ref info) && info.hwndList != IntPtr.Zero) Theme.TrySetWindowTheme(info.hwndList, "DarkMode_Explorer");
        }
        catch
        {
            // Light scroll bar in the list; harmless.
        }
    }

    protected override void OnFontChanged(EventArgs e)
    {
        base.OnFontChanged(e);
        UpdateItemHeight();
    }

    private void UpdateItemHeight()
    {
        int h = TextRenderer.MeasureText("Ag", Font).Height + LogicalToDeviceUnits(10);
        if (ItemHeight != h) ItemHeight = h;
    }

    protected override void OnDrawItem(DrawItemEventArgs e)
    {
        if (e.Index < 0 || e.Index >= Items.Count) return;
        bool selected = (e.State & DrawItemState.Selected) != 0;
        var bg = selected ? Theme.NeutralHover : Theme.Input;
        using (var b = new SolidBrush(bg)) e.Graphics.FillRectangle(b, e.Bounds);
        var text = GetItemText(Items[e.Index]) ?? "";
        var color = text.EndsWith("not available", StringComparison.Ordinal) ? Theme.TextSecondary : Theme.Text;
        var r = new Rectangle(e.Bounds.X + LogicalToDeviceUnits(8), e.Bounds.Y, e.Bounds.Width - LogicalToDeviceUnits(10), e.Bounds.Height);
        TextRenderer.DrawText(e.Graphics, text, Font, r, color,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_PAINT && DropDownStyle == ComboBoxStyle.DropDownList)
        {
            var ps = new PAINTSTRUCT();
            IntPtr hdc = BeginPaint(Handle, ref ps);
            try
            {
                using var g = Graphics.FromHdc(hdc);
                PaintFace(g);
            }
            finally
            {
                EndPaint(Handle, ref ps);
            }
            return;
        }
        base.WndProc(ref m);
    }

    private void PaintFace(Graphics g)
    {
        var back = Theme.EffectiveBackColor(Parent);
        g.Clear(back);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        var border = !Enabled ? Theme.Border : (Focused || DroppedDown) ? Theme.Accent : _hover ? Theme.BorderHover : Theme.Border;
        using (var path = Theme.RoundedRect(rect, LogicalToDeviceUnits(6)))
        {
            using (var b = new SolidBrush(Enabled ? Theme.Input : Theme.Mix(Theme.Input, back, 0.5))) g.FillPath(b, path);
            using (var p = new Pen(border)) g.DrawPath(p, path);
        }

        int arrowArea = LogicalToDeviceUnits(28);
        var text = SelectedIndex >= 0 && SelectedItem is { } item ? GetItemText(item) : "";
        var textRect = new Rectangle(LogicalToDeviceUnits(10), 0, Width - arrowArea - LogicalToDeviceUnits(10), Height);
        TextRenderer.DrawText(g, text, Font, textRect, Enabled ? Theme.Text : Theme.TextDisabled,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);

        // Chevron
        float cx = Width - arrowArea / 2f, cy = Height / 2f, s = LogicalToDeviceUnits(4);
        using var pen = new Pen(Enabled ? Theme.TextSecondary : Theme.TextDisabled, Math.Max(1.5f, LogicalToDeviceUnits(2) * 0.8f));
        g.DrawLines(pen, new[] { new PointF(cx - s, cy - s / 2), new PointF(cx, cy + s / 2), new PointF(cx + s, cy - s / 2) });
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }
    protected override void OnGotFocus(EventArgs e) { Invalidate(); base.OnGotFocus(e); }
    protected override void OnLostFocus(EventArgs e) { Invalidate(); base.OnLostFocus(e); }
    protected override void OnDropDown(EventArgs e) { Invalidate(); base.OnDropDown(e); }
    protected override void OnDropDownClosed(EventArgs e) { Invalidate(); base.OnDropDownClosed(e); }
    protected override void OnSelectedIndexChanged(EventArgs e) { Invalidate(); base.OnSelectedIndexChanged(e); }
    protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct COMBOBOXINFO
    {
        public int cbSize;
        public RECT rcItem;
        public RECT rcButton;
        public int stateButton;
        public IntPtr hwndCombo;
        public IntPtr hwndItem;
        public IntPtr hwndList;
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetComboBoxInfo(IntPtr hwndCombo, ref COMBOBOXINFO info);

    [StructLayout(LayoutKind.Sequential)]
    private unsafe struct PAINTSTRUCT
    {
        public IntPtr hdc;
        public int fErase;
        public RECT rcPaint;
        public int fRestore;
        public int fIncUpdate;
        public fixed byte rgbReserved[32];
    }

    [DllImport("user32.dll")] private static extern IntPtr BeginPaint(IntPtr hWnd, ref PAINTSTRUCT lpPaint);
    [DllImport("user32.dll")] private static extern bool EndPaint(IntPtr hWnd, ref PAINTSTRUCT lpPaint);
}
