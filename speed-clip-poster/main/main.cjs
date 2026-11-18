'use strict';
// Speed Clip Poster: Electron main process.
//
// Runs in the tray so it can keep watching while the window is closed:
//   * checks Speed's YouTube every few minutes (live? scheduled?),
//   * keeps his stream history and your log of clip-channel locks,
//   * recomputes when to post every minute and alerts you (desktop + optional phone),
//   * checks clips against the server rules.
// It never logs in to Discord and never posts for you: you press post yourself.

const { app, BrowserWindow, Menu, Tray, Notification, dialog, ipcMain, nativeImage, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { Store } = require('./store.cjs');
const ffmpeg = require('./ffmpeg.cjs');
const analyzer = require('./analyze.cjs');
const YT = require('../core/youtube.cjs');
const P = require('../core/predictor.cjs');
const { checkClip } = require('../core/clipcheck.cjs');

if (process.env.SCP_USER_DATA) app.setPath('userData', process.env.SCP_USER_DATA);
const IS_TEST = process.env.SCP_TEST === '1';
const USER_DATA = app.getPath('userData');
const LOG_FILE = path.join(USER_DATA, 'speed-clip-poster.log');
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'];

function log(msg) {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + String(msg).replace(/\s+/g, ' ').slice(0, 2000) + '\n');
  } catch (_) {}
}

const store = new Store(USER_DATA, 'data.json');

const DEFAULT_SETTINGS = {
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  risk: 0.2,
  uploadLimitMB: 10,
  pollMinutes: 5,
  leadMinutes: 15,
  ntfyTopic: '',
  alertOnLive: true,
  openAtLogin: false,
  closeToTray: true,
};

function data() {
  const d = store.get();
  return {
    settings: Object.assign({}, DEFAULT_SETTINGS, d.settings || {}),
    apiKeyEnc: d.apiKeyEnc || null,
    channel: d.channel || null,
    streams: d.streams || [],
    locks: d.locks || [],
    clips: d.clips || [],
    calibration: d.calibration || null,
    lastCheck: d.lastCheck || null,
    lastHistoryFetch: d.lastHistoryFetch || 0,
    notified: d.notified || {},
    ffmpegPath: d.ffmpegPath || null,
    toldAboutTray: !!d.toldAboutTray,
  };
}
function save(patch) {
  store.merge(patch);
  pushState();
}

// --- API key: kept encrypted with Windows' own per-user encryption when available ---
function getKey() {
  const enc = data().apiKeyEnc;
  if (!enc) return '';
  try {
    if (enc.startsWith('enc:') && safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(Buffer.from(enc.slice(4), 'base64'));
    if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf8');
  } catch (e) {
    log('key decrypt failed: ' + e.message);
  }
  return '';
}
function setKey(key) {
  key = String(key || '').trim();
  if (!key) return save({ apiKeyEnc: null });
  const enc = safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(key).toString('base64') : 'plain:' + Buffer.from(key).toString('base64');
  save({ apiKeyEnc: enc });
}

// --- FFmpeg ---
async function ffPath() {
  const d = data();
  return ffmpeg.locate({ userDataDir: USER_DATA, extra: d.ffmpegPath ? [d.ffmpegPath] : [] });
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

let lastPrediction = null;

function predictionNow() {
  const d = data();
  const now = Date.now();
  const lc = d.lastCheck;
  const fresh = lc && now - lc.at < Math.max(30, d.settings.pollMinutes * 3) * 60 * 1000;
  const liveNow = !!(fresh && lc.live);
  const upcoming = fresh && lc.upcoming && lc.upcoming.scheduled ? { scheduled: lc.upcoming.scheduled } : null;
  const streams = d.streams.filter((s) => Number.isFinite(s.start)).map((s) => ({ start: s.start, end: s.end, scheduled: s.scheduled }));
  const options = Object.assign({}, d.calibration ? d.calibration.options : {}, { risk: d.settings.risk });
  try {
    lastPrediction = P.predict({ now, tz: d.settings.tz, streams, locks: d.locks, upcoming, liveNow, options });
    lastPrediction.calibrated = !!d.calibration;
  } catch (e) {
    log('predict failed: ' + e.stack);
    lastPrediction = { status: 'error', error: e.message };
  }
  return lastPrediction;
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

function fmtTime(ms, tz) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
}

async function alert(title, body, { urgent = false } = {}) {
  log('alert: ' + title + ' | ' + body);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, urgency: urgent ? 'critical' : 'normal', silent: false });
      n.on('click', () => showWindow());
      n.show();
    }
  } catch (e) {
    log('notification failed: ' + e.message);
  }
  const topic = data().settings.ntfyTopic;
  if (topic && /^[\w-]{6,64}$/.test(topic) && !IS_TEST) {
    try {
      await fetch('https://ntfy.sh/' + topic, { method: 'POST', body, headers: { Title: title, Priority: urgent ? 'high' : 'default', Tags: urgent ? 'rotating_light' : 'clock3' } });
    } catch (e) {
      log('ntfy failed: ' + e.message);
    }
  }
}

