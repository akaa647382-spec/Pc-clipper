// Shared helpers for the end-to-end tests: launches the real Electron app against a throwaway profile.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MEDIA = path.join(ROOT, 'tests', 'media');
export const ARTIFACTS = path.join(ROOT, 'tests', 'artifacts', 'e2e');

function loadPlaywright() {
  const candidates = ['playwright', 'playwright-core', process.env.PLAYWRIGHT_PATH, '/opt/node-tools/node_modules/playwright'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch (e) { /* try the next one */ }
  }
  throw new Error('Playwright is not installed. Run "npm i -D playwright" or set PLAYWRIGHT_PATH.');
}

/** Electron needs a display. On a headless Linux box, re-run the calling script under xvfb. */
export function ensureDisplay(scriptUrl) {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.AP_NO_XVFB) return;
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', process.execPath, fileURLToPath(scriptUrl), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, AP_NO_XVFB: '1' } });
  process.exit(r.status == null ? 1 : r.status);
}

export function ensureMedia() {
  if (['movie.mp4', 'dolby.mp4', 'lang-dual.mkv', 'lang-dolby.mkv', 'lang-mixed.mkv', 'lang-hindi.mp4'].every((f) => fs.existsSync(path.join(MEDIA, f)))) return;
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'make-test-media.sh')], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Could not generate the test clips (is ffmpeg installed?).');
}

export function newProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'avengers-player-test-'));
}

/**
 * Starts the app. `profile` is the userData folder (reuse it to simulate closing and reopening).
 * Returns { app, page, errors, close }.
 */
export async function launch(profile, extraEnv) {
  const { _electron } = loadPlaywright();
  // AP_APP_EXE runs the tests against a packaged build instead of the source tree.
  const packaged = process.env.AP_APP_EXE || '';
  const electronPath = packaged || require(path.join(ROOT, 'node_modules', 'electron'));
  const args = packaged ? [] : [ROOT];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const app = await _electron.launch({
    executablePath: electronPath,
    args,
    cwd: ROOT,
    // ELECTRON_DISABLE_SANDBOX lets an instance restarted by the crash watchdog start as root on Linux too.
    env: { ...process.env, AP_TEST: '1', AP_USER_DATA: profile, ...(process.platform === 'linux' ? { ELECTRON_DISABLE_SANDBOX: '1' } : {}), ...(extraEnv || {}) }
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.waitForFunction(() => !!window.__AP, null, { timeout: 20000 });
  return {
    app, page, errors, profile,
    async close() {
      // Tell the crash watchdog this is a deliberate exit, so no test leaves a resurrected app behind.
      try { fs.writeFileSync(path.join(profile, 'clean-exit'), 'test'); } catch (e) { /* profile gone */ }
      try { await app.close(); } catch (e) { /* already gone */ }
    }
  };
}

/** Loads a clip through the same path the Import button uses, minus the file dialog. */
export async function loadMovie(page, file) {
  return page.evaluate(async (f) => {
    const info = await window.apNative.openMovie(f);
    if (!info) return false;
    return window.__AP.Media.load(info);
  }, file);
}

export const state = (page) => page.evaluate(() => {
  const { Engine, Clock, Media, cfg } = window.__AP;
  const v = document.getElementById('video');
  return {
    mode: Engine.mode, phase: Engine.phase, test: Engine.test ? Engine.test.kind : null,
    drift: Engine.st.drift, rate: v.playbackRate, paused: v.paused, t: v.currentTime, dur: v.duration,
    expected: Engine.session ? Engine.expected() : null,
    recals: Engine.st.recals, autoRecals: Engine.st.autoRecals, slips: Engine.st.slips,
    hasAudio: Media.hasAudio, ready: Media.ready, armed: cfg.armed, testOffset: Clock.testOffsetMs, netOffset: Clock.netOffsetMs,
    view: document.getElementById('app').dataset.view
  };
});

export async function shot(page, name) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, name + '.png');
  await page.screenshot({ path: file });
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
