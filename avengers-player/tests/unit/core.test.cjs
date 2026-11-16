'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

test('fmtDuration / parseDuration round-trip', () => {
  assert.equal(C.fmtDuration(9030), '2:30:30');
  assert.equal(C.fmtDuration(9030.25, { ms: true }), '2:30:30.250');
  assert.equal(C.fmtDuration(59.9996, { ms: true }), '1:00.000');
  assert.equal(C.fmtDuration(75), '1:15');
  assert.equal(C.fmtDuration(75, { forceHours: true }), '0:01:15');
  assert.equal(C.fmtDuration(-5), '-0:05');
  assert.equal(C.fmtDuration(NaN), '--:--');
  assert.equal(C.parseDuration('2:30:30'), 9030);
  assert.equal(C.parseDuration('2:30:30.5'), 9030.5);
  assert.equal(C.parseDuration('2:30:30,250'), 9030.25);
  assert.equal(C.parseDuration('150:30'), 9030);
  assert.equal(C.parseDuration('9030'), 9030);
  assert.equal(C.parseDuration('2h30m30s'), 9030);
  assert.equal(C.parseDuration('2h 30m'), 9000);
  assert.ok(Number.isNaN(C.parseDuration('')));
  assert.ok(Number.isNaN(C.parseDuration('abc')));
  assert.ok(Number.isNaN(C.parseDuration('1:2:3:4')));
  assert.ok(Number.isNaN(C.parseDuration('1.5:20')));
  for (const s of [0, 0.001, 59.999, 3599.5, 9030, 10871.208]) {
    assert.ok(Math.abs(C.parseDuration(C.fmtDuration(s, { ms: true })) - s) < 0.0006, String(s));
  }
});

test('countdown reaches zero exactly at the target', () => {
  assert.equal(C.countdownParts(10000).total, 10);
  assert.equal(C.countdownParts(9999).total, 10);
  assert.equal(C.countdownParts(9001).total, 10);
  assert.equal(C.countdownParts(9000).total, 9);
  assert.equal(C.countdownParts(1).total, 1);
  assert.equal(C.countdownParts(0).total, 0);
  assert.equal(C.countdownParts(-500).total, 0);
  assert.equal(C.fmtCountdown(3 * 86400000 + 3723000), '3d 01:02:03');
  assert.equal(C.fmtCountdown(3723000), '01:02:03');
});

test('countdowns tick on the same instant as the clock, also to a start between two seconds', () => {
  // Midnight, and a snap at 2:30:31.4: the film starts at 9:29:28.6.
  const T = Date.UTC(2027, 0, 1, 0, 0, 0);
  const start = T - 9031400;
  const shown = (now) => C.fmtCountdown(C.untilClockSecond(start, now));
  // The number changes exactly when the clock's second changes, never in between.
  for (let k = 3; k >= 1; k--) {
    const sec = Math.floor(start / 1000) * 1000 - k * 1000;      // the clock shows a whole second
    assert.equal(shown(sec), '00:00:0' + k, 'at the tick');
    assert.equal(shown(sec + 1), '00:00:0' + k, 'just after');
    assert.equal(shown(sec + 999), '00:00:0' + k, 'the same all through the second');
    assert.equal(shown(sec + 1000), '00:00:0' + (k - 1), 'and one less as the clock ticks');
  }
  // It reaches zero as the clock shows the second in which the film starts (9:29:28).
  assert.equal(C.untilClockSecond(start, Math.floor(start / 1000) * 1000), 0);
  // A target on a whole second (midnight) counts exactly as before.
  for (const left of [10000, 9999, 9001, 1, 0]) assert.equal(C.untilClockSecond(T, T - left), left);
});

test('the film\'s time ticks with the clock and shows the snap\'s second at midnight', () => {
  const T = Date.UTC(2027, 0, 1, 0, 0, 0);
  for (const snapMs of [9031400, 9030000, 9031999, 9032001, 10871]) {
    const session = { targetEpoch: T, startEpoch: T - snapMs };
    const at = (now) => C.filmSecondOnClock(session, now);
    assert.equal(at(T), Math.floor(snapMs / 1000), 'midnight shows the second that holds the snap (' + snapMs + ')');
    // It changes on the clock's seconds and nowhere else.
    for (let ms = -5000; ms < 5000; ms += 7) {
      const now = T + ms;
      const tick = now % 1000 === 0;
      if (!tick) assert.equal(at(now), at(now - 1), 'steady inside a second');
    }
    for (let k = -5; k <= 5; k++) assert.equal(at(T + k * 1000) - at(T + k * 1000 - 1), 1, 'one up at each tick');
    // Never ahead of the film; the film's own second, or the one before while the film's second
    // has turned over and the clock's has not yet.
    for (let ms = -3000; ms < 3000; ms += 13) {
      const real = (T + ms - session.startEpoch) / 1000;
      const d = at(T + ms);
      assert.ok(d <= real + 1e-9 && Math.floor(real + 1e-9) - d <= 1, snapMs + ' at ' + ms + ': ' + d + ' vs ' + real);
    }
  }
});

test('clock formatting, 12 and 24 hour', () => {
  assert.equal(C.fmtClock(new Date(2026, 11, 31, 21, 29, 30), false), '9:29:30 PM');
  assert.equal(C.fmtClock(new Date(2026, 11, 31, 21, 29, 30), true), '21:29:30');
  assert.equal(C.fmtClock(new Date(2027, 0, 1, 0, 0, 0), false), '12:00:00 AM');
  assert.equal(C.fmtClock(new Date(2027, 0, 1, 12, 0, 5), false), '12:00:05 PM');
  assert.equal(C.fmtDateTime(new Date(2026, 11, 31, 21, 29, 30).getTime(), false), 'Thu, Dec 31 · 9:29:30 PM');
});

test('new year target: default snap gives a 9:29:30 PM start', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0).getTime();
  const s = C.computeSession({ nowMs: now, snapSec: C.DEFAULT_SNAP_SEC, durationSec: 10871, targetMode: 'newyear' });
  assert.equal(s.targetEpoch, new Date(2027, 0, 1, 0, 0, 0).getTime());
  assert.equal(s.startEpoch, new Date(2026, 11, 31, 21, 29, 30).getTime());
  assert.equal(s.endEpoch, s.startEpoch + 10871000);
  assert.equal(C.expectedPos(s, s.startEpoch), 0);
  assert.equal(C.expectedPos(s, s.targetEpoch), C.DEFAULT_SNAP_SEC);
});

