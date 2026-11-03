# PC Clipper research report: FFmpeg ddagrab capture, hardware encoders, 5K120 feasibility and which FFmpeg build to download

**Note on sources.** `ffmpeg.org`, `trac.ffmpeg.org`, `gyan.dev`, `learn.microsoft.com`, `docs.nvidia.com` and `arxiv.org` were blocked from this session. Instead I read:
- FFmpeg source and docs through `raw.githubusercontent.com/FFmpeg/FFmpeg/<branch>/...`, for every branch from release/7.1 to master.
- Microsoft docs through the `MicrosoftDocs/sdk-api` GitHub mirror.
- Real build archives that I downloaded and checked against their published SHA-256.

NVIDIA performance numbers come from search-engine summaries of NVIDIA's documents, and are marked that way. Current releases today (2026-11-02): FFmpeg **8.1.3, 9.0.2, and 9.1 (branch cut, not yet tagged)**. 7.1 and 8.0 are old.

---

## 0. Executive summary: changes the design needs

1. **Require FFmpeg 8.1 or newer.** [HIGH] Several things the plan needs are missing from 7.1/8.0:
   - In 7.1, `h264_amf`/`hevc_amf` reject ddagrab's frames. The error is "Format of input frames context (bgra) is not supported by AMF", because the 7.1 format map has `BGR0` but not `BGRA`.
   - In 7.1, AMF ignores forced keyframes: there is no `forced_idr` option and no `pict_type` handling.
   - `scale_d3d11` and `vpp_amf` only exist from 8.0.
   - `gfxcapture` only exists from 8.1. `release/8.0` does not contain `vsrc_gfxcapture.c`.
2. **H.264 cannot encode 5K on any vendor.** [HIGH] The limit is 4096 pixels wide on NVENC, AMD VCN and Intel. This also rules out 5120x1440 and 5120x2160 ultrawides. Above 4096 wide, the UI must force HEVC or AV1.
3. **ddagrab never recovers from `DXGI_ERROR_ACCESS_LOST`.** [HIGH] This covers UAC, the lock screen, mode changes and exclusive-fullscreen switches. ffmpeg exits, so the app needs a supervisor that restarts it with backoff. It also needs a per-run segment model, because the resolution can change after a restart.
4. **Likely ~64 fps cap at 120/144 fps.** [MEDIUM, must test on hardware first] ddagrab paces frames with `av_usleep` → winpthreads `Sleep(ms)`. Nothing in the ddagrab path calls `timeBeginPeriod`; the only call I found is in AMD's `amf_capture` source. Since Windows 10 2004, timer resolution is per-process, so ffmpeg.exe probably runs at the default 15.6 ms timer. That would cap unique frames at about 64 fps. `gfxcapture`, which is event-driven, is the escape hatch.
5. **GOP and segment settings.** [HIGH, tested locally]
   - Use `-bf 0`, an IDR every 1 s, and MP4 segments (AV1 is not supported in the MPEG-TS muxer).
   - Join with the concat demuxer plus explicit `duration` lines; this gave gapless joins.
   - B-frames produced 10–40 ms timestamp glitches at every join.
6. **NVIDIA driver floor differs by build.** [HIGH, from the binaries] NVENC in BtbN n8.1 and gyan 8.1.1 needs driver ≥ **570**. gyan 9.0.2 and BtbN 9.0/master need ≥ **610**. Recommended primary: the pinned BtbN n8.1.3 monthly build (URLs and SHA-256 in section 6).
7. **Zero-copy needs the monitor's GPU and the encoder's GPU to be the same.**
   - On Optimus laptops, and on desktops with the monitor in the motherboard port, Desktop Duplication (DDA) cannot run on the dGPU (`DXGI_ERROR_UNSUPPORTED`). Either encode on the iGPU (QSV/AMF), use `gfxcapture` on the dGPU, or use a download/upload path.
8. **Wrong color tags on some paths.** Paths that convert RGB to YUV inside a filter keep the RGB tags on the frame. That gives a wrong VUI and tinted video. Fix it with `setparams` or the filter's own color options (section 3).

---

## 1. ddagrab: options, timestamps, pacing, static screens, ACCESS_LOST

**Source:** `vsrc_ddagrab.c`, `https://raw.githubusercontent.com/FFmpeg/FFmpeg/release/8.1/libavfilter/vsrc_ddagrab.c`. It is byte-identical in 8.1, 9.0, 9.1 and master.
- 7.1 → 8.0: only a typo fix and the `FFFilter` struct refactor.
- 8.0 → 8.1: `extra_hw_frames` support, and a render-target fix for texture-array frames.

**Options and defaults** (from the source option table) [HIGH]:

| option | type | default | notes |
|---|---|---|---|
| `output_idx` | int | 0 | `IDXGIAdapter::EnumOutputs` index **on the device's adapter** |
| `draw_mouse` | bool | 1 | Draws the hardware cursor with a D3D11 shader. A software cursor drawn by the game is captured anyway. |
| `framerate` | rate | 30 | Maximum rate. Also becomes the link `frame_rate`. |
| `video_size` | size | full output | Crops from the bottom/right. Width/height are clamped to the raw size minus the offset. |
| `offset_x`, `offset_y` | int | 0 | Relative to that output's top-left corner |
| `output_fmt` | enum | `8bit` (= `bgra`, DXGI_FORMAT_B8G8R8A8_UNORM) | Also `auto` (offers FP16, 10-bit and BGRA), `10bit`/`x2bgr10`, `16bit`/`rgbaf16` |
| `allow_fallback` | bool | 0 | Lets a requested 10/16-bit format fall back to 8-bit without failing |
| `force_fmt` | bool | 0 | Leaves BGRA out of the format list ("discouraged by Microsoft") |
| `dup_frames` | bool | 1 | Duplicates frames to keep the rate up |
| (generic) `extra_hw_frames` | int | – | 8.1+: makes a fixed pool of 8+N frames (a texture array) |

**Output format**
- Always `AV_PIX_FMT_D3D11` hardware frames. The underlying software format is `bgra` (8-bit), `x2bgr10` or `rgbaf16`.
- Frames are tagged full range, BT.709 primaries, colorspace RGB, transfer sRGB (or linear for FP16).
- With the default `8bit`, only BGRA is offered to `DuplicateOutput1`. If the desktop is HDR or FP16, DXGI converts it (see section 8).

