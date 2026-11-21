/*!
 * Avengers Player: the sound of 'gamma', the green gamma storm (see fx-gamma.js for the picture).
 *
 *   0.0 s    a thunderclap: the sky cracks open (a close, wide crack, the rolling rumble, the green
 *            flash buzzing); with no year it is the bolt into the ground under the words.
 *   0-0.45 s the year plunges in digit by digit: per digit an incoming roar as it falls, then a heavy
 *            impact panned where it lands with a ground-shaking rumble; the last one is the smash,
 *            the biggest hit (impact, braam, thunder, arcs tearing out along the ground to both sides,
 *            glassy shards).
 *   0.8-1.8  lightning writes the title: per strike a leader sizzling down, the crack and the zap of
 *            the bolt panned to its letter (a fork: between its two), and the second stroke; a riser
 *            builds under them and the last strike is the climax (a minor stab, an impact).
 *   2-10.5 s the words burn: a gamma hum and a dark pad, a heartbeat on every pulse of the glow,
 *            electricity crawling over the letters (a buzz where each arc crawls), arcs striking around
 *            the words and along the edges (a crack and a rumble from where they strike).
 *   5.8 s    the second surge: a riser and a reverse swell land on an impact, thunder and a braam,
 *            the strikes of the surge cracking out across the picture.
 *   10.6 s+  the letters short out one by one, left to right (a crackle and a dying buzz each), the
 *            power winds down, a last crackle of energy, then the hall's tail.
 *
 * Every moment comes from the animation's plan (fx-gamma.js, create()): when and where each digit
 * lands, each letter is struck, each arc strikes or crawls, each letter goes out. Original sound
 * design: no melody or motif from any film.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  // The fixed moments of fx-gamma.js (ms); the plan carries them too.
  const MID = 5800;

  // Pitches: everything sits on E, minor.
  const BUZZ = [41.2, 43.65, 49, 55, 61.74, 65.41, 73.42, 82.41, 87.31, 98, 110, 123.5];   // the letters' zaps, climbing (E1 .. B2)
  const STAB = [40, 47, 55];              // E2 B2 G3: the title written
  const PAD = [40, 47, 55];               // E2 B2 G3: the words burning

  let planned = false;                    // the plan is heard once per play (renderAt reports it again)

  const fin = (x, d) => (typeof x === 'number' && isFinite(x) ? x : d);
  const secs = (a, b, min) => Math.max(min || 0.02, (b - a) / 1000);

  /** A braam (detuned saws whose filter blows open, driven, in the hall) that holds `hold` s and dies away. */
  function brass(P, t, root, notes, len, g, open, hold) {
    notes.forEach((m, i) => [-9, 0, 9].forEach((dt) => P.tone(t, len, {
      type: 'sawtooth', f0: root * m, detune: dt + (P.rand() - 0.5) * 4, gain: g / (notes.length * 1.6) / (1 + i * 0.25),
      a: 0.04, r: Math.max(0.1, len - 0.04 - hold), lp: 160, lp1: open, lpGlide: 0.16, q: 1.6, drive: 1.8, pan: (dt / 9) * 0.55, wet: 0.5
    })));
    P.tone(t + 0.2, len, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.15, r: len * 0.75, lp: 900, lp1: 160, q: 1.2, drive: 2, wet: 0.6 });
  }

  /** The crack of a bolt: a hard, bright snap of air. */
  function crack(P, t, g, pan, f) {
    P.noise(t, 0.07, { type: 'highpass', f0: f || 2000, q: 0.6, gain: g, a: 0.0008, r: 0.066, pan: pan, wet: 0.5 });
  }

  /** Thunder rolling away from where it struck. */
  function rumble(P, t, len, g, pan) {
    P.noise(t, len, { type: 'lowpass', f0: 460, f1: 70, q: 0.6, gain: g, a: 0.025, r: len * 0.92, pan: pan, wet: 0.65 });
  }

  /** The zap of the current: a driven, warbling buzz falling away. */
  function zap(P, t, len, g, pan, f) {
    P.tone(t, len, { type: 'sawtooth', f0: f, f1: f * 0.72, gain: g, a: 0.002, r: len * 0.92, drive: 6, lp: 4600, lp1: 1100, pan: pan, wet: 0.35, vib: 45, vibHz: 31 });
  }

  S.define('gamma', {
    bed(T, w, P) {
      planned = false;

      /* ---- 0 s: the thunderclap ---- */
      crack(P, T(0), 0.7, -0.45, 2400);
      crack(P, T(6), 0.62, 0.45, 2800);
      crack(P, T(14), 0.36, 0, 1800);
      P.punch(T(0), { gain: 0.75, f0: 130, f1: 40 });
      P.sub(T(0), { gain: 0.42, f0: 56, f1: 25, dur: 2.2 });
      rumble(P, T(60), 1.1, 0.24, -0.35);
      rumble(P, T(260), 1.5, 0.2, 0.4);
      rumble(P, T(700), 1.8, 0.13, -0.1);
      P.noise(T(0), 0.18, { type: 'bandpass', f0: 1800, f1: 500, q: 0.8, gain: 0.32, a: 0.001, r: 0.17, wet: 0.6 });
      zap(P, T(0), 0.3, 0.12, 0, 82.41);                     // the green flash buzzing
      P.noise(T(0), 0.42, { type: 'highpass', f0: 7000, f1: 4000, q: 0.5, gain: 0.08, a: 0.002, r: 0.4, pan: -0.6, pan1: 0.6, wet: 0.5 });   // the crack running across the sky

      /* ---- 5.8 s: the second surge ---- */
      P.riser(T(MID - 1250), 1.25, { f0: 300, f1: 8500, p0: P.note(28), p1: P.note(64), gain: 0.13 });
      P.swell(T(MID - 450), 0.45, { gain: 0.2, tone: P.note(52), f0: 1600, f1: 6500 });
      P.impact(T(MID), { size: 1.2, bright: true, wet: 0.5 });
      brass(P, T(MID), P.note(28), [1, 2, 3], 2.6, 0.26, 2800, 0.3);
      zap(P, T(MID), 0.45, 0.16, 0, 82.41);
      crack(P, T(MID + 4), 0.4, -0.5, 2600);
      crack(P, T(MID + 9), 0.4, 0.5, 2300);
      rumble(P, T(MID + 60), 2.6, 0.3, -0.3);
      rumble(P, T(MID + 300), 2.2, 0.22, 0.35);
      P.noise(T(MID + 20), 1.3, { type: 'bandpass', f0: 2600, f1: 500, q: 1.1, gain: 0.13, a: 0.01, r: 1.25, pan: 0, pan1: -0.85, wet: 0.4 });   // the ring of the surge tearing out
      P.noise(T(MID + 20), 1.3, { type: 'bandpass', f0: 2400, f1: 480, q: 1.1, gain: 0.13, a: 0.01, r: 1.25, pan: 0, pan1: 0.85, wet: 0.4 });
    },

    cue(name, T, d, P, w) {
      if (name !== 'plan' || planned) return;
      planned = true;
      const px = (x) => P.pan(0.5 + (fin(x, 0.5) - 0.5) * 1.25);
      const digits = w && w.year && Array.isArray(d.digits) ? d.digits.filter((g) => g && isFinite(g.at)) : [];
      const letters = Array.isArray(d.letters) ? d.letters.filter((l) => l && isFinite(l.t)) : [];
      const bolts = Array.isArray(d.bolts) ? d.bolts : [];
      const flashes = Array.isArray(d.flashes) ? d.flashes.filter((f) => f && isFinite(f.t) && isFinite(f.d)) : [];
      const leaves = Array.isArray(d.leaves) ? d.leaves.filter((l) => l && isFinite(l.at)) : [];
      const lead = Math.max(10, fin(d.lead, 70));
      const fall = Math.max(60, fin(d.fall, 300));
      const mid = fin(d.mid, MID);
      const beat = fin(d.beat, 1600);
      const strikesEnd = fin(d.strikesEnd, 10500);
      const leaveAt = fin(d.leaveAt, 10600);
      const smash = digits.length ? fin(d.smash, digits[digits.length - 1].at) : 0;
      const titleDone = letters.length ? fin(d.titleDone, letters[letters.length - 1].t) : smash;

      /* ---- the year smashes down, digit by digit ---- */
      digits.forEach((g, j) => {
        const at = g.at;
        const pan = px(g.x);
        const last = j === digits.length - 1;
        // the incoming roar as it plunges
        P.noise(T(at - fall), fall / 1000, { type: 'bandpass', f0: 3200, f1: 600, q: 1.1, gain: 0.16, a: fall / 1000 * 0.95, r: 0.012, pan: pan, wet: 0.25 });
        // the impact and the ground shaking
        P.punch(T(at), { gain: last ? 0.62 : 0.5, f0: 120, f1: 38, pan: pan });
        P.transient(T(at), { gain: 0.36, f: 2400, pan: pan });
        P.noise(T(at), 0.45, { type: 'bandpass', f0: 800, f1: 180, q: 0.8, gain: 0.18, a: 0.002, r: 0.44, pan: pan, wet: 0.45 });
        P.noise(T(at + 15), 1.5, { type: 'lowpass', f0: 220, f1: 45, q: 0.7, gain: 0.16, a: 0.02, r: 1.45, pan: pan, wet: 0.4 });
        if (j === 0) P.sub(T(at), { gain: 0.3, f0: 60, f1: 28, dur: 1.2 });
      });

      /* ---- the smash: the last digit down, the shock going off ---- */
      if (digits.length) {
        P.impact(T(smash), { size: 1.55, wet: 0.5 });
        brass(P, T(smash), P.note(28), [1, 2, 2.378, 3], 2.6, 0.3, 2600, 0.2);
        P.sub(T(smash), { gain: 0.45, f0: 58, f1: 26, dur: 2.4 });
        rumble(P, T(smash + 40), 2.6, 0.3, 0);
        // arcs tearing out along the ground to both sides
        [-1, 1].forEach((s) => {
          P.noise(T(smash + 10), 0.6, { type: 'bandpass', f0: 3600, f1: 1400, q: 1.4, gain: 0.16, a: 0.005, r: 0.58, pan: s * 0.15, pan1: s * 0.85, wet: 0.35 });
          zap(P, T(smash + 15), 0.4, 0.07, s * 0.6, 98);
        });
        // glassy shards flying
        for (let k = 0; k < 5; k++) {
          const f = 2600 + P.rand() * 3000;
          const len = 0.3 + P.rand() * 0.3;
          P.tone(T(smash + 60 + P.rand() * 320), len, { f0: f, gain: 0.025, a: 0.001, r: len, pan: (P.rand() - 0.5) * 1.5, wet: 0.6 });
        }
      } else {
        // no year: the opening bolt hits the ground under the words
        P.impact(T(0), { size: 1.3, wet: 0.5 });
        brass(P, T(0), P.note(28), [1, 2, 3], 2.2, 0.26, 2400, 0.25);
      }

      /* ---- the bolts: which ones write letters, which crawl, which strike ---- */
      const byBolt = new Map();
      for (const f of flashes) {
        if (!byBolt.has(f.b)) byBolt.set(f.b, []);
        byBolt.get(f.b).push(f);
      }
      const boltPan = (b) => {
        const bo = bolts[b] || {};
        if (bo.edge === 0) return -0.85;
        if (bo.edge === 1) return 0.85;
        return px((fin(bo.x0, 0.5) + fin(bo.x1, 0.5)) / 2);
      };
      for (const [b, fs] of byBolt) {
        fs.sort((p, q) => p.t - q.t);
        if (fs.some((f) => f.k === 2)) continue;                   // a letter's bolt: below
        const pan = boltPan(b);
        if (fs.some((f) => f.k === 1)) {
          // electricity crawling over the words: a buzz while it crawls, crackling
          const t0 = fs[0].t;
          const t1 = fs[fs.length - 1].t + fs[fs.length - 1].d;
          const len = secs(t0, t1, 0.15);
          const p = fin(fs[0].p, 0.2);
          P.tone(T(t0), len, { type: 'sawtooth', f0: 110 + P.rand() * 20, gain: 0.022 * p / 0.22, a: 0.06, r: Math.min(0.3, len * 0.4), drive: 5, lp: 2600, q: 2, pan: pan, wet: 0.3, vib: 60, vibHz: 17 + P.rand() * 8 });
          P.noise(T(t0), len, { type: 'bandpass', f0: 4200, q: 1.6, gain: 0.026 * p / 0.22, a: 0.05, r: Math.min(0.3, len * 0.4), pan: pan, wet: 0.3 });
          continue;
        }
        // a strike: the crack from where it strikes, its strokes, the rumble
        const t0 = fs[0].t;
        if (t0 < 60 || (digits.length && Math.abs(t0 - smash) < 120)) {
          // the thunderclap and the smash have their own; only the strokes after the first are added
          for (let j = 1; j < fs.length; j++) crack(P, T(fs[j].t), 0.22 * fin(fs[j].p, 1), pan, 2600);
          continue;
        }
        const p = Math.min(1.1, fin(fs[0].p, 0.8));
        const surge = Math.abs(t0 - mid) < 600;
        crack(P, T(t0), (surge ? 0.4 : 0.24) * p, pan, 2200 + P.rand() * 800);
        if (surge && fs.length > 1) crack(P, T(fs[1].t), 0.16 * p, pan, 2800);
        rumble(P, T(t0 + 30), surge ? 1.8 : 1.3, (surge ? 0.15 : 0.085) * p, pan);
      }

      /* ---- lightning writes the title ---- */
      letters.forEach((l, q) => {
        const xs = Array.isArray(l.xs) && l.xs.length ? l.xs : [0.5];
        let mx = 0;
        for (const x of xs) mx += fin(x, 0.5);
        mx /= xs.length;
        const pan = px(mx);
        const t = l.t;
        const isLast = q === letters.length - 1;
        // the leader feeling its way down
        P.noise(T(t - lead), lead / 1000 + 0.004, { type: 'bandpass', f0: 2400, f1: 8000, q: 1.4, gain: 0.12, a: lead / 1000 * 0.95, r: 0.004, pan: pan, wet: 0.3 });
        // the strike
        crack(P, T(t), isLast ? 0.5 : 0.4, pan, 2200);
        P.noise(T(t), 0.3, { type: 'bandpass', f0: 1500, f1: 260, q: 0.8, gain: 0.2, a: 0.001, r: 0.3, pan: pan, wet: 0.55 });
        zap(P, T(t), 0.2, 0.1, pan, BUZZ[Math.min(BUZZ.length - 1, Math.round(q * (BUZZ.length - 1) / Math.max(1, letters.length - 1)))] * 2);
        P.punch(T(t), { gain: 0.28, f0: 150, f1: 50, pan: pan });
        // its second stroke
        const re = Array.isArray(l.re) ? l.re.filter((r) => isFinite(r) && r > t) : [];
        if (re.length) crack(P, T(re[0]), 0.2, pan, 3000);
      });

      /* ---- the title written: the climax ---- */
      if (letters.length) {
        const t0 = letters[0].t;
        const rl = secs(t0 - 150, titleDone, 0.4);
        P.riser(T(titleDone - rl * 1000), rl, { f0: 400, f1: 8000, p0: P.note(40), p1: P.note(76), gain: 0.08 });
        P.swell(T(titleDone - 380), 0.38, { gain: 0.13, tone: P.note(52), f0: 1800, f1: 6500 });
        P.impact(T(titleDone), { size: 0.95, bright: true, wet: 0.5 });
        P.stab(T(titleDone), STAB, { gain: 0.16, dur: 3, open: 3200 });
        rumble(P, T(titleDone + 50), 2.2, 0.16, 0);
      }

      /* ---- the words burn: a gamma hum, a dark pad, a heartbeat on every pulse of the glow ---- */
      const hold0 = Math.max(titleDone, smash) + 400;
      const holdEnd = leaveAt + 900;
      P.hum(T(hold0), secs(hold0, holdEnd, 2), { f: 82.41, gain: 0.026, lp: 700, a: 1.2, r: 1.4 });
      P.pad(T(hold0 + 400), secs(hold0 + 400, leaveAt, 2), PAD, { gain: 0.032, lp: 900, a: 2, r: 1.8 });
      for (let tb = 1000 + beat / 4; tb < strikesEnd; tb += beat) {
        if (tb < titleDone + 700 || Math.abs(tb - mid) < 300) continue;
        const k = tb > mid ? 0.8 : 1;
        P.punch(T(tb), { gain: 0.14 * k, f0: 85, f1: 32 });
        P.noise(T(tb + 20), 1.2, { type: 'bandpass', f0: 900, f1: 260, q: 1.2, gain: 0.05 * k, a: 0.06, r: 1.1, wet: 0.55 });
      }

      /* ---- the end: each letter shorts out, left to right, and the power winds down ---- */
      leaves.forEach((l) => {
        const pan = px(l.x);
        P.noise(T(l.at), 0.2, { type: 'highpass', f0: 2600, f1: 5200, q: 0.7, gain: 0.13, a: 0.001, r: 0.19, pan: pan, wet: 0.4 });
        zap(P, T(l.at), 0.28, 0.055, pan, 140 + P.rand() * 30);
      });
      if (leaves.length) {
        P.powerDown(T(leaveAt - 100), 2.2, { f0: 330, f1: 30, gain: 0.12 });
        P.crackle(T(leaveAt + 200), 1.4, 4, { gain: 0.09 });
        // the last letter out: the storm spent, a low breath of it left in the hall
        let out = leaveAt;
        for (const l of leaves) out = Math.max(out, l.at);
        P.sub(T(out + 40), { gain: 0.09, f0: 62, f1: 30, dur: 1.8 });
        P.noise(T(out + 40), 1.6, { type: 'lowpass', f0: 700, f1: 90, q: 0.6, gain: 0.06, a: 0.01, r: 1.55, wet: 0.75 });
        P.tone(T(out + 60), 2.6, { type: 'sawtooth', f0: P.note(28), gain: 0.022, a: 0.08, r: 2.5, lp: 600, lp1: 120, q: 0.8, wet: 0.75 });
      }
    }
  });
})();