function maybeAlert(pred) {
  const d = data();
  if (!pred || pred.status === 'error' || pred.status === 'live' || !pred.postAt) return;
  const lastStart = d.streams.reduce((m, s) => Math.max(m, s.start || 0), 0);
  const day = new Date(pred.postAt).toISOString().slice(0, 10);
  const key = lastStart + ':' + day;
  const notified = Object.assign({}, d.notified);
  const queued = d.clips.filter((c) => c.status === 'queued').length;
  const what = queued ? (queued === 1 ? 'your clip' : 'your ' + queued + ' clips') : 'a clip';
  let changed = false;
  if (pred.status === 'post-now' && !notified['post:' + key]) {
    notified['post:' + key] = Date.now();
    changed = true;
    alert('POST NOW', 'Post ' + what + ' in the Speed clips channel now. ' + Math.round(pred.within.h2 * 100) + '% chance he is live within 2 h.', { urgent: true });
  } else if (pred.status === 'wait' && pred.postAt - Date.now() <= d.settings.leadMinutes * 60 * 1000 && !notified['lead:' + key] && !notified['post:' + key]) {
    notified['lead:' + key] = Date.now();
    changed = true;
    alert('Get ready', 'Post ' + what + ' at ' + fmtTime(pred.postAt, d.settings.tz) + '. Have it open in Discord.');
  }
  if (changed) {
    // Keep only the last 50 keys.
    const keys = Object.keys(notified).sort((a, b) => notified[b] - notified[a]).slice(0, 50);
    save({ notified: Object.fromEntries(keys.map((k) => [k, notified[k]])) });
  }
}

// ---------------------------------------------------------------------------
// YouTube polling
// ---------------------------------------------------------------------------

let polling = false;
let historyBusy = null; // { done, pages } while fetching

async function pollOnce() {
  if (polling) return;
  polling = true;
  const d = data();
  const key = getKey();
  const prevLive = d.lastCheck && d.lastCheck.live;
  let check;
  try {
    if (key) {
      const channel = d.channel || (await YT.resolveChannel(fetch, key));
      if (!d.channel) save({ channel });
      const r = await YT.checkNow(fetch, key, channel);
      check = { at: Date.now(), via: 'api', live: r.live ? pick(r.live) : null, upcoming: r.upcoming ? pick(r.upcoming) : null, error: null };
      // Recent uploads carry exact times: merge them in.
      const withTimes = r.recent.filter((v) => v.start || v.scheduled);
      if (withTimes.length) save({ streams: YT.mergeStreams(data().streams, withTimes) });
    } else {
      const r = await YT.checkNowNoKey(fetch);
      check = { at: Date.now(), via: 'page', live: r.live, upcoming: r.upcoming, error: null };
      recordLiveWithoutKey(prevLive, check.live);
    }
  } catch (e) {
    log('poll failed: ' + (e && e.message));
    check = Object.assign({}, d.lastCheck || {}, { errorAt: Date.now(), error: e && e.message ? e.message : String(e), errorCode: e && e.code });
  } finally {
    polling = false;
  }
  save({ lastCheck: check });
  if (check.live && !prevLive && data().settings.alertOnLive) alert('Speed is LIVE', check.live.title || 'He just went live on YouTube.', { urgent: true });
  if (!check.live && prevLive && key) refreshHistory(2).catch(() => {});
  tick();
}

function pick(v) {
  return { id: v.id, title: v.title, start: v.start, scheduled: v.scheduled, state: v.state };
}

