/*!
 * Avengers Player: the player page.
 *
 * One idea drives everything here: while the countdown is armed, the film position is a pure
 * function of the wall clock (position = now - startTime). The engine never "remembers" where
 * the film was; after a pause, a slip, a stall, a crash or a reboot it simply asks the clock
 * where the film should be and goes there. That is what makes recovery always land in sync.
 */
(() => {
  'use strict';

  const C = window.APCore;
  const SubsCore = window.APSubs || null;
  const FxLib = window.APFx || null;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = C.clamp;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const el = {};
  $$('[id]').forEach((n) => { el[n.id] = n; });
  const video = el.video;

  /* ====================================================== native bridge === */

  /** Lets the page run in a plain browser during development. The shipped app always has apNative. */
  function browserShim() {
    const KEY = 'avengersPlayer.dev';
    const pick = (input) => new Promise((res) => {
      input.value = '';
      input.onchange = () => res(input.files[0] || null);
      input.oncancel = () => res(null);
      input.click();
    });
    const no = async () => ({ error: 'Not available in the browser build.' });
    return {
      isNative: false,
      platform: 'browser',
      loadState() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } },
      saveState(obj) { try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* private mode */ } return Promise.resolve(true); },
      async pickMovie() { const f = await pick(el.fileInput); return f ? { path: '', name: f.name, size: f.size, url: URL.createObjectURL(f) } : null; },
      async openMovie() { return null; },
      pathForFile() { return ''; },
      async pickSubtitle() { const f = await pick(el.subInput); return f ? { path: '', name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null; },
      async readSubtitle() { return null; },
      async findSubtitles() { return []; },
      async setFullscreen(flag) {
        try {
          if (flag) await document.documentElement.requestFullscreen();
          else if (document.fullscreenElement) await document.exitFullscreen();
        } catch (e) { /* refused */ }
        return flag;
      },
      async isFullscreen() { return !!document.fullscreenElement; },
      onFullscreen(cb) { document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement)); },
      setArmed() {},
      async measureTime() { return { ok: false, offsetMs: 0, uncertaintyMs: Infinity, method: 'none', servers: [], at: Date.now() }; },
      async ffLocate() { return null; },
      ffPick: async () => null, ffProbe: no, ffConvert: no, ffDownload: no, ffExtractSub: no, ffSubWindow: no, ffSpeech: no,
      async ffCancel() { return true; },
      async ffSpeechCancel() { return true; },
      onFfProgress() {},
      async appInfo() { return { version: 'dev', electron: '', chrome: '', platform: 'browser', logFile: '', isTest: false }; },
      showItem() {}, openLog() {}, log() {}, crashNow() {}, powerCutNow() {}, lastRun() { return null; },
      async powerState() { return { onBattery: false }; },
      onPower() {}
    };
  }
  const native = window.apNative || browserShim();

  /* ============================================================ settings === */

  const DEFAULTS = {
    theme: 'arc',
    panelSide: 'left',
    snapSec: C.DEFAULT_SNAP_SEC,
    filmVersion: 'original', snapConfirmedFor: '',
    snapByFile: {},
    targetMode: 'newyear', customTarget: '',
    startMode: 'auto',          // auto: set by the snap in the file · classic: 9:29:30 PM · own: startOwnSec
    startOwnSec: C.DEFAULT_SNAP_SEC,   // the user's own start, as seconds before the target
    startOwnSet: false,         // true once the user has set an own start time (it is then kept)
    showMs: true,               // start times and the countdown to the start with milliseconds
    use24h: false,
    showOverlay: true, showClock: true, showDate: true, showCount: true, showSyncBadge: false, finalTen: true,
    overlayPos: 'tl', overlaySize: 'm',
    celebration: 'stark',
    standbyScreen: true,
    autoRecover: true, autoRecoverSec: 10,
    autoRestart: true,
    lockControls: false,
    useNetTime: true,
    volume: 1, muted: false,
    audioLang: 'eng', audioPickKey: '', audioPickPos: -1, audioPickLang: '', keepOtherSound: true,
    showStats: false,
    subsOn: true, subPath: '', subName: '', subMovie: '', subEncoding: 'auto',
    subSize: 'm', subBg: 'shadow', subColor: 'white', subPos: 'low', subDelay: 0,
    subScale: 1, subOwn: false, subAutoSync: true, subSyncKey: '', subSyncState: '',
    armed: false, armedTarget: null, armedEnd: null, moviePath: '', movieName: '', wasFullscreen: false,
    learnedLatency: 0.07, learnedSeekLead: 0.6,
    rehearsed: {},
    newYearSeen: 0              // the New Year midnight already passed (and, if missed, said so)
  };

  const cfg = (() => {
    let saved = {};
    try { saved = native.loadState() || {}; } catch (e) { saved = {}; }
    const c = Object.assign({}, DEFAULTS);
    // Only known keys of the right type are taken from disk, so a damaged file cannot break the player.
    for (const k of Object.keys(DEFAULTS)) {
      const v = saved[k];
      if (v === undefined || v === null) continue;
      if (DEFAULTS[k] === null || typeof v === typeof DEFAULTS[k]) c[k] = v;
    }
    if (!(c.snapSec > 0 && c.snapSec < 86400)) c.snapSec = DEFAULTS.snapSec;
    if (c.theme === 'tva') c.theme = 'hotrod';          // the TVA theme (1.9.3 only) is Hot Rod again
    if (!['auto', 'classic', 'own'].includes(c.startMode)) c.startMode = 'auto';
    if (!(c.startOwnSec >= 60 && c.startOwnSec <= 6 * 3600)) c.startOwnSec = DEFAULTS.startOwnSec;
    if (!(c.volume >= 0 && c.volume <= 1)) c.volume = 1;
    c.audioLang = C.LANG_NAMES[C.normLang(c.audioLang)] ? C.normLang(c.audioLang) : 'eng';
    if (!Number.isInteger(c.audioPickPos)) c.audioPickPos = -1;
    if (!(c.autoRecoverSec >= 1 && c.autoRecoverSec <= 120)) c.autoRecoverSec = 10;
    if (!(Math.abs(c.subDelay) < 600)) c.subDelay = 0;
    if (!(c.subScale > 0.9 && c.subScale < 1.1)) c.subScale = 1;
    if (c.subSyncKey.length > 1200 || !['', 'synced', 'fine', 'close', 'unsure', 'mixed', 'undone', 'hand'].includes(c.subSyncState)) { c.subSyncKey = ''; c.subSyncState = ''; }
    c.learnedLatency = clamp(+c.learnedLatency || 0.07, 0, 0.3);
    c.learnedSeekLead = clamp(+c.learnedSeekLead || 0.6, 0.4, 6);
    if (typeof c.rehearsed !== 'object' || Array.isArray(c.rehearsed)) c.rehearsed = {};
    if (!Number.isFinite(c.newYearSeen)) c.newYearSeen = 0;
    // The snap point each film file was given: only well-formed entries survive, in a fresh object.
    const byFile = {};
    if (c.snapByFile && typeof c.snapByFile === 'object' && !Array.isArray(c.snapByFile)) {
      for (const k of Object.keys(c.snapByFile).slice(-24)) {
        const m = c.snapByFile[k];
        if (m && typeof m === 'object' && m.snapSec > 0 && m.snapSec < 86400) {
          byFile[k] = { snapSec: +m.snapSec, version: String(m.version || 'custom'), confirmed: !!m.confirmed, how: typeof m.how === 'string' ? m.how.slice(0, 16) : '', searched: !!m.searched };
        }
      }
    }
    c.snapByFile = byFile;
    if (c.armedTarget !== null && !Number.isFinite(c.armedTarget)) { c.armedTarget = null; c.armed = false; }
    if (c.armedEnd !== null && !Number.isFinite(c.armedEnd)) c.armedEnd = null;
    return c;
  })();

  let saveTimer = 0;
  function saveNow() {
    clearTimeout(saveTimer);
    try { native.saveState(JSON.parse(JSON.stringify(cfg))); } catch (e) { /* keep playing */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 200);
  }
  window.addEventListener('beforeunload', saveNow);

  /** Tells the main process whether a countdown is armed: keep-awake, close guard, crash watchdog. */
  function tellArmed(flag) {
    try { native.setArmed(!!flag, cfg.autoRestart !== false); } catch (e) { /* stays as it was */ }
  }

  /* =============================================================== clock === */

  /**
   * The app's idea of "now". netOffsetMs corrects a wrong PC clock using internet time;
   * testOffsetMs is how test runs pretend it is 11:59:20 PM on December 31.
   */
  const Clock = {
    netOffsetMs: 0,
    testOffsetMs: 0,
    now() { return Date.now() + this.netOffsetMs + this.testOffsetMs; },
    real() { return Date.now() + this.netOffsetMs; },
    fromPerf(perfTs) { return this.now() + (perfTs - performance.now()); }
  };

  const customTargetMs = () => {
    if (cfg.targetMode !== 'custom' || !cfg.customTarget) return NaN;
    return new Date(cfg.customTarget).getTime();
  };
  const isNewYearMoment = (epoch) => {
    const d = new Date(epoch);
    return d.getMonth() === 0 && d.getDate() === 1 && d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
  };
  const fmtMs = (sec) => {
    if (sec == null || !isFinite(sec)) return '—';
    const ms = Math.round(sec * 1000);
    return (ms > 0 ? '+' : ms < 0 ? '−' : '±') + Math.abs(ms) + ' ms';
  };
  const fmtSpan = (sec) => (sec < 90 ? Math.round(sec) + ' s' : C.fmtDuration(sec));
  /** "10 s", "5 minutes", "1 hour": how late, in words. */
  const fmtLate = (sec) => {
    if (sec < 60) return Math.round(sec) + ' s';
    if (sec < 3600) { const m = Math.round(sec / 60); return m + ' minute' + (m === 1 ? '' : 's'); }
    const h = Math.round(sec / 360) / 10;
    return h + ' hour' + (h === 1 ? '' : 's');
  };
  const fmtOff = (sec) => {
    const a = Math.abs(sec);
    if (a < 1) return Math.round(a * 1000) + ' ms';
    if (a < 90) return a.toFixed(1) + ' s';
    return C.fmtDuration(a);
  };

  /* ==================================================== playback quality === */

  /** Frames shown and dropped so far by the video element (cumulative). */
  const playbackQuality = () => {
    try {
      const v = document.getElementById('video');
      const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return q ? { total: q.totalVideoFrames, dropped: q.droppedVideoFrames } : null;
    } catch (e) { return null; }
  };
  /** How smoothly the film played since `q0`: { lagged, text }. */
  const smoothness = (q0, resyncs) => {
    const q = playbackQuality();
    const total = q && q0 ? q.total - q0.total : 0;
    const dropped = q && q0 ? q.dropped - q0.dropped : 0;
    const share = total > 0 ? dropped / total : 0;
    const lagged = share > 0.05 || resyncs > 0;
    const v = document.getElementById('video');
    const heavy = v && v.videoHeight >= 1600 ? ' This is a ' + v.videoWidth + '×' + v.videoHeight + ' file: a 1080p copy of the film plays far more easily.' : ' A lighter copy of the film (1080p) would play more easily.';
    if (!lagged) return { lagged: false, text: 'Playback was smooth' + (total > 0 ? ' (' + dropped + ' of ' + total + ' frames dropped)' : '') + '.' };
    return {
      lagged: true,
      text: 'Playback lagged on this PC: ' + (total > 0 ? Math.round(share * 100) + '% of the frames were dropped' : 'the film fell behind') +
        (resyncs ? ' and the film had to be re-synced ' + resyncs + ' time' + (resyncs > 1 ? 's' : '') : '') + '. On the night that shows as stutters and jumps.' + heavy
    };
  };

  /* ========================================================== start time === */

  /**
   * Where the film has to be when the clock reaches the target: that decides the start time.
   *   auto     the snap point of this file, so the snap lands on the target (midnight)
   *   classic  2:30:30, the figure everybody quotes: for midnight the film starts at 9:29:30 PM
   *   own      a start time the user chose, kept as seconds before the target
   */
  const startLead = (mode) => {
    const m = mode || cfg.startMode;
    if (m === 'classic') return C.DEFAULT_SNAP_SEC;
    if (m === 'own') return cfg.startOwnSec;
    return cfg.snapSec;
  };
  /** Seconds after the target at which the snap comes in session `s` (+ after, − before, 0 on it). */
  const snapLate = (s) => (s ? Math.round(cfg.snapSec * 1000 - (s.targetEpoch - s.startEpoch)) / 1000 : 0);
  /** "1.668 s after", "0.250 s before", "exactly on" */
  const lateText = (sec) => (Math.abs(sec) < 0.0005 ? 'exactly on'
    : (Math.abs(sec) < 60 ? Math.abs(sec).toFixed(3) + ' s' : C.fmtDuration(Math.abs(sec), { ms: true })) + ' ' + (sec > 0 ? 'after' : 'before'));
  /** Whether the snap comes on the target in session `s`. */
  const onTarget = (s) => Math.abs(snapLate(s)) < 0.0005;
  /** "the snap lands 1.668 s after midnight", with a word when the snap point itself is unchecked. */
  const landsText = (s) => 'the snap lands ' + (onTarget(s) ? 'on ' : lateText(snapLate(s)) + ' ') + targetWord(s) +
    (snapConfirmed() || (!Media.info && !!cfg.snapConfirmedFor && cfg.snapConfirmedFor.endsWith('|' + cfg.snapSec.toFixed(3))) ? '' : ' (if the snap point is right: it has not been checked yet)');
  /**
   * How far the film is from where the clock says, as shown. A stopped film falls behind by a
   * second per second: read at the clock's second, so the number changes with the clock. A
   * playing film's offset stays the same and is read as it is.
   */
  const offOnClock = (now) => video.currentTime - Engine.expected(video.paused ? Math.floor(now / 1000) * 1000 : now);

  /** A start time as shown: to the millisecond ("9:29:28.348 PM"), the instant the movie launches. */
  const clockOf = (epoch) => (cfg.showMs ? C.fmtClockMs(epoch, cfg.use24h) : C.fmtClock(new Date(epoch), cfg.use24h));
  const dateTimeOf = (epoch) => (cfg.showMs ? C.fmtDateTimeMs(epoch, cfg.use24h) : C.fmtDateTime(epoch, cfg.use24h));
  /** The countdown to the start: seconds with the clock, milliseconds (if shown) to the launch. */
  const startCountdown = (s, now) => C.fmtStartCountdown(s.startEpoch, now, cfg.showMs);
  /** "midnight", or the clock time of another target. */
  const targetWord = (s) => (!s ? 'the target' : isNewYearMoment(s.targetEpoch) ? 'midnight' : C.fmtClock(new Date(s.targetEpoch), cfg.use24h));
  /** A start time choice in words: "automatic", "9:29:30 PM", "your own time (9:29:29.500 PM)". */
  const startName = (mode, s) => {
    const m = mode || cfg.startMode;
    if (m === 'auto') return 'automatic';
    const at = s ? clockOf(s.targetEpoch - Math.round(startLead(m) * 1000)) : '';
    return m === 'classic' ? (at || '9:29:30 PM') : 'your own time' + (at ? ' (' + at + ')' : '');
  };

  /* ============================================================== toasts === */

  function toast(text, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), ms || 3300);
  }

  /* =============================================================== modal === */

  const Modal = {
    open(o) {
      el.modalTitle.textContent = o.title;
      el.modalBody.innerHTML = o.html || '';
      el.modalProgress.hidden = !o.progress;
      el.modalBar.style.width = '0%';
      el.modalNote.hidden = !o.note;
      el.modalNote.textContent = o.note || '';
      el.modalActions.textContent = '';
      (o.actions || []).forEach((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn ' + (a.primary ? 'btn-primary' : 'btn-ghost');
        b.textContent = a.label;
        b.addEventListener('click', () => a.onClick && a.onClick());
        el.modalActions.appendChild(b);
      });
      this.onEscape = o.onEscape || null;
      el.modal.hidden = false;
    },
    progress(fraction, note) {
      el.modalProgress.hidden = false;
      el.modalBar.style.width = (clamp(fraction || 0, 0, 1) * 100).toFixed(1) + '%';
      if (note != null) { el.modalNote.hidden = false; el.modalNote.textContent = note; }
    },
    close() { el.modal.hidden = true; this.onEscape = null; },
    get isOpen() { return !el.modal.hidden; }
  };

  /* =============================================================== media === */

  /** true: sound is being decoded. false: there is none this player can decode. null: not known yet. */
  function detectAudio(afterPlayback) {
    try {
      if (typeof video.webkitAudioDecodedByteCount === 'number') {
        if (video.webkitAudioDecodedByteCount > 0) return true;
        if (afterPlayback) return false;
      }
      // Chromium lists only the sound tracks it can decode: an empty list means there is nothing to hear.
      if (AudioTracks.supported) return video.audioTracks.length > 0 ? null : false;
      if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio;
    } catch (e) { /* unknown */ }
    return null;
  }

  const Media = {
    ready: false,
    info: null,          // { path, name, size, url }
    hasAudio: null,      // true / false / null (not known yet)
    probe: null,         // FFmpeg's description of the file, when FFmpeg is available
    assess: null,
    fps: 0,
    lastFrameTime: NaN,
    playedMs: 0,
    loadToken: 0,

    /** Loads a movie. `loading` is true for the duration, so nothing else starts a second load. */
    async load(info, opts) {
      this.loading = true;
      try {
        return await this.loadNow(info, opts);
      } finally {
        this.loading = false;
      }
    },

    /**
     * The countdown is armed but there is no movie (the drive hiccuped, the USB stick is not in yet):
     * keep looking for it, every 5 s for the first minute and every 30 s after that.
     */
    retryWhileArmed(perf) {
      // (Not before the start-up has tried itself: it waits a moment for the internet time first, and
      // loading the movie twice as the app starts would only cost time.)
      if (this.ready || this.loading || !cfg.armed || !cfg.moviePath || !native.isNative || !UI.booted) return;
      if (perf < (this.retryAt || 0)) return;
      this.retries = (this.retries || 0) + 1;
      this.retryAt = perf + (this.retries <= 12 ? 5000 : 30000);
      if (this.retries === 1) Engine.logEvent('The movie is not available: it will be tried again every few seconds');
      native.openMovie(cfg.moviePath).then((info) => {
        if (info && !this.ready && !this.loading && cfg.armed) return this.load(info, { retry: true });
        return false;
      }).then((ok) => {
        if (ok && cfg.wasFullscreen && !UI.isFs) UI.setFullscreen(true);
      }).catch(() => {});
    },

    async loadNow(info, opts) {
      opts = opts || {};
      if (!info || !info.url) return false;
      const token = ++this.loadToken;
      if (!opts.retry) UI.importError('');
      UI.importBusy(true);
      Engine.hardReset();
      SubsUI.found = [];
      SubsUI.clear(true);
      this.ready = false;
      this.hasAudio = null;
      this.probe = null;
      this.assess = null;
      this.fps = 0;
      this.playedMs = 0;
      this.lastFrameTime = NaN;
      this.audioReason = '';
      this.byUser = !!opts.byUser;
      this.inspected = false;
      AudioTracks.clear();
      UI.renderSoundWarning();
      UI.renderSoundTracks();

      const ok = await new Promise((res) => {
        let to = 0;
        const done = (v) => {
          video.removeEventListener('loadedmetadata', onOk);
          video.removeEventListener('error', onErr);
          clearTimeout(to);
          res(v);
        };
        const onOk = () => done(true);
        const onErr = () => done(false);
        video.addEventListener('loadedmetadata', onOk);
        video.addEventListener('error', onErr);
        to = setTimeout(() => done(false), 30000);
        video.src = info.url;
        video.load();
      });
      if (token !== this.loadToken) return false;
      UI.importBusy(false);

      const usable = ok && isFinite(video.duration) && video.duration > 0 && video.videoWidth > 0;
      if (!usable) {
        const hadVideo = ok && video.videoWidth > 0;
        video.removeAttribute('src');
        video.load();
        this.info = null;
        UI.showImport();
        // A silent retry keeps whatever explanation is already on screen.
        if (!opts.retry) UI.importError(await this.explainFailure(info, ok, hadVideo) + (cfg.armed ? ' The countdown stays armed and the app keeps trying this movie.' : ''));
        return false;
      }

      this.info = info;
      this.ready = true;
      if (this.retries) Engine.logEvent('The movie is available again');
      this.retries = 0;
      this.retryAt = 0;
      UI.importError('');
      AudioTracks.onLoad();                              // the right language is chosen before anything plays
      const heard = detectAudio(false);
      this.hasAudio = heard === false ? null : heard;    // "no sound at all" is announced by inspect(), which knows why
      cfg.moviePath = info.path || '';
      cfg.movieName = info.name || '';
      save();
      video.playbackRate = 1;
      applyVolume();
      if (cfg.armed) Versions.guess = C.guessFilmVersion(video.duration, info.name); else Versions.onImport();
      // Every copy of the film is timed a little differently: the app looks for the snap in this one.
      SnapCam.autoFor = opts.retry || opts.afterError ? 0 : token;
      SnapCam.autoSince = performance.now();
      Engine.session = Engine.computeFree();
      UI.showPlayer();
      UI.refreshAll();
      Engine.logEvent('Movie loaded: ' + info.name + ' (' + video.videoWidth + '×' + video.videoHeight + ', ' + C.fmtDuration(video.duration) + ')');

      // Resume an armed countdown straight away: timing first, inspection afterwards.
      if (cfg.armed && !opts.noResume) await Engine.arm({ restore: true, reload: !!opts.afterError });
      this.inspect(token);
      SubsUI.autoLoad(token);
      return true;
    },

    /** Asks FFmpeg (when present) what exactly is inside the file. */
    async reprobe() {
      if (!this.info || !this.info.path || !native.isNative) return false;
      const token = this.loadToken;
      let r = null;
      try {
        const hevcOk = !!video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
        r = await native.ffProbe(this.info.path, hevcOk, cfg.audioLang);
      } catch (e) { r = null; }
      if (token !== this.loadToken || !this.ready || !r || !r.probe) return false;
      this.probe = r.probe;
      this.assess = r.assess || null;
      AudioTracks.read();                                // the same tracks, now with their format and channels
      SubsUI.renderEmbedded();
      this.soundChanged();
      return true;
    },

    soundChanged() {
      UI.renderSoundTracks();
      UI.renderSoundWarning();
      UI.renderFileCard();
      UI.dirty.preflight = true;
    },

    /** Decides whether the sound of this movie will work, and in which language. */
    async inspect(token) {
      // Until the file has been looked into, nothing is said about the language of its sound:
      // a half-informed warning would only be replaced by another one a moment later.
      this.inspected = false;
      if (!this.info || !this.info.path || !native.isNative) { this.inspected = true; this.soundChanged(); return; }
      await this.reprobe();
      if (token !== this.loadToken || !this.ready) return;
      this.inspected = true;
      const a = this.assess;
      if (AudioTracks.supported) {
        const cur = AudioTracks.current();
        if (!cur) {
          const none = !!this.probe && !(this.probe.audio || []).length;
          this.setAudio(false, none ? 'This file has no sound track.' : (a && a.audioReason) || 'No sound could be decoded from this file (the sound is probably Dolby or DTS).');
        } else if (cur.meta && C.playableAudioCodec(cur.meta.codec)) {
          this.setAudio(true);
        } else {
          this.soundCheck(token);                        // not a format known to work: play a moment of it to find out
        }
      } else if (this.probe && a) {
        if (a.needsAudioFix) this.setAudio(false, a.audioReason);
        else if (a.audioOk) this.setAudio(true);
        else if (!this.probe.audio || !this.probe.audio.length) this.setAudio(false, 'This file has no sound track.');
      } else {
        this.soundCheck(token);
      }
      this.soundChanged();
      this.maybeOffer();
    },

    /** What is wrong with the sound of this movie, if anything: silence first, then the wrong language. */
    soundProblem() {
      if (!this.ready) return null;
      if (this.hasAudio === false) {
        const fixable = !!(this.info && this.info.path && native.isNative && (!this.probe || (this.probe.audio || []).length > 0));
        const noTracks = !!this.probe && !(this.probe.audio || []).length;
        return {
          kind: 'silent', fixable: fixable, title: 'This movie would play without sound',
          // What FFmpeg found in the file says more than the bare fact that nothing was decoded.
          text: noTracks ? 'This file has no sound track.' : (this.assess && this.assess.audioReason) || this.audioReason || 'No sound could be decoded from this file.',
          short: 'No playable sound in this file', hint: fixable ? 'Use “Fix the sound” below.' : ''
        };
      }
      return AudioTracks.problem();
    },

    /** Right after an import, offers the fix for a sound problem that has one. Never on a restart or a retry. */
    maybeOffer() {
      if (this.offeredFor === this.loadToken || Modal.isOpen || Engine.test || AudioFix.running) return;
      const p = this.soundProblem();
      if (!p || !p.fixable || p.kind === 'maybe') return;
      if (Engine.mode !== 'free' && !(this.byUser && Engine.phase === 'standby')) return;
      this.offeredFor = this.loadToken;
      AudioFix.offer();
    },

    /**
     * Without FFmpeg nothing can say in advance whether the sound is playable, and finding out
     * at 9:29:32 PM is too late. So right after import the first two seconds are played without
     * sound, just long enough to see whether any sound gets decoded, then the film is put back.
     */
    async soundCheck(token) {
      if (this.hasAudio != null || Engine.mode !== 'free' || Engine.test || !video.paused) return;
      const mine = () => token === this.loadToken && Engine.mode === 'free' && !Engine.test;
      this.checking = true;
      UI.dirty.preflight = true;
      const t0 = performance.now();
      video.muted = true;
      try {
        await video.play();
        while (performance.now() - t0 < 4500 && this.hasAudio == null && mine() && !video.paused) await sleep(100);
      } catch (e) { /* cannot play at all: the sound stays unknown */ }
      const stillMine = mine();
      this.checking = false;
      if (stillMine) {
        if (!video.paused) video.pause();
        try { video.currentTime = 0; } catch (e) { /* not seekable */ }
      }
      applyVolume();                 // whatever happened, the user's own mute and volume come back
      UI.dirty.preflight = true;
    },

    setAudio(has, reason) {
      const changed = this.hasAudio !== has;
      this.hasAudio = has;
      this.audioReason = has ? '' : (reason || '');
      this.soundChanged();
      if (has || !changed) return;
      Engine.logEvent('Sound problem: ' + (reason || 'no sound decoded'));
      this.maybeOffer();
    },

    async explainFailure(info, loaded, hadVideo) {
      const name = '<b>' + esc(info.name || 'This file') + '</b>';
      let detail = '';
      if (info.path && native.isNative) {
        try {
          const r = await native.ffProbe(info.path, !!video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'), cfg.audioLang);
          if (r && r.assess && r.assess.reasons && r.assess.reasons.length) detail = ' ' + esc(r.assess.reasons.join(' '));
        } catch (e) { /* no extra detail */ }
      }
      if (loaded && !hadVideo) {
        return name + ' has sound but no picture this player can decode.' + detail +
          ' The picture is probably HEVC (H.265) without hardware support on this PC, or a 10-bit format. Use an H.264 MP4 copy of the film.';
      }
      return name + ' could not be opened.' + detail +
        ' Avengers Player needs an MP4 or MKV with H.264 (or HEVC on a recent graphics card) video. If the file plays elsewhere, convert it to H.264 MP4 with a tool such as HandBrake.';
    }
  };

  function applyVolume() {
    video.volume = clamp(cfg.volume, 0, 1);
    video.muted = !!cfg.muted;
  }

  /* ======================================================== sound tracks === */

  const channelName = (n) => ({ 1: 'Mono', 2: 'Stereo', 6: '5.1', 7: '6.1', 8: '7.1' }[n] || (n ? n + ' channels' : ''));

  /**
   * The sound tracks of the loaded movie that the player can decode, and which of them plays.
   *
   * English plays automatically (or the preferred language from Setup), whatever the file flags as
   * its main track; a track picked by hand is remembered for that file. Chromium only switches
   * tracks cleanly when the switch comes with a seek (a bare switch repeated quickly can leave the
   * film silent), so every switch re-cues the film, and a watchdog brings the sound back if it ever
   * stops being decoded while the film plays.
   */
  const AudioTracks = {
    supported: (() => { try { return !!video.audioTracks && typeof video.audioTracks.length === 'number'; } catch (e) { return false; } })(),
    list: [],              // [{ pos, lang, title, enabled, meta }]
    defaultPos: -1,        // the track the file itself would have played
    verify: null,          // a switch that still has to prove it produces sound
    alive: false, quietMs: 0, lastBytes: 0, lastWatch: 0, heals: [], gaveUp: false,

    fileKey(info) {
      const f = info || Media.info;
      return f ? (f.path || f.name || '') + '|' + (f.size || 0) : '';
    },

    clear() {
      this.list = [];
      this.defaultPos = -1;
      this.verify = null;
      this.alive = false;
      this.quietMs = 0;
      this.heals = [];
      this.gaveUp = false;
    },

    /** Reads the track list from the video element and attaches what FFmpeg knows about each track. */
    read() {
      const out = [];
      const src = this.supported && Media.ready ? video.audioTracks : null;
      const n = src ? src.length : 0;
      const probed = (Media.probe && Media.probe.audio) || [];
      const playable = probed.filter((a) => C.playableAudioCodec(a.codec));
      // Chromium lists only what it can decode, in file order: line the two lists up when they agree.
      const metaOf = n && n === probed.length ? probed : n && n === playable.length ? playable : [];
      for (let i = 0; i < n; i++) {
        const t = src[i];
        const meta = metaOf[i] || null;
        const label = String(t.label || '').trim();
        const title = /handler$/i.test(label) ? '' : label;      // "SoundHandler" is what an MP4 says when it says nothing
        const lang = C.normLang(t.language) || C.langFromTitle(title) || (meta ? C.trackLang(meta) : '');
        out.push({ pos: i, lang: lang, title: title || (meta && meta.title) || '', enabled: !!t.enabled, meta: meta });
      }
      this.list = out;
      return out;
    },

    current() { return this.list.find((t) => t.enabled) || null; },

    /** True when `pos` is the one and only enabled track. */
    only(pos) { return this.list.length > 0 && this.list.every((t) => t.enabled === (t.pos === pos)); },

    name(t, plain) {
      if (!t) return '';
      const lang = C.langName(t.lang);
      let name = lang || t.title || 'Sound track ' + (t.pos + 1);
      if (lang && /comment|director|descri/i.test(t.title)) name = t.title;
      const ch = !plain && t.meta ? channelName(t.meta.channels) : '';
      return ch ? name + ' · ' + ch : name;
    },

    /** A movie was loaded: choose the track to play before anything is played. */
    onLoad() {
      this.clear();
      this.read();
      this.defaultPos = this.list.findIndex((t) => t.enabled);
      const pos = this.choose();
      if (pos >= 0 && !this.only(pos)) {
        this.apply(pos);
        Engine.logEvent('Sound track chosen: ' + this.name(this.list[pos]) +
          (this.defaultPos >= 0 && this.defaultPos !== pos ? ' (the file itself would have played ' + this.name(this.list[this.defaultPos]) + ')' : ''));
      }
      UI.renderSoundTracks();
    },

    /** The pick remembered for this file if there is one, otherwise the preferred language. */
    choose() {
      if (!this.list.length) return -1;
      if (cfg.audioPickKey && cfg.audioPickKey === this.fileKey()) {
        const t = this.list[cfg.audioPickPos];
        if (t && t.lang === cfg.audioPickLang) return t.pos;
      }
      return C.pickAudioTrack(this.list.map((t) => ({ lang: t.lang, title: t.title, isDefault: t.pos === this.defaultPos })), cfg.audioLang);
    },

    pickedByHand(t) {
      return !!t && !!cfg.audioPickKey && cfg.audioPickKey === this.fileKey() && cfg.audioPickPos === t.pos;
    },

    /** Flips the switches. On its own this is only safe while nothing is playing. */
    apply(pos) {
      let src = null;
      try { src = video.audioTracks; } catch (e) { src = null; }
      if (!src || !src[pos]) return false;
      for (let i = 0; i < src.length; i++) if (i !== pos && src[i].enabled) src[i].enabled = false;
      if (!src[pos].enabled) src[pos].enabled = true;
      this.list.forEach((t) => { t.enabled = t.pos === pos; });
      return true;
    },

    /** Switches track and re-cues the film, which is what makes the switch clean. */
    switchTo(pos, why) {
      const prev = this.current();
      if (!this.apply(pos)) return false;
      this.verify = { prev: prev ? prev.pos : -1, playedMs: 0 };
      this.alive = false;
      this.quietMs = 0;
      const ph = Engine.phase;
      if (Engine.mode === 'armed' && (ph === 'synced' || ph === 'standby' || ph === 'cueing')) {
        Engine.recalibrate('sound').catch(() => {});
      } else {
        try { video.currentTime = video.currentTime; } catch (e) { /* not seekable yet */ }
      }
      Engine.logEvent('Sound track: ' + this.name(this.list[pos]) + (why ? ' (' + why + ')' : ''));
      Media.soundChanged();
      return true;
    },

    /** The user picks a track: the list in the Mission tab, the button on the bar, the A key. */
    select(pos) {
      const t = this.list[pos];
      if (!Media.ready || !t) return false;
      if (Engine.locked()) return false;
      cfg.audioPickKey = this.fileKey();
      cfg.audioPickPos = pos;
      cfg.audioPickLang = t.lang;
      save();
      if (this.only(pos)) { Media.soundChanged(); return true; }
      if (!this.switchTo(pos, 'chosen by hand')) return false;
      toast('Sound: ' + this.name(t), 'good');
      return true;
    },

    cycle() {
      if (!Media.ready) return;
      if (this.list.length < 2) {
        toast(this.list.length ? 'This file has one sound track: ' + this.name(this.list[0]) : 'This file has no sound the player can decode');
        return;
      }
      const cur = this.current();
      this.select(((cur ? cur.pos : -1) + 1) % this.list.length);
    },

    /** The preferred language was changed in Setup: forget the hand-made pick and choose again. */
    preferenceChanged() {
      cfg.audioPickKey = '';
      cfg.audioPickPos = -1;
      cfg.audioPickLang = '';
      save();
      if (!Media.ready) return;
      const pos = this.choose();
      if (pos >= 0 && !this.only(pos)) this.switchTo(pos, 'preferred language');
      Media.offeredFor = -1;
      Media.byUser = true;
      Media.inspect(Media.loadToken);                    // the file is judged against the new language
    },

    /**
     * Is the sound that plays the sound that is wanted? null when all is well, otherwise
     * { kind, title, text, short, hint, fixable }:
     *   fixable  the wanted track is in the file but has to be converted first
     *   other    the file simply has no track in the wanted language
     *   maybe    another language plays and, without FFmpeg, nothing can look inside the file
     */
    problem() {
      if (!Media.ready || !Media.inspected || !this.supported) return null;
      const cur = this.current();
      if (!cur || this.pickedByHand(cur)) return null;   // silence is Media's business; a hand-made pick is respected
      const want = C.normLang(cfg.audioLang) || 'eng';
      const wantName = C.langName(want);
      const curName = C.langName(cur.lang);
      const canFix = !!(Media.info && Media.info.path && native.isNative);
      const a = Media.assess;
      if (Media.probe && a) {
        const bestName = C.langName(a.audioLang);
        const playingBest = !!(cur.meta && cur.meta.index === a.audioIndex);
        if (a.needsAudioFix && !playingBest) {
          return {
            kind: 'fixable', fixable: canFix,
            title: bestName ? 'The ' + bestName + ' sound needs converting' : 'The main sound track needs converting',
            text: a.audioReason,
            short: bestName && curName && bestName !== curName ? 'The sound is ' + curName + ', not ' + bestName : 'The main sound track cannot be played yet',
            hint: 'Use “Fix the sound” below' + (bestName ? ': it converts the ' + bestName + ' track.' : '.')
          };
        }
        if (cur.lang === want || !curName) return null;
        if (a.hasPreferred) {
          return {
            kind: 'fixable', fixable: canFix,
            title: 'This movie would play in ' + curName,
            text: 'This movie would play in ' + curName + ', although the file has ' + wantName + ' sound. The fix makes a copy in which ' + wantName + ' comes first.',
            short: 'The sound is ' + curName + ', not ' + wantName, hint: 'Use “Fix the sound” below.'
          };
        }
        const converted = /\(Avengers Player\)\.mp4$/i.test(Media.info.name || '');
        return {
          kind: 'other', fixable: false,
          title: 'This file has no ' + wantName + ' sound',
          text: 'The sound of this file is ' + curName + '. It has no ' + wantName + ' sound track. ' +
            (converted ? 'Import the original movie file instead and fix its sound: ' + wantName + ' is then chosen automatically.' : 'Use a copy of the film that has ' + wantName + ' sound.') +
            ' (If ' + curName + ' is what you want, make it the preferred sound language in Setup.)',
          short: 'The sound is ' + curName + ', not ' + wantName,
          hint: 'This file has no ' + wantName + ' track.' + (converted ? ' Import the original movie file instead.' : '')
        };
      }
      if (cur.lang === want || !curName) return null;
      return {
        kind: 'maybe', fixable: canFix,
        title: 'The sound of this movie is ' + curName,
        text: 'The sound that will play is ' + curName + ', not ' + wantName + '. If the file also has ' + wantName + ' sound in Dolby or DTS, it can be converted.',
        short: 'The sound is ' + curName + ', not ' + wantName,
        hint: canFix ? '“Fix the sound” below can look inside the file for ' + wantName + ' sound.' : ''
      };
    },

    /** Runs 5 times a second: proves that a switch produced sound, and revives sound that stopped. */
    watch(perf) {
      const dt = clamp(perf - (this.lastWatch || perf), 0, 1000);
      this.lastWatch = perf;
      if (!this.supported || !Media.ready || !this.list.length) return;
      const bytes = video.webkitAudioDecodedByteCount || 0;
      // "Find the snap" plays the film fast and without sound: nothing to watch then.
      const playing = !video.paused && !video.seeking && !video.ended && video.readyState >= 3 && !SnapCam.busy;
      if (!playing) { this.quietMs = 0; this.alive = false; this.lastBytes = bytes; return; }
      if (bytes !== this.lastBytes) {
        this.lastBytes = bytes;
        this.quietMs = 0;
        this.alive = true;
        this.verify = null;
        return;
      }
      this.quietMs += dt;
      if (this.verify) {
        this.verify.playedMs += dt;
        if (this.verify.playedMs >= 5000) this.switchFailed();
        return;
      }
      if (!this.alive || this.quietMs < 4000 || Media.hasAudio !== true) return;
      if (video.duration - video.currentTime < 15) return;       // sound often ends a little before the picture
      this.revive();
    },

    /** The track that was switched to gives no sound: go back to the one that did. */
    switchFailed() {
      const back = this.verify ? this.verify.prev : -1;
      const bad = this.current();
      this.verify = null;
      Engine.logEvent('The sound track ' + this.name(bad) + ' produced no sound');
      if (back >= 0 && this.list[back] && (!bad || bad.pos !== back)) {
        cfg.audioPickKey = '';
        cfg.audioPickPos = -1;
        cfg.audioPickLang = '';
        save();
        toast('That sound track cannot be decoded: back to ' + this.name(this.list[back]), 'bad');
        this.switchTo(back, 'the other track produced no sound');
        this.verify = null;                              // the track it came from is known to work
      } else {
        toast('This sound track produces no sound', 'bad');
      }
    },

    /** The sound was playing and stopped being decoded although the film runs: re-cue to bring it back. */
    revive() {
      const p = performance.now();
      if (Engine.mode === 'armed' && Engine.session) {
        if (Engine.nearMoment(Clock.now(), 6000, 2000)) return;     // never re-cue across midnight or the snap itself
      }
      this.quietMs = 0;
      this.alive = false;
      // Three attempts per movie, no more: if something about this file fools the check, it must
      // not be able to disturb the film again and again.
      if (this.heals.length >= 3) {
        if (!this.gaveUp) {
          this.gaveUp = true;
          Engine.logEvent('The sound stopped and re-cueing did not bring it back');
          toast('The sound stopped. Press R to recalibrate, or check the file.', 'bad');
        }
        return;
      }
      if (Engine.mode === 'armed' && Engine.phase !== 'synced') return;      // the engine is already re-cueing
      this.heals.push(p);
      Engine.logEvent('The sound stopped being decoded: re-cueing the film to bring it back');
      const pos = this.choose();
      if (pos >= 0) this.apply(pos);                     // whatever happened to the switches, the right track is on again
      if (Engine.mode === 'armed') { Engine.autoRecal('the sound stopped'); return; }
      try { video.currentTime = video.currentTime; } catch (e) { /* not seekable */ }
    }
  };

  /* ======================================================= film versions === */

  /** Identifies "this snap point in this file", so a confirmation never carries over to another file or setting. */
  const snapKey = () => (Media.info ? (Media.info.path || Media.info.name) + '|' + (Media.info.size || 0) + '|' + cfg.snapSec.toFixed(3) : '');
  const snapConfirmed = () => !!Media.info && !!cfg.snapConfirmedFor && cfg.snapConfirmedFor === snapKey();

  /**
   * Every film file remembers the snap point it was given, so ENDGAME and ENCORE can both be
   * set once and then swapped freely. A file is known by its name and size: moving it to another
   * folder does not make it a stranger.
   */
  const SnapMemory = {
    key(info) { return info ? (info.name || '') + '|' + (info.size || 0) : ''; },
    get(info) {
      const m = info ? cfg.snapByFile[this.key(info)] : null;
      return m && m.snapSec > 0 ? m : null;
    },
    /**
     * Notes the snap point of the loaded file as it is now.
     *   extra.how       how it was arrived at: 'flash+line', 'flash' (found by the app), 'user'
     *                   (picked from the frames), 'estimate' (from the subtitles), 'typed'
     *   extra.searched  the app has looked for the snap in this file (it does that once)
     */
    put(extra) {
      if (!Media.info) return;
      extra = extra || {};
      const key = this.key(Media.info);
      const confirmed = snapConfirmed();
      const was = cfg.snapByFile[key] || {};
      delete cfg.snapByFile[key];                // put back last: the newest entries are the ones kept
      cfg.snapByFile[key] = {
        snapSec: cfg.snapSec, version: cfg.filmVersion, confirmed: confirmed,
        how: extra.how != null ? extra.how : (was.how || ''), searched: !!(extra.searched || was.searched)
      };
      // A point confirmed in one copy of a cut is where any other copy of that cut starts from.
      const cut = Versions.guess;
      if (confirmed && cut) {
        delete cfg.snapByFile['@' + cut.family];
        cfg.snapByFile['@' + cut.family] = { snapSec: cfg.snapSec, version: cut.id, confirmed: false };
      }
      const keys = Object.keys(cfg.snapByFile);
      while (keys.length > 24) delete cfg.snapByFile[keys.shift()];
      save();
    },
    /** Where a copy of this cut starts from: the point confirmed in another copy (of this cut, else of the other one), else the round figure. */
    startFor(cut) {
      if (!cut) return null;
      // ENCORE is the same film with 25 s more: until a copy of it has been looked at, the point
      // confirmed in ENDGAME is a better start than the round figure (and the other way round).
      const other = { original: 'encore', encore: 'original' }[cut.family];
      const m = cfg.snapByFile['@' + cut.family] || (other ? cfg.snapByFile['@' + other] : null);
      return m && m.snapSec > 0 ? m.snapSec : cut.snapSec;
    },
    /** A copy made from a film (the sound fix) has the same picture: it inherits the snap point. */
    inherit(from, to) {
      const m = this.get(from);
      if (!m || !to) return;
      cfg.snapByFile[this.key(to)] = { snapSec: m.snapSec, version: m.version, confirmed: m.confirmed, how: m.how || '', searched: !!m.searched };
      save();
    }
  };

  const Versions = {
    guess: null,                   // what the length of the loaded file points to

    current() { return C.filmVersion(cfg.filmVersion); },

    /**
     * Where the snap would be if everything this file has more than the 2019 film came BEFORE the
     * film. Only offered for a small surplus: an introduction or a logo, not minutes of new scenes.
     */
    laterSnap() {
      if (!Media.ready) return null;
      const extra = video.duration - C.REFERENCE_SEC;
      if (!(extra >= 3 && extra <= 130)) return null;
      const later = C.DEFAULT_SNAP_SEC + Math.round(extra);
      return video.duration >= later + 2 ? later : null;
    },

    /**
     * A movie was imported. A file that has been here before gets its own snap point back; any
     * other file of a known length starts from that cut's figure; a file of no known length keeps
     * whatever is set.
     */
    onImport() {
      this.guess = Media.ready ? C.guessFilmVersion(video.duration, Media.info && Media.info.name) : null;
      const mem = SnapMemory.get(Media.info);
      if (mem && mem.snapSec < video.duration - 2) {
        const moved = Math.abs(cfg.snapSec - mem.snapSec) > 0.0005;
        cfg.snapSec = mem.snapSec;
        cfg.filmVersion = (this.guess || C.filmVersion(mem.version)).id;     // what the file's name says, now
        if (mem.confirmed) cfg.snapConfirmedFor = snapKey();
        if (moved) cfg.rehearsed = {};
        save();
        Engine.session = Engine.computeFree();
        if (moved) toast('The snap point of this file: ' + C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true }) + (mem.confirmed ? ', confirmed earlier' : ''));
        Engine.logEvent('Snap point remembered for this file: ' + C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true }) + (mem.confirmed ? ' (confirmed)' : ''));
        return;
      }
      this.recognise();
    },

    /** Starts a file of a known length from that cut's own figure. */
    recognise() {
      this.guess = Media.ready ? C.guessFilmVersion(video.duration, Media.info && Media.info.name) : null;
      const guess = this.guess;
      const cur = this.current();
      if (!guess) return;
      // Another copy of the cut that is already selected: the point that is set is the best start.
      if (cur.id !== 'custom' && cur.family === guess.family) return;
      cfg.filmVersion = guess.id;
      cfg.snapSec = SnapMemory.startFor(guess);
      cfg.rehearsed = {};
      save();
      Engine.session = Engine.computeFree();
      Engine.logEvent('Film version: ' + guess.name + ' (by the file name; ' + C.fmtDuration(video.duration) + ' long)');
    },

    /** The user picks a cut. `factory` goes back to the round figure even when a better one is known. */
    choose(id, factory) {
      if (Engine.mode === 'armed' || Engine.test) { toast(Engine.test ? 'End the test run to change the film version' : 'Stop the countdown to change the film version'); UI.renderSettings(); return; }
      const v = C.filmVersion(id);
      cfg.filmVersion = v.id;
      if (v.snapSec != null) cfg.snapSec = factory ? v.snapSec : SnapMemory.startFor(v);
      cfg.rehearsed = {};
      save();
      SnapMemory.put();
      Engine.session = Engine.computeFree();
      UI.renderSettings();
      UI.dirty.all = true;
      UI.dirty.preflight = true;
      toast(v.snapSec != null ? v.short + ': snap at ' + C.fmtDuration(v.snapSec, { forceHours: true }) : 'Now set the snap point below', 'good');
    },

    confirm() {
      cfg.snapConfirmedFor = snapKey();
      save();
      const mem = SnapMemory.get(Media.info);
      SnapMemory.put(mem && /^flash(\+line)?$/.test(mem.how || '') ? null : { how: 'user' });      // somebody looked at it
      UI.dirty.preflight = true;
      UI.renderStartTime();
      Engine.logEvent('Snap point confirmed in this file: ' + C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true }));
    }
  };

  /* ============================================================== engine === */

  const Engine = {
    mode: 'free',        // free | armed
    phase: 'idle',       // idle | standby | cueing | synced | slipped | blocked
    session: null,       // { targetEpoch, startEpoch, endEpoch, snapSec: where the film is at the target }
    test: null,
    token: 0,            // bumped whenever a recalibration in flight must be abandoned
    waiter: null,
    engineSeeks: 0,
    mark: null,
    ctrl: new C.DriftController(),
    events: [],
    graph: [],
    st: {
      drift: null, rate: 1, recals: 0, autoRecals: 0, slips: 0, lastRecal: null,
      slipReason: '', slipAt: 0, slipHold: false,
      syncedAt: 0, lastFrameSample: 0, stallAt: 0, recentAuto: [], lastWall: 0, lastPerf: 0, settleUntil: 0
    },

    logEvent(text) {
      this.events.push({ at: Date.now(), text: text });
      if (this.events.length > 200) this.events.shift();
      try { native.log(text); } catch (e) { /* log is best effort */ }
      UI.dirty.log = true;
    },

    setPhase(p) {
      if (this.phase === p) return;
      this.phase = p;
      UI.onPhase();
    },

    duration() { return Media.ready ? video.duration : NaN; },

    computeFree() {
      return C.computeSession({
        nowMs: Clock.now(), snapSec: startLead(), durationSec: this.duration(),
        targetMode: cfg.targetMode, customTargetMs: customTargetMs()
      });
    },

    /** The viewing that ends on `targetEpoch`, with the start time chosen in Setup (or `mode`). */
    sessionFor(targetEpoch, mode) {
      return C.computeSession({
        nowMs: Clock.now(), snapSec: startLead(mode), durationSec: this.duration(),
        targetMode: 'custom', customTargetMs: targetEpoch
      });
    },

    /** When the snap itself comes on screen: the target, unless the start time was chosen by hand. */
    snapEpoch(s) {
      s = s || this.session;
      return s ? s.startEpoch + Math.round(cfg.snapSec * 1000) : NaN;
    },

    /** Whether `now` is between `before` ms before and `after` ms after the target or the snap itself. */
    nearMoment(now, before, after) {
      const s = this.session;
      if (!s) return false;
      return [s.targetEpoch, this.snapEpoch(s)].some((e) => e - now < before && e - now > -after);
    },

    /** Where the film should be right now (seconds). Negative before the start time. */
    expected(epoch) {
      return ((epoch == null ? Clock.now() : epoch) - this.session.startEpoch) / 1000;
    },

    /** True in the last moments before the start or the snap, when nothing may disturb the clock. */
    nearCritical() {
      if (this.mode !== 'armed' || !this.session) return false;
      const now = Clock.now();
      const toStart = this.session.startEpoch - now;
      return (toStart > -5000 && toStart < 120000) || this.nearMoment(now, 120000, 20000);
    },

    /* ---- arming ---------------------------------------------------------- */

    async arm(opts) {
      opts = opts || {};
      if (!Media.ready || this.test) return;
      if (opts.restore) Recovery.claim();
      if (!opts.restore) {
        // A fresh start of the countdown: stop the mistakes that would only show at midnight.
        const len = video.duration;
        if (cfg.startMode !== 'auto' && len < startLead() + 2) {
          toast('This file is only ' + C.fmtDuration(len) + ' long: with the start time you chose it would be over before ' + targetWord(this.computeFree()) + '. Pick another start time in Setup.', 'bad');
          return;
        }
        if (len < cfg.snapSec + 2) {
          Modal.open({
            title: 'This file ends before the snap',
            html: 'The file is <b>' + esc(C.fmtDuration(len)) + '</b> long, but the snap point is set to <b>' + esc(C.fmtDuration(cfg.snapSec, { forceHours: true })) +
              '</b>, so the snap would never happen. Either this is the wrong file (a sample, another film, a download that was cut short), or the snap point needs changing in Setup.',
            actions: [
              { label: 'Open Setup', onClick: () => { Modal.close(); UI.showTab('setup'); } },
              { label: 'OK', primary: true, onClick: () => Modal.close() }
            ],
            onEscape: () => Modal.close()
          });
          return;
        }
        if (Media.hasAudio === false && !opts.silentOk) {
          const fixable = Media.info && Media.info.path && native.isNative && (!Media.probe || (Media.probe.audio || []).length > 0);
          Modal.open({
            title: 'This movie would play without sound',
            html: esc(Media.audioReason || 'No sound could be decoded from this file.') + '<br><br>Start the countdown anyway?',
            actions: [
              { label: 'Cancel', onClick: () => Modal.close() },
              { label: 'Start anyway', onClick: () => { Modal.close(); this.arm(Object.assign({}, opts, { silentOk: true, langOk: true })); } }
            ].concat(fixable ? [{ label: 'Fix the sound', primary: true, onClick: () => { Modal.close(); AudioFix.offer(); } }] : []),
            onEscape: () => Modal.close()
          });
          return;
        }
        const lp = opts.langOk ? null : Media.soundProblem();
        if (lp && lp.kind !== 'silent') {
          // The film would play, but not in the language that is wanted: say so now, not at midnight.
          Modal.open({
            title: lp.title,
            html: esc(lp.text) + '<br><br>Start the countdown anyway?',
            actions: [
              { label: 'Cancel', onClick: () => Modal.close() },
              { label: 'Start anyway', onClick: () => { Modal.close(); this.arm(Object.assign({}, opts, { langOk: true })); } }
            ].concat(lp.fixable ? [{ label: 'Fix the sound', primary: true, onClick: () => { Modal.close(); AudioFix.offer(); } }] : []),
            onEscape: () => Modal.close()
          });
          return;
        }
        // (With a start time chosen by hand the snap point does not decide the start: nothing to ask.)
        if (!opts.snapOk && cfg.startMode === 'auto' && !snapConfirmed() && Frames.supported && Clock.now() < this.computeFree().startEpoch) {
          // The mistake this app exists to prevent: a snap that lands a second or two off, because
          // the snap point was never checked against the picture. (Somebody joining late has no
          // time for this and is not asked.)
          Modal.open({
            title: 'Find the snap first?',
            html: 'The snap point of this file, <b>' + esc(C.fmtDuration(cfg.snapSec, { ms: cfg.snapSec % 1 !== 0, forceHours: true })) + '</b>, has not been checked against the picture. ' +
              '“2:30:30” is a round figure: in the film the fingers snap a moment later, so the snap could land a second or two after the clock.' +
              '<br><br>Finding the exact frame takes about fifteen seconds.',
            actions: [
              { label: 'Cancel', onClick: () => Modal.close() },
              { label: 'Start anyway', onClick: () => { Modal.close(); this.arm(Object.assign({}, opts, { snapOk: true })); } },
              { label: 'Find the snap', primary: true, onClick: () => { Modal.close(); SnapCam.find(); } }
            ],
            onEscape: () => Modal.close()
          });
          return;
        }
        if (cfg.muted || cfg.volume < 0.05) {
          // A mute left over from a rehearsal would make the whole film silent.
          cfg.muted = false;
          if (cfg.volume < 0.05) cfg.volume = 1;
          save();
          applyVolume();
          UI.renderSettings();
          toast('The player was muted: sound is back on');
        }
      }
      let target = opts.restore && Number.isFinite(cfg.armedTarget) ? cfg.armedTarget : this.computeFree().targetEpoch;
      let s = this.sessionFor(target);
      if (s.endEpoch != null && Clock.now() >= s.endEpoch - 1000) {
        if (opts.restore) {
          cfg.armed = false; cfg.armedTarget = null; cfg.armedEnd = null; saveNow();
          tellArmed(false);
          toast('That countdown has already finished.');
          this.session = this.computeFree();
          UI.onMode();
          return;
        }
        toast('That moment has already passed. Pick a later target in Setup.', 'bad');
        return;
      }
      this.session = s;
      this.mode = 'armed';
      this.st.recals = 0; this.st.autoRecals = 0; this.st.slips = 0; this.st.recentAuto = [];
      cfg.armed = true;
      cfg.armedTarget = s.targetEpoch;
      cfg.armedEnd = s.endEpoch != null ? s.endEpoch : null;      // a crash is recovered from until the film is over
      saveNow();
      tellArmed(true);
      const joining = !opts.restore && Clock.now() >= s.startEpoch;      // the film should already be running
      const late = snapLate(s);
      this.logEvent((opts.restore ? 'Countdown resumed' : joining ? 'Joined late' : 'Countdown armed') + ': movie starts ' + dateTimeOf(s.startEpoch) +
        (cfg.startMode !== 'auto' ? ' (start time chosen by hand: ' + startName(cfg.startMode, s) + '; the snap lands ' + lateText(late) + ' ' + targetWord(s) + ')' : ''));
      if (!opts.restore && !joining && cfg.startMode !== 'auto') toast('Armed: the movie starts at ' + clockOf(s.startEpoch) + ', the time you chose: ' + landsText(s) + '.');
      else if (!opts.restore && !joining && !snapConfirmed()) toast('Armed with a snap point that has not been checked. The Snap test shows whether it lands.');
      Power.onArm();
      UI.onMode();
      // Resumed with the film due to be running (a crash, a power cut, the PC switched off and on
      // again): it goes straight to where the clock says, and says so.
      // (A reload after a video error is no comeback: it goes back quietly, as before.)
      const resuming = !!opts.restore && !opts.reload && Clock.now() >= s.startEpoch;
      if (opts.restore && !resuming && !opts.reload) Recovery.stillArmed(s);
      // Not awaited: before the start time this only finishes when the film starts, and whoever
      // armed (startup, the button) has other things to do meanwhile.
      this.recalibrate(joining ? 'late' : resuming ? 'resume' : 'arm').catch((e) => this.logEvent('Recalibration failed: ' + (e && e.message)));
    },

    /**
     * An armed countdown that is still waiting for the start lets go of the film for a moment
     * (the app looks for the snap in a movie that was just imported). It stays armed on disk, so
     * a crash in that moment restarts armed; arm({ restore: true }) takes the film back.
     */
    lend() {
      this.token++;
      this.dropWaiter();
      this.mode = 'free';
      this.lentAt = performance.now();
      this.setPhase('idle');
      UI.onMode();
      this.logEvent('The armed countdown lets go of the film for a moment');
    },

    /** Abandons whoever is waiting for the clock, telling them so. */
    dropWaiter() {
      const w = this.waiter;
      this.waiter = null;
      if (w) w.res(false);
    },

    disarm() {
      if (this.mode !== 'armed' || this.test) return;
      this.token++;
      this.dropWaiter();
      this.mode = 'free';
      cfg.armed = false; cfg.armedTarget = null; cfg.armedEnd = null; saveNow();
      tellArmed(false);
      if (Media.ready) { video.playbackRate = 1; if (!video.paused) video.pause(); }
      UI.hideSlip();
      if (this.session) Late.dismissedFor = this.session.targetEpoch;   // stopped on purpose: no "you are late" box
      this.session = this.computeFree();
      this.setPhase('idle');
      this.logEvent('Countdown stopped');
      UI.onMode();
    },

    /** Drops everything in flight (used when another movie is loaded). The saved armed flag is kept. */
    hardReset() {
      this.token++;
      this.dropWaiter();
      SnapCam.cancelled = true;
      SnapCam.live = null;
      SnapCam.close();
      if (this.test && this.test.kind === 'late') Late.dismissedFor = this.test.prevDismissed;
      if (this.test) { Clock.testOffsetMs = 0; UI.prevNow = 0; this.test = null; UI.onTest(); }
      this.mode = 'free';
      Celebration.stop();
      UI.hideSlip();
      el.blocked.hidden = true;
      this.setPhase('idle');
      UI.onMode();
    },

    /* ---- the core: put the film where the clock says, exactly ----------- */

    /**
     * Seeks to where the film must be a short moment from now ("the mark"), waits for the decoder
     * to be ready on that frame, then presses play at the exact instant the clock reaches the mark.
     * Before the start time the mark is the start time itself and the film waits at 0:00.
     */
    async recalibrate(reason) {
      if (this.mode !== 'armed' || !Media.ready) return;
      const tok = ++this.token;
      this.dropWaiter();
      this.mark = null;
      UI.hideSlip();
      el.blocked.hidden = true;
      this.ctrl.reset();
      this.st.drift = null;
      this.st.stallAt = 0;
      this.st.rate = 1;
      if (video.playbackRate !== 1) video.playbackRate = 1;
      applyVolume();
      const counted = reason !== 'arm' && reason !== 'test' && reason !== 'late' && reason !== 'resume';
      if (counted) {
        this.st.recals++;
        this.st.lastRecal = { at: Date.now(), reason: reason };
      }
      const dur = video.duration;

      for (let attempt = 0; attempt < 6; attempt++) {
        const t0 = Clock.now();
        const lead = clamp(cfg.learnedSeekLead, 0.4, 6);
        let markEpoch = t0 + lead * 1000;
        let pos = this.expected(markEpoch);
        let waitsForStart = false;
        if (pos <= 0) { pos = 0; markEpoch = this.session.startEpoch; waitsForStart = true; }
        if (pos >= dur - 0.3) { this.finish(); return; }

        this.setPhase(waitsForStart && markEpoch - t0 > 1500 ? 'standby' : 'cueing');
        if (!video.paused) video.pause();
        const p0 = performance.now();
        await this.seek(pos);
        if (tok !== this.token) return;
        const seekSec = (performance.now() - p0) / 1000;
        if (!waitsForStart) {
          // Room for the decoder: grow at once when a seek was slow, shrink only slowly.
          const need = seekSec * 1.8 + 0.3;
          cfg.learnedSeekLead = clamp(need > cfg.learnedSeekLead ? need : 0.85 * cfg.learnedSeekLead + 0.15 * need, 0.4, 6);
        }

        let waited = false;
        const playAt = markEpoch - cfg.learnedLatency * 1000;
        const spare = playAt - Clock.now();
        if (spare < -15) {
          // Missed the mark: pressing play now would start behind the clock. Go again with more room.
          cfg.learnedSeekLead = clamp(Math.max(cfg.learnedSeekLead, seekSec * 2 + 0.4), 0.4, 6);
          if (attempt < 5) continue;
        } else {
          const result = await this.waitUntil(playAt, tok);
          if (tok !== this.token) return;
          if (result === 'late' && attempt < 5) continue;
          waited = result === 'ok' && spare >= 0;
        }

        this.mark = { epoch: markEpoch, pos: pos, latUsed: cfg.learnedLatency, waited: waited, learned: false, firstDrift: null, reason: reason };
        this.st.syncedAt = performance.now();
        this.ctrl.reset();
        this.setPhase('synced');
        try {
          await video.play();
        } catch (e) {
          if (tok === this.token) this.onBlocked();
          return;
        }
        if (tok !== this.token) return;
        if (reason === 'recover' || reason === 'manual') toast('Back in sync', 'good');
        if (reason === 'late') toast('Joined at ' + C.fmtDuration(Math.max(0, C.filmSecondOnClock(this.session, Clock.now())), { forceHours: true }) + ': the film is where the clock says it should be', 'good');
        if (reason === 'wake') toast('The PC woke up: the film is back at ' + C.fmtDuration(Math.max(0, C.filmSecondOnClock(this.session, Clock.now())), { forceHours: true }) + ', where the clock says', 'good', 6000);
        if (reason === 'resume') Recovery.resumed(this.mark);
        this.logEvent('In sync at ' + C.fmtDuration(pos) + ' (' + reason + ')');
        save();
        return;
      }
    },

    seek(pos) {
      return new Promise((res) => {
        this.engineSeeks++;
        let finished = false;
        let began = false;
        let to = 0;
        const done = (ok) => {
          if (finished) return;
          finished = true;
          video.removeEventListener('seeking', onSeeking);
          video.removeEventListener('seeked', onSeeked);
          clearTimeout(to);
          this.engineSeeks = Math.max(0, this.engineSeeks - 1);
          res(ok);
        };
        // A 'seeked' left over from an earlier seek must not finish this one: wait for this seek's
        // own 'seeking', and check the film really is where it was sent.
        const onSeeking = () => { began = true; };
        const onSeeked = () => { if (began && Math.abs(video.currentTime - pos) < 0.5) done(true); };
        video.addEventListener('seeking', onSeeking);
        video.addEventListener('seeked', onSeeked);
        to = setTimeout(() => done(false), 10000);
        try { video.currentTime = pos; } catch (e) { done(false); }
      });
    },

    /** Resolves 'ok' exactly when the clock reaches `epoch`, 'late' if that moment was missed, false if abandoned. */
    waitUntil(epoch, tok) {
      return new Promise((res) => {
        this.waiter = { epoch: epoch, tok: tok, res: res, fine: false };
        this.pump();
      });
    },

    pump() {
      const w = this.waiter;
      if (!w) return;
      if (performance.now() < this.st.settleUntil) return;     // clock in doubt, see tick()
      if (w.tok !== this.token) { this.waiter = null; w.res(false); return; }
      const rem = w.epoch - Clock.now();
      if (rem < -400) { this.waiter = null; w.res('late'); return; }   // e.g. the PC slept through the mark
      if (rem <= 25) {
        // Timers are only good to a few milliseconds (worse on battery), so spin out the last stretch.
        const until = performance.now() + Math.max(0, rem);
        while (performance.now() < until) { /* busy wait, at most 25 ms */ }
        this.waiter = null;
        w.res('ok');
        return;
      }
      if (rem < 900 && !w.fine) {
        w.fine = true;
        setTimeout(() => { if (this.waiter === w) { w.fine = false; this.pump(); } }, Math.max(0, rem - 20));
      }
    },

    onBlocked() {
      this.setPhase('blocked');
      el.blocked.hidden = false;
      this.logEvent('Playback was blocked and needs one click');
    },

    finish() {
      this.token++;
      this.dropWaiter();
      if (!video.paused) video.pause();
      video.playbackRate = 1;
      this.logEvent('The movie finished');
      if (this.test) { this.setPhase('idle'); return; }
      this.mode = 'free';
      cfg.armed = false; cfg.armedTarget = null; cfg.armedEnd = null; saveNow();
      tellArmed(false);
      this.session = this.computeFree();
      this.setPhase('idle');
      UI.onMode();
    },

    /* ---- slips ----------------------------------------------------------- */

    slip(reason) {
      if (this.mode !== 'armed' || this.phase === 'slipped' || this.phase === 'idle') return;
      this.token++;
      this.dropWaiter();
      if (video.playbackRate !== 1) video.playbackRate = 1;
      this.st.rate = 1;
      this.st.slipReason = reason;
      this.st.slipAt = performance.now();
      this.st.slipClock = Math.floor(Clock.now() / 1000) * 1000;     // its countdown runs on the clock's seconds
      this.st.slipHold = false;
      this.st.slips++;
      this.setPhase('slipped');
      this.logEvent('Slipped (' + reason + ')');
      UI.showSlip();
    },

    /**
     * The PC woke up from sleep or hibernation (the lid, the power button, a battery running low).
     * The film stood still meanwhile: it goes straight back to where the clock says. (tick() also
     * notices the jump of the clock and asks the time servers again before anything is decided.)
     */
    onWake() {
      this.logEvent('The PC woke up');
      if (this.mode !== 'armed' || !Media.ready || !this.session) return;
      // Out of sync on purpose, or "Recalibrate by itself" switched off: the slip waits for the user.
      if (this.phase === 'slipped' && (this.st.slipHold || !cfg.autoRecover)) return;
      const exp = this.expected(Clock.now());
      // While it waits for the start the wait itself notices a missed start, so only a running film is re-cued.
      if (['synced', 'slipped', 'blocked', 'cueing'].includes(this.phase) && exp > 0 && exp < video.duration - 0.3) this.recalibrate('wake');
    },

    recover(by) {
      if (this.mode !== 'armed') return;
      if (this.phase !== 'slipped' && this.phase !== 'blocked') return;
      this.logEvent('Recalibrating (' + (by || 'button') + ')');
      this.recalibrate('recover');
    },

    manualRecalibrate() {
      if (this.mode !== 'armed') { toast('Start the countdown first'); return; }
      if (this.phase === 'slipped' || this.phase === 'blocked') { this.recover('key'); return; }
      this.recalibrate('manual');
    },

    autoRecal(reason, drift) {
      const p = performance.now();
      const recent = this.st.recentAuto = this.st.recentAuto.filter((t) => p - t < 30000);
      if (recent.length && p - recent[recent.length - 1] < 2500) return;
      recent.push(p);
      this.st.autoRecals++;
      this.logEvent('Auto-recalibrating: ' + reason + (drift != null ? ' ' + fmtMs(drift) : ''));
      if (recent.length === 4) {
        toast('Playback keeps falling behind. Close other programs on this PC.', 'bad');
        this.logEvent('Warning: repeated automatic recalibrations, the PC may be struggling to play this file');
      } else {
        toast('Recalibrated automatically', 'good');
      }
      this.recalibrate(reason);
    },

    /* ---- user actions ---------------------------------------------------- */

    locked() {
      if (this.mode === 'armed' && cfg.lockControls) { UI.lockedNudge(); return true; }
      return false;
    },

    userTogglePlay() {
      if (!Media.ready) return;
      // "You are late" is on screen: play means "join the film where it should be".
      if (this.mode !== 'armed' && Late.showing && Late.join('play')) return;
      if (this.mode === 'armed') {
        if (this.phase === 'blocked') { this.recover('click'); return; }
        if (this.phase === 'slipped') {
          if (this.st.slipHold) { if (video.paused) video.play().catch(() => {}); else video.pause(); } else this.recover('key');
          return;
        }
        if (this.locked()) return;
        if (this.phase === 'synced') { video.pause(); this.slip('pause'); return; }
        // While the film is being re-cued (a fraction of a second) the key is ignored, so a double tap
        // on Space does not undo the recalibration it just asked for.
        if (this.phase === 'standby') { this.slip('early'); video.play().catch(() => {}); }
        return;
      }
      if (video.paused) video.play().catch(() => {}); else video.pause();
    },

    userSeek(t) {
      if (!Media.ready) return;
      if (this.mode === 'armed') {
        if (this.locked()) return;
        if (this.phase !== 'slipped') this.slip('seek');
      }
      try { video.currentTime = clamp(t, 0, Math.max(0, video.duration - 0.05)); } catch (e) { /* not seekable yet */ }
    },

    /* ---- test runs --------------------------------------------------------- */

    /**
     * A rehearsal. `mode` (Snap test): the start time to try, 'auto', 'classic' or 'own'; the one set
     * in Setup if left out. kind 'night' is the New Year's Eve simulation: the app's clock is put on
     * December 31 (opts.at 'start': the minute before the movie starts; 'snap': 11:59:00 PM;
     * 'five': 11:55:00 PM) and everything runs exactly as on the night, with no test bar and no result.
     */
    startTest(kind, leadSec, mode, opts) {
      opts = opts || {};
      if (!Media.ready) { toast('Import the movie first'); return; }
      if (this.test) return;
      const wasArmed = this.mode === 'armed';
      if (wasArmed && this.phase !== 'standby') { toast('The real movie is playing: tests are off until it ends', 'bad'); return; }
      const realNow = Clock.real();
      const real = wasArmed ? this.session : this.computeFree();
      if (wasArmed && real.startEpoch - realNow < 180000) { toast('Too close to the real start time for a test', 'bad'); return; }

      const dur = video.duration;
      const startMode = ['auto', 'classic', 'own'].includes(mode) ? mode : cfg.startMode;
      // The real-time test needs no simulated clock: its target is a whole minute of the real clock,
      // at least `leadSec` away (a snap far off the target goes on the minute itself).
      let target = real.targetEpoch;
      if (kind === 'real') {
        const minute = (t) => Math.ceil(t / 60000) * 60000;
        const gapMs = Math.round(cfg.snapSec * 1000) - Math.round(startLead(startMode) * 1000);
        target = Math.abs(gapMs) <= 20000 ? minute(realNow + leadSec * 1000 + Math.max(0, -gapMs)) : minute(realNow + leadSec * 1000) - gapMs;
      }
      const s = this.sessionFor(target, startMode);
      const atTarget = (s.targetEpoch - s.startEpoch) / 1000;     // where the film is when the clock reaches the target
      let simNow;
      let eventEpoch;
      let endEpoch = null;
      let title;
      if (kind === 'night') {
        if (dur < atTarget + 2) { toast('This file is only ' + C.fmtDuration(dur) + ' long: with the start time set it would be over before ' + targetWord(s) + '.', 'bad'); return; }
        simNow = opts.at === 'start' ? Math.floor((s.startEpoch - 20000) / 60000) * 60000
          : opts.at === 'five' ? s.targetEpoch - 300000 : s.targetEpoch - 60000;
        eventEpoch = s.targetEpoch;
        endEpoch = s.targetEpoch + 180000;       // ends by itself three minutes after midnight
        title = 'New Year\'s Eve simulation';
      } else if (kind === 'start') {
        simNow = s.startEpoch - leadSec * 1000;
        eventEpoch = s.startEpoch;
        endEpoch = s.startEpoch + 9000;
        title = 'Auto-start test';
      } else if (kind === 'snap' || kind === 'real') {
        if (dur < cfg.snapSec + 2) { toast('This file ends before the snap point. Check the snap point in Setup.', 'bad'); return; }
        if (dur < atTarget + 2) { toast('This file is only ' + C.fmtDuration(dur) + ' long: with that start time it would be over before ' + targetWord(s) + '.', 'bad'); return; }
        // With a start time chosen by hand the snap comes before or after the target. Within 20 s of
        // it the test covers both moments; further away only the snap (an hour of film is no test).
        // The result is taken once the snap (and the target) have been on screen.
        const snapAt = this.snapEpoch(s);
        const both = Math.abs(snapAt - s.targetEpoch) <= 20000;
        const first = both ? Math.min(s.targetEpoch, snapAt) : snapAt;
        const last = both ? Math.max(s.targetEpoch, snapAt) : snapAt;
        const lead = Math.min(leadSec, Math.max(3, (first - s.startEpoch) / 1000 - 1));
        simNow = kind === 'real' ? realNow : first - lead * 1000;      // real time: nothing is simulated
        eventEpoch = last;
        endEpoch = last + (both ? Math.max(8000, Celebration.duration() + 1500) : 8000);
        title = kind === 'real'
          ? 'Real-time test · the snap at ' + C.fmtClockMs(snapAt, cfg.use24h) + (startMode === 'auto' ? '' : ' (start as ' + clockOf(s.startEpoch) + ')')
          : startMode === 'auto' ? 'Snap test' : 'Snap test · start at ' + clockOf(s.startEpoch);
      } else if (kind === 'late') {
        // Somebody who opens the app after the movie should have started. The clock is put that far
        // past the start time and nothing is armed: the real "You are late" box comes up, and
        // JOIN NOW does what it does on the night (joinTest). opts.by 'snap': a minute before the
        // target, so the snap is watched after the late join.
        if (opts.by === 'snap') {
          if (dur < atTarget + 2) { toast('This file is only ' + C.fmtDuration(dur) + ' long: with the start time set it would be over before ' + targetWord(s) + '.', 'bad'); return; }
          const snapAt = this.snapEpoch(s);
          simNow = Math.max(s.startEpoch + 5000, s.targetEpoch - 60000);
          eventEpoch = Math.abs(snapAt - s.targetEpoch) <= 20000 ? Math.max(s.targetEpoch, snapAt) : s.targetEpoch;
          endEpoch = eventEpoch + Math.max(8000, Celebration.duration() + 1500);
          title = 'Late start test · join a minute before ' + targetWord(s);
        } else {
          const by = clamp(Math.round(+opts.by || 300), 1, 12 * 3600);
          if (by > dur - 40) { toast('This file is only ' + C.fmtDuration(dur) + ' long: pick a shorter delay.', 'bad'); return; }
          simNow = s.startEpoch + by * 1000;
          // After New Year's midnight there is nothing left to join (see Late.position).
          if (isNewYearMoment(s.targetEpoch) && simNow > s.targetEpoch - 10000) { toast('With this start time that is already past ' + targetWord(s) + ': pick a shorter delay.', 'bad'); return; }
          eventEpoch = simNow;
          title = 'Late start test · ' + fmtLate(by) + ' late';
        }
      } else {
        const pos = clamp(Math.min(cfg.snapSec * 0.5, dur * 0.4), Math.min(20, dur * 0.2), Math.max(1, dur - 60));
        simNow = s.startEpoch + pos * 1000;
        eventEpoch = simNow + 6000;
        title = 'Slip and recovery drill';
      }

      this.token++;
      this.dropWaiter();
      SnapCam.close();
      if (kind === 'snap' || kind === 'real') SnapCam.watchTest(atTarget); else SnapCam.live = null;
      Clock.testOffsetMs = simNow - realNow;
      UI.prevNow = 0;                    // the clock jumped (maybe past the target): no celebration for that
      this.test = {
        kind: kind, title: title, t0: simNow, eventEpoch: eventEpoch, endEpoch: endEpoch, startMode: startMode, atTarget: atTarget, targetEpoch: s.targetEpoch,
        snapAt: kind === 'snap' || kind === 'real' ? this.snapEpoch(s) : null,
        quality0: null,                    // how smoothly the PC plays the film: measured once it is locked on
        wasArmed: wasArmed, prevSession: wasArmed ? real : null,
        eventDone: false, result: null, knockAt: 0, recoveredAt: 0, note: '',
        // The late test: its own session (nothing is armed until JOIN NOW), and "Not now" as it was before.
        session: s, watchSnap: kind === 'late' && opts.by === 'snap', joined: false, prevDismissed: Late.dismissedFor
      };
      this.session = s;
      if (kind === 'late') {
        // Nothing armed: the film stands still and the "You are late" box comes up, as on the night.
        Late.dismissedFor = 0;
        this.mode = 'free';
        if (Media.ready) { video.playbackRate = 1; if (!video.paused) video.pause(); }
        this.setPhase('idle');
        this.graph.length = 0;
        this.logEvent('Test run started: ' + title);
        UI.onMode();
        UI.onTest();
        return;
      }
      this.mode = 'armed';
      this.st.recals = 0; this.st.autoRecals = 0; this.st.slips = 0; this.st.recentAuto = [];
      this.graph.length = 0;
      this.logEvent('Test run started: ' + title);
      UI.onMode();
      UI.onTest();
      this.recalibrate('test');
    },

    tickTest(now) {
      const t = this.test;
      if (!t) return;
      // Smoothness is measured from a second after the film locked on: the frames a decoder drops
      // while it starts up after a jump say nothing about how the film plays.
      if (!t.quality0 && this.phase === 'synced' && performance.now() - this.st.syncedAt > 1000) t.quality0 = playbackQuality();
      // Never let a rehearsal run into the real thing.
      if (t.wasArmed && t.prevSession.startEpoch - Clock.real() < 60000) { this.endTest('The real start time is near'); return; }

      if (!t.eventDone && now >= t.eventEpoch && (t.kind !== 'slip' || (this.phase === 'synced' && this.st.drift != null))) {
        t.eventDone = true;
        t.eventAt = performance.now();
        if (t.kind === 'slip') {
          const back = Math.min(45, Math.max(5, video.currentTime * 0.5));
          t.knockAt = performance.now();
          this.slip('drill');
          try { video.currentTime = Math.max(0, video.currentTime - back); } catch (e) { /* ignore */ }
        }
      }

      if (t.kind === 'start' && t.eventDone && !t.result && this.mark && this.mark.firstDrift != null) {
        const d = this.mark.firstDrift;
        const ok = this.phase === 'synced' && Math.abs(d) <= 0.2;
        t.result = { ok: ok, title: 'Auto-start test', text: 'The movie started by itself ' + fmtOff(d) + (d > 0 ? ' early' : ' late') + ' and locked onto the clock.' };
      }
      if (t.kind === 'start' && t.eventDone && !t.result && performance.now() - t.eventAt > 6000) {
        t.result = { ok: false, title: 'Auto-start test', text: 'The movie did not start by itself. Phase: ' + this.phase + '.' };
      }
      if (t.kind === 'late') this.tickLate(t, now);
      if ((t.kind === 'snap' || t.kind === 'real') && t.eventDone && !t.result) {
        t.result = this.snapVerdict(t);
        // How smoothly this PC played the film during the test: a file it cannot play smoothly
        // would stutter and be re-synced on the night too.
        if (t.result) {
          const sm = smoothness(t.quality0, this.st.autoRecals);
          t.result.text += ' ' + sm.text;
          if (sm.lagged && t.result.ok !== false) { t.result.ok = false; t.result.strip = true; }
        }
      }
      if (t.kind === 'slip' && t.knockAt && !t.result && this.phase === 'synced' && this.st.drift != null && performance.now() - this.st.syncedAt > 1200) {
        const took = (this.st.syncedAt - t.knockAt) / 1000;
        t.result = { ok: Math.abs(this.st.drift) <= 0.1, title: 'Slip and recovery drill', text: 'Recovered ' + took.toFixed(1) + ' s after the slip, now ' + fmtMs(this.st.drift) + ' from the clock.' };
        t.endEpoch = now + 5000;
      }
      if (t.endEpoch != null && now >= t.endEpoch) this.endTest();
    },

    /**
     * At the snap (and the target): whether the film was on the clock, as a test result. Null until
     * it can be said. With a start time chosen by hand the snap is not on the target.
     */
    snapVerdict(t) {
      const d = this.st.drift;
      if (this.phase === 'synced' && d != null) {
        const late = Math.round((cfg.snapSec - t.atTarget) * 1000) / 1000;     // with this start, the snap comes this long after the target
        if (Math.abs(late) < 0.0005) {
          return { ok: Math.abs(d) <= 0.06, title: t.title, text: 'The snap frame hit ' + targetWord(this.session) + ' ' + (Math.abs(d) < 0.001 ? 'exactly' : fmtOff(d) + (d > 0 ? ' early' : ' late')) + '.' };
        }
        // The film ran on the clock; with this start time the snap is simply not on the target.
        const inStep = Math.abs(d) <= 0.06;
        const word = targetWord(this.session);
        return {
          ok: inStep ? null : false, strip: inStep, rehearsed: inStep, title: t.title,
          text: inStep
            ? 'With this start time the snap came ' + lateText(late) + ' ' + word + ' (the film itself ran on the clock, ' + fmtMs(d) + '). The automatic start, ' +
              clockOf(this.session.targetEpoch - Math.round(cfg.snapSec * 1000)) + ', puts it on ' + word + '.'
            : 'The film was not in step with the clock at ' + word + ' (' + fmtOff(d) + (d > 0 ? ' early' : ' late') + ').'
        };
      }
      if (performance.now() - t.eventAt > 2000) {
        return { ok: false, title: t.title, text: 'The film was not in sync at ' + (Math.abs(cfg.snapSec - t.atTarget) < 0.0005 ? targetWord(this.session) : 'the snap') + ' (' + this.phase + ').' };
      }
      return null;
    },

    /** The late test is waiting for JOIN NOW: nothing armed, the "You are late" box up. */
    lateWaiting() {
      return !!this.test && this.test.kind === 'late' && !this.test.joined;
    },

    /**
     * The late test: JOIN NOW was pressed. From here on it is the real late join, recalibrate('late'):
     * the film goes to where the clock says it should be and starts on the clock. Nothing is saved.
     */
    joinTest(by) {
      const t = this.test;
      if (!t || t.kind !== 'late' || t.joined) return;
      t.joined = true;
      t.joinedAt = performance.now();
      t.joinedClock = Clock.now();
      this.session = t.session;
      this.mode = 'armed';
      this.st.recals = 0; this.st.autoRecals = 0; this.st.slips = 0; this.st.recentAuto = [];
      this.logEvent('Late test: JOIN NOW (' + (by || 'button') + '), ' + fmtLate(Math.max(0, (t.joinedClock - t.session.startEpoch) / 1000)) + ' after the start');
      UI.onMode();
      UI.onTest();
      this.recalibrate('late');
    },

    /** The late test: how long joining took, and how close to the clock the film landed. */
    tickLate(t, now) {
      const p = performance.now();
      if (!t.joined) {
        this.session = t.session;       // nothing may move it while it waits (a time check, another snap point)
        if (t.watchSnap && now >= t.eventEpoch) this.endTest('JOIN NOW was not pressed before ' + targetWord(t.session) + '.');
        else if (Late.position(now) == null) this.endTest('At this point there is nothing left to join (the end of the file, or past ' + targetWord(t.session) + ').');
        else if (now - t.t0 > 5 * 60000) this.endTest('JOIN NOW was not pressed within five minutes.');
        return;
      }
      if (t.result) return;
      const m = this.mark;
      if (!t.lockedAt && this.phase === 'synced' && m && m.firstDrift != null) {
        t.lockedAt = p;
        t.startedClock = m.epoch;                             // the clock's instant the film started on its mark
        t.firstDrift = m.firstDrift;                          // the first measurement with the film running
        t.pos = m.pos;                                        // where the film was sent
        t.took = (this.st.syncedAt - t.joinedAt) / 1000;      // from JOIN NOW to play, pressed on the clock's mark
      }
      const how = () => {
        const f = t.firstDrift;
        return 'JOIN NOW at ' + clockOf(t.joinedClock) + ', ' + fmtLate(Math.max(0, (t.joinedClock - t.session.startEpoch) / 1000)) + ' after the start: the film jumped to ' +
          fmtFilm(t.pos) + ' and started ' + t.took.toFixed(1) + ' s later, ' + (Math.abs(f) < 0.001 ? 'right on the clock' : fmtOff(f) + (f > 0 ? ' ahead of' : ' behind') + ' the clock') + '.';
      };
      const resyncs = this.st.autoRecals ? ' (re-synced ' + this.st.autoRecals + ' time' + (this.st.autoRecals > 1 ? 's' : '') + ' on the way)' : '';
      if (t.watchSnap) {
        if (t.eventDone && t.lockedAt) {
          if (t.startedClock > t.eventEpoch) {
            t.result = { ok: false, title: t.title, text: how() + ' That was after ' + targetWord(t.session) + ': JOIN NOW came too late to see the snap.' };
          } else {
            const v = this.snapVerdict(t);
            if (v) t.result = Object.assign(v, { title: t.title, text: how() + ' ' + v.text.replace(/\.$/, resyncs + '.') });
          }
        }
      } else if (t.lockedAt && p - t.lockedAt > 3000 && this.phase === 'synced' && this.st.drift != null && p - this.st.syncedAt > 1000) {
        const d = this.st.drift;
        t.result = { ok: Math.abs(d) <= 0.06, title: t.title, text: how() + ' Three seconds on it was ' + fmtMs(d) + ' from the clock' + resyncs + '.' };
        t.endEpoch = now + 5000;
      }
      // A join that never gets the film onto the clock is a failure, not a test that runs for ever.
      if (!t.result && (t.lockedAt ? !t.watchSnap && p - t.lockedAt > 30000 : p - t.joinedAt > 20000)) {
        t.result = { ok: false, title: t.title, text: t.lockedAt ? how() + ' It did not stay on the clock (' + this.phase + ').' : 'After JOIN NOW the film did not lock onto the clock (' + this.phase + ').' };
        t.endEpoch = now + 3000;
      }
    },

    endTest(why) {
      const t = this.test;
      if (!t) return;
      this.token++;
      this.dropWaiter();
      Clock.testOffsetMs = 0;
      UI.prevNow = 0;                    // the clock jumped back: that is not the target going by
      this.test = null;
      if (t.kind === 'late') {
        // "Not now" is as it was before the test; the real clock decides whether anybody is late.
        Late.dismissedFor = t.prevDismissed;
        setHidden(el.late, true);
        setHidden(el.latePill, true);
      }
      Celebration.stop();
      UI.hideSlip();
      el.blocked.hidden = true;
      if (Media.ready) { video.playbackRate = 1; if (!video.paused) video.pause(); }
      const result = t.result || { ok: null, title: t.title, text: why || 'Ended before the result was in.' };
      if (t.kind === 'night') {
        // Nothing to grade: it was the night itself.
        toast('Simulation ended. The real countdown is as it was.');
      } else {
        // A rehearsal counts for the start time in use (a Snap test can try another one).
        if ((result.ok || result.rehearsed) && ((t.kind !== 'snap' && t.kind !== 'real') || Math.abs(t.atTarget - startLead()) < 0.0005)) { cfg.rehearsed[t.kind === 'real' ? 'snap' : t.kind] = true; save(); }
        UI.addTestResult(result);
      }
      // After a Snap test that was on the clock: the frames that were on screen around the target moment.
      if ((t.kind === 'snap' || t.kind === 'real') && t.result && (t.result.ok || t.result.strip)) setTimeout(() => SnapCam.afterTest(t), 600); else SnapCam.live = null;
      this.logEvent('Test run ended: ' + result.text);
      this.graph.length = 0;
      if (t.wasArmed) {
        this.session = this.sessionFor(t.prevSession.targetEpoch);
        this.mode = 'armed';
        UI.onMode();
        UI.onTest();
        this.recalibrate('arm');
      } else {
        this.mode = 'free';
        this.session = this.computeFree();
        this.setPhase('idle');
        UI.onMode();
        UI.onTest();
      }
    },

    /* ---- the 5 Hz heartbeat ------------------------------------------------ */

    tick() {
      const wall = Date.now();
      const perf = performance.now();
      const jump = this.st.lastWall ? (wall - this.st.lastWall) - (perf - this.st.lastPerf) : 0;
      if (Math.abs(jump) > 120) {
        // Windows stepped its clock, someone changed it, or the PC slept. Ask the time servers again
        // before touching the film: if only the PC clock moved, true time did not, and nothing has to jump.
        this.logEvent('The PC clock jumped by ' + fmtOff(jump / 1000) + ' (or the PC slept): re-checking the time');
        this.ctrl.reset();
        this.st.settleUntil = perf + 4000;
        NetTime.measure(false, true);
      }
      this.st.lastWall = wall;
      this.st.lastPerf = perf;
      Frames.watchdog();
      // The clock is in doubt until the time servers have answered (at most 4 s): decide nothing
      // on it. A badly wrong clock could otherwise make the film look finished and disarm it.
      if (perf < this.st.settleUntil) return;

      const now = Clock.now();
      SubSync.tick(perf);
      SnapCam.autoTick(perf);
      // Armed on disk but not in memory, with a movie loaded and nothing going on: that must never
      // last. Whatever let go of the film, the countdown takes it back.
      if (this.mode !== 'armed' && cfg.armed && Number.isFinite(cfg.armedTarget) && Media.ready && !Media.loading && !SnapCam.busy && !this.test && !Modal.isOpen) {
        this.strayMs = (this.strayMs || 0) + 200;
        if (this.strayMs >= 3000) {
          this.strayMs = 0;
          this.logEvent('The countdown was armed but not running: taking the film back');
          this.arm({ restore: true });
        }
      } else {
        this.strayMs = 0;
      }
      if (this.mode !== 'armed') {
        // The late test waits here for JOIN NOW, on its own session: nothing is armed.
        if (this.lateWaiting()) this.tickTest(now); else this.session = this.computeFree();
        this.trackAudio();
        AudioTracks.watch(perf);
        if (!this.test) Media.retryWhileArmed(perf);
        return;
      }
      this.pump();
      if (this.test) this.tickTest(now);
      if (this.mode !== 'armed') return;

      const v = video;
      switch (this.phase) {
        case 'synced':
          if (v.ended || this.expected(now) >= v.duration - 0.05) { this.finish(); break; }
          if (v.error) break;                       // the error handler is already reloading the movie
          if (v.paused) { this.slip('pause'); break; }
          this.control(now);
          break;
        case 'standby':
        case 'cueing':
          if (!v.paused && this.engineSeeks === 0) this.slip('early');
          break;
        case 'slipped': {
          const exp = this.expected(now);
          // The start must never be missed: just before it, recover no matter what.
          if (exp > -3 && exp < 0) { this.recover('start time'); break; }
          if (cfg.autoRecover && !this.st.slipHold && now >= this.st.slipClock + cfg.autoRecoverSec * 1000) this.recover('automatic');
          break;
        }
        default:
          break;
      }
      this.trackAudio();
      AudioTracks.watch(perf);
    },

    control(now) {
      const v = video;
      const p = performance.now();
      if (p - this.st.syncedAt < 300 || p < this.st.settleUntil) return;
      if (v.seeking || v.readyState < 3) {
        if (!this.st.stallAt) this.st.stallAt = p;
        else if (p - this.st.stallAt > 4000) { this.st.stallAt = 0; this.autoRecal('playback stalled'); }
        return;
      }
      this.st.stallAt = 0;
      if (p - this.st.lastFrameSample > 400) this.ctrl.push(p / 1000, v.currentTime - this.expected(now));
      // The final approach. For most of the film a few hundredths of a second either way are left
      // alone, so the speed is not nudged for nothing. From two minutes before the snap the film
      // is held to within a hundredth: closer than half a frame, so that the frame of the snap is
      // the one on screen as the clock gets there.
      const fine = this.nearMoment(now, 120000, 15000);
      this.ctrl.o.enter = fine ? 0.010 : 0.030;
      this.ctrl.o.exit = fine ? 0.003 : 0.008;
      const r = this.ctrl.decide(p / 1000);
      if (r.drift == null) return;
      this.st.drift = r.drift;
      this.graph.push({ t: p, d: r.drift });
      if (this.graph.length > 320) this.graph.splice(0, this.graph.length - 320);

      const m = this.mark;
      if (m && !m.learned) {
        m.learned = true;
        m.firstDrift = r.drift;
        // How long play() really took to get going; the next start presses play that much earlier.
        if (m.waited && Math.abs(r.drift) < 0.4) {
          cfg.learnedLatency = clamp(0.6 * cfg.learnedLatency + 0.4 * (m.latUsed - r.drift), 0, 0.3);
          save();
        }
        this.logEvent('Locked on: started ' + fmtOff(r.drift) + (r.drift > 0 ? ' early' : ' late'));
        if (m.reason === 'resume') Recovery.locked(m);
      }

      if (r.action === 'hard') { this.autoRecal('drift', r.drift); return; }
      if (Math.abs(v.playbackRate - r.rate) > 0.0005) v.playbackRate = r.rate;
      this.st.rate = r.rate;
    },

    /** Confirms that sound is really being decoded once the film has played for a moment. */
    trackAudio() {
      if (!Media.ready || Media.hasAudio != null || SnapCam.busy) return;
      if (video.paused || video.seeking || video.readyState < 3) return;
      Media.playedMs += 200;
      if (Media.playedMs < 1600) return;
      const a = detectAudio(true);
      if (a != null) Media.setAudio(a, a ? '' : 'No sound could be decoded from this file (the sound is probably Dolby or DTS).');
    }
  };

  /* ---- video events: anything the engine did not do itself is a slip ---- */

  video.addEventListener('pause', () => {
    // A decoder error also pauses the video: that is the error handler's business, not a slip.
    if (Engine.mode === 'armed' && Engine.phase === 'synced' && !video.ended && !video.error && Media.ready) {
      if (Engine.expected() >= video.duration - 0.3) Engine.finish(); else Engine.slip('pause');
    }
    UI.dirty.transport = true;
  });
  video.addEventListener('play', () => { UI.dirty.transport = true; });
  video.addEventListener('seeking', () => {
    if (Engine.mode === 'armed' && Engine.engineSeeks === 0 && (Engine.phase === 'synced' || Engine.phase === 'standby' || Engine.phase === 'cueing')) Engine.slip('seek');
  });
  video.addEventListener('ratechange', () => {
    // Only the engine may change the speed while armed.
    if (Engine.mode === 'armed' && Engine.phase === 'synced' && Math.abs(video.playbackRate - Engine.st.rate) > 0.001) video.playbackRate = Engine.st.rate;
  });
  video.addEventListener('volumechange', () => { UI.dirty.transport = true; UI.dirty.preflight = true; });
  video.addEventListener('error', () => {
    if (!Media.ready) return;
    Engine.logEvent('Video error: ' + (video.error ? video.error.message || video.error.code : 'unknown'));
    const nowP = performance.now();
    Media.errorTimes = (Media.errorTimes || []).filter((t) => nowP - t < 60000);
    Media.errorTimes.push(nowP);
    const info = Media.info;
    if (!info) return;
    // Never give up while a movie is loaded. A damaged stretch of the file fails again and again
    // while the clock is inside it, but the clock moves on: a later reload lands past the damage.
    const many = Media.errorTimes.length > 3;
    if (Media.errorTimes.length === 4) {
      toast('This part of the file is damaged. Playback resumes as soon as the clock is past it.', 'bad');
      Engine.logEvent('The file seems damaged here: retrying every 5 seconds until the clock is past it');
    } else if (!many) {
      toast('The video reported an error. Recovering…', 'bad');
    }
    setTimeout(() => { if (Media.info === info && !Media.loading) Media.load(info, { afterError: true }); }, many ? 5000 : 800);
  });

  // Frame-accurate drift samples: which film frame is on screen at which instant.
  const Frames = {
    supported: 'requestVideoFrameCallback' in HTMLVideoElement.prototype,
    gen: 0,
    lastAt: 0,
    /** (Re)starts the callback chain. Older chains notice the new generation and stop themselves. */
    start() {
      if (!this.supported) return;
      const g = ++this.gen;
      const cb = (nowPerf, meta) => {
        if (g !== this.gen) return;
        this.lastAt = nowPerf;
        const mt = meta.mediaTime;
        if (isFinite(Media.lastFrameTime)) {
          const dt = mt - Media.lastFrameTime;
          if (dt > 0.008 && dt < 0.12 && video.playbackRate === 1) Media.fps = Media.fps ? Media.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;
        }
        Media.lastFrameTime = mt;
        if (SnapCam.sink || SnapCam.live) { try { SnapCam.onFrame(nowPerf, meta); } catch (e) { /* a picture less in the strip */ } }
        if (Engine.mode === 'armed' && Engine.phase === 'synced' && !video.paused && !video.seeking) {
          Engine.ctrl.push(nowPerf / 1000, mt - Engine.expected(Clock.fromPerf(meta.expectedDisplayTime)));
          Engine.st.lastFrameSample = nowPerf;
        }
        video.requestVideoFrameCallback(cb);
      };
      video.requestVideoFrameCallback(cb);
    },
    /** If frames stopped arriving while the film plays (new file, GPU reset), start a fresh chain. */
    watchdog() {
      if (!this.supported || video.paused || !Media.ready) return;
      if (performance.now() - this.lastAt > 2000) { this.lastAt = performance.now(); this.start(); }
    }
  };
  Frames.start();

  /* =========================================================== late start === */

  /**
   * The movie should already be playing and nobody started the countdown: the app was opened
   * late, the PC crashed with nothing armed, somebody simply forgot. The app says so, and one
   * click joins the film at the place the clock says it should be. People who start the
   * countdown in advance never see any of this.
   */
  const Late = {
    dismissedFor: 0,           // the target moment for which "Not now" was pressed
    SOON_MS: 10 * 60000,       // how long before the start the "not armed" reminder appears

    /** Seconds into the film right now, or null when the film is not due to be playing. */
    position(now) {
      const s = Engine.session;
      if (!Media.ready || Engine.mode !== 'free' || (Engine.test && !Engine.lateWaiting()) || !s) return null;
      const t = now == null ? Clock.now() : now;
      if (t < s.startEpoch) return null;
      if (t >= s.targetEpoch && isNewYearMoment(s.targetEpoch)) return null;     // New Year has come: nothing left to join
      const pos = (t - s.startEpoch) / 1000;
      return pos < video.duration - 5 ? pos : null;
    },

    /** True while the "you are late" box is on screen. */
    get showing() { return !el.late.hidden; },

    join(by) {
      if (this.position() == null) return false;
      Engine.logEvent('Late: joining the movie where the clock says it should be (' + (by || 'button') + ')');
      if (Engine.lateWaiting()) Engine.joinTest(by); else Engine.arm({ late: true });
      return true;
    },

    dismiss() {
      if (Engine.session) this.dismissedFor = Engine.session.targetEpoch;
      setHidden(el.late, true);
    },

    render(now, newYear) {
      const s = Engine.session;
      // Once New Year's midnight has passed there is nothing left to join.
      if (s && newYear && now >= s.targetEpoch) { setHidden(el.late, true); setHidden(el.latePill, true); return; }
      const pos = this.position(now);
      const quiet = Modal.isOpen || !!SnapCam.view || SnapCam.busy || Media.checking || AudioFix.running;
      const dismissed = pos != null && this.dismissedFor === s.targetEpoch;
      const box = pos != null && !dismissed && !quiet;
      setHidden(el.late, !box);
      // The reminder before the start, and the way back to the box after "Not now".
      const toStart = s ? s.startEpoch - now : NaN;
      const soon = Media.ready && Engine.mode === 'free' && !Engine.test && toStart > 0 && toStart <= this.SOON_MS && !quiet;
      setHidden(el.latePill, !((pos != null && dismissed && !quiet) || soon));
      // (Every time on screen is counted on the clock's seconds, so it ticks with the clock.)
      const onClock = s ? Math.max(0, C.filmSecondOnClock(s, now)) : 0;
      if (soon) setText(el.latePill, 'NOT ARMED · the movie has to start in ' + startCountdown(s, now) + ' · click to start the countdown');
      else if (pos != null && dismissed) setText(el.latePill, 'LATE · the movie should be at ' + C.fmtDuration(onClock, { forceHours: true }) + ' · click to join');
      if (!box) return;
      const toSnap = s.targetEpoch - now;
      setText(el.lateTitle, toSnap > 0 ? 'You are late to the countdown' : 'The movie is already running');
      setText(el.lateBody, 'The movie had to start at ' + clockOf(s.startEpoch) + '. Right now it should be at ' + C.fmtDuration(onClock, { forceHours: true }) + '.');
      setText(el.lateSub, (toSnap > 0 ? (newYear ? 'New Year in ' : onTarget(s) ? 'The snap in ' : 'The target in ') + C.fmtCountdown(C.untilClockSecond(s.targetEpoch, now)) : (newYear ? 'Midnight was ' : onTarget(s) ? 'The snap was ' : 'The target was ') + C.fmtDuration(-toSnap / 1000) + ' ago') + ' · press Enter or Space');
    }
  };

  /* ========================================================= missed it === */

  /**
   * New Year's midnight came and the countdown was not running: "Better luck next year". Said
   * once, only when the countdown was not armed at midnight (never started, or late and never
   * joined), never in a rehearsal, and only in the first half hour of the new year. When the
   * countdown was done, nothing is said.
   */
  const Missed = {
    WINDOW_MS: 30 * 60000,

    tick(now, s) {
      if (!s || !isNewYearMoment(s.targetEpoch) || Engine.test || Clock.testOffsetMs) return;
      const t = s.targetEpoch;
      if (now < t || cfg.newYearSeen === t) return;
      if (cfg.armed || Engine.mode === 'armed' || now - t > this.WINDOW_MS) {   // done, or long past
        cfg.newYearSeen = t;
        save();
        return;
      }
      if (Modal.isOpen || SnapCam.busy || SnapCam.view) return;                 // after the dialog that is open
      cfg.newYearSeen = t;
      save();
      setHidden(el.late, true);
      Engine.logEvent('New Year came without the countdown: better luck next year');
      Modal.open({
        title: 'Better luck next year',
        html: 'Midnight is here, and the countdown was not running this time. Happy New Year ' + new Date(t).getFullYear() + '!' +
          '<br><br>Next December 31, import the movie early in the evening and press <b>Start the Countdown</b>: the app starts the film by itself and lands the snap on midnight.',
        actions: [{ label: 'OK', primary: true, onClick: () => Modal.close() }],
        onEscape: () => Modal.close()
      });
    }
  };

  /* ================================================ power cuts and batteries === */

  /**
   * The PC can go off with the countdown armed: a power cut, an empty laptop battery, the power
   * button held down, Windows shutting down or restarting. While armed, Windows opens the app again
   * at the next sign-in; it imports the movie again and the countdown picks up where the clock says,
   * however long the PC was off. The settings that say so are forced onto the disk on every save,
   * so a power cut cannot leave them half written. This says what happened, once, when the film is
   * back on the clock, and after the power cut test it gives that test's result.
   */
  const Recovery = {
    info: null,          // how the last run ended, from the main process (see readLastRun in main.js)
    claimed: null,       // that, taken by the restore now under way (see claim)
    said: false,
    reported: false,

    take(lr) {
      // (After a crash the watchdog's own message says so: see boot.)
      if (!lr || lr.ended === 'clean' || lr.ended === 'watchdog' || !cfg.armed) return;
      this.info = lr;
      const when = lr.lastAlive ? ' (last seen running at ' + C.fmtClock(new Date(lr.lastAlive + Clock.netOffsetMs), cfg.use24h) + ')' : '';
      Engine.logEvent((lr.ended === 'shutdown' ? 'Windows was shut down, restarted or signed out with the countdown armed'
        : lr.drill ? 'Power cut test: the app was cut off'
          : lr.ended === 'killed' ? 'The app was closed without warning while the PC kept running'
            : lr.ended === 'unknown' ? 'The app stopped without being closed'
              : 'The PC went off without warning (a power cut, an empty battery, the power button)') + when + ': picking up where the clock says');
    },

    /**
     * Taken by a restore in the first minute after the app started (the comeback itself; the movie
     * can be loaded twice as the app starts), until it has been said. A later restore (a reload
     * after a video error, the film taken back) must not report an old power cut as new.
     */
    claim() {
      this.claimed = !this.said && performance.now() < 60000 ? this.info : null;
      return this.claimed;
    },

    /** Why the app was gone, in a few words, for the messages below. */
    why(lr) {
      return lr.drill ? 'the power cut test' : lr.ended === 'shutdown' ? 'Windows was shut down, restarted or signed out'
        : lr.ended === 'killed' ? 'the app was closed without warning' : lr.ended === 'unknown' ? 'the app stopped' : 'the PC went off';
    },

    // (The main process wrote its times with the PC clock: spans are measured on that clock too,
    // and shown on the app's clock, which is the PC clock corrected by internet time.)
    cutAt(lr) { return clockOf(lr.drill.at + Clock.netOffsetMs); },
    startedLater(lr) {
      return Number.isFinite(lr.startedAt) ? fmtSpan((lr.startedAt - lr.drill.at) / 1000) + ' later' : 'later';
    },

    /** Back before the movie had to start: the countdown simply carries on. Said once. */
    stillArmed(s) {
      const lr = this.claimed;
      if (!lr || this.said) return;
      this.said = true;
      const text = 'Back after ' + this.why(lr) + ': the countdown is still armed and the movie starts at ' + clockOf(s.startEpoch) + '.';
      toast(text, 'good', 9000);
      Engine.logEvent(text);
      if (lr.drill && !this.reported) {
        // The power cut test before the start: what can be shown is that the countdown survived it.
        this.reported = true;
        const r = {
          ok: true, title: 'Power cut test',
          text: 'The app was cut off at ' + this.cutAt(lr) + ' with nothing saved on the way out, and started again ' + this.startedLater(lr) +
            ' the way Windows starts it when the PC is back on. The countdown came back armed: the movie still starts at ' + clockOf(s.startEpoch) +
            '. (Cut the power while the movie plays, well before the snap, to see the film put back on the clock.)'
        };
        UI.addTestResult(r);
        Engine.logEvent('Power cut test passed: ' + r.text);
      }
    },

    /** The armed countdown has just put the film back where the clock says (after a restart). */
    resumed(mark) {
      const pos = 'the movie is at ' + C.fmtDuration(Math.max(0, mark ? mark.pos : Engine.expected()), { forceHours: true }) + ', where the clock says';
      const lr = this.claimed;
      if (!lr || this.said) { toast('Back in the movie: ' + pos, 'good', 5000); return; }
      this.said = true;
      const raw = Date.now();
      const off = lr.lastAlive ? (raw - lr.lastAlive) / 1000 : null;
      const s = Engine.session;
      const now = Clock.now();
      const gone = lr.lastAlive ? lr.lastAlive + Clock.netOffsetMs : null;
      // Said only when the last sign of life was more than one heartbeat (15 s) before it: a cut
      // seconds after midnight has the film on midnight already.
      const missed = s && gone != null && gone + 15000 < s.targetEpoch && now >= s.targetEpoch ? ' ' + (isNewYearMoment(s.targetEpoch) ? 'Midnight' : 'The target moment') + ' came while it was off.' : '';
      // How long the PC was off: from the last sign of life to the PC starting again (not to now,
      // which also counts the start-up and the sign-in).
      const offFor = lr.lastAlive && Number.isFinite(lr.bootedAt) && lr.bootedAt > lr.lastAlive ? (lr.bootedAt - lr.lastAlive) / 1000 : null;
      let text;
      if (lr.drill) text = 'Power cut test: the app is back ' + fmtSpan((raw - lr.drill.at) / 1000) + ' after it was cut off, and ' + pos + '.';
      else if (lr.ended === 'shutdown') text = 'Back after Windows was shut down, restarted or signed out' + (off != null && off >= 60 ? ' (' + fmtLate(off) + ' ago)' : '') + ': ' + pos + '.' + missed;
      else if (lr.ended === 'killed') text = 'Back after the app was closed without warning: ' + pos + '.' + missed;
      else if (lr.ended === 'unknown') text = 'Back after the app stopped: ' + pos + '.';
      else text = 'Back after the PC went off' + (offFor != null && offFor >= 20 ? ' for about ' + fmtLate(offFor) : '') + ' (a power cut, an empty battery or the power button): ' + pos + '.' + missed;
      toast(text, 'good', 9000);
      Engine.logEvent(text);
    },

    /**
     * The first measurement after the restart. The power cut test is graded three seconds later,
     * like the late start test: the first sample of a decoder that was just started is noisy, and
     * what counts is that the film is held on the clock.
     */
    locked(m) {
      const lr = this.claimed;
      if (!lr || !lr.drill || this.reported) return;
      this.reported = true;
      const first = m.firstDrift;
      const pos = m.pos;
      const back = Date.now();
      setTimeout(() => {
        const d = Engine.st.drift;
        const held = Engine.mode === 'armed' && Engine.phase === 'synced' && d != null;
        const r = {
          ok: held && Math.abs(d) <= 0.06,
          title: 'Power cut test',
          text: 'The app was cut off at ' + this.cutAt(lr) + ' with nothing saved on the way out, and started again ' + this.startedLater(lr) +
            ' the way Windows starts it when the PC is back on. It imported the movie by itself and put it at ' + fmtFilm(pos) + ', ' +
            (Math.abs(first) < 0.001 ? 'right on the clock' : fmtOff(first) + (first > 0 ? ' ahead of' : ' behind') + ' the clock') +
            ': ' + fmtSpan((back - lr.drill.at) / 1000) + ' after the cut the film was running on the clock again' +
            (held ? '; three seconds on it was ' + fmtMs(d) + ' from the clock.' : ', but three seconds on it was not in sync (' + Engine.phase + ').')
        };
        UI.addTestResult(r);
        Engine.logEvent('Power cut test ' + (r.ok ? 'passed' : 'failed') + ': ' + r.text);
      }, 3000);
    }
  };

  /**
   * The battery. A three-hour film can empty a laptop battery: while the countdown is armed on a
   * battery the app says so, and again at 20, 10 and 5 percent. The PC waking up from sleep puts
   * the film straight back where the clock says (Engine.onWake).
   */
  const Power = {
    battery: null,           // the BatteryManager, where the browser has one
    mainOnBattery: null,     // what Windows says (the main process), where it can tell
    wasOn: false,
    warned: 101,             // the lowest level already warned about while unplugged (%)

    init() {
      try { native.onPower((p) => this.event(p && p.type)); } catch (e) { /* not in the browser build */ }
      try { native.powerState().then((st) => { this.mainOnBattery = !!(st && st.onBattery); this.check(); }).catch(() => {}); } catch (e) { /* no main process */ }
      try {
        if (navigator.getBattery) {
          navigator.getBattery().then((b) => {
            this.battery = b;
            b.addEventListener('chargingchange', () => this.check());
            b.addEventListener('levelchange', () => this.check());
            this.check();
          }).catch(() => {});
        }
      } catch (e) { /* no battery information */ }
    },

    /** Whether anything is known about the power at all. */
    get known() { return !!this.battery || this.mainOnBattery != null; },

    /** True while a laptop runs on its battery. */
    onBattery() {
      const b = this.battery;
      return (!!b && typeof b.charging === 'boolean' && !b.charging) || !!this.mainOnBattery;
    },

    /** The battery level in percent, or null when unknown. */
    percent() {
      const b = this.battery;
      return b && Number.isFinite(b.level) ? Math.round(b.level * 100) : null;
    },

    event(type) {
      if (type === 'resume') Engine.onWake();
      else if (type === 'suspend') { Engine.logEvent('The PC is going to sleep'); saveNow(); }
      else if (type === 'on-battery' || type === 'on-ac') { this.mainOnBattery = type === 'on-battery'; this.check(); }
    },

    unpluggedText(pct) {
      return 'The PC is running on its battery' + (pct != null ? ' (' + pct + '%)' : '') + ': plug it in for the film.' +
        (cfg.autoRestart === false
          ? ' If the battery runs out the film stops, and with “Come back by itself after a crash or a power cut” switched off in Setup the app stays closed.'
          : ' If the battery runs out, the app opens again when the PC is back on and you sign in, and picks up where the clock says.');
    },

    /** Said when the countdown is armed (or resumed) on a battery; not more than every ten minutes. */
    onArm() {
      if (!this.onBattery() || performance.now() - (this.armSaidAt || -1e9) < 600000) return;
      this.armSaidAt = performance.now();
      toast(this.unpluggedText(this.percent()), 'bad', 9000);
    },

    check() {
      const on = this.onBattery();
      const pct = this.percent();
      const armed = Engine.mode === 'armed' && !Engine.test;
      if (on !== this.wasOn) {
        this.wasOn = on;
        this.warned = 101;
        Engine.logEvent(on ? 'Running on the battery' + (pct != null ? ' (' + pct + '%)' : '') : 'Plugged in');
        if (armed) toast(on ? this.unpluggedText(pct) : 'Plugged in again', on ? 'bad' : 'good', on ? 9000 : 3300);
      }
      if (on && pct != null) {
        const step = [5, 10, 20].find((x) => pct <= x && x < this.warned);
        if (step) {
          this.warned = step;
          if (armed) { toast('Battery at ' + pct + '%: plug the PC in now', 'bad', 9000); Engine.logEvent('Battery at ' + pct + '%'); }
        }
      }
      UI.dirty.preflight = true;
    }
  };

  /* ========================================================= snap frames === */

  const fmtFilm = (sec) => C.fmtDuration(sec, { ms: true, forceHours: true });
  /** What the start time is now, in words, after the snap point moved. */
  const startNow = (s) => (cfg.startMode === 'auto'
    ? 'The movie now starts at ' + clockOf(s.startEpoch)
    : 'The movie still starts at ' + clockOf(s.startEpoch) + ', the time you chose: the snap lands ' + lateText(snapLate(s)) + ' ' + targetWord(s));

  /**
   * The film around the snap, one picture per frame.
   *
   * "2:30:30" is a round number: the frame on which the fingers snap is found by looking. After
   * a Snap test the strip shows what was really on screen around the target moment (collected
   * from the video as it played), and "Find the snap" plays that stretch of the film and shows
   * it frame by frame, pointing at the flash of the snap. One click on the right frame puts the
   * snap point on that frame's own time, to the millisecond.
   */
  const SnapCam = {
    busy: false,           // "Find the snap" is playing the film: the engine's watchers stand back
    cancelled: false,
    sink: null,            // receives every frame the video presents while a scan runs
    live: null,            // frames collected during a Snap test
    view: null,            // the open strip
    PRE: 2, POST: 4.5,     // seconds of film kept around the snap point during a Snap test

    size() {
      const w = 384;
      const h = Math.max(90, Math.round(w * (video.videoHeight || 9) / (video.videoWidth || 16) / 2) * 2);
      return [w, h];
    },

    /** A small copy of the frame that is on screen right now. */
    thumb() {
      const sz = this.size();
      const c = document.createElement('canvas');
      c.width = sz[0];
      c.height = sz[1];
      c.getContext('2d').drawImage(video, 0, 0, sz[0], sz[1]);
      return c;
    },

    /** Brightness of the middle of a picture, as C.findFlash wants it: { mean, white }. */
    stats(source) {
      if (!this.probe) {
        this.probe = document.createElement('canvas');
        this.probe.width = 48;
        this.probe.height = 27;
        this.probeCtx = this.probe.getContext('2d', { willReadFrequently: true });
      }
      try {
        this.probeCtx.drawImage(source, 0, 0, 48, 27);
        // The middle only: black bars above and below a wide picture must not count.
        const d = this.probeCtx.getImageData(5, 8, 38, 11).data;
        const n = d.length / 4;
        let sum = 0;
        let white = 0;
        for (let i = 0; i < d.length; i += 4) {
          const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          sum += y;
          if (y >= 0.84) white++;
        }
        return { mean: sum / n, white: white / n };
      } catch (e) {
        return { mean: 0, white: 0 };          // pixels cannot be read here: no suggestion, the strip still works
      }
    },

    /* ---- during a Snap test ---- */

    /** A Snap test starts: collect the frames that will be on screen around the target moment. */
    watchTest(atTarget) {
      if (!Frames.supported) { this.live = null; return; }
      let from = cfg.snapSec - this.PRE;
      let to = cfg.snapSec + this.POST;
      // A start time chosen by hand puts another frame on the target: keep that one too, when near.
      if (atTarget != null && Math.abs(atTarget - cfg.snapSec) <= 6) { from = Math.min(from, atTarget - 1); to = Math.max(to, atTarget + 1); }
      this.live = { from: from, to: to, frames: [], snapSec: cfg.snapSec };
    },

    /** Called for every frame the video presents. */
    onFrame(perf, meta) {
      if (this.sink) { this.sink(perf, meta); return; }
      const L = this.live;
      const T = Engine.test;
      if (!L || !T || (T.kind !== 'snap' && T.kind !== 'real')) return;
      const t = meta.mediaTime;
      if (!(t >= L.from && t <= L.to)) return;
      const list = L.frames;
      while (list.length && list[list.length - 1].t >= t) list.pop();     // a re-cue went back: that stretch is being shown again
      if (list.length >= 480) return;
      list.push({ t: t, shown: Clock.fromPerf(meta.expectedDisplayTime), thumb: this.thumb() });
    },

    /** The Snap test is over: show what was on screen around the target moment. */
    async afterTest(test) {
      const L = this.live;
      this.live = null;
      const usable = () => Media.ready && !Modal.isOpen && !Engine.test && !this.view && !this.busy;
      // "Did the snap land on 12:00:00?" is a question only when the start time put it there.
      const byHand = test.atTarget != null && Math.abs(test.atTarget - cfg.snapSec) >= 0.0005;
      const ask = () => { if (byHand) toast('The frames around the snap could not be collected. Run the test again.'); else UI.askSnapLanded(); };
      if (!L || L.frames.length < 6 || Math.abs(L.snapSec - cfg.snapSec) > 0.0005 || !usable()) { if (usable()) ask(); return; }
      let frames = L.frames;
      const token = Media.loadToken;
      if (Engine.mode === 'free') {
        // A frame the PC skipped while playing is fetched now, so the strip has no holes.
        this.busy = true;
        this.cancelled = false;
        try { frames = await this.fill(frames); } catch (e) { /* the strip opens with what there is */ }
        this.sink = null;
        this.busy = false;
        if (token !== Media.loadToken || !usable()) return;
      }
      frames.forEach((f) => { if (f.mean == null) Object.assign(f, this.stats(f.thumb)); });
      const target = test.targetEpoch != null ? test.targetEpoch : test.eventEpoch;
      let clock = -1;
      if (frames.some((f) => f.shown != null && f.shown > target)) {
        for (let i = 0; i < frames.length; i++) if (frames[i].shown != null && frames[i].shown <= target) clock = i;
      }
      this.open({ mode: 'test', frames: frames, clock: clock, target: target, atTarget: test.atTarget });
      // The frame the snap point stands on must be among them, or there is nothing to judge.
      if (this.view && this.view.now < 0) {
        const byHand = this.view.byHand;
        this.close();
        if (byHand) toast('The snap point was not among the frames that played. Run the test again.'); else UI.askSnapLanded();
      }
    },

    /* ---- "Find the snap" ---- */

    /**
     * The line "And I... am... Iron Man." in film time, and whether it is a witness:
     *   1. a subtitle file the app has checked against the voices            (checked)
     *   2. the subtitles inside the movie, every text track in turn, English first  (checked)
     *   3. a subtitle file nobody has checked: only a hint where else to look   (not checked)
     * Only a line that ends between 4 minutes before and 6 minutes after the snap point counts:
     * the words are said elsewhere too. Returns { start, end, text, from, checked } or null.
     */
    async line() {
      const snap = cfg.snapSec;
      const span = { before: 240, after: 360 };
      const notes = [];
      // A subtitle file is moved and stretched to fit the film: film time = line time * speed + shift.
      const fromFile = (checked) => {
        if (!SubsUI.loaded || SubsUI.own) return null;
        const scale = cfg.subScale;
        const hit = C.findSnapLine(SubsUI.cues, (snap - cfg.subDelay) / scale, { before: span.before / scale, after: span.after / scale });
        const end = hit ? hit.end * scale + cfg.subDelay : 0;
        notes.push('the subtitle file ' + SubsUI.name + (checked ? ' (in step with the voices)' : ' (not checked against the film)') + ': ' + (hit ? 'the line ends at ' + fmtFilm(end) : 'no such line near the snap'));
        return hit ? { start: hit.start * scale + cfg.subDelay, end: end, text: hit.text, from: checked ? 'the subtitles' : 'the subtitles, not checked against the film', checked: checked } : null;
      };
      let hit = null;
      if (SubSync.trusted()) hit = fromFile(true);
      if (!hit) hit = await this.lineInside(snap, span, notes);
      const st = SubSync.state();
      if (!hit && SubsUI.loaded && !SubsUI.own && !SubSync.trusted() && st !== 'mixed' && st !== 'unsure') hit = fromFile(false);
      Engine.logEvent('The line before the snap: ' + (notes.length ? notes.join('; ') : 'no subtitles to read'));
      return hit;
    },

    /** The line, read out of the movie's own text subtitles: English first, at most four tracks. */
    async lineInside(snap, span, notes) {
      if (!SubsCore || !Media.info || !Media.info.path || !native.isNative) return null;
      // What is inside the file is known once FFmpeg has looked: right after an import that may
      // still be under way, and the subtitles inside are the best witness there is.
      if (!Media.probe) await Media.reprobe();
      const tracks = ((Media.probe && Media.probe.subtitles) || []).filter((x) => x.isText);
      if (!tracks.length) { notes.push(Media.probe ? 'no text subtitles inside the movie' : 'the subtitles inside the movie cannot be read (no FFmpeg)'); return null; }
      const plain = (x) => !x.forced && !/forced|sign|song|commentary/i.test(x.title || '');
      const order = (x) => { const l = C.trackLang(x); return l === 'eng' && plain(x) ? 0 : !l && plain(x) ? 1 : l === 'eng' ? 2 : 3; };
      const list = tracks.slice().sort((a, b) => order(a) - order(b) || a.index - b.index).slice(0, 4);
      for (const t of list) {
        if ((this.busy && this.cancelled) || !Media.ready) return null;          // the search was called off
        const name = 'subtitle track ' + (t.index + 1) + (C.trackLang(t) ? ' (' + C.trackLang(t) + ')' : '') + ' inside the movie';
        try {
          const r = await native.ffSubWindow(Media.info.path, Math.max(0, snap - span.before), span.before + span.after, '', t.index);
          if (!r || r.error || !r.srt) { notes.push(name + ': ' + ((r && r.error) || 'nothing read')); continue; }
          const cues = SubsCore.parse(r.srt, 'window.srt').cues || [];
          const hit = C.findSnapLine(cues, snap, span);
          notes.push(name + ': ' + cues.length + ' lines read, ' + (hit ? 'the line ends at ' + fmtFilm(hit.end) : 'not the line'));
          if (hit) return { start: hit.start, end: hit.end, text: hit.text, from: 'the subtitles inside the movie', checked: true };
        } catch (e) { notes.push(name + ': could not be read'); }
      }
      return null;
    },

    /**
     * Plays the film from `from` to `to` without sound and returns what was presented:
     * [{ t, mean, white, thumb? }]. Thumbnails are kept only when `keep` is set.
     */
    async capture(from, to, rate, keep, progress) {
      const dur = video.duration;
      from = clamp(from, 0, Math.max(0, dur - 0.6));
      to = clamp(to, from + 0.4, dur - 0.05);
      const out = [];
      if (!video.paused) video.pause();
      video.muted = true;
      await Engine.seek(from);
      if (this.cancelled || !Media.ready) return out;
      video.playbackRate = rate;
      this.sink = (perf, meta) => {
        const t = meta.mediaTime;
        if (t < from - 0.001 || t > to + 0.001) return;
        if (out.length && t <= out[out.length - 1].t) return;
        const f = { t: t };
        if (keep) { f.thumb = this.thumb(); Object.assign(f, this.stats(f.thumb)); } else Object.assign(f, this.stats(video));
        out.push(f);
      };
      const deadline = performance.now() + ((to - from) / rate) * 3000 + 10000;
      try {
        await video.play();
        while (!this.cancelled && Media.ready && !video.ended && video.currentTime < to && performance.now() < deadline) {
          if (progress) progress(clamp((video.currentTime - from) / (to - from), 0, 1));
          await sleep(60);
        }
      } catch (e) { /* cannot play: whatever was collected is returned */ }
      this.sink = null;
      if (!video.paused) video.pause();
      video.playbackRate = 1;
      return out;
    },

    /**
     * The frame at `time`, fetched by going there (paused): { t, thumb, mean, white }, or null.
     * Only a frame within `tol` seconds of `time` is taken: the one on screen before the jump
     * must not be mistaken for it.
     */
    grabAt(time, tol) {
      const near = tol > 0 ? tol : 0.6;
      return new Promise((res) => {
        let done = false;
        const finish = (f) => { if (done) return; done = true; this.sink = null; clearTimeout(to); res(f); };
        const to = setTimeout(() => finish(null), 4000);
        this.sink = (perf, meta) => {
          if (Math.abs(meta.mediaTime - time) > near) return;
          const f = { t: meta.mediaTime, thumb: this.thumb() };
          Object.assign(f, this.stats(f.thumb));
          finish(f);
        };
        try { video.currentTime = time; } catch (e) { finish(null); }
      });
    },

    /**
     * Playing a stretch shows nearly every frame, but a busy PC can skip one, and the one skipped
     * must not be the snap. Missing frames are fetched one by one: first those around each flash
     * (its climb and the start of the white), then the others if there are few. At most 24.
     */
    async fill(frames) {
      if (frames.length < 3 || !Media.ready || Engine.mode !== 'free' || Engine.test) return frames;
      const gaps = [];
      for (let i = 1; i < frames.length; i++) gaps.push(frames[i].t - frames[i - 1].t);
      const dt = C.median(gaps);
      if (!(dt > 0.004)) return frames;
      const missing = [];
      for (let i = 1; i < frames.length; i++) {
        const n = Math.round((frames[i].t - frames[i - 1].t) / dt) - 1;
        for (let k = 1; k <= n && missing.length < 5000; k++) missing.push(frames[i - 1].t + k * dt);
      }
      if (!missing.length) return frames;
      const flash = C.findFlash(frames, {});
      const spots = flash ? flash.runs.map((r) => [frames[r.rise].t - 1.2, frames[r.start].t + 0.25]) : [];
      const inSpot = (t) => spots.some((w) => t >= w[0] && t <= w[1]);
      const first = missing.filter(inSpot);
      const list = (missing.length <= 24 ? missing : first).slice(0, 24);
      if (!list.length) return frames;
      if (!video.paused) video.pause();
      for (const t of list) {
        if (this.cancelled || !Media.ready) break;
        const f = await this.grabAt(t + dt / 2, dt * 0.75);
        if (f && !frames.some((x) => Math.abs(x.t - f.t) < dt / 4)) frames.push(f);
      }
      frames.sort((x, y) => x.t - y.t);
      return frames;
    },

    /**
     * A movie was imported: when nothing is in the way, look for its snap. Called 5 times a second.
     * Only a file that is a cut of the film and has never been searched or set is looked at; a
     * countdown that is armed lends the film only when the user has just imported the movie and
     * the start is more than ten minutes away.
     */
    autoTick(perf) {
      if (!this.autoFor) return;
      if (this.autoFor !== Media.loadToken || !Media.ready || !Frames.supported || !Versions.guess) { this.autoFor = 0; return; }
      if (snapConfirmed() || SnapMemory.get(Media.info)) { this.autoFor = 0; return; }     // this file has its answer, or was searched
      // Wait while something else has the floor: a dialog (the sound fix), the sound check, a test.
      if (this.busy || this.view || Modal.isOpen || AudioFix.running || Media.checking || !Media.inspected || Media.loading || Engine.test) return;
      if (SubSync.wanted() || SubsUI.loading) return;   // the subtitles are being read or put on the voices: their line is a witness
      if (el.app.dataset.view !== 'player' || video.seeking || perf - (this.autoSince || 0) < 1500) return;
      if (Engine.mode === 'armed') {
        if (!Media.byUser || Engine.phase !== 'standby' || Engine.session.startEpoch - Clock.now() < 10 * 60000) { this.autoFor = 0; return; }
      } else if (Late.position() != null || !video.paused) {
        this.autoFor = 0;                      // the film should be running, or somebody is watching: hands off
        return;
      }
      this.autoFor = 0;
      this.find({ auto: true });
    },

    /**
     * Puts what an automatic search saw to use (C.judgeSnap says what it is worth):
     *   found     the snap point goes on the frame and is marked as found
     *   likely    it goes on the frame, not marked: the film strip asks
     *   estimate  it goes a moment after the line, not marked: the film strip asks
     *   ask       nothing changes
     * Returns { how, verdict, old, after } or null.
     */
    decide(v, line) {
      const old = cfg.snapSec;
      if (v.verdict === 'found' || v.verdict === 'likely') {
        const next = Math.round((v.at + 0.001) * 1000) / 1000;
        const how = v.verdict === 'found' ? v.why : 'flash?';
        applySnap(next, { confirmed: v.verdict === 'found', how: how, quiet: true });
        if (Math.abs(cfg.snapSec - next) > 0.0005) return null;
        Engine.logEvent((v.verdict === 'found' ? 'Snap found by the app at ' : 'Snap probably at ') + fmtFilm(next) + ' (it was ' + fmtFilm(old) + '): the flash' +
          (v.after != null ? ', ' + Math.abs(v.after).toFixed(2) + ' s ' + (v.after >= 0 ? 'after' : 'before') + ' the line ends at ' + fmtFilm(line.end)
            : (v.verdict === 'found' ? ', with ' : ', far from where it was expected and with ') + (line ? 'no subtitles known to be in step with the film' : 'no subtitles') + ' to check it against' + (v.verdict === 'found' ? '' : ': to be checked')));
        return { how: how, verdict: v.verdict, old: old, after: v.after };
      }
      if (v.verdict === 'estimate' && v.at < video.duration - 2) {
        const next = Math.round(v.at * 1000) / 1000;
        applySnap(next, { confirmed: false, how: 'estimate', quiet: true });
        if (Math.abs(cfg.snapSec - next) > 0.0005) return null;
        Engine.logEvent('Snap point estimated from the subtitles: ' + fmtFilm(next) + ' (the line ends at ' + fmtFilm(line.end) + ', no flash was found)');
        return { how: 'estimate', verdict: 'estimate', old: old, after: null };
      }
      Engine.logEvent('The app looked for the snap and left the snap point as it was: ' + this.whyText(v, line));
      return null;
    },

    /** Why a search did not settle the snap, in words. */
    whyText(v, line) {
      const f = v && v.flash;
      switch (v && v.why) {
        case 'disagree': return 'the screen turns white at ' + fmtFilm(v.at) + ', which is not right after the line “…Iron Man.”' + (line ? ' (it ends at ' + fmtFilm(line.end) + ')' : '') + ': it may be another flash';
        case 'crowd': case 'rivals': return 'there is more than one flash in sight (white, or bright but not white), and nothing says which one is the snap';
        case 'unclear': return 'a brighter moment comes just before the cut to white, and either could be the snap';
        case 'burst': return 'the flash flickers: a white flash comes just before it, and either could be the snap';
        case 'edge': return 'the frames looked at do not cover the whole moment after the line';
        case 'hint': return 'a subtitle file that has not been checked against the film puts the line ' + (line ? Math.abs(v.at - line.end).toFixed(1) + ' s' : 'well') + ' away from this flash';
        case 'holes': return 'the PC skipped frames right where the flash begins, so its first frame is not known exactly';
        case 'open': return 'the flash begins before the first frame that was looked at';
        case 'fuzzy': return 'the flash begins so softly that its first frame is not clear-cut';
        case 'short': return 'the white-out lasts only ' + (f ? f.duration.toFixed(2) : '?') + ' s, too short to be sure it is the snap';
        case 'bright': return 'the screen turns bright, but not white';
        case 'armed': return 'the countdown is armed, and the app changes it only for a sure find';
        default: return 'no flash was found' + (line ? '' : ', and there are no subtitles to go by');
      }
    },

    /**
     * Looks for the snap in the film.
     *   by hand (the buttons): the strip opens on what was found; nothing changes until the user
     *     presses the button on a frame.
     *   opts.auto (after an import): what was found is put to use as far as it can be trusted
     *     (see decide) and the countdown is calibrated to it; the strip then shows the frames.
     *
     * Where it looks: every frame from 3 s before to 7 s after where the snap is expected (or,
     * when subtitles that are in step with the film put the line elsewhere, after the line first),
     * then, if that did not settle it, a quick sweep of 150 s and a closer look at the white-out
     * it shows. An unchecked subtitle file adds a second place to look, never a witness.
     */
    async find(opts) {
      opts = opts || {};
      if (this.busy || this.view || Modal.isOpen) return;
      if (!Media.ready) { toast('Import the movie first'); return; }
      if (Engine.test) { toast('End the test run first'); return; }
      if (Engine.mode !== 'free' && !(opts.auto && Engine.phase === 'standby')) { toast('Stop the countdown to look for the snap'); return; }
      if (!Frames.supported) { if (!opts.auto) UI.openSnapFinder(); return; }
      if (Media.checking) { toast('One moment: the sound is still being checked'); return; }
      this.busy = true;
      this.cancelled = false;
      // An armed countdown that is still waiting for the start lends the film for the search.
      const lent = Engine.mode !== 'free';
      if (lent) Engine.lend();
      const token = Media.loadToken;
      const snap = cfg.snapSec;
      const dur = video.duration;
      const stop = () => { this.cancelled = true; };
      Modal.open({
        title: opts.auto ? 'Finding the snap in this film' : 'Looking for the snap',
        html: (opts.auto ? 'Every copy of the film is timed a little differently, so the app finds the snap in yours and ' + (cfg.startMode === 'auto' ? 'sets the countdown by it. ' : 'shows where it lands with the start time you chose. ') : '') +
          'The app is playing the part of the film around the snap, without sound, and looking at every frame. This takes a few seconds' + (opts.auto ? ', once per file.' : '.') +
          (lent ? ' The countdown stays armed.' : ''),
        progress: true, note: 'Starting…',
        actions: [{ label: opts.auto ? 'Skip' : 'Cancel', onClick: stop }],
        onEscape: stop
      });
      let line = null;
      let best = null;                   // { frames, verdict, wide }: the most telling look
      let doubt = null;                  // the first look that saw a reason to doubt
      let applied = null;
      try {
        Modal.progress(0, 'Reading the subtitles around the snap…');
        line = await this.line();
        if (this.cancelled || !Media.ready) throw new Error('cancelled');
        const lineAt = line ? line.end + 0.1 : null;
        const centres = [];
        if (line && line.checked && Math.abs(lineAt - snap) > 1.5) centres.push(lineAt, snap);
        else centres.push(snap);
        // (An unchecked line is a second place to look only where the wide search around the first
        // does not reach.)
        if (line && !line.checked && (lineAt < snap - 40 || lineAt > snap + 100)) centres.push(lineAt);
        const rank = (v) => ({ found: 4, likely: 3, estimate: 2 }[v.verdict] || (v.flash ? 1 : 0));
        // A look that saw a reason to doubt (two flashes, a flash away from the line, ...) is not
        // overruled by a later look that happened to see less.
        const DOUBT = ['crowd', 'rivals', 'disagree', 'burst', 'unclear', 'hint'];
        const consider = (frames, wide, rivals) => {
          if (frames.length < 6) return null;
          const v = C.judgeSnap(frames, line, { expect: snap, wide: wide, lent: lent, rivals: rivals || 0 });
          if (!best || rank(v) > rank(best.verdict)) best = { frames: frames, verdict: v, wide: wide };
          if (!doubt && DOUBT.includes(v.why)) doubt = { frames: frames, verdict: v, wide: wide };
          return v;
        };
        const steps = centres.length * 3;
        let step = 0;
        const progress = (text) => (f) => Modal.progress(clamp((step + f) / steps, 0, 1), text);
        const swept = [];
        const settled = () => !!best && (best.verdict.verdict === 'found' || best.verdict.verdict === 'likely');
        for (const c of centres) {
          if (settled()) break;
          // 1. Every frame, from 3 s before to 7 s after.
          let near = await this.capture(c - 3, c + 7, 1, true, progress('Looking near ' + C.fmtDuration(c, { forceHours: true }) + '…'));
          step++;
          if (this.cancelled || !Media.ready) break;
          near = await this.fill(near);
          const v = consider(near, false);
          // A flash with no subtitles to back it up is only found if the wide search sees no
          // other white-out that could be the snap.
          const alone = !!v && v.verdict === 'found' && !(line && line.checked);
          if (settled() && !alone) break;
          // 2. Not settled there (or to make sure): sweep a wide stretch quickly (brightness only),
          //    then take the white-out it shows frame by frame.
          // A copy longer (or shorter) than the 2019 film may have the difference before the snap:
          // the sweep reaches that much further, up to five minutes either way.
          const extra = Versions.guess && isFinite(dur) ? dur - C.REFERENCE_SEC : 0;
          const a = Math.max(0, c - clamp(Math.max(45, 30 - extra), 45, 300));
          const b = Math.min(dur - 0.5, c + clamp(Math.max(105, extra + 30), 105, 300));
          if (swept.some((w) => a >= w[0] - 5 && b <= w[1] + 5)) { step += 2; continue; }
          swept.push([a, b]);
          const sweep = await this.capture(a, b, 5, false, progress('Searching from ' + C.fmtDuration(a, { forceHours: true }) + ' to ' + C.fmtDuration(b, { forceHours: true }) + '…'));
          step++;
          if (this.cancelled || !Media.ready) break;
          const seen = C.findFlash(sweep, { expect: line && line.checked ? lineAt : snap, after: line && line.checked ? line.end : undefined, minDur: 0.2 });
          if (alone) {
            const others = seen ? seen.runs.filter((r) => r.kind === 'white' && r.duration >= 0.3 && Math.abs(sweep[r.start].t - v.at) > 3.5).length : 0;
            if (others && !doubt) doubt = { frames: near, verdict: Object.assign({}, v, { verdict: 'ask', why: 'rivals' }), wide: false };
            step++;
            break;
          }
          if (seen && seen.kind === 'white') {
            const t = sweep[seen.start].t;
            let closer = await this.capture(t - 3.5, t + 3.5, 1, true, progress('Found a white-out at ' + C.fmtDuration(t, { forceHours: true }) + '. Taking it frame by frame…'));
            if (this.cancelled || !Media.ready) break;
            closer = await this.fill(closer);
            // Other white-outs of the sweep, long enough to be taken for the snap too.
            const others = seen.runs.filter((r) => r.kind === 'white' && r.start !== seen.start && r.duration >= 0.3 && Math.abs(sweep[r.start].t - t) > 3.5).length;
            consider(closer, true, others);
          }
          step++;
        }
      } catch (e) {
        if (!this.cancelled) Engine.logEvent('Looking for the snap failed: ' + (e && e.message));
      }
      // A doubt stands: nothing is set by the app, and the strip shows the look that raised it.
      if (doubt && best && (best.verdict.verdict === 'found' || best.verdict.verdict === 'likely' || best.verdict.verdict === 'estimate')) best = doubt;
      this.sink = null;
      this.busy = false;
      const mine = Media.ready && token === Media.loadToken;
      if (mine) {
        video.playbackRate = 1;
        if (!video.paused) video.pause();
        applyVolume();                         // the user's own mute and volume come back
      }
      Modal.close();
      const usable = mine && !this.cancelled && Engine.mode === 'free' && !!best;
      try {
        if (usable && opts.auto) {
          applied = this.decide(best.verdict, line);
          SnapMemory.put({ searched: true });    // found or not: this file has been looked at
        }
      } finally {
        // The countdown takes the film back, whatever happened above.
        if (lent && mine && cfg.armed && Engine.mode === 'free') Engine.arm({ restore: true });
      }
      if (best && mine) this.lastSeen = { frames: best.frames.map((f) => ({ t: f.t, mean: f.mean, white: f.white })), verdict: best.verdict, line: line };
      if (!mine || this.cancelled) return;
      if (!best) {
        if (!opts.auto) { toast('That part of the film could not be played. Use the frame buttons in Setup.', 'bad'); UI.openSnapFinder(); }
        return;
      }
      this.open({ mode: 'find', frames: best.frames, line: line, wide: best.wide, verdict: best.verdict, applied: applied, auto: !!opts.auto });
    },

    /* ---- the strip ---- */

    open(v) {
      this.close();
      const frames = v.frames;
      const gaps = [];
      for (let i = 1; i < frames.length; i++) gaps.push(frames[i].t - frames[i - 1].t);
      v.dt = clamp(C.median(gaps) || 1 / 24, 0.008, 0.25);
      v.now = -1;
      for (let i = 0; i < frames.length; i++) {
        const end = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + v.dt;
        if (cfg.snapSec >= frames[i].t - 1e-4 && cfg.snapSec < end - 1e-4) { v.now = i; break; }
      }
      if (v.clock == null) v.clock = -1;
      v.flash = v.verdict ? v.verdict.flash : C.findFlash(frames, { expect: cfg.snapSec });
      v.readOnly = Engine.mode !== 'free' || !!Engine.test;       // an armed countdown: look, do not touch
      v.ref = v.now;                                              // the frame the snap point stands on
      // After a test: how far from the target moment that frame really came on screen (ms, + is late).
      v.offMs = v.mode === 'test' && v.now >= 0 && frames[v.now].shown != null ? frames[v.now].shown - v.target : null;
      // A test with a start time chosen by hand: the frame put on the target is not the snap.
      v.byHand = v.mode === 'test' && v.atTarget != null && Math.abs(v.atTarget - cfg.snapSec) >= 0.0005;
      if (v.byHand && v.offMs == null && v.now >= 0) v.offMs = Math.round((cfg.snapSec - v.atTarget) * 1000);     // not measured: by the arithmetic
      v.atIdx = -1;
      if (v.byHand) {
        for (let i = 0; i < frames.length; i++) {
          const end = i + 1 < frames.length ? frames[i + 1].t : frames[i].t + v.dt;
          if (v.atTarget >= frames[i].t - 1e-4 && v.atTarget < end - 1e-4) { v.atIdx = i; break; }
        }
      }
      // What the clock will read at the moment the snap has to land on ("12:00:00").
      const aim = v.target || (Engine.session ? Engine.session.targetEpoch : 0);
      const clockText = aim ? C.clockParts(new Date(aim), cfg.use24h).hms : 'the target moment';
      v.clockText = clockText;
      this.view = v;

      el.stripRow.textContent = '';
      frames.forEach((f, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sf';
        b.setAttribute('role', 'option');
        const tags = [];
        if (v.byHand) {
          if (i === v.atIdx) { tags.push(['clock', clockText]); b.classList.add('has-clock'); }
          if (i === v.now) tags.push(['now', 'SNAP POINT']);
        } else {
          if (i === v.now && v.mode === 'test') { tags.push(['clock', clockText]); b.classList.add('has-clock'); }
          if (i === v.now && v.mode !== 'test') tags.push(['now', 'SET NOW']);
        }
        if (v.flash && i === v.flash.rise) { tags.push(['pick', 'SNAP?']); b.classList.add('has-pick'); }
        if (v.flash && i === v.flash.start && v.flash.start !== v.flash.rise) tags.push(['flash', v.flash.kind === 'white' ? 'WHITE' : 'BRIGHT']);
        tags.forEach((t) => { const tag = document.createElement('i'); tag.className = t[0]; tag.textContent = t[1]; b.appendChild(tag); });
        b.appendChild(f.thumb);
        const label = document.createElement('span');
        label.textContent = fmtFilm(f.t).slice(-6);
        b.appendChild(label);
        b.addEventListener('click', () => this.select(i));
        el.stripRow.appendChild(b);
      });

      const flashAt = v.flash ? frames[v.flash.rise].t : null;
      const landed = !!v.flash && v.flash.rise === v.now;
      const arrived = v.offMs == null ? 'at about the time the clock got there' : Math.abs(v.offMs) < 0.5 ? 'exactly as the clock got there' : Math.round(Math.abs(v.offMs)) + ' ms ' + (v.offMs > 0 ? 'after' : 'before') + ' the clock got there';
      v.arrived = arrived;
      let title;
      let note;
      if (v.byHand) {
        const startAt = clockOf(v.target - Math.round(v.atTarget * 1000));
        const autoAt = clockOf(v.target - Math.round(cfg.snapSec * 1000));
        title = v.offMs == null ? 'Where the snap lands with this start time' : 'The snap came ' + lateText(Math.round(v.offMs) / 1000) + ' ' + clockText;
        note = 'This test started the movie at ' + startAt + '. At ' + clockText + ' the film was at ' + fmtFilm(v.atTarget) +
          (v.atIdx >= 0 ? ', the frame marked ' + clockText : '') + '. The snap point of this file, ' + fmtFilm(cfg.snapSec) + ' (marked SNAP POINT), came on screen ' + arrived + '. ' +
          'The automatic start, ' + autoAt + ', puts it on ' + clockText + '. ' +
          (v.flash && v.now >= 0 ? (v.flash.rise === v.now ? 'The flash of the snap begins on the snap point. ' : 'The flash begins ' + Math.abs(flashAt - frames[v.now].t).toFixed(3) + ' s ' + (flashAt > frames[v.now].t ? 'later' : 'earlier') + ' than the snap point, on the frame marked SNAP?. ') : '') +
          'If his fingers snap on another frame than SNAP POINT, pick it and press the button: that moves the snap point (where the snap is in your file), not the start time.';
      } else if (v.mode === 'test') {
        title = landed ? 'The snap landed on ' + clockText : 'Was that the snap?';
        note = 'The frame marked ' + clockText + ' is the one the app put on that moment: it came on screen ' + arrived + '. ' +
          (v.flash ? (landed ? 'The flash of the snap begins on that very frame.' : v.now >= 0 ? 'The flash of the snap begins ' + Math.abs(flashAt - frames[v.now].t).toFixed(3) + ' s ' + (flashAt > frames[v.now].t ? 'later' : 'earlier') + ', on the frame marked SNAP?.' : 'The flash of the snap begins on the frame marked SNAP?.') : 'No flash was found in these frames.') +
          ' Pick the frame where his fingers snap and press the button.';
      } else if (v.applied && v.applied.verdict === 'found') {
        const sess = Engine.session;
        title = 'Snap found: ' + fmtFilm(cfg.snapSec);
        note = 'The app has put the snap on the frame marked SET NOW: the flash begins there' +
          (v.applied.after != null ? ', ' + Math.abs(v.applied.after).toFixed(2) + ' s ' + (v.applied.after >= 0 ? 'after' : 'before') + ' the line “…Iron Man.” goes off screen' : '') +
          (sess ? '. ' + startNow(sess) : '') +
          '. If that is the frame where his fingers snap, press the button; if not, ' + (v.readOnly ? 'stop the countdown and use “Find the snap”.' : 'pick the right frame first.');
      } else if (v.applied && v.applied.verdict === 'likely') {
        const sess = Engine.session;
        const moved = cfg.snapSec - v.applied.old;
        title = 'Is this the snap?';
        note = 'The snap was not where it was expected. The one white-out the app found is ' + Math.abs(moved).toFixed(1) + ' s ' + (moved > 0 ? 'later' : 'earlier') +
          ', and with ' + (v.line ? 'no subtitles known to be in step with the film' : 'no subtitles') + ' to check it against it is set for now on the frame marked SET NOW' +
          (sess ? ' (' + startNow(sess).replace(/^The/, 'the') + ')' : '') +
          '. Check the frames: if his fingers snap on that frame, press the button; if not, pick the right frame.';
      } else if (v.applied) {
        title = 'Where does he snap?';
        note = 'No flash was found in the picture. By the subtitles the snap comes a moment after ' + fmtFilm(v.line.end) + ', so the app has set ' + fmtFilm(cfg.snapSec) +
          ' for now. Step through the frames and press the button on the one where his fingers snap.';
      } else {
        const vv = v.verdict;
        const clear = !!vv && (vv.verdict === 'found' || vv.verdict === 'likely');
        title = v.flash ? (clear ? 'Found it: check the frame' : 'Is this the snap?') : 'Where does he snap?';
        note = (v.line ? 'The line “' + v.line.text.slice(0, 40) + '” ends at ' + fmtFilm(v.line.end) + ' (' + v.line.from + '). ' : '') +
          (v.flash ? 'The screen turns ' + (v.flash.kind === 'white' ? 'white' : 'bright') + ' at ' + fmtFilm(frames[v.flash.start].t) + '; the flash begins on the frame marked SNAP?' +
              (clear && vv.after != null ? ', ' + Math.abs(vv.after).toFixed(2) + ' s ' + (vv.after >= 0 ? 'after' : 'before') + ' the end of that line, as it should' : '') + '. ' : '') +
          (vv && !clear ? (v.auto ? 'The app left the snap point as it was: ' : 'The app cannot be sure: ') + this.whyText(vv, v.line) + '. ' : '') +
          'Step through the frames with ← →, and press the button on the frame where his fingers snap' + (!v.flash && v.line ? ': it is a moment after that line' : '') + '.';
      }
      setText(el.stripTitle, title);
      setText(el.stripNote, note);
      el.stripLegend.innerHTML = (v.byHand
        ? (v.atIdx >= 0 ? '<b class="clock" style="background:var(--hot)">' + esc(clockText) + '</b>the frame on screen at that moment' : '') +
          (v.now >= 0 ? '<b class="now" style="background:#9fb3c8">SNAP POINT</b>the snap point of this file' : '')
        : (v.now >= 0 && v.mode === 'test' ? '<b class="clock" style="background:var(--hot)">' + esc(clockText) + '</b>the frame put on that moment' : '') +
          (v.now >= 0 && v.mode !== 'test' ? '<b class="now" style="background:#9fb3c8">SET NOW</b>the snap point as it is' : '')) +
        (v.flash ? '<b class="pick" style="background:var(--acc)">SNAP?</b>where the flash begins' : '');
      setHidden(el.stripPreview, !v.readOnly);
      el.stage.classList.add('has-strip');
      setHidden(el.strip, false);
      UI.hideSlip();
      // Where to begin: the flash; with no flash, the end of the line (the snap is a moment after
      // it) when the search was for the snap, else the frame that is set; else the first frame.
      let first = v.flash ? v.flash.rise : -1;
      if (first < 0 && v.line && v.mode === 'find' && v.line.end >= frames[0].t && v.line.end <= frames[frames.length - 1].t) {
        first = 0;
        for (let i = 1; i < frames.length; i++) if (Math.abs(frames[i].t - v.line.end) < Math.abs(frames[first].t - v.line.end)) first = i;
      }
      if (first < 0) first = v.ref;
      this.select(Math.max(0, first), true);
      Engine.logEvent('Film strip opened (' + v.mode + '): ' + frames.length + ' frames from ' + fmtFilm(frames[0].t) + ' to ' + fmtFilm(frames[frames.length - 1].t) +
        (v.flash ? ', flash begins at ' + fmtFilm(flashAt) : ', no flash found') +
        (v.offMs != null ? ', the frame at ' + fmtFilm(frames[v.now].t) + ' came on screen ' + arrived : '') +
        (v.clock >= 0 && v.clock !== v.now ? ' (on screen at the very moment: ' + fmtFilm(frames[v.clock].t) + ')' : ''));
    },

    select(i, first) {
      const v = this.view;
      if (!v) return;
      i = clamp(Math.round(i), 0, v.frames.length - 1);
      v.sel = i;
      const f = v.frames[i];
      const nodes = el.stripRow.children;
      for (let k = 0; k < nodes.length; k++) {
        const on = k === i;
        if (nodes[k].classList.contains('sel') !== on) nodes[k].classList.toggle('sel', on);
        nodes[k].setAttribute('aria-selected', on ? 'true' : 'false');
      }
      if (nodes[i]) {
        // Only the strip itself scrolls, sideways, to put that frame in the middle.
        const row = el.stripRow;
        const left = Math.max(0, nodes[i].offsetLeft - (row.clientWidth - nodes[i].offsetWidth) / 2);
        if (first || typeof row.scrollTo !== 'function') row.scrollLeft = left; else row.scrollTo({ left: left, behavior: 'smooth' });
      }
      setText(el.stripTime, fmtFilm(f.t));
      const same = i === v.ref;
      let rel;
      if (v.byHand) {
        const d = v.now >= 0 ? f.t - v.frames[v.now].t : f.t - cfg.snapSec;
        rel = same ? 'the snap point: on screen ' + v.arrived.replace('the clock got there', 'the clock reached ' + v.clockText) : Math.abs(d).toFixed(3) + ' s ' + (d > 0 ? 'after' : 'before') + ' the snap point';
      } else if (v.mode === 'test') {
        const d = v.now >= 0 ? f.t - v.frames[v.now].t : f.t - cfg.snapSec;
        rel = same ? 'on screen ' + v.arrived.replace('the clock got there', 'the clock reached ' + v.clockText) : Math.abs(d).toFixed(3) + ' s ' + (d > 0 ? 'after' : 'before') + ' the frame put on ' + v.clockText;
      } else {
        const d = v.now >= 0 ? f.t - v.frames[v.now].t : f.t - cfg.snapSec;
        rel = same ? 'the snap point as it is set now' : Math.abs(d).toFixed(3) + ' s ' + (d > 0 ? 'after' : 'before') + ' the snap point set now';
      }
      setText(el.stripRel, rel);
      setText(el.stripOk, same ? 'Yes, the snap is on this frame' : 'Put the snap on this frame');
      el.stripOk.disabled = v.readOnly && !same;
      el.stripOk.title = v.readOnly && !same ? 'Stop the countdown to move the snap point' : '';
      if (v.readOnly) {
        // The film itself must not be moved while a countdown is armed: show the collected picture.
        const p = el.stripPreview;
        if (p.width !== f.thumb.width || p.height !== f.thumb.height) { p.width = f.thumb.width; p.height = f.thumb.height; }
        p.getContext('2d').drawImage(f.thumb, 0, 0);
      } else if (Media.ready) {
        // The film itself, paused on that very frame, sharp, above the strip.
        if (!video.paused) video.pause();
        try { video.currentTime = f.t + v.dt / 2; } catch (e) { /* not seekable */ }
        UI.lastVideoT = f.t + v.dt / 2;
      }
    },

    ok() {
      const v = this.view;
      if (!v) return;
      const f = v.frames[v.sel];
      if (v.sel === v.ref) {
        this.close();
        Versions.confirm();
        toast('Snap point confirmed: ' + fmtFilm(cfg.snapSec), 'good');
        return;
      }
      if (v.readOnly || Engine.mode !== 'free') { toast('Stop the countdown to move the snap point'); return; }
      const old = cfg.snapSec;
      // The snap point is the moment that frame comes on screen (a millisecond inside it, so that
      // rounding can never land on the frame before): it appears as the clock gets there.
      const next = Math.round((f.t + 0.001) * 1000) / 1000;
      const clockText = v.clockText;
      this.close();
      applySnap(next, { confirmed: true });
      if (Math.abs(cfg.snapSec - next) > 0.0005) return;
      Engine.logEvent('Snap point moved from ' + fmtFilm(old) + ' to ' + fmtFilm(next) + ' (the frame at ' + fmtFilm(f.t) + ')');
      const s = Engine.session;
      Modal.open({
        title: 'Snap point set to ' + fmtFilm(next),
        html: 'That is <b>' + Math.abs(next - old).toFixed(3) + ' s ' + (next > old ? 'later' : 'earlier') + '</b> than before.' +
          (s ? (cfg.startMode === 'auto' ? ' The movie now has to start at <b>' + esc(dateTimeOf(s.startEpoch)) + '</b>.'
            : ' The start time stays at <b>' + esc(clockOf(s.startEpoch)) + '</b>, the one you chose: the snap now lands <b>' + esc(lateText(snapLate(s))) + '</b> ' + esc(targetWord(s)) + '.') : '') +
          '<br><br>' + (!s || Math.abs(snapLate(s)) < 0.0005 ? 'Run the Snap test now to watch that frame land on ' + esc(clockText || 'the target moment') + '.' : 'Run the Snap test now to see where that frame lands with your start time.'),
        actions: [
          { label: 'Later', onClick: () => Modal.close() },
          { label: 'Run the Snap test', primary: true, onClick: () => { Modal.close(); UI.showTab('test'); Engine.startTest('snap', 20); } }
        ],
        onEscape: () => Modal.close()
      });
    },

    close() {
      if (!this.view) return;
      this.view = null;
      el.stripRow.textContent = '';
      setHidden(el.strip, true);
      setHidden(el.stripPreview, true);
      el.stage.classList.remove('has-strip');
      UI.dirty.all = true;
    },

    /** Keys while the strip is open. */
    key(e) {
      const v = this.view;
      if (!v) return;
      const k = e.key;
      const step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -12, PageDown: 12 }[k];
      if (step) { e.preventDefault(); this.select(v.sel + step); return; }
      if (k === 'Home') { e.preventDefault(); this.select(0); return; }
      if (k === 'End') { e.preventDefault(); this.select(v.frames.length - 1); return; }
      if (k === 'Enter') { e.preventDefault(); if (!e.repeat) this.ok(); return; }
      if (k === 'Escape') { e.preventDefault(); this.close(); }
    }
  };

  /* ======================================================= internet time === */

  const NetTime = {
    result: null,
    busy: false,
    lastTry: 0,

    usable() {
      const r = this.result;
      return !!(r && r.ok && Number.isFinite(r.offsetMs) && r.uncertaintyMs <= 250);
    },

    /** manual: the user asked. forced: the PC clock just jumped, so the correction must be re-checked now. */
    async measure(manual, forced) {
      if (this.busy) { if (forced) this.again = true; return; }
      this.busy = true;
      this.lastTry = performance.now();
      UI.dirty.sync = true;
      let ok = false;
      try {
        const r = await native.measureTime();
        if (r) {
          ok = !!r.ok;
          // Keep the last good answer unless the new one is just as trustworthy: a failed attempt
          // (the Wi-Fi dropped) or a vague one (only a coarse fallback answered) must not undo it.
          const good = r.ok && Number.isFinite(r.offsetMs) && r.uncertaintyMs <= 250;
          if (good || !this.usable()) this.result = r;
          if (r.ok) Engine.logEvent('Internet time: PC clock is ' + this.describe(r.offsetMs) + ' (±' + Math.round(r.uncertaintyMs) + ' ms, ' + r.method + ')');
          else if (manual) toast('Could not reach a time server', 'bad');
        }
        this.apply(manual || forced);
      } catch (e) {
        /* stay on the PC clock */
      } finally {
        this.busy = false;
        if (forced) Engine.st.settleUntil = 0;
        UI.dirty.sync = true;
        UI.dirty.preflight = true;
        if (this.again) {
          this.again = false;
          this.measure(false, true);
        } else if (forced && !ok && (this.retries = (this.retries || 0) + 1) <= 3) {
          // Just woke up and the network is not back yet: try again shortly.
          setTimeout(() => this.measure(false, true), 5000);
        } else {
          this.retries = 0;
        }
      }
    },

    describe(offsetMs) {
      if (Math.abs(offsetMs) < 20) return 'spot on';
      return fmtOff(Math.abs(offsetMs) / 1000) + (offsetMs > 0 ? ' slow' : ' fast');
    },

    apply(manual) {
      const want = cfg.useNetTime && this.usable() ? this.result.offsetMs : 0;
      const delta = want - Clock.netOffsetMs;
      if (Math.abs(delta) < 1) return;
      if (Engine.test) return;                               // a rehearsal keeps its own clock
      // Right before the start and the snap a correction that is already in use is left alone.
      // A first correction, or any correction while the film is still waiting, is always taken:
      // being on true time matters more than not moving.
      if (!manual && this.applied && Engine.phase !== 'standby' && Engine.nearCritical()) return;
      // Two measurements a few milliseconds apart are the same answer: do not make the film chase noise.
      if (!manual && want !== 0 && Clock.netOffsetMs !== 0 && Math.abs(delta) < 25) return;
      Clock.netOffsetMs = want;
      if (want !== 0) this.applied = true;
      Engine.ctrl.reset();
      if (Engine.mode === 'free' && !Engine.test) Engine.session = Engine.computeFree();
      UI.dirty.all = true;
    },

    /**
     * Called once a minute. Re-measures every 10 minutes around the film (from an hour before the
     * start until it ends), hourly otherwise so weeks of standby do not pester the time servers,
     * and every minute for as long as no measurement has worked yet.
     */
    maybeMeasure() {
      if (!cfg.useNetTime || this.busy || Engine.test) return;
      const age = performance.now() - this.lastTry;
      const s = Engine.session;
      const soon = Engine.mode === 'armed' && s && s.startEpoch - Clock.now() < 3600000;
      const every = !this.usable() ? 60000 : soon ? 600000 : 3600000;
      if (age > every) this.measure(false);
      else this.apply(false);
    }
  };

  /* =========================================================== subtitles === */

  const SubsUI = {
    cues: [], index: null, bytes: null, name: '', path: '', format: '', encoding: '', confident: true,
    shown: null, found: [], loading: false,
    own: false,            // these lines came out of the movie file itself: they are right as they are

    get loaded() { return !!this.index && this.cues.length > 0; },

    clear(silent) {
      this.cues = []; this.index = null; this.bytes = null; this.name = ''; this.path = '';
      this.shown = null;
      this.own = false;
      el.subs.textContent = '';
      if (!silent) { cfg.subPath = ''; cfg.subName = ''; cfg.subMovie = ''; save(); }
      SubSync.fileChanged(false);
      this.renderPanel();
    },

    async loadFrom(sub, opts) {
      opts = opts || {};
      if (!SubsCore) { toast('Subtitle support is unavailable', 'bad'); return false; }
      if (!sub || !sub.bytes) return false;
      this.bytes = sub.bytes instanceof Uint8Array ? sub.bytes : new Uint8Array(sub.bytes);
      this.name = sub.name || 'subtitles';
      this.path = sub.path || '';
      // A fresh load starts from the file as it is: what an earlier check found about it (with the
      // shift it gave) no longer applies, and the file is checked again.
      if (!opts.keepDelay) { cfg.subDelay = 0; cfg.subScale = 1; cfg.subSyncKey = ''; cfg.subSyncState = ''; }
      const ok = this.parse();
      if (!ok) {
        toast('No subtitles found in that file', 'bad');
        this.clear(true);
        return false;
      }
      this.own = !!opts.own;
      cfg.subOwn = this.own;
      cfg.subPath = this.path;
      cfg.subName = this.name;
      cfg.subMovie = Media.info ? (Media.info.path || Media.info.name) : '';
      if (!opts.auto) cfg.subsOn = true;
      save();
      SubSync.fileChanged(true);              // a new file: is it on the voices?
      this.renderPanel();
      if (!opts.quiet) toast('Subtitles loaded: ' + this.name + (cfg.subsOn ? '' : ' (hidden, press C)'), 'good');
      Engine.logEvent('Subtitles loaded: ' + this.name + ' (' + this.cues.length + ' lines, ' + this.encoding + ')');
      return true;
    },

    parse() {
      try {
        const dec = SubsCore.decode(this.bytes, cfg.subEncoding || 'auto');
        const parsed = SubsCore.parse(dec.text, this.name);
        this.cues = parsed.cues || [];
        this.index = this.cues.length ? SubsCore.createIndex(this.cues) : null;
        this.format = parsed.format;
        this.encoding = dec.encoding;
        this.confident = dec.confident !== false;
        this.shown = null;
        return this.cues.length > 0;
      } catch (e) {
        this.cues = []; this.index = null;
        return false;
      }
    },

    async pick() {
      try {
        const sub = await native.pickSubtitle();
        if (sub) await this.loadFrom(sub);
      } catch (e) {
        toast((e && e.message) || 'That subtitle file could not be read', 'bad');
      }
    },

    /** After a movie loads: bring back last time's subtitles, or pick up a file with the movie's name. */
    async autoLoad(token) {
      if (!native.isNative || !Media.info || !Media.info.path) { this.renderPanel(); return; }
      this.loading = true;
      try { await this.autoLoadNow(token); } finally { this.loading = false; }
    },

    async autoLoadNow(token) {
      const moviePath = Media.info.path;
      try {
        this.found = await native.findSubtitles(moviePath) || [];
      } catch (e) { this.found = []; }
      if (token !== Media.loadToken) return;
      let sub = null;
      try {
        if (cfg.subPath && cfg.subMovie === moviePath) sub = await native.readSubtitle(cfg.subPath);
        if (sub) { if (token === Media.loadToken) await this.loadFrom(sub, { keepDelay: true, auto: true, quiet: true, own: !!cfg.subOwn }); }
        else if (this.found.length && this.found[0].exact) {
          sub = await native.readSubtitle(this.found[0].path);
          if (sub && token === Media.loadToken) await this.loadFrom(sub, { auto: true });
        }
      } catch (e) { /* subtitles are optional */ }
      this.renderPanel();
    },

    toggle(flag) {
      if (!this.loaded) { UI.showTab('subs'); toast('Load a subtitle file first'); return; }
      cfg.subsOn = flag == null ? !cfg.subsOn : !!flag;
      save();
      this.shown = null;
      this.renderPanel();
      toast(cfg.subsOn ? 'Subtitles on' : 'Subtitles off');
    },

    nudge(delta) {
      // "reset" goes back to the file as it is: no shift, and its own speed. Lines moved by hand
      // are no longer known to be in step with the voices.
      const st = SubSync.state();
      const was = [cfg.subDelay, cfg.subScale];
      if (delta === 0) { cfg.subDelay = 0; cfg.subScale = 1; SubSync.undo = null; }
      else cfg.subDelay = Math.round((cfg.subDelay + delta) * 100) / 100;
      const moved = Math.abs(cfg.subDelay - was[0]) > 1e-9 || Math.abs(cfg.subScale - was[1]) > 1e-12;
      if (this.loaded && !this.own && moved && (st === 'synced' || st === 'fine' || st === 'close')) cfg.subSyncState = delta === 0 ? 'undone' : 'hand';
      save();
      this.shown = null;
      this.renderPanel();
      if (this.loaded) toast('Subtitle delay ' + this.delayText());
    },

    delayText() {
      const d = cfg.subDelay;
      return (d > 0 ? '+' : '') + d.toFixed(Math.abs(d * 10 - Math.round(d * 10)) < 1e-6 ? 1 : 2) + ' s';
    },

    /** Runs every frame; touches the DOM only when the set of visible lines changes. */
    render() {
      // While the film waits at 0:00 a first line (often a credit for the subtitle site) would sit
      // on the standby screen for hours: subtitles only show once the film runs.
      const waiting = Engine.mode === 'armed' && Engine.phase === 'standby';
      if (!this.index || !cfg.subsOn || !Media.ready || waiting) {
        if (this.shown !== false) { el.subs.textContent = ''; this.shown = false; }
        return;
      }
      const active = SubsCore.activeAt(this.index, (video.currentTime - cfg.subDelay) / cfg.subScale);
      const prev = this.shown;
      if (prev && prev !== false && prev.length === active.length) {
        let same = true;
        for (let i = 0; i < active.length; i++) if (active[i] !== prev[i]) { same = false; break; }
        if (same) return;
      }
      this.shown = active.slice();
      el.subs.innerHTML = active.map((c) => '<div class="cue" dir="auto">' + c.html + '</div>').join('');
    },

    renderPanel() {
      el.subToggle.checked = !!cfg.subsOn;
      el.subToggle.disabled = !this.loaded;
      el.subClear.hidden = !this.loaded;
      el.subDelay.textContent = this.delayText();
      SubSync.render();
      if (this.loaded) {
        el.subStatus.className = 'substat' + (this.confident ? '' : ' warn');
        el.subStatus.innerHTML = '<b>' + esc(this.name) + '</b>' + this.cues.length + ' lines · ' + esc(String(this.format).toUpperCase()) + ' · ' + esc(this.encoding) +
          (this.confident ? '' : '<br>The text encoding was guessed. If the letters look wrong, choose the language below.');
      } else {
        el.subStatus.className = 'substat';
        el.subStatus.textContent = 'No subtitles loaded. Load an .srt, .vtt or .ass file, or put it next to the movie with the same name.';
      }
      el.subs.className = 'subs size-' + cfg.subSize + ' bg-' + cfg.subBg + ' col-' + cfg.subColor + ' pos-' + cfg.subPos;
      el.btnSubs.classList.toggle('on', this.loaded && cfg.subsOn);
      el.btnSubs.classList.toggle('off', !this.loaded);

      el.subFoundWrap.hidden = !this.found.length;
      el.subFound.textContent = '';
      this.found.forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = f.name;
        b.title = f.path;
        b.addEventListener('click', async () => {
          try { const sub = await native.readSubtitle(f.path); if (sub) await this.loadFrom(sub); } catch (e) { toast('That subtitle file could not be read', 'bad'); }
        });
        el.subFound.appendChild(b);
      });
      UI.dirty.preflight = true;
    },

    renderEmbedded() {
      const tracks = (Media.probe && Media.probe.subtitles || []).filter((s) => s.isText);
      el.subEmbeddedWrap.hidden = !tracks.length;
      el.subEmbedded.textContent = '';
      tracks.forEach((s) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = 'Track ' + (s.index + 1) + (s.lang ? ' · ' + s.lang : '') + (s.title ? ' · ' + s.title : '');
        b.addEventListener('click', async () => {
          b.disabled = true;
          toast('Reading subtitles from the movie…');
          try {
            const r = await native.ffExtractSub(Media.info.path, s.index);
            if (r && r.sub) await this.loadFrom(r.sub, { own: true }); else toast((r && r.error) || 'Could not read that track', 'bad');
          } catch (e) { toast('Could not read that track', 'bad'); }
          b.disabled = false;
        });
        el.subEmbedded.appendChild(b);
      });
    }
  };

  /* ====================================================== subtitle sync === */

  /**
   * Puts a subtitle file on the voices of the film: film time = line time * speed + shift.
   *
   * Two things can say where a line belongs. The sound of the film: FFmpeg reads the speech band
   * of stretches of it (the centre channel, where there is one), and the lines are laid where
   * somebody is speaking. And the text subtitles inside the movie file, when it has them: those
   * are right already, and a subtitle file is laid on them more exactly than on sound.
   *
   * Nothing is moved unless the fit stands out clearly, and a file that fits only here and there
   * (it was made for another cut) is said to be just that.
   */
  const SubSync = {
    busy: false, auto: false, runId: 0,
    autoKey: '', autoAt: 0,
    fraction: 0,
    note: null,            // { kind, text, key } for the Subs tab
    undo: null,            // { delay, scale } as they were before the last change
    last: null,            // what the last check measured (for the tests and the log)

    /** One name for "this subtitle file on this movie". */
    key() {
      if (!SubsUI.loaded || !Media.info) return '';
      return (Media.info.path || Media.info.name || '') + '|' + (Media.info.size || 0) + '>' + (SubsUI.path || SubsUI.name) + '|' + (SubsUI.bytes ? SubsUI.bytes.length : 0);
    },
    state() { const k = this.key(); return k && cfg.subSyncKey === k ? cfg.subSyncState : ''; },
    /** These lines are known to sit on the voices: they came out of the movie file, or were checked. */
    trusted() { return SubsUI.loaded && (SubsUI.own || this.state() === 'synced' || this.state() === 'fine'); },
    /** An automatic check is waiting or running: the snap search waits for it. */
    wanted() { return !!this.autoKey || (this.busy && this.auto); },

    /** Another subtitle file, or none: whatever was being listened to no longer matters. */
    fileChanged(check) {
      this.runId++;
      if (this.busy) { try { native.ffSpeechCancel(); } catch (e) { /* nothing running */ } }
      this.undo = null;
      this.note = null;
      this.last = null;
      this.autoKey = '';
      if (check && SubsUI.loaded && !SubsUI.own && cfg.subAutoSync && native.isNative && Media.info && Media.info.path) {
        this.autoKey = this.key();
        this.autoAt = performance.now();
      }
    },

    /** The film's own timing comes first: no listening in the two minutes around the snap. */
    nearSnap() {
      if (Engine.mode !== 'armed' || !Engine.session) return false;
      return Engine.nearMoment(Clock.now(), 150000, 20000);
    },

    /** Five times a second: start the automatic check when nothing is in the way; stop a job that is. */
    tick(perf) {
      if (this.busy) {
        const armedRun = Engine.mode === 'armed' && Engine.phase !== 'standby';
        const starting = Engine.mode === 'armed' && Engine.phase === 'standby' && Engine.session && Engine.session.startEpoch - Clock.now() < 45000;
        if (this.nearSnap() || Engine.test || (this.auto && (armedRun || starting))) this.cancel();
        return;
      }
      if (!this.autoKey) return;
      if (!cfg.subAutoSync || !SubsUI.loaded || SubsUI.own || !Media.ready || this.autoKey !== this.key() || cfg.subSyncKey === this.autoKey) { this.autoKey = ''; return; }
      if (perf - this.autoAt < 700) return;
      if (Modal.isOpen || AudioFix.running || SnapCam.busy || SnapCam.view || Media.checking || !Media.inspected || Media.loading || Engine.test) {
        if (perf - this.autoAt > 120000) this.autoKey = '';
        return;
      }
      // An armed countdown is left alone once the film runs or is about to.
      if (Engine.mode === 'armed' && (Engine.phase !== 'standby' || !Engine.session || Engine.session.startEpoch - Clock.now() < 5 * 60000)) { this.autoKey = ''; return; }
      this.autoKey = '';
      this.run({ auto: true });
    },

    cancel() {
      if (!this.busy) return;
      this.runId++;
      try { native.ffSpeechCancel(); } catch (e) { /* nothing running */ }
    },

    progress(f) {
      if (!this.busy) return;
      this.fraction = clamp(f, this.fraction, 1);
      this.render();
    },

    say(kind, text) {
      this.note = text ? { kind: kind, text: text, key: this.key() } : null;
      this.render();
    },

    /** The best fit over the usual speeds, one speed at a time so the player never waits long. */
    async fit(wins, cues, linger, alive, minLines, halves) {
      let best = null;
      for (const r of C.SUB_SCALES) {            // likeliest first; a later one has to be clearly better
        best = C.betterFit(best, C.alignCues(wins, cues, { scales: [r], linger: linger, minLines: minLines, halves: halves }));
        await sleep(0);
        if (!alive()) return null;
      }
      return best;
    },

    /**
     * Listens, compares, and moves the lines when the answer is clear.
     *   opts.auto  the app's own check of a new file: quiet unless the file is off, and it leaves a
     *              file alone that is nearly right or that fits only parts of the film
     */
    async run(opts) {
      opts = opts || {};
      const auto = !!opts.auto;
      if (this.busy) return null;
      if (!SubsUI.loaded) { if (!auto) toast('Load a subtitle file first'); return null; }
      if (!native.isNative || !Media.ready || !Media.info || !Media.info.path) { if (!auto) toast('That needs a movie opened from this PC', 'bad'); return null; }
      if (Engine.test) { if (!auto) toast('Not during a test run'); return null; }
      if (this.nearSnap()) { if (!auto) toast('Not this close to the snap: try again in a few minutes'); return null; }

      this.busy = true;
      this.auto = auto;
      this.fraction = 0;
      const id = ++this.runId;
      const token = Media.loadToken;
      const bytes = SubsUI.bytes;
      const movie = Media.info.path;
      const key = this.key();
      const cues = SubsUI.cues.map((c) => ({ start: c.start, end: c.end }));
      const alive = () => id === this.runId && token === Media.loadToken && bytes === SubsUI.bytes && Media.ready;
      let out = null;
      try {
        const exe = await native.ffLocate().catch(() => null);
        if (!alive()) return null;
        if (!exe) {
          this.say('', 'Syncing subtitles with the voices needs the free tool FFmpeg.');
          if (!auto) this.offerFfmpeg();
          return null;
        }
        this.say('', 'Listening to the film to sync the subtitles…');
        if (!Media.probe) await Media.reprobe();
        if (!alive()) return null;

        // A huge file is slow to read: listen to less of it (about 3.5 GB at most).
        const perSec = Media.info.size > 0 && video.duration > 0 ? Media.info.size / video.duration : 0;
        const plan = C.speechPlan(video.duration, cues, perSec > 0 ? clamp(Math.floor(3.5e9 / perSec), 480, 3600) : 3600);
        if (!plan.length) { this.say('warn', 'This movie is too short to sync subtitles automatically.'); return null; }

        // 1. The voices.
        let voices = null;
        let trouble = '';
        const r = await native.ffSpeech(movie, undefined, plan, cfg.audioLang).catch((e) => ({ error: e && e.message }));
        if (!alive()) return null;
        if (r && r.windows && r.windows.length) {
          const wins = r.windows.map((w) => {
            const sc = C.speechScore(w.energy instanceof Float32Array ? w.energy : Float32Array.from(w.energy || []), r.hz);
            return { from: w.from, hz: r.hz, score: sc.score, sharp: sc.sharp };
          });
          voices = await this.fit(wins, cues, 0.25, alive);
          if (!alive()) return null;
        } else if (r && r.aborted) return null;
        else trouble = (r && r.error) || 'the sound could not be read';
        this.progress(0.62);

        // 2. The movie's own subtitles, where it has them.
        let inside = null;
        const hasText = ((Media.probe && Media.probe.subtitles) || []).some((x) => x.isText);
        if (hasText && SubsCore) {
          const ref = [];
          for (let i = 0; i < plan.length; i++) {
            const w = plan[i];
            const got = await native.ffSubWindow(movie, w.from, w.dur, cfg.audioLang).catch(() => null);
            if (!alive()) return null;
            this.progress(0.62 + 0.3 * (i + 1) / plan.length);
            if (!got || !got.srt) continue;
            const hz = 50;
            const score = new Float32Array(Math.round(w.dur * hz));
            for (const c of SubsCore.parse(got.srt, 'window.srt').cues || []) {
              const a = Math.max(0, Math.round((c.start - w.from) * hz));
              const b = Math.min(score.length - 1, Math.round((c.end - w.from) * hz));
              for (let k = a; k <= b; k++) score[k] = 1;
            }
            ref.push({ from: w.from, hz: hz, score: score });
          }
          if (ref.length) inside = await this.fit(ref, cues, 0, alive, 3, false);
          if (!alive()) return null;
        }
        this.progress(0.96);

        // 3. Who is believed. Where both are sure and agree, the movie's own subtitles give the finer
        //    answer; where they do not agree, the voices are what the lines are spoken in.
        // Two sets of subtitles of the same film lie on each other almost line for line: anything
        // less is a chance fit, however few lines there are.
        const v = voices && voices.confident ? voices : null;
        const o = inside && inside.confident && inside.strength >= 0.5 ? inside : null;
        let pick = null;
        let by = '';
        if (v && o) {
          const agree = Math.abs(v.scale - o.scale) < 1e-9 && Math.abs(v.offset - o.offset) <= 0.5;
          pick = agree ? o : v;
          by = agree ? 'both' : 'voices';
        } else if (v) { pick = v; by = 'voices'; } else if (o) { pick = o; by = 'inside'; }
        const brief = (a) => a ? (a.offset >= 0 ? '+' : '') + a.offset.toFixed(2) + ' s ×' + a.scale.toFixed(4) + ' (z ' + a.z.toFixed(1) + ', fit ' + a.strength.toFixed(2) + ', contrast ' + a.contrast.toFixed(2) + ', ' + a.lines + ' lines' + (a.mixed ? ', parts only' : '') + (a.confident ? '' : ', not sure') + ')' : 'nothing';
        out = { state: '', by: by, voices: voices, inside: inside, pick: pick, moved: false, trouble: trouble };
        this.last = out;
        Engine.logEvent('Subtitles compared with the film: the sound says ' + brief(voices) + ', the subtitles inside the movie say ' + brief(inside) + (trouble ? ' (' + trouble + ')' : ''));

        const byHand = ' Nothing was changed. Use − and + to move the subtitles by hand.';
        if (!pick) {
          out.state = 'unsure';
          this.finish(key, 'unsure', 'warn', trouble && !voices
            ? 'The sound of the film could not be read (' + trouble + ').' + byHand
            : 'The app could not work out where these subtitles belong: the film\'s sound has too little clear speech, or the file is for another film.' + byHand);
          if (!auto) toast('Could not sync the subtitles: nothing was changed', 'bad');
          return out;
        }

        const sameSpeed = Math.abs(pick.scale - cfg.subScale) < 1e-9;
        const diff = pick.offset - cfg.subDelay;                 // > 0: the lines have to come later
        const off = Math.abs(diff);
        const how = by === 'both' ? 'the sound of the film and the subtitles inside the movie file' : by === 'inside' ? 'the subtitles inside the movie file' : 'the sound of the film';
        const amount = off.toFixed(off < 10 ? 2 : 1) + ' s ' + (diff > 0 ? 'early' : 'late');
        const inSync = 'These subtitles are in sync with the voices. (Measured from ' + how + '.)';
        // A file made for another cut fits the film in some parts and would need another shift in others.
        const elsewhere = pick.mixed && pick.other
          ? ' They match the film only in parts: around ' + C.fmtDuration(pick.other.from, { forceHours: video.duration >= 3600 }) + ' the subtitles would have to come about ' +
            Math.abs(pick.other.offset - pick.offset).toFixed(0) + ' s ' + (pick.other.offset > pick.offset ? 'later' : 'earlier') + ' than in the rest, so the file was made for a different cut of the film.'
          : '';
        const small = sameSpeed && off < (auto ? (by === 'voices' ? 0.6 : 0.3) : 0.1);
        if (pick.mixed && (small || auto)) {
          out.state = 'mixed';
          this.finish(key, 'mixed', 'warn', (small ? 'These subtitles are in sync with most of the film.' : 'These subtitles are off.') + elsewhere +
            (small ? '' : ' Nothing was changed. “Sync with the voices” fits them to most of the film.'));
          toast('These subtitles were made for a different cut of the film', 'bad');
          return out;
        }
        if (sameSpeed && off < 0.1) {
          out.state = 'fine';
          this.finish(key, 'fine', 'good', inSync);
          if (!auto) toast('The subtitles are already in sync', 'good');
          return out;
        }
        // The sound alone tells where a line belongs to a few tenths of a second: the app does not
        // move a file by itself for less than it can tell.
        if (small) {
          out.state = off < 0.25 ? 'fine' : 'close';
          this.finish(key, out.state, 'good', off < 0.25 ? inSync
            : 'These subtitles are close: measured from ' + how + ' they come about ' + amount + ', which is as fine as the sound can tell. Nothing was changed. “Sync with the voices” moves them anyway.');
          return out;
        }

        this.undo = { delay: cfg.subDelay, scale: cfg.subScale };
        cfg.subDelay = pick.offset;
        cfg.subScale = pick.scale;
        out.moved = true;
        SubsUI.shown = null;
        const pct = Math.abs(pick.scale - 1) * 100;
        const text = sameSpeed
          ? 'The subtitles came ' + amount + '. They are now in sync with the voices.'
          : pick.scale === 1 ? 'The subtitles are now in sync with the voices, at the file\'s own speed.'
            : 'These subtitles ran at the wrong speed for this film: the file was made for a copy that runs ' + pct.toFixed(pct < 1 ? 1 : 0) + '% ' + (pick.scale > 1 ? 'faster' : 'slower') +
              ' (another frame rate), so they drifted further off the longer the film ran. They are now in sync with the voices.';
        out.state = pick.mixed ? 'mixed' : 'synced';
        this.finish(key, out.state, pick.mixed ? 'warn' : 'good', text + ' (Measured from ' + how + '.)' + elsewhere + (pick.mixed ? ' In those other parts they will still be off.' : ''));
        Engine.logEvent('Subtitles synced: shift ' + (pick.offset >= 0 ? '+' : '') + pick.offset.toFixed(2) + ' s' + (pick.scale !== 1 ? ', speed ×' + pick.scale.toFixed(4) : '') + ' (measured from ' + how + ')');
        toast(sameSpeed ? 'Subtitles were ' + amount + ': now in sync with the voices' : 'Subtitles are now in sync with the voices (their speed was wrong)', 'good');
        return out;
      } catch (e) {
        if (alive()) this.say('warn', 'The subtitles could not be checked: ' + ((e && e.message) || 'unknown error') + '.');
        return null;
      } finally {
        // Only one run exists at a time, so the flag is this run's to clear, called off or not.
        this.busy = false;
        this.auto = false;
        if (this.note && /^Listening/.test(this.note.text)) this.note = null;
        SubsUI.renderPanel();
      }
    },

    finish(key, state, kind, text) {
      cfg.subSyncKey = key;
      cfg.subSyncState = state;
      save();
      this.say(kind, text);
    },

    revert() {
      if (!this.undo || this.busy) return;
      cfg.subDelay = this.undo.delay;
      cfg.subScale = this.undo.scale;
      this.undo = null;
      SubsUI.shown = null;
      this.finish(this.key(), 'undone', '', 'The subtitles are back where they were.');
      SubsUI.renderPanel();
      toast('Subtitles back where they were');
    },

    offerFfmpeg() {
      if (Modal.isOpen) return;
      const canDownload = native.platform === 'win32';
      const go = async () => { Modal.close(); await Media.reprobe(); this.run(); };
      Modal.open({
        title: 'Sync with the voices',
        html: 'To hear the voices of the film, Avengers Player uses the free tool <b>FFmpeg</b>.' + (canDownload ? ' It is a one-time download of about 100 MB.' : ''),
        actions: [
          { label: 'Not now', onClick: () => Modal.close() },
          { label: 'I have FFmpeg…', onClick: async () => { const found = await native.ffPick(); if (found) go(); else toast('That is not a working FFmpeg', 'bad'); } }
        ].concat(canDownload ? [{ label: 'Download and sync', primary: true, onClick: () => AudioFix.download(go) }] : []),
        onEscape: () => Modal.close()
      });
    },

    /** The button, the note and the switch in the Subs tab. */
    render() {
      if (!el.subSync) return;
      el.subSyncWrap.hidden = !native.isNative;
      el.subSync.disabled = !SubsUI.loaded || (!this.busy && SubsUI.own);
      el.subSync.textContent = this.busy ? 'Stop listening (' + Math.round(this.fraction * 100) + '%)' : 'Sync with the voices';
      el.subSyncUndo.hidden = !this.undo || this.busy;
      el.optSubAuto.checked = cfg.subAutoSync !== false;
      let note = this.note && this.note.key === this.key() ? this.note : null;
      if (!note && SubsUI.loaded) {
        const st = this.state();
        if (SubsUI.own) note = { kind: 'good', text: 'These subtitles come from inside the movie file: they are in sync as they are.' };
        else if (st === 'synced') note = { kind: 'good', text: 'These subtitles have been synced with the voices.' };
        else if (st === 'fine') note = { kind: 'good', text: 'These subtitles are in sync with the voices.' };
        else if (st === 'close') note = { kind: 'good', text: 'These subtitles were checked and are close to the voices.' };
        else if (st === 'mixed') note = { kind: 'warn', text: 'These subtitles match only parts of the film: the file was made for a different cut.' };
        else if (st === 'unsure') note = { kind: 'warn', text: 'The app could not work out from the sound where these subtitles belong.' };
        else if (st === 'hand') note = { kind: '', text: 'These subtitles were moved by hand. “Sync with the voices” puts them back on the voices.' };
      }
      el.subSyncNote.hidden = !note;
      el.subSyncNote.className = 'substat syncnote' + (note && note.kind ? ' ' + note.kind : '');
      el.subSyncNote.textContent = note ? note.text : '';
      el.subSpeed.hidden = cfg.subScale === 1;
      el.subSpeed.textContent = cfg.subScale === 1 ? '' : 'Subtitle speed ×' + cfg.subScale.toFixed(4) + ': the file was made for a copy of the film with another frame rate.';
    }
  };

  /* =========================================================== audio fix === */

  const AudioFix = {
    running: false,

    /**
     * Explains the sound problem and offers the fix. With FFmpeg at hand the dialog lets the user
     * choose which language to convert (the wanted one is preselected); without it, it offers to
     * fetch FFmpeg first.
     */
    async offer() {
      if (this.running || Modal.isOpen || !Media.info || !Media.info.path || !native.isNative) return;
      const exe = await native.ffLocate().catch(() => null);
      if (exe && !Media.probe) await Media.reprobe();
      if (Modal.isOpen || !Media.info) return;
      const p = Media.soundProblem();
      const title = p ? p.title : 'Convert the sound';
      const why = esc(p ? p.text : 'The sound of this movie can be converted so that another language plays.');

      if (!exe) {
        const canDownload = native.platform === 'win32';
        Modal.open({
          title: title,
          html: why + '<br><br>Avengers Player can fix this in a few minutes, with no picture quality loss, using the free tool <b>FFmpeg</b>.' +
            (canDownload ? ' It is a one-time download of about 100 MB.' : ''),
          actions: [
            { label: 'Not now', onClick: () => Modal.close() },
            { label: 'I have FFmpeg…', onClick: async () => { const found = await native.ffPick(); if (found) this.afterFfmpeg(); else toast('That is not a working FFmpeg', 'bad'); } }
          ].concat(canDownload ? [{ label: 'Download and fix', primary: true, onClick: () => this.download() }] : []),
          onEscape: () => Modal.close()
        });
        return;
      }

      const tracks = (Media.probe && Media.probe.audio) || [];
      if ((p && !p.fixable) || !tracks.length) {
        // FFmpeg has looked inside: there is nothing in this file to convert into what is wanted.
        Modal.open({
          title: title,
          html: why,
          actions: [{ label: 'Close', primary: true, onClick: () => Modal.close() }],
          onEscape: () => Modal.close()
        });
        return;
      }
      const pick = Media.assess && Number.isInteger(Media.assess.audioIndex) ? Media.assess.audioIndex : tracks[0].index;
      const label = (t) => [C.langName(C.trackLang(t)) || t.title || 'Track ' + (t.index + 1), channelName(t.channels), C.audioCodecName(t.codec)].filter(Boolean).join(' · ');
      const choice = tracks.length > 1
        ? '<label class="fld mfld"><span>Language to play</span><select id="fixLang">' +
            tracks.map((t) => '<option value="' + t.index + '"' + (t.index === pick ? ' selected' : '') + '>' + esc(label(t)) + '</option>').join('') + '</select></label>' +
          '<label class="sw mfld"><input type="checkbox" id="fixKeep"' + (cfg.keepOtherSound ? ' checked' : '') + '><i></i><span>Keep the other languages too' +
            '<small>You can then switch language in the player. Takes a little longer.</small></span></label>'
        : '';
      Modal.open({
        title: title,
        html: why + '<br><br>Fix it now? Only the sound is converted; <b>the picture is copied untouched</b>, so there is no quality loss. It takes a few minutes and makes a new file next to the movie.' + choice,
        actions: [
          { label: 'Not now', onClick: () => Modal.close() },
          {
            label: 'Fix the sound', primary: true, onClick: () => {
              const sel = $('#fixLang', el.modalBody);
              const keep = $('#fixKeep', el.modalBody);
              const idx = sel ? parseInt(sel.value, 10) : pick;
              if (keep) { cfg.keepOtherSound = keep.checked; save(); }
              this.convert(Number.isInteger(idx) ? idx : pick, keep ? keep.checked : false);
            }
          }
        ],
        onEscape: () => Modal.close()
      });
    },

    async download(then) {
      this.running = true;
      Modal.open({
        title: 'Downloading FFmpeg',
        html: 'One-time download. The file is verified before it is used.',
        progress: true, note: 'Starting…',
        actions: [{ label: 'Cancel', onClick: () => native.ffCancel() }]
      });
      const r = await native.ffDownload().catch((e) => ({ error: e && e.message }));
      this.running = false;
      Modal.close();
      if (r && r.path) { if (then) then(); else this.afterFfmpeg(); return; }
      if (!(r && r.aborted)) toast((r && r.error) || 'The download failed', 'bad');
    },

    /** FFmpeg has just become available: look inside the file, then convert or ask which language. */
    async afterFfmpeg() {
      Modal.close();
      await Media.reprobe();
      const tracks = (Media.probe && Media.probe.audio) || [];
      const p = Media.soundProblem();
      if (p && p.kind === 'silent' && tracks.length === 1) { this.convert(tracks[0].index, false); return; }
      this.offer();
    },

    async convert(idx, keepOthers) {
      if (!Media.info || !Media.info.path) return;
      this.running = true;
      const source = Media.info;
      if (!Media.probe) await Media.reprobe();
      const tracks = (Media.probe && Media.probe.audio) || [];
      if (!Number.isInteger(idx)) idx = Media.assess && Number.isInteger(Media.assess.audioIndex) ? Media.assess.audioIndex : 0;
      const chosen = tracks.find((t) => t.index === idx) || null;
      const lang = chosen ? C.trackLang(chosen) : '';
      const what = C.langName(lang);
      const keep = !!keepOthers && tracks.length > 1;
      const wasArmed = Engine.mode === 'armed' && !Engine.test;
      Modal.open({
        title: 'Fixing the sound',
        html: 'Converting the ' + (what ? esc(what) + ' ' : '') + 'sound to AAC' + (keep ? ' and keeping the other languages' : '') +
          '. The picture is copied bit for bit.' + (wasArmed ? ' The countdown stays armed.' : ''),
        progress: true, note: 'Starting…',
        actions: [{ label: 'Cancel', onClick: () => native.ffCancel() }]
      });
      const r = await native.ffConvert(source.path, idx, keep, cfg.audioLang).catch((e) => ({ error: e && e.message }));
      this.running = false;
      Modal.close();
      if (r && r.movie) {
        // The new file starts with the language that was asked for: remember it as this file's choice.
        cfg.audioPickKey = AudioTracks.fileKey(r.movie);
        cfg.audioPickPos = 0;
        cfg.audioPickLang = lang;
        save();
        SnapMemory.inherit(source, r.movie);        // the same picture, frame for frame: the same snap point
        Engine.logEvent('Sound fixed: ' + r.movie.name + (what ? ' (' + what + (keep ? ', other languages kept' : '') + ')' : ''));
        const ok = await Media.load(r.movie, { byUser: true });
        if (ok) toast('Sound fixed' + (what ? ' (' + what + ')' : '') + '. Now using ' + r.movie.name, 'good');
        return;
      }
      if (r && r.missing) { this.offer(); return; }
      if (!(r && r.aborted)) {
        Modal.open({
          title: 'The sound could not be fixed',
          html: esc((r && r.error) || 'Unknown error.'),
          actions: [{ label: 'Close', primary: true, onClick: () => Modal.close() }],
          onEscape: () => Modal.close()
        });
      }
    }
  };

  native.onFfProgress((p) => {
    if (p && p.phase === 'listen') { SubSync.progress((p.fraction || 0) * 0.6); return; }
    if (!Modal.isOpen || !p) return;
    let note = '';
    if (p.phase === 'download') {
      const mb = (n) => (n / 1048576).toFixed(0);
      note = 'Downloading ' + (p.totalBytes ? mb(p.receivedBytes) + ' of ' + mb(p.totalBytes) + ' MB' : mb(p.receivedBytes || 0) + ' MB');
    } else if (p.phase === 'verify') note = 'Verifying the download…';
    else if (p.phase === 'extract') note = 'Unpacking…';
    else {
      note = Math.round((p.fraction || 0) * 100) + '%' + (p.speed ? ' · ' + Number(p.speed).toFixed(0) + '× speed' : '') +
        (isFinite(p.etaSec) && p.etaSec > 0 ? ' · about ' + C.fmtDuration(p.etaSec) + ' left' : '');
    }
    Modal.progress(p.fraction, note);
  });

  /* ========================================================= celebration === */

  const Celebration = {
    fx: null,
    bannerTimer: 0,

    init() {
      if (FxLib && FxLib.create) {
        try { this.fx = FxLib.create(el.fx); } catch (e) { this.fx = null; }
      }
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.resize()).observe(el.stage);
      this.resize();
    },

    resize() {
      const r = el.stage.getBoundingClientRect();
      if (this.fx && r.width > 0 && r.height > 0) {
        try { this.fx.resize(r.width, r.height, window.devicePixelRatio || 1); } catch (e) { /* cosmetic */ }
      }
    },

    duration() {
      const s = cfg.celebration;
      if (s === 'off') return 0;
      if (s === 'minimal' || !this.fx) return 8200;
      try { return FxLib.duration(s) || 14000; } catch (e) { return 14000; }
    },

    play(targetEpoch) {
      const style = cfg.celebration;
      if (style === 'off') return;
      const newYear = isNewYearMoment(targetEpoch);
      const title = newYear ? 'HAPPY NEW YEAR' : !Engine.session || onTarget(Engine.session) ? 'RIGHT ON TIME' : 'TARGET REACHED';
      const year = newYear ? String(new Date(targetEpoch).getFullYear()) : '';
      this.stop();
      if (style === 'minimal' || !this.fx) {
        el.bannerText.textContent = year ? title + ' ' + year : title;
        el.banner.hidden = false;
        this.bannerTimer = setTimeout(() => { el.banner.hidden = true; }, 8200);
        return;
      }
      this.resize();
      try { this.fx.play({ style: style, title: title, year: year }); } catch (e) { Engine.logEvent('Animation failed: ' + (e && e.message)); }
    },

    stop() {
      clearTimeout(this.bannerTimer);
      el.banner.hidden = true;
      if (this.fx) { try { this.fx.stop(); } catch (e) { /* cosmetic */ } }
    }
  };

  /* ================================================================== UI === */

  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4.5v4h4"/><text x="12" y="15.4" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="Segoe UI, sans-serif">10</text></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5"/><path d="M20 4.5v4h-4"/><text x="12" y="15.4" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none" font-family="Segoe UI, sans-serif">10</text></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.4l4.6 4v-13l-4.6 4z" fill="currentColor"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.4 6.6a7.6 7.6 0 0 1 0 10.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.4l4.6 4v-13l-4.6 4z" fill="currentColor"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M10.4 10.4a2.3 2.3 0 1 0 0 3.2M17 10.4a2.3 2.3 0 1 0 0 3.2"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.2"/><path d="M12 7.4V12l3.1 2"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.3-1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19v-6M10 19V5M15 19v-9M20 19v-4"/></svg>',
    fs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/></svg>'
  };

  const THEMES = [
    { id: 'arc', name: 'Arc Reactor', c: ['#070c16', '#5fe3ff', '#f6c453'] },
    { id: 'hotrod', name: 'Hot Rod', c: ['#1b0a0d', '#e02b35', '#ffc24a'] },
    { id: 'infinity', name: 'Infinity', c: ['#140d26', '#6b3df0', '#c19cff'] },
    { id: 'gamma', name: 'Gamma', c: ['#0a1b11', '#12b85a', '#d8ff5a'] },
    { id: 'stealth', name: 'Stealth', c: ['#131316', '#a0a0ac', '#f2f2f4'] },
    { id: 'midnight', name: 'Midnight Gold', c: ['#14110a', '#c8901e', '#f6c453'] },
    { id: 'doom', name: 'Doom', c: ['#0d1610', '#1f7a47', '#c4ccd2'] }
  ];
  const CELEB_HINT = {
    stark: 'Golden dust sweeps in and assembles into HAPPY NEW YEAR, then blows away. The snap, in reverse.',
    fireworks: 'Classic fireworks with a gold title.',
    minimal: 'A small banner only. Nothing covers the scene.',
    off: 'No animation. The date under the clock still rolls over to January 1.'
  };

  const setText = (node, text) => { if (node.__t !== text) { node.__t = text; node.textContent = text; } };

  /**
   * A countdown or a time with milliseconds: the milliseconds in smaller type, and the whole text
   * fitted to its box (measured only when the text changes shape, e.g. days or milliseconds appear).
   */
  // A box whose size changed (a scrollbar came, the window was resized, it became visible) is fitted again.
  const fitWatch = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => { entries.forEach((e) => { e.target.__shape = null; }); }) : null;
  const setCount = (node, text) => {
    if (fitWatch && !node.__watched) { node.__watched = true; fitWatch.observe(node); }
    if (node.__t === text && node.__shape) return;
    node.__t = text;
    const m = /^(.*\d)(\.\d{3})$/.exec(text);
    if (m) {
      node.textContent = m[1];
      const ms = document.createElement('span');
      ms.className = 'ms';
      ms.textContent = m[2];
      node.appendChild(ms);
    } else {
      node.textContent = text;
    }
    const shape = text.replace(/\d/g, '0');
    if (node.__shape === shape) return;
    node.style.fontSize = '';
    const room = node.clientWidth;
    if (!room) return;                       // not on screen yet: fitted the next time
    node.__shape = shape;
    const full = node.scrollWidth;
    if (full > room) node.style.fontSize = Math.floor(parseFloat(getComputedStyle(node).fontSize) * room / full * 0.97) + 'px';
  };

  /**
   * Scrolls the panel, and nothing else, so that `node` is in view. (scrollIntoView would also
   * scroll the window and the app's own frame, which cannot be scrolled back: the app slid up and
   * left a black bar.)
   */
  const scrollPanelTo = (node, where) => {
    const box = el.panel ? el.panel.querySelector('.panes') : null;
    if (!box || !node) return;
    const top = node.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, where === 'center' ? top - (box.clientHeight - node.offsetHeight) / 2 : top - 8);
  };
  const setHidden = (node, hidden) => { if (node.hidden !== hidden) node.hidden = hidden; };
  const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };

  const UI = {
    dirty: { all: true, transport: true, preflight: true, log: true, sync: true },
    tab: 'mission',
    isFs: false,
    idleTimer: 0,
    armConfirmTimer: 0,
    lastDateKey: 0,
    lastSimRender: 0,
    lastCountSec: -1,
    prevNow: 0,
    lastVideoT: 0,
    lastSlow: 0,
    seek: { dragging: false, pct: 0 },

    /* ---- views ---- */

    showImport() {
      el.app.dataset.view = 'import';
      setHidden(el.importView, false);
      setHidden(el.playerView, true);
      this.renderResume();
    },

    showPlayer() {
      el.app.dataset.view = 'player';
      setHidden(el.importView, true);
      setHidden(el.playerView, false);
      Celebration.resize();
      this.wake();
    },

    importBusy(flag) { setHidden(el.importBusy, !flag); },

    importError(html) {
      el.importError.innerHTML = html || '';
      setHidden(el.importError, !html);
      if (html) { try { native.log('import problem: ' + el.importError.textContent); } catch (e) { /* log is best effort */ } }
    },

    renderResume() {
      const show = cfg.armed && el.app.dataset.view === 'import';
      setHidden(el.resumeCard, !show);
      if (!show) return;
      const s = Engine.sessionFor(cfg.armedTarget);
      el.resumeText.textContent = 'The movie is set to start ' + dateTimeOf(s.startEpoch) +
        '. Open ' + (cfg.movieName ? '“' + cfg.movieName + '”' : 'the movie') + ' again and playback jumps straight to where the clock says it should be.';
      el.resumeBtn.textContent = cfg.moviePath ? 'Resume with ' + (cfg.movieName || 'the movie') : 'Choose the movie';
    },

    /** The line over the picture about a sound problem, and the Fix button that goes with it. */
    renderSoundWarning() {
      const p = Media.soundProblem();
      const text = p ? p.text + (p.fixable ? ' Use “Fix the sound” in the Mission tab.' : '') : '';
      if (el.audioWarn.__shown !== text) {
        // A warning the user clicked away stays away until it has something new to say.
        el.audioWarn.__shown = text;
        el.audioWarn.textContent = text;
        setHidden(el.audioWarn, !text);
      }
      setHidden(el.fixAudioBtn, !(p && p.fixable));
    },

    /** The sound language list in the Mission tab and the language button on the bar. */
    renderSoundTracks() {
      const list = Media.ready ? AudioTracks.list : [];
      const cur = AudioTracks.current();
      setHidden(el.soundFld, !list.length);
      const names = list.map((t) => AudioTracks.name(t));
      const sig = names.join('|');
      if (el.soundTrack.__sig !== sig) {
        el.soundTrack.__sig = sig;
        el.soundTrack.textContent = '';
        list.forEach((t, i) => {
          const o = document.createElement('option');
          o.value = String(t.pos);
          o.textContent = names[i] + (names.indexOf(names[i]) !== names.lastIndexOf(names[i]) ? ' (' + (i + 1) + ')' : '');
          el.soundTrack.appendChild(o);
        });
      }
      el.soundTrack.value = cur ? String(cur.pos) : '';
      setHidden(el.btnAudio, list.length < 2);
      setText(el.btnAudio, cur && cur.lang ? cur.lang.toUpperCase() : 'AUD');
      el.btnAudio.title = 'Sound language' + (cur ? ': ' + AudioTracks.name(cur, true) : '') + ' (A)';
    },

    /* ---- reactions to engine changes ---- */

    onMode() {
      if (SnapCam.view && !SnapCam.view.readOnly && (Engine.mode !== 'free' || Engine.test)) SnapCam.close();
      el.app.dataset.mode = Engine.test && Engine.test.kind !== 'night' ? 'test' : Engine.mode;
      this.dirty.all = true;
      clearTimeout(this.armConfirmTimer);
      el.armBtn.classList.remove('confirm');
      this.renderArmButton();
      this.renderStartTime();            // the start time can be changed only while nothing is armed
    },

    onPhase() {
      el.app.dataset.phase = Engine.phase;
      this.dirty.all = true;
      this.wake();
    },

    onTest() {
      const night = !!Engine.test && Engine.test.kind === 'night';
      setHidden(el.testHud, !Engine.test || night);
      setHidden(el.nightEnd, !night);
      el.app.dataset.mode = Engine.test && !night ? 'test' : Engine.mode;
      $$('[data-test]').forEach((b) => { b.disabled = !!Engine.test; });
      this.dirty.all = true;
      this.renderArmButton();
      this.renderStartTime();
    },

    renderArmButton() {
      const b = el.armBtn;
      const lateTest = Engine.lateWaiting();      // the late test: the button joins, as it would on the night
      b.disabled = (!!Engine.test && !lateTest) || !Media.ready;
      b.classList.toggle('armed', Engine.mode === 'armed' && !Engine.test);
      if (Engine.test && !lateTest) setText(b, 'TEST RUNNING');
      else if (Engine.mode === 'armed') setText(b, b.classList.contains('confirm') ? 'CLICK AGAIN TO STOP' : 'COUNTDOWN ARMED');
      else setText(b, this.lateNow ? 'JOIN THE MOVIE NOW' : 'START THE COUNTDOWN');
      setText(el.armHint, Engine.mode === 'armed' && !Engine.test
        ? 'Armed. You can go fullscreen and walk away: the movie starts itself. Click the button twice to stop the countdown.'
        : this.lateNow ? 'The movie should already be playing. Press the button: the film jumps to where the clock says it should be and stays locked to it.'
          : 'Press it any day: the movie waits for the start time and starts itself. Use the Test tab to rehearse right now.');
    },

    showSlip() {
      const titles = {
        pause: 'You paused the movie', seek: 'You slipped on the timeline', early: 'The movie was started early',
        drill: 'Slip drill: the movie was knocked out of sync'
      };
      setText(el.slipTitle, titles[Engine.st.slipReason] || 'You slipped');
      setHidden(el.slip, false);
      setHidden(el.slipPill, true);
      this.wake();
    },

    hideSlip() {
      setHidden(el.slip, true);
      setHidden(el.slipPill, true);
    },

    /** After a passed Snap test: the film was on the clock, but only a person can see where the snap was. */
    askSnapLanded() {
      if (Modal.isOpen || !Media.ready || Engine.test) return;
      const at = C.clockParts(new Date((Engine.session || Engine.computeFree()).targetEpoch), cfg.use24h).hms;
      Modal.open({
        title: 'Did the snap land on ' + at + '?',
        html: 'The film was locked to the clock. What only you can judge: <b>did the fingers snap just as the clock reached ' + esc(at) + '?</b>' +
          '<br><br>If it was early or late, the snap point of this file needs adjusting. That takes half a minute.',
        actions: [
          { label: 'It was off', onClick: () => { Modal.close(); if (Engine.mode === 'free' && !Engine.test && Frames.supported) SnapCam.find(); else this.openSnapFinder(); } },
          { label: 'Not sure', onClick: () => Modal.close() },
          { label: 'Yes, spot on', primary: true, onClick: () => { Modal.close(); Versions.confirm(); toast('Snap point confirmed', 'good'); } }
        ],
        onEscape: () => Modal.close()
      });
    },

    /** Everything somebody else needs to know about the snap point of this file, as text. */
    snapDetails() {
      const s = Engine.session;
      const lines = [
        (this.appName || 'Avengers Player'),
        'File: ' + (Media.info ? Media.info.name : 'none'),
        'Length: ' + (Media.ready ? fmtFilm(video.duration) + ' (' + video.duration.toFixed(3) + ' s), ' + video.videoWidth + 'x' + video.videoHeight + (Media.fps ? ', ' + Media.fps.toFixed(3) + ' frames a second' : '') : 'unknown'),
        'Film version: ' + Versions.current().name,
        'Snap point: ' + fmtFilm(cfg.snapSec) + ' (' + cfg.snapSec.toFixed(3) + ' s), ' + (snapConfirmed() ? 'confirmed in this file' : 'NOT confirmed in this file'),
        'Movie starts: ' + (s ? dateTimeOf(s.startEpoch) : 'unknown') + ', target: ' + (s ? C.fmtDateTime(s.targetEpoch, cfg.use24h) : 'unknown'),
        'Start time: ' + startName(cfg.startMode, s) + (s ? ', the snap lands ' + lateText(snapLate(s)) + ' the target' : '')
      ];
      const last = Engine.events.filter((e) => /Snap point moved|Snap found|Snap probably|Snap point estimated|left the snap point|The line before the snap|Film strip opened|Test run ended: The snap/.test(e.text)).slice(-6).map((e) => e.text);
      // What the last search saw around the flash, frame by frame, so that someone who has not got
      // the film can check the app's choice: "time since the frame before (ms),brightness %,white %".
      const seen = SnapCam.lastSeen;
      const trace = [];
      if (seen && seen.frames.length) {
        const fl = seen.verdict && seen.verdict.flash;
        const a = fl ? Math.max(0, fl.rise - 36) : 0;
        const b = fl ? Math.min(seen.frames.length, fl.start + 13) : Math.min(seen.frames.length, 160);
        const part = seen.frames.slice(a, b);
        let prev = part[0].t;
        trace.push('Last search: ' + seen.verdict.verdict + (seen.verdict.why ? ' (' + seen.verdict.why + ')' : '') +
          (fl ? ', flash begins at ' + fmtFilm(seen.frames[fl.rise].t) : ', no flash') +
          (seen.line ? ', line ends at ' + fmtFilm(seen.line.end) + (seen.line.checked ? '' : ' (not checked)') : ', no line'));
        trace.push('Frames from ' + part[0].t.toFixed(3) + ': ' + part.map((f) => { const d = Math.round((f.t - prev) * 1000); prev = f.t; return d + ',' + Math.round(f.mean * 100) + ',' + Math.round(f.white * 100); }).join(' '));
      }
      return lines.concat(last, trace).join('\n');
    },

    /** Puts the film just before the snap point, paused, with the frame tools in view. */
    openSnapFinder() {
      Modal.close();
      if (Engine.mode === 'armed' || Engine.test) { toast('Stop the countdown to adjust the snap point'); return; }
      this.showTab('setup');
      if (Media.ready) {
        if (!video.paused) video.pause();
        try { video.currentTime = clamp(cfg.snapSec - 12, 0, Math.max(0, video.duration - 1)); } catch (e) { /* not seekable */ }
        this.lastVideoT = video.currentTime;
      }
      el.snapTools.classList.add('attn');
      setTimeout(() => el.snapTools.classList.remove('attn'), 4200);
      scrollPanelTo(el.snapTools, 'center');
    },

    lockedNudge() {
      const now = performance.now();
      if (now - (this.lastNudge || 0) < 1500) return;
      this.lastNudge = now;
      toast('Controls are locked. Press L to unlock.');
    },

    addTestResult(r) {
      const empty = $('.empty', el.testResults);
      if (empty) empty.remove();
      const d = document.createElement('div');
      d.className = 'result' + (r.ok === false ? ' fail' : r.ok == null ? ' warn' : '');
      d.innerHTML = '<b>' + (r.ok ? 'PASS · ' : r.ok === false ? 'FAIL · ' : '') + esc(r.title) + '</b><span>' + esc(r.text) + ' · ' + esc(C.fmtClock(new Date(), cfg.use24h)) + '</span>';
      el.testResults.insertBefore(d, el.testResults.firstChild);
      while (el.testResults.children.length > 8) el.testResults.lastChild.remove();
      toast(r.ok ? 'Test passed' : r.ok === false ? 'Test failed' : 'Test ended', r.ok ? 'good' : r.ok === false ? 'bad' : '');
      this.dirty.preflight = true;
    },

    /* ---- chrome ---- */

    wake() {
      el.stage.classList.remove('idle');
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        const busy = this.seek.dragging || !el.slip.hidden || !el.blocked.hidden || (video.paused && Engine.mode === 'free');
        if (!busy) el.stage.classList.add('idle'); else this.wake();
      }, 2600);
    },

    async setFullscreen(flag) {
      try { await native.setFullscreen(flag); this.onFullscreen(!!flag, true); } catch (e) { /* stays windowed */ }
    },

    onFullscreen(flag, byUser) {
      if (this.isFs === !!flag && !byUser) return;
      this.isFs = !!flag;
      el.app.classList.toggle('is-fs', this.isFs);
      el.btnFs.innerHTML = this.isFs ? ICON.fsExit : ICON.fs;
      setText(el.fsBtn, this.isFs ? 'EXIT FULLSCREEN' : 'ENTER FULLSCREEN');
      if (this.booted) { cfg.wasFullscreen = this.isFs; save(); }
      Celebration.resize();
      this.wake();
    },

    showTab(id) {
      this.tab = id;
      $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
      $$('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + id));
      this.dirty.all = true;
    },

    applyTheme() {
      document.documentElement.dataset.theme = THEMES.some((t) => t.id === cfg.theme) ? cfg.theme : 'arc';
      $$('.theme', el.themeGrid).forEach((b) => b.classList.toggle('on', b.dataset.id === cfg.theme));
    },

    /* ---- one-off renders ---- */

    refreshAll() {
      this.dirty.all = true;
      this.applyTheme();
      this.renderSettings();
      this.renderFileCard();
      this.renderArmButton();
      SubsUI.renderPanel();
    },

    renderFileCard() {
      if (!Media.ready) { setText(el.fileName, '—'); setText(el.fileMeta, ' '); return; }
      setText(el.fileName, Media.info.name);
      el.fileName.title = Media.info.path || Media.info.name;
      const parts = [video.videoWidth + '×' + video.videoHeight, C.fmtDuration(video.duration)];
      if (Versions.guess) parts.unshift(Versions.guess.short);
      if (Media.info.size) parts.push((Media.info.size / 1073741824).toFixed(2) + ' GB');
      const p = Media.probe;
      if (p && p.video && p.video.codec) parts.push(String(p.video.codec).toUpperCase());
      const snd = AudioTracks.current();
      if (snd && snd.meta) parts.push(C.audioCodecName(snd.meta.codec).replace(/ \(.*\)$/, ''));
      else if (!snd && p && p.audio && p.audio[0]) parts.push(C.audioCodecName(p.audio[0].codec).replace(/ \(.*\)$/, ''));
      setText(el.fileMeta, parts.join(' · '));
      this.renderSoundTracks();
    },

    /** Setup → Start time: the three choices, with where the snap lands for each. */
    renderStartTime() {
      // Armed also while the countdown is reloading the film or has lent it out (cfg.armed).
      const armed = Engine.mode === 'armed' || cfg.armed || !!Engine.test;
      // (At startup, and while an armed countdown reloads the film, there may be no armed session yet.)
      const s = Engine.test ? Engine.computeFree()
        : Engine.mode === 'armed' && Engine.session ? Engine.session
        : cfg.armed && Number.isFinite(cfg.armedTarget) ? Engine.sessionFor(cfg.armedTarget)
        : Engine.computeFree();
      const target = s.targetEpoch;
      const at = (mode) => target - Math.round(startLead(mode) * 1000);
      const word = targetWord(s);
      const lands = (mode) => { const late = Math.round((cfg.snapSec - startLead(mode)) * 1000) / 1000; return (Math.abs(late) < 0.0005 ? 'the snap lands on ' + word : 'the snap lands ' + lateText(late) + ' ' + word) + (snapConfirmed() || mode === 'auto' ? '' : ' (if the snap point is right: it has not been checked yet)'); };
      const fits = (mode) => !Media.ready || video.duration >= startLead(mode) + 2;
      el.smAuto.checked = cfg.startMode === 'auto';
      el.smClassic.checked = cfg.startMode === 'classic';
      el.smOwn.checked = cfg.startMode === 'own';
      [el.smAuto, el.smClassic, el.smOwn, el.smOwnInput, el.smOwnApply, el.smOwnMinus1, el.smOwnMinus01, el.smOwnPlus01, el.smOwnPlus1].forEach((n) => { n.disabled = armed; });
      setHidden(el.smArmedNote, !armed);
      setText(el.smArmedNote, Engine.test && !cfg.armed ? 'End the test run to change the start time.' : 'Stop the countdown to change the start time.');
      // The fixed choice is 2:30:30 before the target: 9:29:30 PM for midnight.
      const classicAt = clockOf(at('classic'));
      const opt = el.tsStartMode.querySelector('option[value="classic"]');
      if (opt) setText(opt, 'Start at ' + classicAt);
      // The simulation from the minute before the movie starts.
      const startOpt = el.tsNightAt.querySelector('option[value="start"]');
      const startAt = target - Math.round(startLead() * 1000);
      if (startOpt) setText(startOpt, clockOf(Math.floor((startAt - 20000) / 60000) * 60000) + ': watch it start by itself at ' + clockOf(startAt));
      // The late test that joins a minute before the target, to watch the snap.
      const lateOpt = el.tsLateBy.querySelector('option[value="snap"]');
      if (lateOpt) setText(lateOpt, 'Join at ' + clockOf(target - 60000) + ', watch the snap');
      setText(el.smClassicWhat, isNewYearMoment(target) ? ', the time everybody quotes' : ', 2:30:30 before the target');
      setText(el.smAutoAt, clockOf(at('auto')));
      setText(el.smAutoNote, 'Set by the snap point of this file, ' + fmtFilm(cfg.snapSec) + (snapConfirmed() ? '' : ' (not confirmed yet)') + ': ' + lands('auto') + '.');
      setText(el.smClassicAt, clockOf(at('classic')));
      setText(el.smClassicNote, fits('classic') ? 'The streaming figure. With this file ' + lands('classic') + '.' : 'This file is too short for this start time.');
      setText(el.smOwnNote, cfg.startMode !== 'own'
        ? (cfg.startOwnSet ? 'Your time, ' + clockOf(at('own')) + ', is kept: choose this to use it again, or type another.' : 'Type a time, or press a button below to start from the time set now.')
        : fits('own') ? 'Starts at ' + clockOf(at('own')) + ': ' + lands('own') + '.' : 'This file is too short for this start time.');
      if (document.activeElement !== el.smOwnInput) {
        el.smOwnInput.value = C.fmtClockMs(at(cfg.startMode), cfg.use24h);
        el.smOwnInput.dataset.shown = el.smOwnInput.value;      // what was typed differs from this until it is set
      }
      el.smOwnInput.classList.remove('bad');
    },

    renderSettings() {
      el.optOverlay.checked = cfg.showOverlay;
      el.optClock.checked = cfg.showClock;
      el.optDate.checked = cfg.showDate;
      el.optCount.checked = cfg.showCount;
      el.optFinal.checked = cfg.finalTen;
      el.optMs.checked = cfg.showMs !== false;
      el.optSyncBadge.checked = cfg.showSyncBadge;
      el.optPanel.value = cfg.panelSide === 'right' ? 'right' : 'left';
      el.app.dataset.panel = cfg.panelSide === 'right' ? 'right' : 'left';
      el.optPos.value = cfg.overlayPos;
      el.optSize.value = cfg.overlaySize;
      el.opt24h.value = cfg.use24h ? '24' : '12';
      el.optStandby.checked = cfg.standbyScreen;
      el.optAutoRecover.checked = cfg.autoRecover;
      el.optAutoRecoverSec.value = String(cfg.autoRecoverSec);
      el.optLock.checked = cfg.lockControls;
      el.optAutoRestart.checked = cfg.autoRestart !== false;
      el.optNetTime.checked = cfg.useNetTime;
      el.optAudioLang.value = cfg.audioLang;
      el.subSize.value = cfg.subSize;
      el.subBg.value = cfg.subBg;
      el.subColor.value = cfg.subColor;
      el.subPos.value = cfg.subPos;
      el.subEncoding.value = cfg.subEncoding;
      el.tgNewYear.checked = cfg.targetMode !== 'custom';
      el.tgCustom.checked = cfg.targetMode === 'custom';
      el.tgCustomInput.disabled = cfg.targetMode !== 'custom';
      el.tgCustomInput.value = cfg.customTarget || '';
      if (document.activeElement !== el.snapInput) el.snapInput.value = C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true });
      this.renderStartTime();
      const ver = Versions.current();
      el.filmVersion.value = ver.id;
      const g = Versions.guess;
      setText(el.filmVersionNote, ver.note + (g && g.family !== ver.family && ver.id !== 'custom' ? ' Note: by its name this file looks like ' + g.name + '.' : ''));
      setText(el.snapReset, 'back to ' + C.fmtDuration((g && g.snapSec) || C.DEFAULT_SNAP_SEC, { forceHours: true }));
      // A file longer than the 2019 film: say by how much, and what that can mean for the snap.
      const extra = Media.ready ? video.duration - C.REFERENCE_SEC : NaN;
      const longer = extra >= 3 && extra <= 600;
      setHidden(el.filmLengthNote, !longer);
      if (longer) {
        setText(el.filmLengthNote, 'This file is ' + C.fmtDuration(video.duration) + ' long, ' + fmtSpan(extra) + ' longer than the 2019 film (3:01:11). ' +
          'If the extra time comes after the snap (new scenes at the end), the snap is where it always was. If it comes before the film (an introduction, a longer logo), the snap is that much later. ' +
          'One look settles it: press “Play from 10 s before” below and watch for the snap.');
      }
      const later = Versions.laterSnap();
      const canTry = later != null && Engine.mode !== 'armed' && !Engine.test && Math.abs(cfg.snapSec - later) > 0.5;
      setHidden(el.snapShiftTry, !canTry);
      if (canTry) setText(el.snapShiftTry, 'Snap not there? Try ' + C.fmtDuration(later, { forceHours: true }) + ' (' + fmtSpan(extra) + ' later)');
      $$('button', el.optCelebration).forEach((b) => b.classList.toggle('on', b.dataset.v === cfg.celebration));
      setText(el.celebHint, CELEB_HINT[cfg.celebration] || '');
      el.overlay.className = 'overlay pos-' + cfg.overlayPos + ' size-' + cfg.overlaySize;
      el.stage.dataset.ov = cfg.overlayPos;
      el.btnOverlay.classList.toggle('on', cfg.showOverlay);
      el.btnLock.innerHTML = cfg.lockControls ? ICON.lock : ICON.unlock;
      el.btnLock.classList.toggle('on', cfg.lockControls);
      el.btnStats.classList.toggle('on', cfg.showStats);
      setHidden(el.statsHud, !cfg.showStats);
      el.vol.value = String(cfg.volume);
    },

    renderPreflight() {
      const items = [];
      const v = video;
      if (Media.ready) {
        items.push([true, 'Movie loaded and decoding', v.videoWidth + '×' + v.videoHeight + ' · ' + C.fmtDuration(v.duration)]);
        const sp = Media.soundProblem();
        const snd = AudioTracks.current();
        if (sp) items.push([false, sp.short, sp.hint]);
        else if (Media.hasAudio === true) {
          items.push([true, snd && C.langName(snd.lang) ? 'Sound: ' + AudioTracks.name(snd) : 'Sound is playable',
            (snd && snd.meta ? C.audioCodecName(snd.meta.codec).replace(/ \(.*\)$/, '') : '') + (AudioTracks.list.length > 1 ? (snd && snd.meta ? ' · ' : '') + AudioTracks.list.length + ' languages in this file, press A to switch' : '')]);
        }
        else if (Media.checking) items.push([null, 'Checking the sound…', 'Playing the first two seconds silently.']);
        else items.push([null, 'Sound not verified yet', 'It is checked the moment the movie plays. Run a test.']);
        if (cfg.muted || cfg.volume < 0.05) items.push([false, 'The player is muted', 'Press M or raise the volume. Starting the countdown switches the sound back on.']);
        if (v.duration >= cfg.snapSec + 2) {
          items.push([true, 'The file reaches the snap point', 'Snap at ' + C.fmtDuration(cfg.snapSec, { ms: cfg.snapSec % 1 !== 0 })]);
          const how = (SnapMemory.get(Media.info) || {}).how;
          const at = C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true });
          if (snapConfirmed()) {
            items.push([true, 'Snap point confirmed in this file', at + (how === 'flash+line' ? ' · found by the app: the flash, right after the line “…Iron Man.”'
              : how === 'flash' ? ' · found by the app: the flash of the snap' : how === 'user' ? ' · picked from the frames' : '')]);
          } else if (how === 'estimate') {
            items.push([null, 'Snap point not confirmed in this file yet', at + ' is an estimate from the subtitles: no flash was found. Press “Find the snap” below and pick the frame.']);
          } else if (how === 'flash?') {
            items.push([null, 'Snap point not confirmed in this file yet', at + ' is where the app found a white-out, far from where the snap was expected and with no subtitles to check it. Press “Find the snap” below and confirm the frame.']);
          } else {
            items.push([null, 'Snap point not confirmed in this file yet', '2:30:30 is a round number: the real snap is a moment later. Press “Find the snap” below, or run the Snap test: both show you the frames, and one click sets it.']);
          }
        }
        else items.push([false, 'The file ends before the snap point', 'It is only ' + C.fmtDuration(v.duration) + ' long. Wrong file, or set the snap point in Setup.']);
      } else {
        items.push([null, 'No movie loaded', '']);
      }
      if (Media.ready && cfg.startMode !== 'auto') {
        const sess = Engine.test ? Engine.computeFree() : Engine.session || Engine.computeFree();
        const late = snapLate(sess);
        if (v.duration < startLead() + 2) items.push([false, 'The start time you chose does not fit this file', 'It is only ' + C.fmtDuration(v.duration) + ' long. Pick another start time in Setup.']);
        else items.push([Math.abs(late) < 0.0005 && snapConfirmed() ? true : null, 'Start time chosen by hand: ' + clockOf(sess.startEpoch),
          'With this file ' + landsText(sess) + '.' + (Math.abs(late) < 0.0005 ? '' : ' The automatic start would put it on ' + targetWord(sess) + '.')]);
      }
      const r = NetTime.result;
      if (NetTime.usable() && cfg.useNetTime) items.push([true, 'Clock checked against internet time', 'PC clock is ' + NetTime.describe(r.offsetMs) + (Math.abs(r.offsetMs) >= 20 ? ', corrected' : '')]);
      else if (NetTime.usable()) items.push([Math.abs(r.offsetMs) < 500 ? null : false, 'PC clock is ' + NetTime.describe(r.offsetMs), 'Correction is switched off in the Sync tab.']);
      else items.push([null, NetTime.busy ? 'Checking internet time…' : 'Internet time not available', 'Using the PC clock as it is. Make sure Windows shows the right time.']);
      items.push([native.isNative ? true : null, 'The PC will not fall asleep by itself while armed', native.isNative ? 'Closing the lid or pressing the power button still puts it to sleep. When it wakes up, the film goes straight back to where the clock says.' : 'Not available in the browser build.']);
      // A three-hour film can empty a laptop battery.
      if (Power.known) {
        const pct = Power.percent();
        const back = cfg.autoRestart === false ? 'Switch on “Come back by itself after a crash or a power cut” in Setup, so the app opens again after a power cut.'
          : 'If the power goes off anyway, the app opens again when the PC is back on and you sign in, and picks up where the clock says.';
        items.push(Power.onBattery() ? [false, 'Running on the battery' + (pct != null ? ' (' + pct + '%)' : ''), 'Plug the PC in for the film. ' + back] : [true, 'Plugged in', back]);
      }
      const reh = cfg.rehearsed || {};
      if (reh.start && reh.snap) items.push([true, 'Rehearsed', 'Auto-start and snap tests passed' + ((reh.slip || reh.late) ? ', ' + [reh.slip && 'recovery drill', reh.late && 'late start test'].filter(Boolean).join(' and ') + ' too' : '') + '.']);
      else items.push([null, 'Not rehearsed yet', 'Run the auto-start and snap tests in the Test tab.']);
      if (SubsUI.loaded) items.push([true, 'Subtitles ready', SubsUI.name + (cfg.subsOn ? '' : ' (hidden)')]);

      el.preflight.innerHTML = items.map((it) => '<li data-ok="' + (it[0] == null ? '' : it[0]) + '"><span>' + esc(it[1]) + (it[2] ? '<small>' + esc(it[2]) + '</small>' : '') + '</span></li>').join('');
      setHidden(el.findSnapBtn, !(Media.ready && !snapConfirmed() && Engine.mode === 'free' && !Engine.test && v.duration >= cfg.snapSec + 2));
    },

    renderLog() {
      const rows = Engine.events.slice(-60).reverse();
      el.evLog.innerHTML = rows.map((e) => '<div><b>' + esc(C.fmtClock(new Date(e.at), true)) + '</b> ' + esc(e.text) + '</div>').join('') || '<div>Nothing yet.</div>';
    },

    /* ---- per-frame render ---- */

    frame() {
      const now = Clock.now();
      const date = new Date(now);
      const s = Engine.session;
      const cp = C.clockParts(date, cfg.use24h);
      const view = el.app.dataset.view;
      const toStart = s ? s.startEpoch - now : NaN;
      const toSnap = s ? s.targetEpoch - now : NaN;
      const newYear = s ? isNewYearMoment(s.targetEpoch) : true;
      const dateLine = C.DAYS_LONG[date.getDay()] + ', ' + C.MONTHS_LONG[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
      Missed.tick(now, s);

      if (view === 'import') {
        setText(el.imClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
        setText(el.imDate, dateLine);
        if (s) {
          setCount(el.imToStart, toStart > 0 ? startCountdown(s, now) : 'RUNNING');
          setText(el.imStartAt, dateTimeOf(s.startEpoch));
          setText(el.imToSnap, toSnap > 0 ? C.fmtCountdown(C.untilClockSecond(s.targetEpoch, now)) : 'NOW');
          setText(el.imSnapAt, C.fmtDateTime(s.targetEpoch, cfg.use24h));
          setText(el.imSnapLbl, newYear ? 'NEW YEAR IN' : onTarget(s) ? 'THE SNAP IN' : 'THE TARGET IN');
          setText(el.imStart, clockOf(s.startEpoch));
          const sd = new Date(s.startEpoch);
          setText(el.imDay, 'on ' + C.MONTHS_LONG[sd.getMonth()] + ' ' + sd.getDate());
          setText(el.imLands, onTarget(s) ? (newYear ? 'the snap lands on the first second of the new year' : 'the snap lands on the target') : landsText(s));
        }
        // No movie yet, and it should already be playing: say so before anything else.
        const running = !!s && toStart <= 0 && (s.endEpoch != null ? now < s.endEpoch - 5000 : toSnap > -45 * 60000) && !cfg.armed && !(newYear && toSnap <= 0);
        setHidden(el.imLate, !running);
        if (running) {
          setText(el.imLateText, 'It had to start at ' + clockOf(s.startEpoch) + ' and should be at ' + C.fmtDuration(Math.max(0, C.filmSecondOnClock(s, now)), { forceHours: true }) +
            ' now. Import the movie and press JOIN NOW: it jumps straight to where it should be.');
        }
        this.prevNow = now;
        return;
      }

      Late.render(now, newYear);
      const lateNow = Late.position(now) != null;
      if (lateNow !== this.lateNow) { this.lateNow = lateNow; this.renderArmButton(); }

      // The instant of the snap: fire the celebration within one frame of it.
      if (s && Engine.mode === 'armed' && this.prevNow && this.prevNow < s.targetEpoch && now >= s.targetEpoch && now - s.targetEpoch < 4000) {
        // Fired on the clock, not on the film: also when someone has just slipped, or the app was
        // opened a split second before midnight. Only a film that has not started stays quiet.
        if (Engine.phase !== 'standby' && Engine.phase !== 'idle') Celebration.play(s.targetEpoch);
        Engine.logEvent('Target moment reached' + (Engine.st.drift != null ? ', film ' + fmtMs(Engine.st.drift) + ' from the clock' : ''));
      }
      this.prevNow = now;

      /* overlay */
      const ovOn = cfg.showOverlay && (cfg.showClock || cfg.showDate || cfg.showCount || cfg.finalTen);
      setHidden(el.overlay, !ovOn);
      if (ovOn) {
        setHidden(el.ovClock, !cfg.showClock);
        setHidden(el.ovDate, !cfg.showDate);
        if (cfg.showClock) { setText(el.ovTime, cp.hms); setText(el.ovAmpm, cp.ampm); }
        if (cfg.showDate) this.renderDate(date, now, dateLine);
        // 10, 9, 8 …: for the last ten seconds the countdown row itself becomes the big ticking number.
        const cdSnap = s ? C.untilClockSecond(s.targetEpoch, now) : NaN;
        const ten = cfg.finalTen && s && Engine.mode === 'armed' && toSnap > 0 && toSnap <= 10000 ? C.countdownParts(cdSnap).total : 0;
        let showCount = (cfg.showCount || ten > 0) && !!s;
        let done = false;
        if (showCount) {
          if (toSnap > 0) {
            const parts = C.countdownParts(cdSnap);
            setText(el.ovCountLbl, newYear ? 'NEW YEAR IN' : onTarget(s) ? 'THE SNAP IN' : 'THE TARGET IN');
            setText(el.ovCountVal, ten ? String(ten) : parts.d > 0 || parts.h > 0 ? C.fmtCountdown(cdSnap) : C.pad(parts.m) + ':' + C.pad(parts.s));
          } else if (toSnap > -90000 && cfg.showCount) {
            done = true;
            setText(el.ovCountLbl, newYear ? 'HAPPY NEW YEAR' : onTarget(s) ? 'RIGHT ON TIME' : 'TARGET REACHED');
            setText(el.ovCountVal, newYear ? String(new Date(s.targetEpoch).getFullYear()) : '00:00');
          } else {
            showCount = false;
          }
        }
        setHidden(el.ovCount, !showCount);
        el.overlay.classList.toggle('final', ten > 0);
        el.overlay.classList.toggle('done', done);
        if (ten && ten !== this.lastTen) {
          el.ovCountVal.classList.remove('pop');
          void el.ovCountVal.offsetWidth;
          el.ovCountVal.classList.add('pop');
        }
        if (!ten && this.lastTen) el.ovCountVal.classList.remove('pop');
        this.lastTen = ten;
        const badge = cfg.showSyncBadge && Engine.mode === 'armed';
        setHidden(el.ovSync, !badge);
        if (badge) {
          const b = this.syncState();
          setAttr(el.ovSync, 'data-state', b.state === 'wait' ? '' : b.state);
          setText(el.ovSyncTxt, b.short);
        }
      }

      /* standby */
      // The standby screen gives way to the film at the very millisecond the movie launches
      // (9:29:28.348), as its countdown reaches 00:00:00.000. (Play is pressed a few tens of
      // milliseconds earlier, so that the first frame is on screen at that instant: the screen
      // stays up until then.)
      const standby = Engine.mode === 'armed' && cfg.standbyScreen && !!s && now < s.startEpoch &&
        (Engine.phase === 'standby' || ((Engine.phase === 'synced' || Engine.phase === 'cueing') && s.startEpoch - now < 2000 && !el.standby.hidden));
      setHidden(el.standby, !standby);
      if (standby) {
        setCount(el.sbCount, startCountdown(s, now));      // seconds with the clock, reaching zero as the movie launches
        setText(el.sbLine, 'Starts by itself at ' + clockOf(s.startEpoch) + ' · ' +
          C.DAYS_LONG[new Date(s.startEpoch).getDay()] + ', ' + C.MONTHS_LONG[new Date(s.startEpoch).getMonth()] + ' ' + new Date(s.startEpoch).getDate());
        setText(el.sbClock, 'Now ' + (cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms));
      }

      /* subtitles */
      SubsUI.render();

      /* snap point marker while calibrating in free mode */
      if (Media.ready && Engine.mode === 'free' && this.tab === 'setup' && !video.paused) {
        const t = video.currentTime;
        if (this.lastVideoT < cfg.snapSec && t >= cfg.snapSec && t - this.lastVideoT < 0.5) {
          setHidden(el.snapCue, true);
          void el.snapCue.offsetWidth;
          setHidden(el.snapCue, false);
          clearTimeout(this.snapCueTimer);
          this.snapCueTimer = setTimeout(() => setHidden(el.snapCue, true), 1650);
        }
        this.lastVideoT = t;
      } else {
        this.lastVideoT = Media.ready ? video.currentTime : 0;
      }

      /* slip popup text */
      if (!el.slip.hidden || !el.slipPill.hidden) this.renderSlip(now);

      /* test HUD */
      if (Engine.test && Engine.test.kind !== 'night') this.renderTestHud(now, cp);

      /* transport */
      this.renderTransport(now);

      /* panel header clock */
      setText(el.phClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
      setText(el.phDate, C.DAYS[date.getDay()] + ' · ' + C.MONTHS[date.getMonth()] + ' ' + date.getDate() + ' · ' + date.getFullYear());

      /* slower panel work, about 8 times a second, and always on the frame the clock's second
         changes, so the countdown on the status card ticks with the clock */
      const p = performance.now();
      const second = Math.floor(now / 1000);
      const stage = s ? (now < s.startEpoch ? 0 : now < s.targetEpoch ? 1 : 2) : -1;     // the launch and the target are moments too
      if (p - this.lastSlow > 120 || this.dirty.all || second !== this.lastSlowSecond || stage !== this.lastSlowStage) {
        this.lastSlow = p;
        this.lastSlowSecond = second;
        this.lastSlowStage = stage;
        this.renderStatus(now, toStart, toSnap, newYear);
        if (this.tab === 'sync') this.renderSync(now);
        if (this.tab === 'setup') this.renderSetupLive();
        if (cfg.showStats) this.renderStats(now);
        if (this.dirty.preflight || this.dirty.all) { this.dirty.preflight = false; this.renderPreflight(); }
        if ((this.dirty.log || this.dirty.all) && this.tab === 'sync') { this.dirty.log = false; this.renderLog(); }
        this.dirty.all = false;
      }
    },

    /** The date line under the clock. At midnight it rolls over with a small animation. */
    renderDate(date, now, line) {
      const key = C.dateKey(date);
      if (key === this.lastDateKey) { this.lastSimRender = now; return; }
      const natural = this.lastDateKey && Math.abs(now - this.lastSimRender) < 3000;
      this.lastSimRender = now;
      this.lastDateKey = key;
      setText(el.ovDate, line);
      if (natural) {
        el.ovDate.classList.remove('roll');
        void el.ovDate.offsetWidth;
        el.ovDate.classList.add('roll');
      }
    },

    syncState() {
      const e = Engine;
      if (e.mode !== 'armed') return { state: 'free', label: 'FREE PLAY', short: 'FREE PLAY' };
      if (e.phase === 'slipped' || e.phase === 'blocked') return { state: 'bad', label: 'OUT OF SYNC', short: 'OUT OF SYNC' };
      if (e.phase === 'standby') return { state: 'wait', label: 'ARMED · WAITING', short: 'ARMED' };
      if (e.phase === 'cueing') return { state: 'fix', label: 'RECALIBRATING', short: 'RECALIBRATING' };
      if (e.phase === 'synced') {
        const d = e.st.drift;
        if (d == null) return { state: 'fix', label: 'LOCKING ON', short: 'LOCKING ON' };
        if (Math.abs(d) <= 0.045) return { state: 'ok', label: 'IN SYNC', short: 'IN SYNC ' + fmtMs(d) };
        return { state: 'fix', label: 'CORRECTING', short: 'CORRECTING ' + fmtMs(d) };
      }
      return { state: 'free', label: 'READY', short: 'READY' };
    },

    renderStatus(now, toStart, toSnap, newYear) {
      // The New Year's Eve simulation reads like the night itself (only the label says it is one).
      const e = Engine.test && Engine.test.kind === 'night' ? Object.assign(Object.create(Engine), { test: null, sim: true }) : Engine;
      const card = el.statusCard;
      const s = e.session;
      if (!s) return;
      // With a start time chosen by hand the snap is not on the target: say where it lands.
      const late = snapLate(s);
      const landsOn = Math.abs(late) < 0.0005;
      setText(el.ktStart, dateTimeOf(s.startEpoch));
      setText(el.ktSnap, landsOn ? C.fmtDateTime(s.targetEpoch, cfg.use24h) : lateText(late) + ' ' + targetWord(s));
      setText(el.ktSnapLbl, landsOn ? (newYear ? 'The snap lands on midnight' : 'The snap lands') : 'The snap lands');
      el.ktSnap.classList.toggle('off', !landsOn);
      setText(el.startTimeLink, 'Start time: ' + (Engine.test ? 'test run' : startName(cfg.startMode, s)) + ' · change');
      setText(el.ktPoint, C.fmtDuration(cfg.snapSec, { ms: cfg.snapSec % 1 !== 0, forceHours: true }) + (Versions.current().id !== 'original' ? ' · ' + Versions.current().short : ''));

      let state = 'idle';
      let label;
      let big;
      let sub;
      const exp = e.expected(now);
      const cdSnap = C.untilClockSecond(s.targetEpoch, now);
      if (e.mode !== 'armed') {
        if (toStart > 0) { label = 'READY · NOT ARMED'; big = startCountdown(s, now); sub = 'until the movie has to start'; }
        else if (newYear && toSnap <= 0) { label = 'MISSED · NOT ARMED'; big = 'HAPPY NEW YEAR'; sub = 'The countdown did not run this time. Better luck next year.'; }
        else if (Late.position(now) != null) { state = 'slipped'; label = 'LATE · NOT ARMED'; big = C.fmtDuration(Math.max(0, C.filmSecondOnClock(s, now)), { forceHours: true }); sub = 'is where the movie should be now. Press JOIN NOW to jump in.'; }
        else { label = 'READY · NOT ARMED'; big = startCountdown(s, now); sub = 'until the movie has to start'; }
      } else if (e.phase === 'slipped' || e.phase === 'blocked') {
        state = 'slipped'; label = 'OUT OF SYNC';
        big = exp < 0 ? startCountdown(s, now) : fmtOff(offOnClock(now));
        sub = exp < 0 ? 'until the start. Press Recalibrate.' : (video.currentTime < exp ? 'behind the clock. Press Recalibrate.' : 'ahead of the clock. Press Recalibrate.');
      } else if (toStart > 0) {
        state = e.test ? 'test' : 'standby'; label = e.test ? 'TEST RUN · WAITING FOR THE START' : 'ARMED · THE MOVIE STARTS IN';
        big = startCountdown(s, now); sub = 'It starts by itself. Nothing to press.';
      } else if (toSnap > 0) {
        state = e.test ? 'test' : 'synced'; label = (e.test ? 'TEST RUN · ' : 'PLAYING IN SYNC · ') + (newYear ? 'NEW YEAR IN' : onTarget(s) ? 'THE SNAP IN' : 'THE TARGET IN');
        big = C.fmtCountdown(cdSnap); sub = this.syncState().short;
      } else {
        state = e.test ? 'test' : 'done'; label = e.test ? 'TEST RUN' : 'ON TIME';
        big = newYear ? 'HAPPY NEW YEAR' : onTarget(s) ? 'RIGHT ON TIME' : 'TARGET REACHED'; sub = this.syncState().short;
      }
      if (e.test && state !== 'slipped') state = 'test';
      if (e.sim) label = 'SIMULATION · ' + label;
      else if (e.test && e.mode !== 'armed') label = 'TEST RUN · ' + label;      // the late test, before JOIN NOW
      setAttr(card, 'data-state', state);
      setText(el.stLabel, label);
      setCount(el.stBig, big);
      setText(el.stSub, sub);
    },

    renderSlip(now) {
      const e = Engine;
      if (e.phase !== 'slipped') return;
      const exp = e.expected(now);
      let body;
      if (exp < 0) body = 'The movie should still be waiting at the start.';
      else {
        const off = offOnClock(now);
        body = 'The movie is ' + fmtOff(off) + (off < 0 ? ' behind' : ' ahead of') + ' the clock.';
      }
      setText(el.slipBody, body);
      if (cfg.autoRecover && !e.st.slipHold) {
        const left = C.countdownParts(e.st.slipClock + cfg.autoRecoverSec * 1000 - now).total;
        setText(el.slipAuto, 'Recalibrating by itself in ' + left + ' s · or press R, Enter or Space');
      } else {
        setText(el.slipAuto, 'Press R, Enter or Space');
      }
    },

    renderTestHud(now, cp) {
      const t = Engine.test;
      setText(el.thTitle, t.title);
      setText(el.thClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
      if (t.kind === 'late') {
        // The late test's bar is the film: where it should be by the clock, and the snap.
        const dur = video.duration || 1;
        el.thFill.style.width = (clamp(Engine.expected(now) / dur, 0, 1) * 100).toFixed(1) + '%';
        el.thMark.style.left = (clamp(cfg.snapSec / dur, 0, 1) * 100).toFixed(1) + '%';
      } else {
        const end = t.endEpoch || t.eventEpoch + 20000;
        const span = Math.max(1, end - t.t0);
        el.thFill.style.width = (clamp((now - t.t0) / span, 0, 1) * 100).toFixed(1) + '%';
        const mark = (t.kind === 'snap' || t.kind === 'real') && t.snapAt != null ? t.snapAt : t.eventEpoch;
        el.thMark.style.left = (clamp((mark - t.t0) / span, 0, 1) * 100).toFixed(1) + '%';
      }
      const left = t.eventEpoch - now;
      let note;
      // Its countdowns count to the clock second of each moment, so they change with the clock.
      const tick = (ep) => C.countdownParts(C.untilClockSecond(ep, now)).total;
      if (t.result) note = (t.result.ok ? 'PASS: ' : t.result.ok === false ? 'FAIL: ' : '') + t.result.text;
      else if (t.kind === 'start') note = left > 0 ? 'Auto-start in ' + tick(t.eventEpoch) + ' s. Hands off.' : 'Measuring…';
      else if (t.kind === 'snap' || t.kind === 'real') {
        // With a start time chosen by hand the snap and the target are two moments: the snap first if it comes first.
        const toSnapMs = t.snapAt != null ? t.snapAt - now : left;
        note = toSnapMs > 0 ? 'Snap in ' + tick(t.snapAt != null ? t.snapAt : t.eventEpoch) + ' s' : left > 0 ? targetWord(Engine.session).replace(/^m/, 'M') + ' in ' + tick(t.eventEpoch) + ' s' : 'Measuring…';
      }
      else if (t.kind === 'late') {
        const snapAt = Engine.snapEpoch(t.session);
        if (!t.joined) note = Late.showing ? 'You are late: press JOIN NOW, Enter or Space' : 'You are late: click the LATE bar at the top, or JOIN THE MOVIE NOW, to join';
        else if (!t.lockedAt) note = 'Joining: the film goes to where the clock says it should be…';
        else if (!t.watchSnap) note = 'Joined ' + fmtOff(t.firstDrift) + ' from the clock. Checking that it holds…';
        else note = snapAt > now ? 'Joined. Snap in ' + tick(snapAt) + ' s' : left > 0 ? targetWord(t.session).replace(/^m/, 'M') + ' in ' + tick(t.eventEpoch) + ' s' : 'Measuring…';
      }
      else note = t.knockAt ? 'Knocked out of sync: press Recalibrate' : 'Slip coming in ' + tick(t.eventEpoch) + ' s';
      setText(el.thNote, note);
    },

    renderTransport(now) {
      const v = video;
      if (!Media.ready) return;
      const dur = v.duration || 1;
      const cur = v.currentTime;
      const pct = this.seek.dragging ? this.seek.pct : clamp(cur / dur, 0, 1);
      el.seekFill.style.width = (pct * 100).toFixed(3) + '%';
      el.seekThumb.style.left = (pct * 100).toFixed(3) + '%';
      el.seekSnap.style.left = (clamp(cfg.snapSec / dur, 0, 1) * 100).toFixed(3) + '%';
      setHidden(el.seekSnap, cfg.snapSec > dur);
      const exp = Engine.session ? Engine.expected(now) : -1;
      const live = exp >= 0 && exp <= dur && (Engine.mode === 'armed' ? Engine.phase === 'slipped' : true);
      el.seekLive.style.display = live ? 'block' : 'none';
      if (live) el.seekLive.style.left = (clamp(exp / dur, 0, 1) * 100).toFixed(3) + '%';
      // Locked to the clock, the film's seconds change on the same instant as the clock's.
      const locked = Engine.mode === 'armed' && !!Engine.session && (Engine.phase === 'synced' || Engine.phase === 'cueing');
      const shown = this.seek.dragging ? pct * dur : locked ? clamp(C.filmSecondOnClock(Engine.session, now), 0, Math.floor(dur)) : cur;
      setText(el.timeLabel, C.fmtDuration(shown) + ' / ' + C.fmtDuration(dur));

      if (this.dirty.transport || this.dirty.all) {
        this.dirty.transport = false;
        const playing = !v.paused && !v.ended;
        el.btnPlay.innerHTML = playing ? ICON.pause : ICON.play;
        el.btnMute.innerHTML = v.muted || v.volume === 0 ? ICON.mute : ICON.vol;
      }
      const st = Engine.test ? { state: 'test', label: 'TEST · ' + this.syncState().label } : this.syncState();
      setAttr(el.syncChip, 'data-state', st.state);
      setText(el.syncChipTxt, st.label);
    },

    renderSync(now) {
      const e = Engine;
      const st = this.syncState();
      const d = e.mode === 'armed' && e.phase === 'synced' ? e.st.drift : null;
      setAttr(el.syncMeter, 'data-state', st.state);
      setText(el.syState, e.mode === 'armed' ? st.label : 'NOT ARMED');
      if (e.mode === 'armed' && e.phase === 'slipped' && Media.ready) {
        const off = offOnClock(now);
        setText(el.syDrift, (off < 0 ? '−' : '+') + fmtOff(off));
        el.syNeedle.style.left = off < 0 ? '2%' : '98%';
      } else {
        setText(el.syDrift, d == null ? '—' : fmtMs(d));
        el.syNeedle.style.left = (50 + clamp((d || 0) / 0.1, -1, 1) * 48).toFixed(1) + '%';
      }
      setText(el.syPos, Media.ready ? C.fmtDuration(video.currentTime, { ms: true, forceHours: true }) : '—');
      const exp = e.session ? e.expected(now) : NaN;
      setText(el.syExp, !isFinite(exp) ? '—' : exp < 0 ? 'not started (−' + startCountdown(e.session, now) + ')' : C.fmtDuration(exp, { ms: true, forceHours: true }));
      setText(el.syRate, (Media.ready ? video.playbackRate : 1).toFixed(3) + '×');
      const r = NetTime.result;
      setText(el.sySource, NetTime.busy ? 'checking…' : cfg.useNetTime && NetTime.usable() ? 'Internet time (' + r.method.toUpperCase() + ')' : 'PC clock');
      setText(el.syOffset, NetTime.usable() ? NetTime.describe(r.offsetMs) + ' (±' + Math.round(r.uncertaintyMs) + ' ms)' : r && !r.ok ? 'time servers unreachable' : 'not measured');
      setText(el.syRecals, e.st.recals + (e.st.autoRecals ? ' (' + e.st.autoRecals + ' automatic)' : '') + (e.st.slips ? ' · ' + e.st.slips + ' slips' : ''));
      setText(el.syLat, Math.round(cfg.learnedLatency * 1000) + ' ms');
      el.netBtn.disabled = NetTime.busy;
      this.renderGraph();
    },

    renderGraph() {
      const cv = el.syGraph;
      const ctx = cv.getContext('2d');
      const w = cv.width;
      const h = cv.height;
      const css = getComputedStyle(document.documentElement);
      const acc = css.getPropertyValue('--acc').trim() || '#5fe3ff';
      ctx.clearRect(0, 0, w, h);
      const data = Engine.graph;
      let max = 0.06;
      for (const g of data) max = Math.max(max, Math.abs(g.d) * 1.25);
      max = Math.min(max, 0.6);
      const y = (d) => h / 2 - clamp(d / max, -1, 1) * (h / 2 - 10);
      ctx.fillStyle = 'rgba(61,220,151,.10)';
      ctx.fillRect(0, y(0.03), w, y(-0.03) - y(0.03));
      ctx.strokeStyle = 'rgba(255,255,255,.18)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.font = '18px ' + (css.getPropertyValue('--mono') || 'monospace');
      ctx.fillText('+' + Math.round(max * 1000) + ' ms ahead', 10, 22);
      ctx.fillText('−' + Math.round(max * 1000) + ' ms behind', 10, h - 10);
      if (data.length < 2) return;
      const tEnd = performance.now();
      const span = 60000;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const g of data) {
        const x = w - ((tEnd - g.t) / span) * w;
        if (x < 0) continue;
        if (!started) { ctx.moveTo(x, y(g.d)); started = true; } else ctx.lineTo(x, y(g.d));
      }
      ctx.stroke();
    },

    renderSetupLive() {
      const armed = Engine.mode === 'armed' || !!Engine.test;      // (the late test runs with nothing armed)
      el.snapTools.classList.toggle('disabled', armed || !Media.ready);
      setHidden(el.snapArmedNote, !armed);
      setText(el.snapArmedNote, Engine.test ? 'End the test run to calibrate the snap point.' : 'Stop the countdown to calibrate the snap point.');
      const t = Media.ready ? video.currentTime : 0;
      setText(el.snapNow, C.fmtDuration(t, { ms: true, forceHours: true }));
    },

    renderStats(now) {
      const v = video;
      if (!Media.ready) { setText(el.statsHud, 'no movie'); return; }
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      const r = el.stage.getBoundingClientRect();
      const scale = Math.min(r.width / v.videoWidth, r.height / v.videoHeight) * (window.devicePixelRatio || 1);
      const lines = [
        'source     ' + v.videoWidth + '×' + v.videoHeight + (Media.fps ? ' @ ' + Media.fps.toFixed(2) + ' fps' : ''),
        'shown at   ' + Math.round(v.videoWidth * scale) + '×' + Math.round(v.videoHeight * scale) + ' (' + (scale * 100).toFixed(0) + '%)',
        'frames     ' + (q ? q.totalVideoFrames + ' shown, ' + q.droppedVideoFrames + ' dropped' : 'n/a'),
        'speed      ' + v.playbackRate.toFixed(3) + '×',
        'position   ' + C.fmtDuration(v.currentTime, { ms: true, forceHours: true }),
        'clock says ' + (Engine.session ? C.fmtDuration(Engine.expected(now), { ms: true, forceHours: true }) : '—'),
        'drift      ' + fmtMs(Engine.st.drift),
        'phase      ' + Engine.mode + ' / ' + Engine.phase,
        'clock      ' + (Clock.netOffsetMs ? 'internet ' + fmtMs(Clock.netOffsetMs / 1000) : 'PC') + (Clock.testOffsetMs ? ' · TEST' : '')
      ];
      setText(el.statsHud, lines.join('\n'));
    }
  };

  /* ============================================================== wiring === */

  function setCfg(key, value) {
    cfg[key] = value;
    save();
    UI.renderSettings();
    UI.dirty.all = true;
  }

  async function importMovie(info) {
    if (!info) return;
    await Media.load(info, { byUser: true });
  }

  async function pickMovie() {
    try {
      const info = await native.pickMovie();
      if (info) await importMovie(info);
    } catch (e) {
      UI.importError('The file dialog could not be opened: ' + esc(e && e.message));
    }
  }

  function bindToggle(node, key, after) {
    node.addEventListener('change', () => { setCfg(key, node.checked); if (after) after(); });
  }
  function bindSelect(node, key, map, after) {
    node.addEventListener('change', () => { setCfg(key, map ? map(node.value) : node.value); if (after) after(); });
  }

  function applySnap(sec, opts) {
    opts = opts || {};
    if (Engine.mode === 'armed' || Engine.test) { toast(Engine.test ? 'End the test run to change the snap point' : 'Stop the countdown to change the snap point'); UI.renderSettings(); return; }
    if (!(sec > 0) || !isFinite(sec) || sec >= 86400) { el.snapInput.classList.add('bad'); return; }
    el.snapInput.classList.remove('bad');
    cfg.snapSec = Math.round(sec * 1000) / 1000;
    // The cut is what the length of the file says it is, whatever the exact point; only in a file
    // of no known cut does a point of one's own make it "custom".
    const cur = Versions.current();
    if (Versions.guess) cfg.filmVersion = Versions.guess.id;
    else if (cur.snapSec == null || Math.abs(cur.snapSec - cfg.snapSec) > 0.0005) cfg.filmVersion = 'custom';
    cfg.rehearsed = {};
    if (opts.confirmed) cfg.snapConfirmedFor = snapKey();      // somebody (or the app) pointed at the frame: that is a confirmation
    save();
    SnapMemory.put({ how: opts.how || (opts.confirmed ? 'user' : 'typed') });
    Engine.session = Engine.computeFree();
    UI.renderSettings();
    el.snapInput.value = C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true });
    UI.dirty.all = true;
    UI.dirty.preflight = true;
    if (!opts.quiet) toast('Snap point set to ' + C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true }), 'good');
  }

  function wire() {
    /* the fonts change the width of a countdown: fit them again once they are in */
    try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { [el.stBig, el.sbCount, el.imToStart].forEach((n) => { if (n) n.__shape = null; }); }); } catch (e) { /* fitted as it is */ }

    /* the window and the app's own frame never scroll (only the panel, the film strip and lists do):
       if the browser scrolls one of them to bring something into view, it goes straight back */
    const fixed = [document.documentElement, document.body, el.app, el.playerView, el.panel, el.stage].filter(Boolean);
    document.addEventListener('scroll', (e) => {
      const t = e.target === document ? document.scrollingElement : e.target;
      if (fixed.includes(t) && (t.scrollTop || t.scrollLeft)) { t.scrollTop = 0; t.scrollLeft = 0; }
    }, true);

    /* icons */
    $$('[data-icon]').forEach((b) => { b.innerHTML = ICON[b.dataset.icon] || ''; });

    /* themes */
    THEMES.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme';
      b.dataset.id = t.id;
      b.innerHTML = '<div class="sw3"><i style="background:' + t.c[0] + '"></i><i style="background:' + t.c[1] + '"></i><i style="background:' + t.c[2] + '"></i></div><span>' + esc(t.name) + '</span>';
      b.addEventListener('click', () => { cfg.theme = t.id; save(); UI.applyTheme(); UI.dirty.all = true; });
      el.themeGrid.appendChild(b);
    });

    /* film versions */
    C.FILM_VERSIONS.forEach((v) => {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name;
      el.filmVersion.appendChild(o);
    });

    /* sound languages */
    Object.keys(C.LANG_NAMES)
      .sort((a, b) => (a === 'eng' ? -1 : b === 'eng' ? 1 : C.LANG_NAMES[a].localeCompare(C.LANG_NAMES[b])))
      .forEach((k) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = C.LANG_NAMES[k] + (k === 'eng' ? ' (default)' : '');
        el.optAudioLang.appendChild(o);
      });
    el.optAudioLang.addEventListener('change', () => {
      if (Engine.locked()) { UI.renderSettings(); return; }
      cfg.audioLang = C.LANG_NAMES[el.optAudioLang.value] ? el.optAudioLang.value : 'eng';
      save();
      AudioTracks.preferenceChanged();
      Media.soundChanged();
      toast('Preferred sound language: ' + C.langName(cfg.audioLang));
    });
    el.soundTrack.addEventListener('change', () => {
      AudioTracks.select(parseInt(el.soundTrack.value, 10));
      UI.renderSoundTracks();                            // shows what really plays, also when the pick was refused
    });
    el.btnAudio.addEventListener('click', () => AudioTracks.cycle());
    if (AudioTracks.supported) {
      try { video.audioTracks.addEventListener('change', () => { if (Media.ready) { AudioTracks.read(); UI.renderSoundTracks(); } }); } catch (e) { /* no events: the list is re-read on every load anyway */ }
    }

    /* subtitle encodings */
    const encs = SubsCore && SubsCore.ENCODINGS ? SubsCore.ENCODINGS : [{ id: 'auto', label: 'Auto-detect' }];
    encs.forEach((e) => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.label;
      el.subEncoding.appendChild(o);
    });

    /* import */
    el.dropZone.addEventListener('click', pickMovie);
    el.changeMovie.addEventListener('click', pickMovie);
    el.resumeBtn.addEventListener('click', async () => {
      if (cfg.moviePath) {
        const info = await native.openMovie(cfg.moviePath).catch(() => null);
        if (info) { await importMovie(info); return; }
        UI.importError('The movie is no longer at <b>' + esc(cfg.moviePath) + '</b>. Choose it again.');
      }
      pickMovie();
    });
    el.resumeDiscard.addEventListener('click', () => {
      cfg.armed = false; cfg.armedTarget = null; cfg.armedEnd = null; saveNow();
      tellArmed(false);
      UI.renderResume();
    });

    const dropTargets = [el.importView, el.stage];
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });
    dropTargets.forEach((zone) => {
      zone.addEventListener('dragenter', (e) => { if (hasFiles(e)) el.dropZone.classList.add('over'); });
      zone.addEventListener('dragleave', (e) => { if (e.target === zone) el.dropZone.classList.remove('over'); });
      zone.addEventListener('drop', async (e) => {
        el.dropZone.classList.remove('over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        e.preventDefault();
        const p = native.pathForFile(f);
        const isSub = /\.(srt|vtt|ass|ssa)$/i.test(f.name);
        if (isSub) {
          if (!Media.ready) { toast('Import the movie first'); return; }
          try {
            const sub = p ? await native.readSubtitle(p) : { path: '', name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
            await SubsUI.loadFrom(sub);
          } catch (err) { toast('That subtitle file could not be read', 'bad'); }
          return;
        }
        const info = p ? await native.openMovie(p).catch(() => null) : { path: '', name: f.name, size: f.size, url: URL.createObjectURL(f) };
        if (info) importMovie(info);
      });
    });

    /* mission */
    el.armBtn.addEventListener('click', () => {
      if (Engine.test) { if (Engine.lateWaiting()) Late.join('button'); return; }
      if (Engine.mode !== 'armed') { Engine.arm(); return; }
      if (el.armBtn.classList.contains('confirm')) { Engine.disarm(); return; }
      el.armBtn.classList.add('confirm');
      UI.renderArmButton();
      UI.armConfirmTimer = setTimeout(() => { el.armBtn.classList.remove('confirm'); UI.renderArmButton(); }, 3500);
    });
    el.fsBtn.addEventListener('click', () => UI.setFullscreen(!UI.isFs));
    el.fixAudioBtn.addEventListener('click', () => AudioFix.offer());
    el.audioWarn.addEventListener('click', () => setHidden(el.audioWarn, true));

    /* tabs */
    $$('.tab').forEach((t) => t.addEventListener('click', () => UI.showTab(t.dataset.tab)));

    /* sync tab */
    el.recalBtn.addEventListener('click', () => Engine.manualRecalibrate());
    el.netBtn.addEventListener('click', () => NetTime.measure(true));
    bindToggle(el.optNetTime, 'useNetTime', () => { NetTime.apply(true); if (cfg.useNetTime && !NetTime.usable()) NetTime.measure(true); });
    el.openLog.addEventListener('click', () => native.openLog());

    /* test tab */
    $$('[data-test]').forEach((b) => b.addEventListener('click', () => {
      const kind = b.dataset.test;
      if (kind === 'night') { Engine.startTest('night', 0, undefined, { at: el.tsNightAt.value }); return; }
      if (kind === 'late') { Engine.startTest('late', 0, undefined, { by: el.tsLateBy.value }); return; }
      const lead = kind === 'start' ? +el.tsLeadStart.value : kind === 'snap' ? +el.tsLeadSnap.value : 0;
      const pick = kind === 'snap' ? el.tsStartMode.value : 'set';
      Engine.startTest(kind, lead, pick !== 'set' ? pick : undefined);
    }));
    el.thEnd.addEventListener('click', () => Engine.endTest('Stopped by you.'));
    el.nightEnd.addEventListener('click', () => Engine.endTest('Ended by you.'));
    // A drill takes the app away for a while: never across the start, the target or the snap.
    // (`offSec`: how long it is gone; `spare`: room for starting again and getting back in sync.)
    const drillTooClose = (offSec, spare) => {
      const s = Engine.session;
      if (!s) return false;
      const now = Clock.now();
      return [s.startEpoch, s.targetEpoch, Engine.snapEpoch(s)].some((e) => e > now - 20000 && e - now < (offSec + spare) * 1000);
    };
    el.powerBtn.addEventListener('click', () => {
      if (Engine.test) { toast('End the test run first'); return; }
      if (Engine.mode !== 'armed') { toast('Start the countdown first: the app only comes back while it is armed'); return; }
      if (cfg.autoRestart === false) { toast('Switch on "Come back by itself after a crash or a power cut" in Setup first'); return; }
      if (!native.isNative) { toast('Not available in the browser build'); return; }
      const off = +el.tsPowerOff.value || 30;
      if (drillTooClose(off, 120)) { toast('Too close to the start or the snap: the app would be off then. Run it earlier.', 'bad'); return; }
      // Nothing is saved first: a power cut does not wait for that either.
      Engine.logEvent('Power cut test: the app is cut off now and started again in ' + off + ' s');
      toast('Cutting the app off… it comes back in ' + off + ' s', '', 2000);
      setTimeout(() => native.powerCutNow(off), 700);
    });
    el.crashBtn.addEventListener('click', () => {
      if (Engine.test) { toast('End the test run first'); return; }
      if (Engine.mode !== 'armed') { toast('Start the countdown first: recovery only works while it is armed'); return; }
      if (cfg.autoRestart === false) { toast('Switch on "Come back by itself after a crash or a power cut" in Setup first'); return; }
      if (drillTooClose(20, 40)) { toast('Too close to the start or the snap: the app would be off then. Run it earlier.', 'bad'); return; }
      saveNow();
      Engine.logEvent('Crash drill: the app is about to crash on purpose');
      toast('Crashing on purpose… it will be back in a few seconds');
      setTimeout(() => native.crashNow(), 900);
    });

    /* display tab */
    bindToggle(el.optOverlay, 'showOverlay');
    bindToggle(el.optClock, 'showClock');
    bindToggle(el.optDate, 'showDate');
    bindToggle(el.optCount, 'showCount');
    bindToggle(el.optMs, 'showMs', () => { UI.renderSettings(); UI.dirty.all = true; UI.dirty.preflight = true; });
    bindToggle(el.optFinal, 'finalTen', () => { if (cfg.finalTen && !cfg.showOverlay) setCfg('showOverlay', true); });
    bindToggle(el.optSyncBadge, 'showSyncBadge');
    bindToggle(el.optStandby, 'standbyScreen');
    bindSelect(el.optPanel, 'panelSide', null, () => Celebration.resize());
    bindSelect(el.optPos, 'overlayPos');
    bindSelect(el.optSize, 'overlaySize');
    bindSelect(el.opt24h, 'use24h', (v) => v === '24');
    $$('button', el.optCelebration).forEach((b) => b.addEventListener('click', () => setCfg('celebration', b.dataset.v)));
    el.previewCelebration.addEventListener('click', () => {
      if (cfg.celebration === 'off') { toast('The animation is switched off'); return; }
      Celebration.play(Engine.session ? Engine.session.targetEpoch : Date.now());
    });

    /* subs tab */
    el.subLoad.addEventListener('click', () => SubsUI.pick());
    el.subClear.addEventListener('click', () => SubsUI.clear(false));
    el.subToggle.addEventListener('change', () => SubsUI.toggle(el.subToggle.checked));
    el.subDelayMinus.addEventListener('click', () => SubsUI.nudge(-0.1));
    el.subDelayPlus.addEventListener('click', () => SubsUI.nudge(0.1));
    el.subDelayReset.addEventListener('click', () => SubsUI.nudge(0));
    el.subSync.addEventListener('click', () => { if (SubSync.busy) SubSync.cancel(); else SubSync.run(); });
    el.subSyncUndo.addEventListener('click', () => SubSync.revert());
    el.optSubAuto.addEventListener('change', () => {
      cfg.subAutoSync = el.optSubAuto.checked;
      save();
      if (cfg.subAutoSync) SubSync.fileChanged(true); else SubSync.autoKey = '';
      SubsUI.renderPanel();
    });
    bindSelect(el.subSize, 'subSize', null, () => SubsUI.renderPanel());
    bindSelect(el.subBg, 'subBg', null, () => SubsUI.renderPanel());
    bindSelect(el.subColor, 'subColor', null, () => SubsUI.renderPanel());
    bindSelect(el.subPos, 'subPos', null, () => SubsUI.renderPanel());
    bindSelect(el.subEncoding, 'subEncoding', null, () => { if (SubsUI.bytes) { SubsUI.parse(); SubsUI.renderPanel(); } });

    /* setup tab */
    el.snapApply.addEventListener('click', () => applySnap(C.parseDuration(el.snapInput.value)));
    el.snapInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applySnap(C.parseDuration(el.snapInput.value)); el.snapInput.blur(); } });
    el.snapInput.addEventListener('input', () => el.snapInput.classList.toggle('bad', !(C.parseDuration(el.snapInput.value) > 0)));
    el.snapReset.addEventListener('click', () => Versions.choose(Versions.guess ? Versions.guess.id : 'original', true));
    el.snapFind.addEventListener('click', () => SnapCam.find());
    el.findSnapBtn.addEventListener('click', () => SnapCam.find());
    el.stripPrev.addEventListener('click', () => { if (SnapCam.view) SnapCam.select(SnapCam.view.sel - 1); });
    el.stripNext.addEventListener('click', () => { if (SnapCam.view) SnapCam.select(SnapCam.view.sel + 1); });
    el.stripCancel.addEventListener('click', () => SnapCam.close());
    el.stripOk.addEventListener('click', () => SnapCam.ok());
    el.snapCopy.addEventListener('click', async () => {
      const text = UI.snapDetails();
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied. Paste it wherever you need it.', 'good');
      } catch (e) {
        Modal.open({
          title: 'Details of this snap point',
          html: '<textarea class="copybox" readonly rows="8">' + esc(text) + '</textarea>',
          actions: [{ label: 'Close', primary: true, onClick: () => Modal.close() }],
          onEscape: () => Modal.close()
        });
      }
    });
    el.snapShiftTry.addEventListener('click', () => {
      const later = Versions.laterSnap();
      if (later == null || Engine.mode === 'armed' || Engine.test) return;
      applySnap(later);
      UI.openSnapFinder();
    });
    el.filmVersion.addEventListener('change', () => Versions.choose(el.filmVersion.value));
    const free = () => Media.ready && Engine.mode === 'free' && !Engine.test;
    el.snapGoto.addEventListener('click', () => {
      if (!free()) return;
      video.currentTime = clamp(cfg.snapSec - 10, 0, Math.max(0, video.duration - 1));
      UI.lastVideoT = video.currentTime;
      video.play().catch(() => {});
    });
    const step = (d) => { if (!free()) return; if (!video.paused) video.pause(); video.currentTime = clamp(video.currentTime + d, 0, video.duration); };
    el.snapSecBack.addEventListener('click', () => step(-1));
    el.snapSecFwd.addEventListener('click', () => step(1));
    el.snapFrameBack.addEventListener('click', () => step(-1 / (Media.fps || 24)));
    el.snapFrameFwd.addEventListener('click', () => step(1 / (Media.fps || 24)));
    el.snapSetHere.addEventListener('click', () => {
      if (!free()) return;
      const t = isFinite(Media.lastFrameTime) && Math.abs(Media.lastFrameTime - video.currentTime) < 0.1 && video.paused ? Media.lastFrameTime : video.currentTime;
      applySnap(t, { confirmed: true });
    });
    const setTarget = () => {
      if (Engine.mode === 'armed' || Engine.test) { toast(Engine.test ? 'End the test run to change the target' : 'Stop the countdown to change the target'); UI.renderSettings(); return; }
      cfg.targetMode = el.tgCustom.checked ? 'custom' : 'newyear';
      cfg.customTarget = el.tgCustomInput.value || '';
      save();
      Engine.session = Engine.computeFree();
      UI.renderSettings();
      UI.dirty.all = true;
    };
    // Start time: automatic (the snap in the file decides), 9:29:30 PM, or the user's own.
    const setStartMode = (mode) => {
      if (Engine.mode === 'armed' || cfg.armed || Engine.test) { toast(Engine.test && !cfg.armed ? 'End the test run to change the start time' : 'Stop the countdown to change the start time'); UI.renderSettings(); return; }
      const before = startLead();
      cfg.startMode = mode;
      if (Math.abs(startLead() - before) >= 0.0005) cfg.rehearsed = {};      // a rehearsal was of the start time used then
      save();
      Engine.session = Engine.computeFree();
      UI.renderSettings();
      UI.dirty.all = true;
      UI.dirty.preflight = true;
      const sess = Engine.session;
      Engine.logEvent('Start time: ' + startName(mode, sess) + ' (' + dateTimeOf(sess.startEpoch) + '), the snap lands ' + lateText(snapLate(sess)) + ' ' + targetWord(sess));
      toast('The movie starts at ' + clockOf(sess.startEpoch) + ': ' + landsText(sess), 'good');
    };
    [el.smAuto, el.smClassic, el.smOwn].forEach((r) => r.addEventListener('change', () => {
      if (!r.checked) return;
      // The first time, one's own time starts from the time set now; after that it is kept.
      if (r.value === 'own' && cfg.startMode !== 'own' && !cfg.startOwnSet) cfg.startOwnSec = clamp(Math.round(startLead() * 1000) / 1000, 60, 6 * 3600);
      setStartMode(r.value);
    }));
    const ownFromInput = () => C.leadForStartTime(C.parseClockTime(el.smOwnInput.value), (Engine.session || Engine.computeFree()).targetEpoch, 60, 6 * 3600);
    const setOwn = (lead) => {
      if (Engine.mode === 'armed' || cfg.armed || Engine.test) { toast(Engine.test && !cfg.armed ? 'End the test run to change the start time' : 'Stop the countdown to change the start time'); UI.renderSettings(); return; }
      if (!(lead >= 60 && lead <= 6 * 3600)) {
        const sess = Engine.session || Engine.computeFree();
        el.smOwnInput.classList.add('bad');
        toast('Type a start time between six hours and one minute before ' + targetWord(sess) + ', such as ' + C.fmtClockMs(sess.targetEpoch - 9030000, cfg.use24h), 'bad');
        return;
      }
      const before = startLead();
      cfg.startOwnSec = Math.round(lead * 1000) / 1000;
      cfg.startOwnSet = true;
      if (cfg.startMode === 'own' && Math.abs(startLead() - before) >= 0.0005) cfg.rehearsed = {};
      setStartMode('own');
    };
    el.smOwnApply.addEventListener('click', () => setOwn(ownFromInput()));
    el.smOwnInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setOwn(ownFromInput()); el.smOwnInput.blur(); } });
    el.smOwnInput.addEventListener('input', () => el.smOwnInput.classList.toggle('bad', !(ownFromInput() > 0)));
    // A later start leaves less of the film before the target: the lead shrinks.
    const typedLead = () => {
      if (el.smOwnInput.value.trim() === (el.smOwnInput.dataset.shown || '')) return NaN;
      const lead = ownFromInput();
      return lead >= 60 && lead <= 6 * 3600 ? lead : NaN;
    };
    const nudgeStart = (sec) => { const typed = typedLead(); setOwn((Number.isFinite(typed) ? typed : startLead()) - sec); };
    el.smOwnMinus1.addEventListener('click', () => nudgeStart(-1));
    el.smOwnMinus01.addEventListener('click', () => nudgeStart(-0.1));
    el.smOwnPlus01.addEventListener('click', () => nudgeStart(0.1));
    el.smOwnPlus1.addEventListener('click', () => nudgeStart(1));
    el.smTest.addEventListener('click', () => {
      // A time typed in the field but not set yet is what the user wants to try: set it first.
      if (el.smOwnInput.value.trim() !== (el.smOwnInput.dataset.shown || '')) {
        const lead = ownFromInput();
        if (!(lead >= 60 && lead <= 6 * 3600)) { setOwn(lead); return; }
        if (cfg.startMode !== 'own' || Math.abs(lead - cfg.startOwnSec) >= 0.0005) setOwn(lead);
        if (cfg.startMode !== 'own') return;
      }
      UI.showTab('test');
      Engine.startTest('night', 0, undefined, { at: 'snap' });      // New Year's Eve from 11:59:00 PM, with this start time
    });
    el.startTimeLink.addEventListener('click', () => { UI.showTab('setup'); scrollPanelTo(el.startSec, 'start'); });
    el.tgNewYear.addEventListener('change', setTarget);
    el.tgCustom.addEventListener('change', setTarget);
    el.tgCustomInput.addEventListener('change', setTarget);
    bindToggle(el.optAutoRecover, 'autoRecover');
    bindSelect(el.optAutoRecoverSec, 'autoRecoverSec', (v) => +v);
    bindToggle(el.optLock, 'lockControls');
    bindToggle(el.optAutoRestart, 'autoRestart', () => tellArmed(cfg.armed));
    el.resetAll.addEventListener('click', () => {
      if (Engine.mode === 'armed' || Engine.test || cfg.armed) { toast('Stop the countdown first'); return; }
      const keep = { moviePath: cfg.moviePath, movieName: cfg.movieName };
      Object.assign(cfg, DEFAULTS, keep);
      cfg.rehearsed = {};
      cfg.snapByFile = {};
      Versions.recognise();
      saveNow();
      Engine.session = Engine.computeFree();
      NetTime.apply(true);
      UI.refreshAll();
      toast('Settings reset');
    });

    /* slip */
    el.slipBtn.addEventListener('click', () => Engine.recover('button'));
    el.lateBtn.addEventListener('click', () => Late.join('button'));
    el.lateNo.addEventListener('click', () => Late.dismiss());
    el.latePill.addEventListener('click', () => { if (Late.position() != null) Late.join('pill'); else if (Engine.mode === 'free' && !Engine.test) Engine.arm(); });
    el.slipPill.addEventListener('click', () => Engine.recover('button'));
    el.blocked.addEventListener('click', () => Engine.recover('click'));
    el.slipStay.addEventListener('click', () => {
      Engine.st.slipHold = true;
      setHidden(el.slip, true);
      setHidden(el.slipPill, false);
    });

    /* transport */
    el.btnPlay.addEventListener('click', () => Engine.userTogglePlay());
    el.btnBack.addEventListener('click', () => Engine.userSeek(video.currentTime - 10));
    el.btnFwd.addEventListener('click', () => Engine.userSeek(video.currentTime + 10));
    el.btnMute.addEventListener('click', () => { cfg.muted = !cfg.muted; save(); applyVolume(); });
    el.vol.addEventListener('input', () => { cfg.volume = +el.vol.value; cfg.muted = false; save(); applyVolume(); });
    el.btnSubs.addEventListener('click', () => SubsUI.toggle());
    el.btnOverlay.addEventListener('click', () => setCfg('showOverlay', !cfg.showOverlay));
    el.btnLock.addEventListener('click', () => { setCfg('lockControls', !cfg.lockControls); toast(cfg.lockControls ? 'Controls locked while armed' : 'Controls unlocked'); });
    el.btnStats.addEventListener('click', () => setCfg('showStats', !cfg.showStats));
    el.btnFs.addEventListener('click', () => UI.setFullscreen(!UI.isFs));

    // A dropdown that keeps the focus would swallow R, Enter and Space: let go once a choice is made.
    document.addEventListener('change', (e) => { if (e.target && e.target.tagName === 'SELECT') e.target.blur(); });

    // A click on a button must not leave it focused, or the next Space press would click it again.
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b && e.detail > 0) b.blur();
    });

    /* stage */
    el.stage.addEventListener('pointermove', () => UI.wake());
    el.stage.addEventListener('pointerdown', () => UI.wake());
    let clickTimer = 0;
    video.addEventListener('click', () => {
      // While armed a stray click on the picture does nothing: that is the most common accident.
      if (Engine.mode === 'armed') return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => Engine.userTogglePlay(), 220);
    });
    // A double click toggles fullscreen only when BOTH clicks were on the picture. Otherwise a double
    // click on Recalibrate (whose popup vanishes after the first click) would drop out of fullscreen.
    const onPicture = (t) => t === video || t === el.standby || el.standby.contains(t);
    let firstOnPicture = false;
    el.stage.addEventListener('mousedown', (e) => { if (e.detail <= 1) firstOnPicture = onPicture(e.target); }, true);
    el.stage.addEventListener('dblclick', (e) => {
      if (!onPicture(e.target) || !firstOnPicture) return;
      clearTimeout(clickTimer);
      UI.setFullscreen(!UI.isFs);
    });

    /* timeline */
    const pctOf = (e) => {
      const r = el.seekTrack.getBoundingClientRect();
      return clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    };
    const tip = (e) => {
      if (!Media.ready) return;
      const p = pctOf(e);
      const r = el.seek.getBoundingClientRect();
      el.seekTip.style.left = (p * r.width) + 'px';
      setText(el.seekTip, C.fmtDuration(p * video.duration));
      setHidden(el.seekTip, false);
    };
    el.seek.addEventListener('pointerdown', (e) => {
      if (!Media.ready || e.button !== 0) return;
      if (Engine.locked()) return;
      UI.seek.dragging = true;
      UI.seek.pct = pctOf(e);
      el.seek.classList.add('drag');
      try { el.seek.setPointerCapture(e.pointerId); } catch (err) { /* older engines */ }
    });
    el.seek.addEventListener('pointermove', (e) => { if (UI.seek.dragging) UI.seek.pct = pctOf(e); tip(e); });
    el.seek.addEventListener('pointerup', (e) => {
      if (!UI.seek.dragging) return;
      UI.seek.dragging = false;
      el.seek.classList.remove('drag');
      Engine.userSeek(pctOf(e) * video.duration);
    });
    el.seek.addEventListener('pointercancel', () => { UI.seek.dragging = false; el.seek.classList.remove('drag'); });
    el.seek.addEventListener('pointerleave', () => setHidden(el.seekTip, true));

    /* keyboard */
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (Modal.isOpen) { if (k === 'Escape' && Modal.onEscape) Modal.onEscape(); return; }
      const t = e.target;
      const typing = t && (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range'].includes(t.type)));
      if (typing) return;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      // The fullscreen keys work on every screen: a fullscreen window must always have a way out.
      if (lower === 'f' || k === 'F11') { e.preventDefault(); if (!e.repeat) UI.setFullscreen(!UI.isFs); return; }
      // The film strip takes the keyboard while it is open: arrows step frames, Enter sets, Esc closes.
      if (SnapCam.view) { SnapCam.key(e); return; }
      if (SnapCam.busy) return;
      if (k === 'Escape') { if (UI.isFs) UI.setFullscreen(false); return; }
      if (el.app.dataset.view !== 'player') return;
      const slipped = Engine.mode === 'armed' && Engine.phase === 'slipped' && !Engine.st.slipHold;

      // "You are late" is on screen: every key that means "go" joins the film where it should be.
      if (Late.showing && (k === ' ' || k === 'Enter' || lower === 'k' || lower === 'r')) {
        e.preventDefault();
        if (!e.repeat) Late.join('key');
        return;
      }
      if (k === ' ' || lower === 'k') {
        e.preventDefault();
        if (!e.repeat) Engine.userTogglePlay();
        UI.wake();
        return;
      }
      if (k === 'Enter') { if (slipped) { e.preventDefault(); Engine.recover('key'); } return; }
      if (e.repeat && !['ArrowUp', 'ArrowDown', 'z', 'x'].includes(lower)) return;
      switch (lower) {
        case 'r': Engine.manualRecalibrate(); break;
        case 'ArrowLeft': e.preventDefault(); Engine.userSeek(video.currentTime - 10); UI.wake(); break;
        case 'ArrowRight': e.preventDefault(); Engine.userSeek(video.currentTime + 10); UI.wake(); break;
        case 'ArrowUp': e.preventDefault(); cfg.volume = clamp(Math.round((cfg.volume + 0.05) * 100) / 100, 0, 1); cfg.muted = false; save(); applyVolume(); UI.renderSettings(); toast('Volume ' + Math.round(cfg.volume * 100) + '%'); break;
        case 'ArrowDown': e.preventDefault(); cfg.volume = clamp(Math.round((cfg.volume - 0.05) * 100) / 100, 0, 1); save(); applyVolume(); UI.renderSettings(); toast('Volume ' + Math.round(cfg.volume * 100) + '%'); break;
        case 'm': cfg.muted = !cfg.muted; save(); applyVolume(); toast(cfg.muted ? 'Muted' : 'Sound on'); break;
        case 'o': setCfg('showOverlay', !cfg.showOverlay); toast(cfg.showOverlay ? 'Clock overlay on' : 'Clock overlay hidden'); break;
        case 't': setCfg('finalTen', !cfg.finalTen); if (cfg.finalTen && !cfg.showOverlay) setCfg('showOverlay', true); toast(cfg.finalTen ? '10 · 9 · 8 animation on' : '10 · 9 · 8 animation off'); break;
        case 'n': setCfg('showCount', !cfg.showCount); if (cfg.showCount && !cfg.showOverlay) setCfg('showOverlay', true); toast(cfg.showCount ? 'Countdown mode on' : 'Countdown mode off'); break;
        case 'a': AudioTracks.cycle(); break;
        case 'c': SubsUI.toggle(); break;
        case 'z': SubsUI.nudge(-0.1); break;
        case 'x': SubsUI.nudge(0.1); break;
        case 'h': {
          const order = ['stark', 'fireworks', 'minimal', 'off'];
          setCfg('celebration', order[(order.indexOf(cfg.celebration) + 1) % order.length]);
          toast('New Year animation: ' + cfg.celebration);
          break;
        }
        case 'l': setCfg('lockControls', !cfg.lockControls); toast(cfg.lockControls ? 'Controls locked while armed' : 'Controls unlocked'); break;
        case 'i': setCfg('showStats', !cfg.showStats); break;
        default: break;
      }
    });

    native.onFullscreen((flag) => UI.onFullscreen(flag));
  }

  /* ================================================================ boot === */

  // Anything that goes wrong in the page ends up in the log file, where it can be read afterwards.
  window.addEventListener('error', (e) => { try { native.log('page error: ' + e.message + ' (' + String(e.filename).split('/').pop() + ':' + e.lineno + ')'); } catch (err) { /* nothing more to do */ } });
  window.addEventListener('unhandledrejection', (e) => { try { native.log('page rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); } catch (err) { /* nothing more to do */ } });

  async function boot() {
    const wantFs = cfg.armed && cfg.wasFullscreen;
    wire();
    UI.applyTheme();
    Engine.session = Engine.computeFree();
    UI.renderSettings();
    SubsUI.renderPanel();
    Celebration.init();
    UI.onMode();

    Engine.logEvent('Player started' + (cfg.armed ? ' with the countdown armed' : ''));
    Power.init();
    setInterval(() => { try { Engine.tick(); } catch (e) { Engine.logEvent('tick error: ' + (e && e.message)); if (!Engine.tickErr) { Engine.tickErr = true; try { console.error('tick error: ' + (e && e.stack || e)); } catch (err) { /* nothing */ } } } }, 200);
    setInterval(() => NetTime.maybeMeasure(), 60000);
    const loop = () => {
      requestAnimationFrame(loop);
      // A drawing error must not stop the film; it is logged, and reported to the console so the
      // automated tests count it as an error.
      try { UI.frame(); } catch (e) { if (!UI.frameErr) { UI.frameErr = true; Engine.logEvent('render error: ' + (e && e.stack || e)); try { console.error('render error: ' + (e && e.stack || e)); } catch (err) { /* nothing */ } } }
    };
    requestAnimationFrame(loop);

    native.appInfo().then((info) => {
      const v = 'Avengers Player ' + (info.version || '');
      UI.appName = v.trim();
      setText(el.appVersion, v.trim());
      if (info.recovered) {
        Engine.logEvent('The app was restarted by the crash watchdog');
        setTimeout(() => toast('Recovered after a crash', 'good'), 1500);
      }
      el.aboutInfo.textContent = v.trim() + (info.electron ? ' · Electron ' + info.electron + ' · Chromium ' + String(info.chrome).split('.')[0] : '') +
        '. An unofficial fan-made player. It plays your own copy of the film and ships no film content.';
    }).catch(() => {});
    native.isFullscreen().then((flag) => UI.onFullscreen(flag)).catch(() => {});

    // An armed countdown that ended long ago is not worth resuming.
    if (cfg.armed && Number.isFinite(cfg.armedTarget) && Date.now() > Math.max(cfg.armedTarget + 3600000, Number.isFinite(cfg.armedEnd) ? cfg.armedEnd + 600000 : 0)) {
      cfg.armed = false; cfg.armedTarget = null; cfg.armedEnd = null; saveNow();
    }
    if (!Number.isFinite(cfg.armedTarget)) cfg.armed = false;
    tellArmed(cfg.armed);
    // How the last run ended (a power cut, a shutdown): known before anything can restore the countdown.
    try { Recovery.take(native.lastRun()); } catch (e) { /* not known: nothing special is said */ }

    // Know the true time before deciding where the film should be.
    const firstTime = NetTime.measure(false);
    if (cfg.armed) await Promise.race([firstTime, sleep(2500)]);

    UI.showImport();
    try {
      if (cfg.moviePath) {
        let info = null;
        try { info = await native.openMovie(cfg.moviePath); } catch (e) { info = null; }
        if (info) {
          const ok = await Media.load(info);
          if (ok && wantFs) await UI.setFullscreen(true);
        } else if (cfg.armed) {
          UI.importError('The countdown is armed, but the movie cannot be found at <b>' + esc(cfg.moviePath) + '</b>. Plug the drive back in or choose the movie again. The app keeps looking for it.');
        }
      }
    } finally {
      UI.booted = true;               // from here on an armed countdown keeps trying to load the movie by itself
    }
  }

  // For the automated tests and for debugging from the developer tools.
  window.__AP = { Engine: Engine, Clock: Clock, cfg: cfg, Media: Media, AudioTracks: AudioTracks, AudioFix: AudioFix, SnapCam: SnapCam, Late: Late, Missed: Missed, Power: Power, Recovery: Recovery, NetTime: NetTime, SubsUI: SubsUI, SubSync: SubSync, UI: UI, Celebration: Celebration, Versions: Versions, C: C, saveNow: saveNow };

  boot();
})();
