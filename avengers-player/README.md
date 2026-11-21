# Avengers Player

A Windows video player that starts *Avengers: Endgame* by itself on December 31, keeps the film locked to the clock
for the whole two and a half hours, and lands the snap on **12:00:00 AM**: the very frame on which his fingers snap,
found in your own file and put on midnight to the millisecond. It works with any copy of *Avengers: Endgame* or
*Avengers Endgame: Encore*: Remux, Blu-ray or WEB rip, 4K or 1080p, whatever its exact length.

Created by **akaa**.

**[Download the installer](../download/Avengers-Player-Setup-1.11.0.exe)** (Windows 10 / 11, 64-bit, about 93 MB).
You bring your own copy of the movie. Nothing is uploaded anywhere.

Older version, kept as it was: **[1.3.0 (legacy)](../download/Avengers-Player-Setup-1.3.0-legacy.exe)**. Only one
version is installed at a time: installing one over the other asks first, then replaces it; settings are kept.

![The player with the countdown running](docs/player.png)

## Install

1. Run `Avengers-Player-Setup-1.11.0.exe`. It installs for your user only, so there is no administrator prompt.
   If Avengers Player is already installed, Setup says so first and asks: *update it to version 1.11.0?*, *install
   it again?* (the same version), or, when the installed one is newer, *replace it with this version?* **Yes** puts
   the new version into the folder of the old one (your settings, snap points and an armed countdown stay as they
   are); **No** leaves everything as it is and closes Setup. On a PC without it, Setup simply installs it.
2. Windows may show a blue box, "Windows protected your PC". That appears for any new app that is not signed by a
   company. Click **More info → Run anyway**. (If *Smart App Control* is switched on, Windows offers no such button.)
3. Start **Avengers Player** from the desktop or the Start menu.

## On the night

1. **Import the movie.** Drop the file on the window or click to browse. The app finds the snap in it (see below).
2. Click **START THE COUNTDOWN**. You can do this days ahead: the movie waits for December 31.
3. Press **F** for fullscreen. A standby screen counts down to the start.
4. Walk away. The movie starts by itself at the time shown in the Mission tab: a second or two before 9:29:30 PM,
   exactly as early as the snap in your copy needs (or at the start time you chose, see below).

## Start time: automatic, 9:29:30 PM, or your own

**Setup → Start time** (or *Start time · change* in the Mission tab) has three choices:

| Choice | The movie starts | The snap lands |
|---|---|---|
| **Automatic** (recommended) | when the snap found in your file needs, e.g. 9:29:28.332 PM for a Blu-ray copy | on 12:00:00 |
| **9:29:30 PM** | at 9:29:30 PM, the figure everybody quotes (it comes from the streaming version) | as late as your copy's snap is after 2:30:30: about 1.5 s late on a Blu-ray copy |
| **My own time** | at the time you type (*9:29:29.5* is read as the evening), or nudge with −1 s, −0.1 s, +0.1 s, +1 s | earlier or later by the same amount |

Every countdown, the standby screen, the late join, recovery and a restart after a crash follow the choice. The
Mission tab and the pre-flight list say where the snap lands with it. A file too short for the chosen start is refused.

