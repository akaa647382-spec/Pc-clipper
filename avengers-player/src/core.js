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
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, DAYS: DAYS, DAYS_LONG: DAYS_LONG,
    clamp: clamp, pad: pad, median: median,
    fmtDuration: fmtDuration, parseDuration: parseDuration,
    countdownParts: countdownParts, fmtCountdown: fmtCountdown,
    clockParts: clockParts, fmtClock: fmtClock, fmtDateTime: fmtDateTime, dateKey: dateKey,
    newYearTarget: newYearTarget, computeSession: computeSession, expectedPos: expectedPos,
    DriftController: DriftController
  };
});
