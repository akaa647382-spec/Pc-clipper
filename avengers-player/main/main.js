'use strict';
/**
 * Avengers Player: Electron main process.
 *
 * The renderer (src/) owns the player and the sync engine. This process provides what a web page
 * cannot do reliably on its own: native file access, true fullscreen, keeping the PC awake,
 * real network time (NTP), crash recovery, settings that survive a crash, and the FFmpeg helper.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, powerSaveBlocker, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store } = require('./store');

const IS_TEST = process.env.AP_TEST === '1';
// Tests run against a throwaway profile so they never touch the real settings.
if (process.env.AP_USER_DATA) app.setPath('userData', process.env.AP_USER_DATA);

const USER_DATA = app.getPath('userData');
const LOG_FILE = path.join(USER_DATA, 'avengers-player.log');
const MOVIE_EXT = ['mp4', 'm4v', 'mkv', 'mov', 'webm'];
const SUB_EXT = ['srt', 'vtt', 'ass', 'ssa'];
const MAX_SUB_BYTES = 25 * 1024 * 1024;

/* ------------------------------------------------------------------ logging */

function log(source, message) {
  const line = new Date().toISOString() + ' [' + source + '] ' + String(message).replace(/\s+/g, ' ').slice(0, 2000) + '\n';
  try { fs.appendFileSync(LOG_FILE, line); } catch (e) { /* logging must never break the player */ }
}

function trimLog() {
  try {
    fs.mkdirSync(USER_DATA, { recursive: true });
    const st = fs.statSync(LOG_FILE);
    if (st.size > 2 * 1024 * 1024) {
      const text = fs.readFileSync(LOG_FILE, 'utf8');
      fs.writeFileSync(LOG_FILE, text.slice(-512 * 1024));
    }
  } catch (e) { /* no log yet */ }
}

/** Loads a helper module without letting a failure in it stop the player from starting. */
function optional(name) {
  try { return require(name); } catch (e) { log('main', 'module ' + name + ' unavailable: ' + (e && e.message)); return null; }
}

trimLog();
const ntp = optional('./ntp');
const ffmpeg = optional('./ffmpeg');
const store = new Store(USER_DATA, 'settings.json');

/* ------------------------------------------------------- Chromium behaviour */

// The movie has to start by itself at 9:29:30 PM with nobody touching the PC.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Timers and playback must keep running at full speed when the window is covered or minimised.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Laptops with two GPUs should decode the film on the fast one.
app.commandLine.appendSwitch('force_high_performance_gpu');
// A media key on the keyboard or a Bluetooth headset button must not be able to pause the film,
// and Windows must not treat a covered window as hidden.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,CalculateNativeWinOcclusion');

if (process.platform === 'win32') app.setAppUserModelId('com.avengersplayer.app');

/* ------------------------------------------------------------------- window */

let win = null;
let armed = false;
let quitting = false;
let blockerId = null;
let unresponsiveTimer = null;

function send(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}

function setKeepAwake(on) {
  if (on && blockerId == null) {
    blockerId = powerSaveBlocker.start('prevent-display-sleep');
    log('main', 'keep-awake on');
  } else if (!on && blockerId != null) {
    if (powerSaveBlocker.isStarted(blockerId)) powerSaveBlocker.stop(blockerId);
    blockerId = null;
    log('main', 'keep-awake off');
  }
}