test('new year target: stays on the midnight that just passed while the film is still running', () => {
  const dur = 10871;
  const tail = (dur - C.DEFAULT_SNAP_SEC) * 1000;
  const jan1 = new Date(2027, 0, 1, 0, 0, 0).getTime();
  const during = C.computeSession({ nowMs: jan1 + 5 * 60000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(during.targetEpoch, jan1);
  const justBeforeEnd = C.computeSession({ nowMs: jan1 + tail - 1000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(justBeforeEnd.targetEpoch, jan1);
  const after = C.computeSession({ nowMs: jan1 + tail + 1000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(after.targetEpoch, new Date(2028, 0, 1, 0, 0, 0).getTime());
  const lastSecond = C.computeSession({ nowMs: jan1 - 1, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(lastSecond.targetEpoch, jan1);
});

test('custom target and unknown duration', () => {
  const target = new Date(2026, 5, 1, 20, 0, 0).getTime();
  const s = C.computeSession({ nowMs: 0, snapSec: 100, durationSec: NaN, targetMode: 'custom', customTargetMs: target });
  assert.equal(s.targetEpoch, target);
  assert.equal(s.startEpoch, target - 100000);
  assert.equal(s.endEpoch, null);
  const fallback = C.computeSession({ nowMs: new Date(2026, 5, 1).getTime(), snapSec: 100, durationSec: 200, targetMode: 'custom', customTargetMs: NaN });
  assert.equal(fallback.targetEpoch, new Date(2027, 0, 1).getTime());
});

test('median', () => {
  assert.equal(C.median([3, 1, 2]), 2);
  assert.equal(C.median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(C.median([])));
});

/** Simulates a player whose position follows the commanded rate, with measurement noise. */
function simulate(initialDrift, opts) {
  const ctrl = new C.DriftController(opts);
  let drift = initialDrift;
  let rate = 1;
  let hard = false;
  const trace = [];
  const noise = (i) => Math.sin(i * 12.9898) * 0.004;
  for (let i = 0; i < 24 * 20; i++) {            // 20 s of 24 fps frames
    const t = i / 24;
    drift += (rate - 1) / 24;
    ctrl.push(t, drift + noise(i));
    if (i % 5 === 0) {                             // decisions ~5 times a second
      const r = ctrl.decide(t);
      if (r.action === 'hard') { hard = true; break; }
      rate = r.rate;
    }
    trace.push({ t, drift, rate });
  }
  return { trace, hard, final: drift, ctrl };
}

test('drift controller converges from both sides without overshooting much', () => {
  for (const d0 of [0.2, -0.2, 0.05, -0.05, 0.45, -0.45]) {
    const { trace, hard, final } = simulate(d0);
    assert.equal(hard, false, 'no hard seek for ' + d0);
    assert.ok(Math.abs(final) < 0.02, 'converged from ' + d0 + ' -> ' + final);
    const overshoot = d0 > 0 ? Math.min(...trace.map((x) => x.drift)) : Math.max(...trace.map((x) => x.drift));
    assert.ok(Math.abs(overshoot) < 0.03, 'overshoot ' + overshoot + ' from ' + d0);
    for (const x of trace) assert.ok(x.rate >= 0.94 - 1e-9 && x.rate <= 1.06 + 1e-9, 'rate bounded');
    const settled = trace.find((x) => Math.abs(x.drift) < 0.012);
    assert.ok(settled && settled.t < 12, 'settles in time from ' + d0);
  }
});

test('drift controller leaves small drift alone and asks for a seek on big drift', () => {
  const quiet = simulate(0.012);
  assert.ok(quiet.trace.every((x) => x.rate === 1), 'inside the deadband nothing is touched');
  assert.equal(simulate(0.8).hard, true);
  assert.equal(simulate(-3).hard, true);
});

test('drift controller needs fresh samples', () => {
  const c = new C.DriftController();
  assert.equal(c.decide(1).drift, null);
  c.push(1, 0.1);
  assert.equal(c.decide(1).drift, null, 'one sample is not enough');
  c.push(1.05, 0.1);
  assert.equal(c.decide(1.05).action, 'rate');
  assert.equal(c.decide(5).drift, null, 'stale samples are ignored');
  c.push(NaN, 1); c.push(2, NaN);
  c.reset();
  assert.equal(c.rate, 1);
});

test('film versions: ENDGAME is 3:01:11, ENCORE is 3:01:36', () => {
  const ids = C.FILM_VERSIONS.map((v) => v.id);
  assert.deepEqual(ids, ['original', 'encore', 'custom']);
  assert.equal(C.filmVersion('original').lengthSec, 3 * 3600 + 1 * 60 + 11);
  assert.equal(C.filmVersion('encore').lengthSec, 3 * 3600 + 1 * 60 + 36);
  assert.equal(C.REFERENCE_SEC, 10871);
  assert.match(C.filmVersion('original').name, /3:01:11/);
  assert.match(C.filmVersion('encore').name, /3:01:36/);
  assert.equal(C.filmVersion('original').snapSec, 9030, 'where the search starts');
  assert.equal(C.filmVersion('encore').snapSec, 9030);
  assert.equal(C.filmVersion('custom').snapSec, null);
  // No cut is taken on trust: 2:30:30 is a round number until the frame has been found in the file.
  for (const v of C.FILM_VERSIONS) assert.equal(v.settled, false, v.id);
  // A cut that is no longer offered keeps its own snap point; nothing at all means the film itself.
  assert.equal(C.filmVersion('encore-intro').id, 'custom');
  assert.equal(C.filmVersion('nonsense').id, 'custom');
  assert.equal(C.filmVersion('').id, 'original');
  assert.equal(C.filmVersion(undefined).id, 'original');
  for (const v of C.FILM_VERSIONS) {
    assert.ok(v.name && v.short && v.note && v.family, v.id);
    if (v.minutes) assert.ok(v.minutes[0] < v.minutes[1], v.id);
  }
  // The ranges used to recognise a file must not overlap.
  const ranges = C.FILM_VERSIONS.filter((v) => v.minutes).map((v) => v.minutes).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] >= ranges[i - 1][1]);
});
test('film versions: any copy of the film\'s length is taken for the film; the name tells the cut', () => {
  const guess = (h, m, sec, name) => { const v = C.guessFilmVersion(h * 3600 + m * 60 + sec, name); return v ? v.id : null; };
  const BLURAY = 'Avengers.Endgame.2019.1080p.BluRay.Hindi.5.1-English.5.1.mkv';
  assert.equal(guess(3, 1, 11, BLURAY), 'original', 'ENDGAME');
  assert.equal(guess(3, 2, 5, BLURAY), 'original', 'a 2019 Blu-ray rip that runs 3:02:05 is still the 2019 film');
  assert.equal(guess(3, 1, 36, 'Avengers Endgame Encore (2026).mkv'), 'encore', 'ENCORE by its name');
  assert.equal(guess(3, 1, 36, 'Avengers.Endgame.2026.2160p.WEB-DL.mkv'), 'encore', 'the year of the re-release');
  assert.equal(guess(3, 1, 36, 'movie.mkv'), 'original', 'a name that says nothing: the 2019 film');
  assert.equal(guess(3, 0, 57, 'endgame.mp4'), 'original', 'the 2019 cinema print');
  assert.equal(guess(2, 50, 0, 'endgame-no-credits.mp4'), 'original', 'credits cut short');
  assert.equal(guess(3, 20, 0, 'endgame-with-extras.mkv'), 'original', 'a long intro or extras');
  assert.equal(guess(3, 1, 11, 'x2160p.x265.mkv'), 'original', '2160p is no year');
  assert.equal(guess(2, 29, 0, BLURAY), null, 'Infinity War is not Endgame');
  assert.equal(guess(0, 3, 20, BLURAY), null, 'a test clip');
  assert.equal(guess(3, 31, 0, BLURAY), null, 'longer than any copy of the film');
  assert.equal(C.guessFilmVersion(NaN, BLURAY), null);
  assert.equal(C.guessFilmVersion(0), null);
  assert.equal(C.guessFilmVersion(-5), null);
  assert.equal(C.guessFilmVersion(10871), C.FILM_VERSIONS[0], 'no name at all');
});

// A run of frames as the app measures them: brightness of the middle of the picture, and how much of it is white.
function strip(opts) {
  const fps = opts.fps || 24;
  const out = [];
  for (let i = 0; i < Math.round((opts.to - opts.from) * fps); i++) {
    const t = opts.from + i / fps;
    let k = 0;
    for (const f of opts.flashes || []) k = Math.max(k, Math.max(0, Math.min(1, (t - f.at) / (f.rise || 0.1666))) * Math.max(0, Math.min(1, (f.at + (f.hold || 1.7) - t) / (f.fade || 0.7))));
    const calm = opts.calm != null ? opts.calm : 0.3;
    const peak = opts.peak != null ? opts.peak : 1;
    const mean = calm + (peak - calm) * k;
    out.push({ t: t, mean: mean, white: peak >= 0.99 ? (k >= 0.97 ? 1 : k > 0.8 ? 0.5 : 0) : 0 });
  }
  return out;
}

test('findFlash: the white-out of the snap, and the frame on which it begins', () => {
  // The picture begins to brighten on the frame after 101.5 and is white all over four frames later.
  const fr = strip({ from: 98, to: 106, flashes: [{ at: 101.5 }] });
  const f = C.findFlash(fr, { expect: 100 });
  assert.ok(f);
  assert.equal(f.kind, 'white');
  assert.ok(Math.abs(fr[f.rise].t - 101.5417) < 0.001, 'the first brighter frame: ' + fr[f.rise].t);
  assert.ok(Math.abs(fr[f.start].t - 101.6667) < 0.001, 'the first frame that is white all over: ' + fr[f.start].t);
  assert.ok(fr[f.end].t > 102.3 && fr[f.end].t < 102.7);
  assert.ok(f.duration > 0.7 && f.duration < 1.1);

  // A hard cut to white: the flash begins on the white frame itself.
  const cut = strip({ from: 10, to: 16, flashes: [{ at: 12, rise: 0.001 }] });
  const c = C.findFlash(cut);
  assert.equal(c.rise, c.start);
  assert.ok(Math.abs(cut[c.start].t - 12.0417) < 0.001);

  // At 6 frames a second (the long test clips) there is no room for a ramp either.
  const slow = strip({ from: 9028, to: 9036, fps: 6, flashes: [{ at: 9031.5 }] });
  const s6 = C.findFlash(slow);
  assert.ok(Math.abs(slow[s6.rise].t - 9031.6667) < 0.001, String(slow[s6.rise].t));

  // Nothing there, too little to go by, or white from the very first frame (no beginning to point at).
  assert.equal(C.findFlash(strip({ from: 0, to: 8 })), null);
  assert.equal(C.findFlash([]), null);
  assert.equal(C.findFlash(null), null);
  assert.equal(C.findFlash(fr.slice(0, 3)), null);
  assert.equal(C.findFlash(strip({ from: 101.7, to: 102.3, flashes: [{ at: 101.5 }] })), null);

  // One white frame is a camera flash or a cut, not the snap.
  const blip = strip({ from: 0, to: 6 });
  blip[60].white = 1; blip[60].mean = 1;
  assert.equal(C.findFlash(blip), null);

  // Two white-outs: the longer one; of two equals, the one nearer to where the snap is expected.
  const two = strip({ from: 0, to: 30, flashes: [{ at: 5, hold: 0.6, fade: 0.2 }, { at: 20 }] });
  assert.ok(Math.abs(two[C.findFlash(two, { expect: 5 }).start].t - 20.1667) < 0.001, 'the longer white-out wins even when it is further away');
  const twins = strip({ from: 0, to: 30, flashes: [{ at: 5 }, { at: 20 }] });
  assert.ok(Math.abs(twins[C.findFlash(twins, { expect: 6 }).start].t - 5.1667) < 0.001);
  assert.ok(Math.abs(twins[C.findFlash(twins, { expect: 19 }).start].t - 20.1667) < 0.001);

  // A flash that does not reach pure white is still found, and says so.
  const dim = strip({ from: 0, to: 10, calm: 0.2, peak: 0.8, flashes: [{ at: 4 }] });
  const d = C.findFlash(dim);
  assert.equal(d.kind, 'bright');
  assert.ok(dim[d.start].t > 4 && dim[d.start].t < 4.3);
  // A picture that is bright all the time is not a flash.
  assert.equal(C.findFlash(strip({ from: 0, to: 10, calm: 0.8, peak: 0.8, flashes: [{ at: 4 }] })), null);

  // A fast sweep that sees only every fifth frame still finds it.
  const sparse = strip({ from: 60, to: 160, flashes: [{ at: 101.5 }] }).filter((x, i) => i % 5 === 0);
  const sp = C.findFlash(sparse, { expect: 100, minDur: 0.2 });
  assert.ok(sp && Math.abs(sparse[sp.start].t - 101.7) < 0.25, String(sp && sparse[sp.start].t));
});

test('findFlash and judgeSnap: what a real film can do to the flash, and when the app may say "found"', () => {
  // Frames of a 24 fps film with a little grain; a white-out begins at `at`.
  const film = (o) => {
    let seed = o.seed || 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const fps = o.fps || 24;
    const out = [];
    for (let i = 0; i < Math.round((o.to - o.from) * fps); i++) {
      const t = o.from + i / fps;
      let mean = (o.level == null ? 0.2 : o.level) + (rnd() - 0.5) * 0.02;
      let white = 0;
      for (const w of o.whites || []) {
        const k = Math.floor((t - w.at) * fps + 1e-6);
        const ramp = w.ramp || 0;
        if (k < 0 || t > w.at + ramp / fps + (w.hold || 1)) continue;
        const a = ramp ? Math.min(1, (k + 1) / (ramp + 1)) : 1;
        mean = mean + (1 - mean) * a;
        white = a >= 0.999 ? 1 : a > 0.8 ? 0.8 : 0;
      }
      for (const b of o.shots || []) if (t >= b.at && t < b.at + b.dur) mean = b.level + (rnd() - 0.5) * 0.02;
      out.push({ t: t, mean: mean, white: white });
    }
    return out;
  };
  const at = (fr, t) => fr.findIndex((f) => f.t >= t - 1e-6);
  const SNAP = 9031.5;
  const line = { end: 9031.44, checked: true };

  // One clean white-out where the snap is expected: found, with or without the line.
  const clean = film({ from: 9027, to: 9037, whites: [{ at: SNAP, ramp: 3 }] });
  let j = C.judgeSnap(clean, null, { expect: 9030 });
  assert.equal(j.verdict, 'found');
  assert.equal(j.why, 'flash');
  assert.equal(j.flash.rise, at(clean, SNAP));
  j = C.judgeSnap(clean, line, { expect: 9030 });
  assert.equal(j.verdict, 'found');
  assert.equal(j.why, 'flash+line');
  assert.ok(Math.abs(j.after - 0.06) < 0.01);

  // A brighter shot (the glowing gauntlet) half a second before the cut to white: the cut is the flash.
  const shot = film({ from: 9027, to: 9037, shots: [{ at: SNAP - 0.5, dur: 0.5, level: 0.55 }], whites: [{ at: SNAP }] });
  assert.equal(C.findFlash(shot, { expect: 9030 }).rise, at(shot, SNAP));

  // A frame on the way up that is nearly white does not hide the white-out.
  const band = film({ from: 9027, to: 9037, whites: [{ at: SNAP, ramp: 5, hold: 4 }] });
  assert.equal(C.findFlash(band).kind, 'white');

  // A frame that flickers darker inside the white-out does not split it.
  const flicker = film({ from: 9027, to: 9037, whites: [{ at: SNAP, ramp: 2 }] });
  const s0 = flicker.findIndex((f) => f.white >= 0.88);
  flicker[s0 + 2].white = 0.5; flicker[s0 + 2].mean = 0.9;
  assert.equal(C.findFlash(flicker).rise, at(flicker, SNAP));

  // Two white-outs and no line: nothing says which is the snap, so the app asks.
  const two = film({ from: 9027, to: 9037, whites: [{ at: SNAP }, { at: SNAP + 3, hold: 1.5 }] });
  j = C.judgeSnap(two, null, { expect: 9030 });
  assert.equal(j.verdict, 'ask');
  assert.equal(j.why, 'rivals');
  // With the line, the one right after it is the snap, even though the other is longer.
  j = C.judgeSnap(two, line, { expect: 9030 });
  assert.equal(j.verdict, 'found');
  assert.equal(j.flash.rise, at(two, SNAP));

  // A white-out that is not right after the line: the witnesses disagree, nothing is set.
  const late = film({ from: 9027, to: 9040, whites: [{ at: 9035 }] });
  assert.equal(C.judgeSnap(late, line, { expect: 9030 }).why, 'disagree');
  // Frames that do not cover the whole moment after the line cannot speak for it.
  assert.equal(C.judgeSnap(film({ from: 9030.5, to: 9040, whites: [{ at: SNAP }] }), line, { expect: 9030 }).why, 'edge');

  // Frames the PC skipped right where the flash begins: the app asks.
  const holey = film({ from: 9027, to: 9037, whites: [{ at: SNAP, ramp: 2 }] });
  holey.splice(at(holey, SNAP) - 1, 3);
  assert.equal(C.judgeSnap(holey, null, { expect: 9030 }).why, 'holes');

  // Found far from where it was expected (the wide search), with no line: set, but not marked.
  const far = film({ from: 9053, to: 9060, whites: [{ at: 9056.5 }] });
  assert.equal(C.judgeSnap(far, null, { expect: 9030, wide: true }).verdict, 'likely');
  // ...unless an armed countdown lent the film: then only a sure find may change it.
  assert.equal(C.judgeSnap(far, null, { expect: 9030, wide: true, lent: true }).verdict, 'ask');
  // ...and not when the wide search saw another white-out that could be it.
  assert.equal(C.judgeSnap(far, null, { expect: 9030, wide: true, rivals: 1 }).why, 'rivals');

  // A white-out shorter than 0.3 s with no line, or shorter than 0.2 s with one: too short to be sure.
  const blink = film({ from: 9027, to: 9037, whites: [{ at: SNAP, hold: 0.15 }] });
  assert.equal(C.judgeSnap(blink, null, { expect: 9030 }).why, 'short');
  assert.equal(C.judgeSnap(blink, line, { expect: 9030 }).why, 'short');

  // No flash at all: a checked line gives an estimate a moment after it; an unchecked one nothing.
  const none = film({ from: 9027, to: 9037 });
  j = C.judgeSnap(none, line, { expect: 9030 });
  assert.equal(j.verdict, 'estimate');
  assert.equal(j.at, 9031.54);
  assert.equal(C.judgeSnap(none, { end: 9031.44, checked: false }, { expect: 9030 }).verdict, 'ask');
  assert.equal(C.judgeSnap(none, line, { expect: 9030, lent: true }).verdict, 'ask');
  // An unchecked line is no witness: close to the flash it changes nothing, far from it it is a
  // reason to ask.
  assert.equal(C.judgeSnap(clean, { end: 9031.0, checked: false }, { expect: 9030 }).verdict, 'found');
  assert.equal(C.judgeSnap(clean, { end: 9020, checked: false }, { expect: 9030 }).why, 'hint');

  // From the second review. A short brighter moment, then a cut to white: either could be the flash.
  for (const bump of [0.06, 0.1, 0.14]) {
    const fr = film({ from: 9027, to: 9037, whites: [{ at: SNAP }] });
    const i = at(fr, SNAP);
    fr[i - 1].mean = 0.2 + bump;                                 // one brighter frame right before the white
    const v = C.judgeSnap(fr, line, { expect: 9030 });
    assert.ok(v.verdict === 'ask' || (v.verdict === 'found' && v.flash.rise === i - 1), bump + ': ' + v.verdict + ' ' + v.why + ' ' + v.flash.rise + '/' + (i - 1));
  }
  // A steady ramp shown with a repeated picture (24 fps pictures in a 25 fps file): its start.
  const rep25 = [];
  for (let k = 0; k < 250; k++) rep25.push({ t: 9027 + k / 25, mean: 0.2, white: 0 });
  const r0 = at(rep25, SNAP);
  [[0.466, 0], [0.466, 0], [0.735, 0], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]].forEach(([m, w], k) => { rep25[r0 + k].mean = m; rep25[r0 + k].white = w; });
  const v25 = C.judgeSnap(rep25, line, { expect: 9030 });
  assert.ok(v25.verdict === 'ask' || v25.flash.rise === r0, v25.verdict + ' ' + v25.flash.rise + '/' + r0);
  // A glow that built up for a while, then the cut to white: the cut is the flash.
  const glow = film({ from: 9027, to: 9037, whites: [{ at: SNAP }] });
  const g0 = at(glow, SNAP);
  for (let k = 1; k <= 14; k++) glow[g0 - k].mean = 0.2 + 0.3 * (15 - k) / 15;
  assert.equal(C.findFlash(glow).rise, g0);
  // The flash flickers: a white burst of a frame or two, a dip, then the white-out. Ask.
  const flick = film({ from: 9027, to: 9037, whites: [{ at: SNAP + 0.3 }] });
  const b0 = at(flick, SNAP);
  flick[b0].mean = 1; flick[b0].white = 1; flick[b0 + 1].mean = 1; flick[b0 + 1].white = 1;
  for (let k = 2; k < 7; k++) flick[b0 + k].mean = 0.45;
  assert.equal(C.judgeSnap(flick, line, { expect: 9030 }).why, 'burst');
  assert.equal(C.judgeSnap(flick, null, { expect: 9030 }).why, 'burst');
  // The snap might be a bright flash that is not white: with another white-out close by, ask.
  const warm = film({ from: 9027, to: 9037, whites: [{ at: 9033.04, hold: 0.4 }] });
  for (let k = 0; k < 15; k++) { const w = warm[at(warm, 9031.74) + k]; w.mean = 0.78; w.white = 0.1; }
  assert.equal(C.judgeSnap(warm, line, { expect: 9030 }).why, 'crowd');
  assert.equal(C.judgeSnap(warm, null, { expect: 9030 }).why, 'rivals');
  // A climb that began before the first frame looked at: where it began was not seen.
  const cutoff = film({ from: SNAP + 0.1, to: SNAP + 8, whites: [{ at: SNAP, ramp: 8 }] });
  assert.equal(C.judgeSnap(cutoff, null, { expect: SNAP }).why, 'open');
  // A subtitle file nobody checked puts the line 25 s away from the flash: a reason to ask.
  assert.equal(C.judgeSnap(clean, { end: 9056.4, checked: false }, { expect: 9030 }).why, 'hint');

  // 24 fps pictures in a 60 fps file (each shown two or three times): the first frame of the flash.
  const src = film({ from: 9027, to: 9037, whites: [{ at: SNAP, ramp: 2 }] });
  const sixty = [];
  for (let i = 0; i < 590; i++) {
    const t = 9027 + i / 60;
    let k = 0;
    while (k + 1 < src.length && src[k + 1].t <= t + 1e-9) k++;
    sixty.push({ t: t, mean: src[k].mean, white: src[k].white });
  }
  const first = sixty.findIndex((f) => f.t >= SNAP - 1e-6);
  const f60 = C.findFlash(sixty);
  assert.ok(Math.abs(f60.rise - first) <= 1, 'rise ' + f60.rise + ' / ' + first);
});

test('findSnapLine: the line before the snap, wherever the subtitles put it', () => {
  // The cues of the 4K Blu-ray, as published: the line is split over three, seconds apart.
  const disc = [
    { start: 8998.198, end: 9001.702, text: 'I am... inevitable.' },
    { start: 9021.847, end: 9023.390, text: 'And I...' },
    { start: 9025.058, end: 9026.226, text: 'am...' },
    { start: 9029.938, end: 9031.440, text: 'Iron Man.' },
    { start: 9150.142, end: 9151.852, text: 'Mr. Stark?' }
  ];
  assert.deepEqual(C.findSnapLine(disc, 9030), { start: 9021.847, end: 9031.440, text: 'And I... am... Iron Man.' });
  // Captions for the hard of hearing put sounds in between, in brackets.
  const sdh = [
    { start: 8996.610, end: 9000.213, text: 'I am inevitable.' },
    { start: 9018.2, end: 9019.9, text: 'And I...' },
    { start: 9021.835, end: 9023.501, text: '(PANTING)' },
    { start: 9023.503, end: 9024.637, text: 'am...' },
    { start: 9026.0, end: 9027.0, text: '[GAUNTLET POWERS UP]' },
    { start: 9028.408, end: 9029.809, text: '<i>Iron Man.</i>' }
  ];
  const hit = C.findSnapLine(sdh, 9030);
  assert.equal(hit.end, 9029.809);
  assert.equal(hit.start, 9018.2);
  assert.equal(hit.text, 'And I... am... Iron Man.');
  // Two cues, one cue, other punctuation.
  const cues = [
    { start: 100, end: 102, text: 'I am... inevitable.' },
    { start: 9021.2, end: 9023.0, text: 'And I...' },
    { start: 9023.4, end: 9026.1, text: '<i>am... Iron Man.</i>' },
    { start: 9500, end: 9502, text: 'Everybody wants a happy ending.' }
  ];
  assert.deepEqual(C.findSnapLine(cues, 9030), { start: 9021.2, end: 9026.1, text: 'And I... am... Iron Man.' });
  assert.deepEqual(C.findSnapLine([{ start: 5, end: 8, text: 'And I... am... Iron Man.' }], 9030), { start: 5, end: 8, text: 'And I... am... Iron Man.' });
  assert.deepEqual(C.findSnapLine([{ start: 5, end: 8, text: '- And I am\nIron-Man.' }], 0), { start: 5, end: 8, text: '- And I am Iron-Man.' });
  // The same words twice in a film: the one nearest to where the snap is expected.
  const twice = [{ start: 600, end: 602, text: 'I am Iron Man.' }, { start: 9024, end: 9026, text: 'I am Iron Man.' }];
  assert.equal(C.findSnapLine(twice, 9030).start, 9024);
  assert.equal(C.findSnapLine(twice, 500).start, 600);
  // Not the line.
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'I am inevitable.' }, { start: 3, end: 4, text: 'Iron Man is here.' }, { start: 30, end: 31, text: 'I am' }], 0), null);
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'And I...' }, { start: 60, end: 62, text: 'am Iron Man' }], 0), null, 'two cues a minute apart are not one line');
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'I am... inevitable.' }, { start: 22, end: 23, text: 'Iron Man.' }], 0), null, 'the other man\'s "I am" is not the beginning of this line');
  assert.equal(C.findSnapLine([], 0), null);
  assert.equal(C.findSnapLine(null, 0), null);
  // Real files: machine-read discs write "l" for "I", some put the speaker's name in front, captions
  // for the hard of hearing come between the words, and "I'm" is said for "I am".
  const three = (x, y, z, more) => [{ start: 9021.847, end: 9023.390, text: x }].concat(more || [], [{ start: 9025.058, end: 9026.226, text: y }, { start: 9029.938, end: 9031.440, text: z }]).sort((p, q) => p.start - q.start);
  assert.equal(C.findSnapLine(three('And l...', 'am...', 'lron Man.'), 9030).end, 9031.44);
  assert.equal(C.findSnapLine(three('TONY: And I...', 'TONY: am...', 'TONY: Iron Man.'), 9030).end, 9031.44);
  assert.equal(C.findSnapLine(three('And I...', 'am...', 'Iron Man.', [{ start: 9023.5, end: 9024, text: '(PANTING)' }, { start: 9024.1, end: 9024.9, text: '[GRUNTS]' }, { start: 9026.4, end: 9029.8, text: '[energy crackling]' }]), 9030).end, 9031.44);
  assert.equal(C.findSnapLine(three('And I...', '[grunting\nam...', 'Iron Man.'), 9030).end, 9031.44);
  assert.equal(C.findSnapLine([{ start: 9024, end: 9031.44, text: "And I'm... Iron Man." }], 9030).end, 9031.44);
  // Only near where the snap is expected: the words said five minutes into the film do not count.
  assert.equal(C.findSnapLine([{ start: 300, end: 302, text: 'I am Iron Man.' }], 9030, { before: 240, after: 360 }), null);
  assert.equal(C.findSnapLine([{ start: 9300, end: 9302, text: 'I am Iron Man.' }], 9030, { before: 240, after: 360 }).end, 9302);
  // Another language: no line, rather than a wrong one.
  assert.equal(C.findSnapLine(three('Y yo...', 'soy...', 'Iron Man.'), 9030), null);
});

