'use strict';
// When will Speed go live, when will the mods lock the clips channel, and when should you post?
//
// The model, in plain words:
//   1. Every past stream start is a vote for "he goes live around this time of the week".
//      Recent streams count more (a vote halves in weight every `halfLifeDays`).
//      Each vote is smeared over about +-45 minutes, and part of it (`dailyMix`) is shared
//      with the same time of day on the other weekdays, because his weekday pattern is weak.
//   2. That gives an expected number of stream starts in every 5-minute step ahead.
//      Right after a stream ends he rarely starts another one, so the chance is turned down
//      for a while after the last stream (learned from the gaps between his streams).
//   3. If YouTube shows a scheduled stream, that time wins (plus how late he usually is).
//   4. The lock comes some minutes before the stream. That gap is learned from the locks you log.
//   5. You post at the LATEST moment where the chance the clips are already locked is still
//      below your risk setting (default 20%). Later = closer to the bottom of the channel =
//      seen sooner. Earlier = safer but buried under more clips.
//
// All times are epoch milliseconds. Nothing here touches the network or the disk.

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const SLOT_MIN = 15;
const SLOTS_PER_DAY = (24 * 60) / SLOT_MIN; // 96
const SLOTS_PER_WEEK = SLOTS_PER_DAY * 7; // 672
const STEP_MIN = 5;
const STEP = STEP_MIN * MIN;

const DEFAULTS = {
  halfLifeDays: 45,
  // Multiplies the stream-start rate; calibration tunes it so the percentages match reality.
  hazardScale: 1,
  kernelSigmaMin: 45,
  dailyMix: 0.4,
  floor: 0.05,
  horizonDays: 7,
  risk: 0.2,
  // Only give a firm post time when a stream within `sessionHours` is at least this likely.
  sessionHours: 12,
  minSessionChance: 0.5,
  // Used until you have logged at least `minLockSamples` locks with a matching stream.
  priorLockGapsMin: [15, 30, 45, 60, 90],
  minLockSamples: 3,
  lockKernelMin: 10,
  // How late he is versus a scheduled time, until history says otherwise.
  priorLatenessMin: [0, 5, 10, 15, 30],
};

// ---------------------------------------------------------------------------
// Time zone helpers (cached: Intl is slow and these run millions of times)
// ---------------------------------------------------------------------------

const offsetCaches = new Map();

/** Offset of `tz` from UTC at `ms`, in ms. 'UTC' and undefined skip Intl. */
function tzOffset(ms, tz) {
  if (!tz || tz === 'UTC') return 0;
  let cache = offsetCaches.get(tz);
  if (!cache) {
    cache = { fmt: new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }), map: new Map() };
    offsetCaches.set(tz, cache);
  }
  const key = Math.floor(ms / (15 * MIN));
  let off = cache.map.get(key);
  if (off === undefined) {
    const p = {};
    for (const part of cache.fmt.formatToParts(new Date(key * 15 * MIN))) p[part.type] = part.value;
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
    off = asUtc - key * 15 * MIN;
    if (cache.map.size > 200000) cache.map.clear();
    cache.map.set(key, off);
  }
  return off;
}

/** 15-minute slot of the week (0 = Monday 00:00 local) for `ms` in `tz`. */
function slotOfWeek(ms, tz) {
  const local = new Date(ms + tzOffset(ms, tz));
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  return dow * SLOTS_PER_DAY + Math.floor((local.getUTCHours() * 60 + local.getUTCMinutes()) / SLOT_MIN);
}

// ---------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

/** Normal CDF (Abramowitz-Stegun 7.1.26 erf). */
function normCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** P(X >= x) for a mixture of normals centred on `samples` with sd `sigma`. */
function survivalOfSamples(samples, sigma, x) {
  let s = 0;
  for (const v of samples) s += 1 - normCdf((x - v) / sigma);
  return s / samples.length;
}

// ---------------------------------------------------------------------------
// Cleaning the inputs
// ---------------------------------------------------------------------------

/** Keeps streams with a valid start, sorted, without duplicates (same start within 10 min). */
function cleanStreams(streams) {
  const list = (streams || [])
    .filter((s) => s && Number.isFinite(s.start))
    .map((s) => ({ start: s.start, end: Number.isFinite(s.end) && s.end > s.start ? s.end : null, scheduled: Number.isFinite(s.scheduled) ? s.scheduled : null }))
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of list) {
    const prev = out[out.length - 1];
    if (prev && s.start - prev.start < 10 * MIN) continue;
    out.push(s);
  }
  return out;
}

