# Next steps (hand-off, updated Nov 23, 2026)

Where things stand, so the next session can carry on without the chat history.

## State of the code

- Branch `ccr-be54cccc-rzsvel`. Everything below is committed and pushed.
- **Done and checked:**
  - Stark exactly as it originally was (pixel-identical, `261bb86`).
  - Each theme animation in its own font and look (`3283493`), Infinity as the Thanos animation (`5b580ad`).
  - The Final Countdown follows the chosen New Year animation, with Fireworks and Minimal countdowns of their own;
    with the animation Off it follows the app theme. Infinity's countdown is in the Thanos gold and purple.
  - The Minimal banner refresh.
  - **Animation sound** (`d9a9a3b`): Display → Animation sound, **off by default**. `src/sfx.js` makes every sound with
    the Web Audio API (no files). Quiet, follows the app's volume and mute; the midnight replay gets it too.
  - An adversarial review of all of the above (4 reviewers, each checked by a skeptic): 9 low findings confirmed,
    8 fixed in `f2ee876`. Not fixed on purpose: turning the sound on *after* the midnight replay has started leaves
    it out of that clip (the fix would route every user's replay sound through Web Audio, sound on or not; not
    worth the risk for that case).
- **No more RIGHT ON TIME; New Year hit congratulated** (`43f5d5b`, review fixes `665a5b6`): New Year, test runs and the
  Preview say HAPPY NEW YEAR (a custom non-New-Year target: TARGET REACHED). Film on the clock at midnight (60 ms):
  the Mission card says THE SNAP HIT MIDNIGHT, and when the movie is over a dialog says "You did it. Happy New Year
  2027!" once. e2e newyear + night + ui pass.
- **Countdown sound** (`5a146c8`, review fixes `c39b98a`): Display → Countdown sound, off by default. Each number of
  the Final Countdown heard the instant it appears (scheduled on the audio clock, output latency taken off), a set
  per countdown look (src/sfx-count.js), 3 · 2 · 1 heavier with a build landing on midnight, 6 dB under the animation
  sound. Silenced when the countdown stops; reset when the app's clock jumps (test runs). e2e: countsound, ui, newyear.
- **Gamma reworked** (`359e3e9`, cleanup `c2ce1fc`, sound `47b6de3`): ground zero in photographed rock (CC0 ambientCG
  textures in `src/fx-gamma-tex.js`, Gasoek One with a redrawn Y), a rock-cut 10 · 9 · 8 countdown, and a stone sound
  with a heartbeat matched to the frames (every hit within 5 ms). Four rounds with a strict 3-judge panel: 5.4 → 6.4
  of 10 (10 = a Marvel trailer card); the judges' remaining notes are minor (a lime tint on the hot cracks at 11.05 s,
  a few straight hairline cracks, debris falling below the ground line). Its first frame takes ~3.5 s cold, so the
  app prepares it 60 s before midnight, when the style is picked and when the Display tab opens.
- **Cinematic sound: work in progress** (`b544e30`): all 10 designs written; only Arc and Hot Rod checked. The run was
  stopped; to finish, resume workflow run `wf_a8133b35-4e8` (pixel baseline is `f133018`).
- **Tests:** unit 143/143; e2e `ui` scenario 136/136; the crash scan of all 9 drawn animations is clean.

## Release 1.11.0

- Rebuilt with everything above, including the Gamma rework: e2e 860/861 in the full run (the one miss was a 0.980 s
  gap in the countdown sound under load, at the ±20 ms limit; the `newyear` scenario then passed twice with every gap
  1.000 s), unit 143/143, `tests/fx/shots.cjs --perf` (60 fps; Stark's p95 33 ms is the known measurement quirk;
  Gamma's 3.2 s first frame there is the unprimed cold start), Gamma's own check 62/62.
  `download/Avengers-Player-Setup-1.11.0.exe`, 94.8 MB (limit 95.0 MB: little room left for more data in the app),
  SHA-256 `e75cb7e0fcf26b208f0f7d45853d871c819b990fde53c8879eab045a4338f0e1`.
- Not done: the install/update/launch check under Wine (Wine 9.0 crashes on every command in this container).
- Sound review: Arc and Hot Rod had the full design check; the other animation sounds only the measured checks
  (levels, no clipping, frames identical, no doubled cues). The user judges them by ear from the demo videos.

## What is left

1. The user watches the animation videos (with sound) and picks any other animation to rework (Gamma is done). A
   rework (with Fable 5.2) replaces the current one only if it is clearly better side by side.
2. itch.io: the page text is in `docs/itch-page.md` ($0 or donate, $3.99 suggested). The user takes the two Windows
   warning screenshots, creates the page and uploads.

## After the release

- **Disney+ browser extension** (Chrome / Edge): countdown panel over Disney+, play at the exact second, kept in
  sync, a Calibrate button (pause on the snap, press it, once). If the user's test passes: the animations and the
  Final Countdown inside it; store submissions by about Dec 10.
- **Back to Import while armed**: the countdown keeps running; re-importing any copy joins the film where the clock
  says ("Join now").

## Decisions on record

- Credit: "Created by akaa" (About, installer publisher, exe).
- Pricing: itch.io "$0 or donate", $3.99 suggested.
- TVA keeps the door; no Miss Minutes (a Marvel character: not drawn).
- No exact Marvel fonts: the films' lettering is custom; free lookalikes ship with the app (OFL / Apache).
- Animation order: Stark, Arc Reactor, Hot Rod, Infinity, Gamma, War Machine, TVA, Doom, Fireworks, Minimal, Off.
- Animation sound is off by default.
