/*!
 * Avengers Player: the sound of 'minimal' (the plain banner, shown for 8.2 s; no cues).
 *
 * Restrained on purpose: one soft, warm chord over about four seconds. Three bells rolled gently as
 * the banner fades in (its first 0.5 s), a pad on D add 9 breathing in under them and a little air,
 * all fading into the hall well before the banner goes. No hit, no sub. Original.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  S.define('minimal', {
    bed(T, w, P) {
      // the bells, rolled like a soft strum: A5, D6, F sharp 6, then a faint E6 as the line settles
      P.chime(T(0), P.note(81), { gain: 0.06, dur: 6, pan: -0.3, wet: 0.6 });
      P.chime(T(120), P.note(86), { gain: 0.05, dur: 5.6, pan: 0.05, wet: 0.6 });
      P.chime(T(240), P.note(90), { gain: 0.04, dur: 5.2, pan: 0.32, wet: 0.65 });
      P.chime(T(720), P.note(88), { gain: 0.022, dur: 4.4, pan: -0.1, wet: 0.7 });
      // the pad: D3 A3 E4 F sharp 4, breathing in, holding to about 3 s, letting go by about 5.5 s
      P.pad(T(0), 5.6, [50, 57, 64, 66], { gain: 0.07, a: 0.8, r: 2.6, lp: 1100 });
      // a little air with it
      P.noise(T(0), 4.2, { type: 'bandpass', f0: 5000, f1: 3200, q: 0.8, gain: 0.022, a: 0.7, r: 2.4, pan: -0.2, pan1: 0.2, wet: 0.6 });
    }
  });
})();
