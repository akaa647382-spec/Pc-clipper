/*!
 * Avengers Player: the sound of the New Year animations (off by default: Display → Animation sound).
 *
 * Cinematic sound design made entirely with the Web Audio API: no sound files, nothing to licence,
 * nothing taken from any film. Everything is original.
 *
 *   voices ─┬─ dry ──────────────────────────┐
 *           └─ send → hall reverb (3.4 s) ───┤
 *                                            pre → glue compressor → limiter → out ─┬→ app volume → speakers
 *                                                                                   └→ the replay's mix (before the volume)
 *
 * The library (P, below) has the building blocks of trailer sound: layered impacts with a sub drop,
 * braams, risers that land on a hit, reverse swells, whooshes that fly across the stereo field,
 * thunder, electric crackle, fire, struck metal, a finger snap, HUD beeps, split-flap clacks,
 * typewriter keys, shimmer and dust, pads and stabs.
 *
 * Each animation's sound is a definition: define(id, { bed(T, w, P), cue(name, T, d, P, w) }).
 *   T(ms)  the audio time of a moment of the animation, in the animation's own milliseconds;
 *   w      the words { title, year };
 *   bed    is scheduled when the animation starts (what is known in advance);
 *   cue    is called when the animation reports a moment as it happens (fx.js: env.cue / its own
 *          rockets), so the sound lands on the frame whatever the screen size. d.t is the moment's
 *          time in the animation; a cue may also carry the times of moments to come (a plan).
 *
 * Starting a sound costs the frame almost nothing: only the voices due in the next moment are made
 * at once, the rest just ahead of their time (later()).
 *
 * window.APSfx = { prime(), play(style, { title, year, volume }), cue(name, d), stop(), setVolume(v),
 *                  mix(tracks) -> [MediaStreamTrack], styles(), render(style, w, secs, cues), define, count }
 */