**Changed your mind while the movie plays?** The start time can be changed while the countdown runs ("I think I
started it wrong"). Pick another choice, nudge it, or type a time: the countdown keeps its target, the film jumps to
where it should be with the new start (*New start time 9:29:30 PM: the film jumps 1.7 s back and stays on the
clock*), and the snap lands accordingly. **Start time from where the film is now** works the other way round: the
film stays exactly where it is, and the start time is worked out from it, so the countdown follows the film from
there.

**Test it.** *Test this start time* (Setup), or the Snap test with *Start time as set*, *Automatic start* or *Start at
9:29:30 PM* (Test tab), jumps to just before midnight with that start and says exactly where the snap lands, for
example *"With this start time the snap came 1.668 s after midnight"*. The film strip afterwards marks the frame that
was on screen at 12:00:00 and the snap point, so you can see the difference with your own eyes.

**If the app crashes, it comes back by itself.** While the countdown is armed a small watchdog keeps an eye on the
app. If the app crashes or is killed, the watchdog starts it again within a couple of seconds. Either way it imports
the movie again and jumps to exactly where the clock says the film should be. Nothing to click. (Closing the app
yourself is different: it asks first, and then stays closed.)

**A power cut, an empty battery or a PC that is switched off.** While the countdown is armed, Windows opens the app
again when the PC is back on and you sign in, however long it was off. It loads the countdown, imports the movie and
puts it where the clock says, then tells you, for example *"Back after the PC went off for about 4 minutes (a power
cut, an empty battery or the power button): the movie is at 1:23:45, where the clock says."* After a shutdown or a
restart it says *"Back after Windows was shut down, restarted or signed out"*. Its settings are forced onto the disk every time
they are saved, so a power cut cannot leave them half written (and if a file is ever damaged anyway, the previous
copy is used). If the PC only went to sleep (the lid, the power button, a low battery), the film goes straight back
to where the clock says the moment it wakes up. While armed on a laptop's battery the app tells you to plug it in,
and again at 20, 10 and 5 percent.

## Rehearse first (Test tab)

**New Year's Eve simulation (start with this one).** Exactly like the night: the app's clock is set to December 31
at the moment you pick (9:29:00 PM to watch the movie start by itself, 11:59:00 PM to watch the snap) and runs on
from there. The standby screen counts down, the movie starts by itself, the clock and the date run in the corner,
the snap lands on midnight, the date rolls over and the celebration plays. No test bar, no pass or fail; your PC's
clock and a real countdown are not touched. Press F for fullscreen and watch it as you will on the night. Pick the
start time the simulation uses: the one set in Setup, the automatic one, or **9:29:30 PM** (the simulation then
starts the movie at 9:29:30 PM and you see where the snap lands with it; your real countdown keeps its own).

**The movie launches at the exact millisecond, and every second moves with the clock.** The start time is shown
to the millisecond (for example *9:29:28.348 PM*). The countdown to it changes its seconds on the same frame as the
clock's seconds (00:00:03.348, 00:00:02.348, ...: the milliseconds are the start's own); from 9:29:28.000 the last
.348 counts down live, and the movie launches at 00:00:00.000, that very instant, so the snap lands exactly on
midnight. **Display → Show milliseconds** hides them (9:29:28 PM, 00:00:03); the launch stays exact either way.

The other tests also move the app's own clock, not your PC clock.

| Test | What it proves |
|---|---|
| **Auto-start** | Jumps to a few seconds before 9:29:30 PM. The movie must start alone, on the dot. |
| **Snap** | Jumps to just before midnight. Watch the snap land on 12:00:00, the date roll over to January 1 and the animation play. |
| **Slip and recovery drill** | Knocks the film out of sync on purpose so you can practise **Recalibrate**. |
| **Late start** | For anyone who opens the app after the movie should have started. The app's clock is put 10 s, 5 minutes or an hour past the start time with nothing armed, so the real *You are late* box comes up. Press **JOIN NOW**, Enter or Space: the film jumps to where the clock says and starts on the clock. The result says how long joining took and how close to the clock it landed. *Join at 11:59:00 PM, watch the snap* joins a minute before midnight, so you see the snap land on 12:00:00 after a late join. |
| **Power cut** | With the countdown armed, pick how long the PC stays off (10 s, 30 s, 1 minute) and press *Cut the power*. The whole app is cut off at once, watchdog included, with nothing saved on the way out. After that time it is started again the way Windows starts it when the PC is back on, imports the movie by itself and puts it where the clock says; the result says how far behind or ahead of the clock it landed. (It cuts the app off, not your PC.) |
| **Crash recovery** | With the countdown armed, press *Crash the app now*. The app crashes for real and is back, in sync, a few seconds later. |

Each test prints a result with the measured error in milliseconds.

## The snap is found for you

