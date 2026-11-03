# PC Clipper research: WASAPI capture with NAudio 2.2.1 into ffmpeg, with A/V sync

## Summary

1. **Do not start writing PCM when ffmpeg connects to the pipe.** I measured audio 1115 ms late, and the offset never changed. ffmpeg opens and probes the audio input (about 1.1 s with the default `find_stream_info`) before it starts the video graph. Audio written during that time becomes the start of the stream.
2. **How to get exact alignment:** add one filter right after the capture source: `setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'`. It prints the Unix-epoch microsecond time of video pts 0 to stderr. The app reads that line, converts it to Stopwatch/QPC time, and starts a clock that emits exactly 48000 frames per QPC second from that moment. Measured offset was −3 ms at 0 s and −3 ms at 150 s. That −3 ms is a measurement artifact: the 60 fps frame grid limits how precisely a flash can be timed.
3. **ffmpeg pulls video only as fast as the audio timestamps allow.** In my tests, audio that lagged in timestamps cut ddagrab-style capture to **12.7 fps instead of 60**. The fix:
   - write a 0.25 s silent lead-in to the pipe;
   - add `-af atrim=start_sample=12000`;
   - add `-bsf:a setts=ts=TS-0.25/TB`.

   With these, I measured 60 fps and −3 ms offset, including after cutting into 2 s segments and concatenating them.
4. **Audio must come from a clock, with drift correction per device.** An uncorrected device clock that runs 500 ppm fast drifted +0.50 ms/s. That is 72 ms over 145 s, or about 1.8 s per hour. The FIFO + resampler controller in the C# code below held drift at zero over a simulated hour, with no underruns.
5. **Two ffmpeg flag traps:**
   - Write `-nofind_stream_info`. `-find_stream_info 0` makes "0" an output filename and ffmpeg fails.
   - Do not put `-thread_queue_size` on an input. FFmpeg master removed the input form, so the command line would fail there.

**What I could not test:**
- **ffmpeg 7/8:** all experiments ran on Linux with ffmpeg 6.1.1. The sandbox blocked running a downloaded ffmpeg 7.0.2 binary, so anything I say about ffmpeg ≥7 comes from reading its source.
- **Microsoft docs:** learn.microsoft.com did not resolve in this session; I read the same pages from the MicrosoftDocs GitHub source.
- **Windows:** there is no Windows machine here, so nothing touching WASAPI or named pipes ran.

---

## 1. NAudio `WasapiLoopbackCapture` (NAudio.Wasapi 2.2.1)

**Format it delivers [HIGH for NAudio behaviour, MEDIUM for "typical" values]**
- The constructor sets `waveFormat = audioClient.MixFormat`.
- The `WaveFormat` property returns `waveFormat.AsStandardWaveFormat()`, so a WAVEFORMATEXTENSIBLE becomes a plain IEEE-float WaveFormat.
- The shared-mode mix format is almost always 32-bit IEEE float, interleaved:
  - channel count follows the speaker setup (2, 6 for 5.1, 8 for 7.1);
  - sample rate is the "Default Format" in the Sound control panel (44.1, 48, 96 or 192 kHz).
- `DataAvailable` hands you `e.Buffer`, which NAudio reuses, so copy it immediately.
- **You can request 48 kHz float stereo directly:**
  - Set `capture.WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2)` before `StartRecording()`.
  - NAudio's `GetAudioClientStreamFlags()` always adds `AutoConvertPcm | SrcDefaultQuality`. Windows then inserts its own sample-rate converter and channel matrix.
  - The NAudio 2.1 release notes say this works for `WasapiCapture` and `WasapiLoopbackCapture`.
  - I have not verified it on a real Windows machine: MEDIUM.