(function (root) {
  'use strict';

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  let seed = 1;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  let ac = null;          // the AudioContext (prime() makes it before midnight)
  let ch = null;          // its chain: { pre, revIn, revOut, out, noise, curves }
  let master = null;      // the app's volume and mute (live only)
  let bus = null;         // the animation playing now: dry …
  let send = null;        // … and its reverb send (stop() fades both)
  let def = null;         // its definition
  let words = { title: '', year: '' };
  let ducked = false;     // the reverb was ducked by stop(): play() brings it back
  let queue = [];         // voices still to be made: [time, make], earliest first
  let pump = 0;
  let live = false;       // scheduling for live play (deferred) rather than an offline render
  let mixDest = null;
  let volume = 1;

  const DEFS = Object.create(null);

  /* ------------------------------------------------------------ the chain --- */

  /** A hall: decorrelated stereo noise, 18 ms pre-delay, early reflections, darker as it decays. */
  function makeIR(c, secs) {
    const sr = c.sampleRate;
    const n = Math.round(sr * secs);
    const b = c.createBuffer(2, n, sr);
    const keep = seed;
    seed = 0x5EED;
    const pd = Math.round(sr * 0.018);
    for (let k = 0; k < 2; k++) {
      const d = b.getChannelData(k);
      let y = 0;
      for (let i = pd; i < n; i++) {
        const tt = (i - pd) / sr;
        const bright = 0.72 * Math.exp(-tt * 1.7) + 0.05;
        y += bright * ((rand() * 2 - 1) - y);
        d[i] = y * Math.exp(-6.9 * tt / (secs * 0.82));
      }
      for (let r = 0; r < 9; r++) {
        const i = Math.round(sr * (0.008 + rand() * 0.075));
        d[i] += (rand() < 0.5 ? -1 : 1) * (0.55 - r * 0.045);
      }
    }
    seed = keep;
    return b;
  }

  function makeChain(c) {
    const pre = c.createGain();
    pre.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();         // glue
    comp.threshold.value = -20; comp.knee.value = 10; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.28;
    const lim = c.createDynamicsCompressor();          // no clipping, ever
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
    const make = c.createGain();
    make.gain.value = 1.1;
    // The last guard: a soft clipper, linear to 0.8 and bending smoothly to ±0.95 (a limiter alone
    // can overshoot by a fraction of a dB on a sudden hit).
    const clip = c.createWaveShaper();
    const cv = new Float32Array(2048);
    for (let i = 0; i < cv.length; i++) {
      const x = (i / (cv.length - 1)) * 2 - 1;
      const a = Math.abs(x);
      cv[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.15 * Math.tanh((a - 0.8) / 0.15));
    }
    clip.curve = cv;
    const out = c.createGain();
    pre.connect(comp); comp.connect(lim); lim.connect(make); make.connect(clip); clip.connect(out);
    const revIn = c.createGain();
    const rev = c.createConvolver();
    rev.buffer = makeIR(c, 3.4);
    const revOut = c.createGain();
    revOut.gain.value = 0.6;
    revIn.connect(rev); rev.connect(revOut); revOut.connect(pre);
    const noise = c.createBuffer(1, Math.round(c.sampleRate * 2), c.sampleRate);
    const keep = seed;
    seed = 7;
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    seed = keep;
    return { pre: pre, revIn: revIn, revOut: revOut, out: out, noise: noise, curves: Object.create(null) };
  }

  function ensure() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC({ latencyHint: 'interactive' }); } catch (e) { return null; }
      ch = makeChain(ac);
      master = ac.createGain();
      master.gain.value = volume;
      ch.out.connect(master);
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  /* ------------------------------------------------------- scheduling --- */

  // A definition schedules a whole animation (hundreds of voices). Making them all at once would
  // cost the frame that shows 00:00:00 several milliseconds.
  // In live play nothing is built in the calling frame at all: voices are queued, and those due soon
  // are built in the task right after it (soon), the rest a little ahead of their time (pump).
  const AHEAD = 0.45;
  let soon = 0;

  function later(t, make) {
    SFX.count++;
    if (!live) { make(); return; }
    let i = queue.length;
    while (i > 0 && queue[i - 1][0] > t) i--;
    queue.splice(i, 0, [t, make]);
    if (!soon) soon = setTimeout(() => { soon = 0; drain(); }, 0);
    if (!pump) pump = setInterval(drain, 60);
  }

  function drain() {
    if (!ac || !bus) queue = [];
    const until = ac ? ac.currentTime + AHEAD : 0;
    let n = 0;
    while (n < queue.length && queue[n][0] < until) n++;
    const due = queue.splice(0, n);
    for (const v of due) { try { v[1](); } catch (e) { /* one voice less */ } }
    if (!queue.length && pump) { clearInterval(pump); pump = 0; }
  }

  /* ------------------------------------------------------------ voices --- */

  /** Where a voice goes: a gain → panner → the dry bus, and its share to the reverb. */
  function dest(o) {
    const g = ac.createGain();
    let node = g;
    let pn = null;
    if (o.pan != null && ac.createStereoPanner) {
      pn = ac.createStereoPanner();
      pn.pan.value = clamp(o.pan, -1, 1);
      g.connect(pn);
      node = pn;
    }
    node.connect(bus);
    const wet = o.wet == null ? 0.22 : o.wet;
    if (wet > 0) { const s = ac.createGain(); s.gain.value = wet; node.connect(s); s.connect(send); }
    g.panner = pn;
    return g;
  }

  /** Attack to `peak` in a, hold, then fall over r (exponential, as sounds do). */
  function shape(p, t, peak, a, hold, r) {
    const pk = Math.max(1e-4, peak);
    p.setValueAtTime(1e-4, t);
    p.exponentialRampToValueAtTime(pk, t + Math.max(0.001, a));
    if (hold > 0) p.setValueAtTime(pk, t + a + hold);
    p.exponentialRampToValueAtTime(1e-4, t + a + Math.max(0, hold) + Math.max(0.004, r));
  }

  function curve(drive) {
    const k = Math.round(drive * 10) / 10;
    if (!ch.curves[k]) {
      const n = 1024;
      const c = new Float32Array(n);
      const norm = Math.tanh(k);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
      ch.curves[k] = c;
    }
    return ch.curves[k];
  }

  /** Filtered noise. o: { type, f0, f1, glide, q, gain, a, r, pan, pan1, wet } */
  function noise(t, dur, o) {
    later(t, () => {
      const s = ac.createBufferSource();
      s.buffer = ch.noise;
      s.loop = true;
      const f = ac.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.Q.value = o.q == null ? 0.9 : o.q;
      f.frequency.setValueAtTime(o.f0 || 1000, t);
      if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || dur));
      const g = ac.createGain();
      const a = o.a == null ? 0.005 : o.a;
      const r = o.r == null ? Math.max(0.01, dur - a) : o.r;
      shape(g.gain, t, o.gain == null ? 0.2 : o.gain, a, Math.max(0, dur - a - r), r);
      const d = dest(o);
      if (o.pan1 != null && d.panner) { d.panner.pan.setValueAtTime(clamp(o.pan || 0, -1, 1), t); d.panner.pan.linearRampToValueAtTime(clamp(o.pan1, -1, 1), t + dur); }
      s.connect(f); f.connect(g); g.connect(d);
      s.start(t, rand() * 1.9);
      s.stop(t + dur + 0.05);
    });
  }

  /** An oscillator. o: { type, f0, f1, glide, gain, a, r, lp, lp1, lpGlide, q, drive, detune, pan, pan1, wet, vib, vibHz } */
  function tone(t, dur, o) {
    later(t, () => {
      const x = ac.createOscillator();
      x.type = o.type || 'sine';
      x.frequency.setValueAtTime(o.f0 || 220, t);
      if (o.f1) x.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || dur));
      if (o.detune) x.detune.value = o.detune;
      let node = x;
      if (o.vib) {
        const l = ac.createOscillator(); l.frequency.value = o.vibHz || 5.5;
        const lg = ac.createGain(); lg.gain.value = o.vib;
        l.connect(lg); lg.connect(x.detune); l.start(t); l.stop(t + dur + 0.05);
      }
      if (o.drive) { const w = ac.createWaveShaper(); w.curve = curve(o.drive); w.oversample = '2x'; node.connect(w); node = w; }
      if (o.lp) {
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q == null ? 0.7 : o.q;
        f.frequency.setValueAtTime(o.lp, t);
        if (o.lp1) f.frequency.exponentialRampToValueAtTime(o.lp1, t + (o.lpGlide || dur));
        node.connect(f); node = f;
      }
      const g = ac.createGain();
      const a = o.a == null ? 0.004 : o.a;
      const r = o.r == null ? Math.max(0.01, dur - a) : o.r;
      shape(g.gain, t, o.gain == null ? 0.15 : o.gain, a, Math.max(0, dur - a - r), r);
      const d = dest(o);
      if (o.pan1 != null && d.panner) { d.panner.pan.setValueAtTime(clamp(o.pan || 0, -1, 1), t); d.panner.pan.linearRampToValueAtTime(clamp(o.pan1, -1, 1), t + dur); }
      node.connect(g); g.connect(d);
      x.start(t);
      x.stop(t + dur + 0.05);
    });
  }

  /* ----------------------------------------------------------- library --- */
  // Gains are linear; 1 is a full-size hit. Pan is -1 (left) .. 1 (right); x (0..1 across the
  // screen) converts with P.pan(x). wet is the share sent to the hall.

  const P = {
    noise: noise,
    tone: tone,
    rand: () => rand(),
    pan: (x) => clamp((x == null ? 0.5 : x) * 2 - 1, -0.85, 0.85),
    note: (m) => mtof(m),

    /** A sub drop: felt more than heard; saturated so laptop speakers still give its weight. */
    sub(t, o) {
      o = o || {};
      const dur = o.dur || 1.8;
      tone(t, dur, { f0: o.f0 || 62, f1: o.f1 || 27, glide: dur * 0.55, gain: o.gain == null ? 0.6 : o.gain, a: 0.004, r: dur - 0.01, drive: 2.2, wet: 0.05 });
    },

    /** The punch of a hit (a kick). */
    punch(t, o) {
      o = o || {};
      tone(t, 0.42, { f0: o.f0 || 150, f1: o.f1 || 46, glide: 0.11, gain: o.gain == null ? 0.7 : o.gain, a: 0.002, r: 0.4, drive: 3, pan: o.pan, wet: 0.12 });
    },

    /** The crack at the front of a hit. */
    transient(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.45 : o.gain;
      noise(t, 0.05, { type: 'highpass', f0: o.f || 2400, q: 0.6, gain: g, a: 0.0008, r: 0.045, pan: o.pan, wet: 0.3 });
      tone(t, 0.025, { type: 'square', f0: 2200, f1: 500, gain: g * 0.25, a: 0.0005, r: 0.022, pan: o.pan, wet: 0.2 });
    },

    /** A full cinematic impact: crack, punch, body, sub, and a big hall. o: { size (0.3..1.6), pan, metal, bright, wet } */
    impact(t, o) {
      o = o || {};
      const s = o.size == null ? 1 : o.size;
      const pan = o.pan;
      P.transient(t, { gain: 0.38 * s, pan: pan, f: o.bright ? 3600 : 2000 });
      P.punch(t, { gain: 0.62 * s, pan: pan });
      noise(t, 0.9, { type: 'bandpass', f0: 700, f1: 160, q: 0.8, gain: 0.32 * s, a: 0.002, r: 0.88, pan: pan, wet: o.wet == null ? 0.45 : o.wet });
      if (s > 0.55) P.sub(t, { gain: 0.5 * s, dur: 1.2 + s });
      if (o.metal) P.metal(t, { gain: 0.16 * s, base: o.metal === true ? 140 : o.metal, pan: pan, decay: 2.2, wet: 0.5 });
      noise(t + 0.02, 1.6 + s, { type: 'lowpass', f0: 380, f1: 70, q: 0.5, gain: 0.16 * s, a: 0.03, r: 1.5 + s, pan: pan, wet: 0.6 });
    },

    /** The trailer braam: detuned brass-like saws, the filter blowing open, driven, in the hall.
     *  o: { root (Hz), dur, gain, open (Hz), notes (multiples of root), wet } */
    braam(t, o) {
      o = o || {};
      const root = o.root || mtof(26);          // D1
      const dur = o.dur || 2.6;
      const g = o.gain == null ? 0.22 : o.gain;
      const notes = o.notes || [1, 2, 3, 4];
      notes.forEach((m, i) => {
        [-9, 0, 9].forEach((dt) => tone(t, dur, {
          type: 'sawtooth', f0: root * m, detune: dt + (rand() - 0.5) * 4, gain: g / (notes.length * 1.6) / (1 + i * 0.25),
          a: 0.05, r: dur * 0.55, lp: 160, lp1: o.open || 2400, lpGlide: 0.18, q: 1.6, drive: 1.8, pan: (dt / 9) * 0.5, wet: o.wet == null ? 0.5 : o.wet
        }));
      });
      // the filter settles back: a second, darker layer carrying the tail
      tone(t + 0.25, dur, { type: 'sawtooth', f0: root, gain: g * 0.35, a: 0.2, r: dur * 0.7, lp: 900, lp1: 180, q: 1.2, drive: 2, wet: 0.6 });
      P.sub(t, { gain: g * 1.6, f0: root * 2, f1: root, dur: dur });
    },

    /** A riser that lands at t + dur: noise sweeping up, a pitch climbing, a pulse speeding up. */
    riser(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.18 : o.gain;
      noise(t, dur, { type: 'bandpass', f0: o.f0 || 300, f1: o.f1 || 7000, q: 1.4, gain: g, a: dur * 0.92, r: 0.04, pan: o.pan, wet: 0.35 });
      later(t, () => {
        const x = ac.createOscillator();
        x.type = 'sawtooth';
        x.frequency.setValueAtTime(o.p0 || 110, t);
        x.frequency.exponentialRampToValueAtTime(o.p1 || 880, t + dur);
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(5000, t + dur);
        const amp = ac.createGain(); amp.gain.value = 0.5;
        const lfo = ac.createOscillator(); lfo.type = 'square';
        lfo.frequency.setValueAtTime(3, t); lfo.frequency.exponentialRampToValueAtTime(18, t + dur);
        const lg = ac.createGain(); lg.gain.value = 0.5;
        lfo.connect(lg); lg.connect(amp.gain);
        const env = ac.createGain();
        env.gain.setValueAtTime(1e-4, t);
        env.gain.exponentialRampToValueAtTime(g * 0.55, t + dur * 0.97);
        env.gain.exponentialRampToValueAtTime(1e-4, t + dur + 0.03);
        x.connect(f); f.connect(amp); amp.connect(env); env.connect(dest({ pan: o.pan, wet: 0.4 }));
        x.start(t); x.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
      });
    },

    /** A reverse swell (a cymbal played backwards) that cuts off at t + dur, the breath before a hit. */
    swell(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.16 : o.gain;
      noise(t, dur, { type: 'highpass', f0: o.f0 || 1800, f1: o.f1 || 5000, q: 0.5, gain: g, a: dur * 0.97, r: 0.015, pan: o.pan, wet: 0.3 });
      tone(t, dur, { type: 'sine', f0: o.tone || 220, f1: (o.tone || 220) * 2, gain: g * 0.25, a: dur * 0.95, r: 0.02, wet: 0.5 });
    },

    /** Air moving past: o: { gain, f0, f1, q, pan, pan1, wet } — pan → pan1 flies it across. */
    whoosh(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.5 : o.gain;
      const p0 = o.pan == null ? -0.6 : o.pan;
      const p1 = o.pan1 == null ? 0.6 : o.pan1;
      noise(t, dur, { type: 'bandpass', f0: o.f0 || 400, f1: o.f1 || 2400, q: o.q || 1.3, gain: g, a: dur * 0.62, r: dur * 0.38, pan: p0, pan1: p1, wet: o.wet == null ? 0.25 : o.wet });
      noise(t, dur, { type: 'lowpass', f0: 260, q: 0.5, gain: g * 0.6, a: dur * 0.6, r: dur * 0.4, pan: p0, pan1: p1, wet: 0.1 });
    },

    /** Thunder: a close crack, then rolling rumble for seconds. */
    thunder(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.7 : o.gain;
      const pan = o.pan || 0;
      for (let i = 0; i < 5; i++) noise(t + i * 0.012 + rand() * 0.02, 0.06, { type: 'highpass', f0: 1200 + rand() * 1500, q: 0.6, gain: g * (0.5 - i * 0.07), a: 0.0008, r: 0.055, pan: pan + (rand() - 0.5) * 0.3, wet: 0.5 });
      P.punch(t, { gain: g * 0.7, pan: pan, f0: 120, f1: 38 });
      P.sub(t, { gain: g * 0.55, f0: 55, f1: 24, dur: 3 });
      let tt = t + 0.08;
      for (let i = 0; i < 7; i++) {
        const d = 0.5 + rand() * 0.9;
        noise(tt, d, { type: 'lowpass', f0: 220 + rand() * 260, f1: 90, q: 0.6, gain: g * (0.42 - i * 0.045), a: 0.04 + rand() * 0.12, r: d * 0.7, pan: pan + (rand() - 0.5) * 0.8, wet: 0.65 });
        tt += 0.18 + rand() * 0.42;
      }
    },

    /** Electric arcing: hard buzz bursts and sparks. o: { dur, gain, pan, f } */
    zap(t, o) {
      o = o || {};
      const dur = o.dur || 0.35;
      const g = o.gain == null ? 0.3 : o.gain;
      tone(t, dur, { type: 'sawtooth', f0: o.f || 95, gain: g * 0.6, a: 0.002, r: dur * 0.8, drive: 6, lp: 3800, pan: o.pan, wet: 0.3 });
      tone(t, dur, { type: 'square', f0: (o.f || 95) * 1.5 + 3, gain: g * 0.25, a: 0.002, r: dur * 0.8, drive: 4, lp: 5200, pan: o.pan, wet: 0.3 });
      const n = Math.max(3, Math.round(dur * 60));
      for (let i = 0; i < n; i++) noise(t + rand() * dur, 0.008 + rand() * 0.02, { type: 'highpass', f0: 2500 + rand() * 5000, q: 0.7, gain: g * (0.4 + rand() * 0.6), a: 0.0006, r: 0.012, pan: (o.pan || 0) + (rand() - 0.5) * 0.5, wet: 0.25 });
    },

    /** A low electrical hum (a reactor, a field). */
    hum(t, dur, o) {
      o = o || {};
      const f = o.f || 55;
      const g = o.gain == null ? 0.1 : o.gain;
      tone(t, dur, { type: 'sawtooth', f0: f, gain: g, a: o.a || 0.3, r: o.r || 0.6, lp: o.lp || 500, drive: 1.5, wet: 0.3, vib: 6, vibHz: 0.4 });
      tone(t, dur, { type: 'sine', f0: f * 2.003, gain: g * 0.5, a: o.a || 0.3, r: o.r || 0.6, wet: 0.3 });
    },

    /** Charging up over dur: a whine and a body climbing. */
    powerUp(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.18 : o.gain;
      tone(t, dur, { type: 'sawtooth', f0: o.f0 || 55, f1: o.f1 || 330, gain: g, a: dur * 0.8, r: 0.06, lp: 300, lp1: 4000, q: 2, drive: 1.6, wet: 0.35 });
      tone(t, dur, { type: 'sine', f0: (o.f0 || 55) * 8, f1: (o.f1 || 330) * 8, gain: g * 0.25, a: dur * 0.9, r: 0.05, wet: 0.45 });
    },

    /** Powering down over dur. */
    powerDown(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.16 : o.gain;
      tone(t, dur, { type: 'sawtooth', f0: o.f0 || 300, f1: o.f1 || 35, gain: g, a: 0.01, r: dur * 0.95, lp: 3000, lp1: 200, q: 1.5, drive: 1.6, wet: 0.4 });
      tone(t, dur, { type: 'sine', f0: (o.f0 || 300) * 6, f1: (o.f1 || 35) * 6, gain: g * 0.2, a: 0.01, r: dur * 0.9, wet: 0.5 });
    },

    /** Fire: a roar with crackle. o: { gain, pan, rate } */
    fire(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.2 : o.gain;
      noise(t, dur, { type: 'lowpass', f0: 520, q: 0.7, gain: g, a: Math.min(0.6, dur * 0.3), r: Math.min(1.2, dur * 0.5), pan: o.pan, wet: 0.3 });
      noise(t, dur, { type: 'bandpass', f0: 1400, q: 0.6, gain: g * 0.35, a: Math.min(0.6, dur * 0.3), r: Math.min(1.2, dur * 0.5), pan: o.pan, wet: 0.3 });
      P.crackle(t, dur, o.rate || 26, { gain: g * 0.8, pan: o.pan });
    },

    /** Fire catching: a fast low whoomp. */
    whoomp(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.5 : o.gain;
      noise(t, 0.9, { type: 'lowpass', f0: 140, f1: 1600, glide: 0.18, q: 1.2, gain: g * 0.6, a: 0.05, r: 0.8, pan: o.pan, wet: 0.45 });
      P.sub(t + 0.03, { gain: g * 0.6, f0: 70, f1: 32, dur: 1.4 });
    },

    /** Sparks and embers popping. */
    crackle(t, dur, rate, o) {
      o = o || {};
      const n = Math.max(1, Math.round(dur * (rate || 30)));
      const g = o.gain == null ? 0.12 : o.gain;
      for (let i = 0; i < n; i++) noise(t + rand() * dur, 0.006 + rand() * 0.018, { type: 'highpass', f0: 1800 + rand() * 4500, q: 0.8, gain: g * (0.3 + rand() * 0.7), a: 0.0005, r: 0.01, pan: (o.pan || 0) + (rand() - 0.5) * 0.7, wet: 0.2 });
    },

    /** Struck metal: inharmonic modes ringing out. o: { gain, base, pan, decay, wet } */
    metal(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.2 : o.gain;
      const base = o.base || 220;
      const dec = o.decay || 1.4;
      [1, 2.32, 4.25, 6.63, 9.38, 12.1].forEach((m, i) => tone(t, dec / (1 + i * 0.35), { f0: base * m * (1 + (rand() - 0.5) * 0.004), gain: g / Math.pow(i + 1, 0.75), a: 0.001, r: dec / (1 + i * 0.35), pan: o.pan, wet: o.wet == null ? 0.35 : o.wet }));
      noise(t, 0.03, { type: 'bandpass', f0: Math.min(12000, base * 14), q: 1.2, gain: g * 0.9, a: 0.0005, r: 0.028, pan: o.pan, wet: 0.3 });
    },

    /** A hammer on an anvil: punch, bright ring, crack. */
    anvil(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.5 : o.gain;
      P.punch(t, { gain: g * 0.6, pan: o.pan, f0: 170, f1: 70 });
      P.metal(t, { gain: g * 0.45, base: o.base || 620, pan: o.pan, decay: 1.1, wet: 0.3 });
      P.transient(t, { gain: g * 0.5, pan: o.pan, f: 3200 });
    },

    /** Hot metal hissing (quenching, a torch). */
    sizzle(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.08 : o.gain;
      noise(t, dur, { type: 'highpass', f0: 3800, f1: 5200, q: 0.5, gain: g, a: 0.02, r: dur * 0.8, pan: o.pan, wet: 0.25 });
      P.crackle(t, dur, 30, { gain: g * 0.9, pan: o.pan });
    },

    /** Magic in the air: bell partials glittering. o: { gain, base } */
    shimmer(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.07 : o.gain;
      const base = o.base || 1046.5;
      const notes = [1, 1.25, 1.5, 2, 2.5, 3];
      const n = Math.round(dur * 14);
      for (let i = 0; i < n; i++) {
        const f = base * notes[(rand() * notes.length) | 0] * (rand() < 0.3 ? 2 : 1);
        tone(t + rand() * dur, 0.9, { f0: Math.min(16000, f), gain: g * (0.4 + rand() * 0.6), a: 0.004, r: 0.85, pan: (rand() - 0.5) * 1.4, wet: 0.7 });
      }
      noise(t, dur, { type: 'highpass', f0: 6000, q: 0.5, gain: g * 0.35, a: dur * 0.4, r: dur * 0.5, wet: 0.6 });
    },

    /** Grains of dust gathering (swell: true) or blowing away. o: { gain, pan, pan1, f0, f1, swell } */
    dust(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.22 : o.gain;
      noise(t, dur, { type: 'bandpass', f0: o.f0 || 2600, f1: o.f1 || 5200, q: 0.7, gain: g, a: o.swell ? dur * 0.7 : 0.05, r: o.swell ? dur * 0.3 : dur * 0.8, pan: o.pan == null ? 0 : o.pan, pan1: o.pan1, wet: 0.45 });
      const n = Math.round(dur * 90);
      for (let i = 0; i < n; i++) {
        const u = rand();
        const k = o.swell ? u * u : 1 - u * u;
        noise(t + u * dur, 0.004 + rand() * 0.01, { type: 'highpass', f0: 3000 + rand() * 6000, q: 0.6, gain: g * 0.7 * (0.3 + k * 0.7), a: 0.0004, r: 0.008, pan: (o.pan || 0) + (rand() - 0.5) * 1.2, wet: 0.35 });
      }
    },

    /** A finger snap: a sharp, woody click with a short body. */
    snap(t, o) {
      o = o || {};
      const g = o.gain == null ? 1 : o.gain;
      noise(t, 0.04, { type: 'bandpass', f0: 2300, q: 2.2, gain: g * 1.6, a: 0.0006, r: 0.038, pan: o.pan, wet: o.wet == null ? 0.35 : o.wet });
      noise(t, 0.015, { type: 'highpass', f0: 5000, q: 0.7, gain: g * 0.9, a: 0.0004, r: 0.014, pan: o.pan, wet: 0.2 });
      tone(t, 0.05, { f0: 1100, f1: 700, gain: g * 0.3, a: 0.0005, r: 0.045, pan: o.pan, wet: 0.3 });
    },

    /** A HUD beep. */
    beep(t, f, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.09 : o.gain;
      tone(t, dur, { type: 'sine', f0: f, gain: g, a: 0.002, r: dur * 0.5, pan: o.pan, wet: o.wet == null ? 0.15 : o.wet });
      tone(t, dur, { type: 'square', f0: f, gain: g * 0.12, a: 0.002, r: dur * 0.5, lp: f * 3, pan: o.pan, wet: 0.1 });
    },

    /** A target locked: two quick rising tones and a click. */
    lock(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.1 : o.gain;
      P.beep(t, 1568, 0.07, { gain: g * 0.8, pan: o.pan });
      P.beep(t + 0.075, 2093, 0.16, { gain: g, pan: o.pan });
      noise(t + 0.075, 0.01, { type: 'highpass', f0: 4000, gain: g * 0.8, a: 0.0005, r: 0.009, pan: o.pan, wet: 0.1 });
    },

    /** A servo moving. */
    servo(t, dur, o) {
      o = o || {};
      const g = o.gain == null ? 0.06 : o.gain;
      tone(t, dur, { type: 'sawtooth', f0: o.f0 || 180, f1: o.f1 || 320, gain: g, a: 0.02, r: 0.05, lp: 1400, q: 3, pan: o.pan, wet: 0.15 });
      noise(t, dur, { type: 'bandpass', f0: 2400, q: 3, gain: g * 0.4, a: 0.02, r: 0.05, pan: o.pan, wet: 0.1 });
    },

    /** A shot: crack, punch, and its echo off the buildings. */
    shot(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.4 : o.gain;
      P.transient(t, { gain: g * 0.7, pan: o.pan, f: 2800 });
      P.punch(t, { gain: g * 0.6, pan: o.pan, f0: 200, f1: 60 });
      noise(t + 0.01, 0.6, { type: 'lowpass', f0: 1800, f1: 300, q: 0.6, gain: g * 0.3, a: 0.004, r: 0.58, pan: o.pan, wet: 0.7 });
    },

    /** Flak bursting high up: a distant boom and falling crackle. */
    flak(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.35 : o.gain;
      P.punch(t, { gain: g * 0.55, pan: o.pan, f0: 110, f1: 40 });
      noise(t, 1.1, { type: 'lowpass', f0: 900, f1: 120, q: 0.6, gain: g * 0.35, a: 0.004, r: 1.05, pan: o.pan, wet: 0.75 });
      P.crackle(t + 0.15, 0.9, 30, { gain: g * 0.25, pan: o.pan });
    },

    /** A split-flap leaf falling. */
    clack(t, o) {
      o = o || {};
      const g = (o.gain == null ? 1 : o.gain) * 1.2;
      noise(t, 0.012, { type: 'bandpass', f0: 3200, q: 2.5, gain: g, a: 0.0004, r: 0.011, pan: o.pan, wet: 0.12 });
      noise(t + 0.006, 0.04, { type: 'bandpass', f0: 950, q: 4, gain: g * 0.8, a: 0.0006, r: 0.038, pan: o.pan, wet: 0.12 });
      noise(t + 0.014, 0.01, { type: 'bandpass', f0: 4200, q: 2, gain: g * 0.5, a: 0.0004, r: 0.009, pan: o.pan, wet: 0.1 });
    },

    /** A typewriter key: the strike, the slug on the platen, the body. */
    key(t, o) {
      o = o || {};
      const g = o.gain == null ? 0.4 : o.gain;
      noise(t, 0.012, { type: 'highpass', f0: 2600, q: 0.7, gain: g, a: 0.0004, r: 0.011, pan: o.pan, wet: 0.12 });
      tone(t + 0.004, 0.05, { f0: 190, f1: 120, gain: g * 0.7, a: 0.0008, r: 0.048, pan: o.pan, wet: 0.1 });
      noise(t + 0.004, 0.03, { type: 'bandpass', f0: 1300, q: 3, gain: g * 0.5, a: 0.0006, r: 0.028, pan: o.pan, wet: 0.1 });
    },

    /** A clock's tick. */
    tick(t, o) {
      o = o || {};
      noise(t, 0.008, { type: 'bandpass', f0: o.f || 3400, q: 5, gain: (o.gain == null ? 1 : o.gain) * 1.1, a: 0.0004, r: 0.007, pan: o.pan, wet: 0.2 });
    },

    /** A bell. */
    chime(t, f, o) {
      o = o || {};
      const g = o.gain == null ? 0.08 : o.gain;
      const dur = o.dur || 3;
      [1, 2.756, 5.404, 8.933].forEach((m, i) => tone(t, dur / (1 + i * 0.6), { f0: Math.min(16000, f * m), gain: g / Math.pow(i + 1, 0.9), a: 0.002, r: dur / (1 + i * 0.6), pan: o.pan, wet: o.wet == null ? 0.5 : o.wet }));
    },

    /** A sustained chord: warm detuned saws, slow attack. notes: midi numbers. */
    pad(t, dur, notes, o) {
      o = o || {};
      const g = o.gain == null ? 0.06 : o.gain;
      notes.forEach((m, i) => [-7, 7].forEach((dt) => tone(t, dur, {
        type: 'sawtooth', f0: mtof(m), detune: dt, gain: g / notes.length, a: o.a || dur * 0.35, r: o.r || dur * 0.45,
        lp: o.lp || 1400, q: 0.6, pan: (dt / 7) * 0.4 + (i - notes.length / 2) * 0.1, wet: 0.6
      })));
    },

    /** A brass-like stab on a chord, with a tail. notes: midi numbers. */
    stab(t, notes, o) {
      o = o || {};
      const g = o.gain == null ? 0.14 : o.gain;
      const dur = o.dur || 1.6;
      notes.forEach((m) => [-8, 0, 8].forEach((dt) => tone(t, dur, {
        type: 'sawtooth', f0: mtof(m), detune: dt, gain: g / notes.length / 1.4, a: 0.02, r: dur * 0.8,
        lp: 300, lp1: o.open || 3200, lpGlide: 0.08, q: 1.2, drive: 1.4, pan: (dt / 8) * 0.45, wet: 0.55
      })));
    }
  };

  /* ------------------------------------------------------------ the API --- */

  function define(id, d) { if (id && d && typeof d.bed === 'function') DEFS[id] = d; }

  const SFX = {
    count: 0,
    define: define,
    lib: P,

    /** Before midnight: the audio is ready (context, hall, noise), so the first sound is not late. */
    prime() { ensure(); },

    setVolume(v) {
      volume = clamp(Number(v) || 0, 0, 1);
      if (master) master.gain.setTargetAtTime(volume, ac.currentTime, 0.05);
    },

    /** The sound of `style` from now. w = { title, year, volume }. */
    play(style, w) {
      if (!ensure()) return false;
      this.stop();
      if (w && w.volume != null) this.setVolume(w.volume);
      const d = DEFS[style];
      if (!d) return false;
      if (ducked) { ch.revOut.gain.cancelScheduledValues(ac.currentTime); ch.revOut.gain.setTargetAtTime(0.6, ac.currentTime + 0.1, 0.02); ducked = false; }
      bus = ac.createGain();
      bus.connect(ch.pre);
      send = ac.createGain();
      send.connect(ch.revIn);
      def = d;
      words = { title: (w && w.title) || '', year: (w && w.year) || '' };
      seed = 20270101;
      const t0 = ac.currentTime + 0.03;      // built right after this frame, heard with it
      live = true;
      try { d.bed((ms) => t0 + ms / 1000, words, P); } catch (e) { return false; } finally { live = false; }
      return true;
    },

    /** A moment the animation reports as it happens: d.t is its time in the animation (ms). */
    cue(name, d) {
      if (!ac || !bus || !def || typeof def.cue !== 'function') return;
      const base = ac.currentTime + 0.02;
      const at = d && typeof d.t === 'number' ? d.t : 0;
      live = true;
      try { def.cue(name, (ms) => base + (ms - at) / 1000, d || {}, P, words); } catch (e) { /* one sound less */ } finally { live = false; }
    },

    /** Fades the playing sound out (and the hall's tail with it). */
    stop() {
      queue = [];
      if (pump) { clearInterval(pump); pump = 0; }
      if (soon) { clearTimeout(soon); soon = 0; }
      def = null;
      if (!bus) return;
      const b = bus;
      const s = send;
      bus = null;
      send = null;
      try {
        const now = ac.currentTime;
        b.gain.setTargetAtTime(0.0001, now, 0.04);
        s.gain.setTargetAtTime(0.0001, now, 0.04);
        ch.revOut.gain.cancelScheduledValues(now);
        ch.revOut.gain.setTargetAtTime(0.0001, now, 0.05);
        ducked = true;
        setTimeout(() => { try { b.disconnect(); s.disconnect(); } catch (e) { /* gone */ } }, 600);
      } catch (e) { /* gone */ }
    },

    /** The replay's sound: the film's tracks and the animation's sound in one track (both before the app's volume). */
    mix(tracks) {
      if (!ensure()) return null;
      try {
        if (mixDest) { try { ch.out.disconnect(mixDest); } catch (e) { /* not connected */ } }
        mixDest = ac.createMediaStreamDestination();
        if (tracks && tracks.length) ac.createMediaStreamSource(new MediaStream(tracks)).connect(mixDest);
        // The film's capture ignores the app's volume and mute; the animation's sound is taken
        // before them too, so the clip keeps the balance the room heard at full volume.
        ch.out.connect(mixDest);
        return mixDest.stream.getAudioTracks();
      } catch (e) { return null; }
    },

    styles() { return Object.keys(DEFS); },

    /** Test hook: the sound of `style` rendered offline (an AudioBuffer of `secs` seconds) with the
     *  animation's cues ({ name, t, ... } as fx.js reports them), for checks and demo videos. */
    render(style, w, secs, cues) {
      const OAC = root.OfflineAudioContext;
      const d = DEFS[style];
      if (!OAC || !d) return Promise.resolve(null);
      const keep = [ac, ch, bus, send, def, words, live];
      const oc = new OAC(2, Math.round(44100 * (secs || 14)), 44100);
      try {
        ac = oc;
        ch = makeChain(oc);
        ch.out.connect(oc.destination);
        bus = oc.createGain(); bus.connect(ch.pre);
        send = oc.createGain(); send.connect(ch.revIn);
        def = d;
        words = { title: (w && w.title) || '', year: (w && w.year) || '' };
        live = false;
        seed = 20270101;
        const T = (ms) => 0.02 + ms / 1000;
        d.bed(T, words, P);
        if (typeof d.cue === 'function') for (const c of cues || []) { try { d.cue(c.name, T, c, P, words); } catch (e) { /* one sound less */ } }
      } finally { ac = keep[0]; ch = keep[1]; bus = keep[2]; send = keep[3]; def = keep[4]; words = keep[5]; live = keep[6]; }
      return oc.startRendering();
    }
  };

  root.APSfx = SFX;
})(typeof window !== 'undefined' ? window : this);
