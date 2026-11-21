/*!
 * Avengers Player: the sound of 'doom', sorcery and steel (see fx-doom.js for the picture). Dark and
 * heavy, everything on D minor: green fire, branded steel, an ominous drone and a dark choir.
 *
 *   0.0 s    the green flash: an impact with a whoomp of fire catching, a dark braam, the rays
 *            crackling and the shock ring rushing out; the two heads of fire race round the circle
 *            from the top (a roar flying out to each side, then slowing down to the bottom), the
 *            inner ring is traced from below (a low roar) and the figure draws itself (a dark sweep).
 *   0.15 s   the spark leaps from the fire to the first letter (a crackling zap flying across); the
 *            title is burnt in letter after letter: per letter a burst of fire running across it, a
 *            crackle, and the hiss of the hot steel cooling, panned where the letter is.
 *   1.06 s   the circle surges onto the year (a reverse swell into a burst of fire at 1.34 s), and
 *            the year is branded centre digits first: per digit a heavy hit with a metallic ring and
 *            a hiss of burning. The last brand (or, with no year, the last letter) is the climax: a
 *            big hit, a braam, the dark choir coming in over the drone.
 *   1.9-9 s  the circle turns: a low drone and the choir moving through three dark chords; the steel
 *            sheen sweeping across three times; at 4.15 s and 7.05 s the circle surges (a riser into
 *            an impact, a gust of fire, a low brass stab).
 *   9.35 s   the circle gathers itself and spins faster (a long riser, a whine climbing, the fire
 *            roaring up, a reverse swell, the choir swelling on a darker chord); it collapses inward
 *            from 9.95 s (its fire drawn in from both sides), the letters catch fire again and melt
 *            into flames (a gust per letter, centre first); at 11.05 s the green flash: the
 *            implosion, the biggest hit, a sub drop, a braam, rumble and embers; then silence and
 *            the hall's tail.
 *
 * The moments that depend on the words or the screen (the spark, every letter's burn and melt, the
 * surge onto the year, every brand) come from the animation's plan (fx-doom.js, create()).
 * Original sound design: no melody or motif from any film, game or comic.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-doom.js (ms) the opening needs (the rest comes with the plan).
  const T_TRACE = 900;
  const T_IN0 = 220;
  const T_IN1 = 1080;
  const T_FIG0 = 520;
  const T_FIG1 = 1500;
  const TRACE_DUR = 300;
  const BRAND_DUR = 340;
  const MELT_DUR = 520;
  const SHEEN_DUR = 1300;

  const D1 = 36.71;
  // The choir: D minor, then B flat, then G minor over D (midi).
  const CHORDS = [[50, 53, 57, 62], [50, 53, 58, 62], [50, 55, 58, 62]];

  let planned = false;                      // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  /** A full-range hit (7 voices): crack, punch, a body in the mids, a driven growl, sub, tail. */
  function hit(P, t, o) {
    const s = o.size == null ? 1 : o.size;
    const pan = o.pan;
    P.transient(t, { gain: 0.4 * s, pan: pan, f: 2400 });
    P.punch(t, { gain: 0.5 * s, pan: pan, f0: 150, f1: 44 });
    P.noise(t, 0.8, { type: 'bandpass', f0: 1300, f1: 190, glide: 0.4, q: 0.7, gain: 0.48 * s, a: 0.002, r: 0.78, pan: pan, wet: 0.5 });
    P.tone(t, 1, { type: 'sawtooth', f0: D1 * 2, f1: D1, glide: 0.45, gain: 0.22 * s, a: 0.003, r: 0.98, lp: 1500, lp1: 200, lpGlide: 0.5, q: 0.8, drive: 3, pan: pan, wet: 0.4 });
    P.sub(t, { gain: 0.38 * s, f0: 62, f1: 26, dur: 1 + 0.6 * s });
    P.noise(t + 0.02, 1.8 + s, { type: 'lowpass', f0: 700, f1: 80, q: 0.5, gain: 0.22 * s, a: 0.03, r: 1.7 + s, pan: pan, wet: 0.75 });
  }

  /** A braam on a chord (midi): detuned saws, driven, the filter blowing open, in the hall. */
  function braam(P, t, notes, len, g, open) {
    notes.forEach((m, i) => [-9, 9].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: P.note(m), detune: dt + (P.rand() - 0.5) * 4, gain: g / notes.length / (1 + i * 0.2),
      a: 0.04, r: len * 0.6, lp: 150, lp1: open, lpGlide: 0.18, q: 1.5, drive: 2.2, pan: dt / 18, wet: 0.55
    })));
  }

  /** The dark choir: per note two saws through a resonant low-pass (an 'ah' of sorts), slow vibrato,
   *  swelling in and out; a breath of noise round the vowel. */
  function choir(P, t, len, notes, g, a, r) {
    notes.forEach((m, i) => {
      const f = P.note(m);
      const pan = (i - (notes.length - 1) / 2) * 0.28;
      P.tone(t, len, { type: 'sawtooth', f0: f, detune: -6, gain: g / notes.length, a: a, r: r, lp: 950, q: 3.2, vib: 14, vibHz: 4.8 + i * 0.3, pan: pan - 0.1, wet: 0.75 });
      P.tone(t, len, { type: 'triangle', f0: f, detune: 7, gain: g * 0.7 / notes.length, a: a, r: r, vib: 11, vibHz: 5.3 - i * 0.2, pan: pan + 0.1, wet: 0.75 });
    });
    P.noise(t, len, { type: 'bandpass', f0: 820, q: 2.5, gain: g * 0.3, a: a, r: r, wet: 0.8 });
  }

  /** A burst of green fire (2 voices): the gust and its low body. */
  function gust(P, t, g, pan, len) {
    const d = len || 0.6;
    P.noise(t, d, { type: 'bandpass', f0: 500, f1: 1900, glide: d * 0.3, q: 0.8, gain: g, a: 0.012, r: d * 0.9, pan: pan, wet: 0.4 });
    P.tone(t, d * 0.7, { type: 'sawtooth', f0: 96, f1: 48, glide: d * 0.4, gain: g * 0.4, a: 0.006, r: d * 0.65, lp: 600, drive: 2.5, pan: pan, wet: 0.3 });
  }

  /** A few sparks popping (n voices). */
  function pops(P, t, dur, n, g, pan, spread) {
    for (let i = 0; i < n; i++) {
      P.noise(t + P.rand() * dur, 0.006 + P.rand() * 0.014, { type: 'highpass', f0: 2200 + P.rand() * 4500, q: 0.8, gain: g * (0.4 + P.rand() * 0.6), a: 0.0005, r: 0.012, pan: clamp((pan || 0) + (P.rand() - 0.5) * (spread || 0.6), -1, 1), wet: 0.3 });
    }
  }

  S.define('doom', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: the green flash ---- */
      hit(P, T(0), { size: 1.3 });
      P.whoomp(T(0), { gain: 0.55 });
      braam(P, T(0), [26, 38, 45, 50], 2.2, 0.36, 1800);
      P.noise(T(0), 0.55, { type: 'bandpass', f0: 300, f1: 2600, q: 0.8, gain: 0.2, a: 0.008, r: 0.53, wet: 0.5 });
      pops(P, T(0), 0.35, 6, 0.2, 0, 1.4);

      /* ---- the two heads of fire racing round the circle (out to the sides, then down) ---- */
      // the left head is level with the middle at about 0.19 s (the circle is drawn with an ease-out)
      for (const side of [-1, 1]) {
        const wide = side * 0.6;
        P.noise(T(0), 0.2, { type: 'bandpass', f0: 1100, f1: 1700, q: 0.9, gain: 0.16, a: 0.02, r: 0.17, pan: 0, pan1: wide, wet: 0.35 });
        P.noise(T(190), (T_TRACE - 190) / 1000, { type: 'lowpass', f0: 1400, f1: 500, q: 0.7, gain: 0.12, a: 0.02, r: 0.66, pan: wide, pan1: side * 0.1, wet: 0.4 });
      }
      // the inner ring traced from below, the figure drawing itself
      P.noise(T(T_IN0), (T_IN1 - T_IN0) / 1000, { type: 'lowpass', f0: 260, f1: 900, q: 0.9, gain: 0.12, a: 0.4, r: 0.4, wet: 0.5 });
      P.tone(T(T_FIG0), (T_FIG1 - T_FIG0) / 1000 + 0.6, { type: 'triangle', f0: P.note(62), f1: P.note(63), gain: 0.025, a: 0.5, r: 0.8, vib: 30, vibHz: 3.3, wet: 0.8 });
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const title = Array.isArray(d.title) ? d.title : [];
      const year = Array.isArray(d.year) ? d.year : [];
      const surges = Array.isArray(d.surges) ? d.surges : [4150, 7050];
      const sheens = Array.isArray(d.sheens) ? d.sheens : [2600, 5650, 8350];
      const charge = fin(d.charge, 9350);
      const collapse = fin(d.collapse, 9950);
      const flash = fin(d.flash, 11050);

      /* ---- the spark leaps to the first letter ---- */
      const cross = fin(d.cross, 150);
      if (d.bolt && title.length) {
        const p0 = P.pan(fin(d.bolt.x0, 0.2));
        const p1 = P.pan(fin(d.bolt.x1, 0.25));
        P.tone(T(cross), 0.16, { type: 'sawtooth', f0: 98, gain: 0.14, a: 0.002, r: 0.15, drive: 6, lp: 3800, pan: p0, pan1: p1, wet: 0.3 });
        P.noise(T(cross), 0.14, { type: 'bandpass', f0: 4200, f1: 1800, q: 1.2, gain: 0.16, a: 0.002, r: 0.13, pan: p0, pan1: p1, wet: 0.35 });
        pops(P, T(cross), 0.12, 3, 0.18, p1, 0.3);
      }

      /* ---- the title burnt in, letter after letter ---- */
      let tEnd = 0;
      title.forEach((o, i) => {
        const t0 = fin(o.t, 300 + i * 55);
        const pan = P.pan(fin(o.x, 0.5));
        const up = i / Math.max(1, title.length - 1);
        gust(P, T(t0), 0.2 + 0.06 * up, pan, 0.5);
        P.noise(T(t0) + 0.05, 1, { type: 'highpass', f0: 4200, f1: 5600, q: 0.6, gain: 0.05, a: 0.06, r: 0.9, pan: pan, wet: 0.3 });
        pops(P, T(t0) + 0.04, TRACE_DUR / 1000, 1, 0.16, pan, 0.2);
        tEnd = Math.max(tEnd, t0);
      });

      /* ---- the year branded, centre digits first; the climax ---- */
      let climax = title.length ? tEnd + TRACE_DUR : 1200;
      if (year.length) {
        const gather = fin(d.gather, 1060);
        const burst = Math.max(gather + 100, fin(d.burst, gather + 280));
        P.swell(T(gather) - 0.35, (burst - gather) / 1000 + 0.35, { gain: 0.15, tone: 146.8 });
        P.whoomp(T(burst), { gain: 0.45 });
        // the brands: digits branded together are one heavy hit with a ring per digit
        const times = [];
        for (const o of year) { const t0 = fin(o.t, burst); if (!times.some((x) => Math.abs(x - t0) < 5)) times.push(t0); }
        times.sort((a, b) => a - b);
        times.forEach((t0, k) => {
          const here = year.filter((o) => Math.abs(fin(o.t, burst) - t0) < 5);
          const pan = P.pan(here.reduce((s, o) => s + fin(o.x, 0.5), 0) / here.length);
          P.punch(T(t0), { gain: 0.5, pan: pan, f0: 170, f1: 48 });
          P.transient(T(t0), { gain: 0.34, pan: pan, f: 3000 });
          here.forEach((o, j) => {
            const pj = P.pan(fin(o.x, 0.5));
            const base = 196 * (k === 0 ? 1 : 1.189) * (j ? 1.012 : 1);
            [1, 2.32, 4.25, 6.63].forEach((m, q) => P.tone(T(t0), 2.2 / (1 + q * 0.5), { f0: base * m, gain: 0.07 / Math.pow(q + 1, 0.7), a: 0.001, r: 2.2 / (1 + q * 0.5), pan: pj, wet: 0.55 }));
            P.noise(T(t0) + 0.03, 1.3, { type: 'highpass', f0: 3600, f1: 5200, q: 0.6, gain: 0.08, a: 0.05, r: 1.2, pan: pj, wet: 0.3 });
          });
        });
        climax = times.length ? times[times.length - 1] : burst;
        hit(P, T(times.length ? times[0] : burst), { size: 0.85 });
      }
      hit(P, T(climax), { size: 1.3 });
      braam(P, T(climax), [38, 45, 50, 53], 2.8, 0.4, 2300);

      /* ---- the circle turning: the drone, the choir, the sheens ---- */
      const c0 = climax + 250;
      P.hum(T(c0) - 0.2, Math.max(1, (flash - c0) / 1000 + 0.2), { f: D1, gain: 0.025, a: 1.2, r: 0.15, lp: 360 });
      const marks = [c0, fin(surges[0], 4150), fin(surges[1], 7050), flash];
      for (let i = 0; i < 3; i++) {
        const a = marks[i];
        const last = i === 2;
        const b = last ? Math.max(a + 800, flash) : Math.max(a + 800, marks[i + 1] + 300);
        choir(P, T(a), (b - a) / 1000 + (last ? 0 : 0.8), CHORDS[i], 0.055, i ? 0.5 : 1.2, last ? 0.08 : 1.1);
      }
      for (const s of sheens) {
        const t = fin(s, 2600);
        P.noise(T(t), SHEEN_DUR / 1000, { type: 'bandpass', f0: 5500, f1: 8500, q: 4, gain: 0.05, a: 0.55, r: 0.7, pan: -0.6, pan1: 0.6, wet: 0.5 });
        P.tone(T(t) + 0.3, 1, { f0: 2637, gain: 0.012, a: 0.3, r: 0.65, pan: -0.2, pan1: 0.4, wet: 0.7 });
      }

      /* ---- the surges ---- */
      for (const s0 of surges) {
        const s = fin(s0, 4150);
        const pk = s + 150;
        P.riser(T(pk) - 1.15, 1.15, { gain: 0.11, p0: 73, p1: 587 });
        hit(P, T(pk), { size: 0.7 });
        gust(P, T(pk), 0.24, 0, 1.1);
        braam(P, T(pk), [26, 38, 45], 1.5, 0.17, 1500);
      }

      /* ---- the gathering, the collapse, the melt, the green flash ---- */
      const rise = Math.max(0.3, (flash - charge) / 1000);
      P.riser(T(charge), rise, { gain: 0.16, p0: 55, p1: 880, f0: 200, f1: 8000 });
      P.tone(T(charge), rise, { type: 'sawtooth', f0: 110, f1: 660, gain: 0.03, a: rise * 0.9, r: 0.04, lp: 1200, lp1: 5000, q: 2, vib: 30, vibHz: 7, wet: 0.4 });
      P.noise(T(charge), rise, { type: 'lowpass', f0: 300, f1: 2400, q: 0.8, gain: 0.16, a: rise * 0.9, r: 0.03, wet: 0.4 });
      P.swell(T(charge), rise, { gain: 0.2, tone: 146.8 });
      // the gathering choir: a crescendo cut off by the flash
      choir(P, T(charge), rise, [50, 51, 55, 58], 0.07, rise * 0.95, 0.03);
      // the circle falls in on itself: its fire drawn in from both sides onto the words
      const fall = Math.max(0.2, (flash - collapse) / 1000);
      for (const side of [-0.8, 0.8]) P.noise(T(collapse), fall, { type: 'bandpass', f0: 500, f1: 2600, q: 1, gain: 0.14, a: fall * 0.92, r: 0.03, pan: side, pan1: 0, wet: 0.4 });
      gust(P, T(fin(d.heat, 10200)), 0.18, 0, 0.8);
      for (const o of title.concat(year)) {
        const m0 = fin(o.melt, 10600);
        P.noise(T(m0), MELT_DUR / 1000 + 0.2, { type: 'bandpass', f0: 700, f1: 2000, q: 0.9, gain: 0.09, a: 0.08, r: 0.6, pan: P.pan(fin(o.x, 0.5)), wet: 0.45 });
      }
      // the flash: the implosion
      hit(P, T(flash), { size: 1.65 });
      P.sub(T(flash) + 0.04, { gain: 0.32, f0: 48, f1: 22, dur: 3.2 });
      braam(P, T(flash), [27, 39, 46, 51], 2.6, 0.42, 2000);
      P.noise(T(flash), 0.2, { type: 'highpass', f0: 2500, q: 0.6, gain: 0.3, a: 0.001, r: 0.19, wet: 0.6 });
      for (let i = 0; i < 3; i++) {
        P.noise(T(flash) + 0.2 + i * 0.45 + P.rand() * 0.15, 1.1, { type: 'lowpass', f0: 480 - i * 80, f1: 80, q: 0.6, gain: 0.12 - i * 0.025, a: 0.06, r: 1, pan: (i - 1) * 0.6, wet: 0.75 });
      }
      // the embers drifting away
      pops(P, T(flash) + 0.15, 1.6, 9, 0.12, 0, 1.6);
    }
  });
})();
