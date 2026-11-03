# PC Clipper — implementation spec

PC Clipper is a Windows 10/11 app that works like the PlayStation "save recent gameplay" button.
Turn it on and it keeps the last N minutes (up to 60) of your screen + sound on disk. Press a button or hotkey
to save the last 15 s / 30 s / 1 min / 5 min / 15 min / 30 min / 1 hour as an MP4. It can also do normal
start/stop recording and screenshots. Quality goes up to 5K (5120x2880) at 120 fps when the PC can handle it.

Target user: a gamer, not technical. Everything must be one click, plain language, no jargon in the main
screen, and every failure must say what to do next.

## Repository layout

```
PCClipper/
  src/PcClipper.Core/      net8.0, platform-neutral engine (tested on Linux with real ffmpeg)
  src/PcClipper.App/       net8.0-windows WinForms app (code-only UI), win-x64 single-file exe
  tests/PcClipper.Harness/ Linux integration harness (console app) driving the real engine
  build.sh                 builds + tests on Linux and publishes the Windows exe
```

The public API in `src/PcClipper.Core` (Enums.cs, AppSettings.cs, Abstractions.cs, Models.cs, QualityMath.cs and the
signatures in Contracts.Stubs.cs) is the CONTRACT between Core and App. Do not change public signatures without
updating both sides. Implementers may ADD public members if needed.

## Build constraints (important)

- The build machine is Linux with the Ubuntu .NET 8 SDK (no WindowsDesktop MSBuild SDK). The App uses
  `<FrameworkReference Include="Microsoft.WindowsDesktop.App.WindowsForms" />` instead of `<UseWindowsForms>`.
  Consequences: NO designer files, NO .resx, NO `ApplicationConfiguration.Initialize()` (source generator absent) —
  call `Application.SetHighDpiMode(HighDpiMode.PerMonitorV2)`, `Application.EnableVisualStyles()`,
  `Application.SetCompatibleTextRenderingDefault(false)` manually. `System.Drawing` is available through the framework.
- Packages allowed in the App: NAudio.Wasapi 2.2.1, NAudio.Core 2.2.1. No others (keep the exe lean; COM/DXGI via raw P/Invoke).
- Core must not reference anything Windows-specific (it is compiled and tested on Linux).
- Publish: `dotnet publish src/PcClipper.App -c Release -o publish` produces `publish/PC Clipper.exe`.

---

## Core behaviour

### Ring buffer (SegmentStore + ffmpeg segment muxer)

- One capture session = one folder `<BufferRoot>/session_<yyyyMMdd_HHmmss>_<8 hex>`.
- ffmpeg writes ~2 s segments `seg_%08d<ext>` and appends each finished segment to a CSV list
  (`segments.csv`: `filename,start,end`). Only segments listed in the CSV are "completed"; the newest file on
  disk that is not listed yet is still being written and must never be read, pinned, or deleted.
- Janitor (every 2 s while running): `Refresh()`, then `DeleteExpired(bufferSeconds + 2*segmentSeconds)`.
  Pinned segments are never deleted. Deletion errors (file locked) are ignored and retried next tick.
- On app start and on every StartAsync: `CleanupStaleSessions` removes old `session_*` folders (only folders whose
  name matches that pattern, only inside BufferRoot).
- Changing capture settings starts a NEW session (segments with different codecs/sizes can't be stream-copied
  together), so the buffer starts empty again. The UI says so.

### Saving ("save last N")

1. Must be Running with at least one completed segment, else fail with "Nothing recorded yet — wait a few seconds."
2. Wait for the segment currently being written to complete (poll the list every 100 ms, up to SegmentSeconds+2 s),
   so the clip includes the moment the button was pressed.
3. `SelectLast(N)` → pin them → write a concat list file (`file '<abs path>'` lines; escape `'` as `'\''`;
   use forward slashes or the absolute Windows path, both work with `-safe 0`).
4. Run the concat command (stream copy, +faststart) to `<output>.part.mp4`, then rename to the final name.
   Serialise saves (one at a time) but never block capture.
5. Unpin. Return actual duration (sum of selected segment durations) and `ShorterThanRequested` when less was buffered.
6. Saves of up to 1 hour must finish in seconds (pure stream copy). Never re-encode.
7. **A length unlocks once that much is recorded (like PlayStation).** `Buffered` is exactly what a save of the whole
   buffer would select (same newest-first, never-across-a-gap walk as step 3, capped at the buffer length; the segment
   being written is not counted yet). The Home buttons and tray items for N are greyed out until `Buffered >= N - 0.05 s`
   (a thin bar on the button fills up towards it; the tooltip / menu text says "unlocks in 12 s"). `SaveLastAsync` takes
   a minimum and refuses (`NotEnoughRecorded`, nothing written) below it, and names the file only after picking the
   footage (`Func<TimeSpan, string>`). Buttons/tray: minimum = N (a click that raced a buffer restart is refused).
   Hotkey/controller: they can't be greyed out and refusing would make "save last 15 min" useless for the first quarter
   hour, so minimum = 15 s: they save everything recorded so far, and the toast and file name give the real length
   ("Clip … (last 7 min 12 sec).mp4", "Saved last 7:12 - all that was recorded so far (you asked for 15 min)").