test('languages: codes, names and titles', () => {
  for (const [input, want] of [['eng', 'eng'], ['en', 'eng'], ['EN-us', 'eng'], ['English', 'eng'], ['hin', 'hin'], ['hi', 'hin'],
    ['fre', 'fra'], ['ger', 'deu'], ['chi', 'zho'], ['und', ''], ['', ''], [null, ''], ['xx', 'xx'], ['not a code', '']]) {
    assert.equal(C.normLang(input), want, String(input));
  }
  assert.equal(C.langName('eng'), 'English');
  assert.equal(C.langName('hi'), 'Hindi');
  assert.equal(C.langName('und'), '');
  assert.equal(C.langName('xx'), 'XX');
  assert.equal(C.langFromTitle('Org Hindi DDP 5.1 - 640Kbps'), 'hin');
  assert.equal(C.langFromTitle('English DD 5.1'), 'eng');
  assert.equal(C.langFromTitle('Surround 5.1'), '');
  assert.equal(C.langFromTitle('Finnish'), 'fin');
  assert.equal(C.langFromTitle('unfinished'), '', 'a language name inside another word does not count');
  assert.equal(C.trackLang({ lang: 'und', title: 'English DD 5.1' }), 'eng');
  assert.equal(C.trackLang({ language: 'hin', label: 'SoundHandler' }), 'hin');
  assert.equal(C.trackLang(null), '');
});

