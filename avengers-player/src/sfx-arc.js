/*!
 * Avengers Player: the sound of 'arc', the Arc Reactor celebration (see fx-arc.js for the picture).
 *
 *   0.0 s   ignition: a bright impact with an electric crack, the ring of light flying out to both
 *           sides, the segmented rings ratcheting into place, a turbine spinning up; the title's
 *           tubes tick as the ring passes them.
 *   0.7 s   the reactor rises: its body climbs, a riser and a reverse swell draw the charge in, the
 *           core flutters.
 *   1.4 s   the flare: the biggest hit (impact, braam, an electric discharge), the shockwave tearing
 *           out to both sides, the turbine overspeeding.
 *   1.5 s+  as the wave reaches each letter its neon tube strikes (a crack and a buzz per flicker,
 *           panned where the letter is) and catches (a buzz settling, a glassy ping).
 *   2.0 s+  the year: per digit, a zip as the stream leaves the reactor, a charge climbing while the
 *           digit fills, a bright ping when it tops out; the last one is the climax (impact + chord).
 *           Without a year the climax lands as the last tube catches.
 *   3-9 s   the reactor holds: hum, a quiet chord, the core's heartbeats, scans across the words,
 *           current jumping between the rings, a surge at 6.2 s (riser, swell, impact, braam,
 *           twinkles when its wave reaches the words).
 *   9.3 s   spin-down and sputter; the rings break into sparks (a crack per segment, panned); the
 *           digits drain and the tubes flicker out; the core collapses (a soft low hit) at 10.95 s.
 *
 * The moments that depend on the layout (when each tube strikes, when each digit is full, where
 * the current jumps, where the rings break) come from the animation's plan (fx-arc.js, create()).
 * Original sound design: no melody or motif from any film.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-arc.js (ms).
  const T_FLARE = 1400;
  const PULSES = [2800, 4400, 8000];
  const T_SURGE = 6200;
  const SCANS = [3300, 6900, 9050];
  const SCAN_DUR = 1250;
  const T_DOWN = 9300;
  const T_CORE_OUT = 10950;

  // Pitches: everything sits on D.
  const BUZZ = 146.83;                         // D3: the neon tubes' buzz
  const PINGS = [86, 88, 90, 93, 95, 98, 100]; // the tubes catching, from the middle outwards (D6 E6 F#6 A6 B6 D7 E7)
  const CELLS = [81, 86, 88, 93, 95, 98];      // the digits topping out (A5 D6 E6 A6 B6 D7)
  const CHORD = [38, 45, 50, 57];              // the climax: D2 A2 D3 A3, opened wide

  let planned = false;                         // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);   // (isFinite(null) is true)
  const dur = (a, b, min) => Math.max(min || 0.02, (b - a) / 1000);

  /** A short neon buzz: a driven saw at the tube's pitch. */
  function buzz(P, t, pan, g, len, k) {
    P.tone(t, len, { type: 'sawtooth', f0: BUZZ * (k || 1), gain: g, a: 0.0012, r: len * 0.8, drive: 5, lp: 3600, pan: pan, wet: 0.28 });
  }

  /** The brass of a braam without its sub (the impact under it brings the sub): detuned saws whose
   *  filter blows open, driven, in the hall, and a darker layer carrying the tail. */
  function brass(P, t, root, notes, len, g, open) {
    notes.forEach((m, i) => [-9, 0, 9].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: root * m, detune: dt + (P.rand() - 0.5) * 4, gain: g / (notes.length * 1.6) / (1 + i * 0.25),
      a: 0.05, r: len * 0.55, lp: 160, lp1: open, lpGlide: 0.18, q: 1.6, drive: 1.8, pan: (dt / 9) * 0.5, wet: 0.5
    })));
    P.tone(t + 0.25, len, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.2, r: len * 0.7, lp: 900, lp1: 180, q: 1.2, drive: 2, wet: 0.6 });
  }

  /** A glassy ping: two partials. */
  function ping(P, t, f, g, pan, len) {
    P.tone(t, len, { f0: f, gain: g, a: 0.002, r: len, pan: pan, wet: 0.6 });
    P.tone(t, len * 0.45, { f0: Math.min(16000, f * 2.76), gain: g * 0.35, a: 0.002, r: len * 0.45, pan: pan, wet: 0.6 });
  }

  S.define('arc', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: ignition ---- */
      P.impact(T(0), { size: 1.2, bright: true, wet: 0.5 });
      P.tone(T(0), 0.16, { type: 'square', f0: 2400, f1: 110, glide: 0.09, gain: 0.2, a: 0.0006, r: 0.15, drive: 6, lp: 6000, wet: 0.35 });
      P.noise(T(0), 0.55, { type: 'bandpass', f0: 7000, f1: 1600, q: 0.8, gain: 0.32, a: 0.002, r: 0.54, wet: 0.5 });
      P.noise(T(0), 0.38, { type: 'bandpass', f0: 950, f1: 260, q: 0.9, gain: 0.3, a: 0.001, r: 0.37, wet: 0.45 });   // its body, for small speakers too
      // the ring of light flying out to both sides
      P.noise(T(10), 0.62, { type: 'bandpass', f0: 3200, f1: 650, q: 1.2, gain: 0.26, a: 0.015, r: 0.6, pan: 0, pan1: -0.85, wet: 0.35 });
      P.noise(T(10), 0.62, { type: 'bandpass', f0: 3000, f1: 600, q: 1.2, gain: 0.26, a: 0.015, r: 0.6, pan: 0, pan1: 0.85, wet: 0.35 });
      // the turbine spinning up (its speed reaches cruising at the flare)
      P.tone(T(0), 1.42, { f0: 240, f1: 1175, glide: 1.4, gain: 0.05, a: 0.35, r: 0.05, wet: 0.3, vib: 8, vibHz: 6 });
      P.tone(T(60), 1.36, { type: 'sawtooth', f0: 55, f1: 110, gain: 0.09, a: 0.5, r: 0.05, lp: 220, lp1: 1500, q: 1.4, drive: 1.6, wet: 0.25 });

      /* ---- the rings assembling, inside out ---- */
      P.noise(T(200), 0.5, { type: 'bandpass', f0: 3000, f1: 8000, q: 4, gain: 0.07, a: 0.05, r: 0.2, wet: 0.3 });      // the dashes written on
      P.tick(T(480), { f: 2100, gain: 0.32 });                                                                       // the hub locks
      for (let j = 0; j < 14; j++) P.tick(T(510 + 22 * j), { f: 2600 + j * 90, gain: 0.2 + 0.012 * j, pan: 0.35 * Math.cos(j * Math.PI / 7) });
      for (const at of [830, 1000, 1160]) {
        P.tone(T(at), 0.09, { f0: 420, f1: 160, gain: 0.12, a: 0.001, r: 0.08, drive: 2, wet: 0.2 });
        P.tick(T(at + 4), { f: 4200, gain: 0.28 });
      }

      /* ---- 0.7 s: the reactor rises and draws its charge in ---- */
      P.tone(T(680), 0.72, { type: 'sawtooth', f0: 73.42, f1: 146.83, gain: 0.08, a: 0.6, r: 0.05, lp: 200, lp1: 1800, q: 2, drive: 1.8, wet: 0.3 });
      P.riser(T(700), 0.7, { f0: 400, f1: 9000, p0: 146.83, p1: 1174.7, gain: 0.17 });
      P.swell(T(1000), 0.4, { gain: 0.2, tone: 146.83, f0: 2400, f1: 7000 });
      P.crackle(T(1080), 0.32, 22, { gain: 0.12 });                                                               // the core flutters

      /* ---- 1.4 s: the flare ---- */
      P.impact(T(T_FLARE), { size: 1.15, bright: true, wet: 0.5 });
      brass(P, T(T_FLARE), P.note(26), [1, 2, 3, 4], 3.4, 0.32, 2800);
      P.tone(T(T_FLARE), 0.6, { type: 'sawtooth', f0: 240, f1: 55, glide: 0.35, gain: 0.2, a: 0.001, r: 0.58, drive: 7, lp: 5200, lp1: 700, wet: 0.4 });
      P.noise(T(T_FLARE), 0.25, { type: 'highpass', f0: 3000, f1: 6000, q: 0.6, gain: 0.3, a: 0.0008, r: 0.24, wet: 0.4 });
      // the shockwave tearing out to both sides, and the air it pushes
      P.noise(T(T_FLARE + 15), 1.5, { type: 'bandpass', f0: 2400, f1: 300, q: 1.1, gain: 0.22, a: 0.012, r: 1.45, pan: 0, pan1: -0.85, wet: 0.4 });
      P.noise(T(T_FLARE + 15), 1.5, { type: 'bandpass', f0: 2200, f1: 280, q: 1.1, gain: 0.22, a: 0.012, r: 1.45, pan: 0, pan1: 0.85, wet: 0.4 });
      P.noise(T(T_FLARE), 1.1, { type: 'lowpass', f0: 600, f1: 90, q: 0.6, gain: 0.25, a: 0.01, r: 1.05, wet: 0.3 });
      // the turbine overspeeds, then settles
      P.tone(T(T_FLARE), 0.3, { f0: 1175, f1: 2349, gain: 0.05, a: 0.02, r: 0.05, wet: 0.35 });
      P.tone(T(T_FLARE + 280), 1.7, { f0: 2349, f1: 1175, glide: 1.6, gain: 0.05, a: 0.02, r: 1.5, wet: 0.35, vib: 10, vibHz: 5 });

      /* ---- the reactor holds ---- */
      P.hum(T(1500), 9.3, { f: 73.42, gain: 0.028, a: 0.9, r: 1.2, lp: 650 });
      P.tone(T(2600), 6.8, { f0: 2349, gain: 0.005, a: 1.2, r: 0.3, wet: 0.4, vib: 14, vibHz: 3.2 });              // its whine at cruising
      P.pad(T(3400), 6.2, [50, 57, 64], { gain: 0.035, lp: 1100, a: 1.8, r: 2.4 });                               // D3 A3 E4, quiet
      // the core's heartbeats: a thump and the ripple running out
      for (const at of PULSES) {
        P.punch(T(at), { gain: 0.12, f0: 95, f1: 36 });
        P.noise(T(at + 20), 1.1, { type: 'bandpass', f0: 1600, f1: 500, q: 1.4, gain: 0.07, a: 0.04, r: 1.0, wet: 0.5 });
      }
      // filaments racing round the rings
      [[4000, -0.7, 0.7], [7600, 0.6, -0.6]].forEach((c) => P.whoosh(T(c[0]), 1.3, { gain: 0.06, f0: 1800, f1: 5200, q: 2, pan: c[1], pan1: c[2], wet: 0.4 }));

      /* ---- 6.2 s: the surge ---- */
      P.riser(T(T_SURGE - 900), 0.9, { f0: 500, f1: 8000, p0: 146.83, p1: 587.3, gain: 0.13 });
      P.swell(T(T_SURGE - 420), 0.42, { gain: 0.16, tone: 293.66 });
      P.impact(T(T_SURGE), { size: 0.85, bright: true });
      brass(P, T(T_SURGE), P.note(26), [1, 2], 2.4, 0.2, 2200);
      P.tone(T(T_SURGE), 0.45, { type: 'sawtooth', f0: 330, f1: 82, glide: 0.3, gain: 0.12, a: 0.001, r: 0.43, drive: 7, lp: 5000, lp1: 900, wet: 0.4 });
      P.noise(T(T_SURGE + 15), 1.4, { type: 'bandpass', f0: 2600, f1: 400, q: 1.2, gain: 0.16, a: 0.012, r: 1.35, pan: 0, pan1: -0.8, wet: 0.45 });
      P.noise(T(T_SURGE + 15), 1.4, { type: 'bandpass', f0: 2400, f1: 380, q: 1.2, gain: 0.16, a: 0.012, r: 1.35, pan: 0, pan1: 0.8, wet: 0.45 });

      /* ---- 9.3 s: spin-down, sputter, the core collapses ---- */
      P.powerDown(T(T_DOWN), 1.9, { f0: 220, f1: 30, gain: 0.17 });
      P.tone(T(T_DOWN), 1.6, { f0: 2349, f1: 180, glide: 1.5, gain: 0.03, a: 0.02, r: 1.55, wet: 0.4 });
      P.crackle(T(T_DOWN + 220), 0.75, 10, { gain: 0.1 });
      P.swell(T(T_CORE_OUT - 620), 0.62, { gain: 0.08, tone: 73.42, f0: 1200, f1: 3500 });
      P.punch(T(T_CORE_OUT), { gain: 0.14, f0: 110, f1: 38 });
      P.sub(T(T_CORE_OUT), { gain: 0.2, f0: 78, f1: 29, dur: 2.2 });
      P.noise(T(T_CORE_OUT), 1.8, { type: 'lowpass', f0: 520, f1: 60, q: 0.6, gain: 0.14, a: 0.008, r: 1.75, wet: 0.65 });
      P.noise(T(T_CORE_OUT + 10), 0.45, { type: 'bandpass', f0: 1500, f1: 320, q: 1, gain: 0.1, a: 0.01, r: 0.42, wet: 0.6 });
      P.tone(T(T_CORE_OUT), 1.4, { f0: 1174.7, f1: 587.3, gain: 0.025, a: 0.005, r: 1.35, wet: 0.7 });
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const tubes = Array.isArray(d.tubes) ? d.tubes : [];
      const digits = w && w.year && Array.isArray(d.digits) ? d.digits : [];
      const bolts = Array.isArray(d.bolts) ? d.bolts : [];
      const breaks = Array.isArray(d.breaks) ? d.breaks : [];
      let xmin = 0.5;
      let xmax = 0.5;
      for (const tb of tubes) { xmin = Math.min(xmin, fin(tb.x, 0.5)); xmax = Math.max(xmax, fin(tb.x, 0.5)); }

      /* ---- the title's tubes: blink at ignition, strike as the wave reaches them, catch ---- */
      const mid = (tubes.length - 1) / 2;
      tubes.forEach((tb, q) => {
        const pan = P.pan(fin(tb.x, 0.5));
        const k = 0.985 + 0.03 * P.rand();
        if (tb.blinks && tb.blinks.length) buzz(P, T(fin(tb.blinks[0], 300)), pan, 0.05, 0.035, k);
        const strikes = Array.isArray(tb.strikes) ? tb.strikes : [];
        strikes.forEach((s, j) => {
          const t = T(fin(s, T_FLARE + 200));
          if (j === 0) P.noise(t, 0.03, { type: 'highpass', f0: 3800 + 1500 * P.rand(), q: 0.7, gain: 0.24, a: 0.0006, r: 0.028, pan: pan, wet: 0.3 });
          buzz(P, t, pan, j === 0 ? 0.15 : 0.09, j === 0 ? 0.07 : 0.045, k);
        });
        const c = T(fin(tb.caught, 2000));
        P.tone(c, 0.65, { type: 'sawtooth', f0: BUZZ * k, gain: 0.12, a: 0.002, r: 0.6, drive: 3, lp: 3400, lp1: 800, lpGlide: 0.45, pan: pan, wet: 0.3 });
        const rank = Math.min(PINGS.length - 1, Math.round(Math.abs(q - mid)));
        P.tone(c, 1.3, { f0: P.note(PINGS[rank]), gain: 0.045, a: 0.002, r: 1.3, pan: pan, wet: 0.6 });
      });

      /* ---- the year: a zip, a charge while each digit fills, a ping as it tops out ---- */
      let climax = fin(d.titleLit, 2200);
      digits.forEach((dg, i) => {
        const pan = P.pan(fin(dg.x, 0.5));
        const at = fin(dg.at, 2000);
        const hit = fin(dg.hit, at + 120);
        const full = fin(dg.full, hit + 350);
        const f = P.note(CELLS[Math.min(CELLS.length - 1, i)]);
        P.noise(T(at), dur(at, hit, 0.06) + 0.02, { type: 'bandpass', f0: 7500, f1: 2400, q: 2, gain: 0.13, a: 0.01, r: dur(at, hit, 0.06), pan: 0, pan1: pan, wet: 0.35 });
        P.tone(T(hit), dur(hit, full, 0.1), { type: 'sawtooth', f0: f / 4, f1: f / 2, gain: 0.08, a: dur(hit, full, 0.1) * 0.4, r: 0.012, lp: 500, lp1: 6000, q: 3, drive: 2, pan: pan, wet: 0.35 });
        P.tone(T(hit), dur(hit, full, 0.1), { f0: f / 2, f1: f, gain: 0.04, a: dur(hit, full, 0.1) * 0.4, r: 0.012, pan: pan, wet: 0.4 });
        ping(P, T(full), f, 0.11, pan, 2.2);
        P.noise(T(full), 0.04, { type: 'highpass', f0: 5200, q: 0.6, gain: 0.2, a: 0.0006, r: 0.038, pan: pan, wet: 0.35 });
        climax = Math.max(climax, full);
      });

      /* ---- the words complete: the climax ---- */
      P.swell(T(climax - 520), 0.52, { gain: 0.15, tone: 293.66 });
      P.impact(T(climax), { size: 1.02, bright: true });
      P.stab(T(climax), CHORD, { gain: 0.2, dur: 2.8, open: 3800 });
      for (let j = 0; j < 2; j++) ping(P, T(climax + 40 + j * 90), P.note([98, 105][j]), 0.022, (j % 2 ? 0.5 : -0.5), 1.8);

      /* ---- while it holds: scans across the words, current jumping between the rings ---- */
      for (const at of SCANS) {
        P.noise(T(at), SCAN_DUR / 1000, { type: 'bandpass', f0: 2600, f1: 4800, q: 5, gain: 0.08, a: 0.35, r: 0.55, pan: P.pan(xmin), pan1: P.pan(xmax), wet: 0.45 });
        P.tone(T(at), SCAN_DUR / 1000, { f0: 1760, gain: 0.01, a: 0.35, r: 0.55, pan: P.pan(xmin), pan1: P.pan(xmax), wet: 0.5, vib: 25, vibHz: 7 });
      }
      for (const b of bolts) {
        const len = Math.max(0.04, fin(b.dur, 120) / 1000);
        P.tone(T(fin(b.t, 3000)), len, { type: 'sawtooth', f0: 330 + 330 * P.rand(), gain: 0.07, a: 0.0008, r: len * 0.85, drive: 9, lp: 6500, pan: P.pan(fin(b.x, 0.5)), wet: 0.35 });
      }
      // the surge's wave reaches the words: they twinkle
      const sw = fin(d.surgeOnWords, T_SURGE + 160);
      for (let j = 0; j < 4; j++) P.tone(T(sw + j * 110 + 40 * P.rand()), 0.9, { f0: P.note([93, 98, 102, 105][j]), gain: 0.02, a: 0.002, r: 0.9, pan: P.pan(xmin + (xmax - xmin) * P.rand()), wet: 0.65 });

      /* ---- the end: the rings break, the digits drain, the tubes go out ---- */
      breaks.forEach((b, j) => {
        const t = T(fin(b.t, 10000));
        const pan = P.pan(fin(b.x, 0.5));
        P.noise(t, 0.035, { type: 'highpass', f0: 2600 + 4000 * P.rand(), q: 0.8, gain: 0.16 + 0.08 * P.rand(), a: 0.0006, r: 0.033, pan: pan, wet: 0.4 });
        if (j % 4 === 0) P.tone(t, 0.5, { f0: P.note([93, 95, 98, 100][(j / 4) % 4]), gain: 0.025, a: 0.002, r: 0.48, pan: pan, wet: 0.6 });
      });
      digits.forEach((dg, i) => {
        const at = fin(dg.drain, 10500);
        const f = P.note(CELLS[Math.min(CELLS.length - 1, i)]);
        P.tone(T(at), 0.32, { f0: f / 2, f1: f / 8, gain: 0.05, a: 0.01, r: 0.3, pan: P.pan(fin(dg.x, 0.5)), wet: 0.45 });
      });
      tubes.forEach((tb) => {
        const downs = Array.isArray(tb.downs) ? tb.downs : [];
        if (downs.length > 1) buzz(P, T(fin(downs[1], 10700)), P.pan(fin(tb.x, 0.5)), 0.06, 0.035, 0.99);
      });
    }
  });
})();
