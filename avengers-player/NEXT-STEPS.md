# Next steps (hand-off, updated Nov 21, 2026)

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
- **Cinematic sound: work in progress** (`b544e30`): all 10 designs written; only Arc and Hot Rod checked. The run was
  stopped; to finish, resume workflow run `wf_a8133b35-4e8` (pixel baseline is `f133018`).
- **Tests:** unit 143/143; e2e `ui` scenario 136/136; the crash scan of all 9 drawn animations is clean.

## Release 1.11.0

- Done: full e2e 821/821, unit 143/143, `tests/fx/shots.cjs --perf` (60 fps; every style deterministic and clean at
  the end), built (`download/Avengers-Player-Setup-1.11.0.exe`, 93.4 MB, SHA-256
  `693755862146676d20a3275bff88e6a2faaa684ecf7b0cf9bf9317fb4561f4e7`), 1.10.4 and the preview removed.
- Not done: the install/update/launch check under Wine (Wine 9.0 crashes on every command in this container,
  "free(): invalid pointer", even with the prefix that worked for earlier releases). The installer script changed
  only in its publisher name since 1.10.4, which passed that check.

## What is left

1. The user watches the animation videos (with sound) and picks any animation to rework. A rework (with Fable 5.2)
   replaces the current one only if it is clearly better side by side.
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
