using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// Click it, press a key combination, done. Rules (SPEC "Hotkeys"): the combination must include Ctrl, Alt,
/// Shift or Win unless the key is F13-F24; Esc cancels; Backspace (or Delete) clears it to "Not set".
/// While capturing, every key goes to this box (Alt+F4 doesn't close the window, Alt doesn't open the system menu).
/// </summary>
internal sealed class HotkeyBox : Control
{
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int WM_SYSCHAR = 0x0106;
    private const int WM_CHAR = 0x0102;
    private const int VK_LWIN = 0x5B;
    private const int VK_RWIN = 0x5C;

    private HotkeyBinding _binding = new();
    private bool _capturing;
    private bool _hover;
    private string? _preview;
    private string? _hint;
    private bool _hasError;

    public HotkeyBox()
    {
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer |
                 ControlStyles.ResizeRedraw | ControlStyles.Selectable | ControlStyles.StandardClick, true);
        TabStop = true;
        Cursor = Cursors.Hand;
        Font = Theme.MakeFont(10f, semibold: true);
        Size = new Size(240, 36);
        Margin = new Padding(0, 4, Theme.Space1, 4);
        BackColor = Theme.Input;
    }

    /// <summary>The binding shown (a copy).</summary>
    public HotkeyBinding Binding
    {
        get => _binding.Clone();
        set
        {
            _binding = value?.Clone() ?? new HotkeyBinding();
            Invalidate();
        }
    }

    /// <summary>Red border (registration failed / duplicate).</summary>
    public bool HasError
    {
        get => _hasError;
        set { _hasError = value; Invalidate(); }
    }

    public bool IsCapturing => _capturing;

    /// <summary>The user picked a new combination (or cleared it).</summary>
    public event EventHandler? BindingChanged;

    /// <summary>Capture mode started (true) or ended (false). The app pauses its global hotkeys meanwhile.</summary>
    public event EventHandler<bool>? CapturingChanged;

    private void StartCapture()
    {
        if (_capturing) return;
        _capturing = true;
        _preview = null;
        _hint = null;
        Invalidate();
        CapturingChanged?.Invoke(this, true);
    }

    private void StopCapture()
    {
        if (!_capturing) return;
        _capturing = false;
        _preview = null;
        _hint = null;
        Invalidate();
        CapturingChanged?.Invoke(this, false);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button != MouseButtons.Left) return;
        if (!Focused) Focus();
        if (_capturing) StopCapture(); else StartCapture();
    }

    protected override void OnLostFocus(EventArgs e)
    {
        StopCapture();
        base.OnLostFocus(e);
        Invalidate();
    }

    protected override void OnGotFocus(EventArgs e)
    {
        base.OnGotFocus(e);
        Invalidate();
    }

    protected override void OnMouseEnter(EventArgs e) { _hover = true; Invalidate(); base.OnMouseEnter(e); }
    protected override void OnMouseLeave(EventArgs e) { _hover = false; Invalidate(); base.OnMouseLeave(e); }

    protected override bool IsInputKey(Keys keyData) => _capturing || base.IsInputKey(keyData);

    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        if (_capturing)
        {
            HandleKeyDown(keyData);
            return true; // swallow everything (Alt+F4, Enter, Esc...) while capturing
        }
        if ((keyData == Keys.Enter || keyData == Keys.Space) && Focused)
        {
            StartCapture();
            return true;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    protected override void WndProc(ref Message m)
    {
        if (_capturing)
        {
            switch (m.Msg)
            {
                case WM_KEYUP:
                case WM_SYSKEYUP:
                    // Releasing a modifier: refresh the "Ctrl+Alt+..." preview. Not passing SYSKEYUP on stops
                    // Windows from opening the window menu when Alt is released.
                    UpdateModifierPreview();
                    return;
                case WM_SYSKEYDOWN:
                case WM_SYSCHAR:
                case WM_CHAR:
                    return;
            }
        }
        base.WndProc(ref m);
    }

    private void HandleKeyDown(Keys keyData)
    {
        var key = keyData & Keys.KeyCode;
        bool ctrl = (keyData & Keys.Control) != 0;
        bool alt = (keyData & Keys.Alt) != 0;
        bool shift = (keyData & Keys.Shift) != 0;
        bool win = IsWinDown();
        bool anyModifier = ctrl || alt || shift || win;

        if (key is Keys.ControlKey or Keys.LControlKey or Keys.RControlKey or Keys.ShiftKey or Keys.LShiftKey or Keys.RShiftKey
            or Keys.Menu or Keys.LMenu or Keys.RMenu or Keys.LWin or Keys.RWin)
        {
            UpdateModifierPreview();
            return;
        }

        if (key == Keys.Escape && !anyModifier)
        {
            StopCapture();
            return;
        }

        if ((key == Keys.Back || key == Keys.Delete) && !anyModifier)
        {
            _binding = new HotkeyBinding();
            StopCapture();
            BindingChanged?.Invoke(this, EventArgs.Empty);
            return;
        }

        bool highFKey = key >= Keys.F13 && key <= Keys.F24;
        if (!anyModifier && !highFKey)
        {
            _hint = "Add Ctrl, Alt, Shift or Win";
            Invalidate();
            return;
        }

        // Shift + a typing key would hijack capital letters/symbols in every app.
        if (shift && !ctrl && !alt && !win && IsTypingKey(key))
        {
            _hint = "Shift alone isn't enough here: add Ctrl or Alt";
            Invalidate();
            return;
        }

        _binding = new HotkeyBinding { Ctrl = ctrl, Alt = alt, Shift = shift, Win = win, KeyCode = (int)key };
        StopCapture();
        BindingChanged?.Invoke(this, EventArgs.Empty);
    }

    private static bool IsTypingKey(Keys key) =>
        key is >= Keys.A and <= Keys.Z or >= Keys.D0 and <= Keys.D9 or Keys.Space or Keys.Enter or Keys.Tab ||
        key is >= Keys.Oem1 and <= Keys.Oem102 || key is >= Keys.NumPad0 and <= Keys.Divide;

    private void UpdateModifierPreview()
    {
        var mods = ModifierKeys;
        var parts = new List<string>();
        if ((mods & Keys.Control) != 0) parts.Add("Ctrl");
        if ((mods & Keys.Alt) != 0) parts.Add("Alt");
        if ((mods & Keys.Shift) != 0) parts.Add("Shift");
        if (IsWinDown()) parts.Add("Win");
        _preview = parts.Count == 0 ? null : string.Join("+", parts) + "+...";
        _hint = null;
        Invalidate();
    }

    [DllImport("user32.dll")]
    private static extern short GetKeyState(int nVirtKey);

    private static bool IsWinDown()
    {
        try { return GetKeyState(VK_LWIN) < 0 || GetKeyState(VK_RWIN) < 0; }
        catch { return false; }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        var back = Theme.EffectiveBackColor(Parent);
        g.Clear(back);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f);
        var border = _capturing ? Theme.Accent : _hasError ? Theme.Red : (_hover || Focused) ? Theme.BorderHover : Theme.Border;
        using (var path = Theme.RoundedRect(rect, LogicalToDeviceUnits(6)))
        {
            using (var b = new SolidBrush(Enabled ? Theme.Input : back)) g.FillPath(b, path);
            using (var p = new Pen(border, _capturing ? LogicalToDeviceUnits(2) * 0.75f : 1f)) g.DrawPath(p, path);
        }

        string text;
        Color color;
        if (_capturing)
        {
            text = _hint ?? _preview ?? "Press the keys you want...";
            color = _hint is not null ? Theme.Amber : Theme.Accent;
        }
        else
        {
            text = HotkeyText.Describe(_binding);
            color = _binding.IsAssigned ? Theme.Text : Theme.TextSecondary;
        }
        var area = new Rectangle(LogicalToDeviceUnits(12), 0, Width - LogicalToDeviceUnits(24), Height);
        TextRenderer.DrawText(g, text, Font, area, Enabled ? color : Theme.TextDisabled,
            TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
    }
}