test('sound track choice: English by default, whatever the file calls its main track', () => {
  const pick = (tracks, lang) => C.pickAudioTrack(tracks, lang);
  // The real case that went wrong: Hindi first and flagged as the main track, English second.
  const pahe = [{ lang: 'hin', title: 'Org Hindi DDP 5.1', isDefault: true }, { lang: 'eng', title: 'English DD 5.1', isDefault: false }];
  assert.equal(pick(pahe), 1, 'English wins over the default flag');
  assert.equal(pick(pahe, 'eng'), 1);
  assert.equal(pick(pahe, 'hin'), 0, 'another preferred language is honoured');
  assert.equal(pick(pahe, 'hi'), 0);
  assert.equal(pick(pahe, 'fra'), 0, 'no French track: the file\'s own main track');
  // Languages only in the titles.
  assert.equal(pick([{ lang: '', title: 'Hindi 5.1' }, { lang: 'und', title: 'English 5.1' }]), 1);
  // No English: a track that does not say what it is beats one that says it is something else.
  assert.equal(pick([{ lang: 'hin', isDefault: true }, { lang: '' }]), 1, 'next to a labelled dub, the unlabelled track is tried');
  assert.equal(pick([{ lang: '' }, { lang: 'hin', isDefault: true }]), 0);
  assert.equal(pick([{ lang: 'hin', isDefault: true }, { lang: 'tam' }]), 0, 'two other languages: the file\'s main track');
  assert.equal(pick([{ lang: 'hin' }, { lang: 'tam', isDefault: true }]), 1);
  // Nothing known: the default flag, else the first.
  assert.equal(pick([{ lang: '' }, { lang: '', isDefault: true }]), 1);
  assert.equal(pick([{ lang: '' }, { lang: '' }]), 0);
  // A commentary is never chosen over the film's own sound, even when it comes first.
  assert.equal(pick([{ lang: 'eng', title: 'Director Commentary', isDefault: true }, { lang: 'eng', title: 'English 5.1' }]), 1);
  assert.equal(pick([{ lang: 'eng', title: 'English 5.1' }, { lang: 'eng', title: 'Commentary' }]), 0);
  assert.equal(pick([{ lang: 'eng', title: 'Commentary' }]), 0, 'the only track is still a track');
  // Two English tracks: the first.
  assert.equal(pick([{ lang: 'hin' }, { lang: 'eng', title: 'English 7.1' }, { lang: 'eng', title: 'English 2.0' }]), 1);
  assert.equal(pick([]), -1);
  assert.equal(pick(null), -1);
});

