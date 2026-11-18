/*!
 * Avengers Player: the celebration that plays at the instant of the snap.
 *
 * It draws on a transparent canvas lying over the movie, so it never paints a backdrop: every
 * frame starts from a clear canvas and only adds light.
 *
 *   'stark'      golden dust sweeps in and assembles into the words (the film's dust effect in
 *                reverse), shimmers while red and gold fireworks bloom in the top corners, then
 *                blows away as dust again.
 *   'fireworks'  classic multicolour fireworks with a gold title.
 *
 * More styles come from their own files (src/fx-*.js), registered with
 *   APFx.register(id, { duration, name, create(env) -> { step(dt, t), draw(t) -> particles drawn } })
 * where env gives the canvas (already cleared and scaled to CSS pixels), the size, a seeded random,
 * where the words sit, the words themselves ready to stamp, points on the words, glow sprites and
 * whether the PC is struggling (draw less then). See makeEnv below.
 *
 * Every frame has to fit in 1/60 s on a big screen: nothing may draw text or blurred shadows per
 * frame (the words are drawn once and stamped), and the canvas never holds more than about 4.2
 * million pixels (the browser scales it up on a bigger screen).
 *
 * window.APFx.create(canvas) -> { resize, play, stop, running, onDone, renderAt }
 */
