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
      ffPick: async () => null, ffProbe: no, ffConvert: no, ffDownload: no, ffExtractSub: no,
      async ffCancel() { return true; },
      onFfProgress() {},
      async appInfo() { return { version: 'dev', electron: '', chrome: '', platform: 'browser', logFile: '', isTest: false }; },
      showItem() {}, openLog() {}, log() {}
    };
  }
  const native = window.apNative || browserShim();

  /* ============================================================ settings === */

  const DEFAULTS = {
    theme: 'arc',
    panelSide: 'left',
    snapSec: C.DEFAULT_SNAP_SEC,
    targetMode: 'newyear', customTarget: '',
    use24h: false,
    showOverlay: true, showClock: true, showDate: true, showCount: true, showSyncBadge: true, finalTen: true,
    overlayPos: 'tl', overlaySize: 'm',
    celebration: 'stark',
    standbyScreen: true,
    autoRecover: true, autoRecoverSec: 10,
    autoRestart: true,
    lockControls: false,
    useNetTime: true,
    volume: 1, muted: false,
    showStats: false,
    subsOn: true, subPath: '', subName: '', subMovie: '', subEncoding: 'auto',
    subSize: 'm', subBg: 'shadow', subColor: 'white', subPos: 'low', subDelay: 0,
    armed: false, armedTarget: null, moviePath: '', movieName: '', wasFullscreen: false,
    learnedLatency: 0.07, learnedSeekLead: 0.6,
    rehearsed: {}
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
    if (!(c.volume >= 0 && c.volume <= 1)) c.volume = 1;
    if (!(c.autoRecoverSec >= 1 && c.autoRecoverSec <= 120)) c.autoRecoverSec = 10;
    if (!(Math.abs(c.subDelay) < 600)) c.subDelay = 0;
    c.learnedLatency = clamp(+c.learnedLatency || 0.07, 0, 0.3);
    c.learnedSeekLead = clamp(+c.learnedSeekLead || 0.6, 0.4, 6);
    if (typeof c.rehearsed !== 'object' || Array.isArray(c.rehearsed)) c.rehearsed = {};
    if (c.armedTarget !== null && !Number.isFinite(c.armedTarget)) { c.armedTarget = null; c.armed = false; }
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
  const fmtOff = (sec) => {
    const a = Math.abs(sec);
    if (a < 1) return Math.round(a * 1000) + ' ms';
    if (a < 90) return a.toFixed(1) + ' s';
    return C.fmtDuration(a);
  };

  /* ============================================================== toasts === */

  function toast(text, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = text;
    el.toasts.appendChild(t);
    while (el.toasts.children.length > 3) el.toasts.firstChild.remove();
    setTimeout(() => t.remove(), 3300);
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

  function detectAudio(afterPlayback) {
    try {
      if (video.audioTracks && typeof video.audioTracks.length === 'number') return video.audioTracks.length > 0;
      if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio;
      if (typeof video.webkitAudioDecodedByteCount === 'number') {
        if (video.webkitAudioDecodedByteCount > 0) return true;
        return afterPlayback ? false : null;
      }
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
      if (this.ready || this.loading || !cfg.armed || !cfg.moviePath || !native.isNative) return;
      if (perf < (this.retryAt || 0)) return;
      this.retries = (this.retries || 0) + 1;
      this.retryAt = perf + (this.retries <= 12 ? 5000 : 30000);
      if (this.retries === 1) Engine.logEvent('The movie is not available: it will be tried again every few seconds');
      native.openMovie(cfg.moviePath).then((info) => {
        if (info && !this.ready && !this.loading && cfg.armed) return this.load(info, { retry: true });
        return false;
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
      UI.audioWarning('');

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
      this.hasAudio = detectAudio(false);
      cfg.moviePath = info.path || '';
      cfg.movieName = info.name || '';
      save();
      video.playbackRate = 1;
      applyVolume();
      Engine.session = Engine.computeFree();
      UI.showPlayer();
      UI.refreshAll();
      Engine.logEvent('Movie loaded: ' + info.name + ' (' + video.videoWidth + '×' + video.videoHeight + ', ' + C.fmtDuration(video.duration) + ')');

      // Resume an armed countdown straight away: timing first, inspection afterwards.
      if (cfg.armed && !opts.noResume) await Engine.arm({ restore: true });
      this.inspect(token);
      SubsUI.autoLoad(token);
      return true;
    },

    /** Uses FFmpeg (when present) to learn exactly what is inside the file. */
    async inspect(token) {
      if (!this.info || !this.info.path || !native.isNative) return;
      let r = null;
      try {
        const hevcOk = !!video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
        r = await native.ffProbe(this.info.path, hevcOk);
      } catch (e) { r = null; }
      if (token !== this.loadToken || !r || !r.probe) { UI.dirty.preflight = true; return; }
      this.probe = r.probe;
      this.assess = r.assess || null;
      if (r.assess) {
        if (r.assess.needsAudioFix) this.setAudio(false, r.assess.reasons && r.assess.reasons[0]);
        else if (r.assess.audioOk) this.setAudio(true);
        else if (!r.probe.audio || !r.probe.audio.length) this.setAudio(false, 'This file has no sound track.');
      }
      SubsUI.renderEmbedded();
      UI.dirty.preflight = true;
      UI.renderFileCard();
    },

    setAudio(has, reason) {
      const changed = this.hasAudio !== has;
      this.hasAudio = has;
      this.audioReason = reason || '';
      UI.dirty.preflight = true;
      UI.renderFileCard();
      if (has) { UI.audioWarning(''); return; }
      if (!changed) return;
      const fixable = !this.probe || (this.probe.audio && this.probe.audio.length > 0);
      UI.audioWarning((reason || 'No sound could be decoded from this file.') + (fixable ? ' Use “Fix the sound” in the Mission tab.' : ''));
      Engine.logEvent('Sound problem: ' + (reason || 'no sound decoded'));
      if (fixable && Engine.mode === 'free' && !Engine.test) AudioFix.offer();
    },

    async explainFailure(info, loaded, hadVideo) {
      const name = '<b>' + esc(info.name || 'This file') + '</b>';
      let detail = '';
      if (info.path && native.isNative) {
        try {
          const r = await native.ffProbe(info.path, !!video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"'));
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

  /* ============================================================== engine === */

  const Engine = {
    mode: 'free',        // free | armed
    phase: 'idle',       // idle | standby | cueing | synced | slipped | blocked
    session: null,       // { targetEpoch, startEpoch, endEpoch, snapSec }
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
        nowMs: Clock.now(), snapSec: cfg.snapSec, durationSec: this.duration(),
        targetMode: cfg.targetMode, customTargetMs: customTargetMs()
      });
    },

    sessionFor(targetEpoch) {
      return C.computeSession({
        nowMs: Clock.now(), snapSec: cfg.snapSec, durationSec: this.duration(),
        targetMode: 'custom', customTargetMs: targetEpoch
      });
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
      const toSnap = this.session.targetEpoch - now;
      return (toStart > -5000 && toStart < 120000) || (toSnap > -20000 && toSnap < 120000);
    },

    /* ---- arming ---------------------------------------------------------- */

    async arm(opts) {
      opts = opts || {};
      if (!Media.ready || this.test) return;
      let target = opts.restore && Number.isFinite(cfg.armedTarget) ? cfg.armedTarget : this.computeFree().targetEpoch;
      let s = this.sessionFor(target);
      if (s.endEpoch != null && Clock.now() >= s.endEpoch - 1000) {
        if (opts.restore) {
          cfg.armed = false; cfg.armedTarget = null; saveNow();
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
      saveNow();
      tellArmed(true);
      this.logEvent((opts.restore ? 'Countdown resumed' : 'Countdown armed') + ': movie starts ' + C.fmtDateTime(s.startEpoch, cfg.use24h));
      UI.onMode();
      // Not awaited: before the start time this only finishes when the film starts, and whoever
      // armed (startup, the button) has other things to do meanwhile.
      this.recalibrate('arm').catch((e) => this.logEvent('Recalibration failed: ' + (e && e.message)));
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
      cfg.armed = false; cfg.armedTarget = null; saveNow();
      tellArmed(false);
      if (Media.ready) { video.playbackRate = 1; if (!video.paused) video.pause(); }
      UI.hideSlip();
      this.session = this.computeFree();
      this.setPhase('idle');
      this.logEvent('Countdown stopped');
      UI.onMode();
    },

    /** Drops everything in flight (used when another movie is loaded). The saved armed flag is kept. */
    hardReset() {
      this.token++;
      this.dropWaiter();
      if (this.test) { Clock.testOffsetMs = 0; this.test = null; UI.onTest(); }
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
      const counted = reason !== 'arm' && reason !== 'test';
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
      cfg.armed = false; cfg.armedTarget = null; saveNow();
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
      this.st.slipHold = false;
      this.st.slips++;
      this.setPhase('slipped');
      this.logEvent('Slipped (' + reason + ')');
      UI.showSlip();
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

    startTest(kind, leadSec) {
      if (!Media.ready) { toast('Import the movie first'); return; }
      if (this.test) return;
      const wasArmed = this.mode === 'armed';
      if (wasArmed && this.phase !== 'standby') { toast('The real movie is playing: tests are off until it ends', 'bad'); return; }
      const realNow = Clock.real();
      const real = wasArmed ? this.session : this.computeFree();
      if (wasArmed && real.startEpoch - realNow < 180000) { toast('Too close to the real start time for a test', 'bad'); return; }

      const dur = video.duration;
      const s = this.sessionFor(real.targetEpoch);
      let simNow;
      let eventEpoch;
      let endEpoch = null;
      let title;
      if (kind === 'start') {
        simNow = s.startEpoch - leadSec * 1000;
        eventEpoch = s.startEpoch;
        endEpoch = s.startEpoch + 9000;
        title = 'Auto-start test';
      } else if (kind === 'snap') {
        if (dur < cfg.snapSec + 2) { toast('This file ends before the snap point. Check the snap point in Setup.', 'bad'); return; }
        const lead = Math.min(leadSec, Math.max(3, cfg.snapSec - 1));
        simNow = s.targetEpoch - lead * 1000;
        eventEpoch = s.targetEpoch;
        endEpoch = s.targetEpoch + Math.max(8000, Celebration.duration() + 1500);
        title = 'Snap test';
      } else {
        const pos = clamp(Math.min(cfg.snapSec * 0.5, dur * 0.4), Math.min(20, dur * 0.2), Math.max(1, dur - 60));
        simNow = s.startEpoch + pos * 1000;
        eventEpoch = simNow + 6000;
        title = 'Slip and recovery drill';
      }

      this.token++;
      this.dropWaiter();
      Clock.testOffsetMs = simNow - realNow;
      this.test = {
        kind: kind, title: title, t0: simNow, eventEpoch: eventEpoch, endEpoch: endEpoch,
        wasArmed: wasArmed, prevSession: wasArmed ? real : null,
        eventDone: false, result: null, knockAt: 0, recoveredAt: 0, note: ''
      };
      this.session = s;
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
      if (t.kind === 'snap' && t.eventDone && !t.result) {
        const d = this.st.drift;
        if (this.phase === 'synced' && d != null) {
          t.result = { ok: Math.abs(d) <= 0.06, title: 'Snap test', text: 'The snap frame hit midnight ' + (Math.abs(d) < 0.001 ? 'exactly' : fmtOff(d) + (d > 0 ? ' early' : ' late')) + '.' };
        } else if (performance.now() - t.eventAt > 2000) {
          t.result = { ok: false, title: 'Snap test', text: 'The film was not in sync at midnight (' + this.phase + ').' };
        }
      }
      if (t.kind === 'slip' && t.knockAt && !t.result && this.phase === 'synced' && this.st.drift != null && performance.now() - this.st.syncedAt > 1200) {
        const took = (this.st.syncedAt - t.knockAt) / 1000;
        t.result = { ok: Math.abs(this.st.drift) <= 0.1, title: 'Slip and recovery drill', text: 'Recovered ' + took.toFixed(1) + ' s after the slip, now ' + fmtMs(this.st.drift) + ' from the clock.' };
        t.endEpoch = now + 5000;
      }
      if (t.endEpoch != null && now >= t.endEpoch) this.endTest();
    },

    endTest(why) {
      const t = this.test;
      if (!t) return;
      this.token++;
      this.dropWaiter();
      Clock.testOffsetMs = 0;
      this.test = null;
      Celebration.stop();
      UI.hideSlip();
      el.blocked.hidden = true;
      if (Media.ready) { video.playbackRate = 1; if (!video.paused) video.pause(); }
      const result = t.result || { ok: null, title: t.title, text: why || 'Ended before the result was in.' };
      if (result.ok) { cfg.rehearsed[t.kind] = true; save(); }
      UI.addTestResult(result);
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
      if (this.mode !== 'armed') {
        this.session = this.computeFree();
        this.trackAudio();
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
          if (cfg.autoRecover && !this.st.slipHold && perf - this.st.slipAt >= cfg.autoRecoverSec * 1000) this.recover('automatic');
          break;
        }
        default:
          break;
      }
      this.trackAudio();
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
      }

      if (r.action === 'hard') { this.autoRecal('drift', r.drift); return; }
      if (Math.abs(v.playbackRate - r.rate) > 0.0005) v.playbackRate = r.rate;
      this.st.rate = r.rate;
    },

    /** Confirms that sound is really being decoded once the film has played for a moment. */
    trackAudio() {
      if (!Media.ready || Media.hasAudio != null) return;
      if (video.paused || video.seeking || video.readyState < 3) return;
      Media.playedMs += 200;
      if (Media.playedMs < 1600) return;
      const a = detectAudio(true);
      if (a != null) Media.setAudio(a, a ? '' : 'No sound could be decoded from this file (the sound is probably Dolby or DTS).');
    }
  };

  /* ---- video events: anything the engine did not do itself is a slip ---- */

  video.addEventListener('pause', () => {
    if (Engine.mode === 'armed' && Engine.phase === 'synced' && !video.ended && Media.ready) {
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
  video.addEventListener('volumechange', () => { UI.dirty.transport = true; });
  video.addEventListener('error', () => {
    if (!Media.ready) return;
    Engine.logEvent('Video error: ' + (video.error ? video.error.message || video.error.code : 'unknown'));
    const nowP = performance.now();
    Media.errorTimes = (Media.errorTimes || []).filter((t) => nowP - t < 60000);
    Media.errorTimes.push(nowP);
    const info = Media.info;
    if (Media.errorTimes.length > 3 || !info) { toast('The video keeps failing to play', 'bad'); return; }
    toast('The video reported an error. Recovering…', 'bad');
    setTimeout(() => { if (Media.info === info) Media.load(info); }, 800);
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
      if (Engine.mode === 'free') Engine.session = Engine.computeFree();
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
    shown: null, found: [],

    get loaded() { return !!this.index && this.cues.length > 0; },

    clear(silent) {
      this.cues = []; this.index = null; this.bytes = null; this.name = ''; this.path = '';
      this.shown = null;
      el.subs.textContent = '';
      if (!silent) { cfg.subPath = ''; cfg.subName = ''; cfg.subMovie = ''; save(); }
      this.renderPanel();
    },

    async loadFrom(sub, opts) {
      opts = opts || {};
      if (!SubsCore) { toast('Subtitle support is unavailable', 'bad'); return false; }
      if (!sub || !sub.bytes) return false;
      this.bytes = sub.bytes instanceof Uint8Array ? sub.bytes : new Uint8Array(sub.bytes);
      this.name = sub.name || 'subtitles';
      this.path = sub.path || '';
      if (!opts.keepDelay) cfg.subDelay = 0;
      const ok = this.parse();
      if (!ok) {
        toast('No subtitles found in that file', 'bad');
        this.clear(true);
        return false;
      }
      cfg.subPath = this.path;
      cfg.subName = this.name;
      cfg.subMovie = Media.info ? (Media.info.path || Media.info.name) : '';
      if (!opts.auto) cfg.subsOn = true;
      save();
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
      const moviePath = Media.info.path;
      try {
        this.found = await native.findSubtitles(moviePath) || [];
      } catch (e) { this.found = []; }
      if (token !== Media.loadToken) return;
      let sub = null;
      try {
        if (cfg.subPath && cfg.subMovie === moviePath) sub = await native.readSubtitle(cfg.subPath);
        if (sub) { if (token === Media.loadToken) await this.loadFrom(sub, { keepDelay: true, auto: true, quiet: true }); }
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
      cfg.subDelay = delta === 0 ? 0 : Math.round((cfg.subDelay + delta) * 10) / 10;
      save();
      this.shown = null;
      this.renderPanel();
      if (this.loaded) toast('Subtitle delay ' + (cfg.subDelay > 0 ? '+' : '') + cfg.subDelay.toFixed(1) + ' s');
    },

    /** Runs every frame; touches the DOM only when the set of visible lines changes. */
    render() {
      if (!this.index || !cfg.subsOn || !Media.ready) {
        if (this.shown !== false) { el.subs.textContent = ''; this.shown = false; }
        return;
      }
      const active = SubsCore.activeAt(this.index, video.currentTime - cfg.subDelay);
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
      el.subDelay.textContent = (cfg.subDelay > 0 ? '+' : '') + cfg.subDelay.toFixed(1) + ' s';
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
            if (r && r.sub) await this.loadFrom(r.sub); else toast((r && r.error) || 'Could not read that track', 'bad');
          } catch (e) { toast('Could not read that track', 'bad'); }
          b.disabled = false;
        });
        el.subEmbedded.appendChild(b);
      });
    }
  };

  /* =========================================================== audio fix === */

  const AudioFix = {
    running: false,

    async offer() {
      if (this.running || Modal.isOpen || !Media.info || !Media.info.path || !native.isNative) return;
      const exe = await native.ffLocate().catch(() => null);
      const why = esc(Media.audioReason || 'The sound in this file is in a format this player cannot decode.');
      if (exe) {
        Modal.open({
          title: 'This movie would play without sound',
          html: why + '<br><br>Fix it now? Only the sound is converted; <b>the picture is copied untouched</b>, so there is no quality loss. It takes a minute or two and makes a new file next to the movie.',
          actions: [
            { label: 'Not now', onClick: () => Modal.close() },
            { label: 'Fix the sound', primary: true, onClick: () => this.convert() }
          ],
          onEscape: () => Modal.close()
        });
      } else {
        const canDownload = native.platform === 'win32';
        Modal.open({
          title: 'This movie would play without sound',
          html: why + '<br><br>Avengers Player can fix this in a minute or two, with no picture quality loss, using the free tool <b>FFmpeg</b>.' +
            (canDownload ? ' It is a one-time download of about 100 MB.' : ''),
          actions: [
            { label: 'Not now', onClick: () => Modal.close() },
            { label: 'I have FFmpeg…', onClick: async () => { const p = await native.ffPick(); if (p) this.convert(); else toast('That is not a working FFmpeg', 'bad'); } }
          ].concat(canDownload ? [{ label: 'Download and fix', primary: true, onClick: () => this.download() }] : []),
          onEscape: () => Modal.close()
        });
      }
    },

    async download() {
      this.running = true;
      Modal.open({
        title: 'Downloading FFmpeg',
        html: 'One-time download. The file is verified before it is used.',
        progress: true, note: 'Starting…',
        actions: [{ label: 'Cancel', onClick: () => native.ffCancel() }]
      });
      const r = await native.ffDownload().catch((e) => ({ error: e && e.message }));
      this.running = false;
      if (r && r.path) { this.convert(); return; }
      Modal.close();
      if (!(r && r.aborted)) toast((r && r.error) || 'The download failed', 'bad');
    },

    async convert() {
      if (!Media.info || !Media.info.path) return;
      this.running = true;
      const source = Media.info;
      const wasArmed = Engine.mode === 'armed' && !Engine.test;
      Modal.open({
        title: 'Fixing the sound',
        html: 'Converting the sound to AAC. The picture is copied bit for bit.' + (wasArmed ? ' The countdown stays armed.' : ''),
        progress: true, note: 'Starting…',
        actions: [{ label: 'Cancel', onClick: () => native.ffCancel() }]
      });
      const idx = Media.assess && Number.isInteger(Media.assess.audioIndex) ? Media.assess.audioIndex : 0;
      const r = await native.ffConvert(source.path, idx).catch((e) => ({ error: e && e.message }));
      this.running = false;
      Modal.close();
      if (r && r.movie) {
        Engine.logEvent('Sound fixed: ' + r.movie.name);
        const ok = await Media.load(r.movie);
        if (ok) toast('Sound fixed. Now using ' + r.movie.name, 'good');
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
      const title = newYear ? 'HAPPY NEW YEAR' : 'RIGHT ON TIME';
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
    { id: 'midnight', name: 'Midnight Gold', c: ['#14110a', '#c8901e', '#f6c453'] }
  ];
  const CELEB_HINT = {
    stark: 'Golden dust sweeps in and assembles into HAPPY NEW YEAR, then blows away. The snap, in reverse.',
    fireworks: 'Classic fireworks with a gold title.',
    minimal: 'A small banner only. Nothing covers the scene.',
    off: 'No animation. The date under the clock still rolls over to January 1.'
  };

  const setText = (node, text) => { if (node.__t !== text) { node.__t = text; node.textContent = text; } };
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
      el.resumeText.textContent = 'The movie is set to start ' + C.fmtDateTime(s.startEpoch, cfg.use24h) +
        '. Open ' + (cfg.movieName ? '“' + cfg.movieName + '”' : 'the movie') + ' again and playback jumps straight to where the clock says it should be.';
      el.resumeBtn.textContent = cfg.moviePath ? 'Resume with ' + (cfg.movieName || 'the movie') : 'Choose the movie';
    },

    audioWarning(text) {
      el.audioWarn.textContent = text || '';
      setHidden(el.audioWarn, !text);
      setHidden(el.fixAudioBtn, !(text && Media.info && Media.info.path && native.isNative && (!Media.probe || (Media.probe.audio || []).length > 0)));
    },

    /* ---- reactions to engine changes ---- */

    onMode() {
      el.app.dataset.mode = Engine.test ? 'test' : Engine.mode;
      this.dirty.all = true;
      clearTimeout(this.armConfirmTimer);
      el.armBtn.classList.remove('confirm');
      this.renderArmButton();
    },

    onPhase() {
      el.app.dataset.phase = Engine.phase;
      this.dirty.all = true;
      this.wake();
    },

    onTest() {
      setHidden(el.testHud, !Engine.test);
      el.app.dataset.mode = Engine.test ? 'test' : Engine.mode;
      $$('[data-test]').forEach((b) => { b.disabled = !!Engine.test; });
      this.dirty.all = true;
      this.renderArmButton();
    },

    renderArmButton() {
      const b = el.armBtn;
      b.disabled = !!Engine.test || !Media.ready;
      b.classList.toggle('armed', Engine.mode === 'armed' && !Engine.test);
      if (Engine.test) setText(b, 'TEST RUNNING');
      else if (Engine.mode === 'armed') setText(b, b.classList.contains('confirm') ? 'CLICK AGAIN TO STOP' : 'COUNTDOWN ARMED');
      else setText(b, 'START THE COUNTDOWN');
      setText(el.armHint, Engine.mode === 'armed' && !Engine.test
        ? 'Armed. You can go fullscreen and walk away: the movie starts itself. Click the button twice to stop the countdown.'
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
      if (Media.info.size) parts.push((Media.info.size / 1073741824).toFixed(2) + ' GB');
      const p = Media.probe;
      if (p && p.video && p.video.codec) parts.push(String(p.video.codec).toUpperCase());
      if (p && p.audio && p.audio[0]) parts.push(String(p.audio[0].codec).toUpperCase());
      setText(el.fileMeta, parts.join(' · '));
    },

    renderSettings() {
      el.optOverlay.checked = cfg.showOverlay;
      el.optClock.checked = cfg.showClock;
      el.optDate.checked = cfg.showDate;
      el.optCount.checked = cfg.showCount;
      el.optFinal.checked = cfg.finalTen;
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
        if (Media.hasAudio === true) items.push([true, 'Sound is playable', Media.probe && Media.probe.audio && Media.probe.audio[0] ? String(Media.probe.audio[0].codec).toUpperCase() : '']);
        else if (Media.hasAudio === false) items.push([false, 'No playable sound in this file', 'Use “Fix the sound” below.']);
        else items.push([null, 'Sound not verified yet', 'It is checked the moment the movie plays. Run a test.']);
        if (v.duration >= cfg.snapSec + 2) items.push([true, 'The file reaches the snap point', 'Snap at ' + C.fmtDuration(cfg.snapSec, { ms: cfg.snapSec % 1 !== 0 })]);
        else items.push([false, 'The file ends before the snap point', 'It is only ' + C.fmtDuration(v.duration) + ' long. Wrong file, or set the snap point in Setup.']);
      } else {
        items.push([null, 'No movie loaded', '']);
      }
      const r = NetTime.result;
      if (NetTime.usable() && cfg.useNetTime) items.push([true, 'Clock checked against internet time', 'PC clock is ' + NetTime.describe(r.offsetMs) + (Math.abs(r.offsetMs) >= 20 ? ', corrected' : '')]);
      else if (NetTime.usable()) items.push([Math.abs(r.offsetMs) < 500 ? null : false, 'PC clock is ' + NetTime.describe(r.offsetMs), 'Correction is switched off in the Sync tab.']);
      else items.push([null, NetTime.busy ? 'Checking internet time…' : 'Internet time not available', 'Using the PC clock as it is. Make sure Windows shows the right time.']);
      items.push([native.isNative ? true : null, 'The PC stays awake while armed', native.isNative ? '' : 'Not available in the browser build.']);
      const reh = cfg.rehearsed || {};
      if (reh.start && reh.snap) items.push([true, 'Rehearsed', 'Auto-start and snap tests passed' + (reh.slip ? ', recovery drill too' : '') + '.']);
      else items.push([null, 'Not rehearsed yet', 'Run the auto-start and snap tests in the Test tab.']);
      if (SubsUI.loaded) items.push([true, 'Subtitles ready', SubsUI.name + (cfg.subsOn ? '' : ' (hidden)')]);

      el.preflight.innerHTML = items.map((it) => '<li data-ok="' + (it[0] == null ? '' : it[0]) + '"><span>' + esc(it[1]) + (it[2] ? '<small>' + esc(it[2]) + '</small>' : '') + '</span></li>').join('');
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

      if (view === 'import') {
        setText(el.imClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
        setText(el.imDate, dateLine);
        if (s) {
          setText(el.imToStart, toStart > 0 ? C.fmtCountdown(toStart) : 'RUNNING');
          setText(el.imStartAt, C.fmtDateTime(s.startEpoch, cfg.use24h));
          setText(el.imToSnap, toSnap > 0 ? C.fmtCountdown(toSnap) : 'NOW');
          setText(el.imSnapAt, C.fmtDateTime(s.targetEpoch, cfg.use24h));
          setText(el.imSnapLbl, newYear ? 'NEW YEAR IN' : 'THE SNAP IN');
          setText(el.imStart, C.fmtClock(new Date(s.startEpoch), cfg.use24h));
        }
        this.prevNow = now;
        return;
      }

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
        const ten = cfg.finalTen && s && Engine.mode === 'armed' && toSnap > 0 && toSnap <= 10000 ? C.countdownParts(toSnap).total : 0;
        let showCount = (cfg.showCount || ten > 0) && !!s;
        let done = false;
        if (showCount) {
          if (toSnap > 0) {
            const parts = C.countdownParts(toSnap);
            setText(el.ovCountLbl, newYear ? 'NEW YEAR IN' : 'THE SNAP IN');
            setText(el.ovCountVal, ten ? String(ten) : parts.d > 0 || parts.h > 0 ? C.fmtCountdown(toSnap) : C.pad(parts.m) + ':' + C.pad(parts.s));
          } else if (toSnap > -90000 && cfg.showCount) {
            done = true;
            setText(el.ovCountLbl, newYear ? 'HAPPY NEW YEAR' : 'RIGHT ON TIME');
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
      const standby = Engine.mode === 'armed' && Engine.phase === 'standby' && cfg.standbyScreen && toStart > 250;
      setHidden(el.standby, !standby);
      if (standby) {
        setText(el.sbCount, C.fmtCountdown(toStart));
        setText(el.sbLine, 'Starts by itself at ' + C.fmtClock(new Date(s.startEpoch), cfg.use24h) + ' · ' +
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
      if (Engine.test) this.renderTestHud(now, cp);

      /* transport */
      this.renderTransport(now);

      /* panel header clock */
      setText(el.phClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
      setText(el.phDate, C.DAYS[date.getDay()] + ' · ' + C.MONTHS[date.getMonth()] + ' ' + date.getDate() + ' · ' + date.getFullYear());

      /* slower panel work, about 8 times a second */
      const p = performance.now();
      if (p - this.lastSlow > 120 || this.dirty.all) {
        this.lastSlow = p;
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
      const e = Engine;
      const card = el.statusCard;
      const s = e.session;
      if (!s) return;
      setText(el.ktStart, C.fmtDateTime(s.startEpoch, cfg.use24h));
      setText(el.ktSnap, C.fmtDateTime(s.targetEpoch, cfg.use24h));
      setText(el.ktSnapLbl, newYear ? 'The snap lands on midnight' : 'The snap lands');
      setText(el.ktPoint, C.fmtDuration(cfg.snapSec, { ms: cfg.snapSec % 1 !== 0, forceHours: true }));

      let state = 'idle';
      let label;
      let big;
      let sub;
      const exp = e.expected(now);
      if (e.mode !== 'armed') {
        if (toStart > 0) { label = 'READY · NOT ARMED'; big = C.fmtCountdown(toStart); sub = 'until the movie has to start'; }
        else if (toSnap > 0) { label = 'LATE · NOT ARMED'; big = C.fmtDuration(exp, { forceHours: true }); sub = 'is where the movie should be now. Start the countdown to jump in.'; }
        else { label = 'READY · NOT ARMED'; big = C.fmtCountdown(Math.max(0, toStart)); sub = 'until the movie has to start'; }
      } else if (e.phase === 'slipped' || e.phase === 'blocked') {
        state = 'slipped'; label = 'OUT OF SYNC';
        big = exp < 0 ? C.fmtCountdown(toStart) : fmtOff(video.currentTime - exp);
        sub = exp < 0 ? 'until the start. Press Recalibrate.' : (video.currentTime < exp ? 'behind the clock. Press Recalibrate.' : 'ahead of the clock. Press Recalibrate.');
      } else if (toStart > 0) {
        state = e.test ? 'test' : 'standby'; label = e.test ? 'TEST RUN · WAITING FOR THE START' : 'ARMED · THE MOVIE STARTS IN';
        big = C.fmtCountdown(toStart); sub = 'It starts by itself. Nothing to press.';
      } else if (toSnap > 0) {
        state = e.test ? 'test' : 'synced'; label = e.test ? 'TEST RUN · THE SNAP IN' : (newYear ? 'PLAYING IN SYNC · NEW YEAR IN' : 'PLAYING IN SYNC · THE SNAP IN');
        big = C.fmtCountdown(toSnap); sub = this.syncState().short;
      } else {
        state = e.test ? 'test' : 'done'; label = e.test ? 'TEST RUN' : 'ON TIME';
        big = newYear ? 'HAPPY NEW YEAR' : 'RIGHT ON TIME'; sub = this.syncState().short;
      }
      if (e.test && state !== 'slipped') state = 'test';
      setAttr(card, 'data-state', state);
      setText(el.stLabel, label);
      setText(el.stBig, big);
      setText(el.stSub, sub);
    },

    renderSlip(now) {
      const e = Engine;
      if (e.phase !== 'slipped') return;
      const exp = e.expected(now);
      let body;
      if (exp < 0) body = 'The movie should still be waiting at the start.';
      else {
        const off = video.currentTime - exp;
        body = 'The movie is ' + fmtOff(off) + (off < 0 ? ' behind' : ' ahead of') + ' the clock.';
      }
      setText(el.slipBody, body);
      if (cfg.autoRecover && !e.st.slipHold) {
        const left = Math.max(0, Math.ceil(cfg.autoRecoverSec - (performance.now() - e.st.slipAt) / 1000));
        setText(el.slipAuto, 'Recalibrating by itself in ' + left + ' s · or press R, Enter or Space');
      } else {
        setText(el.slipAuto, 'Press R, Enter or Space');
      }
    },

    renderTestHud(now, cp) {
      const t = Engine.test;
      setText(el.thTitle, t.title);
      setText(el.thClock, cp.ampm ? cp.hms + ' ' + cp.ampm : cp.hms);
      const end = t.endEpoch || t.eventEpoch + 20000;
      const span = Math.max(1, end - t.t0);
      el.thFill.style.width = (clamp((now - t.t0) / span, 0, 1) * 100).toFixed(1) + '%';
      el.thMark.style.left = (clamp((t.eventEpoch - t.t0) / span, 0, 1) * 100).toFixed(1) + '%';
      const left = t.eventEpoch - now;
      let note;
      if (t.result) note = (t.result.ok ? 'PASS: ' : 'FAIL: ') + t.result.text;
      else if (t.kind === 'start') note = left > 0 ? 'Auto-start in ' + C.countdownParts(left).total + ' s. Hands off.' : 'Measuring…';
      else if (t.kind === 'snap') note = left > 0 ? 'Snap in ' + C.countdownParts(left).total + ' s' : 'Measuring…';
      else note = t.knockAt ? 'Knocked out of sync: press Recalibrate' : 'Slip coming in ' + C.countdownParts(left).total + ' s';
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
      setText(el.timeLabel, C.fmtDuration(this.seek.dragging ? pct * dur : cur) + ' / ' + C.fmtDuration(dur));

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
        const off = video.currentTime - e.expected(now);
        setText(el.syDrift, (off < 0 ? '−' : '+') + fmtOff(off));
        el.syNeedle.style.left = off < 0 ? '2%' : '98%';
      } else {
        setText(el.syDrift, d == null ? '—' : fmtMs(d));
        el.syNeedle.style.left = (50 + clamp((d || 0) / 0.1, -1, 1) * 48).toFixed(1) + '%';
      }
      setText(el.syPos, Media.ready ? C.fmtDuration(video.currentTime, { ms: true, forceHours: true }) : '—');
      const exp = e.session ? e.expected(now) : NaN;
      setText(el.syExp, !isFinite(exp) ? '—' : exp < 0 ? 'not started (−' + C.fmtDuration(-exp) + ')' : C.fmtDuration(exp, { ms: true, forceHours: true }));
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
      const armed = Engine.mode === 'armed';
      el.snapTools.classList.toggle('disabled', armed || !Media.ready);
      setHidden(el.snapArmedNote, !armed);
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
    await Media.load(info);
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

  function applySnap(sec) {
    if (Engine.mode === 'armed') { toast('Stop the countdown to change the snap point'); UI.renderSettings(); return; }
    if (!(sec > 0) || !isFinite(sec) || sec >= 86400) { el.snapInput.classList.add('bad'); return; }
    el.snapInput.classList.remove('bad');
    cfg.snapSec = Math.round(sec * 1000) / 1000;
    cfg.rehearsed = {};
    save();
    Engine.session = Engine.computeFree();
    el.snapInput.value = C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true });
    UI.dirty.all = true;
    UI.dirty.preflight = true;
    toast('Snap point set to ' + C.fmtDuration(cfg.snapSec, { ms: true, forceHours: true }), 'good');
  }

  function wire() {
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
      cfg.armed = false; cfg.armedTarget = null; saveNow();
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
      if (Engine.test) return;
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
      const lead = kind === 'start' ? +el.tsLeadStart.value : kind === 'snap' ? +el.tsLeadSnap.value : 0;
      Engine.startTest(kind, lead);
    }));
    el.thEnd.addEventListener('click', () => Engine.endTest('Stopped by you.'));

    /* display tab */
    bindToggle(el.optOverlay, 'showOverlay');
    bindToggle(el.optClock, 'showClock');
    bindToggle(el.optDate, 'showDate');
    bindToggle(el.optCount, 'showCount');
    bindToggle(el.optFinal, 'finalTen');
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
    bindSelect(el.subSize, 'subSize', null, () => SubsUI.renderPanel());
    bindSelect(el.subBg, 'subBg', null, () => SubsUI.renderPanel());
    bindSelect(el.subColor, 'subColor', null, () => SubsUI.renderPanel());
    bindSelect(el.subPos, 'subPos', null, () => SubsUI.renderPanel());
    bindSelect(el.subEncoding, 'subEncoding', null, () => { if (SubsUI.bytes) { SubsUI.parse(); SubsUI.renderPanel(); } });

    /* setup tab */
    el.snapApply.addEventListener('click', () => applySnap(C.parseDuration(el.snapInput.value)));
    el.snapInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { applySnap(C.parseDuration(el.snapInput.value)); el.snapInput.blur(); } });
    el.snapInput.addEventListener('input', () => el.snapInput.classList.toggle('bad', !(C.parseDuration(el.snapInput.value) > 0)));
    el.snapReset.addEventListener('click', () => applySnap(C.DEFAULT_SNAP_SEC));
    const free = () => Media.ready && Engine.mode === 'free';
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
      applySnap(t);
    });
    const setTarget = () => {
      if (Engine.mode === 'armed') { toast('Stop the countdown to change the target'); UI.renderSettings(); return; }
      cfg.targetMode = el.tgCustom.checked ? 'custom' : 'newyear';
      cfg.customTarget = el.tgCustomInput.value || '';
      save();
      Engine.session = Engine.computeFree();
      UI.renderSettings();
      UI.dirty.all = true;
    };
    el.tgNewYear.addEventListener('change', setTarget);
    el.tgCustom.addEventListener('change', setTarget);
    el.tgCustomInput.addEventListener('change', setTarget);
    bindToggle(el.optAutoRecover, 'autoRecover');
    bindSelect(el.optAutoRecoverSec, 'autoRecoverSec', (v) => +v);
    bindToggle(el.optLock, 'lockControls');
    bindToggle(el.optAutoRestart, 'autoRestart', () => tellArmed(cfg.armed));
    el.resetAll.addEventListener('click', () => {
      if (Engine.mode === 'armed' || Engine.test) { toast('Stop the countdown first'); return; }
      const keep = { moviePath: cfg.moviePath, movieName: cfg.movieName };
      Object.assign(cfg, DEFAULTS, keep);
      cfg.rehearsed = {};
      saveNow();
      Engine.session = Engine.computeFree();
      NetTime.apply(true);
      UI.refreshAll();
      toast('Settings reset');
    });

    /* slip */
    el.slipBtn.addEventListener('click', () => Engine.recover('button'));
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
      if (el.app.dataset.view !== 'player') return;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      const slipped = Engine.mode === 'armed' && Engine.phase === 'slipped' && !Engine.st.slipHold;

      if (lower === 'f' || k === 'F11') { e.preventDefault(); if (!e.repeat) UI.setFullscreen(!UI.isFs); return; }
      if (k === 'Escape') { if (UI.isFs) UI.setFullscreen(false); return; }
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
        case 't': setCfg('finalTen', !cfg.finalTen); toast(cfg.finalTen ? '10 · 9 · 8 animation on' : '10 · 9 · 8 animation off'); break;
        case 'n': setCfg('showCount', !cfg.showCount); if (cfg.showCount && !cfg.showOverlay) setCfg('showOverlay', true); toast(cfg.showCount ? 'Countdown mode on' : 'Countdown mode off'); break;
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
    UI.renderSettings();
    SubsUI.renderPanel();
    Celebration.init();
    Engine.session = Engine.computeFree();
    UI.onMode();

    Engine.logEvent('Player started' + (cfg.armed ? ' with the countdown armed' : ''));
    setInterval(() => { try { Engine.tick(); } catch (e) { Engine.logEvent('tick error: ' + (e && e.message)); } }, 200);
    setInterval(() => NetTime.maybeMeasure(), 60000);
    const loop = () => {
      requestAnimationFrame(loop);
      try { UI.frame(); } catch (e) { if (!UI.frameErr) { UI.frameErr = true; Engine.logEvent('render error: ' + (e && e.stack || e)); } }
    };
    requestAnimationFrame(loop);

    native.appInfo().then((info) => {
      const v = 'Avengers Player ' + (info.version || '');
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
    if (cfg.armed && Number.isFinite(cfg.armedTarget) && Date.now() > cfg.armedTarget + 3600000) {
      cfg.armed = false; cfg.armedTarget = null; saveNow();
    }
    if (!Number.isFinite(cfg.armedTarget)) cfg.armed = false;
    tellArmed(cfg.armed);

    // Know the true time before deciding where the film should be.
    const firstTime = NetTime.measure(false);
    if (cfg.armed) await Promise.race([firstTime, sleep(2500)]);

    UI.showImport();
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
    UI.booted = true;
  }

  // For the automated tests and for debugging from the developer tools.
  window.__AP = { Engine: Engine, Clock: Clock, cfg: cfg, Media: Media, NetTime: NetTime, SubsUI: SubsUI, UI: UI, Celebration: Celebration, C: C, saveNow: saveNow };

  boot();
})();
