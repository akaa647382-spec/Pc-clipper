'use strict';
/**
 * Avengers Player: Electron main process.
 *
 * The renderer (src/) owns the player and the sync engine. This process provides what a web page
 * cannot do reliably on its own: native file access, true fullscreen, keeping the PC awake,
 * real network time (NTP), crash recovery, settings that survive a crash, and the FFmpeg helper.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, powerMonitor, powerSaveBlocker, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const os = require('os');
const { Store, writeDurable } = require('./store');
const { classifyLastRun } = require('./lastrun');
const { withDuration } = require('./webm');

const IS_TEST = process.env.AP_TEST === '1';
const STARTED_AT = Date.now();                              // when this instance was started (the power cut test reports it)
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
let sessionEnding = false;           // Windows is shutting down, restarting or signing out
let comeBack = false;                // armed with "Come back by itself" on: the watchdog and the sign-in entry are in place
let blockerId = null;
let unresponsiveTimer = null;
let watchdog = null;
const CLEAN_EXIT = path.join(USER_DATA, 'clean-exit');     // present only after the app was closed on purpose
const SESSION_END = path.join(USER_DATA, 'session-end');   // Windows was shutting down, restarting or signing out
const ALIVE = path.join(USER_DATA, 'alive');               // while armed: the last moment the app was seen running
const POWER_DRILL = path.join(USER_DATA, 'power-drill');   // the power cut test: when the app was cut off
const RECOVERED = process.argv.includes('--recovered');     // this instance was started by the crash watchdog
const LOGIN_ITEM = 'AvengersPlayer';                        // name of the start-at-login entry (see installer.nsi)

/** How the last run ended (see lastrun.js), read before this run puts down markers of its own. */
function readLastRun() {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
  let drill = null;
  try { drill = JSON.parse(read(POWER_DRILL) || 'null'); } catch (e) { drill = null; }
  let bootedAt = NaN;
  try { bootedAt = Date.now() - os.uptime() * 1000; } catch (e) { /* cannot tell */ }
  // The automated tests cannot restart the PC: they say when it "started".
  if (IS_TEST && Number.isFinite(Number(process.env.AP_BOOTED_AT))) bootedAt = Number(process.env.AP_BOOTED_AT);
  return classifyLastRun({
    clean: read(CLEAN_EXIT) != null, recovered: RECOVERED, shutdownAt: Date.parse(read(SESSION_END) || ''),
    lastAlive: Number(read(ALIVE)), aliveMissing: read(ALIVE) == null, drill: drill, bootedAt: bootedAt
  });
}
let lastRun = { ended: 'clean', lastAlive: null, shutdownAt: null, drill: null };

/** How to start this app again: the way Windows starts it at sign-in (the installed app takes no arguments). */
function relaunchSpec() {
  const skip = (a) => a === '--recovered' || /^--(inspect|remote-debugging)/.test(a);
  return { exe: process.execPath, args: app.isPackaged ? [] : process.argv.slice(1).filter((a) => !skip(a)), cwd: process.cwd() };
}

/** Starts watchdog.js (the app's own executable running as plain Node), detached from this process. */
function spawnHelper(mode) {
  const args = [path.join(__dirname, 'watchdog.js'), String(process.pid), USER_DATA, JSON.stringify(relaunchSpec())];
  if (mode) args.push(JSON.stringify(mode));
  return spawn(process.execPath, args, {
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
    detached: true, stdio: 'ignore', windowsHide: true
  });
}

/**
 * Crash recovery beyond a page reload: while the countdown is armed, a tiny second process watches
 * this one and starts the app again if it disappears (see watchdog.js).
 */
function startWatchdog() {
  if (watchdog || process.env.AP_NO_WATCHDOG === '1') return;
  try {
    watchdog = spawnHelper(null);
    const mine = watchdog;
    watchdog.on('error', (e) => { log('main', 'watchdog failed: ' + e.message); if (watchdog === mine) watchdog = null; });
    watchdog.on('exit', () => { if (watchdog === mine) watchdog = null; });
    watchdog.unref();
    log('main', 'crash watchdog on');
  } catch (e) {
    log('main', 'watchdog could not start: ' + (e && e.message));
    watchdog = null;
  }
}

