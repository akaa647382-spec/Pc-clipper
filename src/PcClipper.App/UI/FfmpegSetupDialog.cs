using PcClipper.App.Platform;
using PcClipper.Core;

namespace PcClipper.App.UI;

/// <summary>
/// "PC Clipper uses FFmpeg..." - download it (with progress, cancel-able), browse for an ffmpeg.exe, or cancel.
/// On OK, <see cref="FfmpegPath"/> holds the chosen/downloaded ffmpeg.exe; the caller probes it.
/// </summary>
internal sealed class FfmpegSetupDialog : Form
{
    public const string DefaultMessage =
        "PC Clipper uses FFmpeg, a free video engine (about 100 MB), to talk to your graphics card. Download it now?";

    private readonly ILog _log;
    private readonly TableLayoutPanel _root;
    private readonly Label _status;
    private readonly ProgressStrip _progress;
    private readonly FlatButton _download;
    private readonly FlatButton _browse;
    private readonly FlatButton _cancel;
    private CancellationTokenSource? _cts;
    private bool _closeWhenIdle;

    public FfmpegSetupDialog(ILog log, string? reason)
    {
        _log = log;
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Set up FFmpeg";
        Font = Theme.MakeFont(10f);
        BackColor = Theme.Background;
        ForeColor = Theme.Text;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterParent;
        Icon = Theme.AppIcon(32);
        Padding = new Padding(Theme.Space3, Theme.Space3 - 4, Theme.Space3, Theme.Space2);

        var root = _root = Theme.Stack();
        root.Dock = DockStyle.Fill;
        root.MinimumSize = new Size(500, 0);

        var heading = Theme.MakeLabel("One more thing before you can record", 14f, semibold: true);
        heading.Margin = new Padding(0, 0, 0, Theme.Space1);

        var body = Theme.MakeLabel(reason ?? DefaultMessage, 10f);
        body.MaximumSize = new Size(500, 0);
        body.Margin = new Padding(0, 0, 0, Theme.Space1);

        var note = Theme.MakeLabel("It is downloaded once from a trusted public build and kept in your user folder. Nothing else is installed.",
            9f, color: Theme.TextSecondary);
        note.MaximumSize = new Size(500, 0);
        note.Margin = new Padding(0, 0, 0, Theme.Space2);

        _progress = new ProgressStrip { Dock = DockStyle.Fill, Height = 6, Visible = false, Margin = new Padding(0, 0, 0, Theme.Space1) };

        _status = Theme.MakeLabel("", 9.5f, color: Theme.TextSecondary);
        _status.MaximumSize = new Size(500, 0);
        _status.Margin = new Padding(0, 0, 0, Theme.Space2);
        _status.Visible = false;

        _download = Theme.MakeButton("Download", ButtonKind.Primary, minWidth: 120, height: 40);
        _browse = Theme.MakeButton("I have it - browse...", ButtonKind.Secondary, height: 40);
        _cancel = Theme.MakeButton("Cancel", ButtonKind.Secondary, minWidth: 96, height: 40);
        _cancel.Margin = new Padding(0);
        _download.Click += async (_, _) => await DownloadAsync();
        _browse.Click += (_, _) => Browse();
        _cancel.Click += (_, _) => OnCancelClicked();

        var buttons = new TableLayoutPanel { ColumnCount = 4, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0, Theme.Space1, 0, 0) };
        buttons.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        buttons.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        buttons.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        buttons.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        Theme.AddRow(buttons, _download, _browse, null, _cancel);

