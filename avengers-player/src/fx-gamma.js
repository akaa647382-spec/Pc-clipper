/*!
 * Avengers Player: 'gamma', a gamma surge at the instant of the snap.
 *
 * A green thunderclap: a short flash, and heavy shockwave rings slam out along the ground from just
 * under the words. Jagged green-white lightning leaps between points around the words and along the
 * edges of the picture, striking again every so often (and in a second surge half-way through);
 * glowing embers and glassy shards rise; the words burn pale lime to green in a glow of their own,
 * with electricity crawling over them. At the end the arcs die down and the embers drift away.
 *
 * Light only, the movie is under the canvas: everything but the words is added with 'lighter'.
 * Every bolt and particle path is worked out in create(), and the frame for a time t depends only on
 * the seed and t (nothing is simulated from frame to frame, so step() has nothing to do).
 *
 * Speed, measured on a software-rendered canvas: a long stroke costs about the same whatever its
 * width, a 1-pixel one a quarter of that, and a stretched image several times more per pixel than
 * one drawn at its own size. So only a bolt's trunk gets a glow (its core and its branches are
 * 1-pixel lines), the words are never stamped stretched, and the big glows (around the words,
 * along the edges) are rendered once at their final size and only copied.
 */
(function (root) {
  'use strict';

  const FX = root.APFx;
  if (!FX || typeof FX.register !== 'function') return;

  const DURATION = 12800;
  const FADE_AT = DURATION - 1500;      // everything fades out from here ...
  const GONE_AT = DURATION - 90;        // ... and nothing at all is drawn from here on
  const MID = 5800;                     // the second surge
  const STRIKES_END = DURATION - 2300;  // the last arc
  const BEAT = 1600;                    // while the words hold, the surge beats like a heart
  const WORD_BUDGET = 1500;             // points on the letters, for the light that plays over them

  // The words: pale lime to green. HOT is the white heat they arrive with (and flash back to).
  const FILL = { stops: [[0, '#f4ffd6'], [0.42, '#d8ff5a'], [1, '#17c25d']], halo: 'rgba(0,0,0,0.88)' };
  const HOT = { stops: [[0, '#ffffff'], [0.55, '#f3ffdc'], [1, '#c8ff92']], halo: 'rgba(0,0,0,0.7)' };

  const BOLT_BLOOM = 'rgb(30,210,100)';
  const BOLT_GLOW = 'rgb(80,255,150)';
  const BOLT_MID = 'rgb(200,255,130)';
  const BOLT_CORE = 'rgb(246,255,236)';
  const BOLT_BRANCH = 'rgb(150,255,170)';
  const RING_GLOW = 'rgb(40,230,120)';
  const RING_CORE = 'rgb(240,255,214)';
  const SHARD_COLORS = ['rgb(200,255,80)', 'rgb(90,255,150)', 'rgb(230,255,170)'];

  /* ------------------------------------------------------- textures --- */

  let TEX = null;                       // made once per page: none of them depends on the screen
  const SIZED = { key: '', v: null };   // made once per screen size and words (kept across create())

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    return c;
  }

  function radialTex(size, stops) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    for (const s of stops) grad.addColorStop(s[0], s[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /** A soft glow along one edge of the picture: strongest at the edge. */
  function edgeTex(side) {
    const across = side === 0 || side === 1;
    const c = makeCanvas(across ? 64 : 8, across ? 8 : 64);
    const g = c.getContext('2d');
    const grad = across
      ? g.createLinearGradient(side === 0 ? 0 : 64, 0, side === 0 ? 64 : 0, 0)
      : g.createLinearGradient(0, side === 2 ? 0 : 64, 0, side === 2 ? 64 : 0);
    grad.addColorStop(0, 'rgba(90,255,150,1)');
    grad.addColorStop(0.28, 'rgba(30,210,100,0.42)');
    grad.addColorStop(1, 'rgba(0,120,50,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function emberTex(rgb) {
    return radialTex(32, [[0, 'rgba(255,255,240,1)'], [0.18, 'rgba(' + rgb + ',1)'], [0.42, 'rgba(' + rgb + ',0.38)'], [1, 'rgba(' + rgb + ',0)']]);
  }

  function textures() {
    if (TEX) return TEX;
    const streak = makeCanvas(256, 32);
    const g = streak.getContext('2d');
    g.setTransform(4, 0, 0, 0.5, 0, 0);        // a round glow squeezed into a long thin one
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.08, 'rgba(235,255,210,0.9)');
    grad.addColorStop(0.3, 'rgba(120,255,160,0.35)');
    grad.addColorStop(1, 'rgba(0,140,60,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    TEX = {
      // soft green light: the glow under and around the words, out-of-focus embers
      glow: radialTex(128, [[0, 'rgba(170,255,190,1)'], [0.22, 'rgba(70,240,130,0.55)'], [0.6, 'rgba(20,160,80,0.15)'], [1, 'rgba(0,90,40,0)']]),
      // white heat: the impact, where an arc touches, a shard catching the light
      hot: radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(245,255,225,0.95)'], [0.32, 'rgba(190,255,130,0.45)'], [0.65, 'rgba(60,230,120,0.12)'], [1, 'rgba(0,120,50,0)']]),
      streak: streak,
      edge: [edgeTex(0), edgeTex(1), edgeTex(2), edgeTex(3)],
      ember: [emberTex('216,255,90'), emberTex('110,255,160'), emberTex('236,255,190')]
    };
    return TEX;
  }

  /**
   * The light that belongs to this screen and these words, rendered at device resolution so that a
   * frame only copies it: the glow around the letters with its pool on the ground, and the four edges.
   */
  function sized(env, geo) {
    const L = env.layout;
    const key = env.W + 'x' + env.H + '@' + env.dpr + '|' + L.title + '|' + L.year;
    if (SIZED.key === key && SIZED.v) return SIZED.v;
    const T = textures();
    const W = env.W;
    const H = env.H;
    const dpr = env.dpr;
    const S = env.scale;
    const P = geo.P;

    // The glow: soft light stacked on the letters, and a wide pool of it on the ground under them.
    const pad = L.titleSize * 0.8;
    const poolW = W * 0.62;
    const poolH = H * 0.22;
    const x0 = Math.max(0, Math.floor(Math.min(geo.x0 - pad, geo.gx - poolW / 2)));
    const x1 = Math.min(W, Math.ceil(Math.max(geo.x1 + pad, geo.gx + poolW / 2)));
    const y0 = Math.max(0, Math.floor(geo.y0 - pad));
    const y1 = Math.min(H, Math.ceil(geo.gy + poolH * 0.55));
    const c = makeCanvas(Math.round((x1 - x0) * dpr), Math.round((y1 - y0) * dpr));
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.5;
    g.drawImage(T.glow, geo.gx - poolW / 2, geo.gy - poolH * 0.45, poolW, poolH);
    const n = P.length >> 1;
    const every = Math.max(1, Math.round(n / 700));
    const area = every * geo.step * geo.step;          // letter area each sprite stands for
    for (let i = 0; i < n; i += every) {
      const x = P[i * 2];
      const y = P[i * 2 + 1];
      const s = (y > geo.split ? L.yearSize : L.titleSize) * 0.46;
      g.globalAlpha = Math.min(0.5, 4.2 * area / (s * s));
      g.drawImage(T.glow, x - s / 2, y - s / 2, s, s);
    }
    const radiance = { canvas: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

    // The edges of the picture, each a strip of light.
    const ew = Math.round(90 * S);
    const edges = [];
    for (let e = 0; e < 4; e++) {
      const across = e < 2;
      const w = across ? ew : W;
      const h = across ? H : ew;
      const k = makeCanvas(Math.round(w * dpr), Math.round(h * dpr));
      k.getContext('2d').drawImage(T.edge[e], 0, 0, k.width, k.height);
      edges.push({ canvas: k, x: e === 1 ? W - ew : 0, y: e === 3 ? H - ew : 0, w: w, h: h });
    }
    SIZED.key = key;
    SIZED.v = { radiance: radiance, edges: edges };
    return SIZED.v;
  }

  // A repeatable flicker: the same t always gives the same value.
  function hash01(n) {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  const bump = (t, at, w) => { const d = (t - at) / w; return Math.exp(-d * d); };

  /* --------------------------------------------------------- create --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const S = env.scale;
    const L = env.layout;
    const rnd = env.rnd;
    const clamp = env.clamp;
    const smooth = env.smooth;
    const lerp = env.lerp;
    const easeOut = env.easeOut;
    const T = textures();
    const R = (a, b) => a + (b - a) * rnd();
    const hair = 1 / Math.max(0.5, env.dpr || 1);        // one device pixel: the cheapest line there is

    /* -- where the words are: the box of each line, from the points on its letters -- */
    const wp = env.wordPoints(WORD_BUDGET);
    const P = wp.pts;
    const NP = P.length >> 1;
    const step = Math.max(2, wp.step || 4);
    const year = !!L.year;
    const split = year ? (L.titleY + L.yearY) / 2 : Infinity;
    let tx0 = Infinity, tx1 = -Infinity, ty0 = Infinity, ty1 = -Infinity;
    let yx0 = Infinity, yx1 = -Infinity, yy0 = Infinity, yy1 = -Infinity;
    for (let i = 0; i < NP; i++) {
      const x = P[i * 2];
      const y = P[i * 2 + 1];
      if (y < split) {
        if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y;
      } else {
        if (x < yx0) yx0 = x; if (x > yx1) yx1 = x; if (y < yy0) yy0 = y; if (y > yy1) yy1 = y;
      }
    }
    if (!(tx1 > tx0)) {
      tx0 = L.cx - W * 0.3; tx1 = L.cx + W * 0.3;
      ty0 = L.titleY - L.titleSize * 0.36; ty1 = L.titleY + L.titleSize * 0.36;
    }
    if (!(yx1 > yx0)) {
      if (year) {
        yx0 = L.cx - W * 0.17; yx1 = L.cx + W * 0.17;
        yy0 = L.yearY - L.yearSize * 0.36; yy1 = L.yearY + L.yearSize * 0.36;
      } else {
        yx0 = tx0; yx1 = tx1; yy0 = ty0; yy1 = ty1;   // one line only: the "lower line" is the title
      }
    }
    ty0 -= step / 2; ty1 += step / 2; yy0 -= step / 2; yy1 += step / 2;
    const gap = L.titleSize * 0.22;                           // how far the arcs keep off the letters
    const gx = L.cx;                                          // the impact: just under the words
    const gy = Math.min(H - 10 * S, yy1 + L.titleSize * 0.42);
    const pre = sized(env, { P: P, step: step, split: split, gx: gx, gy: gy, x0: Math.min(tx0, yx0), x1: Math.max(tx1, yx1), y0: ty0 });

    /* -- lightning -- */

    // Midpoint displacement: n = 2^levels segments, ends pinned at 0, roughly within +-1.5.
    function jag(levels, rough) {
      const n = 1 << levels;
      const d = new Float32Array(n + 1);
      let amp = 1;
      for (let size = n; size > 1; size >>= 1) {
        const half = size >> 1;
        for (let i = half; i < n; i += size) d[i] = (d[i - half] + d[i + half]) * 0.5 + (rnd() * 2 - 1) * amp;
        amp *= rough;
      }
      return d;
    }

    /** A jagged line from A to B that bulges by `bow` pixels towards (ux, uy). */
    function polyline(ax, ay, bx, by, bow, ux, uy, jit, levels) {
      const n = 1 << levels;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len;
      let ny = dx / len;
      if (nx * ux + ny * uy < 0) { nx = -nx; ny = -ny; }
      const d = jag(levels, 0.56);
      const amp = len * jit;
      const out = new Float32Array((n + 1) * 2);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const off = 4 * u * (1 - u) * bow + d[i] * amp;
        const slide = i > 0 && i < n ? (rnd() - 0.5) * (len / n) * 0.7 : 0;
        out[i * 2] = ax + dx * u + nx * off + (dx / len) * slide;
        out[i * 2 + 1] = ay + dy * u + ny * off + (dy / len) * slide;
      }
      return out;
    }

    function addTo(path, pts) {
      path.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
    }

    const bolts = [];
    /** Three versions of one arc (it jumps between them as it strikes again), each with branches. */
    function makeBolt(s) {
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      const v = [];
      for (let k = 0; k < 3; k++) {
        const main = polyline(s.ax, s.ay, s.bx, s.by, s.bow * R(0.75, 1.2), s.ux, s.uy, s.jit, s.levels);
        const mp = new Path2D();
        addTo(mp, main);
        const n = main.length / 2 - 1;
        const nb = s.branches ? Math.max(1, Math.round(s.branches * R(0.5, 1))) : 0;
        const bp = nb ? new Path2D() : null;
        for (let b = 0; b < nb; b++) {
          const i = 1 + Math.floor(R(0.08, 0.7) * n);
          const j = Math.min(n, i + 3);
          const px = main[i * 2];
          const py = main[i * 2 + 1];
          let dx = main[j * 2] - px;
          let dy = main[j * 2 + 1] - py;
          const dl = Math.hypot(dx, dy) || 1;
          dx /= dl; dy /= dl;
          // Fork off to one side, towards the side the arc prefers when it has one.
          let turn = R(0.35, 0.95) * (rnd() < 0.5 ? -1 : 1);
          if (s.bu && (dx * Math.cos(turn) - dy * Math.sin(turn)) * s.bu[0] + (dx * Math.sin(turn) + dy * Math.cos(turn)) * s.bu[1] < 0) turn = -turn;
          const bl = len * R(0.1, 0.3);
          const ex = px + (dx * Math.cos(turn) - dy * Math.sin(turn)) * bl;
          const ey = py + (dx * Math.sin(turn) + dy * Math.cos(turn)) * bl;
          const pts = polyline(px, py, ex, ey, bl * R(-0.12, 0.12), 0, -1, s.jit * 1.3, Math.max(2, s.levels - 2));
          addTo(bp, pts);
        }
        v.push({ main: mp, br: bp });
      }
      return { v: v, ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, len: len, w: s.w || 1, edge: s.edge == null ? -1 : s.edge };
    }

    // Where arcs can leap. Each gives the ends, how much it bows and which way, and how jagged it is.
    const spec = {
      // the thunderclap: from the impact along the ground out to the side of the picture
      ground(side) {
        const ay = gy + R(-0.01, 0.02) * H;
        return { ax: gx + side * R(0.02, 0.07) * W, ay: ay, bx: side < 0 ? -30 : W + 30, by: Math.min(H + 10, ay + R(-0.12, 0.06) * H), bow: R(0.03, 0.07) * W, ux: 0, uy: -1, jit: 0.05, levels: 6, branches: 4, w: 1.25 };
      },
      // the thunderclap: from beside the impact up to the edge of the picture
      rise(side) {
        return { ax: gx + side * R(0.1, 0.2) * W, ay: gy - R(0, 0.04) * H, bx: side < 0 ? -20 : W + 20, by: R(0.14, 0.42) * H, bow: R(0.05, 0.11) * W, ux: side, uy: 1, jit: 0.055, levels: 6, branches: 5, w: 1.2 };
      },
      // down one side of the words, bowing out
      side(side) {
        const x0 = side < 0 ? tx0 - gap : tx1 + gap;
        const x1 = side < 0 ? yx0 - gap : yx1 + gap;
        const ya = lerp(ty0, ty1, R(0.15, 0.75));
        const yb = year ? lerp(yy0, yy1, R(0.35, 0.95)) : ty1 + L.titleSize * R(0.6, 1);
        return { ax: x0, ay: ya, bx: x1, by: yb, bow: R(0.25, 0.5) * Math.hypot(x1 - x0, yb - ya) + gap, ux: side, uy: 0, jit: 0.09, levels: 5, branches: 2, bu: [side, 0] };
      },
      // over the title, bowing up like an arc between two electrodes
      crown() {
        const w = tx1 - tx0;
        const span = w * R(0.22, 0.5);
        const xa = tx0 + rnd() * (w - span);
        const y0 = ty0 - gap * R(0.6, 1.1);
        return { ax: xa, ay: y0 + R(-0.3, 0.3) * gap, bx: xa + span, by: y0 + R(-0.3, 0.3) * gap, bow: span * R(0.14, 0.3), ux: 0, uy: -1, jit: 0.1, levels: 5, branches: 2, bu: [0, -1] };
      },
      // a discharge leaping up from the top of the title into the picture
      spire() {
        const x = lerp(tx0, tx1, R(0.04, 0.96));
        const y = ty0 - gap * 0.3;
        const len = R(0.12, 0.26) * H;
        const ang = -Math.PI / 2 + R(-0.55, 0.55);
        return { ax: x, ay: y, bx: x + Math.cos(ang) * len, by: y + Math.sin(ang) * len, bow: R(-0.15, 0.15) * len, ux: 1, uy: 0, jit: 0.1, levels: 5, branches: 3, bu: [0, -1] };
      },
      // a great arch over the whole title
      arch() {
        const ya = lerp(ty0, ty1, 0.4);
        return { ax: tx0 - gap, ay: ya, bx: tx1 + gap, by: ya + R(-0.5, 0.5) * gap, bow: R(0.22, 0.34) * Math.min(W, H), ux: 0, uy: -1, jit: 0.065, levels: 6, branches: 5, bu: [0, -1], w: 1.2 };
      },
      // from the end of a line of words out to the side of the picture
      flank(side) {
        const top = !year || rnd() < 0.6;
        const xa = side < 0 ? (top ? tx0 : yx0) - gap : (top ? tx1 : yx1) + gap;
        const ya = top ? lerp(ty0, ty1, R(0.2, 0.8)) : lerp(yy0, yy1, R(0.2, 0.8));
        const xb = side < 0 ? -25 : W + 25;
        const yb = clamp(ya + R(-0.3, 0.2) * H, 0.08 * H, 0.98 * H);
        return { ax: xa, ay: ya, bx: xb, by: yb, bow: R(-0.1, 0.1) * Math.abs(xb - xa), ux: 0, uy: -1, jit: 0.06, levels: 6, branches: 3, w: 1.15 };
      },
      // along an edge of the picture (0 left, 1 right, 2 top, 3 bottom), bowing a little inwards
      edge(e) {
        const m = R(4, 12) * S;
        if (e < 2) {
          const ya = R(0.03, 0.5) * H;
          const x = e === 0 ? m : W - m;
          return { ax: x, ay: ya, bx: x, by: Math.min(H - m, ya + R(0.25, 0.5) * H), bow: R(0.02, 0.05) * H, ux: e === 0 ? 1 : -1, uy: 0, jit: 0.04, levels: 6, branches: 3, bu: [e === 0 ? 1 : -1, 0], edge: e, w: 0.95 };
        }
        const xa = R(0.03, 0.55) * W;
        const y = e === 2 ? m : H - m;
        return { ax: xa, ay: y, bx: Math.min(W - m, xa + R(0.22, 0.42) * W), by: y, bow: R(0.012, 0.035) * W, ux: 0, uy: e === 2 ? 1 : -1, jit: 0.035, levels: 6, branches: 3, bu: [0, e === 2 ? 1 : -1], edge: e, w: 0.95 };
      },
      // under the lower line, sagging towards the ground
      under() {
        const w = yx1 - yx0;
        const span = w * R(0.35, 0.75);
        const xa = yx0 + rnd() * (w - span);
        const y0 = yy1 + gap * R(0.4, 0.8);
        return { ax: xa, ay: y0, bx: xa + span, by: y0, bow: span * R(0.1, 0.22), ux: 0, uy: 1, jit: 0.09, levels: 5, branches: 2, bu: [0, 1] };
      }
    };

    // Every flash of every bolt: start (ms), duration, bolt, version, peak, kind (0 a strike that
    // dies away, 1 one hop of a live arc that holds).
    const fl = [];
    const sparkAt = [];                                          // where strikes throw sparks
    function strike(t0, s, peak, strokes) {
      const b = bolts.length;
      bolts.push(makeBolt(s));
      const n = strokes || 1 + Math.floor(rnd() * 2.6);
      let t = t0;
      for (let j = 0; j < n; j++) {
        const dur = j === n - 1 ? R(180, 320) : R(70, 120);
        fl.push([t, dur, b, j % 3, peak * (1 - 0.12 * j), 0]);
        t += dur + R(15, 60);                                    // dark for an instant, then again
      }
      sparkAt.push(t0, s.ax, s.ay, t0 + 10, s.bx, s.by);
    }
    function crawl(t0, s, peak, len) {
      const b = bolts.length;
      bolts.push(makeBolt(s));
      const hop = R(45, 70);
      let j = 0;
      for (let t = t0; t < t0 + len; t += hop, j++) {
        const k = Math.min(1, (t - t0) / 80, (t0 + len - t) / 160);
        fl.push([t, hop + 8, b, j % 3, peak * Math.max(0.25, k), 1]);
      }
    }

    // The thunderclap: arcs race out from the impact along the ground and up to the edges.
    strike(0, spec.ground(-1), 1, 3);
    strike(20, spec.ground(1), 1, 3);
    strike(70, spec.rise(-1), 0.95, 2);
    strike(110, spec.rise(1), 0.95, 2);
    strike(330, spec.edge(3), 0.8, 1);
    strike(430, spec.side(-1), 0.9, 2);
    strike(500, spec.side(1), 0.9, 2);
    strike(640, spec.edge(0), 0.8, 2);
    strike(700, spec.edge(1), 0.8, 2);
    strike(780, spec.crown(), 0.9, 2);
    // Then the words crackle: live arcs hug them one after another, now here, now there ...
    const quiet = (t) => t > MID - 200 && t < MID + 520;                   // room for the surge
    let lastSide = 1;
    for (let tq = 900; tq < STRIKES_END; ) {
      const late = smooth(STRIKES_END - 2800, STRIKES_END, tq);            // fewer and weaker at the end
      if (!quiet(tq)) {
        const r = rnd();
        let s;
        if (r < 0.3) s = spec.crown();
        else if (r < 0.55) { lastSide = -lastSide; s = spec.side(lastSide); }
        else if (r < 0.8) s = spec.spire();
        else s = spec.under();
        crawl(tq, s, lerp(0.95, 0.6, late) * R(0.8, 1), R(600, 1100) * (1 - late * 0.4));
      }
      tq += R(290, 540) * (1 + late * 1.2);
    }
    // ... and it strikes around them and along the edges of the picture.
    let arches = 0;
    for (let tq = 1150; tq < STRIKES_END; ) {
      const late = smooth(STRIKES_END - 2800, STRIKES_END, tq);
      if (!quiet(tq)) {
        const r = rnd();
        let s;
        if (r < 0.06 && arches < 2 && late < 0.3) { s = spec.arch(); arches++; }
        else if (r < 0.5) { const e = rnd(); s = spec.edge(e < 0.32 ? 0 : e < 0.64 ? 1 : e < 0.82 ? 2 : 3); }
        else if (r < 0.8) s = spec.flank(rnd() < 0.5 ? -1 : 1);
        else if (r < 0.9) s = spec.crown();
        else s = spec.side(rnd() < 0.5 ? -1 : 1);
        strike(tq, s, lerp(1, 0.6, late) * R(0.8, 1));
      }
      tq += R(360, 720) * (1 + late * 1.5);
    }
    // ... and half-way through it surges again.
    strike(MID, spec.flank(-1), 1, 3);
    strike(MID + 60, spec.flank(1), 1, 3);
    strike(MID + 170, spec.arch(), 1, 3);
    strike(MID + 300, spec.under(), 0.9, 2);
    strike(MID + 420, spec.edge(2), 0.85, 2);

    const NF = fl.length;
    const fS = new Float32Array(NF), fD = new Float32Array(NF), fP = new Float32Array(NF);
    const fB = new Uint16Array(NF), fV = new Uint8Array(NF), fK = new Uint8Array(NF);
    for (let i = 0; i < NF; i++) { fS[i] = fl[i][0]; fD[i] = fl[i][1]; fB[i] = fl[i][2]; fV[i] = fl[i][3]; fP[i] = fl[i][4]; fK[i] = fl[i][5]; }
    const actB = new Uint16Array(NF), actV = new Uint8Array(NF), actI = new Float32Array(NF);
    const edgeBoost = new Float32Array(4);

    /* -- the shockwave rings: start, duration, reach, width, strength, flatness -- */
    const rings = [
      [0, 1200, 0.62 * W, 13, 1, 0.2],
      [120, 1450, 0.76 * W, 8, 0.75, 0.22],
      [0, 900, 1.2 * Math.max(W, H), 3, 0.5, 1],                // the blast in the air, a full circle
      [MID, 1100, 0.56 * W, 10, 0.85, 0.2],
      [MID + 130, 1300, 0.68 * W, 6, 0.55, 0.22]
    ];
    // a ripple along the ground on every beat, at the top of each pulse
    for (let tb = 1000 + BEAT / 4; tb < STRIKES_END - 600; tb += BEAT) {
      if (Math.abs(tb - MID) > 700) rings.push([tb, 1400, 0.46 * W, 4, 0.32, 0.2]);
    }

    /* -- embers (glowing points) and shards (glassy splinters), all on fixed paths -- */
    const NE = 1100;
    const eT = new Float32Array(NE), eX = new Float32Array(NE), eY = new Float32Array(NE);
    const eVX = new Float32Array(NE), eVY = new Float32Array(NE), eVT = new Float32Array(NE), eK = new Float32Array(NE);
    const eL = new Float32Array(NE), eS = new Float32Array(NE), eWA = new Float32Array(NE), eWF = new Float32Array(NE), eWP = new Float32Array(NE);
    const eC = new Uint8Array(NE), eFront = new Uint8Array(NE);
    let ne = 0;
    function ember(t0, x, y, vx, vy, vt, k, life, size, front, c) {
      if (ne >= NE) return;
      eT[ne] = t0; eX[ne] = x; eY[ne] = y; eVX[ne] = vx; eVY[ne] = vy; eVT[ne] = vt; eK[ne] = k;
      eL[ne] = life; eS[ne] = size; eWA[ne] = R(4, 16) * S; eWF[ne] = R(1.5, 4.5); eWP[ne] = R(0, 6.283);
      const p = rnd();
      eC[ne] = c != null ? c : p < 0.5 ? 0 : p < 0.8 ? 1 : 2;
      eFront[ne] = front;
      ne++;
    }
    function burst(t0, count, speed, spread) {
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + R(-1.25, 1.25);
        const v = R(0.22, 1) * speed * S;
        ember(t0 + R(0, 120), gx + R(-1, 1) * spread * W, gy + R(-0.01, 0.02) * H, Math.cos(a) * v * 1.25, Math.sin(a) * v,
          R(30, 90) * S, R(1.6, 2.6), R(1.4, 3.2), R(5, 12) * S, rnd() < 0.25 ? 1 : 0);
      }
    }
    burst(0, 130, 1150, 0.07);
    burst(MID, 80, 850, 0.05);
    // a steady rise from below the picture, and some already on their way up
    for (let i = 0; i < 280; i++) {
      const high = rnd() < 0.4;
      ember(R(150, STRIKES_END + 300), R(0.02, 0.98) * W, high ? R(0.25, 1) * H : H + R(0, 0.05) * H, R(-20, 20) * S, -R(40, 140) * S,
        R(40, 130) * S, 0.6, R(3.5, 6.5), R(4, 10) * S, 0);
    }
    // big soft embers, out of focus, drifting past in front
    for (let i = 0; i < 14; i++) {
      ember(R(300, STRIKES_END - 1500), R(0.05, 0.95) * W, R(0.55, 1.05) * H, R(-12, 12) * S, -R(20, 50) * S, R(25, 60) * S, 0.5, R(3.5, 6), R(26, 52) * S, 2, 3);
    }
    // sparks lifting off the letters
    for (let i = 0; i < 120 && NP; i++) {
      const p = Math.floor(rnd() * NP);
      ember(R(800, DURATION - 2000), P[p * 2], P[p * 2 + 1], R(-25, 25) * S, -R(20, 90) * S, R(30, 80) * S, 1, R(0.8, 2), R(3, 7) * S, 1);
    }
    // at the end the energy leaves the letters as sparks drifting up and away
    for (let i = 0; i < 110 && NP; i++) {
      const p = Math.floor(rnd() * NP);
      ember(R(FADE_AT - 500, FADE_AT + 500), P[p * 2], P[p * 2 + 1], R(-30, 30) * S, -R(40, 140) * S, R(50, 110) * S, 0.9, R(1.4, 2.4), R(3.5, 8) * S, 1);
    }
    // sparks thrown where an arc touches down
    for (let i = 0; i < sparkAt.length; i += 3) {
      const x = sparkAt[i + 1];
      const y = sparkAt[i + 2];
      if (x < 0 || x > W || y < 0 || y > H) continue;
      for (let k = 0; k < 3; k++) {
        const a = R(0, 6.283);
        const v = R(80, 380) * S;
        ember(sparkAt[i] + R(0, 40), x, y, Math.cos(a) * v, Math.sin(a) * v - 60 * S, R(10, 40) * S, 3, R(0.5, 1.1), R(3, 6) * S, 1);
      }
    }

    const NS = 96;
    const sT = new Float32Array(NS), sX = new Float32Array(NS), sY = new Float32Array(NS), sVX = new Float32Array(NS), sVY = new Float32Array(NS);
    const sVT = new Float32Array(NS), sK = new Float32Array(NS), sL = new Float32Array(NS), sSz = new Float32Array(NS);
    const sA = new Float32Array(NS), sW = new Float32Array(NS), sP = new Float32Array(NS), sQ = new Float32Array(NS);
    const sN = new Uint8Array(NS), sShape = new Float32Array(NS * 8), sC = new Uint8Array(NS);
    let ns = 0;
    function shard(t0, x, y, vx, vy, vt, k, life, size) {
      if (ns >= NS) return;
      sT[ns] = t0; sX[ns] = x; sY[ns] = y; sVX[ns] = vx; sVY[ns] = vy; sVT[ns] = vt; sK[ns] = k; sL[ns] = life; sSz[ns] = size;
      sA[ns] = R(0, 6.283); sW[ns] = R(1.5, 5) * (rnd() < 0.5 ? -1 : 1);     // spin
      sP[ns] = R(0, 6.283); sQ[ns] = R(2.5, 7) * (rnd() < 0.5 ? -1 : 1);     // tumble
      // A long splinter: one sharp point, two or three short ones.
      const nv = rnd() < 0.55 ? 3 : 4;
      sN[ns] = nv;
      let ang = R(-0.15, 0.15);
      for (let v = 0; v < nv; v++) {
        const rad = v === 0 ? 1 : R(0.25, 0.6);
        sShape[ns * 8 + v * 2] = Math.cos(ang) * rad;
        sShape[ns * 8 + v * 2 + 1] = Math.sin(ang) * rad * 0.42;
        ang += (6.283 / nv) * R(0.75, 1.25);
      }
      sC[ns] = Math.floor(rnd() * 3);
      ns++;
    }
    for (let i = 0; i < 36; i++) {
      const a = -Math.PI / 2 + R(-1.1, 1.1);
      const v = R(0.3, 1) * 1300 * S;
      shard(R(0, 80), gx + R(-0.08, 0.08) * W, gy + R(-0.01, 0.01) * H, Math.cos(a) * v * 1.2, Math.sin(a) * v, R(25, 70) * S, R(1.3, 2), R(2.4, 4.6), R(10, 24) * S);
    }
    for (let i = 0; i < 18; i++) {
      const a = -Math.PI / 2 + R(-1, 1);
      const v = R(0.3, 1) * 900 * S;
      shard(MID + R(0, 80), gx + R(-0.06, 0.06) * W, gy, Math.cos(a) * v * 1.2, Math.sin(a) * v, R(25, 70) * S, R(1.3, 2), R(2, 3.8), R(8, 20) * S);
    }
    for (let i = 0; i < 28; i++) {
      shard(R(400, STRIKES_END), R(0.04, 0.96) * W, H + R(0.01, 0.05) * H, R(-15, 15) * S, -R(50, 120) * S, R(40, 100) * S, 0.7, R(4, 6.5), R(7, 16) * S);
    }

    /* -- light on the letters -- */
    const sweepC = new Float32Array(NP);       // the slanted line the shimmer sweeps along
    const wDist = new Float32Array(NP);        // distance from the impact, for the surge waves
    let cMin = Infinity, cMax = -Infinity;
    for (let i = 0; i < NP; i++) {
      const x = P[i * 2];
      const y = P[i * 2 + 1];
      const c = x + (y - L.titleY) * 0.45;
      sweepC[i] = c;
      if (c < cMin) cMin = c;
      if (c > cMax) cMax = c;
      wDist[i] = Math.hypot(x - gx, y - gy);
    }
    const NT = Math.min(200, NP);
    const twI = new Uint16Array(NT), twF = new Float32Array(NT), twP = new Float32Array(NT);
    for (let i = 0; i < NT; i++) { twI[i] = Math.floor(rnd() * NP); twF[i] = R(3.5, 8); twP[i] = R(0, 6.283); }

    // Little arcs crawling over the letters, in crackling bursts.
    const micro = [];
    for (let tc = 900; tc < DURATION - 1900 && NP > 20; tc += R(80, 260)) {
      const n = 2 + Math.floor(rnd() * 4);
      for (let b = 0; b < n; b++) {
        const i = Math.floor(rnd() * NP);
        const dir = rnd() < 0.5 ? -1 : 1;
        const k = 3 + Math.floor(rnd() * 9);
        let j = i + dir * k;
        if (j < 0 || j >= NP) j = i - dir * k;
        if (j < 0 || j >= NP) continue;
        const ax = P[i * 2], ay = P[i * 2 + 1], bx = P[j * 2], by = P[j * 2 + 1];
        const dd = Math.hypot(bx - ax, by - ay);
        if (dd < step * 2 || dd > step * 16) continue;     // the next row or across a gap: skip it
        const a = new Path2D();
        const c = new Path2D();
        addTo(a, polyline(ax, ay, bx, by, R(-0.3, 0.3) * dd, 0, -1, 0.22, 3));
        addTo(c, polyline(ax, ay, bx, by, R(-0.3, 0.3) * dd, 0, -1, 0.22, 3));
        micro.push({ t: tc + R(-60, 120), d: R(70, 160), a: a, b: c });
      }
    }

    // Waves of light running out through the letters from the impact: [start, speed px/ms, width, strength].
    const waves = [[MID + 40, 1.7, 60, 1]];   // (the words arrive white hot: a wave would not show then)

    /* ---------------------------------------------------------- draw --- */

    /** Which bolts are lit at t, and how brightly. Returns how many. */
    function activeBolts(t) {
      let na = 0;
      edgeBoost[0] = edgeBoost[1] = edgeBoost[2] = edgeBoost[3] = 0;
      for (let i = 0; i < NF; i++) {
        const tau = t - fS[i];
        if (tau < 0 || tau >= fD[i]) continue;
        let on = 1;
        if (fK[i] === 0 && tau > 25) on = Math.exp(-(tau - 25) / (fD[i] * 0.4));
        const I = fP[i] * on * (0.7 + 0.3 * hash01(Math.floor(t / 34) * 13 + i));
        if (I < 0.03) continue;
        actB[na] = fB[i];
        actV[na] = fV[i];
        actI[na] = I;
        na++;
        const e = bolts[fB[i]].edge;
        if (e >= 0) edgeBoost[e] += I;
      }
      return na;
    }

    function drawFlash(t) {
      // a green thunderclap: the whole picture lights up for an instant, twice
      const a = 0.16 * Math.exp(-t / 60) + 0.07 * bump(t, 125, 35);
      if (t > 240 || a < 0.004) return 0;
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgb(70,255,150)';
      ctx.fillRect(0, 0, W, H);
      return 1;
    }

    // The beat: a short pulse every BEAT ms while the words hold.
    function throb(t) {
      if (t < 1000 || t > STRIKES_END) return 0;
      const s = Math.sin(((t - 1000) / BEAT) * Math.PI * 2);
      return s > 0 ? s * s * s * s * s * s : 0;
    }

    function drawRadiance(t, fade, boost) {
      const base = (0.42 + 0.3 * throb(t)) * smooth(170, 700, t);
      const flare = 0.6 * smooth(170, 300, t) * (1 - smooth(320, 1700, t)) + 0.55 * bump(t, MID + 100, 260);
      const a = Math.min(1, base + flare + 0.15 * Math.min(1.5, boost)) * fade * (1 - smooth(FADE_AT - 700, FADE_AT + 600, t));
      if (a < 0.01) return 0;
      const r = pre.radiance;
      ctx.globalAlpha = a;
      ctx.drawImage(r.canvas, r.x, r.y, r.w, r.h);
      return 1;
    }

    function drawEdges(fade) {
      let n = 0;
      // wherever an arc runs along an edge, the edge lights up
      for (let e = 0; e < 4; e++) {
        const a = Math.min(0.45, 0.3 * edgeBoost[e]) * fade;
        if (a < 0.01) continue;
        const s = pre.edges[e];
        ctx.globalAlpha = a;
        ctx.drawImage(s.canvas, s.x, s.y, s.w, s.h);
        n++;
      }
      return n;
    }

    function drawRings(t, fade, lo) {
      let n = 0;
      for (let k = 0; k < rings.length; k++) {
        const g = rings[k];
        const u = (t - g[0]) / g[1];
        if (u <= 0 || u >= 1) continue;
        const r = 20 * S + (g[2] - 20 * S) * easeOut(u);
        const a = g[4] * Math.pow(1 - u, 1.7) * fade;
        const w = (g[3] * (1 - u) + 1.2) * S;
        ctx.beginPath();
        ctx.ellipse(gx, gy, r, r * g[5], 0, 0, Math.PI * 2);
        if (!lo && g[5] < 1) {
          ctx.strokeStyle = RING_GLOW;
          ctx.lineWidth = w * 3.4;
          ctx.globalAlpha = Math.min(1, a * 0.26);
          ctx.stroke();
          n++;
        }
        ctx.strokeStyle = g[5] < 1 ? RING_CORE : RING_GLOW;
        ctx.lineWidth = Math.max(hair, w * 0.45);
        ctx.globalAlpha = Math.min(1, a * 0.9);
        ctx.stroke();
        n++;
      }
      return n;
    }

    function drawImpact(t, fade) {
      let n = 0;
      for (let k = 0; k < 2; k++) {
        const t0 = k ? MID : 0;
        const tau = t - t0;
        if (tau < 0 || tau > 1000) continue;
        const str = k ? 0.65 : 1;
        const s = (k ? 240 : 330) * S * (0.55 + 0.45 * Math.exp(-tau / 160));
        ctx.globalAlpha = 0.95 * str * Math.exp(-tau / 260) * fade;
        ctx.drawImage(T.hot, gx - s / 2, gy - s / 2, s, s);
        const sw = 1.6 * W * str * (0.6 + 0.4 * easeOut(Math.min(1, tau / 220)));
        const sh = 34 * S * (1 - 0.5 * tau / 1000);
        ctx.globalAlpha = 0.7 * str * Math.exp(-tau / 300) * fade;
        ctx.drawImage(T.streak, gx - sw / 2, gy - sh / 2, sw, sh);
        n += 2;
      }
      return n;
    }

    function drawBolts(fade, lo, na) {
      let n = 0;
      if (!lo) {
        // the strongest flashes bloom
        ctx.strokeStyle = BOLT_BLOOM;
        let blooms = 0;
        for (let k = 0; k < na && blooms < 2; k++) {
          if (actI[k] < 0.65) continue;
          blooms++;
          const b = bolts[actB[k]];
          ctx.globalAlpha = Math.min(1, 0.1 * actI[k] * fade);
          ctx.lineWidth = 20 * S * b.w;
          ctx.stroke(b.v[actV[k]].main);
          n++;
        }
      }
      ctx.strokeStyle = BOLT_GLOW;
      for (let k = 0; k < na; k++) {
        const b = bolts[actB[k]];
        ctx.globalAlpha = Math.min(1, 0.38 * actI[k] * fade);
        ctx.lineWidth = 8 * S * b.w;
        ctx.stroke(b.v[actV[k]].main);
        n++;
      }
      ctx.strokeStyle = BOLT_MID;
      for (let k = 0; k < na; k++) {
        const b = bolts[actB[k]];
        ctx.globalAlpha = Math.min(1, 0.75 * actI[k] * fade);
        ctx.lineWidth = 2.4 * S * b.w;
        ctx.stroke(b.v[actV[k]].main);
        n++;
      }
      ctx.lineWidth = hair;
      for (let k = 0; k < na; k++) {
        const v = bolts[actB[k]].v[actV[k]];
        ctx.strokeStyle = BOLT_CORE;
        ctx.globalAlpha = Math.min(1, 1.15 * actI[k] * fade);
        ctx.stroke(v.main);
        n++;
        if (v.br) {
          ctx.strokeStyle = BOLT_BRANCH;
          ctx.globalAlpha = Math.min(1, 0.9 * actI[k] * fade);
          ctx.stroke(v.br);
          n++;
        }
      }
      // white heat where each arc touches
      for (let k = 0; k < na; k++) {
        const b = bolts[actB[k]];
        const I = actI[k] * fade;
        const s = 34 * S * (0.6 + I) * b.w;
        ctx.globalAlpha = Math.min(1, 0.6 * I);
        ctx.drawImage(T.hot, b.ax - s / 2, b.ay - s / 2, s, s);
        ctx.drawImage(T.hot, b.bx - s / 2, b.by - s / 2, s, s);
        n += 2;
      }
      return n;
    }

    // At the end a breeze carries everything that floats off to the right.
    const WIND_FROM = DURATION - 3200;
    function windAt(t) {
      const s = Math.max(0, (t - WIND_FROM) / 1000);
      return 22 * S * s * s;
    }

    function drawShards(t, fade, lo) {
      let n = 0;
      const wind = windAt(t);
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = SHARD_COLORS[c];
        for (let i = 0; i < ns; i++) {
          if (sC[i] !== c || (lo && (i & 1))) continue;
          const tau = (t - sT[i]) / 1000;
          if (tau <= 0 || tau >= sL[i]) continue;
          const k = sK[i];
          const e = Math.exp(-k * tau);
          const f = (1 - e) / k;
          const x = sX[i] + sVX[i] * f + (wind - windAt(sT[i]));
          const y = sY[i] + sVY[i] * f - sVT[i] * (tau - f);
          const life = sL[i];
          const a = Math.min(1, tau / 0.1) * (1 - smooth(life * 0.6, life, tau)) * fade;
          if (a < 0.01) continue;
          const th = sA[i] + sW[i] * tau;
          const face = Math.cos(sP[i] + sQ[i] * tau);
          const lit = Math.abs(face);
          const ct = Math.cos(th);
          const st = Math.sin(th);
          const z = sSz[i];
          const o = i * 8;
          // its own glow (the bigger ones), then the splinter
          if (z > 12 * S) {
            const gs = z * 2.6;
            ctx.globalAlpha = a * (0.18 + 0.3 * lit);
            ctx.drawImage(T.ember[c], x - gs / 2, y - gs / 2, gs, gs);
            n++;
          }
          ctx.beginPath();
          for (let v = 0; v < sN[i]; v++) {
            const ux = sShape[o + v * 2] * z;
            const uy = sShape[o + v * 2 + 1] * z * face;
            if (v === 0) ctx.moveTo(x + ux * ct - uy * st, y + ux * st + uy * ct);
            else ctx.lineTo(x + ux * ct - uy * st, y + ux * st + uy * ct);
          }
          ctx.closePath();
          ctx.globalAlpha = a * (0.4 + 0.6 * lit);
          ctx.fill();
          n++;
          if (lit > 0.93) {
            // catching the light
            const g = z * 2.4;
            ctx.globalAlpha = a * 0.7;
            ctx.drawImage(T.hot, x - g / 2, y - g / 2, g, g);
            n++;
          }
        }
      }
      return n;
    }

    function drawEmbers(t, fade, lo, front) {
      let n = 0;
      const wind = windAt(t);
      for (let i = 0; i < ne; i++) {
        if (eFront[i] !== front || (lo && (i & 1))) continue;
        const tau = (t - eT[i]) / 1000;
        if (tau <= 0 || tau >= eL[i]) continue;
        const k = eK[i];
        const e = Math.exp(-k * tau);
        const f = (1 - e) / k;
        const life = eL[i];
        const wob = eWA[i] * Math.min(1, tau) * Math.sin(eWP[i] + eWF[i] * tau);
        const x = eX[i] + eVX[i] * f + wob + (wind - windAt(eT[i]));
        const y = eY[i] + eVY[i] * f - eVT[i] * (tau - f);
        let a = Math.min(1, tau / 0.12) * (1 - smooth(life * 0.55, life, tau)) * (0.72 + 0.28 * Math.sin(eWP[i] * 3 + tau * 9)) * fade;
        if (front === 2) a *= 0.22;                              // the big soft ones are only a haze
        if (a < 0.01) continue;
        const s = eS[i] * (1 - 0.45 * tau / life);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(eC[i] === 3 ? T.glow : T.ember[eC[i]], x - s, y - s, s * 2, s * 2);
        n++;
      }
      return n;
    }

    function drawWords(t, fade) {
      const a = smooth(70, 150, t) * fade;
      if (a <= 0.003) return 0;
      // White heat cooling to green, and a flash of heat again in the surge. Stamped at full strength
      // whenever possible and never scaled: a stretched or faded stamp costs two to five times what a
      // plain copy does.
      const hot = t < 450 ? 1 : Math.min(1, 1 - smooth(450, 800, t) + 0.6 * bump(t, MID + 90, 110));
      if (hot >= 0.995) { env.words(a, HOT, 1); return 1; }
      env.words(a, FILL, 1);
      if (hot > 0.01) { env.words(a * hot, HOT, 1); return 2; }
      return 1;
    }

    function drawWordLight(t, fade, lo) {
      if (!NP) return 0;
      const wa = smooth(120, 420, t) * fade;
      if (wa <= 0.01) return 0;
      let n = 0;
      const spr = T.ember[2];
      const sz = step * 3;
      const stride = lo ? 6 : 3;
      // waves of light running out through the letters from the impact
      for (let w = 0; w < waves.length; w++) {
        const wv = waves[w];
        const tau = t - wv[0];
        if (tau <= 0 || tau > 900) continue;
        const r = tau * wv[1] * S;
        const width = wv[2] * S;
        const str = wv[3] * (1 - tau / 900) * wa;
        for (let i = 0; i < NP; i += stride + 2) {
          const d = (wDist[i] - r) / width;
          if (d < -1.5 || d > 1.5) continue;
          ctx.globalAlpha = Math.min(1, Math.exp(-d * d * 1.6) * str);
          ctx.drawImage(spr, P[i * 2] - sz, P[i * 2 + 1] - sz, sz * 2, sz * 2);
          n++;
        }
      }
      // a shimmer sweeping across the words every few seconds
      if (t > 1500 && t < FADE_AT + 300) {
        const p = ((t - 1500) % 2600) / 1200;
        if (p <= 1) {
          const band = Math.max(20, (cMax - cMin) * 0.07);
          const at = cMin - band * 2 + p * (cMax - cMin + band * 4);
          for (let i = 0; i < NP; i += stride) {
            const d = (sweepC[i] - at) / band;
            if (d < -1.6 || d > 1.6) continue;
            ctx.globalAlpha = Math.exp(-d * d * 2.2) * 0.5 * wa;
            ctx.drawImage(spr, P[i * 2] - sz, P[i * 2 + 1] - sz, sz * 2, sz * 2);
            n++;
          }
        }
      }
      // sparkles that come and go on the letters
      for (let k = 0; k < NT; k += lo ? 2 : 1) {
        const b = Math.sin(twP[k] + t * 0.001 * twF[k]);
        if (b < 0.82) continue;
        const i = twI[k];
        const q = (b - 0.82) / 0.18;
        const s = sz * (0.6 + 0.5 * q);
        ctx.globalAlpha = q * 0.8 * wa;
        ctx.drawImage(T.hot, P[i * 2] - s, P[i * 2 + 1] - s, s * 2, s * 2);
        n++;
      }
      // electricity crawling over them
      for (let m = 0; m < micro.length; m++) {
        const mc = micro[m];
        const tau = t - mc.t;
        if (tau < 0 || tau > mc.d) continue;
        const a = (1 - tau / mc.d) * (0.6 + 0.4 * hash01(Math.floor(t / 30) + m)) * wa;
        const path = Math.floor(tau / 40) & 1 ? mc.b : mc.a;
        if (!lo) {
          ctx.globalAlpha = a * 0.5;
          ctx.lineWidth = 3.4 * S;
          ctx.strokeStyle = BOLT_GLOW;
          ctx.stroke(path);
          n++;
        }
        ctx.globalAlpha = Math.min(1, a);
        ctx.lineWidth = hair;
        ctx.strokeStyle = BOLT_CORE;
        ctx.stroke(path);
        n++;
      }
      return n;
    }

    function draw(t) {
      if (!(t >= 0) || t >= GONE_AT) return 0;
      const fade = 1 - smooth(FADE_AT, GONE_AT, t);
      const lo = env.low();
      const na = activeBolts(t);
      let boost = 0;
      for (let k = 0; k < na; k++) boost += actI[k];
      let n = 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      n += drawFlash(t);
      n += drawRadiance(t, fade, boost * 0.4);
      n += drawEdges(fade);
      n += drawRings(t, fade, lo);
      n += drawImpact(t, fade);
      n += drawBolts(fade, lo, na);
      n += drawShards(t, fade, lo);
      n += drawEmbers(t, fade, lo, 0);
      ctx.restore();
      n += drawWords(t, fade);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      n += drawWordLight(t, fade, lo);
      n += drawEmbers(t, fade, lo, 1);
      if (!lo) n += drawEmbers(t, fade, lo, 2);
      ctx.restore();
      return n;
    }

    return {
      step: function () { /* every frame is worked out from t alone */ },
      draw: draw,
      // Before midnight: the words in both fills are made ahead of time (the points on them and the
      // glow are already made by create()), and a few moments are drawn once so that everything is
      // warmed up: the first frame at midnight has nothing slow left to do. All of it is cleared
      // again in the same task, so none of it is ever seen.
      prime: function () {
        ctx.save();
        ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
        try {
          env.words(1, FILL, 1);
          env.words(1, HOT, 1);
          draw(60);
          draw(650);
          draw(3000);
          draw(MID + 120);
        } finally {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.restore();
        }
      }
    };
  }

  FX.register('gamma', { name: 'Gamma', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
