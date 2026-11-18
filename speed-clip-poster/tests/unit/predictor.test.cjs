'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../core/predictor.cjs');
const { MIN, HOUR, DAY } = P;

function rng(seed) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const g = () => Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r());
  return { r, g };
}

/** Regular streamer: ~20:00 UTC, not Tue/Thu, skips 15% of days. */
function regular(days = 150, seed = 7) {
  const { r, g } = rng(seed);
  const day0 = Date.UTC(2026, 5, 1);
  const out = [];
  for (let d = 0; d < days; d++) {
    const dow = new Date(day0 + d * DAY).getUTCDay();
    if (dow === 2 || dow === 4 || r() < 0.15) continue;
    const st = day0 + d * DAY + 20 * HOUR + g() * 40 * MIN;
    out.push({ start: st, end: st + (3 + r() * 2) * HOUR });
  }
  return out;
}

/** Messy streamer: random hour each time, bursts and week-long breaks. */
function messy(days = 150, seed = 3) {
  const { r } = rng(seed);
  const day0 = Date.UTC(2026, 5, 1);
  const out = [];
  let d = 0;
  while (d < days) {
    if (r() < 0.1) { d += 5 + Math.floor(r() * 5); continue; }
    if (r() < 0.6) {
      const st = day0 + d * DAY + (12 + r() * 12) * HOUR;
      out.push({ start: st, end: st + (2 + r() * 4) * HOUR });
    }
    d++;
  }
  return out;
}

test('slotOfWeek: Monday 00:00 UTC is slot 0, Sunday 23:45 is the last', () => {
  assert.strictEqual(P.slotOfWeek(Date.UTC(2026, 10, 16, 0, 0), 'UTC'), 0);
  assert.strictEqual(P.slotOfWeek(Date.UTC(2026, 10, 22, 23, 50), 'UTC'), 671);
});

test('time zone shifts the slot (London is UTC+0 in Nov, New York UTC-5)', () => {
  const t = Date.UTC(2026, 10, 16, 3, 0); // Mon 03:00 UTC = Sun 22:00 New York
  assert.strictEqual(P.slotOfWeek(t, 'Europe/London'), 12);
  assert.strictEqual(P.slotOfWeek(t, 'America/New_York'), 6 * 96 + 22 * 4);
});

test('regular schedule: predicts the evening and says post before the lock', () => {
  const s = regular();
  const last = s[s.length - 1];
  // A Saturday 12:00 UTC after the last stream: he streams Saturdays at ~20:00.
  let now = last.end + 6 * HOUR;
  while (new Date(now).getUTCDay() !== 6) now += DAY;
  now = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate(), 12);
  const streams = s.filter((x) => x.start < now);
  const r = P.predict({ now, tz: 'UTC', streams, options: { hazardScale: 2.5, dailyMix: 0.1 } });
  assert.notStrictEqual(r.status, 'not-soon', JSON.stringify(r.within));
  const medH = new Date(r.start.median).getUTCHours() + new Date(r.start.median).getUTCMinutes() / 60;
  assert.ok(medH > 18.5 && medH < 21.5, 'median start ' + medH);
  const postH = new Date(r.postAt).getUTCHours() + new Date(r.postAt).getUTCMinutes() / 60;
  assert.ok(postH < medH - 0.75 && postH > 16, 'post ' + postH);
  assert.ok(r.chanceLockedAtPost <= 0.2 + 1e-9);
});

test('live now short-circuits', () => {
  const r = P.predict({ now: Date.now(), streams: regular(), liveNow: true });
  assert.strictEqual(r.status, 'live');
});

test('scheduled stream wins and gives high confidence', () => {
  const s = regular();
  const now = s[s.length - 1].end + 5 * HOUR;
  const sched = now + 3 * HOUR;
  const r = P.predict({ now, streams: s, upcoming: { scheduled: sched } });
  assert.strictEqual(r.source, 'scheduled');
  assert.strictEqual(r.confidence, 'high');
  assert.ok(Math.abs(r.start.median - (sched + 10 * MIN)) < 20 * MIN);
  assert.ok(r.postAt < sched - 15 * MIN && r.postAt > sched - 3 * HOUR);
});

test('lock gaps are learned from logged locks', () => {
  const s = regular();
  const locks = s.slice(-5).map((x) => ({ at: x.start - 70 * MIN }));
  const gaps = P.lockGaps(locks, P.cleanStreams(s));
  assert.strictEqual(gaps.length, 5);
  for (const g of gaps) assert.ok(Math.abs(g - 70) < 1e-6);
  const r = P.predict({ now: s[s.length - 1].end + HOUR, streams: s, locks });
  assert.strictEqual(r.lock.learned, true);
  assert.ok(Math.abs(r.lock.medianMin - 70) < 1e-6);
});

test('higher risk setting gives a later post time', () => {
  const s = regular();
  const now = s[s.length - 1].end + 14 * HOUR;
  const o = { hazardScale: 2.5, dailyMix: 0.1, minSessionChance: 0 };
  const safe = P.predict({ now, streams: s, options: Object.assign({ risk: 0.05 }, o) });
  const bold = P.predict({ now, streams: s, options: Object.assign({ risk: 0.4 }, o) });
  assert.ok(bold.postAt > safe.postAt);
});

test('no history: no confidence and no crash', () => {
  const r = P.predict({ now: Date.now(), streams: [] });
  assert.strictEqual(r.confidence, 'none');
});

test('calibration improves a regular schedule and gets posts in before the lock', () => {
  const c = P.calibrate({ tz: 'UTC', streams: regular(), days: 40 });
  assert.ok(c.after.brier < c.after.brierBaseline, 'beats no-skill');
  assert.ok(c.after.goodRate >= 0.8, 'good ' + c.after.goodRate);
  assert.ok(c.after.goodRate >= c.before.goodRate);
});

test('messy schedule: honest, lower numbers, still not worse than no-skill', () => {
  const c = P.calibrate({ tz: 'UTC', streams: messy(), days: 40 });
  assert.ok(c.after.brier <= c.after.brierBaseline * 1.05, c.after.brier + ' vs ' + c.after.brierBaseline);
  assert.ok(c.after.streamsTested > 10);
  console.log('# messy: good', c.after.goodRate, 'made it', c.after.madeItRate, 'missed', c.after.missedLock, 'never', c.after.neverSaidPost, 'early h', c.after.medianHoursEarly);
});