/** Without a key there is no history API: note when we saw him go live and stop. */
function recordLiveWithoutKey(prevLive, live) {
  const d = data();
  const streams = d.streams.slice();
  if (live && !prevLive && !streams.some((s) => s.id === live.id)) {
    streams.push({ id: live.id, start: Date.now(), end: null, approx: true, title: '' });
    save({ streams });
  } else if (!live && prevLive) {
    const s = streams.find((x) => x.id === prevLive.id && !x.end);
    if (s) {
      s.end = Date.now();
      save({ streams });
    }
  }
}

async function refreshHistory(maxPages) {
  const key = getKey();
  if (!key || historyBusy) return;
  historyBusy = { found: 0, pages: 0, maxPages };
  pushState();
  try {
    const d = data();
    const r = await YT.fetchHistory(fetch, key, {
      maxPages,
      channel: d.channel || undefined,
      onProgress: (found, pages) => {
        historyBusy = { found, pages, maxPages };
        pushState();
      },
    });
    const merged = YT.mergeStreams(data().streams.filter((s) => !s.approx || !r.streams.length), r.streams);
    save({ streams: merged, channel: r.channel, lastHistoryFetch: Date.now(), historyError: null });
    log('history: ' + r.streams.length + ' streams fetched, ' + merged.length + ' stored, quota ' + r.quotaUsed);
    const cal = data().calibration;
    if (!cal || Date.now() - cal.at > 7 * 86400e3 || maxPages > 5) calibrate();
  } catch (e) {
    log('history failed: ' + e.message);
    save({ historyError: e.message });
  } finally {
    historyBusy = null;
    pushState();
  }
}

// ---------------------------------------------------------------------------
// Calibration (in a worker thread: it takes 10-60 s)
// ---------------------------------------------------------------------------

let calibrating = null;

function calibrate() {
  if (calibrating) return;
  const d = data();
  const streams = d.streams.filter((s) => Number.isFinite(s.start)).map((s) => ({ start: s.start, end: s.end, scheduled: s.scheduled }));
  if (streams.length < 25) {
    save({ calibrationNote: 'Needs at least 25 past streams to calibrate (has ' + streams.length + ').' });
    return;
  }
  calibrating = { done: 0, total: 1 };
  pushState();
  const worker = new Worker(path.join(__dirname, '..', 'core', 'calibrate-worker.cjs').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'), {
    workerData: { tz: d.settings.tz, streams, locks: d.locks, days: 90, options: { risk: d.settings.risk } },
  });
  worker.on('message', (m) => {
    if (m.progress) {
      calibrating = m.progress;
      pushState();
    } else if (m.result) {
      save({ calibration: m.result, calibrationNote: null });
      log('calibrated: ' + JSON.stringify(m.result.options) + ' good ' + m.result.after.goodRate);
    } else if (m.error) {
      save({ calibrationNote: 'Calibration failed: ' + m.error });
    }
  });
  worker.on('error', (e) => {
    log('calibrate worker error: ' + e.stack);
    save({ calibrationNote: 'Calibration failed: ' + e.message });
  });
  worker.on('exit', () => {
    calibrating = null;
    tick();
  });
}

// ---------------------------------------------------------------------------
// State for the window
// ---------------------------------------------------------------------------

let win = null;
let tray = null;
let analyzing = null;

function publicState() {
  const d = data();
  const streams = d.streams.filter((s) => Number.isFinite(s.start));
  const cleaned = P.cleanStreams(streams);
  const lockRows = d.locks.map((l) => {
    const gap = P.lockGaps([l], cleaned)[0];
    return { id: l.id, at: l.at, gapMin: Number.isFinite(gap) ? gap : null, liveAt: Number.isFinite(gap) ? l.at + gap * 60000 : null };
  }).sort((a, b) => b.at - a.at);
  return {
    now: Date.now(),
    settings: d.settings,
    hasKey: !!getKey(),
    channel: d.channel,
    lastCheck: d.lastCheck,
    prediction: lastPrediction || predictionNow(),
    streamCount: streams.length,
    firstStream: streams.length ? Math.min(...streams.map((s) => s.start)) : null,
    recentStreams: streams.slice().sort((a, b) => b.start - a.start).slice(0, 15).map((s) => ({ id: s.id, title: s.title, start: s.start, end: s.end, approx: !!s.approx, manual: !!s.manual })),
    historyBusy,
    historyError: store.get().historyError || null,
    lastHistoryFetch: d.lastHistoryFetch,
    locks: lockRows,
    clips: d.clips.map((c) => Object.assign({}, c, { facts: c.facts ? Object.assign({}, c.facts, { hashes: undefined }) : null })).sort((a, b) => b.addedAt - a.addedAt),
    calibration: d.calibration,
    calibrationNote: store.get().calibrationNote || null,
    calibrating,
    analyzing,
    ffmpegPath: ffCached,
    version: app.getVersion(),
  };
}

