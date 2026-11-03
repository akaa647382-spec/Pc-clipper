using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace PcClipper.App.UI;

/// <summary>Visual style of a <see cref="FlatButton"/>.</summary>
internal enum ButtonKind
{
    /// <summary>The one main action on a card (accent blue).</summary>
    Primary,
    /// <summary>Normal buttons (dark grey).</summary>
    Secondary,
    /// <summary>Stop / destructive (record red).</summary>
    Danger,
    /// <summary>Text-only buttons (navigation, links).</summary>
    Ghost,
}

/// <summary>
/// Colours, fonts and styling helpers for the dark theme (SPEC "Main window").
/// Sizes passed to helpers are logical pixels at 96 DPI; forms use AutoScaleMode.Dpi so they scale at 100-200%.
/// Fonts are created per control on purpose: WinForms rescales fonts per control on DPI changes, and sharing
/// one Font instance between controls has caused "disposed font" crashes in some .NET versions.
/// </summary>
internal static class Theme
{
    // ---- Palette (SPEC) ----
    public static readonly Color Background = FromHex(0x0F1115);
    public static readonly Color Card = FromHex(0x181B22);
    public static readonly Color Border = FromHex(0x262A33);
    public static readonly Color Text = FromHex(0xE8EAF0);
    public static readonly Color TextSecondary = FromHex(0x9AA3B2);
    public static readonly Color Accent = FromHex(0x4F7CFF);
    public static readonly Color Red = FromHex(0xFF4D5A);
    public static readonly Color Green = FromHex(0x3DD68C);
    public static readonly Color Amber = FromHex(0xF5B83D);

    // ---- Derived shades ----
    public static readonly Color TextDisabled = FromHex(0x5C6370);
    public static readonly Color Input = FromHex(0x11141A);
    public static readonly Color BorderHover = FromHex(0x3A404D);
    public static readonly Color Neutral = FromHex(0x242934);
    public static readonly Color NeutralHover = FromHex(0x2E3441);
    public static readonly Color NeutralPressed = FromHex(0x1D2129);
    public static readonly Color RowHover = FromHex(0x20242C);
    public static readonly Color AccentHover = Mix(Accent, Color.White, 0.14);
    public static readonly Color AccentPressed = Mix(Accent, Color.Black, 0.18);
    public static readonly Color RedHover = Mix(Red, Color.White, 0.12);
    public static readonly Color RedPressed = Mix(Red, Color.Black, 0.18);

    // ---- Spacing grid (logical px) ----
    public const int Space1 = 8;
    public const int Space2 = 16;
    public const int Space3 = 24;

