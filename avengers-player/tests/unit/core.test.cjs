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

test('pickTimeSample prefers the fastest round trip', () => {
  assert.equal(C.pickTimeSample([]), null);
  const r = C.pickTimeSample([{ rtt: 180, offset: 900 }, { rtt: 22, offset: 512 }, { rtt: 30, offset: 520 }, { rtt: NaN, offset: 1 }]);
  assert.equal(r.offsetMs, 512);
  assert.equal(r.rttMs, 22);
  assert.equal(r.n, 3);
  assert.ok(r.uncertaintyMs >= 11);
});

test('time endpoint parsers', () => {
  assert.equal(C.timeParsers.cloudflareTrace('fl=1\nh=x\nts=1700000000.123\nvisit_scheme=https\n'), 1700000000123);
  assert.ok(Number.isNaN(C.timeParsers.cloudflareTrace('nothing')));
  assert.equal(C.timeParsers.timeApiIo('{"dateTime":"2026-12-31T23:59:59.5001234"}'), Date.parse('2026-12-31T23:59:59.500Z'));
  assert.equal(C.timeParsers.worldTimeApi('{"utc_datetime":"2026-12-31T23:59:59.250000+00:00"}'), Date.parse('2026-12-31T23:59:59.250Z'));
  assert.ok(Number.isNaN(C.timeParsers.worldTimeApi('not json')));
});
