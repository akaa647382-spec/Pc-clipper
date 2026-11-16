/*!
 * Avengers Player: core timing logic.
 * Pure functions and small state machines with no DOM access, so the same file runs in the
 * browser (window.APCore) and under Node for unit tests (module.exports).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 2:30:30 into the film: start at 9:29:30 PM and the snap lands on midnight. */
  const DEFAULT_SNAP_SEC = 2 * 3600 + 30 * 60 + 30;

  /** Length of the 2019 film (3:01:11): the yardstick other copies are measured against. */
  const REFERENCE_SEC = 10871;

  /**
   * The cuts of the film the player knows about.
   *
   *   lengthSec  how long the cut is
   *   snapSec    where the snap is in that cut, as far as it is known before anyone has looked
   *   minutes    the usual lengths of the cut, in minutes (for reference only: a cut is told by the
   *              file's name, since copies of the same cut differ in length)
   *   settled    true once the snap point has been measured in that cut; false while it is the
   *              round figure everybody quotes
   *
   * Avengers: Endgame is 3:01:11 long, Avengers Endgame: Encore (the 2026 re-release) 3:01:36.
   * The snap point given here is where the search starts, never where it ends: "2:30:30" is a
   * round number, the real snap is a second or so later, and the player puts the exact frame on
   * midnight only after that frame has been found in the file itself (the film strip does that).
   */
  const FILM_VERSIONS = [
    {
      id: 'original', family: 'original', name: 'Avengers: Endgame (2019) · 3:01:11', short: 'Endgame', lengthSec: REFERENCE_SEC,
      snapSec: DEFAULT_SNAP_SEC, minutes: [180.0, 181.4], settled: false,
      note: 'The 2019 film, 3:01:11 long. The snap is a moment after 2:30:30: press “Find the snap” once and the app puts the exact frame on midnight.'
    },
    {
      id: 'encore', family: 'encore', name: 'Avengers Endgame: Encore (2026) · 3:01:36', short: 'Encore', lengthSec: 10896,
      snapSec: DEFAULT_SNAP_SEC, minutes: [181.4, 187.5], settled: false,
      note: 'The 2026 re-release, 3:01:36 long: 25 seconds more than the 2019 film. Where the snap sits in it has to be found in the file: press “Find the snap” once.'
    },
    {
      id: 'custom', family: 'custom', name: 'Another cut, or a snap point set by hand', short: 'Custom', lengthSec: null,
      snapSec: null, minutes: null, settled: false,
      note: 'Your own snap point. Press “Find the snap”, or type the time.'
    }
  ];

  function filmVersion(id) {
    for (const v of FILM_VERSIONS) if (v.id === id) return v;
    // A cut that is no longer offered (or a damaged setting) keeps its snap point: that is "custom".
    return id ? FILM_VERSIONS[FILM_VERSIONS.length - 1] : FILM_VERSIONS[0];
  }

  /**
   * Lengths a file of the film can have: releases differ by seconds to minutes (logos, an
   * introduction, a re-release's new scenes, credits cut short), so anything from 2:45:00 to
   * 3:30:00 is taken for the film and searched for the snap.
   */
  const FILM_SPAN = [2 * 3600 + 45 * 60, 3 * 3600 + 30 * 60];

  /**
   * Which cut a file most likely is, or null when its length is not that of the film at all.
   * The length does not tell the cuts apart (copies of the 2019 film run from 3:00:57 to beyond
   * 3:02): the name does. "Encore", or the year 2026, is the re-release; anything else the 2019 film.
   */
  function guessFilmVersion(durationSec, name) {
    if (!isFinite(durationSec) || durationSec < FILM_SPAN[0] || durationSec > FILM_SPAN[1]) return null;
    const n = String(name || '');
    if (/encore/i.test(n) || /(^|[^0-9])2026([^0-9]|$)/.test(n)) return FILM_VERSIONS[1];
    return FILM_VERSIONS[0];
  }

  /* ------------------------------------------------------------- the snap */

  /**
   * Where the climb to a white-out begins: the first frame that is clearly brighter than the
   * picture was a moment before it, with every frame after it climbing on to the white.
   *   F      frames in time order, [{ t, mean }]
   *   start  the first white frame
   *   dt     the time from one frame to the next (the usual gap)
   *   frameDt  the length of one frame (the shortest gaps), when frames may be missing
   * "Clearly" is measured against how much this picture flickers by itself. A brighter shot that
   * only holds its level is not a climb; a glow that builds up and then a cut to white: the flash
   * is the cut. A picture shown twice in a row (a film of 24 frames in a file of 50 or 60) does
   * not end a climb.
   * Returns { rise, open, holes, fuzzy, unclear, burst }:
   *   open     the climb begins at the very start of what was looked at: where it began was not seen
   *   holes    frames are missing in the climb or just before it
   *   fuzzy    the first step is hardly bigger than the flicker: the frame may be a frame or two off
   *   unclear  a short brighter moment, then a cut to white: either could be the flash
   *   burst    a white flash comes just before the climb: either could be the snap
   */
  function climbStart(F, start, dt, frameDt) {
    const level = (i) => {
      const v = [];
      for (let k = i - 1; k >= 0 && (F[i].t - F[k].t <= 0.105 + 1e-6 || v.length < 2); k--) v.push(F[k].mean);
      return v.length ? median(v) : F[i].mean;
    };
    // The flicker: how far each frame of the two seconds before is from the average of its two
    // neighbours (a steady climb, however long, is no flicker). Pictures repeated in a 50 or 60
    // frame file say nothing about flicker and are left out.
    const dev = [];
    const diff = [];                                   // between one picture and the next different one
    let same = 0;
    let pairs = 0;
    for (let i = start - 2; i > 0 && F[start].t - F[i].t <= 2; i--) {
      dev.push(Math.abs(F[i].mean - (F[i - 1].mean + F[i + 1].mean) / 2));
      const d = Math.abs(F[i].mean - F[i - 1].mean);
      pairs++;
      if (d < 1e-5) same++; else diff.push(d);
    }
    // A film of 24 pictures a second in a file of 25, 30, 50 or 60 frames shows some pictures twice
    // or three times: then the flicker is measured from one picture to the next different one.
    // (A picture that does not move at all has no flicker: the corners of the climb itself, which
    // are the only frames that "move" then, must not be taken for it.)
    const repeated = pairs >= 8 && same >= pairs * 0.2;
    const sigma = dev.length < 4 ? 0.01 : repeated ? (diff.length >= 4 ? 1.4826 * median(diff) / 1.4142 : 0) : 1.4826 * median(dev) / 1.2247;
    const g = Math.max(0.015, 3.5 * sigma);
    const bridge = Math.max(1, Math.round(0.06 / dt));
    let rise = start;
    let open = false;
    while (rise > 0) {
      if (F[start].t - F[rise - 1].t > 2.5) { open = true; break; }
      let q = -1;
      for (let k = rise - 1; k >= Math.max(1, rise - 1 - bridge); k--) {
        if (F[k].mean > F[rise].mean + g) break;                     // brighter than what follows: not this climb
        if (F[k].mean - level(k) >= g) { q = k; break; }
      }
      if (q < 0) break;
      rise = q;
    }
    // The climb must begin inside what was looked at, with a moment of picture before it.
    if (rise <= 1 || F[rise].t - F[0].t < 0.25) open = true;
    // Is the climb one event, or something brighter first and then the cut to white? A steady
    // ramp is one event: it begins where it begins. A glow or a brighter shot that lasted a
    // quarter of a second or more and then a much bigger step: the flash is that step. Anything
    // shorter than that, then a cut: which of the two is the flash cannot be told.
    const big = Math.max(0.2, 4 * g);
    let unclear = false;
    let jCut = -1;
    for (let j = start; j > rise; j--) if (F[j].mean - F[j - 1].mean >= big) { jCut = j; break; }
    if (jCut > rise) {
      const cutStep = F[jCut].mean - F[jCut - 1].mean;
      let biggest = 0;
      let held = false;
      let lastUp = F[rise].t;
      const pause = repeated ? 0.06 : dt * 0.5;            // a repeated picture is not a pause
      for (let k = rise; k < jCut; k++) {
        const d = F[k].mean - (k > 0 ? F[k - 1].mean : F[k].mean);
        if (d >= g / 2) { biggest = Math.max(biggest, d); lastUp = F[k].t; } else if (F[k].t - lastUp > pause) held = true;
      }
      const ramp = !held && cutStep < 2.5 * biggest;
      if (!ramp) {
        if (F[jCut].t - F[rise].t >= 0.25 - 1e-6) rise = jCut;
        else unclear = true;
      }
    }
    // A white flash just before the climb (the flash flickering): which of the two is the snap?
    let burst = false;
    for (let k = rise - 1; k >= 0 && F[rise].t - F[k].t <= 0.6; k--) if (F[k].white >= 0.75 || F[k].mean >= 0.8) { burst = true; break; }
    const fuzzy = F[rise].mean - level(rise) < 1.5 * g || g >= 0.1;
    // A missing frame is a gap longer than one frame. (When many frames are missing, the usual gap
    // is no longer one frame long: the shortest gaps are.)
    const step = Math.min(dt, frameDt > 0 ? frameDt : dt);
    let holes = false;
    for (let i = Math.max(1, rise - 2); i <= start; i++) if (F[i].t - F[i - 1].t > step * 1.6) holes = true;
    return { rise: rise, open: open, holes: holes, fuzzy: fuzzy, unclear: unclear, burst: burst };
  }

  /**
   * Looks for the flash of the snap in a run of frames: the picture going white all over, out of
   * a picture that was not.
   *
   *   frames  [{ t, mean, white }]  t = film time of the frame, mean = average brightness (0..1)
   *           of the middle of the picture, white = share of that area that is nearly white
   *   opts    expect  where the snap is thought to be (breaks ties)
   *           after   when the line "...Iron Man." goes off screen, if that is known: then the
   *                   first white-out that begins between 0.75 s before and 4 s after it is taken
   *           minDur  how long a white-out has to last to count (0.12 s)
   *
   * Returns null, or { start, rise, end, kind, duration, rivals, open, holes, fuzzy, runs } with
   * positions in `frames`:
   *   start   the first frame that is white all over
   *   rise    the frame on which the brightness began to climb towards it: the snap frame
   *   kind    'white' (the screen whites out) or 'bright' (only a clear peak of brightness)
   *   rivals  how many other white-outs there are in the frames
   *   open, holes, fuzzy, unclear, burst  see climbStart: any of them makes it a suggestion, not a find
   *   runs    every white-out (or the peak), as { start, rise, end, kind, duration }
   *   peaks   clear peaks of brightness that are not white and not part of a white-out, { start, end }
   */
  function findFlash(frames, opts) {
    opts = opts || {};
    // Only frames that follow each other in time count: a re-cue shows a stretch twice.
    const idx = [];
    for (let i = 0; i < (frames ? frames.length : 0); i++) {
      const f = frames[i];
      if (!f || !isFinite(f.t)) continue;
      while (idx.length && frames[idx[idx.length - 1]].t >= f.t) idx.pop();
      idx.push(i);
    }
    const F = idx.map((i) => frames[i]);
    const n = F.length;
    if (n < 4) return null;
    const gaps = [];
    for (let i = 1; i < n; i++) gaps.push(F[i].t - F[i - 1].t);
    const dt = Math.max(1e-3, median(gaps));
    const frameDt = Math.max(1e-3, percentile(gaps, 0.15));
    const minDur = opts.minDur != null ? opts.minDur : 0.12;
    const expect = isFinite(opts.expect) ? opts.expect : (F[0].t + F[n - 1].t) / 2;
    const EPS = 1e-6;

    // 1. White-outs. A frame on the way up that is only nearly white does not hide what follows,
    //    and a frame that flickers darker inside the white-out does not end it.
    const runs = [];
    let armed = false;
    for (let i = 0; i < n; i++) {
      if (!(F[i].white >= 0.75)) { armed = true; continue; }
      if (!armed || !(F[i].white >= 0.88)) continue;
      let j = i;
      for (let k = i + 1; k < n; k++) {
        if (F[k].t - F[k - 1].t >= Math.max(0.3, dt * 4)) break;
        if (F[k].white >= 0.75) j = k;
        else if (F[k].t - F[j].t > 0.15 + EPS) break;
      }
      const duration = F[j].t - F[i].t + dt;
      if (duration >= minDur - EPS) runs.push({ start: i, end: j, duration: duration, kind: 'white' });
      i = j;
      armed = false;
    }

    // 2. Failing that, one clear peak of brightness (a flash that does not reach pure white).
    if (!runs.length) {
      const means = F.map((f) => f.mean);
      const base = median(means);
      let top = 0;
      for (let i = 1; i < n; i++) if (means[i] > means[top]) top = i;
      const peak = means[top];
      if (peak >= 0.6 && peak - base >= 0.35) {
        const half = (peak + base) / 2;
        let a = top;
        let b = top;
        while (a > 0 && means[a - 1] >= half) a--;
        while (b + 1 < n && means[b + 1] >= half) b++;
        const duration = F[b].t - F[a].t + dt;
        if (a > 0 && duration >= Math.min(minDur, 0.08) - EPS && duration <= 4) runs.push({ start: a, end: b, duration: duration, kind: 'bright' });
      }
    }
    if (!runs.length) return null;
    for (const r of runs) Object.assign(r, climbStart(F, r.start, dt, frameDt));

    // Clear peaks of brightness that do not reach white and are not part of a white-out (its
    // climb, the white, and its fading): if the snap does not white out, one of them may be it.
    const peaks = [];
    if (runs.some((r) => r.kind === 'white')) {
      const base = median(F.map((f) => f.mean));
      const floor = Math.max(0.6, base + 0.35);
      const inRun = (t) => runs.some((r) => t >= F[r.rise].t - 0.1 && t <= F[r.end].t + 1.0);
      let a = -1;
      for (let i = 0; i <= n; i++) {
        const on = i < n && F[i].mean >= floor && !(F[i].white >= 0.75) && !inRun(F[i].t);
        if (on && a < 0) a = i;
        if (!on && a >= 0) {
          if (F[i - 1].t - F[a].t + dt >= 0.08 - EPS) peaks.push({ start: a, end: i - 1 });
          a = -1;
        }
      }
    }

    // Which one. With the line known: the first white-out that begins right after it. Otherwise
    // the longest; between (nearly) equals, the one nearest to where the snap is expected.
    let run = null;
    if (isFinite(opts.after)) {
      for (const r of runs) {
        const d = F[r.rise].t - opts.after;
        if (d > -0.75 && d < 4) { run = r; break; }
      }
    }
    if (!run) {
      const same = Math.max(dt * 1.5, 0.08);
      run = runs[0];
      for (const r of runs) {
        const longer = Math.min(r.duration, 1.5) - Math.min(run.duration, 1.5);
        if (longer > same || (Math.abs(longer) <= same && Math.abs(F[r.start].t - expect) < Math.abs(F[run.start].t - expect))) run = r;
      }
    }
    return {
      start: idx[run.start], rise: idx[run.rise], end: idx[run.end], kind: run.kind, duration: run.duration,
      rivals: runs.filter((r) => r !== run && r.kind === 'white').length,
      open: run.open, holes: run.holes, fuzzy: run.fuzzy, unclear: run.unclear, burst: run.burst,
      runs: runs.map((r) => ({ start: idx[r.start], rise: idx[r.rise], end: idx[r.end], kind: r.kind, duration: r.duration })),
      peaks: peaks.map((p) => ({ start: idx[p.start], end: idx[p.end] }))
    };
  }

  /**
   * What may be done with what a search for the snap saw. There are two witnesses: the white-out
   * in the picture, and the line "...Iron Man." in subtitles that are known to be in step with the
   * film (the movie's own, or a file the app has put on the voices). The snap follows that line
   * by a moment in every copy.
   *
   *   frames  the frames looked at, [{ t, mean, white }]
   *   line    { end, checked } or null; only a checked line is a witness
   *   opts    expect  where the snap is thought to be
   *           wide    the frames come from the wide search, far from where the snap was expected
   *           lent    an armed countdown lent the film for the search: only a find may change it
   *           rivals  white-outs seen elsewhere (by the wide search) that could be the snap too
   *
   * Returns { verdict, at, flash, why, after }:
   *   'found'     set as found. A clean white-out (every frame there, a climb that starts clearly,
   *               white for at least 0.2 s) that begins between 0.75 s before and 2 s after a
   *               checked line, with no other white-out beginning there; or, with no checked line,
   *               a clean white-out of at least 0.3 s near where the snap was expected, the only
   *               white-out in sight
   *   'likely'    set, not marked as found: the same, but only the wide search saw it
   *   'estimate'  set, not marked as found: no flash at all, and a checked line: 0.1 s after it
   *   'ask'       nothing set: what was seen does not settle it, and the film strip asks
   *   why         'flash+line', 'flash', 'far', 'line', or what stood in the way: 'disagree',
   *               'crowd', 'rivals', 'holes', 'open', 'fuzzy', 'unclear', 'burst', 'edge', 'hint',
   *               'short', 'bright', 'nothing', 'armed'
   *   after       seconds from the end of the line to the flash (null without both)
   */
  function judgeSnap(frames, line, opts) {
    opts = opts || {};
    const EPS = 1e-6;
    const checked = !!(line && line.checked && isFinite(line.end));
    const flash = findFlash(frames, { expect: checked ? line.end + 0.1 : opts.expect, after: checked ? line.end : undefined });
    const at = flash ? frames[flash.rise].t : null;
    const after = checked && flash ? at - line.end : null;
    const res = (verdict, why, t) => ({ verdict: verdict, at: t != null ? t : at, flash: flash, why: why, after: after });
    const flaw = !flash ? 'nothing' : flash.kind !== 'white' ? 'bright' : flash.holes ? 'holes' : flash.open ? 'open' :
      flash.burst ? 'burst' : flash.unclear ? 'unclear' : flash.fuzzy ? 'fuzzy' : '';
    const first = frames && frames.length ? frames[0].t : NaN;
    const last = frames && frames.length ? frames[frames.length - 1].t : NaN;
    if (checked) {
      // Only frames that cover the whole moment after the line can say what happened in it.
      if (!(first <= line.end - 2 + EPS && last >= line.end + 2.5 - EPS)) return res('ask', 'edge');
      if (!flash) return opts.lent ? res('ask', 'armed') : res('estimate', 'line', Math.round((line.end + 0.1) * 1000) / 1000);
      const near = (t) => t - line.end > -0.75 - EPS && t - line.end < 2 + EPS;
      if (!near(at)) return res('ask', 'disagree');
      const crowd = flash.runs.filter((r) => r.kind === 'white' && r.start !== flash.start && near(frames[r.rise].t)).length +
        flash.peaks.filter((p) => near(frames[p.start].t)).length;
      if (flaw) return res('ask', flaw);
      if (crowd) return res('ask', 'crowd');
      if (flash.duration < 0.2 - EPS) return res('ask', 'short');
      return res('found', 'flash+line');
    }
    if (flaw) return res('ask', flaw);
    if (flash.rivals || flash.peaks.length || opts.rivals > 0) return res('ask', 'rivals');
    if (flash.duration < 0.3 - EPS) return res('ask', 'short');
    // A subtitle file nobody has checked is no witness, but one that puts the line well away from
    // this flash is a reason to doubt it.
    if (line && isFinite(line.end) && Math.abs(at - (line.end + 0.1)) > 3) return res('ask', 'hint');
    const close = isFinite(opts.expect) && at >= opts.expect - 3.5 && at <= opts.expect + 7.5;
    if (!opts.wide && close) return res('found', 'flash');
    return opts.lent ? res('ask', 'armed') : res('likely', 'far');
  }

  /**
   * Finds the line "And I... am... Iron Man." in a list of subtitle cues ({ start, end, text }).
   * On the discs it is split over three cues several seconds apart, captions for the hard of
   * hearing put sounds such as (PANTING) in between, subtitles read off a disc by machine write
   * "l" for "I", and some files put the speaker's name in front: up to five cues with words in a
   * row are read as one sentence, and sound captions and names are left out.
   *   expect  where the snap is thought to be: of several places, the one nearest to it wins
   *   opts    before, after: only a line that ends within this many seconds of `expect` counts
   * Returns { start, end, text } (end = when the last cue of the line goes off screen) or null.
   */
  function findSnapLine(cues, expect, opts) {
    if (!cues || !cues.length) return null;
    opts = opts || {};
    const re = /(?:^|[^a-z0-9])[il|](?:[^a-z0-9]{0,12}am|['’]m)[^a-z0-9]{0,12}[il|]ron[^a-z0-9]{0,3}man(?![a-z0-9])/i;
    // Tags, sound captions in brackets (closed or not) and speaker names are not part of what is said.
    const plain = (c) => String(c && c.text != null ? c.text : '').replace(/<[^>]*>|\{[^}]*\}/g, ' ').replace(/\\N/g, '\n')
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[(\[][^\n)\]]*$/gm, ' ')
      .replace(/(^|\n)\s*[-–—]?\s*[A-Za-z][A-Za-z .'\-]{0,24}:\s*/g, '$1')
      .replace(/\s+/g, ' ').trim();
    const said = cues.map(plain);
    const known = isFinite(expect);
    let best = null;
    for (let i = 0; i < cues.length; i++) {
      if (!said[i]) continue;
      let text = '';
      let spoken = 0;
      let last = i;
      for (let j = i; j < cues.length && spoken < 5; j++) {
        if (j > i && (cues[j].start - cues[last].end > 8 || cues[j].end - cues[i].start > 25)) break;
        if (!said[j]) continue;                        // a sound caption: not one of the five
        spoken++;
        last = j;
        text = (text + ' ' + said[j]).trim();
        if (!re.test(text)) continue;
        const end = cues[j].end;
        if (known && ((opts.before != null && end < expect - opts.before) || (opts.after != null && end > expect + opts.after))) break;
        const d = Math.abs(end - (known ? expect : end));
        // Nearest to where the snap is expected; of runs that end on the same cue, the tightest.
        if (!best || d < best.d - 1e-6 || (Math.abs(d - best.d) <= 1e-6 && cues[i].start > best.start)) best = { start: cues[i].start, end: end, text: text, d: d };
        break;
      }
    }
    return best ? { start: best.start, end: best.end, text: best.text } : null;
  }

  /* ------------------------------------------------ subtitles and voices */

  function percentile(values, p) {
    if (!values || !values.length) return NaN;
    const s = Array.from(values).sort((x, y) => x - y);
    const i = clamp(p, 0, 1) * (s.length - 1);
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  }

  /** x minus its own average over `width` frames around each frame: what is left is the quick ups and downs. */
  function detrend(x, width) {
    const n = x.length;
    const out = new Float32Array(n);
    const half = Math.floor(width / 2);
    let sum = 0;
    let lo = 0;
    let hi = -1;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - half);
      const b = Math.min(n - 1, i + half);
      while (hi < b) sum += x[++hi];
      while (lo < a) sum -= x[lo++];
      out[i] = x[i] - sum / (b - a + 1);
    }
    return out;
  }

  /** The average of x over `width` frames around each frame. */
  function smoothed(x, width) {
    const flat = detrend(x, width);
    for (let i = 0; i < flat.length; i++) flat[i] = x[i] - flat[i];
    return flat;
  }

  /**
   * "Is somebody speaking?" for every frame of a stretch of sound.
   *   energy  the mean square of the sound per frame (the speech band, the centre of the mix)
   *   hz      frames a second (50)
   *
   * Loudness alone does not tell: a film is loudest where nobody speaks. Two things do. Speech
   * rises and falls at the pace of syllables and stops between phrases, where music holds its
   * level; and what counts is the level against the last few seconds, not against the whole film
   * (a loud scene is not one long line). So the level is taken on a scale from the quiet to the
   * loud parts of the stretch, the syllable flutter is added, and everything slower than a few
   * seconds is taken out.
   *
   * Returns { score, sharp }: `score` finds the place (level and flutter), `sharp` sets it exactly
   * (level only: the flutter is a little early). Both hover around zero.
   */
  function speechScore(energy, hz) {
    const n = energy ? energy.length : 0;
    const rate = hz > 0 ? hz : 50;
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) db[i] = 10 * Math.log10((energy[i] > 0 ? energy[i] : 0) + 1e-9);
    const lo = percentile(db, 0.3);
    const hi = percentile(db, 0.92);
    const span = Math.max(8, hi - lo);               // at least 8 dB between "quiet" and "speech"
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = clamp((db[i] - lo) / span, 0, 1);
    const level = smoothed(raw, Math.round(rate * 0.1));
    // Flutter: how far the level of the moment is from the level of the half second around it.
    const quick = smoothed(db, Math.round(rate * 0.06));
    const slow = smoothed(db, Math.round(rate * 0.5));
    const away = new Float32Array(n);
    for (let i = 0; i < n; i++) away[i] = Math.abs(quick[i] - slow[i]);
    const flutter = smoothed(away, Math.round(rate * 0.5));
    const both = new Float32Array(n);
    for (let i = 0; i < n; i++) both[i] = level[i] + clamp(flutter[i] / 6, 0, 1);
    const width = Math.round(rate * 4);
    return { score: detrend(both, width), sharp: detrend(level, width) };
  }

  /** 1 wherever a subtitle line is on screen, `hz` steps a second, with film time = cue time * scale. */
  function cueTimeline(cues, hz, scale, length) {
    const m = new Uint8Array(length);
    for (const c of cues) {
      const a = Math.max(0, Math.round(c.start * scale * hz));
      const b = Math.min(length - 1, Math.round(c.end * scale * hz));
      for (let i = a; i <= b; i++) m[i] = 1;
    }
    return m;
  }

  /*
   * Subtitle files made for another frame rate run at one of these speeds against the film: the
   * file's own speed first, then the likeliest ones (25 against 23.976 frames a second, and back).
   */
  const SUB_SCALES = [1, 25000 / 23976, 23976 / 25000, 24000 / 23976, 23976 / 24000, 25 / 24, 24 / 25];

  /**
   * Which of two fits to believe when the speeds are tried one after the other, likeliest first.
   * A later speed has to be clearly better: on a short film two speeds hardly differ, and the
   * file's own speed is given up last of all.
   */
  function betterFit(best, next) {
    if (!next) return best;
    if (!best) return next;
    return next.peak > best.peak * (best.scale === 1 ? 1.03 : 1.01) ? next : best;
  }

  /**
   * Which stretches of the film to listen to: a film is long, and up to an hour of it, taken
   * from all over and where the talking is, says nearly as much as the whole.
   *   total  how many seconds of sound may be listened to altogether (a huge file is slow to read)
   * Returns [{ from, dur }]; a short film is taken whole.
   */
  function speechPlan(durationSec, cues, total) {
    const dur = Number(durationSec);
    if (!(dur > 8)) return [];
    if (dur <= 1200) return [{ from: 0, dur: Math.floor(dur) }];
    const budget = total > 0 ? total : 3600;
    let K = clamp(Math.round(dur / 720), 6, 16);
    if (budget / K < 60) K = Math.max(4, Math.floor(budget / 60));
    const from = dur * 0.03;
    const span = dur * 0.9 / K;
    const W = Math.min(clamp(Math.floor(budget / K), 60, 240), Math.floor(span));     // never two stretches over the same part
    const plan = [];
    for (let i = 0; i < K; i++) {
      const a = from + i * span;
      // Within this part of the film, the stretch with the most subtitle lines in it.
      let best = a + (span - W) / 2;
      let most = -1;
      for (let t = a; t + W <= a + span + 1; t += 30) {
        let on = 0;
        for (const c of cues || []) { if (c.end > t && c.start < t + W) on += Math.min(c.end, t + W) - Math.max(c.start, t); }
        if (on > most) { most = on; best = t; }
      }
      plan.push({ from: Math.round(clamp(best, 0, dur - W - 1)), dur: W });
    }
    return plan;
  }

  /** The stretches where a 0/1 time line is 1, as a flat list [from, to, from, to, …], `to` exclusive. */
  function runsOf(S) {
    const out = [];
    const n = S.length;
    let i = 0;
    while (i < n) {
      if (!S[i]) { i++; continue; }
      let j = i + 1;
      while (j < n && S[j]) j++;
      out.push(i, j);
      i = j;
    }
    return out;
  }

  /** The sum of a track over the runs moved by `lag`, within [lo, hi). P is the track's running total. */
  function runSum(P, runs, lag, lo, hi) {
    let sum = 0;
    for (let q = 0; q < runs.length; q += 2) {
      let a = runs[q] + lag;
      let b = runs[q + 1] + lag;
      if (a < lo) a = lo;
      if (b > hi) b = hi;
      if (b > a) sum += P[b] - P[a];
    }
    return sum;
  }

  const runningTotal = (A) => {
    const P = new Float64Array(A.length + 1);
    for (let i = 0; i < A.length; i++) P[i + 1] = P[i] + A[i];
    return P;
  };

  /**
   * How a subtitle file has to be moved to sit on the voices: film time = cue time * scale + offset.
   *
   *   windows  [{ from, hz, score, sharp }]  for stretches of the film, how much speech there is in
   *            every frame: speechScore of the sound (`score` finds the place, `sharp` sets it), or
   *            1/0 from subtitles that are known to be right (`score` only)
   *   cues     [{ start, end }]       the subtitle lines as the file has them
   *   opts.linger  seconds a line stays on screen after the voice has stopped (subtitles do that,
   *            and against sound it pulls the answer early); 0 against other subtitles
   *   opts.minLines  how many lines have to fall inside the stretches for the answer to count (12)
   *   opts.halves  false: do not ask that two halves of the film agree (a few lines of subtitles
   *            against other subtitles cannot be split)
   *
   * Every shift up to maxOffset seconds either way is tried at each of the usual speeds, first
   * coarsely, then to the frame around the best one. Returns null when there is nothing to go by,
   * otherwise { offset, scale, z, strength, peak, contrast, lines, halves, confident, mixed, other, windows }:
   *   z, strength  how far the best fit stands out from the others, and how well the lines sit on
   *                the voices (a correlation, 0..1)
   *   contrast     how much more speech there is while a line is up than while none is
   *   lines        how many lines fall inside the stretches at the answer
   *   halves       every other half minute of the film, and the rest, each give the same answer
   *   peak         the raw height of the best fit: the speed that gives the highest one is the right one
   *   confident    only then should anything be changed
   *   mixed        stretches of the film that do not fit would fit with another shift: the file
   *                was made for another cut; `other` = { offset, from, count } says which shift and
   *                from which stretch on
   */
  function alignCues(windows, cues, opts) {
    opts = opts || {};
    const scales = opts.scales || SUB_SCALES;
    const maxOff = opts.maxOffset != null ? opts.maxOffset : 120;
    const CZ = 5;                                    // coarse steps a second
    const wins = (windows || []).filter((w) => w && w.score && w.hz > 0 && w.score.length >= w.hz * 4);
    if (!wins.length || !cues || cues.length < 3) return null;
    const linger = opts.linger > 0 ? opts.linger : 0;
    if (linger) {
      // What is compared with the sound is when the line is SPOKEN: a little less than when it is shown.
      cues = cues.map((c) => {
        const len = c.end - c.start;
        return { start: c.start + Math.min(0.05, len * 0.1), end: c.end - Math.min(linger, len * 0.3) };
      });
    }
    const hz = wins[0].hz;
    const step = Math.max(1, Math.round(hz / CZ));
    const lastCue = cues.reduce((m, c) => Math.max(m, c.end), 0);
    const lastWin = wins.reduce((m, w) => Math.max(m, w.from + w.score.length / w.hz), 0);

    // The stretches laid out on the film's own time line, each with its own average taken out:
    // coarsely from `score` (to find the place), frame by frame from `sharp` (to set it). With
    // running totals, the sum under all the lines at any shift costs one step per line.
    const lenC = Math.ceil((lastWin + 1) * CZ) + 1;
    const lenF = Math.ceil((lastWin + 1) * hz) + 1;
    const AC = new Float32Array(lenC);
    const AF = new Float32Array(lenF);
    const HF = new Uint8Array(lenF);                 // 1 where the film was listened to
    const spans = [];
    let saa = 0;
    let all = 0;
    for (const w of wins) {
      const nC = Math.floor(w.score.length / step);
      const c0 = Math.round(w.from * CZ);
      const c1 = Math.min(lenC, c0 + nC);
      let mean = 0;
      for (let i = 0; i < nC; i++) {
        let sum = 0;
        for (let k = 0; k < step; k++) sum += w.score[i * step + k];
        if (c0 + i < lenC) AC[c0 + i] = sum / step;
        mean += sum / step;
      }
      mean /= nC || 1;
      let caa = 0;
      for (let i = c0; i < c1; i++) { AC[i] -= mean; caa += AC[i] * AC[i]; }
      const src = w.sharp && w.sharp.length === w.score.length ? w.sharp : w.score;
      const f0 = Math.round(w.from * hz);
      const f1 = Math.min(lenF, f0 + src.length);
      let m2 = 0;
      for (let i = 0; i < src.length; i++) m2 += src[i];
      m2 /= src.length || 1;
      let aa = 0;
      for (let i = f0; i < f1; i++) {
        const v = src[i - f0] - m2;
        AF[i] = v;
        HF[i] = 1;
        aa += v * v;
      }
      spans.push({ from: w.from, c0: c0, c1: c1, caa: caa, f0: f0, f1: f1, aa: aa });
      saa += aa;
      all += f1 - f0;
    }
    const PC = runningTotal(AC);

    const L = Math.round(maxOff * CZ);
    const sweep = (P, runs) => {
      const curve = new Float64Array(2 * L + 1);
      let top = 0;
      for (let lag = -L; lag <= L; lag++) {
        const v = runSum(P, runs, lag, 0, lenC);
        curve[lag + L] = v;
        if (v > curve[top]) top = lag + L;
      }
      return { curve: curve, lag: top - L, peak: curve[top] };
    };
    let best = null;
    for (const r of scales) {
      const runs = runsOf(cueTimeline(cues, CZ, r, Math.ceil((lastCue * r + 1) * CZ) + 1));
      const found = sweep(PC, runs);
      const next = { r: r, scale: r, lag: found.lag, peak: found.peak, curve: found.curve, runs: runs };
      if (betterFit(best, next) === next) best = next;
    }
    // How far the peak stands out from what the other shifts give (its own neighbourhood left out).
    let n = 0;
    let mean = 0;
    const far = (i) => Math.abs(i - (best.lag + L)) > 3 * CZ;
    for (let i = 0; i < best.curve.length; i++) if (far(i)) { mean += best.curve[i]; n++; }
    mean /= n || 1;
    let spread2 = 0;
    for (let i = 0; i < best.curve.length; i++) if (far(i)) spread2 += (best.curve[i] - mean) * (best.curve[i] - mean);
    const z = (best.peak - mean) / (Math.sqrt(spread2 / (n || 1)) || 1e-9);

    // A fit that is real shows in any part of the film. Every other half minute goes to one half,
    // the rest to the other, and each half is asked on its own: a chance fit does not repeat.
    let halves = false;
    if (all / hz >= 120) {
      const block = 30 * CZ;
      const A0 = new Float32Array(lenC);
      const A1 = new Float32Array(lenC);
      for (let i = 0; i < lenC; i++) { if (Math.floor(i / block) % 2 === 0) A0[i] = AC[i]; else A1[i] = AC[i]; }
      const h0 = sweep(runningTotal(A0), best.runs).lag;
      const h1 = sweep(runningTotal(A1), best.runs).lag;
      halves = Math.abs(h0 - best.lag) <= 3 && Math.abs(h1 - best.lag) <= 3;
    }

    // Fine: around the coarse answer, frame by frame.
    const runsF = runsOf(cueTimeline(cues, hz, best.r, Math.ceil((lastCue * best.r + 1) * hz) + 1));
    const PF = runningTotal(AF);
    const PH = runningTotal(HF);
    const centre = Math.round(best.lag / CZ * hz);
    const reach = Math.round(0.5 * hz);
    let bestF = centre;
    let bestV = -Infinity;
    for (let lag = centre - reach; lag <= centre + reach; lag++) {
      const v = runSum(PF, runsF, lag, 0, lenF);
      if (v > bestV) { bestV = v; bestF = lag; }
    }

    // How well the lines sit on the voices at the answer (a correlation), and how much more speech
    // there is under the lines than between them. A film whose sound is one long hum has a best
    // fit too, on whatever click it contains: that must not count.
    const on = runSum(PH, runsF, bestF, 0, lenF);
    const share = on / (all || 1);
    const strength = bestV / (Math.sqrt(saa * all * share * (1 - share)) || 1e-9);
    const contrast = on > 0 && all > on ? bestV / on + bestV / (all - on) : 0;      // the stretches average zero
    const offsetExact = bestF / hz;
    let lines = 0;
    for (const c of cues) {
      const a = c.start * best.r + offsetExact;
      const b = c.end * best.r + offsetExact;
      if (wins.some((w) => b > w.from && a < w.from + w.score.length / w.hz)) lines++;
    }
    const minLines = opts.minLines != null ? opts.minLines : 12;

    // Does every stretch of the film fit? Each gets its own correlation at the answer.
    const local = spans.map((sp) => {
      const len = sp.f1 - sp.f0;
      const part = runSum(PH, runsF, bestF, sp.f0, sp.f1) / (len || 1);
      const sum = runSum(PF, runsF, bestF, sp.f0, sp.f1);
      return { from: sp.from, lines: part, strength: part > 0.08 && part < 0.92 ? sum / (Math.sqrt(sp.aa * len * part * (1 - part)) || 1e-9) : null };
    });

    // A stretch that does not fit at all: would it fit with another shift? Two such stretches that
    // agree on one say the file was made for another cut of the film (and where the cuts differ).
    const offset = Math.round(bestF / hz * 100) / 100;
    const ones = new Uint8Array(lenC).fill(1);
    const P1 = runningTotal(ones);
    const elsewhere = [];
    for (let wi = 0; wi < spans.length; wi++) {
      if (local[wi].strength == null || local[wi].strength >= 0.15 * strength) continue;
      const sp = spans[wi];
      const len = sp.c1 - sp.c0;
      let top = null;
      for (let lag = -L; lag <= L; lag++) {
        const part = runSum(P1, best.runs, lag, sp.c0, sp.c1) / (len || 1);
        if (!(part > 0.08 && part < 0.92)) continue;
        const fit = runSum(PC, best.runs, lag, sp.c0, sp.c1) / (Math.sqrt(sp.caa * len * part * (1 - part)) || 1e-9);
        if (!top || fit > top.fit) top = { fit: fit, offset: lag / CZ };
      }
      if (top && top.fit >= 0.5 * strength && Math.abs(top.offset - offset) > 1) elsewhere.push({ from: sp.from, offset: top.offset });
    }
    let other = null;
    for (const a of elsewhere) {
      const same = elsewhere.filter((b) => Math.abs(b.offset - a.offset) <= 0.6);
      if (same.length >= 2 && (!other || same.length > other.count)) {
        other = { count: same.length, offset: Math.round(median(same.map((b) => b.offset)) * 10) / 10, from: Math.min.apply(null, same.map((b) => b.from)) };
      }
    }

    return {
      offset: offset, scale: best.r, z: z, strength: strength, peak: best.peak, contrast: contrast, lines: lines, halves: halves,
      // Thresholds from films put together out of real voices, music and effects (see the tests).
      // (A fit that towers over the rest needs no second opinion: a file made for another cut has
      // two places that fit, and either may come out on top in one half of the film.)
      confident: z >= ALIGN.z && strength >= ALIGN.strength && contrast >= ALIGN.contrast && lines >= minLines &&
        (opts.halves === false || halves || (z >= ALIGN.sure.z && strength >= ALIGN.sure.strength)),
      mixed: !!other, other: other, windows: local
    };
  }

  /*
   * What a fit has to show before anything is moved on the strength of it. Measured on films put
   * together from real voices, real music and real sound effects (speech from 8 dB over the rest
   * down to 6 dB under it, in one channel): the right place gave z 6.8 to 16.6, strength 0.09 to
   * 0.28 and contrast 0.05 to 0.14, and both halves agreed every time; subtitles of another film
   * and sound without speech gave z up to 4.9, strength up to 0.05 (0.12 once), contrast up to
   * 0.03 (0.08 once), and the halves never agreed.
   */
  const ALIGN = { z: 6, strength: 0.07, contrast: 0.035, sure: { z: 9, strength: 0.15 } };

  /* Languages of sound tracks: files label them with ISO 639 codes, people read names. */
  const LANG_NAMES = {
    eng: 'English', hin: 'Hindi', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', ben: 'Bengali',
    mar: 'Marathi', urd: 'Urdu', pan: 'Punjabi', guj: 'Gujarati', spa: 'Spanish', fra: 'French', deu: 'German',
    ita: 'Italian', por: 'Portuguese', rus: 'Russian', jpn: 'Japanese', kor: 'Korean', zho: 'Chinese', ara: 'Arabic',
    tur: 'Turkish', pol: 'Polish', nld: 'Dutch', swe: 'Swedish', nor: 'Norwegian', dan: 'Danish', fin: 'Finnish',
    ell: 'Greek', heb: 'Hebrew', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', msa: 'Malay', ukr: 'Ukrainian',
    ces: 'Czech', hun: 'Hungarian', ron: 'Romanian', fas: 'Persian', fil: 'Filipino'
  };
  const LANG_ALIASES = {
    en: 'eng', hi: 'hin', ta: 'tam', te: 'tel', ml: 'mal', kn: 'kan', bn: 'ben', mr: 'mar', ur: 'urd', pa: 'pan', gu: 'guj',
    es: 'spa', fr: 'fra', fre: 'fra', de: 'deu', ger: 'deu', it: 'ita', pt: 'por', ru: 'rus', ja: 'jpn', ko: 'kor',
    zh: 'zho', chi: 'zho', ar: 'ara', tr: 'tur', pl: 'pol', nl: 'nld', dut: 'nld', sv: 'swe', no: 'nor', nb: 'nor', da: 'dan',
    fi: 'fin', el: 'ell', gre: 'ell', he: 'heb', iw: 'heb', th: 'tha', vi: 'vie', id: 'ind', ms: 'msa', may: 'msa', uk: 'ukr',
    cs: 'ces', cze: 'ces', hu: 'hun', ro: 'ron', rum: 'ron', fa: 'fas', per: 'fas', tl: 'fil'
  };

  /** Sound formats the player's own decoder handles on every PC. Dolby, DTS and the rest need converting. */
  function playableAudioCodec(codec) {
    const c = String(codec || '').toLowerCase();
    return ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(c) || /^pcm_/.test(c);
  }

  const AUDIO_CODEC_NAMES = {
    ac3: 'Dolby Digital (AC-3)', eac3: 'Dolby Digital Plus (E-AC-3)', dts: 'DTS', truehd: 'Dolby TrueHD', mlp: 'MLP',
    wmav2: 'Windows Media Audio', wmapro: 'Windows Media Audio Pro', alac: 'Apple Lossless', mp2: 'MPEG Layer II', amr_nb: 'AMR',
    aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC'
  };
  const audioCodecName = (codec) => AUDIO_CODEC_NAMES[String(codec || '').toLowerCase()] || String(codec || 'unknown').toUpperCase();

  /** "en", "EN-us", "eng", "English" -> "eng". Empty string when unknown or undefined ("und"). */
  function normLang(code) {
    const raw = String(code == null ? '' : code).trim().toLowerCase();
    if (!raw || raw === 'und' || raw === 'unknown') return '';
    const base = raw.split(/[-_]/)[0];
    if (LANG_NAMES[base]) return base;
    if (LANG_ALIASES[base]) return LANG_ALIASES[base];
    for (const k of Object.keys(LANG_NAMES)) if (LANG_NAMES[k].toLowerCase() === raw) return k;
    return /^[a-z]{2,3}$/.test(base) ? base : '';
  }

  function langName(code) {
    const k = normLang(code);
    return k ? (LANG_NAMES[k] || k.toUpperCase()) : '';
  }

  /** A language named in a track title such as "Hindi DDP 5.1" or "English (Commentary)". */
  function langFromTitle(title) {
    const t = String(title || '').toLowerCase();
    if (!t) return '';
    for (const k of Object.keys(LANG_NAMES)) {
      if (new RegExp('(^|[^a-z])' + LANG_NAMES[k].toLowerCase() + '([^a-z]|$)').test(t)) return k;
    }
    return '';
  }

  /** The language of a sound track ({ lang | language, title | label }), "" when it cannot be told. */
  function trackLang(track) {
    if (!track) return '';
    return normLang(track.lang != null ? track.lang : track.language) || langFromTitle(track.title != null ? track.title : track.label);
  }

  /**
   * Which sound track to play: the one in the wanted language (English unless told otherwise),
   * never a commentary if there is anything else. When no track is in the wanted language, a track
   * that does not say what it is beats one that says it is something else (next to a track labelled
   * as a dub, the unlabelled one is usually the original), and after that the file's own main track.
   * Returns the position in `tracks`, or -1 when there are none.
   */
  function pickAudioTrack(tracks, preferLang) {
    if (!tracks || !tracks.length) return -1;
    const want = normLang(preferLang) || 'eng';
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i] || {};
      let score = -i * 0.01;                                   // earlier tracks win ties
      const lang = trackLang(t);
      if (lang === want) score += 100;
      else if (!lang) score += 20;
      if (/comment|descri|director|isolated|karaoke/i.test(String(t.title || t.label || ''))) score -= 50;
      if (t.isDefault) score += 10;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    return best;
  }

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const pad = (n, w) => String(Math.trunc(Math.abs(n))).padStart(w || 2, '0');

  function median(values) {
    if (!values.length) return NaN;
    const s = values.slice().sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /** Seconds -> "2:30:30" (or "2:30:30.250" with opts.ms). Negative values get a leading minus. */
  function fmtDuration(sec, opts) {
    opts = opts || {};
    if (!isFinite(sec)) return '--:--';
    const neg = sec < 0;
    const t = Math.abs(sec);
    let whole;
    let frac = '';
    if (opts.ms) {
      const totalMs = Math.round(t * 1000);
      whole = Math.floor(totalMs / 1000);
      frac = '.' + String(totalMs % 1000).padStart(3, '0');
    } else {
      whole = Math.floor(t + 1e-9);
    }
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const body = (h > 0 || opts.forceHours) ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
    return (neg && (whole > 0 || frac) ? '-' : '') + body + frac;
  }

  /** "2:30:30", "2:30:30.5", "150:30", "9030", "2h30m30s" -> seconds (NaN when unparseable). */
  function parseDuration(input) {
    if (typeof input === 'number') return input;
    let s = String(input == null ? '' : input).trim().toLowerCase().replace(',', '.');
    if (!s) return NaN;
    const hms = /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/.exec(s);
    if (hms && (hms[1] || hms[2] || hms[3])) {
      return (+hms[1] || 0) * 3600 + (+hms[2] || 0) * 60 + (+hms[3] || 0);
    }
    const parts = s.split(':');
    if (parts.length > 3) return NaN;
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      if (!(last ? /^\d+(\.\d+)?$/ : /^\d+$/).test(parts[i])) return NaN;
      total = total * 60 + parseFloat(parts[i]);
    }
    return total;
  }

  /**
   * Whole seconds left, rounded up, so a countdown reads "10" for the whole tenth-last second
   * and reaches 0 exactly at the target instant.
   */
  function countdownParts(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000 - 1e-9)) || 0;
    return {
      total: total,
      d: Math.floor(total / 86400),
      h: Math.floor((total % 86400) / 3600),
      m: Math.floor((total % 3600) / 60),
      s: total % 60
    };
  }

  /**
   * Milliseconds until the clock shows the second in which `epochMs` falls. A countdown to the
   * start of the film (which can be at 9:29:28.332) counted this way ticks on the same instant as
   * the clock's seconds, and reaches zero as the clock shows that second.
   */
  function untilClockSecond(epochMs, nowMs) {
    return Math.floor(epochMs / 1000) * 1000 - nowMs;
  }

  /**
   * The second of the film to show at `nowMs` while the film runs on `session`, counted on the
   * clock's seconds: it changes on the same instant as the clock's seconds, and when the clock
   * reaches the target (midnight) it shows the second of the film that holds the snap.
   *
   * (A start time between two seconds, 9:29:28.6 say, cannot have both: the film's own seconds
   * begin 0.6 s after the clock's. The display follows the clock and is pinned to the snap; the
   * film itself runs on the millisecond.)
   */
  function filmSecondOnClock(session, nowMs) {
    const snapMs = session.targetEpoch - session.startEpoch;
    return Math.floor(nowMs / 1000) - Math.floor(session.targetEpoch / 1000) + Math.floor(snapMs / 1000);
  }

  function fmtCountdown(ms) {
    const p = countdownParts(ms);
    const hms = pad(p.h) + ':' + pad(p.m) + ':' + pad(p.s);
    return p.d > 0 ? p.d + 'd ' + hms : hms;
  }

  function clockParts(date, use24) {
    let h = date.getHours();
    let ampm = '';
    if (!use24) {
      ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      if (h === 0) h = 12;
    }
    const hh = use24 ? pad(h) : String(h);
    return {
      hms: hh + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds()),
      hm: hh + ':' + pad(date.getMinutes()),
      ampm: ampm
    };
  }

  function fmtClock(date, use24) {
    const p = clockParts(date, use24);
    return p.ampm ? p.hms + ' ' + p.ampm : p.hms;
  }

  /** "Thu, Dec 31 · 9:29:30 PM" */
  function fmtDateTime(epochMs, use24) {
    if (!isFinite(epochMs)) return '—';
    const d = new Date(epochMs);
    const mon = MONTHS[d.getMonth()];
    return DAYS[d.getDay()].charAt(0) + DAYS[d.getDay()].slice(1).toLowerCase() + ', ' +
      mon.charAt(0) + mon.slice(1).toLowerCase() + ' ' + d.getDate() + ' · ' + fmtClock(d, use24);
  }

  function dateKey(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  /**
   * The New Year's midnight (local time) this viewing belongs to. For `tailMs` after midnight
   * the film is still running, so that midnight stays the target instead of jumping a year ahead.
   */
  function newYearTarget(nowMs, tailMs) {
    const now = new Date(nowMs);
    const thisJan1 = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
    if (nowMs < thisJan1 + tailMs) return thisJan1;
    return new Date(now.getFullYear() + 1, 0, 1, 0, 0, 0, 0).getTime();
  }

  /**
   * Everything the player needs to know about one viewing:
   *   targetEpoch  wall-clock instant the snap must land on
   *   startEpoch   wall-clock instant the film must be at 0:00
   *   endEpoch     wall-clock instant the film ends (null while the duration is unknown)
   */
  function computeSession(o) {
    const snapMs = Math.round(o.snapSec * 1000);
    const durMs = isFinite(o.durationSec) && o.durationSec > 0 ? Math.round(o.durationSec * 1000) : null;
    const tailMs = durMs != null ? Math.max(60000, durMs - snapMs) : 45 * 60000;
    let targetEpoch;
    if (o.targetMode === 'custom' && isFinite(o.customTargetMs)) targetEpoch = o.customTargetMs;
    else targetEpoch = newYearTarget(o.nowMs, tailMs);
    const startEpoch = targetEpoch - snapMs;
    return {
      targetEpoch: targetEpoch,
      startEpoch: startEpoch,
      endEpoch: durMs != null ? startEpoch + durMs : null,
      snapSec: o.snapSec
    };
  }

  /** Where the film should be (seconds) at wall-clock instant `epochMs`. Negative before the start. */
  function expectedPos(session, epochMs) {
    return (epochMs - session.startEpoch) / 1000;
  }

  /**
   * Keeps playback glued to the clock.
   *
   * Feed it drift samples (film position minus where the clock says it should be, in seconds;
   * positive means the film is ahead). `decide()` answers with one of:
   *   none  inside the deadband, play at 1.0x
   *   rate  nudge the playback speed by a few percent until the drift is gone
   *   hard  too far out for a nudge, the caller must seek
   */
  class DriftController {
    constructor(opts) {
      this.o = Object.assign({
        enter: 0.030,     // start correcting above this drift (s)
        exit: 0.008,      // stop correcting below this drift (s)
        tau: 1.2,         // correction time constant (s)
        maxRate: 0.06,    // largest speed change (6%)
        minRate: 0.004,   // smallest useful speed change
        hard: 0.5,        // beyond this, seek instead of nudging (s)
        window: 0.6,      // only samples this recent count (s)
        minSamples: 2,
        maxSamples: 64
      }, opts || {});
      this.reset();
    }

    reset() {
      this.samples = [];
      this.correcting = false;
      this.rate = 1;
      this.drift = null;
    }

    push(tSec, drift) {
      if (!isFinite(drift) || !isFinite(tSec)) return;
      this.samples.push({ t: tSec, d: drift });
      if (this.samples.length > this.o.maxSamples) this.samples.splice(0, this.samples.length - this.o.maxSamples);
    }

    estimate(tSec) {
      const from = tSec - this.o.window;
      const recent = [];
      for (let i = this.samples.length - 1; i >= 0; i--) {
        if (this.samples[i].t < from) break;
        recent.push(this.samples[i].d);
      }
      if (recent.length < this.o.minSamples) return null;
      return median(recent);
    }

    decide(tSec) {
      const d = this.estimate(tSec);
      if (d == null) return { drift: null, action: 'none', rate: this.rate };
      this.drift = d;
      const a = Math.abs(d);
      if (a > this.o.hard) {
        this.correcting = false;
        this.rate = 1;
        return { drift: d, action: 'hard', rate: 1 };
      }
      if (this.correcting ? a > this.o.exit : a > this.o.enter) {
        this.correcting = true;
        let off = clamp(-d / this.o.tau, -this.o.maxRate, this.o.maxRate);
        if (Math.abs(off) < this.o.minRate) off = (off < 0 ? -1 : 1) * this.o.minRate;
        this.rate = Math.round((1 + off) * 1000) / 1000;
        return { drift: d, action: 'rate', rate: this.rate };
      }
      this.correcting = false;
      this.rate = 1;
      return { drift: d, action: 'none', rate: 1 };
    }
  }

  return {
    DEFAULT_SNAP_SEC: DEFAULT_SNAP_SEC,
    FILM_VERSIONS: FILM_VERSIONS, filmVersion: filmVersion, guessFilmVersion: guessFilmVersion, REFERENCE_SEC: REFERENCE_SEC,
    normLang: normLang, langName: langName, langFromTitle: langFromTitle, trackLang: trackLang, pickAudioTrack: pickAudioTrack,
    LANG_NAMES: LANG_NAMES, playableAudioCodec: playableAudioCodec, audioCodecName: audioCodecName,
    findFlash: findFlash, findSnapLine: findSnapLine, judgeSnap: judgeSnap, climbStart: climbStart, median: median,
    percentile: percentile, speechScore: speechScore, cueTimeline: cueTimeline, speechPlan: speechPlan, alignCues: alignCues, SUB_SCALES: SUB_SCALES, betterFit: betterFit, ALIGN: ALIGN,
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, DAYS: DAYS, DAYS_LONG: DAYS_LONG,
    clamp: clamp, pad: pad, median: median, untilClockSecond: untilClockSecond, filmSecondOnClock: filmSecondOnClock, FILM_SPAN: FILM_SPAN,
    fmtDuration: fmtDuration, parseDuration: parseDuration,
    countdownParts: countdownParts, fmtCountdown: fmtCountdown,
    clockParts: clockParts, fmtClock: fmtClock, fmtDateTime: fmtDateTime, dateKey: dateKey,
    newYearTarget: newYearTarget, computeSession: computeSession, expectedPos: expectedPos,
    DriftController: DriftController
  };
});