// ---- subtitles and voices: simulated films, since no real one can be shipped with the tests
function rng(seed) { let x = seed >>> 0; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }
function filmCues(rand, dur) {                         // stretches of dialogue, action scenes in between
  const cues = [];
  let t = 30;
  while (t < dur - 600) {
    const end = t + 20 + rand() * 120;
    while (t < end) { const d = 0.8 + rand() * 3.2; cues.push({ start: t, end: t + d }); t += d + 0.1 + rand() * 2.5; }
    t += rand() < 0.25 ? 30 + rand() * 240 : rand() * 20;
  }
  return cues;
}
function filmSound(rand, cues, from, dur, hz, o) {     // speech inside most lines, other loud things elsewhere
  const n = Math.round(dur * hz);
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = 1e-5 * (0.5 + rand());
  for (const c of cues) {
    if (rand() < o.miss) continue;
    for (let t = c.start + rand() * 0.3; t < c.end - rand() * 0.6; t += 1 / hz) {
      const i = Math.round((t - from) * hz);
      if (i >= 0 && i < n) e[i] += 1e-2 * (0.3 + rand()) * (Math.sin(t * 25) > -0.6 ? 1 : 0.05);
    }
  }
  for (let t = from; t < from + dur; t += 1 + rand() * 6) {
    if (rand() >= o.noise) continue;
    const d = 0.5 + rand() * 6;
    for (let x = t; x < t + d; x += 1 / hz) { const i = Math.round((x - from) * hz); if (i >= 0 && i < n) e[i] += 2e-2 * rand(); }
    t += d;
  }
  return e;
}