"Start at 9:29:30 PM" puts the snap at 2:30:30, and that is a round number. In the film the fingers snap a moment
later, and how much later differs from copy to copy: a Blu-ray copy, a streaming copy and the 2026 Encore cut are
all timed differently. So the app takes nothing from a table. **When you import a movie, it finds the snap in that
file by itself and sets the countdown by it** (with a start time chosen by hand, it shows where the snap lands).

1. Import the movie. After a moment a box says *Finding the snap in this film*: the app plays that part of the film
   without sound and looks at every frame. It takes ten seconds or so, once per file.
2. A **film strip** opens: one small picture per frame, with the film itself paused on the chosen frame above it.
   The title reads *Snap found: 2:30:31.5…* and the start time of the movie has already moved with it.
3. Look at the picture. If it is the frame where his fingers snap, press **Yes** (or just close the strip). If it is
   a frame off, step with **←** **→** and press **Put the snap on this frame**.
4. Run the **Snap test** when you like. Afterwards the strip shows the frame the app put on 12:00:00 and how many
   milliseconds from the clock it came on screen.

The app has two witnesses. One is the picture: the flash that fills the screen when the fingers snap. The other is
the line *"And I… am… Iron Man."* in subtitles that are known to be in step with the film: the subtitles inside the
movie (FFmpeg reads every English text track until it finds the line, skipping forced-only and commentary tracks),
or a subtitle file the app has put on the voices (see *Subtitles*). The snap comes a moment after that line goes off
screen, in every cut. A subtitle file nobody has checked is only a hint where else to look, never a witness.

The app only says **found** when nothing else could explain what it saw:

| What the app saw | What it does |
|---|---|
| A clean white-out that begins between 0.75 s before and 2 s after the line, and no other flash there | Sets the snap point on its first frame, marked as found |
| No subtitles to ask: one clean white-out of at least 0.3 s near where the snap is expected, no other flash in sight, and no other white-out in the stretch the wide search covers | The same |
| One clean white-out, but only the wide search found it, far from where the snap was expected, and no subtitles | Sets the snap point there (the countdown is calibrated) but marks it *not confirmed*: the strip asks you to look, one click confirms it |
| The line, but no flash anywhere | Sets an estimate 0.1 s after the line, marked *not confirmed*, and asks you to pick the frame |
| Two flashes (white, or bright but not white) and nothing to choose between them; a flash that is not right after the line; a flash that flickers (white, darker, white); a brief brighter moment right before a cut to white; frames the PC skipped where the flash begins; a climb that began before the stretch looked at; a start too soft to name its first frame; a white-out too short; a subtitle file nobody has checked that puts the line more than 3 s away | Changes nothing, says why, and shows you the frames |

"Clean" means: every frame of the climb was seen (frames the PC skipped are fetched one by one), the first frame is
clearly brighter than the flicker of that shot, and the climb began inside the stretch that was looked at. A brighter
shot or a glow right before a cut to white does not fool it: the cut is the flash. A film stored at 50 or 60 frames a
second (each picture shown two or three times) is handled too.

Where the app looks: every frame from 3 s before to 7 s after where the snap is expected (or, when trusted subtitles
put the line somewhere else, around the line first); if that does not settle it, a quick sweep of 150 s and a frame by
frame look at the white-out it shows. For a copy longer or shorter than the 2019 film the sweep reaches as far as the
difference could have moved the snap, up to five minutes either way. Every film file remembers its own snap point, so any number of copies can be set
once and then swapped freely. Starting the countdown with a snap point that was never confirmed asks first. **FIND THE
SNAP** (Mission tab, or Setup → Snap point) runs the search again at any time, and the frame buttons in Setup still
work by hand. **Setup → Copy the details** copies what the last search saw, frame by frame, as text.

## Which version of the film?

Copies of the film differ in length: a Remux, a Blu-ray rip and a WEB copy of the same 2019 film can run 3:00:57,
3:01:11 or 3:02:05, depending on logos, the studio intro and how the credits end. So the length decides only whether
a file is the film at all: **any file from 2:45:00 to 3:30:00 is taken for the film and searched for the snap
automatically**, whoever made it. Which cut it is, the app reads from the file's name: *Encore* or *2026* in the name
is the re-release, any other name the 2019 film. **Setup → Film version** shows what it read and lets you change it.