**Timestamps** [HIGH]
- The output time base is **1/1,000,000 (microseconds)**.
- `pts = av_gettime_relative() - first_pts`. This is **wall-clock based** (monotonic clock on Windows: `clock_gettime(CLOCK_MONOTONIC)`, or `QueryPerformanceCounter`), **not a frame counter**.
- The first frame has pts ≈ 0.
- A new frame gets the time just after `AcquireNextFrame` returns.
- A duplicated frame gets the pacing deadline time.
- Result: slightly jittery, essentially VFR timestamps. The ffmpeg CLI picks CFR automatically for the `segment` and `mp4` muxers, because they lack `AVFMT_VARIABLE_FPS`. Set `-fps_mode cfr -r N` explicitly anyway.

**Frame pacing** [HIGH]
- The next deadline is the previous deadline plus 1/framerate, in exact rational arithmetic.
- The filter calls `av_usleep()` until the deadline.
- If it is more than one interval late, it skips exactly one interval per call. It never bursts to catch up.
- `AcquireNextFrame` timeout = `round(1000/fps)/2` ms: 8 ms at 60 fps, 4 ms at 120, 3 ms at 144.
- There is **no background buffering**. If the encoder is slow, ddagrab is simply not polled; the CLI's CFR stage then inserts duplicates (`dup=` in the stats rises).
- **Windows caveat:** in this build, `av_usleep` → winpthreads `nanosleep` → `Sleep(ms)` (checked in mingw-w64 `winpthreads/src/time.c` and `thread.c`). Neither ffmpeg.c nor ddagrab calls `timeBeginPeriod`. I checked the strings in the BtbN 8.1 binaries: the only `timeBeginPeriod` user is `amf_capture` (`vsrc_amf.c`, comment: "need to increase precision for capture timing accuracy").
- So with the default 15.625 ms timer, each pacing sleep wakes on a tick, which gives about **64 unique frames/s at most**. I'm not sure this happens on real machines; verify it (test recipe in section 7).

**Static screen** [HIGH]
- `AcquireNextFrame` times out → `EAGAIN`.
- With `dup_frames=1`, the last frame is sent again as a reference (no GPU copy) with a new pts.
- With `dup_frames=0`, the filter loops until the desktop changes. This wait has no upper bound; avoid it.
- If only the mouse moved (`LastPresentTime==0`), the filter sends a copy of the last desktop texture with the new cursor drawn.

**Startup** [HIGH]
- `config_props` runs `probe_output_format`, which loops `do { AcquireNextFrame } while (EAGAIN)` with **no timeout**.
- The app needs a startup watchdog: kill ffmpeg if there is no progress after about 10 s, for example when the monitor is asleep.

**ACCESS_LOST and similar errors** [HIGH; source + Microsoft docs + a real project]
- Any `AcquireNextFrame` failure other than timeout logs `AcquireNextFrame failed: 887a0026` and returns `AVERROR_EXTERNAL`. `DDA ReleaseFrame failed` may also be logged.
- A size or format change logs `Output parameters changed!` (`AVERROR_OUTPUT_CHANGED`).
- No version re-creates the duplication.
- With `-filter_complex`, the filtergraph thread fails ("Error requesting a frame from the filtergraph" / "Terminating thread with error"). The scheduler stops, **the trailers are still written** (the current segment is finalized; `fftools/ffmpeg.c` `transcode()` calls `of_write_trailer` after `sch_stop`), and ffmpeg exits non-zero.
- With `-f lavfi -i ddagrab`, the error shows up as a demux error, which is treated as end of input. ffmpeg may then exit 0, so treat **any** exit the app did not request as a failure.
- Per Microsoft: duplication becomes invalid on a desktop switch (UAC, lock screen), a mode change, or a switch to or from DWM/full-screen apps. While the secure desktop is showing, `DuplicateOutput` returns `E_ACCESSDENIED` (ffmpeg logs "Desktop duplication access denied"), so keep retrying with backoff.
- A real replay app hit exactly this. The Toru project's PR #133 saw `AcquireNextFrame failed: 887a0026` and `DDA ReleaseFrame failed` with fullscreen games. Their fix: exponential backoff (1 s → 30 s), and switching to gfxcapture after two failures.

Sources:
- The source file above, plus `fftools/ffmpeg_filter.c`, `ffmpeg_sched.c` and `ffmpeg.c` at release/9.1.
- https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/dxgi1_2/nf-dxgi1_2-idxgioutputduplication-acquirenextframe.md
- https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/dxgi1_2/nn-dxgi1_2-idxgioutputduplication.md
- https://github.com/StephenSHorton/toru/pull/133
- mingw-w64 `winpthreads/src/time.c` and `thread.c` (raw GitHub)

---

## 2. Choosing the adapter and monitor (including a second GPU)

**How it works** [HIGH, source]
- If the filter has no `hw_device_ctx`, ddagrab calls `av_hwdevice_ctx_create(D3D11VA, NULL)`. That is `D3D11CreateDevice(NULL, D3D_DRIVER_TYPE_HARDWARE)`, the DXGI default adapter (normally the primary display's GPU; on hybrid laptops Windows' per-app GPU preference can change this).
- `output_idx` is passed to `IDXGIAdapter::EnumOutputs` on **that device's adapter**, so it is **per adapter** and starts at 0. Monitors on other GPUs cannot be reached.
- In the `d3d11va` device string, `N` is an `IDXGIFactory::EnumAdapters` index.
- Alternatively, `vendor_id=0x10de` picks the first adapter of that vendor (present in 7.1+).
- `-f lavfi -i ddagrab` **cannot** receive a device: `libavdevice/lavfi.c` has no hardware-device plumbing.
- With `-filter_complex`, `graph_parse()` gives the device to every filter flagged `AVFILTER_FLAG_HWDEVICE`. The device is the one named by `-filter_hw_device`, otherwise the last one initialized (with a warning if more than one exists).

Working pattern (the monitor is output 0 of adapter 1):
```
ffmpeg -init_hw_device d3d11va=dda:1 -filter_hw_device dda -filter_complex "ddagrab=output_idx=0:framerate=60[v]" -map "[v]" -c:v hevc_nvenc ... out.mp4
ffmpeg -init_hw_device d3d11va=dda,vendor_id=0x10de -filter_hw_device dda -filter_complex "ddagrab=output_idx=0[v]" ...
```

