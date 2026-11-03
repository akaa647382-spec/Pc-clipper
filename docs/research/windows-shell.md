# PC Clipper: app shell research report

Topics covered: the Windows app shell, global hotkeys, the ffmpeg child process, the overlay toast, monitor choice, autostart and single instance, SmartScreen, and storage. Plus what existing replay tools offer.

**How I checked things:**
- On this Linux box, with .NET SDK 8.0.133, the C# code below builds for win-x64 with 0 warnings and 0 errors, and publishes to a single exe.
- Struct sizes and offsets were checked with `Marshal.SizeOf`.
- None of it could be run on Windows. Every runtime behaviour statement comes from documentation, source code, or community reports, and is tagged that way.

**Blocked sites:** these could not be fetched and would have to be allowed in the session's network settings to check them directly: www.amd.com, www.playstation.com, help.steampowered.com, learn.microsoft.com, devblogs.microsoft.com, forums.developer.nvidia.com, textslashplain.com, www.freemancw.com. I used Microsoft's own docs mirrored on GitHub (`raw.githubusercontent.com/MicrosoftDocs/...`) instead, plus search snippets for the others.

**Full compiling source files:**
- `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/app-shell/shell/` contains `shell.csproj`, `Program.cs`, `SingleInstance.cs`, `Hotkeys.cs`, `Toast.cs`, `ProcessControl.cs`, `Displays.cs`, `Startup.cs`, plus `app.manifest` and `app.ico`.
- The project test for question 2 is in `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/app-shell/wf1/`.

---

## 1. Existing replay features and their maximum buffer length

| Product | Longest "save the last…" | Confidence | Source |
|---|---|---|---|
| **PS5 "Save recent gameplay"** | **1 hour.** PlayStation support says you can save clips "from the last 15 seconds up to 1 hour of gameplay". The en-US page says you can "record up to 1 hour". Short-clip presets differ between sources (15 s / 30 s / 3 min / 15 min / 30 min / 1 h, or 15 s to 30 min) and I could not confirm the exact menu. | HIGH for 1 h; LOW for the preset list | playstation.com/en-ae/support/games/capture-ps5-gameplay-screenshots and /en-us/ (search snippets; site blocked); https://digitaltrends.com/gaming/how-to-record-gameplay-on-a-ps5 |
| **NVIDIA App / GeForce Experience Instant Replay** | **20 minutes** (slider from about 15–30 s up to 20 min). Save hotkey Alt+F10, toggle Alt+Shift+F10, record Alt+F9, screenshot Alt+F1, overlay Alt+Z, stats Alt+R. | MEDIUM (no NVIDIA page reachable; third-party sources agree) | https://beebom.com/how-setup-instant-replay-geforce-experience , https://www.technobezz.com/how-to-fix-nvidia-instant-replay-not-working , https://www.computerhope.com/jargon/n/nvidia-overlay.htm |
| **AMD Software: Adrenalin Instant Replay** | **20 minutes**, adjustable in 15 s steps (AMD FAQ). Defaults: save replay Ctrl+Shift+S, screenshot Ctrl+Shift+I, overlay Alt+R. | MEDIUM-HIGH (official FAQ, seen only as a search snippet) | https://www.amd.com/en/resources/support-articles/faqs/DH3-023.html , https://manuals.plus/m/4e1dbc0980470ca62922fb4970faf3bef247ccc39b4a2369c6468dc5e9b62e02 |
| **Xbox Game Bar "Record what happened"** | **10 minutes** (choices 15 s, 30 s, 1, 3, 5, 10 min under Settings > Gaming > Captures). Save is Win+Alt+G. Separate manual-recording cap: 30 min to 4 h. A few sites say 30 min, which looks like a mix-up with that manual cap. | MEDIUM | https://geekrewind.com/how-to-manage-background-recording-length-settings-in-windows-11-game-bar/ , https://www.technipages.com/how-to-change-xbox-game-bar-recording-settings |
| **Steam Game Recording** (background mode) | Configurable by **duration and disk space**, globally and per game. **I'm not sure of the hard maximum**: users report up to about 120 min per game, and the duration setting is sometimes ignored. The minimum duration for "All other games" is 5 min. Default record hotkey is Ctrl+F11, screenshot F12. | LOW for the maximum, MEDIUM for the rest | https://help.steampowered.com/faqs/view/23B7-49AD-4A28-9590 (blocked; snippet), https://steamcommunity.com/discussions/forum/0/592891465952137743 , https://digitaltrends.com/gaming/how-to-steam-game-recording |
| OBS Replay Buffer (context for the "just use OBS" crowd) | Held in RAM ("Maximum Memory" setting), so one hour at a high bitrate is impractical. | MEDIUM (from memory, not re-checked) | none |

**Takeaway for the user:** PC tools cap at 10–20 minutes (Steam is the exception and is disk-based). A disk-backed 60-minute buffer, like PS5's, is a real difference. NVIDIA stores its replay buffer as temporary files on disk ("Temporary files location"), the same idea as our segment folder (https://shacknews.com/article/142202/change-shadowplay-save-file-location-nvidia-app).

---

## 2. WinForms on .NET 8 built on Linux without Microsoft.NET.Sdk.WindowsDesktop

**Why the plain SDK plus a FrameworkReference is required.** The Linux SDK has no `Sdks/Microsoft.NET.Sdk.WindowsDesktop` folder. Core `Microsoft.NET.Sdk.targets` (around line 1318) imports `../../Microsoft.NET.Sdk.WindowsDesktop/targets/Microsoft.NET.Sdk.WindowsDesktop.targets` whenever `UseWindowsForms=true`. So setting `UseWindowsForms` on Linux points at a missing file. Using `Microsoft.NET.Sdk` + `<FrameworkReference Include="Microsoft.WindowsDesktop.App.WindowsForms"/>` + `EnableWindowsTargeting` is the right approach. [HIGH; tested locally: ls of the SDK folder plus grep of the targets]

**What breaks, what is missing, and what still works:**

