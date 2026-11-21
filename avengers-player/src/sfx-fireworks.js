/*!
 * Avengers Player: the sound of 'fireworks'.
 *
 * Standing under a big professional show: every shell is heard where it flies (the 'launch' and
 * 'burst' cues fx.js reports for each rocket), the year blasts out of a gold burst (the 'boom'),
 * then the letters of the title pop in one by one ('pop'). Celebratory and original, in F.
 *
 *   0 ms        the show opens: the first salvo of four mortars and a deep hit; a breath in …
 *   560         … the reveal (fx.js fireworksReveal BOOM, the 'boom' cue): a huge impact, low and
 *               high brass on F, a glitter cascade, a pad swelling; the year's digits glint as they
 *               land (BOOM + 40 + |i - mid| x 90 ms; none without a year)
 *   pops        each letter of the title is a crackling pop, a bell climbing F pentatonic with them;
 *               a brass swell on C rises under them and lands …
 *   last pop    … when the words are complete: the climax, a bright brass stab on F and a crash
 *   .. 8.8 s    the show goes on: launches (mortar thump, lift, some whistle) and bursts near and far
 *   9..12 s     the outro: the last echoes roll away, a closing chord (B flat to F) as the words fade
 *               (DURATION - 1300 .. DURATION - 150), bells, then the hall
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // fx.js fireworksReveal: the boom at 560 ms; the year's digits land 40 ms later, outer ones 90 ms
  // apart; the title's letters then pop every 60 ms from 1250 ms (620 ms without a year).
  const BOOM = 560;
  const POP_GAP = 60;
  const FADE_AT = 12000 - 1300;     // the words fade out from here to the end (DURATION 12000)

  const letters = (s) => Array.from(s || '').filter((c) => c.trim()).length;
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  function prng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** A stable 0..1 number for one moment (a shell at x, at t): it sounds the same every time. */
  function hash(a, b) { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s); }

  // F major pentatonic, from F5 up: the bells that climb with the letters.
  const PENTA = [77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101, 103, 105, 108];

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

  /** Brass: detuned driven saws on a chord, the filter blowing open. */
  function brass(P, t, notes, o) {
    const g = o.gain == null ? 0.2 : o.gain;
    const dur = o.dur || 2.5;
    const n = notes.length;
    notes.forEach((m, i) => [-7, 7].forEach((dt) => P.tone(t, dur, {
      type: 'sawtooth', f0: P.note(m), detune: dt + (i % 2 ? 2 : -2), gain: g / n, a: o.a || 0.03, r: o.r || dur * 0.7,
      lp: o.lp0 || 260, lp1: o.open || 2600, lpGlide: o.glide || 0.14, q: o.q || 1.5, drive: o.drive || 2,
      pan: (dt / 7) * 0.35 + (n > 1 ? (i / (n - 1) - 0.5) * 0.3 : 0), wet: o.wet == null ? 0.5 : o.wet
    })));
  }

  /** A soft pad: one detuned pair of saws per note, dark and slow. */
  function pad(P, t, dur, notes, o) {
    const g = o.gain == null ? 0.06 : o.gain;
    const n = notes.length;
    notes.forEach((m, i) => [-6, 6].forEach((dt) => P.tone(t, dur, {
      type: 'sawtooth', f0: P.note(m), detune: dt, gain: g / n, a: o.a || 0.8, r: o.r || dur * 0.5,
      lp: o.lp || 1200, q: 0.6, pan: (dt / 6) * 0.35 + (n > 1 ? (i / (n - 1) - 0.5) * 0.4 : 0), wet: 0.65
    })));
  }

  /** One spark crackling: a tiny bright tick. */
  function click(P, t, g, pan, f) {
    P.noise(t, 0.014, { type: 'highpass', f0: f, q: 0.7, gain: g, a: 0.0005, r: 0.013, pan: clamp(pan, -0.9, 0.9), wet: 0.35 });
  }
  /** A bell partial glinting. */
  function glint(P, t, g, pan, m, dur) {
    P.tone(t, dur || 0.9, { f0: Math.min(15000, P.note(m)), gain: g, a: 0.002, r: dur || 0.9, pan: clamp(pan, -0.9, 0.9), wet: 0.75 });
  }

  let popCount = 0;     // the letters popped so far (reset when the animation starts)

  // The voice budget (about 350 per animation). Live play is unseeded, so the show's rocket count
  // varies (about 20 to 36): past FULL voices the shells get lighter, past CAP only a burst's body is left.
  const FULL = 334;
  const CAP = 350;
  let vBase = 0;        // APSfx.count when the bed was scheduled

  S.define('fireworks', {
    bed(T, w, P) {
      popCount = 0;
      vBase = S.count || 0;
      const n = letters(w.title);
      const hasYear = letters(w.year) > 0;
      const tLast = (hasYear ? 1250 : BOOM + 60) + Math.max(0, n - 1) * POP_GAP;

      /* ---- 0 ms: the show opens (the salvo's mortars come with their 'launch' cues) ---- */
      hit(P, T(0), { gain: 0.95, sub: 0.28, punchF: 140, crackF: 1800 });
      // the breath in before the reveal
      P.swell(T(90), (BOOM - 90) / 1000, { gain: 0.13, f0: 1800, f1: 7000, tone: P.note(53) });

      /* ---- the pops: a brass swell on C rising under them, landing on the last one ---- */
      const sw = (tLast - BOOM - 150) / 1000;
      if (sw > 0.2) {
        brass(P, T(BOOM + 150), [48, 55, 60, 64], { gain: 0.2, dur: sw, a: sw * 0.95, r: 0.03, lp0: 400, open: 2600, glide: sw, q: 1.2, drive: 1.6, wet: 0.45 });
        P.noise(T(BOOM + 150), sw, { type: 'bandpass', f0: 1500, f1: 7000, q: 1.2, gain: 0.12, a: sw * 0.95, r: 0.03, pan: -0.3, pan1: 0.3, wet: 0.4 });
      }

      /* ---- the outro: the last echoes, a closing chord as the words fade ---- */
      P.noise(T(9000), 3.2, { type: 'lowpass', f0: 260, f1: 70, glide: 2.5, q: 0.5, gain: 0.14, a: 0.6, r: 2.4, pan: -0.3, pan1: 0.4, wet: 0.8 });
      pad(P, T(9300), 2.0, [46, 58, 62], { gain: 0.09, a: 1.0, r: 0.8, lp: 1300 });             // B flat add 9 …
      pad(P, T(FADE_AT - 100), 4.0, [53, 60, 67, 69], { gain: 0.1, a: 0.7, r: 2.8, lp: 1500 });  // … to F
      P.chime(T(FADE_AT), P.note(89), { gain: 0.045, dur: 4, pan: -0.25 });
      glint(P, T(FADE_AT + 180), 0.02, 0.3, 96, 3);
      P.tone(T(FADE_AT - 100), 3.2, { f0: P.note(41), gain: 0.035, a: 0.8, r: 2.2, drive: 1.4, wet: 0.3 });
    },

    cue(name, T, d, P, w) {
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
        // the mortar's thump on the ground, the shell lifting, some with a whistle
        if (used <= FULL) P.tone(t, 0.36, { f0: 150, f1: 44, glide: 0.07, gain: 0.14, a: 0.002, r: 0.34, drive: 2.6, lp: 1400, pan: p * 0.6, wet: 0.3 });
        P.noise(t + 0.02, 0.62, { type: 'bandpass', f0: 500, f1: 3000, q: 1.4, gain: 0.13, a: 0.32, r: 0.28, pan: p * 0.6, pan1: p, wet: 0.4 });
        if (h < 0.32 && used <= FULL) P.tone(t + 0.05, 0.68, { f0: 700 + h * 1200, f1: (700 + h * 1200) * 2.7, gain: 0.03, a: 0.16, r: 0.3, vib: 30, vibHz: 13, pan: p, wet: 0.5 });
      } else if (name === 'burst') {
        // near, middling or far: the bigger the closer (louder, brighter, more crackle)
        const r = prng(Math.floor(h * 1e9) + 7);
        const far = h < 0.3;
        const big = h > 0.7 && used <= FULL;
        const s = far ? 0.55 : big ? 0.9 : 0.75;
        if (used > FULL) {
          // past the budget: the shell's body (and its crack while some room is left)
          if (!far && used <= CAP) P.noise(t, 0.08, { type: 'highpass', f0: 2000, q: 0.6, gain: 0.17 * s, a: 0.0008, r: 0.075, pan: p, wet: 0.45 });
          P.noise(t, far ? 2.4 : 2.8, { type: 'bandpass', f0: far ? 700 : 1300, f1: 140, glide: 1.4, q: 0.7, gain: (far ? 0.36 : 0.26) * s, a: 0.003, r: far ? 2.38 : 2.78, pan: p, wet: far ? 0.85 : 0.65 });
          return;
        }
        if (!far) {
          P.noise(t, 0.08, { type: 'highpass', f0: 2000, q: 0.6, gain: 0.17 * s, a: 0.0008, r: 0.075, pan: p, wet: 0.45 });
          P.tone(t, 0.6, { f0: 135, f1: 40, glide: 0.11, gain: 0.15 * s, a: 0.002, r: 0.58, drive: 2.6, lp: 1600, pan: p, wet: 0.3 });
          P.noise(t + 0.1, 1.6, { type: 'highpass', f0: 5000, f1: 3500, q: 0.5, gain: 0.02 * s, a: 0.35, r: 1.2, pan: p, wet: 0.5 });
        }
        P.noise(t, far ? 2.4 : 2.8, { type: 'bandpass', f0: far ? 700 : 1300, f1: 140, glide: 1.4, q: 0.7, gain: (far ? 0.36 : 0.26) * s, a: 0.003, r: far ? 2.38 : 2.78, pan: p, wet: far ? 0.85 : 0.65 });
        if (big) P.noise(t + 0.05, 4, { type: 'lowpass', f0: 500, f1: 60, glide: 2.8, q: 0.5, gain: 0.12, a: 0.05, r: 3.9, pan: p, wet: 0.85 });
        const k = far ? 1 : big ? 3 : 1;
        for (let i = 0; i < k; i++) {
          const dt = 0.25 + Math.pow(r(), 0.8) * 1.2;
          click(P, t + dt, 0.12 * s * (1 - dt / 1.7), p + (r() - 0.5) * 0.6, 2000 + r() * 5000);
        }
      } else if (name === 'boom') {
        // the reveal: the year (or the title) blasts out of a gold burst
        const r = prng(0xB00);
        hit(P, t, { gain: 1.2, sub: 0.38, subF: 60, subDur: 3, pan: p * 0.3 });
        brass(P, t, [41, 48, 53, 57], { gain: 0.4, dur: 3.2, r: 2.8, open: 2600 });
        brass(P, t + 0.015, [60, 65, 69], { gain: 0.17, dur: 2.4, r: 2.0, open: 4000, glide: 0.1 });
        P.chime(t + 0.02, P.note(89), { gain: 0.05, dur: 3.6, pan: 0.2 });
        // the glitter cascade of its 150 sparks
        P.noise(t + 0.08, 2.2, { type: 'highpass', f0: 6000, f1: 4000, q: 0.5, gain: 0.04, a: 0.3, r: 1.7, pan: p, wet: 0.6 });
        for (let i = 0; i < 4; i++) {
          const dt = 0.2 + Math.pow(r(), 0.7) * 1.6;
          click(P, t + dt, 0.13 * (1 - dt / 2.1), (r() - 0.5) * 1.4, 2200 + r() * 5000);
        }
        pad(P, t + 0.1, 6.4, [53, 60, 67, 69], { gain: 0.08, a: 1.0, r: 3.0, lp: 1500 });
        // the year's digits landing (fx.js: BOOM + 40 + |i - mid| x 90 ms), outer ones last
        const ny = letters(w.year);
        const mid = (ny - 1) / 2;
        for (let i = 0; i < ny; i++) {
          const at = BOOM + 40 + Math.abs(i - mid) * 90;
          glint(P, T(at), 0.03, ny > 1 ? (i / (ny - 1) - 0.5) * 0.7 : 0, PENTA[5 + Math.round(Math.abs(i - mid))], 1.2);
        }
      } else if (name === 'pop') {
        // a letter pops in: a firecracker snap, a couple of sparks, and a bell a step higher
        const i = popCount++;
        const n = letters(w.title);
        const r = prng(Math.floor(h * 1e9) + 3);
        P.noise(t, 0.09, { type: 'bandpass', f0: 2400, f1: 700, glide: 0.05, q: 0.9, gain: 0.5, a: 0.0006, r: 0.088, pan: p, wet: 0.45 });
        click(P, t + 0.05 + r() * 0.25, 0.1, p + (r() - 0.5) * 0.4, 2500 + r() * 5000);
        glint(P, t + 0.004, 0.028, p, PENTA[Math.min(PENTA.length - 1, i)], 1.0);
        if (i === n - 1) {
          // the words are complete: the climax
          brass(P, t, [53, 65, 69, 77], { gain: 0.4, dur: 2.8, r: 2.4, open: 4400, glide: 0.08 });
          hit(P, t, { gain: 0.95, sub: 0.26, subF: 55, crackF: 3200 });
          P.noise(t, 2.8, { type: 'highpass', f0: 3200, f1: 6000, glide: 1.5, q: 0.5, gain: 0.1, a: 0.004, r: 2.7, pan: -0.3, wet: 0.6 });
          P.noise(t + 0.01, 2.8, { type: 'highpass', f0: 3600, f1: 6500, glide: 1.5, q: 0.5, gain: 0.1, a: 0.004, r: 2.7, pan: 0.3, wet: 0.6 });
          P.chime(t + 0.02, P.note(96), { gain: 0.045, dur: 3.4, pan: 0.3 });
        }
      }
    }
  });
})();
