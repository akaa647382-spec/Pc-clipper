// End-to-end tests: drive the real Electron app and measure what it actually does.
//   node tests/e2e/run.mjs            run everything
//   node tests/e2e/run.mjs snap slip  run only the scenarios whose name contains one of the words
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
const C_fmt = (sec) => Math.floor(sec / 3600) + ':' + String(Math.floor(sec % 3600 / 60)).padStart(2, '0') + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

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

/** "Find the snap first?": answers the way somebody in a hurry would. Returns whether it was asked. */
function startAnyway(page) {
  return page.evaluate(() => {
    if (document.getElementById('modal').hidden || !/Find the snap first/.test(document.getElementById('modalTitle').textContent)) return false;
    Array.from(document.querySelectorAll('#modalActions button')).find((b) => /Start anyway/.test(b.textContent)).click();
    return true;
  });
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
  await startAnyway(page);
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

/** Points the countdown at a moment such that the movie has to start `startInSec` from now (negative: it already should have). */
async function aimAt(page, startInSec) {
  await page.evaluate(({ startInSec, snap }) => {
    const { cfg, Engine, saveNow } = window.__AP;
    const d = new Date(Date.now() + (startInSec + snap) * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    cfg.targetMode = 'custom';
    cfg.customTarget = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    saveNow();
    Engine.session = Engine.computeFree();
  }, { startInSec, snap: SNAP });
}

/** What the film strip shows, or null when it is closed. */
const stripView = (page) => page.evaluate(() => {
  const S = window.__AP.SnapCam;
  const v = S.view;
  if (!v) return null;
  const g = (id) => document.getElementById(id);
  const tags = (i) => Array.from(g('stripRow').children[i].querySelectorAll('i')).map((x) => x.className + ':' + x.textContent);
  return {
    mode: v.mode, n: v.frames.length, sel: v.sel, selT: v.frames[v.sel].t, first: v.frames[0].t, last: v.frames[v.frames.length - 1].t, dt: v.dt,
    clockT: v.clock >= 0 ? v.frames[v.clock].t : null, nowT: v.now >= 0 ? v.frames[v.now].t : null, readOnly: v.readOnly, offMs: v.offMs,
    flash: v.flash ? { rise: v.frames[v.flash.rise].t, start: v.frames[v.flash.start].t, kind: v.flash.kind } : null,
    gaps: v.frames.slice(1).filter((f, i) => f.t - v.frames[i].t > v.dt * 1.5).length,
    title: g('stripTitle').textContent, note: g('stripNote').textContent, time: g('stripTime').textContent, rel: g('stripRel').textContent,
    ok: g('stripOk').textContent, okDisabled: g('stripOk').disabled, tags: tags(v.sel), thumbs: g('stripRow').children.length,
    shown: !g('strip').hidden && g('stage').classList.contains('has-strip'), preview: !g('stripPreview').hidden,
    videoT: g('video').currentTime, paused: g('video').paused, muted: g('video').muted, rate: g('video').playbackRate
  };
});
const stripOpen = (page, timeout) => waitFor(page, () => !!window.__AP.SnapCam.view, null, timeout || 60000);
const stripClosed = (page) => waitFor(page, () => !window.__AP.SnapCam.view && document.getElementById('strip').hidden, null, 4000);

/**
 * The Final Countdown for every New Year animation, through "Preview the Final Countdown" in the
 * Display tab (open, with a movie loaded and paused): it ticks with the clock in the clock panel,
 * runs that animation's own countdown in that animation's typeface (loaded, and really the one
 * drawn), draws nothing outside the panel, and goes when it is over, clicked again, or a test run
 * starts. Stark has the classic one; with the animation off, the app theme's. Settings are left as
 * they were.
 */
async function tenPreviews(s) {
  const page = s.page;
  // Per countdown (data-ten): the number's own animation (its layers' names start with it, ten-out
  // is shared), whether it has layers, and its typeface: [family, weight, name in the font file], or
  // null for the app's own.
  const TEN = {
    classic: { anim: 'tenpop', layers: false, face: null },
    arc: { anim: 'ten-arc', layers: true, face: ['AP Michroma', '400', 'Michroma'] },
    hotrod: { anim: 'ten-hotrod', layers: true, face: ['AP Russo One', '400', 'Russo One'] },
    infinity: { anim: 'ten-infinity', layers: true, face: ['AP Syncopate', '700', 'Syncopate'] },
    gamma: { anim: 'ten-gamma', layers: true, face: ['AP Anton', '400', 'Anton'] },
    warmachine: { anim: 'ten-wm', layers: true, face: ['AP Black Ops One', '400', 'Black Ops One'] },
    tva: { anim: 'ten-tva', layers: true, face: ['AP Orbitron', '900', 'Orbitron'] },
    doom: { anim: 'ten-doom', layers: true, face: ['AP Cinzel', '900', 'Cinzel'] },
    fireworks: { anim: 'ten-fw', layers: true, face: null },
    minimal: { anim: 'ten-minimal', layers: false, face: null }
  };
  // [the animation, the app theme for Off]: the countdown each one plays
  const CHOICES = [['stark'], ['arc'], ['hotrod'], ['infinity'], ['gamma'], ['warmachine'], ['tva'], ['doom'], ['fireworks'], ['minimal'], ['off', 'tva'], ['off', 'gamma']];
  const tenOf = (c, theme) => (c === 'stark' ? 'classic' : c === 'off' ? theme : c);
  const look = () => page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const box = g('ovCount');
    return {
      pv: window.__AP.UI.tenPv, final: g('overlay').classList.contains('final'), shown: !g('overlay').hidden && !g('ovCount').hidden,
      n: g('ovCountVal').textContent, lbl: g('ovCountLbl').textContent, btn: g('previewTen').textContent, toasts: g('toasts').textContent,
      ten: g('overlay').dataset.ten,
      anims: document.getAnimations().filter((a) => a.effect && a.effect.target && box.contains(a.effect.target) && a.playState !== 'idle')
        .map((a) => a.animationName + (a.effect.pseudoElement || ''))
    };
  });
  // The typeface of the number: what the page asks for, whether that face is loaded, and what the
  // browser really drew it with (DevTools: the fonts used for the node's text).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const face = async () => {
    const doc = await cdp.send('DOM.getDocument', { depth: 0 });
    const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#ovCountVal' });
    const drawn = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId: q.nodeId })).fonts;
    const css = await page.evaluate(() => {
      const v = getComputedStyle(document.getElementById('ovCountVal'));
      return { family: v.fontFamily, weight: v.fontWeight, app: getComputedStyle(document.getElementById('ovCountLbl')).fontFamily,
        loaded: Array.from(document.fonts).filter((f) => f.status === 'loaded').map((f) => f.family.replace(/["']/g, '') + ' ' + f.weight) };
    });
    return { ...css, drawn: drawn.map((f) => ({ name: f.familyName, custom: f.isCustomFont, n: f.glyphCount })) };
  };
  const faceOk = (f, want) => (want
    ? f.family.replace(/["']/g, '').startsWith(want[0] + ',') && f.weight === want[1] && f.loaded.includes(want[0] + ' ' + want[1]) &&
      f.drawn.length > 0 && f.drawn.every((d) => d.custom && d.name.startsWith(want[2]))
    : f.family === f.app && f.drawn.length > 0 && f.drawn.every((d) => !d.custom));
  // Every frame for `ms`: the number, the clock and where the panel is.
  const frames = (ms) => page.evaluate(async (ms) => {
    const g = (id) => document.getElementById(id);
    const out = [];
    const end = performance.now() + ms;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      const r = g('overlay').getBoundingClientRect();
      out.push({ t: performance.now(), n: g('ovCountVal').textContent, clock: g('ovTime').textContent, final: g('overlay').classList.contains('final'),
        shown: !g('overlay').hidden && !g('ovCount').hidden, box: [r.x, r.y, r.width, r.height].map((x) => Math.round(x * 10) / 10).join(',') });
    }
    return out;
  }, ms);
  // Clicks the button early in a second of the clock, so its 10 is followed by 9 at that second's end;
  // returns the frames from just before the click.
  const startPreview = async () => {
    await page.waitForFunction(() => { const p = window.__AP.Clock.now() % 1000; return p > 30 && p < 250; }, null, { polling: 'raf', timeout: 3000 });
    const seen = frames(2400);
    await page.click('#previewTen');
    return seen;
  };
  const noFinal = () => waitFor(page, () => !document.getElementById('overlay').classList.contains('final'), null, 1500);
  // A tick held at several moments: around the panel, nothing differs from the moment it is over.
  const outside = async () => {
    await page.waitForFunction((n) => document.getElementById('ovCountVal').textContent !== n, await page.textContent('#ovCountVal'), { polling: 'raf', timeout: 3000 });
    const box = await page.evaluate(() => { const r = document.getElementById('overlay').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const M = 36;
    const clip = { x: Math.max(0, Math.floor(box.x) - M), y: Math.max(0, Math.floor(box.y) - M) };
    clip.width = Math.ceil(box.x + box.w) + M - clip.x;
    clip.height = Math.ceil(box.y + box.h) + M - clip.y;
    const pics = [];
    for (const t of [950, 0, 60, 150, 300, 600]) {
      const n = await page.evaluate(async (t) => {
        const box = document.getElementById('ovCount');
        window.__held = document.getAnimations().filter((a) => a.effect && a.effect.target && box.contains(a.effect.target));
        window.__held.forEach((a) => { a.pause(); a.currentTime = t; });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return document.getElementById('ovCountVal').textContent;
      }, t);
      pics.push({ n, png: (await page.screenshot({ clip })).toString('base64') });
    }
    // (Only what is still held: one that a new tick has cancelled since would come back to life.)
    await page.evaluate(() => (window.__held || []).forEach((a) => { if (a.playState === 'paused') a.play(); }));
    return page.evaluate(async ({ pics, box, clip }) => {
      const read = async (b64) => {
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const base = await read(pics[0].png);
      const k = base.width / clip.width;
      const G = 4;                       // a few pixels of glow may reach past the edge
      const x0 = (box.x - clip.x - G) * k, x1 = (box.x + box.w - clip.x + G) * k, y0 = (box.y - clip.y - G) * k, y1 = (box.y + box.h - clip.y + G) * k;
      let worst = 0;
      for (const p of pics.slice(1)) {
        const d = await read(p.png);
        let n = 0;
        for (let y = 0; y < d.height; y++) {
          for (let x = 0; x < d.width; x++) {
            if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
            const i = (y * d.width + x) * 4;
            if (Math.max(Math.abs(d.data[i] - base.data[i]), Math.abs(d.data[i + 1] - base.data[i + 1]), Math.abs(d.data[i + 2] - base.data[i + 2])) > 20) n++;
          }
        }
        worst = Math.max(worst, n);
      }
      return { worst, oneTick: pics.every((p) => p.n === pics[0].n), size: base.width + 'x' + base.height };
    }, { pics, box, clip });
  };
  const keys = ['showOverlay', 'showClock', 'showDate', 'showCount', 'finalTen', 'theme', 'overlayPos', 'overlaySize', 'celebration'];
  const settings = () => page.evaluate((keys) => JSON.stringify(keys.map((k) => window.__AP.cfg[k])), keys);
  check('the Display tab has "Preview the Final Countdown" next to its switch', await page.evaluate(() => {
    const b = document.getElementById('previewTen');
    const sw = document.getElementById('optFinal').closest('label');
    return !!b && b.offsetWidth > 0 && /Preview the Final Countdown/.test(b.textContent) && sw.nextElementSibling === b;
  }));

  const celebrationBefore = await page.evaluate(() => window.__AP.cfg.celebration);
  for (const [c, theme] of CHOICES) {
    const id = c + (theme ? ' (theme ' + theme + ')' : '');
    const ten = tenOf(c, theme);
    const want = TEN[ten];
    if (theme) await page.click(`#themeGrid .theme[data-id="${theme}"]`);
    await page.click(`#optCelebration [data-v="${c}"]`);
    const before = await settings();
    const rows = await startPreview();
    const i10 = rows.findIndex((r) => r.final && r.shown && r.n === '10');
    const i9 = rows.findIndex((r, i) => i > i10 && r.n === '9');
    const i8 = rows.findIndex((r, i) => i > i9 && r.n === '8');
    check(`${id}: the preview puts 10 in the clock panel at once, then 9 as the clock's second turns`,
      i10 >= 0 && rows[i10].t - rows[0].t < 700 && i9 > i10 && rows[i9].t - rows[i10].t <= 1100 && rows[i9].clock !== rows[i9 - 1].clock && rows.slice(i10, i9).every((r) => r.final && r.n === '10'),
      i9 > 0 ? `10 for ${Math.round(rows[i9].t - rows[i10].t)} ms, clock ${rows[i9 - 1].clock} -> ${rows[i9].clock}` : JSON.stringify(rows.slice(0, 3)));
    const boxes = new Set(rows.slice(i10).filter((r) => r.final).map((r) => r.box));
    check(`${id}: the panel does not move or change size from one second to the next`, i8 > i9 && boxes.size === 1, [...boxes].join(' | '));
    const v = await look();
    const mine = v.anims.filter((a) => a.startsWith(want.anim) || a.startsWith('ten-out'));
    const layers = v.anims.filter((a) => a.includes('::')).length;
    check(`${id}: its own countdown (${ten}) is the one running, on the number${want.layers ? ' and its layers' : ' alone'}`,
      v.ten === ten && v.anims.includes(want.anim) && mine.length === v.anims.length && (want.layers ? layers >= 2 : v.anims.length === 1) && (ten === 'classic' || !v.anims.includes('tenpop')),
      v.ten + ': ' + v.anims.join(' '));
    const f = await face();
    check(`${id}: the number is drawn in ${want.face ? want.face[0] + ', loaded' : 'the app\'s own typeface'}`, faceOk(f, want.face),
      f.family.split(',')[0] + ' ' + f.weight + ' -> ' + f.drawn.map((d) => d.name + (d.custom ? ' (shipped)' : '')).join(', '));
    await sleep(150);
    await shot(page, 'ten-' + c + (theme ? '-' + theme : ''));
    // (Should a new tick come in the middle, its frames are as good a sample: around the panel they
    // must not differ either.)
    const o = await outside();
    check(`${id}: nothing is drawn outside the clock panel, all through a tick`, o.worst === 0, JSON.stringify(o));
    if (c === 'arc') {
      // Another animation mid-preview: its countdown takes over, the old one is gone, the preview goes on.
      await page.click('#optCelebration [data-v="gamma"]');
      await sleep(120);
      const w = await look();
      check('an animation chosen during the preview takes over at once, the old countdown stops', w.pv === v.pv && w.final && w.ten === 'gamma' && w.anims.includes('ten-gamma') && !w.anims.some((a) => a.startsWith('ten-arc')), w.ten + ': ' + w.anims.join(' '));
      await page.click('#optCelebration [data-v="arc"]');
      // The app theme has no say while an animation is chosen.
      const was = await page.evaluate(() => window.__AP.cfg.theme);
      await page.click('#themeGrid .theme[data-id="doom"]');
      await sleep(120);
      const t = await look();
      check('with an animation chosen, another app theme leaves its countdown as it is', t.final && t.ten === 'arc' && t.anims.includes('ten-arc') && !t.anims.some((a) => a.startsWith('ten-doom')), t.ten + ': ' + t.anims.join(' '));
      await page.click(`#themeGrid .theme[data-id="${was}"]`);
    }
    if (c === 'off' && theme === 'tva') {
      // With the animation off, the countdown is the theme's: another theme mid-preview takes over.
      await page.click('#themeGrid .theme[data-id="hotrod"]');
      await sleep(120);
      const w = await look();
      check('with the animation off, a theme chosen during the preview takes over the countdown at once', w.final && w.ten === 'hotrod' && w.anims.includes('ten-hotrod') && !w.anims.some((a) => a.startsWith('ten-tva')), w.ten + ': ' + w.anims.join(' '));
      await page.click('#themeGrid .theme[data-id="tva"]');
    }
    if (id !== 'off (theme gamma)') {
      await page.click('#previewTen');
      await noFinal();
      const x = await look();
      check(`${id}: clicked again, the preview stops and the panel is as it was`, !x.pv && !x.final && x.btn === 'Preview the Final Countdown' && !/^\d+$/.test(x.n) && x.lbl === 'NEW YEAR IN', JSON.stringify({ pv: x.pv, final: x.final, n: x.n, btn: x.btn }));
    } else {
      const ended = await waitFor(page, () => !window.__AP.UI.tenPv && !document.getElementById('overlay').classList.contains('final'), null, 10000);
      const x = await look();
      check(`${id}: the preview stops by itself after 1, and the panel is as it was`, ended && x.btn === 'Preview the Final Countdown' && !/^\d+$/.test(x.n) && x.lbl === 'NEW YEAR IN' && x.anims.length === 0, JSON.stringify({ n: x.n, lbl: x.lbl, btn: x.btn, anims: x.anims }));
    }
    check(`${id}: the preview changed no setting`, (await settings()) === before, await settings());
  }
  await page.click(`#optCelebration [data-v="${celebrationBefore}"]`);

  // With the clock panel switched off, the preview still shows it, and hides it again after.
  await page.keyboard.press('o');
  await waitFor(page, () => document.getElementById('overlay').hidden, null, 2000);
  await page.click('#previewTen');
  check('with the clock panel off, the preview shows it while it runs', await waitFor(page, () => !document.getElementById('overlay').hidden && document.getElementById('overlay').classList.contains('final'), null, 1500));
  await page.click('#previewTen');
  check('and hides it again when it stops, still switched off', await waitFor(page, () => document.getElementById('overlay').hidden, null, 1500) && await page.evaluate(() => window.__AP.cfg.showOverlay === false));
  await page.keyboard.press('o');
  await waitFor(page, () => !document.getElementById('overlay').hidden, null, 2000);

  // Never during a test run: refused, and a test run that starts stops a running preview.
  await page.click('#previewTen');
  await waitFor(page, () => document.getElementById('overlay').classList.contains('final'), null, 1500);
  await page.click('.tab[data-tab="test"]');
  await page.click('[data-test="slip"]');
  check('a test run that starts stops the preview', await waitFor(page, () => !!window.__AP.Engine.test && !window.__AP.UI.tenPv && !document.getElementById('overlay').classList.contains('final'), null, 3000));
  await page.click('.tab[data-tab="display"]');
  await page.click('#previewTen');
  await sleep(400);
  const t = await look();
  check('during a test run the Final Countdown preview is refused and says why', !t.pv && !t.final && /Not during a test run/.test(t.toasts), JSON.stringify({ pv: t.pv, final: t.final, toasts: t.toasts }));
  await page.evaluate(() => window.__AP.Engine.endTest('Stopped by the test.'));
  await waitFor(page, () => !window.__AP.Engine.test && document.getElementById('video').paused, null, 4000);
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
          bigger: v.height > clock.height, stray: !!document.getElementById('bigCount'),
          ten: document.getElementById('overlay').dataset.ten,
          anims: document.getAnimations().filter((a) => a.effect && a.effect.target && document.getElementById('ovCount').contains(a.effect.target)).map((a) => a.animationName)
        };
      });
      check('the 10 · 9 · 8 countdown ticks inside the clock panel, under the clock', big.final && big.n >= 1 && big.n <= 10 && big.inside && big.under && big.bigger, JSON.stringify(big));
      check('with Stark (the default animation) it is the classic Final Countdown', big.ten === 'classic' && big.anims.join() === 'tenpop', big.ten + ': ' + big.anims.join(' '));
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

      // 4. "Stay out of sync": paused on purpose, the film waits until RECALIBRATE is pressed.
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      check('the popup offers STAY OUT OF SYNC as a button next to RECALIBRATE', await s.page.evaluate(() => {
        const b = document.getElementById('slipStay');
        const r = b.getBoundingClientRect();
        return b.textContent === 'STAY OUT OF SYNC' && b.classList.contains('btn') && r.width > 200 && r.height > 30;
      }));
      await s.page.click('#slipStay');
      check('stay out of sync shows the small pill instead', await s.page.isHidden('#slip') && await s.page.isVisible('#slipPill'));
      check('and the Mission tab offers RECALIBRATE', await s.page.isVisible('#missionRecal'));
      const heldAt = (await state(s.page)).t;
      await sleep(12000);
      st = await state(s.page);
      check('nothing plays or recovers on its own, even past the automatic recalibration', st.phase === 'slipped' && st.paused && Math.abs(st.t - heldAt) < 0.05, 'paused at ' + heldAt.toFixed(2) + ', now ' + st.t.toFixed(2));
      await s.page.click('#missionRecal');
      check('RECALIBRATE in the Mission tab brings it back on the clock', await waitSynced(s.page, 8000));
      check('and the button goes away again', await waitFor(s.page, () => document.getElementById('missionRecal').hidden, null, 2000));
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      await s.page.click('#slipStay');
      await s.page.click('#slipPill');
      check('the pill recalibrates too', await waitSynced(s.page, 8000));

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

  async subsync() {
    const TALK = path.join(MEDIA, 'talk.mp4');
    const loadSub = (page, name) => page.evaluate(async (f) => window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(f)), path.isAbsolute(name) ? name : path.join(MEDIA, name));
    const sync = (page) => page.evaluate(() => {
      const { cfg, SubSync, SubsUI } = window.__AP;
      const note = document.getElementById('subSyncNote');
      return {
        delay: cfg.subDelay, scale: cfg.subScale, state: SubSync.state(), busy: SubSync.busy, wanted: SubSync.wanted(), by: SubSync.last ? SubSync.last.by : '',
        note: note.hidden ? '' : note.textContent, undo: !document.getElementById('subSyncUndo').hidden, name: SubsUI.name, lines: SubsUI.cues.length,
        button: document.getElementById('subSync').textContent, disabled: document.getElementById('subSync').disabled, toasts: document.getElementById('toasts').textContent
      };
    });
    // The check of the file that is loaded now has run to its end.
    const settled = (page, timeout) => waitFor(page, () => {
      const { SubSync, cfg } = window.__AP;
      return !SubSync.busy && !SubSync.autoKey && SubSync.key() !== '' && cfg.subSyncKey === SubSync.key();
    }, null, timeout || 90000);
    const lineAt = async (page, t) => {
      await page.evaluate((x) => { document.getElementById('video').currentTime = x; }, t);
      await sleep(350);
      return page.textContent('#subs');
    };
    // The lines of the film as they really are (talk.srt), to compare against.
    const truth = Array.from(fs.readFileSync(path.join(MEDIA, 'talk.srt'), 'utf8').matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> /g)).map((m) => (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000);

    const profile = newProfile();
    let s = await launch(profile);
    try {
      /* ---- a file that is right is left alone ---- */
      await loadMovie(s.page, TALK);
      check('the subtitle file next to the film is loaded', await waitFor(s.page, () => window.__AP.SubsUI.loaded && window.__AP.SubsUI.name === 'talk.srt', null, 8000));
      check('the app checks it against the voices by itself', await settled(s.page));
      let st = await sync(s.page);
      check('a file that is in sync is left as it is', st.state === 'fine' && st.delay === 0 && st.scale === 1 && !st.undo, JSON.stringify(st));
      await s.page.click('.tab[data-tab="subs"]');
      check('and the Subs tab says so', /in sync with the voices/.test(st.note) && /sound of the film/.test(st.note), st.note);
      check('line 1 is on screen while it is spoken', /^Line 1 of the film\.$/.test(await lineAt(s.page, truth[0] + 1)), await s.page.textContent('#subs'));

      /* ---- a file that comes early is put right without asking ---- */
      await loadSub(s.page, 'talk-early.srt');
      check('a new subtitle file is checked too', await settled(s.page));
      st = await sync(s.page);
      check('lines that come 2.4 s early are moved 2.4 s later', st.state === 'synced' && Math.abs(st.delay - 2.4) <= 0.12 && st.scale === 1, JSON.stringify({ state: st.state, delay: st.delay, scale: st.scale }));
      check('the note says what was wrong and what was done', /came 2\.\d\d s early\. They are now in sync with the voices/.test(st.note), st.note);
      check('a toast says it too', /Subtitles were 2\.\d\d s early: now in sync with the voices/.test(st.toasts), st.toasts);
      check('the delay readout shows the shift to the hundredth', /^\+2\.[34]\d? s$/.test(await s.page.textContent('#subDelay')), await s.page.textContent('#subDelay'));
      check('line 1 is on screen while it is spoken, not 2.4 s before', /^Line 1 of the film\.$/.test(await lineAt(s.page, truth[0] + 1)) && (await lineAt(s.page, truth[0] - 1.2)) === '', await s.page.textContent('#subs'));
      await shot(s.page, 'subsync-synced');

      check('Undo is offered', st.undo);
      await s.page.click('#subSyncUndo');
      st = await sync(s.page);
      check('Undo puts the lines back where the file has them', st.delay === 0 && st.scale === 1 && st.state === 'undone' && !st.undo, JSON.stringify(st));
      await sleep(2500);
      st = await sync(s.page);
      check('and the app does not move them again by itself', st.delay === 0 && !st.busy && !st.wanted, JSON.stringify(st));
      await s.page.click('#subSync');
      check('the button syncs them on request', await waitFor(s.page, () => window.__AP.SubSync.state() === 'synced' && !window.__AP.SubSync.busy, null, 60000));
      st = await sync(s.page);
      check('to the same place', Math.abs(st.delay - 2.4) <= 0.12, st.delay);
      const before = st.delay;
      await s.page.click('#subDelayPlus');
      check('the − / + buttons still move them by hand, in tenths', Math.abs((await sync(s.page)).delay - (before + 0.1)) < 1e-9, (await sync(s.page)).delay);
      await s.page.click('#subSync');
      await waitFor(s.page, () => !window.__AP.SubSync.busy && /already in sync|now in sync/.test(document.getElementById('toasts').textContent), null, 60000);
      st = await sync(s.page);
      check('syncing again after a nudge by hand puts them back on the voices', Math.abs(st.delay - 2.4) <= 0.12, st.delay);
      await s.page.click('#subDelayReset');
      st = await sync(s.page);
      check('"reset" goes back to the file as it is', st.delay === 0 && st.scale === 1, JSON.stringify({ delay: st.delay, scale: st.scale }));

      /* ---- a file made for a copy of the film at another speed ---- */
      await loadSub(s.page, 'talk-pal.srt');
      check('a file made for a 25 frames-a-second copy is checked', await settled(s.page));
      st = await sync(s.page);
      const mapped = await s.page.evaluate(() => { const { cfg, SubsUI } = window.__AP; return SubsUI.cues.map((c) => c.start * cfg.subScale + cfg.subDelay); });
      const worst = Math.max(...mapped.map((t, i) => Math.abs(t - truth[i])));
      check('its speed is corrected as well as its shift', st.state === 'synced' && Math.abs(st.scale - 25000 / 23976) < 0.002 && mapped.length === truth.length, JSON.stringify({ state: st.state, delay: st.delay, scale: st.scale }));
      check('every line lands within 0.2 s of where it is spoken', worst <= 0.2, worst.toFixed(3) + ' s at worst');
      check('the note explains the speed', /wrong speed for this film/.test(st.note) && /4% faster/.test(st.note), st.note);
      check('the Subs tab shows the speed', await s.page.isVisible('#subSpeed') && /×1\.04/.test(await s.page.textContent('#subSpeed')), await s.page.textContent('#subSpeed'));
      check('the last line of the film is on screen while it is spoken', new RegExp('^Line ' + truth.length + ' of the film\\.$').test(await lineAt(s.page, truth[truth.length - 1] + 0.6)), await s.page.textContent('#subs'));

      /* ---- the subtitles of another film ---- */
      await loadSub(s.page, 'talk-other.srt');
      check('a file that belongs to another film is checked', await settled(s.page));
      st = await sync(s.page);
      check('nothing is moved when the lines fit nowhere', st.state === 'unsure' && st.delay === 0 && st.scale === 1 && !st.undo, JSON.stringify({ state: st.state, delay: st.delay, scale: st.scale }));
      check('and the app says it could not tell', /could not work out where these subtitles belong/.test(st.note) && /Nothing was changed/.test(st.note), st.note);
      await s.page.click('#subSync');
      check('asking for it by hand says the same', await waitFor(s.page, () => /Could not sync the subtitles/.test(document.getElementById('toasts').textContent), null, 60000));
      st = await sync(s.page);
      check('and still moves nothing', st.delay === 0 && st.scale === 1, JSON.stringify({ delay: st.delay, scale: st.scale }));

      /* ---- the switch ---- */
      await s.page.click('label:has(#optSubAuto)');
      check('the automatic check can be switched off', await s.page.evaluate(() => window.__AP.cfg.subAutoSync === false));
      await loadSub(s.page, 'talk-early.srt');
      await sleep(3000);
      st = await sync(s.page);
      check('then a new file is left alone', st.delay === 0 && st.state === '' && !st.busy && !st.wanted && st.note === '', JSON.stringify(st));
      await s.page.click('label:has(#optSubAuto)');
      check('switching it on checks the file that is loaded', await settled(s.page) && Math.abs((await sync(s.page)).delay - 2.4) <= 0.12, (await sync(s.page)).delay);

      /* ---- it is all remembered ---- */
      await sleep(400);
      await s.close();
      s = await launch(profile);
      check('after a restart the film and its subtitles are back', await waitFor(s.page, () => window.__AP.Media.ready && window.__AP.SubsUI.loaded && window.__AP.SubsUI.name === 'talk-early.srt', null, 15000));
      await sleep(2500);
      st = await sync(s.page);
      check('with the shift they were given, and without another check', Math.abs(st.delay - 2.4) <= 0.12 && st.state === 'synced' && !st.busy && !st.wanted, JSON.stringify(st));
      await s.page.click('.tab[data-tab="subs"]');
      check('the Subs tab says they have been synced', /have been synced with the voices/.test((await sync(s.page)).note), (await sync(s.page)).note);

      /* ---- an armed countdown ---- */
      const mission = () => s.page.click('.tab[data-tab="mission"]');
      await setSnap(s.page, SNAP);
      await armIn(s.page, 20 * 60);
      await waitPhase(s.page, 'standby');
      await s.page.evaluate(() => { window.__AP.cfg.subSyncKey = ''; window.__AP.cfg.subSyncState = ''; });
      await loadSub(s.page, 'talk-early.srt');
      check('with the film due in twenty minutes a new file is still checked', await settled(s.page) && Math.abs((await sync(s.page)).delay - 2.4) <= 0.12, JSON.stringify(await sync(s.page)));
      check('and the countdown stays armed', (await state(s.page)).mode === 'armed' && (await state(s.page)).phase === 'standby');
      await s.page.evaluate(() => window.__AP.Engine.disarm());
      await armIn(s.page, 150);
      await waitPhase(s.page, 'standby');
      await s.page.evaluate(() => { window.__AP.cfg.subSyncKey = ''; window.__AP.cfg.subSyncState = ''; });
      await loadSub(s.page, 'talk-early.srt');
      await sleep(3000);
      st = await sync(s.page);
      check('with the film due in a few minutes the app leaves the subtitles alone', st.delay === 0 && !st.busy && !st.wanted && st.state === '', JSON.stringify(st));
      await s.page.click('.tab[data-tab="subs"]');
      await s.page.click('#subSync');
      check('but the button still works while the film waits', await waitFor(s.page, () => window.__AP.SubSync.state() === 'synced' && !window.__AP.SubSync.busy, null, 60000) && Math.abs((await sync(s.page)).delay - 2.4) <= 0.12, JSON.stringify(await sync(s.page)));
      await s.page.evaluate(() => window.__AP.Engine.disarm());
      // The film is running and the snap is a minute away: nothing may get in its way.
      await mission();
      await armIn(s.page, -40);
      await waitSynced(s.page, 30000);
      await s.page.click('.tab[data-tab="subs"]');
      await s.page.click('#subDelayReset');
      await s.page.click('#subSync');
      await sleep(1500);
      st = await sync(s.page);
      check('close to the snap the button refuses and says why', /Not this close to the snap/.test(st.toasts) && !st.busy && st.delay === 0, JSON.stringify({ toasts: st.toasts, busy: st.busy, delay: st.delay }));
      await s.page.evaluate(() => window.__AP.Engine.disarm());
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    /* ---- surround sound, and subtitles inside the movie file ---- */
    s = await launch(newProfile());
    try {
      await loadMovie(s.page, path.join(MEDIA, 'talk-51.mkv'));
      await waitFor(s.page, () => window.__AP.Media.inspected, null, 15000);
      await loadSub(s.page, 'talk-early.srt');
      check('5.1 film: the file is checked', await settled(s.page));
      let st = await sync(s.page);
      const last = await s.page.evaluate(() => { const l = window.__AP.SubSync.last; return { v: l.voices && { o: l.voices.offset, c: l.voices.confident }, i: l.inside && { o: l.inside.offset, c: l.inside.confident, s: l.inside.strength } }; });
      check('the voices are heard in the centre channel, under loud music left and right', last.v && last.v.c && Math.abs(last.v.o - 2.4) <= 0.12, JSON.stringify(last.v));
      check('the subtitles inside the movie file say the same, more exactly', last.i && last.i.c && last.i.s > 0.9 && Math.abs(last.i.o - 2.4) <= 0.06, JSON.stringify(last.i));
      check('both are believed together', st.by === 'both' && st.state === 'synced' && Math.abs(st.delay - 2.4) <= 0.06 && /sound of the film and the subtitles inside the movie file/.test(st.note), JSON.stringify({ by: st.by, delay: st.delay, note: st.note }));
      // Subtitles taken out of the movie file itself need no check.
      await s.page.click('.tab[data-tab="subs"]');
      await s.page.click('#subEmbedded button');
      check('the movie\'s own subtitles load', await waitFor(s.page, () => window.__AP.SubsUI.loaded && window.__AP.SubsUI.own, null, 20000));
      await sleep(1500);
      st = await sync(s.page);
      check('they are not checked or moved: they are right as they are', st.delay === 0 && st.scale === 1 && !st.busy && !st.wanted && st.disabled && /come from inside the movie file/.test(st.note), JSON.stringify(st));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    /* ---- a long film is listened to in stretches ---- */
    s = await launch(newProfile());
    try {
      await loadMovie(s.page, path.join(MEDIA, 'talk-long.mp4'));
      check('half-hour film: its own subtitle file is found in sync', await settled(s.page) && (await sync(s.page)).state === 'fine', JSON.stringify(await sync(s.page)));
      const windows = await s.page.evaluate(() => window.__AP.SubSync.last.voices.windows.length);
      check('it was listened to in six stretches, not from end to end', windows === 6, windows);
      await loadSub(s.page, 'talk-long-ntsc.srt');
      await settled(s.page);
      let st = await sync(s.page);
      check('a file made for a 24.000 frames-a-second copy: a tenth of a percent of speed is found', st.state === 'synced' && Math.abs(st.scale - 24000 / 23976) < 1e-6 && Math.abs(st.delay - 0.8) <= 0.15, JSON.stringify({ state: st.state, delay: st.delay, scale: st.scale }));
      check('and named as less than a percent', /0\.1% faster/.test(st.note), st.note);
      await loadSub(s.page, 'talk-long-cut.srt');
      await settled(s.page);
      st = await sync(s.page);
      check('a file made for a different cut is recognised', st.state === 'mixed' && st.delay === 0 && st.scale === 1, JSON.stringify({ state: st.state, delay: st.delay, scale: st.scale }));
      check('the note says where it stops matching and by how much', /in sync with most of the film/.test(st.note) && /about 20 s later than in the rest/.test(st.note) && /different cut/.test(st.note), st.note);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    /* ---- without FFmpeg ---- */
    s = await launch(newProfile(), { AP_NO_FFMPEG: '1' });
    try {
      await loadMovie(s.page, TALK);
      await waitFor(s.page, () => window.__AP.SubsUI.loaded, null, 8000);
      await loadSub(s.page, 'talk-early.srt');
      await sleep(3000);
      let st = await sync(s.page);
      check('without FFmpeg nothing is moved', st.delay === 0 && st.state === '' && !st.busy && !st.wanted, JSON.stringify(st));
      check('and the Subs tab says what is needed', /needs the free tool FFmpeg/.test(st.note), st.note);
      await s.page.click('.tab[data-tab="subs"]');
      await s.page.click('#subSync');
      check('the button offers to get FFmpeg', await waitFor(s.page, () => !document.getElementById('modal').hidden && /Sync with the voices/.test(document.getElementById('modalTitle').textContent) && /FFmpeg/.test(document.getElementById('modalBody').textContent), null, 5000));
      await s.page.keyboard.press('Escape');
      check('Escape closes the offer', await waitFor(s.page, () => document.getElementById('modal').hidden, null, 3000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    /* ---- the line before the snap: whose subtitles are believed ---- */
    s = await launch(newProfile());
    try {
      // The lines of snap-subs.mkv, made for a copy of the film that starts 20 s later.
      const wrong = path.join(s.profile, 'late-copy.srt');
      fs.writeFileSync(wrong, '1\n00:01:53,000 --> 00:01:55,000\nI am... inevitable.\n\n2\n00:01:56,500 --> 00:01:57,400\nAnd I...\n\n3\n00:01:57,600 --> 00:01:58,300\nam...\n\n4\n00:01:59,100 --> 00:02:00,600\nIron Man.\n\n5\n00:02:40,000 --> 00:02:42,000\nMr. Stark?\n');
      await s.page.evaluate(() => { window.__AP.cfg.subAutoSync = false; });
      await loadMovie(s.page, path.join(MEDIA, 'snap-subs.mkv'));
      await waitFor(s.page, () => window.__AP.Media.inspected && !window.__AP.SnapCam.busy, null, 90000);
      await setSnap(s.page, 100);
      await loadSub(s.page, wrong);
      let line = await s.page.evaluate(() => window.__AP.SnapCam.line());
      check('a subtitle file nobody has checked is not asked where the snap is: the movie\'s own subtitles are', line && /inside the movie/.test(line.from) && Math.abs(line.end - 100.6) < 0.1, JSON.stringify(line));
      await s.page.evaluate(() => { window.__AP.cfg.subAutoSync = true; window.__AP.SubSync.fileChanged(true); });
      check('once it is checked', await settled(s.page));
      const st = await sync(s.page);
      check('the file is found to be 20 s late, from the movie\'s own subtitles (five lines and a steady tone are nothing to go by)', st.state === 'synced' && st.by === 'inside' && Math.abs(st.delay + 20) <= 0.1, JSON.stringify({ state: st.state, by: st.by, delay: st.delay }));
      line = await s.page.evaluate(() => window.__AP.SnapCam.line());
      check('and then its line before the snap is in the right place', line && line.from === 'the subtitles' && Math.abs(line.end - 100.6) < 0.1, JSON.stringify(line));
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
      await startAnyway(s.page);
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

      // A snap point that was never checked against the picture: the mistake this app exists to prevent.
      await setSnap(s.page, SNAP);
      await aimAt(s.page, 600);
      await s.page.click('#armBtn');
      const asked = async () => !(await s.page.isHidden('#modal')) && /Find the snap first/.test(await s.page.textContent('#modalTitle'));
      check('starting the countdown with an unchecked snap point asks first', await asked() && (await state(s.page)).mode === 'free' && /0:01:40/.test(await s.page.textContent('#modalBody')) && /round figure/.test(await s.page.textContent('#modalBody')), await s.page.textContent('#modalBody'));
      check('with three ways on: cancel, start anyway, find the snap', (await s.page.$$eval('#modalActions button', (b) => b.map((x) => x.textContent).join(' | '))) === 'Cancel | Start anyway | Find the snap');
      await s.page.click('#modalActions .btn-primary');
      check('“Find the snap” starts the search', await waitFor(s.page, () => !document.getElementById('modal').hidden && /Looking for the snap/.test(document.getElementById('modalTitle').textContent), null, 3000) && (await state(s.page)).mode === 'free');
      await s.page.click('#modalActions button');
      await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 6000);
      await s.page.click('#armBtn');
      check('it asks again the next time', await asked());
      check('“Start anyway” starts the countdown', await startAnyway(s.page) && await waitPhase(s.page, 'standby', 5000) && (await state(s.page)).mode === 'armed');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      await s.page.click('#armBtn');
      check('with the snap point confirmed nothing is asked', !(await asked()) && await waitPhase(s.page, 'standby', 5000));
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      await aimAt(s.page, -20);
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000);
      await setSnap(s.page, SNAP + 1);
      await aimAt(s.page, -20);
      await s.page.keyboard.press('Enter');
      check('somebody joining late is not held up by the question', !(await asked()) && await waitSynced(s.page, 12000));
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      await s.page.evaluate(() => { window.__AP.cfg.targetMode = 'newyear'; window.__AP.Engine.session = window.__AP.Engine.computeFree(); });

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

  async versions() {
    // Tiny clips with the real lengths: ENDGAME (3:01:11), ENCORE (3:01:36) and a longer copy (3:05:10).
    // Each has the flash of a snap in it: 1.67 s after 2:30:30 in the first and the last, 25 s later
    // than that in the 3:01:36 clip. They run at 6 frames a second, so a frame is 0.167 s long.
    // The app is expected to find the snap in each of them BY ITSELF when the file is imported.
    const ENDGAME = path.join(MEDIA, 'original-length.mp4');
    const ENCORE = path.join(MEDIA, 'encore-short.mp4');
    const LONGER = path.join(MEDIA, 'encore-length.mp4');
    if (![ENDGAME, ENCORE, LONGER].every((f) => fs.existsSync(f))) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const info = (page) => page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      const mem = window.__AP.cfg.snapByFile;
      return {
        version: window.__AP.cfg.filmVersion, snap: window.__AP.cfg.snapSec, dur: g('video').duration, card: g('fileMeta').textContent, point: g('ktPoint').textContent,
        start: g('ktStart').textContent, target: g('ktSnap').textContent, preflight: g('preflight').textContent, picker: g('filmVersion').value,
        options: Array.from(g('filmVersion').options).map((o) => o.textContent), note: g('filmVersionNote').textContent,
        lengthNote: g('filmLengthNote').hidden ? '' : g('filmLengthNote').textContent, findBtn: !g('findSnapBtn').hidden,
        files: Object.keys(mem).length, mode: window.__AP.Engine.mode, phase: window.__AP.Engine.phase, armed: window.__AP.cfg.armed
      };
    });
    const searching = (page, timeout) => waitFor(page, () => !document.getElementById('modal').hidden && /Finding the snap in this film/.test(document.getElementById('modalTitle').textContent), null, timeout || 12000);
    // The panel is redrawn a few times a second: wait for a text rather than read it at once.
    const shows = (page, id, re) => waitFor(page, ({ id, src }) => new RegExp(src).test(document.getElementById(id).textContent), { id, src: re.source }, 4000);
    const quiet = async (page, forMs) => {       // nothing starts by itself for a while
      const end = Date.now() + forMs;
      while (Date.now() < end) {
        if (await page.evaluate(() => window.__AP.SnapCam.busy || !!window.__AP.SnapCam.view || !document.getElementById('modal').hidden)) return false;
        await sleep(250);
      }
      return true;
    };
    // The same film under another name, without using more disk: a second name for the same file.
    const dir = newProfile();
    const alias = (file, name) => { const to = path.join(dir, name); try { fs.linkSync(file, to); } catch (e) { fs.copyFileSync(file, to); } return to; };
    const importAsUser = (page, file) => page.evaluate(async (f) => window.__AP.Media.load(await window.apNative.openMovie(f), { byUser: true }), file);

    const s = await launch(newProfile());
    try {
      // 1. ENDGAME, 3:01:11: imported, and the app finds the snap by itself.
      await loadMovie(s.page, ENDGAME);
      await sleep(500);
      let v = await info(s.page);
      check('the version list is ENDGAME 3:01:11, ENCORE 3:01:36 and a custom cut', v.options.length === 3 && /Endgame \(2019\) · 3:01:11/.test(v.options[0]) && /Encore \(2026\) · 3:01:36/.test(v.options[1]), JSON.stringify(v.options));
      check('a 3:01:11 file is ENDGAME, starting from the round figure 2:30:30', v.version === 'original' && /^Endgame · /.test(v.card) && v.snap === 9030 && /Dec 31 · 9:29:30 PM/.test(v.start), v.version + ' | ' + v.card + ' | ' + v.snap);
      check('the app starts looking for the snap by itself', await searching(s.page));
      check('and says what it is doing', /Every copy of the film is timed a little differently/.test(await s.page.textContent('#modalBody')) && /once per file/.test(await s.page.textContent('#modalBody')));
      check('it ends with the film strip', await stripOpen(s.page, 180000));
      let f = await stripView(s.page);
      v = await info(s.page);
      check('the snap point is already set: 2:30:31.668, where the flash begins, 1.668 s after the round figure', Math.abs(v.snap - 9031.668) < 1e-6 && v.version === 'original', v.snap + ' ' + v.version);
      check('the countdown is calibrated to it: the movie starts at 9:29:28.332 PM', await shows(s.page, 'ktStart', /Dec 31 · 9:29:28\.332 PM/) && /Jan 1 · 12:00:00 AM/.test(v.target), v.start);
      check('the pre-flight list says the app found it, and how', await shows(s.page, 'preflight', /Snap point confirmed in this file2:30:31\.668 · found by the app: the flash of the snap/) && !(await info(s.page)).findBtn, v.preflight.slice(0, 260));
      check('the strip shows the frame it chose', /^Snap found: 2:30:31\.668$/.test(f.title) && /The app has put the snap on the frame marked SET NOW/.test(f.note) && /The movie now starts at 9:29:28\.332 PM/.test(f.note) &&
        Math.abs(f.selT - 9031.6667) < 0.01 && Math.abs(f.nowT - 9031.6667) < 0.01 && f.ok === 'Yes, the snap is on this frame' && f.tags.includes('now:SET NOW') && f.tags.includes('pick:SNAP?'), f.title + ' | ' + f.note.slice(0, 200) + ' | ' + f.tags.join(','));
      check('with the film itself paused on that frame, sound and speed untouched', f.paused && f.videoT >= 9031.666 && f.videoT < 9031.834 && !f.muted && f.rate === 1, JSON.stringify({ t: f.videoT, muted: f.muted, rate: f.rate }));
      await shot(s.page, 'versions-auto-endgame');
      await s.page.keyboard.press('Enter');
      check('Enter agrees and closes the strip', await stripClosed(s.page) && Math.abs((await info(s.page)).snap - 9031.668) < 1e-6);

      // 2. The Snap test proves it.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsLeadSnap', '20');
      await s.page.click('[data-test="snap"]');
      check('Snap test: locks on 20 s before the snap, two and a half hours into the file', await waitSynced(s.page, 12000));
      const st = await state(s.page);
      check('the film is at about 2:30:11', Math.abs(st.t - 9011.7) < 6, C_fmt(st.t));
      check('after the test the strip opens', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      check('the frame put on 12:00:00 is the frame of the flash, and it came on screen within 60 ms of the clock', f.mode === 'test' && Math.abs(f.nowT - 9031.6667) < 0.01 && !!f.flash && Math.abs(f.flash.rise - f.nowT) < 0.01 && Math.abs(f.offMs) < 60, JSON.stringify({ now: f.nowT, flash: f.flash, offMs: Math.round(f.offMs) }));
      check('the strip says the snap landed', /The snap landed on 12:00:00/.test(f.title) && f.ok === 'Yes, the snap is on this frame', f.title + ' | ' + f.ok);
      await shot(s.page, 'versions-strip-landed');
      await s.page.keyboard.press('Enter');
      await stripClosed(s.page);
      await s.page.click('.tab[data-tab="mission"]');

      // 3. ENCORE, 3:01:36: the same film with 25 s more. The app searches it by itself, starting
      //    from the point confirmed in ENDGAME. In this clip the snap is 25 s further in, and only
      //    the picture says so: the app sets it (the countdown is calibrated) and asks for a look.
      await loadMovie(s.page, ENCORE);
      await sleep(500);
      v = await info(s.page);
      check('a 3:01:36 file is ENCORE', v.version === 'encore' && v.picker === 'encore' && /^Encore · /.test(v.card), v.version + ' | ' + v.card);
      check('the search starts from the point confirmed in ENDGAME, the same film', Math.abs(v.snap - 9031.668) < 1e-6 && /Snap point not confirmed in this file yet/.test(v.preflight), v.snap + '');
      check('it starts by itself', await searching(s.page));
      check('the snap is not there in this cut, so the app sweeps a wider stretch', await waitFor(s.page, () => /Searching from 2:29:46 to 2:32:16/.test(document.getElementById('modalNote').textContent), null, 30000), await s.page.textContent('#modalNote'));
      check('and ends with the strip', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      v = await info(s.page);
      check('ENCORE: the white-out it found is set: 2:30:56.668, 25 s after the ENDGAME point', Math.abs(v.snap - 9056.668) < 1e-6 && Math.abs(f.selT - 9056.6667) < 0.01 && Math.abs(f.nowT - 9056.6667) < 0.01, v.snap + ' | ' + f.title);
      check('the strip asks for a look: found far from where it was expected, with no subtitles to vouch for it', /^Is this the snap\?$/.test(f.title) && /The snap was not where it was expected/.test(f.note) && /25\.0 s later/.test(f.note) && f.tags.includes('now:SET NOW'), f.title + ' | ' + f.note);
      check('ENCORE: the countdown is calibrated to it, and the pre-flight list asks for that look', await shows(s.page, 'ktStart', /Dec 31 · 9:29:03\.332 PM/) && await shows(s.page, 'preflight', /Snap point not confirmed in this file yet2:30:56\.668 is where the app found a white-out/), (await info(s.page)).preflight.slice(0, 300));
      await s.page.click('.tab[data-tab="setup"]');
      await sleep(300);
      check('Setup says the file is 25 s longer than the 2019 film', /3:01:36 long, 25 s longer than the 2019 film/.test((await info(s.page)).lengthNote));
      await shot(s.page, 'versions-auto-encore');
      await s.page.click('#stripOk');
      check('one press on "Yes, the snap is on this frame" confirms it', await stripClosed(s.page) && Math.abs((await info(s.page)).snap - 9056.668) < 1e-6 && await shows(s.page, 'preflight', /Snap point confirmed in this file2:30:56\.668 · picked from the frames/), (await info(s.page)).preflight.slice(0, 300));
      await s.page.click('.tab[data-tab="mission"]');

      // 4. Each file remembers its own snap point: swapping the two films needs no second search.
      await loadMovie(s.page, ENDGAME);
      check('back to ENDGAME: nothing is searched again', await quiet(s.page, 4000));
      v = await info(s.page);
      check('its own snap point is back, confirmed', v.version === 'original' && Math.abs(v.snap - 9031.668) < 1e-6 && /Snap point confirmed in this file/.test(v.preflight) && /9:29:28\.332 PM/.test(v.start), v.version + ' ' + v.snap);
      await loadMovie(s.page, ENCORE);
      check('back to ENCORE: nothing is searched again', await quiet(s.page, 4000));
      v = await info(s.page);
      check('its own snap point is back, confirmed', v.version === 'encore' && Math.abs(v.snap - 9056.668) < 1e-6 && /Snap point confirmed in this file/.test(v.preflight) && /9:29:03\.332 PM/.test(v.start), v.version + ' ' + v.snap);

      // 5. The same film in another folder is the same film. Another copy of a cut is searched itself.
      const moved = path.join(newProfile(), path.basename(ENDGAME));
      try { fs.linkSync(ENDGAME, moved); } catch (e) { fs.copyFileSync(ENDGAME, moved); }
      await loadMovie(s.page, moved);
      check('the ENDGAME file in another folder: not searched again', await quiet(s.page, 4000));
      v = await info(s.page);
      check('and its confirmed snap point is kept', Math.abs(v.snap - 9031.668) < 1e-6 && /Snap point confirmed in this file/.test(v.preflight), v.snap + '');
      fs.unlinkSync(moved);

      await loadMovie(s.page, LONGER);
      await sleep(500);
      v = await info(s.page);
      check('a 3:05:10 file is taken for Encore too, starting from the point confirmed in the other Encore copy', v.version === 'encore' && Math.abs(v.snap - 9056.668) < 1e-6 && /Snap point not confirmed in this file yet/.test(v.preflight), v.card + ' ' + v.snap);
      check('it is searched itself', await searching(s.page) && await stripOpen(s.page, 180000));
      v = await info(s.page);
      check('and its own white-out is set, 25 s earlier in this copy: 2:30:31.668, for a look', Math.abs(v.snap - 9031.668) < 1e-6 && await shows(s.page, 'preflight', /Snap point not confirmed in this file yet/), v.snap + '');
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);

      // 6. "Skip" leaves everything alone, and the file is tried again the next time it is imported.
      const copy1 = alias(ENDGAME, 'Endgame copy one.mp4');
      await loadMovie(s.page, copy1);
      check('another copy of ENDGAME: searched by itself', await searching(s.page));
      await sleep(1500);
      await s.page.click('#modalActions button');
      await sleep(1200);
      const after = await s.page.evaluate(() => { const vid = document.getElementById('video'); return { strip: !!window.__AP.SnapCam.view, busy: window.__AP.SnapCam.busy, modal: !document.getElementById('modal').hidden, paused: vid.paused, muted: vid.muted, rate: vid.playbackRate }; });
      v = await info(s.page);
      check('Skip stops the search and changes nothing', !after.strip && !after.busy && !after.modal && after.paused && !after.muted && after.rate === 1 && /Snap point not confirmed in this file yet/.test(v.preflight), JSON.stringify(after));
      check('the Mission tab still offers to find it', v.findBtn);
      await loadMovie(s.page, copy1);
      check('imported again, it is searched again', await searching(s.page) && await stripOpen(s.page, 180000));
      check('and found', Math.abs((await info(s.page)).snap - 9031.668) < 1e-6);
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);

      // 7. While a countdown is armed: a movie the user imports is still searched (the countdown
      //    lends the film and takes it back); a restart after a crash searches nothing.
      await aimAt(s.page, 1800);
      await s.page.evaluate(() => { window.__AP.cfg.targetMode = 'newyear'; window.__AP.Engine.session = window.__AP.Engine.computeFree(); });
      await s.page.click('#armBtn');
      check('armed for New Year with a confirmed snap point: nothing is asked', await waitPhase(s.page, 'standby', 6000) && (await info(s.page)).mode === 'armed');
      const copy2 = alias(ENDGAME, 'Endgame copy two.mp4');
      await importAsUser(s.page, copy2);
      check('armed, and the user imports another copy: the app looks for its snap', await searching(s.page, 15000));
      check('telling the user the countdown stays armed', /The countdown stays armed/.test(await s.page.textContent('#modalBody')));
      v = await info(s.page);
      check('the countdown is still armed on disk while the film is lent', v.armed === true && v.mode === 'free', v.mode + ' ' + v.armed);
      check('the strip opens', await stripOpen(s.page, 180000));
      v = await info(s.page);
      f = await stripView(s.page);
      check('the countdown has the film back: armed, waiting at the start', v.mode === 'armed' && v.phase === 'standby' && v.armed === true && (await state(s.page)).t < 0.1, v.mode + ' ' + v.phase);
      check('the snap is confirmed in the new copy, and the strip is for looking only', await shows(s.page, 'preflight', /Snap point confirmed in this file/) && Math.abs(v.snap - 9031.668) < 1e-6 && f.readOnly && f.preview, v.snap + ' ' + f.readOnly);
      check('the start time is the calibrated one', await shows(s.page, 'ktStart', /Dec 31 · 9:29:28\.332 PM/), v.start);
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);
      const copy3 = alias(ENDGAME, 'Endgame copy three.mp4');
      await loadMovie(s.page, copy3);
      check('armed, and a movie is loaded without the user (a restart): nothing is searched', await quiet(s.page, 5000) && (await info(s.page)).mode === 'armed');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async encore() {
    // ENCORE (3:01:36) with English subtitles inside: a forced-only track first, the full English
    // track second. "Iron Man." goes off screen at 2:30:55.75 and the flash begins at 2:30:56.667
    // (in the MKV both 46 ms later: the remux shifts picture and subtitles alike).
    const SUBS = path.join(MEDIA, 'encore-subs.mkv');
    const PLAIN = path.join(MEDIA, 'encore-short.mp4');
    if (![SUBS, PLAIN].every((f) => fs.existsSync(f))) { console.log('  note  ENCORE test clips missing: run scripts/make-test-media.sh'); return; }
    const info = (page) => page.evaluate(() => ({ version: window.__AP.cfg.filmVersion, snap: window.__AP.cfg.snapSec, preflight: document.getElementById('preflight').textContent, start: document.getElementById('ktStart').textContent }));
    const searching = (page, timeout) => waitFor(page, () => !document.getElementById('modal').hidden && /Finding the snap in this film/.test(document.getElementById('modalTitle').textContent), null, timeout || 15000);
    const shows = (page, id, re) => waitFor(page, ({ id, src }) => new RegExp(src).test(document.getElementById(id).textContent), { id, src: re.source }, 5000);
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, SUBS);
      await sleep(500);
      let v = await info(s.page);
      check('ENCORE imported first, nothing known yet: recognised, starting from 2:30:30', v.version === 'encore' && v.snap === 9030, v.version + ' ' + v.snap);
      check('the app looks for the snap by itself', await searching(s.page));
      check('it ends with the film strip', await stripOpen(s.page, 180000));
      const f = await stripView(s.page);
      v = await info(s.page);
      const found = v.snap;
      check('found by itself: 2:30:56.7, on the first frame of the flash, right after the line', found > 9056.66 && found < 9056.72 && Math.abs(found - (f.selT + 0.001)) < 0.0015 && /^Snap found: 2:30:56\.7\d\d$/.test(f.title) && /0\.92 s after the line “…Iron Man\.” goes off screen/.test(f.note), v.snap + ' | ' + f.selT + ' | ' + f.title + ' | ' + f.note.slice(0, 160));
      check('marked as found, by the flash and the line together', await shows(s.page, 'preflight', /Snap point confirmed in this file2:30:56\.7\d\d · found by the app: the flash, right after the line/), v.preflight.slice(0, 300));
      check('the countdown is calibrated to it: the movie starts at 9:29:03.2xx PM', await shows(s.page, 'ktStart', /Dec 31 · 9:29:03\.2\d\d PM/), v.start);
      const log = await s.page.evaluate(() => window.__AP.Engine.events.map((e) => e.text).filter((t) => /The line before the snap/.test(t)).join(' | '));
      check('the line came from the full English track inside the movie, not the forced one', /subtitle track 2 \(eng\) inside the movie: \d+ lines read, the line ends at 2:30:55\.7\d\d/.test(log) && !/subtitle track 1/.test(log), log);
      await shot(s.page, 'encore-subs-found');
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);

      // Another copy of ENCORE, without subtitles: it starts where the snap was found in the first.
      await loadMovie(s.page, PLAIN);
      await sleep(500);
      v = await info(s.page);
      check('a second ENCORE copy starts from the point found in the first one', v.version === 'encore' && Math.abs(v.snap - found) < 1e-6, v.snap + '');
      check('it is searched by itself', await searching(s.page) && await stripOpen(s.page, 180000));
      v = await info(s.page);
      check('and its snap is found right there, by the flash alone', Math.abs(v.snap - 9056.668) < 1e-6 && await shows(s.page, 'preflight', /Snap point confirmed in this file2:30:56\.668 · found by the app: the flash of the snap/), v.preflight.slice(0, 300));
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async newyear() {
    // The app's clock is put a few seconds before New Year's midnight through the internet-time
    // correction (the same path a real correction takes).
    const until = (secs) => {
      const target = new Date(new Date().getFullYear() + 1, 0, 1).getTime();
      return { target: target, fake: JSON.stringify({ ok: true, offsetMs: target - Date.now() - secs * 1000, uncertaintyMs: 12, method: 'ntp', servers: [] }) };
    };
    const popup = (page) => page.evaluate(() => !document.getElementById('modal').hidden && /Better luck next year/.test(document.getElementById('modalTitle').textContent));
    const congrats = (page) => page.evaluate(() => !document.getElementById('modal').hidden && /You did it/.test(document.getElementById('modalTitle').textContent));
    const toMidnight = (page, target) => page.evaluate((t) => t - window.__AP.Clock.now(), target);
    const onTime = (page) => waitFor(page, () => Math.abs(window.__AP.Clock.netOffsetMs) > 1000, null, 20000);

    // 1. Never started: at midnight, "Better luck next year". Once.
    let t = until(30);
    const profile = newProfile();
    let s = await launch(profile, { AP_FAKE_NTP: t.fake });
    try {
      check('the app clock is put just before New Year', await onTime(s.page));
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      check('the film should be running and is not: the late box is up', await waitFor(s.page, () => !document.getElementById('late').hidden, null, 10000));
      let ms = await toMidnight(s.page, t.target);
      check('seconds before midnight, nothing is said yet', ms > 1000 && ms < 30000 && !(await popup(s.page)), Math.round(ms) + ' ms to go');
      const seen = await waitFor(s.page, () => !document.getElementById('modal').hidden && /Better luck next year/.test(document.getElementById('modalTitle').textContent), null, ms + 5000);
      const late = await s.page.evaluate((x) => window.__AP.Clock.now() - x, t.target);
      check('at midnight: "Better luck next year"', seen && late >= 0 && late < 1500, Math.round(late) + ' ms after midnight');
      check('wishing a happy new year', new RegExp('Happy New Year ' + new Date(t.target).getFullYear()).test(await s.page.textContent('#modalBody')));
      check('the late box is gone', await s.page.evaluate(() => document.getElementById('late').hidden));
      await shot(s.page, 'newyear-missed');
      await s.page.click('#modalActions button');
      await sleep(2500);
      check('it is said once', !(await popup(s.page)) && await s.page.evaluate((x) => window.__AP.cfg.newYearSeen === x, t.target));
      check('and after midnight there is no late box or reminder', await s.page.evaluate(() => document.getElementById('late').hidden && document.getElementById('latePill').hidden));
      check('the Mission card says it was missed, not late', await waitFor(s.page, () => /MISSED · NOT ARMED/.test(document.getElementById('stLabel').textContent) && /HAPPY NEW YEAR/.test(document.getElementById('stBig').textContent), null, 3000) && !/JOIN/.test(await s.page.textContent('#armBtn')), await s.page.textContent('#stLabel') + ' | ' + await s.page.textContent('#armBtn'));
      await sleep(400);
      await s.close();
      s = await launch(profile, { AP_FAKE_NTP: t.fake });
      await onTime(s.page);
      await waitFor(s.page, () => window.__AP.Media.ready, null, 15000);
      await sleep(3000);
      check('a restart in the first minutes of the new year does not say it again', !(await popup(s.page)));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // 2. The countdown was done (here: joined late, before midnight): nothing is said.
    t = until(40);
    s = await launch(newProfile(), { AP_FAKE_NTP: t.fake });
    try {
      await onTime(s.page);
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 10000);
      await s.page.click('#lateBtn');
      check('joined before midnight: the countdown runs', await waitSynced(s.page, 20000) && (await state(s.page)).armed);
      const ms = await toMidnight(s.page, t.target);
      await sleep(Math.max(0, ms) + 3000);
      check('midnight passed with the countdown done: no "Better luck next year"', !(await popup(s.page)), Math.round(ms) + ' ms');
      check('the snap moment was reached on the clock', await s.page.evaluate(() => window.__AP.Engine.events.some((e) => /Target moment reached/.test(e.text))));
      check('and the moment is marked as dealt with', await s.page.evaluate((x) => window.__AP.cfg.newYearSeen === x, t.target));
      // Hit: the film was on the clock at midnight. Congratulated once the movie is over (here: stopped).
      check('the film was on the clock at midnight: the hit is kept', await s.page.evaluate((x) => window.__AP.cfg.madeIt === x, t.target), JSON.stringify(await s.page.evaluate(() => ({ at: window.__AP.cfg.madeIt, d: window.__AP.cfg.madeItDrift }))));
      check('the Mission card says the snap hit midnight (no "RIGHT ON TIME", no "ON TIME")', await waitFor(s.page, () => /^THE SNAP HIT MIDNIGHT$/.test(document.getElementById('stLabel').textContent) && /HAPPY NEW YEAR/.test(document.getElementById('stBig').textContent), null, 3000), await s.page.textContent('#stLabel') + ' | ' + await s.page.textContent('#stBig'));
      check('the overlay says HAPPY NEW YEAR and the year', await s.page.evaluate((y) => document.getElementById('ovCountLbl').textContent === 'HAPPY NEW YEAR' && document.getElementById('ovCountVal').textContent === y, String(new Date(t.target).getFullYear())));
      check('no congratulations while the movie still plays', !(await congrats(s.page)));
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('stopped after midnight: congratulated, after the animation', await waitFor(s.page, () => !document.getElementById('modal').hidden && /You did it/.test(document.getElementById('modalTitle').textContent), null, 25000) &&
        await s.page.evaluate(() => !(window.__AP.Celebration.fx && window.__AP.Celebration.fx.running)));
      const made = await s.page.evaluate(() => ({ title: document.getElementById('modalTitle').textContent, body: document.getElementById('modalBody').textContent }));
      const year = String(new Date(t.target).getFullYear());
      check('with the year, and how close to the clock the snap landed', made.title === 'You did it. Happy New Year ' + year + '!' && made.body.startsWith(year) &&
        /The snap landed on the stroke of midnight, (to the millisecond|\d+ ms from the clock)\./.test(made.body), JSON.stringify(made));
      await shot(s.page, 'newyear-madeit');
      await s.page.click('#modalActions .btn-primary');
      await sleep(1500);
      check('it is said once', !(await congrats(s.page)) && await s.page.evaluate(() => window.__AP.cfg.madeIt === 0));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // 2b. A hit, and the film runs to its end: congratulated after the movie.
    t = until(25);
    s = await launch(newProfile(), { AP_FAKE_NTP: t.fake });
    try {
      await onTime(s.page);
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, 190);                       // the 200 s clip ends 10 s after midnight
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 10000);
      await s.page.click('#lateBtn');
      check('joined: the countdown runs', await waitSynced(s.page, 20000));
      const ms = await toMidnight(s.page, t.target);
      await sleep(Math.max(0, ms) + 2000);
      check('at midnight the film was on the clock: the hit is kept', await s.page.evaluate((x) => window.__AP.cfg.madeIt === x, t.target));
      check('no congratulations while the movie plays', !(await congrats(s.page)));
      check('the movie runs to its end, then: "You did it"', await waitFor(s.page, () => !document.getElementById('modal').hidden && /You did it/.test(document.getElementById('modalTitle').textContent), null, 40000) &&
        await s.page.evaluate(() => window.__AP.Engine.events.some((e) => /The movie finished/.test(e.text)) && window.__AP.Engine.mode === 'free'));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // 3. No movie at all, the app just open: at midnight it is said too.
    t = until(12);
    s = await launch(newProfile(), { AP_FAKE_NTP: t.fake });
    try {
      await onTime(s.page);
      const ms = await toMidnight(s.page, t.target);
      check('on the import screen, no movie: "Better luck next year" at midnight', await waitFor(s.page, () => !document.getElementById('modal').hidden && /Better luck next year/.test(document.getElementById('modalTitle').textContent), null, Math.max(0, ms) + 5000), Math.round(ms) + ' ms');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async languages() {
    // Sound in several languages: English must play, whatever the file flags as its main track.
    // The tracks of the test clips differ in bitrate, so the bytes decoded per second of film say
    // which one is really playing: about 6 000 for English and 24 000 for Hindi in lang-dual.mkv.
    const DUAL = path.join(MEDIA, 'lang-dual.mkv');
    const tracks = (page) => page.evaluate(() => {
      const A = window.__AP.AudioTracks;
      return A.list.map((t) => ({ pos: t.pos, lang: t.lang, on: t.enabled, name: A.name(t) }));
    });
    const playing = async (page) => (await tracks(page)).find((t) => t.on) || { lang: 'none' };
    const rate = (page, ms) => page.evaluate(async (ms) => {
      const v = document.getElementById('video');
      const b0 = v.webkitAudioDecodedByteCount;
      const t0 = v.currentTime;
      await new Promise((r) => setTimeout(r, ms));
      return Math.round((v.webkitAudioDecodedByteCount - b0) / Math.max(0.001, v.currentTime - t0));
    }, ms || 2200);
    const selected = (page) => page.evaluate(() => { const e = document.getElementById('soundTrack'); return e.selectedIndex >= 0 ? e.options[e.selectedIndex].textContent : ''; });
    const preflight = (page) => page.textContent('#preflight');
    // The list is redrawn a few times a second: wait for it rather than read it at once.
    const preflightSays = (page, re) => waitFor(page, (src) => new RegExp(src).test(document.getElementById('preflight').textContent), re.source, 4000);
    const isEng = (r) => r > 3500 && r < 9000;
    const isHin = (r) => r > 18000 && r < 30000;
    // What Chromium does when tracks are switched in quick succession WITHOUT a seek: the sound dies.
    // The app never switches like that; this reaches past it to prove the watchdog brings sound back.
    const killSound = (page, endPos) => page.evaluate(async (endPos) => {
      const l = document.getElementById('video').audioTracks;
      for (let k = 0; k < 6; k++) {
        const to = k % 2 ? endPos : 1 - endPos;
        for (let i = 0; i < l.length; i++) if (i !== to) l[i].enabled = false;
        l[to].enabled = true;
        await new Promise((r) => setTimeout(r, 100));
      }
    }, endPos);
    const logged = (page, text, timeout) => waitFor(page, (t) => window.__AP.Engine.events.some((e) => e.text.includes(t)), text, timeout);

    const profile = newProfile();
    let s = await launch(profile);
    try {
      check('loads a movie with Hindi first and English second', await loadMovie(s.page, DUAL));
      let t = await tracks(s.page);
      check('both languages are listed', t.length === 2 && t[0].lang === 'hin' && t[1].lang === 'eng', JSON.stringify(t));
      check('English is chosen by itself, although the file flags Hindi as its main track', t.length === 2 && t[1].on && !t[0].on);
      check('the sound is confirmed playable', await waitFor(s.page, () => window.__AP.Media.hasAudio === true, null, 8000));
      check('the Mission tab shows English as the sound language', await s.page.isVisible('#soundFld') && /^English/.test(await selected(s.page)), await selected(s.page));
      check('the pre-flight list says the sound is English', await preflightSays(s.page, /Sound: English/), (await preflight(s.page)).slice(0, 200));
      check('nothing to warn about and nothing to fix', await s.page.isHidden('#audioWarn') && await s.page.isHidden('#fixAudioBtn') && await s.page.isHidden('#modal'));
      await s.page.evaluate(() => document.getElementById('video').play());
      await sleep(1500);
      let r = await rate(s.page);
      check('what is decoded is the English track', isEng(r), r + ' bytes/s');

      await s.page.selectOption('#soundTrack', '0');
      await sleep(1500);
      r = await rate(s.page);
      check('choosing Hindi in the list switches the sound', isHin(r) && (await playing(s.page)).lang === 'hin', r + ' bytes/s');
      check('the film keeps playing through the switch', !(await state(s.page)).paused);
      check('the button on the bar shows the language', await s.page.isVisible('#btnAudio') && (await s.page.textContent('#btnAudio')) === 'HIN', await s.page.textContent('#btnAudio'));
      await s.page.keyboard.press('a');
      await sleep(1500);
      r = await rate(s.page);
      check('the A key switches back to English', isEng(r) && (await playing(s.page)).lang === 'eng', r + ' bytes/s');

      // Chromium loses the sound when tracks are switched in quick succession without a seek.
      for (let i = 0; i < 7; i++) { await s.page.keyboard.press('a'); await sleep(110); }
      await sleep(2600);
      r = await rate(s.page);
      let cur = await playing(s.page);
      check('seven quick presses of A do not leave the film silent', r > 3000, r + ' bytes/s');
      check('and what plays is what the list says', cur.lang === 'hin' ? isHin(r) : isEng(r), cur.lang + ' ' + r + ' bytes/s');
      check('the film is still playing', !(await state(s.page)).paused);

      // The watchdog, in free play.
      await killSound(s.page, 1);
      await sleep(1200);
      r = await rate(s.page, 1500);
      if (r === 0) {
        check('the watchdog notices that the sound stopped and re-cues the film', await logged(s.page, 'The sound stopped being decoded', 9000));
        await sleep(1500);
        r = await rate(s.page);
        const now = await playing(s.page);
        check('and the sound is back, in the language that was chosen by hand', now.lang === cur.lang && (cur.lang === 'hin' ? isHin(r) : isEng(r)), now.lang + ' ' + r + ' bytes/s');
        check('with the film still playing', !(await state(s.page)).paused);
      } else {
        console.log('  note  the sound survived the bare switching this time (' + r + ' bytes/s): watchdog not exercised in free play');
      }

      // While the countdown runs: a switch re-cues the film and it stays on the clock.
      await s.page.evaluate(() => document.getElementById('video').pause());
      if ((await playing(s.page)).lang !== 'eng') { await s.page.keyboard.press('a'); await sleep(800); }
      await setSnap(s.page, SNAP);
      await armIn(s.page, -20);
      check('armed with the film already running: in sync', await waitSynced(s.page, 12000));
      await sleep(1500);
      const before = await state(s.page);
      await s.page.keyboard.press('a');
      await sleep(300);
      check('switching language while armed', await waitSynced(s.page, 12000));
      await sleep(1800);
      const m = await measureSync(s.page, 3000);
      r = await rate(s.page);
      const after = await state(s.page);
      check('the film stays on the clock after the switch', Math.abs(m.worst) < 0.08, ms(m.worst));
      check('it was a clean re-cue, not a slip', after.slips === before.slips && after.mode === 'armed' && await s.page.isHidden('#slip'), 'slips ' + after.slips);
      check('Hindi is what plays now', isHin(r) && (await playing(s.page)).lang === 'hin', r + ' bytes/s');

      // The watchdog, while armed. The fault above does not strike reliably while the engine steers the
      // speed, so the sound is stopped another way: every track switched off behind the app's back.
      const auto0 = (await state(s.page)).autoRecals;
      await s.page.evaluate(() => { const l = document.getElementById('video').audioTracks; for (let i = 0; i < l.length; i++) l[i].enabled = false; });
      await sleep(1200);
      r = await rate(s.page, 1500);
      check('armed: with every track switched off nothing is decoded', r === 0, r + ' bytes/s');
      check('armed: the watchdog re-cues the film when the sound stops', await logged(s.page, 'Auto-recalibrating: the sound stopped', 9000));
      check('armed: back in sync', await waitSynced(s.page, 12000));
      await sleep(1800);
      const m2 = await measureSync(s.page, 2500);
      r = await rate(s.page);
      const st2 = await state(s.page);
      check('armed: the chosen language is back and the film is on the clock', isHin(r) && (await playing(s.page)).lang === 'hin' && Math.abs(m2.worst) < 0.08, r + ' bytes/s, ' + ms(m2.worst));
      check('armed: one automatic recalibration, no slip', st2.autoRecals === auto0 + 1 && st2.slips === before.slips && st2.mode === 'armed', 'auto ' + st2.autoRecals + ', slips ' + st2.slips);

      // The controls lock keeps the language where it is.
      await s.page.keyboard.press('l');
      await s.page.keyboard.press('a');
      await sleep(900);
      check('with the controls locked, A changes nothing', (await playing(s.page)).lang === 'hin');
      await s.page.keyboard.press('l');

      // Closing and reopening while armed: the language chosen by hand comes back with the film.
      await s.close();
      s = await launch(profile);
      check('reopened: the countdown resumes in sync', await waitSynced(s.page, 20000));
      await sleep(1500);
      r = await rate(s.page);
      check('the language chosen by hand is remembered for that movie', (await playing(s.page)).lang === 'hin' && isHin(r), (await playing(s.page)).lang + ' ' + r + ' bytes/s');
      check('a hand-made choice is not reported as a problem', await preflightSays(s.page, /Sound: Hindi/) && await s.page.isHidden('#audioWarn'), (await preflight(s.page)).slice(0, 160));
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('countdown stopped', (await state(s.page)).mode === 'free');

      // Another movie starts from English again.
      const copy = path.join(newProfile(), 'Another film.mkv');
      fs.copyFileSync(DUAL, copy);
      await loadMovie(s.page, copy);
      check('another movie plays English again', (await playing(s.page)).lang === 'eng');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // ---- the file that went wrong for a real user: Dolby Hindi flagged as the main track, Dolby English second
    s = await launch(newProfile());
    try {
      const ffmpegHere = await s.page.evaluate(() => window.apNative.ffLocate());
      if (!ffmpegHere) { console.log('  note  FFmpeg not found on this machine: the conversion is not exercised'); return; }
      const dir = newProfile();
      const film = path.join(dir, 'Film 2019 1080p HEVC [Org Hindi DDP 5.1 - 640Kbps + English DD 5.1] ESubs.mkv');
      fs.copyFileSync(path.join(MEDIA, 'lang-dolby.mkv'), film);
      check('loads a movie with Dolby Hindi first and Dolby English second', await loadMovie(s.page, film));
      check('the sound is found undecodable at import', await waitFor(s.page, () => window.__AP.Media.hasAudio === false, null, 8000));
      check('the fix is offered', await waitFor(s.page, () => !document.getElementById('modal').hidden, null, 5000));
      const body = await s.page.textContent('#modalBody');
      check('the explanation is about the English track', /The English sound track is Dolby Digital \(AC-3\)/.test(body), body.slice(0, 140));
      const opts = await s.page.evaluate(() => { const e = document.getElementById('fixLang'); return e ? { all: Array.from(e.options).map((o) => o.textContent), sel: e.options[e.selectedIndex].textContent, keep: document.getElementById('fixKeep').checked } : null; });
      check('the dialog lists both languages', !!opts && opts.all.length === 2 && /^Hindi · 5\.1 · Dolby Digital Plus/.test(opts.all[0]) && /^English · Stereo · Dolby Digital/.test(opts.all[1]), JSON.stringify(opts && opts.all));
      check('English is preselected, although Hindi is the file\'s main track', !!opts && /^English/.test(opts.sel), opts && opts.sel);
      check('keeping the other languages is on by default', !!opts && opts.keep === true);
      await shot(s.page, 'languages-fix-dialog');
      await s.page.click('#modalActions .btn-primary');
      check('the conversion finishes and the new file is loaded', await waitFor(s.page, () => /\(Avengers Player\)\.mp4$/.test(window.__AP.Media.info ? window.__AP.Media.info.name : ''), null, 120000));
      check('its sound is playable', await waitFor(s.page, () => window.__AP.Media.hasAudio === true, null, 8000));
      let t = await tracks(s.page);
      check('English first and playing, Hindi kept for switching', t.length === 2 && t[0].lang === 'eng' && t[0].on && t[1].lang === 'hin' && !t[1].on, JSON.stringify(t));
      check('the pre-flight list says English', await preflightSays(s.page, /Sound: English/), (await preflight(s.page)).slice(0, 160));
      check('no warning left', await s.page.isHidden('#audioWarn') && await s.page.isHidden('#fixAudioBtn'));
      await s.page.evaluate(() => document.getElementById('video').play());
      await sleep(1500);
      const rEng = await rate(s.page);
      check('English is what is decoded (stereo, about 192 kbit/s)', rEng > 20000 && rEng < 27000, rEng + ' bytes/s');
      await s.page.keyboard.press('a');
      await sleep(1600);
      const rHin = await rate(s.page);
      check('A switches to the Hindi track that was kept (5.1, a higher bitrate)', rHin > rEng * 1.12 && (await playing(s.page)).lang === 'hin', rHin + ' against ' + rEng + ' bytes/s');
      await s.page.evaluate(() => document.getElementById('video').pause());
      await s.page.click('.tab[data-tab="subs"]');
      check('the movie\'s own subtitles are still offered after the fix', await waitFor(s.page, () => document.querySelectorAll('#subEmbedded button').length === 1, null, 5000));
      await s.page.click('#subEmbedded button');
      check('and they load', await waitFor(s.page, () => window.__AP.SubsUI.loaded, null, 8000));
      await s.page.click('.tab[data-tab="mission"]');
      await shot(s.page, 'languages-fixed');

      // Asking for Hindi instead, without keeping English.
      await loadMovie(s.page, film);
      await waitFor(s.page, () => !document.getElementById('modal').hidden, null, 8000);
      await s.page.selectOption('#fixLang', '0');
      await s.page.uncheck('#fixKeep', { force: true });
      await s.page.click('#modalActions .btn-primary');
      await waitFor(s.page, () => document.getElementById('modalTitle').textContent === 'Fixing the sound' || /\(Avengers Player\)/.test(window.__AP.Media.info ? window.__AP.Media.info.name : ''), null, 5000);
      check('converting another language on request', await waitFor(s.page, () => /\(Avengers Player\)\.mp4$/.test(window.__AP.Media.info ? window.__AP.Media.info.name : '') && window.__AP.Media.hasAudio === true, null, 120000));
      t = await tracks(s.page);
      check('the new file has Hindi only', t.length === 1 && t[0].lang === 'hin' && t[0].on, JSON.stringify(t));
      check('a language asked for by hand is not reported as a problem', await preflightSays(s.page, /Sound: Hindi/) && await s.page.isHidden('#audioWarn'), (await preflight(s.page)).slice(0, 160));

      // ---- a Hindi-only file, which is what the first version of the fix produced from that movie
      const hindiOnly = path.join(dir, 'Film 2019 (Avengers Player).mp4');
      fs.copyFileSync(path.join(MEDIA, 'lang-hindi.mp4'), hindiOnly);
      await loadMovie(s.page, hindiOnly);
      check('a Hindi-only file plays', await waitFor(s.page, () => window.__AP.Media.hasAudio === true, null, 8000));
      check('and is flagged: the sound is Hindi, not English', await waitFor(s.page, () => /The sound is Hindi, not English/.test(document.getElementById('preflight').textContent), null, 5000), (await preflight(s.page)).slice(0, 200));
      await waitFor(s.page, () => /no English sound track/.test(document.getElementById('audioWarn').textContent), null, 4000);
      const warn = await s.page.textContent('#audioWarn');
      check('the warning says to import the original file', await s.page.isVisible('#audioWarn') && /no English sound track/.test(warn) && /Import the original movie file/.test(warn), warn);
      check('there is nothing to fix in this file, so no Fix button and no dialog', await s.page.isHidden('#fixAudioBtn') && await s.page.isHidden('#modal'));
      await setSnap(s.page, 20);
      await s.page.click('#armBtn');
      check('starting the countdown asks first', await s.page.isVisible('#modal') && /no English sound/.test(await s.page.textContent('#modalTitle')) && (await state(s.page)).mode === 'free', await s.page.textContent('#modalTitle'));
      await s.page.keyboard.press('Escape');
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.selectOption('#optAudioLang', 'hin');
      await s.page.click('.tab[data-tab="mission"]');
      check('with Hindi as the preferred language the same file is fine', await waitFor(s.page, () => /Sound: Hindi/.test(document.getElementById('preflight').textContent) && document.getElementById('audioWarn').hidden, null, 5000), (await preflight(s.page)).slice(0, 160));
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.selectOption('#optAudioLang', 'eng');
      await s.page.click('.tab[data-tab="mission"]');
      check('and back to English it is flagged again', await waitFor(s.page, () => /The sound is Hindi, not English/.test(document.getElementById('preflight').textContent), null, 5000));

      // ---- a dub the player can decode, with the English original in Dolby
      const mixed = path.join(dir, 'Mixed.mkv');
      fs.copyFileSync(path.join(MEDIA, 'lang-mixed.mkv'), mixed);
      await loadMovie(s.page, mixed);
      check('a playable Hindi dub with Dolby English: the fix is offered for the English', await waitFor(s.page, () => !document.getElementById('modal').hidden && /English sound needs converting/.test(document.getElementById('modalTitle').textContent), null, 8000), await s.page.textContent('#modalTitle'));
      check('the explanation says the movie would play in Hindi', /would play in Hindi instead/.test(await s.page.textContent('#modalBody')));
      check('the pre-flight list shows it', await preflightSays(s.page, /The sound is Hindi, not English/), (await preflight(s.page)).slice(0, 160));
      await s.page.click('#modalActions .btn-primary');
      check('fixed: English plays', await waitFor(s.page, () => /\(Avengers Player\)\.mp4$/.test(window.__AP.Media.info ? window.__AP.Media.info.name : '') && window.__AP.Media.hasAudio === true, null, 90000) && (await playing(s.page)).lang === 'eng');
      check('pre-flight is clean', await preflightSays(s.page, /Sound: English/) && await s.page.isHidden('#audioWarn'), (await preflight(s.page)).slice(0, 160));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // ---- a PC without FFmpeg: the language is still chosen, and a foreign-only file is still flagged
    s = await launch(newProfile(), { AP_NO_FFMPEG: '1' });
    try {
      await loadMovie(s.page, DUAL);
      check('without FFmpeg: English is still chosen by itself', (await playing(s.page)).lang === 'eng');
      check('and confirmed by playing a moment of it', await waitFor(s.page, () => window.__AP.Media.hasAudio === true && !window.__AP.Media.checking, null, 9000));
      await loadMovie(s.page, path.join(MEDIA, 'lang-hindi.mp4'));
      check('without FFmpeg: a Hindi-only file is flagged', await waitFor(s.page, () => /The sound is Hindi, not English/.test(document.getElementById('preflight').textContent), null, 9000));
      check('with an offer to look inside the file', await s.page.isVisible('#fixAudioBtn') && await s.page.isHidden('#modal'));
      await s.page.click('#fixAudioBtn');
      check('the offer explains what FFmpeg is for', await s.page.isVisible('#modal') && /FFmpeg/.test(await s.page.textContent('#modalBody')), await s.page.textContent('#modalTitle'));
      await s.page.keyboard.press('Escape');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async strip() {
    // A clip whose picture bursts into white the way the snap does: the first brighter frame is the
    // one at 1:41.542 (frame 2437), the first frame that is white all over the one at 1:41.667.
    const SCENE = path.join(MEDIA, 'snap-scene.mp4');
    const FRAME = 1 / 24;
    const RISE = 2437 / 24;
    const WHITE = 2440 / 24;
    const snapSec = (page) => page.evaluate(() => window.__AP.cfg.snapSec);
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, SCENE);
      await setSnap(s.page, SNAP);
      await waitFor(s.page, () => window.__AP.Media.hasAudio === true && !window.__AP.Media.checking, null, 9000);
      check('with the snap point unconfirmed, the Mission tab offers to find it', await s.page.isVisible('#findSnapBtn'));

      // ---- Find the snap
      await s.page.click('#findSnapBtn');
      check('a progress dialog while the app looks', await waitFor(s.page, () => !document.getElementById('modal').hidden && /Looking for the snap/.test(document.getElementById('modalTitle').textContent), null, 3000));
      check('the strip opens by itself', await stripOpen(s.page, 180000));
      let f = await stripView(s.page);
      check('every frame from 3 s before to 7 s after, none missing', f.mode === 'find' && f.n >= 236 && f.n <= 244 && f.gaps === 0 && f.thumbs === f.n && Math.abs(f.first - 97) < 0.05, f.n + ' frames, ' + f.gaps + ' gaps, from ' + f.first);
      check('the flash is found: begins at 1:41.542, white at 1:41.667', !!f.flash && Math.abs(f.flash.rise - RISE) < 0.002 && Math.abs(f.flash.start - WHITE) < 0.002 && f.flash.kind === 'white', JSON.stringify(f.flash));
      check('the frame where it begins is selected and marked SNAP?', Math.abs(f.selT - RISE) < 0.002 && f.tags.includes('pick:SNAP?'), f.selT + ' ' + f.tags.join(','));
      check('its film time is shown to the millisecond', f.time === '0:01:41.542' && /^1\.542 s after the snap point set now$/.test(f.rel), f.time + ' | ' + f.rel);
      check('the film itself is paused on that frame, above the strip', f.shown && f.paused && Math.abs(f.videoT - (RISE + FRAME / 2)) < 0.005, 't=' + f.videoT);
      check('sound and speed are as they were', !f.muted && f.rate === 1);
      check('the frame at 1:40.000 is marked as the snap point set now', Math.abs(f.nowT - 100) < 0.002, String(f.nowT));
      await shot(s.page, 'strip-find');

      // ---- keys
      await s.page.keyboard.press('ArrowRight');
      await sleep(250);
      f = await stripView(s.page);
      check('→ steps one frame on, and the film follows', Math.abs(f.selT - (RISE + FRAME)) < 0.002 && Math.abs(f.videoT - (RISE + 1.5 * FRAME)) < 0.005, f.selT + ' / ' + f.videoT);
      await s.page.keyboard.press('ArrowLeft');
      await s.page.keyboard.press('ArrowLeft');
      await sleep(250);
      f = await stripView(s.page);
      check('← steps back', Math.abs(f.selT - (RISE - FRAME)) < 0.002, String(f.selT));
      await s.page.keyboard.press('Space');
      await sleep(300);
      check('Space does not start the film while the strip is open', (await stripView(s.page)).paused);
      await s.page.click('#stripNext');
      await sleep(250);
      f = await stripView(s.page);
      check('the frame buttons do the same', Math.abs(f.selT - RISE) < 0.002 && f.ok === 'Put the snap on this frame', f.selT + ' ' + f.ok);
      // clicking a thumbnail
      await s.page.evaluate(() => { const v = window.__AP.SnapCam.view; document.getElementById('stripRow').children[v.frames.findIndex((x) => Math.abs(x.t - 100) < 0.002)].click(); });
      await sleep(250);
      f = await stripView(s.page);
      check('clicking the frame set now says so', Math.abs(f.selT - 100) < 0.002 && f.ok === 'Yes, the snap is on this frame' && /as it is set now/.test(f.rel), f.selT + ' | ' + f.ok + ' | ' + f.rel);
      await s.page.evaluate((t) => { const v = window.__AP.SnapCam.view; window.__AP.SnapCam.select(v.frames.findIndex((x) => Math.abs(x.t - t) < 0.002)); }, RISE);

      // ---- set it
      await s.page.keyboard.press('Enter');
      await sleep(400);
      let snap = await snapSec(s.page);
      check('Enter puts the snap on the moment that frame comes on screen: 1:41.543', Math.abs(snap - 101.543) < 1e-6, String(snap));
      check('the strip is closed and the point counts as confirmed', await stripClosed(s.page) && /Snap point confirmed in this file/.test(await s.page.textContent('#preflight')) && await s.page.isHidden('#findSnapBtn'));
      check('a dialog says by how much it moved', await s.page.isVisible('#modal') && /Snap point set to 0:01:41\.543/.test(await s.page.textContent('#modalTitle')) && /1\.543 s later/.test(await s.page.textContent('#modalBody')) && /land on 12:00:00/.test(await s.page.textContent('#modalBody')), await s.page.textContent('#modalBody'));

      // ---- the Snap test proves it: the frame on screen at the target moment is that frame
      await s.page.click('#modalActions .btn-primary');
      check('the Snap test starts from the dialog', await waitFor(s.page, () => window.__AP.Engine.test && window.__AP.Engine.test.kind === 'snap', null, 3000));
      check('in sync', await waitSynced(s.page, 12000));
      const m = await measureSync(s.page, 4000);
      check('collecting the frames does not disturb the film', Math.abs(m.worst) < 0.06, ms(m.worst));
      check('after the test the strip opens', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      check('test strip: 2 s before to 4.5 s after, none missing', f.mode === 'test' && f.n >= 150 && f.n <= 158 && f.gaps === 0, f.n + ' frames, ' + f.gaps + ' gaps');
      check('the frame the app put on 12:00:00 is the frame of the snap', Math.abs(f.nowT - RISE) < 0.002 && Math.abs(f.selT - RISE) < 0.002, 'put on midnight: ' + f.nowT + ', flash begins: ' + (f.flash && f.flash.rise));
      check('it came on screen within 20 ms of the clock reaching 12:00:00', Math.abs(f.offMs) < 20, Math.round(f.offMs) + ' ms');
      check('and the strip says so, with the measured figure', /The snap landed on 12:00:00/.test(f.title) && /it came on screen (\d+ ms (after|before)|exactly as) the clock got there\. The flash of the snap begins on that very frame/.test(f.note) && f.ok === 'Yes, the snap is on this frame' && f.tags.includes('clock:12:00:00') && f.tags.includes('pick:SNAP?') && /^on screen (\d+ ms (after|before)|exactly as) the clock reached 12:00:00$/.test(f.rel), f.title + ' | ' + f.rel + ' | ' + f.tags.join(','));
      await shot(s.page, 'strip-landed');
      await s.page.click('#stripOk');
      check('“Yes” confirms', await stripClosed(s.page) && /Snap point confirmed in this file/.test(await s.page.textContent('#preflight')));
      check('the snap point is unchanged', Math.abs((await snapSec(s.page)) - snap) < 1e-6);

      // ---- starting from the round number with a Snap test: what a first-time user sees
      await setSnap(s.page, SNAP);
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsLeadSnap', '20');
      await s.page.click('[data-test="snap"]');
      check('Snap test with the round number', await waitSynced(s.page, 12000));
      check('strip after it', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      check('the frame put on 12:00:00 was the one at 1:40.000, not the snap', Math.abs(f.nowT - 100) < 0.002 && /Was that the snap/.test(f.title) && Math.abs(f.offMs) < 30, f.nowT + ', ' + Math.round(f.offMs) + ' ms');
      check('the app points at the frame of the flash, 1.542 s later', Math.abs(f.selT - RISE) < 0.002 && /begins 1\.542 s later/.test(f.note) && /^1\.542 s after the frame put on 12:00:00$/.test(f.rel) && f.ok === 'Put the snap on this frame', f.note.slice(0, 190) + ' | ' + f.rel);
      await shot(s.page, 'strip-after-test');
      await s.page.click('#stripOk');
      await sleep(400);
      check('one click moves the snap there', Math.abs((await snapSec(s.page)) - 101.543) < 1e-6);
      await s.page.keyboard.press('Escape');

      // ---- the snap is nowhere near the point that is set: the wide sweep
      await setSnap(s.page, 60);
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.click('#snapFind');
      check('not near the point set: the app says it is searching wider', await waitFor(s.page, () => /Searching from 0:00:15 to 0:02:39/.test(document.getElementById('modalNote').textContent), null, 30000), await s.page.textContent('#modalNote'));
      check('and still ends on the flash', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      check('found 41.5 s away from the point that was set', !!f.flash && Math.abs(f.flash.rise - RISE) < 0.002 && Math.abs(f.selT - RISE) < 0.002 && f.nowT === null, JSON.stringify(f.flash));
      await s.page.click('#stripCancel');
      check('Close leaves the snap point alone', await stripClosed(s.page) && (await snapSec(s.page)) === 60);

      // ---- cancelling the search
      await s.page.click('#snapFind');
      await sleep(1500);
      await s.page.click('#modalActions button');
      await sleep(900);
      const after = await s.page.evaluate(() => { const v = document.getElementById('video'); return { strip: !!window.__AP.SnapCam.view, busy: window.__AP.SnapCam.busy, modal: !document.getElementById('modal').hidden, paused: v.paused, muted: v.muted, rate: v.playbackRate }; });
      check('Cancel stops the search and puts sound and speed back', !after.strip && !after.busy && !after.modal && after.paused && !after.muted && after.rate === 1, JSON.stringify(after));
      check('the sound is not mistaken for broken by the silent search', (await state(s.page)).hasAudio === true);

      // ---- subtitles help: the line before the snap
      const srt = path.join(newProfile(), 'line.srt');
      fs.writeFileSync(srt, '1\n00:01:33,000 --> 00:01:35,000\nI am... inevitable.\n\n2\n00:01:36,500 --> 00:01:37,400\nAnd I...\n\n3\n00:01:37,600 --> 00:01:39,250\nam... Iron Man.\n');
      await s.page.evaluate(async (file) => { await window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(file), { quiet: true }); }, srt);
      await s.page.click('#snapFind');
      check('a subtitle file nobody has checked does not steer the search: it starts where the snap point is', await waitFor(s.page, () => /Looking near 0:01:00/.test(document.getElementById('modalNote').textContent), null, 6000), await s.page.textContent('#modalNote'));
      check('strip', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      check('the strip quotes the line, where it ends, and that it was not checked', /The line “And I\.\.\. am\.\.\. Iron Man\.” ends at 0:01:39\.250 \(the subtitles, not checked against the film\)/.test(f.note) && Math.abs(f.selT - RISE) < 0.002, f.note.slice(0, 160));
      await s.page.keyboard.press('Enter');
      await sleep(300);
      await s.page.keyboard.press('Escape');
      check('set from there', Math.abs((await snapSec(s.page)) - 101.543) < 1e-6);

      // ---- while a countdown is armed the strip is for looking only
      await s.page.click('.tab[data-tab="mission"]');
      await armIn(s.page, 900);
      check('armed, waiting for a start 15 minutes away', await waitPhase(s.page, 'standby', 6000));
      await s.page.click('.tab[data-tab="test"]');
      await s.page.click('[data-test="snap"]');
      check('a Snap test during an armed countdown', await waitSynced(s.page, 12000));
      check('its strip opens too', await stripOpen(s.page, 180000));
      f = await stripView(s.page);
      const st = await state(s.page);
      check('the real countdown is armed again underneath', st.mode === 'armed' && st.phase === 'standby' && st.test === null, st.mode + ' ' + st.phase);
      check('the strip shows its own picture and does not move the film', f.readOnly && f.preview && st.t < 0.1, JSON.stringify({ readOnly: f.readOnly, preview: f.preview, t: st.t }));
      check('the snap landed, and “Yes” is offered', /The snap landed/.test(f.title) && !f.okDisabled && f.ok === 'Yes, the snap is on this frame');
      await s.page.keyboard.press('ArrowRight');
      await sleep(200);
      f = await stripView(s.page);
      check('another frame can be looked at but not set', f.okDisabled && f.ok === 'Put the snap on this frame' && (await state(s.page)).t < 0.1);
      await shot(s.page, 'strip-armed');
      await s.page.keyboard.press('Escape');
      check('closed, still armed, no slip', await stripClosed(s.page) && (await state(s.page)).mode === 'armed' && (await state(s.page)).slips === 0);
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // ---- a wide picture with black bars, and a film with no flash at all
    const s2 = await launch(newProfile());
    try {
      await loadMovie(s2.page, path.join(MEDIA, 'snap-wide.mp4'));
      await setSnap(s2.page, 20);
      await s2.page.click('#findSnapBtn');
      check('a wide picture with black bars: strip', await stripOpen(s2.page, 180000));
      let f = await stripView(s2.page);
      check('the bars do not hide the flash: begins at 0:21.542', !!f.flash && f.flash.kind === 'white' && Math.abs(f.flash.rise - 517 / 24) < 0.002, JSON.stringify(f.flash));
      await s2.page.keyboard.press('Escape');

      // Subtitles inside the movie: nothing is loaded by hand, the app reads them itself.
      if (await s2.page.evaluate(() => window.apNative.ffLocate())) {
        await loadMovie(s2.page, path.join(MEDIA, 'snap-subs.mkv'));
        await setSnap(s2.page, 20);
        await waitFor(s2.page, () => !!window.__AP.Media.probe, null, 6000);
        check('no subtitle file is loaded', !(await s2.page.evaluate(() => window.__AP.SubsUI.loaded)));
        await s2.page.click('#findSnapBtn');
        check('the app reads the subtitles inside the movie and goes to the line, 80 s from the point that is set', await waitFor(s2.page, () => /Looking near 0:01:40/.test(document.getElementById('modalNote').textContent), null, 15000), await s2.page.textContent('#modalNote'));
        check('strip', await stripOpen(s2.page, 180000));
        f = await stripView(s2.page);
        // (this file's times run 0.021 s later than the plain clip's: its sound starts that much before its picture)
        check('line and flash agree, and the strip says so', !!f.flash && Math.abs(f.flash.rise - 2437 / 24) < 0.03 &&
          /The line “And I\.\.\. am\.\.\. Iron Man\.” ends at 0:01:40\.6\d\d \(the subtitles inside the movie\)/.test(f.note) && /0\.9\d s after the end of that line, as it should/.test(f.note), f.note.slice(0, 260));
        await s2.page.keyboard.press('Escape');
      } else {
        console.log('  note  FFmpeg not found on this machine: subtitles inside the movie are not read');
      }

      // ---- what the app decides by itself after an import (started here the way an import starts it)
      const auto = (page) => page.evaluate(() => { window.__AP.SnapCam.find({ auto: true }); });
      const verdict = (page) => page.evaluate(() => {
        const { cfg, SnapCam, Engine } = window.__AP;
        const mem = Object.values(cfg.snapByFile).slice(-1)[0] || {};
        return { snap: cfg.snapSec, how: mem.how, searched: mem.searched, confirmed: mem.confirmed, applied: SnapCam.view && SnapCam.view.applied ? SnapCam.view.applied.how : null,
          title: document.getElementById('stripTitle').textContent, note: document.getElementById('stripNote').textContent, pre: document.getElementById('preflight').textContent,
          log: Engine.events.slice(-3).map((e) => e.text).join(' | ') };
      });
      if (await s2.page.evaluate(() => window.apNative.ffLocate())) {
        // Both witnesses, and they agree: the flash, right after the line in the movie's own subtitles.
        await loadMovie(s2.page, path.join(MEDIA, 'snap-subs.mkv'));
        await setSnap(s2.page, 20);
        await s2.page.evaluate(() => { window.__AP.cfg.snapByFile = {}; });
        await waitFor(s2.page, () => !!window.__AP.Media.probe, null, 6000);
        await auto(s2.page);
        check('flash and subtitles agree: the strip opens with the snap already set', await stripOpen(s2.page, 180000));
        let d = await verdict(s2.page);
        check('the snap point is on the frame of the flash, found by both witnesses', Math.abs(d.snap - 101.564) < 0.0015 && d.how === 'flash+line' && d.confirmed && d.searched && d.applied === 'flash+line', JSON.stringify({ snap: d.snap, how: d.how, confirmed: d.confirmed }));
        check('and the strip says so', /^Snap found: 0:01:41\.56\d$/.test(d.title) && /0\.9\d s after the line “…Iron Man\.” goes off screen/.test(d.note), d.title + ' | ' + d.note.slice(0, 160));
        check('the pre-flight list names both witnesses', await waitFor(s2.page, () => /found by the app: the flash, right after the line “…Iron Man\.”/.test(document.getElementById('preflight').textContent), null, 3000));
        await s2.page.keyboard.press('Escape');
      }

      // The witnesses disagree: a flash, but six seconds after the line in subtitles the app vouches
      // for (as if it had put them on the voices). Nothing is set; the user decides.
      await s2.page.evaluate(() => { window.__AP.cfg.subAutoSync = false; });
      const vouch = (page) => page.evaluate(() => { const { cfg, SubSync } = window.__AP; cfg.subSyncKey = SubSync.key(); cfg.subSyncState = 'synced'; });
      await loadMovie(s2.page, path.join(MEDIA, 'snap-scene.mp4'));
      await setSnap(s2.page, SNAP);
      await s2.page.evaluate(() => { window.__AP.cfg.snapByFile = {}; });
      const early = path.join(newProfile(), 'early.srt');
      fs.writeFileSync(early, '1\n00:01:31,000 --> 00:01:33,000\nAnd I...\n\n2\n00:01:33,500 --> 00:01:35,000\nam... Iron Man.\n');
      await s2.page.evaluate(async (file) => { await window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(file), { quiet: true }); }, early);
      await vouch(s2.page);
      await auto(s2.page);
      check('flash and trusted subtitles disagree: the strip opens', await stripOpen(s2.page, 180000));
      let d = await verdict(s2.page);
      check('nothing is set by the app', d.snap === SNAP && d.applied === null && !d.confirmed && d.searched, JSON.stringify({ snap: d.snap, how: d.how }));
      check('and the strip says why: the flash is not right after the line', /The app left the snap point as it was: the screen turns white at 0:01:41\.5\d\d, which is not right after the line “…Iron Man\.”/.test(d.note) && /^Is this the snap\?$/.test(d.title), d.title + ' | ' + d.note.slice(0, 260));
      await s2.page.keyboard.press('Escape');
      // The same file, not checked against the film: only a hint, never a witness. The flash settles it.
      await s2.page.evaluate(() => { const { cfg } = window.__AP; cfg.subSyncKey = ''; cfg.subSyncState = ''; cfg.snapByFile = {}; });
      await auto(s2.page);
      check('the same subtitles unchecked: the strip opens', await stripOpen(s2.page, 180000));
      d = await verdict(s2.page);
      check('a subtitle file nobody has checked is no witness, but one that puts the line 6.5 s from the flash is a reason to ask', d.snap === SNAP && d.applied === null && !d.confirmed && /puts the line 6\.\d s away from this flash/.test(d.note), JSON.stringify({ snap: d.snap, how: d.how }) + ' ' + d.note.slice(0, 260));
      await s2.page.keyboard.press('Escape');
      await s2.page.evaluate(() => window.__AP.SubsUI.clear());

      // Only the subtitles: no flash in the picture. An estimate just after the line, and it says so.
      await loadMovie(s2.page, MOVIE);
      await setSnap(s2.page, SNAP);
      await s2.page.evaluate(() => { window.__AP.cfg.snapByFile = {}; });
      const only = path.join(newProfile(), 'only.srt');
      fs.writeFileSync(only, '1\n00:01:36,500 --> 00:01:37,400\nAnd I...\n\n2\n00:01:37,600 --> 00:01:38,300\nam...\n\n3\n00:01:39,100 --> 00:01:40,600\nIron Man.\n');
      await s2.page.evaluate(async (file) => { await window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(file), { quiet: true }); }, only);
      await vouch(s2.page);
      await auto(s2.page);
      check('trusted subtitles but no flash: the strip opens after the wider search', await stripOpen(s2.page, 180000));
      d = await verdict(s2.page);
      check('the snap point is an estimate, 0.1 s after the line, and not called confirmed', Math.abs(d.snap - 100.7) < 0.0015 && d.how === 'estimate' && !d.confirmed && d.applied === 'estimate', JSON.stringify({ snap: d.snap, how: d.how, confirmed: d.confirmed }));
      check('the strip asks the user to pick the frame', /Where does he snap/.test(d.title) && /No flash was found in the picture\. By the subtitles the snap comes a moment after 0:01:40\.600/.test(d.note), d.note.slice(0, 200));
      const sel = await stripView(s2.page);
      check('and starts at the end of the line', Math.abs(sel.selT - 100.6) < 0.03, String(sel.selT));
      check('the pre-flight list says it is an estimate', await waitFor(s2.page, () => /0:01:40\.700 is an estimate from the subtitles/.test(document.getElementById('preflight').textContent), null, 3000));
      await s2.page.keyboard.press('Escape');
      await s2.page.evaluate(() => window.__AP.SubsUI.clear());
      // Unchecked, the same file gives no estimate: nothing is set.
      await setSnap(s2.page, SNAP);
      await s2.page.evaluate(async (file) => { window.__AP.cfg.snapByFile = {}; await window.__AP.SubsUI.loadFrom(await window.apNative.readSubtitle(file), { quiet: true }); }, only);
      await auto(s2.page);
      check('the same subtitles unchecked: the strip opens', await stripOpen(s2.page, 180000));
      d = await verdict(s2.page);
      check('an unchecked subtitle file gives no estimate: nothing is set', d.snap === SNAP && d.applied === null && !d.confirmed, JSON.stringify({ snap: d.snap, how: d.how }));
      await s2.page.keyboard.press('Escape');
      await s2.page.evaluate(() => { window.__AP.SubsUI.clear(); window.__AP.cfg.subAutoSync = true; });

      // No witness at all.
      await loadMovie(s2.page, MOVIE);
      await setSnap(s2.page, SNAP);
      await s2.page.evaluate(() => { window.__AP.cfg.snapByFile = {}; });
      await auto(s2.page);
      check('no flash and no subtitles: the strip opens for the user', await stripOpen(s2.page, 180000));
      d = await verdict(s2.page);
      check('nothing is set, and the file is noted as searched', d.snap === SNAP && d.applied === null && !d.confirmed && d.searched && /left the snap point as it was: no flash was found, and there are no subtitles to go by/.test(d.log), JSON.stringify({ snap: d.snap, searched: d.searched }) + ' ' + d.log.slice(-160));
      await s2.page.keyboard.press('Escape');

      await loadMovie(s2.page, MOVIE);
      await setSnap(s2.page, SNAP);
      await s2.page.click('#findSnapBtn');
      check('a film with no flash: the app searches wider, then shows the frames anyway', await stripOpen(s2.page, 180000));
      f = await stripView(s2.page);
      check('no frame is suggested; the frame set now is selected', f.flash === null && /no flash was found/i.test(f.note) && Math.abs(f.selT - SNAP) < 0.002 && f.ok === 'Yes, the snap is on this frame', f.note.slice(0, 80) + ' | ' + f.selT);
      await s2.page.keyboard.press('ArrowRight');
      await s2.page.keyboard.press('ArrowRight');
      await sleep(250);
      await s2.page.keyboard.press('Enter');
      await sleep(300);
      check('a frame picked by eye is set just the same', Math.abs((await s2.page.evaluate(() => window.__AP.cfg.snapSec)) - 100.084) < 0.0011, String(await s2.page.evaluate(() => window.__AP.cfg.snapSec)));
      await s2.page.keyboard.press('Escape');
      const details = await s2.page.evaluate(() => window.__AP.UI.snapDetails());
      check('“Copy the details” has the numbers', /Snap point: 0:01:40\.08\d \(100\.08\d s\), confirmed in this file/.test(details), details.slice(0, 300));
      check('and what the last search saw, frame by frame', /Last search: ask \(nothing\), no flash, no line/.test(details) && /Frames from \d+\.\d{3}: (\d+,\d+,\d+ ){100,}/.test(details), details.split('\n').slice(-2).join(' / ').slice(0, 300));
      check('no page errors', s2.errors.length === 0, s2.errors.join(' | '));
    } finally { await s2.close(); }
  },

  async latejoin() {
    // Somebody who never started the countdown and turns up when the film should already be running.
    const box = (page) => page.evaluate(() => {
      const g = (id) => document.getElementById(id);
      return {
        box: !g('late').hidden, title: g('lateTitle').textContent, body: g('lateBody').textContent, sub: g('lateSub').textContent,
        pill: !g('latePill').hidden, pillText: g('latePill').textContent, arm: g('armBtn').textContent, hint: g('armHint').textContent, label: g('stLabel').textContent
      };
    });
    const stop = async (page) => { await page.click('.tab[data-tab="mission"]'); await page.click('#armBtn'); await page.click('#armBtn'); await sleep(300); };
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await waitFor(s.page, () => window.__AP.Media.hasAudio === true && !window.__AP.Media.checking, null, 9000);
      let L = await box(s.page);
      check('weeks before the start nothing is said', !L.box && !L.pill && L.arm === 'START THE COUNTDOWN');

      // five minutes to go and not armed
      await aimAt(s.page, 300);
      check('ten minutes before the start an un-armed player is reminded', await waitFor(s.page, () => !document.getElementById('latePill').hidden, null, 3000));
      L = await box(s.page);
      check('the reminder counts down and says what to press', /^NOT ARMED · the movie has to start in 00:0(4:5\d|5:00) · click to start the countdown$/.test(L.pillText) && !L.box, L.pillText);
      await s.page.click('#latePill');
      check('clicking it starts the countdown (after the question about the unchecked snap point)', await startAnyway(s.page) && await waitPhase(s.page, 'standby', 5000) && (await state(s.page)).mode === 'armed' && await s.page.isHidden('#latePill'));
      await stop(s.page);

      // the movie should have started half a minute ago
      await aimAt(s.page, -30);
      check('late: the box appears by itself', await waitFor(s.page, () => !document.getElementById('late').hidden && document.getElementById('stLabel').textContent === 'LATE · NOT ARMED', null, 3000));
      L = await box(s.page);
      check('it says so, and where the film should be', L.title === 'You are late to the countdown' && /^The movie had to start at \d+:\d\d:\d\d [AP]M\. Right now it should be at 0:00:3\d\.$/.test(L.body) && /^The snap in 00:01:\d\d · press Enter or Space$/.test(L.sub), L.body + ' | ' + L.sub);
      check('the big button and the status card say the same', L.arm === 'JOIN THE MOVIE NOW' && L.label === 'LATE · NOT ARMED' && /should already be playing/.test(L.hint), L.arm + ' | ' + L.label);
      await shot(s.page, 'late-box');
      await s.page.keyboard.press('Enter');
      check('Enter joins: the film locks onto the clock', await waitSynced(s.page, 12000));
      let st = await state(s.page);
      let m = await measureSync(s.page, 2500);
      check('it is where the clock says it should be, not at the beginning', st.mode === 'armed' && st.t > 30 && Math.abs(m.worst) < 0.08, 't=' + st.t.toFixed(2) + ', ' + ms(m.worst));
      L = await box(s.page);
      check('the box is gone and the countdown counts as armed', !L.box && !L.pill && /COUNTDOWN ARMED/.test(L.arm), L.arm);
      check('it is logged as a late join, not as a recalibration', (await s.page.evaluate(() => window.__AP.Engine.events.some((e) => /Joined late/.test(e.text)))) && st.recals === 0);

      // stopping on purpose is not answered with the box
      await stop(s.page);
      L = await box(s.page);
      check('after stopping on purpose: no box, only a small way back', !L.box && L.pill && /^LATE · the movie should be at 0:00:\d\d · click to join$/.test(L.pillText), L.pillText);
      await s.page.click('#latePill');
      check('the pill joins again', await waitSynced(s.page, 12000) && (await state(s.page)).mode === 'armed');
      await stop(s.page);

      // "Not now"
      await aimAt(s.page, -40);
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000);
      await s.page.click('#lateNo');
      await sleep(300);
      L = await box(s.page);
      check('“Not now” puts the box away', !L.box && L.pill);
      await s.page.keyboard.press('Space');
      await sleep(900);
      st = await state(s.page);
      check('after that, Space plays the film freely as always', st.mode === 'free' && !st.paused);
      await s.page.keyboard.press('Space');

      // the play button
      await aimAt(s.page, -50);
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000);
      await s.page.click('#btnPlay', { force: true });
      check('while the box is up, the play button joins too', await waitSynced(s.page, 12000) && (await state(s.page)).mode === 'armed' && (await state(s.page)).t > 50);
      await stop(s.page);

      // eight seconds before the snap
      await aimAt(s.page, -(SNAP - 8));
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000);
      L = await box(s.page);
      check('seconds before the snap the box still offers to join', /^The snap in 00:00:0\d/.test(L.sub), L.sub);
      await s.page.keyboard.press(' ');
      check('Space joins', await waitSynced(s.page, 9000));
      const left = await s.page.evaluate(() => window.__AP.Engine.session.targetEpoch - window.__AP.Clock.now());
      check('in sync before the snap', left > 1000, Math.round(left) + ' ms to go');
      await sleep(Math.max(0, left) + 1200);
      const atSnap = await s.page.evaluate(() => {
        const { Engine, Clock, cfg, Celebration } = window.__AP;
        const v = document.getElementById('video');
        return { since: (Clock.now() - Engine.session.targetEpoch) / 1000, t: v.currentTime, snap: cfg.snapSec, party: !!(Celebration.fx && Celebration.fx.running), reached: Engine.events.some((e) => /Target moment reached/.test(e.text)) };
      });
      check('the snap lands on the clock and the celebration plays', atSnap.reached && atSnap.party && Math.abs((atSnap.t - atSnap.snap) - atSnap.since) < 0.08, JSON.stringify(atSnap));
      await stop(s.page);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // ---- the PC crashed with nothing armed, or the app is simply opened late: the box is there at once
    await (async () => {
      const again = await launch(profile);
      try {
        await aimAt(again.page, -45);
        await again.close();
      } catch (e) { await again.close(); throw e; }
    })();
    s = await launch(profile);
    try {
      check('opened late with the movie remembered: the box is on screen', await waitFor(s.page, () => window.__AP.Media.ready && !document.getElementById('late').hidden, null, 15000));
      const L = await box(s.page);
      check('and says where the film should be', /Right now it should be at 0:0[01]:\d\d\./.test(L.body), L.body);
      await s.page.click('#lateBtn');
      check('JOIN NOW joins', await waitSynced(s.page, 12000) && (await state(s.page)).mode === 'armed');
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }

    // ---- no movie yet: the import screen says that it should be playing
    s = await launch(newProfile());
    try {
      check('before the start the import screen says nothing of the kind', await s.page.isHidden('#imLate'));
      await s.page.evaluate(() => {
        const { cfg, Engine } = window.__AP;
        const d = new Date(Date.now() + 3600 * 1000);
        const pad = (n) => String(n).padStart(2, '0');
        cfg.targetMode = 'custom';
        cfg.customTarget = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        Engine.session = Engine.computeFree();
      });
      check('with the film due to be running, the import screen says so', await waitFor(s.page, () => !document.getElementById('imLate').hidden, null, 3000));
      const txt = await s.page.textContent('#imLateText');
      check('with the start time and where the film should be', /^It had to start at \d+:\d\d:\d\d [AP]M and should be at 1:30:\d\d now\. Import the movie and press JOIN NOW/.test(txt), txt);
      await shot(s.page, 'late-import');
      await loadMovie(s.page, path.join(MEDIA, 'original-length.mp4'));
      check('importing the movie brings up the box', await waitFor(s.page, () => !document.getElementById('late').hidden, null, 6000));
      await s.page.keyboard.press('Enter');
      check('and one key joins an hour and a half into the film', await waitSynced(s.page, 15000) && Math.abs((await state(s.page)).t - 5430) < 30, C_fmt((await state(s.page)).t));
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
      check('seven app themes are offered: War Machine in place of Stealth, TVA in place of Midnight Gold, Doom', themes.join(',') === 'arc,hotrod,infinity,gamma,warmachine,tva,doom', themes.join(','));
      for (const id of themes) {
        await s.page.click('#themeGrid .theme[data-id="' + id + '"]');
        await sleep(250);
        await shot(s.page, 'theme-' + id);
      }
      await s.page.click('#themeGrid .theme[data-id="hotrod"]');
      check('choosing a theme restyles the app', await s.page.evaluate(() => document.documentElement.dataset.theme === 'hotrod' && getComputedStyle(document.documentElement).getPropertyValue('--acc2').trim() === '#e02b35'));
      await tenPreviews(s);
      await s.page.click('#themeGrid .theme[data-id="hotrod"]');
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
      check('all eleven animation choices are there, the seven theme ones included', await s.page.evaluate(() =>
        ['stark', 'arc', 'hotrod', 'infinity', 'gamma', 'warmachine', 'tva', 'doom', 'fireworks', 'minimal', 'off'].every((id) => {
          const b = document.querySelector('#optCelebration [data-v="' + id + '"]');
          return b && !b.hidden && b.offsetWidth > 0;
        })));
      // Each theme animation really plays in the app (its file loaded, registered and drawing).
      for (const id of ['arc', 'hotrod', 'infinity', 'gamma', 'warmachine', 'tva', 'doom']) {
        await s.page.click(`#optCelebration [data-v="${id}"]`);
        await s.page.click('#previewCelebration');
        await sleep(2200);
        const r = await s.page.evaluate(() => {
          const c = document.getElementById('fx');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let lit = 0;
          for (let i = 3; i < d.length; i += 16) if (d[i] > 8) lit++;
          return { running: !!(window.__AP.Celebration.fx && window.__AP.Celebration.fx.running), lit, style: window.__AP.cfg.celebration, hint: document.getElementById('celebHint').textContent };
        });
        check(`${id}: the preview plays in the app and draws`, r.running && r.lit > 200 && r.style === id && r.hint.length > 20, JSON.stringify(r));
        if (id === 'tva') await shot(s.page, 'celebration-tva');
        await s.page.evaluate(() => window.__AP.Celebration.stop());
      }
      // The words: never "RIGHT ON TIME". The Preview and a test run rehearse the night.
      const words = await s.page.evaluate(() => {
        const A = window.__AP;
        const soon = A.Clock.real() + 60000;
        const keep = [A.cfg.targetMode, A.cfg.customTarget];
        const out = { y: String(new Date(A.Clock.real()).getFullYear() + 1), now: A.Celebration.words(soon) };
        A.cfg.targetMode = 'custom'; A.cfg.customTarget = (new Date(A.Clock.real()).getFullYear() + 1) + '-03-14T15:00';
        out.own = A.Celebration.words(soon);
        A.cfg.targetMode = keep[0]; A.cfg.customTarget = keep[1];
        return out;
      });
      check('the Preview and a test run say HAPPY NEW YEAR and the coming year', words.now.title === 'HAPPY NEW YEAR' && words.now.year === words.y, JSON.stringify(words));
      check('a target of one\'s own that is not New Year says TARGET REACHED', words.own.title === 'TARGET REACHED' && words.own.year === '', JSON.stringify(words.own));
      // Animation sound: off by default; switched on, every animation is heard, Stark's rockets too.
      const sfxCount = () => s.page.evaluate(() => (window.__AP.Sfx ? window.__AP.Sfx.count : -1));
      check('the animation sound is there and off by default', await s.page.evaluate(() =>
        !!window.__AP.Sfx && window.__AP.cfg.celebrationSound === false && document.getElementById('optCelebSound').checked === false));
      await s.page.click('#optCelebration [data-v="stark"]');
      let c0 = await sfxCount();
      await s.page.click('#previewCelebration');
      await sleep(3000);
      check('with the sound off, the preview makes no sound', await sfxCount() === c0, `${c0} -> ${await sfxCount()}`);
      await s.page.evaluate(() => window.__AP.Celebration.stop());
      await s.page.click('label:has(#optCelebSound)');
      check('the switch turns the sound on', await s.page.evaluate(() => window.__AP.cfg.celebrationSound === true));
      c0 = await sfxCount();
      await s.page.click('#previewCelebration');
      const c1 = await sfxCount();
      await sleep(4500);
      const c2 = await sfxCount();
      check('Stark is heard: its own sound at once, then its rockets as they fire', c1 > c0 && c2 > c1, `${c0} -> ${c1} -> ${c2}`);
      await s.page.evaluate(() => window.__AP.Celebration.stop());
      for (const id of ['arc', 'hotrod', 'infinity', 'gamma', 'warmachine', 'tva', 'doom', 'fireworks', 'minimal']) {
        await s.page.click(`#optCelebration [data-v="${id}"]`);
        const a = await sfxCount();
        await s.page.click('#previewCelebration');
        const b = await sfxCount();
        check(`${id} has a sound`, b > a, `${a} -> ${b}`);
        await s.page.evaluate(() => window.__AP.Celebration.stop());
      }
      // The midnight frame stays light: the sound's voices are made just ahead of time, not all at once.
      const soundMs = await s.page.evaluate(() => {
        let worst = 0;
        for (const st of ['gamma', 'doom', 'hotrod', 'arc']) {
          const a = performance.now();
          window.__AP.Celebration.sound(st, 'HAPPY NEW YEAR', '2027');
          worst = Math.max(worst, performance.now() - a);
          window.__AP.Celebration.stop();
        }
        return Math.round(worst * 100) / 100;
      });
      check('starting an animation\'s sound costs the midnight frame almost nothing', soundMs < 5, soundMs + ' ms at most');
      await s.page.click('label:has(#optCelebSound)');
      check('and the switch turns it off again', await s.page.evaluate(() => window.__AP.cfg.celebrationSound === false));
      // With only the Final Countdown left on, the panel is not an empty box all evening.
      for (const id of ['optClock', 'optDate', 'optCount']) await s.page.click(`label:has(#${id})`);
      check('with the clock, date and countdown off, no empty panel is left on screen', await waitFor(s.page, () => document.getElementById('overlay').hidden, null, 2000)
        && await s.page.evaluate(() => window.__AP.cfg.finalTen === true && window.__AP.cfg.showOverlay === true));
      for (const id of ['optClock', 'optDate', 'optCount']) await s.page.click(`label:has(#${id})`);
      check('and it comes back with them', await waitFor(s.page, () => !document.getElementById('overlay').hidden, null, 2000));
      // Less motion asked for (Windows animation effects off): Stark's countdown stays the classic one.
      await s.page.emulateMedia({ reducedMotion: 'reduce' });
      const tenAnim = async (c) => {
        await s.page.click(`#optCelebration [data-v="${c}"]`);
        await s.page.click('#previewTen');
        await waitFor(s.page, () => document.getElementById('overlay').classList.contains('final'), null, 2000);
        await sleep(120);
        const a = await s.page.evaluate(() => document.getAnimations().filter((x) => x.effect && x.effect.target === document.getElementById('ovCountVal') && !x.effect.pseudoElement).map((x) => x.animationName));
        await s.page.click('#previewTen');
        await waitFor(s.page, () => !document.getElementById('overlay').classList.contains('final'), null, 2000);
        return a;
      };
      const rmStark = await tenAnim('stark');
      const rmArc = await tenAnim('arc');
      check('with less motion asked for, Stark keeps its classic countdown and the others just fade', rmStark.includes('tenpop') && rmArc.includes('ten-fade') && !rmArc.includes('ten-arc'), JSON.stringify({ stark: rmStark, arc: rmArc }));
      await s.page.emulateMedia({ reducedMotion: 'no-preference' });
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
      // Midnight Gold became TVA: a saved Midnight Gold choice opens as TVA.
      await s.close();
      const file = path.join(profile, 'settings.json');
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved.renderer.theme = 'midnight';
      fs.writeFileSync(file, JSON.stringify(saved));
      s = await launch(profile);
      check('a saved Midnight Gold theme opens as TVA', await s.page.evaluate(() => document.documentElement.dataset.theme === 'tva' && window.__AP.cfg.theme === 'tva' &&
        getComputedStyle(document.documentElement).getPropertyValue('--acc2').trim() === '#c8622a'));
      // Stealth became War Machine: a saved Stealth choice opens as War Machine.
      await s.close();
      const saved2 = JSON.parse(fs.readFileSync(file, 'utf8'));
      saved2.renderer.theme = 'stealth';
      fs.writeFileSync(file, JSON.stringify(saved2));
      s = await launch(profile);
      check('a saved Stealth theme opens as War Machine, in the same greys', await s.page.evaluate(() => document.documentElement.dataset.theme === 'warmachine' && window.__AP.cfg.theme === 'warmachine' &&
        getComputedStyle(document.documentElement).getPropertyValue('--acc2').trim() === '#a0a0ac' && getComputedStyle(document.documentElement).getPropertyValue('--card').trim() === '#131316'));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async restart() {
    // "I think I started it wrong": the start time changes while the movie plays, without stopping the countdown.
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, -30);
      check('armed and playing in sync', await waitSynced(s.page, 10000));
      await sleep(1500);
      const before = await s.page.evaluate(() => ({ start: window.__AP.Engine.session.startEpoch, target: window.__AP.cfg.armedTarget }));
      await s.page.click('.tab[data-tab="setup"]');
      const ui = await s.page.evaluate(() => ({ off: document.getElementById('smAuto').disabled || document.getElementById('smOwnPlus1').disabled, note: document.getElementById('smArmedNote').textContent, shown: !document.getElementById('smArmedNote').hidden, here: !document.getElementById('smHere').hidden }));
      check('while armed the start time can be changed, and Setup says what that does', !ui.off && ui.shown && /The countdown is running: a new start time moves the film at once/.test(ui.note) && ui.here, JSON.stringify(ui));

      // One second later: the film jumps back one second and stays on the clock.
      await s.page.click('#smOwnPlus1');
      check('+1 s while playing: the film is re-cued and locks on again', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /Start time changed while armed/.test(e.text)), null, 3000) && await waitSynced(s.page, 8000));
      await sleep(1500);
      let v = await s.page.evaluate(() => { const { Engine, cfg } = window.__AP; const vid = document.getElementById('video'); return { start: Engine.session.startEpoch, target: cfg.armedTarget, armed: cfg.armed, mode: cfg.startMode, off: vid.currentTime - Engine.expected(), drift: Engine.st.drift }; });
      check('the movie now counts as started one second later, same target, still armed', v.start - before.start === 1000 && v.target === before.target && v.armed && v.mode === 'own', JSON.stringify(v));
      check('and the film is where the clock says with it', Math.abs(v.off) < 0.12 && Math.abs(v.drift) < 0.06, JSON.stringify(v));
      const toasts = await s.page.evaluate(() => document.getElementById('toasts').textContent);
      check('it says so: “New start time …: the film jumps 1.0 s back and stays on the clock”', /New start time \d+:\d\d:\d\d(\.\d{3})? [AP]M: the film jumps 1\.0 s back and stays on the clock\./.test(toasts), toasts.slice(0, 300));

      // A start time this file is too short for is refused, and nothing changes.
      await s.page.click('label:has(#smClassic)');
      await sleep(600);
      v = await s.page.evaluate(() => ({ mode: window.__AP.cfg.startMode, start: window.__AP.Engine.session.startEpoch, toasts: document.getElementById('toasts').textContent }));
      check('9:29:30 PM with a 3:20 clip: refused, the start time stays', v.mode === 'own' && v.start === before.start + 1000 && /too short for that start time/.test(v.toasts), JSON.stringify(v));

      // Paused on purpose, then "Start time from where the film is now": the film goes on from where it is.
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.keyboard.press('Space');
      await waitPhase(s.page, 'slipped', 2000);
      await s.page.click('#slipStay');
      await sleep(3000);
      const paused = await s.page.evaluate(() => document.getElementById('video').currentTime);
      await s.page.click('.tab[data-tab="setup"]');
      const clickAt = Date.now();
      await s.page.click('#smHere');
      check('“Start time from where the film is now”: the film locks on again', await waitSynced(s.page, 8000));
      await sleep(1000);
      v = await s.page.evaluate(() => { const { Engine, cfg } = window.__AP; return { t: document.getElementById('video').currentTime, start: Engine.session.startEpoch, armed: cfg.armed, target: cfg.armedTarget, off: document.getElementById('video').currentTime - Engine.expected() }; });
      const ran = (Date.now() - clickAt) / 1000;
      check('it went on from where it was paused, not from where the old start time said', Math.abs(v.t - (paused + ran)) < 0.6 && v.start - before.start > 3500, 'paused at ' + paused.toFixed(2) + ' s, now ' + v.t.toFixed(2) + ' s after ' + ran.toFixed(1) + ' s; start moved ' + ((v.start - before.start) / 1000).toFixed(2) + ' s');
      check('still armed, same target, on the clock', v.armed && v.target === before.target && Math.abs(v.off) < 0.12, JSON.stringify(v));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async replay() {
    // The replay of the night, in the New Year's Eve simulation from 11:59:00 PM: nothing is recorded
    // until 20 s before midnight, then midnight, the snap and the celebration are saved as a clip.
    const ENDGAME = path.join(MEDIA, 'original-length.mp4');
    if (!fs.existsSync(ENDGAME)) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const profile = newProfile();
    const dir = path.join(profile, 'videos');
    const files = () => { try { return fs.readdirSync(dir); } catch (e) { return []; } };
    const s = await launch(profile);
    try {
      await loadMovie(s.page, ENDGAME);
      if (await waitFor(s.page, () => !document.getElementById('modal').hidden && /Finding the snap/.test(document.getElementById('modalTitle').textContent), null, 15000)) {
        await s.page.click('#modalActions button');
        await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 8000);
      }
      await setSnap(s.page, '2:30:31.668');
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      await s.page.click('.tab[data-tab="display"]');
      check('the replay is on by default, 40 s before midnight', await s.page.evaluate(() => document.getElementById('optReplay').checked && document.getElementById('optReplaySec').value === '40'));
      await s.page.selectOption('#optReplaySec', '20');
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsNightStart', 'set');
      await s.page.selectOption('#tsNightAt', 'snap');
      await s.page.click('[data-test="night"]');
      await sleep(25000);
      check('11:59:25 PM: nothing is recorded yet', files().length === 0, files().join(', '));
      check('20 s before midnight the recording starts', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /Replay: recording midnight \(rehearsal\)/.test(e.text)), null, 20000));
      check('20 s after midnight it is saved', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /Replay saved: /.test(e.text)), null, 60000));
      const saved = files();
      const clip = saved.find((f) => /^Rehearsal \d{4}-\d\d-\d\d \d\d\.\d\d - midnight\.(mp4|webm)$/.test(f));
      check('one clip, named as a rehearsal of midnight, nothing half written', !!clip && saved.length === 1, saved.join(', '));
      if (clip) {
        const file = path.join(dir, clip);
        let probe = null;
        try { probe = JSON.parse(execSync('ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of json ' + JSON.stringify(file)).toString()); } catch (e) { probe = null; }
        const dur = probe && probe.format ? +probe.format.duration : NaN;
        const kinds = probe ? probe.streams.map((x) => x.codec_type).sort().join(',') : '';
        const vid = probe ? probe.streams.find((x) => x.codec_type === 'video') : null;
        check('the clip runs from 20 s before to 20 s after midnight, picture and sound', Math.abs(dur - 40) < 3 && kinds === 'audio,video' && vid && vid.width > 300,
          'duration ' + (Number.isFinite(dur) ? dur.toFixed(1) : 'unknown') + ' s, streams ' + kinds + (vid ? ', ' + vid.width + 'x' + vid.height : '') + ', ' + Math.round(fs.statSync(file).size / 1024) + ' KB');
      }
      await s.page.click('#nightEnd');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async standbyfit() {
    // The standby screen weeks ahead: "44d 01:12:21.185" fits the screen, also a narrow window, and
    // its glow is not cut off at the edges of its box (that drew a rectangle behind the numbers).
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, '1:40.185');
      await s.page.evaluate(() => { const { cfg, Engine } = window.__AP; cfg.targetMode = 'newyear'; Engine.session = Engine.computeFree(); });
      await s.page.click('#armBtn');
      await startAnyway(s.page);
      check('weeks ahead: the standby screen counts down', await waitFor(s.page, () => !document.getElementById('standby').hidden, null, 10000));
      const look = () => s.page.evaluate(() => {
        const n = document.getElementById('sbCount');
        const r = n.getBoundingClientRect();
        const st = document.getElementById('stage').getBoundingClientRect();
        return { text: n.textContent, ms: !!n.querySelector('.ms'), overflow: getComputedStyle(n).overflow, fits: n.scrollWidth <= n.clientWidth + 1,
          inside: r.left >= st.left - 1 && r.right <= st.right + 1, shadow: getComputedStyle(n).textShadow };
      });
      await sleep(600);
      let v = await look();
      check('days and milliseconds, e.g. “44d 01:12:21.815”', /^\d+d \d\d:\d\d:\d\d\.\d{3}$/.test(v.text) && v.ms, v.text);
      check('the numbers glow, and nothing cuts the glow off into a box', /rgba?\(/.test(v.shadow) && v.overflow === 'visible', JSON.stringify(v));
      check('it fits the screen', v.fits && v.inside, JSON.stringify(v));
      await s.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1024, 640); });
      await sleep(1500);
      v = await look();
      check('and a narrow window', v.fits && v.inside, JSON.stringify(v));
      await s.page.evaluate(() => window.__AP.Engine.disarm());
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async ticks() {
    // Every countdown, and the film's own time while it is locked to the clock, change on the same
    // frame as the clock's seconds. The snap is put at 1:40.4, so the film starts between two seconds.
    const s = await launch(newProfile());
    try {
      check('loads the movie', await loadMovie(s.page, MOVIE));
      await setSnap(s.page, SNAP + 0.4);
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      // Every frame, what the screen shows.
      const sample = (forMs, untilEpoch) => s.page.evaluate(async ({ forMs, untilEpoch }) => {
        const g = (id) => document.getElementById(id).textContent;
        const { Clock, Engine } = window.__AP;
        const v = document.getElementById('video');
        const out = [];
        const end = performance.now() + forMs;
        while (performance.now() < end && !(untilEpoch && Clock.now() > untilEpoch)) {
          await new Promise((r) => requestAnimationFrame(r));
          const se = Engine.session;
          out.push({ now: Clock.now(), start: se ? se.startEpoch : 0, target: se ? se.targetEpoch : 0, phase: Engine.phase, cur: v.currentTime,
            clock: g('phClock'), card: g('stBig'), sb: g('sbCount'), ov: g('ovCountVal'), time: g('timeLabel') });
        }
        return out;
      }, { forMs, untilEpoch: untilEpoch || 0 });
      // How often `key` changed, how often without the clock, and how often the clock changed without it.
      const together = (rows, key, when) => {
        const r = { changes: 0, alone: 0, missed: 0, frames: 0 };
        for (let i = 1; i < rows.length; i++) {
          if (!when(rows[i]) || !when(rows[i - 1])) continue;
          r.frames++;
          const c = rows[i].clock !== rows[i - 1].clock;
          const k = rows[i][key] !== rows[i - 1][key];
          if (k) r.changes++;
          if (k && !c) r.alone++;
          if (c && !k) r.missed++;
        }
        return r;
      };
      const ok = (r, n) => r.changes >= n && r.alone === 0 && r.missed === 0;
      const secs = (txt) => { const p = txt.split(' / ')[0].split(':').map(Number); return p.reduce((a, x) => a * 60 + x, 0); };

      // 1. Armed, waiting for a start at x.6 s.
      await armIn(s.page, 7);
      check('armed, waiting for the start', await waitPhase(s.page, 'standby', 5000));
      const start = await s.page.evaluate(() => window.__AP.Engine.session.startEpoch);
      check('the start falls between two seconds', start % 1000 !== 0, String(start % 1000));
      let rows = await sample(3500);
      const waiting = (r) => r.phase === 'standby' && r.start - r.now > 1000;
      const frac = String(start % 1000).padStart(3, '0');
      check('the standby countdown shows the start\'s milliseconds', rows.filter(waiting).every((r) => r.sb.endsWith('.' + frac)), rows.filter(waiting).slice(0, 2).map((r) => r.sb).join(' | ') + ' (start .' + frac + ')');
      let t = together(rows, 'sb', waiting);
      check('and its seconds change on the same frame as the clock', ok(t, 3), JSON.stringify(t));
      t = together(rows, 'card', waiting);
      check('the countdown on the status card too', ok(t, 3), JSON.stringify(t));
      t = together(rows, 'ov', waiting);
      check('and the countdown in the clock panel', ok(t, 3), JSON.stringify(t));

      // 2. The film starts by itself and runs locked to the clock: its time ticks with the clock.
      check('the film starts and syncs', await waitSynced(s.page, 15000));
      await sleep(300);
      rows = await sample(3500);
      const locked = (r) => r.phase === 'synced';
      t = together(rows, 'time', locked);
      check('in sync, the film\'s time changes on the same frame as the clock', ok(t, 3), JSON.stringify(t));
      const far = rows.filter((r) => locked(r) && (Math.floor(r.cur + 1e-6) - secs(r.time) < 0 || Math.floor(r.cur + 1e-6) - secs(r.time) > 1));
      check('and is the film\'s own second (or the one before, for less than a second)', far.length === 0, far.slice(0, 3).map((r) => r.time + ' at ' + r.cur.toFixed(3)).join(' | '));

      // 3. A slip: the bar shows where the film really is; recalibrated, it ticks with the clock again.
      await s.page.evaluate(() => document.getElementById('video').pause());
      check('a pause is a slip', await waitPhase(s.page, 'slipped', 4000));
      rows = await sample(1600);
      const stuck = rows.filter((r) => r.phase === 'slipped');
      check('out of sync, the bar shows the film where it stopped, not the clock', stuck.length > 10 && stuck.every((r) => r.time === stuck[0].time && secs(r.time) === Math.floor(r.cur + 1e-6)), stuck.length ? stuck[0].time + ' at ' + stuck[0].cur.toFixed(3) : 'no rows');
      await s.page.keyboard.press('r');
      check('R recalibrates', await waitSynced(s.page, 12000));
      await sleep(300);
      rows = await sample(2500);
      t = together(rows, 'time', locked);
      check('back in sync, the film\'s time ticks with the clock again', ok(t, 2), JSON.stringify(t));

      // 4. The snap: as the clock's second turns to the target, the film's time turns to 1:40, the
      //    second that holds the snap (at 1:40.4).
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      await aimAt(s.page, -93);
      await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000);
      await s.page.keyboard.press('Enter');
      check('joined late, in sync', await waitSynced(s.page, 12000));
      const target = await s.page.evaluate(() => window.__AP.Engine.session.targetEpoch);
      rows = await sample(12000, target + 1500);
      const i = rows.findIndex((r) => r.now >= target);
      const at = i > 0 ? rows[i] : null;
      const before = i > 0 ? rows[i - 1] : null;
      check('the frame the clock reaches the target, the film\'s time turns from 1:39 to 1:40',
        !!at && before.phase === 'synced' && at.clock !== before.clock && /^1:40 \//.test(at.time) && /^1:39 \//.test(before.time),
        at ? before.time + ' -> ' + at.time + ' (' + before.clock + ' -> ' + at.clock + ', film at ' + at.cur.toFixed(3) + ')' : 'never reached');
      t = together(rows, 'time', locked);
      check('and all through the last seconds before it, the film\'s time ticked with the clock', ok(t, 3), JSON.stringify(t));
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async starttime() {
    // The start time can be chosen: automatic (the snap in the file decides), 9:29:30 PM, or one's
    // own. Every countdown follows the choice, and the Snap test says where the snap lands with it.
    // ENDGAME's flash begins at 2:30:31.667: the automatic start is 9:29:28.332 PM.
    const ENDGAME = path.join(MEDIA, 'original-length.mp4');
    if (!fs.existsSync(ENDGAME)) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const g = (page) => page.evaluate(() => {
      const t = (id) => document.getElementById(id).textContent;
      const se = window.__AP.Engine.session;
      return {
        mode: window.__AP.cfg.startMode, own: window.__AP.cfg.startOwnSec, start: t('ktStart'), lands: t('ktSnap'), landsLbl: t('ktSnapLbl'), link: t('startTimeLink'),
        autoAt: t('smAutoAt'), autoNote: t('smAutoNote'), classicAt: t('smClassicAt'), classicNote: t('smClassicNote'), ownNote: t('smOwnNote'),
        ownInput: document.getElementById('smOwnInput').value, preflight: t('preflight'), lead: se ? se.targetEpoch - se.startEpoch : null
      };
    });
    const shows = (page, id, re) => waitFor(page, ({ id, src }) => new RegExp(src).test(document.getElementById(id).textContent), { id, src: re.source }, 5000);
    const results = (page) => page.textContent('#testResults');
    const s = await launch(newProfile());
    try {
      // A 3:20 clip cannot start at 9:29:30 PM: it would be over long before midnight.
      await loadMovie(s.page, MOVIE);
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.check('#smClassic');
      await s.page.click('.tab[data-tab="mission"]');
      check('a 3:20 clip with 9:29:30 PM chosen: the pre-flight list says it does not fit', await shows(s.page, 'preflight', /The start time you chose does not fit this file/));
      await s.page.click('#armBtn');
      await sleep(600);
      check('and the countdown is not started', (await state(s.page)).mode === 'free');
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.check('#smAuto');

      // ENDGAME, its snap point on the first frame of the flash and confirmed.
      await loadMovie(s.page, ENDGAME);
      if (await waitFor(s.page, () => !document.getElementById('modal').hidden && /Finding the snap/.test(document.getElementById('modalTitle').textContent), null, 15000)) {
        await s.page.click('#modalActions button');
        await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 8000);
      }
      await setSnap(s.page, '2:30:31.668');
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      await sleep(300);
      let v = await g(s.page);
      check('automatic: the movie starts at 9:29:28 PM and the snap lands on midnight', v.mode === 'auto' && /Dec 31 · 9:29:28\.332 PM/.test(v.start) && /Jan 1 · 12:00:00 AM/.test(v.lands) &&
        v.landsLbl === 'The snap lands on midnight' && v.link === 'Start time: automatic · change' && v.lead === 9031668, JSON.stringify(v));
      // The countdown to a start 44 days away with milliseconds fits its card.
      const fit = await s.page.evaluate(() => { const b = document.getElementById('stBig'); return { text: b.textContent, fits: b.scrollWidth <= b.clientWidth + 1, ms: !!b.querySelector('.ms') }; });
      check('the status card countdown, days and milliseconds, fits its card', fit.fits && fit.ms && /^\d+d \d\d:\d\d:\d\d\.\d{3}$/.test(fit.text), JSON.stringify(fit));
      await s.page.click('#startTimeLink');
      check('“Start time · change” opens Setup', await waitFor(s.page, () => document.getElementById('pane-setup').classList.contains('on'), null, 2000));
      await sleep(300);
      const lay = await s.page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const panes = document.querySelector('#panel .panes').getBoundingClientRect();
        return { doc: document.scrollingElement.scrollTop, app: document.getElementById('app').scrollTop, panel: document.getElementById('panel').scrollTop, player: document.getElementById('playerView').scrollTop,
          tabsTop: document.querySelector('#panel .tabs').getBoundingClientRect().top, secTop: r('startSec').top, panesTop: panes.top, panesBottom: panes.bottom, winH: window.innerHeight, appBottom: r('app').bottom };
      });
      check('it scrolls the panel only: the app stays in place, no black bar, the section in view', lay.doc === 0 && lay.app === 0 && lay.panel === 0 && lay.player === 0 && lay.tabsTop >= 0 &&
        lay.secTop >= lay.panesTop - 1 && lay.secTop < lay.panesBottom && Math.abs(lay.appBottom - lay.winH) < 2, JSON.stringify(lay));
      v = await g(s.page);
      check('Setup shows the start times and where the snap lands with each', v.autoAt === '9:29:28.332 PM' && /2:30:31\.668: the snap lands on midnight/.test(v.autoNote) &&
        v.classicAt === '9:29:30 PM' && /the snap lands 1\.668 s after midnight/.test(v.classicNote), JSON.stringify(v));

      // 9:29:30 PM.
      await s.page.check('#smClassic');
      const shown = await shows(s.page, 'ktStart', /Dec 31 · 9:29:30 PM/);       // the panel is redrawn on the next frame
      v = await g(s.page);
      check('9:29:30 PM chosen: the movie starts at 9:29:30 PM', shown && v.mode === 'classic' && v.lead === 9030000, JSON.stringify(v));
      await s.page.click('.tab[data-tab="mission"]');
      check('the Mission tab says where the snap lands: 1.668 s after midnight', await shows(s.page, 'ktSnap', /^1\.668 s after midnight$/) && await shows(s.page, 'startTimeLink', /^Start time: 9:29:30 PM · change$/), (await g(s.page)).lands);
      check('and the pre-flight list says the start was chosen by hand', await shows(s.page, 'preflight', /Start time chosen by hand: 9:29:30 PMWith this file the snap lands 1\.668 s after midnight/), (await g(s.page)).preflight.slice(0, 400));

      // The Snap test with that start time says where the snap lands, and the strip shows it.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsLeadSnap', '20');
      await s.page.click('[data-test="snap"]');
      check('Snap test with 9:29:30 PM: it locks on', await waitSynced(s.page, 12000));
      check('its result: the snap came 1.668 s after midnight', await waitFor(s.page, () => /With this start time the snap came 1\.668 s after midnight/.test(document.getElementById('testResults').textContent), null, 60000), await results(s.page));
      check('the strip opens', await stripOpen(s.page, 60000));
      let f = await stripView(s.page);
      const clockAt = await s.page.evaluate(() => { const v = window.__AP.SnapCam.view; const i = Array.from(document.getElementById('stripRow').children).findIndex((b) => b.classList.contains('has-clock')); return i >= 0 ? v.frames[i].t : null; });
      check('it shows the frame on screen at 12:00:00 (2:30:30) and the snap point, 1.67 s later', /^The snap came 1\.6\d\d s after 12:00:00$/.test(f.title) && clockAt != null && Math.abs(clockAt - 9030) < 0.17 &&
        f.tags.includes('now:SNAP POINT') && /This test started the movie at 9:29:30 PM\. At 12:00:00 the film was at 2:30:30\.000/.test(f.note) && /The automatic start, 9:29:28\.332 PM, puts it on 12:00:00/.test(f.note),
        f.title + ' | clock frame ' + clockAt + ' | ' + f.tags.join(',') + ' | ' + f.note.slice(0, 300));
      await shot(s.page, 'starttime-classic-strip');
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);
      check('and the setting is still 9:29:30 PM', (await g(s.page)).mode === 'classic');

      // One's own time, typed without AM/PM: the evening is the reading that fits.
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.fill('#smOwnInput', '9:29:29.5');
      await s.page.press('#smOwnInput', 'Enter');
      v = await g(s.page);
      check('own time 9:29:29.5: the snap lands 1.168 s after midnight', v.mode === 'own' && v.own === 9030.5 && /Starts at 9:29:29\.500 PM: the snap lands 1\.168 s after midnight/.test(v.ownNote), JSON.stringify(v));
      await s.page.click('#smOwnMinus1');
      await s.page.click('#smOwnPlus01');
      v = await g(s.page);
      check('−1 s, then +0.1 s: 9:29:28.600 PM, the snap lands 0.268 s after midnight', v.own === 9031.4 && /Starts at 9:29:28\.600 PM: the snap lands 0\.268 s after midnight/.test(v.ownNote), JSON.stringify(v));
      await s.page.fill('#smOwnInput', '11:59:50 PM');
      await s.page.press('#smOwnInput', 'Enter');
      check('a start ten seconds before midnight is refused', (await g(s.page)).own === 9031.4 && await s.page.evaluate(() => document.getElementById('smOwnInput').classList.contains('bad')));

      // The Snap test can try the automatic start without changing the setting.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsStartMode', 'auto');
      await s.page.click('[data-test="snap"]');
      check('Snap test with the automatic start: the snap frame hits midnight', await waitFor(s.page, () => /PASS · Snap test/.test(document.getElementById('testResults').firstChild.textContent) && /The snap frame hit midnight/.test(document.getElementById('testResults').firstChild.textContent), null, 60000), await results(s.page));
      check('the strip says it landed on 12:00:00', await stripOpen(s.page, 60000) && /^The snap landed on 12:00:00$/.test((await stripView(s.page)).title), (await stripView(s.page) || {}).title);
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);
      check('and one\'s own time is still the one set', (await g(s.page)).mode === 'own' && (await g(s.page)).own === 9031.4);

      // Armed with one's own start time: the countdown counts to it, and it cannot be changed.
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      check('armed with my own start time: nothing is asked, it waits for 9:29:28.6 PM', await waitPhase(s.page, 'standby', 6000) && (await g(s.page)).lead === 9031400, JSON.stringify(await g(s.page)));
      // While armed the start time can still be changed (1.11.0): the countdown follows at once.
      await s.page.click('.tab[data-tab="setup"]');
      check('while armed the start time can still be changed', await s.page.isEnabled('#smClassic') && await s.page.isEnabled('#smOwnInput') && await s.page.isVisible('#smHere'));
      await s.page.click('#smOwnPlus01');
      v = await g(s.page);
      const armedNow = await s.page.evaluate(() => ({ mode: window.__AP.Engine.mode, phase: window.__AP.Engine.phase }));
      check('+0.1 s while armed: the countdown now waits for 9:29:28.7 PM, still armed', v.own === 9031.3 && v.lead === 9031300 && armedNow.mode === 'armed' && armedNow.phase === 'standby', JSON.stringify(Object.assign({ own: v.own, lead: v.lead }, armedNow)));
      await s.page.click('#smOwnMinus01');
      v = await g(s.page);
      check('and −0.1 s puts it back on 9:29:28.6 PM', v.own === 9031.4 && v.lead === 9031400, JSON.stringify({ own: v.own, lead: v.lead }));
      await s.page.click('.tab[data-tab="mission"]');
      await s.page.click('#armBtn');
      await s.page.click('#armBtn');
      check('stopped', await waitFor(s.page, () => window.__AP.Engine.mode === 'free', null, 4000));

      // Back to automatic.
      await s.page.click('.tab[data-tab="setup"]');
      await s.page.check('#smAuto');
      const back = await shows(s.page, 'ktSnap', /Jan 1 · 12:00:00 AM/) && await shows(s.page, 'ktStart', /Dec 31 · 9:29:28\.332 PM/);
      v = await g(s.page);
      check('back to automatic: 9:29:28 PM, the snap on midnight', back && v.mode === 'auto' && v.landsLbl === 'The snap lands on midnight' && v.lead === 9031668, JSON.stringify(v));
      check('one\'s own time is kept for next time', /Your time, 9:29:28\.600 PM, is kept/.test(v.ownNote), v.ownNote);
      await s.page.check('#smOwn');
      check('choosing it again brings it back', (await g(s.page)).mode === 'own' && (await g(s.page)).own === 9031.4);
      // A time typed but not set yet is what a nudge starts from.
      await s.page.fill('#smOwnInput', '9:29:29 PM');
      await s.page.click('#smOwnPlus01');
      v = await g(s.page);
      check('typed 9:29:29 PM, then +0.1 s: 9:29:29.100 PM', v.own === 9030.9 && /Starts at 9:29:29\.100 PM/.test(v.ownNote), JSON.stringify(v));
      await s.page.check('#smAuto');
      // The Doom theme.
      await s.page.click('.tab[data-tab="display"]');
      await s.page.click('#themeGrid .theme[data-id="doom"]');
      check('the Doom theme', await s.page.evaluate(() => document.documentElement.dataset.theme === 'doom' && getComputedStyle(document.documentElement).getPropertyValue('--acc2').trim() === '#1f7a47'));
      await shot(s.page, 'theme-doom');
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async night() {
    // The New Year's Eve simulation: the app's clock on December 31, everything as on the night, no
    // test bar and no result. The screen switches to the film on the very second the countdown ends.
    const ENDGAME = path.join(MEDIA, 'original-length.mp4');
    if (!fs.existsSync(ENDGAME)) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, ENDGAME);
      if (await waitFor(s.page, () => !document.getElementById('modal').hidden && /Finding the snap/.test(document.getElementById('modalTitle').textContent), null, 15000)) {
        await s.page.click('#modalActions button');
        await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 8000);
      }
      await setSnap(s.page, '2:30:31.668');
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      await s.page.click('.tab[data-tab="test"]');
      const look = () => s.page.evaluate(() => {
        const d = new Date(window.__AP.Clock.now());
        return { mon: d.getMonth(), day: d.getDate(), h: d.getHours(), m: d.getMinutes(), hud: !document.getElementById('testHud').hidden, mode: document.getElementById('app').dataset.mode,
          end: !document.getElementById('nightEnd').hidden, label: document.getElementById('stLabel').textContent, results: document.getElementById('testResults').textContent };
      });
      check('the first choice reads “9:29:00 PM: watch it start by itself at 9:29:28.332 PM”', /^9:29:00 PM: watch it start by itself at 9:29:28\.332 PM$/.test(await s.page.$eval('#tsNightAt option[value="start"]', (o) => o.textContent)));
      await s.page.selectOption('#tsNightAt', 'start');
      await s.page.click('[data-test="night"]');
      let v = await look();
      check('the app\'s clock is on December 31, 9:29 PM, with no test bar', v.mon === 11 && v.day === 31 && v.h === 21 && v.m === 29 && !v.hud && v.mode === 'armed' && v.end, JSON.stringify(v));
      check('the standby screen counts down', await waitFor(s.page, () => !document.getElementById('standby').hidden, null, 5000));
      // Every frame through the start.
      const rows = await s.page.evaluate(async () => {
        const { Clock, Engine } = window.__AP;
        const out = [];
        const until = Engine.session.startEpoch + 1500;
        while (Clock.now() < until && out.length < 6000) {
          await new Promise((r) => requestAnimationFrame(r));
          out.push({ now: Clock.now(), standby: !document.getElementById('standby').hidden, count: document.getElementById('sbCount').textContent, phase: Engine.phase, start: Engine.session.startEpoch });
        }
        return out;
      });
      const i = rows.findIndex((r) => !r.standby);
      const at = rows.length ? rows[0].start : 0;
      const whole = Math.floor(at / 1000) * 1000;
      const secs = (txt) => (+txt.slice(0, 2)) * 3600 + (+txt.slice(3, 5)) * 60 + (+txt.slice(6, 8));
      const beforeOk = rows.slice(0, i).filter((r) => r.now < whole - 20).every((r) => r.count.endsWith('.332') && Math.abs(secs(r.count) - Math.ceil((whole - r.now) / 1000)) <= 1);
      const lastOk = rows.slice(0, i).filter((r) => r.now >= whole + 20).every((r) => secs(r.count) === 0 && Math.abs(+r.count.slice(9) - (at - r.now)) < 30);
      check('the countdown\'s seconds go with the clock (.332 after them), the last .332 counts down live, and the movie launches at the exact start', i > 0 && rows[i - 1].now < at && rows[i].now >= at && rows[i].now - at < 50 && /^00:00:00\.\d{3}$/.test(rows[i - 1].count) && beforeOk && lastOk,
        i > 0 ? 'last countdown frame ' + (rows[i - 1].now - at) + ' ms (' + rows[i - 1].count + '), film from ' + (rows[i].now - at) + ' ms after the start' : 'never');
      check('the replay was recording while the movie started', await s.page.evaluate(() => { const r = window.__AP.Replay.rec; return !!(r && r.kind === 'start' && r.started); }));
      check('and the film runs locked to the clock', await waitSynced(s.page, 8000));
      v = await look();
      check('no test result, no pass or fail', /No test run yet/.test(v.results) && /^SIMULATION · /.test(v.label), v.label);
      check('the start time is shown to the millisecond', /Dec 31 · 9:29:28\.332 PM/.test(await s.page.textContent('#ktStart')), await s.page.textContent('#ktStart'));
      await s.page.click('.tab[data-tab="display"]');
      await s.page.click('label:has(#optMs)');
      check('“Show milliseconds” off: 9:29:28 PM', await waitFor(s.page, () => /Dec 31 · 9:29:28 PM/.test(document.getElementById('ktStart').textContent), null, 3000), await s.page.textContent('#ktStart'));
      await s.page.click('label:has(#optMs)');
      await s.page.click('.tab[data-tab="test"]');
      await s.page.click('#nightEnd');
      check('“End the simulation” brings the real clock back', await waitFor(s.page, () => !window.__AP.Engine.test && window.__AP.Clock.testOffsetMs === 0 && window.__AP.Engine.mode === 'free', null, 4000));

      // From 11:59:00 PM: the snap at midnight, the date rolls over, the celebration plays.
      await s.page.selectOption('#tsNightAt', 'snap');
      await s.page.click('[data-test="night"]');
      v = await look();
      check('the app\'s clock is on December 31, 11:59 PM', v.mon === 11 && v.day === 31 && v.h === 23 && v.m === 59 && !v.hud, JSON.stringify(v));
      check('at midnight the target is reached, as on the night', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /Target moment reached/.test(e.text)), null, 80000));
      v = await look();
      check('the date has rolled over to January 1', v.mon === 0 && v.day === 1, JSON.stringify(v));
      check('the Mission card says the snap hit midnight, as on the night', await waitFor(s.page, () => /^SIMULATION · THE SNAP HIT MIDNIGHT$/.test(document.getElementById('stLabel').textContent), null, 3000), await s.page.textContent('#stLabel'));
      check('a rehearsal is not kept as a hit', await s.page.evaluate(() => window.__AP.cfg.madeIt === 0));
      await sleep(1500);
      check('no film strip and no test result after it', !(await s.page.evaluate(() => !!window.__AP.SnapCam.view)) && /No test run yet/.test((await look()).results));
      await s.page.click('#nightEnd');
      check('ended', await waitFor(s.page, () => !window.__AP.Engine.test && window.__AP.Clock.testOffsetMs === 0, null, 4000));

      // The night with the movie starting at 9:29:30 PM (only the simulation uses it).
      await s.page.selectOption('#tsNightStart', 'classic');
      await s.page.selectOption('#tsNightAt', 'start');
      check('with “Start at 9:29:30 PM” the first choice reads “9:29:00 PM: watch it start by itself at 9:29:30 PM”',
        await waitFor(s.page, () => /^9:29:00 PM: watch it start by itself at 9:29:30 PM$/.test(document.querySelector('#tsNightAt option[value="start"]').textContent), null, 3000),
        await s.page.$eval('#tsNightAt option[value="start"]', (o) => o.textContent));
      await s.page.click('[data-test="night"]');
      // The Mission card is redrawn on the next frame, not inside the click.
      await waitFor(s.page, () => /9:29:30/.test(document.getElementById('ktStart').textContent), null, 3000);
      const nv = await s.page.evaluate(() => {
        const { Engine, cfg } = window.__AP;
        const st = new Date(Engine.session.startEpoch);
        return { h: st.getHours(), m: st.getMinutes(), sec: st.getSeconds(), ms: st.getMilliseconds(), mode: cfg.startMode,
          start: document.getElementById('ktStart').textContent, lands: document.getElementById('ktSnap').textContent };
      });
      check('the simulated night starts the movie at 9:29:30.000 PM, and the snap lands 1.668 s after midnight', nv.h === 21 && nv.m === 29 && nv.sec === 30 && nv.ms === 0 &&
        /Dec 31 · 9:29:30 PM/.test(nv.start) && /^1\.668 s after midnight$/.test(nv.lands), JSON.stringify(nv));
      check('it starts by itself at 9:29:30 PM and runs on the clock', await waitSynced(s.page, 45000) &&
        await s.page.evaluate(() => { const { Engine, Clock } = window.__AP; const since = Clock.now() - Engine.session.startEpoch; return since > 0 && since < 3000 && new Date(Engine.session.startEpoch).getSeconds() === 30; }));
      check('the real countdown keeps its own start time', (await s.page.evaluate(() => window.__AP.cfg.startMode)) === 'auto');
      await s.page.click('#nightEnd');
      check('ended again', await waitFor(s.page, () => !window.__AP.Engine.test && window.__AP.Clock.testOffsetMs === 0, null, 4000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async anycopy() {
    // Copies of the film come in any length. A 3:20:00 copy whose snap is four minutes later than in
    // the 2019 film is searched by itself, as far as its extra length reaches; a copy named as the
    // 2019 film is that film, whatever its length.
    const EXTENDED = path.join(MEDIA, 'endgame-extended.mp4');
    const ENCORE = path.join(MEDIA, 'encore-short.mp4');
    if (![EXTENDED, ENCORE].every((f) => fs.existsSync(f))) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const info = (page) => page.evaluate(() => ({ version: window.__AP.cfg.filmVersion, snap: window.__AP.cfg.snapSec, card: document.getElementById('fileMeta').textContent, preflight: document.getElementById('preflight').textContent }));
    const searching = (page, timeout) => waitFor(page, () => !document.getElementById('modal').hidden && /Finding the snap in this film/.test(document.getElementById('modalTitle').textContent), null, timeout || 15000);
    const shows = (page, id, re) => waitFor(page, ({ id, src }) => new RegExp(src).test(document.getElementById(id).textContent), { id, src: re.source }, 5000);
    const dir = newProfile();
    const alias = (file, name) => { const to = path.join(dir, name); try { fs.linkSync(file, to); } catch (e) { fs.copyFileSync(file, to); } return to; };
    const s = await launch(newProfile());
    try {
      // A 3:01:36 file named as a 2019 Blu-ray: the 2019 film, searched by itself. (Skipped at once.)
      await loadMovie(s.page, alias(ENCORE, 'Avengers.Endgame.2019.1080p.BluRay.x264-GROUP.mp4'));
      await sleep(500);
      let v = await info(s.page);
      check('a 3:01:36 copy named as the 2019 film is the 2019 film', v.version === 'original' && /^Endgame · /.test(v.card), v.version + ' | ' + v.card);
      check('and is searched by itself', await searching(s.page));
      await s.page.click('#modalActions button');
      await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 8000);

      // The 3:20:00 copy.
      await loadMovie(s.page, EXTENDED);
      await sleep(500);
      v = await info(s.page);
      check('a 3:20:00 copy is taken for the film', v.version === 'original' && /^Endgame · /.test(v.card), v.version + ' | ' + v.card);
      check('it is searched by itself', await searching(s.page));
      check('the wide search reaches as far as its extra length: to 2:35:30', await waitFor(s.page, () => /Searching from 2:29:45 to 2:35:30/.test(document.getElementById('modalNote').textContent), null, 40000), await s.page.textContent('#modalNote'));
      check('it ends with the film strip', await stripOpen(s.page, 240000));
      const f = await stripView(s.page);
      v = await info(s.page);
      check('the white-out four minutes on is set: 2:34:31.668', Math.abs(v.snap - 9271.668) < 1e-6 && Math.abs(f.selT - 9271.6667) < 0.01, v.snap + ' | ' + f.title);
      check('far from where it was expected and with no subtitles: the strip asks for one look', /^Is this the snap\?$/.test(f.title) && /The snap was not where it was expected/.test(f.note), f.title + ' | ' + f.note.slice(0, 200));
      check('the countdown is calibrated to it: the movie starts at 9:25:28.332 PM', await shows(s.page, 'ktStart', /Dec 31 · 9:25:28\.332 PM/), await s.page.textContent('#ktStart'));
      await s.page.keyboard.press('Escape');
      await stripClosed(s.page);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async latetest() {
    // The late start test: the app's clock past the start time with nothing armed, the real
    // "You are late" box, JOIN NOW, and the film on the clock. Then a minute before midnight: the
    // snap lands after a late join.
    const ENDGAME = path.join(MEDIA, 'original-length.mp4');
    if (!fs.existsSync(ENDGAME)) { console.log('  note  long test clips missing: run scripts/make-test-media.sh'); return; }
    const s = await launch(newProfile());
    try {
      await loadMovie(s.page, ENDGAME);
      if (await waitFor(s.page, () => !document.getElementById('modal').hidden && /Finding the snap/.test(document.getElementById('modalTitle').textContent), null, 15000)) {
        await s.page.click('#modalActions button');
        await waitFor(s.page, () => !window.__AP.SnapCam.busy && document.getElementById('modal').hidden, null, 8000);
      }
      await setSnap(s.page, '2:30:31.668');
      await s.page.evaluate(() => window.__AP.Versions.confirm());
      await s.page.click('.tab[data-tab="test"]');
      const look = () => s.page.evaluate(() => {
        const { Engine, Clock } = window.__AP;
        const g = (id) => document.getElementById(id);
        const d = new Date(Clock.now());
        return {
          mode: Engine.mode, test: Engine.test && Engine.test.kind, joined: !!(Engine.test && Engine.test.joined), h: d.getHours(), m: d.getMinutes(),
          sinceStart: Engine.session ? (Clock.now() - Engine.session.startEpoch) / 1000 : null,
          box: !g('late').hidden, title: g('lateTitle').textContent, body: g('lateBody').textContent,
          hud: !g('testHud').hidden, note: g('thNote').textContent, label: g('stLabel').textContent,
          arm: g('armBtn').textContent, armOff: g('armBtn').disabled, results: g('testResults').textContent
        };
      });
      check('the last choice reads “Join at 11:59:00 PM, watch the snap”', /^Join at 11:59:00 PM, watch the snap$/.test(await s.page.$eval('#tsLateBy option[value="snap"]', (o) => o.textContent)));

      // Five minutes late.
      await s.page.selectOption('#tsLateBy', '300');
      await s.page.click('[data-test="late"]');
      let v = await look();
      check('the app\'s clock is 5 minutes past the start, nothing armed', v.test === 'late' && v.mode === 'free' && !v.joined && Math.abs(v.sinceStart - 300) < 2, JSON.stringify(v));
      check('the real “You are late” box comes up', await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000));
      v = await look();
      // (The film's time on screen changes with the clock's seconds: 5 minutes after 9:29:28.332 PM it reads 0:04:59 until the clock reaches 9:34:29.)
      check('it says the movie should be at 0:04:59 or 0:05:0x', /You are late to the countdown/.test(v.title) && /Right now it should be at 0:0(4:59|5:0\d)\./.test(v.body), v.title + ' | ' + v.body);
      check('the test bar asks for JOIN NOW, the big button joins, the status reads LATE', v.hud && /press JOIN NOW/.test(v.note) && v.arm === 'JOIN THE MOVIE NOW' && !v.armOff && v.label === 'TEST RUN · LATE · NOT ARMED', JSON.stringify(v));
      // Setup is locked while the test runs, as while armed: the real countdown must not change under it.
      await s.page.click('.tab[data-tab="setup"]');
      await sleep(400);
      const lock = await s.page.evaluate(() => ({ off: document.getElementById('snapTools').classList.contains('disabled'), note: document.getElementById('snapArmedNote').textContent, shown: !document.getElementById('snapArmedNote').hidden }));
      await s.page.fill('#snapInput', '2:00:00', { force: true });
      await s.page.press('#snapInput', 'Enter');
      const kept = await s.page.evaluate(() => Math.abs(window.__AP.cfg.snapSec - 9031.668) < 1e-6);
      check('Setup is locked during the test: the snap point stays as it was', lock.off && lock.shown && /End the test run/.test(lock.note) && kept, JSON.stringify(lock) + ' kept=' + kept);
      await s.page.click('.tab[data-tab="test"]');
      await sleep(800);
      await s.page.click('#lateBtn');
      check('JOIN NOW: the film locks onto the clock', await waitSynced(s.page, 10000));
      const m = await measureSync(s.page, 1500);
      check('every frame within 60 ms of the clock after joining', Math.abs(m.worst) < 0.06, ms(m.worst) + ' over ' + m.n + ' frames');
      check('PASS, with where it jumped and how close it landed', await waitFor(s.page, () => /PASS · Late start test · 5 minutes late/.test(document.getElementById('testResults').textContent), null, 15000), (await look()).results.slice(0, 300));
      v = await look();
      check('the result says how it joined', /JOIN NOW at 9:34:\d\d\.\d{3} PM, 5 minutes after the start: the film jumped to 0:05:0\d\.\d{3} and started \d\.\d s later, (right on the clock|\d+ ms (ahead of|behind) the clock)\. Three seconds on it was [+−±]\d+ ms from the clock\./.test(v.results), v.results.slice(0, 400));
      check('the test ends by itself and the real clock is back', await waitFor(s.page, () => !window.__AP.Engine.test && window.__AP.Clock.testOffsetMs === 0 && window.__AP.Engine.mode === 'free', null, 12000));
      check('with the real clock there is no late box', await s.page.evaluate(() => document.getElementById('late').hidden && document.getElementById('latePill').hidden));

      // A minute before midnight, joined with the keyboard: the snap lands on midnight anyway.
      await s.page.selectOption('#tsLateBy', 'snap');
      await s.page.click('[data-test="late"]');
      check('11:59 PM: the late box is up', await waitFor(s.page, () => !document.getElementById('late').hidden, null, 3000));
      v = await look();
      check('the app\'s clock reads 11:59 PM', v.h === 23 && v.m === 59 && v.mode === 'free', JSON.stringify(v));
      await sleep(800);
      await s.page.keyboard.press('Space');
      check('Space joins, and the film locks onto the clock', await waitSynced(s.page, 10000));
      check('midnight comes with the film on the clock', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /Target moment reached/.test(e.text)), null, 80000));
      const party = await s.page.evaluate(() => {
        const { Engine, Celebration } = window.__AP;
        return { fx: !!(Celebration.fx && Celebration.fx.running), banner: !document.getElementById('banner').hidden, test: !!Engine.test, ev: Engine.events.slice(-4).map((e) => e.text) };
      });
      check('the celebration plays, the test still running', (party.fx || party.banner) && party.test, JSON.stringify(party));
      // (A result goes into the list when its test ends, after the celebration.)
      check('the snap frame hits midnight after the late join', await waitFor(s.page, () => /PASS · Late start test · join a minute before midnight/.test(document.getElementById('testResults').textContent) && /The snap frame hit midnight/.test(document.getElementById('testResults').textContent), null, 30000), (await look()).results.slice(0, 400));
      check('and the test ends by itself', await waitFor(s.page, () => !window.__AP.Engine.test && window.__AP.Clock.testOffsetMs === 0, null, 30000));
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally { await s.close(); }
  },

  async powerearly() {
    // The PC goes off before the movie has started: when it is back on, the countdown simply carries on.
    const profile = newProfile();
    let s = await launch(profile);
    try {
      await loadMovie(s.page, MOVIE);
      await setSnap(s.page, SNAP);
      await armIn(s.page, 60);
      check('armed, waiting for the start', await waitPhase(s.page, 'standby', 10000));
      const start = await s.page.evaluate(() => window.__AP.Engine.session.startEpoch);
      const pid = s.app.process().pid;
      const rows = execSync('ps -eo pid=,ppid=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
      const all = [pid];
      for (let i = 0; i < all.length; i++) for (const [c, pp] of rows) if (pp === all[i]) all.push(c);
      for (const p of all.reverse()) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* gone */ } }
      await sleep(3000);
      s = await launch(profile, { AP_BOOTED_AT: String(Date.now()) });
      check('back on: still armed, waiting for the same start', await waitPhase(s.page, 'standby', 20000) && await s.page.evaluate((t) => window.__AP.cfg.armed && window.__AP.Engine.session.startEpoch === t, start));
      check('it says the countdown is still armed', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /^Back after the PC went off: the countdown is still armed and the movie starts at \d+:\d\d:\d\d(\.\d{3})? [AP]M\.$/.test(e.text)), null, 10000),
        (await s.page.evaluate(() => window.__AP.Engine.events.map((e) => e.text).filter((t) => /Back after/.test(t)).join(' | '))) || 'nothing said');
      // A minute before the start the power cut test and the crash drill are refused: the app would be off then.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.click('#powerBtn');
      await s.page.click('#crashBtn');
      const said = await s.page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent).join(' | '));
      await sleep(1500);
      check('a minute before the start both drills are refused, and the app stays up', (said.match(/Too close to the start or the snap/g) || []).length === 2 && await s.page.evaluate(() => window.__AP.Engine.mode === 'armed'), said);
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally {
      await Promise.race([s.close(), sleep(15000)]);
      try { execSync('pkill -9 -f ' + JSON.stringify(profile) + ' || true'); } catch (e) { /* nothing left */ }
    }
  },

  async restartmanager() {
    // An installer's Restart Manager closes the app ('close-app') while the session goes on: that is
    // not a shutdown, so the crash watchdog must bring the app back at once.
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
      const mark = readLog().length;
      await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('session-end', { reasons: ['close-app'], preventDefault() {} }));
      process.kill(s.app.process().pid, 'SIGKILL');          // Windows ends the process (the watchdog lives on)
      let tail = '';
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await sleep(500);
        tail = readLog().slice(mark);
        if (/Locked on: started/.test(tail)) break;
      }
      check('a Restart Manager close is logged as such, with no session-end marker', /closed by the Windows Restart Manager \(an installer\): the crash watchdog brings the app back/.test(tail) && !fs.existsSync(path.join(profile, 'session-end')), tail.split('\n')[0]);
      check('the crash watchdog brings the app back and it locks onto the clock', /restarted by the crash watchdog/.test(tail) && /Locked on: started/.test(tail));
      newPid = +(/ pid (\d+) \(restarted/.exec(tail) || [])[1] || null;
    } finally {
      try { fs.writeFileSync(path.join(profile, 'clean-exit'), 'test'); } catch (e) { /* profile gone */ }
      if (newPid) { try { process.kill(newPid, 'SIGKILL'); } catch (e) { /* already gone */ } }
      await Promise.race([s.close(), sleep(15000)]);
      try { execSync('pkill -9 -f ' + JSON.stringify(profile) + ' || true'); } catch (e) { /* nothing left */ }
    }
  },

  async powercut() {
    // The PC goes off with the countdown armed: a power cut, an empty battery, the power button held.
    // Every process of the app dies at once, the crash watchdog with it, and nothing is saved on the
    // way out. Then the PC is "turned back on": the app is started the way Windows starts it at
    // sign-in, with no arguments, and has to pick up where the clock says.
    const profile = newProfile();
    const logFile = path.join(profile, 'avengers-player.log');
    const readLog = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch (e) { return ''; } };
    const cutPower = (app) => {
      let pid = 0;
      try { pid = app.process().pid; } catch (e) { return 0; }      // already gone (closed by the end of the session)
      const rows = execSync('ps -eo pid=,ppid=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
      const all = [pid];
      for (let i = 0; i < all.length; i++) for (const [c, pp] of rows) if (pp === all[i]) all.push(c);
      for (const p of all.reverse()) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* gone */ } }
      return all.length;
    };
    const events = (page) => page.evaluate(() => window.__AP.Engine.events.map((e) => e.text).join('\n'));
    // A half-hour clip with the snap at 25:00: the power cut test is refused within two minutes of
    // the snap, so the snap has to be far away for the whole scenario.
    const CLIP = path.join(MEDIA, 'talk-long.mp4');
    let s = await launch(profile);
    let drillPid = null;
    try {
      await loadMovie(s.page, CLIP);
      await setSnap(s.page, '0:25:00');
      await s.page.evaluate(() => {
        const { cfg, Engine } = window.__AP;
        const d = new Date(Date.now() + (1500 - 30) * 1000);       // the movie started 30 s ago
        const pad = (n) => String(n).padStart(2, '0');
        cfg.targetMode = 'custom';
        cfg.customTarget = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        Engine.session = Engine.computeFree();
      });
      await s.page.click('#armBtn');
      await startAnyway(s.page);
      check('armed and playing in sync', await waitSynced(s.page, 10000));
      await sleep(1500);
      const before = await state(s.page);
      check('while armed the app writes down that it is running', fs.existsSync(path.join(profile, 'alive')));
      const n = cutPower(s.app);
      check('power cut: every process of the app gone at once, the watchdog too', n >= 2, n + ' processes');
      const cutAt = Date.now();
      await sleep(4000);                                   // the PC is off
      check('nothing brought the app back while the PC was off', !/\[watchdog\] the app disappeared/.test(readLog()));

      // 1. Back on: started as at sign-in. (The PC "started" after the cut: the tests cannot restart it.)
      s = await launch(profile, { AP_BOOTED_AT: String(Date.now()) });
      check('back on: the countdown is armed again and the film locks onto the clock by itself', await waitSynced(s.page, 20000) && (await state(s.page)).armed);
      const after = await state(s.page);
      const lost = (Date.now() - cutAt) / 1000;
      check('the film is where the clock says, not where it stopped', Math.abs(after.t - after.expected) < 0.12 && after.t > before.t + 4, 'was at ' + before.t.toFixed(1) + ' s, now ' + after.t.toFixed(1) + ' s (' + lost.toFixed(1) + ' s later)');
      const sm = await measureSync(s.page, 1500);
      check('every frame within 60 ms of the clock', Math.abs(sm.worst) < 0.06, ms(sm.worst) + ' over ' + sm.n + ' frames');
      check('the log says how the last run ended: cut off', /the last run did not end on purpose \(cut\)/.test(readLog()));
      let ev = await events(s.page);
      check('it says so: “Back after the PC went off … the movie is at …, where the clock says”', /Back after the PC went off \(a power cut, an empty battery or the power button\): the movie is at 0:0\d:\d\d, where the clock says\./.test(ev) && /In sync at [\d:]+ \(resume\)/.test(ev), (ev.match(/Back after[^\n]*/) || [''])[0]);
      // Had the PC kept running (the app ended from Task Manager), it would not say the PC went off.
      const killedText = await s.page.evaluate(() => {
        const R = window.__AP.Recovery;
        const keep = { claimed: R.claimed, said: R.said };
        R.claimed = { ended: 'killed', lastAlive: Date.now() - 5000 }; R.said = false;
        R.resumed({ pos: 61 });
        Object.assign(R, keep);
        const t = Array.from(document.querySelectorAll('#toasts .toast')).map((x) => x.textContent);
        return t[t.length - 1] || '';
      });
      check('an app killed while the PC kept running: “Back after the app was closed without warning”', /^Back after the app was closed without warning: the movie is at 0:01:01, where the clock says\.$/.test(killedText), killedText);

      // 2. The PC wakes up from sleep: straight back on the clock, no out-of-sync box.
      await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('power:event', { type: 'resume' }));
      check('waking up from sleep re-cues the film at once', await waitFor(s.page, () => window.__AP.Engine.events.some((e) => /In sync at .* \(wake\)/.test(e.text)), null, 6000));
      check('and it is locked to the clock again', await waitSynced(s.page, 8000) && (await state(s.page)).phase === 'synced');

      // 3. Unplugged, battery running low: said while armed.
      await s.page.evaluate(() => { const P = window.__AP.Power; P.battery = { charging: false, level: 0.09, addEventListener() {} }; P.check(); });
      const toasts = await s.page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent).join(' | '));
      check('on the battery: “plug it in”, and “Battery at 9%”', /running on its battery \(9%\): plug it in/.test(toasts) && /Battery at 9%: plug the PC in now/.test(toasts), toasts);
      check('the pre-flight list says it too', await waitFor(s.page, () => /Running on the battery \(9%\)/.test(document.getElementById('preflight').textContent), null, 3000));
      await s.page.evaluate(() => { const P = window.__AP.Power; P.battery = { charging: true, level: 0.1, addEventListener() {} }; P.check(); });
      check('plugged in again', await waitFor(s.page, () => /Plugged in/.test(document.getElementById('preflight').textContent), null, 3000));
      // Windows saying so (the main process's power events) counts as well.
      const send = (type) => s.app.evaluate(({ BrowserWindow }, t) => BrowserWindow.getAllWindows()[0].webContents.send('power:event', { type: t }), type);
      await send('on-battery');
      check('Windows says "on battery": said while armed', await waitFor(s.page, () => /running on its battery \(10%\)/.test(document.getElementById('toasts').textContent) && /Running on the battery/.test(document.getElementById('preflight').textContent), null, 3000));
      await send('on-ac');
      check('and "plugged in"', await waitFor(s.page, () => /Plugged in/.test(document.getElementById('preflight').textContent), null, 3000));

      // 4. Windows shuts down with the app open (the window's own 'session-end' event, then it closes),
      //    and the settings file did not survive whole.
      const logMark = readLog().length;
      await s.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.emit('session-end', { reasons: ['shutdown'], preventDefault() {} }); w.close(); });
      await sleep(2500);
      const shutLog = readLog().slice(logMark);
      check('Windows ending the session: marked, not taken for a quit, the start-at-login entry left in place', fs.existsSync(path.join(profile, 'session-end')) && !fs.existsSync(path.join(profile, 'clean-exit')) &&
        /Windows is ending the session \(shutdown\): the countdown is armed and comes back at the next sign-in/.test(shutLog) && /window closed by the end of the Windows session/.test(shutLog), shutLog.split('\n').slice(0, 4).join(' / '));
      check('and the crash watchdog does not start the app into a session that is ending', !/\[watchdog\] the app disappeared/.test(shutLog));
      cutPower(s.app);
      const f = path.join(profile, 'settings.json');
      fs.writeFileSync(f, Buffer.alloc(fs.statSync(f).size));      // zeroed, as a power cut can leave a file
      await sleep(2500);
      s = await launch(profile);
      check('a zeroed settings file: the backup is used and the countdown comes back armed', await waitSynced(s.page, 20000) && (await state(s.page)).armed);
      ev = await events(s.page);
      check('after a shutdown it says “Back after Windows was shut down, restarted or signed out”', /Back after Windows was shut down, restarted or signed out: the movie is at [\d:]+, where the clock says\./.test(ev), (ev.match(/Back after[^\n]*/) || [''])[0]);

      // 5. The power cut test in the Test tab: the app cuts itself off and the helper starts it as at sign-in.
      await s.page.click('.tab[data-tab="test"]');
      await s.page.selectOption('#tsPowerOff', '10');
      const mark = readLog().length;
      await s.page.click('#powerBtn');
      let tail = '';
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await sleep(500);
        tail = readLog().slice(mark);
        if (/Power cut test (passed|failed)/.test(tail)) break;
      }
      check('the button cuts the whole app off', /power cut test: cutting the app off for 10 s/.test(tail));
      check('nothing comes back for 10 s, then it is started as at sign-in', /\[watchdog\] power cut test: the PC is "back on"/.test(tail) && !/restarted by the crash watchdog/.test(tail));
      const offFor = (() => {
        const a = (tail.match(/^(\S+) \[watchdog\] power cut test: the app is off/m) || [])[1];
        const b = (tail.match(/^(\S+) \[watchdog\] power cut test: the PC is "back on"/m) || [])[1];
        return a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : NaN;
      })();
      check('it stayed off for the 10 s chosen', offFor >= 9.5 && offFor < 11.5, offFor.toFixed(1) + ' s');
      check('the new instance imported the movie and resumed on the clock', /Movie loaded: talk-long\.mp4/.test(tail) && /In sync at [\d:]+ \(resume\)/.test(tail));
      check('the power cut test passed: back on the clock', /Power cut test passed: The app was cut off at .* with nothing saved on the way out, and started again 1\d s later the way Windows starts it when the PC is back on\. It imported the movie by itself and put it at 0:0\d:\d\d\.\d{3}, .*the clock: \d+ s after the cut the film was running on the clock again; three seconds on it was [+−±]\d+ ms from the clock\./.test(tail), (tail.match(/Power cut test (passed|failed)[^\n]*/) || ['no result'])[0]);
      drillPid = +(/ pid (\d+)\n/.exec(tail.slice(tail.indexOf('the PC is "back on"'))) || [])[1] || null;
      check('no page errors', s.errors.length === 0, s.errors.join(' | '));
    } finally {
      // A deliberate exit first (the watchdog then stays quiet), then whatever the drill started.
      await Promise.race([s.close(), sleep(15000)]);
      try { fs.writeFileSync(path.join(profile, 'clean-exit'), 'test'); } catch (e) { /* profile gone */ }
      if (drillPid) { try { process.kill(drillPid, 'SIGKILL'); } catch (e) { /* already gone */ } }
      try { execSync('pkill -9 -f ' + JSON.stringify(profile) + ' || true'); } catch (e) { /* nothing left */ }
    }
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