(function (root) {
  'use strict';

  const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif';
  const DURATION = { stark: 12800, fireworks: 12000 };
  const STYLES = Object.create(null);          // registered styles (src/fx-*.js)
  const PIXEL_BUDGET = 4.2e6;                  // most canvas pixels filled per frame
  const GOLD = { stops: [[0, '#fff3c4'], [0.45, '#ffc94a'], [1, '#e8871e']], halo: 'rgba(0,0,0,0.85)' };
  const STARK = {
    assembleEnd: 2400,      // words fully formed
    holdEnd: 8400,          // start blowing away
    sweep: 1500,            // the disintegration wave crosses the words in this time
    fly: 2100               // how long one grain takes to fade once released
  };
  // gold, deep gold, ember, hot-rod red, arc-reactor cyan
  const DUST_COLORS = ['#ffe2a0', '#f9b233', '#ff8a2a', '#ff4d4d', '#8fefff'];
  const DUST_WEIGHTS = [0.44, 0.27, 0.15, 0.08, 0.06];

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A soft round glow, pre-rendered once per colour so particles can be stamped cheaply. */
  function makeSprite(color) {
    const size = 32;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.9;
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function create(canvas) {
    const ctx = canvas.getContext('2d');
    let W = 0;
    let H = 0;
    let DPR = 1;
    let running = false;
    let raf = 0;
    let startTs = 0;
    let lastTs = 0;
    let opts = null;
    let rnd = Math.random;
    let simple = false;
    let layout = null;       // where the words sit
    let dust = null;         // the grains that form the words
    let rockets = [];
    let sparks = [];
    let flashes = [];
    let nextRocket = 0;
    let rocketSide = 0;
    let sprites = null;
    let peak = 0;
    let low = false;         // the PC cannot keep 60 frames a second: the soft glow is dropped
    let slowFor = 0;         // how long frames have been taking longer than a 60 Hz screen allows (s)
    let custom = null;       // the running instance of a registered style
    let wordsCache = Object.create(null);    // these three are kept until the size changes:
    let sampleCache = Object.create(null);   // prime() fills them before midnight, so the first
    let pointCache = Object.create(null);    // frame of the animation has nothing slow left to do
    const spriteCache = Object.create(null);

    const api = {
      onDone: null,
      get running() { return running; },
      get peakParticles() { return peak; },
      resize: resize,
      prime: prime,
      play: play,
      stop: stop,
      renderAt: renderAt
    };

    function resize(cssW, cssH, dpr) {
      const w = Math.max(0, Math.floor(cssW || 0));
      const h = Math.max(0, Math.floor(cssH || 0));
      const d0 = clamp(dpr || 1, 1, 2);
      // A big monitor at full sharpness has more pixels than a frame can fill in 1/60 s: the canvas
      // keeps to PIXEL_BUDGET and the browser scales it up (soft light does not need more).
      const d = w * h * d0 * d0 > PIXEL_BUDGET ? Math.max(0.5, Math.sqrt(PIXEL_BUDGET / Math.max(1, w * h))) : d0;
      if (w === W && h === H && d === DPR) return;
      W = w; H = h; DPR = d;
      wordsCache = Object.create(null);
      sampleCache = Object.create(null);
      pointCache = Object.create(null);
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      if (opts) prepare();                     // mid-animation: lay the words out again for the new size
      else clear();
    }

    function clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /* ---------------------------------------------------------- layout --- */

    function font(size) { return '800 ' + size + 'px ' + FONT; }

    /** Draws one line with wide letter spacing, centred on (cx, cy). Returns its width. */
    function drawLine(g, text, size, cx, cy, draw) {
      g.font = font(size);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const gap = size * 0.14;
      const widths = [];
      let total = 0;
      for (const ch of text) { const w = g.measureText(ch).width; widths.push(w); total += w + gap; }
      total -= gap;
      if (draw) {
        let x = cx - total / 2;
        let i = 0;
        for (const ch of text) { draw(ch, x, cy); x += widths[i++] + gap; }
      }
      return total;
    }

    function computeLayout() {
      const title = String(opts.title || '').toUpperCase();
      const year = String(opts.year || '');
      const probe = ctx;
      probe.save();
      probe.setTransform(1, 0, 0, 1, 0, 0);
      let titleSize = clamp(H * (year ? 0.09 : 0.12), 12, 400);
      const fit = (text, size) => {
        const w = drawLine(probe, text, size, 0, 0, null);
        return w > W * 0.88 ? size * (W * 0.88) / w : size;
      };
      titleSize = fit(title, titleSize);
      let yearSize = year ? fit(year, clamp(titleSize * 2.2, 12, H * 0.22)) : 0;
      probe.restore();
      const gap = titleSize * 0.42;
      const blockH = titleSize + (year ? gap + yearSize : 0);
      const top = H * 0.705 - blockH / 2;                // lower middle of the frame
      return {
        title: title, year: year, titleSize: titleSize, yearSize: yearSize,
        titleY: top + titleSize / 2,
        yearY: top + titleSize + gap + yearSize / 2,
        top: top - titleSize * 0.2, bottom: top + blockH + titleSize * 0.2,
        cx: W / 2
      };
    }

    function drawWords(g, L, fill) {
      drawLine(g, L.title, L.titleSize, L.cx, L.titleY, fill);
      if (L.year) drawLine(g, L.year, L.yearSize, L.cx, L.yearY, fill);
    }

    /** Rasterises the words and returns one target point per grid cell they cover. */
    function sampleTargets(L, want) {
      const key = W + 'x' + H + '|' + L.title + '|' + L.year + '|' + (want || 0);
      return sampleCache[key] || (sampleCache[key] = sampleTargetsNow(L, want));
    }

    function sampleTargetsNow(L, want) {
      const bandTop = Math.max(0, Math.floor(L.top));
      const bandH = Math.max(1, Math.min(H, Math.ceil(L.bottom)) - bandTop);
      const off = document.createElement('canvas');
      off.width = Math.max(1, W);
      off.height = bandH;
      const g = off.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff';
      g.translate(0, -bandTop);
      drawWords(g, L, (ch, x, y) => g.fillText(ch, x, y));
      let data;
      try { data = g.getImageData(0, 0, off.width, off.height).data; } catch (e) { return { pts: [], step: 3, minX: 0, maxX: W }; }
      // Aim for roughly the same number of grains at every resolution.
      const budget = want || clamp(Math.round((W * H) / 640), 900, 4200);
      let step = Math.max(2, Math.round(Math.min(W / 1920, H / 1080) * 3.4));
      let pts = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        pts = [];
        for (let y = step >> 1; y < off.height; y += step) {
          for (let x = step >> 1; x < off.width; x += step) {
            if (data[(y * off.width + x) * 4 + 3] > 110) pts.push(x, y + bandTop);
          }
        }
        if (pts.length / 2 <= budget) break;
        step++;
      }
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < pts.length; i += 2) { if (pts[i] < minX) minX = pts[i]; if (pts[i] > maxX) maxX = pts[i]; }
      return { pts: pts, step: step, minX: isFinite(minX) ? minX : 0, maxX: isFinite(maxX) ? maxX : W };
    }

    /** A soft round glow in this colour (cached). */
    function sprite(color) {
      return spriteCache[color] || (spriteCache[color] = makeSprite(color));
    }

    /**
     * Everything a registered style gets. Its ctx is already cleared and scaled to CSS pixels; it
     * draws with W x H in mind and keeps to light (the movie is under the canvas).
     */
    function makeEnv() {
      const seed = opts.seed == null ? 20270101 : opts.seed;
      return {
        ctx: ctx, W: W, H: H, dpr: DPR,
        scale: Math.max(0.3, Math.min(W / 1920, H / 1080)),
        layout: layout,                       // { title, year, titleSize, yearSize, titleY, yearY, top, bottom, cx }
        rnd: mulberry32(seed ^ 0x51ED270B),   // the same seed draws the same animation
        // The words, stamped from a ready-made picture: fill { stops: [[0, '#fff'], [1, '#08f']], halo: 'rgba(0,0,0,.85)' }.
        words: (alpha, fill, scaleUp) => stampWords(alpha, scaleUp == null ? 1 : scaleUp, fill || GOLD),
        // Points on the words (x, y pairs), at most `budget` of them, for particles that form the words.
        wordPoints: (budget) => {
          const b = Math.round(clamp(budget || 2000, 200, 5000));
          const key = b + '|' + layout.title + '|' + layout.year;
          if (!pointCache[key]) { const s = sampleTargets(layout, b); pointCache[key] = { pts: Float32Array.from(s.pts), step: s.step, minX: s.minX, maxX: s.maxX }; }
          return pointCache[key];
        },
        sprite: sprite,
        low: () => low,                       // true once the PC cannot keep 60 frames a second: draw less
        clamp: clamp, lerp: lerp, smooth: smooth, easeOut: easeOut, easeIn: easeIn, mulberry32: mulberry32
      };
    }

    function prepare() {
      if (!opts || W < 8 || H < 8) { layout = null; dust = null; custom = null; return; }
      layout = computeLayout();
      dust = null;
      custom = null;
      if (STYLES[opts.style]) { custom = STYLES[opts.style].create(makeEnv()) || null; return; }
      if (simple || opts.style !== 'stark') return;
      // The same seed always lays out the same dust, whatever happened before.
      const r = mulberry32((opts.seed == null ? 20270101 : opts.seed) ^ 0x9E3779B9);
      const s = sampleTargets(layout);
      const n = s.pts.length / 2;
      const d = {
        n: n, step: s.step, minX: s.minX, span: Math.max(1, s.maxX - s.minX),
        tx: new Float32Array(n), ty: new Float32Array(n), sx: new Float32Array(n), sy: new Float32Array(n),
        delay: new Float32Array(n), dur: new Float32Array(n), ph: new Float32Array(n), amp: new Float32Array(n),
        size: new Float32Array(n), col: new Uint8Array(n), out: new Float32Array(n), fx: new Float32Array(n), fy: new Float32Array(n),
        order: []
      };
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      for (let i = 0; i < n; i++) {
        const tx = s.pts[i * 2] + (r() - 0.5) * s.step * 0.5;
        const ty = s.pts[i * 2 + 1] + (r() - 0.5) * s.step * 0.5;
        const along = (tx - d.minX) / d.span;
        d.tx[i] = tx;
        d.ty[i] = ty;
        // Blown in from the left on a rising, spreading wind.
        d.sx[i] = -W * (0.05 + r() * 0.5);
        d.sy[i] = ty + (r() - 0.35) * H * 0.75;
        d.delay[i] = 120 + along * 760 + r() * 520;
        d.dur[i] = 880 + r() * 620;
        d.ph[i] = r() * Math.PI * 2;
        d.amp[i] = (20 + r() * 90) * scale;
        d.size[i] = s.step * (0.62 + r() * 0.5);
        let pick = r();
        let c = 0;
        while (c < DUST_WEIGHTS.length - 1 && pick > DUST_WEIGHTS[c]) { pick -= DUST_WEIGHTS[c]; c++; }
        d.col[i] = c;
        d.out[i] = along * STARK.sweep + r() * 320;
        d.fx[i] = W * (0.16 + r() * 0.3);
        d.fy[i] = H * (0.03 + r() * 0.16);
      }
      for (let c = 0; c < DUST_COLORS.length; c++) {
        const list = [];
        for (let i = 0; i < n; i++) if (d.col[i] === c) list.push(i);
        d.order.push(list);
      }
      dust = d;
      if (!sprites) sprites = DUST_COLORS.map(makeSprite);
    }

    /* ------------------------------------------------------- fireworks --- */

    function resetSim() {
      rnd = opts && opts.seed != null ? mulberry32(opts.seed) : Math.random;
      rockets = [];
      sparks = [];
      flashes = [];
      nextRocket = opts && opts.style === 'stark' ? STARK.assembleEnd + 150 : 0;
      rocketSide = 0;
      peak = 0;
    }

    function launch(t) {
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      const stark = opts.style === 'stark';
      let x;
      let ty;
      if (stark) {
        // Top corners only: the words and the middle of the picture stay clear.
        const left = (rocketSide++ % 2) === 0;
        x = W * (left ? 0.07 + rnd() * 0.2 : 0.73 + rnd() * 0.2);
        ty = H * (0.1 + rnd() * 0.24);
      } else {
        x = W * (0.1 + rnd() * 0.8);
        ty = H * (0.1 + rnd() * 0.38);
      }
      const hue = stark ? [44, 36, 18, 2, 48][(rnd() * 5) | 0] : (rnd() * 360) | 0;
      const flight = 0.55 + rnd() * 0.25;
      rockets.push({ x: x + (rnd() - 0.5) * 60 * scale, y: H + 10, tx: x, ty: ty, t: 0, flight: flight, hue: hue, sat: stark && hue === 48 ? 30 : 100 });
    }

    function burst(rk) {
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      const count = Math.round((110 + rnd() * 70) * clamp(Math.sqrt(scale), 0.6, 1.3));
      const power = (330 + rnd() * 230) * scale;
      const ring = rnd() < 0.3;
      for (let i = 0; i < count && sparks.length < 1800; i++) {
        const a = rnd() * Math.PI * 2;
        const v = power * (ring ? 0.9 + rnd() * 0.12 : Math.sqrt(0.08 + rnd() * 0.92));
        const life = 1.3 + rnd() * 1.0;
        sparks.push({
          x: rk.tx, y: rk.ty, px: rk.tx, py: rk.ty, ppx: rk.tx, ppy: rk.ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          life: life, max: life, hue: rk.hue + (rnd() - 0.5) * 16, sat: rk.sat, lum: 60 + rnd() * 16, size: (3.2 + rnd() * 2.4) * Math.max(0.6, scale)
        });
      }
      flashes.push({ x: rk.tx, y: rk.ty, t: 0, r: power * 0.5, hue: rk.hue, sat: rk.sat });
    }

    function step(dt, t) {
      if (simple || !opts || W < 8) return;
      if (custom) { if (custom.step) custom.step(dt, t); return; }
      const stark = opts.style === 'stark';
      const until = stark ? STARK.holdEnd - 500 : 9300;
      while (t >= nextRocket && nextRocket <= until) {
        const salvo = !stark && nextRocket === 0 ? 4 : 1 + (rnd() < 0.25 ? 1 : 0);
        for (let i = 0; i < salvo; i++) launch(nextRocket);
        nextRocket += stark ? 560 + rnd() * 420 : 300 + rnd() * 380;
      }
      for (let i = rockets.length - 1; i >= 0; i--) {
        const rk = rockets[i];
        rk.t += dt;
        if (rk.t >= rk.flight) { burst(rk); rockets.splice(i, 1); }
      }
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      const drag = Math.exp(-1.7 * dt);
      const g = 120 * scale * dt;
      let live = 0;
      for (let i = 0; i < sparks.length; i++) {
        const p = sparks[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.ppx = p.px;
        p.ppy = p.py;
        p.px = p.x;
        p.py = p.y;
        p.vx *= drag;
        p.vy = p.vy * drag + g;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        sparks[live++] = p;
      }
      sparks.length = live;
      let lf = 0;
      for (let i = 0; i < flashes.length; i++) { flashes[i].t += dt; if (flashes[i].t < 0.28) flashes[lf++] = flashes[i]; }
      flashes.length = lf;
    }

    /* ----------------------------------------------------------- render --- */

    /**
     * The words in a fill, drawn once into a canvas of their own with one soft dark halo (it keeps
     * them readable over a bright scene without boxing them in). Drawing text with a blurred shadow
     * every frame is what made the animation drop to 30 frames a second on a big screen.
     */
    function wordsBitmap(fill) {
      const key = JSON.stringify(fill) + '|' + layout.title + '|' + layout.year;
      if (wordsCache[key]) return wordsCache[key];
      const L = layout;
      const pad = Math.ceil(L.titleSize * 0.9);
      const top = Math.floor(L.top - pad);
      const hgt = Math.ceil(L.bottom - L.top + pad * 2);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(W * DPR));
      c.height = Math.max(1, Math.round(hgt * DPR));
      const g = c.getContext('2d');
      g.setTransform(DPR, 0, 0, DPR, 0, -top * DPR);
      if (fill.halo) {
        g.shadowColor = fill.halo;
        g.shadowBlur = Math.max(6, L.titleSize * 0.28);
        g.shadowOffsetY = L.titleSize * 0.04;
      }
      const grad = g.createLinearGradient(0, L.top, 0, L.bottom);
      for (const st of fill.stops) grad.addColorStop(st[0], st[1]);
      g.fillStyle = grad;
      drawWords(g, L, (ch, x, y) => g.fillText(ch, x, y));
      return (wordsCache[key] = { canvas: c, top: top, h: hgt });
    }

    function stampWords(alpha, scaleUp, fill) {
      const L = layout;
      if (!L || alpha <= 0.003) return;
      const b = wordsBitmap(fill);
      ctx.save();
      if (scaleUp !== 1) {
        const cy = (L.top + L.bottom) / 2;
        ctx.translate(L.cx, cy);
        ctx.scale(scaleUp, scaleUp);
        ctx.translate(-L.cx, -cy);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      ctx.drawImage(b.canvas, 0, b.top, W, b.h);
      ctx.restore();
    }

    function drawSolidWords(alpha, scaleUp) {
      stampWords(alpha, scaleUp, GOLD);
    }

    function drawPulse(t) {
      if (t > 520) return;
      const k = clamp(t / 520, 0, 1);
      const cx = W / 2;
      const cy = H / 2;
      const reach = Math.max(W, H) * 0.62;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (t < 340) {
        // A soft warm flash, well under a quarter of full brightness.
        const a = 0.2 * (1 - t / 340);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        grad.addColorStop(0, 'rgba(255,214,140,' + a.toFixed(3) + ')');
        grad.addColorStop(1, 'rgba(255,214,140,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.strokeStyle = 'rgba(255,226,160,' + (0.55 * (1 - k)).toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, (1 - k) * 7 * Math.min(W / 1920, H / 1080) + 1);
      ctx.beginPath();
      ctx.arc(cx, cy, easeOut(k) * reach, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    function drawDust(t) {
      const d = dust;
      if (!d || !d.n) return 0;
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      const holdT = t - STARK.assembleEnd;
      // A glint that sweeps across the words every couple of seconds.
      const band = d.span * 0.09;
      const glintX = holdT > 0 && t < STARK.holdEnd ? d.minX - band * 3 + ((holdT % 2500) / 2500) * (d.span + band * 6) : -1e9;
      let drawn = 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let c = 0; c < d.order.length; c++) {
        const list = d.order[c];
        ctx.fillStyle = DUST_COLORS[c];
        const sprite = sprites[c];
        for (let k = 0; k < list.length; k++) {
          const i = list[k];
          let x;
          let y;
          let a;
          let s = d.size[i];
          const u = (t - d.delay[i]) / d.dur[i];
          if (u <= 0) continue;
          const leave = (t - STARK.holdEnd - d.out[i]) / STARK.fly;
          if (leave >= 1) continue;
          if (u < 1) {
            // Flying in: ride the wind, wobbling less and less as the grain homes in.
            const e = easeOut(u);
            const wob = (1 - e) * d.amp[i];
            x = lerp(d.sx[i], d.tx[i], e) + Math.cos(d.ph[i] + u * 5) * wob * 0.35;
            y = lerp(d.sy[i], d.ty[i], e) + Math.sin(d.ph[i] + u * 7) * wob;
            a = Math.min(1, u * 5) * 0.9;
          } else if (leave <= 0) {
            // Holding the shape: a gentle shiver so the words feel alive.
            x = d.tx[i] + Math.sin(t * 0.0041 + d.ph[i]) * 0.55 * scale;
            y = d.ty[i] + Math.cos(t * 0.0036 + d.ph[i] * 1.7) * 0.55 * scale;
            a = 0.72 + 0.2 * Math.sin(t * 0.006 + d.ph[i] * 3);
            const gdist = (d.tx[i] - glintX) / band;
            if (gdist > -3 && gdist < 3) { const boost = Math.exp(-gdist * gdist); a = Math.min(1, a + boost * 0.5); s *= 1 + boost * 0.55; }
          } else {
            // Blowing away to the right, rising and thinning out.
            const e = easeIn(leave);
            x = d.tx[i] + d.fx[i] * e + Math.sin(d.ph[i] + leave * 6) * 14 * scale * leave;
            y = d.ty[i] - d.fy[i] * leave + Math.cos(d.ph[i] * 1.3 + leave * 5) * 12 * scale * leave;
            a = 0.85 * (1 - Math.pow(leave, 1.4));
            s *= 1 - leave * 0.45;
          }
          ctx.globalAlpha = a;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          if ((i & 1) === 0 && !low) {
            const gs = s * 4.2;
            ctx.globalAlpha = a * 0.3;
            ctx.drawImage(sprite, x - gs / 2, y - gs / 2, gs, gs);
          }
          drawn++;
        }
      }
      ctx.restore();
      return drawn;
    }

    function drawFireworks() {
      if (!rockets.length && !sparks.length && !flashes.length) return 0;
      const scale = Math.max(0.3, Math.min(W / 1920, H / 1080));
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const rk of rockets) {
        const k = easeOut(clamp(rk.t / rk.flight, 0, 1));
        const x = lerp(rk.x, rk.tx, k);
        const y = lerp(rk.y, rk.ty, k);
        const k0 = easeOut(clamp((rk.t - 0.07) / rk.flight, 0, 1));
        // Rockets only light up as they climb, so they do not scratch across the words.
        const vis = smooth(0.6, 0.35, y / H);
        if (vis <= 0.01) continue;
        ctx.strokeStyle = 'hsla(' + rk.hue + ',' + rk.sat + '%,82%,' + (0.8 * vis).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, 3 * scale);
        ctx.beginPath();
        ctx.moveTo(lerp(rk.x, rk.tx, k0), lerp(rk.y, rk.ty, k0));
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      for (const f of flashes) {
        const k = f.t / 0.28;
        const r = f.r * (0.35 + 0.65 * k);
        const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r);
        grad.addColorStop(0, 'hsla(' + f.hue + ',' + f.sat + '%,88%,' + (0.55 * (1 - k)).toFixed(3) + ')');
        grad.addColorStop(1, 'hsla(' + f.hue + ',' + f.sat + '%,60%,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2);
      }
      ctx.lineCap = 'butt';
      for (const p of sparks) {
        const a = clamp(p.life / p.max, 0, 1);
        const twinkle = a < 0.45 ? 0.55 + 0.45 * Math.sin(p.life * 40 + p.hue) : 1;
        const s = p.size * (0.5 + 0.5 * a);
        const col = 'hsl(' + (p.hue | 0) + ',' + p.sat + '%,' + (p.lum | 0) + '%)';
        // A short streak behind each spark, then a bright head with a soft halo.
        ctx.strokeStyle = col;
        ctx.lineWidth = s * 0.7;
        ctx.globalAlpha = a * 0.45;
        ctx.beginPath();
        ctx.moveTo(p.ppx, p.ppy);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.globalAlpha = a * 0.16 * twinkle;
        ctx.fillRect(p.x - s * 1.7, p.y - s * 1.7, s * 3.4, s * 3.4);
        ctx.globalAlpha = Math.min(1, a * 1.25) * twinkle;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.restore();
      return sparks.length;
    }

    function draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!opts || !layout || W < 8 || H < 8) return;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      if (custom) {
        const n = custom.draw(t) || 0;
        if (n > peak) peak = n;
        return;
      }
      const total = DURATION[opts.style] || DURATION.stark;
      if (simple) {
        drawSolidWords(smooth(200, 1200, t) * (1 - smooth(total - 1500, total - 200, t)), 1);
        return;
      }
      let live = 0;
      if (opts.style === 'stark') {
        drawPulse(t);
        // The solid words fade in underneath as the dust settles, so they read instantly.
        const under = smooth(STARK.assembleEnd - 800, STARK.assembleEnd + 200, t) * (1 - smooth(STARK.holdEnd, STARK.holdEnd + STARK.sweep * 0.8, t));
        drawSolidWords(under * 0.62, 1);
        live += drawFireworks();
        live += drawDust(t);
      } else {
        live += drawFireworks();
        const a = smooth(300, 1100, t) * (1 - smooth(total - 1300, total - 150, t));
        drawSolidWords(a, lerp(0.88, 1, easeOut(clamp((t - 300) / 900, 0, 1))));
      }
      if (live > peak) peak = live;
    }

    /* --------------------------------------------------------- control --- */

    function frame(ts) {
      if (!running) return;
      // The frame timestamp can be a hair earlier than the moment play() was called.
      const t = Math.max(0, ts - startTs);
      const dt = clamp((ts - lastTs) / 1000, 0, 0.05);     // a stalled tab must not explode the simulation
      lastTs = ts;
      // Frames slower than a 60 Hz screen allows (19 ms) for a third of a second: the glow goes, and
      // stays off for the rest of the animation so the picture does not flicker between the two.
      if (!low && t > 300) {
        slowFor = dt > 0.019 ? slowFor + dt : Math.max(0, slowFor - dt * 0.5);
        if (slowFor > 0.33) low = true;
      }
      try {
        step(dt, t);
        draw(t);
      } catch (e) {
        // A drawing error must never leave a dead animation marked as running over the film.
        finish(false);
        if (root.console) root.console.error('celebration stopped: ' + (e && e.message));
        return;
      }
      if (t >= (DURATION[opts.style] || DURATION.stark)) {
        finish(true);
        return;
      }
      raf = root.requestAnimationFrame(frame);
    }

    function finish(natural) {
      const was = running;
      running = false;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      opts = null;
      layout = null;
      dust = null;
      custom = null;
      rockets = [];
      sparks = [];
      flashes = [];
      clear();
      if (natural && was && typeof api.onDone === 'function') {
        try { api.onDone(); } catch (e) { /* the host's problem */ }
      }
    }

    /**
     * Does the slow part of starting an animation (laying out and measuring the words, preparing
     * the dust) ahead of time, so that play() at midnight starts on the very next frame.
     */
    function prime(o) {
      if (running || W < 8 || H < 8) return;
      try {
        opts = options(o);
        prepare();
        if (layout) wordsBitmap(GOLD);
        if (custom && custom.prime) custom.prime();
      } catch (e) { /* only a head start */ }
      opts = null;
      layout = null;
      dust = null;
      custom = null;
    }

    function options(o) {
      o = o || {};
      return {
        style: STYLES[o.style] ? o.style : o.style === 'fireworks' ? 'fireworks' : 'stark',
        title: o.title == null ? 'HAPPY NEW YEAR' : String(o.title),
        year: o.year == null ? '' : String(o.year),
        seed: typeof o.seed === 'number' ? o.seed : null
      };
    }

    function play(o) {
      finish(false);
      o = o || {};
      opts = options(o);
      // The user picked this animation on purpose (Minimal and Off exist for those who want less),
      // so it plays in full even when Windows has its own animations switched off.
      simple = false;
      low = false;
      slowFor = 0;
      resetSim();
      prepare();
      running = true;
      startTs = lastTs = root.performance.now();
      raf = root.requestAnimationFrame(frame);
    }

    function stop() {
      finish(false);
    }

    /** Test hook: draw the frame for time t, simulated from zero in fixed steps. Stops the live clock. */
    function renderAt(tMs) {
      if (!opts) return;
      if (raf) root.cancelAnimationFrame(raf);
      raf = 0;
      running = false;
      resetSim();
      prepare();
      const dt = 1 / 60;
      for (let t = 0; t <= tMs; t += 1000 / 60) step(dt, t);
      draw(tMs);
    }

    return api;
  }

  root.APFx = {
    create: create,
    duration: function (style) { return DURATION[style] || DURATION.stark; },
    /** Adds a style: def = { name, duration (ms), create(env) -> { step(dt, t), draw(t) } }. */
    register: function (id, def) {
      if (!id || !def || typeof def.create !== 'function') return;
      STYLES[id] = def;
      DURATION[id] = def.duration || 12000;
    },
    styles: function () { return ['stark', 'fireworks'].concat(Object.keys(STYLES)); },
    name: function (id) { return STYLES[id] ? STYLES[id].name || id : id === 'fireworks' ? 'Fireworks' : 'Stark'; }
  };
})(typeof window !== 'undefined' ? window : this);
