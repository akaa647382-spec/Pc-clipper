using System.Drawing.Drawing2D;

namespace PcClipper.App.UI;

/// <summary>
/// A flat, rounded, fully custom-painted button with hover/pressed colours and a hand cursor.
/// <see cref="Dimmed"/> makes it look disabled while still receiving the mouse, so tooltips can explain why
/// it is unavailable (WinForms never shows tooltips on truly disabled controls); a dimmed click raises
/// <see cref="DimmedClick"/> instead of <see cref="Control.Click"/>.
/// </summary>
internal sealed class FlatButton : Button
{
    private bool _hover;
    private bool _pressed;
    private bool _dimmed;
    private Mark _glyph;
    private Color? _glyphColor;

    public FlatButton()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        FlatStyle = FlatStyle.Flat;
        FlatAppearance.BorderSize = 0;
        UseVisualStyleBackColor = false;
        UseMnemonic = false;
        Cursor = Cursors.Hand;
        Padding = new Padding(14, 6, 14, 6);
        TextAlign = ContentAlignment.MiddleCenter;
        BackColor = Color.Transparent;
    }

    public Color Fill { get; set; } = Theme.Neutral;
    public Color FillHover { get; set; } = Theme.NeutralHover;
    public Color FillPressed { get; set; } = Theme.NeutralPressed;
    public Color TextColor { get; set; } = Theme.Text;
    public Color? EdgeColor { get; set; }
    /// <summary>Corner radius in logical pixels.</summary>
    public int CornerRadius { get; set; } = 8;
    /// <summary>Left/centre alignment of the text.</summary>
    public bool AlignLeft { get; set; }

    /// <summary>A shape drawn before the text (record dot, stop square), instead of a symbol character.</summary>
    public Mark Glyph
    {
        get => _glyph;
        set
        {
            if (_glyph == value) return;
            _glyph = value;
            if (AutoSize) Parent?.PerformLayout();
            Invalidate();
        }
    }

    /// <summary>Colour of <see cref="Glyph"/>; null = the text colour.</summary>
    public Color? GlyphColor
    {
        get => _glyphColor;
        set
        {
            if (_glyphColor == value) return;
            _glyphColor = value;
            Invalidate();
        }
    }

    private int GlyphSize => (int)Math.Round(Font.Height * 0.72);
    private int GlyphGap => LogicalToDeviceUnits(8);

    public bool Dimmed
    {
        get => _dimmed;
        set
        {
            if (_dimmed == value) return;
            _dimmed = value;
            Cursor = value ? Cursors.Default : Cursors.Hand;
            Invalidate();
        }
    }

    public event EventHandler? DimmedClick;

    public void ApplyKind(ButtonKind kind)
    {
        EdgeColor = null;
        switch (kind)
        {
            case ButtonKind.Primary:
                Fill = Theme.Accent; FillHover = Theme.AccentHover; FillPressed = Theme.AccentPressed; TextColor = Color.White;
                break;
            case ButtonKind.Danger:
                Fill = Theme.Red; FillHover = Theme.RedHover; FillPressed = Theme.RedPressed; TextColor = Color.White;
                break;
            case ButtonKind.Ghost:
                Fill = Color.Transparent; FillHover = Theme.Neutral; FillPressed = Theme.NeutralPressed; TextColor = Theme.TextSecondary;
                break;
            default:
                Fill = Theme.Neutral; FillHover = Theme.NeutralHover; FillPressed = Theme.NeutralPressed; TextColor = Theme.Text;
                EdgeColor = Theme.Border;
                break;
        }
        Invalidate();
    }

    protected override void OnClick(EventArgs e)
    {
        if (_dimmed)
        {
            DimmedClick?.Invoke(this, e);
            return;
        }
        base.OnClick(e);
    }

    protected override void OnMouseEnter(EventArgs e)
    {
        _hover = true;
        Invalidate();
        base.OnMouseEnter(e);
    }

    protected override void OnMouseLeave(EventArgs e)
    {
        _hover = false;
        _pressed = false;
        Invalidate();
        base.OnMouseLeave(e);
    }

    protected override void OnMouseDown(MouseEventArgs mevent)
    {
        if (mevent.Button == MouseButtons.Left)
        {
            _pressed = true;
            Invalidate();
        }
        base.OnMouseDown(mevent);
    }

    protected override void OnMouseUp(MouseEventArgs mevent)
    {
        _pressed = false;
        Invalidate();
        base.OnMouseUp(mevent);
    }

    protected override void OnEnabledChanged(EventArgs e)
    {
        Invalidate();
        base.OnEnabledChanged(e);
    }

    protected override void OnTextChanged(EventArgs e)
    {
        base.OnTextChanged(e);
        Invalidate();
    }

    public override Size GetPreferredSize(Size proposedSize)
    {
        var t = TextRenderer.MeasureText(Text.Length == 0 ? " " : Text, Font, Size.Empty, TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix);
        int w = t.Width + Padding.Horizontal + LogicalToDeviceUnits(4) + (_glyph == Mark.None ? 0 : GlyphSize + GlyphGap);
        int h = t.Height + Padding.Vertical;
        return new Size(Math.Max(w, MinimumSize.Width), Math.Max(h, MinimumSize.Height));
    }

    protected override void OnPaintBackground(PaintEventArgs pevent)
    {
        // Everything is painted in OnPaint (double-buffered) to avoid flicker.
    }

    protected override void OnPaint(PaintEventArgs pevent)
    {
        var g = pevent.Graphics;
        var parentBack = Theme.EffectiveBackColor(Parent);
        g.Clear(parentBack);
        g.SmoothingMode = SmoothingMode.AntiAlias;

        bool live = Enabled && !_dimmed;
        Color fill = Fill.A == 0 ? parentBack : Fill;
        if (live && _pressed) fill = FillPressed;
        else if (live && _hover) fill = FillHover;
        if (!live) fill = Theme.Mix(fill, parentBack, 0.55);

        var rect = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        using (var path = Theme.RoundedRect(rect, LogicalToDeviceUnits(CornerRadius)))
        {
            using (var b = new SolidBrush(fill)) g.FillPath(b, path);
            if (EdgeColor is { } edge)
            {
                using var pen = new Pen(live ? (_hover ? Theme.BorderHover : edge) : Theme.Mix(edge, parentBack, 0.5));
                g.DrawPath(pen, path);
            }
            if (Focused && ShowFocusCues)
            {
                using var pen = new Pen(Theme.Mix(Theme.Accent, Color.White, 0.25), LogicalToDeviceUnits(2));
                using var inner = Theme.RoundedRect(RectangleF.Inflate(rect, -1.5f, -1.5f), LogicalToDeviceUnits(CornerRadius) - 1);
                g.DrawPath(pen, inner);
            }
        }

        var textColor = live ? TextColor : Theme.TextDisabled;
        var area = new Rectangle(Padding.Left / 2, 0, Width - Padding.Horizontal / 2, Height);
        var flags = TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis;
        if (AlignLeft)
        {
            area = new Rectangle(Padding.Left, 0, Width - Padding.Horizontal, Height);
            flags |= TextFormatFlags.Left;
        }
        else flags |= TextFormatFlags.HorizontalCenter;

        if (_glyph != Mark.None && !AlignLeft)
        {
            // Draw the shape and the text centred as one unit.
            var measure = TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding;
            var ts = TextRenderer.MeasureText(g, Text, Font, Size.Empty, measure);
            int gs = GlyphSize, gap = GlyphGap;
            int x = Math.Max(Padding.Left / 2, (Width - gs - gap - ts.Width) / 2);
            var glyphColor = live ? (_glyphColor ?? textColor) : textColor;
            MarkPainter.Draw(g, _glyph, new RectangleF(x, (Height - gs) / 2f, gs, gs), glyphColor, fill);
            var vflags = TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.NoPrefix | TextFormatFlags.NoPadding | TextFormatFlags.EndEllipsis;
            TextRenderer.DrawText(g, Text, Font, new Rectangle(x + gs + gap, 0, Math.Max(1, Width - (x + gs + gap) - Padding.Right / 2), Height), textColor, vflags);
        }
        else
        {
            TextRenderer.DrawText(g, Text, Font, area, textColor, flags);
        }
    }
}