    public static Color FromHex(int rgb) => Color.FromArgb(255, (rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);

    /// <summary>Linear blend: t = 0 gives <paramref name="a"/>, 1 gives <paramref name="b"/>.</summary>
    public static Color Mix(Color a, Color b, double t)
    {
        t = Math.Clamp(t, 0, 1);
        return Color.FromArgb(255,
            (int)Math.Round(a.R + (b.R - a.R) * t),
            (int)Math.Round(a.G + (b.G - a.G) * t),
            (int)Math.Round(a.B + (b.B - a.B) * t));
    }

    /// <summary>A soft tinted background for a coloured element (banners, pills).</summary>
    public static Color Tint(Color color, Color over, double strength = 0.14) => Mix(over, color, strength);

    // ---- Fonts ----

    public static Font MakeFont(float points, bool semibold = false) =>
        new(semibold ? "Segoe UI Semibold" : "Segoe UI", points, FontStyle.Regular, GraphicsUnit.Point);

    // ---- Factories ----

    public static Label MakeLabel(string text, float points = 10f, bool semibold = false, Color? color = null, bool wrap = false)
    {
        var l = new Label
        {
            Text = text,
            AutoSize = true,
            Font = MakeFont(points, semibold),
            ForeColor = color ?? Text,
            Margin = new Padding(0, 0, 0, 4),
            UseMnemonic = false,
        };
        // In a TableLayoutPanel, an auto-sized label anchored left+right wraps to the column width.
        if (wrap) l.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        return l;
    }

    public static FlatButton MakeButton(string text, ButtonKind kind = ButtonKind.Secondary, int minWidth = 0, int height = 40, float points = 10f)
    {
        var b = new FlatButton
        {
            Text = text,
            Font = MakeFont(points, semibold: kind != ButtonKind.Ghost),
            AutoSize = true,
            MinimumSize = new Size(minWidth, height),
            Margin = new Padding(0, 0, Space1, 0),
        };
        b.ApplyKind(kind);
        return b;
    }

    public static LinkLabel MakeLink(string text, float points = 9.5f)
    {
        var l = new LinkLabel
        {
            Text = text,
            AutoSize = true,
            Font = MakeFont(points),
            LinkColor = Accent,
            ActiveLinkColor = AccentHover,
            VisitedLinkColor = Accent,
            DisabledLinkColor = TextDisabled,
            LinkBehavior = LinkBehavior.HoverUnderline,
            Margin = new Padding(0, 0, Space2, 0),
            UseMnemonic = false,
        };
        return l;
    }

    public static CheckBox MakeCheck(string text)
    {
        var c = new CheckBox
        {
            Text = text,
            AutoSize = true,
            Font = MakeFont(10f),
            ForeColor = Text,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand,
            Margin = new Padding(0, 4, 0, 4),
            UseMnemonic = false,
        };
        c.FlatAppearance.BorderColor = BorderHover;
        c.FlatAppearance.CheckedBackColor = Card;
        c.FlatAppearance.MouseOverBackColor = Neutral;
        c.FlatAppearance.MouseDownBackColor = NeutralPressed;
        return c;
    }

    public static NumericUpDown StyleNumeric(NumericUpDown n)
    {
        n.BackColor = Input;
        n.ForeColor = Text;
        n.BorderStyle = BorderStyle.FixedSingle;
        n.Font = MakeFont(10f);
        n.TextAlign = HorizontalAlignment.Right;
        n.Margin = new Padding(0, 4, Space1, 4);
        // Best effort: ask Windows 10/11 to draw the spin buttons dark too. Older builds simply ignore it.
        void Apply()
        {
            foreach (Control child in n.Controls) TrySetWindowTheme(child, "DarkMode_Explorer");
        }
        if (n.IsHandleCreated) Apply();
        n.HandleCreated += (_, _) => Apply();
        return n;
    }

    public static TextBox StyleTextBox(TextBox t)
    {
        t.BackColor = Input;
        t.ForeColor = Text;
        t.BorderStyle = BorderStyle.FixedSingle;
        t.Font = MakeFont(10f);
        t.Margin = new Padding(0, 4, Space1, 4);
        return t;
    }

    public static TrackBar StyleTrackBar(TrackBar t)
    {
        t.BackColor = Card;
        t.TickStyle = TickStyle.None;
        t.AutoSize = false;
        t.Height = 32;
        t.Width = 220;
        t.Margin = new Padding(0, 0, Space1, 0);
        t.Cursor = Cursors.Hand;
        return t;
    }

    /// <summary>An owner-drawn dark tooltip.</summary>
    public static ToolTip MakeToolTip()
    {
        var font = MakeFont(9.5f);
        var tip = new ToolTip { OwnerDraw = true, InitialDelay = 350, ReshowDelay = 100, AutoPopDelay = 12000, UseFading = true };
        const TextFormatFlags flags = TextFormatFlags.WordBreak | TextFormatFlags.Left | TextFormatFlags.NoPrefix;
        tip.Popup += (_, e) =>
        {
            var text = e.AssociatedControl is null ? "" : tip.GetToolTip(e.AssociatedControl);
            int pad = e.AssociatedControl?.LogicalToDeviceUnits(10) ?? 10;
            int maxWidth = e.AssociatedControl?.LogicalToDeviceUnits(360) ?? 360;
            var size = TextRenderer.MeasureText(text, font, new Size(maxWidth, 0), flags);
            e.ToolTipSize = new Size(size.Width + pad * 2, size.Height + pad);
        };
        tip.Draw += (_, e) =>
        {
            using (var bg = new SolidBrush(Neutral)) e.Graphics.FillRectangle(bg, e.Bounds);
            using (var pen = new Pen(BorderHover)) e.Graphics.DrawRectangle(pen, e.Bounds.X, e.Bounds.Y, e.Bounds.Width - 1, e.Bounds.Height - 1);
            var inner = Rectangle.Inflate(e.Bounds, -(e.Bounds.Height > 0 ? 9 : 0), -5);
            TextRenderer.DrawText(e.Graphics, e.ToolTipText, font, inner, Text, flags | TextFormatFlags.VerticalCenter);
        };
        return tip;
    }

    // ---- Layout helpers ----

    /// <summary>Adds a new auto-sized row to <paramref name="t"/> with one control per column (null = empty cell).</summary>
    public static void AddRow(TableLayoutPanel t, params Control?[] cells)
    {
        int row = t.RowCount;
        t.RowCount = row + 1;
        t.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        for (int col = 0; col < cells.Length; col++)
            if (cells[col] is { } c) t.Controls.Add(c, col, row);
    }

    /// <summary>Adds a control that spans every column on its own row.</summary>
    public static void AddSpanRow(TableLayoutPanel t, Control c)
    {
        AddRow(t, c);
        t.SetColumnSpan(c, Math.Max(1, t.ColumnCount));
    }

    /// <summary>A single-row, auto-sized strip of controls laid out left to right.</summary>
    public static FlowLayoutPanel Inline(params Control[] parts)
    {
        var f = new FlowLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            WrapContents = false,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0),
            Padding = new Padding(0),
            BackColor = Color.Transparent,
        };
        foreach (var p in parts) f.Controls.Add(p);
        return f;
    }

    /// <summary>A vertical, full-width stack (one column, auto-sized rows).</summary>
    public static TableLayoutPanel Stack()
    {
        var t = new TableLayoutPanel
        {
            ColumnCount = 1,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        t.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        return t;
    }

    // ---- Painting helpers ----

    public static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        if (d <= 1f)
        {
            p.AddRectangle(r);
            return p;
        }
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    /// <summary>The first non-transparent background colour up the parent chain.</summary>
    public static Color EffectiveBackColor(Control? c)
    {
        for (var x = c; x is not null; x = x.Parent)
            if (x.BackColor.A == 255) return x.BackColor;
        return Background;
    }

    // ---- Native bits (all best effort) ----

    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)]
    private static extern int SetWindowTheme(IntPtr hwnd, string? pszSubAppName, string? pszSubIdList);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DestroyIcon(IntPtr hIcon);

    private static void TrySetWindowTheme(Control c, string theme)
    {
        if (c.IsHandleCreated) TrySetWindowTheme(c.Handle, theme);
    }

    /// <summary>SetWindowTheme with a dark theme class ("DarkMode_Explorer", "DarkMode_CFD"); failure keeps the default look.</summary>
    public static void TrySetWindowTheme(IntPtr hwnd, string theme)
    {
        try
        {
            if (hwnd != IntPtr.Zero) SetWindowTheme(hwnd, theme, null);
        }
        catch
        {
            // uxtheme missing or the theme class unknown on this Windows build.
        }
    }

    /// <summary>Dark scroll bars for an auto-scrolling container (Windows 10 1809+; ignored elsewhere).</summary>
    public static void UseDarkScrollBars(Control c)
    {
        if (c.IsHandleCreated) TrySetWindowTheme(c, "DarkMode_Explorer");
        c.HandleCreated += (_, _) => TrySetWindowTheme(c, "DarkMode_Explorer");
    }

    /// <summary>Turns on vertical-only auto scrolling (no stray horizontal scroll bar when the vertical one appears).</summary>
    public static void VerticalScrollOnly(ScrollableControl c)
    {
        c.AutoScroll = false;
        c.HorizontalScroll.Enabled = false;
        c.HorizontalScroll.Visible = false;
        c.HorizontalScroll.Maximum = 0;
        c.AutoScroll = true;
    }

    /// <summary>The app icon, never throwing: platform helper, then the embedded resource, then the stock icon.</summary>
    public static Icon AppIcon(int size)
    {
        try
        {
            return Platform.NativeUi.AppIcon(size);
        }
        catch
        {
            // Fall through to our own loader.
        }
        try
        {
            using var s = typeof(Theme).Assembly.GetManifestResourceStream("pcclipper.ico");
            if (s is not null) return new Icon(s, size, size);
        }
        catch
        {
            // Fall through to the stock icon.
        }
        return (Icon)SystemIcons.Application.Clone();
    }

    public static void TryDarkTitleBar(Form f)
    {
        try { Platform.NativeUi.UseDarkTitleBar(f.Handle); }
        catch { /* light title bar is fine */ }
    }

    // ---- Small "only touch it if it changed" helpers that avoid layout churn on the 1 s refresh ----

    public static void SetText(Control c, string text)
    {
        if (c.Text != text) c.Text = text;
    }

    public static void SetVisible(Control c, bool visible)
    {
        if (c.Visible != visible) c.Visible = visible;
    }

    public static void SetEnabled(Control c, bool enabled)
    {
        if (c.Enabled != enabled) c.Enabled = enabled;
    }

    public static void SetFore(Control c, Color color)
    {
        if (c.ForeColor != color) c.ForeColor = color;
    }

    public static void SetTip(ToolTip tip, Control c, string? text)
    {
        if (tip.GetToolTip(c) != (text ?? "")) tip.SetToolTip(c, text);
    }
}