/** Typical stream length, for streams whose end we do not know. */
function typicalDuration(streams) {
  const d = streams.filter((s) => s.end).map((s) => s.end - s.start).sort((a, b) => a - b);
  return d.length ? quantile(d, 0.5) : 3 * HOUR;
}

/** Gap from one stream's end to the next one's start, in ms, sorted. */
function restGaps(streams) {
  const dur = typicalDuration(streams);
  const gaps = [];
  for (let i = 1; i < streams.length; i++) {
    const prevEnd = streams[i - 1].end || streams[i - 1].start + dur;
    const g = streams[i].start - prevEnd;
    if (g > 0) gaps.push(g);
  }
  return gaps.sort((a, b) => a - b);
}

/**
 * Lock gaps (minutes between "clips locked" and the stream going live) from your log.
 * A lock pairs with the first stream that starts 0-6 h after it.
 */
function lockGaps(locks, streams) {
  const out = [];
  for (const l of locks || []) {
    if (!l || !Number.isFinite(l.at)) continue;
    let liveAt = Number.isFinite(l.liveAt) ? l.liveAt : null;
    if (liveAt === null) {
      const s = streams.find((x) => x.start >= l.at && x.start - l.at <= 6 * HOUR);
      if (s) liveAt = s.start;
    }
    if (liveAt !== null && liveAt >= l.at) out.push((liveAt - l.at) / MIN);
  }
  return out.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Builds the weekly pattern from streams that started before `now`.
 * Returns { perWeek, shape[672], n } where shape sums to 1 and perWeek is the
 * recency-weighted number of streams per week.
 */
function buildPattern(streams, now, tz, opt) {
  const hl = opt.halfLifeDays * DAY;
  const past = streams.filter((s) => s.start <= now);
  const weekly = new Float64Array(SLOTS_PER_WEEK);
  const daily = new Float64Array(SLOTS_PER_DAY);
  const sigmaSlots = opt.kernelSigmaMin / SLOT_MIN;
  const reach = Math.ceil(sigmaSlots * 3);
  const kernel = [];
  for (let k = -reach; k <= reach; k++) kernel.push(Math.exp(-(k * k) / (2 * sigmaSlots * sigmaSlots)));
  const ksum = kernel.reduce((a, b) => a + b, 0);
  let wsum = 0;
  for (const s of past) {
    const w = Math.pow(0.5, (now - s.start) / hl);
    wsum += w;
    const slot = slotOfWeek(s.start, tz);
    for (let k = -reach; k <= reach; k++) {
      const kw = (w * kernel[k + reach]) / ksum;
      weekly[(slot + k + SLOTS_PER_WEEK) % SLOTS_PER_WEEK] += kw;
      daily[(slot % SLOTS_PER_DAY + k + SLOTS_PER_DAY) % SLOTS_PER_DAY] += kw;
    }
  }
  const shape = new Float64Array(SLOTS_PER_WEEK);
  if (wsum > 0) {
    for (let i = 0; i < SLOTS_PER_WEEK; i++) {
      const p = (1 - opt.dailyMix) * (weekly[i] / wsum) + opt.dailyMix * (daily[i % SLOTS_PER_DAY] / wsum / 7);
      shape[i] = (1 - opt.floor) * p + opt.floor / SLOTS_PER_WEEK;
    }
  } else {
    shape.fill(1 / SLOTS_PER_WEEK);
  }
  // Weighted streams per week: sum of weights divided by the weighted length of the observed span.
  let perWeek = 0;
  if (past.length) {
    const span = Math.max(now - past[0].start, WEEK);
    const weightedSpan = (hl / Math.LN2) * (1 - Math.pow(0.5, span / hl));
    perWeek = wsum / (weightedSpan / WEEK);
  }
  return { perWeek, shape, n: past.length };
}

/**
 * Probability, for every 5-minute step from `now` over the horizon, that the NEXT stream
 * starts in that step. Returns { times[], probs[], beyond } where beyond is the chance it
 * starts after the horizon (the probs are not normalised).
 */
function startDistribution(input, opt) {
  const now = input.now;
  const tz = input.tz;
  const streams = input.streams;
  const steps = Math.round((opt.horizonDays * DAY) / STEP);
  const times = new Array(steps);
  const probs = new Float64Array(steps);
  for (let k = 0; k < steps; k++) times[k] = now + k * STEP;

  // A scheduled stream on YouTube: lateness distribution around that time.
  const upcoming = input.upcoming && Number.isFinite(input.upcoming.scheduled) ? input.upcoming.scheduled : null;
  if (upcoming !== null && upcoming > now - 2 * HOUR) {
    const late = streams.filter((s) => s.scheduled && s.start >= s.scheduled - HOUR && s.start - s.scheduled < 6 * HOUR).map((s) => (s.start - s.scheduled) / MIN);
    const samples = late.length >= 3 ? late : opt.priorLatenessMin;
    const sigma = 8;
    let prevSurv = 1;
    for (let k = 0; k < steps; k++) {
      const tMin = (times[k] + STEP - upcoming) / MIN;
      // P(start <= t | start >= now): mixture CDF, renormalised to what is still possible.
      const surv = survivalOfSamples(samples, sigma, tMin);
      const surv0 = survivalOfSamples(samples, sigma, (now - upcoming) / MIN);
      const s = surv0 > 1e-9 ? surv / surv0 : 0;
      probs[k] = Math.max(0, prevSurv - s);
      prevSurv = s;
    }
    // Leave 5% for "the schedule was wrong / cancelled": spread by the pattern below.
    const scale = 0.95;
    for (let k = 0; k < steps; k++) probs[k] *= scale;
    const pat = patternDistribution(input, opt, times);
    for (let k = 0; k < steps; k++) probs[k] += (1 - scale) * pat.probs[k];
    const total = probs.reduce((a, b) => a + b, 0);
    return { times, probs, beyond: Math.max(0, 1 - total), source: 'scheduled' };
  }
  const pat = patternDistribution(input, opt, times);
  return { times, probs: pat.probs, beyond: pat.beyond, source: 'pattern' };
}

function patternDistribution(input, opt, times) {
  const { now, tz, streams } = input;
  const pattern = buildPattern(streams, now, tz, opt);
  const probs = new Float64Array(times.length);
  const gaps = restGaps(streams.filter((s) => s.start <= now));
  const minRest = clamp(gaps.length >= 5 ? quantile(gaps, 0.1) : 6 * HOUR, 1 * HOUR, 12 * HOUR);
  const last = streams.filter((s) => s.start <= now).pop();
  const lastEnd = last ? (last.end || last.start + typicalDuration(streams)) : -Infinity;
  const perStepScale = (pattern.perWeek * STEP) / (SLOT_MIN * MIN); // expected starts per step = perWeek * shape[slot] * (STEP/SLOT)
  let surv = 1;
  for (let k = 0; k < times.length; k++) {
    const t = times[k];
    const rest = clamp((t - lastEnd) / minRest, 0, 1);
    const lambda = opt.hazardScale * perStepScale * pattern.shape[slotOfWeek(t, tz)] * rest * rest;
    const p = 1 - Math.exp(-lambda);
    probs[k] = surv * p;
    surv *= 1 - p;
  }
  return { probs, beyond: surv, pattern, minRest };
}

/**
 * The full prediction.
 *
 * input = {
 *   now, tz,                 // tz: IANA name like 'Europe/London'; default UTC
 *   streams: [{start, end?, scheduled?}],
 *   locks:   [{at, liveAt?}],
 *   upcoming: {scheduled} | null,   // YouTube scheduled stream, if any
 *   liveNow: boolean,
 *   options: {risk, ...}
 * }
 */
function predict(input) {
  const opt = Object.assign({}, DEFAULTS, input.options || {});
  const now = input.now;
  const tz = input.tz || 'UTC';
  const streams = cleanStreams(input.streams);
  const base = { now, tz, streams, upcoming: input.upcoming };

  const gapsMin = lockGaps(input.locks, streams);
  const lockSamples = gapsMin.length >= opt.minLockSamples ? gapsMin : opt.priorLockGapsMin;
  const lockLearned = gapsMin.length >= opt.minLockSamples;

  if (input.liveNow) {
    return {
      status: 'live',
      headline: 'He is live right now.',
      now,
      lock: { learned: lockLearned, samples: gapsMin.length, medianMin: quantile(lockSamples.slice().sort((a, b) => a - b), 0.5) },
      historyCount: streams.length,
    };
  }

  const dist = startDistribution(base, opt);
  const { times, probs } = dist;
  const inHorizon = 1 - dist.beyond;

  const cum = (until) => {
    let s = 0;
    for (let k = 0; k < times.length && times[k] < until; k++) s += probs[k];
    return s;
  };
  const within = {
    h2: cum(now + 2 * HOUR),
    h6: cum(now + 6 * HOUR),
    h24: cum(now + 24 * HOUR),
  };
  if (input.quick) return { within };

  // Start quantiles, conditional on a stream within the horizon.
  const startQ = (q) => {
    if (inHorizon <= 0) return null;
    let s = 0;
    for (let k = 0; k < times.length; k++) {
      s += probs[k] / inHorizon;
      if (s >= q) return times[k] + STEP / 2;
    }
    return times[times.length - 1];
  };
  const start = { p10: startQ(0.1), p25: startQ(0.25), median: startQ(0.5), p75: startQ(0.75), p90: startQ(0.9) };

  // P(lock already happened by t), conditional on the next stream starting in steps [k0, k1).
  // Conditioning on a window matters: "20% risk over the next week" can still mean "40% risk
  // if he streams tonight", and tonight is the case that counts.
  const lockSigma = opt.lockKernelMin;
  const makeLockedBy = (k0, k1) => {
    let mass = 0;
    for (let k = k0; k < k1; k++) mass += probs[k];
    return (t) => {
      if (mass <= 0) return 0;
      let s = 0;
      for (let k = k0; k < k1; k++) {
        if (probs[k] < 1e-12) continue;
        const S = times[k] + STEP / 2;
        // locked by t  <=>  S - G <= t  <=>  G >= S - t
        s += probs[k] * survivalOfSamples(lockSamples, lockSigma, (S - t) / MIN);
      }
      return s / mass;
    };
  };
  // Latest step in [k0, k1) with lockedBy(t) <= risk (lockedBy only grows with t).
  const latestSafe = (lockedBy, k0, k1) => {
    if (lockedBy(times[k0]) > opt.risk) return k0;
    let lo = k0;
    let hi = k1 - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lockedBy(times[mid]) <= opt.risk) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const kSession = Math.min(times.length, Math.round((opt.sessionHours * HOUR) / STEP));
  let pSession = 0;
  for (let k = 0; k < kSession; k++) pSession += probs[k];
  const likelySoon = pSession >= opt.minSessionChance;

  let postAt = null;
  let lockedAtPost = null;
  let postAtIsEstimate = false;
  if (likelySoon) {
    const lb = makeLockedBy(0, kSession);
    const k = latestSafe(lb, 0, kSession);
    postAt = times[k];
    lockedAtPost = lb(postAt);
  } else if (start.median !== null) {
    // Not likely in the next session: a rough time around the most likely start, to plan with.
    const k0 = Math.max(0, Math.round((start.median - opt.sessionHours * HOUR / 2 - now) / STEP));
    const k1 = Math.min(times.length, k0 + kSession);
    if (k1 > k0) {
      const lb = makeLockedBy(k0, k1);
      const k = latestSafe(lb, k0, k1);
      postAt = times[k];
      lockedAtPost = lb(postAt);
      postAtIsEstimate = true;
    }
  }

  // How sure is this? Spread of the middle half of the start distribution.
  const spreadH = start.p25 !== null && start.p75 !== null ? (start.p75 - start.p25) / HOUR : Infinity;
  let confidence;
  if (dist.source === 'scheduled') confidence = 'high';
  else if (streams.length < 15) confidence = 'none';
  else if (spreadH <= 3 && inHorizon > 0.6) confidence = 'medium';
  else confidence = 'low';

  const sorted = lockSamples.slice().sort((a, b) => a - b);
  const lockMedianMin = quantile(sorted, 0.5);
  const postNow = likelySoon && postAt !== null && postAt <= now + STEP / 2;

  return {
    status: postNow ? 'post-now' : (likelySoon ? 'wait' : 'not-soon'),
    chanceThisSession: pSession,
    sessionHours: opt.sessionHours,
    postAtIsEstimate,
    now,
    source: dist.source,
    confidence,
    historyCount: streams.length,
    within,
    inHorizon,
    start,
    spreadHours: spreadH,
    postAt,
    postNow,
    chanceLockedAtPost: lockedAtPost,
    risk: opt.risk,
    lock: {
      learned: lockLearned,
      samples: gapsMin.length,
      medianMin: lockMedianMin,
      p20Min: quantile(sorted, 0.2),
      p80Min: quantile(sorted, 0.8),
    },
    predictedLockAt: start.median !== null ? start.median - lockMedianMin * MIN : null,
    curve: downsampleCurve(times, probs, inHorizon, now, 48),
  };
}

/** Hourly chance of the stream starting, for the next `hours`, for the chart. */
function downsampleCurve(times, probs, inHorizon, now, hours) {
  const out = [];
  for (let h = 0; h < hours; h++) {
    let s = 0;
    for (let k = 0; k < times.length; k++) {
      if (times[k] >= now + h * HOUR && times[k] < now + (h + 1) * HOUR) s += probs[k];
    }
    out.push({ t: now + h * HOUR, p: s });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backtest: how would the app have done on his real past streams?
// ---------------------------------------------------------------------------

/**
 * Replays the app on history. Starting after each stream ends, the app re-checks every
 * `everyMin` minutes using only what it knew at that moment, and you post the first time
 * it says "post now". Then we look at when he actually went live.
 *
 * A post counts as MADE IT if it went up before the lock, where the lock is taken as
 * `assumeLockGapMin` minutes before the real start (your logged median, or 45 by default).
 *
 * Also scores the "chance he goes live in the next 6 h" number against what happened
 * (Brier score; lower is better; compare with the no-skill baseline).
 */
function backtest(input) {
  const opt = Object.assign({}, DEFAULTS, input.options || {});
  const tz = input.tz || 'UTC';
  const streams = cleanStreams(input.streams);
  const everyMin = input.everyMin || 30;
  const goodWindowH = input.goodWindowHours || 4;
  const days = input.days || 60;
  const gapsMin = lockGaps(input.locks, streams);
  const lockGapMin = Number.isFinite(input.assumeLockGapMin) ? input.assumeLockGapMin : (gapsMin.length >= opt.minLockSamples ? quantile(gapsMin, 0.5) : 45);
  const lastStart = streams.length ? streams[streams.length - 1].start : 0;
  const from = lastStart - days * DAY;
  const dur = typicalDuration(streams);

  const trials = [];
  let brier = 0;
  let brierBase = 0;
  let nScore = 0;
  const buckets = Array.from({ length: 5 }, () => ({ n: 0, predicted: 0, happened: 0 }));

  for (let i = 1; i < streams.length && !input.skipTrials; i++) {
    const target = streams[i];
    if (target.start < from) continue;
    const prev = streams[i - 1];
    const known = streams.slice(0, i);
    if (known.length < 15) continue;
    const begin = (prev.end || prev.start + dur) + 10 * MIN;
    if (begin >= target.start) continue;
    const lockAt = target.start - lockGapMin * MIN;
    let postedAt = null;
    for (let t = begin; t < target.start; t += everyMin * MIN) {
      const r = predict({ now: t, tz, streams: known, locks: (input.locks || []).filter((l) => l.at < t), options: opt });
      if (r.postNow) {
        postedAt = t;
        break;
      }
      // The app re-checks every minute and alerts at the post time, so a post time that falls
      // before the next check here is when you would have posted.
      if (r.status === 'wait' && r.postAt !== null && r.postAt < t + everyMin * MIN) {
        postedAt = Math.max(t, r.postAt);
        break;
      }
    }
    trials.push({
      start: target.start,
      postedAt,
      madeIt: postedAt !== null && postedAt <= lockAt,
      // Made it AND not so early that it is buried: within `goodWindowHours` of him going live.
      good: postedAt !== null && postedAt <= lockAt && target.start - postedAt <= goodWindowH * HOUR,
      hoursEarly: postedAt !== null ? (target.start - postedAt) / HOUR : null,
    });
  }

  // Scoring pass: every 3 h over the tested range, while he is not live.
  for (let t = input.skipScoring ? Infinity : Math.max(from, streams.length > 15 ? streams[15].start : Infinity); t < lastStart; t += 3 * HOUR) {
    const known = streams.filter((s) => s.start < t);
    const last = known[known.length - 1];
    if (!last || t < (last.end || last.start + dur)) continue;
    const next = streams.find((s) => s.start >= t);
    const happened = next && next.start - t <= 6 * HOUR ? 1 : 0;
    const r = predict({ now: t, tz, streams: known, options: opt, quick: true });
    const p = r.within.h6;
    // No-skill comparison: the share of 6 h windows that had a start, from what was known then.
    const spanKnown = Math.max(last.start - known[0].start, DAY);
    const baseRate = clamp((known.length * 6 * HOUR) / spanKnown, 0, 1);
    brier += (p - happened) ** 2;
    brierBase += (baseRate - happened) ** 2;
    nScore++;
    const b = buckets[Math.min(4, Math.floor(p * 5))];
    b.n++;
    b.predicted += p;
    b.happened += happened;
  }

  const made = trials.filter((t) => t.madeIt);
  const early = made.map((t) => t.hoursEarly).sort((a, b) => a - b);
  return {
    streamsTested: trials.length,
    madeItRate: trials.length ? made.length / trials.length : null,
    goodRate: trials.length ? trials.filter((t) => t.good).length / trials.length : null,
    goodWindowHours: goodWindowH,
    missedLock: trials.filter((t) => t.postedAt !== null && !t.madeIt).length,
    neverSaidPost: trials.filter((t) => t.postedAt === null).length,
    medianHoursEarly: early.length ? quantile(early, 0.5) : null,
    assumedLockGapMin: lockGapMin,
    brier: nScore ? brier / nScore : null,
    brierBaseline: nScore ? brierBase / nScore : null,
    calibration: buckets.map((b, i) => ({ range: [i / 5, (i + 1) / 5], n: b.n, predicted: b.n ? b.predicted / b.n : null, happened: b.n ? b.happened / b.n : null })),
    trials,
  };
}

// ---------------------------------------------------------------------------
// Calibration: pick the settings that would have worked best on his own history
// ---------------------------------------------------------------------------

const PATTERN_GRID = {
  halfLifeDays: [21, 45, 120],
  dailyMix: [0.1, 0.25, 0.45],
  kernelSigmaMin: [30, 60],
  hazardScale: [1, 1.6, 2.5, 4],
};
const SESSION_GRID = [0.3, 0.4, 0.5, 0.6, 0.75];

/**
 * Two stages:
 *   1. pattern settings that make "chance he goes live in the next 6 h" most accurate (Brier),
 *   2. the "how sure before saying post" threshold that gets the most posts in before the lock.
 * Tuning and scoring use the same history, so the scores are a little optimistic; the app says so.
 * `onProgress(done, total)` is called as it goes.
 */
function calibrate(input, onProgress) {
  const base = Object.assign({}, input.options || {});
  const combos = [];
  for (const h of PATTERN_GRID.halfLifeDays) for (const d of PATTERN_GRID.dailyMix) for (const k of PATTERN_GRID.kernelSigmaMin) for (const x of PATTERN_GRID.hazardScale) combos.push({ halfLifeDays: h, dailyMix: d, kernelSigmaMin: k, hazardScale: x });
  const total = combos.length + SESSION_GRID.length + 1;
  let done = 0;
  const tick = () => { done++; if (onProgress) onProgress(done, total); };

  const before = backtest(Object.assign({}, input, { options: base }));
  tick();
  let best = null;
  for (const c of combos) {
    const r = backtest(Object.assign({}, input, { options: Object.assign({}, base, c), skipTrials: true }));
    if (r.brier !== null && (!best || r.brier < best.brier)) best = { brier: r.brier, opts: c };
    tick();
  }
  const pattern = best ? best.opts : {};
  let bestSession = null;
  for (const m of SESSION_GRID) {
    const opts = Object.assign({}, base, pattern, { minSessionChance: m });
    const r = backtest(Object.assign({}, input, { options: opts, skipScoring: true }));
    const score = (r.goodRate || 0) + 0.001 * (r.madeItRate || 0);
    if (!bestSession || score > bestSession.score) bestSession = { score, m };
    tick();
  }
  const options = Object.assign({}, pattern, { minSessionChance: bestSession ? bestSession.m : DEFAULTS.minSessionChance });
  const after = backtest(Object.assign({}, input, { options: Object.assign({}, base, options) }));
  return { options, before: summarize(before), after: summarize(after), at: Date.now() };
}

function summarize(b) {
  const out = Object.assign({}, b);
  delete out.trials;
  return out;
}

module.exports = {
  calibrate,
  summarize,
  predict,
  backtest,
  cleanStreams,
  lockGaps,
  slotOfWeek,
  tzOffset,
  quantile,
  DEFAULTS,
  MIN,
  HOUR,
  DAY,
};
