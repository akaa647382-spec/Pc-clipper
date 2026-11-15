// Takes the README screenshot: the player armed and in sync shortly before midnight on December 31.
import path from 'node:path';
import fs from 'node:fs';
import { ensureDisplay, ensureMedia, newProfile, launch, loadMovie, sleep, MEDIA, ROOT } from './harness.mjs';
ensureDisplay(import.meta.url);
ensureMedia();
const s = await launch(newProfile());
try {
  await loadMovie(s.page, path.join(MEDIA, 'movie.mp4'));
  await s.page.evaluate(() => {
    const { Clock, Engine, cfg } = window.__AP;
    cfg.snapSec = 100;
    const year = new Date().getFullYear();
    const midnight = new Date(year + 1, 0, 1).getTime();
    Clock.testOffsetMs = midnight - 72000 - Date.now();      // pretend it is 11:58:48 PM on December 31
    Engine.session = Engine.computeFree();
  });
  await s.page.click('#armBtn');
  await s.page.waitForFunction(() => window.__AP.Engine.phase === 'synced' && window.__AP.Engine.st.drift != null, null, { timeout: 15000 });
  await sleep(2500);
  await s.page.mouse.move(900, 300);
  await sleep(300);
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  await s.page.screenshot({ path: path.join(ROOT, 'docs', 'player.png') });
  console.log('saved docs/player.png');
} finally {
  await s.close();
}
