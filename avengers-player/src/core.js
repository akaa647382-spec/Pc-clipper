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

  /** Length of the 2019 home release (3:01:11): the yardstick other copies are measured against. */
  const REFERENCE_SEC = 10871;

  /**
   * The cuts of the film the player knows about.
   *
   *   snapSec   where the snap is in that cut
   *   minutes   range of file lengths that identify the cut (null: never guessed from the length)
   *   settled   true when the snap point is the long-established figure; false when it is derived
   *             or approximate and must be confirmed in the file
   *
   * "Avengers Endgame: Encore" is the 2026 re-release. By all published accounts its added scenes
   * sit at the very end (a longer last scene, then scenes during and after the credits), which
   * leaves the snap where it always was. Copies differ in length, though (3:01:36 has been reported
   * by a user, about 3:05 by the press), and cinemas played a short introduction BEFORE the film,
   * so the snap point of an Encore copy has to be confirmed in the file itself.
   */
  const FILM_VERSIONS = [
    {
      id: 'original', family: 'original', name: 'Avengers: Endgame (2019)', short: 'Original',
      snapSec: DEFAULT_SNAP_SEC, minutes: [180.0, 181.45], settled: true,
      note: 'The 2019 film, 3:01:11 long. Start at 9:29:30 PM and the snap lands on midnight.'
    },
    {
      id: 'encore', family: 'encore', name: 'Avengers Endgame: Encore (2026)', short: 'Encore',
      snapSec: DEFAULT_SNAP_SEC, minutes: [181.45, 187.5], settled: false,
      note: 'The 2026 re-release. Its new scenes are reported to come after the snap (a longer last scene and scenes in the credits), which would leave the snap where it was in the original. Copies differ in length and nobody has published a New Year timing for this cut yet, so confirm it once with the Snap test.'
    },
    {
      id: 'encore-intro', family: 'encore', name: 'Encore with the cinema introduction', short: 'Encore + intro',
      snapSec: DEFAULT_SNAP_SEC + 60, minutes: null, settled: false,
      note: 'For a copy that opens with the roughly one-minute introduction shown in cinemas: everything is about a minute later. This is approximate. Find the exact frame below.'
    },
    {
      id: 'custom', family: 'custom', name: 'Another cut (set the snap point yourself)', short: 'Custom',
      snapSec: null, minutes: null, settled: false,
      note: 'Your own snap point. Find the frame below, or type the time.'
    }
  ];

  function filmVersion(id) {
    for (const v of FILM_VERSIONS) if (v.id === id) return v;
    return FILM_VERSIONS[0];
  }

  /** Which cut a file of this length most likely is, or null when the length says nothing. */
  function guessFilmVersion(durationSec) {
    if (!isFinite(durationSec) || durationSec <= 0) return null;
    const minutes = durationSec / 60;
    for (const v of FILM_VERSIONS) {
      if (v.minutes && minutes >= v.minutes[0] && minutes < v.minutes[1]) return v;
    }
    return null;
  }

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
   * never a commentary if there is anything else, otherwise the file's own main track.
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
      if (trackLang(t) === want) score += 100;
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
    MONTHS: MONTHS, MONTHS_LONG: MONTHS_LONG, DAYS: DAYS, DAYS_LONG: DAYS_LONG,
    clamp: clamp, pad: pad, median: median,
    fmtDuration: fmtDuration, parseDuration: parseDuration,
    countdownParts: countdownParts, fmtCountdown: fmtCountdown,
    clockParts: clockParts, fmtClock: fmtClock, fmtDateTime: fmtDateTime, dateKey: dateKey,
    newYearTarget: newYearTarget, computeSession: computeSession, expectedPos: expectedPos,
    DriftController: DriftController
  };
});
