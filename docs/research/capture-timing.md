# Capture timing: why 1.0.1 clips stuttered and what 1.0.2 changed

Research done for 1.0.2 (four investigations, each re-checked by an independent skeptic) from FFmpeg source at
n8.1/n8.1.1/master, mingw-w64 winpthreads v11–v14 source, and disassembly of the two pinned ffmpeg builds
(gyan 8.1.1 essentials, BtbN n8.1.3 autobuild). **Nothing here was measured on Windows hardware.**

## ddagrab pacing (the likely cause)

- `vsrc_ddagrab.c` (identical in n8.1, n8.1.1, master), `ddagrab_request_frame`: advance the slot clock by one slot
  (+1 more if more than a slot behind), `av_usleep(delay)` while the slot is in the future, then `AcquireNextFrame`
  with a timeout of half a slot in whole ms (`av_rescale_q` rounds: 16/8/4 ms at 30/60/120, 1 ms for 500–666, 0 for
  667+). `frame->pts = av_gettime_relative() - first_pts` after the acquire (QPC, precise). With `dup_frames=1` a
  timeout re-sends the last frame; with `dup_frames=0` it loops on EAGAIN inside the same call.
- `av_usleep` → `nanosleep` (winpthreads) in both builds → whole ms → `Sleep`/`WaitForSingleObject`; gyan's build checks
  the deadline with `GetTickCount64`, so its wake-ups stay on the 15.6 ms tick even with a raised timer resolution.
- Nothing in ffmpeg.exe calls `timeBeginPeriod` (only `vsrc_amf.c`). Since Windows 10 2004 PC Clipper's own call does
  not reach the child process.
- Result (model): grabs at 15.6/31.25 ms gaps; `fps=F` then repeats/skips: ~4 hitches/s at 60 fps on a 60 Hz panel,
  ~33/s on 144 Hz, ~44/s on 240 Hz; at 120 fps only ~64 different frames/s. "Test my PC" counted frames, not spacing.
- Rejected fixes: injecting `timeBeginPeriod(1)` into ffmpeg with `CreateRemoteThread` (does not help gyan's
  GetTickCount64 deadline; looks like code injection to antivirus/anti-cheat); `GlobalTimerResolutionRequests` registry
  value (Windows 11 only, admin + reboot, same gyan flaw); `framerate=666:dup_frames=1` (can catch up and sleep again;
  gyan's 1–1.5 ms sleeps stall to the next tick); changing the frame rate alone.
- **Chosen**: `framerate=666:dup_frames=0`, then one frame per 1/F slot (`select` + `setpts` snap, no fps filter). The
  slot clock advances ≤3 ms per delivered frame, so with presents spaced >3 ms (<333 Hz) it never sleeps (presents only;
  pointer-only updates also produce frames and their rate is unmeasured); each present is acquired on arrival with a
  precise timestamp. Cost: no frames on a completely still screen (`CaptureConfig.PausesOnStillScreen`), every present
  copied.
- First draft kept `fps=F` after the event-driven source. The review showed (vf_fps.c: it reads no input while it holds
  two frames and emits clones as fast as the encoder takes them; the encoder queue holds 2 frames) that after a still of
  P seconds it emits P*F repeats in one burst, during which ddagrab isn't polled: live motion afterwards came out as a
  slideshow for about P*r/(1-r) s (r = F / encoder fps); a FIFO repro gave ~8 s after a 20 s still. Per-slot select
  never repeats, so there is no backlog; the stream is variable-rate where nothing changed. Encoder frame rate:
  `-enc_time_base:v 1/F` + `setpts=PTS:strip_fps=1` (NVENC/AMF/QSV/x264 fall back to the time base when the frame rate is
  unset: nvenc.c 1873-1878, amfenc_h264.c 210-213, qsvenc.c 751-756, libx264.c 1313-1318); `-r F` is fatal with
  passthrough (ffmpeg_mux_init.c 783-789).

## gfxcapture (Windows Graphics Capture) in 8.1

- Event-driven (FrameArrived), pts = compositor `SystemRelativeTime`; 2-buffer pool; `max_framerate` (default 60) is only
  `MinUpdateInterval`, Windows 11 24H2+; exactly 1/F can drop composed frames → 1.0.2 passes 25% headroom.
- Still screen: nothing comes; fps holds, then bursts; segments can't cut; scheduler stops reading audio after 100 ms.
  Upstream `dup_frames` for gfxcapture is master-only (2026-10-24).
- `display_border=0` needs `IsBorderRequired` (Windows 11); Windows 10 always shows the yellow border.

## GPU priority

- `gdi32!D3DKMTSetProcessSchedulingPriorityClass(hProcess, HIGH=4)` works on a child handle without admin (field
  reports; undocumented). REALTIME needs `SeIncreaseBasePriorityPrivilege` and has NVIDIA freezes with HAGS. OBS uses
  HIGH under HAGS, skips Intel. Benefit unmeasured. `IDXGIDevice::SetGPUThreadPriority` is in-process only.

## Other findings from the pipeline audit

- Container/timestamps of saved clips are correct (segment → concatf → mp4: CFR, gapless joins).
- Upscaling above native multiplied encoder load and bitrate (fixed in 1.0.2: never upscale).
- Saves are multi-GB disk copies; CPU priority alone doesn't help (1.0.2: low I/O + memory priority).
- PC Clipper's dup/drop counters are always 0 with `-fps_mode passthrough`; vf_fps logs its real counts only at
  verbose level on exit. Diagnosing stutter needs a frame-spacing measurement (open item).
