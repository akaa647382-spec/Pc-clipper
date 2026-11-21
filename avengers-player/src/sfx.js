/*!
 * Avengers Player: the sound of the New Year animations (off by default: Display → Animation sound).
 *
 * Every sound is made here with the Web Audio API (noise, oscillators, filters, envelopes): no sound
 * files, nothing to licence. Each animation has a script of its own timed to its key moments (the
 * snap, the lights colliding, a digit landing, a letter typed…); Stark's corner fireworks and the
 * Fireworks animation are heard as the engine fires them (cue()), so every burst seen is a burst heard.
 *
 * It is quiet on purpose: at midnight the film is playing its own snap. The level follows the app's
 * volume and mute. mix(tracks) gives the replay of midnight one sound track with the film and the
 * animation together, so the clip sounds like the night did.
 *
 * window.APSfx = { prime(), play(style, { title, year, volume }), stop(), cue(name, data), setVolume(v),
 *                  mix(tracks) -> [MediaStreamTrack], count }
 */
(function (root) {
  'use strict';

  let ac = null;          // the AudioContext, made on first use (prime() makes it before midnight)
  let master = null;      // everything goes through this (the app's volume)
  let bus = null;         // the animation playing now (stop() fades it out)
  let noise = null;       // two seconds of white noise, reused by every noisy sound
  let mixDest = null;     // the replay's mix, when one is recording
  let volume = 1;
  let seed = 1;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  function ensure() {
    if (!ac) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      try { ac = new AC(); } catch (e) { return null; }
      master = ac.createGain();
      master.gain.value = 0.55 * volume;
      master.connect(ac.destination);
      noise = ac.createBuffer(1, Math.round(ac.sampleRate * 2), ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  /* ------------------------------------------------------------ voices --- */

  /** Where a sound goes: the animation's bus, panned (-1 left .. 1 right). */
  function out(pan) {
    if (!pan || !ac.createStereoPanner) return bus;
    const p = ac.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(bus);
    return p;
  }

  /** An envelope on a gain node: rise to peak in `a`, hold, fall over `r` (seconds, from `t`). */
  function env(g, t, peak, a, dur, r) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.002, a));
    p.setValueAtTime(Math.max(0.0002, peak), t + Math.max(a, dur - r));
    p.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Filtered noise: whooshes, cracks, rumbles, sizzles. f0 → f1 is the filter's sweep. */
  function hiss(t, dur, o) {
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.Q.value = o.q == null ? 1 : o.q;
    f.frequency.setValueAtTime(o.f0 || 1000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ac.createGain();
    env(g, t, o.gain || 0.2, o.a == null ? 0.01 : o.a, dur, o.r == null ? dur * 0.6 : o.r);
    src.connect(f); f.connect(g); g.connect(out(o.pan));
    src.start(t, rand() * 1.5);
    src.stop(t + dur + 0.05);
    SFX.count++;
  }

  /** An oscillator: beeps, hums, sweeps. */
  function tone(t, dur, o) {
    const osc = ac.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0 || 440, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
    const g = ac.createGain();
    env(g, t, o.gain || 0.1, o.a == null ? 0.005 : o.a, dur, o.r == null ? dur * 0.7 : o.r);
    let node = osc;
    if (o.lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(out(o.pan));
    osc.start(t);
    osc.stop(t + dur + 0.05);
    SFX.count++;
  }

  /* the sounds the scripts are made of */
  const boom = (t, gain, pan) => {
    tone(t, 0.9, { f0: 95, f1: 32, gain: gain, a: 0.004, r: 0.8, pan: pan });
    hiss(t, 0.7, { type: 'lowpass', f0: 420, f1: 90, q: 0.7, gain: gain * 0.8, a: 0.003, r: 0.6, pan: pan });
  };
  const crack = (t, gain, pan) => {
    hiss(t, 0.12, { type: 'highpass', f0: 2200, q: 0.7, gain: gain, a: 0.001, r: 0.11, pan: pan });
    tone(t, 0.05, { type: 'square', f0: 1800, f1: 600, gain: gain * 0.3, a: 0.001, r: 0.045, pan: pan });
  };
  const whoosh = (t, dur, gain, f0, f1, pan) => hiss(t, dur, { type: 'bandpass', f0: f0, f1: f1, q: 1.6, gain: gain, a: dur * 0.7, r: dur * 0.3, pan: pan });
  const metal = (t, gain, base, pan) => {
    const parts = [1, 2.76, 5.4, 8.93];
    parts.forEach((m, i) => tone(t, 0.9 - i * 0.15, { f0: base * m, gain: gain / (1 + i * 0.8), a: 0.001, r: 0.85 - i * 0.15, pan: pan }));
    hiss(t, 0.05, { type: 'highpass', f0: 3000, gain: gain * 0.7, a: 0.001, r: 0.045, pan: pan });
  };
  const zap = (t, gain, pan) => {
    tone(t, 0.16, { type: 'sawtooth', f0: 1700 + rand() * 600, f1: 140, gain: gain, a: 0.002, r: 0.15, lp: 3500, pan: pan });
    hiss(t, 0.06, { type: 'highpass', f0: 4000, gain: gain * 0.5, a: 0.001, r: 0.05, pan: pan });
  };
  const crackle = (t, dur, gain, rate, pan) => {
    const n = Math.max(1, Math.round(dur * rate));
    for (let i = 0; i < n; i++) hiss(t + rand() * dur, 0.012 + rand() * 0.02, { type: 'highpass', f0: 2500 + rand() * 3000, gain: gain * (0.4 + rand() * 0.6), a: 0.001, r: 0.01, pan: (pan || 0) + (rand() - 0.5) * 0.6 });
  };
  const beep = (t, f, dur, gain, pan) => tone(t, dur, { type: 'sine', f0: f, gain: gain, a: 0.003, r: dur * 0.5, pan: pan });
  const clack = (t, gain, pan) => {
    hiss(t, 0.035, { type: 'bandpass', f0: 1900, q: 2.5, gain: gain, a: 0.001, r: 0.03, pan: pan });
    tone(t, 0.06, { f0: 160, f1: 90, gain: gain * 0.6, a: 0.001, r: 0.05, pan: pan });
  };
  const key = (t, gain, pan) => {
    hiss(t, 0.018, { type: 'highpass', f0: 3200, gain: gain, a: 0.001, r: 0.016, pan: pan });
    tone(t, 0.045, { f0: 220, f1: 110, gain: gain * 0.5, a: 0.001, r: 0.04, pan: pan });
  };
  const chime = (t, f, gain, pan) => [1, 2.003, 3.01].forEach((m, i) => tone(t, 2.4 - i * 0.5, { f0: f * m, gain: gain / (1 + i), a: 0.004, r: 2.2 - i * 0.5, pan: pan }));
  const shimmer = (t, dur, gain) => [2093, 2637, 3136, 3951].forEach((f, i) => tone(t + i * 0.05, dur, { f0: f * (1 + (rand() - 0.5) * 0.01), gain: gain / 4, a: dur * 0.4, r: dur * 0.6, pan: (i - 1.5) * 0.4 }));
  const pan = (x) => clamp((x == null ? 0.5 : x) * 2 - 1, -0.9, 0.9);

  /* ------------------------------------------------------------ scripts --- */
  // Each script gets t0 (the audio time of the animation's start) and the words; times in seconds.

  const letters = (s) => Array.from(s || '').filter((c) => c.trim()).length;

  const SCRIPTS = {
    // Golden dust: a swell of wind while it gathers, a shimmer as the words form, wind as it blows away.
    stark(t0) {
      whoosh(t0, 2.3, 0.3, 300, 1400, -0.4);
      shimmer(t0 + 1.6, 1.6, 0.09);
      whoosh(t0 + 8.4, 2.2, 0.26, 1600, 500, 0.5);
    },
    // Fireworks are heard as the engine fires them (cue()); a little crowd-like hiss under the start.
    fireworks(t0) {
      hiss(t0, 1.2, { type: 'bandpass', f0: 900, q: 0.6, gain: 0.04, a: 0.2, r: 0.8 });
    },
    // The reactor: a hum powering up, flickers, the core flare, letters striking on, the year charging.
    arc(t0, w) {
      tone(t0, 1.5, { type: 'sawtooth', f0: 55, f1: 140, gain: 0.08, a: 0.6, r: 0.4, lp: 700 });
      for (let i = 0; i < 5; i++) tone(t0 + 0.15 + rand() * 1.1, 0.05, { type: 'square', f0: 100, gain: 0.04, a: 0.002, r: 0.04, lp: 1200 });
      zap(t0 + 1.4, 0.16);
      boom(t0 + 1.42, 0.2);
      const n = letters(w.title);
      for (let i = 0; i < n; i++) zap(t0 + 1.5 + (i / Math.max(1, n)) * 0.6, 0.05, (i / Math.max(1, n - 1)) * 1.4 - 0.7);
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) {
        const t = t0 + 1.7 + k * 0.29;
        tone(t, 0.27, { type: 'sine', f0: 300, f1: 900, gain: 0.05, a: 0.2, r: 0.07, pan: (k / Math.max(1, ny - 1)) * 0.8 - 0.4 });
        beep(t + 0.27, 1320, 0.25, 0.05, (k / Math.max(1, ny - 1)) * 0.8 - 0.4);
      }
      boom(t0 + 6.2, 0.08); shimmer(t0 + 6.2, 1.2, 0.03);
      tone(t0 + 9.3, 1.6, { type: 'sawtooth', f0: 140, f1: 38, gain: 0.07, a: 0.1, r: 1.2, lp: 600 });
      for (let i = 0; i < 6; i++) zap(t0 + 10.6 + rand() * 1.0, 0.03, rand() * 1.4 - 0.7);
    },
    // Hot Rod: two thrusters crossing, the year forged blow by blow, a torch welding the title, cooling.
    hotrod(t0, w) {
      whoosh(t0, 0.36, 0.16, 500, 2600, -0.8);
      whoosh(t0, 0.36, 0.16, 520, 2700, 0.8);
      crack(t0 + 0.33, 0.18); boom(t0 + 0.34, 0.14);
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) { const t = t0 + 0.52 + k * 0.24; metal(t, 0.12, 180, (k / Math.max(1, ny - 1)) * 0.8 - 0.4); boom(t, 0.07); }
      crack(t0 + 1.5, 0.1);
      hiss(t0 + 1.6, 1.15, { type: 'highpass', f0: 3500, gain: 0.05, a: 0.05, r: 0.2 });
      crackle(t0 + 1.6, 1.15, 0.05, 40, 0);
      whoosh(t0 + 4.5, 0.9, 0.05, 200, 500); whoosh(t0 + 7.45, 0.9, 0.05, 200, 500);
      for (let i = 0; i < 8; i++) metal(t0 + 10.6 + i * 0.18, 0.02, 900 + rand() * 600, rand() * 1.2 - 0.6);
      crackle(t0 + 10.6, 1.6, 0.03, 18, 0);
    },
    // Thanos: the snap, six streaks of light colliding into a gold blaze, the year forged, ash rising,
    // and at the end, perfectly balanced, two gusts of dust.
    infinity(t0, w) {
      crack(t0, 0.26); tone(t0, 0.12, { type: 'square', f0: 2600, f1: 900, gain: 0.05, a: 0.001, r: 0.1 });
      whoosh(t0 + 0.02, 0.5, 0.06, 2400, 600);
      for (let i = 0; i < 6; i++) whoosh(t0 + 0.1 + i * 0.06, 0.92 - i * 0.05, 0.07, 350, 2400, Math.cos(i * Math.PI / 3 - Math.PI / 2 + 0.35) * 0.8);
      boom(t0 + 1.05, 0.24); shimmer(t0 + 1.08, 1.0, 0.05);
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) metal(t0 + 1.25 + k * 0.15, 0.1, 140, 0);
      hiss(t0 + 1.9, 1.2, { type: 'bandpass', f0: 2600, q: 0.8, gain: 0.05, a: 0.3, r: 0.6 });
      shimmer(t0 + 2.3, 1.0, 0.03);
      hiss(t0 + 9.6, 1.4, { type: 'highpass', f0: 1800, gain: 0.1, a: 0.15, r: 1.0, pan: 0.4 });
      hiss(t0 + 10.4, 1.4, { type: 'highpass', f0: 1600, gain: 0.1, a: 0.15, r: 1.0, pan: 0.5 });
    },
    // Gamma: a thunderclap, the year smashing down, lightning writing the title, a second surge.
    gamma(t0, w) {
      crack(t0, 0.3); boom(t0, 0.26);
      hiss(t0 + 0.05, 2.4, { type: 'lowpass', f0: 300, f1: 80, q: 0.5, gain: 0.14, a: 0.05, r: 2.0 });
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) { const t = t0 + 0.3 + k * 0.047; tone(t, 0.25, { f0: 120, f1: 50, gain: 0.12, a: 0.002, r: 0.22, pan: (k / Math.max(1, ny - 1)) * 0.8 - 0.4 }); }
      boom(t0 + 0.44, 0.22);
      const n = letters(w.title);
      for (let i = 0; i < n; i++) { const t = t0 + 0.77 + (i / Math.max(1, n)) * 1.0; const p = (i / Math.max(1, n - 1)) * 1.4 - 0.7; crackle(t, 0.09, 0.08, 120, p); zap(t, 0.05, p); }
      crack(t0 + 5.8, 0.16); hiss(t0 + 5.85, 1.6, { type: 'lowpass', f0: 260, f1: 80, q: 0.5, gain: 0.09, a: 0.05, r: 1.4 });
      crackle(t0 + 10.5, 1.5, 0.04, 20, 0);
    },
    // War Machine: the display booting, lock-on beeps, the year's counter and its lock, tracers and flak.
    warmachine(t0, w) {
      tone(t0, 0.5, { f0: 180, f1: 1200, gain: 0.06, a: 0.05, r: 0.3 });
      key(t0 + 0.02, 0.06);
      for (let i = 0; i < 4; i++) beep(t0 + 0.3 + i * 0.35, 1760, 0.05, 0.03);
      const n = letters(w.title);
      for (let i = 0; i < n; i++) beep(t0 + 0.6 + i * 0.08, 2093, 0.04, 0.035, (i / Math.max(1, n - 1)) * 1.4 - 0.7);
      for (let i = 0; i < 14; i++) key(t0 + 1.8 + i * 0.05, 0.03);
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) { beep(t0 + 2.0 + k * 0.15, 880, 0.06, 0.05); beep(t0 + 2.07 + k * 0.15, 1320, 0.08, 0.05); }
      [2.5, 3.9, 5.3, 6.7, 8.1].forEach((s, v) => {
        whoosh(t0 + s, 0.5, 0.05, 600, 2200, -0.7); whoosh(t0 + s + 0.05, 0.5, 0.05, 600, 2200, 0.7);
        for (let i = 0; i < 4; i++) { const t = t0 + s + 0.55 + i * 0.12 + rand() * 0.06; crack(t, 0.07, rand() * 1.4 - 0.7); }
      });
      boom(t0 + 9.5, 0.16); crack(t0 + 9.5, 0.12);
      tone(t0 + 11, 0.9, { f0: 900, f1: 120, gain: 0.05, a: 0.02, r: 0.7 });
    },
    // TVA: split-flap clacks, the year flipping over, the terminal typing the title, then unwriting it.
    tva(t0, w) {
      const ny = letters(w.year);
      for (let k = 0; k < Math.max(1, ny); k++) clack(t0 + 0.42 + k * 0.07, 0.09, (k / Math.max(1, ny - 1)) * 0.8 - 0.4);
      for (let i = 0; i < 4; i++) clack(t0 + 0.9 + i * 0.065, 0.04);
      clack(t0 + 1.18, 0.16); tone(t0 + 1.18, 0.15, { f0: 600, gain: 0.03, a: 0.001, r: 0.14 });
      beep(t0 + 1.06, 660, 0.05, 0.03);
      let t = t0 + 1.34;
      for (const ch of Array.from(w.title || '')) {
        if (ch.trim()) { key(t, 0.07, 0); t += 0.088; } else t += 0.15;
      }
      for (let i = 0; i < letters(w.title); i++) key(t0 + 10.63 + i * 0.052, 0.035);
      for (let k = 0; k < Math.max(1, ny); k++) clack(t0 + 10.76 + k * 0.13, 0.06);
    },
    // Doom: a whoomp of green fire, the letters burned in, the circle surging, its collapse.
    doom(t0, w) {
      boom(t0, 0.18);
      hiss(t0, 3.0, { type: 'lowpass', f0: 700, f1: 400, q: 0.6, gain: 0.06, a: 0.2, r: 1.5 });
      const n = letters(w.title);
      for (let i = 0; i < n; i++) crackle(t0 + 0.5 + (i / Math.max(1, n)) * 1.4, 0.15, 0.05, 80, (i / Math.max(1, n - 1)) * 1.4 - 0.7);
      const ny = letters(w.year);
      for (let k = 0; k < ny; k++) { hiss(t0 + 2.1 + k * 0.16, 0.5, { type: 'bandpass', f0: 900, q: 0.8, gain: 0.08, a: 0.01, r: 0.45 }); }
      [4.15, 7.05].forEach((s) => hiss(t0 + s, 1.4, { type: 'lowpass', f0: 300, f1: 900, q: 0.6, gain: 0.08, a: 0.6, r: 0.8 }));
      hiss(t0 + 9.35, 1.7, { type: 'lowpass', f0: 250, f1: 1400, q: 0.6, gain: 0.1, a: 1.4, r: 0.3 });
      boom(t0 + 11.0, 0.2);
    },
    // Minimal: a soft two-note chime.
    minimal(t0) {
      chime(t0, 784, 0.05, -0.2);
      chime(t0 + 0.22, 1175, 0.04, 0.2);
    }
  };

  /** The sound of an engine cue at audio time t. */
  function cueAt(t, name, d) {
    const p = pan(d && d.x);
    if (name === 'launch') whoosh(t, 0.6, 0.035, 500, 2600, p);
    else if (name === 'burst') { crack(t, 0.09, p); boom(t, 0.05, p); crackle(t + 0.15, 0.9, 0.025, 25, p); }
    else if (name === 'boom') { boom(t, 0.2, p); crack(t, 0.12, p); crackle(t + 0.12, 1.2, 0.04, 40, p); }
    else if (name === 'pop') crackle(t, 0.12, 0.05, 90, p);
  }

  /* ------------------------------------------------------------ the API --- */

  const SFX = {
    count: 0,

    /** Before midnight: the audio is ready, so the first sound is not late. */
    prime() { ensure(); },

    setVolume(v) {
      volume = clamp(Number(v) || 0, 0, 1);
      if (master) master.gain.setTargetAtTime(0.55 * volume, ac.currentTime, 0.05);
    },

    /** The sound of `style` from now. w = { title, year, volume }. */
    play(style, w) {
      if (!ensure()) return false;
      this.stop();
      if (w && w.volume != null) this.setVolume(w.volume);
      bus = ac.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      seed = 20270101;
      const script = SCRIPTS[style];
      if (!script) return false;
      try { script(ac.currentTime + 0.02, { title: (w && w.title) || '', year: (w && w.year) || '' }); } catch (e) { return false; }
      return true;
    },

    /** A sound the animation engine fires as it happens (Stark's and Fireworks' rockets and bursts). */
    cue(name, d) {
      if (!ac || !bus) return;
      cueAt(ac.currentTime + 0.005, name, d);
    },

    /** Fades the playing sound out. */
    stop() {
      if (!bus) return;
      const b = bus;
      bus = null;
      try {
        b.gain.setTargetAtTime(0.0001, ac.currentTime, 0.04);
        setTimeout(() => { try { b.disconnect(); } catch (e) { /* gone */ } }, 400);
      } catch (e) { /* gone */ }
    },

    /** The replay's sound: the film's tracks and the animation's sound in one track. */
    mix(tracks) {
      if (!ensure()) return null;
      try {
        if (mixDest) { try { master.disconnect(mixDest); } catch (e) { /* not connected */ } }
        mixDest = ac.createMediaStreamDestination();
        if (tracks && tracks.length) ac.createMediaStreamSource(new MediaStream(tracks)).connect(mixDest);
        master.connect(mixDest);
        return mixDest.stream.getAudioTracks();
      } catch (e) { return null; }
    },

    styles() { return Object.keys(SCRIPTS); },

    /** Test hook: the sound of `style` rendered offline (an AudioBuffer of `secs` seconds), for checks and demo videos. */
    render(style, w, secs, cues) {
      const OAC = root.OfflineAudioContext;
      if (!OAC || !SCRIPTS[style]) return Promise.resolve(null);
      const keep = [ac, master, bus, noise];
      const oc = new OAC(2, Math.round(44100 * (secs || 13)), 44100);
      ac = oc;
      master = oc.createGain(); master.gain.value = 0.55; master.connect(oc.destination);
      bus = oc.createGain(); bus.connect(master);
      noise = oc.createBuffer(1, 88200, 44100);
      seed = 7; const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
      seed = 20270101;
      try {
        SCRIPTS[style](0.02, { title: (w && w.title) || '', year: (w && w.year) || '' });
        for (const c of cues || []) cueAt(0.02 + c.t / 1000, c.name, c);
      } finally { ac = keep[0]; master = keep[1]; bus = keep[2]; noise = keep[3]; }
      return oc.startRendering();
    }
  };

  root.APSfx = SFX;
})(typeof window !== 'undefined' ? window : this);