function createWindow() {
  const saved = store.get().window || {};
  const b = saved.bounds || {};
  win = new BrowserWindow({
    width: Number.isFinite(b.width) ? Math.max(1024, b.width) : 1440,
    height: Number.isFinite(b.height) ? Math.max(640, b.height) : 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#04060b',
    show: false,
    autoHideMenuBar: true,
    title: 'Avengers Player',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  if (saved.maximized) win.maximize();

  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Dropping a file on the window must not navigate away from the player, and nothing may open popups.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('enter-full-screen', () => send('win:fullscreen-changed', true));
  win.on('leave-full-screen', () => send('win:fullscreen-changed', false));

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
    if (devtools) { win.webContents.toggleDevTools(); e.preventDefault(); }
  });

  // Crash recovery: bring the page back and the renderer resumes the armed countdown at the right spot.
  win.webContents.on('render-process-gone', (_e, details) => {
    log('main', 'renderer gone: ' + details.reason + ' (' + details.exitCode + ')');
    if (quitting || details.reason === 'clean-exit') return;
    setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 400);
  });
  win.on('unresponsive', () => {
    log('main', 'window unresponsive');
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        log('main', 'still unresponsive after 10 s: restarting the renderer');
        try { win.webContents.forcefullyCrashRenderer(); } catch (e) { win.reload(); }
      }
    }, 10000);
  });
  win.on('responsive', () => { clearTimeout(unresponsiveTimer); log('main', 'window responsive again'); });

  win.on('close', (e) => {
    if (armed && !quitting && !IS_TEST) {
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        buttons: ['Keep waiting', 'Quit anyway'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        title: 'Avengers Player',
        message: 'The countdown is armed.',
        detail: 'If you quit now the movie will not start by itself. Reopen Avengers Player before the start time and it will pick up where the clock says it should be.'
      });
      if (choice === 0) { e.preventDefault(); return; }
    }
    quitting = true;
    try {
      store.merge({ window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } });
    } catch (err) { /* window state is a convenience only */ }
  });
  win.on('closed', () => { win = null; });
}

/* ---------------------------------------------------------------------- IPC */

function fileInfo(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return null;
    return { path: file, name: path.basename(file), size: st.size, url: pathToFileURL(file).href };
  } catch (e) {
    return null;
  }
}

function readSubtitle(file) {
  const ext = path.extname(String(file)).slice(1).toLowerCase();
  if (!SUB_EXT.includes(ext)) throw new Error('Not a subtitle file (.srt, .vtt, .ass, .ssa).');
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Subtitle file not found.');
  if (st.size > MAX_SUB_BYTES) throw new Error('That file is too large to be a subtitle file.');
  return { path: file, name: path.basename(file), bytes: new Uint8Array(fs.readFileSync(file)) };
}