        Theme.AddRow(root, heading);
        Theme.AddRow(root, body);
        Theme.AddRow(root, note);
        Theme.AddRow(root, _progress);
        Theme.AddRow(root, _status);
        Theme.AddRow(root, buttons);
        Controls.Add(root);
        AcceptButton = _download;
        CancelButton = _cancel; // Esc: stops a running download, otherwise closes
        // Assigning CancelButton sets the button's DialogResult to Cancel, which would close the dialog on every click -
        // also "Stop download". OnCancelClicked decides instead (it sets DialogResult itself when nothing is running).
        _cancel.DialogResult = DialogResult.None;
        ResumeLayout(false);
        PerformLayout();
    }

    /// <summary>The ffmpeg.exe that was downloaded or picked.</summary>
    public string? FfmpegPath { get; private set; }

    private bool Busy => _cts is not null;

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.TryDarkTitleBar(this);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        FitToContent();
        if (Owner is not null) CenterToParent(); else CenterToScreen();
    }

    /// <summary>Grows/shrinks the dialog to its content (the status line can appear and wrap).</summary>
    private void FitToContent()
    {
        var pref = _root.GetPreferredSize(Size.Empty);
        var size = new Size(pref.Width + Padding.Horizontal, pref.Height + Padding.Vertical);
        if (ClientSize != size) ClientSize = size;
    }

    private async Task DownloadAsync()
    {
        if (Busy) return;
        _cts = new CancellationTokenSource();
        SetBusy(true);
        _progress.Visible = true;
        _progress.Indeterminate = true;
        ShowStatus("Connecting...", Theme.TextSecondary);
        var progress = new Progress<DownloadProgress>(OnProgress);
        try
        {
            var path = await FfmpegLocator.DownloadAsync(progress, _log, _cts.Token);
            FfmpegPath = path;
            _log.Info($"FFmpeg downloaded to {path}");
            DialogResult = DialogResult.OK; // closes the dialog
        }
        catch (OperationCanceledException)
        {
            _progress.Visible = false;
            ShowStatus("Download stopped. You can start it again whenever you like.", Theme.TextSecondary);
        }
        catch (Exception ex)
        {
            _log.Error("FFmpeg download failed", ex);
            ShowStatus($"The download didn't work: {Fmt.Sentence(ex.Message)} Check your internet connection and try again, " +
                       "or download FFmpeg yourself (for example the \"essentials\" build from gyan.dev), unzip it and use \"I have it - browse...\".",
                Theme.Amber);
            _progress.Visible = false;
            FitToContent();
        }
        finally
        {
            _cts?.Dispose();
            _cts = null;
            if (!IsDisposed)
            {
                SetBusy(false);
                if (_closeWhenIdle && DialogResult != DialogResult.OK) Close();
            }
        }
    }

    private void OnProgress(DownloadProgress p)
    {
        if (IsDisposed) return;
        string sizes = p.BytesTotal is > 0
            ? $" - {QualityMath.FormatBytes(p.BytesDone)} of {QualityMath.FormatBytes(p.BytesTotal.Value)}"
            : p.BytesDone > 0 ? $" - {QualityMath.FormatBytes(p.BytesDone)}" : "";
        ShowStatus((string.IsNullOrWhiteSpace(p.Status) ? "Downloading" : p.Status) + sizes, Theme.TextSecondary);
        if (p.BytesTotal is > 0)
        {
            _progress.Indeterminate = false;
            _progress.Value = p.BytesDone / (double)p.BytesTotal.Value;
        }
        else _progress.Indeterminate = true;
    }

    private void Browse()
    {
        if (Busy) return;
        using var ofd = new OpenFileDialog
        {
            Title = "Find ffmpeg.exe",
            Filter = "FFmpeg (ffmpeg.exe)|ffmpeg.exe|Programs (*.exe)|*.exe",
            CheckFileExists = true,
            RestoreDirectory = true,
        };
        try
        {
            if (ofd.ShowDialog(this) != DialogResult.OK) return;
        }
        catch (Exception ex)
        {
            _log.Error("Browse dialog failed", ex);
            return;
        }
        FfmpegPath = ofd.FileName;
        DialogResult = DialogResult.OK;
    }

    private void OnCancelClicked()
    {
        if (Busy)
        {
            _cts?.Cancel();
            return;
        }
        DialogResult = DialogResult.Cancel;
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (Busy && DialogResult != DialogResult.OK)
        {
            // Stop the download first, then close once it has cleaned up its temp file.
            e.Cancel = true;
            _closeWhenIdle = true;
            _cts?.Cancel();
        }
        base.OnFormClosing(e);
    }

    private void SetBusy(bool busy)
    {
        _download.Enabled = !busy;
        _browse.Enabled = !busy;
        _download.Text = busy ? "Downloading..." : "Download";
        _cancel.Text = busy ? "Stop download" : "Cancel";
        _download.Invalidate();
    }

    private void ShowStatus(string text, Color color)
    {
        _status.Text = text;
        _status.ForeColor = color;
        _status.Visible = true;
        if (IsHandleCreated) FitToContent();
    }
}