test('speechPlan: a short film whole, a long one in stretches where the talking is', () => {
  assert.deepEqual(C.speechPlan(200, []), [{ from: 0, dur: 200 }]);
  assert.deepEqual(C.speechPlan(5, []), []);
  assert.deepEqual(C.speechPlan(NaN, []), []);
  const cues = filmCues(rng(7), 10871);
  const plan = C.speechPlan(10871, cues);
  assert.equal(plan.length, 15);
  for (let i = 0; i < plan.length; i++) {
    assert.equal(plan[i].dur, 240);
    assert.ok(plan[i].from >= 0 && plan[i].from + 240 < 10871);
    if (i) assert.ok(plan[i].from >= plan[i - 1].from + 240, 'stretches do not overlap');
  }
  const total = plan.reduce((sum, w) => sum + w.dur, 0);
  assert.ok(total <= 60 * 60, 'no more than an hour of a three-hour film');
  // Each stretch sits where there are lines, not in an action scene.
  const covered = (w) => cues.reduce((sum, c) => sum + Math.max(0, Math.min(c.end, w.from + w.dur) - Math.max(c.start, w.from)), 0);
  assert.ok(plan.filter((w) => covered(w) > 45).length >= 13);
  // A film of twenty-odd minutes: the stretches shrink rather than overlap.
  const short = C.speechPlan(1250, cues);
  for (let i = 1; i < short.length; i++) assert.ok(short[i].from >= short[i - 1].from + short[i - 1].dur, 'no overlap in a short film');
  // A huge file is slow to read: with ten minutes of listening allowed, fewer and shorter stretches.
  const lean = C.speechPlan(10871, cues, 600);
  assert.equal(lean.length, 10);
  assert.ok(lean.every((w) => w.dur === 60));
  assert.ok(lean.reduce((sum, w) => sum + w.dur, 0) <= 600);
  const mid = C.speechPlan(10871, cues, 1500);
  assert.equal(mid.length, 15);
  assert.ok(mid.every((w) => w.dur === 100));
  assert.ok(C.speechPlan(10871, cues, 99999).every((w) => w.dur === 240), 'never more than four minutes at a stretch');
  assert.ok(C.speechPlan(10871, cues, 100).length >= 4, 'never fewer than four stretches');
});

