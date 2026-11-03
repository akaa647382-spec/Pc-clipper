using System.Drawing.Imaging;

namespace PcClipper.App.Platform;

/// <summary>
/// Fallback screenshot (when ffmpeg's ddagrab can't take one): GDI copy of a desktop rectangle in physical pixels
/// (the process is per-monitor DPI aware). Without CAPTUREBLT layered windows such as our own toast are left out.
/// Note: GDI sees an exclusive-fullscreen game as black on some systems; that is why it is only the fallback.
/// </summary>
public static class GdiScreenshot
{
    /// <summary>Fallback screenshot of a desktop rectangle to PNG. Returns false on failure.</summary>
    public static bool Capture(Rectangle bounds, string pngPath)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0)
        {
            PlatformLog.Warn($"GDI screenshot skipped: empty area {bounds}.");
            return false;
        }
        string tmp = pngPath + ".part";
        try
        {
            var dir = Path.GetDirectoryName(Path.GetFullPath(pngPath));
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

            using (var bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(bmp))
                    g.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                bmp.Save(tmp, ImageFormat.Png);
            }
            File.Move(tmp, pngPath, overwrite: false);
            return true;
        }
        catch (Exception ex)
        {
            PlatformLog.Error($"GDI screenshot of {bounds} to {pngPath} failed", ex);
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }
            return false;
        }
    }
}
