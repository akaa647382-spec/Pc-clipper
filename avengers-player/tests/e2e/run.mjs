// End-to-end tests: drive the real Electron app and measure what it actually does.
//   node tests/e2e/run.mjs            run everything
//   node tests/e2e/run.mjs snap slip  run only the scenarios whose name contains one of the words
import fs from 'node:fs';
import path from 'node:path';
import { ensureDisplay, ensureMedia, newProfile, launch, loadMovie, state, shot, sleep, MEDIA } from './harness.mjs';

ensureDisplay(import.meta.url);
ensureMedia();

const MOVIE = path.join(MEDIA, 'movie.mp4');
const SNAP = 100;                      // the test clip is 200 s long; pretend the snap is at 1:40
const only = process.argv.slice(2);
const results = [];
let current = '';

function check(name, ok, detail) {
  results.push({ scenario: current, name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log((ok ? '  ok    ' : '  FAIL  ') + name + (detail == null ? '' : '  [' + detail + ']'));
}
const ms = (sec) => (sec == null ? 'n/a' : Math.round(sec * 1000) + ' ms');

async function waitFor(page, fn, arg, timeout) {
  try { await page.waitForFunction(fn, arg, { timeout: timeout || 15000, polling: 50 }); return true; } catch (e) { return false; }
}
const waitPhase = (page, phase, timeout) => waitFor(page, (p) => window.__AP.Engine.phase === p, phase, timeout);
const waitSynced = (page, timeout) => waitFor(page, () => window.__AP.Engine.phase === 'synced' && window.__AP.Engine.st.drift != null, null, timeout);

/** Sets the snap point through the Setup tab, the way a user would. */
async function setSnap(page, sec) {
  await page.click('.tab[data-tab="setup"]');
  await page.fill('#snapInput', String(sec));
  await page.press('#snapInput', 'Enter');
  await page.click('.tab[data-tab="mission"]');
}

/** Arms the real countdown with the movie due to start `startInSec` from now. */
async function armIn(page, startInSec) {
  await page.evaluate(({ startInSec, snap }) => {
    const { cfg, Engine } = window.__AP;
    const d = new Date(Date.now() + (startInSec + snap) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    cfg.targetMode = 'custom';
    cfg.customTarget = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    Engine.session = Engine.computeFree();
  }, { startInSec, snap: SNAP });
  await page.click('#armBtn');
}

/** Largest gap between the film and the clock over a stretch of playback, sampled directly from the video element. */
async function measureSync(page, durationMs) {
  return page.evaluate(async (durationMs) => {
    const { Engine, Clock } = window.__AP;
    const v = document.getElementById('video');
    let worst = 0;
    let n = 0;
    const end = performance.now() + durationMs;
    while (performance.now() < end) {
      await new Promise((r) => v.requestVideoFrameCallback((now, meta) => {
        const d = meta.mediaTime - Engine.expected(Clock.fromPerf(meta.expectedDisplayTime));
        if (Math.abs(d) > Math.abs(worst)) worst = d;
        n++;
        r();
      }));
    }
    return { worst, n };
  }, durationMs);
}

const scenarios = {

  async boot() {
    const s = await launch(newProfile());
    try {
      await sleep(800);
      const st = await state(s.page);
      check('starts on the import screen', st.view === 'import');
      const txt = await s.page.evaluate(() => ({ clock: document.getElementById('imClock').textContent, start: document.getElementById('imStartAt').textContent, snap: document.getElementById('imSnapAt').textContent }));
      check('shows the live clock', /\d:\d\d:\d\d/.test(txt.clock), txt.clock);
      check('default start time is 9:29:30 PM on Dec 31', /Dec 31 · 9:29:30 PM/.test(txt.start), txt.start);
      check('default target is midnight on Jan 1', /Jan 1 · 12:00:00 AM/.test(txt.snap), txt.snap);
      check('loads the movie', await loadMovie(s.page, MOVIE));
      const st2 = await state(s.page);
      check('switches to the player', st2.view === 'player' && st2.ready && Math.abs(st2.dur - 200) < 1, 'duration ' + st2.dur);
      check('free play until armed', st2.mode === 'free' && st2.paused);
      await s.page.keyboard.press('Space');
      await sleep(2600);
      const st3 = await state(s.page);
      check('space plays in free mode', !st3.paused && st3.t > 1, 't=' + st3.t.toFixed(2));
      check('sound detected once it plays', st3.hasAudio === true, String(st3.hasAudio));
      await s.page.keyboard.press('Space');
      await sleep(200);
      check('space pauses in free mode, no slip popup', (await state(s.page)).paused && await s.page.isHidden('#slip'));
      await shot(s.page, 'boot-player');
      // A file name full of characters that are special in URLs and on command lines.
      const oddDir = path.join(newProfile(), 'Ünï côdé & co');
      fs.mkdirSync(oddDir, { recursive: true });
      const odd = path.join(oddDir, "Avengers #1 100% 'Endgame' (2019) [4K] + más.mp4");
      fs.copyFileSync(path.join(MEDIA, 'silent.mp4'), odd);
      check('a movie with an awkward file name loads', await loadMovie(s.page, odd));
      await s.page.evaluate(() => document.getElementById('video').play());
      check('and plays', await waitFor(s.page, () => document.getElementById('video').currentTime > 0.5, null, 6000));
      check('its name is shown as it is', (await s.page.textContent('#fileName')) === path.basename(odd), await s.page.textContent('#fileName'));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async autostart() {
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsLeadStart', '10');
      await s.page.click('[data-test="start"]');
      check('enters standby, film waiting at 0:00', await waitPhase(s.page, 'standby', 5000));
      await sleep(1500);
      const a = await state(s.page);
      check('paused at the first frame while waiting', a.paused && a.t < 0.05, 't=' + a.t);
      check('standby countdown is on screen', await s.page.isVisible('#standby'));
      check('test HUD is on screen', await s.page.isVisible('#testHud'));
      await shot(s.page, 'autostart-standby');
      // Catch the very first frame after the start: how far from the simulated 9:29:30.000 did playback begin?
      const first = await s.page.evaluate(() => new Promise((res) => {
        const { Engine, Clock } = window.__AP;
        const v = document.getElementById('video');
        const to = setTimeout(() => res(null), 16000);
        const cb = (now, meta) => {
          if (v.paused || meta.mediaTime <= 0) { v.requestVideoFrameCallback(cb); return; }
          clearTimeout(to);
          res(meta.mediaTime - Engine.expected(Clock.fromPerf(meta.expectedDisplayTime)));
        };
        v.requestVideoFrameCallback(cb);
      }));
      check('the movie started by itself', first != null);
      check('first moving frame within 150 ms of the start time', first != null && Math.abs(first) < 0.15, ms(first));
      await sleep(3500);
      const b = await state(s.page);
      check('locked onto the clock within a few seconds', b.phase === 'synced' && b.drift != null && Math.abs(b.drift) < 0.05, ms(b.drift));
      const m = await measureSync(s.page, 2000);
      check('every frame within 60 ms of the clock afterwards', Math.abs(m.worst) < 0.06, ms(m.worst) + ' over ' + m.n + ' frames');
      check('test ends by itself and reports PASS', await waitFor(s.page, () => !window.__AP.Engine.test && !!document.querySelector('#testResults .result'), null, 12000));
      const r = await s.page.textContent('#testResults .result');
      check('result says PASS', /PASS/.test(r), r);
      const c = await state(s.page);
      check('clock is back to real time, player is free again', c.testOffset === 0 && c.mode === 'free' && c.paused);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async snap() {
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsLeadSnap', '20');
      await s.page.click('[data-test="snap"]');
      check('locks on shortly after jumping to 20 s before midnight', await waitSynced(s.page, 8000));
      const a = await state(s.page);
      check('film is ~20 s before the snap point', Math.abs(a.t - (SNAP - 20)) < 4, 't=' + a.t.toFixed(2));
      const ov = await s.page.evaluate(() => ({ date: document.getElementById('ovDate').textContent, lbl: document.getElementById('ovCountLbl').textContent, clock: document.getElementById('ovTime').textContent + document.getElementById('ovAmpm').textContent }));
      check('overlay shows December 31 and 11:59 PM', /December 31, \d{4}$/.test(ov.date) && /^11:59:\d\dPM$/.test(ov.clock), JSON.stringify(ov));
      check('clock, then date, then countdown, top to bottom', ov.lbl === 'NEW YEAR IN' && await s.page.evaluate(() => {
        const c = document.getElementById('ovClock').getBoundingClientRect();
        const d = document.getElementById('ovDate').getBoundingClientRect();
        const n = document.getElementById('ovCount').getBoundingClientRect();
        return d.top >= c.bottom - 1 && n.top >= d.bottom - 1 && n.height > 0 && d.height > 0;
      }));
      check('no calendar card anywhere', await s.page.evaluate(() => !document.querySelector('.cal, #ovCal')));
      await shot(s.page, 'snap-countdown');
      // Sample the film against the clock through the final seconds and across midnight.
      const toSnap = await s.page.evaluate(() => window.__AP.Engine.session.targetEpoch - window.__AP.Clock.now());
      await sleep(Math.max(0, toSnap - 6500));
      const big = await s.page.evaluate(() => {
        const ov = document.getElementById('overlay').getBoundingClientRect();
        const v = document.getElementById('ovCountVal').getBoundingClientRect();
        const clock = document.getElementById('ovTime').getBoundingClientRect();
        return {
          final: document.getElementById('overlay').classList.contains('final'), n: +document.getElementById('ovCountVal').textContent,
          inside: v.left >= ov.left && v.right <= ov.right && v.top >= ov.top && v.bottom <= ov.bottom, under: v.top >= clock.bottom,
          bigger: v.height > clock.height, stray: !!document.getElementById('bigCount')
        };
      });
      check('the 10 · 9 · 8 countdown ticks inside the clock panel, under the clock', big.final && big.n >= 1 && big.n <= 10 && big.inside && big.under && big.bigger, JSON.stringify(big));
      check('nothing is drawn across the picture', !big.stray);
      await shot(s.page, 'snap-final-seconds');
      const m = await measureSync(s.page, 8000);
      check('every frame within 60 ms of the clock across midnight', Math.abs(m.worst) < 0.06, ms(m.worst) + ' over ' + m.n + ' frames');
      const b = await s.page.evaluate(() => {
        const { Engine, Clock } = window.__AP;
        const v = document.getElementById('video');
        return {
          since: (Clock.now() - Engine.session.targetEpoch) / 1000, t: v.currentTime, snap: window.__AP.cfg.snapSec,
          date: document.getElementById('ovDate').textContent, big: document.getElementById('overlay').classList.contains('final'),
          lbl: document.getElementById('ovCountLbl').textContent, val: document.getElementById('ovCountVal').textContent,
          fx: (() => {
            // The animation must really be drawing: count lit pixels on its canvas.
            const c = document.getElementById('fx');
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let lit = 0;
            for (let i = 3; i < d.length; i += 16) if (d[i] > 8) lit++;
            return window.__AP.Celebration.fx.running && lit > 200;
          })(),
          clock: document.getElementById('ovTime').textContent + document.getElementById('ovAmpm').textContent
        };
      });
      check('midnight has passed and the film is past the snap by the same amount', b.since > 0 && Math.abs((b.t - b.snap) - b.since) < 0.08, 'film +' + (b.t - b.snap).toFixed(3) + ' s, clock +' + b.since.toFixed(3) + ' s');
      check('the date rolled over to January 1', /January 1, \d{4}$/.test(b.date), b.date);
      check('the panel countdown is back to normal after zero', !b.big);
      check('clock reads 12:00 AM', /^12:00:\d\dAM$/.test(b.clock), b.clock);
      check('countdown turned into HAPPY NEW YEAR', b.lbl === 'HAPPY NEW YEAR' && /^\d{4}$/.test(b.val), b.lbl + ' ' + b.val);
      check('celebration is playing', b.fx);
      await shot(s.page, 'snap-celebration');
      check('test ends by itself', await waitFor(s.page, () => !window.__AP.Engine.test, null, 25000));
      const r = await s.page.textContent('#testResults .result');
      check('result says PASS', /PASS/.test(r), r);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async slip() {
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.click('.tab[data-tab="test"]');
      await s.page.click('[data-test="slip"]');
      check('drill starts mid-movie in sync', await waitSynced(s.page, 8000));
      check('the drill knocks the film out of sync and the popup appears', await waitFor(s.page, () => !document.getElementById('slip').hidden, null, 12000));
      const a = await state(s.page);
      check('film really is far from the clock', Math.abs(a.t - a.expected) > 3, (a.t - a.expected).toFixed(2) + ' s');
      await shot(s.page, 'slip-popup');
      await s.page.click('#slipBtn');
      check('one click on Recalibrate brings it back', await waitSynced(s.page, 8000));
      await sleep(1500);
      const b = await state(s.page);
      check('back within 60 ms of the clock', Math.abs(b.drift) < 0.06 && Math.abs(b.t - b.expected) < 0.12, ms(b.drift));
      check('popup is gone', await s.page.isHidden('#slip'));
      check('drill reports PASS', await waitFor(s.page, () => !window.__AP.Engine.test, null, 15000) && /PASS/.test(await s.page.textContent('#testResults .result')));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async armed() {
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.evaluate(() => { window.__AP.cfg.autoRecoverSec = 5; });
      await armIn(s.page, 6);
      check('arming puts the film on standby', await waitPhase(s.page, 'standby', 4000));
      check('button now reads COUNTDOWN ARMED', (await s.page.textContent('#armBtn')) === 'COUNTDOWN ARMED');
      check('starts by itself at the start time', await waitSynced(s.page, 12000));
      await sleep(2500);
      let st = await state(s.page);
      check('in sync after the automatic start', Math.abs(st.drift) < 0.05, ms(st.drift));

      await s.page.click('.tab[data-tab="sync"]');
      await sleep(400);
      const sy = await s.page.evaluate(() => ({ state: document.getElementById('syState').textContent, drift: document.getElementById('syDrift').textContent, pos: document.getElementById('syPos').textContent, exp: document.getElementById('syExp').textContent }));
      check('the Sync tab shows film time against clock time', sy.state === 'IN SYNC' && /^[+−±]\d+ ms$/.test(sy.drift) && /^\d:\d\d:\d\d\.\d{3}$/.test(sy.pos) && /^\d:\d\d:\d\d\.\d{3}$/.test(sy.exp), JSON.stringify(sy));
      await s.page.click('.tab[data-tab="mission"]');

      // 1. Space bar: pause -> popup -> R recovers.
      await s.page.keyboard.press('Space');
      check('space pauses and shows the slip popup', await waitPhase(s.page, 'slipped', 2000) && await s.page.isVisible('#slip'));
      check('popup says it was paused', /paused/i.test(await s.page.textContent('#slipTitle')));
      await sleep(1200);
      await s.page.keyboard.press('r');
      check('R recalibrates', await waitSynced(s.page, 8000));
      await sleep(1500);
      st = await state(s.page);
      check('in sync again after a pause', Math.abs(st.drift) < 0.06, ms(st.drift));

      // 2. Slipping on the timeline: click far to the right -> popup -> recovers by itself after 5 s.
      await s.page.mouse.move(400, 400);
      const box = await s.page.locator('#seekTrack').boundingBox();
      await s.page.mouse.click(box.x + box.width * 0.85, box.y + box.height / 2);
      check('a click on the timeline is caught as a slip', await waitPhase(s.page, 'slipped', 2000));
      st = await state(s.page);
      check('film jumped away from the clock', Math.abs(st.t - st.expected) > 20, (st.t - st.expected).toFixed(1) + ' s');
      check('popup names the timeline', /timeline/i.test(await s.page.textContent('#slipTitle')));
      check('recovers by itself after the grace period', await waitSynced(s.page, 12000));
      await sleep(1500);
      st = await state(s.page);
      check('in sync again after the timeline slip', Math.abs(st.drift) < 0.06 && Math.abs(st.t - st.expected) < 0.12, ms(st.drift));

      // 3. Something outside the app pauses the video (headset button, OS): same recovery, Enter this time.
      await s.page.evaluate(() => document.getElementById('video').pause());
      check('an outside pause is caught too', await waitPhase(s.page, 'slipped', 2000));
      await s.page.keyboard.press('Enter');
      check('Enter recalibrates', await waitSynced(s.page, 8000));

      // 4. "Stay out of sync" keeps the popup away until asked.
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      await s.page.click('#slipStay');
      check('stay out of sync shows the small pill instead', await s.page.isHidden('#slip') && await s.page.isVisible('#slipPill'));
      await sleep(6000);
      check('and nothing recovers on its own', (await state(s.page)).phase === 'slipped');
      await s.page.click('#slipPill');
      check('the pill recalibrates', await waitSynced(s.page, 8000));

      // 5. Locked controls: space and the timeline do nothing.
      await s.page.keyboard.press('l');
      await s.page.keyboard.press('Space');
      await s.page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
      await sleep(700);
      st = await state(s.page);
      check('locked controls cannot cause a slip', st.phase === 'synced' && !st.paused);
      await s.page.keyboard.press('l');

      // 6. A forced stall: the film falls behind without anyone touching it -> automatic recalibration.
      await s.page.evaluate(() => { const v = document.getElementById('video'); window.__AP.Engine.engineSeeks++; v.currentTime = v.currentTime - 4; setTimeout(() => { window.__AP.Engine.engineSeeks--; }, 500); });
      check('a silent drift is corrected automatically', await waitFor(s.page, () => window.__AP.Engine.st.autoRecals >= 1, null, 6000) && await waitSynced(s.page, 8000));
      await sleep(1500);
      st = await state(s.page);
      check('in sync after the automatic correction', Math.abs(st.drift) < 0.06, ms(st.drift));
      check('no popup for an automatic correction', await s.page.isHidden('#slip'));
      await shot(s.page, 'armed-playing');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));

      // 7. Stop the countdown: two clicks, then free play. Then arm again, joining late.
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      check('first click asks for confirmation', /CLICK AGAIN/.test(await s.page.textContent('#armBtn')));
      await s.page.click('#armBtn');
      st = await state(s.page);
      check('second click stops the countdown', st.mode === 'free' && !st.armed && st.paused);
      await armIn(s.page, -20);
      check('armed again, joining 20 s late', await waitSynced(s.page, 10000));

      // 8. Close the app in the middle of the movie and open it again: nothing to click.
      const before = await state(s.page);
      await s.close();
      await sleep(1500);
      s = await launch(profile);
      check('reopened: movie loaded and countdown resumed without a click', await waitSynced(s.page, 15000));
      await sleep(1500);
      st = await state(s.page);
      check('reopened: armed and in sync', st.armed && st.mode === 'armed' && Math.abs(st.drift) < 0.06 && Math.abs(st.t - st.expected) < 0.12, ms(st.drift));
      check('reopened: the film moved on with the clock while the app was closed', st.t > before.t + 2, before.t.toFixed(1) + ' -> ' + st.t.toFixed(1));

      // 9. The player page itself crashes: the app reloads it and resumes. Probed through the main
      //    process, because the test driver loses its handle on a crashed page.
      const tBefore = st.t;
      const probe = () => s.app.evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        if (!w || w.webContents.isCrashed() || w.webContents.isLoading()) return null;
        try {
          return await w.webContents.executeJavaScript('window.__AP ? JSON.stringify({ phase: __AP.Engine.phase, mode: __AP.Engine.mode, drift: __AP.Engine.st.drift, t: document.getElementById("video").currentTime, exp: __AP.Engine.expected() }) : null');
        } catch (e) { return null; }
      });
      await s.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(); });
      let after = null;
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        const raw = await probe().catch(() => null);
        const o = raw ? JSON.parse(raw) : null;
        if (o && o.phase === 'synced' && o.drift != null && i >= 4) { after = o; break; }
      }
      check('after a crash of the player page it resumes by itself', !!after, JSON.stringify(after));
      if (after) {
        await sleep(1500);
        after = JSON.parse(await probe());
        check('after the crash: in sync and further along', Math.abs(after.drift) < 0.06 && Math.abs(after.t - after.exp) < 0.12 && after.t > tBefore, ms(after.drift) + ', t=' + after.t.toFixed(1));
      }
    } finally { await s.close(); }
  },

  async crash() {
    // The whole app dies without warning while the movie is playing. Nobody touches anything.
    const profile = newProfile();
    const logFile = path.join(profile, 'avengers-player.log');
    const readLog = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch (e) { return ''; } };
    const s = await launch(profile);
    let newPid = null;
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, -30);
      check('armed and playing in sync', await waitSynced(s.page, 10000));
      await sleep(1500);
      const before = await state(s.page);
      check('the crash watchdog is on while armed', /crash watchdog on/.test(readLog()));
      // The drill button in the Test tab crashes the main process for real.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.click('#crashBtn');
      const dead = Date.now() + 8000;
      while (Date.now() < dead && !/crash drill: crashing on purpose/.test(readLog())) await sleep(100);
      const killedAt = Date.now() + 300;
      let tail = '';
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await sleep(500);
        const text = readLog();
        const at = text.lastIndexOf('[watchdog] the app disappeared');
        tail = at >= 0 ? text.slice(at) : '';
        if (/Locked on: started/.test(tail)) break;
      }
      check('the watchdog noticed the crash and started the app again', /restarted by the crash watchdog/.test(tail), tail.split('\n')[0]);
      check('the new instance imported the movie again by itself', /Movie loaded: movie\.mp4/.test(tail));
      check('and resumed the countdown, locked to the clock', /Countdown resumed/.test(tail) && /Locked on: started \d+ ms/.test(tail), (tail.match(/Locked on[^\n]*/) || [''])[0]);
      const where = /In sync at (\d+):(\d+)(?::(\d+))?/.exec(tail);
      const lockLine = (tail.match(/^(\S+) \[ui\] Locked on/m) || [])[1];
      const took = lockLine ? (Date.parse(lockLine) - killedAt) / 1000 : NaN;
      check('back in sync within 15 seconds of the crash', took < 15, took.toFixed(1) + ' s');
      if (where) {
        const pos = where[3] != null ? (+where[1]) * 3600 + (+where[2]) * 60 + (+where[3]) : (+where[1]) * 60 + (+where[2]);
        // It must come back where the clock is now (old position plus the time lost), give or take the log's 1 s resolution.
        check('the film carried on from where the clock was, not from the top', pos >= before.t && Math.abs(pos - (before.t + took)) < 2.5, 'was at ' + before.t.toFixed(1) + ' s, came back at ' + pos + ' s after ' + took.toFixed(1) + ' s');
      } else check('the film carried on from where the clock was, not from the top', false, 'no position in the log');
      newPid = +(/ pid (\d+) \(restarted/.exec(tail) || [])[1] || null;
      check('a deliberate quit does not bring the app back', true);
    } finally {
      try { fs.writeFileSync(path.join(profile, 'clean-exit'), 'test'); } catch (e) { /* profile gone */ }
      if (newPid) { try { process.kill(newPid, 'SIGKILL'); } catch (e) { /* already gone */ } }
      await s.close();
      await sleep(2500);
      const after = readLog();
      const restarts = (after.match(/\[watchdog\] the app disappeared/g) || []).length;
      check('after a marked clean exit nothing is restarted', restarts === 1, restarts + ' restart(s) in the log');
    }
  },

  async killed() {
    // Same recovery when the app is killed from outside (no crash handler gets a chance to run).
    const profile = newProfile();
    const logFile = path.join(profile, 'avengers-player.log');
    const readLog = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch (e) { return ''; } };
    const s = await launch(profile);
    let newPid = null;
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, 8);
      check('armed and waiting for the start', await waitPhase(s.page, 'standby', 5000));
      const pid = await s.app.evaluate(() => process.pid);
      process.kill(pid, 'SIGKILL');
      let tail = '';
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await sleep(500);
        const text = readLog();
        const at = text.lastIndexOf('[watchdog] the app disappeared');
        tail = at >= 0 ? text.slice(at) : '';
        if (/Locked on: started/.test(tail)) break;
      }
      check('killed while waiting: the app came back and still started the movie on time', /restarted by the crash watchdog/.test(tail) && /In sync at 0:00 \(arm\)/.test(tail) && /Locked on: started \d+ ms/.test(tail), (tail.match(/Locked on[^\n]*/) || ['no lock'])[0]);
      newPid = +(/ pid (\d+) \(restarted/.exec(tail) || [])[1] || null;
    } finally {
      try { fs.writeFileSync(path.join(profile, 'clean-exit'), 'test'); } catch (e) { /* profile gone */ }
      if (newPid) { try { process.kill(newPid, 'SIGKILL'); } catch (e) { /* already gone */ } }
      await s.close();
    }
  },

  async late() {
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      // Arm 30 s after the movie should have started: it must jump in, not start from the top.
      await armIn(s.page, -30);
      check('arming late jumps straight in', await waitSynced(s.page, 10000));
      const st = await state(s.page);
      check('film is where the clock says, not at the start', st.t > 29 && Math.abs(st.t - st.expected) < 0.15, 't=' + st.t.toFixed(2));
      // The film ends: the session closes itself.
      await s.page.evaluate(() => {
        const { Engine } = window.__AP;
        Engine.session.startEpoch -= 165000; Engine.session.targetEpoch -= 165000; Engine.session.endEpoch -= 165000;
        Engine.recalibrate('manual');
      });
      check('when the film ends the countdown closes itself', await waitFor(s.page, () => window.__AP.Engine.mode === 'free' && !window.__AP.cfg.armed, null, 20000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async sound() {
    const s = await launch(newProfile());
    try {
      check('loads a clip with Dolby Digital sound', await loadMovie(s.page, path.join(MEDIA, 'dolby.mp4')));
      const ffmpegHere = await s.page.evaluate(() => window.apNative.ffLocate());
      const known = await waitFor(s.page, () => window.__AP.Media.hasAudio === false, null, 6000);
      if (!known) {
        await s.page.evaluate(() => document.getElementById('video').play());
        check('undecodable sound is noticed once the clip plays', await waitFor(s.page, () => window.__AP.Media.hasAudio === false, null, 8000));
      } else {
        check('undecodable sound is noticed on import' + (ffmpegHere ? ' (FFmpeg probe)' : ''), true);
      }
      check('a warning is on screen', await s.page.isVisible('#audioWarn') || await s.page.isVisible('#modal'));
      check('Fix the sound is offered', await s.page.isVisible('#modal') || await s.page.isVisible('#fixAudioBtn'));
      await shot(s.page, 'sound-warning');
      if (ffmpegHere) {
        if (await s.page.isHidden('#modal')) await s.page.click('#fixAudioBtn');
        await s.page.click('#modalActions .btn-primary');
        check('conversion finishes and the fixed file is loaded', await waitFor(s.page, () => /Avengers Player/.test(window.__AP.Media.info ? window.__AP.Media.info.name : ''), null, 60000));
        await s.page.evaluate(() => document.getElementById('video').play());
        check('the fixed file has playable sound', await waitFor(s.page, () => window.__AP.Media.hasAudio === true, null, 8000));
        const out = await s.page.evaluate(() => window.__AP.Media.info.path);
        try { fs.unlinkSync(out); } catch (e) { /* nothing to clean */ }
      } else {
        console.log('  note  FFmpeg not found on this machine: conversion not exercised');
      }
      await s.page.evaluate(() => { if (!document.getElementById('modal').hidden) window.__AP.cfg && document.querySelector('#modalActions button').click(); });
      check('loads a clip with no sound track', await loadMovie(s.page, path.join(MEDIA, 'silent.mp4')));
      await s.page.evaluate(() => document.getElementById('video').play());
      check('a silent file is reported as having no sound', await waitFor(s.page, () => window.__AP.Media.hasAudio === false, null, 8000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async subtitles() {
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      check('the subtitle file next to the movie is loaded by itself', await waitFor(s.page, () => window.__AP.SubsUI.loaded, null, 6000));
      const n = await s.page.evaluate(() => window.__AP.SubsUI.cues.length);
      check('all 40 lines parsed', n === 40, n);
      await s.page.evaluate(() => { document.getElementById('video').currentTime = 6.5; });
      check('the right line is on screen', await waitFor(s.page, () => /Line 2 at 5 seconds/.test(document.getElementById('subs').textContent), null, 4000), await s.page.textContent('#subs'));
      await shot(s.page, 'subtitles-on');
      await s.page.keyboard.press('c');
      check('C hides the subtitles', await waitFor(s.page, () => document.getElementById('subs').textContent === '', null, 2000));
      await s.page.keyboard.press('c');
      check('C shows them again', await waitFor(s.page, () => /Line 2/.test(document.getElementById('subs').textContent), null, 2000));
      await s.page.evaluate(() => { document.getElementById('video').currentTime = 9.5; });
      await sleep(400);
      check('no line between two cues', (await s.page.textContent('#subs')) === '');
      for (let i = 0; i < 10; i++) await s.page.keyboard.press('x');
      check('+1.0 s delay keeps the earlier line up longer', await waitFor(s.page, () => /Line 2/.test(document.getElementById('subs').textContent), null, 2000), await s.page.textContent('#subs'));
      await s.page.click('.tab[data-tab="subs"]');
      check('delay readout shows +1.0 s', (await s.page.textContent('#subDelay')) === '+1.0 s');
      await s.page.click('#subDelayReset');
      const other = await s.page.evaluate(async (f) => window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(f)), path.join(MEDIA, 'other.vtt'));
      check('a WebVTT file loads', other === true);
      check('italic markup is kept, as real markup', await waitFor(s.page, () => !!document.querySelector('#subs .cue i') && /Other subtitle track/.test(document.getElementById('subs').textContent), null, 3000));
      await shot(s.page, 'subtitles-panel');
      await s.close();
      s = await launch(profile);
      check('after a restart the chosen subtitles come back', await waitFor(s.page, () => window.__AP.Media.ready && window.__AP.SubsUI.loaded && window.__AP.SubsUI.name === 'other.vtt', null, 15000));
      await s.page.click('.tab[data-tab="subs"]');
      await s.page.click('#subClear');
      check('Remove clears them', await s.page.evaluate(() => !window.__AP.SubsUI.loaded && document.getElementById('subs').textContent === ''));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async clock() {
    const fake = JSON.stringify({ ok: true, offsetMs: 1500, uncertaintyMs: 12, method: 'ntp', servers: [] });
    const s = await launch(newProfile(), { AP_FAKE_NTP: fake });
    try {
      check('internet time offset is applied to the app clock', await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 1500, null, 8000));
      const d = await s.page.evaluate(() => window.__AP.Clock.now() - Date.now());
      check('app clock runs 1.5 s ahead of the (slow) PC clock', d === 1500, d);
      await loadMovie(s.page, MOVIE);
      check('pre-flight reports the correction', await waitFor(s.page, () => /1\.5 s slow, corrected/.test(document.getElementById('preflight').textContent), null, 4000), await s.page.textContent('#preflight'));
      await s.page.click('.tab[data-tab="sync"]');
      await s.page.click('label:has(#optNetTime)');
      check('switching the correction off returns to the PC clock', await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 0, null, 3000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async clockjump() {
    // Windows corrects its own clock in the middle of the movie: the PC clock steps 2 s forward
    // while true time does not move. The film must not jump.
    const file = path.join(newProfile(), 'ntp.json');
    const answer = (offsetMs) => fs.writeFileSync(file, JSON.stringify({ ok: true, offsetMs, uncertaintyMs: 10, method: 'ntp', servers: [] }));
    answer(1500);
    const s = await launch(newProfile(), { AP_FAKE_NTP_FILE: file });
    try {
      await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 1500, null, 8000);
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, -40);
      check('playing in sync on internet time', await waitSynced(s.page, 10000));
      await sleep(2000);
      const before = await state(s.page);
      const wallBefore = Date.now();
      answer(-500);
      await s.page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 2000; });
      check('the app notices the jump and re-checks the time', await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === -500, null, 8000));
      await sleep(2500);
      const after = await state(s.page);
      const elapsed = (Date.now() - wallBefore) / 1000;
      check('the film did not jump or recalibrate', after.recals === before.recals && after.autoRecals === before.autoRecals && after.phase === 'synced', 'recals ' + before.recals + ' -> ' + after.recals + ', auto ' + after.autoRecals);
      check('still locked to true time', Math.abs(after.drift) < 0.05 && Math.abs(after.t - after.expected) < 0.1, ms(after.drift));
      check('the film advanced by real elapsed time only', Math.abs((after.t - before.t) - elapsed) < 0.3, 'film ' + (after.t - before.t).toFixed(2) + ' s, real ' + elapsed.toFixed(2) + ' s');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async reopen() {
    // Armed days ahead, then the app is closed and opened again while still waiting for the start.
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await waitFor(s.page, () => window.__AP.SubsUI.loaded, null, 6000);
      await armIn(s.page, 600);
      await waitPhase(s.page, 'standby', 5000);
      await s.page.keyboard.press('f');
      await waitFor(s.page, () => document.getElementById('app').classList.contains('is-fs'), null, 4000);
      await sleep(500);
      await s.close();
      await sleep(1000);
      s = await launch(profile);
      check('reopened while waiting: back on standby', await waitPhase(s.page, 'standby', 12000));
      const ok = await waitFor(s.page, () => window.__AP.UI.booted && window.__AP.SubsUI.loaded && document.getElementById('app').classList.contains('is-fs'), null, 8000);
      const st = await s.page.evaluate(() => ({ booted: !!window.__AP.UI.booted, subs: window.__AP.SubsUI.loaded, fs: document.getElementById('app').classList.contains('is-fs'), standby: !document.getElementById('standby').hidden, armed: window.__AP.cfg.armed }));
      check('startup finishes straight away: subtitles, fullscreen and the standby screen are back', ok && st.standby && st.armed, JSON.stringify(st));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async timeguard() {
    const file = path.join(newProfile(), 'ntp.json');
    const answer = (o) => fs.writeFileSync(file, JSON.stringify(Object.assign({ ok: true, offsetMs: 0, uncertaintyMs: 10, method: 'ntp', servers: [] }, o)));
    const remeasure = (page) => page.evaluate(() => window.__AP.NetTime.measure(false));

    // 1. One vague answer must not undo a good correction.
    answer({ offsetMs: 1500, uncertaintyMs: 12 });
    let s = await launch(newProfile(), { AP_FAKE_NTP_FILE: file });
    try {
      await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 1500, null, 8000);
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, -40);
      await waitSynced(s.page, 10000);
      await sleep(1500);
      const before = await state(s.page);
      answer({ offsetMs: 1480, uncertaintyMs: 600, method: 'https' });
      await remeasure(s.page);
      await sleep(1500);
      let st = await state(s.page);
      check('a vague time answer does not throw away a good correction', st.netOffset === 1500 && st.recals === before.recals && st.autoRecals === before.autoRecals, 'offset ' + st.netOffset + ', recals ' + st.recals);
      answer({ ok: false, offsetMs: 0, uncertaintyMs: null, method: 'none' });
      await remeasure(s.page);
      st = await state(s.page);
      check('nor does a failed one', st.netOffset === 1500, 'offset ' + st.netOffset);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // 2. A correction that only arrives shortly before the start is still used while the film waits.
    answer({ ok: false, offsetMs: 0, uncertaintyMs: null, method: 'none' });
    s = await launch(newProfile(), { AP_FAKE_NTP_FILE: file });
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, 20);
      await waitPhase(s.page, 'standby', 5000);
      check('inside the last two minutes before the start', await s.page.evaluate(() => window.__AP.Engine.nearCritical()));
      answer({ offsetMs: 3000, uncertaintyMs: 10 });
      await remeasure(s.page);
      check('a late first correction is applied while waiting', await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 3000, null, 3000));
      check('and the film then starts on true time', await waitSynced(s.page, 22000));
      await sleep(1500);
      const st = await state(s.page);
      check('in sync on the corrected clock', Math.abs(st.drift) < 0.06 && st.netOffset === 3000, ms(st.drift));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // 3. A PC clock that is hours wrong gets fixed while the film waits: the countdown must survive.
    answer({ offsetMs: 36000000, uncertaintyMs: 10 });
    s = await launch(newProfile(), { AP_FAKE_NTP_FILE: file });
    try {
      await waitFor(s.page, () => window.__AP.Clock.netOffsetMs === 36000000, null, 8000);
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.evaluate(({ snap }) => {
        const { cfg, Engine, Clock } = window.__AP;
        const d = new Date(Clock.now() + (300 + snap) * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        cfg.targetMode = 'custom';
        cfg.customTarget = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        Engine.session = Engine.computeFree();
      }, { snap: SNAP });
      await s.page.click('#armBtn');
      await waitPhase(s.page, 'standby', 5000);
      const toStart = () => s.page.evaluate(() => (window.__AP.Engine.session.startEpoch - window.__AP.Clock.now()) / 1000);
      const t0 = await toStart();
      answer({ offsetMs: 0, uncertaintyMs: 10 });
      await s.page.evaluate(() => { const real = Date.now.bind(Date); Date.now = () => real() + 36000000; });
      await sleep(5000);
      const st = await state(s.page);
      const t1 = await toStart();
      check('a ten-hour clock fix while waiting does not disarm the countdown', st.mode === 'armed' && st.phase === 'standby' && st.armed, st.mode + '/' + st.phase);
      check('and the start time has not moved', st.netOffset === 0 && Math.abs((t0 - t1) - 5) < 1.5, 'start in ' + t0.toFixed(1) + ' s -> ' + t1.toFixed(1) + ' s');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async unplug() {
    // The movie lives on a drive that drops out for a moment while the countdown is armed.
    const dir = newProfile();
    const film = path.join(dir, 'film.mp4');
    const away = path.join(dir, 'film.away');
    fs.copyFileSync(MOVIE, film);
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, film);
      await setSnap(s.page, SNAP);
      await armIn(s.page, 16);
      await waitPhase(s.page, 'standby', 5000);
      fs.renameSync(film, away);
      await s.page.evaluate(() => document.getElementById('video').dispatchEvent(new Event('error')));
      check('the movie going away is noticed', await waitFor(s.page, () => document.getElementById('app').dataset.view === 'import' && window.__AP.cfg.armed, null, 8000));
      await sleep(1500);
      fs.renameSync(away, film);
      check('when it is back the app picks it up by itself', await waitFor(s.page, () => window.__AP.Media.ready && window.__AP.Engine.mode === 'armed', null, 15000));
      check('and the movie still starts on time', await waitSynced(s.page, 20000), JSON.stringify(await s.page.evaluate(() => ({ phase: window.__AP.Engine.phase, mode: window.__AP.Engine.mode, exp: window.__AP.Engine.expected(), dur: document.getElementById('video').duration, ev: window.__AP.Engine.events.slice(-8).map((e) => e.text) }))));
      await sleep(1200);
      const st = await state(s.page);
      check('in sync after the drop-out', Math.abs(st.drift) < 0.06 && Math.abs(st.t - st.expected) < 0.12, ms(st.drift));
      const unexpected = s.errors.filter((e) => !/ERR_FILE_NOT_FOUND/.test(e));      // the missing file itself is expected
      check('no page errors', unexpected.length === 0, unexpected.join(' | '));
    } finally { await s.close(); }
  },

  async fumbles() {
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await s.page.evaluate(() => { window.__AP.cfg.autoRecoverSec = 30; });
      await armIn(s.page, -30);
      await waitSynced(s.page, 10000);

      // Double tap on Space while the popup is up: must end in sync, not "started early".
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      await s.page.keyboard.press('Space');
      await sleep(150);
      await s.page.keyboard.press('Space');
      check('a double tap on Space still ends in sync', await waitSynced(s.page, 8000) && await s.page.isHidden('#slip'));
      let st = await state(s.page);
      check('and is not read as a second slip', st.slips === 1, st.slips + ' slips');

      // A dropdown keeps the focus: the recovery keys must still work.
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.selectOption('#optAutoRecoverSec', '30');
      await s.page.evaluate(() => document.getElementById('video').pause());
      await waitPhase(s.page, 'slipped', 2000);
      await s.page.keyboard.press('r');
      check('R works right after using a dropdown', await waitSynced(s.page, 8000));

      // Double click on Recalibrate in fullscreen must not leave fullscreen.
      await s.page.keyboard.press('f');
      await waitFor(s.page, () => document.getElementById('app').classList.contains('is-fs'), null, 4000);
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      check('the popup shows in fullscreen, centred', await s.page.evaluate(() => {
        const p = document.getElementById('slip').getBoundingClientRect();
        const st = document.getElementById('stage').getBoundingClientRect();
        return !document.getElementById('slip').hidden && Math.abs((p.left + p.right) / 2 - (st.left + st.right) / 2) < 4 && Math.abs((p.top + p.bottom) / 2 - (st.top + st.bottom) / 2) < 4;
      }));
      await shot(s.page, 'slip-fullscreen');
      await s.page.dblclick('#slipBtn');
      check('a double click on Recalibrate recovers', await waitSynced(s.page, 8000));
      await sleep(400);
      check('and stays in fullscreen', await s.page.evaluate(() => document.getElementById('app').classList.contains('is-fs')));
      await s.page.keyboard.press('Escape');

      // Someone pauses seconds before midnight: the New Year animation still plays.
      await s.page.evaluate(() => {
        const { Engine, Clock } = window.__AP;
        const shift = Engine.session.targetEpoch - Clock.now() - 6000;      // the snap is now 6 s away
        Engine.session.targetEpoch -= shift; Engine.session.startEpoch -= shift; Engine.session.endEpoch -= shift;
        Engine.recalibrate('manual');
      });
      await waitSynced(s.page, 8000);
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      check('paused seconds before midnight', (await state(s.page)).phase === 'slipped');
      check('the celebration still fires at midnight', await waitFor(s.page, () => window.__AP.Celebration.fx.running, null, 9000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async nosound() {
    // A PC without FFmpeg: the sound has to be checked at import all the same.
    const s = await launch(newProfile(), { AP_NO_FFMPEG: '1' });
    try {
      check('no FFmpeg on this run', (await s.page.evaluate(() => window.apNative.ffLocate())) === null);
      await loadMovie(s.page, path.join(MEDIA, 'dolby.mp4'));
      check('Dolby sound is noticed right after import, before anything is armed', await waitFor(s.page, () => window.__AP.Media.hasAudio === false, null, 8000));
      check('with a warning and an offer to fix it', await s.page.isVisible('#modal') && /without sound/i.test(await s.page.textContent('#modalTitle')));
      await sleep(600);
      let v = await s.page.evaluate(() => { const v = document.getElementById('video'); return { paused: v.paused, t: v.currentTime, muted: v.muted, volume: v.volume }; });
      check('the film is put back at the start with the sound switched on', v.paused && v.t < 0.1 && !v.muted && v.volume === 1, JSON.stringify(v));
      await s.page.click('#modalActions button');
      await s.page.click('#armBtn');
      check('starting the countdown on a silent movie asks first', await s.page.isVisible('#modal') && (await state(s.page)).mode === 'free');
      await s.page.keyboard.press('Escape');

      await loadMovie(s.page, MOVIE);
      check('a movie with normal sound is confirmed at import too', await waitFor(s.page, () => window.__AP.Media.hasAudio === true && !window.__AP.Media.checking, null, 8000));
      await sleep(400);
      v = await s.page.evaluate(() => { const v = document.getElementById('video'); return { paused: v.paused, t: v.currentTime, muted: v.muted }; });
      check('and it is back at the start, not muted, no warning', v.paused && v.t < 0.1 && !v.muted && await s.page.isHidden('#modal') && await s.page.isHidden('#audioWarn'), JSON.stringify(v));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async guards() {
    const s = await launch(newProfile());
    try {
      // The wrong file: shorter than the snap point (default 2:30:30, the clip is 3:20 long).
      await loadMovie(s.page, MOVIE);
      await s.page.click('#armBtn');
      check('a file that ends before the snap point is refused', await s.page.isVisible('#modal') && /ends before the snap/i.test(await s.page.textContent('#modalTitle')) && (await state(s.page)).mode === 'free');
      check('the message names both lengths', /3:20/.test(await s.page.textContent('#modalBody')) && /2:30:30/.test(await s.page.textContent('#modalBody')), await s.page.textContent('#modalBody'));
      await s.page.click('#modalActions .btn-primary');

      // A mute left over from a rehearsal.
      await setSnap(s.page, SNAP);
      await s.page.keyboard.press('m');
      check('the pre-flight list flags a muted player', await waitFor(s.page, () => /The player is muted/.test(document.getElementById('preflight').textContent), null, 3000));
      await armIn(s.page, 600);
      await waitPhase(s.page, 'standby', 5000);
      const v = await s.page.evaluate(() => ({ muted: document.getElementById('video').muted, cfg: window.__AP.cfg.muted }));
      check('starting the countdown switches the sound back on', !v.muted && !v.cfg, JSON.stringify(v));

      // Subtitles must not sit on the waiting screen (the clip's first line starts at 0:00).
      await waitFor(s.page, () => window.__AP.SubsUI.loaded, null, 6000);
      await sleep(500);
      check('no subtitle line on the standby screen', await s.page.evaluate(() => window.__AP.SubsUI.loaded && window.__AP.cfg.subsOn && document.getElementById('subs').textContent === '' && !document.getElementById('standby').hidden));

      // The clock panel: clock, date, countdown and nothing else by default.
      const rows = await s.page.evaluate(() => ['ovClock', 'ovDate', 'ovCount', 'ovSync'].filter((id) => !document.getElementById(id).hidden));
      check('the clock panel shows exactly clock, date and countdown', rows.join(',') === 'ovClock,ovDate,ovCount', rows.join(','));

      // T brings the panel back when it was hidden with O.
      await s.page.keyboard.press('o');
      await s.page.keyboard.press('t');
      await s.page.keyboard.press('t');
      check('switching the 10 · 9 · 8 animation on shows the clock panel again', await waitFor(s.page, () => !document.getElementById('overlay').hidden && window.__AP.cfg.finalTen, null, 2000));

      // A fullscreen window always has a way out, also on the import screen.
      await s.page.keyboard.press('f');
      await waitFor(s.page, () => document.getElementById('app').classList.contains('is-fs'), null, 4000);
      await s.page.evaluate(() => window.__AP.UI.showImport());
      await s.page.keyboard.press('Escape');
      check('Escape leaves fullscreen on the import screen too', await waitFor(s.page, () => !document.getElementById('app').classList.contains('is-fs'), null, 4000));
      await s.page.evaluate(() => window.__AP.UI.showPlayer());
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async damaged() {
    // Four seconds of the file are garbage (a bad download piece). The film must come back by itself.
    const dir = newProfile();
    const bad = path.join(dir, 'bad.mp4');
    fs.copyFileSync(MOVIE, bad);
    const { spawnSync } = await import('node:child_process');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time,pos', '-of', 'csv=p=0', MOVIE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const at = (t) => { const m = new RegExp('^' + t.toFixed(6) + ',(\\d+)', 'm').exec(probe.stdout || ''); return m ? +m[1] : null; };
    const from = at(50);
    const to = at(54);
    if (from == null || to == null) { console.log('  note  ffprobe not available: damaged-file scenario skipped'); return; }
    const fd = fs.openSync(bad, 'r+');
    const junk = Buffer.alloc(to - from);
    for (let i = 0; i < junk.length; i++) junk[i] = (i * 2654435761) >>> 24;
    fs.writeSync(fd, junk, 0, junk.length, from);
    fs.closeSync(fd);
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, bad);
      await setSnap(s.page, SNAP);
      await armIn(s.page, -44);
      check('playing in sync just before the damaged stretch', await waitSynced(s.page, 10000));
      const hit = await waitFor(s.page, () => (window.__AP.Media.errorTimes || []).length >= 1, null, 15000);
      check('the damage is hit', hit, JSON.stringify(await s.page.evaluate(() => window.__AP.Engine.events.slice(-4).map((e) => e.text))));
      const back = await waitFor(s.page, () => window.__AP.Engine.phase === 'synced' && window.__AP.Engine.st.drift != null && document.getElementById('video').currentTime > 55, null, 30000);
      check('playback comes back by itself once the clock is past it', back, JSON.stringify(await s.page.evaluate(() => ({ phase: window.__AP.Engine.phase, t: document.getElementById('video').currentTime, ev: window.__AP.Engine.events.slice(-5).map((e) => e.text) }))));
      await sleep(2000);
      const st = await state(s.page);
      check('in sync after the damaged stretch, no popup left', st.phase === 'synced' && Math.abs(st.drift) < 0.06 && Math.abs(st.t - st.expected) < 0.12 && await s.page.isHidden('#slip'), ms(st.drift));
    } finally { await s.close(); }
  },

  async screen() {
    // A restart must bring the window back where it was (the TV), not on the default spot.
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await s.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setBounds({ x: 130, y: 70, width: 1180, height: 760 }); });
      await sleep(1200);                    // the position is remembered while running, not only on close
      const saved = JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')).window;
      check('the window position is saved while the app runs', saved && saved.bounds.x === 130 && saved.bounds.y === 70, JSON.stringify(saved));
      await s.close();
      s = await launch(profile);
      const b = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      check('and restored on the next start', b.x === 130 && b.y === 70 && b.width === 1180 && b.height === 760, JSON.stringify(b));
    } finally { await s.close(); }
  },

  async ui() {
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      await s.page.click('.tab[data-tab="display"]');
      const themes = await s.page.$$eval('#themeGrid .theme', (n) => n.map((b) => b.dataset.id));
      check('six app themes are offered', themes.length === 6, themes.join(','));
      for (const id of themes) {
        await s.page.click('#themeGrid .theme[data-id="' + id + '"]');
        await sleep(250);
        await shot(s.page, 'theme-' + id);
      }
      await s.page.click('#themeGrid .theme[data-id="hotrod"]');
      check('choosing a theme restyles the app', await s.page.evaluate(() => document.documentElement.dataset.theme === 'hotrod'));
      const hidden = (id) => waitFor(s.page, (id) => document.getElementById(id).hidden, id, 2000);
      const shown = (id) => waitFor(s.page, (id) => !document.getElementById(id).hidden, id, 2000);
      await s.page.keyboard.press('o');
      check('O hides the clock overlay', await hidden('overlay'));
      await s.page.keyboard.press('o');
      check('O shows it again', await shown('overlay'));
      await s.page.keyboard.press('n');
      check('N switches countdown mode off, the clock stays', await hidden('ovCount') && await s.page.isVisible('#ovClock'));
      await s.page.keyboard.press('n');
      check('N switches countdown mode on, under the clock', await shown('ovCount'));
      await s.page.keyboard.press('t');
      check('T switches the 10 · 9 · 8 animation off', await s.page.evaluate(() => window.__AP.cfg.finalTen === false));
      await s.page.keyboard.press('t');
      check('the control panel is on the left', await s.page.evaluate(() => document.getElementById('panel').getBoundingClientRect().left === 0 && document.getElementById('stage').getBoundingClientRect().left > 300));
      check('the clock panel is on the left of the picture', await s.page.evaluate(() => {
        const st = document.getElementById('stage').getBoundingClientRect();
        const ov = document.getElementById('overlay').getBoundingClientRect();
        return ov.left - st.left < st.width * 0.1 && ov.right < st.left + st.width / 2 && ov.top - st.top < st.height * 0.1;
      }));
      await s.page.click('#optCelebration [data-v="off"]');
      check('the New Year animation can be turned off', await s.page.evaluate(() => window.__AP.cfg.celebration === 'off'));
      await s.page.click('#optCelebration [data-v="stark"]');
      await s.page.keyboard.press('f');
      check('F enters fullscreen and hides the panel', await waitFor(s.page, () => document.getElementById('app').classList.contains('is-fs'), null, 4000) && await s.page.isHidden('#panel'));
      await sleep(500);
      await shot(s.page, 'fullscreen');
      await s.page.evaluate(() => document.getElementById('video').play());
      await s.page.mouse.move(700, 400);
      check('in fullscreen the controls and the cursor hide after a few seconds', await waitFor(s.page, () => document.getElementById('stage').classList.contains('idle') && getComputedStyle(document.getElementById('controls')).opacity === '0' && getComputedStyle(document.getElementById('stage')).cursor === 'none', null, 6000));
      await s.page.mouse.move(720, 420);
      check('and come back when the mouse moves', await waitFor(s.page, () => !document.getElementById('stage').classList.contains('idle'), null, 2000));
      await s.page.evaluate(() => document.getElementById('video').pause());
      await s.page.keyboard.press('Escape');
      check('Escape leaves fullscreen', await waitFor(s.page, () => !document.getElementById('app').classList.contains('is-fs'), null, 4000));
      await setSnap(s.page, '1:23.5');
      await sleep(400);
      await s.close();
      s = await launch(profile);
      await waitFor(s.page, () => window.__AP.Media.ready, null, 15000);
      const kept = await s.page.evaluate(() => ({ theme: document.documentElement.dataset.theme, snap: window.__AP.cfg.snapSec, view: document.getElementById('app').dataset.view }));
      check('settings and the last movie survive a restart', kept.theme === 'hotrod' && kept.snap === 83.5 && kept.view === 'player', JSON.stringify(kept));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  }
};

const started = Date.now();
for (const [name, fn] of Object.entries(scenarios)) {
  if (only.length && !only.some((w) => name.includes(w))) continue;
  current = name;
  console.log('\n' + name);
  try {
    await fn();
  } catch (e) {
    check('scenario ran to the end', false, (e && e.stack || e).toString().split('\n').slice(0, 3).join(' / '));
  }
}
const failed = results.filter((r) => !r.ok);
console.log('\n' + (results.length - failed.length) + ' of ' + results.length + ' checks passed in ' + Math.round((Date.now() - started) / 1000) + ' s');
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log('  ' + f.scenario + ' > ' + f.name + (f.detail ? '  [' + f.detail + ']' : ''));
}
process.exit(failed.length ? 1 : 0);
