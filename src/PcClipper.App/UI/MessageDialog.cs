namespace PcClipper.App.UI;

/// <summary>
/// A small dark question/notice dialog with plain-language buttons ("Apply and restart" / "Cancel")
/// instead of Yes/No. Used for confirmations; crash reports use the stock MessageBox (works even when the UI is broken).
/// </summary>
internal sealed class MessageDialog : Form
{
    private readonly TableLayoutPanel _root;
    private int _choice = -1;

    private MessageDialog(string title, string text, IReadOnlyList<string> buttons, int defaultIndex, int cancelIndex, bool warning)
    {
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = title;
        Font = Theme.MakeFont(10f);
        BackColor = Theme.Background;
        ForeColor = Theme.Text;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowIcon = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        Padding = new Padding(Theme.Space3, Theme.Space3 - 4, Theme.Space3, Theme.Space2);

        var root = _root = Theme.Stack();
        root.Dock = DockStyle.Fill;

        var heading = Theme.MakeLabel(title, 13f, semibold: true, color: warning ? Theme.Amber : Theme.Text);
        heading.Margin = new Padding(0, 0, 0, Theme.Space1);
        var body = Theme.MakeLabel(text, 10f, color: Theme.Text);
        body.MaximumSize = new Size(460, 0);
        body.Margin = new Padding(0, 0, 0, Theme.Space3);

        var row = new FlowLayoutPanel
        {
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Anchor = AnchorStyles.Right,
            Margin = new Padding(0),
        };
        for (int i = buttons.Count - 1; i >= 0; i--)
        {
            int index = i;
            var b = Theme.MakeButton(buttons[i], i == defaultIndex ? ButtonKind.Primary : ButtonKind.Secondary, minWidth: 96, height: 38);
            b.Margin = new Padding(Theme.Space1, 0, 0, 0);
            b.Click += (_, _) =>
            {
                _choice = index;
                Close();
            };
            row.Controls.Add(b);
            if (i == defaultIndex) AcceptButton = b;
            if (i == cancelIndex) CancelButton = b;
        }
        // RightToLeft flow shows the last-added first; we added in reverse so the order reads left-to-right.

        Theme.AddRow(root, heading);
        Theme.AddRow(root, body);
        Theme.AddRow(root, row);
        Controls.Add(root);
        ResumeLayout(false);
        PerformLayout();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.TryDarkTitleBar(this);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        // Size to the content (already DPI-scaled at this point), then centre again.
        var pref = _root.GetPreferredSize(Size.Empty);
        ClientSize = new Size(pref.Width + Padding.Horizontal, pref.Height + Padding.Vertical);
        if (Owner is not null) CenterToParent(); else CenterToScreen();
    }

    /// <summary>Shows the dialog; returns the index of the button pressed, or <paramref name="cancelIndex"/> if closed.</summary>
    public static int Ask(IWin32Window? owner, string title, string text, IReadOnlyList<string> buttons, int defaultIndex = 0, int cancelIndex = -1, bool warning = false)
    {
        if (cancelIndex < 0) cancelIndex = buttons.Count - 1;
        using var dlg = new MessageDialog(title, text, buttons, defaultIndex, cancelIndex, warning);
        if (owner is null)
        {
            dlg.StartPosition = FormStartPosition.CenterScreen;
            dlg.ShowInTaskbar = true;
            dlg.TopMost = true;
        }
        dlg.ShowDialog(owner);
        return dlg._choice < 0 ? cancelIndex : dlg._choice;
    }

    public static bool Confirm(IWin32Window? owner, string title, string text, string yes, string no = "Cancel", bool warning = false) =>
        Ask(owner, title, text, new[] { yes, no }, 0, 1, warning) == 0;

    public static void Inform(IWin32Window? owner, string title, string text, bool warning = false) =>
        Ask(owner, title, text, new[] { "OK" }, 0, 0, warning);
}
