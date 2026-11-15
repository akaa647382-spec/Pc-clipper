// Diagnostic: how long after a seek is the pipeline really ready, and how late does play() start?
import path from 'node:path';
import { ensureDisplay, newProfile, launch, loadMovie, sleep, MEDIA } from './harness.mjs';
ensureDisplay(import.meta.url);
const s = await launch(newProfile());
try {
  await loadMovie(s.page, path.join(MEDIA, 'movie.mp4'));
  const rows = await s.page.evaluate(async () => {
    const v = document.getElementById('video');
    const out = [];
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const hold of [0, 100, 250, 500, 1000, 2000, 250, 250]) {
      const pos = 20 + Math.random() * 150;
      v.pause();
      const t0 = performance.now();
      await new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = pos; });
      const seekMs = performance.now() - t0;
      const rsAtSeeked = v.readyState;
      let enoughMs = null;
      const tR = performance.now();
      while (performance.now() - tR < hold) { if (enoughMs == null && v.readyState >= 4) enoughMs = performance.now() - tR; await sleep(5); }
      const rsAtPlay = v.readyState;
      const p0 = performance.now();
      const base = v.currentTime;
      // latency = how far the media clock lags behind "started exactly at play()"
      const lat = await new Promise((res) => {
        let n = 0; const samples = [];
        const cb = (now, meta) => {
          if (meta.mediaTime > base + 0.001) { samples.push((meta.expectedDisplayTime - p0) / 1000 - (meta.mediaTime - base)); n++; }
          if (n >= 12) res(samples); else v.requestVideoFrameCallback(cb);
        };
        v.requestVideoFrameCallback(cb);
        v.play();
      });
      lat.sort((a, b) => a - b);
      out.push({ hold, seekMs: Math.round(seekMs), rsAtSeeked, enoughMs: enoughMs == null ? null : Math.round(enoughMs), rsAtPlay, latMedianMs: Math.round(lat[lat.length >> 1] * 1000), latMinMs: Math.round(lat[0] * 1000), latMaxMs: Math.round(lat[lat.length - 1] * 1000) });
      await sleep(600);
    }
    return out;
  });
  console.table(rows);
} finally { await s.close(); }
