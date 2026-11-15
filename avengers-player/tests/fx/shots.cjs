// Renders reproducible frames of the celebration for a visual check, and measures real-time frame cost.
//   node tests/fx/shots.cjs            screenshots -> tests/artifacts/fx/
//   node tests/fx/shots.cjs --perf     also run each style in real time and report frame times
const path = require('node:path');
const fs = require('node:fs');
let pw;
for (const c of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node-tools/node_modules/playwright'].filter(Boolean)) { try { pw = require(c); break; } catch (e) { /* next */ } }
const out = path.join(__dirname, '..', 'artifacts', 'fx');
fs.mkdirSync(out, { recursive: true });
const url = 'file://' + path.join(__dirname, 'demo.html');
const TIMES = [150, 900, 1700, 2500, 5000, 8000, 9600, 10600, 12000];
(async () => {
  const browser = await pw.chromium.launch();
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url);
    await page.addStyleTag({ content: '#bar{display:none}' });
    for (const style of ['stark', 'fireworks']) {
      await page.evaluate((style) => { demo.fx.play({ style, title: 'HAPPY NEW YEAR', year: '2027', seed: 7 }); }, style);
      for (const t of TIMES) {
        await page.evaluate((t) => demo.fx.renderAt(t), t);
        await page.screenshot({ path: path.join(out, `${style}-${h}p-${String(t).padStart(5, '0')}.png`) });
      }
      const same = await page.evaluate(() => {
        const c = document.getElementById('fx');
        const grab = () => { demo.fx.renderAt(5000); return c.toDataURL(); };
        return grab() === grab();
      });
      const clearAtEnd = await page.evaluate((style) => {
        demo.fx.renderAt(APFx.duration(style) + 50);
        const c = document.getElementById('fx');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 2) lit++;
        return lit;
      }, style);
      console.log(`${style} ${w}x${h}: same seed -> identical frame: ${same}; lit pixels after the end: ${clearAtEnd}; errors: ${errors.length ? errors.join(' | ') : 'none'}`);
      await page.evaluate(() => demo.fx.stop());
    }
    if (process.argv.includes('--perf') && w === 1920) {
      for (const style of ['stark', 'fireworks']) {
        const r = await page.evaluate((style) => new Promise((res) => {
          const times = [];
          let last = performance.now();
          let done = false;
          demo.fx.onDone = () => { done = true; };
          demo.fx.play({ style, title: 'HAPPY NEW YEAR', year: '2027' });
          const tick = (ts) => {
            times.push(ts - last); last = ts;
            if (!done) requestAnimationFrame(tick);
            else { times.sort((a, b) => a - b); res({ frames: times.length, avg: times.reduce((a, b) => a + b, 0) / times.length, p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], peak: demo.fx.peakParticles }); }
          };
          requestAnimationFrame(tick);
        }), style);
        console.log(`perf ${style}: ${r.frames} frames, avg ${r.avg.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, max ${r.max.toFixed(1)} ms, peak particles ${r.peak}`);
      }
    }
    await page.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