**Rules and failure modes**
- If you pass a d3d11 device created on the wrong adapter, `DuplicateOutput` returns `E_INVALIDARG` (ffmpeg: "Invalid output duplication argument") or `DXGI_ERROR_UNSUPPORTED` (ffmpeg: "Selected output not supported").
- On hybrid laptops, duplication on the dGPU fails with `0x887a0004` by design (Microsoft KB3019314). Capture on the iGPU, or use gfxcapture.
- The adapter order in the C# process can differ from ffmpeg.exe's when Windows "Graphics settings" holds different per-app GPU preferences. Don't set a preference for ffmpeg.exe.
- To confirm the right GPU was used, check ffmpeg's log for `Using device %04x:%04x (name).` (INFO, printed when an adapter index is given) and `Opened dxgi output N with dimensions WxH` (VERBOSE).
- With zero-copy, the encoder uses the frames' D3D11 device. So the encoder must be on the same GPU as the monitor: NVENC for NVIDIA, AMF for AMD, QSV for Intel.
- For the cross-GPU fallback (monitor on the iGPU, NVENC on the dGPU), add `-init_hw_device cuda=nv:0`. `fftools` attaches a hardware device to the encoder by walking its config list, and NVENC lists CUDA before D3D11VA; without a CUDA device, NVENC would grab the iGPU's d3d11 device and fail. [HIGH, `ffmpeg_enc.c hw_device_setup_for_encode`]

Sources:
- `libavutil/hwcontext_d3d11va.c`, `fftools/ffmpeg_hw.c`, `fftools/ffmpeg_filter.c`, `libavdevice/lavfi.c` (release/7.1 and 9.1)
- https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/dxgi1_2/nf-dxgi1_2-idxgioutput1-duplicateoutput.md
- https://support.microsoft.com/en-us/help/3019314
- https://www.freemancw.com/2020/11/desktop-duplication-on-hybrid-graphics-systems/

---

## 3. Zero-copy pipelines, GPU scaling and pixel-format conversion

Legend: **S** = verified in source or binary; **D** = an FFmpeg documentation example; **I** = inferred from source and not run on hardware.

| Encoder | Native resolution (no scaling) | GPU scaling / RGB→YUV | Status |
|---|---|---|---|
| NVENC h264/hevc/av1 | `ddagrab[v]` straight into the encoder. NVENC accepts D3D11 BGRA and converts to 4:2:0 internally (`rgb_mode=yuv420`, the default). FFmpeg writes VUI matrix = BT.470BG (BT.601), limited range. | `scale_d3d11=width=W:height=H:format=nv12` (8.0+; D3D11 video processor; output must be `nv12` or `p010`; the default fails). **CUDA cannot be used**: `hwcontext_cuda` has no D3D11 interop (derive only from Vulkan), so `hwmap=derive_device=cuda` + `scale_cuda` does not work. | native D+S; scale_d3d11 S, untested on NVENC (I) |
| AMF h264/hevc/av1 | `ddagrab[v]` straight in (**8.0+ only**; 7.1 errors). D: FFmpeg's gfxcapture example feeds D3D11 BGRA into `h264_amf`. | `vpp_amf=w=W:h=H:format=nv12:color_profile=bt709:color_range=studio` (8.0/8.1) or `...:out_color_range=studio` (9.x). It sets the output frame's color tags. There is no `scale_amf`. | native D (8.1+); vpp_amf I |
| QSV h264/hevc/av1 | `ddagrab,hwmap=derive_device=qsv,format=qsv,vpp_qsv=format=nv12:out_color_matrix=bt709:out_range=tv`. hwcontext_qsv can derive from D3D11 dynamic pools (BGRA→RGB4); the QSV encoders take only QSV frames. | Add `w=W:h=H` to `vpp_qsv`, or use `scale_qsv=w=W:h=H:format=nv12` | I (no public ddagrab+QSV example found) |
| libx264 (CPU) | `ddagrab,hwdownload,format=bgra,scale=w=W:h=H:out_color_matrix=bt709:out_range=tv,format=nv12` | Better on 8.0+: `ddagrab,scale_d3d11=width=W:height=H:format=nv12,hwdownload,format=nv12,setparams=...` (the GPU does the RGB→YUV conversion and scaling; only NV12 crosses PCIe) | D (doc shows `hwdownload,format=bgra`) + I |

**Color tags you must fix** [S]
- `scale_d3d11` copies the input frame's tags (RGB, full range) onto its NV12 output.
- Per Microsoft's `D3D11_VIDEO_PROCESSOR_COLOR_SPACE` defaults, the video processor converts with **BT.601**, conventional (16–235) YCbCr.
- So after `scale_d3d11`, add `setparams=range=tv:colorspace=smpte170m:color_primaries=bt709:color_trc=iec61966-2-1`. `setparams` is metadata-only and passes hardware frames. Otherwise the stream is flagged matrix=GBR, full range, and players show a green/purple tint. [MEDIUM: drivers may not follow the API default; check with a color-bar capture.]
- `vpp_qsv` keeps the input's RGB tags unless `out_color_matrix`/`out_range` are given [S].
- Do **not** put `-colorspace`/`-color_range` on the output for hardware pipelines. Since 7.1 the CLI takes the encoder's color properties from the frames and forwards requested values into the filtergraph format negotiation [S]. Tag inside the graph instead.

Other notes:
- Media Foundation (`h264_mf`/`hevc_mf`) accepts D3D11 NV12 in 8.0+ [S]. With `scale_d3d11`, this is a vendor-agnostic hardware fallback (limited rate-control options). [I]
- D3D12 encoders exist in 8.1+, but there is no D3D11→D3D12 map from ddagrab. Skip them.

Sources:
- `vf_scale_d3d11.c`, `hwcontext_cuda.c`, `hwcontext_qsv.c`, `vf_vpp_qsv.c`, `vf_vpp_amf.c`, `vf_amf_common.c`, `hwcontext_amf.c`, `amfenc.c` (7.1 vs 8.0), `nvenc.c`, `mfenc.c` (raw GitHub, per branch)
- https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/d3d11/ns-d3d11-d3d11_video_processor_color_space.md

---

## 4. Encoder limits, AV1 support and 5K120 feasibility

