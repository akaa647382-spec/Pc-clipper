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
- **Tests:** unit 143/143; e2e `ui` scenario 136/136; the crash scan of all 9 drawn animations is clean.

## Release 1.11.0, what is left

1. Full e2e (`node tests/e2e/run.mjs`, about an hour) and `node tests/fx/shots.cjs --perf` on a quiet machine.
2. Build (`node scripts/build-win.mjs`), remove the 1.10.4 and preview installers from `download/`, commit, push,
   and give the user the link.
3. The user watches the animation videos (with sound) and picks any animation to rework. A rework (with Fable 5.2)
   replaces the current one only if it is clearly better side by side.
4. itch.io: the page text is in `docs/itch-page.md` ($0 or donate, $3.99 suggested). The user takes the two Windows
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