/// <summary>Dark colours for context menus (tray menu).</summary>
internal sealed class DarkMenuColors : ProfessionalColorTable
{
    private static readonly Color Selected = Theme.NeutralHover;
    public override Color ToolStripDropDownBackground => Theme.Card;
    public override Color MenuBorder => Theme.Border;
    public override Color MenuItemBorder => Selected;
    public override Color MenuItemSelected => Selected;
    public override Color MenuItemSelectedGradientBegin => Selected;
    public override Color MenuItemSelectedGradientEnd => Selected;
    public override Color MenuItemPressedGradientBegin => Theme.Neutral;
    public override Color MenuItemPressedGradientMiddle => Theme.Neutral;
    public override Color MenuItemPressedGradientEnd => Theme.Neutral;
    public override Color ImageMarginGradientBegin => Theme.Card;
    public override Color ImageMarginGradientMiddle => Theme.Card;
    public override Color ImageMarginGradientEnd => Theme.Card;
    public override Color SeparatorDark => Theme.Border;
    public override Color SeparatorLight => Theme.Card;
    public override Color CheckBackground => Theme.Neutral;
    public override Color CheckSelectedBackground => Theme.NeutralHover;
    public override Color CheckPressedBackground => Theme.Neutral;
}

internal sealed class DarkMenuRenderer : ToolStripProfessionalRenderer
{
    public DarkMenuRenderer() : base(new DarkMenuColors()) => RoundedEdges = false;

    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e)
    {
        e.TextColor = e.Item.Enabled ? Theme.Text : Theme.TextDisabled;
        base.OnRenderItemText(e);
    }

    protected override void OnRenderArrow(ToolStripArrowRenderEventArgs e)
    {
        e.ArrowColor = e.Item?.Enabled == false ? Theme.TextDisabled : Theme.TextSecondary;
        base.OnRenderArrow(e);
    }
}