### Manual recording

- `StartRecording()`: remembers `CurrentWritingIndex` and the wall time, and `PinFrom(thatIndex)` so nothing from the
  recording is deleted by the janitor, however long it runs.
- `StopRecordingAsync()`: wait for the current segment to complete (as in saving), `SelectFrom(startIndex)`, concat
  to MP4, then dispose the pin. Recording length is unlimited (disk permitting).
- Recording requires the buffer to be running; the App turns the buffer on automatically if needed.

### Engine lifecycle (ReplayEngine)

- `StartAsync(cfg)`:
  1. Create session dir + SegmentStore. Check free space on BufferRoot's drive ≥ estimated full-buffer size + 2 GB;
     otherwise throw with a message like "Not enough free space on D: (12 GB free, needs 19 GB). Lower the buffer
     length or quality, or pick another drive in Settings."
  2. If audio is enabled: create the PCM sink (`env.CreatePcmSink()`), start a task waiting for ffmpeg to connect.
  3. Start ffmpeg with `FfmpegCommandBuilder.BuildCaptureArgs(...)`: UseShellExecute=false, CreateNoWindow=true,
     RedirectStandardInput=true (for 'q'), RedirectStandardError=true (progress + errors), RedirectStandardOutput=false.
     Use `ArgumentList`. `env.ProcessGuard.Attach(process)` immediately after start.
  4. Read stderr asynchronously: keep the last 60 lines (for error messages and the log), parse progress lines
     (`frame=`, `fps=`, `drop=`, `dup=`, `speed=`) into stats. Log every non-progress line at Info.
  5. When the sink connects: create audio sources, Start() them, start the AudioMixerPump. (Video and audio timelines
     both start at ~the same moment — see the A/V sync section.)
  6. Running = the first completed segment appears in the list within 15 s. If ffmpeg exits or nothing appears in
     time: kill it, state Faulted, throw InvalidOperationException with a plain explanation + the last stderr lines.
