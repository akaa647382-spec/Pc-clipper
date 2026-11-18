'use strict';
// Daily posting slot, learned walk-forward from ctx.history.
//
// Policy: post one clip a day at one local time-of-day T. At the start of each local day T is re-learned
// as the quarter-hour that, on past stream days, would have put the day's single post inside the burial
// window before the channel locked:
//
//     T* = argmax_T  #{ past stream days d :  T < lock_d <= T + W }
//
// lock_d is when the channel locked before the first stream of day d (one post per day, and the channel
// stays locked from that lock until the stream ends, so later streams that day are out of reach).
// Locks are taken from what the poster SAW: observe() records the first locked tick before each stream
// (the lock is visible in Discord). For streams from before the observations started, the lock is the
// start minus the lock gap learned from the observed locks (the 45 min working guess until one is seen).
//
// The argmax of a count over 10-30 past days is unstable, so the slot is "bagged": the median of the
// argmax over 200 bootstrap resamples of the past days (fixed seed, so runs are reproducible).
//
// If the channel is locked or live when the slot comes up, the day is skipped: posting after the stream
// ends only buries the clip before the next one. Separate weekday/weekend slots are used only when both
// groups have >= 10 past stream days AND a leave-one-day-out check says split slots would have hit more
// held-out days than one pooled slot. (On this data it never switches on: at most 9 weekend days.)
//
// Assumed, not learned: the burial window W = 3 h (project working assumption; nothing in ctx measures it)
// and the 45 min prior lock gap (project working guess, only used until a lock has been observed).
// Chosen after looking at harness results: bagging (plain argmax scored 10/22 vs 11/22 bagged) and the
// >= 10 days per group guard on the split (an earlier version with >= 4 split on 4-5 weekend days).

const P = require('../../core/predictor.cjs'); // only for tzOffset (the app's own timezone helper)

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const DEFAULTS = {
  windowH: 3, // assumed burial window
  priorLockGapMin: 45, // working guess until a lock is observed
  learnLockGap: true, // learn the gap from channel locks seen in observe()
  kernel: 'none', // 'none' = count past days (the definition above); 'silverman' = Gaussian KDE variant
  bag: 200, // bootstrap resamples for the slot (0 = plain argmax)
  seed: 12345,
  allowSplit: true, // weekday/weekend split, only if supported (see minGroupDays + leave-one-out)
  minGroupDays: 10,
  skipIfMissed: true, // never post after a stream if the slot was locked
  gridMin: 15, // candidate slots on the quarter hour (the app's tick)
};

function localInfo(ms, tz) {
  const d = new Date(ms + P.tzOffset(ms, tz));
  return { dayKey: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600, dow: (d.getUTCDay() + 6) % 7 };
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

// Standard normal CDF (erf approximation, Abramowitz-Stegun 7.1.26). Only used by the KDE variant.
function phi(x) {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

function silvermanBandwidth(xs) {
  const n = xs.length;
  if (n < 2) return 1;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1));
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p) => { const pos = (n - 1) * p; const lo = Math.floor(pos); const hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };
  const iqr = q(0.75) - q(0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.34) : sd;
  return Math.max(0.9 * spread * Math.pow(n, -0.2), 0.25);
}

/** How many past locks L (local hours) a post at T would have been good for: T < L <= T + W. */
function slotScore(T, locks, W, bw) {
  let s = 0;
  if (!bw) {
    for (const L of locks) if (L > T + 1e-9 && L <= T + W + 1e-9) s += 1;
    return s;
  }
  for (const L of locks) s += phi((T + W - L) / bw) - phi((T - L) / bw);
  return s;
}

/** Argmax slot on the quarter-hour grid. Ties go to the middle of the tied set. */
function argmaxSlot(locks, cfg) {
  const W = cfg.windowH;
  const bw = cfg.kernel === 'silverman' ? silvermanBandwidth(locks) : 0;
  const step = cfg.gridMin / 60;
  let best = -Infinity;
  let bestTs = [];
  for (let T = 0; T < 24 - 1e-9; T += step) {
    const sc = slotScore(T, locks, W, bw);
    if (sc > best + 1e-9) { best = sc; bestTs = [T]; } else if (Math.abs(sc - best) <= 1e-9) bestTs.push(T);
  }
  return bestTs[Math.floor((bestTs.length - 1) / 2)];
}

/** The slot: plain argmax, or the median argmax over bootstrap resamples of the past days. */
function bestSlot(locks, cfg) {
  if (!locks.length) return null;
  if (!cfg.bag) return argmaxSlot(locks, cfg);
  let seed = cfg.seed >>> 0;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const picks = [];
  for (let b = 0; b < cfg.bag; b++) picks.push(argmaxSlot(locks.map(() => locks[Math.floor(rnd() * locks.length)]), cfg));
  const step = cfg.gridMin / 60;
  return Math.round(median(picks) / step) * step;
}

const isWeekend = (dow) => dow >= 5;

/** Leave-one-day-out: would weekday/weekend slots have hit more held-out past days than one pooled slot? */
function splitSupported(days, cfg) {
  const nWe = days.filter((d) => isWeekend(d.dow)).length;
  if (nWe < cfg.minGroupDays || days.length - nWe < cfg.minGroupDays) return false;
  const plain = Object.assign({}, cfg, { bag: 0 }); // the plain argmax keeps this check fast
  const hit = (T, L) => T != null && L > T && L <= T + cfg.windowH;
  let pooled = 0;
  let split = 0;
  for (let i = 0; i < days.length; i++) {
    const held = days[i];
    const rest = days.filter((_, j) => j !== i);
    if (hit(bestSlot(rest.map((d) => d.lock), plain), held.lock)) pooled++;
    const same = rest.filter((d) => isWeekend(d.dow) === isWeekend(held.dow));
    if (hit(bestSlot(same.map((d) => d.lock), plain), held.lock)) split++;
  }
  return split > pooled;
}