function stopWatchdog() {
  if (!watchdog) return;
  try { watchdog.kill(); } catch (e) { /* already gone */ }
  watchdog = null;
  log('main', 'crash watchdog off');
}

/** While armed, Windows starts the app again after a restart of the PC (an update, a power cut). */
function setStartAtLogin(on) {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try {
    // A fixed name, so the uninstaller knows exactly which entry to remove. Written or removed every
    // time: on Windows getLoginItemSettings() cannot look an entry up by its name (it only takes a
    // path and arguments), so asking first said "not there" and a disarmed countdown left the entry
    // behind, opening the app at every sign-in.
    app.setLoginItemSettings({ openAtLogin: !!on, name: LOGIN_ITEM });
  } catch (e) {
    log('main', 'start-at-login could not be changed: ' + (e && e.message));
  }
}

function markCleanExit() {
  try { fs.writeFileSync(CLEAN_EXIT, new Date().toISOString()); } catch (e) { /* worst case the watchdog restarts us */ }
  stopWatchdog();
  setAlive(false);
}

let aliveTimer = null;
/**
 * While armed, the time is written down every 15 seconds. When the PC goes off without warning
 * (a power cut, an empty battery), the next start knows roughly when that was.
 */
function setAlive(on) {
  clearInterval(aliveTimer);
  aliveTimer = null;
  if (!on) { try { fs.unlinkSync(ALIVE); } catch (e) { /* none */ } return; }
  const beat = () => { try { fs.writeFileSync(ALIVE, String(Date.now())); } catch (e) { /* a convenience only */ } };
  beat();
  aliveTimer = setInterval(beat, 15000);
}

/** Windows is ending the session with the app open. Written at once: nothing else runs after this. */
function markSessionEnd(why) {
  log('main', 'Windows is ending the session (' + why + ')' + (armed ? (comeBack ? ': the countdown is armed and comes back at the next sign-in'
    : ': the countdown is armed, but "Come back by itself" is off: it will not reopen by itself') : ''));
  try { writeDurable(SESSION_END, new Date().toISOString()); } catch (e) { /* the next start then says "power cut" instead */ }
}

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

/** The saved window position, but only if that spot is still on a connected screen (the TV may be off). */
function savedPosition(b) {
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return {};
  try {
    const w = Number.isFinite(b.width) ? b.width : 1440;
    const h = Number.isFinite(b.height) ? b.height : 900;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      const overlapX = Math.min(b.x + w, a.x + a.width) - Math.max(b.x, a.x);
      const overlapY = Math.min(b.y + h, a.y + a.height) - Math.max(b.y, a.y);
      return overlapX > 200 && overlapY > 150;
    });
    return visible ? { x: Math.round(b.x), y: Math.round(b.y) } : {};
  } catch (e) {
    return {};
  }
}

let boundsTimer = null;
/** Remembers where the window is, so a restart after a crash comes back on the same screen. */
function rememberBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    try { store.merge({ window: { bounds: win.getNormalBounds(), maximized: win.isMaximized() } }); } catch (e) { /* a convenience only */ }
  }, 600);
}