let ffCached = null;
let pushTimer = null;
function pushState() {
  if (!win || win.isDestroyed()) return;
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  }, 50);
}

function tick() {
  const pred = predictionNow();
  maybeAlert(pred);
  updateTray(pred);
  pushState();
}

function updateTray(pred) {
  if (!tray) return;
  const tz = data().settings.tz;
  let tip = 'Speed Clip Poster';
  if (pred.status === 'live') tip += ': Speed is live';
  else if (pred.status === 'post-now') tip += ': POST NOW';
  else if (pred.postAt) tip += ': post at ' + fmtTime(pred.postAt, tz) + (pred.postAtIsEstimate ? ' (rough)' : '');
  tray.setToolTip(tip);
}

// ---------------------------------------------------------------------------
// Window, tray
// ---------------------------------------------------------------------------

function iconPath() {
  return path.join(__dirname, '..', 'build', 'icon.png');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#0d0f14',
    title: 'Speed Clip Poster',
    icon: iconPath(),
    show: !process.argv.includes('--hidden'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (app.isQuitting || IS_TEST || !data().settings.closeToTray) return;
    e.preventDefault();
    win.hide();
    if (!data().toldAboutTray) {
      save({ toldAboutTray: true });
      alert('Still watching', 'Speed Clip Poster keeps running in the tray so it can alert you. Right-click the tray icon to quit.');
    }
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

function logLock(at) {
  const locks = data().locks.slice();
  locks.push({ id: crypto.randomUUID(), at: at || Date.now() });
  save({ locks });
  tick();
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { label: 'Clips just got locked', click: () => { logLock(); alert('Logged', 'Lock logged at ' + fmtTime(Date.now(), data().settings.tz) + '.'); } },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } catch (e) {
    log('tray failed: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const own = (e) => win && !win.isDestroyed() && e.sender === win.webContents;

function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!own(e)) return { error: 'not allowed' };
    try {
      return await fn(...args);
    } catch (err) {
      log(channel + ' failed: ' + (err && err.stack));
      return { error: err && err.message ? err.message : String(err) };
    }
  });
}

function clipHistory(exceptId) {
  return data().clips.filter((c) => c.status === 'posted' && c.id !== exceptId && c.facts).map((c) => ({ fileName: c.facts.fileName, sha256: c.facts.sha256, hashes: c.facts.hashes, postedAt: c.postedAt }));
}

function updateClip(id, patch) {
  const clips = data().clips.map((c) => (c.id === id ? Object.assign({}, c, patch) : c));
  save({ clips });
  return clips.find((c) => c.id === id);
}

