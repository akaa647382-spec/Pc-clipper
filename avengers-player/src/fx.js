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
 * window.APFx.create(canvas) -> { resize, play, stop, running, onDone, renderAt }
 */
(function (root) {
  'use strict';

  const FONT = '"Bahnschrift", "DIN Alternate", "Segoe UI", system-ui, sans-serif';
  const DURATION = { stark: 12800, fireworks: 12000 };
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
    let slow = 0;            // smoothed frame time; when the machine struggles the soft glow is dropped

    const api = {
      onDone: null,
      get running() { return running; },
      get peakParticles() { return peak; },
      resize: resize,
      play: play,
      stop: stop,
      renderAt: renderAt
    };

    function resize(cssW, cssH, dpr) {
      const w = Math.max(0, Math.floor(cssW || 0));
      const h = Math.max(0, Math.floor(cssH || 0));
      const d = clamp(dpr || 1, 1, 2);
      if (w === W && h === H && d === DPR) return;
      W = w; H = h; DPR = d;
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
    function sampleTargets(L) {
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
      const budget = clamp(Math.round((W * H) / 640), 900, 4200);
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

    function prepare() {
      if (!opts || W < 8 || H < 8) { layout = null; dust = null; return; }
      layout = computeLayout();
      dust = null;
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

    function goldFill(g, L) {
      const grad = g.createLinearGradient(0, L.top, 0, L.bottom);
      grad.addColorStop(0, '#fff3c4');
      grad.addColorStop(0.45, '#ffc94a');
      grad.addColorStop(1, '#e8871e');
      return grad;
    }

    function drawSolidWords(alpha, scaleUp) {
      const L = layout;
      if (!L || alpha <= 0.003) return;
      ctx.save();
      if (scaleUp !== 1) {
        const cy = (L.top + L.bottom) / 2;
        ctx.translate(L.cx, cy);
        ctx.scale(scaleUp, scaleUp);
        ctx.translate(-L.cx, -cy);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      // One soft dark halo keeps the words readable over a bright scene without boxing them in.
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = Math.max(6, L.titleSize * 0.28);
      ctx.shadowOffsetY = L.titleSize * 0.04;
      ctx.fillStyle = goldFill(ctx, L);
      drawWords(ctx, L, (ch, x, y) => ctx.fillText(ch, x, y));
      ctx.restore();
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
          if ((i & 1) === 0 && slow < 0.026) {
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
      slow = slow ? slow * 0.92 + dt * 0.08 : dt;
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
      rockets = [];
      sparks = [];
      flashes = [];
      clear();
      if (natural && was && typeof api.onDone === 'function') {
        try { api.onDone(); } catch (e) { /* the host's problem */ }
      }
    }

    function play(o) {
      finish(false);
      o = o || {};
      opts = {
        style: o.style === 'fireworks' ? 'fireworks' : 'stark',
        title: o.title == null ? 'HAPPY NEW YEAR' : String(o.title),
        year: o.year == null ? '' : String(o.year),
        seed: typeof o.seed === 'number' ? o.seed : null
      };
      // The user picked this animation on purpose (Minimal and Off exist for those who want less),
      // so it plays in full even when Windows has its own animations switched off.
      simple = false;
      slow = 0;
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
    duration: function (style) { return DURATION[style] || DURATION.stark; }
  };
})(typeof window !== 'undefined' ? window : this);
