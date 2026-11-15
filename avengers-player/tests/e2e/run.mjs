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
      const big = await s.page.evaluate(() => ({ shown: !document.getElementById('bigCount').hidden, n: +document.getElementById('bigNum').textContent }));
      check('the 10 · 9 · 8 animation is counting', big.shown && big.n >= 1 && big.n <= 10, JSON.stringify(big));
      await shot(s.page, 'snap-final-seconds');
      const m = await measureSync(s.page, 8000);
      check('every frame within 60 ms of the clock across midnight', Math.abs(m.worst) < 0.06, ms(m.worst) + ' over ' + m.n + ' frames');
      const b = await s.page.evaluate(() => {
        const { Engine, Clock } = window.__AP;
        const v = document.getElementById('video');
        return {
          since: (Clock.now() - Engine.session.targetEpoch) / 1000, t: v.currentTime, snap: window.__AP.cfg.snapSec,
          date: document.getElementById('ovDate').textContent, big: !document.getElementById('bigCount').hidden,
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
      check('the big countdown is gone after zero', !b.big);
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
      await s.page.click('#optCelebration [data-v="off"]');
      check('the New Year animation can be turned off', await s.page.evaluate(() => window.__AP.cfg.celebration === 'off'));
      await s.page.click('#optCelebration [data-v="stark"]');
      await s.page.keyboard.press('f');
      check('F enters fullscreen and hides the panel', await waitFor(s.page, () => document.getElementById('app').classList.contains('is-fs'), null, 4000) && await s.page.isHidden('#panel'));
      await sleep(500);
      await shot(s.page, 'fullscreen');
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