/** Subtitle files that sit next to the movie and share its name ("Movie.srt", "Movie.en.srt"). */
function findSubtitles(moviePath) {
  const out = [];
  try {
    const dir = path.dirname(moviePath);
    const base = path.basename(moviePath, path.extname(moviePath)).toLowerCase();
    const scan = (folder) => {
      let names = [];
      try { names = fs.readdirSync(folder); } catch (e) { return; }
      for (const name of names) {
        const ext = path.extname(name).slice(1).toLowerCase();
        if (!SUB_EXT.includes(ext)) continue;
        const stem = path.basename(name, path.extname(name)).toLowerCase();
        const exact = stem === base;
        if (exact || stem.startsWith(base + '.') || stem.startsWith(base + '-') || stem.startsWith(base + '_') || stem.startsWith(base + ' ')) {
          out.push({ path: path.join(folder, name), name: name, exact: exact });
        }
      }
    };
    scan(dir);
    for (const sub of ['Subs', 'subs', 'Subtitles', 'subtitles']) scan(path.join(dir, sub));
  } catch (e) { /* best effort */ }
  const seen = new Set();
  return out
    .filter((s) => { const k = s.path.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.exact - a.exact) || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function registerIpc() {
  const own = (e) => win && !win.isDestroyed() && e.sender === win.webContents;

  ipcMain.on('state:load', (e) => { e.returnValue = own(e) ? (store.get().renderer || {}) : {}; });
  ipcMain.handle('state:save', (e, obj) => (own(e) ? store.merge({ renderer: obj }) : false));

  ipcMain.on('session:armed', (e, on) => {
    if (!own(e)) return;
    armed = !!on;
    setKeepAwake(armed);
  });

  ipcMain.on('log', (e, line) => { if (own(e)) log('ui', line); });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    logFile: LOG_FILE,
    isTest: IS_TEST
  }));

  ipcMain.handle('movie:pick', async (e) => {
    if (!own(e)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Import the movie',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: MOVIE_EXT }, { name: 'All files', extensions: ['*'] }]
    });
    return r.canceled || !r.filePaths.length ? null : fileInfo(r.filePaths[0]);
  });
  ipcMain.handle('movie:open', (e, file) => (own(e) && typeof file === 'string' ? fileInfo(file) : null));

  ipcMain.handle('subs:pick', async (e) => {
    if (!own(e)) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a subtitle file',
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: SUB_EXT }]
    });
    if (r.canceled || !r.filePaths.length) return null;
    return readSubtitle(r.filePaths[0]);
  });
  ipcMain.handle('subs:read', (e, file) => (own(e) && typeof file === 'string' ? readSubtitle(file) : null));
  ipcMain.handle('subs:find', (e, moviePath) => (own(e) && typeof moviePath === 'string' ? findSubtitles(moviePath) : []));

  ipcMain.handle('win:fullscreen', (e, on) => {
    if (!own(e)) return false;
    win.setFullScreen(!!on);
    return !!on;
  });
  ipcMain.handle('win:is-fullscreen', (e) => (own(e) ? win.isFullScreen() : false));

  ipcMain.handle('shell:show-item', (e, file) => { if (own(e) && typeof file === 'string') shell.showItemInFolder(file); });
  ipcMain.handle('shell:open-log', (e) => (own(e) ? shell.openPath(LOG_FILE) : ''));

  /* ---- internet time ---- */
  let timeBusy = null;
  ipcMain.handle('time:measure', async () => {
    const none = { ok: false, offsetMs: 0, uncertaintyMs: Infinity, method: 'none', servers: [], at: Date.now() };
    if (IS_TEST && (process.env.AP_FAKE_NTP || process.env.AP_FAKE_NTP_FILE)) {
      // Tests stand in for the time servers: a fixed answer, or a file they can rewrite between calls.
      try {
        const raw = process.env.AP_FAKE_NTP_FILE ? fs.readFileSync(process.env.AP_FAKE_NTP_FILE, 'utf8') : process.env.AP_FAKE_NTP;
        return Object.assign(none, JSON.parse(raw), { at: Date.now() });
      } catch (e) { return none; }
    }
    if (!ntp) return none;
    if (!timeBusy) {
      timeBusy = Promise.resolve()
        .then(() => ntp.measure())
        .catch((err) => { log('main', 'time measurement failed: ' + (err && err.message)); return none; })
        .finally(() => { timeBusy = null; });
    }
    return timeBusy;
  });

  /* ---- FFmpeg helper (optional) ---- */
  let ffAbort = null;
  const ffPath = async () => {
    if (!ffmpeg) return null;
    return ffmpeg.locate({ extra: [store.get().ffmpegPath].filter(Boolean), userDataDir: USER_DATA });
  };
  const ffError = (err) => ({ error: (err && err.message) || 'Something went wrong.', aborted: !!(err && err.name === 'AbortError') });

  ipcMain.handle('ff:locate', async () => {
    try { return await ffPath(); } catch (e) { return null; }
  });

  ipcMain.handle('ff:pick', async (e) => {
    if (!own(e) || !ffmpeg) return null;
    const r = await dialog.showOpenDialog(win, {
      title: 'Locate ffmpeg',
      properties: ['openFile'],
      filters: process.platform === 'win32' ? [{ name: 'FFmpeg', extensions: ['exe'] }] : []
    });
    if (r.canceled || !r.filePaths.length) return null;
    store.merge({ ffmpegPath: r.filePaths[0] });
    if (ffmpeg.resetCache) ffmpeg.resetCache();
    return ffPath();
  });

  ipcMain.handle('ff:probe', async (e, file, hevcOk) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      const probe = await ffmpeg.probe(exe, file);
      return { probe: probe, assess: ffmpeg.assess(probe, { hevcOk: !!hevcOk }) };
    } catch (err) {
      return ffError(err);
    }
  });

  ipcMain.handle('ff:convert', async (e, file, audioIndex) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    if (ffAbort) return { error: 'A conversion is already running.' };
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      let output = ffmpeg.suggestOutputPath(file);
      try {
        fs.accessSync(path.dirname(output), fs.constants.W_OK);
      } catch (err) {
        // The movie's folder is read-only (DVD, network share): fall back to the app's own folder.
        const dir = path.join(USER_DATA, 'converted');
        fs.mkdirSync(dir, { recursive: true });
        output = path.join(dir, path.basename(output));
      }
      try {
        const need = fs.statSync(file).size * 1.02;
        const fsStat = await fs.promises.statfs(path.dirname(output));
        const free = Number(fsStat.bavail) * Number(fsStat.bsize);
        if (Number.isFinite(free) && free < need) {
          const gb = (n) => (n / 1073741824).toFixed(1) + ' GB';
          return { error: 'Not enough free disk space: ' + gb(need) + ' needed, ' + gb(free) + ' free on that drive.' };
        }
      } catch (err) { /* cannot tell: let FFmpeg try */ }
      ffAbort = new AbortController();
      log('main', 'converting audio: ' + file + ' -> ' + output);
      const r = await ffmpeg.convertAudio(exe, file, output, {
        audioIndex: Number.isInteger(audioIndex) ? audioIndex : 0,
        signal: ffAbort.signal,
        onProgress: (p) => send('ff:progress', Object.assign({ phase: 'convert' }, p))
      });
      return { movie: fileInfo(r.output), seconds: r.seconds };
    } catch (err) {
      log('main', 'conversion failed: ' + (err && err.message));
      return ffError(err);
    } finally {
      ffAbort = null;
    }
  });

  ipcMain.handle('ff:download', async (e) => {
    if (!own(e) || !ffmpeg) return { error: 'FFmpeg helper unavailable.' };
    if (ffAbort) return { error: 'Another task is already running.' };
    try {
      ffAbort = new AbortController();
      const dest = path.join(USER_DATA, 'ffmpeg');
      await ffmpeg.download(dest, { signal: ffAbort.signal, onProgress: (p) => send('ff:progress', p) });
      if (ffmpeg.resetCache) ffmpeg.resetCache();
      return { path: await ffPath() };
    } catch (err) {
      log('main', 'ffmpeg download failed: ' + (err && err.message));
      return ffError(err);
    } finally {
      ffAbort = null;
    }
  });

  ipcMain.handle('ff:cancel', () => { if (ffAbort) ffAbort.abort(); return true; });

  ipcMain.handle('ff:extract-sub', async (e, file, subIndex) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      const dir = path.join(USER_DATA, 'subs');
      fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, path.basename(file, path.extname(file)) + '.track' + (subIndex | 0) + '.srt');
      await ffmpeg.extractSubtitle(exe, file, subIndex | 0, out, {});
      return { sub: readSubtitle(out) };
    } catch (err) {
      return ffError(err);
    }
  });
}

/* ---------------------------------------------------------------- lifecycle */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    log('main', 'start v' + app.getVersion() + ' electron ' + process.versions.electron);
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => { setKeepAwake(false); app.quit(); });
  app.on('child-process-gone', (_e, details) => log('main', 'child process gone: ' + details.type + ' ' + details.reason));
  process.on('uncaughtException', (err) => log('main', 'uncaught: ' + (err && err.stack)));
  process.on('unhandledRejection', (err) => log('main', 'unhandled rejection: ' + (err && err.stack || err)));
}
