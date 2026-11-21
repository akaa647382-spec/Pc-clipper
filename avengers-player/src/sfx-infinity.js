/*!
 * Avengers Player: the sound of 'infinity', the Thanos animation (see fx-infinity.js for the picture).
 *
 *   0.0 s    THE SNAP: a crisp finger snap that hits like a gunshot in a cathedral (the snap, its
 *            report thrown into a huge hall, a sub drop), the crack of light and the ring racing out
 *            to both sides; then a split second of near-silence with only the hall ringing.
 *   0.1-1 s  six lights streak in from six directions: six whooshes flying from where each starts to
 *            the centre, staggered as they are, each carrying one note of a dark chord that gathers
 *            as they converge; a riser and a reverse swell draw everything in.
 *   1.0 s    they collide: the gold blaze, the biggest hit (impact with struck metal, a minor braam,
 *            fire catching, a golden glint), the blaze roaring while it feeds the year.
 *   1.25 s+  the year is forged centre digits first: per digit, the stream of gold pouring in, then a
 *            heavy hammer blow on metal (panned to the digit) and the white-hot hiss as it cools.
 *   1.9 s+   ash rises into the title letter by letter: a granular swell sweeping left to right with
 *            grains settling on each letter, a breath rising under it, landing on the climax as the
 *            last letter is whole (a dark minor stab, an impact, a gong).
 *   3.4-9 s  the purple aura: an ominous low drone and a dark minor pad breathing with the aura; each
 *            of the six motes sings softly as it passes in front of the words (right to left).
 *   9.6 s    perfectly balanced: half the letters turn to dust, a gust carrying each one's dust off to
 *            the right from where it stands; 10.4 s the rest, a bigger gust and a last low chord.
 *            Then nothing but the hall's tail.
 *
 * The moments that depend on the layout or the seed (where each light starts, when and where each
 * digit lands, each letter, which letters go first) come from the animation's plan (fx-infinity.js,
 * create()). Original sound design: no melody or motif from any film.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-infinity.js (ms).
  const T_MERGE = 1050;            // the six lights have all arrived
  const HIT = T_MERGE - 50;        // the blaze flares (it starts growing at T_MERGE - 60)
  const T_HALF1 = 9600;
  const T_HALF2 = 10400;

  // Pitches: everything sits on C, minor, with a flat sixth for the dark colour.
  const LIGHT_NOTES = [48, 55, 63, 70, 74, 79];    // C3 G3 Eb4 Bb4 D5 G5: the six lights gathering
  const MOTE_NOTES = [79, 82, 84, 86, 87, 91];     // G5 Bb5 C6 D6 Eb6 G6: the motes singing
  const FORGE = [196, 174.6, 220, 146.8];          // the struck metal of each digit, in the order forged
  const STAB = [36, 43, 48, 51];                   // C2 G2 C3 Eb3: the climax
  const AURA = [36, 43, 51, 56];                   // C2 G2 Eb3 Ab3: the aura's pad
  const LAST = [24, 36, 43, 51];                   // C1 C2 G2 Eb3: the last chord

  let planned = false;                             // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const secs = (a, b, min) => Math.max(min || 0.02, (b - a) / 1000);

  /** A braam whose bloom is short (it holds `hold` s, then dies away), so the hits after it stand out:
   *  detuned saws whose filter blows open, driven, in the hall, a darker layer under the tail. */
  function brass(P, t, root, notes, len, g, open, hold) {
    notes.forEach((m, i) => [-9, 0, 9].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: root * m, detune: dt + (P.rand() - 0.5) * 4, gain: g / (notes.length * 1.6) / (1 + i * 0.25),
      a: 0.04, r: Math.max(0.1, len - 0.04 - hold), lp: 160, lp1: open, lpGlide: 0.16, q: 1.6, drive: 1.8, pan: (dt / 9) * 0.55, wet: 0.5
    })));
    P.tone(t + 0.2, len, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.15, r: len * 0.75, lp: 900, lp1: 160, q: 1.2, drive: 2, wet: 0.6 });
  }

  S.define('infinity', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: the snap ---- */
      P.snap(T(0), { gain: 1.15, wet: 0.9 });
      // its report: bright, then thrown into the hall
      P.noise(T(0), 0.1, { type: 'bandpass', f0: 3400, f1: 1300, q: 0.9, gain: 0.85, a: 0.0006, r: 0.095, wet: 0.95 });
      P.noise(T(2), 0.6, { type: 'lowpass', f0: 2400, f1: 220, q: 0.6, gain: 0.34, a: 0.002, r: 0.58, wet: 1 });
      P.punch(T(0), { gain: 0.72, f0: 170, f1: 42 });
      P.sub(T(0), { gain: 0.7, f0: 74, f1: 24, dur: 1.1 });
      // the cathedral answering: a dark resonance hanging in the hall
      P.tone(T(0), 2.4, { f0: P.note(48), gain: 0.035, a: 0.01, r: 2.35, wet: 1 });
      P.tone(T(0), 1.6, { f0: P.note(67), gain: 0.012, a: 0.01, r: 1.55, wet: 1 });
      // the crack of light tearing across, and the ring racing out to both sides
      P.noise(T(0), 0.34, { type: 'highpass', f0: 6500, f1: 9500, q: 0.6, gain: 0.16, a: 0.001, r: 0.33, pan: 0, pan1: -0.85, wet: 0.5 });
      P.noise(T(0), 0.34, { type: 'highpass', f0: 6200, f1: 9000, q: 0.6, gain: 0.16, a: 0.001, r: 0.33, pan: 0, pan1: 0.85, wet: 0.5 });
      P.noise(T(6), 0.5, { type: 'bandpass', f0: 2600, f1: 700, q: 1.1, gain: 0.14, a: 0.01, r: 0.48, pan: 0, pan1: -0.85, wet: 0.45 });
      P.noise(T(6), 0.5, { type: 'bandpass', f0: 2500, f1: 650, q: 1.1, gain: 0.14, a: 0.01, r: 0.48, pan: 0, pan1: 0.85, wet: 0.45 });

      /* ---- the lights converge (their whooshes come with the plan): drawn in ---- */
      P.riser(T(300), secs(300, HIT), { f0: 300, f1: 8000, p0: P.note(36), p1: P.note(60), gain: 0.12 });
      P.swell(T(HIT - 520), 0.52, { gain: 0.2, tone: P.note(48), f0: 1500, f1: 6500 });

      /* ---- 1.0 s: the gold blaze ---- */
      P.impact(T(HIT), { size: 1.6, metal: 82, wet: 0.55 });
      P.noise(T(HIT), 0.7, { type: 'lowpass', f0: 1400, f1: 180, q: 0.6, gain: 0.36, a: 0.003, r: 0.69, wet: 0.5 });     // the blast
      brass(P, T(HIT), P.note(24), [1, 2, 2.378, 3], 2.8, 0.36, 2600, 0.28);
      P.sub(T(HIT), { gain: 0.5, f0: 65.4, f1: 32.7, dur: 2.6 });
      P.whoomp(T(HIT + 10), { gain: 0.42 });
      P.noise(T(HIT), 0.3, { type: 'highpass', f0: 3000, f1: 7000, q: 0.6, gain: 0.26, a: 0.0008, r: 0.29, wet: 0.5 });
      // the golden glint
      [84, 91, 99].forEach((m, i) => P.tone(T(HIT + 15 * i), 2.6 - i * 0.5, { f0: P.note(m), gain: 0.03 - i * 0.006, a: 0.003, r: 2.5 - i * 0.5, pan: [-0.3, 0.3, 0][i], wet: 0.8 }));
      // the blaze roaring while it feeds the year, dying away by 2.4 s
      P.noise(T(HIT + 60), 1.45, { type: 'lowpass', f0: 650, f1: 260, q: 0.7, gain: 0.12, a: 0.12, r: 1.0, wet: 0.35 });
      P.noise(T(HIT + 60), 1.3, { type: 'bandpass', f0: 1600, f1: 900, q: 0.7, gain: 0.05, a: 0.12, r: 0.9, wet: 0.35 });

      /* ---- 9.6 s, 10.4 s: perfectly balanced (each letter's dust comes with the plan) ---- */
      // the room holds its breath, then the first gust
      P.swell(T(T_HALF1 - 700), 0.7, { gain: 0.07, tone: P.note(36), f0: 1200, f1: 4200 });
      P.sub(T(T_HALF1), { gain: 0.12, f0: 58, f1: 30, dur: 1.6 });
      P.tone(T(T_HALF1), 1.8, { type: 'sawtooth', f0: P.note(36), f1: P.note(31), glide: 1.6, gain: 0.05, a: 0.04, r: 1.7, lp: 520, lp1: 160, q: 1, wet: 0.6 });
      // the second, bigger
      P.swell(T(T_HALF2 - 520), 0.52, { gain: 0.1, tone: P.note(43), f0: 1400, f1: 5200 });
      P.sub(T(T_HALF2), { gain: 0.16, f0: 54, f1: 25, dur: 2.2 });
      P.punch(T(T_HALF2), { gain: 0.14, f0: 110, f1: 38 });
      // ... and a last low chord as the dust goes, into silence
      LAST.forEach((m, i) => P.tone(T(T_HALF2 + 40), 3.2 - i * 0.3, { type: i ? 'sawtooth' : 'sine', f0: P.note(m), detune: (i - 1.5) * 5, gain: i ? 0.02 : 0.045, a: 0.25, r: 2.6 - i * 0.3, lp: 700, lp1: 180, lpGlide: 2.8, q: 0.8, pan: [0, -0.35, 0.35, 0][i], wet: 0.75 }));
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const px = (x) => P.pan(0.5 + (fin(x, 0.5) - 0.5) * 1.25);
      const cx = fin(d.cx, 0.5);
      const lights = Array.isArray(d.lights) ? d.lights : [];
      const digits = w && w.year && Array.isArray(d.digits) ? d.digits : [];
      const letters = Array.isArray(d.letters) ? d.letters.filter((l) => l && isFinite(l.at)) : [];
      const ends = Array.isArray(d.ends) ? d.ends.filter((e) => e && isFinite(e.at)) : [];

      /* ---- the six lights: from where each starts to the centre, landing on the blaze ---- */
      lights.forEach((lt, i) => {
        const t0 = Math.min(HIT - 120, fin(lt.t0, 100 + i * 55));
        const len = secs(t0, HIT, 0.12);
        const p0 = px(lt.x0);
        const p1 = px(cx);
        P.noise(T(t0), len, { type: 'bandpass', f0: 420, f1: 4200, q: 1.5, gain: 0.3, a: len * 0.95, r: 0.025, pan: p0, pan1: p1, wet: 0.3 });
        P.noise(T(t0), len, { type: 'lowpass', f0: 240, f1: 800, q: 0.8, gain: 0.2, a: len * 0.92, r: 0.03, pan: p0, pan1: p1, wet: 0.15 });
        P.tone(T(t0), len, { type: 'sawtooth', f0: P.note(LIGHT_NOTES[i % 6]) * 0.94, f1: P.note(LIGHT_NOTES[i % 6]), gain: 0.045, a: len * 0.9, r: 0.03, lp: 500, lp1: 3800, q: 2, pan: p0, pan1: p1, wet: 0.55, vib: 12, vibHz: 6.5 });
      });

      /* ---- the year, forged centre digits first ---- */
      let forged = HIT;
      digits.forEach((dg, j) => {
        const at = fin(dg.at, 1250 + j * 150);
        const pan = px(dg.x);
        const last = j === digits.length - 1;
        // the stream of gold pouring from the blaze into it
        P.noise(T(at - 220), 0.22, { type: 'bandpass', f0: 5600, f1: 1500, q: 2.2, gain: 0.13, a: 0.19, r: 0.03, pan: px(cx), pan1: pan, wet: 0.35 });
        // the hammer blow, the heavy metal ringing, the white-hot hiss as it cools
        P.punch(T(at), { gain: last ? 0.58 : 0.42, f0: 150, f1: 44, pan: pan });
        P.transient(T(at), { gain: 0.32, f: 3000, pan: pan });
        P.noise(T(at), 0.5, { type: 'bandpass', f0: 900, f1: 220, q: 0.8, gain: 0.13, a: 0.002, r: 0.48, pan: pan, wet: 0.5 });
        P.metal(T(at), { gain: last ? 0.13 : 0.1, base: FORGE[j % 4], pan: pan, decay: last ? 2.6 : 2, wet: 0.5 });
        P.noise(T(at + 25), 0.55, { type: 'highpass', f0: 4200, f1: 7000, q: 0.5, gain: 0.05, a: 0.04, r: 0.5, pan: pan, wet: 0.3 });
        for (let k = 0; k < 3; k++) P.noise(T(at + 20 + P.rand() * 380), 0.006 + P.rand() * 0.012, { type: 'highpass', f0: 3500 + P.rand() * 4500, q: 0.7, gain: 0.12 * (0.5 + P.rand() * 0.5), a: 0.0005, r: 0.01, pan: pan + (P.rand() - 0.5) * 0.4, wet: 0.3 });
        if (last) P.sub(T(at), { gain: 0.36, f0: 62, f1: 30, dur: 1.4 });
        forged = Math.max(forged, at);
      });

      /* ---- ash rising into the title, letter by letter: the climax lands as the last is whole ---- */
      if (letters.length) {
        const a0 = letters[0].at;
        const aN = letters[letters.length - 1].at;
        const clx = aN + 780;
        const span = secs(a0, clx, 0.4);
        const pL = px(letters[0].x);
        const pR = px(letters[letters.length - 1].x);
        P.noise(T(a0), span, { type: 'bandpass', f0: 1300, f1: 5200, q: 0.8, gain: 0.24, a: span * 0.7, r: 0.04, pan: pL, pan1: pR, wet: 0.5 });
        P.noise(T(a0 + 120), secs(a0 + 120, clx, 0.3), { type: 'highpass', f0: 5500, f1: 9000, q: 0.5, gain: 0.05, a: secs(a0 + 120, clx, 0.3) * 0.85, r: 0.04, pan: pR, pan1: pL, wet: 0.6 });
        // each letter forming: a puff of ash settling into it, and a few grains
        letters.forEach((l) => {
          const pan = px(l.x);
          P.noise(T(l.at + 240), 0.62, { type: 'bandpass', f0: 1800, f1: 4200, q: 0.9, gain: 0.13, a: 0.4, r: 0.2, pan: pan, wet: 0.5 });
          for (let k = 0; k < 2; k++) {
            P.noise(T(l.at + 300 + P.rand() * 480), 0.005 + P.rand() * 0.012, { type: 'highpass', f0: 3200 + P.rand() * 5000, q: 0.6, gain: 0.1 * (0.4 + P.rand() * 0.6), a: 0.0005, r: 0.009, pan: pan + (P.rand() - 0.5) * 0.25, wet: 0.45 });
          }
        });
        // a breath rising under it
        P.tone(T(a0), span, { type: 'sawtooth', f0: P.note(36), gain: 0.07, a: span * 0.8, r: 0.05, lp: 180, lp1: 1600, q: 3, pan: -0.2, wet: 0.5 });
        P.tone(T(a0), span, { type: 'sawtooth', f0: P.note(43), detune: 6, gain: 0.055, a: span * 0.85, r: 0.05, lp: 180, lp1: 1800, q: 3, pan: 0.2, wet: 0.5 });
        const rl = Math.min(1.1, Math.max(0.4, (clx - Math.max(forged, HIT) - 150) / 1000));
        P.riser(T(clx - rl * 1000), rl, { f0: 500, f1: 7500, p0: P.note(43), p1: P.note(67), gain: 0.09 });
        P.swell(T(clx - 420), 0.42, { gain: 0.17, tone: P.note(48), f0: 1600, f1: 6000 });

        /* ---- the words are whole: the climax ---- */
        P.impact(T(clx), { size: 0.64, wet: 0.55 });
        P.stab(T(clx), STAB, { gain: 0.125, dur: 3.4, open: 2400 });
        P.metal(T(clx + 10), { gain: 0.07, base: 71, decay: 4, wet: 0.75 });

        /* ---- the purple aura: a low drone and a dark pad breathing under the motes ---- */
        const auraEnd = T_HALF1 - 220;
        const al = secs(clx + 200, auraEnd, 2);
        P.pad(T(clx + 200), al, AURA, { gain: 0.06, lp: 620, a: 1.8, r: 1.1 });
        P.hum(T(clx + 100), secs(clx + 100, T_HALF2, 2), { f: P.note(24) * 2, gain: 0.03, lp: 320, a: 1.2, r: 1.4 });
        // the aura breathes (its brightest at about 6.7 s)
        P.noise(T(5400), 2.7, { type: 'lowpass', f0: 380, q: 0.6, gain: 0.05, a: 1.35, r: 1.35, wet: 0.6 });
        P.tone(T(5500), 2.5, { f0: P.note(63), gain: 0.012, a: 1.25, r: 1.25, wet: 0.8, vib: 8, vibHz: 4 });

        // the six motes, each singing as it passes in front of the words (right to left)
        const ring = d.ring || {};
        const rx = fin(ring.x, 0.5);
        const rw = fin(ring.rx, 0.25);
        const PASS = Math.PI / 0.0011;
        for (let i = 0; i < 6; i++) {
          for (let k = 0; k < 4; k++) {
            const ts = (2 * Math.PI * k - i * Math.PI / 3) / 0.0011;
            const mid = ts + PASS / 2;
            if (mid < Math.max(2900, clx + 300) || mid > 8800) continue;
            P.tone(T(ts), PASS / 1000, { f0: P.note(MOTE_NOTES[i]), gain: 0.015, a: PASS / 2000, r: PASS / 2000, pan: px(rx + rw), pan1: px(rx - rw), wet: 0.7, vib: 7, vibHz: 5 });
          }
        }
      }

      /* ---- perfectly balanced: each letter's dust blown off to the right ---- */
      const halves = [ends.filter((e) => e.at < (T_HALF1 + T_HALF2) / 2), ends.filter((e) => e.at >= (T_HALF1 + T_HALF2) / 2)];
      halves.forEach((h, q) => {
        if (!h.length) return;
        const big = q === 1;
        let mx = 0;
        for (const e of h) mx += fin(e.x, 0.5);
        mx /= h.length;
        const t0 = q ? T_HALF2 : T_HALF1;
        // the gust
        P.noise(T(t0 + 40), 1.8, { type: 'lowpass', f0: 300, f1: 900, glide: 0.8, q: 0.7, gain: big ? 0.16 : 0.13, a: 0.35, r: 1.4, pan: px(mx), pan1: 0.8, wet: 0.45 });
        P.noise(T(t0 + 60), 1.7, { type: 'bandpass', f0: 900, f1: 2600, q: 1, gain: big ? 0.15 : 0.1, a: 0.4, r: 1.25, pan: px(mx), pan1: 0.85, wet: 0.5 });
        // each letter: its dust hissing away from where it stands, and a few grains
        h.forEach((e) => {
          const at = e.at;
          const pan = px(e.x);
          P.noise(T(at + 50), 1.35, { type: 'bandpass', f0: 2200, f1: 6000, q: 0.7, gain: big ? 0.13 : 0.1, a: 0.14, r: 1.15, pan: pan, pan1: Math.min(0.85, pan + 0.35), wet: 0.5 });
          for (let k = 0; k < 3; k++) {
            P.noise(T(at + 80 + P.rand() * 500), 0.005 + P.rand() * 0.01, { type: 'highpass', f0: 3500 + P.rand() * 5000, q: 0.6, gain: 0.08 * (0.5 + P.rand() * 0.5), a: 0.0005, r: 0.009, pan: Math.min(0.85, pan + P.rand() * 0.3), wet: 0.45 });
          }
        });
      });
    }
  });
})();
