/*!
 * Avengers Player: the sound of 'stark' (the default New Year animation).
 *
 * Golden dust is blown in on a gust and assembles into the words (the snap in reverse), the words
 * hold and shimmer while small red and gold rockets bloom in the top corners, then the wind blows
 * them away. Heroic, warm, high-tech gold, in D. Everything here is original.
 *
 *   0 ms        midnight: the gold pulse and its ring (fx.js drawPulse, 520 ms): a hit, a struck-gold
 *               ring and bright air splitting outwards to both sides
 *   0..2400     the gust: wind sweeping left to right, grains of dust, a drone on D opening up, a
 *               reverse swell, all sucked into …
 *   2400        … the words locking (fx.js STARK.assembleEnd): brass braam, a high brass stab, a hit
 *               with a sub, gold bells and glitter
 *   2400..8400  the hold: a warm pad, gold glitter, a bright swish each time the glint crosses the
 *               words (every 2.5 s); the corner rockets ('launch' / 'burst' cues from fx.js) as distant
 *               whooshes and crackling bursts with a soft boom, panned where they fly
 *   8400        the blow-away (STARK.holdEnd): a low hit and the brass sinking, the wind carrying the
 *               dust off to the right, an open chord fading into the hall
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // fx.js STARK: the words are formed at 2400 ms and hold until 8400; the blow-away wave crosses
  // them in 1500 ms (+ up to 320 ms) and a released grain fades out over 2100 ms. While they hold,
  // a glint sweeps across them every 2500 ms (over the letters from ~17 % to ~83 % of its pass).
  const FORMED = 2400;
  const HOLD_END = 8400;
  const SWEEP = 1500;
  const FLY = 2100;
  const GLINT = 2500;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  /** A seeded generator of our own: the grains fall in the same places live and offline. */
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** A stable 0..1 number for one moment (a rocket at x, at t): it sounds the same every time. */
  function hash(a, b) { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); }

  // Gold: D major pentatonic, high up.
  const GOLD = [86, 88, 90, 93, 95, 98, 100, 102];

  // The voice budget (about 350 per animation). Live play is unseeded, so the corner rockets vary
  // (7 to 16 of them): past FULL voices the rockets get lighter, past CAP only a burst's body is left.
  const FULL = 334;
  const CAP = 350;
  let vBase = 0;        // APSfx.count when the bed was scheduled

  /** A cinematic hit with every band under control: crack, smack, punch, body, hall tail, sub. */
  function hit(P, t, o) {
    const g = o.gain == null ? 1 : o.gain;
    const pan = o.pan;
    P.noise(t, 0.07, { type: 'highpass', f0: o.crackF || 2600, q: 0.6, gain: 0.3 * g, a: 0.0008, r: 0.065, pan: pan, wet: 0.35 });
    P.noise(t, 0.4, { type: 'bandpass', f0: 1800, f1: 420, q: 0.8, gain: 0.5 * g, a: 0.001, r: 0.39, pan: pan, wet: 0.45 });
    P.tone(t, 0.55, { f0: o.punchF || 170, f1: 48, glide: 0.12, gain: 0.48 * g, a: 0.002, r: 0.53, drive: 3, lp: 2400, pan: pan, wet: 0.15 });
    P.noise(t, 2.2, { type: 'bandpass', f0: 900, f1: 150, glide: 1.2, q: 0.7, gain: 0.5 * g, a: 0.002, r: 2.18, pan: pan, wet: 0.55 });
    P.noise(t + 0.02, 4.5, { type: 'lowpass', f0: 700, f1: 60, glide: 3, q: 0.5, gain: 0.22 * g, a: 0.04, r: 4.4, pan: pan, wet: 0.8 });
    if (o.sub) P.tone(t, o.subDur || 2.2, { f0: o.subF || 58, f1: (o.subF || 58) / 2, glide: 0.6, gain: o.sub, a: 0.004, r: (o.subDur || 2.2) - 0.01, drive: 1.8, wet: 0.05 });
  }

  /** Brass: detuned driven saws on a chord, the filter blowing open (a braam when low). */
  function brass(P, t, notes, o) {
    const g = o.gain == null ? 0.2 : o.gain;
    const dur = o.dur || 2.5;
    const n = notes.length;
    notes.forEach((m, i) => [-7, 7].forEach((dt) => P.tone(t, dur, {
      type: 'sawtooth', f0: P.note(m), detune: dt + (i % 2 ? 2 : -2), gain: g / n, a: o.a || 0.035, r: o.r || dur * 0.7,
      lp: o.lp0 || 240, lp1: o.open || 2400, lpGlide: o.glide || 0.16, q: o.q || 1.5, drive: o.drive || 2,
      pan: (dt / 7) * 0.35 + (n > 1 ? (i / (n - 1) - 0.5) * 0.3 : 0), wet: o.wet == null ? 0.5 : o.wet
    })));
  }

  /** One grain of dust: a tiny bright tick. */
  function grain(P, t, g, pan, f) {
    P.noise(t, 0.012, { type: 'highpass', f0: f, q: 0.6, gain: g, a: 0.0006, r: 0.011, pan: clamp(pan, -0.9, 0.9), wet: 0.45 });
  }
  /** Gold catching the light: one high bell partial. */
  function glint(P, t, g, pan, m, dur) {
    P.tone(t, dur || 0.8, { f0: Math.min(15000, P.note(m)), gain: g, a: 0.003, r: dur || 0.8, pan: clamp(pan, -0.9, 0.9), wet: 0.8 });
  }

  S.define('stark', {
    bed(T, w, P) {
      vBase = S.count || 0;
      const r = prng(0x57A2C);

      /* ---- 0 ms: midnight. The gold pulse, its ring racing outwards ---- */
      hit(P, T(0), { gain: 1.05, sub: 0.3, subDur: 2.4 });
      P.metal(T(0), { base: P.note(62), gain: 0.07, decay: 3.4, wet: 0.8 });
      P.noise(T(0), 0.6, { type: 'bandpass', f0: 5200, f1: 900, q: 1.1, gain: 0.3, a: 0.006, r: 0.59, pan: -0.15, pan1: -0.85, wet: 0.55 });
      P.noise(T(0), 0.6, { type: 'bandpass', f0: 5600, f1: 1000, q: 1.1, gain: 0.3, a: 0.006, r: 0.59, pan: 0.15, pan1: 0.85, wet: 0.55 });

      /* ---- 0..2400: the gust brings the dust in from the left ---- */
      // the wind's body, then its airy top, both sweeping left to right; cut dead as the words lock
      const CUT = FORMED - 60;      // everything breathes in and stops a hair before the lock
      P.noise(T(120), (CUT - 120) / 1000, { type: 'bandpass', f0: 280, f1: 1300, q: 0.9, gain: 0.24, a: 0.45, r: 0.05, pan: -0.85, pan1: 0.35, wet: 0.35 });
      P.noise(T(800), (CUT - 800) / 1000, { type: 'bandpass', f0: 1400, f1: 5200, q: 1.1, gain: 0.13, a: 1.0, r: 0.04, pan: -0.75, pan1: 0.5, wet: 0.4 });
      P.noise(T(1500), (CUT - 1500) / 1000, { type: 'bandpass', f0: 500, f1: 2400, q: 0.8, gain: 0.3, a: 0.8, r: 0.03, pan: -0.3, pan1: 0.45, wet: 0.4 });
      // the reverse swell: the breath in before the words lock
      P.swell(T(900), (FORMED - 20 - 900) / 1000, { gain: 0.13, f0: 2200, f1: 7500, tone: P.note(50) });
      // a low drone on D rising out of the dust, its filter opening
      P.tone(T(400), (CUT - 400) / 1000, { type: 'sawtooth', f0: P.note(38), gain: 0.1, a: 1.0, r: 0.03, lp: 140, lp1: 1500, q: 1.5, drive: 1.8, pan: -0.15, wet: 0.4 });
      P.tone(T(900), (CUT - 900) / 1000, { type: 'sawtooth', f0: P.note(45), detune: 6, gain: 0.07, a: 0.9, r: 0.03, lp: 200, lp1: 2200, q: 1.3, drive: 1.6, pan: 0.2, wet: 0.45 });
      // a thin high-tech whine climbing to the lock
      P.tone(T(1000), (CUT - 1000) / 1000, { type: 'sine', f0: P.note(74), f1: P.note(86), gain: 0.03, a: 1.1, r: 0.03, vib: 8, vibHz: 6, wet: 0.5 });
      // the grains: denser as the words fill, following the gust across
      for (let i = 0; i < 36; i++) {
        const u = Math.sqrt(r());
        const ms = 150 + u * (CUT - 170);
        const along = clamp((ms - 300) / 2000, 0, 1);
        grain(P, T(ms), 0.06 + 0.1 * u, -0.85 + along * 1.5 + (r() - 0.5) * 0.4, 3000 + r() * 6000);
      }
      // gold catching the light as the grains settle (the words fill left to right)
      for (let i = 0; i < 10; i++) {
        const ms = 1100 + Math.pow(r(), 0.6) * 1250;
        glint(P, T(ms), 0.01 + 0.012 * r(), -0.7 + ((ms - 1100) / 1250) * 1.3, GOLD[(r() * 5) | 0], 0.5);
      }

      /* ---- 2400: the words lock ---- */
      const L = T(FORMED);
      brass(P, L, [38, 45, 50, 54, 57], { gain: 0.5, dur: 3.8, r: 3.2, open: 2400 });
      brass(P, L, [62, 66, 69, 74], { gain: 0.23, dur: 2.8, r: 2.4, open: 4000, glide: 0.1 });
      hit(P, L, { gain: 1.25, sub: 0.36, subF: 62, subDur: 3 });
      P.chime(L + 0.01, P.note(86), { gain: 0.05, dur: 3.8, pan: 0.3 });
      P.chime(L + 0.05, P.note(81), { gain: 0.04, dur: 3.4, pan: -0.35 });
      for (let i = 0; i < 8; i++) glint(P, L + 0.06 + Math.pow(r(), 1.6) * 1.4, 0.012 + 0.012 * r(), (r() - 0.5) * 1.6, GOLD[(r() * GOLD.length) | 0], 0.9);

      /* ---- 2400..8400: the hold ---- */
      P.pad(T(2700), 6.4, [38, 50, 57, 62, 64, 66], { gain: 0.07, a: 1.2, r: 2.0, lp: 1600 });
      // gold glitter in the air
      for (let i = 0; i < 14; i++) glint(P, T(3200 + r() * 5000), 0.006 + 0.008 * r(), (r() - 0.5) * 1.6, GOLD[(r() * GOLD.length) | 0], 1.0);
      // the glint crossing the words
      for (let k = 0; k < 3; k++) {
        const on = FORMED + k * GLINT + 440;
        const off = Math.min(FORMED + k * GLINT + 2060, HOLD_END);
        const dur = (off - on) / 1000;
        const full = off - on > 1000;
        P.noise(T(on), dur, { type: 'bandpass', f0: 5000, f1: 8500, q: 1.8, gain: full ? 0.09 : 0.06, a: dur * 0.5, r: dur * 0.5, pan: -0.7, pan1: full ? 0.7 : -0.1, wet: 0.6 });
        const n = full ? 3 : 1;
        for (let j = 0; j < n; j++) glint(P, T(on + (j + 0.5) * (off - on) / n), 0.009, -0.7 + ((j + 0.5) / n) * (full ? 1.4 : 0.6), GOLD[3 + j], 0.7);
      }

      /* ---- 8400: blown away ---- */
      const B = T(HOLD_END);
      P.swell(T(HOLD_END - 800), 0.8, { gain: 0.08, f0: 3000, f1: 8000, tone: P.note(62) });
      P.tone(B, 0.6, { f0: 110, f1: 36, glide: 0.16, gain: 0.16, a: 0.003, r: 0.58, drive: 2.5, lp: 900, wet: 0.2 });
      P.noise(B, 2.4, { type: 'bandpass', f0: 600, f1: 140, glide: 1.2, q: 0.7, gain: 0.22, a: 0.004, r: 2.38, wet: 0.65 });
      P.noise(B + 0.03, 5, { type: 'lowpass', f0: 420, f1: 55, glide: 3, q: 0.5, gain: 0.18, a: 0.05, r: 4.9, wet: 0.85 });
      P.tone(B, 3.2, { f0: 55, f1: 27, glide: 0.8, gain: 0.1, a: 0.005, r: 3.18, drive: 1.8, wet: 0.05 });
      // the brass sinking as the words go
      brass(P, B, [38, 45], { gain: 0.11, dur: 3.4, r: 3.2, lp0: 900, open: 160, glide: 2.6, q: 1.2, drive: 1.6, wet: 0.65 });
      P.pad(B + 0.2, 5.6, [45, 62, 69, 74], { gain: 0.07, a: 0.8, r: 2.6, lp: 1300 });
      // the wind carrying the dust off to the right and up
      P.whoosh(B, (SWEEP + 400) / 1000, { gain: 0.5, f0: 500, f1: 2600, pan: -0.75, pan1: 0.85, wet: 0.4 });
      P.noise(B, 2.8, { type: 'bandpass', f0: 1600, f1: 500, q: 0.8, gain: 0.26, a: 0.3, r: 1.2, pan: -0.45, pan1: 0.85, wet: 0.45 });
      P.noise(B, 4.0, { type: 'lowpass', f0: 480, q: 0.5, gain: 0.16, a: 0.5, r: 1.4, pan: -0.3, pan1: 0.7, wet: 0.4 });
      P.noise(T(HOLD_END + 400), 4.0, { type: 'bandpass', f0: 3200, f1: 1300, q: 0.9, gain: 0.09, a: 0.6, r: 1.3, pan: -0.1, pan1: 0.85, wet: 0.55 });
      // grains torn off the letters as the wave crosses them, thinning out
      for (let i = 0; i < 34; i++) {
        const u = r();
        const ms = HOLD_END + u * u * (SWEEP + 320 + FLY * 0.6);
        const along = clamp((ms - HOLD_END) / SWEEP, 0, 1);
        grain(P, T(ms), 0.1 * (1 - u * 0.75), -0.75 + along * 1.4 + (r() - 0.3) * 0.4, 2500 + r() * 6000);
      }
      for (let i = 0; i < 5; i++) glint(P, T(HOLD_END + 100 + r() * 2400), 0.006 + 0.006 * r(), -0.2 + r() * 1.0, GOLD[(r() * GOLD.length) | 0], 1.1);
    },

    cue(name, T, d, P) {
      // (fx.js always gives d.t; without it the moment is now. A time that is not a number would
      // block the engine's live queue, so such a moment is dropped.)
      const tMs = typeof d.t === 'number' ? d.t : 0;
      const t = T(tMs);
      if (!isFinite(t)) return;
      const x = typeof d.x === 'number' && isFinite(d.x) ? d.x : 0.5;
      const p = P.pan(x);
      const h = hash(tMs, x);
      const used = (S.count || 0) - vBase;
      if (name === 'launch') {
        if (used > CAP) return;
        // far off in a corner: a soft thump, the rocket climbing, a faint whistle
        if (used <= FULL) P.tone(t, 0.32, { f0: 95, f1: 42, glide: 0.09, gain: 0.14, a: 0.002, r: 0.3, drive: 1.5, lp: 420, pan: p * 0.7, wet: 0.45 });
        P.noise(t, 0.6, { type: 'bandpass', f0: 700, f1: 3400, q: 1.6, gain: 0.14, a: 0.4, r: 0.2, pan: p * 0.75, pan1: p, wet: 0.45 });
        if (used <= FULL) P.tone(t + 0.06, 0.5, { f0: 1500 + h * 600, f1: 2700 + h * 900, gain: 0.012, a: 0.3, r: 0.2, vib: 25, vibHz: 11, pan: p, wet: 0.55 });
      } else if (name === 'burst') {
        // a crackling burst with a soft boom, bigger or smaller, up in its corner
        const s = 0.75 + 0.5 * h;
        if (used <= CAP) P.tone(t, 0.7, { f0: 118, f1: 38, glide: 0.14, gain: 0.11 * s, a: 0.002, r: 0.68, drive: 2, lp: 700, pan: p * 0.8, wet: 0.4 });
        if (used <= FULL) P.noise(t, 0.06, { type: 'highpass', f0: 1800, q: 0.6, gain: 0.1 * s, a: 0.0008, r: 0.055, pan: p, wet: 0.55 });
        P.noise(t, 2.6, { type: 'bandpass', f0: 1000, f1: 160, glide: 1.4, q: 0.7, gain: 0.2 * s, a: 0.003, r: 2.55, pan: p, wet: 0.75 });
        if (used > FULL) return;
        P.noise(t + 0.12, 1.4, { type: 'highpass', f0: 5200, f1: 3800, q: 0.5, gain: 0.012 * s, a: 0.3, r: 1.05, pan: p, wet: 0.55 });
        const r = prng(Math.floor(h * 1e9));
        const n = 5 + Math.round(h * 3);
        for (let i = 0; i < n; i++) {
          const dt = 0.22 + Math.pow(r(), 0.8) * 1.1;
          grain(P, t + dt, 0.07 * s * (1 - dt / 1.6), p + (r() - 0.5) * 0.5, 1800 + r() * 4500);
        }
      }
    }
  });
})();
