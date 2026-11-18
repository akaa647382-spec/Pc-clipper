// Launches the real app (Electron) with a throwaway profile and drives every tab.
// Needs a display (use xvfb-run on Linux) and the clips from scripts/make-test-media.sh.
//   node tests/e2e/run.mjs [--shots]   --shots also saves docs/*.png
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(path.join(process.env.NODE_PATH || '', 'playwright')); }
const { _electron: electron } = pw;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MEDIA = path.join(ROOT, 'tests', 'fixtures', 'media');
const SHOTS = process.argv.includes('--shots');
const EXE = process.env.SCP_EXE || require(path.join(ROOT, 'node_modules', 'electron'));

let pass = 0;
let fail = 0;
const check = (name, ok, extra) => { (ok ? pass++ : fail++); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' :: ' + extra : '')); };

// --- a profile with 120 days of a regular streamer, going live ~3 h from now each day ---
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'scp-e2e-'));
const H = 3600e3;
const D = 24 * H;
const now = Date.now();
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const streams = [];
for (let d = 120; d >= 1; d--) {
  if (rnd() < 0.2) continue;
  const start = now - d * D + 3 * H + (rnd() - 0.5) * 60 * 60e3;
  streams.push({ id: 'v' + d, title: 'stream ' + d, start, end: start + (2.5 + rnd() * 2) * H, scheduled: null });
}
const locks = streams.slice(-6).map((s, i) => ({ id: 'l' + i, at: s.start - (40 + i * 5) * 60e3 }));
fs.writeFileSync(path.join(userData, 'data.json'), JSON.stringify({
  settings: { tz: 'UTC', closeToTray: false },
  streams,
  locks,
  clips: [],
  lastCheck: { at: now, via: 'api', live: null, upcoming: null, error: null },
}));

const app = await electron.launch({
  executablePath: EXE,
  // SCP_APP runs a packaged app.asar (for checking a Windows build's trimmed files on Linux).
  args: process.env.SCP_EXE ? [] : [process.env.SCP_APP || ROOT],
  env: Object.assign({}, process.env, { SCP_TEST: '1', SCP_NO_POLL: '1', SCP_USER_DATA: userData }),
});
const page = await app.firstWindow();
await page.setViewportSize({ width: 1100, height: 900 });
page.on('pageerror', (e) => check('no page errors', false, e.message));
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: path.join(ROOT, 'docs', name + '.png') }); };
const count = (n) => page.waitForFunction((k) => document.querySelectorAll('#clipList .clip').length === k, n, { timeout: 240000 });

try {
  // --- When to post ---
  await page.waitForSelector('#tab-now .status', { timeout: 20000 });
  const big = await page.textContent('#tab-now .status .big');
  const label = await page.textContent('#tab-now .status .label');
  check('prediction shows a post time or post now', /POST NOW|AM|PM|\d:\d\d/.test(big), label + ' | ' + big);
  check('chart drawn', (await page.$$('#tab-now svg.chart rect')).length === 48);
  const lockTxt = await page.textContent('#tab-now .panel p.dim');
  check('lock gap learned from the 6 logged locks', /learned from your 6 logged locks/.test(lockTxt), lockTxt.replace(/\s+/g, ' ').slice(0, 200));
  await shot('now');

  // --- Lock button ---
  await page.click('#tab-now [data-lock]');
  await page.waitForFunction(() => document.querySelectorAll('#tab-log tbody tr').length >= 7);
  check('lock button logs a lock', true);

  // --- Check a clip: self-promo ---
  await page.click('button[data-tab=check]');
  const ff = await page.evaluate(() => scp.ffLocate());
  check('ffmpeg found', !!ff && !ff.error, JSON.stringify(ff));
  let r = await page.evaluate((f) => scp.analyze(f, 'speed pls react to this'), path.join(MEDIA, 'promo.mp4'));
  check('promo clip analysed', r && r.id, JSON.stringify(r));
  await count(1);
  let head = await page.textContent('#clipList .clip .verdict');
  check('promo clip: DON\'T POST', /DON'T POST/.test(head), head);
  const items = await page.textContent('#clipList .clip .items');
  check('on-screen promo (with the handle) and begging both found', /Self-promotion \(on screen\)/.test(items) && /clipzking/.test(items) && /Begging/.test(items), items.replace(/\s+/g, ' ').slice(0, 200));

  // --- good clip, queue it, post it, then a re-encode is a repeat ---
  r = await page.evaluate((f) => scp.analyze(f, 'bro this goes hard'), path.join(MEDIA, 'good.mp4'));
  await count(2);
  head = await page.textContent('#clipList .clip .verdict');
  check('good clip: POST', /^POST/.test(head), head);
  await shot('check');
  await page.click('#clipList .clip [data-queue]');
  await page.click('button[data-tab=now]');
  await page.waitForFunction(() => /Clips waiting for the moment \(1\)/.test(document.querySelector('#tab-now').textContent));
  check('queued clip listed on the When-to-post tab', true);
  await page.click('#tab-now [data-posted]');
  await page.waitForFunction(() => /Clips waiting for the moment \(0\)/.test(document.querySelector('#tab-now').textContent));
  await page.click('button[data-tab=check]');
  r = await page.evaluate((f) => scp.analyze(f, ''), path.join(MEDIA, 'good-reencoded.mp4'));
  await count(3);
  head = await page.textContent('#clipList .clip .verdict');
  check('re-encoded copy of a posted clip: DON\'T POST (repeat)', /DON'T POST.*already posted/i.test(head), head);

  // --- too big -> small copy ---
  r = await page.evaluate((f) => scp.analyze(f, ''), path.join(MEDIA, 'big.mp4'));
  await count(4);
  check('big clip blocked for size', /Too big/.test(await page.textContent('#clipList .clip .verdict')));
  await page.click('#clipList .clip [data-small]');
  await count(5);
  head = await page.textContent('#clipList .clip .verdict');
  const meta = await page.textContent('#clipList .clip .faint');
  check('10 MB copy made and passes', /^POST/.test(head) && /\(10MB\)\.mp4/.test(meta), head + ' | ' + meta);

  // --- Accuracy: calibrate ---
  await page.click('button[data-tab=accuracy]');
  await page.evaluate(() => scp.calibrate());
  await page.waitForFunction(() => /If you had used the app/.test(document.querySelector('#tab-accuracy').textContent), null, { timeout: 240000 });
  const acc = await page.textContent('#tab-accuracy .stats');
  check('calibration result shown', /posted before the lock/.test(acc), acc.replace(/\s+/g, ' ').slice(0, 200));
  await shot('accuracy');

  // --- Lock log and settings ---
  await page.click('button[data-tab=log]');
  await shot('lock-log');
  await page.click('button[data-tab=settings]');
  check('settings show the key steps', /Create credentials/.test(await page.textContent('#tab-settings')));
  await page.fill('#ntfy', 'bad topic!');
  await page.dispatchEvent('#ntfy', 'change');
  await page.waitForSelector('#toast.bad:not([hidden])');
  check('bad phone topic rejected', true);
  await page.fill('#ntfy', '');
  await page.dispatchEvent('#ntfy', 'change');
  await shot('settings');

  // --- data survived on disk ---
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8'));
  check('clips, locks and calibration saved', saved.clips.length === 5 && saved.locks.length === 7 && !!saved.calibration, saved.clips.length + ' clips, ' + saved.locks.length + ' locks');
} catch (e) {
  check('run finished', false, e.stack);
} finally {
  await app.close().catch(() => {});
}
console.log(pass + '/' + (pass + fail) + ' checks passed (profile left in ' + userData + ')');
process.exit(fail ? 1 : 0);