- Sources: [WasapiCapture.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Wasapi/WasapiCapture.cs), [WasapiLoopbackCapture.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Wasapi/WasapiLoopbackCapture.cs), [RELEASE_NOTES.md](https://github.com/naudio/NAudio/blob/v2.2.1/RELEASE_NOTES.md), [Docs/WasapiLoopbackCapture.md](https://github.com/naudio/NAudio/blob/v2.2.1/Docs/WasapiLoopbackCapture.md), and Microsoft's [AUDCLNT_STREAMFLAGS constants](https://learn.microsoft.com/en-us/windows/win32/coreaudio/audclnt-streamflags-xxx-constants) (AUTOCONVERTPCM: "A channel matrixer and a sample rate converter are inserted as necessary…").

**Buffer and latency [HIGH, from source]**
- `new WasapiLoopbackCapture()` and `new WasapiLoopbackCapture(dev)` call `base(dev)`, which means `useEventSync=false` and a 100 ms buffer.
  - The capture thread does `Thread.Sleep(50)` and then drains every packet.
  - `DataAvailable` therefore fires about every 50 ms with up to about 100 ms of audio.
- `WasapiLoopbackCapture` has no event-driven constructor. Subclass `WasapiCapture(dev, true, 20)` and override `GetAudioClientStreamFlags()` to add `Loopback`; the code is below.
  - Microsoft's [IAudioClient::Initialize remarks](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient-initialize) say event handles are set for loopback streams starting with Windows 10.
  - The [Loopback Recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording) page says event-driven loopback clients are supported in Windows 10 1703 and later.
- In event mode, NAudio waits on `WaitOne(3 × buffer)` (60 ms for a 20 ms buffer). If no event arrives it still polls, so the worst case falls back to polling.
- Default devices:
  - `WasapiLoopbackCapture()` uses `GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia)`.
  - `WasapiCapture()` uses `(DataFlow.Capture, Role.Console)`.

**The silence gap [HIGH]**
- NAudio's own documentation: "If no audio is playing whatsoever, then the DataAvailable event won't fire… use an NAudio playback device to play silence… Alternatively… insert silence yourself when you detect gaps".
- To be precise from the source: `ReadNextPacket` always calls `DataAvailable` at the end, so in polling mode you get `BytesRecorded == 0` events every 50 ms rather than no events. Either way, no audio data arrives.
- Packets flagged `AUDCLNT_BUFFERFLAGS_SILENT` are zero-filled by NAudio (`Array.Clear`).
- **Recommended fix: use both of these.**
  1. A keep-alive: `WasapiOut(dev, Shared, true, 50)` playing `NAudio.Wave.SilenceProvider`. (The class lives in the file `NAudio.Core/Wave/WaveProviders/SilenceWaveProvider.cs`.) This keeps the engine running and loopback packets flowing.
  2. The clock-driven mixer below, which outputs silence whenever a source FIFO is starved. This one is mandatory; the keep-alive is the extra layer.

  Because the timeline is driven by the clock and not by sample counts, missing or lost capture data can never shift A/V sync.

**Default-device change and unplug [HIGH from source, MEDIUM for which errors Windows raises]**
- Loopback is bound to the `MMDevice` you gave it. If the default device changes, it keeps capturing the old device (often silently) and raises no error.
- On unplug, a format change in the control panel, an exclusive-mode takeover, or a Bluetooth headset switching to its hands-free profile:
  - `GetNextPacketSize` or `GetBuffer` return `AUDCLNT_E_DEVICE_INVALIDATED` (0x88890004).
  - NAudio's `AudioCaptureClient` turns that into a `COMException`, which `CaptureThread` catches.
  - You then get **`RecordingStopped` with `e.Exception` set**.
  - `AudioClient.Stop()` and `Start()` ignore HRESULTs, so the `finally` block cannot throw a second time.
- **How to restart:**
  - Always create a new capture instance. `StartRecording` on the old one reuses the dead `AudioClient`, because `initialized` stays true.
  - Watch for default-device changes with `IMMNotificationClient`, registered through `MMDeviceEnumerator.RegisterEndpointNotificationCallback`.
  - Microsoft's rules for these callbacks: they must not block, must not register or unregister callbacks, and must not release the last reference to an MMDevice object. So the callback only schedules a debounced restart on another thread.
- `RecordingStopped` is posted to the `SynchronizationContext` that existed when the capture was constructed. Create captures inside `Task.Run`, not on the WinForms UI thread.
- Sources: [Recovering from an Invalid-Device Error](https://learn.microsoft.com/en-us/windows/win32/coreaudio/recovering-from-an-invalid-device-error), [IMMNotificationClient](https://learn.microsoft.com/en-us/windows/win32/api/mmdeviceapi/nn-mmdeviceapi-immnotificationclient), [AudioCaptureClient.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Wasapi/CoreAudioApi/AudioCaptureClient.cs), [AudioClient.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Wasapi/CoreAudioApi/AudioClient.cs).

## 2. Microphone through `WasapiCapture` (shared mode), resampling and mixing

**Format [HIGH from source, MEDIUM for typical values]**
- It delivers the capture endpoint's mix format: float32, usually 1 or 2 channels (array microphones can report 4), at 44.1 or 48 kHz. Bluetooth headsets in hands-free mode deliver 16 kHz or 8 kHz.
- Use `new WasapiCapture(dev, useEventSync: true, audioBufferMillisecondsLength: 20)` and set `WaveFormat = CreateIeeeFloatWaveFormat(48000, 2)`. Windows then does the mono-to-stereo upmix and the resampling.

**Resampling options in NAudio 2.2.1 [HIGH for the APIs, MEDIUM for quality judgements]**
1. **Windows AUTOCONVERTPCM, as above.** This is the best option.
2. **Fallback if `Initialize` refuses the format:** capture in `MixFormat` and convert in managed code.
   - `WdlResamplingSampleProvider` is fully managed and float-only. It is hard-wired to `SetMode(true, 2, false)` (linear interpolation plus IIR filters), which is mediocre quality, and its internal `WdlResampler` is private.
   - For better quality and drift correction, use `NAudio.Dsp.WdlResampler` directly, which is public. Use `SetMode(false, 0, true, 64, 32)` for sinc, and note that `SetRates` can be changed at runtime without resetting the resampler.
   - Use `MonoToStereoSampleProvider` for mono-to-stereo.
3. **Avoid `MediaFoundationResampler`.** It needs `MediaFoundationApi.Startup()` and COM, and Media Foundation is missing on Windows N/KN without the Media Feature Pack. MEDIUM.
- Sources: [WdlResampler.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Core/Dsp/WdlResampler.cs), [WdlResamplingSampleProvider.cs](https://github.com/naudio/NAudio/blob/v2.2.1/NAudio.Core/Wave/SampleProviders/WdlResamplingSampleProvider.cs).

**Mixing two sources on different device clocks [HIGH, tested in simulation]**
- Do not build this as `BufferedWaveProvider` → `MixingSampleProvider`:
  - `BufferedWaveProvider` holds 5 s by default and **throws `InvalidOperationException("Buffer full")`** on overflow unless `DiscardOnBufferOverflow` is set.
  - It has no drift control. A device running 200 ppm fast fills the buffer at about 0.72 s per hour, and that becomes audio latency, which means desync.
  - `MixingSampleProvider` removes any input that returns a short read, unless that input is set to ReadFully.
- **Use this design instead:**
  - One `DriftFifo` per device: a lock-protected ring filled by the capture thread.
  - One mixer clock (Stopwatch/QPC) that pulls exactly N frames per tick from each FIFO.
  - Each FIFO adjusts a `WdlResampler` ratio with a proportional controller on its smoothed fill level: 1 ms of error gives 50 ppm, clamped to ±2000 ppm (pitch change under 3.5 cents).
  - An underrun produces silence and the FIFO waits to refill to its target before playing again.
  - An excursion more than 200 ms above target jumps straight back to target.
- Simulated over one hour, with 10 ms packets, ±3 ms jitter, and 7 ms pull ticks (compiled with .NET 8 against NAudio.Core 2.2.1):

  | Device clock | Ratio settled at | Fill level after 5 s | Underruns |
  |---|---|---|---|
  | 0 ppm | 0.999985 | 25–41 ms | 0 |
  | +500 ppm | 1.000485 | 31–48 ms | 0 |
  | −500 ppm | 0.999485 | 15–38 ms | 0 |
  | +1500 ppm | 1.001485 | 35–68 ms | 0 |

  The fill level stays bounded, so latency stays constant and there is no drift. The simulation is at `/tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/audio-sync/fifotest/Program.cs`.

## 3. Feeding raw PCM to ffmpeg through a Windows named pipe

**Can ffmpeg open `\\.\pipe\name` as an input? [HIGH from source, not run on Windows]**
- There is no colon in the path, so ffmpeg uses the `file` protocol. `file_open` calls `avpriv_open`, which on Windows is `win32_open`, which calls `_wsopen(path, O_RDONLY|O_BINARY, SH_DENYNO)`.
- `get_extended_win32_path` → `GetFullPathNameW` leaves `\\.\` paths unchanged, and it only adds a `\\?\` prefix for paths of 260 characters or more.
- `is_streamed` is set when `fstat` reports a FIFO.
- `file_read` returns EOF when `read()` returns 0, which happens when the writer closes.
- So `-f f32le -ar 48000 -ac 2 -i \\.\pipe\pcclipper_mix_…` works.
- Sources: [libavformat/file.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/file.c) (`file_open` around line 303, `file_read` around line 147), [libavutil/file_open.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/file_open.c), [libavutil/wchar_filename.h](https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/wchar_filename.h) (`path_is_device_path`, `get_extended_win32_path`).

**.NET settings [HIGH for the API, MEDIUM for the exact error codes]**
- Create the server with `new NamedPipeServerStream(name, PipeDirection.Out, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly, 0, 1 << 20)`.
- The out-buffer size is only advisory, according to Microsoft's [CreateNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-createnamedpipea) docs.
- Use a unique name per session that includes the process ID and a GUID.
- Write from a dedicated thread fed by a queue, so the producer never blocks.

**Ordering [HIGH]**
- The server object must exist **before** ffmpeg starts. Otherwise `CreateFile` fails and ffmpeg reports "No such file or directory".
- If ffmpeg connects before you call `WaitForConnectionAsync`, that is still fine. Microsoft's [ConnectNamedPipe](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-connectnamedpipe) docs say it returns `ERROR_PIPE_CONNECTED` and "there is a good connection".
- A second client gets `ERROR_PIPE_BUSY` ([named pipe client docs](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-client)).
- Use the order: create server → start ffmpeg → wait for connection (with a timeout, and abort if the process exits).

**If ffmpeg reads before any data exists [HIGH, tested on 6.1.1]**
- ffmpeg blocks inside input opening and nothing else starts. No video, no "Input #0" line.
- Two places block:
  - `avformat_open_input` does an ID3v2 check that reads 10 bytes. In 6.1 and 7.1 this applies to every input format; in master only to ID3-flagged formats.
  - `avformat_find_stream_info` read about 1.1 s of audio before ffmpeg continued.
- Tested on Linux with a FIFO: ffmpeg printed "Input #0" only once data arrived, even with only a WAV header present.
- Recommended fix: use `-nofind_stream_info` and write the lead-in immediately on connect. Each pipe needs its own lead-in, because ffmpeg opens inputs one at a time, in command-line order.
- Sources: [demux.c](https://github.com/FFmpeg/FFmpeg/blob/n7.1/libavformat/demux.c) (n7.1 line 301), [ffmpeg_opt.c](https://github.com/FFmpeg/FFmpeg/blob/n8.0/fftools/ffmpeg_opt.c) (`find_stream_info` is an `OPT_INPUT` bool).

**Writer side when ffmpeg exits [HIGH on Linux, MEDIUM on Windows]**
- On Linux the writer got EPIPE / BrokenPipeError in every run.
- In .NET on Windows, expect `IOException` with "Pipe is broken" (109) or "The pipe is being closed" (232).
- Catch these in the writer thread and treat the session as dead.

**Stopping [HIGH on 6.1.1]**
- I sent `q` while ffmpeg was waiting on the audio pipe. It was **not acted on for 3 s** and was processed only after the pipe closed; ffmpeg then exited with code 0 and a valid file.
- So the stop sequence is: write `q` → close the pipe(s) → wait up to 10 s → kill.

## 4. A/V sync: how ffmpeg timestamps each side, and the recommended approach

**How raw PCM is timestamped [HIGH]**
- Timestamps are a sample count starting at 0. There is no clock involved.
- ffmpeg then subtracts **each input's own** start time (`ts_offset = -start_time`), so audio sample 0 and video pts 0 are both set to 0 independently. Opening the inputs one after another therefore produces an offset equal to (time of video frame 0) − (real time represented by audio sample 0).
- Packet sizes:
  - 6.1.1: 1024 samples.
  - 7.x and later: `sample_rate/10` rounded down to a power of 2, which is **4096 samples = 85.3 ms** at 48 kHz.
  - The WAV demuxer's `-max_size` can make packets smaller.
- Sources: [pcm.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/pcm.c) (`PCM_DEMUX_TARGET_FPS 10`), [wavdec.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/wavdec.c).

**How ddagrab timestamps video [HIGH, from source]**
- In `ddagrab_request_frame`, `first_pts` is set to `av_gettime_relative()` on the first request, and each frame gets `pts = av_gettime_relative() - first_pts` after `AcquireNextFrame`. The time base is 1/1000000.
- The frame timestamp is the time ffmpeg **pulled** the frame. If ffmpeg pulls late, frames are dropped or duplicated, but the timestamps stay correct.
- On Windows, `av_gettime_relative` is QueryPerformanceCounter, the same clock as .NET `Stopwatch` ([time.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/time.c)).
- Sources: [vsrc_ddagrab.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vsrc_ddagrab.c) (lines 907–927 and 1099–1233). FFmpeg 8.1's `gfxcapture` does the same thing using `SystemRelativeTime` (QPC) minus `first_pts` ([vsrc_gfxcapture_winrt.cpp](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/vsrc_gfxcapture_winrt.cpp) around line 1470), so the same method applies.

**Detecting when ffmpeg started capturing [HIGH]**
- The pipe connection time is **not** the start. The measured gap was 1126 ms with default flags. With `-nofind_stream_info` and a lead-in it was 3.4 ms in my simulation; on Windows it will be larger and unknown, because of DXGI and NVENC setup.
- Progress lines appear only every 0.5 s by default and only after the muxer has started, so they are too coarse.
- **Use the print instead:** `setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'`.
  - `RTCTIME` is `av_gettime()`, Unix-epoch microseconds.
  - `print` writes `"%f\n"` with no prefix at log level 24.
  - `setpts` has no format negotiation (it is flagged metadata-only), so it passes D3D11 hardware frames through.
  - The line arrived 0.014–0.063 ms after the frame in my runs.
  - The app converts it with a `DateTime.UtcNow`/Stopwatch pair. As a sanity check, if the result is not within the 500 ms before the line arrived, use the line's arrival time instead. This covers ffmpeg builds with a coarse realtime clock: newer mingw-w64 uses `GetSystemTimePreciseAsFileTime`, older ones a clock with about 15 ms resolution ([mingw-w64 gettimeofday.c](https://mingw.googlesource.com/mingw-w64/+/refs/heads/v13.x/mingw-w64-crt/misc/gettimeofday.c)). MEDIUM.
- Use the `-filter_complex` form. With `-f lavfi -i ddagrab…`, print `RTCTIME` instead, because that form subtracts the input's start time; the difference is at most half a frame.
- Sources: [setpts.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavfilter/setpts.c) (lines 57 and 179), [eval.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavutil/eval.c) (line 238).

**How ffmpeg ties video pulling to audio timestamps — critical [HIGH on 6.1.1 tested, MEDIUM on 7.x/8.x from source]**
- **ffmpeg 6.1:** the main loop always serves the output stream with the lowest timestamp. Video stamped "now" is always ahead of audio that arrives with latency, so video is pulled about once per audio latency. Measured: 12.7 fps instead of 60, with frame gaps of 83 ms.
- **ffmpeg 7.x/8.x:** the scheduler ([ffmpeg_sched.c](https://github.com/FFmpeg/FFmpeg/blob/master/fftools/ffmpeg_sched.c)) behaves like this:
  - `SCHEDULE_TOLERANCE` is 100 ms (line 45).
  - A stream whose last timestamp is ≥100 ms ahead of the slowest stream has its source paused. So is any stream that has output while another stream has none yet (lines 1420–1510).
  - A source-only filter graph like ddagrab in `-filter_complex` waits in `waiter_wait` while paused (lines 2551–2585). ddagrab is then not pulled and frames are lost.
  - The 85 ms PCM packets plus AAC encoder delay make audio lag by more than 100 ms likely.
- **The fix — make audio lead:**
  - The 0.25 s lead-in makes audio the leading stream. In 7.x+ the scheduler then pauses the audio reader instead, which is harmless: the data waits in the pipe and the app queue.
  - The scheduler records each stream's last timestamp in `send_to_mux` (line ~2010), **before** the muxer thread runs bitstream filters ([ffmpeg_mux.c](https://github.com/FFmpeg/FFmpeg/blob/master/fftools/ffmpeg_mux.c) line 314). So `setts` removes the lead from the file without the scheduler seeing it removed.
  - `atrim` removes the 12000 lead-in samples, so no audio timestamps go negative; AAC priming is unchanged.

**Evaluation of the options you listed**

| Option | Verdict |
|---|---|
| `-use_wallclock_as_timestamps 1` (audio) | Stamps each packet with `av_gettime()` when the demuxer finishes reading it ([demux.c](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/demux.c) line 588). That is late by capture latency + packet length, and jittery. ffmpeg still subtracts each input's start time. **Measured +52 to +64 ms.** Don't use. [HIGH] |
| `-copyts` | PCM (relative to sample 0) and ddagrab (relative to its first frame) share no common zero. With wallclock audio plus `setpts=RTCTIME` video (my R6 run): **+40 to +60 ms with jitter, 46.8 fps.** Don't use. [HIGH] |
| `-itsoffset` | Adds a constant, but the startup gap is unknown at launch. Usable only as an alternative way to create the lead (`-itsoffset 0.25` plus a 16-byte pre-roll). [HIGH] |
| `-thread_queue_size` | Not related to sync. **Do not put it on inputs:** master accepts it as an output option only ([ffmpeg_opt.c](https://github.com/FFmpeg/FFmpeg/blob/master/fftools/ffmpeg_opt.c) line 1836); 8.0 still accepts both. [HIGH] |
| `aresample=async=1:first_pts=0` | Stretches or pads audio to match its timestamps. With sample-count timestamps it does nothing; with wallclock timestamps it follows the arrival jitter. Not needed ([resampler.texi](https://github.com/FFmpeg/FFmpeg/blob/master/doc/resampler.texi)). [HIGH] |
| `-fflags +genpts` | PCM packets already have timestamps; no effect on alignment. [MEDIUM] |
| `-af asetpts=N/SR/TB` | Re-stamps by sample count, which is the default for PCM anyway. It does not fix the start offset. [HIGH] |

**The recommended approach [HIGH on 6.1, MEDIUM on ≥7]**
1. Create the pipe(s).
2. Start ffmpeg with `-nofind_stream_info` and the print filter.
3. When each pipe connects, write 12000 zero frames (0.25 s).
4. Read the print line to get V0 in QPC time.
5. Start the mixer. It emits sample `12000 + k` at QPC time `V0 + L + k/48000`, where L is the FIFO target plus device latency, about 55 ms. When a source is starved, it emits silence.
6. In ffmpeg, `atrim` and `setts` remove the 0.25 s lead.
7. If the clock jumps by more than 5 s (system sleep), or the pipe queue fills or breaks, restart the session. Do not emit a huge burst of silence and do not drop samples.

## 5. Local experiment (Linux, ffmpeg 6.1.1)

**Setup**
- Video: `testsrc2=960x540:60,realtime,settb=1/1000000,setpts=RTCTIME-C,drawbox(white, enable when mod(t,5)<0.1),setpts=PTS-STARTPTS` plus the print filter. This copies ddagrab's behaviour (timestamp = wallclock at pull time, relative to the first frame), and the flash fires on absolute 5 s wallclock boundaries.
- Audio: a Python producer writing f32le 48 kHz to a FIFO, paced by the monotonic clock, with 40 ms of simulated capture latency. It plays a 1 kHz beep for 100 ms on the same absolute 5 s boundaries.
- Encoding: libx264 ultrafast + AAC, `-fps_mode passthrough`, with millisecond video time base.
- Measurement: flash onsets with `signalstats` YAVG > 200; beep onsets with a threshold on the decoded PCM.
- Offset = beep − flash (positive means audio is late). The measurement has a constant bias of 0 to −16.7 ms from the 60 fps frame grid.

**Results**

| Run | Setup | Offset at start | Offset at end | Video fps |
|---|---|---|---|---|
| R1 | Plain: write from connect, default flags | **+1115.2 ms** | +1115.2 ms (t = 144 s) | 60.0 |
| R2 | Anchored by print, no lead | −0.2 to −78 ms (scatter from low fps) | same | **12.7** |
| R3 | Recommended: anchor + 0.25 s lead + setts | **−2.9 ms** | **−2.9 ms** (t = 145 s) | 60.0 |
| R3b | R3 + `atrim=start=0.25` | −3.1 ms | −3.1 ms (t = 90 s) | 60.0 |
| R4 | R3 + uncorrected +500 ppm device clock | −8.0 ms | **+64.5 ms** (0.50 ms/s) | 60.0 |
| R5 | Plain + `-use_wallclock_as_timestamps 1` + `aresample=async=1` | +52 ms | +60 to +64 ms | 60.0 |
| R6 | All wallclock + `-copyts` | +40 to +60 ms (jitter) | same | 46.8 |
| R7 | R3b with two pipes (separate tracks) | −6.5 ms on both tracks | −6.5 ms (t = 59 s) | 60.0 |
| R8 | R3b → 2 s mpegts segments → concat segments 10–24 → MP4 | −4.0 ms | −0.7 ms | 60.0 |

R7 note: the second pipe connected 0.6 ms after the first pipe received its bytes.

The exact ffmpeg command for R3b:
```
ffmpeg -hide_banner -nostats -loglevel info -thread_queue_size 4096 -nofind_stream_info -f f32le -ar 48000 -ac 2 -i R3b.fifo -filter_complex "testsrc2=size=960x540:rate=60,realtime,settb=1/1000000,setpts=RTCTIME-<C_us>,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,5),0.1)',setpts=PTS-STARTPTS,setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'[v]" -map "[v]" -map 0:a -af atrim=start=0.25 -bsf:a setts=ts=TS-0.25/TB -c:v libx264 -preset ultrafast -g 120 -pix_fmt yuv420p -fps_mode passthrough -enc_time_base:v 1:1000 -c:a aac -b:a 160k -y R3b.mp4
```
(`-thread_queue_size` was in every test command; drop it in production, see Q4.)

The R8 concat step was `ffmpeg -f concat -safe 0 -i list.txt -map 0 -c copy -movflags +faststart clip.mp4`. It kept sync. The mpegts segments add a common +1.4 s offset to both streams, which is harmless.

**Limits of this simulation**
- It ran ffmpeg 6.1.1, which does not have the 7.x+ scheduler; the 7.x behaviour above comes from the source only.
- There is no GPU, no NVENC latency, and no `AcquireNextFrame` wait (up to half a frame).
- The simulated video uses the realtime clock, not QPC.
- Linux FIFO `open()` blocks until both ends are open, whereas a Windows client `CreateFile` succeeds immediately once the server exists. Pipe buffer sizes also differ.
- The producer is synthetic, with no WASAPI jitter. In the real app, the error in the latency estimate L becomes a constant offset, so offer a user "A/V offset" setting.
- The print line arrived within under 0.1 ms on Linux; on Windows the RTC value is used, so this matters little.

## 6. Optional second audio track (mic) [HIGH on 6.1.1, tested in R7]

- Use two inputs, each with `-nofind_stream_info -f f32le -ar 48000 -ac 2 -i \\.\pipe\…`, then `-map "[v]" -map 0:a -map 1:a`.
- One `-af atrim=start_sample=12000` and one `-bsf:a setts=…` cover both audio streams.
- Optionally add `-metadata:s:a:N title=…` and `-disposition:a:1 0`.
- The extra risks:
  - Each pipe needs its own lead-in as soon as it connects.
  - Both pipes must be written by the **same** mixer tick with the same sample index, so they cannot drift apart.
  - Use a separate writer thread and queue per pipe, because ffmpeg may pause one input while reading the other.
  - Many players only play track 1, so make track 1 the desktop + mic mix and track 2 the mic alone.

---

## Recommended exact command lines and code

**ffmpeg capture.** The audio parts are prescribed; the video encoder and segment arguments belong to the video design. Build it with `ProcessStartInfo.ArgumentList`, not a quoted string.
```
-hide_banner -loglevel info
-nofind_stream_info -f f32le -ar 48000 -ac 2 -i \\.\pipe\pcclipper_mix_<pid>_<guid>
[-nofind_stream_info -f f32le -ar 48000 -ac 2 -i \\.\pipe\pcclipper_mic_<pid>_<guid>]
-filter_complex "ddagrab=output_idx=0:framerate=60:draw_mouse=1,setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'<,hw/scale filters…>[v]"
-map [v] -map 0:a [-map 1:a]
<video encoder args>
-c:a aac -b:a 192k
-af atrim=start_sample=12000
-bsf:a setts=ts=TS-0.25/TB
<-f segment … out_%06d.ts>
```
- Do **not** add `-nostdin`, because `q` is sent on stdin.
- Do **not** add `-copyts` or `-use_wallclock_as_timestamps`.
- Do **not** write `-find_stream_info 0`.
- Do **not** put `-thread_queue_size` on an input.
- Keep `print(…,24)` visible: use `-loglevel warning` or more verbose.

**C# code**
- Six classes, about 630 lines, compiled with `dotnet build` (0 warnings) against NAudio.Wasapi 2.2.1 and NAudio.Core 2.2.1 for `net8.0-windows`. Copy the files as they are, plus `Example.cs`, which shows the full wiring.

| File | What it does |
|---|---|
| `DriftFifo.cs` | Per-device jitter buffer with the `WdlResampler` sinc drift controller and silence on underrun (verified by the simulation in Q2) |
| `CaptureSource.cs` | `EventLoopbackCapture` subclass (`base(dev, true, 20)` with the `Loopback` flag); requests 48 kHz float stereo; silent `WasapiOut` keep-alive; restart on `RecordingStopped` with an exception; debounced `RequestRestart` |
| `DeviceWatcher.cs` | `IMMNotificationClient`: default render device / Multimedia → restart loopback; default capture device / Communications → restart mic; state change or removal of a pinned device → restart |
| `ClockedMixer.cs` | QPC clock, `due = base + floor((now − anchor) × 48000 / Frequency)`, chunks of up to 100 ms, `timeBeginPeriod(1)` + `Sleep(2)`; fires `Fatal` if more than 5 s is owed or the pipe queue is full |
| `PcmPipe.cs` | The pipe server shown above, a writer thread, a bounded queue of 4000 chunks, and `Complete()` that flushes then closes (ffmpeg sees EOF) |
| `AvSyncSession.cs` | Start sequence (connect → pre-roll → read V0 → `mixer.Start(V0 + OutputLatency, 12000)`), stderr reader, RTC-to-QPC conversion with sanity fallback, stop sequence (`q` → close pipes → wait 10 s → kill) |

Files are in /tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/audio-sync/csharp:
- AudioSync.csproj
- AvSyncSession.cs
- CaptureSource.cs
- ClockedMixer.cs
- DeviceWatcher.cs
- DriftFifo.cs
- Example.cs
- PcmPipe.cs

The lines that carry the design:
```csharp
public const string VideoPrintFilter = "setpts='PTS+0*if(eq(N,0),print(RTCTIME-T*1000000,24),0)'";
public static string[] AudioInputArgs(string pipePath) =>
    new[] { "-nofind_stream_info", "-f", "f32le", "-ar", "48000", "-ac", "2", "-i", pipePath };
public static string[] AudioOutputArgs(string extraFilter = "") => new[] {
    "-af", $"atrim=start_sample={PrerollFrames}" + (extraFilter.Length > 0 ? "," + extraFilter : ""),
    "-bsf:a", string.Create(CultureInfo.InvariantCulture, $"setts=ts=TS-{LeadSeconds}/TB") };
// stderr: ^(?:\[[^\]]*\]\s*)*(\d{13,20})\.\d+\s*$  -> rtcUs (Unix-epoch us of video pts 0)
long t = qpcNow - (long)((utcNowUs - rtcUs) * Stopwatch.Frequency / 1e6);   // fallback to line-arrival time if outside [arrival-0.5s, arrival]
_mixer.Start(V0Ticks + (long)(OutputLatencyMs * Stopwatch.Frequency / 1000.0), PrerollFrames);   // OutputLatencyMs ≈ FIFO target 40 + 15
```
**Calibration:** if clips have audio late by d ms, increase `OutputLatencyMs` by d; if audio is early, decrease it.

## Risks the design must handle

1. **ffmpeg version differences.**
   - 6.1 pulls video strictly by the lowest timestamp; 7.x+ uses the 100 ms tolerance; the raw PCM packet size changed from 1024 to 4096 samples.
   - Input `-thread_queue_size` is gone in master.
   - The ID3 read at open is unconditional in 6.1/7.1 and gated in master.
   - Pin one ffmpeg build. Validate the lead on it: ddagrab fps should hold at target while you play audio. Raise `LeadSeconds` to 0.5 if video stutters while CPU and GPU are idle.
2. **Never drop or skip samples on the way to ffmpeg.** If the queue is full, the pipe is broken, or the clock jumps (system sleep or hibernate), restart the ffmpeg session and its segment set. Also hook `SystemEvents.PowerModeChanged`.
3. **Device events:** unplug, format change, exclusive-mode takeover, a Bluetooth headset switching from A2DP to hands-free when the mic opens, and DRM content that loopback returns as silence. Handle them with a new capture instance and debounced restarts; the clock carries silence in the meantime.
4. **If the app crashes, an orphaned ffmpeg keeps recording.** Audio goes to EOF but ddagrab continues. Put ffmpeg in a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
5. **Thread contexts.**
   - Create the NAudio objects off the UI thread.
   - Never block in `IMMNotificationClient` callbacks.
   - The `DataAvailable` handler must only copy data, because an exception thrown there stops the capture.
6. **Timer granularity.** Use `timeBeginPeriod(1)` in the mixer; otherwise `Sleep` granularity is about 15.6 ms, which adds latency jitter but not drift. The mixer allocates many small arrays; pool them if GC shows up.
7. **The latency estimate L is a constant guess** (about 55 ms), so its error becomes a constant A/V offset. Expose a user offset setting.
8. **ffmpeg realtime clock precision on Windows** depends on the mingw build. The sanity fallback to line-arrival time limits the error to about 1 ms of pipe latency.
9. **Pipe security and uniqueness:** use `CurrentUserOnly` and a per-session GUID name, so two app instances never share a pipe.
10. **Stopping:** `q` alone can hang while ffmpeg's demuxer is blocked in a pipe read. Always close the pipes after sending `q`, then kill after a timeout.

Experiment scripts and results are in /tmp/claude-0/-home-user/475cdaf1-36e4-5dd2-9a43-3107e5826cd3/scratchpad/research/audio-sync/exp:
- run.py
- measure.py
- R1_plain.mp4.json … R8 (one `.json` log per run)