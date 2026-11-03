# PC Clipper: ring buffer and save/concat research report

**The design has to change in two places:**
- **H.264/HEVC:** do not use the concat demuxer. Save by byte-joining MPEG-TS segments with the `concatf:` protocol instead.
- **AV1:** the concat demuxer only works if you pass a `duration` line for every segment, taken from `list.csv`.

Local tests used ffmpeg 6.1.1. Scripts and test outputs are in `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/ringbuffer/`.

`ffmpeg.org` and `learn.microsoft.com` cannot be reached from this session; they would need to be allowed in its network settings. I read the FFmpeg docs and source through `raw.githubusercontent.com` and `github.com` instead.

---

## 1. Segment muxer: timing, list file, CSV format

**Segment durations.** With `testsrc2 60fps`, `-g 60` and `-segment_time 2`, segments are exactly 2.000 s.
- The first segment is 2.02–2.03 s because of the AAC priming offset.
- The last segment is partial.
- When the keyframe interval divides `segment_time`, a segment's end time always equals the next segment's start time.
- **[HIGH]** tested locally (`seg_poll.sh`: `-re`, polling every 0.5 s).

**When a line appears in `list.csv`.** A line appears only after its segment is closed, and it is written immediately.
- Polling showed `seg_00000000.ts,0.000000,2.021333` at t≈2.1 s, at the same moment `seg_00000001.ts` was created.
- strace showed this order: last data `write(seg fd)` → `write(list fd, "seg_00000000.ts,0.000000,2.02133…\n")` as one write → `close(seg fd)` → `openat(next segment)`.
- So the line is written a few microseconds *before* the segment handle closes. The data is complete by then.
- Source order in `segment_end`: `av_write_frame(oc,NULL)` → `av_write_trailer` → print the list entry plus `avio_flush` → `ff_format_io_close`.
- **[HIGH]** tested locally plus https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavformat/segment.c

**Append vs. rewrite.**
- **Default (`segment_list_size` 0, type csv):** the list is opened once (O_TRUNC at start), kept open, and one line is appended and flushed per segment.
- **`-segment_list_size N` (or type m3u8):** the whole list is rewritten every segment to `list.csv.tmp` and then renamed over `list.csv`. strace showed `openat("list.csv.tmp")` followed by `rename("list.csv.tmp","list.csv")`. On Windows the rename is `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`, which fails if the app has `list.csv` open without delete sharing.
- **Recommendation:** use append mode, not `segment_list_size`.
- **[HIGH]** tested locally plus segment.c and https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavformat/os_support.h

**CSV columns.** `filename,start_time,end_time`, written with `"%f"`, so there are always 6 decimals and a `.` decimal point.
- The filename is the **basename only**, even when the output pattern is an absolute path (tested). It is CSV-escaped, i.e. quoted only if it contains special characters.
- `start_time` is the pts of the keyframe that started the segment. `end_time` is the largest pts+duration seen. Times are in the stream's timeline.
- The times do **not** include the 1.4 s offset the mpegts muxer adds inside the files.
- **[HIGH]** tested locally plus segment.c

**`-segment_list_flags +live`.** No observable effect on CSV. The flag is declared in `segment.c` but never tested in the code; only `cache` changes output, and only for M3U8.
- **[HIGH]** tested locally plus segment.c

**Other facts found along the way:**
- **Only one segment file is open at a time.** The segment fd is reused and closed before the next one opens (strace). **[HIGH]**
- **SIGINT:** ffmpeg exits with 255, but the last segment is still closed and listed. **[HIGH]** tested.
- **`%` in the output path:** a `%` anywhere in the folder path breaks the segment template ("Invalid segment filename template"). Set the ffmpeg working directory to the session folder and pass a relative `seg_%08d.ts`. **[HIGH]** tested.

## 2. Container choice (mpegts vs. matroska vs. fragmented MP4)

All tests: 60 s, 720p60, AAC, x264 `veryfast` (B-frames on), saving the newest 15 of 30 segments.

