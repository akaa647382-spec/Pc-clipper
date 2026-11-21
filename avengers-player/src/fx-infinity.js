/*!
 * Avengers Player: 'infinity', the Thanos animation (a style for src/fx.js).
 *
 *   0.0 s      the snap: a sharp gold-white flash and a crack of light above the words, and a ring of
 *              light racing out.
 *   0.1-1.1 s  six streaks of light in the stones' colours (blue, yellow, red, purple, green, orange)
 *              shoot in from six directions on curving paths and collide above the words.
 *   1.0-1.6 s  they merge into a gold blaze.
 *   1.2-2.0 s  the blaze pours gold into the year, centre digits first: each digit lands white-hot,
 *              throws a burst of sparks and cools to gold with a purple edge.
 *   1.9-3.0 s  purple ash rises from below and builds HAPPY NEW YEAR letter by letter.
 *   3-9.6 s    a slow purple aura breathes behind the words; six motes of coloured light circle the year.
 *   9.6 s      perfectly balanced: exactly half the letters turn to dust and blow away; at 10.4 s, the
 *              other half. Nothing is drawn after about 12 s.
 *
 * No character, no gauntlet, no gems: only light, gold, purple and dust. Every frame is a function of
 * the seed and t alone (all randomness is drawn in create()), so renderAt(t), a resize and the live
 * animation draw the same picture.
 */
