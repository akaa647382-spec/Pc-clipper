'use strict';
/**
 * Crash watchdog. A tiny separate process (the app's own executable running as plain Node) that
 * the main process starts while the countdown is armed.
 *
 * It does one thing: if the app disappears without having been closed on purpose, and the
 * countdown is still armed, it starts the app again. The new instance reloads the movie and
 * jumps to where the clock says the film should be, so a crash costs a few seconds, not the night.
 *
 *   argv[2]  process id of the app to watch
 *   argv[3]  the app's data folder (settings.json, the log, the "clean-exit" marker)
 *   argv[4]  JSON: { exe, args, cwd } describing how to start the app again
 *   argv[5]  optional JSON: { powerCut: ms } for the power cut test. The app has cut itself off on
 *            purpose; after `ms` it is started again the way Windows starts it at sign-in, with no
 *            arguments, as if the PC had been off that long and was just turned back on.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pid = parseInt(process.argv[2], 10);
const dataDir = process.argv[3];
let relaunch = null;
try { relaunch = JSON.parse(process.argv[4]); } catch (e) { relaunch = null; }
if (!(pid > 0) || !dataDir || !relaunch || !relaunch.exe) process.exit(0);
let mode = null;
try { mode = process.argv[5] ? JSON.parse(process.argv[5]) : null; } catch (e) { mode = null; }
const powerCut = mode && Number.isFinite(mode.powerCut) ? Math.min(600000, Math.max(1000, mode.powerCut)) : 0;

const MAX_RESTARTS = 5;               // within the window below: a crash loop must not run forever
const WINDOW_MS = 10 * 60 * 1000;

function log(message) {
  try {
    fs.appendFileSync(path.join(dataDir, 'avengers-player.log'), new Date().toISOString() + ' [watchdog] ' + message + '\n');
  } catch (e) { /* the log is a convenience */ }
}

function appIsAlive() {
  try {
    process.kill(pid, 0);             // signal 0 only asks whether the process exists
    return true;
  } catch (e) {
    return !!(e && e.code === 'EPERM');
  }
}

/** True while there is an armed countdown worth coming back for. */
function stillArmed() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    const r = s && s.renderer;
    if (!r || r.armed !== true || r.autoRestart === false) return false;
    // Until an hour after the target, or ten minutes after the film ends when it ends later
    // (a start time chosen late in the evening).
    const until = Math.max(r.armedTarget + 60 * 60 * 1000, Number.isFinite(r.armedEnd) ? r.armedEnd + 10 * 60 * 1000 : 0);
    return Number.isFinite(r.armedTarget) && Date.now() < until;
  } catch (e) {
    return false;
  }
}

/** Remembers recent restarts; refuses when the app keeps dying straight away. */
function restartAllowed() {
  const file = path.join(dataDir, 'restarts.json');
  let times = [];
  try { times = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { times = []; }
  const now = Date.now();
  times = (Array.isArray(times) ? times : []).filter((t) => Number.isFinite(t) && now - t < WINDOW_MS);
  if (times.length >= MAX_RESTARTS) return false;
  times.push(now);
  try { fs.writeFileSync(file, JSON.stringify(times)); } catch (e) { /* worst case we restart once too often */ }
  return true;
}

/** Starts the app: with '--recovered' after a crash, with nothing at all as Windows does at sign-in. */
function start(extra) {
  try {
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;  // the new process must be the app, not another plain Node
    const child = spawn(relaunch.exe, (relaunch.args || []).concat(extra), {
      cwd: relaunch.cwd || undefined, env: env, detached: true, stdio: 'ignore', windowsHide: false
    });
    child.on('error', (e) => log('could not start the app: ' + e.message));
    child.unref();
  } catch (e) {
    log('could not start the app: ' + e.message);
  }
  setTimeout(() => process.exit(0), 1500);
}

const marker = (name) => fs.existsSync(path.join(dataDir, name));

const timer = setInterval(() => {
  if (appIsAlive()) return;
  clearInterval(timer);
  if (powerCut) {
    // The power cut test: the PC "stays off" this long, then is "turned back on".
    log('power cut test: the app is off; it is started again in ' + Math.round(powerCut / 1000) + ' s, the way Windows starts it when the PC is back on');
    setTimeout(() => {
      if (!stillArmed()) { log('power cut test: the countdown is not armed any more, nothing to start'); process.exit(0); return; }
      log('power cut test: the PC is "back on": starting the app as Windows does at sign-in');
      start([]);
    }, powerCut);
    return;
  }
  // Closed on purpose; Windows shutting down (the app opens again at the next sign-in, not into a
  // session that is ending); or the power cut test, whose own helper starts the app.
  if (marker('clean-exit') || marker('session-end') || marker('power-drill') || !stillArmed()) { process.exit(0); return; }
  if (!restartAllowed()) {
    log('the app keeps disappearing: not starting it again');
    process.exit(0);
    return;
  }
  log('the app disappeared while the countdown was armed: starting it again');
  start(['--recovered']);
}, powerCut ? 250 : 1000);