**Maximum resolution**
- **H.264 is 4096 on all three vendors.** [HIGH]
  - AMD AMF wiki: H.264 "4K" for VCN 2.0–5.0; HEVC 8K for VCN 3.0+; AV1 8K for VCN 4.0/5.0.
  - Intel media-driver table: AVC encode 4k (4096x4096) on every platform; HEVC 16k on DG2 and newer; AV1 8k with **NV12/P010 input only**.
  - NVENC: H.264 is limited to 4096 (from NVIDIA's support matrix; not fetched directly). FFmpeg checks `NV_ENC_CAPS_WIDTH_MAX` and fails with `Width %d exceeds %d`. NVENC HEVC and AV1 allow 8192x8192.

**AV1 encode support** [HIGH/MEDIUM]
- NVIDIA: Ada (RTX 40) and Blackwell (RTX 50) only.
- AMD: VCN 4.0 (RX 7000, Ryzen 7040+ APUs) and VCN 5.0 (RX 9000). On AMD, AV1 runs on **one** VCN instance.
- Intel: Arc A/B series (DG2, BMG) and Meteor Lake or newer iGPUs (MTL/LNL/PTL). Not Tiger/Alder/Raptor Lake.

**Pixel-rate math**
- 5120x2880@120 = **1.77 Gpx/s**: 14.2× 1080p60, 0.89× 8K60, about 853 "1080p frames per second".
- 5120x1440@120 = 0.88 Gpx/s.
- 4K120 = 1.0 Gpx/s.

**Throughput evidence and verdict**

| GPU | Evidence | 5K120 verdict |
|---|---|---|
| RTX 30 (Ampere, 1 NVENC, no AV1, no split-frame encoding) | NVENC application note 12.1, table 3 (per NVENC, 1080p, P1, CBR, LL): HEVC 875 fps, H.264 810 fps [MEDIUM, via search summary] | HEVC P1 at 5K is about 123 fps *theoretical*: no headroom. **Plan 5K60 or 4K120.** [MEDIUM] |
| RTX 40 with 2 NVENC (4070 Ti and up), RTX 50 with 2–3 NVENC (5070 Ti and up; 5090 has 3) | NVIDIA: Ada does 8K60 10-bit HEVC/AV1 using split-frame encoding (SFE) across two NVENCs. SFE applies to HEVC/AV1 only, needs height ≥2112 (HEVC) or ≥2048 (AV1), and turns on automatically at p1–p2 with HQ tuning or p1–p4 with LL tuning above 2160p. | **Feasible** with HEVC/AV1, p1–p4 + `-tune ll`, `-split_encode_mode auto/forced`. [MEDIUM; the per-SKU NVENC counts need checking in NVIDIA's support matrix] |
| RTX 40/50 with 1 NVENC | No SFE | Borderline; test, and expect 5K60. [LOW-MEDIUM] |
| RX 7900 XT/XTX | AMD claim (PCWorld): 4K H.264/HEVC up to 180 fps (1.49 Gpx/s), AV1 up to 240 fps (1.99 Gpx/s) | AV1 5K120 is plausible at `-quality speed`; HEVC is about 100 fps max. [LOW-MEDIUM] |
| RX 9000 (VCN 5.0, 1 instance) | No numbers found | I'm not sure; test. |
| Intel Arc | Resolution support only; no fps data found | I'm not sure; test. |
| CPU (libx264) | Tested locally on a 4-core Xeon 2.1 GHz: 1080p60 superfast about 105 fps, 1440p about 62 fps | 5K is impossible. Cap CPU mode at 1080p60–1440p60. |

**NVENC split-frame encoding in FFmpeg** [HIGH, source]
- Option: `-split_encode_mode disabled|auto|forced|2|3[|4]`, default `auto`.
- Exists on `hevc_nvenc` and `av1_nvenc` (7.1+), **not on `h264_nvenc`**. Passing an option an encoder doesn't have is a fatal error.

**Practical caveat:** most 5120x2880 monitors are 60 Hz. DDA cannot give more unique frames than the refresh rate. Cap the capture fps at the monitor's refresh rate.

Sources:
- https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/GPU-and-APU-HW-Features-and-Support
- https://github.com/intel/media-driver/blob/master/docs/media_features.md
- https://docs.nvidia.com/video-technologies/video-codec-sdk/12.1/nvenc-application-note/
- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/nvenc-video-encoder-api-prog-guide/index.html
- https://obsproject.com/kb/advanced-nvenc-options
- https://developer.nvidia.com/blog/improving-video-quality-and-performance-with-av1-and-nvidia-ada-lovelace-architecture
- https://www.pcworld.com/article/1434166/amd-rdna-3-radeon-rx-7900-xtx-content-creation-review.html
- `nvenc_hevc.c` / `nvenc_av1.c` (release/7.1, 9.1)

---

## 5. Rate control, presets, GOP flags and B-frames

**What the code actually does** [HIGH, source]
- **NVENC:** `gopLength = -g`, `idrPeriod = gopLength`, so every GOP starts with an IDR. Forced keyframes from `-force_key_frames` become IDR with `-forced-idr 1`. Only IDR packets get the keyframe flag, so the segment muxer cuts only on IDRs.
- **AMF H.264:** `-g` sets `IDR_PERIOD`.
- **AMF HEVC:** `-g` sets `GOP_SIZE`, with `-gops_per_idr` (default 1).
- **AMF AV1:** `-g` sets `GOP_SIZE`.
- AMF `forced_idr` (8.0+) turns forced I-frames into IDR or KEY frames and inserts SPS/PPS or a sequence header. Only IDR/KEY packets are flagged as keyframes.
- **QSV:** `GopPicSize = -g`, `GopRefDist = bf+1`, `-flags +cgop` gives a closed GOP.
  - `h264_qsv -idr_interval 0`: every I-frame is an IDR.
  - `hevc_qsv`: FFmpeg adds 1 internally, so the default 0 also means every I-frame is an IDR.
  - `forced_idr` applies to all three. Only IDR/xIDR packets are flagged as keyframes.
- **QSV with no bitrate given defaults to CQP** (Changelog). Always pass `-b:v`. `maxrate > b:v` gives VBR; equal values give CBR.

**Recommended rate control**
- Peak-constrained VBR: `-b:v T -maxrate 1.5T -bufsize 2T`. Per encoder: NVENC `-rc vbr`, AMF `-rc vbr_peak`, QSV via maxrate.
- Suggested targets (HEVC/AV1; H.264 about 1.5×):
  - 1080p60: 20–30 Mb/s
  - 1440p60: 30–45 Mb/s; 1440p144: 50–70 Mb/s
  - 4K60: 60–90 Mb/s; 4K120: 100–150 Mb/s
  - 5K120: 150–250 Mb/s
  - [LOW, engineering judgement]
- Disk use ≈ Mb/s × 0.45 GB per hour of buffer: **5K120 at 200 Mb/s ≈ 90 GB per 60-min buffer**.
- HEVC above 120 Mb/s at 5K: use `-tier high` (nvenc) or `-profile_tier high` (amf). Main tier at level 6.1 tops out at 120 Mb/s.

**Presets**
- NVENC (p1 fastest … p7):
  - ≤1440p: `-preset p5 -tune hq`
  - 4K60: `-preset p4 -tune hq`
  - ≥4K120 or 5K: `-preset p4 -tune ll -split_encode_mode auto` (HEVC/AV1)
  - Single-NVENC GPUs: p1–p2
  - Valid `-tune` values: hq, uhq, ll, ull, lossless.
  - Avoid the old `-rc vbr_hq` style names; 9.0 removed deprecated options.
- AMF: `-usage transcoding` with `-quality balanced` (≤1440p) or `speed` (≥4K120). `-preanalysis 0`.
- QSV: `-preset medium` at 1080p, `faster`/`veryfast` at ≥1440p120. `-async_depth 4`.

**IDR at least every second**
- Use `-g <fps>` and `-force_key_frames "expr:gte(t,n_forced*1)"`, plus the encoder's forced-IDR flag. Also disable adaptive I-frames: NVENC has no lookahead with `-rc-lookahead 0`; QSV `-adaptive_i 0 -adaptive_b 0`.
- A 2-s GOP would reduce keyframe "pumping" at 5K if 1 s turns out too costly.

**Are B-frames a problem?** [HIGH, tested locally with ffmpeg 6.1.1 + libx264, closed GOP, 2-s segments, 1-s keyframes]
- Each MP4/TS segment from the segment muxer decodes on its own, with or without B-frames.
- Concat demuxer, `-c copy`, **no** duration lines: ~20–40 ms video gaps at every join (because audio ends ~21 ms after video in each segment). Over a 1-h buffer this drift adds up.
- Concat demuxer **with** `duration <end-start>` taken from `-segment_list` CSV:
  - `-bf 0` → gapless (6.000 s video exactly, continuous audio).
  - `-bf 3` → still about 11 ms gaps and audio overlaps at joins.
- Byte-concat of TS (`concat:` protocol) keeps the timestamps exactly but logs "Packet corrupt" warnings at joins (decode was fine).
- AV1 is **not supported in the mpegts muxer** (no `AV_CODEC_ID_AV1` in `mpegtsenc.c`, 7.1–9.1). AV1 in MP4 segments + concat worked.
- **Recommendation:** `-bf 0` on every encoder, MP4 segments, `-reset_timestamps 0`, concat demuxer with duration lines. Note that NVENC HQ presets use B-frames unless `-bf 0` is given.

Sources:
- `nvenc.c`, `amfenc*.c`, `qsvenc*.c`, `qsvenc.h`, `segment.c`, `mpegtsenc.c` (release/9.1); Changelog
- Tested locally (commands in the appendix of section 7). Results:
  - `seg_bf0_mp4/out_dur.mp4`: video 6.000000, no gaps
  - `seg_bf3_mp4/out_dur.mp4`: gaps at 2.015→2.027
  - `seg_av1_mp4/out.mp4`: av1 6.000000, decode-ok

---

## 6. Prebuilt Windows builds: contents, URLs, layout and size

I downloaded the archives and checked them against their published SHA-256. Contents were read from the embedded configure line and filter/encoder name strings.

| Build | ddagrab | gfxcapture | scale_d3d11 / vpp_amf / vpp_qsv | nvenc / amf / qsv | libx264 | NVENC min. driver | Download |
|---|---|---|---|---|---|---|---|
| **BtbN n8.1.3 gpl-shared** (2026-10-31) | yes | yes | yes / yes / yes | yes / yes / yes (libvpl) | yes (+x265, svt-av1) | **570.0** | 85.5 MB zip (shared DLLs) |
| BtbN n8.1.3 gpl (static) | same | same | same | same | same | 570.0 | 185 MB zip |
| **gyan 8.1.1 essentials** (2026-05-04) | yes | yes | yes | yes | yes (+x265, no svt-av1) | **570.0** | 109 MB zip, single static ffmpeg.exe of 101 MB |
| gyan 9.0.2 essentials (2026-09-20) | yes | yes (+amf_capture) | yes | yes | yes | **610.00** | 114.8 MB zip |
| gyan "full" | I'm not sure; the full archive wasn't inspected (it is a superset of essentials per its name) | | | | | | 246 MB (9.0.2) |

Notes on these builds:
- BtbN builds daily. "latest" carries only **master, n9.0 and n8.1** right now; 7.1/8.0 have already left "latest". Per BtbN's README, the last build of each month is kept for 2 years.
- BtbN's build script uses nv-codec-headers SDK 13.0 for FFmpeg ≤ 8.1 (driver ≥570) and SDK 13.1 for 9.0+ (driver ≥610).

**Primary download (pinned monthly build, retained about 2 years)**
- URL: `https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-shared-8.1.zip`
- SHA-256: `3adc00b67118a8c4bdd6624a000e139df283b1eeb8b126fcec4849bd5b778dd4` (verified)
- Layout: `ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-shared-8.1/bin/{ffmpeg.exe, ffprobe.exe, ffplay.exe, avcodec-62.dll, avdevice-62.dll, avfilter-11.dll, avformat-62.dll, avutil-60.dll, swresample-6.dll, swscale-9.dll}` plus `include/`, `lib/`, `doc/`, `presets/`, `LICENSE.txt`. Extract all of `bin/` into one folder.
- Static alternative: `.../autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip`, SHA-256 `401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f`.

**Fallback download (different publisher, same feature level and driver floor)**
- URL: `https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip`
- SHA-256: `6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541` (verified; matches the winget manifest)
- Layout: `ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe` (static), plus `ffprobe.exe`, `ffplay.exe`, `README.txt`, `LICENSE`.

**Moving links** (avoid, or verify the hash at runtime)
- `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip`: it changes daily, and the n8.1 entry will disappear once BtbN drops 8.1.
- gyan.dev's `https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip`: moving, and unverified here because the host is blocked.

**Licensing:** the archives are GPLv3 (`--enable-version3`). Downloading on first run from the original publisher avoids redistributing them.

Sources:
- https://github.com/BtbN/FFmpeg-Builds (README, `.github/workflows/build.yml`, `scripts.d/50-ffnvcodec.sh`, `50-amf.sh`, `50-onevpl.sh`, `50-x264.sh`, `util/repack_latest.sh`)
- https://github.com/BtbN/FFmpeg-Builds/releases/tag/latest
- The `autobuild-2026-10-31-12-59` release and its `checksums.sha256`
- https://github.com/GyanD/codexffmpeg/releases
- `microsoft/winget-pkgs` manifests `Gyan.FFmpeg.Essentials/8.1.1`, `9.0.1`, `8.0.1`
- nv-codec-headers README at the commits BtbN pins

---

## 7. gfxcapture (Windows.Graphics.Capture)

**Availability:** FFmpeg **8.1+** (Changelog entry "version 8.1: gfxcapture"; absent in release/8.0). The Toru PR's "8.0+" is wrong. Present in both recommended builds. [HIGH]

**Options** (8.1–9.1) [HIGH, source]
- `window_title`, `window_class`, `window_exe`: ECMAScript regex; `(?i)` supported.
- `monitor_idx`: `EnumDisplayMonitors` order, or `window`.
- `hwnd`, `hmonitor`: raw handles. These override everything else. Prefer passing the HMONITOR from C#.
- `capture_cursor` = 1, `capture_border` = 0, `display_border` = 0 (the yellow border).
- `max_framerate` = **60**. Set it.
- `width`/`height` = 0 (the initial size), plus crop_left/top/right/bottom.
- `premultiplied` = 0, `resize_mode` = crop | scale | scale_aspect, `scale_mode` = point | bilinear | bicubic, `output_fmt` = bgra | x2bgr10 | rgbaf16.
- `dup_frames` (default 1) exists **only on master** (after 9.1).
- Output: D3D11 frames, time base 1/10,000,000, pts = `SystemRelativeTime` − first. It is VFR; add `fps=N`.
- When the window closes or the monitor is disconnected: "Capture item closed" → EOF, which ends ffmpeg gracefully.

**Advantages over ddagrab for games** [MEDIUM]
- Event-driven (FrameArrived plus a condition variable), not `Sleep`-paced, so it should avoid the ~64 fps issue.
- The output canvas stays fixed when the source size changes (crop/scale modes), so encoder parameters survive game resolution changes.
- Can capture a single window, including occluded ones.
- WGC copies across adapters, so on hybrid laptops you can capture with the dGPU's D3D11 device and feed NVENC zero-copy. [MEDIUM; this is how OBS's WGC capture behaves]
- No ACCESS_LOST death on UAC.

**Disadvantages**
- On 8.1–9.1, static content produces no frames, so `fps=` stalls and segments stop being cut while the screen is static.
- The yellow border can't be disabled before Windows 11 / build 20348 (`IGraphicsCaptureSession3`; FFmpeg warns "Disabling border drawing unavailable").
- Without `IGraphicsCaptureSession5` (`MinUpdateInterval`, Windows 11 24H2+), FFmpeg warns "framerate may be limited". I'm not sure what the real cap is.
- Window capture of true exclusive-fullscreen games may be black or frozen; prefer monitor capture.
- Needs Windows 10 1903+.
- DRM-protected content is black, same as DDA.

**Test recipe for the 64 fps question** (do this on real hardware first): play a game at ≥120 fps on a ≥120 Hz monitor and run each line for 10 s.
```
ffmpeg -init_hw_device d3d11va=dda:0 -filter_hw_device dda -filter_complex "ddagrab=output_idx=0:framerate=144:dup_frames=0[v]" -map "[v]" -fps_mode passthrough -t 10 -c:v hevc_nvenc -preset p1 -f null -
ffmpeg -init_hw_device d3d11va=dda:0 -filter_hw_device dda -filter_complex "gfxcapture=monitor_idx=0:max_framerate=144[v]" -map "[v]" -fps_mode passthrough -t 10 -c:v hevc_nvenc -preset p1 -f null -
```
The final `frame=` count divided by 10 is the unique capture rate. About 64 means the timer cap is real. Then prefer gfxcapture for ≥90 fps, or document the registry option `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\kernel\GlobalTimerResolutionRequests=1` (Windows 11, admin, reboot) together with the app calling `timeBeginPeriod(1)`. [LOW-MEDIUM]

Sources:
- `vsrc_gfxcapture.c`, `vsrc_gfxcapture_winrt.cpp` (release/8.1, 9.1, master)
- `doc/filters.texi`; Changelog
- https://github.com/StephenSHorton/toru/pull/133

---

## 8. Known real-world problems and mitigations

- **ACCESS_LOST** (UAC, lock screen, fullscreen mode switch, resolution change, GPU TDR/driver update `887a0005`): ffmpeg exits. Supervise: healthy if the run lasted ≥20 s; otherwise back off 1 s → 2 → 4 → … 30 s. After two quick failures, switch to gfxcapture if `-filters` lists it. Show a tray notice. (Toru PR #133.) [HIGH]
- **GPU at 100% (GPU-bound game):** DWM composition, DDA copies and NVENC's internal RGB→YUV all compete. Symptoms: `dup=` rising, stutter.
  - Mitigations: cap the game's fps or leave headroom (most effective); `Process.PriorityClass = AboveNormal/High` for ffmpeg; optionally `D3DKMTSetProcessSchedulingPriorityClass(ffmpegHandle, HIGH or REALTIME)`, which OBS uses (REALTIME without HAGS, HIGH with HAGS; it logs "failed (not admin?)" otherwise, so it needs admin); avoid extra GPU filters (record at native resolution when possible).
  - [MEDIUM; OBS `libobs-d3d11/d3d11-subsystem.cpp`]
- **`-thread_queue_size`** applies only to `-i` inputs (the audio pipe, or a lavfi device). It does nothing for `-filter_complex` sources. Raising queues of hardware frames costs ~59 MB of VRAM per 5K BGRA frame. [HIGH]
- **HDR desktops:** the default `output_fmt=8bit` makes DXGI convert the FP16 desktop to BGRA, so captures look washed out or clipped. In C#, detect `IDXGIOutput6.Desc1.ColorSpace == RGB_FULL_G2084_NONE_P2020` and warn. For v1, record SDR only (`10bit`/`16bit` capture needs PQ/BT.2020 conversion that FFmpeg's D3D11 path doesn't provide). [MEDIUM]
- **G-Sync/VRR:** unique frames equal the frames actually presented. CFR duplication adds judder below the target fps; this is inherent. [MEDIUM]
- **Cursor:**
  - A cursor-trail/stutter bug was fixed in FFmpeg commit b47abd5 (March 2024), so use a build ≥7.0.
  - Expose a `draw_mouse` toggle.
  - Screenshots: DDA's alpha channel is undefined, so convert to `rgb24` before PNG. [MEDIUM]
- **Session limits:** a maximum of 4 processes can use DDA at once ("Too many open duplication sessions"; OBS/Discord count). GeForce NVENC also has a concurrent-session limit (I'm not sure of the current number). [HIGH for DDA]
- **Rotated (portrait) monitors:** ddagrab rotates only the cursor coordinates, not the image, so portrait monitors are likely captured sideways. Use gfxcapture there. [LOW-MEDIUM, inferred from source]
- **Static or asleep display at startup:** ffmpeg can hang in the probe step. Use a watchdog. [HIGH, source]
- **Monitors with mixed refresh rates:** OBS's high-fps recording guide reports encode lag with them. Test. [LOW]

Sources:
- https://github.com/BtbN/FFmpeg-Builds/issues/347
- https://raw.githubusercontent.com/obsproject/obs-studio/master/libobs-d3d11/d3d11-subsystem.cpp
- Microsoft `DuplicateOutput` doc (limit of 4)
- https://obsproject.com/forum/resources/how-to-troubleshoot-high-fps-recordings-120-144-240-300-fps-recording.1433

---

## Recommended exact command lines / code

Pass arguments with `ProcessStartInfo.ArgumentList`, one item per token, with no shell quoting. Filtergraph strings below are single arguments. Do **not** pass `-nostdin`; you need stdin to send `q`. Placeholders: `{A}` adapter index, `{O}` output index, `{F}` fps, `{W}x{H}` output size, `{T}`/`{M}`/`{B}` bitrate / maxrate / bufsize, `{DIR}` segment folder.

**Common head**
```
-hide_banner -loglevel info -stats_period 1 -progress pipe:1
-init_hw_device d3d11va=dda:{A} -filter_hw_device dda
-thread_queue_size 1024 -f f32le -ar 48000 -ac 2 -i \\.\pipe\pcclipper_audio_{RUNID}
```

**Common tail**
```
-map [v] -map 0:a -fps_mode cfr -r {F}
-force_key_frames expr:gte(t,n_forced*1) -g {F}
-c:a aac -b:a 192k -max_muxing_queue_size 4096
-f segment -segment_time 2 -segment_format mp4 -reset_timestamps 0
-segment_list {DIR}\list.csv -segment_list_type csv {DIR}\seg_%06d.mp4
```

**Video graph and encoder, per vendor**

NVENC, native resolution (8.1+; HEVC/AV1 for >4096 wide):
```
-filter_complex ddagrab=output_idx={O}:framerate={F}:draw_mouse=1:dup_frames=1[v]
-c:v hevc_nvenc -preset p4 -tune ll -rc vbr -b:v {T} -maxrate {M} -bufsize {B} -profile:v main -tier high -bf 0 -forced-idr 1 -rc-lookahead 0 -no-scenecut 1 -split_encode_mode auto
```
- AV1: `-c:v av1_nvenc` with the same options minus `-profile:v` and `-tier`.
- H.264 (≤4096 wide): `-c:v h264_nvenc -preset p5 -tune hq -rc vbr -b:v {T} -maxrate {M} -bufsize {B} -profile:v high -bf 0 -forced-idr 1 -rc-lookahead 0 -no-scenecut 1`. Never pass `split_encode_mode` to h264_nvenc.

NVENC with GPU scaling (8.0+):
```
-filter_complex ddagrab=output_idx={O}:framerate={F}:draw_mouse=1,scale_d3d11=width={W}:height={H}:format=nv12,setparams=range=tv:colorspace=smpte170m:color_primaries=bt709:color_trc=iec61966-2-1[v]
```

AMF (8.1 option names; on 9.x use `out_color_range=studio`):
```
-filter_complex ddagrab=output_idx={O}:framerate={F}:draw_mouse=1,vpp_amf=w={W}:h={H}:format=nv12:color_profile=bt709:color_range=studio[v]
-c:v hevc_amf -usage transcoding -quality speed -rc vbr_peak -b:v {T} -maxrate {M} -bufsize {B} -gops_per_idr 1 -header_insertion_mode idr -forced_idr 1 -preanalysis 0 -profile_tier high
```
- H.264: `-c:v h264_amf -usage transcoding -quality balanced -rc vbr_peak -b:v {T} -maxrate {M} -bufsize {B} -bf 0 -forced_idr 1 -preanalysis 0 -profile:v high`
- AV1: `-c:v av1_amf -usage transcoding -quality speed -rc vbr_peak -b:v {T} -maxrate {M} -bufsize {B} -bf 0 -forced_idr 1 -header_insertion_mode frame -preanalysis 0`
- To skip vpp_amf, use `ddagrab=...[v]` directly (8.0+ accepts BGRA). The color then follows the frame tags (RGB/full range); verify.

QSV:
```
-filter_complex ddagrab=output_idx={O}:framerate={F}:draw_mouse=1,hwmap=derive_device=qsv,format=qsv,vpp_qsv=w={W}:h={H}:format=nv12:out_color_matrix=bt709:out_range=tv[v]
-c:v hevc_qsv -preset faster -b:v {T} -maxrate {M} -bufsize {B} -bf 0 -idr_interval 0 -forced_idr 1 -flags +cgop -adaptive_i 0 -adaptive_b 0 -look_ahead_depth 0 -async_depth 4
```
- H.264: `h264_qsv`, same options plus `-look_ahead 0`.
- AV1: `av1_qsv`, same options minus `-idr_interval`.

CPU fallback (≤1440p60):
```
-filter_complex ddagrab=output_idx={O}:framerate={F}:draw_mouse=1,scale_d3d11=width={W}:height={H}:format=nv12,hwdownload,format=nv12,setparams=range=tv:colorspace=smpte170m:color_primaries=bt709:color_trc=iec61966-2-1[v]
-c:v libx264 -preset veryfast -profile:v high -b:v {T} -maxrate {M} -bufsize {B} -bf 0 -keyint_min {F} -sc_threshold 0
```
- If `scale_d3d11` fails: `ddagrab=...,hwdownload,format=bgra,scale=w={W}:h={H}:out_color_matrix=bt709:out_range=tv,format=nv12[v]`

Cross-GPU (monitor on iGPU adapter {A}, encode on NVIDIA): add `-init_hw_device cuda=nv:0` after the d3d11va device, keep `-filter_hw_device dda`, use `ddagrab=...,hwdownload,format=bgra[v]`, then the `hevc_nvenc` options.

gfxcapture fallback (8.1+; laptops, high fps, after ACCESS_LOST loops; use `-filter_hw_device` on the *encoder's* GPU):
```
-filter_complex gfxcapture=hmonitor={HMONITOR}:max_framerate={F}:capture_cursor=1:display_border=0,fps={F}[v]
```

**Screenshot** (separate process, ~0.2–0.5 s):
```
ffmpeg -hide_banner -y -init_hw_device d3d11va=dda:{A} -filter_hw_device dda -filter_complex ddagrab=output_idx={O}:framerate=10:draw_mouse=1,hwdownload,format=bgra,format=rgb24 -frames:v 1 -update 1 -compression_level 3 "{path}.png"
```

**Concat for "save last N"** (tested): write a list file with lines `file '<abs path>'` and `duration <end-start>` (from list.csv), then:
```
ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart out.mp4
```
Only concatenate segments from the same run, with identical codec, resolution and fps.

**Self-test before enabling a preset.** Run the real graph with `-t 5 -f null -` instead of the segment output. Parse the `-progress` keys `fps=`, `speed=`, `dup_frames=`, `drop_frames=`. Pass if speed ≥ 0.98 and dup growth ≤ 2%; otherwise step down: preset, then fps, then resolution.

**stderr patterns** (all present in the 8.1 binaries):

| Pattern | Action |
|---|---|
| `AcquireNextFrame failed: 887a0026` / `DDA ReleaseFrame failed` | restart |
| `Desktop duplication access denied` | secure desktop: retry with backoff |
| `Too many open duplication sessions` | tell the user to close other recorders |
| `Selected output not supported` / `Invalid output duplication argument` | wrong adapter: change adapter or use gfxcapture |
| `Failed to enumerate DXGI output` | bad index |
| `Output parameters changed!` | restart at the new size |
| `Driver does not support the required nvenc API version` / `The minimum required Nvidia driver for nvenc is` | ask for a driver update or change encoder |
| `OpenEncodeSessionEx failed` | — |
| `Width %d exceeds %d` | resolution too large for the encoder |
| `Format of input frames context (bgra) is not supported by AMF` | FFmpeg too old |
| `Capture item closed` | gfxcapture source gone |

**C# adapter and output enumeration** (Vortice.DXGI 3.x; names may need small adjustments):
```csharp
using Vortice.DXGI; using static Vortice.DXGI.DXGI;
public record Target(int Adapter, string Gpu, uint VendorId, int Output, string DeviceName,
                     int X, int Y, int W, int H, IntPtr HMonitor, ModeRotation Rot, bool Hdr);
public static List<Target> EnumerateTargets() {
  var list = new List<Target>();
  using IDXGIFactory1 f = CreateDXGIFactory1<IDXGIFactory1>();
  for (uint a = 0; f.EnumAdapters1(a, out IDXGIAdapter1 ad).Success; a++) using (ad) {
    var d = ad.Description1; if ((d.Flags & AdapterFlags.Software) != 0) continue; // 0x1414 = MS Basic
    for (uint o = 0; ad.EnumOutputs(o, out IDXGIOutput op).Success; o++) using (op) {
      var od = op.Description; var r = od.DesktopCoordinates; bool hdr = false;
      using (var o6 = op.QueryInterfaceOrNull<IDXGIOutput6>())
        if (o6 != null) hdr = o6.Description1.ColorSpace == ColorSpaceType.RgbFullG2084NoneP2020;
      list.Add(new((int)a, d.Description, d.VendorId, (int)o, od.DeviceName,
                   r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top, od.Monitor, od.Rotation, hdr));
    }
  }
  return list; // {A}=Adapter, {O}=Output; DeviceName matches Screen.DeviceName; VendorId 0x10DE NVIDIA, 0x1002 AMD, 0x8086 Intel
}
```
- The encoder family follows the monitor adapter's `VendorId`.
- Get the refresh rate from `EnumDisplaySettings(DeviceName)` and cap `{F}` to it.
- After starting, confirm in ffmpeg's log: `Using device ...` and `Opened dxgi output ...`.

**Local test commands** (Linux, ffmpeg 6.1.1): segment with `-c:v libx264 -bf {0|3} -g 60 -force_key_frames expr:gte(t,n_forced*1) -f segment -segment_time 2 -segment_format {mp4|ts} -segment_list list.csv -segment_list_type csv`, then concat as above, then check frame pts gaps with `ffprobe -show_entries frame=pts_time`. Results are in section 5. The work files are in `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/ddagrab/`.

---

## Risks the design must handle

1. **ffmpeg dies on ACCESS_LOST, UAC, lock screen, mode or resolution change, or GPU reset.** Needed: supervisor, backoff, gfxcapture fallback, startup watchdog, and per-run segment folders or IDs. Resolution can change after a restart, so always scale to a fixed output size (scale_d3d11 / vpp_* / gfxcapture `width`/`height`), or never concat across runs.
2. **Capture may cap at ~64 unique fps** (the `Sleep`-based pacing). Run the test recipe from section 7 on day one. If confirmed, use gfxcapture for ≥90 fps.
3. **H.264 cannot go above 4096 wide on any vendor**, so 5K and 5120-wide ultrawides need HEVC/AV1. HEVC/AV1 at 5K needs HEVC level 6.1 high tier or AV1, and many PCs can't play 5K120 smoothly. HEVC playback in Windows' built-in apps needs the paid HEVC extension.
4. **5K120 is only realistic on dual-NVENC RTX 40/50 (HEVC/AV1 with split-frame encoding) and possibly RX 7900 (AV1 at "speed").** Every other GPU should drop to 5K60 or 4K120 via the self-test. Most 5K monitors are 60 Hz, so cap fps at the refresh rate.
5. **Disk and SSD wear.** A 60-min buffer at 5K120/200 Mb/s is about 90 GB, written continuously at about 25 MB/s (about 2 TB/day). Check free space, put the buffer on a fast drive, and warn the user.
6. **Hybrid laptops, monitors on the iGPU port, and per-app GPU preferences** break zero-copy or the adapter index. Detect the vendor per output, and pick QSV/AMF, gfxcapture on the dGPU, or the download path (with `-init_hw_device cuda`).
7. **Driver floors.** NVENC needs ≥570 with the 8.1 builds and ≥610 with 9.0+ builds. Parse the error and fall back to another encoder or the CPU.
8. **FFmpeg version differences.** vpp_amf option names changed in 9.0. gfxcapture `dup_frames` exists only on FFmpeg master (committed 2026-10-24; not in 8.1.x, 9.0.x or release/9.1). 7.1 AMF rejects BGRA. Read the version from `ffmpeg -version` and capabilities from `-filters`/`-encoders` at runtime, and never pass an option the chosen encoder lacks (it is fatal).
9. **Color tagging** on scale_d3d11 / vpp_qsv / AMF paths. Verify on each vendor by recording a known color pattern and checking with ffprobe and a player.
10. **HDR desktops** give washed-out SDR captures. Detect and warn.
11. **Session limits:** a maximum of 4 DDA processes, plus GeForce's NVENC session limit. The screenshot process counts while recording.
12. **A/V offset.** ddagrab pts start at its first frame, and the raw-PCM pipe's pts start at its first packet. Any startup skew becomes a constant offset. Coordinate with the audio design and test with a flash/clap.
13. **Static screens with gfxcapture on 8.1–9.1** stop the stream, so segments stop being cut. Prefer ddagrab when idle, or use the `fps` filter and accept the gaps.
14. **Moving download URLs.** Use the pinned monthly URLs and SHA-256s from section 6. BtbN drops old branches from "latest".
15. **VRAM.** 5K BGRA frames are ~59 MB each, and the pools (ddagrab, scale_d3d11 with 10 frames, NVENC surfaces) add up to several hundred MB on top of the game.