- If ffmpeg exits unexpectedly while Running: state Faulted, raise `Problem` with a plain explanation (map known
  stderr patterns: "No NVENC capable devices", "OpenEncodeSessionEx failed", "out of memory", "Could not open
  duplication"/"DXGI_ERROR"/"access lost", "No space left", "Error opening output"). The App may auto-restart.
- `StopAsync()`: stop pump (close sink), write "q\n" to ffmpeg stdin, wait up to 5 s, then Kill(entireProcessTree).
  If a recording is in progress, finish it first (StopAsync must not lose a recording: the App calls
  StopRecordingAsync before StopAsync). Delete the session folder after any in-flight save finishes. State Off.
- `Buffered` = what a save of the whole buffer would select now (the same walk as Saving step 3: newest-first, never
  across a gap, also not between runs), capped at BufferSeconds; see Saving step 7.
- `GetStats()` from the parsed progress line + store.
- Every ffmpeg command line is logged (Info) exactly as passed.

### Audio (AudioRingBuffer, AudioMixerPump)

- Format everywhere: 48 kHz, stereo, 32-bit float interleaved (`f32le`).
- Each IAudioSource owns an AudioRingBuffer (capacity 2 s). Capture callbacks write converted samples into it.
- The pump runs on a dedicated thread (ThreadPriority.Highest). Every ~10 ms it computes
  `target = round(elapsedWallSeconds * 48000)` frames since Start(), and emits `target - FramesWritten` frames:
  for each source read what is available up to the needed count, zero-fill the rest (underrun = silence), multiply by
  the source Volume, sum, clamp to [-1, 1], write to the sink. This makes audio duration == wall-clock duration, so it
  can't drift against video over an hour.
- Drift/latency control: if a source holds more than 100 ms beyond what this tick needs, Trim it to ~40 ms (drop oldest).
- If the sink throws (ffmpeg gone), raise Faulted once and stop the thread.

### A/V sync (implemented in Core; measured on Linux: offset stable, no drift)

- ffmpeg opens the audio pipe with `-nofind_stream_info`; the pump writes a 0.25 s silent lead-in as soon as the pipe
  connects (keeps audio "ahead" in ffmpeg's scheduler so the video pull is never throttled); ffmpeg removes it again
  with `-af atrim=start_sample=12000` + `-bsf:a setts=ts=TS-0.25/TB`.
- The video graph contains `setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'`, which prints the wall-clock time
  of video pts 0. The engine converts it to Stopwatch time and starts the audio clock at V0 + 45 ms (capture latency:
  DriftFifo fill ~38 ms + packet age) − the user's AudioSyncOffsetMs. Harness: offset constant across the clip
  (spread < 2 ms), about −12 ms with simulated 7 ms packet age; WASAPI packets are older, so Windows should land near 0.
- Each audio source owns a `DriftFifo` (resampler ratio controller): device clocks that run ±2000 ppm off are absorbed
  without drift, underruns become silence. Platform sources derive from `BufferedAudioSource` and call `Push()`.
- The PCM sink (`QueuedPcmSink`) never blocks the mixer: 60 s queue, writer thread.

### Probing

- `ProbeAsync`: `ffmpeg -hide_banner -version` (first line), `-filters` (look for `ddagrab`, `gfxcapture`,
  `scale_d3d11`, `scale_cuda`, `hwmap`...), `-encoders`. For each hardware encoder present in the build
  (h264/hevc/av1 × nvenc/amf/qsv) run `BuildEncoderTestArgs` (timeout 10 s each, run them sequentially) and add the
  ones that exit 0 to WorkingEncoders. CPU encoders (libx264/libx265/libsvtav1) count as working if compiled in.
- `BenchmarkAsync`: run the real capture pipeline into `-f null` for N seconds, parse the last progress line; Ok when
  achieved fps ≥ 95% of the target and speed ≥ 0.97. Message in plain language, e.g. "Your PC handled 2560x1440 at
  120 fps with HEVC (NVIDIA): 119.6 fps, no dropped frames." or "Too heavy: only 71 fps of 120. Try 1440p or 60 fps."

---

## App behaviour (Windows)

### Startup (Program.cs)
- Single instance: named Mutex `Local\PCClipper.SingleInstance`. A second launch signals the first (named
  EventWaitHandle `Local\PCClipper.Show`) to show its window, then exits.
- Global exception handlers (Application.ThreadException, AppDomain.UnhandledException, TaskScheduler.UnobservedTaskException)
  → log + friendly MessageBox; never a silent crash.
- Log file: `%LOCALAPPDATA%\PCClipper\logs\pcclipper.log`, append, roll over to `.1` at 5 MB. Log startup info
  (version, OS, monitors, GPU names, ffmpeg path+version, working encoders, settings JSON).
- `--minimized` argument (used by "Start with Windows") starts hidden in the tray.

### FFmpeg acquisition
- Locate in order: settings.FfmpegPath, `<exe dir>\ffmpeg.exe`, `<exe dir>\ffmpeg\bin\ffmpeg.exe`,
  `%LOCALAPPDATA%\PCClipper\ffmpeg\bin\ffmpeg.exe`, PATH.
- If missing (or it lacks ddagrab): a friendly dialog: "PC Clipper uses FFmpeg, a free video engine (about 100 MB),
  to talk to your graphics card. Download it now?" [Download] [I have it — browse...] [Cancel].
  Download with HttpClient + progress bar to a temp file, verify the SHA-256 (see "Downloads" below), extract only the
  `*/bin/ffmpeg.exe` entry (ZipArchive) into `%LOCALAPPDATA%\PCClipper\ffmpeg\bin\`, verify it runs and
  `FfmpegCapabilities.IsSupported`. Primary then fallback URL.
  Cancel-able. Errors in plain language with the "browse" option.

### Main window (code-only WinForms, dark theme)
Size ~ 820×700 (Home fits without scrolling at 100%; shrunk to the screen's working area if smaller), resizable
(min 760×560), DPI-aware, icon from embedded resource `pcclipper.ico`.
Theme: background #0F1115, cards #181B22, borders #262A33, text #E8EAF0, secondary #9AA3B2, accent #4F7CFF,
record red #FF4D5A, success green #3DD68C, warning amber #F5B83D. Font: Segoe UI 10pt (titles 16-20pt semibold).
Flat buttons (FlatStyle.Flat, no border or 1px border, hover colour change, hand cursor), rounded look optional.
Dark title bar via DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE = 20) (ignore failure).

Top bar: app name "PC Clipper", status pill on the right ("● REPLAY ON" green / "○ REPLAY OFF" grey /
"● RECORDING 03:21" red / "⚠ PROBLEM" amber), and two nav buttons: "Home" and "Settings".

HOME page:
1. Replay card: big title "Replay buffer", a line like "On — 12:34 saved of 60:00 · HEVC (NVIDIA) 2560x1440 60 fps" or
   "Off — turn it on to start keeping your last 60 minutes", and a large toggle button "Turn ON" / "Turn OFF".
   While Starting: "Starting…" and the button disabled.
2. "Save the last…" card: 7 big buttons in a row/grid: 15 sec, 30 sec, 1 min, 5 min, 15 min, 30 min, 1 hour.
   Disabled while the buffer is off. Lengths longer than the buffer length setting are disabled with a tooltip
   ("Your buffer keeps 30 min. Increase it in Settings."). Lengths not recorded yet are greyed out until they are
   (see Saving, step 7). While a save runs, show "Saving…" on that button and keep
   the others usable (saves queue). After save: toast + the clip appears in Recent.
3. Action row: [● Record] (becomes "■ Stop 03:21" in red while recording), [Screenshot], [Open clips folder].
4. Recent card: the last 8 clips/screenshots saved this run (and existing files found in the clips folder on start,
   newest first): name, length/size, and an "Open" link + "Show in folder" link. Double-click opens.
5. Footer hint: "Hotkeys: Alt+F10 save last 15 min · Alt+F9 record · Alt+F8 screenshot" (reflect actual bindings).
   While a controller is connected, a second line lists its shortcuts in its own button names ("PS5 controller:
   Create/Share + Cross save last 15 min · ..."; one line per family when Xbox and PlayStation pads are both connected).

SETTINGS page (scrollable, grouped cards, "Save" + "Cancel" buttons at bottom; Save applies immediately; if the buffer is
running and `CaptureDiffers`, ask "Applying these settings restarts the replay buffer (the current buffer is cleared). Continue?"):
- Video: Monitor (dropdown of MonitorInfo), Resolution (Native/720p/1080p/1440p/4K/5K), Frame rate (30/60/120),
  Quality (Low/Medium/High/Ultra/Custom + Mbps box when Custom), Encoder (Auto/NVIDIA/AMD/Intel/CPU), Codec
  (Auto/H.264/HEVC/AV1), "Show mouse cursor" checkbox. Live line under it: "≈ 39 Mbps · a 60-minute buffer uses
  about 17.6 GB" + warnings from `QualityMath.Warnings` in amber. "Capture method" dropdown (Auto / Desktop
  Duplication / Windows Graphics Capture). Button "Test my PC" → pause the buffer if running (ask), show
  `TestCard.Show(monitorBounds)` (animated window so the capture has new frames), run BenchmarkAsync(cfg, 6) (two ~6 s passes, ~15-20 s in all) with the
  pending settings, dispose the card, show the message (green/amber) incl. UniqueFps, restart the buffer if it was on.
- Replay: Buffer length (1–60 min, NumericUpDown or slider with label), Hotkey saves (dropdown of the 7 lengths),
  Buffer folder (path + Browse… + free space "D: 210 GB free"), note "Tip: put the buffer on a big HDD to spare your SSD."
- Saving: Clips folder, Screenshots folder (path + Browse…).
- Audio: "Record game/PC sound" checkbox + volume slider (0–200%); "Record microphone" checkbox + device dropdown
  (active capture devices via NAudio MMDeviceEnumerator, "Default microphone" first = the Windows default recording
  device, Role.Console) + volume slider.
- Hotkeys: four capture boxes (Save replay / Start-stop recording / Screenshot / Turn replay on-off). Defaults
  Ctrl+Alt+F9 / F10 / F11 / F8 (avoid NVIDIA Alt+F-keys, AMD Ctrl+Shift+letters, Game Bar, Steam F12, and AltGr). Click the box, press a combination
  (must include Ctrl, Alt, Shift or Win unless it is F13–F24); Esc cancels; Backspace clears. Show a red message if
  RegisterHotKey fails: "Alt+F10 is already used by another app (NVIDIA overlay?). Pick another."
- Controller (after Hotkeys): see "Controller shortcuts" below.
- General: Start with Windows (HKCU Run key with `"<exe>" --minimized`), Turn replay on when PC Clipper starts,
  Closing the window keeps PC Clipper running in the tray, Show on-screen notifications, Play sounds.
- Engine: FFmpeg path + version + working encoders list; buttons "Download FFmpeg" / "Browse…"; "Open log folder".

### Tray icon (NotifyIcon)
Always visible while running. Double-click shows the window. Menu: Turn replay on/off · Save the last ▸ (7 lengths; a
length not recorded yet is greyed out: "15 min  (unlocks in about 14 min)") ·
Start/Stop recording · Take screenshot · Open clips folder · Show PC Clipper · Exit. Tooltip shows state ("PC Clipper —
replay on, 12:34 buffered"; max 63 chars). Icon gets a small red dot overlay while recording (draw at runtime).

### Hotkeys
RegisterHotKey on a hidden message-only NativeWindow (HWND_MESSAGE parent) owned by the UI thread; MOD_NOREPEAT.
Re-register when settings change; report failures per hotkey (error 1409 = taken by another app). Save hotkey saves
`HotkeySaveSeconds`. NEVER activate/show a normal window from a hotkey (it would steal focus and can minimize an
exclusive-fullscreen game): only start work and show the non-activating toast. A game that registers raw input with
RIDEV_NOHOTKEYS disables all app hotkeys while focused (documented; nothing we can do — mention in README).

### Controller shortcuts
- `ControllerManager` (Platform) reads Xbox/XInput pads and PlayStation DualShock 4 / DualSense / DualSense Edge (USB and
  Bluetooth HID) on its own polling thread; Core's `ChordDetector` turns button states into `PadAction`s (a chord fires
  once when its Press button goes down while its Hold buttons are down; 800 ms repeat guard per action).
- Settings: `ControllerShortcuts` (default on), `PadSaveReplay` / `PadRecord` / `PadScreenshot` / `PadToggleReplay`
  (defaults: hold View = Create/Share + A/Cross, X/Square, Y/Triangle; toggle replay off), `ControllerVibrate` (default on).
- AppController (UI/AppController.Controller.cs) creates and starts the manager at start-up when the setting is on (a
  failure is logged and only disables controllers), starts/stops it when the setting is changed, and re-applies the
  bindings whenever settings are saved. The detector runs on the polling thread (under a lock); triggered actions are
  posted to the UI thread and run exactly like the keyboard hotkeys (same handlers and feedback, never a window shown
  or activated). When the action worked (clip/screenshot saved, recording started or stopped and saved, replay on/off)
  and `ControllerVibrate` is on, the pad rumbles for 150 ms (Xbox only: PlayStation pads are never written to).
- Recognition: on Connected, one toast per controller per session, short enough for the one-line toast: "PS5 controller
  connected - Create/Share + Cross saves the last 15 min" (the first assigned shortcut in that controller's naming; the
  save length is `HotkeySaveSeconds`). Connects and disconnects are logged; disconnects are otherwise quiet.
- Settings → Controller: "Use controller shortcuts (Xbox and PlayStation)"; a live list of connected controllers ("DualSense
  Wireless Controller - Bluetooth", or "No controller found - plug one in or connect it by Bluetooth"); four drop-downs
  (Off first, then `PadChord.Presets`, labelled with `PadLabels.DescribeBoth`; a saved chord that isn't a preset is added as
  its own item), disabled while the shortcuts are off; a tester line "Press buttons to test: Create/Share + Cross" in the
  pressing controller's naming (the combo stays shown after release; green with "→ <action>" when it matches a drop-down),
  updated from ButtonsChanged at most ~20 times a second and only while the page is shown; "Vibrate when a controller
  shortcut works (Xbox)"; and the hint that games may use the same buttons and that pads used through Steam or DS4Windows
  may appear as Xbox controllers. Save is blocked (red message) when two actions share one chord.

### Feedback
- On-screen toast: small non-activating topmost window (WS_EX_TOPMOST|WS_EX_NOACTIVATE|WS_EX_TOOLWINDOW|
  WS_EX_TRANSPARENT|WS_EX_LAYERED; ShowWithoutActivation=true; SWP_NOACTIVATE) at the top-right of the captured
  monitor for 2.5 s: "✓ Saved last 15:00", "● Recording started", "■ Recording saved (12:03)", "📷 Screenshot saved",
  or amber "⚠ …" for problems. It must NEVER take focus from the game. Make sure it is not captured into the
  clip if possible: SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE = 0x11) (Win10 2004+; ignore failure).
- Sounds (off by default — desktop audio capture records them into later clips; say so next to the checkbox):
  short generated tones (in-memory WAV via SoundPlayer): save = two rising beeps, record start =
  one high beep, record stop = one low beep, screenshot = one short click, error = low double beep.
- If the main window is visible, also update it.

### Engine supervision
- The engine keeps the buffer across restarts: `StartAsync(cfg, keepBuffer: true)` after a fault continues the same
  buffer (saves join the runs). `keepBuffer: false` (or StopAsync then StartAsync) clears it.
- If the engine faults while the user wanted it on and `engine.LastFaultRetryable`: show a quiet status ("Capture
  interrupted — resuming…"), restart with backoff 1 s, 2 s, 4 s … max 30 s (reset the backoff when a run lasted ≥ 20 s,
  see `engine.CurrentRunUptime`), indefinitely while the user wants it on. UAC prompts / fullscreen switches cause these.
  The capture method is never switched automatically (Auto = Desktop Duplication; Windows Graphics Capture would pause on
  still screens and draw a yellow border on Windows 10). A resume passes `keepBuffer: true`; the engine keeps the
  buffer's output format when the display mode changed, so earlier footage stays joinable.
- Not retryable (disk full, encoder can't handle settings, FFmpeg too old...): stop, show the message with what to do.
- The engine's own disk guard stops capture below 2 GB free (non-retryable fault).
- `EngineEnvironment.RecordingPathFactory` must be set (Recording name): the engine auto-saves a running recording when
  the buffer is turned off or restarted with different settings, raising `RecordingAutoSaved` → toast "Recording saved".
- User "Turn ON" after "Turn OFF" = fresh buffer. Applying changed capture settings = StopAsync + StartAsync (fresh).
- Default output names: `Clip 2026-11-02 17-45-12 (last 15 min).mp4`, `Recording 2026-11-02 17-45-12.mp4`,
  `Screenshot 2026-11-02 17-45-12.png`. Create folders if missing. Never overwrite (append " (2)" etc.).
- On exit: if recording, stop and save it first, then wait - with no time limit - for every clip/recording being
  written (`ActiveOperations`, plus the App's own save tasks), showing "Saving your clip before closing…" (window notice,
  toast when hidden); choosing Exit again offers "Close anyway". Then StopAsync (30 s cap only once nothing is being
  written), dispose the tray icon. Turn OFF / applying capture settings / Test my PC also let in-flight saves finish.
- Windows session ending / shutdown: while a recording runs or anything is being written, answer WM_QUERYENDSESSION
  with "not yet" (the hidden main window always has a handle, and SystemEvents' handler sets `Cancel` too), show
  `ShutdownBlockReasonCreate` "Saving your recording…/clip…", wait for the saves like a normal exit, then
  `ShutdownBlockReasonDestroy` and exit so Windows continues. Otherwise: same as exit, best effort within a few seconds.
- A recording whose save failed stays pending in the engine: Home shows "A recording wasn't saved: <reason>" with
  [Try again] (`RetryPendingRecordingsAsync`, named after the recording's start time) and [Pick another folder]; Turn OFF
  and exit try once more first. The engine's "raw video was kept in <dir>" notice is shown with [Open folder].
- Buffer length changes are applied live (`SetBufferSeconds`, no restart, no confirmation); a free-space warning is
  shown if the longer buffer may not fit.

### Screenshot
`FfmpegProbe.ScreenshotAsync` (native resolution PNG of the selected monitor); fallback: GDI
`Graphics.CopyFromScreen` of that monitor's bounds. Works whether or not the buffer is on.

### Windows-specific implementations the App must provide
- `WasapiAudioSource : IAudioSource` (desktop loopback and microphone), converting device mix format → 48 kHz stereo
  float with NAudio's WdlResampler (NAudio.Dsp) when the rate differs; mono → duplicated, >2 channels → take FL/FR.
  Desktop loopback must follow the default render device (IMMNotificationClient → restart capture on change).
  Handle RecordingStopped with an exception (device unplugged) by retrying every 2 s; never crash.
- `NamedPipePcmSink : IPcmSink` — `\\.\pipe\pcclipper-audio-<pid>-<counter>`, NamedPipeServerStream(PipeDirection.Out,
  1 instance, Byte mode, Asynchronous, outBufferSize 1 MB).
- `JobObjectGuard : IProcessGuard` — kill-on-close job object; also disable power throttling for the child and set
  priority AboveNormal.
- `DxgiMonitors` — enumerate adapters/outputs with raw COM P/Invoke (CreateDXGIFactory1, EnumAdapters1, EnumOutputs,
  GetDesc) to produce MonitorInfo (adapter index, output index, device name, size from DesktopCoordinates, vendor id,
  adapter name); refresh rate from EnumDisplaySettings; friendly name from `Screen`/EnumDisplayDevices; fallback to
  `Screen.AllScreens` (output index = order) if DXGI fails.
- `FfmpegDownloader`, `HotkeyManager`, `TrayController`, `OverlayToast`, `Sounds`, `StartupRegistration`, `FileLog : ILog`.

## FFmpeg command lines (research-verified; built in Core/FfmpegCommandBuilder.cs)

Requires FFmpeg 8.1+ features: ddagrab + scale_d3d11 (`FfmpegCapabilities.IsSupported`), gfxcapture for Windows Graphics
Capture, AMF accepting D3D11 BGRA. Older builds: tell the user to download the recommended build.

Capture (WorkingDirectory = run folder; names relative because '%' in a path breaks the segment template):
```
-hide_banner -nostats -loglevel level+info -progress pipe:1 -stats_period 1
-init_hw_device d3d11va=dda:{adapter} -filter_hw_device dda
[-nofind_stream_info -f f32le -ar 48000 -ac 2 -i \\.\pipe\pcclipper-audio-...]
-filter_complex "ddagrab=output_idx={O}:framerate=666:draw_mouse={0|1}:dup_frames=0,<anchor setpts>,
   select='isnan(prev_selected_t)+gt(round(t*F),round(prev_selected_t*F))',setpts='round(T*F)/(F*TB)',<conversion>,
   setpts=PTS:strip_fps=1[v]"
   (event-driven + one frame per slot: see Capture method below; WGC: gfxcapture=hmonitor={H}:
    max_framerate={ceil(max(F,refresh)*1.25)}:capture_cursor={0|1}:display_border=0:capture_border=0,<anchor>,<same>;
    classic timing (fallback): ddagrab=...:framerate={F}:dup_frames=1,<anchor>,fps={F},<conversion>, no strip/enc_time_base)
   conversion: NVENC/AMF native = none (they take D3D11 BGRA); scaled = scale_d3d11=width=W:height=H:format=nv12,setparams=...
               QSV = hwmap=derive_device=qsv,format=qsv,vpp_qsv=w=W:h=H:format=nv12:out_color_matrix=bt709:out_range=tv
               CPU = scale_d3d11=...:format=nv12,hwdownload,format=nv12,setparams=...
-map [v] [-map 0:a] -fps_mode passthrough -enc_time_base:v 1/{F}
   (NOT "-fps_mode cfr -r F": measured on the harness, the CLI's CFR shifts wall-clock-stamped video ~2 frames late
    because it only corrects drift beyond 1.1 frames; the fps filter rounds each frame to the nearest slot instead)
-c:v {enc} -b:v T -maxrate 1.5T -bufsize 2T -g {F} -bf 0 + per-encoder tuning (falls back to these basics only if the probe
   finds the tuned flags rejected) + -flags:v +global_header -bsf:v dump_extra=freq=keyframe (H.264/HEVC: headers on every IDR)
[-c:a aac -b:a 192k -af atrim=start_sample=12000 -bsf:a setts=ts=TS-0.25/TB]
-max_muxing_queue_size 4096
-f segment -segment_time 2 -reset_timestamps 0 -segment_format mpegts -segment_format_options mpegts_flags=+initial_discontinuity
   -segment_list segments.csv -segment_list_type csv seg_%08d.ts          (AV1: matroska, seg_%08d.mkv)
```
Save: H.264/HEVC → byte-join TS segments with `-i concatf:<list>` (gapless, exact timestamps); several runs → an ffconcat
file listing one `concatf:` URL per run (+ `-protocol_whitelist file,concatf,crypto,data`). AV1/MKV → concat demuxer with
`duration` lines. Then `-map 0 -c copy [-tag:v hvc1] [-movflags +faststart only ≤ 10 min] -f mp4 out.mp4.part`, rename.
Lists: UTF-8 without BOM, every path single-quoted, forward slashes.

Never: `-thread_queue_size` on inputs (removed in FFmpeg master), `-find_stream_info 0`, `-segment_list_size`, intra-refresh,
`-force_key_frames` without forced IDR. Stop: write `q` to stdin, close the audio pipe, wait 10 s, kill.

### Downloads (pinned, SHA-256 verified; first-run download by the app, never redistributed by us)
- Primary (static single exe, 109 MB zip; ffmpeg.exe at `ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe`):
  `https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip`
  SHA-256 `6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541`
- Fallback (BtbN static, 185 MB zip; `ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1/bin/ffmpeg.exe`):
  `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip`
  SHA-256 `401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f`
- NVENC in these builds needs NVIDIA driver ≥ 570.

### Capture method
- Desktop Duplication (ddagrab) is the default, **event-driven since 1.0.2** (`framerate=666:dup_frames=0`). Up to 1.0.1
  it ran `framerate=F:dup_frames=1`, which paces itself with av_usleep → winpthreads nanosleep → Sleep/WaitForSingleObject
  in whole ms with a GetTickCount64 deadline (checked in the gyan 8.1.1 and BtbN 8.1 binaries). ffmpeg.exe never calls
  timeBeginPeriod (only vsrc_amf does), and PC Clipper's own call doesn't reach a child process since Windows 10 2004, so
  grabs woke on the 15.625 ms tick: gaps of 15.6/31.25 ms, which fps=F turned into repeated + skipped frames (modelled:
  ~4 hitches/s at 60 fps on 60 Hz, ~33/s on 144 Hz; ~64 different frames/s at 120 fps). That is the likely cause of
  "the saved video lags" reports. At framerate=666 the slot clock (+≤2 slots of 1.5 ms per call) falls behind real time
  at once, so av_usleep is never reached; AcquireNextFrame waits (1 ms timeout, re-polled while dup_frames=0) and each
  presented picture is stamped with the QPC clock on arrival. 667+ would make the timeout 0 (busy poll). Above ~333 Hz
  of presents (or pointer updates, unmeasured) the sleep path can come back (not handled). Every present is copied
  (e.g. 144/s on a 144 Hz monitor).
- **One frame per slot, no repeats** (`SlotSelectFilter`/`SlotSnapFilter`): `select` keeps the first frame whose rounded
  1/F slot is new, `setpts` puts it exactly on its slot. Not fps=F: on a still screen nothing arrives, and fps=F then
  emitted the whole pause as repeats in one burst when the next picture came; while the encoder worked through them the
  capture wasn't read, so the first seconds after the pause came out frozen (review of the first 1.0.2 draft reproduced
  ~8 s of slideshow after a 20 s still). Now a slot without a new picture stays empty: the stream is variable-rate only
  where nothing changed, and a player keeps showing the last picture. Keyframes come once a second by time
  (`-force_key_frames expr:isnan(prev_forced_t)+gte(t,prev_forced_t+1)` + each encoder's forced-IDR switch; `-g F` is
  only a cap), since a GOP of F frames would last F/(real fps) seconds. Saves use `-copyts -start_at_zero`: without
  it ffmpeg treats a > 10 s jump in MPEG-TS as a discontinuity and closes it up in the video only (after a long still
  the picture ran ahead of the sound). The encoder gets `-enc_time_base:v 1/F` and the
  frame-rate tag is cleared last (`setpts=PTS:strip_fps=1`, FFmpeg 7.1+; after vpp_qsv, which derives its rate from its
  input), so NVENC/AMF/QSV/x264 take F from the time base (checked in their n8.1 sources) instead of ddagrab's 666.
  `-r F` is not possible: FFmpeg 8 rejects -r with -fps_mode passthrough.
- **Still screens** (`CaptureConfig.PausesOnStillScreen`, both real methods): start accepted after 8 s without a
  segment, 10-minute audio queue, watchdog 10 minutes instead of 15 s. "Stalled" = ffmpeg's encoded-frame count (from
  -progress) hasn't moved for 2.5 s: then a save doesn't wait for the current segment (the clip ends at the last
  finished one, up to ~2 s before the screen went still), 'q' gets 2 s instead of 10 before the kill (ddagrab can't
  see it until a picture arrives), and the "PC is struggling" hint ignores the speed dip. Mouse movement does produce
  frames. With per-slot frames, speed stays ~1 even when the encoder is overloaded (frames are stamped on arrival; a
  slow encoder just means fewer of them), so that hint mostly can't fire any more; "Test my PC" judges the encoder on a
  constant-rate pass (fps=F; its test card never stops moving) and counts different frames on the real graph. Harness: a FIFO source frozen with SIGSTOP checks the hold, live motion afterwards, continuous
  sound, save and stop times.
- **Classic timing** (Settings > Capture method > "Desktop Duplication - classic timing (1.0.1)",
  `CaptureMethod.DesktopDuplicationClassic` → `TimerPacedCapture`): the 1.0.1 graph, kept as a fallback. Saved as
  `"CaptureMethod": "DesktopDuplication"` + `"ClassicCaptureTiming": true`, so 1.0.1 can still read the settings file.
- Not measured on hardware: the 1.0.2 capture change rests on FFmpeg's source, the pinned binaries and the Linux
  harness (whose FFmpeg 6.1 lacks strip_fps; it runs the per-slot graph without it).
- Windows Graphics Capture (gfxcapture, FFmpeg 8.1+): event driven (FrameArrived, compositor SystemRelativeTime pts),
  survives UAC; also pauses on still screens; on Windows 10 shows a yellow border; its max_framerate is only a cap
  (MinUpdateInterval, Windows 11 24H2+), given 25% headroom. Auto = WGC only for rotated monitors. User can force either
  in Settings ("Capture method").
- The capture ffmpeg gets D3DKMT GPU scheduling priority HIGH (not REALTIME: needs admin, NVIDIA freezes with HAGS; skipped
  for Intel like OBS); saves get low I/O and memory priority on top of BelowNormal CPU.
- Resolution presets above the monitor's height record at the monitor's size (never upscaled).

## Behaviour added after the adversarial review (all implemented)

- **Resume keeps the buffer's format.** A supervised resume (`StartAsync(cfg, keepBuffer: true)`) reuses the previous run's
  output size, fps, encoder and bitrate and scales the new picture into it, so a game changing resolution/refresh rate
  doesn't make the old footage un-joinable (and deleted).
- **Recordings are never thrown away by a failed save.** The footage stays pinned as a *pending recording*
  (`PendingRecordingCount`, `RetryPendingRecordingsAsync`); the app shows "Try again". If the buffer is turned off with a
  pending recording that still can't be saved, its folder is kept (marker file) instead of deleted.
- **Recording auto-stops before the drive fills**: when free space on the clips drive drops below what saving it needs.
- **Saves check free space first** (clip size + 2 GB floor when on the buffer drive) and fail with a plain message
  instead of tripping the disk guard and stopping the replay.
- **Long saves**: concatf lists are chunked (≤ 1000 segments; Windows' C runtime allows ~8000 open files) and joined by an
  ffconcat with exact chunk durations; save timeouts scale with size (≥ 15 MB/s).
- **Exit/shutdown wait for in-flight saves** (`ActiveOperations`) instead of killing them.
- **Capture method**: Auto = Desktop Duplication (WGC only for rotated monitors). Both pause on still screens (see Capture
  method above).
- **Encoder choice**: AMF/Quick Sync must run on the monitor's GPU (zero copy); NVENC may run on another GPU via system
  memory (`CrossAdapter`, extra `-init_hw_device cuda`). With no usable GPU encoder, CPU H.264 capped at 1080p60.
- **"Test my PC"** judges only the steady-state window (block-to-block deltas), not ffmpeg's totals incl. start-up.
- **Buffer length** changes apply live (`SetBufferSeconds`), without clearing the buffer.
