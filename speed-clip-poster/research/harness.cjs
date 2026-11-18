'use strict';
// Scores a posting strategy on Speed's real past streams, walking forward in time.
//
// Every `tickMin` minutes the strategy is asked "post now?" and sees ONLY the past:
// streams that started before that moment (a stream still running shows as live, with no end).
//
// The rules of the simulation:
//   * The clips channel locks `lockGapMin` minutes before each stream starts and reopens when the
//     stream ends. While locked, posting is impossible (the strategy is told `channelLocked`).
//   * At most `maxPostsPerDay` posts per local day (posting more looks like spam: server rule 2).
//   * Every post uses up one clip (you can't repost the same clip: clip rule 5).
//   * A post is GOOD if it went up at most `windowH` hours before the next lock. Posted earlier than
//     that, it is buried under later clips before Speed gets to it ("wasted").
//
// Per stream we ask: was there at least one good post waiting for it? That is a HIT.
// The cost is clips used: posts per week and wasted posts.

const P = require('../core/predictor.cjs');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function localParts(ms, tz) {
  const d = new Date(ms + P.tzOffset(ms, tz));
  return {
    dayKey: d.toISOString().slice(0, 10),
    hour: d.getUTCHours() + d.getUTCMinutes() / 60,
    dow: (d.getUTCDay() + 6) % 7, // Monday = 0
  };
}

/** Local midnight (in tz) at or before ms. */
function localMidnight(ms, tz) {
  const off = P.tzOffset(ms, tz);
  const local = ms + off;
  return local - (((local % DAY) + DAY) % DAY) - off;
}

function evaluate(strategy, opts = {}) {
  const tz = opts.tz || 'America/New_York';
  const lockGap = (opts.lockGapMin != null ? opts.lockGapMin : 45) * MIN;
  const windowMs = (opts.windowH != null ? opts.windowH : 3) * HOUR;
  const tick = (opts.tickMin || 15) * MIN;
  const maxPerDay = opts.maxPostsPerDay != null ? opts.maxPostsPerDay : 1;
  const streams = P.cleanStreams(opts.streams).map((s) => ({ start: s.start, end: s.end || s.start + 3 * HOUR }));
  const startIndex = opts.startIndex != null ? opts.startIndex : 10;
  if (streams.length <= startIndex) throw new Error('not enough streams');

  const testFrom = localMidnight(streams[startIndex - 1].start, tz) + DAY;
  const targets = streams.filter((s) => s.start >= testFrom);
  const testEnd = targets[targets.length - 1].start + HOUR;

  const posts = [];
  const state = {};
  const postsByDay = {};
  for (let t = testFrom; t < testEnd; t += tick) {
    const startedBefore = streams.filter((s) => s.start < t);
    const live = startedBefore.length > 0 && startedBefore[startedBefore.length - 1].end > t;
    const history = startedBefore.map((s) => ({ start: s.start, end: s.end > t ? null : s.end }));
    const next = streams.find((s) => s.start >= t);
    const lockedForNext = next && t >= next.start - lockGap;
    const channelLocked = live || !!lockedForNext;
    const lp = localParts(t, tz);
    const postsToday = postsByDay[lp.dayKey] || 0;
    const lastPostAt = posts.length ? posts[posts.length - 1].at : null;
    if (channelLocked || postsToday >= maxPerDay) {
      // Still let stateful strategies observe time passing, but no post is possible.
      if (strategy.observe) strategy.observe({ now: t, tz, history, live, channelLocked, lastPostAt, postsToday, local: lp, state });
      continue;
    }
    let wants = false;
    try {
      wants = !!strategy.decide({ now: t, tz, history, live, channelLocked, lastPostAt, postsToday, local: lp, state });
    } catch (e) {
      throw new Error(strategy.name + ' threw at ' + new Date(t).toISOString() + ': ' + e.message);
    }
    if (!wants) continue;
    postsByDay[lp.dayKey] = postsToday + 1;
    const lockAt = next ? next.start - lockGap : null;
    const good = !!next && lockAt - t <= windowMs;
    posts.push({ at: t, good, nextStart: next ? next.start : null, hoursBeforeLock: next ? (lockAt - t) / HOUR : null });
  }

  const hits = targets.filter((s) => posts.some((p) => p.good && p.nextStart === s.start));
  const weeks = (testEnd - testFrom) / (7 * DAY);
  const hitHours = posts.filter((p) => p.good).map((p) => p.hoursBeforeLock).sort((a, b) => a - b);
  return {
    strategy: strategy.name,
    streamsTested: targets.length,
    hits: hits.length,
    hitRate: hits.length / targets.length,
    posts: posts.length,
    postsPerWeek: posts.length / weeks,
    wasted: posts.filter((p) => !p.good).length,
    clipsPerHit: hits.length ? posts.length / hits.length : null,
    medianHoursBeforeLockOnGood: hitHours.length ? hitHours[Math.floor(hitHours.length / 2)] : null,
    testFrom: new Date(testFrom).toISOString(),
    testEnd: new Date(testEnd).toISOString(),
  };
}

/** The standard report: main setting plus sensitivity to the unknowns (lock gap, burial window). */
function report(strategy, streams, extra = {}) {
  const main = evaluate(strategy, Object.assign({ streams }, extra));
  const sens = [];
  for (const lockGapMin of [30, 45, 60, 90]) {
    for (const windowH of [1.5, 3, 6]) {
      const r = evaluate(strategy, Object.assign({ streams, lockGapMin, windowH }, extra));
      sens.push({ lockGapMin, windowH, hitRate: +r.hitRate.toFixed(3), postsPerWeek: +r.postsPerWeek.toFixed(2) });
    }
  }
  return { main, sensitivity: sens };
}

module.exports = { evaluate, report, localParts, localMidnight, MIN, HOUR, DAY };

// CLI: node research/harness.cjs research/strategies/foo.cjs [...]
if (require.main === module) {
  const streams = require('../core/seed-streams.json').streams;
  for (const file of process.argv.slice(2)) {
    const s = require(require('node:path').resolve(file));
    const r = report(s, streams);
    console.log(JSON.stringify(r));
  }
}