| Container | Saving with `-c copy` | After a hard kill (truncated last segment) | H.264 | HEVC | AV1 |
|---|---|---|---|---|---|
| **mpegts** | **Perfect via byte concat (`concatf:`)**: 30.000 s, no gaps, 0 decode errors, with or without B-frames. Concat demuxer has problems (§3). | Usable. Cut at a 256 KiB boundary, readable up to the cut; 1 decode error on the partial last frame. Joining it with the others works. | yes | yes | **no** |
| matroska | Concat demuxer works **only with `duration` lines** and **only without B-frame reordering**. Without durations the output is broken (632 s / 352 s, see §3). | Usable. "File ended prematurely"; the demuxer drops the incomplete block; joining works with 0 decode errors. | ok only with `-bf 0` | ok only with `-bf 0` | **yes (perfect)** |
| fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`) | Video OK with durations, but **audio has 12–17 ms holes at joins** (H.264 and AV1). | **Worst.** "partial file", Invalid NAL size, 7 decode errors; joining gives Non-monotonic DTS plus `h264_mp4toannexb` errors. | poor | – | poor |

**AV1 in MPEG-TS** is not supported in 6.1, 7.1, 8.0, or current master.
- Tested 6.1.1: ffmpeg warns "Stream 0, codec av1, is muxed as a private data stream and may not be recognized upon reading", and ffprobe then reports `bin_data`, which cannot be decoded.
- In master `mpegtsenc.c`, AV1 has no case in `get_dvb_stream_type` or `get_m2ts_stream_type`, so it falls through to `STREAM_TYPE_PRIVATE_DATA`. There is no `AV01` registration descriptor.
- The Changelog has no "AV1 in MPEG-TS" entry up to 8.1.
- **[HIGH]** https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavformat/mpegtsenc.c and https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/Changelog

**Recommendation [HIGH]:**
- **H.264 and HEVC:** `mpegts` with `mpegts_flags=+initial_discontinuity`, saved with `concatf:`.
- **AV1:** `matroska`, saved with the concat demuxer plus `duration` lines from the CSV.
- **Fragmented MP4:** do not use.

**HEVC open GOP.** libx265 uses open GOP by default. A clip then starts with 3 leading RASL frames (1803 frames instead of 1800). Decoding showed 0 errors, but closed GOP is preferred.
- NVENC sets `idrPeriod = gopLength` for H.264, HEVC and AV1, so every keyframe is an IDR (closed GOP).
- **[HIGH]** for NVENC: https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavcodec/nvenc.c
- **[LOW]** for AMF and QSV defaults; I did not verify them.

## 3. Saving: subset → MP4

Saving 15 of 30 segments with `-f concat -safe 0 -i list.txt -c copy -movflags +faststart` and **no** duration lines:

**mpegts + concat demuxer, B-frames on:**
- Duration was 30.33 s instead of 30.00 s.
- Every join had a 20–40 ms hole in both audio and video.
- Cause: the concat demuxer places each file using that file's *probed* duration, and the last AAC packet overshoots the keyframe.
- The audio holes are dangerous. Players that play audio sample-by-sample would drift by about 21 ms per join, which is about 19 s per hour.
- Adding `duration` lines from the CSV reduced this, but 3 joins still had gaps and the decode showed 4 "non monotonically increasing dts" errors.
- Cause: with B-frames, AAC packets whose pts is earlier than the keyframe pts go into the new segment, so the file's start time no longer matches the CSV start.
- **[HIGH]** tested.

**mkv + concat demuxer without durations:**
- **Broken:** H.264 came out 632 s long and AV1 352 s, with 14 gaps of 30–40 s each and 40 decode errors.
- Cause: with `reset_timestamps 0`, each mkv stores its absolute end time as its Duration.
- **`duration` lines are mandatory for mkv.** **[HIGH]** tested.

**With `-bf 0`:**
- The concat demuxer is perfect for both ts and mkv, with or without durations: 30.000 s, no gaps, 0 errors.
- AV1 in mkv with durations is also perfect (AV1 has pts == dts).
- **[HIGH]** tested.

**mpegts byte concat (`concat:` or `concatf:`):**
- Perfect for H.264 with B-frames, and for HEVC with B-frames: 30.000 s, 1800 frames, no gaps, 0 decode errors.
- Without `+initial_discontinuity` you get one harmless "Packet corrupt" warning per join, because the continuity counter jumps; the data is intact and decodes with 0 errors. With the flag there are 0 warnings.
- **[HIGH]** tested.

**AAC conversion.** `aac_adtstoasc` is inserted automatically for MP4: the output tag is `mp4a`, there are no warnings, and decoding is clean. **[HIGH]** tested.

**Start time.** The output starts at 0. Video may start 16–26 ms after audio, which is normal. **[HIGH]** tested.

**HEVC tag.** Copying HEVC into MP4 gives the `hev1` tag. Add `-tag:v hvc1` so Apple and Windows players accept it (tested: works, 0 errors). **[HIGH]** tested for the tag; **[MEDIUM]** for player behaviour, which is general knowledge.

## 4. Precision of "now − N"

With `-c copy`, cuts can only happen at keyframes.

- **Concat `inpoint` at a non-keyframe (AV1/mkv, keyframe + 0.5 s):** the output was *identical* to cutting at the keyframe (1740 frames, starts at the keyframe). The packets from the keyframe onward are kept and the CLI shifts them to 0. No gain in precision. **[HIGH]** tested. The docs agree: "inpoint … works best with intra frame codecs".
- **Input `-ss 1.5` (not a keyframe) on a `concatf:` input:** worse. Video before 1.5 s is dropped until the *next* keyframe, so the clip starts with 0.5 s of audio and no video (video start_time 0.526). **[HIGH]** tested.
- **`-ss 1.0` exactly on a keyframe:** works, but the audio gets 0.23 s of pre-roll with negative timestamps (an edit list). **[HIGH]** tested.

**Recommendation:**
- Cut only at segment boundaries; never use `-ss` or `inpoint`.
- Set the keyframe interval to 1 s (`-g <fps>`) and `-segment_time 2`. A clip is then N to N+2 s long.
- If you want 1 s granularity, use `-segment_time 1`. That is 3600 files per hour, which is fine (see §7).

## 5. Graceful stop and hard kill

**'q' on stdin** (tested for ts, mkv and fmp4): ffmpeg exits with 0, and the last segment is complete, listed (e.g. `seg_00000003.ts,6.033333,7.483333`) and decodes with 0 errors. **[HIGH]** tested.

**SIGKILL:** exit 137, and the last segment is **not** listed.
- File sizes are multiples of 256 KiB, because data still in ffmpeg's I/O buffer is lost.
- ts: readable, 1 decode error on the last frame.
- mkv: readable, clean.
- fmp4: corrupt.

**The app should only ever use segments that are listed in the CSV.** That rule also makes a hard kill harmless whatever the container. **[HIGH]** tested.

## 6. Deleting old segments while ffmpeg writes

**Linux:** deleting closed segments and saving at the same time while ffmpeg writes has no effect on ffmpeg (tested).

**Windows (from source; not tested on Windows):**
- Every ffmpeg file open goes through `avpriv_open`, which calls `_wsopen(filename_w, oflag, SH_DENYNO, pmode)`.
- In the UCRT, `_SH_DENYNO` becomes `FILE_SHARE_READ | FILE_SHARE_WRITE`, **without** `FILE_SHARE_DELETE`.
- **What that means for the app:**
  - **Reading:** it can read `list.csv` and segments that are still open, but must open them with `FileShare.ReadWrite`.
  - **Deleting the segment ffmpeg is writing:** fails with a sharing violation. This is a built-in safety net.
  - **Deleting closed segments:** safe, because ffmpeg keeps only the current segment open.
  - **Deleting segments a save is reading:** fails with IOException, because the save's ffmpeg also opens them without delete sharing. Pin segments during a save and retry the delete later.
- **[MEDIUM-HIGH]**
  - https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavutil/file_open.c, which quotes `fd = _wsopen(filename_w, oflag, SH_DENYNO, pmode);`
  - https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavformat/file.c
  - For the UCRT mapping, from search results: https://doxygen.reactos.org/d2/dce/open_8cpp_source.html and https://gist.github.com/hkuno9000/ac9ef084c8431ea148a5

## 7. Long saves (~1800 segments)

I tested **1800 real segments** (1 h, 160x90, `-bf 0`) locally. All three methods produced exactly 3600.000 s, with 108000 frames and 0 gaps:

| Method | Wall time | Peak memory |
|---|---|---|
| ts + `concatf:` | 6.4 s | 75 MB |
| ts + concat demuxer (with durations) | 11.4 s | 139 MB |
| mkv + concat demuxer (with durations) | 8.3 s | 80 MB |

- The cost depends on the number of packets (about 25–45k packets/s on this machine), not the number of files. **[HIGH]** tested.
- A real 1 h save at 120 fps is about 600k packets, plus whatever time the disk needs to read and write the full size (§9).
- **The `concat:` protocol** puts every path on the command line. 1800 absolute paths is more than Windows' 32,767-character limit, so use `concatf:` with a list file (available since FFmpeg 5.0; no limit on entries). **[HIGH]** concat.c source.

**`concatf:` list format** (tested):
- Entries are opened as written, relative to ffmpeg's **working directory**, not the list file's folder.
- Each line goes through `av_get_token`, so an unquoted backslash path fails. Wrap each path in `'…'`, and write an apostrophe inside a path as `'\''`.
- CRLF line endings are fine.
- **A UTF-8 BOM breaks it.**

**`+faststart`** rewrites the whole output a second time: strace showed about 2× the write calls and extra reads. Disk space needed is only the file plus its index; the cost is time. Skip it for long clips (more than about 10 min).

## 8. Changing settings mid-session

I tested joining a 720p segment with a 1080p one, and an H.264 segment with an HEVC one, using both methods:
- **ffmpeg returns 0 every time** and writes a broken file.
- **Resolution change:** the header says 1280x720 but the file contains 1080p frames.
- **Codec change:** 351–714 decode errors.

So ffmpeg will not catch this. **The app must start a new session folder whenever anything changes** (codec, encoder, resolution, fps, audio format), and also whenever ffmpeg restarts: timestamps restart at 0 and numbering would overwrite `seg_00000000`. **[HIGH]** tested.

## 9. Disk usage

GB per hour = Mbit/s × 0.45. MPEG-TS adds about 2–4% (measured: ts 63.4 MB vs. mkv 61.4 MB for the same 8 Mbit/s content). AAC at 160 kbit/s adds about 0.07 GB/h.

| Video bitrate | Write rate | 60 min buffer | Per 2 s segment |
|---|---|---|---|
| 20 Mbit/s | 2.5 MB/s | 9.0 GB (8.4 GiB) | 5 MB |
| 40 Mbit/s | 5 MB/s | 18 GB (16.8 GiB) | 10 MB |
| 80 Mbit/s | 10 MB/s | 36 GB (33.5 GiB) | 20 MB |
| 150 Mbit/s | 18.75 MB/s | 67.5 GB (62.9 GiB) | 37.5 MB |
| 250 Mbit/s | 31.25 MB/s | 112.5 GB (104.8 GiB) | 62.5 MB |

Saving 60 minutes needs that much free space again for the MP4.

---

## Recommended exact command lines / code

**Encoder requirements (input side):**
- Keyframe every 1 s: `-g <fps>`. **Do not** use NVENC intra-refresh: it sets an infinite GOP, so no segment would ever close.
- **Do not** use `-force_key_frames` unless you also pass `-forced-idr 1`. Without it NVENC produces I-frames that are not marked as keyframes, so segments never split (nvenc.c: only `NV_ENC_PIC_TYPE_IDR` sets `AV_PKT_FLAG_KEY`).
- B-frames are fine for H.264/HEVC in TS. AV1 needs nothing special.

**Live segmenting, H.264/HEVC** (ffmpeg `WorkingDirectory` = session folder):
```
-f segment -segment_time 2 -segment_time_delta 0.05 -reset_timestamps 0
-segment_format mpegts -segment_format_options mpegts_flags=+initial_discontinuity
-segment_list list.csv -segment_list_type csv seg_%08d.ts
```

**Live segmenting, AV1:**
```
-f segment -segment_time 2 -segment_time_delta 0.05 -reset_timestamps 0
-segment_format matroska -segment_list list.csv -segment_list_type csv seg_%08d.mkv
```
`segment_time_delta` is taken from the docs and was not tested; it is optional. Never use `-segment_list_size` or `-segment_wrap`.

**Save, H.264/HEVC** (WorkingDirectory = session folder):
```
ffmpeg -hide_banner -nostats -loglevel warning -y -i concatf:save_<id>.txt -map 0 -c copy [-tag:v hvc1] -movflags +faststart -f mp4 "<out>.mp4.part"
```
`save_<id>.txt` holds one entry per line, like `'seg_00001234.ts'`. On exit code 0, rename the file to `.mp4`. Add `-progress pipe:1` if you want a progress bar.

**Save, AV1:**
```
ffmpeg -hide_banner -nostats -loglevel warning -y -f concat -safe 0 -i save_<id>.ffconcat -map 0 -c copy -movflags +faststart -f mp4 "<out>.mp4.part"
```
with this list format:
```
ffconcat version 1.0
file 'seg_00001234.mkv'
duration 2.000000
```
Each duration is the next segment's CSV start minus this one's; for the last segment, its own end minus start. Relative names resolve against the list file's folder.

**Record, H.264/HEVC (recommended: no long wait when you press stop):**
```
ffmpeg -hide_banner -nostats -loglevel warning -y -f mpegts -i pipe:0 -map 0 -c copy [-tag:v hvc1] -f mp4 "<out>.mp4.part"
```
- As each segment from the record start onward closes, write its bytes into stdin. At stop, wait for the segment that was open to close, feed it, close stdin, wait for exit 0, then rename.
- Tested: 60 s, no gaps, 0 errors.
- Once a segment has been fed, normal buffer cleanup may delete it.
- **Alternative**, and the only option for AV1: use the Save command over the pinned range when recording stops.

**C# core:**
```csharp
using System.Globalization; using System.Text;
record Seg(string Name, double Start, double End);
static readonly UTF8Encoding Utf8NoBom = new(false);
static string Q(string s) => "'" + s.Replace("'", "'\\''") + "'";