test('betterFit: the likeliest speeds are tried first and a later one has to be clearly better', () => {
  assert.equal(C.SUB_SCALES[0], 1);
  assert.ok(Math.abs(C.SUB_SCALES[1] - 25000 / 23976) < 1e-12 && Math.abs(C.SUB_SCALES[2] - 23976 / 25000) < 1e-12);
  const own = { scale: 1, peak: 100 };
  assert.equal(C.betterFit(null, own), own);
  assert.equal(C.betterFit(own, null), own);
  // On a short film another speed fits a hair better by chance: the file's own speed stays.
  assert.equal(C.betterFit(own, { scale: 1.001, peak: 102 }), own);
  const pal = { scale: 25000 / 23976, peak: 140 };
  assert.equal(C.betterFit(own, pal), pal);
  // 25/24 and 25000/23976 are a tenth of a percent apart: the commoner one wins a near tie.
  assert.equal(C.betterFit(pal, { scale: 25 / 24, peak: 141 }), pal);
  const near = { scale: 25 / 24, peak: 143 };
  assert.equal(C.betterFit(pal, near), near);
});

test('alignCues: shift and speed of a subtitle file, found from the voices', () => {
  const DUR = 10871;
  const HZ = 50;
  const rand = rng(101);
  const film = filmCues(rand, DUR);
  const heard = (e, from) => { const sc = C.speechScore(e, HZ); return { from: from, hz: HZ, score: sc.score, sharp: sc.sharp }; };
  const hear = (o) => C.speechPlan(DUR, film).map((w) => heard(filmSound(rand, film, w.from, w.dur, HZ, o), w.from));
  const asFile = (off, scale) => film.map((c) => ({ start: (c.start - off) / scale, end: (c.end - off) / scale })).filter((c) => c.start > 0);
  const clean = hear({ miss: 0.1, noise: 0.2 });
  const noisy = hear({ miss: 0.3, noise: 0.5 });
  for (const [wins, name] of [[clean, 'clean'], [noisy, 'noisy']]) {
    for (const [off, scale] of [[0, 1], [2.4, 1], [-37.3, 1], [61, 1], [1.2, 25000 / 23976], [-0.8, 23976 / 24000]]) {
      // Against sound the answer is good to a few tenths of a second: lines stay on screen after
      // the voice has stopped, by an amount no two subtitle files agree on.
      const r = C.alignCues(wins, asFile(off, scale), { linger: 0.25 });
      assert.ok(Math.abs(r.offset - off) < 0.3, name + ': offset ' + r.offset + ' for ' + off);
      assert.ok(Math.abs(r.scale - scale) < 1e-4, name + ': speed ' + r.scale + ' for ' + scale);
      assert.ok(r.z > 6 && r.strength > 0.25, name + ': z ' + r.z.toFixed(1) + ', strength ' + r.strength.toFixed(2));
      assert.ok(r.contrast > 0.2 && r.lines > 100, name + ': contrast ' + r.contrast.toFixed(2) + ', lines ' + r.lines);
      assert.equal(r.confident, true, name + ' ' + off + '/' + scale);
      assert.equal(r.mixed, false);
    }
  }
  // The subtitles of another film: whatever comes out is not believed.
  for (const seed of [900, 901, 902]) {
    const other = C.alignCues(clean, filmCues(rng(seed), DUR), { linger: 0.25 });
    assert.equal(other.confident, false, 'another film: z ' + other.z.toFixed(1) + ', strength ' + other.strength.toFixed(2));
  }
  // Subtitles made for another cut: the first half fits at +2 s, the second at +14 s.
  const cut = film.map((c) => { const off = c.start < DUR / 2 ? 2 : 14; return { start: c.start - off, end: c.end - off }; });
  const split = C.alignCues(clean, cut, { linger: 0.25 });
  assert.equal(split.mixed, true);
  // Which half won is a toss-up; what counts is that the other half is named with its own shift.
  const [main, rest] = Math.abs(split.offset - 2) < 0.3 ? [2, 14] : [14, 2];
  assert.ok(Math.abs(split.offset - main) < 0.3, 'one half fits at ' + split.offset);
  assert.ok(Math.abs(split.other.offset - rest) <= 0.4 && split.other.count >= 3, 'and the other half would fit at ' + JSON.stringify(split.other));
  assert.ok(main === 2 ? split.other.from > DUR / 2 - 200 : split.other.from < DUR / 2);
  // A film where a few stretches are drowned in noise is not "another cut": nothing else fits there either.
  const drowned = clean.map((w, i) => (i % 5 === 2 ? heard(filmSound(rng(5000 + i), [], w.from, 240, HZ, { miss: 1, noise: 0.9 }), w.from) : w));
  const patchy = C.alignCues(drowned, asFile(2.4, 1), { linger: 0.25 });
  assert.ok(Math.abs(patchy.offset - 2.4) < 0.3 && patchy.confident, 'still found: ' + patchy.offset);
  assert.equal(patchy.mixed, false, JSON.stringify(patchy.other));
  // Nothing to go by.
  assert.equal(C.alignCues([], film), null);
  assert.equal(C.alignCues(clean, []), null);
  assert.equal(C.alignCues(null, null), null);
  // A reference that is itself a set of subtitles (the movie's own): ones and zeros instead of sound.
  const ref = C.speechPlan(DUR, film).map((w) => {
    const score = new Float32Array(w.dur * HZ);
    for (const c of film) for (let i = Math.max(0, Math.round((c.start - w.from) * HZ)); i < Math.min(score.length, Math.round((c.end - w.from) * HZ)); i++) score[i] = 1;
    return { from: w.from, hz: HZ, score: score };
  });
  const viaSubs = C.alignCues(ref, asFile(-3.5, 1));
  assert.ok(Math.abs(viaSubs.offset + 3.5) < 0.05 && viaSubs.confident && viaSubs.strength > 0.9, JSON.stringify({ o: viaSubs.offset, s: viaSubs.strength }));
});