| Item | Finding | Confidence |
|---|---|---|
| `ApplicationConfiguration.Initialize()` generator | **Available.** The analyzer comes in through the targeting pack (`microsoft.windowsdesktop.app.ref/8.0.33/analyzers/dotnet/cs/System.Windows.Forms.Analyzers.CSharp.dll`, listed as `Type="Analyzer"` in FrameworkList.xml). **Trap:** without the WindowsDesktop SDK it cannot see `ApplicationHighDpiMode` and similar properties. It then **silently generates `SetHighDpiMode(HighDpiMode.SystemAware)`** even when the csproj sets `<ApplicationHighDpiMode>PerMonitorV2</ApplicationHighDpiMode>`. The fix is to add `<CompilerVisibleProperty Include="ApplicationHighDpiMode;ApplicationVisualStyles;ApplicationUseCompatibleTextRendering;ApplicationDefaultFont"/>`. After that it generates `PerMonitorV2` and `SetDefaultFont(Segoe UI 9pt)`. **Recommendation:** skip the generator and call the four APIs explicitly (see Program.Main below). | HIGH, tested locally: read `obj/.../ApplicationConfiguration.g.cs` before and after adding CompilerVisibleProperty |
| `SetHighDpiMode(PerMonitorV2)`, `EnableVisualStyles()`, `SetCompatibleTextRenderingDefault(false)`, `SetDefaultFont(...)` | Plain runtime APIs, unaffected. Call them before any window or `IWin32Window` exists; `SetCompatibleTextRenderingDefault` throws otherwise. Generator order: EnableVisualStyles, then SetCompatibleTextRenderingDefault(false), then SetHighDpiMode, then SetDefaultFont. PerMonitorV2 also matters for monitor enumeration (question 6): DXGI desktop coordinates and `Screen` bounds are only physical pixels in a per-monitor-aware process. | HIGH |
| `<ApplicationManifest>` / `<ApplicationIcon>` / `<Version>` | **Work with the core SDK, even in single-file publish on Linux.** The published exe contains ICON, GROUP_ICON, VERSIONINFO and MANIFEST resources (our manifest XML verified inside), subsystem WINDOWS_GUI, and no NETSDK1074 warning. The bare apphost template has no `.rsrc` at all, so these resources come from the SDK's resource updater. | HIGH, tested locally: `llvm-readobj --coff-resources pub/PCClipper.exe` |
| Manifest contents | Keep `asInvoker`, the Win10 `supportedOS` GUID, `longPathAware`, and the Common-Controls v6 dependency. Leave DPI to `SetHighDpiMode` (the WinForms team recommends the API over manifest DPI entries). | MEDIUM |
| Trimming | **Not guarded.** The NETSDK1175 "WinForms + trimming" error only fires when `UseWindowsForms=true`. With a bare FrameworkReference, `PublishTrimmed=true` silently produced a 54 MB exe. The .NET docs say trimming is disabled for WinForms because it depends on built-in COM marshalling and "almost no Windows Forms apps are runnable" without it. **Never set PublishTrimmed.** | HIGH, tested locally plus https://raw.githubusercontent.com/dotnet/docs/main/docs/core/deploying/trimming/incompatibilities.md |
| Other properties that change without `UseWindowsForms` | (a) No implicit WinForms global usings. (b) `EnableUnsafeBinaryFormatterSerialization` defaults to false instead of true; irrelevant without resx or clipboard custom objects. (c) No resx designer support, which is fine for code-only forms. | HIGH (read from `Microsoft.NET.Sdk.targets`) |
| Single-file size | The self-contained WinForms runtime pack also ships WPF binaries (PresentationCore, wpfgfx_cor3, D3DCompiler_47_cor3…), because the runtime pack is not filtered by profile. Results: 161 MB plain; 145 MB with `SatelliteResourceLanguages=en`; **66 MB with `EnableCompressionInSingleFile=true`**. Compression costs some start-up time (docs). I believe the official SDK gives the same sizes but did not verify that. | HIGH (measured) |
| `IncludeNativeLibrariesForSelfExtract=true` | Needed for one file. Native DLLs (wpfgfx, PresentationNative, vcruntime140_cor3, D3DCompiler) are extracted at start-up to `%TEMP%\.net\...`, or to `DOTNET_BUNDLE_EXTRACT_BASE_DIR`. | HIGH, https://raw.githubusercontent.com/dotnet/docs/main/docs/core/deploying/single-file/overview.md |
| Single-file API caveats | `Assembly.Location` returns `""`. Use `Environment.ProcessPath` for the exe path (needed for the Run key) and `AppContext.BaseDirectory` for files next to the exe. | HIGH (same doc) |

---

## 3. Global hotkeys

**Pattern.**
- `RegisterHotKey(hwnd, id, mods | MOD_NOREPEAT, vk)`, then handle `WM_HOTKEY (0x0312)` in `NativeWindow.WndProc` or `Form.WndProc`, and `UnregisterHotKey` on exit.
- Modifier values: MOD_ALT=0x1, MOD_CONTROL=0x2, MOD_SHIFT=0x4, MOD_WIN=0x8, MOD_NOREPEAT=0x4000 ("keyboard auto-repeat does not yield multiple hotkey notifications").
- App hotkey ids must be 0x0000–0xBFFF.
- Registration must happen on the thread that created the window ("fails if you try to associate a hot key with a window created by another thread").
- WinForms `Keys` & `Keys.KeyCode` equals the VK code.

[HIGH] https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-registerhotkey.md

**When the combination is already taken.** RegisterHotKey "typically… fails if the keystrokes… have already been registered". `GetLastError()` is **1409 = ERROR_HOTKEY_ALREADY_REGISTERED** (a probe of 592 Win-key chords got 1409 on 28). Caveat: this only detects other `RegisterHotKey` users. Overlays that read keys through hooks or raw input (possibly NVIDIA, AMD, Discord) will not cause a failure; both apps would react, or theirs might swallow the key. So pick defaults that don't collide, and let the user rebind.
- Docs: "Keyboard shortcuts that involve the WINDOWS key are reserved for use by the operating system".
- Docs: "The F12 key is reserved for use by the debugger at all times."
- Confidence: HIGH for 1409 and the docs; MEDIUM for the hook-based-overlay caveat. Sources: same doc and https://github.com/blendonl/mshell/pull/39

**Does it fire while a fullscreen game has focus?** Generally yes. Hotkeys are matched by the system before input reaches the foreground app, which is how ShareX-style tools work in games. Exception (documented): a game that registers raw keyboard input with **`RIDEV_NOHOTKEYS` (0x200)** turns off app hotkeys while it is in the foreground ("application-defined keyboard device hotkeys are not handled… system hotkeys such as ALT+TAB… are still handled"). Some games do this, and then no RegisterHotKey tool works in that game.
- Confidence: MEDIUM. Source: https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/ns-winuser-rawinputdevice.md
- I'm not sure whether DirectInput exclusive keyboard mode has the same effect.

**Elevated (admin) game, non-elevated PC Clipper.**
- Best available evidence: UIPI does **not** block RegisterHotKey delivery. The documented attack is exactly a low-integrity process triggering a hotkey owned by Explorer. Low-level hooks, SendInput and messages *are* blocked. [MEDIUM] https://github.com/Chaoses-Ib/Windows/blob/main/Kernel/Security/UIPI.md , https://github.com/xiaoyifang/goldendict-ng/pull/3142
- Contrary reports: ShareX users with admin games needed to run ShareX as admin, mostly for PrintScreen. [LOW] https://steamcommunity.com/app/400040/discussions/1/2953788788214670102
- I could not test this. Treat it as "probably works; verify on Windows with an elevated game such as Genshin Impact".
- If it fails, the fallback is a user-chosen "Run PC Clipper as administrator" option. Note that an elevated app cannot autostart through the HKCU Run key (see question 7); it needs Task Scheduler with "highest privileges".

**Never steal focus in the WM_HOTKEY handler.** Receiving the hotkey gives our process the "last input event" foreground right, so `Activate()`, `Show()` on a normal form, or `SetForegroundWindow` would pull focus from the game. That can minimize an exclusive-fullscreen game. Only start background work and show the non-activating toast. [HIGH] https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setforegroundwindow.md

