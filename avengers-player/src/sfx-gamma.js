/*!
 * Avengers Player: the sound of 'gamma', GROUND ZERO (see fx-gamma.js for the picture). Stone, mass
 * and pressure: something colossal lands unseen, and everything heard is rock.
 *
 *   0.0 s    IMPACT, the biggest single hit: a body thump and the knock of stone, the mid crunch of
 *            rock breaking and the ground itself giving way, a bright crack of stone to both sides,
 *            a deep sub swelling in just behind it, the hall. As the camera is knocked the ground
 *            gives (a low whump); the berm is thrown up (a scatter of rock clatters while it rises),
 *            the shock of dust rolls outward to both edges, grit fans up, rock flies low past the
 *            lens to both sides, and the few large dark pieces that cross right in front of it go
 *            by with a short, close, fast whoosh each, to the side each leaves by (the plan's lens).
 *   0.3 s+   rocks landing: taps and clatters panned where each comes down, the big ones first and
 *            with a low knock of their own, the small ones only in the gaps (the ones under a big
 *            hit and the ones too close to a bigger one are left out).
 *   0.33-1.43 the year: per digit a grinding rise (rock on rock in three surges and two stalls, as
 *            it is seen, over a low rumble of strain that climbs), a breath while it hangs, and a
 *            heavy landing (thud with a sub, the knock and crunch of stone, a ring of dust), panned
 *            to the digit; each a clear step heavier than the one before and out of the way before
 *            the next comes down; the last the heaviest: the ground answers it with a rumble.
 *   1.75-2.35 the title words: per word a short pull of air into a hard stone hit, panned to the
 *            word; the last is the hero hit (the plan's accent): a full stone hit, a low brass-like
 *            stab (root, fifth, octave: no tune), a sub, the dust front rolling out; it rings until
 *            the heartbeat starts.
 *   2.8-11 s the hold: a low gamma hum (a steady saw two octaves over the root, over it two saws
 *            beating slowly from side to side, a breath of noise that comes and goes; brighter
 *            after the second smash), a faint crackle of embers and grit, the HEARTBEAT on every
 *            beat (lub, dub: deep, each with a soft knock on its front, its weight following the
 *            plan's strengths, the last the strongest; from the third the berm rattles and breathes
 *            dust), a faint glassy shimmer crossing with each glint of light.
 *   6.0 s    SECOND SMASH: a hit, the block of letters heaved up (stone grinding upward over a
 *            rumble of strain), a short hush while it is in the air, the crash back (a heavy hit,
 *            rubble kicked up), a frame or two later the title coming down after it (a second, lighter,
 *            harder hit: the plan's titleLand) and the stone cracking open (a fracture crackle
 *            running through each letter for as long as its crack grows, panned where it cracks; a
 *            few last ticks after).
 *   10-11 s  the ground trembles: a rumble and a low tone rising, grit rattling faster and faster.
 *   11.0 s   FINAL POUND: a hit nearly as big as the first; the cracks blaze (a short hot sizzle);
 *            at 11.09 s the letters burst (a shatter, pieces cracking apart where the letters
 *            stand), the pieces come down in two heaps (a heavy clatter over a low rumble at each of
 *            the plan's pieceLands, panned where its dust rises), the berm collapses from its ends
 *            inward (a tumbling rumble closing in on the middle, a knock where each part gives), and
 *            at the plan's thud (12.12 s) the last of it settles: one low THUD, the button.
 *            Nothing dry sounds after everything is dark (exit.dark, 12.3 s): only the hall's tail.
 * Without a year the words punch in from 0.56 s and there are no digits.
 *
 * Only the impact at 0 is known in advance (the bed). Every other moment and position comes from
 * the animation's plan (fx-gamma.js, create(): impact, fissures, shockwaves, jets, debris,
 * lens, rockLands, digits, words, accent, beats, dust, sweeps, smash, tremble, exit, cool,
 * lastPulse, gone); a field that is missing, empty or not a number is simply not heard, and no voice starts
 * before the impact or sounds past the cut whatever the plan says. Original sound design made of
 * noise and oscillators: no samples, no melody or motif from any film, no voice or roar of any
 * creature (nothing in it shudders or growls: the strain of the stone is noise and a pure tone).
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S) return;

  const ROOT = 34.65;                     // C sharp 1: the stab and the hum sit on it
  const MAX_TAPS = 28;                    // rock landings heard at most
  const MAX_CRACKS = 10;
  const MAX_PIECES = 8;
  const MAX_LENS = 4;                     // rocks crossing close to the lens
  const MAX_HEAPS = 4;                    // heaps of pieces coming down
  const MAX_GIVES = 12;                   // parts of the berm giving way
  const LEVEL = 1.8;                      // the whole piece: set against the other styles' perceived level (see NOTES.md)
  // the balance of a stone hit: its weight is in the 150 Hz - 2 kHz body (what small speakers give), not only in the sub
  const KNOCK = 1.0, CRUNCH = 1.45, BREAK = 1.0, SUB = 0.34, TAIL = 0.5;
  // the sizes of the blows (the impact, in the bed, is 2.1: the biggest) and the levels of the hold
  const HERO = 1.15, SMASH = 1.05, HOP = 0.74, TITLE = 0.4, EXIT = 1.1, DIGIT = 0.9, DIGIT_STEP = 0.56;
  const LENS = 0.62;                       // a rock passing the lens
  const HUM = 0.026, BREATH = 0.055, BEAT = 0.073, BEAT_POW = 1.5;   // the chain's compressor flattens the beats: the plan's strengths are steepened to come out as planned

  let planned = false;                    // the plan is heard once per play (renderAt reports it again)

  const num = Number.isFinite;            // not the global isFinite: that one takes null (a NaN after JSON) for 0
  const fin = (x, d) => (num(x) ? x : d);
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const arr = (a) => (Array.isArray(a) ? a.filter((v) => v && typeof v === 'object') : []);
  const obj = (o) => (o && typeof o === 'object' ? o : {});

  /** Stone struck (2 voices): a dry resonant tock and a bright crack of air. */
  function crackle(P, t, g, pan, f) {
    P.noise(t, 0.045, { type: 'bandpass', f0: f || 1500, q: 4.5, gain: g * 1.5, a: 0.0006, r: 0.042, pan: pan, wet: 0.3 });
    P.noise(t, 0.05, { type: 'highpass', f0: 2600, q: 0.6, gain: g, a: 0.0008, r: 0.046, pan: pan, wet: 0.35 });
  }

  /** A rock knocking on rock (1 voice): the bigger, the lower and longer. */
  function tap(P, t, g, pan, f, len, wet) {
    P.noise(t, len || 0.04, { type: 'bandpass', f0: f, q: 3 + P.rand() * 3, gain: g, a: 0.0006, r: (len || 0.04) - 0.001, pan: pan, wet: wet == null ? 0.3 : wet });
  }

  /** A heavy stone hit (8 voices): crack (2), thump, the knock of its body, crunch of breaking rock (2), sub, the ground's tail.
   *  o: { pan, tail (s), crunch (s), wet, sub, subDur, subA (the sub's attack, s), punch (share of the thump), crack (share of the crack and the breaking) } */
  function hit(P, t, s, o) {
    o = o || {};
    const pan = o.pan;
    const ck = o.crack == null ? 1 : o.crack;
    crackle(P, t, 0.5 * s * ck, pan, 1300);
    P.punch(t, { gain: 0.6 * s * (o.punch == null ? 1 : o.punch), f0: 128, f1: 40, pan: pan });
    P.noise(t, 0.16, { type: 'bandpass', f0: 360, f1: 150, q: 1.1, gain: KNOCK * s, a: 0.0015, r: 0.155, pan: pan, wet: 0.3 });           // the body of the stone
    P.noise(t, o.crunch || 0.7, { type: 'bandpass', f0: 950, f1: 170, glide: 0.32, q: 0.7, gain: CRUNCH * s, a: 0.002, r: (o.crunch || 0.7) - 0.02, pan: pan, wet: o.wet == null ? 0.45 : o.wet });
    P.noise(t, 0.3, { type: 'bandpass', f0: 2600, f1: 700, glide: 0.15, q: 0.6, gain: BREAK * s * ck, a: 0.001, r: 0.29, pan: pan, wet: 0.4 });   // the rock breaking
    const sd = o.subDur || (0.9 + 0.8 * s);
    const sa = o.subA || 0.004;                            // a sub that swells in a little late leaves the first instant to the stone
    P.tone(t, sd, { f0: 58, f1: 25, glide: sd * 0.55, gain: (o.sub == null ? SUB : o.sub) * s, a: sa, r: sd - sa - 0.006, drive: 2.2, wet: 0.05 });
    const tail = o.tail == null ? 1.3 + s : o.tail;
    if (tail > 0) P.noise(t + 0.02, tail, { type: 'lowpass', f0: 520, f1: 80, q: 0.5, gain: TAIL * s, a: 0.03, r: tail - 0.04, pan: pan, wet: 0.65 });
  }

  /** The library, bounded and levelled: no voice starts before t0 or sounds past t1 (it is shortened, or left
   *  out); a time that is not a number makes no voice; every gain is scaled by LEVEL (the whole piece's level
   *  under the film). Whatever the plan says, nothing dry outlives the cut. */
  function within(P, t0, t1) {
    const fit = (t, dur, o, def) => {
      if (!num(t) || !num(dur)) return null;
      let d = dur;
      if (t < t0) { d -= t0 - t; t = t0; }
      if (t + d > t1) d = t1 - t;
      if (!(d > 0) || (d < dur && d < 0.03)) return null;
      o = Object.assign({}, o);
      o.gain = (o.gain == null ? def : o.gain) * LEVEL;
      if (d < dur) {
        const k = d / dur;
        if (o.a != null) o.a *= k;
        if (o.r != null) o.r *= k;
        if (o.glide != null) o.glide = Math.min(o.glide, d);
        if (o.lpGlide != null) o.lpGlide = Math.min(o.lpGlide, d);
      }
      return { t: t, d: d, o: o };
    };
    return {
      rand: P.rand,
      pan: P.pan,
      noise(t, dur, o) { const f = fit(t, dur, o, 0.2); if (f) P.noise(f.t, f.d, f.o); },
      tone(t, dur, o) { const f = fit(t, dur, o, 0.15); if (f) P.tone(f.t, f.d, f.o); },
      sub(t, o) { const f = fit(t, (o && o.dur) || 1.8, o, 0.6); if (f) { f.o.dur = f.d; P.sub(f.t, f.o); } },
      punch(t, o) {
        const f = fit(t, (o && o.dur) || 0.42, o, 0.7);
        if (!f) return;
        if (f.d >= 0.42) P.punch(f.t, f.o);
        else P.tone(f.t, f.d, { f0: f.o.f0 || 150, f1: f.o.f1 || 46, glide: Math.min(0.11, f.d * 0.5), gain: f.o.gain, a: 0.002, r: f.d - 0.004, drive: 3, pan: f.o.pan, wet: 0.12 });
      },
      braam(t, o) { const f = fit(t, ((o && o.dur) || 2.6) + 0.25, o, 0.22); if (f && f.d > 0.55) { f.o.dur = f.d - 0.25; P.braam(f.t, f.o); } }
    };
  }

  /** Rubble thrown about (n voices): rock clatters scattered over dur, thinning out. */
  function scatter(P, t, dur, n, g, pan, spread) {
    for (let i = 0; i < n; i++) {
      const u = P.rand();
      const size = P.rand();
      tap(P, t + u * u * dur, g * (0.5 + 0.5 * size) * (1 - 0.5 * u), clamp((pan || 0) + (P.rand() - 0.5) * (spread || 1.4), -0.9, 0.9), 2600 - size * 1900 + P.rand() * 300, 0.03 + size * 0.035);
    }
  }

  /** The dust front running along the ground from the middle to both edges (2 voices). */
  function shock(P, t, dur, g) {
    [-1, 1].forEach((s) => P.noise(t, dur, { type: 'lowpass', f0: 520, f1: 140, q: 0.6, gain: g * 2.4, a: 0.03, r: dur - 0.04, pan: s * 0.1, pan1: s * 0.9, wet: 0.5 }));
  }

  /** Stone dragged on stone between two moments (1 voice). */
  function grind(P, t, len, g, pan, f0, f1) {
    P.noise(t, len, { type: 'bandpass', f0: f0, f1: f1, q: 1.3, gain: g * 3.6, a: len * 0.3, r: len * 0.55, pan: pan, wet: 0.25 });
  }

  /** The strain of a great weight moving (1 voice, 2 if deep): the ground's low rumble rising, a pure low tone under it.
   *  Rock under load: noise and a sine, nothing that shudders like a throat. */
  function strain(P, t, len, g, pan, f0, f1, deep) {
    P.noise(t, len, { type: 'bandpass', f0: f0 * 3.2, f1: f1 * 3.6, q: 2.2, gain: g * 5, a: len * 0.35, r: len * 0.3, pan: pan, wet: 0.3 });
    if (deep) P.tone(t, len, { f0: f0, f1: f1, gain: g * 0.9, a: len * 0.35, r: len * 0.3, pan: pan, wet: 0.2 });
  }

  S.define('gamma', {
    bed(T, w, P0) {
      planned = false;
      const P = within(P0, T(0), T(600000));
      /* ---- 0 s: the impact (the one moment known in advance; the plan adds what it throws up) ---- */
      hit(P, T(0), 2.1, { tail: 2.6, subA: 0.06, punch: 1.15, sub: 0.3 });
      P.noise(T(0), 0.07, { type: 'highpass', f0: 3400, q: 0.6, gain: 0.62, a: 0.0008, r: 0.066, pan: -0.5, wet: 0.5 });   // the crack of stone, wide
      P.noise(T(5), 0.07, { type: 'highpass', f0: 2900, q: 0.6, gain: 0.56, a: 0.0008, r: 0.066, pan: 0.5, wet: 0.5 });
      P.noise(T(0), 0.34, { type: 'bandpass', f0: 1500, f1: 260, glide: 0.2, q: 0.8, gain: 1.6, a: 0.001, r: 0.335, wet: 0.5 });   // the ground itself breaking: only here
      P.tone(T(0), 0.9, { type: 'sawtooth', f0: ROOT * 2, f1: ROOT, glide: 0.4, gain: 0.3, a: 0.003, r: 0.88, lp: 1500, lp1: 180, lpGlide: 0.45, q: 0.8, drive: 3, wet: 0.4 });   // the body
    },

    cue(name, T, d, P0, w) {
      if (name !== 'plan' || planned || !d || typeof d !== 'object') return;
      planned = true;
      const exit = obj(d.exit);
      const end = d.gone > 0 && num(d.gone) ? d.gone : (d.duration > 0 && num(d.duration) ? d.duration : 12500);
      const gone = exit.dark > 0 && num(exit.dark) ? Math.min(end, exit.dark) : end;   // everything dark: the cut
      const P = within(P0, T(0), T(gone));                   // nothing before the impact, nothing dry after the cut
      const px = (x) => P.pan(0.5 + (fin(x, 0.5) - 0.5) * 1.3);

      const impact = obj(d.impact);
      const smash = obj(d.smash);
      const tremble = obj(d.tremble);
      const accent = obj(d.accent);
      const digits = arr(d.digits).filter((g) => num(g.land)).sort((a, b) => a.land - b.land);
      const words = arr(d.words).filter((x) => num(x.land));
      const beats = arr(d.beats).filter((b) => num(b.t));
      const dust = arr(d.dust).filter((x) => num(x.t));
      const tImpact = fin(impact.t, 0);
      const tSmash = fin(smash.t, NaN);
      const tHop = fin(smash.hopLand, NaN);
      const tExit = fin(exit.t, NaN);
      const tBurst = fin(exit.burst, num(tExit) ? tExit + fin(exit.blaze, 90) : NaN);
      const tAccent = num(accent.t) ? accent.t : (words.length ? words[words.length - 1].land : NaN);
      // the title comes down a frame or two after the year (only where the plan cracks letters at that moment:
      // without a year the title lands at hopLand and there is no second hit)
      const cracks = arr(smash.cracks);
      const tTitle0 = fin(smash.titleLand, NaN);
      const titleCr = num(tTitle0) ? cracks.filter((c) => num(c.t) && Math.abs(c.t - tTitle0) < 8) : [];
      const tTitle = num(tHop) && tTitle0 > tHop + 5 && tTitle0 < tHop + 150 && (titleCr.length || (!cracks.some((c) => num(c.t)) && digits.length)) ? tTitle0 : NaN;
      // the pieces' landings and the last thud, as the picture has them
      const heaps = num(tExit) ? (Array.isArray(exit.pieceLands) ? exit.pieceLands : []).filter((t) => num(t) && t > tExit && t < gone - 80).slice(0, MAX_HEAPS) : [];

      // the great blows (rock landing under one of them is not heard on its own)
      const big = [tImpact, tAccent, tSmash, tHop, tTitle, tExit, tBurst].concat(heaps).filter(num);
      digits.forEach((g) => big.push(g.land));
      words.forEach((x) => big.push(x.land));
      const soft = [];                                       // the heartbeat: low and soft, it hides a landing only right on it
      beats.forEach((b) => { soft.push(b.t); soft.push(fin(b.dub, b.t + 230)); });
      const masked = (t, size) => big.some((b) => t > b - 25 && t < b + (size > 1 ? 60 : 110)) || soft.some((b) => t > b - 15 && t < b + 45);   // a big rock is heard sooner after a blow

      /* ---- the impact: what it throws up ---- */
      const knock = fin(impact.knock, NaN);
      if (num(knock)) P.noise(T(knock), 0.5, { type: 'lowpass', f0: 300, f1: 70, q: 0.9, gain: 0.3, a: 0.008, r: 0.49, wet: 0.4 });   // the ground gives
      const fis = obj(d.fissures);
      if (num(fis.t)) scatter(P, T(fis.t + 40), Math.max(0.15, fin(fis.dur, 300) / 1000) + 0.25, 7, 0.5, px(impact.x), 1.5);

      /* ---- the dust front along the ground, the fans of grit, rock flying low past the lens ---- */
      arr(d.shockwaves).forEach((s) => {
        if (!num(s.t)) return;
        const first = Math.abs(s.t - tImpact) < 40;
        shock(P, T(s.t + 15), fin(s.dur, 260) / 1000 + (first ? 1.5 : 0.8), first ? 0.26 : 0.15);
      });
      (Array.isArray(d.jets) ? d.jets : []).forEach((t) => {
        if (!num(t)) return;
        P.noise(T(t + 20), 0.4, { type: 'highpass', f0: 2600, f1: 6200, q: 0.5, gain: 0.11, a: 0.02, r: 0.36, wet: 0.4 });
      });
      const fly = new Map();                                 // per blow and side: the rocks that pass the lens
      arr(d.debris).forEach((r) => {
        if (!num(r.t)) return;
        const k = Math.round(r.t / 400) + (r.dir > 0 ? 'R' : 'L');
        const f = fly.get(k) || { t: r.t, n: 0, dir: r.dir > 0 ? 1 : -1 };
        f.t = Math.min(f.t, r.t); f.n++;
        fly.set(k, f);
      });
      for (const f of fly.values()) {
        P.noise(T(f.t), 0.5, { type: 'bandpass', f0: 280, f1: 1100, q: 1.2, gain: 0.2 + 0.03 * Math.min(8, f.n), a: 0.2, r: 0.28, pan: f.dir * 0.15, pan1: f.dir * 0.95, wet: 0.25 });
      }

      /* ---- rocks landing: sparse taps and clatters where they come down; the big ones first ---- */
      const lands = arr(d.rockLands).concat(arr(d.rubbleLands)).filter((r) => num(r.t) && !masked(r.t, r.size))
        .map((r) => ({ t: r.t, x: r.x, size: clamp(fin(r.size, 0.5), 0.2, 2), j: 0.7 + 0.6 * P.rand() }))
        .sort((a, b) => b.size - a.size || a.t - b.t);
      let gap = 45;                                          // (the picture has few of them now: nearly every one is heard)
      let kept = [];
      for (let pass = 0; pass < 8; pass++) {
        kept = [];
        for (const r of lands) if (kept.every((k) => Math.abs(k.t - r.t) >= gap * r.j)) kept.push(r);    // a big one keeps its place; smaller ones fill the gaps
        if (kept.length <= MAX_TAPS) break;
        gap *= 1.4;
      }
      kept.slice(0, MAX_TAPS).forEach((r) => {
        const size = r.size;
        const pan = px(r.x);
        const f = (2300 / Math.pow(size + 0.35, 0.8)) * (0.8 + 0.45 * P.rand());
        const g = 0.22 + 0.17 * Math.min(1.9, size);
        tap(P, T(r.t), g, pan, f, 0.028 + 0.022 * size);
        if (size > 1) P.tone(T(r.t), 0.09, { f0: 180, f1: 80, gain: g * 0.5, a: 0.001, r: 0.088, pan: pan, wet: 0.2 });      // a big one: its weight
        else if (P.rand() < 0.3) tap(P, T(r.t + 30 + P.rand() * 45), g * 0.5, pan + (P.rand() - 0.5) * 0.2, f * 1.35, 0.025);   // it bounces once
      });

      /* ---- the year: each digit grinds up, hangs, lands; each a good step heavier than the last ---- */
      digits.forEach((g, j) => {
        const pan = px(g.x);
        const n = digits.length;
        const k = n > 1 ? j / (n - 1) : 1;
        const last = j === n - 1;
        const rise = fin(g.rise, g.land - 500);
        const hang = Math.max(rise + 60, fin(g.hang, g.land - 190));
        const len = (hang - rise) / 1000;
        // the landing: each a clear step heavier (the chain's compressor takes two thirds of a step: they are
        // made 6 dB apart to be heard about 2 to 3 dB apart), and each out of the way before the next comes down
        const s = Math.max(0.1, DIGIT * Math.pow(DIGIT_STEP, n - 1 - j));
        const gr = 0.11 * Math.sqrt(s / DIGIT);                // its grinding grows with it, and stays under the landing beside it
        // three surges, two stalls (fx-gamma.js, grind()): rock on rock, higher each surge
        [[0, 0.2], [0.36, 0.54], [0.7, 1]].forEach((sg, q) => {
          const t0 = rise + sg[0] * (hang - rise);
          const l = (sg[1] - sg[0]) * len;
          grind(P, T(t0), l + 0.02, gr * (1 + 0.35 * q), pan, 300 + q * 130, 520 + q * 190);
          if (q) tap(P, T(t0 + 4), gr * (2 + 0.6 * q), pan + (P.rand() - 0.5) * 0.2, 900 + P.rand() * 900, 0.03);       // the rock in the way gives
        });
        strain(P, T(rise), len, 0.7 * gr, pan, 40 - 5 * k, 60 - 6 * k);
        // (the hang and the drop: a breath, nothing)
        const t = g.land;
        const room = last ? 9 : Math.max(0.1, (digits[j + 1].land - t) / 1000 - 0.015);
        crackle(P, T(t), 0.62 * s, pan, 1250 - 250 * k);
        P.punch(T(t), { gain: 0.62 * s, f0: 126 - 22 * k, f1: 42 - 6 * k, pan: pan, dur: Math.min(0.42, room) });
        P.noise(T(t), 0.14, { type: 'bandpass', f0: 380 - 60 * k, f1: 150, q: 1.1, gain: 1.1 * s, a: 0.0015, r: 0.135, pan: pan, wet: 0.3 });
        const cl = Math.min(0.5, Math.max(0.14, room));
        P.noise(T(t), cl, { type: 'bandpass', f0: 820 - 180 * k, f1: 170, glide: Math.min(0.25, cl), q: 0.75, gain: 1.7 * s, a: 0.002, r: cl - 0.02, pan: pan, wet: 0.4 });
        P.sub(T(t), { gain: 0.42 * s, f0: 60 - 6 * k, f1: 27, dur: last ? 1.9 : Math.min(0.7 + 0.5 * k, room) });
        P.noise(T(t + 25), 0.55, { type: 'bandpass', f0: 1500, f1: 520, q: 0.6, gain: 0.34 * s, a: 0.07, r: 0.47, pan: pan, wet: 0.4 });   // the ring of dust
        if (last) {                                            // the heaviest: the ground answers it
          P.noise(T(t), 0.28, { type: 'bandpass', f0: 1300, f1: 300, glide: 0.18, q: 0.8, gain: 1.0 * s, a: 0.001, r: 0.275, wet: 0.45 });
          P.noise(T(t), 1.6, { type: 'lowpass', f0: 560, f1: 70, q: 0.5, gain: 0.42 * s, a: 0.012, r: 1.58, pan: pan * 0.5, wet: 0.65 });
        }
      });

      /* ---- the title: each word a pull of air into a hard hit; the hero hit with a low stab ---- */
      let hero = -1;
      words.forEach((x, i) => { if (num(tAccent) && Math.abs(x.land - tAccent) < 25) hero = i; });
      words.forEach((x, i) => {
        const pan = px(x.x);
        const t = x.land;
        const pull = Math.max(40, fin(x.punch, 85)) / 1000 + (i === hero ? 0.22 : 0.07);
        P.noise(T(t) - pull, pull, { type: 'bandpass', f0: 500, f1: 2600, q: 1.1, gain: i === hero ? 0.34 : 0.26, a: pull * 0.96, r: 0.012, pan: pan, wet: 0.2 });
        if (i === hero) return;
        const s = 0.55 + 0.07 * i;
        crackle(P, T(t), 0.7 * s, pan, 1700);
        P.punch(T(t), { gain: 0.55 * s, f0: 150, f1: 48, pan: pan });
        P.noise(T(t), 0.14, { type: 'bandpass', f0: 420, f1: 170, q: 1.1, gain: 1.0 * s, a: 0.0015, r: 0.135, pan: pan, wet: 0.3 });
        P.noise(T(t), 0.38, { type: 'bandpass', f0: 1100, f1: 240, glide: 0.2, q: 0.8, gain: 1.9 * s, a: 0.002, r: 0.37, pan: pan, wet: 0.45 });
      });
      if (num(tAccent)) {
        const pan = hero >= 0 ? px(words[hero].x) * 0.6 : px(accent.x);
        // it rings until the heartbeat starts (short when the first beat is close, so that beat is not coloured)
        let room = 2.2;
        beats.forEach((b) => { if (b.t > tAccent) room = Math.min(room, (b.t - tAccent) / 1000); });
        hit(P, T(tAccent), HERO, { pan: pan, tail: clamp(room * 0.9, 0.9, 2.4), wet: 0.5, subDur: clamp(room * 0.6, 0.8, 1.3) });
        P.braam(T(tAccent), { root: ROOT, notes: [1, 1.5, 2], dur: clamp(room * 0.7, 0.9, 1.6), gain: 0.3, open: 1900, wet: 0.5 });
      }

      /* ---- the hold: the gamma hum, embers and grit, the heartbeat, the glints ---- */
      const holdEnd = num(tExit) ? tExit : gone - 800;
      const hold0 = Math.min(holdEnd - 1000, (num(tAccent) ? tAccent : tImpact) + 450);
      const holdMid = num(tHop) && tHop > hold0 && tHop < holdEnd ? tHop : NaN;
      if (holdEnd - hold0 > 800) {
        const len = (holdEnd - hold0) / 1000;
        // a steady saw two octaves over the root (above the heartbeat's band, and steady, so the beats are not
        // coloured by it), and over it two saws a third of a hertz apart, one to each side: the hum swells and
        // sinks by itself where small speakers still give it
        P.tone(T(hold0), len, { type: 'sawtooth', f0: ROOT * 4, gain: HUM * 0.7, a: 0.4, r: 0.12, lp: 640, q: 0.7, drive: 1.5, wet: 0.3 });
        P.tone(T(hold0), len, { type: 'sawtooth', f0: ROOT * 8, gain: HUM * 0.6, a: 0.5, r: 0.12, lp: 900, q: 0.7, drive: 1.5, pan: -0.7, wet: 0.35 });
        P.tone(T(hold0), len, { type: 'sawtooth', f0: ROOT * 8 + 0.31, gain: HUM * 0.6, a: 0.5, r: 0.12, lp: 900, q: 0.7, drive: 1.5, pan: 0.7, wet: 0.35 });
        P.tone(T(hold0), len, { type: 'sine', f0: ROOT * 2, gain: HUM * 0.4, a: 0.6, r: 0.12, wet: 0.2 });       // its depth
        if (num(holdMid) && holdEnd - holdMid > 700) {         // the pit brighter after the second smash
          const l2 = (holdEnd - holdMid) / 1000;
          P.tone(T(holdMid + 300), l2 - 0.2, { type: 'sawtooth', f0: ROOT * 12 + 0.43, gain: HUM * 0.5, a: l2 * 0.6, r: 0.12, lp: 1300, q: 1.2, drive: 1.5, wet: 0.4 });
        }
        // the breath: a band of noise coming and going
        const nb = Math.max(1, Math.round(len / 2.4));
        for (let i = 0; i < nb; i++) {
          const bl = len / nb;
          P.noise(T(hold0) + i * bl, Math.min(bl + 0.3, len - i * bl), { type: 'bandpass', f0: 240, f1: 460, glide: bl * 0.5, q: 0.9, gain: BREATH * (1 + 0.5 * i / nb), a: bl * 0.5, r: bl * 0.5, pan: i % 2 ? 0.35 : -0.35, wet: 0.4 });
        }
        // embers and grit: a faint, irregular crackle
        const ne = Math.min(10, Math.round(len * 1.3));
        for (let i = 0; i < ne; i++) {
          P.noise(T(hold0) + (i + P.rand()) * len / ne, 0.006 + P.rand() * 0.016, { type: 'highpass', f0: 2200 + P.rand() * 4200, q: 0.8, gain: 0.04 + P.rand() * 0.06, a: 0.0005, r: 0.012, pan: (P.rand() - 0.5) * 1.5, wet: 0.25 });
        }
      }
      let top = 1;
      beats.forEach((b) => { top = Math.max(top, fin(b.strength, 1)); });
      beats.forEach((b, i) => {
        const k = fin(b.strength, 1);
        const strongest = k >= top - 1e-6 && beats.length > 1;
        const g = BEAT * Math.pow(Math.max(0.2, k), BEAT_POW) * (strongest ? 1.2 : 1);   // the strongest sounds under the tremble: a little more, to stay the strongest
        const dub = Math.max(b.t + 80, fin(b.dub, b.t + 230));
        // lub: the deep one, a knock on its front; dub: shorter and a little higher
        P.tone(T(b.t), 0.4, { f0: 92, f1: 36, glide: 0.1, gain: g, a: 0.003, r: 0.39, drive: 3, wet: 0.14 });
        P.noise(T(b.t), 0.11, { type: 'bandpass', f0: 250, q: 1.1, gain: g * 2.6, a: 0.003, r: 0.105, wet: 0.3 });
        P.tone(T(dub), 0.3, { f0: 104, f1: 44, glide: 0.08, gain: g * 0.66, a: 0.003, r: 0.29, drive: 3, wet: 0.14 });
        P.noise(T(dub), 0.08, { type: 'bandpass', f0: 320, q: 1.1, gain: g * 1.7, a: 0.003, r: 0.075, wet: 0.3 });
        if (strongest) P.sub(T(b.t), { gain: 0.16, f0: 62, f1: 30, dur: Math.min(0.5, (dub - b.t) / 1000 - 0.02) });   // the strongest: a sub that is gone before its dub
        // the berm shudders and breathes dust (where the plan kicks dust up on the beat)
        const du = dust.find((x) => Math.abs(x.t - b.t) < 30);
        if (du) {
          const p = clamp(fin(du.power, 0.5), 0.1, 1.5);
          P.noise(T(b.t + 15), 0.6, { type: 'bandpass', f0: 1300, f1: 420, q: 0.7, gain: 0.12 * p, a: 0.05, r: 0.54, pan: px(du.x), wet: 0.45 });
          tap(P, T(b.t + 20 + P.rand() * 40), 0.15 * p, (P.rand() - 0.5) * 1.2, 1100 + P.rand() * 900, 0.03);
          tap(P, T(dub + 10 + P.rand() * 40), 0.11 * p, (P.rand() - 0.5) * 1.2, 1500 + P.rand() * 900, 0.03);
        }
      });
      arr(d.sweeps).forEach((s) => {
        if (!num(s.t)) return;
        const len = Math.max(0.3, fin(s.dur, 900) / 1000);
        // a glint crossing the stone: glassy and faint, left to right
        P.noise(T(s.t), len, { type: 'highpass', f0: 6500, f1: 9000, q: 0.5, gain: 0.024, a: len * 0.45, r: len * 0.5, pan: -0.7, pan1: 0.7, wet: 0.6 });
        [3310, 4470].forEach((f, i) => P.tone(T(s.t + i * len * 250), len * 0.75, { f0: f, gain: 0.014 - i * 0.003, a: len * 0.25, r: len * 0.5, pan: -0.5 + i * 0.5, wet: 0.7 }));
      });

      /* ---- the second smash: the block heaved up, a hush, the crash back, the stone cracking open ---- */
      if (num(tSmash)) {
        const land = num(tHop) ? tHop : tSmash + 380;
        const air = Math.max(0.12, (land - tSmash) / 1000);
        hit(P, T(tSmash), SMASH, { pan: px(smash.x), tail: 0.5, wet: 0.3, subDur: Math.min(1.2, air) });
        const kn = fin(smash.knock, tSmash + 17);
        grind(P, T(kn), air * 0.55, 0.2, -0.25, 280, 900);     // stone grinding upward
        grind(P, T(kn + 20), air * 0.5, 0.16, 0.25, 420, 1300);
        strain(P, T(kn), air * 0.6, 0.13, 0, 42, 78, true);
        // (airborne: a hush)
        if (num(tHop)) {
          hit(P, T(tHop), HOP, { pan: px(smash.x), tail: 1.9, wet: 0.5, crack: 0.8 });
          scatter(P, T(tHop + 25), 0.45, 5, 0.42, 0, 1.5);
          // the title comes down after the year: a second hit, lighter and harder, where the title stands
          if (num(tTitle)) {
            let tx = 0, tn = 0;
            (titleCr.length ? titleCr : words).forEach((c) => { if (num(c.x)) { tx += c.x; tn++; } });
            const pan = px(tn ? tx / tn : smash.x);
            crackle(P, T(tTitle), 0.75 * TITLE, pan, 1750);
            P.punch(T(tTitle), { gain: 0.5 * TITLE, f0: 150, f1: 50, pan: pan });
            P.noise(T(tTitle), 0.13, { type: 'bandpass', f0: 440, f1: 180, q: 1.1, gain: 1.1 * TITLE, a: 0.0015, r: 0.125, pan: pan, wet: 0.3 });
            P.noise(T(tTitle), 0.3, { type: 'bandpass', f0: 1250, f1: 300, glide: 0.18, q: 0.8, gain: 1.6 * TITLE, a: 0.002, r: 0.29, pan: pan, wet: 0.45 });
          }
          // the fracture: each letter crackles for as long as its crack grows (the plan's dur), densest at its start;
          // one band of tearing stone under them all, and a few last ticks as the flash dies
          const step = Math.max(1, cracks.length / MAX_CRACKS);
          let c0 = Infinity, c1 = -Infinity;
          for (let q = 0; q < cracks.length; q += step) {
            const c = cracks[Math.floor(q)];
            const at = fin(c.t, tHop);
            const du = clamp(fin(c.dur, 90), 30, 800);
            c0 = Math.min(c0, at); c1 = Math.max(c1, at + du);
            const n = du > 300 ? 3 : 2;
            for (let k = 0; k < n; k++) {
              const u = (k + P.rand()) / n;
              P.noise(T(at + 5 + u * (du - 12)), 0.008 + P.rand() * 0.014, { type: 'bandpass', f0: 2400 + P.rand() * 3800, q: 2.5, gain: 0.45 * (1 - 0.5 * u), a: 0.0005, r: 0.014, pan: px(c.x), wet: 0.3 });
            }
          }
          if (c1 > c0) {
            const bl = (c1 - c0) / 1000 + 0.14;
            P.noise(T(c0 + 4), bl, { type: 'bandpass', f0: 1700, f1: 4600, q: 1.8, gain: 0.24, a: 0.004, r: 0.15, wet: 0.3 });
            for (let i = 0; i < 3; i++) {
              const c = cracks[Math.floor(P.rand() * cracks.length)];
              P.noise(T(c1 + 30 + (i + P.rand()) * 90), 0.008 + P.rand() * 0.012, { type: 'bandpass', f0: 2600 + P.rand() * 3400, q: 2.5, gain: 0.2 - 0.045 * i, a: 0.0005, r: 0.014, pan: px(c.x), wet: 0.35 });
            }
          }
        }
      }

      /* ---- the tremble: a rumble and a low tone rising to the pound, grit rattling ---- */
      if (num(tremble.t)) {
        const until = fin(tremble.until, num(tExit) ? tExit : tremble.t + 1000);
        const len = Math.max(0.2, (until - tremble.t) / 1000);
        [-1, 1].forEach((s) => P.noise(T(tremble.t), len, { type: 'lowpass', f0: 90, f1: 380, q: 0.9, gain: 0.17, a: len * 0.96, r: 0.03, pan: s * 0.6, wet: 0.3 }));
        P.tone(T(tremble.t), len, { type: 'sawtooth', f0: ROOT * 0.94, f1: ROOT * 1.5, gain: 0.09, a: len * 0.96, r: 0.03, drive: 3, lp: 180, lp1: 620, q: 0.9, wet: 0.3 });   // steady: it only climbs
        P.noise(T(tremble.t), len, { type: 'bandpass', f0: 170, f1: 360, q: 0.8, gain: 0.07, a: len * 0.35, r: 0.03, wet: 0.3 });   // ... there from the start, over the heartbeat's band
        P.noise(T(tremble.t), len, { type: 'bandpass', f0: 500, f1: 3200, q: 1.4, gain: 0.12, a: len * 0.96, r: 0.03, wet: 0.35 });
        for (let i = 0; i < 6; i++) {
          const u = Math.sqrt((i + P.rand()) / 6);            // faster and faster
          tap(P, T(tremble.t) + u * len * 0.97, 0.08 + 0.14 * u, (P.rand() - 0.5) * 1.6, 1200 + P.rand() * 1800, 0.025);
        }
      }

      /* ---- the final pound: the blaze, the burst, the pieces down, the berm down, the button ---- */
      if (num(tExit)) {
        // big, but the impact stays the biggest: less crack, a shorter crunch (the burst follows at once)
        hit(P, T(tExit), EXIT, { pan: px(exit.x), tail: 1.2, crunch: 0.22, wet: 0.45, subDur: 1.2, crack: 0.5, punch: 0.8 });
        P.noise(T(tExit), 0.07, { type: 'highpass', f0: 3200, q: 0.6, gain: 0.24, a: 0.0008, r: 0.066, pan: -0.5, wet: 0.45 });
        P.noise(T(tExit + 5), 0.07, { type: 'highpass', f0: 2800, q: 0.6, gain: 0.22, a: 0.0008, r: 0.066, pan: 0.5, wet: 0.45 });
        const kn = fin(exit.knock, NaN);
        if (num(kn)) P.noise(T(kn), 0.4, { type: 'lowpass', f0: 300, f1: 70, q: 0.9, gain: 0.26, a: 0.008, r: 0.39, wet: 0.35 });
        // the cracks blaze: hot, short
        const cool = fin(d.cool, fin(tBurst, tExit + 90) + 180);
        const bz = Math.max(0.08, (cool - tExit) / 1000);
        P.noise(T(tExit + 8), bz, { type: 'highpass', f0: 4200, f1: 7400, glide: bz * 0.5, q: 0.6, gain: 0.13, a: Math.min(0.06, bz * 0.3), r: bz * 0.6, wet: 0.3 });
        for (let i = 0; i < 4; i++) P.noise(T(tExit + 12) + P.rand() * bz * 0.8, 0.006 + P.rand() * 0.012, { type: 'highpass', f0: 3000 + P.rand() * 5000, q: 0.8, gain: 0.1 + P.rand() * 0.1, a: 0.0005, r: 0.01, pan: (P.rand() - 0.5) * 1.3, wet: 0.25 });

        if (num(tBurst)) {
          // the burst: a hard shatter
          crackle(P, T(tBurst), 0.38, 0, 2100);
          P.punch(T(tBurst), { gain: 0.26, f0: 170, f1: 55 });
          P.noise(T(tBurst), 0.5, { type: 'bandpass', f0: 2200, f1: 380, glide: 0.25, q: 0.7, gain: 0.5, a: 0.004, r: 0.48, wet: 0.4 });
          const sh = arr(exit.shatters);
          const step = Math.max(1, sh.length / MAX_PIECES);
          for (let q = 0; q < sh.length; q += step) {
            const c = sh[Math.floor(q)];
            const pan = px(c.x);
            const at = fin(c.breaks, tBurst);
            tap(P, T(at + 4 + P.rand() * 55), 0.28, pan, 1500 + P.rand() * 1600, 0.03);                   // it comes apart
            const fall = at + 330 + P.rand() * 330;                                                        // ... and its pieces come down (a plan without pieceLands)
            if (!heaps.length && fall < gone - 150) {
              tap(P, T(fall), 0.6 + P.rand() * 0.25, pan, 480 + P.rand() * 520, 0.07, 0.4);
              if (Math.floor(q) % 2 === 0) P.tone(T(fall), 0.1, { f0: 170, f1: 70, gain: 0.22, a: 0.001, r: 0.098, pan: pan, wet: 0.2 });
            }
          }
        }
        // the last settle: the plan's thud (lastPulse in a plan without it)
        const cr0 = fin(exit.crumble, NaN);
        const tb = fin(exit.thud, fin(d.lastPulse, num(cr0) ? fin(exit.crumbleEnd, cr0 + 700) + 100 : fin(tBurst, tExit) + 900));
        // the pieces come down in heaps: at each a heavy clatter over a short low rumble, where its dust rises
        const used = [];
        heaps.forEach((t, i) => {
          const du = dust.filter((x) => Math.abs(x.t - t) < 90 && !used.includes(x)).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
          if (du) used.push(du);
          const pan = px(du ? du.x : fin(exit.x, 0.5) + (i % 2 ? 0.12 : -0.12));
          const p = clamp(fin(du && du.power, 0.7), 0.4, 1.2);
          tap(P, T(t), 0.85 * p + 0.2, pan, 400 + P.rand() * 160, 0.08, 0.4);
          P.tone(T(t), 0.13, { f0: 165, f1: 66, gain: 0.34 * p + 0.06, a: 0.001, r: 0.128, pan: pan, wet: 0.2 });
          P.noise(T(t), 0.32, { type: 'lowpass', f0: 520, f1: 130, q: 0.7, gain: 0.5 * p + 0.1, a: 0.004, r: 0.31, pan: pan, wet: 0.4 });
          for (let k = 0; k < 3; k++) tap(P, T(t + 14 + (k + P.rand()) * 32), (0.55 - 0.1 * k) * (0.6 + 0.5 * p), clamp(pan + (P.rand() - 0.5) * 0.7, -0.9, 0.9), 520 + P.rand() * 620, 0.05, 0.4);
        });
        // the berm goes down, from its ends inward
        const c0 = cr0;
        if (num(c0)) {
          const c1 = Math.min(gone - 60, Math.max(c0 + 200, fin(exit.crumbleEnd, c0 + 700)));
          const len = Math.max(0.1, (c1 - c0) / 1000);
          [-1, 1].forEach((s) => P.noise(T(c0), len, { type: 'lowpass', f0: 620, f1: 130, q: 0.7, gain: 0.55, a: len * 0.25, r: len * 0.4, pan: s * 0.85, pan1: s * 0.12, wet: 0.35 }));
          // a knock where each part of it gives (the plan's dust along the berm; a plan without it: five, closing in)
          const gives = dust.filter((x) => !used.includes(x) && x.t >= c0 - 40 && x.t <= c1 && !(num(tb) && x.t > tb - 60)).slice(0, MAX_GIVES);
          if (gives.length >= 3) {
            gives.forEach((x) => tap(P, T(x.t), (0.3 + 0.2 * P.rand()) * clamp(fin(x.power, 0.6), 0.3, 1.2) / 0.6, px(x.x), 330 + P.rand() * 420, 0.06, 0.3));
          } else {
            for (let i = 0; i < 5; i++) {
              const u = (i + P.rand()) / 5;
              tap(P, T(c0) + u * len, 0.4 + 0.25 * P.rand(), (i % 2 ? 1 : -1) * 0.85 * (1 - u * 0.85), 330 + P.rand() * 420, 0.06, 0.3);
            }
          }
        }
        // the last piece settles: the button
        if (num(tb) && tb > tExit && tb < gone - 60) {
          const bl = 0.26;
          P.tone(T(tb), bl, { f0: 96, f1: 34, glide: 0.09, gain: 0.36, a: 0.002, r: bl - 0.003, drive: 3, wet: 0.3 });
          P.tone(T(tb), bl, { f0: 52, f1: 27, glide: 0.2, gain: 0.24, a: 0.004, r: bl - 0.005, drive: 2.2, wet: 0.1 });
          P.noise(T(tb), 0.2, { type: 'lowpass', f0: 520, f1: 130, q: 0.7, gain: 0.4, a: 0.002, r: 0.197, wet: 0.55 });
          tap(P, T(tb), 0.36, 0, 520, 0.05, 0.4);
        }
      }

      /* ---- the large dark pieces right in front of the lens: each a short, close, fast whoosh-by, out to its side ---- */
      arr(d.lens).filter((l) => num(l.t)).slice(0, MAX_LENS).forEach((l, i) => {
        const dir = l.dir > 0 ? 1 : l.dir < 0 ? -1 : (fin(l.x, 0.5) >= 0.5 ? 1 : -1);
        const from = clamp(px(l.x) * 0.45, -0.6, 0.6);
        const len = 0.17 + 0.03 * P.rand();
        const f = 520 + 160 * i + 200 * P.rand();
        P.noise(T(l.t), len, { type: 'bandpass', f0: f, f1: f * 3.4, glide: len * 0.6, q: 1.6, gain: LENS, a: len * 0.38, r: len * 0.5, pan: from, pan1: dir * 0.95, wet: 0.1 });   // the air it tears (close: dry)
        P.noise(T(l.t), len * 0.8, { type: 'lowpass', f0: 420, f1: 150, q: 0.8, gain: LENS * 0.7, a: len * 0.3, r: len * 0.45, pan: from, pan1: dir * 0.95, wet: 0.08 });        // its mass going by
      });
    }
  });
})();