function setupIpc() {
  handle('state:get', async () => publicState());

  handle('settings:save', async (patch) => {
    const s = Object.assign({}, data().settings);
    if (typeof patch.tz === 'string') {
      try { new Intl.DateTimeFormat('en-US', { timeZone: patch.tz }); s.tz = patch.tz; } catch (_) { throw new Error('Unknown time zone: ' + patch.tz); }
    }
    if (Number.isFinite(patch.risk)) s.risk = Math.max(0.02, Math.min(0.5, patch.risk));
    if ([10, 50, 500].includes(patch.uploadLimitMB)) s.uploadLimitMB = patch.uploadLimitMB;
    if (Number.isFinite(patch.pollMinutes)) s.pollMinutes = Math.max(2, Math.min(30, Math.round(patch.pollMinutes)));
    if (Number.isFinite(patch.leadMinutes)) s.leadMinutes = Math.max(0, Math.min(120, Math.round(patch.leadMinutes)));
    if (typeof patch.ntfyTopic === 'string') {
      const t = patch.ntfyTopic.trim();
      if (t && !/^[\w-]{6,64}$/.test(t)) throw new Error('Phone alert topic: 6-64 letters, digits, - or _.');
      s.ntfyTopic = t;
    }
    for (const k of ['alertOnLive', 'openAtLogin', 'closeToTray']) if (typeof patch[k] === 'boolean') s[k] = patch[k];
    if (typeof patch.openAtLogin === 'boolean' && process.platform === 'win32' && !IS_TEST) app.setLoginItemSettings({ openAtLogin: patch.openAtLogin, args: ['--hidden'], name: 'SpeedClipPoster' });
    save({ settings: s });
    if (Number.isFinite(patch.pollMinutes)) schedulePoll();
    tick();
    return { ok: true };
  });

  handle('key:set', async (key) => {
    key = String(key || '').trim();
    if (key) {
      // Check it before keeping it.
      const channel = await YT.resolveChannel(fetch, key);
      setKey(key);
      save({ channel });
      refreshHistory(20).catch(() => {});
      pollOnce();
      return { ok: true, channel };
    }
    setKey('');
    return { ok: true };
  });

  handle('poll:now', async () => { await pollOnce(); return { ok: true }; });
  handle('history:refresh', async () => { refreshHistory(20); return { ok: true }; });
  handle('calibrate:run', async () => { calibrate(); return { ok: true }; });

  handle('lock:add', async (at) => { logLock(Number.isFinite(at) ? at : Date.now()); return { ok: true }; });
  handle('lock:remove', async (id) => { save({ locks: data().locks.filter((l) => l.id !== id) }); tick(); return { ok: true }; });
  handle('stream:add', async (at) => {
    if (!Number.isFinite(at)) throw new Error('Pick a time.');
    const streams = data().streams.slice();
    streams.push({ id: 'manual-' + crypto.randomUUID(), start: at, end: null, manual: true, title: 'Added by hand' });
    save({ streams });
    tick();
    return { ok: true };
  });
  handle('stream:remove', async (id) => { save({ streams: data().streams.filter((s) => s.id !== id || !(s.manual || s.approx)) }); tick(); return { ok: true }; });

  handle('test:alert', async () => { await alert('Test alert', 'This is how a "post now" alert looks.', { urgent: true }); return { ok: true }; });

  // --- FFmpeg ---
  handle('ff:locate', async () => (ffCached = await ffPath()));
  handle('ff:download', async () => {
    await ffmpeg.download(path.join(USER_DATA, 'ffmpeg'), { onProgress: (p) => win && win.webContents.send('ff:progress', p) });
    ffmpeg.resetCache();
    return { path: (ffCached = await ffPath()) };
  });
  handle('ff:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Find ffmpeg', properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'FFmpeg', extensions: ['exe'] }] : [] });
    if (r.canceled || !r.filePaths.length) return { path: ffCached };
    save({ ffmpegPath: r.filePaths[0] });
    ffmpeg.resetCache();
    return { path: (ffCached = await ffPath()) };
  });

  // --- Clips ---
  handle('clip:pick', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a clip', properties: ['openFile'], filters: [{ name: 'Videos', extensions: VIDEO_EXT }] });
    return r.canceled ? null : r.filePaths[0];
  });

  handle('clip:analyze', async (file, caption) => {
    if (analyzing) throw new Error('Already checking a clip.');
    if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error('That file is not there any more.');
    const exe = await ffPath();
    if (!exe) throw new Error('FFmpeg is needed to check clips. Get it on the Settings tab.');
    analyzing = { file: path.basename(file), step: 'Starting' };
    log('check clip: ' + file);
    pushState();
    try {
      const facts = await analyzer.analyze(exe, file, {
        ocrDataDir: path.join(USER_DATA, 'ocr'),
        onStep: (s) => { log('  ' + s); analyzing = { file: path.basename(file), step: s }; pushState(); },
      });
      const id = crypto.randomUUID();
      const result = checkClip(facts, { caption, uploadLimitMB: data().settings.uploadLimitMB, history: clipHistory(id) });
      const clip = { id, addedAt: Date.now(), status: 'checked', caption: String(caption || ''), facts, result };
      save({ clips: [clip, ...data().clips].slice(0, 300) });
      return { id };
    } finally {
      analyzing = null;
      pushState();
    }
  });

  handle('clip:recheck', async (id, caption) => {
    const c = data().clips.find((x) => x.id === id);
    if (!c) throw new Error('Clip not found.');
    const result = checkClip(c.facts, { caption, uploadLimitMB: data().settings.uploadLimitMB, history: clipHistory(id) });
    updateClip(id, { caption: String(caption || ''), result });
    return { ok: true };
  });

  handle('clip:small-copy', async (id) => {
    const c = data().clips.find((x) => x.id === id);
    if (!c) throw new Error('Clip not found.');
    if (analyzing) throw new Error('Busy with another clip.');
    const exe = await ffPath();
    if (!exe) throw new Error('FFmpeg is needed.');
    const limit = data().settings.uploadLimitMB;
    analyzing = { file: c.facts.fileName, step: 'Making a ' + limit + ' MB copy' };
    pushState();
    let out;
    try {
      out = await analyzer.makeSmallCopy(exe, c.facts.filePath, limit, { onStep: (s) => { analyzing = { file: c.facts.fileName, step: s }; pushState(); } });
    } finally {
      analyzing = null;
      pushState();
    }
    // Check the copy as its own clip, with the same message.
    return analyzeAgain(out.file, c.caption);
  });

  handle('clip:set-status', async (id, status) => {
    if (!['checked', 'queued', 'posted'].includes(status)) throw new Error('bad status');
    const patch = { status };
    if (status === 'posted') patch.postedAt = Date.now();
    updateClip(id, patch);
    tick();
    return { ok: true };
  });
  handle('clip:remove', async (id) => { save({ clips: data().clips.filter((c) => c.id !== id) }); return { ok: true }; });
  handle('clip:show', async (id) => {
    const c = data().clips.find((x) => x.id === id);
    if (c && fs.existsSync(c.facts.filePath)) shell.showItemInFolder(c.facts.filePath);
    else throw new Error('The file is not there any more.');
    return { ok: true };
  });

  handle('open:link', async (which) => {
    const links = {
      apikey: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
      credentials: 'https://console.cloud.google.com/apis/credentials',
      ntfy: 'https://ntfy.sh/',
      log: null,
    };
    if (which === 'log') return shell.openPath(LOG_FILE);
    if (!links[which]) throw new Error('unknown link');
    await shell.openExternal(links[which]);
    return { ok: true };
  });
}

