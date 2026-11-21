/*!
 * Avengers Player: the sound of 'warmachine', the War Machine celebration (see fx-warmachine.js for
 * the picture). Everything sits on D, low and heavy.
 *
 *   0.0 s    power-on: a metal impact with a braam under it, an electric thunk, the white-hot line
 *            tearing out to both edges; the boot tone climbs while the scan lines sweep (it lands on
 *            a beep at 0.76 s), the vertical scan crosses the frame left to right (the frame blips
 *            on as it lights each side), the reticle whirrs up and slides down onto the words.
 *   0.56 s+  target acquisition: per letter, as the seeker box snaps onto it, a lock blip and a
 *            mechanical clunk, panned to the letter.
 *   1.5 s+   the year's counter: each drum powers on with a blip and rolls (a tick per digit rolled,
 *            exactly as the drum turns), then locks (a heavy clunk, a clank of metal, two blips on
 *            the red double blink). The brackets servo in, a riser and a reverse swell draw in to
 *            the lock of the whole display (2.55 s, or 1.82 s without a year): the climax, a big
 *            impact, a braam and the lock tone, the red ring rushing out.
 *   2.8-8 s  five salvoes: per round, a muzzle crack in its corner, the tracer flying up and across
 *            to where it bursts, a flak burst there (farther, higher bursts are darker, quieter and
 *            wetter); the steel sheens shimmer across. A low drone and a dark chord hold underneath.
 *   8.65 s   the finale: two rounds fire together and curve in from both sides while a riser and a
 *            reverse swell build; at 9.75 s the biggest hit (impact, a braam a third below, rolling
 *            rumble, sparks raining), the brackets blinking red.
 *   11 s     the display powers down, the letters scan out from both ends inwards, the reticle
 *            shrinks to a point that winks out (11.9 s): a last low thump, then the hall's tail.
 *
 * The moments that depend on the words, the screen or the seed (each letter's lock, the drums,
 * the display's lock, every round's launch, burst and sparks) come from the animation's plan
 * (fx-warmachine.js, create()). Original sound design: no melody or motif from any film.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-warmachine.js (ms): the boot.
  const T_SPLIT0 = 150;
  const T_SPLIT1 = 760;
  const T_VSCAN0 = 380;
  const T_VSCAN1 = 1300;
  const T_RET0 = 200;
  const T_RET1 = 700;
  const T_SLIDE0 = 760;
  const T_SLIDE1 = 1620;
  const T_SEEK = 440;

  const ROOT = 36.71;                       // D1
  const BB0 = 29.14;                        // Bb0: the finale, a third below

  let planned = false;                      // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  /** The brass of a braam (the impact under it brings the sub): detuned saws whose filter blows
   *  open, driven, in the hall, and a darker layer carrying the tail. */
  function brass(P, t, root, notes, len, g, open) {
    notes.forEach((m, i) => [-8, 8].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: root * m, detune: dt + (P.rand() - 0.5) * 4, gain: g / (notes.length * 1.2) / (1 + i * 0.3),
      a: 0.04, r: len * 0.6, lp: 150, lp1: open, lpGlide: 0.16, q: 1.5, drive: 2, pan: dt / 16, wet: 0.5
    })));
    P.tone(t + 0.2, len, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.2, r: len * 0.7, lp: 800, lp1: 160, q: 1.2, drive: 2, wet: 0.6 });
  }

  /** Struck metal, a few inharmonic modes. */
  function ring(P, t, base, g, dec, pan, n) {
    const M = [1, 2.32, 4.25, 6.63, 9.38];
    for (let i = 0; i < Math.min(n || 4, M.length); i++) {
      const d = dec / (1 + i * 0.4);
      P.tone(t, d, { f0: Math.min(15000, base * M[i] * (1 + (P.rand() - 0.5) * 0.004)), gain: g / Math.pow(i + 1, 0.7), a: 0.001, r: d, pan: pan, wet: 0.45 });
    }
  }

  /** A full-range hit (7 voices): the crack, the punch, a body in the mids (what small speakers
   *  play), a driven growl, a sub that is felt, and the hall's tail. o: { size, pan } */
  function hit(P, t, o) {
    const s = o.size == null ? 1 : o.size;
    const pan = o.pan;
    P.transient(t, { gain: 0.42 * s, pan: pan, f: 2600 });
    P.punch(t, { gain: 0.5 * s, pan: pan, f0: 160, f1: 50 });
    P.noise(t, 0.75, { type: 'bandpass', f0: 1500, f1: 220, glide: 0.35, q: 0.7, gain: 0.5 * s, a: 0.002, r: 0.73, pan: pan, wet: 0.45 });
    P.tone(t, 0.95, { type: 'sawtooth', f0: 82, f1: 41, glide: 0.4, gain: 0.22 * s, a: 0.003, r: 0.93, lp: 1700, lp1: 220, lpGlide: 0.5, q: 0.8, drive: 3, pan: pan, wet: 0.35 });
    P.sub(t, { gain: 0.38 * s, dur: 1 + 0.6 * s });
    P.noise(t + 0.02, 1.8 + s, { type: 'lowpass', f0: 800, f1: 90, q: 0.5, gain: 0.2 * s, a: 0.03, r: 1.7 + s, pan: pan, wet: 0.7 });
  }

  /** A short HUD blip (one voice). */
  function blip(P, t, f, g, pan, len, f1) {
    P.tone(t, len || 0.05, { type: 'square', f0: f, f1: f1, gain: g, a: 0.001, r: (len || 0.05) * 0.9, lp: Math.min(9000, f * 2.2), pan: pan, wet: 0.2 });
  }

  S.define('warmachine', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: power-on ---- */
      hit(P, T(0), { size: 1.4 });
      ring(P, T(0), 98, 0.11, 2.6, 0, 3);
      brass(P, T(0), ROOT, [1, 2, 3, 4], 1.7, 0.34, 1900);
      P.tone(T(0), 0.15, { type: 'square', f0: 1900, f1: 70, glide: 0.1, gain: 0.15, a: 0.0006, r: 0.14, drive: 5, lp: 5200, wet: 0.3 });
      // the white-hot line tearing out to both edges (it reaches them at 0.24 s)
      for (const side of [-0.85, 0.85]) P.noise(T(0), 0.3, { type: 'bandpass', f0: 6800, f1: 2000, q: 1, gain: 0.17, a: 0.003, r: 0.29, pan: 0, pan1: side, wet: 0.4 });

      /* ---- the boot ---- */
      // the scan lines sweep to the top and bottom edges while the boot tone climbs; a beep as they land
      P.powerUp(T(T_SPLIT0), (T_SPLIT1 - T_SPLIT0) / 1000, { f0: 55, f1: 220, gain: 0.1 });
      P.noise(T(T_SPLIT0), (T_SPLIT1 - T_SPLIT0) / 1000, { type: 'bandpass', f0: 900, f1: 4200, q: 2.4, gain: 0.06, a: 0.12, r: 0.35, wet: 0.3 });
      blip(P, T(T_SPLIT1), 1760, 0.05, 0, 0.1);
      // the reticle whirrs up in the middle of the frame (the seeker drops out of it), then slides onto the words
      P.servo(T(T_RET0), (T_RET1 - T_RET0) / 1000, { f0: 140, f1: 420, gain: 0.05 });
      blip(P, T(T_SEEK), 2093, 0.04, 0, 0.08, 1397);
      P.servo(T(T_SLIDE0), (T_SLIDE1 - T_SLIDE0) / 1000, { f0: 260, f1: 165, gain: 0.035 });
      // the vertical scan crosses the frame left to right; the frame and the scales blip on as it lights them
      const vs = (T_VSCAN1 - T_VSCAN0) / 1000;
      P.noise(T(T_VSCAN0), vs, { type: 'bandpass', f0: 2600, f1: 3600, q: 5, gain: 0.08, a: 0.09, r: 0.2, pan: -0.85, pan1: 0.85, wet: 0.25 });
      const lit = (x) => T_VSCAN0 + (T_VSCAN1 - T_VSCAN0) * x;
      blip(P, T(lit(0.03)), 2637, 0.03, -0.85);
      blip(P, T(lit(0.97)), 3136, 0.03, 0.85);
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const letters = Array.isArray(d.letters) ? d.letters : [];
      const digits = Array.isArray(d.digits) ? d.digits : [];
      const shots = Array.isArray(d.shots) ? d.shots : [];
      const lock = fin(d.lock, 2550);
      const down = fin(d.down, 11000);

      /* ---- target acquisition: a lock blip and a clunk per letter ---- */
      letters.forEach((e, i) => {
        const t = T(fin(e.t, 560 + i * 70));
        const pan = P.pan(fin(e.x, 0.5));
        const up = i / Math.max(1, letters.length - 1);
        // the lock blips climb a little along the line (a scan, not a tune); the last is higher
        blip(P, t, i === letters.length - 1 ? 3136 : 1760 * Math.pow(1.5, up * 0.7), 0.03 + 0.012 * up, pan, 0.045);
        P.tone(t, 0.13, { f0: 210, f1: 62, glide: 0.05, gain: 0.17 + 0.07 * up, a: 0.001, r: 0.12, drive: 2.6, pan: pan, wet: 0.2 });
      });

      /* ---- the readout's gate, the drums rolling and locking ---- */
      const gate = fin(d.gate, 1510);
      if (digits.length) {
        const mx = digits.reduce((s, e) => s + fin(e.x, 0.5), 0) / digits.length;
        P.servo(T(gate), 0.14, { f0: 300, f1: 560, gain: 0.05, pan: P.pan(mx) });
        P.tone(T(gate + 40), 0.12, { f0: 190, f1: 70, glide: 0.05, gain: 0.2, a: 0.001, r: 0.11, drive: 2.4, pan: P.pan(mx), wet: 0.2 });
      } else {
        blip(P, T(gate), 1568, 0.035, 0, 0.09, 1047);
      }
      digits.forEach((e, p) => {
        const on = fin(e.on, gate + 40 + p * 55);
        const lk = Math.max(on + 30, fin(e.lock, lock));
        const pan = P.pan(fin(e.x, 0.5));
        blip(P, T(on), 660, 0.03, pan, 0.06, 1320);
        // the drum spinning: a low motor whirr until it stops dead
        P.tone(T(on), (lk - on) / 1000, { type: 'sawtooth', f0: 95 + p * 12, f1: 120 + p * 14, gain: 0.035, a: 0.04, r: 0.02, lp: 900, q: 2, pan: pan, wet: 0.15 });
        // a tick per digit the drum rolls past (the last one is the lock)
        const n = clamp(Math.round(fin(e.rolls, 0)), 0, 40);
        for (let m = 1; m < n; m++) {
          P.noise(T(on + (lk - on) * m / n), 0.016, { type: 'bandpass', f0: 2800 + p * 300, q: 1.8, gain: 0.85, a: 0.0005, r: 0.015, pan: pan, wet: 0.12 });
        }
        // the lock: a heavy clunk, a clank, two blips on the red double blink
        P.punch(T(lk), { gain: 0.24 + 0.04 * p, pan: pan, f0: 175, f1: 50 });
        ring(P, T(lk), 520 + p * 40, 0.05, 0.55, pan, 2);
        blip(P, T(lk + 50), 1976, 0.03, pan, 0.06);
        blip(P, T(lk + 165), 1976, 0.03, pan, 0.06);
      });

      /* ---- the lock of the whole display: the climax ---- */
      const brk = fin(d.brackets, lock - 440);
      P.servo(T(brk), Math.max(0.1, (lock - 40 - brk) / 1000), { f0: 180, f1: 470, gain: 0.05 });
      P.riser(T(lock) - 1.2, 1.2, { gain: 0.15, p0: 73, p1: 587 });
      P.swell(T(lock) - 0.6, 0.6, { gain: 0.12, tone: 146.8 });
      hit(P, T(lock), { size: 1.5 });
      ring(P, T(lock), 110, 0.1, 2.8, 0, 4);
      brass(P, T(lock), ROOT * 2, [1, 1.5, 2, 3], 2.6, 0.42, 2600);
      P.tone(T(lock) + 0.02, 0.09, { f0: 1568, gain: 0.07, a: 0.002, r: 0.08, wet: 0.3 });
      P.tone(T(lock) + 0.11, 0.32, { f0: 2093, gain: 0.08, a: 0.002, r: 0.3, wet: 0.35 });
      // the red ring rushing out
      P.noise(T(lock), 0.8, { type: 'bandpass', f0: 380, f1: 3600, q: 0.8, gain: 0.13, a: 0.01, r: 0.78, wet: 0.5 });

      /* ---- the hold: a low drone and a dark chord under the salvoes ---- */
      const hold = Math.max(1, (down - lock) / 1000 + 0.6);
      P.hum(T(lock) + 0.3, hold, { f: ROOT * 2, gain: 0.03, a: 1.4, r: 1.2, lp: 420 });
      P.pad(T(lock) + 0.6, hold - 0.3, [38, 45, 53], { gain: 0.025, lp: 760, a: 2.2, r: 1.6 });
      // the sheens across the steel (the first rides on the lock)
      (Array.isArray(d.sheens) ? d.sheens.slice(1) : []).forEach((s) => {
        P.noise(T(fin(s, 4300)), 1, { type: 'bandpass', f0: 5000, f1: 8200, q: 4, gain: 0.04, a: 0.45, r: 0.55, pan: -0.6, pan1: 0.6, wet: 0.5 });
      });

      /* ---- the salvoes ---- */
      let ns = 0;
      for (const s of shots) {
        if (s.fin) continue;
        ns++;
        const t0 = fin(s.t0, 3000);
        const tb = Math.max(t0 + 200, fin(s.tb, t0 + 1000));
        const sz = clamp(fin(s.size, 1), 0.6, 1.4);
        const ps = P.pan(fin(s.x0, 0.03));
        const pb = P.pan(fin(s.bx, 0.5));
        const flight = (tb - t0) / 1000;
        // the muzzle: a crack with its thump, in its corner
        P.noise(T(t0), 0.34, { type: 'lowpass', f0: 3000 + P.rand() * 900, f1: 260, glide: 0.1, q: 0.9, gain: 0.34 * sz, a: 0.0008, r: 0.33, pan: ps, wet: 0.45 });
        // the tracer flying up and across (falling in pitch as it goes away)
        P.noise(T(t0) + 0.02, flight, { type: 'bandpass', f0: 2600, f1: 1000, q: 3.2, gain: 0.06, a: flight * 0.2, r: flight * 0.78, pan: ps, pan1: pb, wet: 0.3 });
        // the flak: farther (higher) bursts are darker, quieter, wetter
        const far = clamp((0.4 - fin(s.by, 0.3)) / 0.25, 0, 1);
        const g = (0.4 - 0.15 * far) * sz;
        P.tone(T(tb), 0.6, { f0: (150 - 35 * far) * (0.9 + P.rand() * 0.2), f1: 52, glide: 0.12, gain: g * 0.55, a: 0.002, r: 0.58, drive: 3, pan: pb, wet: 0.35 + 0.25 * far });
        P.noise(T(tb), 1.3, { type: 'lowpass', f0: 2600 - 1100 * far, f1: 160, glide: 0.45, q: 0.7, gain: g * 0.8, a: 0.003, r: 1.28, pan: pb, wet: 0.65 + 0.2 * far });
        // a spark popping as the first glint flares in the burst (every other one)
        if (ns % 2) continue;
        const crk = Array.isArray(s.crk) && s.crk.length ? Math.min.apply(null, s.crk.map((c) => fin(c, tb + 500))) : tb + 500;
        P.noise(T(crk), 0.02, { type: 'highpass', f0: 3800, q: 0.8, gain: 0.16 * (1 - 0.4 * far), a: 0.0005, r: 0.018, pan: pb, wet: 0.4 });
      }

      /* ---- the finale ---- */
      const fins = shots.filter((s) => s.fin);
      const f0 = fin(d.finale, 8650);
      const fb = Math.max(f0 + 300, fin(d.finBurst, 9750));
      const ff = (fb - f0) / 1000;
      P.punch(T(f0), { gain: 0.5, f0: 200, f1: 48 });
      (fins.length ? fins : [{ x0: 0.025 }, { x0: 0.975 }]).forEach((s) => {
        const ps = P.pan(fin(s.x0, 0.5));
        P.noise(T(f0), 0.45, { type: 'lowpass', f0: 3800, f1: 240, glide: 0.12, q: 0.9, gain: 0.42, a: 0.0008, r: 0.44, pan: ps, wet: 0.5 });
        // the two rounds curving in to meet above the reticle, closing in (rising)
        P.noise(T(f0) + 0.03, ff - 0.03, { type: 'bandpass', f0: 900, f1: 3800, q: 2.6, gain: 0.09, a: (ff - 0.03) * 0.85, r: 0.04, pan: ps, pan1: 0, wet: 0.3 });
      });
      P.riser(T(f0) + 0.1, ff - 0.1, { gain: 0.12, p0: 55, p1: 440 });
      P.swell(T(fb) - 0.8, 0.8, { gain: 0.15, tone: 116.5 });
      hit(P, T(fb), { size: 1.6 });
      ring(P, T(fb), 87, 0.12, 3.2, 0, 4);
      brass(P, T(fb), BB0 * 2, [1, 1.5, 2, 3], 2.8, 0.48, 2200);
      // the rumble rolling round the sky, and the sparks raining down
      P.noise(T(fb) + 0.05, 3.2, { type: 'lowpass', f0: 320, f1: 60, q: 0.5, gain: 0.13, a: 0.05, r: 3.1, wet: 0.6 });
      for (let i = 0; i < 3; i++) {
        P.noise(T(fb) + 0.25 + i * 0.42 + P.rand() * 0.15, 0.9, { type: 'lowpass', f0: 520 - i * 90, f1: 90, q: 0.6, gain: 0.12 - i * 0.025, a: 0.05, r: 0.85, pan: (i - 1) * 0.6, wet: 0.7 });
      }
      const rain = [];
      for (const s of fins) for (const c of (Array.isArray(s.crk) ? s.crk : [])) rain.push(fin(c, fb + 600));
      rain.sort((a, b) => a - b).slice(0, 7).forEach((c) => {
        P.noise(T(c), 0.02, { type: 'highpass', f0: 3600 + P.rand() * 3000, q: 0.8, gain: 0.13, a: 0.0005, r: 0.018, pan: (P.rand() - 0.5) * 1.2, wet: 0.45 });
      });
      // the brackets blink red again
      blip(P, T(fb + 60), 1976, 0.04, -0.4, 0.07);
      blip(P, T(fb + 180), 1976, 0.04, 0.4, 0.07);

      /* ---- the power-down ---- */
      P.powerDown(T(down), 1.6, { f0: 220, f1: 30, gain: 0.12 });
      P.servo(T(down) + 0.1, 0.6, { f0: 420, f1: 120, gain: 0.04 });
      // the letters scan out from both ends inwards
      const outs = Array.isArray(d.outs) ? d.outs.map((o) => fin(o.t, down + 200)) : [];
      const o0 = outs.length ? Math.min.apply(null, outs) : down + 40;
      const o1 = outs.length ? Math.max.apply(null, outs) + 150 : down + 650;
      for (const side of [-0.7, 0.7]) P.noise(T(o0), Math.max(0.1, (o1 - o0) / 1000), { type: 'bandpass', f0: 5200, f1: 2400, q: 3, gain: 0.05, a: 0.04, r: 0.3, pan: side, pan1: 0, wet: 0.3 });
      // the reticle shrinks to a point that winks out
      const pt = fin(d.point, down + 900);
      P.tone(T(pt), 0.5, { f0: 1760, f1: 220, gain: 0.04, a: 0.08, r: 0.4, wet: 0.5 });
      P.sub(T(pt) + 0.25, { gain: 0.08, f0: 70, f1: 30, dur: 1.4 });
      P.tone(T(pt) + 0.25, 0.4, { f0: 2637, gain: 0.025, a: 0.002, r: 0.39, wet: 0.7 });
    }
  });
})();
