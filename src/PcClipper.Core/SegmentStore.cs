using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace PcClipper.Core;

/// <summary>
/// Tracks the segments of one capture session on disk. ffmpeg's segment muxer appends a CSV line
/// (<c>filename,start,end</c>) when a segment is finished; only listed segments are treated as complete.
/// The file ffmpeg is writing right now is never listed yet, so it is never read, pinned or deleted.
/// </summary>
public sealed partial class SegmentStore
{
    private const string SegmentPrefix = "seg_";
    /// <summary>A session folder containing a file ending like this holds recording footage that isn't saved yet (its
    /// recovery note): cleanup leaves the folder alone and the next launch re-saves it.</summary>
    public const string KeepMarkerSuffix = ".pcclipper-keep.json";

    private readonly ILog _log;
    private readonly object _gate = new();
    private readonly List<SegmentInfo> _segments = new(); // oldest first, contiguous indices
    private readonly HashSet<int> _known = new();
    private readonly Dictionary<int, int> _pinCounts = new();
    private readonly List<PinFromHandle> _pinFrom = new();
    private readonly List<SegmentInfo> _pendingDelete = new();
    private long _listOffset;
    private int _maxKnownIndex = -1;
    private long _lastNewSegmentMs = Environment.TickCount64;
    private string _partialLine = "";

    public SegmentStore(string sessionDir, string segmentExtension, ILog log)
    {
        SessionDir = Path.GetFullPath(sessionDir);
        Extension = segmentExtension.StartsWith('.') ? segmentExtension : "." + segmentExtension;
        _log = log;
    }

    public string SessionDir { get; }
    public string Extension { get; }

    /// <summary>ffmpeg output pattern, e.g. "&lt;dir&gt;/seg_%08d.ts".</summary>
    public string SegmentPattern => Path.Combine(SessionDir, SegmentPrefix + "%08d" + Extension);

    /// <summary>The CSV list ffmpeg appends to as each segment closes.</summary>
    public string ListFile => Path.Combine(SessionDir, FfmpegCommandBuilder.SegmentListName);

    /// <summary>Make a new, empty session folder under <paramref name="bufferRoot"/> and return its path.</summary>
    public static string CreateSessionDir(string bufferRoot)
    {
        var name = $"session_{DateTime.Now:yyyyMMdd_HHmmss}_{Guid.NewGuid().ToString("N")[..8]}";
        var dir = Path.Combine(Path.GetFullPath(bufferRoot), name);
        Directory.CreateDirectory(dir);
        return dir;
    }

