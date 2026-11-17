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
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const pid = parseInt(process.argv[2], 10);
const dataDir = process.argv[3];
let relaunch = null;
try { relaunch = JSON.parse(process.argv[4]); } catch (e) { relaunch = null; }
if (!(pid > 0) || !dataDir || !relaunch || !relaunch.exe) process.exit(0);

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

const timer = setInterval(() => {
  if (appIsAlive()) return;
  clearInterval(timer);
  const closedOnPurpose = fs.existsSync(path.join(dataDir, 'clean-exit'));
  if (closedOnPurpose || !stillArmed()) { process.exit(0); return; }
  if (!restartAllowed()) {
    log('the app keeps disappearing: not starting it again');
    process.exit(0);
    return;
  }
  log('the app disappeared while the countdown was armed: starting it again');
  try {
    const env = Object.assign({}, process.env);
    delete env.ELECTRON_RUN_AS_NODE;  // the new process must be the app, not another plain Node
    const child = spawn(relaunch.exe, (relaunch.args || []).concat('--recovered'), {
      cwd: relaunch.cwd || undefined, env: env, detached: true, stdio: 'ignore', windowsHide: false
    });
    child.on('error', (e) => log('could not start the app: ' + e.message));
    child.unref();
  } catch (e) {
    log('could not start the app: ' + e.message);
  }
  setTimeout(() => process.exit(0), 1500);
}, 1000);