(function (root) {
  'use strict';

  const FX = root.APFx;
  if (!FX || typeof FX.register !== 'function') return;

  const DURATION = 12800;
  const TAU = Math.PI * 2;
  // The six lights, in the stones' colours.
  const LIGHTS = ['#5b95ff', '#ffd23a', '#ff4040', '#b45cff', '#3ee07f', '#ff8f2e'];
  const ASH = ['#b47cff', '#8a4fe0', '#d9b8ff', '#ffcf6a', '#6a35b8'];
  const PURPLE = '#7a3cff';
  const GOLDC = '#ffcf5a';
  // The words: gold with a deep purple edge (and a dark halo, to read over a bright scene).
  const GOLD = {
    stops: [[0, '#fff5d0'], [0.3, '#ffd977'], [0.58, '#e3a52c'], [1, '#93530e']],
    halo: 'rgba(26,6,44,0.92)',
    stroke: { width: 0.02, stops: [[0, '#d2abff'], [1, '#4a1a8c']] }
  };
  // White-hot, added as light over a digit as it lands.
  const HOT = { stops: [[0, '#ffffff'], [1, '#fff0c4']] };

  const T_MERGE = 1050;     // the six lights have all arrived
  const T_HALF1 = 9600;     // the first half of the letters turns to dust
  const T_HALF2 = 10400;    // the other half
  const MELT = 450;         // a letter fades out over this while its dust lifts
  const DUST_FLY = 1200;    // how long a grain of dust takes to blow away

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const S = env.scale;
    const L = env.layout;
    const rnd = env.rnd;
    const clamp = env.clamp;
    const lerp = env.lerp;
    const smooth = env.smooth;
    const easeOut = env.easeOut;
    const easeIn = env.easeIn;

    const glyphs = env.glyphs();
    const title = glyphs.filter((g) => g.line === 0);
    const year = glyphs.filter((g) => g.line === 1);
    const hasYear = year.length > 0;

    // Where the lights meet: above the words.
    const C = { x: L.cx, y: Math.max(H * 0.12, L.top - Math.max(L.titleSize * 1.5, H * 0.13)) };

    /* ---- the six lights: from six directions, curving in to C ---- */
    const reach = Math.hypot(W, H) * 0.42;     // they start near the edges, visible right after the snap
    const lights = LIGHTS.map((col, i) => {
      const a = i * (TAU / 6) - Math.PI / 2 + 0.35 + (rnd() - 0.5) * 0.3;
      const p0 = { x: C.x + Math.cos(a) * reach, y: C.y + Math.sin(a) * reach };
      const bend = (i % 2 ? 1 : -1) * reach * (0.22 + rnd() * 0.12);
      const mx = (p0.x + C.x) / 2;
      const my = (p0.y + C.y) / 2;
      const q = { x: mx - Math.sin(a) * bend, y: my + Math.cos(a) * bend };
      const t0 = 80 + i * 55 + rnd() * 40;
      return { col: col, p0: p0, q: q, t0: t0, t1: T_MERGE - 40 + rnd() * 40 };
    });
    const bez = (lt, u) => {
      const v = 1 - u;
      return { x: v * v * lt.p0.x + 2 * v * u * lt.q.x + u * u * C.x, y: v * v * lt.p0.y + 2 * v * u * lt.q.y + u * u * C.y };
    };

    /* ---- the year: centre digits first, each fed by a stream of gold ---- */
    const mid = (year.length - 1) / 2;
    const yearOrder = year.map((g, i) => ({ g: g, rank: Math.abs(i - mid) + i * 0.001 }))
      .sort((p, q) => p.rank - q.rank);
    const landing = new Map();
    yearOrder.forEach((o, k) => landing.set(o.g, 1250 + k * 150));
    const sparks = new Map();      // per digit: [angle, speed, life] * n
    for (const g of year) {
      const n = 16;
      const sp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        sp[i * 3] = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.6;
        sp[i * 3 + 1] = (180 + rnd() * 360) * S;
        sp[i * 3 + 2] = 450 + rnd() * 400;
      }
      sparks.set(g, sp);
    }

    /* ---- the title: purple ash rising into each letter, left to right ---- */
    const titleStart = new Map();
    title.forEach((g, i) => titleStart.set(g, (hasYear ? 1900 : 1150) + i * 65));

    /* ---- the grains: points on the letters, each belonging to one letter ---- */
    const wp = env.wordPoints(1400);
    const split = hasYear ? (L.titleY + L.titleSize / 2 + L.yearY - L.yearSize / 2) / 2 : Infinity;
    const grains = [];          // { g, tx, ty, sx, sy, dl, du, col, size, wob, ox, oy, od }
    for (let i = 0; i < wp.pts.length; i += 2) {
      const x = wp.pts[i];
      const y = wp.pts[i + 1];
      const line = y < split ? title : year;
      let best = null;
      let bd = Infinity;
      for (const g of line) { const d = Math.abs(g.cx - x); if (d < bd) { bd = d; best = g; } }
      if (!best) continue;
      grains.push({
        g: best, tx: x, ty: y,
        // rising ash: from below and a little to the side
        sx: x + (rnd() - 0.5) * W * 0.08, sy: y + H * (0.1 + rnd() * 0.28),
        dl: rnd() * 220, du: 520 + rnd() * 380,
        col: ASH[(rnd() * ASH.length) | 0], size: (1.6 + rnd() * 1.8) * Math.max(0.7, S), wob: rnd() * TAU,
        // blowing away at the end
        ox: (0.12 + rnd() * 0.26) * W, oy: (0.04 + rnd() * 0.2) * H, od: rnd() * 250
      });
    }

    /* ---- perfectly balanced: exactly half the letters go first ---- */
    const order = glyphs.map((g) => ({ g: g, k: rnd() })).sort((p, q) => p.k - q.k);
    const ends = new Map();
    order.forEach((o, i) => ends.set(o.g, (i < Math.floor(order.length / 2) ? T_HALF1 : T_HALF2) + rnd() * 180));

    // The ring of motes round the year (or the title without one).
    const ringLine = hasYear ? year : title;
    const ringW = ringLine.length ? (ringLine[ringLine.length - 1].x1 - ringLine[0].x0) : W * 0.3;
    const ring = { x: L.cx, y: hasYear ? L.yearY : L.titleY, rx: ringW * 0.62 + 30 * S, ry: (hasYear ? L.yearSize : L.titleSize) * 0.62 };

    const sprites = LIGHTS.map((c) => env.sprite(c));
    const white = env.sprite('#ffffff');
    const gold = env.sprite(GOLDC);
    const purple = env.sprite(PURPLE);
    const TF = { scale: 1 };
    const TH = { scale: 1, op: 'lighter' };

    const blot = (img, x, y, size, a) => {
      if (a <= 0.003) return;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
    };

    /** How visible a letter is at t (0..1) and how big (its landing scale). */
    function letterState(g, t) {
      let a = 0;
      let s = 1;
      if (g.line === 1) {
        const tl = landing.get(g);
        const k = (t - tl) / 320;
        if (k > 0) { a = clamp((t - tl) / 60, 0, 1); s = lerp(1.35, 1, easeOut(clamp(k, 0, 1))); }
      } else {
        const ts = titleStart.get(g);
        a = smooth(ts + 420, ts + 820, t);
      }
      const te = ends.get(g);
      a *= 1 - smooth(te, te + MELT, t);
      return { a: a, s: s };
    }

    function draw(t) {
      let n = 0;
      const lowQ = env.low();
      ctx.save();

      /* the aura behind the words */
      const aura = smooth(2200, 3400, t) * (1 - smooth(9400, 10600, t));
      if (aura > 0.003) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = aura * (0.16 + 0.06 * Math.sin(t * 0.0021));
        const ah = (L.bottom - L.top) * 2.4;
        ctx.drawImage(purple, L.cx - W * 0.36, (L.top + L.bottom) / 2 - ah / 2, W * 0.72, ah);
      }

      /* the snap: a flash, a crack of light and a ring */
      if (t < 520) {
        ctx.globalCompositeOperation = 'lighter';
        const k = t / 520;
        const fl = 0.22 * (1 - smooth(0, 300, t));
        if (fl > 0.003) {
          const r = Math.max(W, H) * 0.6;
          const grad = ctx.createRadialGradient(C.x, C.y, 0, C.x, C.y, r);
          grad.addColorStop(0, 'rgba(255,236,190,' + fl.toFixed(3) + ')');
          grad.addColorStop(1, 'rgba(255,236,190,0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, W, H);
        }
        const crack = 1 - smooth(0, 360, t);
        if (crack > 0.003) {
          ctx.globalAlpha = crack;
          const len = W * (0.18 + 0.3 * easeOut(clamp(t / 180, 0, 1)));
          const grad = ctx.createLinearGradient(C.x - len, C.y, C.x + len, C.y);
          grad.addColorStop(0, 'rgba(255,220,140,0)');
          grad.addColorStop(0.5, 'rgba(255,255,255,1)');
          grad.addColorStop(1, 'rgba(255,220,140,0)');
          ctx.fillStyle = grad;
          const th = Math.max(1.5, 5 * S * crack);
          ctx.fillRect(C.x - len, C.y - th / 2, len * 2, th);
          blot(white, C.x, C.y, 90 * S * (0.6 + crack), crack);
        }
        ctx.globalAlpha = 0.65 * (1 - k);
        ctx.strokeStyle = 'rgba(255,226,160,1)';
        ctx.lineWidth = Math.max(1, 4 * S * (1 - k));
        ctx.beginPath();
        ctx.arc(C.x, C.y, easeOut(k) * Math.max(W, H) * 0.42, 0, TAU);
        ctx.stroke();
      }

      /* the six lights */
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 0; i < lights.length; i++) {
        const lt = lights[i];
        if (t < lt.t0 || t > lt.t1 + 120) continue;
        const k = clamp((t - lt.t0) / (lt.t1 - lt.t0), 0, 1);
        const u = Math.pow(k, 1.45);
        const fade = 1 - smooth(lt.t1, lt.t1 + 120, t);
        // the trail
        const segs = lowQ ? 6 : 12;
        const u0 = Math.max(0, u - 0.3);
        let prev = bez(lt, u0);
        ctx.strokeStyle = lt.col;
        for (let j = 1; j <= segs; j++) {
          const uj = u0 + (u - u0) * (j / segs);
          const p = bez(lt, uj);
          ctx.globalAlpha = 0.85 * fade * (j / segs);
          ctx.lineWidth = (1 + 4 * (j / segs)) * Math.max(0.6, S);
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          prev = p;
        }
        // the head
        const h = bez(lt, u);
        blot(sprites[i], h.x, h.y, 70 * S, fade);
        blot(white, h.x, h.y, 18 * S, fade);
        n += segs;
      }

      /* the gold blaze where they meet, glowing on while the year is fed */
      const tb = t - (T_MERGE - 60);
      if (tb > 0 && t < 2400) {
        const grow = easeOut(clamp(tb / 280, 0, 1));
        const k = tb < 280 ? 1 : 1 - smooth(1700, 2400, t) * 0.999;
        const r = (50 + 170 * grow) * S;
        blot(gold, C.x, C.y, r * 2.2, 0.75 * k);
        blot(white, C.x, C.y, r * 0.7, 0.9 * k);
        if (!lowQ) {
          ctx.strokeStyle = 'rgba(255,214,120,1)';
          ctx.lineWidth = Math.max(1, 1.6 * S);
          for (let i = 0; i < 12; i++) {
            const a = i * (TAU / 12) + t * 0.0006;
            const len = r * (1.1 + 0.6 * Math.sin(i * 2.3 + t * 0.004));
            ctx.globalAlpha = 0.35 * k;
            ctx.beginPath();
            ctx.moveTo(C.x + Math.cos(a) * r * 0.3, C.y + Math.sin(a) * r * 0.3);
            ctx.lineTo(C.x + Math.cos(a) * len, C.y + Math.sin(a) * len);
            ctx.stroke();
          }
        }
      }

      /* streams of gold from the blaze into each digit */
      for (const g of year) {
        const tl = landing.get(g);
        const k = (t - (tl - 220)) / 220;
        if (k <= 0 || k > 1.25) continue;
        const kk = clamp(k, 0, 1);
        const tx = g.cx;
        const ty = g.top;
        const hx = lerp(C.x, tx, easeIn(kk));
        const hy = lerp(C.y, ty, easeIn(kk));
        const fade = 1 - smooth(1, 1.25, k);
        ctx.globalAlpha = 0.7 * fade;
        ctx.strokeStyle = GOLDC;
        ctx.lineWidth = Math.max(1.2, 3.2 * S);
        ctx.beginPath();
        ctx.moveTo(lerp(C.x, tx, Math.max(0, easeIn(kk) - 0.35)), lerp(C.y, ty, Math.max(0, easeIn(kk) - 0.35)));
        ctx.lineTo(hx, hy);
        ctx.stroke();
        blot(gold, hx, hy, 46 * S, fade);
        blot(white, hx, hy, 14 * S, fade);
      }

      /* the ash rising into the title */
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < grains.length; i++) {
        const gr = grains[i];
        if (gr.g.line !== 0) continue;
        if (lowQ && (i & 1)) continue;
        const ts = titleStart.get(gr.g) + gr.dl;
        const k = (t - ts) / gr.du;
        if (k <= 0 || t > ts + gr.du + 700) continue;
        const e = easeOut(clamp(k, 0, 1));
        const la = smooth(titleStart.get(gr.g) + 420, titleStart.get(gr.g) + 820, t);
        const a = Math.min(1, k * 4) * (1 - la) * 0.9;
        if (a <= 0.01) continue;
        const wob = (1 - e) * 10 * S;
        const x = lerp(gr.sx, gr.tx, e) + Math.sin(gr.wob + t * 0.006) * wob;
        const y = lerp(gr.sy, gr.ty, e);
        ctx.globalAlpha = a;
        ctx.fillStyle = gr.col;
        ctx.fillRect(x - gr.size / 2, y - gr.size / 2, gr.size, gr.size);
        n++;
      }

      /* the letters */
      for (const g of glyphs) {
        const st = letterState(g, t);
        if (st.a <= 0.003) continue;
        TF.scale = st.s;
        env.glyph(g, st.a, GOLD, TF);
        if (g.line === 1) {
          const tl = landing.get(g);
          const hot = Math.pow(1 - clamp((t - tl) / 450, 0, 1), 2) * 0.9 * st.a;
          if (hot > 0.003) { TH.scale = st.s; env.glyph(g, hot, HOT, TH); }
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';

      /* sparks thrown off each digit as it lands */
      for (const g of year) {
        const tl = landing.get(g);
        const sp = sparks.get(g);
        const tau = (t - tl) / 1000;
        if (tau <= 0 || tau > 0.9) continue;
        for (let i = 0; i < sp.length; i += 3) {
          const life = sp[i + 2] / 1000;
          if (tau > life) continue;
          const v = sp[i + 1];
          const x = g.cx + Math.cos(sp[i]) * v * tau;
          const y = g.cy + Math.sin(sp[i]) * v * tau + 0.5 * 700 * S * tau * tau;
          const a = 1 - tau / life;
          ctx.globalAlpha = a;
          ctx.fillStyle = i % 2 ? '#ffffff' : GOLDC;
          const s = 2.4 * Math.max(0.7, S);
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          n++;
        }
      }

      /* six motes of coloured light circling the year */
      const motes = smooth(2400, 3200, t) * (1 - smooth(T_HALF1 - 600, T_HALF1, t));
      if (motes > 0.003) {
        for (let i = 0; i < 6; i++) {
          const a = t * 0.0011 + i * (TAU / 6);
          const x = ring.x + Math.cos(a) * ring.rx;
          const y = ring.y + Math.sin(a) * ring.ry;
          const behind = Math.sin(a) < 0 ? 0.55 : 1;
          blot(sprites[i], x, y, 30 * S, 0.8 * motes * behind);
          blot(white, x, y, 7 * S, 0.9 * motes * behind);
        }
      }

      /* perfectly balanced: the letters' dust blowing away */
      ctx.globalCompositeOperation = 'source-over';
      if (t > T_HALF1) {
        for (let i = 0; i < grains.length; i++) {
          if (lowQ && (i & 1)) continue;
          const gr = grains[i];
          const te = ends.get(gr.g) + gr.od;
          const k = (t - te) / DUST_FLY;
          if (k <= 0 || k >= 1) continue;
          const e = easeIn(k);
          const a = Math.min(1, k * 8) * (1 - k) * 0.9;
          const x = gr.tx + gr.ox * e + Math.sin(gr.wob + k * 6) * 12 * S * k;
          const y = gr.ty - gr.oy * e + Math.cos(gr.wob * 1.3 + k * 5) * 10 * S * k;
          const s = gr.size * (1 - k * 0.5);
          ctx.globalAlpha = a;
          ctx.fillStyle = gr.col;
          ctx.fillRect(x - s / 2, y - s / 2, s, s);
          n++;
        }
      }

      ctx.restore();
      return n;
    }

    /** Before midnight: the letters' pictures, so the first frame has nothing slow left to do. */
    function prime() {
      env.warm(GOLD);
      env.warm(HOT);
    }

    return { step: function () {}, draw: draw, prime: prime };
  }

  FX.register('infinity', { name: 'Infinity', duration: DURATION, font: { family: 'AP Syncopate', weight: 700, tracking: 0.05 }, create: create });
})(typeof window !== 'undefined' ? window : this);
