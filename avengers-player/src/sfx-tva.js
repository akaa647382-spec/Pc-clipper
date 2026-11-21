/*!
 * Avengers Player: the sound of 'tva', branching time (see fx-tva.js for the picture). Retro and
 * bureaucratic, a little eerie: everything sits on A, with whole-tone glass for the timelines.
 *
 *   0.0 s    the flare: an impact with a time-jump zap falling through it and an amber chord; the
 *            timeline shoots out to both edges (two whooshes flying apart), the ring of light races
 *            out, and the slit grows with a thin whine.
 *   0.25 s+  the split-flap clock: each card flips in (a swish, then its flap clacks down, panned to
 *            the digit); the digit that changes riffles through blank flaps (light clacks) and lands
 *            with a heavy clack at 0.98 s: the new year is complete (a warm hit and a bloom).
 *   0.43 s   the door of light opens: a low hum swelling in, a time-warp whoosh, an eerie original
 *            sweep (two detuned sines gliding a tritone apart, wavering).
 *   0.7-3 s  every fork of the tree flashes with a glassy ping (whole-tone, panned where it splits).
 *   1.06 s   the cursor switches on; from 1.28 s the title types out, a typewriter key per character
 *            exactly as it appears (a duller thunk for a space), building on a riser; at the last key
 *            the carriage bell rings over the climax (a hit and an amber chord). (No year: from 0.52 s.)
 *   3-7.9 s  the hold: the hum and a soft chord, and a clock ticking (tick, tock).
 *   5.6 s    the surge: a reverse swell into a hit and a chord, the wave whooshing out to both sides.
 *   7.9 s    pruning: whooshes drawn back from the edges, the eerie sweep falling; at 9.3 s the hands
 *            wind back to midnight (a ratchet that speeds up and slows down), at 9.75 s the timeline
 *            is reeled in (whooshes closing on the middle); the door closes (the hum powers down).
 *   10.45 s  the cursor comes back and unwrites the title from its end (reversed keys), the flaps
 *            clack back to blank right to left, the slit collapses (a reverse swell into a soft low
 *            implosion at 11.3 s) and winks out (a last glint); then the hall's tail.
 *
 * The moments that depend on the words, the screen or the seed (every flap, every key and its
 * unwriting, every fork, the cursor) come from the animation's plan (fx-tva.js, create()).
 * Original sound design: no melody or motif from any film or show.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-tva.js (ms).
  const T_LINE = 560;
  const T_SLIT1 = 470;
  const T_OPEN0 = 430;
  const T_OPEN1 = 1350;
  const REWIND_DUR = 900;
  const BACK_DUR = 750;
  const T_CLOSE1 = 11050;
  const T_WINK1 = 11730;

  const A1 = 55;
  // Whole-tone glass for the forks (A5 B5 C#6 D#6 F6 G6), lower for the first generation.
  const GLASS = [81, 83, 85, 87, 89, 91];

  let planned = false;                      // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  /** A full-range hit (7 voices): crack, punch, a warm body in the mids, a driven growl, sub, tail. */
  function hit(P, t, o) {
    const s = o.size == null ? 1 : o.size;
    const pan = o.pan;
    P.transient(t, { gain: 0.36 * s, pan: pan, f: 2200 });
    P.punch(t, { gain: 0.48 * s, pan: pan, f0: 140, f1: 44 });
    P.noise(t, 0.8, { type: 'bandpass', f0: 1200, f1: 200, glide: 0.4, q: 0.7, gain: 0.46 * s, a: 0.002, r: 0.78, pan: pan, wet: 0.5 });
    P.tone(t, 1, { type: 'sawtooth', f0: A1 * 1.5, f1: A1 * 0.75, glide: 0.45, gain: 0.2 * s, a: 0.003, r: 0.98, lp: 1500, lp1: 200, lpGlide: 0.5, q: 0.8, drive: 3, pan: pan, wet: 0.4 });
    P.sub(t, { gain: 0.36 * s, f0: 60, f1: 27, dur: 1 + 0.6 * s });
    P.noise(t + 0.02, 1.8 + s, { type: 'lowpass', f0: 760, f1: 90, q: 0.5, gain: 0.2 * s, a: 0.03, r: 1.7 + s, pan: pan, wet: 0.75 });
  }

  /** An analog synth chord: detuned saws, the filter opening and closing, in the hall. */
  function chord(P, t, notes, len, g, open, a) {
    notes.forEach((m, i) => [-7, 7].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: P.note(m), detune: dt + (P.rand() - 0.5) * 3, gain: g / notes.length / (1 + i * 0.15),
      a: a == null ? 0.03 : a, r: len * 0.7, lp: 220, lp1: open, lpGlide: 0.14, q: 1.2, drive: 1.4, pan: dt / 14 + (i - (notes.length - 1) / 2) * 0.1, wet: 0.6
    })));
  }

  /** The eerie sweep: two sines a little apart, gliding, wavering (5 Hz), far back in the hall. */
  function eerie(P, t, len, f0, f1, g) {
    P.tone(t, len, { f0: f0, f1: f1, glide: len * 0.7, gain: g, a: len * 0.35, r: len * 0.5, vib: 28, vibHz: 5.2, pan: -0.3, wet: 0.75 });
    P.tone(t, len, { f0: f0 * 1.4142, f1: f1 * 1.4142, glide: len * 0.7, gain: g * 0.6, a: len * 0.4, r: len * 0.5, vib: 22, vibHz: 4.6, pan: 0.3, wet: 0.75 });
  }

  /** A typewriter key struck backwards: the slug lifting off the platen, the key rising. */
  function unkey(P, t, g, pan) {
    P.noise(t - 0.035, 0.038, { type: 'bandpass', f0: 1400, f1: 2600, q: 2, gain: g, a: 0.034, r: 0.003, pan: pan, wet: 0.2 });
    P.noise(t, 0.012, { type: 'highpass', f0: 3000, q: 0.7, gain: g * 0.7, a: 0.0005, r: 0.011, pan: pan, wet: 0.15 });
  }

  S.define('tva', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: the flare, the timeline shooting out, the ring racing out ---- */
      hit(P, T(0), { size: 1.35 });
      P.tone(T(0), 0.5, { type: 'triangle', f0: 1760, f1: 110, glide: 0.42, gain: 0.12, a: 0.002, r: 0.48, vib: 40, vibHz: 18, wet: 0.5 });
      chord(P, T(0), [45, 52, 57, 60], 2, 0.32, 2600);
      for (const side of [-0.85, 0.85]) P.whoosh(T(0), T_LINE / 1000, { gain: 0.3, f0: 2600, f1: 900, pan: 0, pan1: side, wet: 0.4 });
      P.noise(T(0), 0.5, { type: 'bandpass', f0: 500, f1: 2400, q: 0.9, gain: 0.16, a: 0.01, r: 0.48, wet: 0.5 });
      // the slit grows to the door's height
      P.tone(T(30), (T_SLIT1 - 30) / 1000, { f0: 1320, f1: 2640, gain: 0.02, a: 0.1, r: 0.2, wet: 0.6 });

      /* ---- 0.43 s: the door of light opens ---- */
      P.whoosh(T(T_OPEN0), (T_OPEN1 - T_OPEN0) / 1000, { gain: 0.22, f0: 220, f1: 1400, pan: -0.5, pan1: 0.5, wet: 0.55 });
      eerie(P, T(T_OPEN0), 2.4, 440, 659, 0.045);
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const digits = Array.isArray(d.digits) ? d.digits : [];
      const keys = Array.isArray(d.keys) ? d.keys : [];
      const forks = Array.isArray(d.forks) ? d.forks : [];
      const typed = fin(d.typed, keys.length ? fin(keys[keys.length - 1].t, 2500) : 2500);
      const surge = fin(d.surge, 5600);
      const prune = fin(d.prune, 7900);
      const close = fin(d.close, 10350);
      const wink = fin(d.wink, 11300);

      /* ---- the split-flap clock ---- */
      for (const e of digits) {
        const pan = P.pan(fin(e.x, 0.5));
        const tIn = fin(e.tIn, 250);
        const land = Math.max(tIn + 20, fin(e.land, tIn + 170));
        P.noise(T(tIn), 0.12, { type: 'bandpass', f0: 1800, f1: 3800, q: 1.2, gain: 0.05, a: 0.08, r: 0.04, pan: pan, wet: 0.2 });
        for (const r of (Array.isArray(e.riffles) ? e.riffles : [])) P.clack(T(fin(r, tIn)), { gain: 0.45, pan: pan });
        if (e.clack) {
          // the new year lands: a heavy clack, a warm hit, the year lighting up
          P.clack(T(land), { gain: 1.4, pan: pan });
          P.punch(T(land), { gain: 0.3, pan: pan, f0: 220, f1: 70 });
          hit(P, T(land), { size: 0.75 });
          chord(P, T(land), [57, 64, 69, 71], 1.8, 0.14, 3800, 0.01);
        } else {
          P.clack(T(land), { gain: 0.75, pan: pan });
        }
      }

      /* ---- the forks of the tree: glass, panned where each splits ---- */
      forks.forEach((f, i) => {
        const g = clamp(Math.round(fin(f.gen, 2)), 1, 6);
        const m = GLASS[(i * 5 + g * 2) % GLASS.length] - (g === 1 ? 12 : 0);
        P.tone(T(fin(f.t, 800)), 1.2, { type: 'sine', f0: P.note(m), gain: g === 1 ? 0.035 : 0.022, a: 0.003, r: 1.19, pan: P.pan(fin(f.x, 0.5)), wet: 0.75 });
      });

      /* ---- the terminal: the cursor, the keys, the bell and the climax ---- */
      const cur = fin(d.cursor, 1060);
      P.tone(T(cur), 0.05, { type: 'square', f0: 1046, gain: 0.025, a: 0.001, r: 0.045, lp: 2500, wet: 0.3 });
      P.noise(T(cur), 0.6, { type: 'highpass', f0: 9000, q: 0.7, gain: 0.012, a: 0.02, r: 0.5, wet: 0.3 });
      keys.forEach((k, i) => {
        const t = T(fin(k.t, 1300 + i * 90));
        const pan = P.pan(fin(k.x, 0.5));
        if (k.space) {
          P.tone(t, 0.09, { f0: 130, f1: 80, gain: 0.3, a: 0.001, r: 0.085, pan: pan, wet: 0.15 });
          P.noise(t, 0.05, { type: 'lowpass', f0: 900, q: 0.8, gain: 0.25, a: 0.001, r: 0.048, pan: pan, wet: 0.15 });
        } else {
          P.key(t, { gain: 0.7 + 0.2 * (i / Math.max(1, keys.length - 1)), pan: pan });
        }
      });
      // the typing builds to the end of the line
      const k0 = keys.length ? fin(keys[0].t, typed - 1200) : typed - 1200;
      const rise = clamp((typed - k0) / 1000 + 0.1, 0.4, 1.6);
      P.riser(T(typed) - rise, rise, { gain: 0.11, p0: 110, p1: 880, f0: 400, f1: 6000 });
      P.swell(T(typed) - 0.45, 0.45, { gain: 0.1, tone: 220 });
      // the carriage bell over the climax
      P.chime(T(typed) + 0.03, 1975.5, { gain: 0.11, dur: 2.4, pan: 0.5 });
      hit(P, T(typed), { size: 1.5 });
      chord(P, T(typed), [45, 52, 59, 60, 64], 3.2, 0.4, 3000);
      P.shimmer(T(typed) + 0.05, 1.2, { gain: 0.03, base: 1760 });
      // the cursor blinking at the end of the line: a faint tick each time it comes back on
      const bl = fin(d.blink, typed + 140);
      const bms = Math.max(200, fin(d.blinkMs, 1060));
      for (let b = 1; bl + b * bms < fin(d.curOff, bl + 2400); b++) P.tone(T(bl + b * bms), 0.03, { type: 'square', f0: 2093, gain: 0.012, a: 0.001, r: 0.028, lp: 4000, pan: 0.6, wet: 0.3 });

      /* ---- the hold: the hum, a soft chord, the clock ticking ---- */
      P.hum(T(T_OPEN0), (close - T_OPEN0) / 1000 + 0.5, { f: A1, gain: 0.024, a: 0.9, r: 0.6, lp: 420 });
      P.pad(T(typed) + 0.6, (prune - typed) / 1000 + 0.6, [45, 52, 59, 64], { gain: 0.03, lp: 1000, a: 1.6, r: 1.2 });
      let tk = 0;
      for (let t = Math.ceil((typed + 700) / 500) * 500; t < prune - 100; t += 500, tk++) {
        const tock = tk % 2 === 1;
        P.tick(T(t), { gain: tock ? 0.4 : 0.5, f: tock ? 2500 : 3400, pan: tock ? 0.15 : -0.15 });
        P.tone(T(t), 0.04, { f0: tock ? 520 : 700, gain: 0.05, a: 0.001, r: 0.038, pan: tock ? 0.15 : -0.15, wet: 0.35 });
      }

      /* ---- the surge ---- */
      P.riser(T(surge) - 1.2, 1.2, { gain: 0.1, p0: 110, p1: 660 });
      P.swell(T(surge) - 0.7, 0.7, { gain: 0.13, tone: 220 });
      hit(P, T(surge) + 0.04, { size: 0.8 });
      chord(P, T(surge) + 0.04, [41, 48, 57, 60, 65], 2.6, 0.26, 2800);
      for (const side of [-0.85, 0.85]) P.whoosh(T(surge), 1.1, { gain: 0.26, f0: 700, f1: 3200, pan: 0, pan1: side, wet: 0.45 });

      /* ---- the outro: pruned, wound back, reeled in, shut ---- */
      for (const side of [-0.85, 0.85]) P.whoosh(T(prune), 1.1, { gain: 0.3, f0: 2800, f1: 500, pan: side, pan1: side * 0.3, wet: 0.5 });
      eerie(P, T(prune), 2.2, 659, 330, 0.04);
      // the hands wind back to midnight: a ratchet speeding up, then slowing
      const rw = fin(d.rewind, 9300);
      const N = 18;
      for (let k = 1; k < N; k++) {
        const y = k / N;
        const u = y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2;       // the inverse of an ease-in-out
        P.tick(T(rw + u * REWIND_DUR), { gain: 0.8, f: 3000 + (k % 2) * 500, pan: 0 });
      }
      const back = fin(d.back, 9750);
      for (const side of [-0.85, 0.85]) P.whoosh(T(back), BACK_DUR / 1000, { gain: 0.34, f0: 600, f1: 2600, pan: side, pan1: 0, wet: 0.4 });
      P.powerDown(T(close), (T_CLOSE1 - close) / 1000 + 0.3, { f0: 220, f1: 40, gain: 0.08 });
      P.swell(T(wink) - 0.8, 0.8, { gain: 0.12, tone: 110 });
      P.punch(T(wink), { gain: 0.18, f0: 120, f1: 36 });
      P.sub(T(wink), { gain: 0.12, f0: 55, f1: 26, dur: 1.6 });
      P.noise(T(wink), 1.6, { type: 'lowpass', f0: 900, f1: 120, q: 0.6, gain: 0.12, a: 0.004, r: 1.58, wet: 0.7 });
      chord(P, T(wink), [45, 52, 57], 2.2, 0.1, 900);
      P.tone(T(T_WINK1) - 0.08, 1.4, { f0: 3520, gain: 0.03, a: 0.002, r: 1.38, wet: 0.8 });

      /* ---- the title unwritten, the flaps back to blank ---- */
      const er = fin(d.erase, 10450);
      P.tone(T(er), 0.05, { type: 'square', f0: 1046, gain: 0.022, a: 0.001, r: 0.045, lp: 2500, wet: 0.3 });
      for (const k of keys) {
        const pan = P.pan(fin(k.x, 0.5));
        unkey(P, T(fin(k.off, er + 200)), k.space ? 0.3 : 0.5, pan);
      }
      for (const e of digits) P.clack(T(fin(e.out, 11000)), { gain: 0.85, pan: P.pan(fin(e.x, 0.5)) });
    }
  });
})();
