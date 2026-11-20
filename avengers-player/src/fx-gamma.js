/*!
 * Avengers Player: 'gamma', a gamma surge at the instant of the snap.
 *
 * Smash, then strike. At midnight a green thunderclap cracks across the sky and the year comes down
 * out of it: the digits plunge in at the top of the picture one after another, white-hot with green
 * trails, and hit the ground one, two, three, four, each slamming a ring out from under it. As the
 * last one lands the shock goes off: heavy rings slam out, the digits jolt and settle, arcs race away
 * along the ground and glassy shards fly. Then lightning writes the title: for each letter in turn
 * the air charges, a bolt feels its way down from the sky and hits it (now and then one fork hits
 * two), the charge pours into the letter from where it was hit, and it flashes white-hot and cools to
 * pale lime. From then on the words burn in a glow of their own that beats like a heart: lightning
 * leaps around them and along the edges of the picture, electricity crawls over the letters, embers
 * and shards rise, and half-way through it all surges again. At the end the arcs die down and the
 * letters short out one by one, left to right, in a last crackle and a spray of sparks. (No year: the
 * thunderclap is a bolt into the ground under the words, and the lightning writes the title.) The
 * year is only ever the one given: there is no old year rolling over.
 *
 * Light only, the movie is under the canvas: everything but the letters is added with 'lighter'.
 * Every bolt, letter and particle path is worked out in create(), and the frame for a time t depends
 * only on the seed and t (nothing is simulated from frame to frame, so step() has nothing to do).
 *
 * Speed, measured on a software-rendered canvas: a long stroke costs about the same whatever its
 * width, a 1-pixel one a sixth of that, and a stretched image several times more per pixel than
 * one drawn at its own size. So only a bolt's trunk gets a glow (its core and its branches are
 * 1-pixel lines), a letter is only stretched while it falls or is hit, its white heat is the small
 * halo-less picture added on top (not a second picture with a halo), once every letter has settled
 * the words are stamped in one piece, and the big glows (each letter's and each line's, the pool on
 * the ground, the bloom of a hit, the edges) are rendered once at their final size and only copied.
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

  // How the words arrive and leave.
  const FALL = 300;                     // a digit plunges from above the picture to the ground in this time (ms)
  const LEAD = 70;                      // a bolt's leader feels its way down this long before it hits its letter
  const LEAD_STEPS = 6;                 // ... and is drawn in this many stages
  const WIPE = 90;                      // the charge pours into a letter from where the bolt hits, top to bottom
  const TITLE_SPAN = 1300;              // the lightning writes the title in at most this time
  const LEAVE_AT = 10600;               // the first letter crackles off ...
  const LEAVE_SPAN = 1250;              // ... the last one this much later ...
  const LEAVE_DUR = 300;                // ... and each takes this long to go out

  // The words: pale lime to green. HOT is the white heat they flash back to in the surge (the words
  // in one piece); FLASH is pure light in their shapes (no halo): added on a letter, it is the white
  // heat a letter arrives with (white plus lime is white), and the flash as it is hit or lands.
  const FILL = { stops: [[0, '#f4ffd6'], [0.42, '#d8ff5a'], [1, '#17c25d']], halo: 'rgba(0,0,0,0.88)', stroke: { width: 0.05, color: '#03200e' } };
  const HOT = { stops: [[0, '#ffffff'], [0.55, '#f3ffdc'], [1, '#c8ff92']], halo: 'rgba(0,0,0,0.7)' };
  const FLASH = { stops: [[0, '#ffffff'], [0.5, '#f2ffe0'], [1, '#c4ffa0']], halo: null };

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

  /** The green trail a falling digit leaves: bright where the digit is (the bottom), gone at the top. */
  function trailTex() {
    const c = makeCanvas(32, 256);
    const g = c.getContext('2d');
    const across = g.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(40,220,110,0)');
    across.addColorStop(0.28, 'rgba(90,255,150,0.55)');
    across.addColorStop(0.5, 'rgba(236,255,220,1)');
    across.addColorStop(0.72, 'rgba(90,255,150,0.55)');
    across.addColorStop(1, 'rgba(40,220,110,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 32, 256);
    g.globalCompositeOperation = 'destination-in';
    const along = g.createLinearGradient(0, 0, 0, 256);
    along.addColorStop(0, 'rgba(0,0,0,0)');
    along.addColorStop(0.6, 'rgba(0,0,0,0.35)');
    along.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = along;
    g.fillRect(0, 0, 32, 256);
    return c;
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
      trail: trailTex(),
      edge: [edgeTex(0), edgeTex(1), edgeTex(2), edgeTex(3)],
      ember: [emberTex('216,255,90'), emberTex('110,255,160'), emberTex('236,255,190')]
    };
    return TEX;
  }

  /**
   * The light that belongs to this screen and these words, rendered at device resolution so that a
   * frame only copies it: the glow of each letter (it comes and goes with its letter), the pool of
   * light on the ground under the words, and the four edges.
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
    const n = P.length >> 1;
    const every = Math.max(1, Math.round(n / 700));
    const area = every * geo.step * geo.step;          // letter area each sprite stands for

    // The glow of the letters for which has(k) is true: soft light stacked on their points.
    function glowOf(has) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i += every) {
        const k = geo.pG[i];
        if (k < 0 || !has(k)) continue;
        const s = geo.G[k].size * 0.46;
        const x = P[i * 2];
        const y = P[i * 2 + 1];
        if (x - s / 2 < x0) x0 = x - s / 2; if (x + s / 2 > x1) x1 = x + s / 2;
        if (y - s / 2 < y0) y0 = y - s / 2; if (y + s / 2 > y1) y1 = y + s / 2;
      }
      if (!(x1 >= x0)) return null;
      x0 = Math.floor(x0 - 1); x1 = Math.ceil(x1 + 1); y0 = Math.floor(y0 - 1); y1 = Math.ceil(y1 + 1);
      const c = makeCanvas(Math.round((x1 - x0) * dpr), Math.round((y1 - y0) * dpr));
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i += every) {
        const k = geo.pG[i];
        if (k < 0 || !has(k)) continue;
        const s = geo.G[k].size * 0.46;
        g.globalAlpha = Math.min(0.5, 4.2 * area / (s * s));
        g.drawImage(T.glow, P[i * 2] - s / 2, P[i * 2 + 1] - s / 2, s, s);
      }
      return { canvas: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    // each letter's own (it comes and goes with its letter), and each line's in one piece (for while
    // the whole line simply stands there)
    const glows = geo.G.map((g, k) => glowOf((j) => j === k));
    const lineGlows = [0, 1].map((line) => glowOf((j) => geo.G[j].line === line));

    // The pool of light on the ground under the words.
    const poolW = W * 0.62;
    const poolH = H * 0.22;
    const px0 = Math.max(0, Math.floor(geo.gx - poolW / 2));
    const px1 = Math.min(W, Math.ceil(geo.gx + poolW / 2));
    const py0 = Math.max(0, Math.floor(geo.gy - poolH * 0.45));
    const py1 = Math.max(py0 + 1, Math.min(H, Math.ceil(geo.gy + poolH * 0.55)));
    const pc = makeCanvas(Math.round((px1 - px0) * dpr), Math.round((py1 - py0) * dpr));
    const pg = pc.getContext('2d');
    pg.setTransform(dpr, 0, 0, dpr, -px0 * dpr, -py0 * dpr);
    pg.globalAlpha = 0.5;
    pg.drawImage(T.glow, geo.gx - poolW / 2, geo.gy - poolH * 0.45, poolW, poolH);
    const pool = { canvas: pc, x: px0, y: py0, w: px1 - px0, h: py1 - py0 };

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
    // The bloom of green light round a letter as a bolt hits it, at its final size (copied, never stretched).
    const bs = Math.ceil(L.titleSize * 2.4);
    const bloom = makeCanvas(Math.round(bs * dpr), Math.round(bs * dpr));
    bloom.getContext('2d').drawImage(T.glow, 0, 0, bloom.width, bloom.height);
    const hs = Math.ceil(L.titleSize * 1.5);
    const heat = makeCanvas(Math.round(hs * dpr), Math.round(hs * dpr));
    heat.getContext('2d').drawImage(T.hot, 0, 0, heat.width, heat.height);
    SIZED.key = key;
    SIZED.v = { glows: glows, lineGlows: lineGlows, pool: pool, edges: edges, bloom: { canvas: bloom, s: bs }, heat: { canvas: heat, s: hs } };
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

    /* -- the letters, the points on them, and which letter each point is on -- */
    const G = env.glyphs();
    const NG = G.length;
    const wp = env.wordPoints(WORD_BUDGET);
    const P = wp.pts;
    const NP = P.length >> 1;
    const step = Math.max(2, wp.step || 4);
    const year = !!L.year;
    const split = year ? (L.titleY + L.yearY) / 2 : Infinity;
    const pG = new Int16Array(NP);
    for (let i = 0; i < NP; i++) {
      const x = P[i * 2];
      const line = P[i * 2 + 1] < split ? 0 : 1;
      let best = -1;
      let bd = Infinity;
      for (let k = 0; k < NG; k++) {
        const g = G[k];
        if (g.line !== line) continue;
        const d = x < g.x0 ? g.x0 - x : x > g.x1 ? x - g.x1 : 0;
        if (d < bd) { bd = d; best = k; }
      }
      pG[i] = best;
    }
    const gPts = [];                                          // the points on each letter
    for (let k = 0; k < NG; k++) gPts.push([]);
    for (let i = 0; i < NP; i++) if (pG[i] >= 0) gPts[pG[i]].push(i);

    /* -- where the words are: the box of each line, from the points on its letters -- */
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
    const pre = sized(env, { P: P, step: step, G: G, pG: pG, gx: gx, gy: gy });

    /* -- when each letter arrives and leaves -- */
    const born = new Float32Array(NG);        // the moment a digit lands or a letter is hit
    const leave = new Float32Array(NG);       // the moment it starts to crackle off
    const fallD = new Float32Array(NG);       // how far a digit falls
    const rsT = new Float32Array(NG * 2).fill(-1e9);    // a letter's bolt striking again
    const YG = [];
    const TG = [];
    for (let k = 0; k < NG; k++) (G[k].line === 1 ? YG : TG).push(k);
    // The year smashes down first, digit after digit, coming in at the top of the picture.
    let tland = FALL;
    for (const k of YG) {
      born[k] = tland;
      fallD[k] = G[k].cy + G[k].size * 0.4;
      tland += R(36, 58);
    }
    const landN = YG.length ? born[YG[YG.length - 1]] : 0;
    const SMASH = landN;          // the last digit down: the shock (with no year: the thunderclap's bolt hits the ground)
    // Then the lightning writes the title: one strike per letter, or one fork for two, quick within a
    // word and with a breath between words.
    const sameWord = (a, b) => G[b].x0 - G[a].x1 < G[a].size * 0.3;
    const groups = [];
    for (let j = 0; j < TG.length;) {
      if (j > 0 && j + 1 < TG.length && sameWord(TG[j], TG[j + 1]) && rnd() < 0.3) { groups.push([TG[j], TG[j + 1]]); j += 2; }
      else { groups.push([TG[j]]); j += 1; }
    }
    const at = [];
    let tt = 0;
    for (let q = 0; q < groups.length; q++) {
      at.push(tt);
      const last = groups[q][groups[q].length - 1];
      tt += q + 1 < groups.length && sameWord(last, groups[q + 1][0]) ? R(70, 100) : R(170, 230);
    }
    const span = at.length ? at[at.length - 1] : 0;
    const squeeze = span > TITLE_SPAN ? TITLE_SPAN / span : 1;
    const T0 = YG.length ? landN + 330 : 300;                 // the first letter is hit
    for (let q = 0; q < groups.length; q++) for (const k of groups[q]) born[k] = T0 + at[q] * squeeze;
    const titleDone = TG.length ? T0 + span * squeeze : landN;
    const settleAt = Math.max(titleDone, landN) + 1700;      // every letter cool and still: stamped in one piece
    // each line's glow in one piece from when its last letter's flare has died down until its first letter goes
    const lineStill = [[TG.length ? titleDone + 1000 : Infinity, Infinity], [YG.length ? landN + 1000 : Infinity, Infinity]];
    // At the end they crackle off one by one, left to right across both lines.
    const order = [];
    for (let k = 0; k < NG; k++) order.push([G[k].cx / W + R(-0.035, 0.035), k]);
    order.sort((a, b) => a[0] - b[0]);
    order.forEach((o, r) => { leave[o[1]] = LEAVE_AT + (NG > 1 ? r / (NG - 1) : 0) * LEAVE_SPAN; });
    for (let k = 0; k < NG; k++) lineStill[G[k].line][1] = Math.min(lineStill[G[k].line][1], leave[k]);
    const pBorn = new Float32Array(NP);
    const pLeave = new Float32Array(NP);
    for (let i = 0; i < NP; i++) { pBorn[i] = pG[i] >= 0 ? born[pG[i]] : 0; pLeave[i] = pG[i] >= 0 ? leave[pG[i]] : LEAVE_AT; }

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

    /** The first fraction f of a polyline. */
    function addPart(path, pts, f) {
      const n = pts.length / 2 - 1;
      const upto = clamp(f, 0, 1) * n;
      const whole = Math.floor(upto);
      path.moveTo(pts[0], pts[1]);
      for (let i = 1; i <= whole; i++) path.lineTo(pts[i * 2], pts[i * 2 + 1]);
      const r = upto - whole;
      if (r > 0.01 && whole < n) path.lineTo(lerp(pts[whole * 2], pts[whole * 2 + 2], r), lerp(pts[whole * 2 + 1], pts[whole * 2 + 3], r));
    }

    const bolts = [];
    /**
     * Three versions of one arc (it jumps between them as it strikes again), each with branches; a
     * fork (s.fork) is a second trunk splitting off two thirds of the way down; an arc that has to
     * find its way first (s.lead) also gets its leader, the trunk growing from its start in stages.
     */
    function makeBolt(s) {
      const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
      const v = [];
      for (let k = 0; k < 3; k++) {
        const main = polyline(s.ax, s.ay, s.bx, s.by, s.bow * R(0.75, 1.2), s.ux, s.uy, s.jit, s.levels);
        const mp = new Path2D();
        addTo(mp, main);
        const n = main.length / 2 - 1;
        let fork = null;
        let fi = 0;
        if (s.fork) {
          fi = Math.round(n * R(0.58, 0.7));
          const fx = main[fi * 2];
          const fy = main[fi * 2 + 1];
          const fl = Math.hypot(s.fork[0] - fx, s.fork[1] - fy);
          fork = polyline(fx, fy, s.fork[0], s.fork[1], fl * R(-0.15, 0.15), 1, 0, s.jit * 1.2, Math.max(3, s.levels - 2));
          addTo(mp, fork);
        }
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
        let lead = null;
        if (s.lead && k === 0) {
          lead = [];
          const f0 = fi / n;
          for (let q = 1; q < LEAD_STEPS; q++) {
            const f = q / LEAD_STEPS;
            const p = new Path2D();
            addPart(p, main, f);
            if (fork && f > f0) addPart(p, fork, (f - f0) / (1 - f0));
            lead.push(p);
          }
        }
        v.push({ main: mp, br: bp, lead: lead });
      }
      return { v: v, ax: s.ax, ay: s.ay, bx: s.bx, by: s.by, fx: s.fork ? s.fork[0] : NaN, fy: s.fork ? s.fork[1] : NaN, len: len, w: s.w || 1, edge: s.edge == null ? -1 : s.edge };
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
      // the thunderclap: the sky cracking open across the top of the picture, forks hanging down
      sky() {
        const xa = R(0.03, 0.2) * W;
        const xb = R(0.8, 0.97) * W;
        return { ax: xa, ay: R(0.03, 0.12) * H, bx: xb, by: R(0.03, 0.14) * H, bow: R(0.07, 0.13) * H, ux: 0, uy: 1, jit: 0.045, levels: 6, branches: 7, bu: [0, 1], w: 1.35 };
      },
      // the thunderclap with no year: a bolt from the sky into the ground under the words
      down() {
        const len = gy + 20;
        return { ax: gx + R(-0.12, 0.12) * W, ay: -20, bx: gx, by: gy, bow: R(-0.08, 0.08) * len, ux: 1, uy: 0, jit: 0.05, levels: 6, branches: 6, bu: [0, 1], w: 1.3 };
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
    // dies away, 1 one hop of a live arc that holds, 2 a leader growing down before its strike).
    const fl = [];
    const sparkAt = [];                                          // where strikes throw sparks: t, x, y, count
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
      sparkAt.push(t0, s.ax, s.ay, 3, t0 + 10, s.bx, s.by, 3);
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
    /** A bolt from the sky that hits letter ks[0] (and, forked, ks[1]) at tc: it writes them. */
    function letterStrike(tc, ks) {
      const g = G[ks[0]];
      const drop = Math.max(40, g.top);
      const ax = clamp(g.cx + R(-0.32, 0.32) * drop, W * 0.02, W * 0.98);
      const ay = -R(8, 30) * S;
      const bx = g.cx + R(-0.12, 0.12) * (g.x1 - g.x0);
      const by = g.top - g.size * 0.04;
      const len = Math.hypot(bx - ax, by - ay);
      const s = { ax: ax, ay: ay, bx: bx, by: by, bow: R(-0.1, 0.1) * len, ux: 1, uy: 0, jit: 0.06, levels: 6, branches: 4, bu: [0, 1], w: 1.35, lead: true };
      if (ks.length > 1) { const h = G[ks[1]]; s.fork = [h.cx + R(-0.12, 0.12) * (h.x1 - h.x0), h.top - h.size * 0.04]; }
      const b = bolts.length;
      bolts.push(makeBolt(s));
      fl.push([tc - LEAD, LEAD, b, 0, 0.62, 2]);
      const n = 2;
      let t = tc;
      for (let j = 0; j < n; j++) {
        const dur = j === n - 1 ? R(130, 210) : R(55, 85);
        fl.push([t, dur, b, j % 3, (j === 0 ? 1.25 : 1) * (1 - 0.12 * j), 0]);
        if (j > 0) for (const k of ks) { if (rsT[k * 2] < -1e8) rsT[k * 2] = t; else rsT[k * 2 + 1] = t; }
        t += dur + R(15, 45);
      }
      sparkAt.push(tc, bx, by, 11);
      if (s.fork) sparkAt.push(tc, s.fork[0], s.fork[1], 11);
    }

    // The thunderclap at midnight: the sky cracks open (or, with no year, a bolt hits the ground) ...
    if (YG.length) {
      strike(0, spec.sky(), 1.15, 3);
      strike(25, spec.edge(2), 0.9, 2);
    } else {
      strike(0, spec.down(), 1, 3);
    }
    // ... and where the year smashes down, arcs race out along the ground and up to the edges.
    strike(SMASH, spec.ground(-1), 1, 2);
    strike(SMASH + 20, spec.ground(1), 1, 2);
    strike(SMASH + 40, spec.rise(-1), 0.95, 1);
    strike(SMASH + 70, spec.rise(1), 0.95, 1);
    // Then the lightning writes the title, letter by letter.
    for (let q = 0; q < groups.length; q++) letterStrike(born[groups[q][0]], groups[q]);
    // From then on the words crackle: live arcs hug them one after another, now here, now there ...
    const quiet = (t) => t > MID - 200 && t < MID + 520;                   // room for the surge
    const after = titleDone + 150;
    strike(after + 60, spec.edge(0), 0.8, 2);
    strike(after + 120, spec.edge(1), 0.8, 2);
    let lastSide = 1;
    for (let tq = after; tq < STRIKES_END;) {
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
    for (let tq = after + 250; tq < STRIKES_END;) {
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
    const actB = new Uint16Array(NF), actV = new Uint8Array(NF), actI = new Float32Array(NF), actP = new Uint8Array(NF);
    const edgeBoost = new Float32Array(4);

    /* -- the shockwave rings: start, duration, reach, width, strength, flatness -- */
    const rings = [
      [SMASH, 1200, 0.62 * W, 13, 1, 0.2, gx, gy],
      [SMASH + 120, 1450, 0.76 * W, 8, 0.75, 0.22, gx, gy],
      [SMASH, 900, 1.2 * Math.max(W, H), 3, 0.5, 1, gx, gy],          // the blast in the air, a full circle
      [MID, 1100, 0.56 * W, 10, 0.85, 0.2, gx, gy],
      [MID + 130, 1300, 0.68 * W, 6, 0.55, 0.22, gx, gy]
    ];
    // each digit slams a ring of its own out from under it as it lands
    for (const k of YG) {
      const g = G[k];
      rings.push([born[k], 650, (g.x1 - g.x0) * 1.6, 7, 0.75, 0.24, g.cx, Math.min(H - 4 * S, g.bottom + g.size * 0.06)]);
    }
    // a ripple along the ground on every beat, at the top of each pulse
    for (let tb = 1000 + BEAT / 4; tb < STRIKES_END - 600; tb += BEAT) {
      if (Math.abs(tb - MID) > 700) rings.push([tb, 1400, 0.46 * W, 4, 0.32, 0.2, gx, gy]);
    }

    /* -- embers (glowing points) and shards (glassy splinters), all on fixed paths -- */
    const NE = 1500;
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
    burst(SMASH, 130, 1150, 0.07);
    burst(MID, 80, 850, 0.05);
    // each digit kicks up a spray of sparks along the ground where it lands
    for (const k of YG) {
      const g = G[k];
      const w = g.x1 - g.x0;
      for (let i = 0; i < 14; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const a = side < 0 ? Math.PI + R(0.05, 0.75) : -R(0.05, 0.75);
        const v = R(150, 560) * S;
        ember(born[k] + R(0, 50), g.cx + side * R(0.1, 0.5) * w, g.bottom + R(-0.02, 0.03) * g.size, Math.cos(a) * v, Math.sin(a) * v,
          R(20, 60) * S, 3.2, R(0.5, 1.2), R(3, 6.5) * S, 1);
      }
    }
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
    // sparks lifting off the letters (only once a letter is there)
    for (let i = 0; i < 120 && NP; i++) {
      const p = Math.floor(rnd() * NP);
      const t0 = R(Math.max(800, pBorn[p] + 200), Math.max(pBorn[p] + 300, Math.min(DURATION - 2000, pLeave[p] - 300)));
      ember(t0, P[p * 2], P[p * 2 + 1], R(-25, 25) * S, -R(20, 90) * S, R(30, 80) * S, 1, R(0.8, 2), R(3, 7) * S, 1);
    }
    // at the end each letter shorts out with a spray of sparks ...
    for (let k = 0; k < NG; k++) {
      const pts = gPts[k];
      if (!pts.length) continue;
      for (let m = 0; m < 7; m++) {
        const p = pts[Math.floor(rnd() * pts.length)];
        const a = -Math.PI / 2 + R(-1.6, 1.6);
        const v = R(160, 520) * S;
        ember(leave[k] + R(0, 40), P[p * 2], P[p * 2 + 1], Math.cos(a) * v, Math.sin(a) * v, R(10, 40) * S, 3.2, R(0.4, 0.9), R(3, 6) * S, 1);
      }
    }
    // ... and the energy leaves it as sparks drifting up and away
    for (let i = 0; i < 150 && NP; i++) {
      const p = Math.floor(rnd() * NP);
      ember(pLeave[p] + R(0, 280), P[p * 2], P[p * 2 + 1], R(-30, 30) * S, -R(40, 150) * S, R(50, 110) * S, 0.9, R(1.0, 1.8), R(3.5, 8) * S, 1);
    }
    // sparks thrown where an arc touches down (and where a bolt hits a letter, more of them)
    for (let i = 0; i < sparkAt.length; i += 4) {
      const x = sparkAt[i + 1];
      const y = sparkAt[i + 2];
      const c = sparkAt[i + 3];
      if (x < 0 || x > W || y < 0 || y > H) continue;
      for (let k = 0; k < c; k++) {
        const a = c > 3 ? -Math.PI / 2 + R(-1.5, 1.5) : R(0, 6.283);
        const v = R(c > 3 ? 140 : 80, c > 3 ? 560 : 380) * S;
        ember(sparkAt[i] + R(0, 40), x, y, Math.cos(a) * v, Math.sin(a) * v - 60 * S, R(10, 40) * S, 3, R(0.5, 1.1), R(3, 6) * S, 1);
      }
    }

    const NS = 112;
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
      shard(SMASH + R(0, 80), gx + R(-0.08, 0.08) * W, gy + R(-0.01, 0.01) * H, Math.cos(a) * v * 1.2, Math.sin(a) * v, R(25, 70) * S, R(1.3, 2), R(2.4, 4.6), R(10, 24) * S);
    }
    for (const k of YG) {
      const g = G[k];
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + R(-1.2, 1.2);
        const v = R(0.3, 1) * 760 * S;
        shard(born[k] + R(0, 40), g.cx + R(-0.4, 0.4) * (g.x1 - g.x0), g.bottom, Math.cos(a) * v * 1.2, Math.sin(a) * v, R(25, 70) * S, R(1.4, 2.2), R(1.6, 3), R(7, 15) * S);
      }
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
    const SHIMMER_AT = titleDone + 700;        // the shimmer starts once the words are written
    const NT = Math.min(200, NP);
    const twI = new Uint16Array(NT), twF = new Float32Array(NT), twP = new Float32Array(NT);
    for (let i = 0; i < NT; i++) { twI[i] = Math.floor(rnd() * NP); twF[i] = R(3.5, 8); twP[i] = R(0, 6.283); }

    // Little arcs crawling over the letters, in crackling bursts: as a letter is hit or lands, while
    // the words hold, and as each letter goes out.
    const micro = [];
    function microArc(t0, d, i) {
      const dir = rnd() < 0.5 ? -1 : 1;
      const k = 3 + Math.floor(rnd() * 9);
      let j = i + dir * k;
      if (j < 0 || j >= NP) j = i - dir * k;
      if (j < 0 || j >= NP) return;
      const ax = P[i * 2], ay = P[i * 2 + 1], bx = P[j * 2], by = P[j * 2 + 1];
      const dd = Math.hypot(bx - ax, by - ay);
      if (dd < step * 2 || dd > step * 16) return;     // the next row or across a gap: skip it
      // only on letters that are there for the whole of it
      if (t0 < Math.max(pBorn[i], pBorn[j]) || t0 + d > Math.min(pLeave[i], pLeave[j]) + LEAVE_DUR * 0.6) return;
      const a = new Path2D();
      const c = new Path2D();
      addTo(a, polyline(ax, ay, bx, by, R(-0.3, 0.3) * dd, 0, -1, 0.22, 3));
      addTo(c, polyline(ax, ay, bx, by, R(-0.3, 0.3) * dd, 0, -1, 0.22, 3));
      micro.push({ t: t0, d: d, a: a, b: c });
    }
    for (let k = 0; k < NG; k++) {
      const pts = gPts[k];
      if (pts.length < 8) continue;
      for (let m = 0; m < 3; m++) microArc(born[k] + R(10, 170), R(80, 170), pts[Math.floor(rnd() * pts.length)]);
      for (let m = 0; m < 3; m++) microArc(leave[k] + R(0, 70), R(50, 100), pts[Math.floor(rnd() * pts.length)]);
    }
    for (let tc = Math.max(900, titleDone + 100); tc < LEAVE_AT && NP > 20; tc += R(80, 260)) {
      const n = 2 + Math.floor(rnd() * 4);
      for (let b = 0; b < n; b++) microArc(tc + R(-60, 120), R(70, 160), Math.floor(rnd() * NP));
    }
    micro.sort((a, b) => a.t - b.t);

    // Waves of light running out through the letters from the impact: [start, speed px/ms, width, strength].
    const waves = [[MID + 40, 1.7, 60, 1]];   // (the words arrive white hot: a wave would not show then)

    /* -- each letter's state in the current frame -- */
    const pV = new Float32Array(NG);          // how much of it is there (0 not yet / gone)
    const pDy = new Float32Array(NG);         // moved down by
    const pSx = new Float32Array(NG);         // stretched across ...
    const pSy = new Float32Array(NG);         // ... and up and down (round its middle)
    const pHot = new Float32Array(NG);        // white heat over it
    const pBoost = new Float32Array(NG);      // extra light added on it
    const pFall = new Float32Array(NG);       // a digit on its way down: how far (0..1), else -1
    const tf = { dx: 0, dy: 0, sx: 1, sy: 1, op: 'source-over', crop: null };
    const crop = [0, 0, 1, 1];
    // The letter pictures' margins (their halos), as the engine makes them: for a crop at a given height.
    const padOf = (halo) => ((halo ? Math.max(6, L.titleSize * 0.28) * 1.6 : 0) + L.titleSize * 0.04) / Math.min(1, env.dpr) + 2;
    const PAD_HALO = padOf(true);
    const PAD_NONE = padOf(false);
    const wipeY = new Float32Array(NG);       // a letter being filled: down to here (else NaN)
    let surge = 0;                            // the second surge's white heat over every letter

    function poses(t) {
      // the ground jolts each time a digit lands on it
      let jolt = 0;
      for (let j = 0; j < YG.length; j++) {
        const u = t - born[YG[j]];
        if (u > 0 && u < 360) jolt += (j === YG.length - 1 ? 1.2 : 0.55) * Math.exp(-u / 55) * Math.sin(u * 0.075);
      }
      surge = 0.6 * bump(t, MID + 90, 110);
      for (let k = 0; k < NG; k++) {
        const g = G[k];
        let vis = 0, dy = 0, sx = 1, sy = 1, hot = 0, boost = 0, fall = -1;
        const u = t - born[k];
        if (g.line === 1 && u < 0 && u > -FALL) {
          // plunging, faster and faster, stretched by the speed
          const f = 1 + u / FALL;
          dy = -fallD[k] * (1 - (0.3 * f + 0.7 * f * f));
          const v = (0.3 + 1.4 * f) / 1.7;
          sy = 1 + 0.16 * v;
          sx = 1 - 0.06 * v;
          vis = 1; hot = 1; fall = f;
        } else if (u >= 0) {
          vis = 1;
          if (g.line === 1) {
            // the smash: squashed flat, driven a little into the ground, then it springs back and settles
            const e = Math.exp(-u / 70) * Math.cos(u * 0.037);
            sy = 1 - 0.2 * e;
            sx = 1 + 0.1 * e;
            dy = (g.bottom - g.cy) * (1 - sy) + g.size * (0.045 * Math.exp(-u / 90) * Math.cos(u * 0.031) + 0.022 * jolt);
            hot = Math.max(0, Math.exp(-u / 180) - 0.04);
            boost = 0.9 * Math.exp(-u / 70);
          } else {
            // hit: knocked down a little, white-hot, cooling to lime (and flaring as its bolt strikes again)
            dy = g.size * 0.05 * Math.exp(-u / 60) * Math.cos(u * 0.039);
            sx = sy = 1 + 0.07 * Math.exp(-u / 55);
            hot = Math.max(0, Math.exp(-u / 200) - 0.04);
            boost = 0.95 * Math.exp(-u / 80);
            for (let q = 0; q < 2; q++) {
              const r = t - rsT[k * 2 + q];
              if (r >= 0 && r < 420) { boost += 0.45 * Math.exp(-r / 70); hot = Math.max(hot, 0.7 * Math.exp(-r / 160)); }
            }
          }
        }
        // going out: it shorts out with a last white crackle, blinks like a failing tube and is gone
        const w = t - leave[k];
        if (vis && w > 0) {
          boost += 0.9 * Math.exp(-w / 50);
          if (w >= LEAVE_DUR) vis = 0;
          else {
            const h = hash01(Math.floor(t / 40) * 7 + k * 13);
            vis = (1 - smooth(LEAVE_DUR * 0.35, LEAVE_DUR, w)) * (w < 50 ? 1 : h < 0.38 ? 0.06 : 0.6 + 0.4 * h);
          }
          dy -= g.size * 0.05 * smooth(0, LEAVE_DUR, w);
        }
        pV[k] = vis; pDy[k] = dy; pSx[k] = sx; pSy[k] = sy;
        wipeY[k] = g.line === 0 && u >= 0 && u < WIPE ? lerp(g.top - g.size * 0.04, g.bottom + g.size * 0.3, smooth(0, WIPE, u * 1.12)) : NaN;
        pHot[k] = Math.min(1, hot + surge); pBoost[k] = boost; pFall[k] = fall;
      }
    }

    /**
     * The transform for letter k in this frame (null when it simply stands where it belongs); while
     * it is being filled, only the part above the front, in the picture with margin `pad`.
     */
    function pose(k, op, pad) {
      const wy = wipeY[k];
      const filling = wy === wy;
      if (!op && !filling && Math.abs(pDy[k]) < 0.05 && Math.abs(pSx[k] - 1) < 0.002 && Math.abs(pSy[k] - 1) < 0.002) return null;
      tf.dy = pDy[k]; tf.sx = pSx[k]; tf.sy = pSy[k]; tf.op = op || 'source-over';
      if (filling) {
        const g = G[k];
        const half = g.size * 0.62 + pad;
        crop[3] = clamp((wy - (g.cy - half)) / (2 * half), 0.01, 1);
        tf.crop = crop;
      } else tf.crop = null;
      return tf;
    }

    /* ---------------------------------------------------------- draw --- */

    /** Which bolts are lit at t, and how brightly. Returns how many. */
    function activeBolts(t) {
      let na = 0;
      edgeBoost[0] = edgeBoost[1] = edgeBoost[2] = edgeBoost[3] = 0;
      for (let i = 0; i < NF; i++) {
        const tau = t - fS[i];
        if (tau < 0 || tau >= fD[i]) continue;
        let I;
        let part = 255;
        if (fK[i] === 2) {
          part = Math.min(LEAD_STEPS - 2, Math.floor((tau / fD[i]) * (LEAD_STEPS - 1)));
          I = fP[i] * (0.75 + 0.25 * hash01(Math.floor(t / 17) * 7 + i));
        } else {
          let on = 1;
          if (fK[i] === 0 && tau > 25) on = Math.exp(-(tau - 25) / (fD[i] * 0.4));
          I = fP[i] * on * (0.7 + 0.3 * hash01(Math.floor(t / 34) * 13 + i));
        }
        if (I < 0.03) continue;
        actB[na] = fB[i];
        actV[na] = fV[i];
        actI[na] = I;
        actP[na] = part;
        na++;
        const e = bolts[fB[i]].edge;
        if (e >= 0) edgeBoost[e] += I;
      }
      return na;
    }

    function drawFlash(t) {
      // a green thunderclap: the whole picture lights up for an instant, twice; and once more as the
      // year smashes down
      let a = 0;
      if (YG.length) {
        a = 0.14 * Math.exp(-t / 70) + 0.05 * bump(t, 120, 30);
        const u = t - SMASH;
        if (u >= 0) a += 0.13 * Math.exp(-u / 45);
      } else {
        a = 0.16 * Math.exp(-t / 60) + 0.07 * bump(t, 125, 35);
      }
      if (t > (YG.length ? SMASH + 150 : 240) || a < 0.006) return 0;
      ctx.globalAlpha = Math.min(0.18, a);
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
      const beat = 0.42 + 0.3 * throb(t);
      const common = 0.55 * bump(t, MID + 100, 260) + 0.15 * Math.min(1.5, boost);
      let n = 0;
      // each letter's own glow, there with it (a falling digit glows like a meteor); a line that simply
      // stands there has its glow in one piece
      const still0 = t >= lineStill[0][0] && t < lineStill[0][1];
      const still1 = t >= lineStill[1][0] && t < lineStill[1][1];
      for (let k = 0; k < NG; k++) {
        const gl = pre.glows[k];
        if (!gl || pV[k] <= 0.003 || (G[k].line ? still1 : still0)) continue;
        const u = t - born[k];
        const a = (u < 0 ? 0.8 : beat + 0.6 * Math.exp(-u / 300) + common) * pV[k] * fade;
        if (a < 0.01) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(gl.canvas, gl.x, gl.y + pDy[k], gl.w, gl.h);
        n++;
      }
      for (let line = 0; line < 2; line++) {
        const gl = pre.lineGlows[line];
        if (!gl || !(line ? still1 : still0)) continue;
        ctx.globalAlpha = Math.min(1, (beat + common) * fade);
        ctx.drawImage(gl.canvas, gl.x, gl.y, gl.w, gl.h);
        n++;
      }
      // the pool of light on the ground, from the moment the year hits it
      const u = t - SMASH;
      if (u > 0) {
        const a = (0.9 * beat + 0.7 * Math.exp(-u / 500) + common) * smooth(0, 90, u) * (1 - smooth(LEAVE_AT, LEAVE_AT + LEAVE_SPAN + LEAVE_DUR, t)) * fade;
        if (a >= 0.01) {
          const p = pre.pool;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(p.canvas, p.x, p.y, p.w, p.h);
          n++;
        }
      }
      return n;
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
        const r0 = Math.min(20 * S, g[2] * 0.2);
        const r = r0 + (g[2] - r0) * easeOut(u);
        const a = g[4] * Math.pow(1 - u, 1.7) * fade;
        const w = (g[3] * (1 - u) + 1.2) * S;
        ctx.beginPath();
        ctx.ellipse(g[6], g[7], r, r * g[5], 0, 0, Math.PI * 2);
        if (!lo && g[5] < 1 && g[2] > 0.3 * W) {
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
        const t0 = k ? MID : SMASH;
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

    /** The falling digits: a green trail above each, and the smear of its light a moment ago. */
    function drawTrails(fade) {
      let n = 0;
      for (const k of YG) {
        const f = pFall[k];
        if (f < 0) continue;
        const g = G[k];
        const v = (0.3 + 1.4 * f) / 1.7;
        const w = (g.x1 - g.x0) * 0.95;
        const len = g.size * (0.9 + 2.2 * v);
        const yb = g.cy + pDy[k] + g.size * 0.2;
        ctx.globalAlpha = Math.min(1, 0.75 * v * fade);
        ctx.drawImage(T.trail, g.cx - w / 2, yb - len, w, len);
        n++;
        // the smear of its light: the digit stretched upward from where it is, as by its speed
        const reach = (g.bottom - g.cy);
        tf.crop = null; tf.op = 'lighter'; tf.sx = pSx[k] * 0.97;
        const st = pSy[k] * (1 + 0.8 * v);
        tf.sy = st;
        tf.dy = pDy[k] + reach * (pSy[k] - st);
        env.glyph(g, 0.36 * fade, FLASH, tf);
        n++;
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
          if (actI[k] < 0.65 || actP[k] !== 255) continue;
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
        const lead = actP[k] !== 255;
        ctx.globalAlpha = Math.min(1, (lead ? 0.3 : 0.38) * actI[k] * fade);
        ctx.lineWidth = (lead ? 5 : 8) * S * b.w;
        ctx.stroke(lead ? b.v[actV[k]].lead[actP[k]] : b.v[actV[k]].main);
        n++;
      }
      ctx.strokeStyle = BOLT_MID;
      for (let k = 0; k < na; k++) {
        if (actP[k] !== 255) continue;
        const b = bolts[actB[k]];
        ctx.globalAlpha = Math.min(1, 0.75 * actI[k] * fade);
        ctx.lineWidth = 2.4 * S * b.w;
        ctx.stroke(b.v[actV[k]].main);
        n++;
      }
      ctx.lineWidth = hair;
      for (let k = 0; k < na; k++) {
        const v = bolts[actB[k]].v[actV[k]];
        const lead = actP[k] !== 255;
        ctx.strokeStyle = BOLT_CORE;
        ctx.globalAlpha = Math.min(1, (lead ? 0.9 : 1.15) * actI[k] * fade);
        ctx.stroke(lead ? v.lead[actP[k]] : v.main);
        n++;
        if (v.br && !lead) {
          ctx.strokeStyle = BOLT_BRANCH;
          ctx.globalAlpha = Math.min(1, 0.9 * actI[k] * fade);
          ctx.stroke(v.br);
          n++;
        }
      }
      // white heat where each arc touches
      for (let k = 0; k < na; k++) {
        if (actP[k] !== 255) continue;
        const b = bolts[actB[k]];
        const I = actI[k] * fade;
        const s = 34 * S * (0.6 + I) * b.w;
        ctx.globalAlpha = Math.min(1, 0.6 * I);
        if (b.ay > -s / 2) { ctx.drawImage(T.hot, b.ax - s / 2, b.ay - s / 2, s, s); n++; }
        ctx.drawImage(T.hot, b.bx - s / 2, b.by - s / 2, s, s);
        n++;
        if (b.fx === b.fx) { ctx.drawImage(T.hot, b.fx - s / 2, b.fy - s / 2, s, s); n++; }
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

    /** The letters themselves (source-over: each has its dark halo, so it reads on a bright scene). */
    function drawLetters(t, fade) {
      if (t >= settleAt && t < LEAVE_AT) {
        // Every letter in place and cool: the words in one stamp (the very same picture). White heat
        // again in the surge. Stamped at full strength whenever possible and never scaled: a
        // stretched or faded stamp costs two to five times what a plain copy does.
        const hot = Math.min(1, surge);
        if (hot >= 0.995) { env.words(fade, HOT, 1); return 1; }
        env.words(fade, FILL, 1);
        if (hot > 0.01) { env.words(fade * hot, HOT, 1); return 2; }
        return 1;
      }
      // One by one (each in its own state): the letter, its white heat added on in drawLetterLight().
      let n = 0;
      for (let k = 0; k < NG; k++) {
        const a = pV[k] * fade;
        if (a <= 0.003) continue;
        env.glyph(G[k], a, FILL, pose(k, null, PAD_HALO));
        n++;
      }
      return n;
    }

    /** Light on the letters: the flash as each is hit or lands, a white-hot burst there, the last crackle. */
    function drawLetterLight(t, fade) {
      let n = 0;
      for (let k = 0; k < NG; k++) {
        const g = G[k];
        if (g.line === 0 && pV[k] <= 0.003) {
          // the air where the letter will be charges up as the leader comes down to it
          const c = t - born[k] + LEAD + 30;
          if (c > 0 && c < LEAD + 30) {
            const q = c / (LEAD + 30);
            const bl = pre.bloom;
            ctx.globalAlpha = 0.4 * q * q * fade;
            ctx.drawImage(bl.canvas, g.cx - bl.s / 2, g.cy - bl.s / 2, bl.s, bl.s);
            n++;
          }
          continue;
        }
        if (pV[k] <= 0.003) continue;
        // its white heat and its flashes: pure light in its shape
        const b = Math.min(1, pHot[k] * 0.92 + pBoost[k]) * pV[k] * fade;
        if (b > 0.03 && !(t >= settleAt && t < LEAVE_AT)) { env.glyph(g, b, FLASH, pose(k, 'lighter', PAD_NONE)); n++; }
        const u = t - born[k];
        if (u >= 0 && u < (g.line === 1 ? 380 : 300)) {
          if (g.line === 1) {
            // the digit hits the ground: white heat at its foot, a flat flash along the ground
            const w = g.x1 - g.x0;
            const s = w * 1.5 * (0.7 + 0.3 * Math.exp(-u / 120));
            ctx.globalAlpha = 0.8 * Math.exp(-u / 90) * fade;
            ctx.drawImage(T.hot, g.cx - s / 2, g.bottom - s * 0.45, s, s);
            const sw = w * (2 + 2.5 * easeOut(Math.min(1, u / 200)));
            const sh = g.size * 0.22;
            ctx.globalAlpha = 0.6 * Math.exp(-u / 140) * fade;
            ctx.drawImage(T.streak, g.cx - sw / 2, g.bottom - sh / 2, sw, sh);
            n += 2;
          } else {
            // the bolt hits the letter: a bloom of green light round it, white heat where it strikes,
            // and the bright front of the charge pouring down through it
            const bl = pre.bloom;
            const ba = 0.85 * Math.exp(-u / 110) * fade;
            if (ba > 0.02) {
              ctx.globalAlpha = ba;
              ctx.drawImage(bl.canvas, g.cx - bl.s / 2, g.cy + pDy[k] - bl.s / 2, bl.s, bl.s);
              n++;
            }
            const ht = pre.heat;
            const ha = 0.9 * Math.exp(-u / 70) * fade;
            if (ha > 0.02) {
              ctx.globalAlpha = ha;
              ctx.drawImage(ht.canvas, g.cx - ht.s / 2, g.top - ht.s * 0.45, ht.s, ht.s);
              n++;
            }
            const wy = wipeY[k];
            const inside = wy === wy ? 1 - smooth(g.bottom - g.size * 0.08, g.bottom + g.size * 0.12, wy) : 0;
            if (inside > 0.01) {
              const fw = (g.x1 - g.x0) * 1.7;
              const fh = g.size * 0.2;
              ctx.globalAlpha = 0.9 * inside * fade;
              ctx.drawImage(T.streak, g.cx - fw / 2, wy + pDy[k] - fh / 2, fw, fh);
              n++;
            }
          }
        }
      }
      return n;
    }

    function drawWordLight(t, fade, lo) {
      if (!NP) return 0;
      const wa = fade;
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
          if (d < -1.5 || d > 1.5 || t < pBorn[i] || t > pLeave[i]) continue;
          ctx.globalAlpha = Math.min(1, Math.exp(-d * d * 1.6) * str);
          ctx.drawImage(spr, P[i * 2] - sz, P[i * 2 + 1] - sz, sz * 2, sz * 2);
          n++;
        }
      }
      // a shimmer sweeping across the words every few seconds
      if (t > SHIMMER_AT && t < FADE_AT + 300) {
        const p = ((t - SHIMMER_AT) % 2600) / 1200;
        if (p <= 1) {
          const band = Math.max(20, (cMax - cMin) * 0.07);
          const at = cMin - band * 2 + p * (cMax - cMin + band * 4);
          for (let i = 0; i < NP; i += stride) {
            const d = (sweepC[i] - at) / band;
            if (d < -1.6 || d > 1.6 || t > pLeave[i]) continue;
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
        if (t < pBorn[i] + 250 || t > pLeave[i]) continue;
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
        if (tau < 0) break;                         // (in order of time)
        if (tau > mc.d) continue;
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
      poses(t);
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
      n += drawTrails(fade);
      n += drawBolts(fade, lo, na);
      n += drawShards(t, fade, lo);
      n += drawEmbers(t, fade, lo, 0);
      ctx.restore();
      n += drawLetters(t, fade);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      n += drawLetterLight(t, fade);
      n += drawWordLight(t, fade, lo);
      n += drawEmbers(t, fade, lo, 1);
      if (!lo) n += drawEmbers(t, fade, lo, 2);
      ctx.restore();
      return n;
    }

    return {
      step: function () { /* every frame is worked out from t alone */ },
      draw: draw,
      // Before midnight: the letters in every fill (one picture each) and the words in one piece are
      // made ahead of time (the points on them and the glows are already made by create()), and a few
      // moments are drawn once so that everything is warmed up: the first frame at midnight has
      // nothing slow left to do. All of it is cleared again in the same task, so none of it is seen.
      prime: function () {
        ctx.save();
        ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
        try {
          env.warm(FILL);
          env.warm(FLASH);
          env.words(1, FILL, 1);
          env.words(1, HOT, 1);
          const moments = [40, 160, SMASH + 30, SMASH + 220, titleDone - 30, titleDone + 200, settleAt + 100, MID + 120, LEAVE_AT + 200];
          for (const t of moments) draw(t);
        } finally {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          ctx.restore();
        }
      }
    };
  }

  FX.register('gamma', { name: 'Gamma', duration: DURATION, font: { family: 'AP Anton', weight: 400, tracking: 0.08, scale: 1.12 }, create: create });
})(typeof window !== 'undefined' ? window : this);
