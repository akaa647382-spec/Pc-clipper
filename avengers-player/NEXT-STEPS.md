# Next steps (hand-off, written Nov 18, 2026)

Where things stand, so the next session can carry on without the chat history.

## State of the code

- Branch `ccr-be54cccc-rzsvel`. Commits `c5139d5` and `8469f50` hold the builders' finished work:
  letter-by-letter word reveals in Arc Reactor, Gamma, War Machine, TVA, Doom; new Hot Rod and
  Infinity animations; themed 10 · 9 · 8 countdowns for the seven themes with a Preview button (the mode is now called
  "Final Countdown" in the app).
- None of that has been through its independent review (the reviews stopped at the usage limit), and
  the full end-to-end suite has not been run on it.
- Hot Rod and Infinity are not loaded by the app yet (`src/index.html` has no script tags for
  `fx-hotrod.js` / `fx-infinity.js`, and `scripts/build-win.mjs` does not require them).
- `download/` has 1.10.4, the 1.3.0 legacy installer and `Avengers-Player-Setup-1.11.0-preview.exe`
  (an earlier build, before all of the above). The README already links to a 1.11.0 installer that
  does not exist yet.

## Release 1.11.0 (Friday), in this order

1. **Stark goes back to exactly how it was**: undo the Stark part of `src/fx.js` from commit `ee37e40`
   (the second gust for the year, `STARK.yearLag`, the line-by-line solid words). Keep the letter API
   (`env.glyphs` / `env.textGlyphs` / `env.glyph` / `env.warm`), the pixel-grid words picture and the
   Fireworks changes.
2. **Fonts** ("close to the films", chosen by the user). The animations stay as they are; only the
   words change:

   | Animation | Font | Look of the words |
   |---|---|---|
   | Arc Reactor | Michroma | cyan neon |
   | Hot Rod | Russo One, slanted | gold with a deep red edge |
   | Infinity | Syncopate | lilac to white, violet glow |
   | Gamma | Anton | lime, thick dark outline |
   | War Machine | Black Ops One | gunmetal, fine red edge |
   | TVA | Orbitron | amber |
   | Doom | Cinzel | scratched steel, glossy green outline (like the Doomsday logo) |
   | Stark, Fireworks, Minimal | unchanged | unchanged |

   Each theme's 10 · 9 · 8 uses the same font and look. Fonts ship inside the app (offline): take the
   woff2 files from the `@fontsource/*` npm packages and keep their licence files (OFL / Apache).
   The engine needs a per-style font (`APFx.register(id, { font })`) used by the layout, the words
   picture, the letters and Stark's dust sampling, and the fonts must be loaded before `prime()`.
3. **Minimal**: a small refresh that stays minimal, same font.
4. **Wire in Hot Rod and Infinity**: script tags, the build's required files, their hints in `CELEB_HINT`.
5. **Reviews**: adversarial review of the seven theme animations and the themed 10 · 9 · 8.
6. **Show the user a short video of each animation.** The user picks which ones get reworked (with
   Fable 5.2). A rework replaces the current version only if it is clearly better side by side.
7. **Checks**: `node tests/fx/shots.cjs --perf` on a quiet machine (60 fps, ends clean),
   `npm run test:unit`, the full `node tests/e2e/run.mjs`.
8. **README**, build the installer (`node scripts/build-win.mjs`), remove the 1.10.4 and preview
   installers from `download/`, commit, push.
9. **itch.io page text**: pay what you want, $3.99 suggested, $0 minimum; install steps with the two
   Windows warning screenshots (the user takes them). The user creates the page and uploads.
10. **Marketing plan**: rewrite the doc (https://claude.ai/artifact/83ioNLMSvcyM2jtA7itFs6) in the
    simple week-by-week form, with itch.io.

## After the release

- **Disney+ browser extension** (Chrome / Edge): countdown panel over Disney+, play at the exact
  second, kept in sync, a Calibrate button (pause on the snap, press it, once). If the user's test
  passes: the animations and themed 10 · 9 · 8 inside it; store submissions by about Dec 10.
- **Back to Import while armed**: the countdown keeps running; re-importing any copy joins the film
  where the clock says ("Join now").

## Decisions on record

- Credit: "Created by akaa" (About, installer publisher, exe).
- TVA keeps the door; no Miss Minutes (a Marvel character: not drawn).
- No exact Marvel fonts: the films' lettering is custom, fan copies are personal-use only.
- Animation order: Stark, the seven themes, Fireworks, Minimal, Off.
