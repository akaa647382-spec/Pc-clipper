/*!
 * Avengers Player: the sound of 'hotrod', the Hot Rod celebration (see fx-hotrod.js for the picture).
 *
 *   0.0 s   the thrusters fire: a blast, then two repulsor screams (a whine and a jet roar each)
 *           flying in from the lower corners, one left to right, one right to left.
 *   0.33 s  they cross behind the words: a reverse swell sucks in, an impact with a fireball.
 *   0.34 s+ the year is forged: per digit a white-hot slug whistles down and strikes (a punch, a
 *           crack, the anvil ringing on a rising arpeggio, a sub, the quench hissing, sparks), panned
 *           where the digit is; the last strike is the heaviest.
 *   1.26 s  the molten bead arcs over to the title and lights the torch with a pop.
 *   1.6 s+  the torch writes the title: its hiss follows it across the stereo field letter by letter,
 *           the flame roars under it, sparks crackle, each letter ends with a pop; a riser climbs
 *           under the whole weld and lands on the climax as the line is complete (2.75 s; 2.15 s
 *           without a year): impact, ringing metal, a braam.
 *   2.8 s+  the metal holds: a low forge rumble and a quiet chord, the polished sheen sweeping the
 *           words with a metallic shimmer, the heat waves rolling across, embers ticking.
 *   10.25 s it cools: metal ticking and pinging as it contracts, each letter hissing out with its
 *           embers, and a last low settle as the last one goes.
 *
 * The moments that depend on the layout (the strikes, the bead, each letter of the weld, each letter
 * going out) come from the animation's plan (fx-hotrod.js, create()). Original sound design.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-hotrod.js (ms).
  const T_CROSS = 330;
  const T_OUT = 750;                            // the thrusters are out by the top corners
  const SLUG = 180;
  const SHEEN_DUR = 1150;
  const WAVE_DUR = 1700;
  const T_COOL0 = 10250;
  const LETTER_OUT = 520;

  // Pitches: everything sits on E.
  const ANVIL = [76, 79, 83, 88, 91, 95];       // the strikes ring out on E5 G5 B5 E6 (and on)
  const ROOT = 41.2;                            // E1

  let planned = false;                          // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);   // (isFinite(null) is true)

  /** Struck metal, four inharmonic modes. */
  function ring(P, t, base, g, decay, pan, wet) {
    [1, 2.32, 4.25, 6.63].forEach((m, i) => P.tone(t, decay / (1 + i * 0.45), {
      f0: Math.min(15000, base * m * (1 + (P.rand() - 0.5) * 0.004)), gain: g / Math.pow(i + 1, 0.8), a: 0.0008,
      r: decay / (1 + i * 0.45), pan: pan, wet: wet == null ? 0.4 : wet
    }));
  }

  /** The brass of a braam without its sub (the impact under it brings the sub). */
  function brass(P, t, root, notes, len, g, open) {
    notes.forEach((m, i) => [-9, 0, 9].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: root * m, detune: dt + (P.rand() - 0.5) * 4, gain: g / (notes.length * 1.6) / (1 + i * 0.25),
      a: 0.05, r: len * 0.55, lp: 160, lp1: open, lpGlide: 0.18, q: 1.6, drive: 1.8, pan: (dt / 9) * 0.5, wet: 0.5
    })));
    P.tone(t + 0.25, len, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.2, r: len * 0.7, lp: 900, lp1: 180, q: 1.2, drive: 2, wet: 0.6 });
  }

  /** One thruster flying across: approach then recede (a doppler drop as it passes). */
  function thruster(P, T, from, to, pitch) {
    const a = T_CROSS / 1000;
    const b = (T_OUT - T_CROSS) / 1000;
    P.tone(T(0), a, { type: 'sawtooth', f0: pitch, f1: pitch * 1.12, gain: 0.05, a: 0.02, r: 0.01, lp: 5200, drive: 1.5, pan: from, pan1: 0, wet: 0.25, vib: 22, vibHz: 9 });
    P.tone(T(T_CROSS), b + 0.25, { type: 'sawtooth', f0: pitch * 1.12, f1: pitch * 0.55, glide: 0.3, gain: 0.05, a: 0.005, r: b + 0.2, lp: 5200, lp1: 1500, drive: 1.5, pan: 0, pan1: to, wet: 0.3, vib: 22, vibHz: 9 });
    P.noise(T(0), a, { type: 'bandpass', f0: 1100, f1: 2600, q: 0.8, gain: 0.3, a: 0.01, r: 0.01, pan: from, pan1: 0, wet: 0.2 });
    P.noise(T(T_CROSS), b + 0.3, { type: 'bandpass', f0: 2600, f1: 520, glide: b + 0.1, q: 0.8, gain: 0.3, a: 0.005, r: b + 0.25, pan: 0, pan1: to, wet: 0.35 });
  }

  S.define('hotrod', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: the thrusters fire and fly in ---- */
      P.impact(T(0), { size: 0.9, wet: 0.4 });
      P.noise(T(0), 0.3, { type: 'bandpass', f0: 800, f1: 300, q: 0.9, gain: 0.3, a: 0.001, r: 0.29, wet: 0.4 });
      thruster(P, T, -0.85, 0.85, 1250);
      thruster(P, T, 0.85, -0.85, 1330);
      P.noise(T(0), 0.9, { type: 'lowpass', f0: 220, q: 0.7, gain: 0.22, a: 0.02, r: 0.6, wet: 0.2 });       // their thrum

      /* ---- 0.33 s: they cross behind the words ---- */
      P.swell(T(0), T_CROSS / 1000, { gain: 0.16, tone: 164.8, f0: 2000, f1: 6000 });
      P.impact(T(T_CROSS), { size: 0.85, bright: true });
      P.whoomp(T(T_CROSS), { gain: 0.32 });
      P.crackle(T(T_CROSS + 10), 0.45, 22, { gain: 0.14 });
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const digits = w && w.year && Array.isArray(d.digits) ? d.digits : [];
      const letters = Array.isArray(d.letters) ? d.letters : [];
      const outs = Array.isArray(d.out) ? d.out.filter((o) => o.line === 0 || (w && w.year)) : [];
      const minX = fin(d.minX, 0.25);
      const maxX = fin(d.maxX, 0.75);

      /* ---- the year: struck digit by digit ---- */
      digits.forEach((dg, i) => {
        const hit = fin(dg.hit, 520 + 240 * i);
        const pan = P.pan(fin(dg.x, 0.5));
        const last = i === digits.length - 1;
        const k = last ? 1.25 : 0.8 + 0.2 * i / Math.max(1, digits.length - 2);
        // the slug whistling down from alternate sides
        const from = P.pan(fin(dg.x, 0.5) + (i % 2 ? 0.05 : -0.05));
        P.tone(T(hit - SLUG), SLUG / 1000, { f0: 3400, f1: 900, gain: 0.04, a: SLUG / 1000 * 0.45, r: 0.008, pan: from, pan1: pan, wet: 0.3 });
        P.noise(T(hit - SLUG), SLUG / 1000, { type: 'bandpass', f0: 7000, f1: 1800, q: 1.2, gain: 0.1, a: SLUG / 1000 * 0.6, r: 0.008, pan: from, pan1: pan, wet: 0.3 });
        // the strike
        P.punch(T(hit), { gain: 0.5 * k, f0: 170, f1: 52, pan: pan });
        P.transient(T(hit), { gain: 0.36 * k, f: 3400, pan: pan });
        P.noise(T(hit), 0.5, { type: 'bandpass', f0: 1300, f1: 280, q: 0.9, gain: 0.2 * k, a: 0.001, r: 0.49, pan: pan, wet: 0.45 });
        P.sub(T(hit), { gain: 0.3 * k, f0: 66, f1: 30, dur: last ? 1.6 : 1.0 });
        ring(P, T(hit), P.note(ANVIL[Math.min(ANVIL.length - 1, i)]), 0.13 * k, last ? 2.4 : 1.7, pan, 0.45);
        // the quench and the sparks
        P.noise(T(hit + 15), 0.9, { type: 'highpass', f0: 3800, f1: 6000, q: 0.5, gain: 0.07, a: 0.03, r: 0.85, pan: pan, wet: 0.3 });
        P.crackle(T(hit + 10), 0.42, 19, { gain: 0.13, pan: pan });
      });

      /* ---- the bead and the torch lighting ---- */
      if (d.bead) {
        const b0 = fin(d.bead.t0, 1260);
        const b1 = Math.max(b0 + 40, fin(d.bead.t1, b0 + 240));
        const half = (b1 - b0) / 2000;
        const p0 = P.pan(fin(d.bead.x0, 0.5));
        const p1 = P.pan(fin(d.bead.x1, 0.2));
        const pm = (p0 + p1) / 2;
        P.tone(T(b0), half, { f0: 900, f1: 1900, gain: 0.03, a: 0.02, r: 0.01, pan: p0, pan1: pm, wet: 0.4 });
        P.tone(T(b0) + half, half + 0.02, { f0: 1900, f1: 1000, gain: 0.03, a: 0.005, r: half, pan: pm, pan1: p1, wet: 0.4 });
        P.noise(T(b0), (b1 - b0) / 1000, { type: 'bandpass', f0: 3000, f1: 6000, q: 1, gain: 0.06, a: 0.03, r: 0.05, pan: p0, pan1: p1, wet: 0.35 });
      }
      let climax = digits.length ? fin(digits[digits.length - 1].hit, 1240) + 300 : T_CROSS + 300;
      if (d.torch && letters.length) {
        const lit = fin(d.torch.lit, 1500);
        const t0 = fin(d.torch.t0, lit + 100);
        const t1 = Math.max(t0 + 100, fin(d.torch.t1, 2750));
        const pl = P.pan(fin(letters[0].x0, 0.25));
        P.noise(T(lit), 0.28, { type: 'bandpass', f0: 320, f1: 2600, glide: 0.07, q: 0.9, gain: 0.26, a: 0.003, r: 0.27, pan: pl, wet: 0.4 });
        P.tick(T(lit), { f: 2600, gain: 0.5, pan: pl });
        // the flame's roar under the whole weld, travelling with it
        const pr = P.pan(fin(letters[letters.length - 1].x1, 0.75));
        P.noise(T(lit + 40), (t1 - lit) / 1000 + 0.1, { type: 'bandpass', f0: 900, q: 0.7, gain: 0.26, a: 0.06, r: 0.15, pan: pl, pan1: pr, wet: 0.3 });
        // letter by letter: its hiss following the torch, its sparks, a pop as it is done
        for (const L of letters) {
          const a = fin(L.t0, t0);
          const b = Math.max(a + 20, fin(L.t1, a + 90));
          const pa = P.pan(fin(L.x0, 0.5));
          const pb = P.pan(fin(L.x1, 0.5));
          P.noise(T(a), (b - a) / 1000, { type: 'highpass', f0: 3200, q: 0.6, gain: 0.2, a: 0.008, r: 0.012, pan: pa, pan1: pb, wet: 0.25 });
          P.crackle(T(a), (b - a) / 1000, 32, { gain: 0.16, pan: (pa + pb) / 2 });
          P.noise(T(b), 0.03, { type: 'bandpass', f0: 3600, q: 2, gain: 0.28, a: 0.0006, r: 0.028, pan: pb, wet: 0.3 });
        }
        // a riser climbing under the weld, landing on the climax
        P.riser(T(t0), (t1 - t0) / 1000, { f0: 300, f1: 6000, p0: ROOT * 2, p1: ROOT * 16, gain: 0.09 });
        P.swell(T(t1 - 450), 0.45, { gain: 0.13, tone: 164.8 });
        climax = t1;
      }

      /* ---- the line is complete: the climax ---- */
      P.impact(T(climax), { size: 0.92, bright: true });
      ring(P, T(climax), P.note(64), 0.1, 3.0, 0, 0.55);
      brass(P, T(climax), ROOT, [1, 2, 3, 4], 2.7, 0.24, 2600);

      /* ---- the metal holds ---- */
      const hold0 = climax + 200;
      P.noise(T(hold0), (16400 - hold0) / 1000, { type: 'lowpass', f0: 190, q: 0.6, gain: 0.2, a: 1.0, r: 6.0, wet: 0.3 });     // the forge, dying away as it cools
      P.pad(T(hold0 + 300), (15000 - hold0 - 300) / 1000, [40, 47, 52], { gain: 0.04, lp: 900, a: 2, r: 4.6 });               // E2 B2 E3
      P.crackle(T(hold0), (T_COOL0 - hold0) / 1000, 3, { gain: 0.08 });                                                      // embers
      for (const s0 of Array.isArray(d.sheens) ? d.sheens : []) {
        const t = fin(s0, 3300);
        P.noise(T(t), SHEEN_DUR / 1000, { type: 'bandpass', f0: 2500, f1: 7500, q: 6, gain: 0.28, a: 0.3, r: 0.5, pan: P.pan(minX), pan1: P.pan(maxX), wet: 0.5 });
        P.tone(T(t + 350), 0.9, { f0: P.note(100), gain: 0.022, a: 0.003, r: 0.88, pan: P.pan(minX + (maxX - minX) * 0.35), wet: 0.6 });
        P.tone(T(t + 700), 0.9, { f0: P.note(107), gain: 0.018, a: 0.003, r: 0.88, pan: P.pan(minX + (maxX - minX) * 0.7), wet: 0.6 });
      }
      for (const w0 of Array.isArray(d.waves) ? d.waves : []) {
        const t = fin(w0, 4500) - 400;
        P.noise(T(t), (WAVE_DUR + 800) / 1000, { type: 'bandpass', f0: 260, f1: 1000, q: 0.6, gain: 0.28, a: 0.7, r: 1.0, pan: P.pan(minX), pan1: P.pan(maxX), wet: 0.4 });
        P.noise(T(t + 200), (WAVE_DUR + 400) / 1000, { type: 'bandpass', f0: 1800, q: 0.5, gain: 0.08, a: 0.6, r: 0.9, pan: P.pan(minX), pan1: P.pan(maxX), wet: 0.4 });
      }

      /* ---- it cools: ticking and pinging, each letter hissing out ---- */
      P.noise(T(T_COOL0), 2.4, { type: 'highpass', f0: 5000, q: 0.5, gain: 0.05, a: 0.15, r: 2.2, wet: 0.4 });
      for (let j = 0; j < 14; j++) {
        const t = T_COOL0 + 120 + j * 140 + 90 * P.rand();
        const x = minX + (maxX - minX) * P.rand();
        if (j % 3 === 2) P.tick(T(t), { f: 2800 + 2400 * P.rand(), gain: 0.4, pan: P.pan(x) });
        else P.tone(T(t), 0.3, { f0: 2400 + 3200 * P.rand(), gain: 0.04, a: 0.001, r: 0.29, pan: P.pan(x), wet: 0.5 });
      }
      let lastOut = 0;
      for (const o of outs) {
        const t = fin(o.t, 10600);
        lastOut = Math.max(lastOut, t);
        const pan = P.pan(fin(o.x, 0.5));
        P.noise(T(t), 0.42, { type: 'bandpass', f0: 3200, f1: 1800, q: 0.9, gain: 0.12, a: 0.02, r: 0.4, pan: pan, wet: 0.4 });
        P.noise(T(t + 60 + 120 * P.rand()), 0.01, { type: 'highpass', f0: 3000 + 3000 * P.rand(), q: 0.7, gain: 0.12, a: 0.0005, r: 0.009, pan: pan, wet: 0.3 });
      }
      // the last one goes: a low settle
      const end = (lastOut || 11250) + LETTER_OUT * 0.5;
      P.swell(T(end - 500), 0.5, { gain: 0.08, tone: 82.4, f0: 1200, f1: 3000 });
      P.punch(T(end), { gain: 0.1, f0: 100, f1: 38 });
      P.sub(T(end), { gain: 0.14, f0: 70, f1: 30, dur: 2.0 });
      P.noise(T(end), 1.6, { type: 'lowpass', f0: 450, f1: 60, q: 0.6, gain: 0.1, a: 0.01, r: 1.55, wet: 0.65 });
      ring(P, T(end), P.note(52), 0.04, 2.6, 0, 0.7);
    }
  });
})();