function createWindow() {
  const saved = store.get().window || {};
  const b = saved.bounds || {};
  win = new BrowserWindow(Object.assign(savedPosition(b), {
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
      spellcheck: false,
      // Lets the page see the movie's sound tracks and choose which language plays.
      enableBlinkFeatures: 'AudioVideoTracks'
    }
  }));
  Menu.setApplicationMenu(null);
  if (saved.maximized) win.maximize();

  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.show(); });
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // Dropping a file on the window must not navigate away from the player, and nothing may open popups.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);
  win.on('enter-full-screen', () => send('win:fullscreen-changed', true));
  win.on('leave-full-screen', () => send('win:fullscreen-changed', false));

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    // Developer tools are for development builds: in the installed app F12 sits right next to F11
    // (fullscreen) and a stray press would shrink the picture and swallow the keyboard.
    if (app.isPackaged && process.env.AP_DEVTOOLS !== '1') return;
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

  // Shut down, restart or sign out: Windows ends the process right after this, without a 'close'.
  // The countdown stays armed and the start-at-login entry stays in place, so the app opens again
  // at the next sign-in and picks up where the clock says.
  win.on('session-end', (e) => {
    const reasons = e && Array.isArray(e.reasons) ? e.reasons : [];
    // An installer's Restart Manager closing the app ('close-app') is not the end of the session:
    // it is treated like any other kill, and the crash watchdog brings the app back at once.
    if (reasons.includes('close-app') && !reasons.some((r) => r === 'logoff' || r === 'shutdown' || r === 'critical')) {
      log('main', 'closed by the Windows Restart Manager (an installer)' + (comeBack ? ': the crash watchdog brings the app back' : ''));
      return;
    }
    sessionEnding = true;
    markSessionEnd(reasons.length ? reasons.join(', ') : 'shut down or restart');
  });

  win.on('close', (e) => {
    if (sessionEnding) {
      // Shut down with the countdown armed: nothing is marked as a deliberate quit, so the
      // start-at-login entry stays and the app opens again at the next sign-in.
      log('main', 'window closed by the end of the Windows session');
      return;
    }
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
    markCleanExit();                 // closed on purpose: the watchdog must not bring the app back
    setStartAtLogin(false);          // ...and neither must the next sign-in
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

  ipcMain.on('session:armed', (e, payload) => {
    if (!own(e)) return;
    const o = payload && typeof payload === 'object' ? payload : { armed: !!payload, autoRestart: true };
    armed = !!o.armed;
    setKeepAwake(armed);
    const guard = armed && o.autoRestart !== false;
    comeBack = guard;
    if (guard) startWatchdog(); else stopWatchdog();
    setStartAtLogin(guard);
    setAlive(armed);
  });

  ipcMain.handle('power:state', () => {
    try { return { onBattery: !!powerMonitor.isOnBatteryPower() }; } catch (err) { return { onBattery: false }; }
  });

  ipcMain.on('log', (e, line) => { if (own(e)) log('ui', line); });

  // The crash drill in the Test tab: take the whole app down the hard way, so the user can watch
  // the watchdog bring it back. Only honoured while a countdown is armed.
  ipcMain.on('drill:crash', (e) => {
    if (!own(e) || !armed) return;
    log('main', 'crash drill: crashing on purpose');
    setTimeout(() => process.crash(), 300);
  });

  // The power cut test: the whole app is cut off at once, crash watchdog included, with nothing
  // saved on the way out, as a power cut or an empty battery would cut it off. A helper waits the
  // chosen time and starts the app again exactly as Windows does at sign-in: no arguments.
  ipcMain.on('drill:powercut', (e, offSec) => {
    if (!own(e) || !armed) return;
    const offMs = Math.round(Math.min(600, Math.max(5, Number(offSec) || 30)) * 1000);
    log('main', 'power cut test: cutting the app off for ' + offMs / 1000 + ' s');
    stopWatchdog();
    try {
      writeDurable(POWER_DRILL, JSON.stringify({ at: Date.now(), offMs: offMs }));
      // A helper that could not be started reports it later, as an 'error' event with no process id:
      // the app must not cut itself off with nothing to bring it back.
      const helper = spawnHelper({ powerCut: offMs });
      helper.on('error', (err) => log('main', 'power cut helper: ' + (err && err.message)));
      if (!helper.pid) throw new Error('the helper that starts the app again did not start');
      helper.unref();
    } catch (err) {
      log('main', 'power cut test could not start: ' + (err && err.message));
      try { fs.unlinkSync(POWER_DRILL); } catch (e2) { /* none */ }
      startWatchdog();
      return;
    }
    setTimeout(() => { try { process.kill(process.pid, 'SIGKILL'); } catch (err) { process.exit(1); } }, 300);
  });

  // How the last run ended, read synchronously by the page as it starts (before it can restore the
  // countdown), and told once: a page reloaded later (after a crash of the page) must not report a
  // power cut from hours ago again.
  ipcMain.on('app:last-run', (e) => {
    if (!own(e)) { e.returnValue = null; return; }
    e.returnValue = Object.assign({ startedAt: STARTED_AT }, lastRun);
    lastRun = { ended: 'clean', lastAlive: null, shutdownAt: null, drill: null };
  });

  ipcMain.handle('app:info', () => infoWith());
  const infoWith = () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    logFile: LOG_FILE,
    isTest: IS_TEST,
    recovered: RECOVERED,
    startedAt: STARTED_AT,
    pid: process.pid
  });

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

  /* ---- the replay of the night (the page records; this writes the file as it comes) ---- */
  // Videos > Avengers Player. The automated tests point it at a folder of their own.
  const replayDir = () => (IS_TEST && process.env.AP_VIDEOS_DIR ? process.env.AP_VIDEOS_DIR : path.join(app.getPath('videos'), 'Avengers Player'));
  const replays = new Map();
  let replayNext = 1;
  ipcMain.handle('replay:source', (e) => (own(e) && win && !win.isDestroyed() ? win.getMediaSourceId() : null));
  ipcMain.handle('replay:begin', (e, name, ext) => {
    if (!own(e)) return null;
    try {
      const dir = replayDir();
      fs.mkdirSync(dir, { recursive: true });
      const base = String(name || 'Replay').replace(/[^A-Za-z0-9 .,()'-]/g, '').trim().slice(0, 80) || 'Replay';
      const x = ext === 'webm' ? 'webm' : 'mp4';
      let file = path.join(dir, base + '.' + x);
      for (let i = 2; fs.existsSync(file) && i < 100; i++) file = path.join(dir, base + ' (' + i + ').' + x);
      // Written as it comes: a crash or a power cut keeps what was recorded (in the .part file).
      const part = file + '.part';
      const fd = fs.openSync(part, 'w');
      const id = replayNext++;
      replays.set(id, { fd: fd, part: part, file: file });
      log('main', 'replay: recording to ' + file);
      return { id: id, file: file };
    } catch (err) {
      log('main', 'replay: cannot write (' + (err && err.message) + ')');
      return null;
    }
  });
  ipcMain.handle('replay:chunk', (e, id, bytes) => {
    const r = own(e) ? replays.get(id) : null;
    if (!r || !bytes) return false;
    try { fs.writeSync(r.fd, Buffer.from(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength)); return true; } catch (err) { return false; }
  });
  ipcMain.handle('replay:end', (e, id, keep, ms) => {
    const r = own(e) ? replays.get(id) : null;
    if (!r) return null;
    replays.delete(id);
    try { fs.closeSync(r.fd); } catch (err) { /* already closed */ }
    try {
      if (keep && fs.statSync(r.part).size > 0) {
        // A recorded WebM file does not say how long it is: write that in, so players show it and seek.
        if (/\.webm$/.test(r.file) && ms > 0) {
          try { const fixed = withDuration(fs.readFileSync(r.part), ms); if (fixed) writeDurable(r.part, fixed); } catch (err) { log('main', 'replay: length not written (' + (err && err.message) + ')'); }
        }
        fs.renameSync(r.part, r.file);
        log('main', 'replay: saved ' + r.file);
        return r.file;
      }
      fs.unlinkSync(r.part);
    } catch (err) { log('main', 'replay: could not finish (' + (err && err.message) + ')'); }
    return null;
  });
  ipcMain.handle('replay:open-dir', (e) => {
    if (!own(e)) return '';
    try { fs.mkdirSync(replayDir(), { recursive: true }); } catch (err) { /* opened below if it exists */ }
    return shell.openPath(replayDir());
  });
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
  let speechAbort = null;
  const ffPath = async () => {
    if (!ffmpeg || (IS_TEST && process.env.AP_NO_FFMPEG === '1')) return null;
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

  ipcMain.handle('ff:probe', async (e, file, hevcOk, preferLang) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      const probe = await ffmpeg.probe(exe, file);
      return { probe: probe, assess: ffmpeg.assess(probe, { hevcOk: !!hevcOk, preferLang: typeof preferLang === 'string' ? preferLang : '' }) };
    } catch (err) {
      return ffError(err);
    }
  });

  ipcMain.handle('ff:convert', async (e, file, audioIndex, keepOthers, preferLang) => {
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
      log('main', 'converting audio: ' + file + ' -> ' + output + ' (track ' + (Number.isInteger(audioIndex) ? audioIndex : 'auto') + (keepOthers ? ', keeping the others' : '') + ')');
      const r = await ffmpeg.convertAudio(exe, file, output, {
        audioIndex: Number.isInteger(audioIndex) ? audioIndex : undefined,
        keepOthers: !!keepOthers,
        preferLang: typeof preferLang === 'string' ? preferLang : '',
        signal: ffAbort.signal,
        onProgress: (p) => send('ff:progress', Object.assign({ phase: 'convert' }, p))
      });
      return { movie: fileInfo(r.output), seconds: r.seconds, audio: r.audio, subtitles: r.subtitles };
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

  // The subtitles of a stretch of the movie: used to find the line before the snap.
  ipcMain.handle('ff:sub-window', async (e, file, fromSec, durSec, preferLang, trackIndex) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      const r = await ffmpeg.subtitleWindow(exe, file, Number(fromSec) || 0, Number(durSec) || 600, {
        preferLang: typeof preferLang === 'string' ? preferLang : '', trackIndex: Number.isInteger(trackIndex) ? trackIndex : undefined
      });
      return r || { none: true };
    } catch (err) {
      return ffError(err);
    }
  });

  // The sound of stretches of the movie, for putting a subtitle file on the voices. It has its own
  // off switch, so it never stands in the way of a conversion or a download.
  ipcMain.handle('ff:speech', async (e, file, audioIndex, windows, preferLang) => {
    if (!own(e) || !ffmpeg || typeof file !== 'string') return { error: 'FFmpeg helper unavailable.' };
    if (speechAbort) speechAbort.abort();
    const mine = speechAbort = new AbortController();
    try {
      const exe = await ffPath();
      if (!exe) return { error: 'FFmpeg not found.', missing: true };
      return await ffmpeg.speechEnergy(exe, file, {
        audioIndex: Number.isInteger(audioIndex) ? audioIndex : undefined,
        windows: Array.isArray(windows) ? windows : [],
        preferLang: typeof preferLang === 'string' ? preferLang : '',
        signal: mine.signal,
        onProgress: (p) => send('ff:progress', Object.assign({ phase: 'listen' }, p))
      });
    } catch (err) {
      return ffError(err);
    } finally {
      if (speechAbort === mine) speechAbort = null;
    }
  });
  ipcMain.handle('ff:speech-cancel', () => { if (speechAbort) speechAbort.abort(); return true; });

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
    log('main', 'start v' + app.getVersion() + ' electron ' + process.versions.electron + ' pid ' + process.pid + (RECOVERED ? ' (restarted by the crash watchdog)' : ''));
    lastRun = readLastRun();
    if (lastRun.ended !== 'clean' && (store.get().renderer || {}).armed) {
      log('main', 'the last run did not end on purpose (' + lastRun.ended + ')' + (lastRun.lastAlive ? ', last seen running ' + new Date(lastRun.lastAlive).toISOString() : '') + ': the armed countdown picks up where the clock says');
    }
    for (const f of [CLEAN_EXIT, SESSION_END, POWER_DRILL]) { try { fs.unlinkSync(f); } catch (e) { /* no marker from last time */ } }
    // No armed countdown on record: make sure nothing is left that would start the app at login.
    const saved = store.get().renderer || {};
    if (!saved.armed) setStartAtLogin(false);
    registerIpc();
    createWindow();
    // Sleep, wake and the battery: the page re-syncs the moment the PC wakes up and warns while
    // an armed countdown runs on a battery.
    const tell = (type) => () => { log('main', 'power: ' + type); send('power:event', { type: type }); };
    powerMonitor.on('suspend', tell('suspend'));
    powerMonitor.on('resume', tell('resume'));
    powerMonitor.on('on-battery', tell('on-battery'));
    powerMonitor.on('on-ac', tell('on-ac'));
    // (Linux and macOS: Windows says so through the window's 'session-end'.)
    powerMonitor.on('shutdown', () => markSessionEnd('the system is shutting down'));
  });

  app.on('window-all-closed', () => { setKeepAwake(false); if (quitting) stopWatchdog(); app.quit(); });
  app.on('child-process-gone', (_e, details) => log('main', 'child process gone: ' + details.type + ' ' + details.reason));
  process.on('uncaughtException', (err) => log('main', 'uncaught: ' + (err && err.stack)));
  process.on('unhandledRejection', (err) => log('main', 'unhandled rejection: ' + (err && err.stack || err)));
}
