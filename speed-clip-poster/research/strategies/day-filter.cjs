'use strict';
// Day filter: spend fewer clips by skipping days he is unlikely to stream.
//
// Post one clip at 2:30 PM ET (the baseline's daily time), but only on days that look at least as likely as an
// average day, judged by how busy his last week was. Everything is learned walk-forward from ctx.history.
//
// Score of a day d: "recent activity" A(d) = sum over his past stream days s < d of exp(-(d - s) / 7).
//   A is high right after a busy week (several streams, or one yesterday) and decays as days pass without one.
// Model: P(stream day | A) = sigmoid(b0 + b1 * A), a logistic regression fitted every morning on all past days
//   since his first stream (each day labelled 1 if he went live that local day). b0 and b1 are learned; a weak
//   ridge (lambda = 1) on b1 keeps it near 0 (= no filter) while there is little history.
// Rule: post at 14:30 if   odds(today) / odds(average day) >= MIN_RATIO   (1 = "at least an average day"),
//   and never on a day he already went live (a clip posted after today's stream waits days and gets buried).
//
// Constants and why:
//   TAU_DAYS = 7     his rhythm is weekly (~2 streams/week); not tuned (3.5 and 14 were checked, see the report)
//   RIDGE = 1        weak, round; 0.1 and 10 behave the same
//   MIN_RATIO = 1    neutral "above-average day" cut, not tuned; make({ minRatio }) gives the other points
//   POST_HOUR = 14.5 the baseline's daily post time, kept fixed so the comparison isolates the day filter
//
// What did NOT work (walk-forward): a gap-hazard model P(stream | days since last stream) and weekday
// frequencies were both anti-predictive (AUC 0.34-0.46). August had back-to-back days (Jul 31-Aug 3, several
// pairs), the autumn did not, so "the day after a stream is likely" was learned and then wrong; and past
// weekday counts are noise (chi-square ~3 on 6 df).

const P = require('../../core/predictor.cjs');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULTS = { tauDays: 7, ridge: 1, minRatio: 1, postHour: 14.5 };

function localDay(ms, tz) {
  return Math.floor((ms + P.tzOffset(ms, tz)) / DAY);
}

/** Walk-forward day score from the stream days before `today`. Returns { ok, ratio, p, base, b0, b1, activity }. */
function scoreDay(streamDays, today, o) {
  const past = streamDays.filter((d) => d < today);
  if (past.length < 3) return { ok: true, ratio: null, reason: 'not enough history: no filter' };
  const isStream = new Set(past);
  const activity = (d) => {
    let a = 0;
    for (const s of past) if (s < d) a += Math.exp(-(d - s) / o.tauDays);
    return a;
  };
  const xs = [];
  const ys = [];
  for (let d = past[0] + 1; d < today; d++) {
    xs.push(activity(d));
    ys.push(isStream.has(d) ? 1 : 0);
  }
  const base = ys.reduce((a, b) => a + b, 0) / ys.length;
  if (!(base > 0 && base < 1)) return { ok: true, ratio: null, reason: 'degenerate history: no filter' };
  const logitBase = Math.log(base / (1 - base));
  // Newton-Raphson for ridge-penalised logistic regression (penalty on the slope only).
  let b0 = logitBase;
  let b1 = 0;
  for (let it = 0; it < 30; it++) {
    let g0 = 0, g1 = -o.ridge * b1, h00 = 0, h01 = 0, h11 = o.ridge;
    for (let i = 0; i < xs.length; i++) {
      const p = 1 / (1 + Math.exp(-(b0 + b1 * xs[i])));
      const r = ys[i] - p;
      const v = p * (1 - p);
      g0 += r;
      g1 += r * xs[i];
      h00 += v;
      h01 += v * xs[i];
      h11 += v * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(det > 1e-12)) break;
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0;
    b1 += d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
  }
  const a = activity(today);
  const z = b0 + b1 * a;
  const ratio = Math.exp(z - logitBase); // odds today / odds of an average day
  return { ok: ratio >= o.minRatio, ratio, p: 1 / (1 + Math.exp(-z)), base, b0, b1, activity: a };
}

function make(opts) {
  const o = Object.assign({}, DEFAULTS, opts);
  return {
    name: 'day-filter' + (opts && Object.keys(opts).length ? '-' + Object.entries(opts).map(([k, v]) => k + v).join('-') : ''),
    describe:
      'Post at ' + o.postHour + 'h local only on days whose walk-forward P(stream today | last-week activity, tau ' + o.tauDays +
      ' d) is at least ' + o.minRatio + 'x the odds of an average day; never on a day he already went live.',
    options: o,
    decide(ctx) {
      if (ctx.postsToday > 0 || ctx.live) return false;
      const st = ctx.state;
      const today = Math.floor(Date.parse(ctx.local.dayKey + 'T00:00:00Z') / DAY);
      if (st.today !== today) {
        // Score once per local day, from stream days strictly before today (stable through the day).
        const streamDays = [...new Set(ctx.history.map((s) => localDay(s.start, ctx.tz)))];
        st.today = today;
        st.score = scoreDay(streamDays, today, o);
      }
      if (!st.score.ok) return false;
      const last = ctx.history[ctx.history.length - 1];
      if (last && localDay(last.start, ctx.tz) === today) return false; // already streamed today
      return ctx.local.hour >= o.postHour;
    },
  };
}

module.exports = Object.assign(make({}), { make, scoreDay, DEFAULTS });