function make(userCfg = {}) {
  const cfg = Object.assign({}, DEFAULTS, userCfg);
  const tickMs = cfg.gridMin * MIN;

  function init(ctx) {
    const st = ctx.state;
    if (st.ready) return st;
    st.ready = true;
    st.seen = ctx.history.length; // streams already known: their locks were not observed
    st.prevOpen = null; // channel open on the previous call?
    st.lastOpenAt = null;
    st.lockRun = null; // { at, prevOpenAt, clean }: first locked tick of the current pre-stream lock
    st.observedLock = {}; // stream start -> { lockAt, prevOpenAt }
    st.day = null;
    st.slot = null;
    st.missed = false;
    st.cache = { n: -1, nLocks: -1 };
    st.log = [];
    return st;
  }

  // Watch the channel lock as the poster would, and attach each lock to the stream that follows it.
  function track(ctx, st) {
    if (ctx.history.length > st.seen) {
      const run = st.lockRun;
      for (let i = st.seen; i < ctx.history.length; i++) {
        const s = ctx.history[i];
        if (run && run.clean && s.start >= run.at && s.start - run.at <= 6 * HOUR) {
          st.observedLock[s.start] = { lockAt: run.at, prevOpenAt: run.prevOpenAt };
        }
      }
      st.seen = ctx.history.length;
      st.lockRun = null;
    }
    if (ctx.channelLocked && !ctx.live) {
      // A lock is only measurable if the channel was open right before it (not straight after a stream).
      if (!st.lockRun) st.lockRun = { at: ctx.now, prevOpenAt: st.lastOpenAt, clean: st.prevOpen === true };
    } else {
      st.lockRun = null;
    }
    if (!ctx.channelLocked) st.lastOpenAt = ctx.now;
    st.prevOpen = !ctx.channelLocked;
  }

  // Lock gap (min): median over observed locks of the midpoint of [start - firstLockedTick, start - lastOpenTick].
  function lockGapMin(st) {
    if (!cfg.learnLockGap) return cfg.priorLockGapMin;
    const gaps = [];
    for (const k of Object.keys(st.observedLock)) {
      const o = st.observedLock[k];
      const lo = (+k - o.lockAt) / MIN;
      const hi = o.prevOpenAt != null ? (+k - o.prevOpenAt) / MIN : lo;
      gaps.push((lo + hi) / 2);
    }
    return gaps.length ? median(gaps) : cfg.priorLockGapMin;
  }

  // One record per past local day with a stream: { dow, lock } (lock as a local hour, first stream only).
  function pastDays(ctx, st) {
    const gap = lockGapMin(st);
    const byDay = new Map();
    for (const s of ctx.history) {
      const li = localInfo(s.start, ctx.tz);
      if (byDay.has(li.dayKey)) continue; // history is sorted: the first stream of the day wins
      const o = cfg.learnLockGap ? st.observedLock[s.start] : null;
      // Inferred locks are rounded up to the tick grid, like the observed ones (first locked tick).
      const lockMs = o ? o.lockAt : Math.ceil((s.start - gap * MIN) / tickMs) * tickMs;
      const lk = localInfo(lockMs, ctx.tz);
      byDay.set(li.dayKey, { dow: li.dow, lock: lk.dayKey === li.dayKey ? lk.hour : lk.hour - 24 });
    }
    return [...byDay.values()];
  }

  function slotFor(ctx, st, dow) {
    const nLocks = Object.keys(st.observedLock).length;
    if (st.cache.n !== ctx.history.length || st.cache.nLocks !== nLocks) {
      const days = pastDays(ctx, st);
      const c = { n: ctx.history.length, nLocks, gap: lockGapMin(st), split: false };
      c.pooled = bestSlot(days.map((d) => d.lock), cfg);
      if (cfg.allowSplit && splitSupported(days, cfg)) {
        c.split = true;
        c.we = bestSlot(days.filter((d) => isWeekend(d.dow)).map((d) => d.lock), cfg);
        c.wd = bestSlot(days.filter((d) => !isWeekend(d.dow)).map((d) => d.lock), cfg);
      }
      st.cache = c;
      st.log.push({ at: ctx.now, pooled: c.pooled, split: c.split, we: c.we, wd: c.wd, gap: c.gap });
    }
    const c = st.cache;
    return c.split ? (isWeekend(dow) ? c.we : c.wd) : c.pooled;
  }

  function newDay(ctx, st) {
    if (st.day === ctx.local.dayKey) return;
    st.day = ctx.local.dayKey;
    st.slot = slotFor(ctx, st, ctx.local.dow); // fixed for the whole day
    st.missed = false;
  }

  return {
    name: 'slot-learned',
    describe: 'Post once a day at a time-of-day slot re-learned each day from past streams: the quarter-hour that would have put a post within 3 h before the most past channel locks (bootstrap-bagged argmax; lock gap learned from observed locks). Skip the day if the slot comes up while the channel is locked.',
    cfg,
    observe(ctx) {
      const st = init(ctx);
      track(ctx, st);
      newDay(ctx, st);
      // The slot came up while posting was impossible: the day is lost, do not post after the stream.
      if (cfg.skipIfMissed && st.slot != null && ctx.channelLocked && ctx.local.hour >= st.slot) st.missed = true;
    },
    decide(ctx) {
      const st = init(ctx);
      track(ctx, st);
      newDay(ctx, st);
      if (st.slot == null || st.missed || ctx.postsToday > 0 || ctx.channelLocked) return false;
      return ctx.local.hour >= st.slot;
    },
  };
}

module.exports = make();
module.exports.make = make;