test('alignCues: a film without speech gives no answer, whatever its sound does', () => {
  const HZ = 50;
  const few = [[93, 95], [96.5, 97.4], [97.6, 98.3], [99.1, 100.6], [140, 142]].map(([a, b]) => ({ start: a, end: b }));
  const many = filmCues(rng(3), 1500).filter((c) => c.end < 158);
  assert.ok(many.length >= 12, 'enough lines for the test: ' + many.length);
  const sounds = {
    // One steady tone with a click where the recording starts and one in the middle.
    hum: () => { const e = new Float32Array(160 * HZ).fill(1e-2); for (let i = 0; i < 20; i++) { e[i] = 0.2; e[3000 + i] = 0.2; } return e; },
    // Digital silence.
    silence: () => new Float32Array(160 * HZ),
    // Music that swells and fades on a beat of its own.
    music: () => { const e = new Float32Array(160 * HZ); for (let i = 0; i < e.length; i++) e[i] = 1e-3 * (1.2 + Math.sin(i / 37) + 0.5 * Math.sin(i / 11)) ** 2; return e; },
    // Noise.
    noise: () => { const r = rng(41); const e = new Float32Array(160 * HZ); for (let i = 0; i < e.length; i++) e[i] = 1e-3 * (0.2 + r()); return e; }
  };
  for (const [name, make] of Object.entries(sounds)) {
    const sc = C.speechScore(make(), HZ);
    const wins = [{ from: 0, hz: HZ, score: sc.score, sharp: sc.sharp }];
    for (const [cues, what] of [[few, 'five lines'], [many, 'many lines']]) {
      const r = C.alignCues(wins, cues, { linger: 0.25 });
      assert.ok(r === null || r.confident === false, name + ', ' + what + ': ' + JSON.stringify(r && { o: r.offset, z: r.z, s: r.strength, c: r.contrast, l: r.lines }));
    }
  }
  // Five lines are not enough to go by against sound, even when they do fit…
  const e = new Float32Array(160 * HZ).fill(1e-5);
  for (const c of few) for (let i = Math.round(c.start * HZ); i < Math.round(c.end * HZ); i++) e[i] = 1e-2;
  const sp = C.speechScore(e, HZ);
  const spoken = [{ from: 0, hz: HZ, score: sp.score, sharp: sp.sharp }];
  const thin = C.alignCues(spoken, few.map((c) => ({ start: c.start - 3, end: c.end - 3 })), {});
  assert.ok(Math.abs(thin.offset - 3) < 0.1 && thin.lines === 5 && thin.confident === false, JSON.stringify({ o: thin.offset, l: thin.lines }));
  // …but against another set of subtitles of the same film they are (the caller asks for it).
  const ref = new Float32Array(160 * HZ);
  for (const c of few) for (let i = Math.round(c.start * HZ); i < Math.round(c.end * HZ); i++) ref[i] = 1;
  const twin = C.alignCues([{ from: 0, hz: HZ, score: ref }], few.map((c) => ({ start: c.start + 20, end: c.end + 20 })), { minLines: 3 });
  assert.ok(Math.abs(twin.offset + 20) < 0.05 && twin.confident && twin.strength > 0.9, JSON.stringify({ o: twin.offset, s: twin.strength, z: twin.z }));
});

test('speechScore: speech stands out against the seconds around it, whatever the level of the recording', () => {
  const HZ = 50;
  const mean = (x, a, b) => { let sum = 0; for (let i = a; i < b; i++) sum += x[i]; return sum / (b - a); };
  let first = null;
  for (const gain of [1, 0.02]) {
    // Twenty seconds of quiet with somebody speaking from 8.0 to 10.0 s, in syllables.
    const e = new Float32Array(20 * HZ);
    for (let i = 0; i < e.length; i++) {
      const t = i / HZ;
      e[i] = gain * (t >= 8 && t < 10 && Math.floor(t * 5) % 2 === 0 ? 1e-2 : 1e-5);
    }
    const sc = C.speechScore(e, HZ);
    assert.equal(sc.score.length, e.length);
    assert.equal(sc.sharp.length, e.length);
    for (const x of [sc.score, sc.sharp]) {
      assert.ok(mean(x, 8 * HZ, 10 * HZ) > 0.15, 'up while somebody speaks: ' + mean(x, 8 * HZ, 10 * HZ));
      assert.ok(mean(x, 10.3 * HZ, 11.5 * HZ) < -0.05, 'down right after: ' + mean(x, 10.3 * HZ, 11.5 * HZ));
      assert.ok(Math.abs(mean(x, 15 * HZ, 19 * HZ)) < 0.02, 'level far from any speech: ' + mean(x, 15 * HZ, 19 * HZ));
    }
    // How loud the recording is makes no difference.
    if (first) for (let i = 0; i < e.length; i += 7) assert.ok(Math.abs(first[i] - sc.score[i]) < 0.02, 'at ' + i + ': ' + first[i] + ' / ' + sc.score[i]);
    first = sc.score;
  }
  // A loud scene is not one long line: a minute of steady loud music scores nothing, where the
  // speech in front of it still does.
  const e = new Float32Array(120 * HZ).fill(1e-5);
  for (let i = 60 * HZ; i < 120 * HZ; i++) e[i] = 5e-2 * (1 + 0.05 * Math.sin(i / 3));
  for (let i = 20 * HZ; i < 22 * HZ; i++) if (Math.floor(i / 10) % 2 === 0) e[i] = 1e-2;
  const sc = C.speechScore(e, HZ);
  assert.ok(Math.abs(mean(sc.sharp, 70 * HZ, 110 * HZ)) < 0.01, 'steady and loud is not speech: ' + mean(sc.sharp, 70 * HZ, 110 * HZ));
  assert.ok(mean(sc.sharp, 20 * HZ, 22 * HZ) > 0.15);
  const none = C.speechScore(new Float32Array(0), HZ);
  assert.equal(none.score.length, 0);
  assert.equal(C.percentile([3, 1, 2], 0.5), 2);
  assert.ok(Number.isNaN(C.percentile([], 0.5)));
});

