# Avengers Player

A Windows video player that starts *Avengers: Endgame* by itself at **9:29:30 PM on December 31**, keeps the film
locked to the clock for the whole two and a half hours, and lands the snap on **12:00:00 AM**.

**[Download the installer](../download/Avengers-Player-Setup-1.0.0.exe)** (Windows 10 / 11, 64-bit, about 93 MB).
You bring your own copy of the movie. Nothing is uploaded anywhere.

![The player with the countdown running](docs/player.png)

## Install

1. Run `Avengers-Player-Setup-1.0.0.exe`. It installs for your user only, so there is no administrator prompt.
2. Windows may show a blue box, "Windows protected your PC". That appears for any new app that is not signed by a
   company. Click **More info → Run anyway**. (If *Smart App Control* is switched on, Windows offers no such button.)
3. Start **Avengers Player** from the desktop or the Start menu.

## On the night

1. **Import the movie.** Drop the file on the window or click to browse.
2. Click **START THE COUNTDOWN**. You can do this days ahead: the movie waits for December 31.
3. Press **F** for fullscreen. A standby screen counts down to the start.
4. Walk away. At 9:29:30 PM the movie starts by itself.

The app remembers the armed countdown. If it is closed, crashes or the PC restarts, open it again and it loads the
movie and jumps to exactly where the clock says the film should be. Nothing to click.

## Rehearse first (Test tab)

A test run moves the app's own clock, not your PC clock, so you can try the whole thing today.

| Test | What it proves |
|---|---|
| **Auto-start** | Jumps to a few seconds before 9:29:30 PM. The movie must start alone, on the dot. |
| **Snap** | Jumps to just before midnight. Watch the snap land on 12:00:00, the date roll over to January 1 and the animation play. |
| **Slip and recovery drill** | Knocks the film out of sync on purpose so you can practise **Recalibrate**. |

Each test prints a result with the measured error in milliseconds.

**Check the snap point once.** The usual copy of the film has the snap at 2:30:30. A different cut can be a second or
two off. Open **Setup → Snap point**, press *Play from 10 s before*, pause on the snap, step with the frame buttons and
press *The snap is on this frame*. The start time adjusts itself.

## If someone slips

While the countdown is armed, a pause or a click on the timeline does not ruin the night. A small box appears in the
middle of the screen (in fullscreen too):

> **You slipped** · The movie is 12.4 s behind the clock · **RECALIBRATE**

Click it, or press **R**, **Enter** or **Space**. The film jumps back to where the clock says it should be. If nobody
reacts, it recalibrates by itself after 10 seconds (changeable in Setup). Stalls, a sleeping PC and decoder hiccups are
corrected automatically, without a box. **L** locks the controls so a slip cannot happen at all.

## On-screen clock

Top right of the picture: the **digital clock**, the **date** under it, and the **countdown** under that. At midnight the
date rolls over from December 31 to January 1.

| Key | |
|---|---|
| **O** | Show or hide the whole overlay (hide it if everyone has a phone out anyway) |
| **N** | Countdown mode on or off |
| **T** | The big 10 · 9 · 8 animation for the last ten seconds, on or off |
| **H** | Happy New Year animation: Stark (gold dust forms the words, then blows away), Fireworks, Minimal, Off |
| **C** | Subtitles on or off |
| **Z** / **X** | Subtitles earlier / later |
| **F** / **F11** | Fullscreen |
| **R** | Recalibrate |
| **L** | Lock the controls |
| **Space**, **←** **→**, **↑** **↓**, **M** | Play/pause, skip 10 s, volume, mute |

Position, size, 12/24-hour clock, six app themes and which side the control panel sits on are in the **Display** tab.

## Subtitles

**Subs → Load subtitle file** takes `.srt`, `.vtt`, `.ass` and `.ssa`. A subtitle file with the same name as the movie,
in the same folder, is loaded by itself. If the letters look wrong (older Arabic, Cyrillic, Greek, … files), pick the
language under *Text encoding*. Size, colour, outline or box, height and timing are adjustable.

## What "in sync" means here

The film position is always computed from the clock: *position = now − start time*. The player measures, frame by
frame, how far the picture is from where it should be. A few milliseconds are corrected by nudging the speed by a
fraction of a percent; anything bigger is corrected by re-cueing the film to the exact frame and pressing play at the
exact instant. The **Sync** tab shows the live error and a graph.

The clock itself is checked against internet time servers (NTP), because a PC clock can be seconds off. If your PC
is 0.8 s slow, the app corrects for it and says so. Offline, it uses the PC clock as it is.

## Files and sound

Video is played by Chromium at its native resolution, untouched: H.264 always, HEVC (H.265) when the graphics card
supports it. **Dolby (AC-3 / E-AC-3) and DTS sound cannot be decoded.** The player notices this when you import the
file and offers **Fix the sound**: the picture is copied bit for bit and only the sound is converted to AAC. That needs
FFmpeg; the app finds the copy PC Clipper downloaded, or downloads it once (about 100 MB).

## The day before

- Run the Auto-start and Snap tests with the real movie file. The pre-flight list in the Mission tab should be green.
- Plug the laptop in. The app keeps the PC awake while armed, but it cannot stop the battery from running out.
- Leave Windows Update alone until January 1.
- Start the countdown early in the evening and leave the app open.

## Honest limits

- The app was developed and tested on Linux with the same code (unit tests plus end-to-end tests that drive the real
  app). The Windows installer is built and verified on Linux but has not been run on a Windows PC by the author. Run
  the two tests above before you rely on it.
- 9:29:30 PM is the commonly quoted start time. It depends on your copy of the film; that is what the snap point check
  is for.
- Sound through Bluetooth speakers or a TV can lag behind the picture by a tenth of a second or more. That delay
  happens after the player and is not corrected.
- This is an unofficial fan project. It ships no film content.

## For developers

```
npm install
npm start                # run the app
npm test                 # unit tests + end-to-end tests (needs ffmpeg; uses xvfb on headless Linux)
npm run build:win        # package for Windows and build ../download/Avengers-Player-Setup-<version>.exe (needs makensis)
```

| Path | |
|---|---|
| `main/` | Electron main process: files, fullscreen, keep-awake, crash recovery, NTP time, FFmpeg helper |
| `src/core.js` | Timing maths and the drift controller (pure, unit-tested) |
| `src/app.js` | The player: sync engine, slip recovery, test runs, overlay, panels |
| `src/subs-core.js` | Subtitle decoding and parsing |
| `src/fx.js` | The celebration animation |
| `tests/` | `unit/` (node:test), `e2e/` (Playwright driving Electron), `fx/` (animation frames) |