    /// <summary>Re-read the list file; tolerate a partially written last line and a rewritten file.</summary>
    public void Refresh()
    {
        string chunk;
        try
        {
            using var fs = new FileStream(ListFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            lock (_gate)
            {
                if (fs.Length < _listOffset)
                {
                    // ffmpeg rewrote the list from scratch; parse it again (entries are de-duplicated by index).
                    _listOffset = 0;
                    _partialLine = "";
                }
                if (fs.Length == _listOffset) return;
                fs.Seek(_listOffset, SeekOrigin.Begin);
                var buf = new byte[fs.Length - _listOffset];
                int read = 0;
                while (read < buf.Length)
                {
                    int n = fs.Read(buf, read, buf.Length - read);
                    if (n == 0) break;
                    read += n;
                }
                _listOffset += read;
                chunk = _partialLine + Encoding.UTF8.GetString(buf, 0, read);
            }
        }
        catch (FileNotFoundException) { return; }
        catch (DirectoryNotFoundException) { return; }
        catch (IOException ex)
        {
            _log.Warn($"Could not read segment list: {ex.Message}");
            return;
        }

        lock (_gate)
        {
            int lastNewline = chunk.LastIndexOf('\n');
            _partialLine = lastNewline < 0 ? chunk : chunk[(lastNewline + 1)..];
            if (lastNewline < 0) return;

            foreach (var raw in chunk[..lastNewline].Split('\n'))
            {
                var line = raw.Trim('\r', ' ');
                if (line.Length == 0) continue;
                if (TryParseLine(line, out var seg) && _known.Add(seg.Index))
                {
                    _maxKnownIndex = Math.Max(_maxKnownIndex, seg.Index);
                    Insert(seg);
                    _lastNewSegmentMs = Environment.TickCount64;
                }
            }
        }
    }

    private bool TryParseLine(string line, out SegmentInfo seg)
    {
        seg = null!;
        // filename,start,end  (the filename is quoted by ffmpeg only if it contains a comma/quote; ours never do)
        int c2 = line.LastIndexOf(',');
        if (c2 <= 0) return false;
        int c1 = line.LastIndexOf(',', c2 - 1);
        if (c1 <= 0) return false;
        var name = line[..c1].Trim('"');
        if (!double.TryParse(line[(c1 + 1)..c2], NumberStyles.Float, CultureInfo.InvariantCulture, out var start)) return false;
        if (!double.TryParse(line[(c2 + 1)..], NumberStyles.Float, CultureInfo.InvariantCulture, out var end)) return false;

        var file = Path.GetFileName(name.Replace('/', Path.DirectorySeparatorChar).Replace('\\', Path.DirectorySeparatorChar));
        var m = SegmentNameRegex().Match(file);
        if (!m.Success) return false;
        int index = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        seg = new SegmentInfo(index, Path.Combine(SessionDir, file), start, end);
        return true;
    }

    private void Insert(SegmentInfo seg)
    {
        // Lines arrive in order, so this is almost always an append.
        int i = _segments.Count;
        while (i > 0 && _segments[i - 1].Index > seg.Index) i--;
        _segments.Insert(i, seg);
    }

    /// <summary>Completed segments still on disk, oldest first.</summary>
    public IReadOnlyList<SegmentInfo> Completed
    {
        get { lock (_gate) return _segments.ToArray(); }
    }

    /// <summary>When the newest segment was discovered (whoever called <see cref="Refresh"/>).</summary>
    /// <remarks>Monotonic (Environment.TickCount64): a clock step from time sync must not blind the stall watchdog.</remarks>
    public long LastNewSegmentMs => Interlocked.Read(ref _lastNewSegmentMs);

    /// <summary>Total size of the given segments' files (missing files count as 0).</summary>
    public static long BytesOf(IEnumerable<SegmentInfo> segments) => segments.Sum(s =>
    {
        try { return new FileInfo(s.Path).Length; } catch { return 0L; }
    });

    /// <summary>Sum of the completed segments' durations.</summary>
    public double TotalDuration
    {
        get { lock (_gate) return _segments.Sum(x => x.Duration); }
    }

    /// <summary>True while any save or recording holds segments of this store.</summary>
    public bool HasPins
    {
        get { lock (_gate) return _pinCounts.Count > 0 || _pinFrom.Count > 0; }
    }

    public double NewestEndSeconds
    {
        get { lock (_gate) return _segments.Count == 0 ? 0 : _segments[^1].EndSeconds; }
    }

    /// <summary>How far short of the asked length a selection may stop (rounding in the segment list's times).</summary>
    public const double SelectionSlackSeconds = 0.05;

    /// <summary>Newest contiguous segments covering at least <paramref name="seconds"/> (or all that exist), oldest first.</summary>
    public IReadOnlyList<SegmentInfo> SelectLast(double seconds)
    {
        lock (_gate)
        {
            var picked = new List<SegmentInfo>();
            double total = 0;
            for (int i = _segments.Count - 1; i >= 0 && total < seconds - SelectionSlackSeconds; i--)
            {
                if (picked.Count > 0 && _segments[i].Index != picked[^1].Index - 1) break; // never bridge a gap
                picked.Add(_segments[i]);
                total += _segments[i].Duration;
            }
            picked.Reverse();
            return picked;
        }
    }

    /// <summary>Completed contiguous segments with Index &gt;= <paramref name="fromIndex"/>, oldest first.</summary>
    public IReadOnlyList<SegmentInfo> SelectFrom(int fromIndex)
    {
        lock (_gate)
        {
            var picked = new List<SegmentInfo>();
            foreach (var s in _segments)
            {
                if (s.Index < fromIndex) continue;
                if (picked.Count > 0 && s.Index != picked[^1].Index + 1) break;
                picked.Add(s);
            }
            return picked;
        }
    }

    /// <summary>Index ffmpeg is writing now (highest completed + 1, or 0).</summary>
    public int CurrentWritingIndex
    {
        get { lock (_gate) return _known.Count == 0 ? 0 : _maxKnownIndex + 1; }
    }

    /// <summary>Protect segments from deletion until the returned handle is disposed.</summary>
    public IDisposable Pin(IEnumerable<SegmentInfo> segments)
    {
        var indices = segments.Select(s => s.Index).ToArray();
        lock (_gate)
        {
            foreach (var i in indices)
                _pinCounts[i] = _pinCounts.TryGetValue(i, out var c) ? c + 1 : 1;
        }
        return new ActionHandle(() =>
        {
            lock (_gate)
            {
                foreach (var i in indices)
                {
                    if (!_pinCounts.TryGetValue(i, out var c)) continue;
                    if (c <= 1) _pinCounts.Remove(i); else _pinCounts[i] = c - 1;
                }
            }
        });
    }

    /// <summary>Protect every segment with Index &gt;= fromIndex (present and future) until disposed.</summary>
    public IDisposable PinFrom(int fromIndex)
    {
        var handle = new PinFromHandle(this, fromIndex);
        lock (_gate) _pinFrom.Add(handle);
        return handle;
    }

    private bool IsPinned(int index)
    {
        if (_pinCounts.ContainsKey(index)) return true;
        foreach (var p in _pinFrom)
            if (index >= p.FromIndex) return true;
        return false;
    }

    /// <summary>Atomically select the newest segments covering <paramref name="seconds"/> and pin them.</summary>
    public IReadOnlyList<SegmentInfo> SelectLastAndPin(double seconds, out IDisposable pin)
    {
        lock (_gate)
        {
            var picked = SelectLast(seconds);
            pin = Pin(picked);
            return picked;
        }
    }

    /// <summary>Delete completed, unpinned segments that end before NewestEnd - keepSeconds. Returns count deleted.</summary>
    public int DeleteExpired(double keepSeconds)
    {
        var victims = new List<SegmentInfo>();
        lock (_gate)
        {
            if (_segments.Count > 0)
            {
                double cutoff = _segments[^1].EndSeconds - keepSeconds;
                // Every expired segment that nothing holds goes, even beyond a pinned block (a recording waiting to be
                // saved): otherwise that block would stop the buffer from ever expiring and the drive would fill. Gaps
                // only appear in the expired region, and selections never bridge a gap. The segment leaves the list
                // under the lock, so no save can select it after this point.
                victims.AddRange(_segments.Where(x => x.EndSeconds < cutoff && !IsPinned(x.Index)));
                foreach (var v in victims) _segments.Remove(v);
            }
            victims.InsertRange(0, _pendingDelete);
            _pendingDelete.Clear();
        }

        int deleted = 0;
        foreach (var s in victims)
        {
            try
            {
                File.Delete(s.Path); // no exception if it is already gone
                deleted++;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Locked (antivirus scan, indexer...). Try again on the next tick.
                lock (_gate) _pendingDelete.Add(s);
            }
        }
        return deleted;
    }

    /// <summary>Delete every completed, unpinned segment wherever it is (used when capture has stopped for good).</summary>
    public int DeleteAllUnpinned()
    {
        List<SegmentInfo> victims;
        lock (_gate)
        {
            victims = _segments.Where(x => !IsPinned(x.Index)).ToList();
            foreach (var v in victims) _segments.Remove(v);
        }
        int deleted = 0;
        foreach (var v in victims)
        {
            try { File.Delete(v.Path); deleted++; }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
        }
        return deleted;
    }

    /// <summary>Total bytes of files in the session folder.</summary>
    public long BytesOnDisk()
    {
        try
        {
            return new DirectoryInfo(SessionDir).EnumerateFiles().Sum(f =>
            {
                try { return f.Length; } catch { return 0L; }
            });
        }
        catch
        {
            return 0;
        }
    }

    /// <summary>Delete the whole session folder (best effort).</summary>
    public void DeleteSession()
    {
        for (int attempt = 0; attempt < 5; attempt++)
        {
            try
            {
                if (Directory.Exists(SessionDir)) Directory.Delete(SessionDir, recursive: true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                Thread.Sleep(200);
            }
        }
        _log.Warn($"Could not fully delete buffer folder {SessionDir}; it will be cleaned up next time.");
    }

    /// <summary>Delete leftover session_* folders from earlier runs (best effort). Skips <paramref name="exceptDir"/>.</summary>
    public static int CleanupStaleSessions(string bufferRoot, string? exceptDir, ILog log)
    {
        int removed = 0;
        try
        {
            if (!Directory.Exists(bufferRoot)) return 0;
            var except = exceptDir is null ? null : Path.GetFullPath(exceptDir).TrimEnd(Path.DirectorySeparatorChar);
            foreach (var dir in Directory.EnumerateDirectories(bufferRoot))
            {
                var name = Path.GetFileName(dir);
                if (!SessionNameRegex().IsMatch(name)) continue;
                if (Directory.EnumerateFiles(dir, "*" + KeepMarkerSuffix).Any()) continue;
                if (except is not null && string.Equals(Path.GetFullPath(dir).TrimEnd(Path.DirectorySeparatorChar), except, StringComparison.OrdinalIgnoreCase)) continue;
                try
                {
                    Directory.Delete(dir, recursive: true);
                    removed++;
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    log.Warn($"Could not remove old buffer folder {dir}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            log.Warn($"Buffer cleanup failed: {ex.Message}");
        }
        return removed;
    }

    [GeneratedRegex(@"^seg_(\d+)\.[A-Za-z0-9]+$")]
    private static partial Regex SegmentNameRegex();

    [GeneratedRegex(@"^session_\d{8}_\d{6}_[0-9a-f]{8}$")]
    private static partial Regex SessionNameRegex();

    private sealed class ActionHandle : IDisposable
    {
        private Action? _onDispose;
        public ActionHandle(Action onDispose) => _onDispose = onDispose;
        public void Dispose() => Interlocked.Exchange(ref _onDispose, null)?.Invoke();
    }

    private sealed class PinFromHandle : IDisposable
    {
        private readonly SegmentStore _owner;
        private int _disposed;
        public PinFromHandle(SegmentStore owner, int fromIndex)
        {
            _owner = owner;
            FromIndex = fromIndex;
        }
        public int FromIndex { get; }
        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
            lock (_owner._gate) _owner._pinFrom.Remove(this);
        }
    }
}