async function analyzeAgain(file, caption) {
  const exe = await ffPath();
  analyzing = { file: path.basename(file), step: 'Checking the copy' };
  pushState();
  try {
    const facts = await analyzer.analyze(exe, file, { ocrDataDir: path.join(USER_DATA, 'ocr'), onStep: (s) => { analyzing = { file: path.basename(file), step: s }; pushState(); } });
    const id = crypto.randomUUID();
    const result = checkClip(facts, { caption, uploadLimitMB: data().settings.uploadLimitMB, history: clipHistory(id) });
    save({ clips: [{ id, addedAt: Date.now(), status: 'checked', caption: String(caption || ''), facts, result }, ...data().clips].slice(0, 300) });
    return { id, file };
  } finally {
    analyzing = null;
    pushState();
  }
}

// ---------------------------------------------------------------------------
// Timers and start-up
// ---------------------------------------------------------------------------

let pollTimer = null;
function schedulePoll() {
  if (pollTimer) clearInterval(pollTimer);
  if (IS_TEST && process.env.SCP_NO_POLL === '1') return;
  pollTimer = setInterval(pollOnce, data().settings.pollMinutes * 60 * 1000);
}

if (!IS_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.speedclipposter.app');
    setupIpc();
    createWindow();
    createTray();
    ffCached = await ffPath().catch(() => null);
    tick();
    if (!(IS_TEST && process.env.SCP_NO_POLL === '1')) {
      pollOnce();
      const d = data();
      if (getKey() && (!d.streams.filter((s) => !s.approx).length || Date.now() - d.lastHistoryFetch > 86400e3)) refreshHistory(d.streams.length ? 2 : 20);
    }
    schedulePoll();
    setInterval(tick, 60 * 1000);
  });
  app.on('before-quit', () => { app.isQuitting = true; analyzer.closeOcr(); });
  app.on('window-all-closed', () => {
    if (IS_TEST || !data().settings.closeToTray) app.quit();
  });
}

module.exports = { publicState };
