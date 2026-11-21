/*!
 * Avengers Player: the sound of the Final Countdown (10 · 9 · 8 …), off by default
 * (Display → Countdown sound). One set per countdown look, as the Final Countdown follows the
 * New Year animation (data-ten on the clock panel): Stark's classic one, each theme's, and a plain
 * one for the rest.
 *
 * Each number is heard on the instant it appears. 10 to 4 are light and grow a little each
 * second; 3 · 2 · 1 are heavier, and from 3 a build rises to land exactly on midnight, where the
 * animation (and the film's own snap) take over. It is kept under the film: the room should still
 * hear the film, and itself counting.
 *
 * fn(n, t, P): n is the number (10 … 1), t its audio time, P the library of sfx.js.
 * Original sound design: no melody or motif from any film or show.
 */
(function () {
  'use strict';
  const S = window.APSfx;
  if (!S || !S.defineCount) return;

  /** How strong number n is: 10 is the softest, each second a little more, 3 · 2 · 1 full. */
  const grow = (n) => (n <= 3 ? 1 : 0.6 + (10 - n) * 0.05);

  // Plain: a soft, clean blip; a fifth higher for 3 · 2 · 1, and a breath into midnight.
  S.defineCount('default', (n, t, P) => {
    const b = grow(n);
    P.tone(t, 0.14, { type: 'sine', f0: n <= 3 ? 1318.5 : 880, gain: (n <= 3 ? 0.24 : 0.15) * b, a: 0.002, r: 0.13, wet: 0.25 });
    P.tick(t, { gain: 0.5 * b, f: 4200 });
    if (n === 3) P.swell(t + 0.6, 2.4, { gain: 0.06, f0: 2000, f1: 6000, tone: 330 });
  });

  // Stark (the classic countdown): a gold HUD. A clean beep on a soft low thump; 3 · 2 · 1 lock on
  // higher with a punch, and a bright riser climbs into midnight.
  S.defineCount('stark', (n, t, P) => {
    const b = grow(n);
    P.beep(t, n <= 3 ? 1760 : 1174.7, 0.09, { gain: 0.075 * b });
    P.tick(t, { gain: 0.45 * b, f: 4800 });
    P.tone(t, 0.14, { f0: 98, f1: 60, gain: 0.14 * b, a: 0.002, r: 0.13, wet: 0.1 });
    if (n <= 3) { P.punch(t, { gain: 0.09 + (3 - n) * 0.02, f0: 130, f1: 50 }); P.beep(t + 0.09, 2349.3, 0.12, { gain: 0.05 }); }
    if (n === 3) { P.riser(t, 3, { gain: 0.075, p0: 147, p1: 587, f0: 400, f1: 6000 }); P.swell(t + 1.9, 1.1, { gain: 0.07 }); }
  });

  // Arc Reactor: a pulse of current through the core: a short arc and a ping; 3 · 2 · 1 arc longer
  // over the reactor's hum, and the core charges up into midnight.
  S.defineCount('arc', (n, t, P) => {
    const b = grow(n);
    P.zap(t, { dur: n <= 3 ? 0.14 : 0.07, gain: (n <= 3 ? 0.16 : 0.1) * b, f: 110 });
    P.tone(t, 0.3, { type: 'sine', f0: n <= 3 ? 880 : 587.3, gain: 0.07 * b, a: 0.002, r: 0.28, wet: 0.35 });
    if (n <= 3) P.hum(t, 0.9, { f: 55, gain: 0.05, a: 0.02, r: 0.6 });
    if (n === 3) P.powerUp(t, 3, { gain: 0.085, f0: 55, f1: 440 });
  });

  // Hot Rod: the repulsors breathing: a chirp of thrust; 3 · 2 · 1 with a kick, and the thrusters
  // spool up into midnight.
  S.defineCount('hotrod', (n, t, P) => {
    const b = grow(n);
    P.noise(t, 0.2, { type: 'bandpass', f0: 1200, f1: 350, q: 1.1, gain: 0.21 * b, a: 0.004, r: 0.19, wet: 0.2 });
    P.tone(t, 0.16, { type: 'sine', f0: 660, f1: 990, gain: 0.09 * b, a: 0.003, r: 0.15, wet: 0.2 });
    if (n <= 3) P.punch(t, { gain: 0.1 + (3 - n) * 0.02, f0: 150, f1: 55 });
    if (n === 3) { P.powerUp(t, 3, { gain: 0.08, f0: 110, f1: 880 }); P.whoosh(t + 1.6, 1.4, { gain: 0.12, pan: -0.5, pan1: 0.5 }); }
  });

  // Infinity: a deep, dark resonance on C, a struck stone ringing; 3 · 2 · 1 hit lower and harder,
  // and a dark rise climbs into midnight.
  S.defineCount('infinity', (n, t, P) => {
    const b = grow(n);
    P.tone(t, 0.9, { f0: 65.4, gain: 0.13 * b, a: 0.004, r: 0.85, lp: 420, drive: 1.3, wet: 0.4 });
    P.metal(t, { gain: 0.035 * b, base: 261.6, decay: 1, wet: 0.5 });
    if (n <= 3) P.punch(t, { gain: 0.12 + (3 - n) * 0.02, f0: 90, f1: 38 });
    if (n === 3) P.riser(t, 3, { gain: 0.07, p0: 65.4, p1: 523.3, f0: 200, f1: 4000 });
  });

  // Gamma: a heartbeat (lub-dub) getting louder; 3 · 2 · 1 pound, and a growl swells into midnight.
  S.defineCount('gamma', (n, t, P) => {
    const b = grow(n);
    const k = n <= 3 ? 1.12 + (3 - n) * 0.05 : 1;
    P.punch(t, { gain: 0.22 * b * k, f0: 82, f1: 40 });
    P.punch(t + 0.17, { gain: 0.14 * b * k, f0: 72, f1: 36 });
    if (n <= 3) P.sub(t, { gain: 0.08, f0: 55, f1: 30, dur: 0.6 });
    if (n === 3) P.tone(t, 3, { type: 'sawtooth', f0: 41.2, f1: 82.4, gain: 0.085, a: 2.8, r: 0.08, lp: 180, lp1: 1600, q: 1.4, drive: 2.2, wet: 0.3 });
  });

  // War Machine: armour and servos: a heavy clack with a servo twitch; 3 · 2 · 1 lock a target with
  // a thud, and the systems power up into midnight.
  S.defineCount('warmachine', (n, t, P) => {
    const b = grow(n);
    P.clack(t, { gain: 0.55 * b });
    P.servo(t + 0.03, 0.12, { gain: 0.06 * b, f0: 200, f1: 360 });
    if (n <= 3) { P.lock(t, { gain: 0.08 }); P.punch(t, { gain: 0.1 + (3 - n) * 0.02, f0: 120, f1: 45 }); }
    if (n === 3) P.powerUp(t, 3, { gain: 0.075, f0: 80, f1: 640 });
  });

  // TVA: a clock: tick, tock, with a wooden body; 3 · 2 · 1 a small bell over it, and an eerie swell
  // into midnight.
  S.defineCount('tva', (n, t, P) => {
    const b = grow(n);
    P.tick(t, { gain: 1.1 * b, f: n % 2 ? 3000 : 2300 });
    P.tone(t, 0.07, { f0: 180, f1: 150, gain: 0.12 * b, a: 0.001, r: 0.065, wet: 0.15 });
    if (n <= 3) P.chime(t, 880, { gain: 0.06, dur: 1.2 });
    if (n === 3) P.swell(t + 0.5, 2.5, { gain: 0.07, tone: 220 });
  });

  // Doom: an iron drum in a stone hall; 3 · 2 · 1 the hammer on the anvil, and a dark rise into midnight.
  S.defineCount('doom', (n, t, P) => {
    const b = grow(n);
    P.punch(t, { gain: 0.2 * b, f0: 110, f1: 45 });
    P.noise(t, 0.5, { type: 'lowpass', f0: 320, f1: 120, q: 0.6, gain: 0.1 * b, a: 0.003, r: 0.48, wet: 0.55 });
    if (n <= 3) P.anvil(t, { gain: 0.09 + (3 - n) * 0.015, base: 440 });
    if (n === 3) P.riser(t, 3, { gain: 0.07, p0: 55, p1: 220, f0: 150, f1: 2500 });
  });

  // Fireworks: a light tick and a tiny bell; 3 · 2 · 1 ring out, and a rocket whistles up into midnight.
  S.defineCount('fireworks', (n, t, P) => {
    const b = grow(n);
    P.tick(t, { gain: 0.8 * b, f: 3800 });
    P.tone(t, 0.12, { type: 'sine', f0: 1568, gain: 0.07 * b, a: 0.002, r: 0.11, wet: 0.35 });
    if (n <= 3) P.chime(t, 1568, { gain: 0.08, dur: 1 });
    if (n === 3) P.tone(t + 0.5, 2.5, { type: 'sine', f0: 900, f1: 2600, gain: 0.07, a: 2.3, r: 0.05, wet: 0.4 });
  });
})();