// Tail list.csv (append mode). Keep _pos and _partial between polls.
long _pos; string _partial = "";
IEnumerable<Seg> PollList(string path) {
    using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
    fs.Seek(_pos, SeekOrigin.Begin);
    var buf = new byte[fs.Length - _pos]; int n = fs.Read(buf, 0, buf.Length); _pos += n;
    var text = _partial + Encoding.UTF8.GetString(buf, 0, n);
    int nl = text.LastIndexOf('\n'); if (nl < 0) { _partial = text; yield break; }
    _partial = text[(nl + 1)..];
    foreach (var line in text[..nl].Split('\n')) {
        var p = line.TrimEnd('\r').Split(',');            // our names contain no commas
        if (p.Length == 3 &&
            double.TryParse(p[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var s) &&
            double.TryParse(p[2], NumberStyles.Float, CultureInfo.InvariantCulture, out var e))
            yield return new Seg(p[0], s, e);
    }
}
// Save last N: at click, wait for the NEXT new CSV line (the segment in progress closes, at most ~2 s).
// Then pick from the newest segment backwards (closed, contiguous):
List<Seg> Pick(List<Seg> all, double n) {
    double from = all[^1].End - n; int k = all.Count - 1;
    while (k > 0 && all[k].Start > from) k--;
    return all.GetRange(k, all.Count - k);
}
void WriteConcatf(string path, List<Seg> segs) =>
    File.WriteAllText(path, string.Join("\n", segs.Select(s => Q(s.Name))) + "\n", Utf8NoBom);
void WriteFfconcat(string path, List<Seg> segs) {
    var sb = new StringBuilder("ffconcat version 1.0\n");
    for (int i = 0; i < segs.Count; i++) {
        double d = (i + 1 < segs.Count ? segs[i + 1].Start : segs[i].End) - segs[i].Start;
        sb.Append("file ").Append(Q(segs[i].Name)).Append('\n')
          .Append("duration ").Append(d.ToString("0.000000", CultureInfo.InvariantCulture)).Append('\n');
    }
    File.WriteAllText(path, sb.ToString(), Utf8NoBom);
}
// Cleanup every few seconds: delete if End < newestEnd - bufferSec - 2 and the segment is not pinned.
// Wrap File.Delete in try/catch (IOException / UnauthorizedAccessException): a busy file means retry later.
```
Also check that the selected segments are contiguous (index numbers consecutive) and that every file exists.

## Risks the design must handle

1. **No segments ever close.** This happens if the encoder never outputs a packet marked as a keyframe (NVENC intra-refresh, or `-force_key_frames` without `-forced-idr 1`, or an AMF/QSV setting I did not verify). Add a watchdog: if no CSV line appears within 3× `segment_time`, report an error and restart.
2. **Mixing sessions.** ffmpeg silently writes broken files (§8). Use one folder per ffmpeg process.
3. **Concat demuxer timestamp traps.** It needs per-file durations, and B-frames cause gaps and non-monotonic DTS. Use it only for AV1/mkv, where pts == dts. If you ever put H.264/HEVC in mkv, force `-bf 0`.
4. **AV1 cannot go in TS** on any FFmpeg version, so AV1 must use matroska. Matroska timestamps have 1 ms precision, which adds ±0.5 ms jitter at 120 fps; this is harmless.
5. **Locale.** The CSV and ffconcat files use `.` as the decimal point. Always parse and format with `InvariantCulture`; a German or French Windows would otherwise misread the numbers.
6. **Paths:**
   - A `%` in the folder path breaks the segment template. Fix: set WorkingDirectory and use relative names.
   - Lists must be UTF-8 **without BOM** and every path single-quoted.
   - Do not use `concat:` with many files (command-line length limit).
7. **Windows file locks:**
   - Deleting segments that are open or being read by a save fails. Pin them and retry.
   - Never use `-segment_list_size`: its rename-over fails while the app holds `list.csv`.
   - Antivirus or the search indexer can briefly lock new files, so retry.
8. **Waiting before a save.** "Save" must wait up to about one segment for the current segment to close. Never read the segment still being written: ffmpeg flushes it in 256 KiB chunks, so its tail would be cut off.
9. **After a crash or hard kill,** the last segment is unlisted and truncated. On startup, recover from listed segments only, or delete old session folders.
10. **Disk:**
    - Check free space for buffer + clip before starting.
    - `+faststart` doubles the write time of long clips.
    - Saving and live capture on the same slow disk compete; run save processes at BelowNormal priority and prefer an SSD.
    - At 250 Mbit/s the app writes about 112 GB per hour, which wears SSDs; warn the user.
11. **HEVC in MP4** needs `-tag:v hvc1`. Prefer closed GOP; open GOP adds undecodable leading frames at the start of a clip.
12. **Stopping:** stop ffmpeg with `q` on stdin. Keep stdin as a pipe, so audio cannot use stdin, which matches the named-pipe plan. Expect exit code 0. Killing the process loses up to about 256 KiB plus encoder delay.
13. **FFmpeg 7.1/8.0 differences.** Changes since 6.1 to `segment.c` (path length, program relay) and `concatdec.c` (overflow checks, a chapter option) do not change this behaviour. **[MEDIUM]**: I read commit titles only.
    - https://github.com/FFmpeg/FFmpeg/commits/master/libavformat/segment.c
    - https://github.com/FFmpeg/FFmpeg/commits/master/libavformat/concatdec.c