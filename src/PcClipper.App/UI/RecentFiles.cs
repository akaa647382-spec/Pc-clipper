namespace PcClipper.App.UI;

internal enum RecentKind
{
    Clip,
    Recording,
    Screenshot,
}

/// <summary>A clip, recording or screenshot shown in the Home page's Recent list.</summary>
/// <param name="Duration">Known for files saved this session; null for files found on disk at startup.</param>
internal sealed record RecentItem(string Path, RecentKind Kind, DateTime When, long Bytes, TimeSpan? Duration)
{
    public string Name => System.IO.Path.GetFileNameWithoutExtension(Path);

    public static RecentItem FromFile(string path, RecentKind kind, TimeSpan? duration)
    {
        long bytes = 0;
        var when = DateTime.Now;
        try
        {
            var fi = new FileInfo(path);
            if (fi.Exists)
            {
                bytes = fi.Length;
                when = fi.LastWriteTime;
            }
        }
        catch
        {
            // Size is optional.
        }
        return new RecentItem(path, kind, when, bytes, duration);
    }
}

/// <summary>Finds the newest clips and screenshots already in the output folders (for the Recent list at startup).</summary>
internal static class RecentFiles
{
    public static List<RecentItem> Scan(string clipsFolder, string screenshotsFolder, int limit)
    {
        var items = new List<RecentItem>();
        // The two folders may be the same; each pass only looks at its own file type, and duplicates are merged below.
        AddFrom(items, clipsFolder, ".mp4");
        AddFrom(items, screenshotsFolder, ".png");
        return items
            .GroupBy(i => i.Path, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderByDescending(i => i.When)
            .Take(limit)
            .ToList();
    }

    private static void AddFrom(List<RecentItem> items, string folder, string extension)
    {
        try
        {
            var dir = new DirectoryInfo(folder);
            if (!dir.Exists) return;
            foreach (var f in dir.EnumerateFiles("*" + extension))
            {
                // EnumerateFiles' 3-letter-extension quirk can match longer extensions; be exact.
                if (!f.Name.EndsWith(extension, StringComparison.OrdinalIgnoreCase)) continue;
                var kind = extension == ".png" ? RecentKind.Screenshot
                    : f.Name.StartsWith("Recording", StringComparison.OrdinalIgnoreCase) ? RecentKind.Recording
                    : RecentKind.Clip;
                items.Add(new RecentItem(f.FullName, kind, f.LastWriteTime, f.Length, null));
            }
        }
        catch
        {
            // Folder unreadable or on a disconnected drive: just show nothing from it.
        }
    }
}