**WH_KEYBOARD_LL hook as an alternative: pros and cons.**
- Pro: it sees every key and can't be refused with 1409.
- Con: every keystroke system-wide, including the game's, waits for our callback.
- Con: a slow callback is "silently removed without being called" after `LowLevelHooksTimeout` (at most 1000 ms on Windows 10 1709+). A GC pause or a busy UI thread could add input lag to the game or kill the hook without any signal.
- Con: UIPI blocks it for elevated foreground windows unless the process has uiAccess (which needs a signed exe in Program Files).
- Anti-cheat: I'm not sure whether specific anti-cheats flag LL hooks. A process watching all keystrokes is more suspicious than RegisterHotKey.
- **Recommendation: RegisterHotKey only.**
- Confidence: HIGH for the timeout behaviour (https://raw.githubusercontent.com/MicrosoftDocs/win32/docs/desktop-src/winmsg/lowlevelkeyboardproc.md), MEDIUM for UIPI, LOW for anti-cheat.

**Recommended defaults** (all user-rebindable). Ctrl+Alt+F-keys:
- **Ctrl+Alt+F9:** save last N (N = the user's default length)
- **Ctrl+Alt+F10:** start/stop manual recording
- **Ctrl+Alt+F11:** screenshot
- **Ctrl+Alt+F8:** buffer on/off
- Optional, off by default: Ctrl+Alt+F1…F7 for 15 s / 30 s / 1 m / 5 m / 15 m / 30 m / 1 h.

Why this set:
- It avoids NVIDIA's Alt+Fx, Alt+Z and Alt+R.
- It avoids AMD's Ctrl+Shift+letters and Alt+R.
- It avoids Game Bar's Win+Alt+… and Steam's F12, Ctrl+F11 and Shift+Tab.
- It avoids PrtScn (Windows 11 Snipping Tool and ShareX).
- It avoids F12 entirely.
- It avoids **Ctrl+Alt+letter or digit**, because AltGr equals Ctrl+Alt on European layouts (German AltGr+Q = @). Registering those would steal characters. F-keys produce no AltGr characters.
- I did not find Discord's default clip keybind. [MEDIUM]

---

## 4. Child-process safety, priority and power throttling

**Job object** [HIGH; layouts verified with Marshal.SizeOf/OffsetOf; constants from the docs and mingw-w64 headers].
- `JOBOBJECT_BASIC_LIMIT_INFORMATION` is 64 bytes on x64. Offsets: LimitFlags @16, MinimumWorkingSetSize @24, Affinity @48 (padding after each DWORD).
- `IO_COUNTERS` is 48 bytes.
- `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` is 144 bytes.
- `JobObjectExtendedLimitInformation = 9`.
- `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000`.
- `JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION = 0x400` (avoids a WER "ffmpeg.exe stopped working" dialog).
- Nested jobs are allowed since Windows 8, so it still works if Steam or a launcher already put us in a job.

Call sequence:
1. At start-up: `CreateJobObjectW(NULL, NULL)` → `SetInformationJobObject(job, 9, &ext, 144)`.
2. Keep the handle in a **static** field for the process lifetime. If it is GC-finalized or disposed early, ffmpeg is killed.
3. After each `Process.Start(ffmpeg)`: `AssignProcessToJobObject(job, p.Handle)`. The small race is harmless because ffmpeg spawns no children.

Do **not** put PC Clipper itself into the job. Every child would inherit it, so a video player opened with "Open clip" would be killed when PC Clipper exits.

Sources: https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winnt/ns-winnt-jobobject_basic_limit_information.md , https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/jobapi2/nf-jobapi2-assignprocesstojobobject.md , https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-headers/include/winnt.h

**Power throttling (EcoQoS)** [HIGH].
- Call `SetProcessInformation(hProcess, ProcessPowerThrottling = 4, &state, 12)`.
- State: `{ Version = 1, ControlMask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED (0x1), StateMask = 0 }` means "HighQoS: throttling off".
- Separately, `ControlMask = PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION (0x4), StateMask = 0` means "always honour timer-resolution requests". This is Windows 11 only, so make it a separate call and ignore failure.
- Apply both to ffmpeg's handle (we have full access because we created it) and to our own process, which runs the WASAPI capture threads.

Sources: https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/processthreadsapi/nf-processthreadsapi-setprocessinformation.md , https://raw.githubusercontent.com/mingw-w64/mingw-w64/master/mingw-w64-headers/include/processthreadsapi.h

**Priority class.**
- `Process.PriorityClass = AboveNormal` for ffmpeg with a GPU encoder.
- Keep `Normal` for the libx264 / libx265 / SVT-AV1 CPU fallback, because at High it competes with the game's CPU threads.
- High is allowed without admin; Realtime needs SeIncreaseBasePriorityPrivilege, otherwise it is capped at High.
- [MEDIUM] (judgement; privilege rule from Microsoft's Win32_Process docs via search)

**GPU priority.**
- OBS can call `D3DKMTSetProcessSchedulingPriorityClass` (HIGH when hardware-accelerated GPU scheduling is on, otherwise REALTIME) plus `IDXGIDevice::SetGPUThreadPriority`. In OBS source this is compiled in only when `GPU_PRIORITY_VAL` is set, and skipped on Intel. [HIGH for what the source does] https://raw.githubusercontent.com/obsproject/obs-studio/master/libobs-d3d11/d3d11-subsystem.cpp , libobs-d3d11/CMakeLists.txt
- An NVIDIA developer-forum thread reports NVENC hangs or driver crashes with REALTIME. [LOW, snippet only] https://forums.developer.nvidia.com/t/nvenc-encoder-hangs-on-windows-when-using-d3d11-in-real-time-mode/357465
- The privilege rules for D3DKMT are undocumented. [LOW]
- **Recommendation: don't touch GPU scheduling priority in v1.**

**Timer-resolution risk for 120 fps.** I read this in the source; it is not tested on Windows.
- ddagrab paces frames with `av_usleep(delay)`, which on Windows maps to millisecond `Sleep`/wait calls, and sets `frame->pts = now`. Its AcquireNextFrame timeout is half a frame interval.
- ddagrab does **not** call `timeBeginPeriod`. FFmpeg's AMD capture source `vsrc_amf.c` does, explicitly.
- Since Windows 10 2004, timer resolution is per process: "For processes which have not called this function, Windows does not guarantee a higher resolution than the default system resolution" (about 15.6 ms).
- At 120 fps (8.3 ms frames), a coarse timer would cap real capture at roughly 64 fps with uneven timestamps. Something else inside ffmpeg (a driver DLL, for example) may raise the resolution, so this may not happen in practice.
- **The implementer must measure on Windows:** `ffmpeg -f lavfi -i ddagrab=framerate=120 -t 10 -f null -`; the frame count should be about 1200 and the stats fps about 120.
- Confidence: LOW-MEDIUM. Sources: https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavfilter/vsrc_ddagrab.c (lines ~1099–1121 and 909), https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavutil/time.c , https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavfilter/vsrc_amf.c , https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/timeapi/nf-timeapi-timebeginperiod.md

---

## 5. Non-activating topmost overlay toast

**Recipe** [HIGH for the WinForms internals, read from source; MEDIUM for runtime behaviour]:
- Borderless form with `ShowInTaskbar = false`.
- Override `ShowWithoutActivation => true`, which gives `SW_SHOWNOACTIVATE`.
- In `CreateParams.ExStyle`, OR in `WS_EX_TOPMOST 0x8 | WS_EX_NOACTIVATE 0x08000000 | WS_EX_TOOLWINDOW 0x80 | WS_EX_TRANSPARENT 0x20`.
- Return `MA_NOACTIVATE` for `WM_MOUSEACTIVATE`.
- After `Show()`, call `SetWindowPos(HWND_TOPMOST, SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE|SWP_SHOWWINDOW)`.

**Two WinForms traps,** found in `dotnet/winforms` release/8.0 `Form.cs`:
1. **Don't set `Form.TopMost = true`.** Its setter calls `SetWindowPos(HWND_TOPMOST, SWP_NOMOVE|SWP_NOSIZE)` without `SWP_NOACTIVATE`, both on handle creation and in `SetVisibleCore`. When TopMost is set, `SetVisibleCore` also calls `FocusActiveControlInternal()`, which calls `SetFocus`.
2. **Don't add `WS_EX_LAYERED` yourself while Opacity == 1.** WinForms only calls `SetLayeredWindowAttributes` from `UpdateLayered()` when its own "layered" flag is set (Opacity < 1 or TransparencyKey set). A layered window that never gets that call **never becomes visible**. Set `Opacity = 0.9` and let WinForms add WS_EX_LAYERED. Click-through then comes from LAYERED + TRANSPARENT.

Source: https://raw.githubusercontent.com/dotnet/winforms/release/8.0/src/System.Windows.Forms/src/System/Windows/Forms/Form.cs (TopMost setter ~l.2157; SetVisibleCore ~l.2350; UpdateLayered ~l.5625)

**Keep the toast out of the recording.** ddagrab captures the composed desktop, so our toast would end up in clips and screenshots. Call `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE = 0x11)` (Windows 10 2004+). The docs give this exact use: "windows that show video recording controls, so that the controls are not included in the capture." On older Windows it behaves like WDA_MONITOR, which shows a black box in captures. Desktop Duplication honouring display affinity is my understanding of DWM, not separately verified.
- Confidence: HIGH for the doc, MEDIUM that DDA honours it. Source: https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setwindowdisplayaffinity.md

**Which games show the overlay:**
- **Borderless-windowed games:** yes, DWM composes the topmost window on top. While it is visible, DWM may drop the game from independent flip to composed mode, possibly costing a frame or briefly toggling VRR. Keep the toast small and short (2–3 s) and optional. [MEDIUM / LOW for the flip detail]
- **DX11/DX12 "exclusive fullscreen" with Windows fullscreen optimizations (FSO):** usually yes. Microsoft's FSO post says overlays such as Game Bar work under FSO, while under true exclusive fullscreen "the display may flicker". [MEDIUM] https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/ (snippet; site blocked)
- **True exclusive fullscreen** (FSO disabled, many DX9 and OpenGL titles): **no**, the toast won't be seen. Offer an optional short **sound cue** as well. The cue will be picked up by desktop loopback into *later* clips, unless the audio side uses process-loopback exclusion of our own PID; that is the audio investigator's area. [MEDIUM]

**NotifyIcon.ShowBalloonTip on Windows 10/11.** It becomes a toast notification. Windows 11 Do Not Disturb has automatic rules "When playing a game" and "When using an app in full-screen mode", which hide notifications and send them to the notification centre. I believe these are on by default but did not verify that. So don't rely on balloons in games; use them only for non-game events (for example "ffmpeg download finished"). [MEDIUM] https://www.elevenforum.com/t/manage-focus-assist-automatic-rules-in-windows-11.1363/ , https://windowscentral.com/how-use-focus-assist-avoid-distractions-windows-11

---

## 6. Monitor enumeration that matches ddagrab's `output_idx`

**How ffmpeg picks the output** [HIGH, read from FFmpeg source]:
- ddagrab takes the **adapter of its D3D11 device** (`IDXGIDevice::GetParent(IDXGIAdapter)`), then calls `IDXGIAdapter_EnumOutputs(adapter, output_idx)`.
- The device comes from `-init_hw_device d3d11va=<name>:<N>`. N is the index into `CreateDXGIFactory1 → IDXGIFactory2::EnumAdapters(N)`.
- With no device given, it uses the default adapter, which is EnumAdapters index 0.
- FFmpeg **7.0+** also accepts `vendor_id=0x10de` (I checked release/6.1 = no, 7.0 / 7.1 / 8.0 = yes).
- ffmpeg logs "Using device %04x:%04x (%ls)" and, with verbose logging, "Opened dxgi output %d with dimensions %dx%d". Use these to verify the choice.

Sources: https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavfilter/vsrc_ddagrab.c (l.176–207), https://raw.githubusercontent.com/FFmpeg/FFmpeg/master/libavutil/hwcontext_d3d11va.c (l.580–680)

**Matching it from C#: raw COM via function pointers, no NuGet** [HIGH; vtable slots from Wine's dxgi*.idl; struct sizes verified: DXGI_ADAPTER_DESC1 = 312, DXGI_OUTPUT_DESC = 96, DXGI_OUTPUT_DESC1 = 152, DEVMODEW = 220 with dmPelsWidth @172 and dmDisplayFrequency @184].
- Call `CreateDXGIFactory1(IID_IDXGIFactory1 = 770aae78-f26f-4dba-a829-253c83d1b387)`.
- vtable slots: Factory1.EnumAdapters1 = 12; Adapter.EnumOutputs = 7; Adapter1.GetDesc1 = 10; Output.GetDesc = 7; IDXGIOutput6 (068346e8-aaec-4b84-add7-137f513f77a1).GetDesc1 = 27; Release = 2.
- `DXGI_ERROR_NOT_FOUND = 0x887A0002` ends each loop.
- EnumAdapters and EnumAdapters1 return the same order. Count the software adapter (flag 2, vendor 0x1414) in the index, but skip it.
- Code: see `Displays.cs` below.

**Vortice.DXGI alternative.**
- Latest is **3.8.3**, which targets net8.0, net9.0 and net10.0, depends on Vortice.DirectX 3.8.3 and SharpGen.Runtime 2.4.2-beta.
- 3.8.1 dropped net8.0. 3.6.2 is the last earlier version for net8.0.
- Raw COM is about 150 lines and avoids a beta dependency. [HIGH, NuGet API]

**Mapping to `Screen`.** `DXGI_OUTPUT_DESC.DeviceName` ("\\.\DISPLAY1") equals WinForms `Screen.DeviceName`, which WinForms fills from `GetMonitorInfo` MONITORINFOEX.szDevice. A fallback is `Screen.FromPoint(center of DesktopCoordinates)`. [HIGH] https://raw.githubusercontent.com/dotnet/winforms/release/8.0/src/System.Windows.Forms/src/System/Windows/Forms/Screen.cs

**Resolution and refresh rate.** Use `EnumDisplaySettingsW(DeviceName, ENUM_CURRENT_SETTINGS = -1)`, which gives dmPelsWidth, dmPelsHeight and dmDisplayFrequency. DDA captures the **current desktop mode**, so that is the capture size. Two consequences for the quality UI:
- **"5K" only makes sense on a 5K desktop.** Anything higher is an upscale that wastes bits.
- **120 fps only makes sense on a monitor running at 120 Hz or more.** DDA only produces new frames at the refresh rate, and ddagrab duplicates frames otherwise (`dup_frames` defaults to 1).

**HDR.** `IDXGIOutput6::GetDesc1().ColorSpace == 12` (`DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020`) means HDR is on. Flag it to the ffmpeg side, because 8-bit BGRA capture of an HDR desktop is a known quality problem.

**Encoder auto-pick.** Choose by the **vendor of the adapter that owns the captured output**, not by "best GPU in the PC": 0x10DE gives *_nvenc, 0x1002 gives *_amf, 0x8086 gives *_qsv. Zero-copy only works when the encoder runs on that same adapter.
- On hybrid laptops (internal panel on the Intel/AMD iGPU), NVENC can't consume the iGPU's D3D11 textures without a copy.
- Running Desktop Duplication on the dGPU for an iGPU-attached output fails with DXGI_ERROR_UNSUPPORTED, by design.

[MEDIUM] https://www.freemancw.com/2020/11/desktop-duplication-on-hybrid-graphics-systems/ (snippet), https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/37349427/desktop-duplication-api-switchable-graphics (snippet)

**Adapter order can differ between processes.** Windows' per-app GPU preference (HKCU\Software\Microsoft\DirectX\UserGpuPreferences, keyed by exe path, value like `GpuPreference=2;`) changes the order EnumAdapters returns for that exe. PCClipper.exe and ffmpeg.exe could therefore disagree on index N. Mitigations:
- Prefer `vendor_id=` when there is one GPU per vendor.
- Always check ffmpeg's "Using device VVVV:DDDD" and "Opened dxgi output … WxH" lines against what the app enumerated.

[MEDIUM; I could not fetch a primary source for the registry format]

---

## 7. "Start with Windows" and single instance

**Run key** [HIGH; StartupApproved details MEDIUM]:
- Write `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value `"PC Clipper"` = `"C:\full\path\PCClipper.exe" --tray` (REG_SZ).
- Use **real quote characters around `Environment.ProcessPath`**. A reported bug shows backslash-escaped quotes in a Run value crashing Task Manager: https://claudeissues.com/issue/80757-bug-windows-startup-run-registry-value-is-written-with-escaped-quotes-crashing-t
- Re-write the path on each launch if it changed (the user may move the exe).
- Task Manager or Settings "disable" doesn't delete the Run value. It writes a 12-byte value under `...\Explorer\StartupApproved\Run`; first byte 0x02 = enabled, odd (0x03) = disabled. Read it to show the true state.
- To re-enable from our checkbox, delete our StartupApproved value. The format is undocumented. https://forums.powershell.org/t/enable-disable-startup-programs-in-windows-10/8537 , https://windowsir.blogspot.com/2022/07/does-autostart-really-mean-autostart.html
- Run-key entries are never elevated. An "always admin" mode would need a scheduled task instead. [MEDIUM]

**Single instance** [HIGH for the APIs]:
- Create a named `Mutex` `Local\PCClipper-{GUID}` (per logon session). The first instance also creates an `EventWaitHandle` `Local\...Show` right away, so a second instance can't race it.
- The second instance calls `AllowSetForegroundWindow(ASFW_ANY = 0xFFFFFFFF)`. It is allowed to, because the user just launched it and it is "the foreground process" or "received the last input event". It then sets the event and exits.
- The first instance waits with `ThreadPool.RegisterWaitForSingleObject`, then `BeginInvoke` → Show / restore / `Activate` / `SetForegroundWindow`.
- Don't use `HWND_BROADCAST` with a registered message: a form with `ShowInTaskbar = false` is owned by a hidden window, and broadcasts only reach top-level *unowned* windows.

Sources: https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-allowsetforegroundwindow.md , https://raw.githubusercontent.com/MicrosoftDocs/sdk-api/docs/sdk-api-src/content/winuser/nf-winuser-setforegroundwindow.md

---

## 8. Windows Defender, SmartScreen and Smart App Control

All points below are [HIGH] from Microsoft's SmartScreen developer doc (ms.date 05/04/2026), https://raw.githubusercontent.com/MicrosoftDocs/windows-dev-docs/docs/hub/apps/package-and-deploy/smartscreen-reputation.md , except where noted.
- **An unsigned exe downloaded with a browser** shows "Windows protected your PC". The user must click **More info, then Run anyway**. Enterprise policy can block it entirely.
- Unsigned reputation is per file hash and "must build anew with every update". It takes "several weeks and hundreds of clean installs".
- Extended Validation certificates "no longer bypass SmartScreen".
- Microsoft recommends **Artifact Signing (formerly Trusted Signing), about $10/month**. The Microsoft Store avoids warnings entirely.
- **Smart App Control (Windows 11):** "will block execution of unsigned files unless the file has a positive reputation" and "applies to all executable files, not just those downloaded from the Internet". There is **no "Run anyway"**; the user would have to turn SAC off, which can't be undone without resetting Windows. That applies to our unsigned exe *and* to a downloaded unsigned ffmpeg.exe. [HIGH doc; per-app no-override: MEDIUM, https://learn.microsoft.com/en-us/answers/questions/5791210/application-signed-and-blocked-by-smart-app-contro]
- **ffmpeg.exe fetched by our app** with HttpClient gets no Mark-of-the-Web, so SmartScreen doesn't prompt. Defender real-time scanning still scans it, and SAC still applies.
  - Pin one specific, widely downloaded release build (for example a versioned gyan.dev or BtbN release, not a daily "latest") so its hash has reputation.
  - Verify a SHA-256 hash embedded in the app.
  - Store it in `%LOCALAPPDATA%\PCClipper\tools`.
  - Downloading at run time also avoids us redistributing GPL binaries.
  - If `Process.Start` fails, map `Win32Exception.NativeErrorCode`: 4551 = ERROR_SYSTEM_INTEGRITY_POLICY_VIOLATION (SAC / WDAC block), 225 = ERROR_VIRUS_INFECTED; a missing file can mean quarantine. Show plain-language help for each.
  - Confidence: MEDIUM for MOTW and the error codes; from memory.
- **Machine-learning false positives** ("Trojan:Win32/Wacatac.B!ml") are reported for fresh unsigned .NET 9 AOT and zipped builds. They are usually cleared after a false-positive submission to Microsoft. [MEDIUM] https://dylanbeattie.net/2024/12/09/dotnet-9-aot-zip-file-windows-defender-false-positives.html
- **Controlled folder access** (Defender ransomware protection, off by default) blocks unknown apps from writing to Documents, Pictures, Videos and similar folders. Saves would fail with access denied. Catch `UnauthorizedAccessException` and tell the user to allow PC Clipper *and* ffmpeg.exe. [MEDIUM] https://learn.microsoft.com/en-us/defender-endpoint/controlled-folders

**Text for a non-technical user:** "Windows shows a blue 'Windows protected your PC' box for new apps that haven't been downloaded by many people yet. It means Windows doesn't know this app yet, not that a virus was found. Click **More info**, then **Run anyway**. If your PC has *Smart App Control* turned on, Windows won't offer that button. In that case PC Clipper can't run until we publish a signed version. PC Clipper downloads the free FFmpeg video engine once (about 100 MB) and checks its fingerprint before using it."

---

## 9. Save locations and SSD wear

**Folders** [HIGH]:
- `Environment.GetFolderPath(SpecialFolder.MyVideos | MyPictures | LocalApplicationData, SpecialFolderOption.Create)`.
- The **default `SpecialFolderOption.None` returns `""` when the folder doesn't exist**. Source: https://raw.githubusercontent.com/dotnet/dotnet-api-docs/main/xml/System/Environment+SpecialFolderOption.xml
- Clips go to `Videos\PC Clipper`; screenshots to `Pictures\PC Clipper`.
- Videos and Pictures may be **redirected to OneDrive** (Known Folder Move). An hour-long clip would then upload and can fill a 5 GB free plan, so show the resolved path and let the user change it. [MEDIUM]
- The buffer goes in `%LOCALAPPDATA%\PCClipper\buffer`, **not `%TEMP%`**, because Storage Sense and cleanup tools purge temp folders. [MEDIUM]

**Buffer on another drive.**
- Offer a drive dropdown listing `DriveInfo` entries with `DriveType.Fixed` and `IsReady`, using `<drive>:\PCClipperBuffer`.
- Before starting, check free space ≥ bitrate/8 × buffer seconds × 1.15.
- On change, stop the pipeline, delete old segments, and restart.
- An HDD can easily absorb 12–30 MB/s of sequential writes. Saving a 1 h clip re-reads and re-writes about 45 GB (expect several minutes at about 100 MB/s on an HDD), and the clip needs as much free space at the destination.

**SSD wear estimate** [HIGH for the arithmetic; MEDIUM for TBW figures, which come from retail and review pages]:
- 100 Mbit/s = 12.5 MB/s = **45 GB per hour**, so 4 h/day = **180 GB/day ≈ 65.7 TB/year** (plus each saved clip written once more).
- **Daily writes depend only on hours running × bitrate, not on buffer length.** The buffer length only sets disk space: a 60-minute buffer at 100 Mbit/s holds 45 GB.

| SSD endurance rating (total terabytes written) | Years at 4 h/day, 100 Mbit/s | At 200 Mbit/s (5K/120) | At 50 Mbit/s |
|---|---|---|---|
| 1200 TBW (typical 2 TB TLC) | ≈ 18 | ≈ 9 | ≈ 36 |
| 600 TBW (Samsung 990 PRO 1TB, WD SN850X 1TB) | ≈ 9.1 | ≈ 4.6 | ≈ 18 |
| 300 TBW (typical 500 GB TLC) | ≈ 4.6 | ≈ 2.3 | ≈ 9 |
| 220 TBW (Crucial P3 Plus 1TB, QLC) | ≈ 3.3 | ≈ 1.7 | ≈ 6.7 |

- Warranties are usually "5 years or the endurance rating, whichever comes first".
- Big sequential files with TRIM keep write amplification close to 1.
- A "buffer only while a game is running" option would cut wear substantially.

TBW sources: https://www.slashgear.com/1324814/most-reliable-ssd-pc/ , https://tech-compare-pro.pages.dev/2026/05/samsung-990-pro-vs-wd-black-sn850x/

---

## Recommended exact command lines / code

**Build and publish (on Linux, verified)**
```bash
dotnet publish -c Release          # all settings live in the csproj; output: pub/PCClipper.exe (~66 MB)
llvm-readobj --coff-resources pub/PCClipper.exe | grep 'Type:'   # expect ICON, GROUP_ICON, VERSIONINFO, MANIFEST
```

**shell.csproj** (verified: build has 0 warnings, publish succeeds)
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net8.0-windows</TargetFramework>
    <EnableWindowsTargeting>true</EnableWindowsTargeting>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    <ApplicationIcon>app.ico</ApplicationIcon>
    <ApplicationManifest>app.manifest</ApplicationManifest>
    <AssemblyName>PCClipper</AssemblyName>
    <RootNamespace>PCClipper</RootNamespace>
    <Version>1.0.0</Version>
    <!-- only read by ApplicationConfiguration.Initialize() if the CompilerVisibleProperty items below exist -->
    <ApplicationHighDpiMode>PerMonitorV2</ApplicationHighDpiMode>
    <ApplicationVisualStyles>true</ApplicationVisualStyles>
    <ApplicationUseCompatibleTextRendering>false</ApplicationUseCompatibleTextRendering>
    <ApplicationDefaultFont>Segoe UI, 9pt</ApplicationDefaultFont>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
    <PublishTrimmed>false</PublishTrimmed> <!-- NEVER true: NETSDK1175 guard is inactive without UseWindowsForms -->
    <DebugType>embedded</DebugType>
  </PropertyGroup>
  <ItemGroup>
    <FrameworkReference Include="Microsoft.WindowsDesktop.App.WindowsForms" />
    <CompilerVisibleProperty Include="ApplicationHighDpiMode" />
    <CompilerVisibleProperty Include="ApplicationVisualStyles" />
    <CompilerVisibleProperty Include="ApplicationUseCompatibleTextRendering" />
    <CompilerVisibleProperty Include="ApplicationDefaultFont" />
  </ItemGroup>
</Project>
```

**app.manifest** (no DPI entries; DPI is set through the API)
```xml
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="1.0.0.0" name="PCClipper.app"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2"><security><requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
    <requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/></application></compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3"><windowsSettings>
    <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware></windowsSettings></application>
  <dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0"
    processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency>
</assembly>
```

**Program.Main**
```csharp
[STAThread]
private static int Main(string[] args)
{
    using var instance = SingleInstance.Acquire(AppId);          // before any window exists
    if (!instance.IsFirst) { SingleInstance.SignalFirstInstance(AppId); return 0; }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);       // also makes DXGI/Screen coordinates physical pixels
    Application.SetDefaultFont(new Font("Segoe UI", 9f));

    Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
    Application.ThreadException += (_, e) => CrashLog.Write(e.Exception);
    AppDomain.CurrentDomain.UnhandledException += (_, e) => CrashLog.Write(e.ExceptionObject as Exception);

    ChildProcessJob.Initialize();                                // static job handle lives for the whole process
    ProcessTuning.MakeHighQoS(System.Diagnostics.Process.GetCurrentProcess().Handle); // WASAPI threads live here

    bool startInTray = Array.Exists(args, a => string.Equals(a, "--tray", StringComparison.OrdinalIgnoreCase));
    using var main = new MainForm(startInTray);                  // create HotkeyManager + ToastForm (force toast.Handle) on this thread
    instance.ListenForActivation(main);
    StartupRegistration.RefreshPathIfEnabled();
    Application.Run(main);
    return 0;
}
```

**SingleInstance** (core)
```csharp
public static SingleInstance Acquire(string id)
{
    var mutex = new Mutex(false, @"Local\" + id, out bool createdNew);
    EventWaitHandle? ev = createdNew ? new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\" + id + ".Show") : null;
    return new SingleInstance(mutex, createdNew, ev);
}
public static void SignalFirstInstance(string id)
{
    AllowSetForegroundWindow(0xFFFFFFFF /*ASFW_ANY*/);
    try { using var ev = EventWaitHandle.OpenExisting(@"Local\" + id + ".Show"); ev.Set(); }
    catch (WaitHandleCannotBeOpenedException) { }
}
public void ListenForActivation(Form form) =>
    _registration = ThreadPool.RegisterWaitForSingleObject(_showEvent!, (_, _) =>
    { if (form.IsHandleCreated && !form.IsDisposed) form.BeginInvoke(() => {
        form.ShowInTaskbar = true; form.Show();
        if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
        form.Activate(); SetForegroundWindow(form.Handle); }); }, null, Timeout.Infinite, false);
```

**HotkeyManager** (core)
```csharp
internal sealed class HotkeyManager : NativeWindow, IDisposable
{
    const int WM_HOTKEY = 0x0312; public const int ERROR_HOTKEY_ALREADY_REGISTERED = 1409;
    readonly Dictionary<int, Action> _actions = new(); int _nextId = 1;           // ids 0x0000..0xBFFF
    public HotkeyManager() => CreateHandle(new CreateParams());                     // UI thread only
    public bool TryRegister(HotkeyMods mods, Keys key, Action onPressed, out int err)
    {
        int id = _nextId++;
        if (!RegisterHotKey(Handle, id, (uint)(mods | HotkeyMods.NoRepeat), (uint)(key & Keys.KeyCode)))
        { err = Marshal.GetLastWin32Error(); return false; }                        // 1409 => taken by another app
        _actions[id] = onPressed; err = 0; return true;
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && _actions.TryGetValue((int)m.WParam, out var a))
        { try { a(); } catch (Exception ex) { CrashLog.Write(ex); } return; }       // never Activate()/Show() a normal form here
        base.WndProc(ref m);
    }
    public void Dispose() { foreach (var id in _actions.Keys) UnregisterHotKey(Handle, id); _actions.Clear(); DestroyHandle(); }
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll", SetLastError = true)] static extern bool UnregisterHotKey(IntPtr h, int id);
}
[Flags] internal enum HotkeyMods : uint { Alt = 1, Control = 2, Shift = 4, Win = 8, NoRepeat = 0x4000 }
// defaults: Ctrl+Alt+F9 save replay, Ctrl+Alt+F10 record, Ctrl+Alt+F11 screenshot, Ctrl+Alt+F8 buffer on/off
```

**ChildProcessJob and ProcessTuning** (full; struct sizes verified at 64 / 48 / 144 / 12 bytes)
```csharp
internal static class ChildProcessJob
{
    static SafeFileHandle? s_job;   // static => never finalized; closing it kills ffmpeg
    public static void Initialize()
    {
        var job = CreateJobObjectW(IntPtr.Zero, null);
        if (job.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x00002000 /*KILL_ON_JOB_CLOSE*/ | 0x00000400 /*DIE_ON_UNHANDLED_EXCEPTION*/;
        if (!SetInformationJobObject(job, 9 /*JobObjectExtendedLimitInformation*/, ref info,
                (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        s_job = job;
    }
    public static void Add(Process p)   // right after Process.Start(ffmpeg)
    { if (!AssignProcessToJobObject(s_job!, p.Handle)) throw new Win32Exception(Marshal.GetLastWin32Error()); }

    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern SafeFileHandle CreateJobObjectW(IntPtr a, string? n);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(SafeFileHandle j, int c, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION i, uint cb);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(SafeFileHandle j, IntPtr p);
}

internal static class ProcessTuning
{
    public static void MakeHighQoS(IntPtr h) { TrySet(h, 0x1 /*EXECUTION_SPEED*/); TrySet(h, 0x4 /*IGNORE_TIMER_RESOLUTION, Win11*/); }
    public static void Apply(Process ffmpeg, bool cpuEncoder)
    {
        try { ffmpeg.PriorityClass = cpuEncoder ? ProcessPriorityClass.Normal : ProcessPriorityClass.AboveNormal; } catch (Win32Exception) { }
        MakeHighQoS(ffmpeg.Handle);
    }
    static void TrySet(IntPtr h, uint mech)
    { var s = new PROCESS_POWER_THROTTLING_STATE { Version = 1, ControlMask = mech, StateMask = 0 };
      SetProcessInformation(h, 4 /*ProcessPowerThrottling*/, ref s, 12); }      // ignore failure
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_POWER_THROTTLING_STATE { public uint Version, ControlMask, StateMask; }
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int c, ref PROCESS_POWER_THROTTLING_STATE s, uint cb);
}
// Launch order: var p = Process.Start(psi /*UseShellExecute=false, CreateNoWindow=true, RedirectStandardInput/Error=true*/);
//               ChildProcessJob.Add(p); ProcessTuning.Apply(p, cpuEncoder);
```

**ToastForm** (full file at `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/app-shell/shell/Toast.cs`)
```csharp
internal sealed class ToastForm : Form
{
    public ToastForm() { FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
        BackColor = Color.FromArgb(32, 32, 32); Opacity = 0.9; /* NOT TopMost=true */ Size = new Size(360, 56); /* + Label + 2.5 s Timer -> Hide() */ }
    protected override bool ShowWithoutActivation => true;
    protected override CreateParams CreateParams { get { var cp = base.CreateParams;
        cp.ExStyle |= 0x8 /*TOPMOST*/ | 0x08000000 /*NOACTIVATE*/ | 0x80 /*TOOLWINDOW*/ | 0x20 /*TRANSPARENT*/; return cp; } }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetWindowDisplayAffinity(Handle, 0x11 /*WDA_EXCLUDEFROMCAPTURE*/); }
    protected override void WndProc(ref Message m) { if (m.Msg == 0x21 /*WM_MOUSEACTIVATE*/) { m.Result = (IntPtr)3 /*MA_NOACTIVATE*/; return; } base.WndProc(ref m); }
    public void ShowMessage(string text)   // place on the *captured* monitor's WorkingArea
    { /* set label, Location */ if (!Visible) Show();
      SetWindowPos(Handle, new IntPtr(-1) /*HWND_TOPMOST*/, 0, 0, 0, 0, 0x1 | 0x2 | 0x10 | 0x40 /*NOSIZE|NOMOVE|NOACTIVATE|SHOWWINDOW*/); }
}
```

**Displays: DXGI enumeration** (full file at `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/app-shell/shell/Displays.cs`; key part)
```csharp
Guid iid = new("770aae78-f26f-4dba-a829-253c83d1b387");          // IID_IDXGIFactory1
Marshal.ThrowExceptionForHR(CreateDXGIFactory1(&iid, out IntPtr factory));
for (uint a = 0; ; a++) {
    IntPtr adapter; int hr = ((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Slot(factory, 12))(factory, a, &adapter); // EnumAdapters1
    if (hr == unchecked((int)0x887A0002)) break; Marshal.ThrowExceptionForHR(hr);
    try {
        DXGI_ADAPTER_DESC1 ad; ((delegate* unmanaged[Stdcall]<IntPtr, DXGI_ADAPTER_DESC1*, int>)Slot(adapter, 10))(adapter, &ad); // GetDesc1
        if ((ad.Flags & 2) != 0) continue;                         // software adapter (index still counted)
        for (uint o = 0; ; o++) {
            IntPtr output; hr = ((delegate* unmanaged[Stdcall]<IntPtr, uint, IntPtr*, int>)Slot(adapter, 7))(adapter, o, &output); // EnumOutputs
            if (hr == unchecked((int)0x887A0002)) break; Marshal.ThrowExceptionForHR(hr);
            try {
                DXGI_OUTPUT_DESC od; ((delegate* unmanaged[Stdcall]<IntPtr, DXGI_OUTPUT_DESC*, int>)Slot(output, 7))(output, &od); // GetDesc
                // AdapterIndex=a -> "-init_hw_device d3d11va=dda:{a}", OutputIndex=o -> "ddagrab=output_idx={o}"
                // new string(od.DeviceName) == Screen.DeviceName ; EnumDisplaySettingsW(name, -1) -> width/height/Hz
                // QI IDXGIOutput6 (068346e8-aaec-4b84-add7-137f513f77a1), slot 27 GetDesc1: ColorSpace==12 => HDR
            } finally { Release(output); }
        }
    } finally { Release(adapter); }
}
Release(factory);
static void* Slot(IntPtr com, int i) => (*(void***)com)[i];
static void Release(IntPtr p) { if (p != IntPtr.Zero) ((delegate* unmanaged[Stdcall]<IntPtr, uint>)Slot(p, 2))(p); }
// structs (sequential, x64): DXGI_ADAPTER_DESC1 { fixed char Description[128]; uint VendorId, DeviceId, SubSysId, Revision;
//   nuint DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory; LUID AdapterLuid; uint Flags; }  // 312 B
// DXGI_OUTPUT_DESC { fixed char DeviceName[32]; RECT DesktopCoordinates; int AttachedToDesktop; int Rotation; IntPtr Monitor; } // 96 B
// Encoder by VendorId: 0x10DE h264/hevc/av1_nvenc, 0x1002 *_amf, 0x8086 *_qsv, else libx264/libx265/libsvtav1
```
Matching ffmpeg arguments for the capture source (FFmpeg 7.0+ for `vendor_id`):
```
-init_hw_device d3d11va=dda:<AdapterIndex> -filter_hw_device dda -filter_complex "ddagrab=output_idx=<OutputIndex>:framerate=<fps>" ...
```
Then confirm the stderr lines "Using device VVVV:DDDD (name)" and, with `-v verbose`, "Opened dxgi output N with dimensions WxH" against the enumeration.

**Startup and paths** (full file at `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/app-shell/shell/Startup.cs`)
```csharp
const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
static string Command => $"\"{Environment.ProcessPath}\" --tray";
// enable:  Registry.CurrentUser.CreateSubKey(RunKey, true).SetValue("PC Clipper", Command, RegistryValueKind.String);
//          Registry.CurrentUser.OpenSubKey(ApprovedKey, true)?.DeleteValue("PC Clipper", false);
// enabled? Run value exists && !(StartupApproved value is byte[] b && (b[0] & 1) == 1)
string Known(Environment.SpecialFolder f) => Environment.GetFolderPath(f, Environment.SpecialFolderOption.Create);
// clips:  Known(MyVideos)\PC Clipper ; shots: Known(MyPictures)\PC Clipper
// buffer: Known(LocalApplicationData)\PCClipper\buffer   or  <user drive>:\PCClipperBuffer
// tools:  Known(LocalApplicationData)\PCClipper\tools\ffmpeg.exe (pinned version + SHA-256 check)
// space:  need >= bitsPerSecond/8 * (bufferSeconds + 2*segmentSeconds) * 1.15 bytes free (DriveInfo.AvailableFreeSpace)
```

---

## Risks the design must handle

1. **Silent SystemAware DPI.** If anyone switches to `ApplicationConfiguration.Initialize()` without the `CompilerVisibleProperty` items, DPI silently becomes SystemAware. Mixed-DPI monitors then give scaled `Screen` and DXGI rectangles and blurry UI. Keep the explicit calls.
2. **Never enable `PublishTrimmed`.** The SDK won't stop it in this project setup, and WinForms breaks at runtime.
3. **The job handle must outlive ffmpeg.** If it is finalized early, ffmpeg dies mid-capture. Close it only after ffmpeg has been asked to quit (`q`) and exited, or let process exit close it.
4. **Hotkey limits.**
   - Hotkeys may be dead in games that use `RIDEV_NOHOTKEYS`, possibly with some elevated games, and possibly where NVIDIA/AMD/Discord hooks swallow keys.
   - Show registration failures (1409) in the UI and offer the tray-menu and window buttons as a fallback.
   - Detect when the foreground window belongs to an elevated process and show a hint.
5. **Focus theft.** Any `Activate()`, `Show()` on a normal form, `TopMost = true`, or `SetForegroundWindow` after a hotkey can knock the game out of fullscreen or minimize it. Only use the toast form.
6. **Toast visibility and recording.**
   - The toast is invisible in true exclusive fullscreen; offer an optional sound cue.
   - Showing it over a flip-model game can briefly force DWM composition; keep it optional and short.
   - Use `WDA_EXCLUDEFROMCAPTURE` so it isn't recorded.
7. **120 fps pacing.** ddagrab paces with millisecond sleeps and never raises timer resolution. At 120 fps, or even 60 fps, ffmpeg.exe may capture at about 64 fps or with jitter. Measure on Windows before promising 120 fps. 120 fps also needs a monitor at 120 Hz or more; detect the refresh rate and clamp or warn.
8. **5K needs a 5K desktop.** Capture size equals the desktop mode; anything larger is an upscale. Build quality presets from the detected mode.
9. **Hybrid laptops and adapter order.**
   - Desktop Duplication must run on the adapter that owns the output.
   - NVENC can't zero-copy from an iGPU texture.
   - Per-exe GPU preference can reorder EnumAdapters between PCClipper.exe and ffmpeg.exe.
   - Pick the encoder by the owning adapter's vendor and check ffmpeg's log against our enumeration.
10. **Desktop Duplication interruptions.** Mode changes, UAC prompts and the secure desktop, lock screen, GPU driver resets and HDR toggles make DDA fail (access-lost class errors) and ffmpeg exit. The controller must detect exit, restart the pipeline, keep segment numbering continuous, and surface repeated failures. Details belong to the ffmpeg investigator.
11. **HDR desktops.** 8-bit capture of an HDR desktop needs tone mapping. Detect with IDXGIOutput6 (ColorSpace 12) and handle or warn.
12. **SmartScreen and Smart App Control.**
    - Unsigned exe: SmartScreen "Run anyway" on first runs of each new build.
    - Smart App Control: hard block with no override, for both our exe and an unsigned ffmpeg build without reputation.
    - Possible machine-learning false positives.
    - Plan for code signing (Artifact Signing, about $10/month), pin and hash-check ffmpeg, and map error codes 4551 and 225 to friendly messages.
13. **Controlled folder access and OneDrive.** Controlled folder access can block writes to Videos and Pictures (catch `UnauthorizedAccessException` and explain). OneDrive-redirected Videos can upload huge clips; show the resolved path.
14. **Disk space and wear.**
    - 60 minutes at 100 Mbit/s needs about 45 GB for the buffer, plus up to as much again for a 1-hour save.
    - Check space before starting and before each save. Stop gracefully when the disk fills.
    - At 4 h/day and 100 Mbit/s the buffer writes about 66 TB a year: fine for a 600 TBW drive (about 9 years), significant for 220–300 TBW drives.
    - Offer an HDD buffer location and a "buffer only while a game runs" option.
15. **Buffer location.** `%TEMP%` can be purged by Storage Sense or cleaners; use `%LOCALAPPDATA%\PCClipper\buffer`. Single-file native libraries extract to `%TEMP%\.net` at start-up, which is normal behaviour.
16. **Autostart edge cases.**
    - A moved exe leaves a stale Run path; refresh it on start.
    - A Task Manager "disable" leaves the Run value in place but disabled through StartupApproved; read it.
    - An elevated mode can't autostart through the Run key.
17. **Single-instance races.** Create the Show event immediately in the first instance. Use `Local\` names (per session); two Windows users each get their own instance and each other's hotkeys don't conflict.
18. **Executable size.** About 66 MB compressed (161 MB uncompressed) because WPF binaries ride along in the self-contained runtime. Compression adds some start-up cost; accept it, or ship framework-dependent with the .NET 8 Desktop Runtime as a prerequisite.