| Cut | Usual length | Snap point |
|---|---|---|
| *Avengers: Endgame* (2019) | about 3:01 | a moment after 2:30:30; found in the file |
| *Avengers Endgame: Encore* (2026) | about 3:01:36 | found in the file; the search covers the extra 25 seconds |

For neither cut is the snap point taken from a table: it is found in the file when the file is imported, as
described above. Until a snap point has been found or picked, the pre-flight list keeps a line saying so.

**Importing ENCORE runs the same calibration.** The search starts from the snap point already confirmed in your
ENDGAME file, if there is one (it is the same film), else from 2:30:30. If the extra 25 seconds come after the snap,
the snap is right there and it is found. If they come before it, the wide search finds it 25 s further in: with
subtitles inside the file it is found outright; without, the app sets it, calibrates the countdown, and asks you for
one look in the strip, because a white-out 25 s from where it was expected, with nothing else to back it up, is
something a person should see once.

What is known from outside the file. A published subtitle file made from the 4K Blu-ray's own subtitle track
shows *"Iron Man."* from 2:30:29.9 to 2:30:31.4, so on a Blu-ray copy the snap is at about 2:30:31.5, a second and a
half after the round figure. The same lines sit about 1.5 s earlier in subtitles of the iTunes version, which fits
the figure everybody quotes, 9:29:30 PM
([Looper](https://www.looper.com/1475223/avengers-thanos-iron-man-snaps-marvel-timestamps-start-new-year)), having
been worked out on a streaming service
([Laughing Place](https://www.laughingplace.com/w/articles/2021/12/31/ring-in-the-new-year-by-timing-up-these-5-mcu-moments-to-the-stroke-of-midnight/)).
These are subtitle timings, good to a few tenths of a second, not frame counts: which is why the app looks at the
picture. For Encore, a scene-by-scene guide puts
the first new scene at 2:48:50
([CinemaBlend](https://www.cinemablend.com/movies/i-grabbed-avengers-endgame-encore-doomsday-scene-timestamps)), after
the snap. Other lengths than 3:01:36 have been published for Encore, which is one more reason the app goes by the
name and finds the snap in the file instead of trusting any length.

## If you are late

Nothing has to be armed in advance for the night to work. If the app is opened, or the movie imported, after the
movie should have started (even at 11:59 PM), or the PC crashed with no countdown armed, a box says so:

> **You are late to the countdown** · The movie had to start at 9:29:28 PM. Right now it should be at 1:12:43. · **JOIN NOW**

Press the button, **Enter**, **Space** or the play button: the film jumps to where the clock says it should be and
stays locked to it, exactly as if the countdown had been armed all along. *Not now* puts the box away and leaves a
small reminder at the top. In the ten minutes before the start, a player that is not armed shows a reminder too.

If midnight comes and the countdown is not running (never started, or late and never joined), the app says
**Better luck next year**, once. If the countdown was running, it says nothing of the kind.

If the film was on the clock at midnight (within 60 ms), the Mission card says **THE SNAP HIT MIDNIGHT**, and once the
movie is over (it ran to its end, or the countdown was stopped after midnight) the app congratulates you, once:
**You did it. Happy New Year 2027!**, with how close to the clock the snap landed. Closed before the end, the app says
it the next time it opens that day. Test runs and the Preview show the New Year words too (HAPPY NEW YEAR and the
coming year), so they look like the real night; only a target of your own that is not New Year says TARGET REACHED.

## If someone slips

While the countdown is armed, a pause or a click on the timeline does not ruin the night. A small box appears in the
middle of the screen (in fullscreen too):

> **You paused the movie** · The movie is 12.4 s behind the clock · **RECALIBRATE** · **STAY OUT OF SYNC**

Click **RECALIBRATE**, or press **R**, **Enter** or **Space**: the film jumps back to where the clock says it should be.
If nobody reacts, it recalibrates by itself after 10 seconds (changeable in Setup, or switched off there).

Paused on purpose and coming back later? Press **STAY OUT OF SYNC**: the film stays exactly where you left it and
nothing plays or recalibrates by itself. Space plays and pauses it freely. When you are ready, press **RECALIBRATE**
in the Mission tab (it is there whenever the film is out of sync), click the *OUT OF SYNC* bar at the top, or press
**R**: the film jumps to where the clock says and stays locked to it. Stalls, a sleeping PC and decoder hiccups are
corrected automatically, without a box. If a stretch of the file is damaged, playback resumes by itself as soon as the
clock is past it. **L** locks the controls so a slip cannot happen at all.

## On-screen clock

Top left of the picture: the **digital clock**, the **date** under it, and the **countdown** under that. For the last ten
seconds the countdown grows inside that panel and ticks 10, 9, 8 … Nothing is drawn across the picture. At midnight the
date rolls over from December 31 to January 1.

This **Final Countdown** follows the Happy New Year animation you choose, so the two feel like one piece, each in
that animation's lettering and colours, inside the panel: **Stark**: the classic one, as it always was; **Arc
Reactor**: cyan neon that strikes on like a tube, between the arcs of a spinning reactor ring, with a shockwave;
**Hot Rod**: slanted polished gold with a deep red edge, slamming down in sparks; **Infinity**: gold with a deep
purple edge, as the Thanos words at midnight, condensing out of violet and gold ash with an orbiting comet; **Gamma**: lime inside a thick dark outline, with a jolt and a
crack of lightning; **War Machine**: gunmetal with a fine red edge, scanned in as brackets lock on; **TVA**: amber,
switching on like an old television inside a clock dial; **Doom**: green fire cooling to scratched steel with a green
outline, in a turning ring; **Fireworks**: every number bursts in with coloured rays and sparks; **Minimal**: a quiet
fade. 3, 2, 1 hit harder. With the animation **Off**, the countdown still plays, in the style of the app theme; the
**T** key (or its switch in the Display tab) is what turns it off. **Display → Preview the Final Countdown** plays the
last ten seconds there right now, as the chosen animation has them (not during a test run or the countdown's last
minute; click it again to stop).

**Everything ticks with the clock.** Every countdown (overlay, standby screen, Mission tab, the late box) and the
film's own time on the control bar change on the same instant as the clock's seconds, also when the start time falls
between two seconds (9:29:28.6, say). While the film is locked to the clock (in sync, and again after a slip, a
recalibration, or a crash and restart) its time is counted on the clock's seconds, and as the clock turns 12:00:00 it
shows the second that holds the snap. Only while the film is out of sync (paused, dragged, stuck) does the bar show
where the film really is, so you can see that it is off; it ticks with the clock again as soon as it is back in sync.

| Key | |
|---|---|
| **O** | Show or hide the whole overlay (hide it if everyone has a phone out anyway) |
| **N** | Countdown mode on or off |
| **T** | The Final Countdown (10, 9, 8 … in the clock panel for the last ten seconds), on or off |
| **H** | Happy New Year animation: Stark (gold dust forms the words, then blows away), Arc Reactor, Hot Rod, Infinity, Gamma, War Machine, TVA, Doom, Fireworks, Minimal, Off |
| **A** | Sound language: switches between the sound tracks of the movie |
| **C** | Subtitles on or off |
| **Z** / **X** | Subtitles earlier / later |
| **←** **→** / **Enter** / **Esc** | In the film strip: step a frame, set the snap on the frame, close |
| **F** / **F11** | Fullscreen |
| **R** | Recalibrate |
| **L** | Lock the controls |
| **Space**, **←** **→**, **↑** **↓**, **M** | Play/pause, skip 10 s, volume, mute |

Position, size, 12/24-hour clock, seven app themes (Arc Reactor, Hot Rod, Infinity, Gamma, War Machine, TVA, Doom) and which side the control panel sits on are in the **Display** tab.

## The Happy New Year animation

**Display → Happy New Year animation** chooses what plays at midnight: **Stark** (golden dust assembles into HAPPY
NEW YEAR and blows away again), the seven theme animations, **Fireworks**, **Minimal** (a small banner) or **Off**.
*Preview the animation* plays it now. Each theme animation builds the words in stages, never all at once, in
lettering of its own:

- **Arc Reactor** (Michroma, cyan neon): a reactor powers up above the words; its shockwave strikes each letter on
  like a neon tube, then energy fills the year digit by digit.
- **Hot Rod** (Russo One, slanted gold with a deep red edge): 2027 is struck digit by digit from molten metal, then a
  welding torch writes HAPPY NEW YEAR in sparks.
- **Infinity**, the Thanos animation (Syncopate, gold with a deep purple edge): a snap; six coloured lights collide
  into a gold blaze that forges the year, ash rises into the greeting, and at the end, perfectly balanced, half of the
  letters turn to dust, then the rest.
- **Gamma** (Anton, lime inside a thick dark outline): a thunderclap; the year smashes down digit by digit, then
  lightning writes the greeting one letter at a time.
- **War Machine** (Black Ops One, gunmetal with a fine red edge): a tactical display boots and locks each letter as it
  renders in steel, the year's counter rolls and locks, then red tracers burst into silver flak.
- **TVA** (Orbitron, amber): an old split-flap clock flips over to the new year and HAPPY NEW YEAR types out on a
  terminal, as a door of light opens behind the words.
- **Doom** (Cinzel, scratched steel with a glossy green outline): green fire burns the letters in one by one, then a
  circle of runes surges and brands the year.

The typefaces ship inside the app, so they work offline: free fonts under the SIL Open Font License (Syncopate under
Apache 2.0), with their licences in `src/fonts`. They are chosen to feel close to the films; the films' own lettering
is custom and not used.

**Animation sound** (Display tab, **off by default**): each animation gets a sound of its own, made by the app itself
(no sound files): the snap and the gold blaze for Infinity, a thunderclap for Gamma, split-flap clacks and typing for
TVA, the rockets of Stark and Fireworks as they fly, and so on. It is quiet and follows the app's volume and mute,
because at midnight the film is playing its own snap. With the replay on, the midnight clip gets it too, mixed with
the film's sound.

**Countdown sound** (Display tab, next to the Final Countdown, **off by default**): the 10 · 9 · 8 gets a sound in the
look of its countdown (a HUD beep for Stark, current through the reactor for Arc, a heartbeat for Gamma, a clock's
tick-tock for TVA, an iron drum for Doom…). Each number is heard the instant it appears: it is put on the audio clock
ahead of time, with the speakers' latency taken off, not played when a frame happens to draw it. 3 · 2 · 1 are
heavier, and from 3 a build rises to land on midnight. It sits under the film (the room counts down too), follows the
app's volume and mute, is silenced at once if the countdown is stopped, and plays with "Preview the Final Countdown".

They are built to run at 60 frames a second on big screens too: the words are drawn once and reused, the animation gets ready a
few seconds before midnight, and if a PC still cannot keep up, the soft glow is the first thing to go.

## Replay of the night

For anyone who forgot to film it. While the countdown runs, the app records two moments of what is on screen, with
the film's own sound: **the movie starting by itself** (the last 10 seconds of the standby countdown and the first
15 of the film) and **midnight** (the last 20 or 40 seconds before it, the snap and the celebration, until 20 seconds
after). Nothing else is recorded, ever. The clips are saved in **Videos › Avengers Player** (*New Year 2027 -
midnight*, *New Year 2027 - the movie starts*); the New Year's Eve simulation saves *Rehearsal* clips the same way,
so you can see it work beforehand. **Display → Replay of the night** switches it off or chooses 20 or 40 seconds;
*Open the replay folder* opens it. The clips are MP4 (H.264) where the PC records it, otherwise WebM.

## Subtitles

**Subs → Load subtitle file** takes `.srt`, `.vtt`, `.ass` and `.ssa`. A subtitle file with the same name as the movie,
in the same folder, is loaded by itself. If the letters look wrong (older Arabic, Cyrillic, Greek, … files), pick the
language under *Text encoding*. Size, colour, outline or box, height and timing are adjustable.

**Subtitles that come early or late are put right by the app.** A subtitle file from the internet was usually made
for another copy of the film, so its lines come a second or two (or half a minute) early or late, or drift further
off the longer the film runs because that copy had another frame rate. When a subtitle file is loaded, the app
listens to up to an hour of the film's sound, taken from all over it (in a surround mix the centre channel, where the
dialogue is), works out where people are speaking, and moves the lines there: the shift, and the speed too if that
is wrong. If the movie file carries subtitles of its own, the lines are compared with those as well, which is more
exact than sound. It takes a few seconds to a minute, needs FFmpeg (the same free tool as *Fix the sound*), and the
Subs tab says what was done, for example *"The subtitles came 2.38 s early. They are now in sync with the voices."*

- **Undo** puts the lines back with one click. **Sync with the voices** runs the check again whenever you like.
- The switch *Check every new subtitle file by itself* turns the automatic check off; the button still works.
- The app moves subtitles only when the answer is clear. If the lines belong to another film, or the sound has too
  little clear speech, it says so and changes nothing; the **−** and **+** buttons (keys **Z** and **X**) move the
  lines by hand.
- A file made for a different cut of the film fits in some parts and not in others. The app says so, and where.
- While the countdown film is running, the app never starts a check by itself, and the button refuses in the two
  and a half minutes before the snap: nothing is allowed to disturb the film there.

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
file (on a PC without FFmpeg it plays the first two seconds silently to find out) and offers **Fix the sound**: the
picture is copied bit for bit and only the sound is converted to AAC. That needs FFmpeg; the app finds the copy
PC Clipper downloaded, or downloads it once (about 100 MB).

**English plays by itself.** Many copies of the film carry several sound tracks, for instance a Hindi dub first and
the English original second, with the dub flagged as the main track. The player ignores that flag: it plays the
English track, and *Fix the sound* converts the English track. The fix dialog lists the languages in the file, with
English preselected, and by default keeps the other languages in the new file so you can still switch. To switch, use
**Sound language** in the Mission tab, the language button on the control bar, or press **A**; a choice made by hand
is remembered for that movie. Another default language can be set under **Setup → Sound language**. Subtitle tracks
inside the movie are carried over by the fix, so they can still be picked in the Subs tab.

If a file has no English sound at all (for example a copy that version 1.0.0 converted from a dubbed track), the
pre-flight list says *The sound is Hindi, not English*. Import the original movie file again and fix its sound: the
new copy is in English.

**Start the Countdown** checks for the mistakes that would only show at midnight: it refuses a file that ends before
the snap point, asks before arming a movie with no playable sound or with sound in another language than the one you
want, and switches the sound back on if the player was left muted.

## The day before

- Run the Auto-start and Snap tests with the real movie file. The pre-flight list in the Mission tab should be green.
- Plug the laptop in and leave the lid open. While armed the app stops the PC from falling asleep by itself, but
  closing the lid or pressing the power button still puts it to sleep, and a battery still runs out. (If either
  happens, the film goes back where the clock says when the PC wakes up or is back on; the pre-flight list says
  whether the PC is plugged in.)
- Leave Windows Update alone until January 1.
- Start the countdown early in the evening and leave the app open.

## Honest limits

- The app is developed and tested on Linux with the same code (unit tests plus end-to-end tests that drive the real
  app), and the Windows installer and uninstaller are run under Wine. On a real Windows PC, version 1.0.0 is known to
  install, import a movie, convert its sound and play it; the timing figures come from the Linux test runs. Run the
  Auto-start and Snap tests on your own PC before you rely on it.
- Switching the sound language uses a part of Chromium that is still marked experimental. The app works around its
  one known weakness (it re-cues the film on every switch, and brings the sound back by itself if it ever stops), and
  the language is normally chosen once, before the countdown. Choose it during a rehearsal, not during the film.
- The app finds the snap by the flash that fills the screen when the fingers snap. Fan descriptions of the scene speak
  of "a blinding flash of white" at the snap, but no official source says how long it lasts or on which frame it
  begins, and the author does not have the film. The finder was put through two independent adversarial reviews and
  about sixteen thousand generated flashes at eight frame rates (cuts, ramps, soft starts, a brighter shot or a glow
  just before, flicker inside the white, white bursts before it, flashes that are bright but not white, decoy
  white-outs, lightning, explosions, skipped frames, pictures repeated in 25, 30, 50 and 60 frame files). In every
  case where it says *found*, it named the first frame of the flash or the one next to it; in the cases it cannot
  settle it says so and asks. It has not seen the real film: look at the frame it marks once, and move a frame or
  two if needed.
- Around the snap the film is held to within about a hundredth of a second of the clock. On a 60 Hz screen a film
  frame can only come on screen at one of 60 moments a second, so a few milliseconds either way are the limit of
  any player; the strip shows the figure that was measured.
- The subtitle sync was tested on clips made for the purpose and on half-hour "films" put together from real
  recordings (real voices, real music, real sound effects, mixed into one channel, with the voices anywhere from
  clearly louder than the rest to 6 dB quieter than it). There it put the lines within 0.16 s of the right place in
  16 cases out of 16 and refused every subtitle file that did not belong (20 out of 20). It has not been tested on
  the film itself. From sound alone it is good to a tenth or two of a second, not to the frame: subtitles stay on
  screen a little after the last word, by an amount no two files agree on. Against subtitles inside the movie file
  it is good to a few hundredths of a second. When the voices are buried under the rest of the sound, it says it
  cannot tell and moves nothing.
- Power cuts were tested by killing every process of the app at once (the watchdog included) and starting it again
  the way Windows does at sign-in, on Linux. That Windows opens the app at sign-in after a real power cut depends on
  the start-at-login entry the app sets while armed (and on you signing in); it was not tried on a real Windows PC
  with the plug pulled. The Power cut test runs the same path on your PC, minus the sign-in.
- The internet time check was tested against stand-in time servers only. If it cannot reach a real one on your PC, the
  pre-flight list says so and the app uses the PC clock as it is.
- Sound through Bluetooth speakers or a TV can lag behind the picture by a tenth of a second or more. That delay
  happens after the player and is not corrected.
- The animations were measured at 1920×1080 in the app's own browser engine on a 4-core cloud machine with no graphics
  card: all eight keep 60 frames a second there (95% of frames within 16.8 ms). Your screen and graphics card were not
  measured. If a PC cannot keep up, the soft glow is dropped first; *Preview the animation* shows it on yours.
- The replay records the window with Chromium's screen capture. Whether your PC records it in H.264 (usually in the
  graphics card, light) or falls back to WebM at 30 frames a second (in the processor, heavier) depends on the PC and
  was not tried on Windows. Run the New Year's Eve simulation once: if the film stutters while it records, switch
  **Replay of the night** off.
- This is an unofficial fan project, created by akaa. It ships no film content.

## For developers

```
npm install
npm start                # run the app
npm test                 # unit tests + end-to-end tests (needs ffmpeg; uses xvfb on headless Linux)
npm run build:win        # package for Windows and build ../download/Avengers-Player-Setup-<version>.exe (needs makensis)
```

| Path | |
|---|---|
| `main/` | Electron main process: files, fullscreen, keep-awake, crash watchdog, NTP time, FFmpeg helper |
| `src/core.js` | Timing maths and the drift controller (pure, unit-tested) |
| `src/app.js` | The player: sync engine, slip recovery, test runs, overlay, panels |
| `src/subs-core.js` | Subtitle decoding and parsing |
| `src/fx.js` | The celebration engine (Stark, Fireworks) and the style plug-in API |
| `src/fx-*.js` | The theme animations, one file each: Arc Reactor, Gamma, War Machine, TVA, Doom |
| `tests/` | `unit/` (node:test), `e2e/` (Playwright driving Electron), `fx/` (animation frames) |
