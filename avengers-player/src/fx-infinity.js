/*!
 * Avengers Player: 'infinity', Infinity (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays: a point of violet light flares above the middle of the words
 *             and two pens of light leave it, up and out, drawing an infinity loop (a lemniscate)
 *             across the picture; they meet again at the crossing at 0.8 s and the loop lights up.
 *             Stars switch on as the wave of the flare passes them.
 *   0.05 s    the pens shed stardust that runs back down the loop into the crossing and gathers
 *             there in a swirling knot.
 *   0.3-1.8 s the knot pours its dust into the year, digit by digit: each stream fans out into a
 *             blown-up copy of the digit and pulls in. The grains land one by one and draw the digit
 *             in dust first, in a violet haze that gathers and tightens round it; once a third of them
 *             are down, the digit's shape glows lilac between them, burns white as the last ones land
 *             and cools into its colours while the grains melt into it.
 *   1.15-2.9 s dust riding the loop peels off it and flows down into the title, letter by letter,
 *             left to right, each letter condensing the same way. (With no year the title is built
 *             from the knot instead.)
 *   2.9-10.4 s the loop flows on behind the words: stardust streams round it, comets of light run
 *             along it and its light shifts through violet, lilac, rose and ice blue; slow ripples
 *             run out from the crossing (the stars brighten and the letters glint as they pass) and
 *             now and then a grain peels off the loop and settles on a letter.
 *   10.4 s    the words break back into stardust, letter by letter: each flares, loses its colours,
 *             and its light thins out as its dust lifts off and is drawn into the loop;
 *   11.15 s   the loop closes into its crossing, a point, which winks out at 12.3 s.
 *
 * Only light is added over the film, but for small dark shadows: the letters keep their own dark
 * halo, and the grains that build them cast a little one too (on their way to a letter and off it),
 * so the dust can be seen pouring in over a bright picture as well. Every frame is a function of the
 * seed and t alone, so renderAt(t), a resize in the middle and the live animation all draw the same
 * picture. Nothing is stroked per frame: the loop is drawn once into a picture per lobe and look, the
 * letters come from env.glyph() (one small copy each: lilac light, white-hot light and the letter in
 * its colours), and the grains of dust are gathered into one path per colour and brightness, so a
 * frame is a few hundred draws at most. The dust, the stars and the pictures are made once per size
 * and seed (prime() does it before midnight), so play() has nothing slow to do.
 * The year is only ever the one it is given: no old year is shown first.
 */
(function (root) {
  'use strict';

  const APFx = root.APFx;
  if (!APFx || typeof APFx.register !== 'function') return;

  const DURATION = 12800;
  const PI = Math.PI;
  const TAU = PI * 2;

  /* ------------------------------------------------------------ timeline (ms) --- */

  const T_DRAW = 800;           // the pens close the loop
  const T_KNOT = 290;           // the first glyph's dust leaves the knot ...
  const KNOT_STAG = 240;        // ... the next one this much later (year digits)
  const KNOT_STAG_T = 120;      // (title letters, when there is no year)
  const REL_SPAN = 200;         // a glyph's dust leaves over this long
  const FLY0 = 330;             // a grain's flight, shortest ...
  const FLY1 = 460;             // ... and longest
  const T_PEEL = 1150;          // with a year: the first title letter's dust peels off the loop
  const PEEL_STAG = 85;         // the next letter's this much later
  const PEEL_SPAN = 190;
  const RIPPLES = [3100, 5900, 8500];
  const RIPPLE_V = 0.62;        // px per ms at scale 1
  const RIPPLE_LIFE = 3600;
  const ACCENT = 2600;          // a swell of colour goes once round the loop in this time
  const T_DISS = 10400;         // the title starts dissolving (left to right) ...
  const DISS_STAG = 45;
  const T_DISS_Y = 10640;       // ... and the year
  const DISS_STAG_Y = 90;
  const T_CLOSE0 = 11150;       // the loop closes into its crossing
  const T_CLOSE1 = 11950;
  const T_WINK = 11980;         // the last point of light winks out
  const T_GONE = 12360;         // nothing is drawn from here on

  /* -------------------------------------------------------------- colours --- */

  // The words: white at the top, through lilac, to violet at the foot, in a deep violet halo.
  const FILL = { stops: [[0, '#ffffff'], [0.34, '#f0e8ff'], [0.68, '#c6a6ff'], [1, '#9c76ff']], halo: 'rgba(15,7,36,0.92)' };
  // White-hot letters with no halo, added on top as a letter condenses (and when a ripple passes).
  const HOT = { stops: [[0, '#ffffff'], [1, '#efe6ff']] };
  // Lilac light in the shape of a letter, no halo: the first glow of a letter as its dust gathers.
  const GLOW = { stops: [[0, '#dcc6ff'], [1, '#a47fff']] };

  const WHITE = '#ffffff';
  const PALE = '#efe6ff';
  const LILAC = '#c19cff';
  const VIOLET = '#9670ff';
  const DEEP = '#6b3df0';
  const ROSE = '#ff94e4';
  const ICE = '#8fe2ff';
  const GOLD = '#ffe0a0';
  const DUST = [WHITE, PALE, LILAC, VIOLET, ROSE, ICE, GOLD];
  const DUST_W = [0.2, 0.27, 0.26, 0.15, 0.05, 0.05, 0.02];
  const STAR_COLS = ['#ffffff', '#e2d6ff', '#cfe6ff'];
  const SHADOW = '#0c0620';     // the deep violet of the letters' halo, under the grains that build them
  const COMET_COLS = [PALE, ROSE, ICE, LILAC, GOLD, WHITE];
  const LEVELS = 6;             // grains are drawn at this many brightnesses (one path each)

  // How the loop is drawn: a stack of strokes, widest and faintest first [width at scale 1, alpha, colour].
  const PASS_A = [[66, 0.026, '#3c1aa8'], [40, 0.05, '#5a2fe0'], [23, 0.09, DEEP], [12.5, 0.15, '#7a52ff'],
    [6.6, 0.27, '#9a78ff'], [3.3, 0.5, LILAC], [1.6, 0.85, '#f5f0ff']];
  const PASS_B = [[40, 0.03, '#7d5cff'], [22, 0.07, '#a07fff'], [12, 0.13, LILAC], [6.5, 0.26, '#dcc8ff'], [3.2, 0.55, '#f4eeff'], [1.7, 1, WHITE]];
  const PASS_C = [[44, 0.035, 0], [24, 0.075, 0], [12, 0.15, 0], [5.6, 0.32, 0], [2.6, 0.5, 1]];   // 0: the side's hue, 1: pale
  const PAD = 34;               // the widest pass reaches this far from the line (at scale 1)

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
  const easeIn = (u) => u * u;
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);
  /** 0 outside [c - w, c + w], rising smoothly to 1 at c. */
  const bump = (x, c, w) => { const u = 1 - Math.abs(x - c) / w; return u <= 0 ? 0 : u * u * (3 - 2 * u); };
  /** How far the pens have drawn the loop: 0 to 1 (fast out of the flare, gently closing). */
  const penAt = (t) => (t <= 0 ? 0 : t >= T_DRAW ? 1 : 1 - Math.pow(1 - t / T_DRAW, 2.2));
  /** When the pens have drawn this much (the inverse of penAt). */
  const penTime = (p) => T_DRAW * (1 - Math.pow(1 - clamp(p, 0, 1), 1 / 2.2));

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /* ------------------------------------------------- pictures (kept per size) --- */

  let CACHE = null;

  /** A soft round glow: white core, lilac, violet. */
  function glowSprite() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.07, 'rgba(250,244,255,0.95)');
    gr.addColorStop(0.18, 'rgba(206,176,255,0.55)');
    gr.addColorStop(0.4, 'rgba(140,100,255,0.2)');
    gr.addColorStop(0.7, 'rgba(100,60,240,0.06)');
    gr.addColorStop(1, 'rgba(90,50,230,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  }

  /** A soft violet haze with no bright core: the cloud of dust a letter condenses out of. */
  function hazeSprite() {
    const c = canvas(128, 128);
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(176,140,255,0.55)');
    gr.addColorStop(0.3, 'rgba(146,104,255,0.36)');
    gr.addColorStop(0.62, 'rgba(112,72,240,0.12)');
    gr.addColorStop(1, 'rgba(90,50,230,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return c;
  }

  /** A four-pointed glint: two thin streaks of light across a soft centre. */
  function glintSprite() {
    const c = canvas(64, 64);
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    let gr = g.createRadialGradient(32, 32, 0, 32, 32, 14);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)');
    gr.addColorStop(0.3, 'rgba(225,205,255,0.4)');
    gr.addColorStop(1, 'rgba(160,120,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    for (let k = 0; k < 2; k++) {
      g.save();
      g.translate(32, 32);
      if (k) g.rotate(PI / 2);
      g.scale(1, 0.07);
      gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)');
      gr.addColorStop(0.35, 'rgba(220,200,255,0.45)');
      gr.addColorStop(1, 'rgba(160,120,255,0)');
      g.fillStyle = gr;
      g.fillRect(-32, -32, 64, 64);
      g.restore();
    }
    return c;
  }

  /** A long horizontal lens streak (a round glow squashed sixteen times). */
  function streakSprite() {
    const c = canvas(512, 32);
    const g = c.getContext('2d');
    g.setTransform(16, 0, 0, 1, 0, 0);
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(248,242,255,1)');
    gr.addColorStop(0.12, 'rgba(206,176,255,0.75)');
    gr.addColorStop(0.4, 'rgba(130,90,255,0.22)');
    gr.addColorStop(1, 'rgba(100,60,240,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    return c;
  }

  /** One lobe of the loop in one look, drawn once on the screen's pixel grid (a frame copies it 1:1). */
  function lobePicture(G, lobe, passes, dpr, s) {
    const pad = PAD * s + 3;
    const x0 = lobe === 0 ? G.cx - G.A - pad : G.cx - pad;
    const x1 = lobe === 0 ? G.cx + pad : G.cx + G.A + pad;
    const y0 = G.cy - G.hh - pad;
    const y1 = G.cy + G.hh + pad;
    const ox = Math.floor(x0 * dpr);
    const oy = Math.floor(y0 * dpr);
    const c = canvas(Math.ceil(x1 * dpr) - ox, Math.ceil(y1 * dpr) - oy);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, -ox, -oy);
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const N = G.N;
    const k0 = lobe === 0 ? 0 : N / 2;
    const path = () => {
      g.beginPath();
      g.moveTo(G.X[k0], G.Y[k0]);
      for (let k = 2; k <= N / 2; k += 2) { const j = (k0 + k) % N; g.lineTo(G.X[j], G.Y[j]); }
      g.closePath();
    };
    for (let q = 0; q < passes.length; q++) {
      const p = passes[q];
      let col = p[2];
      if (col === 0 || col === 1) {
        // the spectral look: rose on the far left, ice blue on the far right, lilac at the crossing
        const gr = g.createLinearGradient(G.cx - G.A, 0, G.cx + G.A, 0);
        if (col === 0) {
          gr.addColorStop(0, '#ff7fd6');
          gr.addColorStop(0.28, '#d88cff');
          gr.addColorStop(0.5, '#a98cff');
          gr.addColorStop(0.72, '#86b8ff');
          gr.addColorStop(1, '#7fe6ff');
        } else {
          gr.addColorStop(0, '#ffd8f4');
          gr.addColorStop(0.5, '#f1eaff');
          gr.addColorStop(1, '#d6f7ff');
        }
        col = gr;
      }
      g.strokeStyle = col;
      g.globalAlpha = p[1];
      g.lineWidth = Math.max(q === passes.length - 1 ? 1 : 1.5, p[0] * s);
      path();
      g.stroke();
    }
    // Behind the title the loop is dimmer, so the letters stand clear of it.
    const b0 = G.band0;
    const b1 = G.band1;
    if (b1 > b0) {
      const soft = (b1 - b0) * 0.45;
      const gr = g.createLinearGradient(0, b0 - soft, 0, b1 + soft);
      const f = soft / (b1 - b0 + soft * 2);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(f, 'rgba(0,0,0,0.5)');
      gr.addColorStop(1 - f, 'rgba(0,0,0,0.5)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-out';
      g.globalAlpha = 1;
      g.fillStyle = gr;
      g.fillRect(x0, b0 - soft, x1 - x0, b1 - b0 + soft * 2);
    }
    return { c: c, ox: ox, oy: oy };
  }

  function pictures(G, dpr, s, key) {
    if (CACHE && CACHE.key === key) return CACHE;
    CACHE = null;
    const P = {
      key: key,
      A: [lobePicture(G, 0, PASS_A, dpr, s), lobePicture(G, 1, PASS_A, dpr, s)],
      B: [lobePicture(G, 0, PASS_B, dpr, s), lobePicture(G, 1, PASS_B, dpr, s)],
      C: [lobePicture(G, 0, PASS_C, dpr, s), lobePicture(G, 1, PASS_C, dpr, s)],
      glow: glowSprite(),
      haze: hazeSprite(),
      glint: glintSprite(),
      streak: streakSprite()
    };
    CACHE = P;
    return P;
  }

  /** The loop for this layout: its size and place, and points spaced evenly along it (kept per size). */
  let GEOM = null;
  /** The dust, the stars and the comets for one size, words and seed (see create()). */
  let SETUP = null;

  function geometry(W, H, L, GL, hasYear) {
    const ts = L.titleSize;
    const tTop = L.titleY - 0.37 * ts;
    const tBot = L.titleY + 0.37 * ts;
    const yTop = hasYear ? L.yearY - 0.37 * L.yearSize : Infinity;
    let wx0 = W;
    let wx1 = 0;
    for (const g of GL) { if (g.x0 < wx0) wx0 = g.x0; if (g.x1 > wx1) wx1 = g.x1; }
    // The crossing sits above the middle of the title; the lobes reach out past the ends of the
    // words and hold the title in their lower halves (their bottoms run between the two lines).
    const cy = tTop - ts * 1.05;
    const bottom = hasYear ? (tBot + yTop) / 2 + ts * 0.12 : tBot + ts * 0.5;
    const A = clamp(Math.max((wx1 - wx0) / 2 + ts * 1.6, W * 0.4), 40, Math.min(W * 0.47, H * 1.05));
    const hh = clamp(Math.min(bottom - cy, cy - H * 0.06), A * 0.16, A * 0.36);
    const key = [W, H, L.title, L.year, L.titleSize, L.titleY].join('|');
    if (GEOM && GEOM.key === key) return GEOM;
    const G = { key: key, N: 2048, cx: W / 2, cy: cy, A: A, hh: hh, B: hh / 0.353553, wx0: wx0, wx1: wx1, band0: tTop - ts * 0.12, band1: tBot + ts * 0.12 };
    const N = G.N;
    const X = (G.X = new Float32Array(N));
    const Y = (G.Y = new Float32Array(N));
    const TX = (G.TX = new Float32Array(N));
    const TY = (G.TY = new Float32Array(N));
    // Sampled evenly along its length: u = 0 is the crossing, the left lobe is u < 0.5 (up and round
    // anticlockwise), the right lobe u >= 0.5 (up and round clockwise).
    const M = 4096;
    const cum = new Float64Array(M + 1);
    let px = G.cx;
    let py = G.cy;
    for (let i = 1; i <= M; i++) {
      const a = PI / 2 + (i / M) * TAU;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const d = 1 + sn * sn;
      const x = G.cx + A * cs / d;
      const y = G.cy + G.B * sn * cs / d;
      cum[i] = cum[i - 1] + Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
    G.len = cum[M];
    let j = 0;
    for (let k = 0; k < N; k++) {
      const want = (k / N) * G.len;
      while (j < M - 1 && cum[j + 1] < want) j++;
      const f = (want - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      const a = PI / 2 + ((j + f) / M) * TAU;
      const sn = Math.sin(a);
      const cs = Math.cos(a);
      const d = 1 + sn * sn;
      X[k] = G.cx + A * cs / d;
      Y[k] = G.cy + G.B * sn * cs / d;
    }
    for (let k = 0; k < N; k++) {
      const a = (k + 1) % N;
      const b = (k + N - 1) % N;
      const dx = X[a] - X[b];
      const dy = Y[a] - Y[b];
      const l = Math.hypot(dx, dy) || 1;
      TX[k] = dx / l;
      TY[k] = dy / l;
    }
    GEOM = G;
    return G;
  }

  /* ------------------------------------------------------------------ style --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const s = env.scale;
    const ks = Math.max(0.7, s);                  // grains and stars never get smaller than this
    const dpr = env.dpr || 1;
    const rnd = env.rnd;

    const GL = env.glyphs();
    const NG = GL.length;
    const hasYear = GL.some((g) => g.line === 1);
    const ts = L.titleSize;

    const G = geometry(W, H, L, GL, hasYear);
    const N = G.N;
    const X = G.X;
    const Y = G.Y;
    const TX = G.TX;
    const TY = G.TY;
    const CX = G.cx;
    const CY = G.cy;
    const kOf = (u) => { let k = Math.round((u - Math.floor(u)) * N); if (k >= N) k -= N; return k; };
    const FOCUS = [CX - G.A * Math.SQRT1_2, CX + G.A * Math.SQRT1_2];
    const WEDGE_R = G.A * 0.8 + PAD * s + 8;

    const P = pictures(G, dpr, s, [W, H, dpr, CX, CY, G.A, G.B].join('|'));

    // Everything below is the same for the same size, words and seed: made once (prime() does it
    // before midnight) and kept, so create() at midnight has nothing slow to do.
    const fp = rnd();
    const skey = [W, H, dpr, L.title, L.year, L.titleSize, L.titleY, fp].join('|');
    const Z = SETUP && SETUP.key === skey ? SETUP : (SETUP = build());
    const S = Z.S;
    const S_ORDER = Z.S_ORDER;
    const NS = Z.NS;
    const D = Z.D;
    const D_ORDER = Z.D_ORDER;
    const NP = Z.NP;
    const LET = Z.LET;
    const DRIFT = Z.DRIFT;
    const ST_BY = Z.ST_BY;
    const COMETS = Z.COMETS;

    function build() {
      const pickCol = (bias) => {
        let r = rnd() * (1 + (DUST_W[0] + DUST_W[1]) * (bias - 1));
        for (let c = 0; c < DUST.length; c++) { const w = DUST_W[c] * (c < 2 ? bias : 1); if (r < w) return c; r -= w; }
        return 2;
      };
      function byColour(cols, count) {
        const out = [];
        for (let c = 0; c < DUST.length; c++) {
          const l = [];
          for (let i = 0; i < count; i++) if (cols[i] === c) l.push(i);
          out.push(Int32Array.from(l));
        }
        return out;
      }

      /* ---------------------------------------------------- the stream --- */

      // Stardust riding the loop, forwards (up out of the crossing, round, and back in from below).
      const NS = Math.round(clamp(G.len / (4.6 * ks), 160, 900));
      const S = {
        u0: new Float32Array(NS), v: new Float32Array(NS), off: new Float32Array(NS), wob: new Float32Array(NS),
        wf: new Float32Array(NS), ph: new Float32Array(NS), size: new Float32Array(NS), a: new Float32Array(NS), col: new Uint8Array(NS)
      };
      for (let i = 0; i < NS; i++) {
        S.u0[i] = rnd();
        S.v[i] = (0.07 + rnd() * 0.05) / 1000;
        const o = rnd() * 2 - 1;
        const wide = rnd() < 0.25;
        S.off[i] = o * o * o * (wide ? 34 : 14) * s;
        S.wob[i] = (1.5 + rnd() * 5) * s;
        S.wf[i] = 0.001 + rnd() * 0.0025;
        S.ph[i] = rnd() * TAU;
        S.size[i] = (1.2 + rnd() * rnd() * 2.6) * ks;
        S.a[i] = wide ? 0.25 + rnd() * 0.45 : 0.45 + rnd() * 0.55;
        S.col[i] = pickCol(1);
      }
      const S_ORDER = byColour(S.col, NS);

      /* ------------------------------------------------- the words' dust --- */

      // Points on the letters, each given to its letter.
      const wp = env.wordPoints(2400);
      const own = GL.map(() => []);
      const splitY = hasYear ? (L.titleY + L.yearY) / 2 : Infinity;
      for (let i = 0; i < wp.pts.length; i += 2) {
        const x = wp.pts[i];
        const y = wp.pts[i + 1];
        const line = y > splitY ? 1 : 0;
        let best = -1;
        let bd = Infinity;
        for (let k = 0; k < NG; k++) {
          const g = GL[k];
          if (g.line !== line) continue;
          const d = x < g.x0 ? g.x0 - x : x > g.x1 ? x - g.x1 : 0;
          if (d < bd) { bd = d; best = k; }
        }
        if (best >= 0) own[best].push(x, y);
      }
      // How each letter is built: from the knot (the year, or the title when there is no year), or
      // from dust peeling off the loop (the title after the year); and when.
      const LET = GL.map((g, k) => ({ g: g, k: k, knot: hasYear ? g.line === 1 : true, t0: 0, la0: Infinity, la1: 0, d0: 0, peelU: 0 }));
      {
        const titleN = GL.filter((g) => g.line === 0).length;
        const knotStag = hasYear ? KNOT_STAG : Math.min(KNOT_STAG_T, 1500 / Math.max(1, titleN - 1));
        const peelStag = Math.min(PEEL_STAG, 1000 / Math.max(1, titleN - 1));
        // (long words leave faster, so that every grain is back in the loop before it closes)
        const dissStag = Math.min(DISS_STAG, 560 / Math.max(1, titleN - 1));
        const dissStagY = Math.min(DISS_STAG_Y, 330 / Math.max(1, NG - titleN - 1));
        for (const e of LET) {
          e.t0 = e.knot ? T_KNOT + e.g.i * knotStag : T_PEEL + e.g.i * peelStag;
          e.d0 = e.g.line === 0 ? T_DISS + e.g.i * dissStag : T_DISS_Y + e.g.i * dissStagY;
        }
      }
      // The loop point a title letter's dust peels off from: the nearest one on its own side.
      for (const e of LET) {
        const gx = e.g.cx;
        const gy = e.g.top;
        const left = gx < CX;
        let best = 0;
        let bd = Infinity;
        for (let k = 0; k < N; k += 2) {
          if ((k < N / 2) !== left) continue;
          const d = (X[k] - gx) * (X[k] - gx) + (Y[k] - gy) * (Y[k] - gy) * 1.6;
          if (d < bd) { bd = d; best = k; }
        }
        e.peelU = best / N;
      }

      const capYear = Math.round(clamp(210 * Math.sqrt(Math.max(0.5, s)), 90, 260));
      const capTitle = Math.round(clamp((hasYear ? 56 : 84) * Math.sqrt(Math.max(0.5, s)), 30, 110));
      const list = [];
      for (const e of LET) {
        const pts = own[e.k];
        const n = pts.length / 2;
        const cap = e.g.line === 1 ? capYear : capTitle;
        // a fair pick of at most `cap` points
        const idx = new Int32Array(n);
        for (let i = 0; i < n; i++) idx[i] = i;
        for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp; }
        const m = Math.min(cap, n);
        for (let q = 0; q < m; q++) list.push({ e: e, x: pts[idx[q] * 2], y: pts[idx[q] * 2 + 1] });
      }
      const NP = list.length;
      const D = {
        tx: new Float32Array(NP), ty: new Float32Array(NP), knot: new Uint8Array(NP),
        // before the release: knot grains drain down the loop from where a pen shed them and swirl in
        // the knot; peel grains ride the loop
        lobe: new Uint8Array(NP), ub: new Float32Array(NP), tb: new Float32Array(NP), ta: new Float32Array(NP),
        r: new Float32Array(NP), th: new Float32Array(NP), w: new Float32Array(NP),
        up: new Float32Array(NP), v: new Float32Array(NP), off: new Float32Array(NP),
        // the flight in: P0 P1 P2 -> the target, from rel to land
        rel: new Float32Array(NP), land: new Float32Array(NP),
        x0: new Float32Array(NP), y0: new Float32Array(NP), x1: new Float32Array(NP), y1: new Float32Array(NP), x2: new Float32Array(NP), y2: new Float32Array(NP),
        // the way out: off the letter at `out`, to the loop at `back`
        out: new Float32Array(NP), back: new Float32Array(NP), uq: new Float32Array(NP),
        ox1: new Float32Array(NP), oy1: new Float32Array(NP), ox2: new Float32Array(NP), oy2: new Float32Array(NP),
        size: new Float32Array(NP), col: new Uint8Array(NP), ph: new Float32Array(NP),
        // the letter it builds, and when that letter has formed (its last grain has landed)
        lt: new Int32Array(NP), lf: new Float32Array(NP)
      };
      for (let i = 0; i < NP; i++) {
        const it = list[i];
        const e = it.e;
        const g = e.g;
        D.tx[i] = it.x;
        D.ty[i] = it.y;
        D.knot[i] = e.knot ? 1 : 0;
        D.ph[i] = rnd() * TAU;
        D.size[i] = (g.line === 1 ? 1.8 + rnd() * 1.6 : 1.4 + rnd() * 1.3) * ks;
        D.col[i] = pickCol(1.6);
        const rel = e.t0 + rnd() * (e.knot ? REL_SPAN : PEEL_SPAN);
        D.rel[i] = rel;
        const fly = FLY0 + rnd() * (FLY1 - FLY0) + (e.knot ? 0 : -40);
        D.land[i] = rel + fly;
        // the letter's shape, blown up round its middle: the grains condense from it
        const gx = g.cx;
        const gy = g.cy;
        const spread = 1.7 + rnd() * 0.7;
        D.x2[i] = gx + (it.x - gx) * spread + (rnd() - 0.5) * g.size * 0.12;
        D.y2[i] = gy + (it.y - gy) * spread - g.size * (0.08 + rnd() * 0.18);
        if (e.knot) {
          // shed by a pen near the crossing, drains back into the knot, swirls there
          D.lobe[i] = rnd() < 0.5 ? 0 : 1;
          const ta = Math.max(50, rel - 50 - rnd() * 230);
          let ub = 0.015 + rnd() * 0.15;
          let dur = 110 + ub * 1200;
          // the pen must have passed the point before the grain can leave it
          for (let k = 0; k < 8 && ta - dur < penTime(ub * 2); k++) { ub *= 0.65; dur = 110 + ub * 1200; }
          D.ub[i] = ub;
          D.tb[i] = Math.max(penTime(ub * 2), ta - dur);
          D.ta[i] = Math.max(D.tb[i] + 50, ta);
          D.r[i] = (4 + Math.pow(rnd(), 0.8) * 44) * Math.max(0.6, s);
          D.th[i] = rnd() * TAU;
          D.w[i] = 0.0075 + rnd() * 0.005;
          // where it is in the knot when it leaves; it leaves towards its letter
          const age = rel - D.ta[i];
          const rr = D.r[i] * smooth(0, 160, age);
          const th = D.th[i] + D.w[i] * age;
          D.x0[i] = CX + rr * Math.cos(th);
          D.y0[i] = CY + rr * Math.sin(th) * 0.42;
          const vx = -Math.sin(th);
          const vy = Math.cos(th) * 0.42;
          const vl = Math.hypot(vx, vy) || 1;
          const dx = gx - D.x0[i];
          const dy = gy - D.y0[i];
          const dl = Math.hypot(dx, dy) || 1;
          const k1 = (40 + rnd() * 40) * s;
          D.x1[i] = D.x0[i] + (vx / vl * 0.55 + dx / dl * 0.45) * k1 * 1.6;
          D.y1[i] = D.y0[i] + (vy / vl * 0.55 + dy / dl * 0.45) * k1 * 1.6;
        } else {
          // riding the loop until it peels off near the letter
          const v = (0.07 + rnd() * 0.05) / 1000;
          const up = e.peelU + (rnd() - 0.5) * 0.04;
          D.up[i] = up;
          D.v[i] = v;
          const o = rnd() * 2 - 1;
          D.off[i] = o * o * o * 14 * s;
          const k = kOf(up);
          D.x0[i] = X[k] - TY[k] * D.off[i];
          D.y0[i] = Y[k] + TX[k] * D.off[i];
          const k1 = (40 + rnd() * 50) * s;
          D.x1[i] = D.x0[i] + TX[k] * k1;
          D.y1[i] = D.y0[i] + TY[k] * k1 + 12 * s;
        }
        if (D.land[i] < e.la0) e.la0 = D.land[i];
        if (D.land[i] > e.la1) e.la1 = D.land[i];
        D.lt[i] = e.k;
        // The way out: lifted off the letter, back to the loop (title) or the knot (year).
        const out = e.d0 + rnd() * 300;
        D.out[i] = out;
        D.back[i] = out + 420 + rnd() * 260;
        const lift = 0.35 + rnd() * 0.5;
        D.ox1[i] = it.x + (it.x - gx) * lift + (rnd() - 0.5) * 30 * s;
        D.oy1[i] = it.y + (it.y - gy) * lift - (30 + rnd() * 50) * s;
        if (e.knot && hasYear) {
          D.uq[i] = -1;
          D.ox2[i] = CX + (it.x - CX) * 0.35;
          D.oy2[i] = CY + (it.y - CY) * 0.2;
        } else {
          const uq = e.peelU + (rnd() - 0.5) * 0.05;
          D.uq[i] = uq;
          const k = kOf(uq);
          D.ox2[i] = X[k] - TX[k] * 60 * s;
          D.oy2[i] = Y[k] - TY[k] * 60 * s;
        }
      }
      // A letter too thin to get any grain (a very small screen) still condenses, on the same beat.
      for (const e of LET) {
        if (e.la1 > 0) continue;
        e.la0 = e.t0 + FLY0;
        e.la1 = e.t0 + (e.knot ? REL_SPAN : PEEL_SPAN) + FLY1;
      }
      for (let i = 0; i < NP; i++) D.lf[i] = LET[D.lt[i]].la1;
      const D_ORDER = byColour(D.col, NP);

      // A grain now and then peels off the loop during the hold and settles on a letter.
      const DRIFT = [];
      {
        const nd = Math.round(34 * Math.max(0.6, Math.min(1.4, s)));
        for (let i = 0; i < nd && NG; i++) {
          const e = LET[Math.floor(rnd() * NG)];
          const pts = own[e.k];
          if (!pts.length) continue;
          const q = Math.floor(rnd() * (pts.length / 2));
          const t0 = 3200 + rnd() * 6400;
          const k = kOf(e.peelU + (rnd() - 0.5) * 0.06);
          DRIFT.push({ t0: t0, t1: t0 + 700 + rnd() * 400, life: 900 + rnd() * 700,
            x0: X[k], y0: Y[k], x1: X[k] + TX[k] * 50 * s, y1: Y[k] + TY[k] * 50 * s,
            x3: pts[q * 2], y3: pts[q * 2 + 1], col: rnd() < 0.5 ? 0 : rnd() < 0.5 ? 4 : 5, size: (1.8 + rnd()) * ks });
        }
      }

      /* ------------------------------------------------------- the stars --- */

      const ST = [];
      {
        const nst = Math.round(clamp(W * H / 14000, 30, 180));
        const bx0 = G.wx0 - ts * 0.6;
        const bx1 = G.wx1 + ts * 0.6;
        const by0 = L.top - ts * 0.15;
        const by1 = L.bottom + ts * 0.15;
        let tries = 0;
        while (ST.length < nst && tries++ < nst * 8) {
          const x = rnd() * W;
          const y = rnd() * H;
          if (x > bx0 && x < bx1 && y > by0 && y < by1) continue;
          const big = rnd() < 0.12;
          const dist = Math.hypot(x - CX, (y - CY) * 1.3);
          ST.push({ x: x, y: y, d: dist, on: 60 + dist / (1.9 * Math.max(0.5, s)), big: big,
            size: (big ? 1.7 + rnd() * 1.2 : 0.9 + rnd() * 1.3) * ks, a: big ? 0.8 + rnd() * 0.2 : 0.35 + rnd() * 0.5,
            w: 0.0015 + rnd() * 0.003, ph: rnd() * TAU, col: rnd() < 0.55 ? 0 : rnd() < 0.6 ? 1 : 2, gl: (12 + rnd() * 14) * Math.max(0.6, s) });
        }
      }
      const ST_BY = [0, 1, 2].map((c) => ST.filter((st) => st.col === c));

      // Comets of light running round the loop during the hold.
      const COMETS = [];
      for (let c = 0; c < 3; c++) COMETS.push({ u0: c / 3 + rnd() * 0.1, v: (0.2 + rnd() * 0.06) / 1000, ph: c * 2 + rnd() });
      return { key: skey, S: S, S_ORDER: S_ORDER, NS: NS, D: D, D_ORDER: D_ORDER, NP: NP, LET: LET, DRIFT: DRIFT, ST_BY: ST_BY, COMETS: COMETS };
    }

    /* ---------------------------------------------------------- drawing --- */

    let n = 0;
    // A batch of grains of one colour: where they are, how big and how bright (in LEVELS steps).
    const MAXB = Math.max(NS, NP, ST_BY[0].length + ST_BY[1].length + ST_BY[2].length, 64) + 8;
    const BX = new Float32Array(MAXB);
    const BY = new Float32Array(MAXB);
    const BS = new Float32Array(MAXB);
    const BL = new Uint8Array(MAXB);
    let nb = 0;
    // The words' dust in this frame: place, size, brightness, glow, which grain, colour.
    const GX = new Float32Array(NP + 1);
    const GY = new Float32Array(NP + 1);
    const GZ = new Float32Array(NP + 1);
    const GA = new Float32Array(NP + 1);
    const GG = new Float32Array(NP + 1);
    const GI = new Int32Array(NP + 1);
    const GC = new Uint8Array(NP + 1);
    const GD = new Float32Array(NP + 1);
    function add(x, y, size, a) {
      const lv = Math.round((a > 1 ? 1 : a) * LEVELS);
      if (lv <= 0 || nb >= MAXB) return;
      BX[nb] = x;
      BY[nb] = y;
      BS[nb] = size;
      BL[nb] = lv;
      nb++;
    }
    /** The batch so far in one colour: one path per brightness. */
    function flush(col) {
      if (!nb) return;
      ctx.fillStyle = col;
      for (let lv = 1; lv <= LEVELS; lv++) {
        let any = false;
        for (let j = 0; j < nb; j++) {
          if (BL[j] !== lv) continue;
          if (!any) { ctx.beginPath(); any = true; }
          const z = BS[j];
          ctx.rect(BX[j] - z / 2, BY[j] - z / 2, z, z);
        }
        if (any) { ctx.globalAlpha = lv / LEVELS; ctx.fill(); n++; }
      }
      nb = 0;
    }

    /** A picture stamped centred on (x, y), size x size. */
    function stamp(img, x, y, size, a) {
      if (a <= 0.004 || size <= 0.2) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      n++;
    }

    /** How much of the loop is left as it closes into its crossing (1 to 0). */
    const closeAt = (t) => 1 - easeIn(clamp((t - T_CLOSE0) / (T_CLOSE1 - T_CLOSE0), 0, 1));

    /** One lobe picture, 1:1 on the pixel grid, at alpha a. */
    function lobe(pic, a) {
      if (a <= 0.004) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(pic.c, pic.ox / dpr, pic.oy / dpr, pic.c.width / dpr, pic.c.height / dpr);
      n++;
    }

    /** The angle round lobe j's focus of the pen that has drawn fraction f of it. */
    function penAngle(j, f) {
      const k = kOf(j * 0.5 + f * 0.5);
      const a = Math.atan2(Y[k] - CY, X[k] - FOCUS[j]);
      if (j === 0) return a > 0 && f > 0.25 ? a - TAU : Math.min(a, 0);
      return a < 0 ? a + TAU : f < 0.25 ? Math.max(a, PI) : a + TAU;
    }

    function drawLoop(t, sc, lo) {
      const p = penAt(t);
      if (p <= 0) return;
      const fade = smooth(T_CLOSE1 - 120, T_CLOSE1 + 60, t);
      const base = (1 - fade) * (0.6 + 0.4 * smooth(0, 300, t));
      if (p < 1) {
        // being drawn: each lobe shows as far round as its pen has gone
        for (let j = 0; j < 2; j++) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(FOCUS[j], CY);
          ctx.arc(FOCUS[j], CY, WEDGE_R, j === 0 ? 0 : PI, penAngle(j, p), j === 0);
          ctx.closePath();
          ctx.clip();
          lobe(P.A[j], base);
          ctx.restore();
        }
        return;
      }
      if (sc < 0.999) {
        // closing: the lobe pictures shrink into the crossing, burning whiter as they go
        ctx.save();
        ctx.translate(CX, CY);
        ctx.scale(sc, sc);
        ctx.translate(-CX, -CY);
        for (let j = 0; j < 2; j++) {
          const pa = P.A[j];
          ctx.globalAlpha = clamp(base * (0.55 + 0.45 * sc), 0, 1);
          ctx.drawImage(pa.c, pa.ox / dpr, pa.oy / dpr, pa.c.width / dpr, pa.c.height / dpr);
          n++;
          // (the white-hot look only once the loop has shrunk a little: a large scaled copy is slow)
          const wb = base * 0.85 * smooth(0.1, 0.55, 1 - sc);
          if (wb > 0.01) {
            const pb = P.B[j];
            ctx.globalAlpha = wb > 1 ? 1 : wb;
            ctx.drawImage(pb.c, pb.ox / dpr, pb.oy / dpr, pb.c.width / dpr, pb.c.height / dpr);
            n++;
          }
        }
        ctx.restore();
        return;
      }
      // the light of the loop shifts: a swell of colour goes round it, through the left lobe and
      // then the right, lilac one time and rose and ice blue the next; the whole loop flares as it
      // closes and again as each ripple leaves the crossing
      const flare = bump(t, T_DRAW + 60, 420);
      let rip = 0;
      for (let r = 0; r < RIPPLES.length; r++) rip += bump(t, RIPPLES[r] + 250, 450);
      const cyc = Math.max(0, t - T_DRAW - 700) / ACCENT;
      const turn = Math.floor(cyc);
      const f = cyc - turn;
      const swell = smooth(T_DRAW + 700, T_DRAW + 1700, t) * (1 - fade);
      for (let j = 0; j < 2; j++) {
        lobe(P.A[j], base);
        if (lo) continue;
        // this lobe's share of the swell (each lobe has it for half a turn, overlapping a little)
        const w = swell * 0.7 * (j === 0 ? bump(f, 0.25, 0.32) + bump(f, 1.25, 0.32) : bump(f, 0.75, 0.32) + bump(f, -0.25, 0.32));
        const wB = 0.6 * flare + 0.35 * rip + ((turn & 1) === 0 ? w : 0);
        const wC = (turn & 1) === 1 ? w : 0;
        if (wB > 0.02) lobe(P.B[j], wB * (1 - fade));
        else if (wC > 0.02) lobe(P.C[j], wC);
      }
    }

    function drawPens(t) {
      if (t >= T_DRAW + 220) return;
      const p = penAt(t);
      const a = 1 - smooth(T_DRAW - 120, T_DRAW + 220, t);
      for (let j = 0; j < 2; j++) {
        for (let q = 8; q >= 0; q--) {
          const f = p - q * 0.011 * (0.4 + p);
          if (f < 0) continue;
          const k = kOf(j * 0.5 + f * 0.5);
          const fall = 1 - q / 9;
          stamp(P.glow, X[k], Y[k], (q ? 30 : 70) * s * (0.5 + 0.5 * fall), a * fall * (q ? 0.5 : 1));
        }
        const k = kOf(j * 0.5 + p * 0.5);
        stamp(P.glint, X[k], Y[k], 44 * s, a);
      }
      // the moment the pens meet: the loop closes with a flash at the crossing
      const meet = bump(t, T_DRAW, 240);
      if (meet > 0.01) {
        stamp(P.glow, CX, CY, 170 * s, 0.6 * meet);
        ctx.globalAlpha = 0.55 * meet;
        const sw = 620 * s * (0.6 + 0.4 * meet);
        ctx.drawImage(P.streak, CX - sw / 2, CY - 10 * s, sw, 20 * s);
        n++;
      }
    }

    function drawFlare(t) {
      if (t > 560) return;
      // midnight: a point flares at the crossing, with a long thin streak of light
      const k = t / 560;
      const a = 1 - smooth(60, 560, t);
      stamp(P.glow, CX, CY, (140 + 280 * easeOut(k)) * s, 0.6 * a);
      ctx.globalAlpha = 0.75 * a;
      const sw = Math.min(W * 1.15, 1500 * s) * (0.35 + 0.65 * easeOut(k));
      ctx.drawImage(P.streak, CX - sw / 2, CY - 12 * s, sw, 24 * s);
      n++;
      stamp(P.glint, CX, CY, 110 * s * (1 - 0.5 * k), a);
    }

    function drawKnot(t, sc) {
      // the knot's glow: grows as the dust gathers, burns while it pours out, then settles to the
      // bright crossing of the loop
      const gather = smooth(20, 300, t);
      const busy = hasYear ? 1 - smooth(1250, 1950, t) : 1 - smooth(1700, 2600, t);
      const a = gather * (0.4 + 0.45 * busy) * (1 - smooth(T_CLOSE1 - 100, T_CLOSE1 + 80, t));
      if (a <= 0.01) return;
      const beat = 1 + 0.1 * Math.sin(t * 0.007);
      stamp(P.glow, CX, CY, (46 + 70 * busy) * s * beat * (0.4 + 0.6 * sc), a);
    }

    function drawStars(t, lo) {
      if (t < 50) return;
      const fa = 1 - smooth(10900, 12000, t);
      if (fa <= 0.004) return;
      let glints = 0;
      for (let c = 0; c < 3; c++) {
        const list = ST_BY[c];
        for (let i = 0; i < list.length; i++) {
          const st = list[i];
          const since = t - st.on;
          if (since < 0) continue;
          // the wave of the flare lights it (a flash), then it twinkles
          let a = st.a * (0.6 + 0.4 * Math.sin(st.ph + t * st.w)) * smooth(0, 380, since) + 0.8 * bump(since, 70, 150);
          let size = st.size;
          for (let r = 0; r < RIPPLES.length; r++) {
            const ar = t - RIPPLES[r];
            if (ar < 0 || ar > RIPPLE_LIFE) continue;
            const b = bump(st.d, ar * RIPPLE_V * s, 90 * s);
            if (b > 0) { a += 0.7 * b; size *= 1 + 0.8 * b; }
          }
          a *= fa;
          if (a <= 0.02) continue;
          add(st.x, st.y, size, a);
          if (st.big && !lo && glints < 40) {
            stamp(P.glint, st.x, st.y, st.gl * (0.75 + 0.25 * Math.sin(st.ph * 1.7 + t * st.w * 1.3)), a * 0.75);
            glints++;
          }
        }
        flush(STAR_COLS[c]);
      }
    }

    /** The ripples' push on a point at distance d from the crossing (0 to about 1). */
    function ripplePush(t, d) {
      let push = 0;
      for (let r = 0; r < RIPPLES.length; r++) {
        const ar = t - RIPPLES[r];
        if (ar < 0 || ar > RIPPLE_LIFE) continue;
        push += bump(d, ar * RIPPLE_V * s, 70 * s) * (1 - ar / RIPPLE_LIFE);
      }
      return push;
    }

    function drawStream(t, sc, lo) {
      const p = penAt(t);
      if (p <= 0) return;
      const drawn = 0.5 * p;
      const fa = 1 - smooth(T_CLOSE1 - 150, T_CLOSE1 + 50, t);
      if (fa <= 0.004) return;
      const step = lo ? 2 : 1;
      const rippling = t > RIPPLES[0] && t < RIPPLES[RIPPLES.length - 1] + RIPPLE_LIFE;
      for (let c = 0; c < S_ORDER.length; c++) {
        const ids = S_ORDER[c];
        for (let q = 0; q < ids.length; q += step) {
          const i = ids[q];
          const u = S.u0[i] + S.v[i] * t;
          const uf = u - Math.floor(u);
          const rel = uf < 0.5 ? uf : uf - 0.5;
          if (rel > drawn) continue;
          const k = kOf(uf);
          const o = S.off[i] + Math.sin(S.ph[i] + t * S.wf[i]) * S.wob[i];
          let x = X[k] - TY[k] * o;
          let y = Y[k] + TX[k] * o;
          if (rippling) {
            const dx = x - CX;
            const dy = y - CY;
            const d = Math.hypot(dx, dy * 1.3) || 1;
            const push = ripplePush(t, d) * 9 * s;
            if (push > 0.05) { x += dx / d * push; y += dy / d * push; }
          }
          if (sc < 0.999) { x = CX + (x - CX) * sc; y = CY + (y - CY) * sc; }
          const a = S.a[i] * fa * clamp((drawn - rel) * 30, 0, 1) * (0.7 + 0.3 * Math.sin(S.ph[i] * 3 + t * 0.005));
          if (a > 0.02) add(x, y, S.size[i], a);
        }
        flush(DUST[c]);
      }
    }

    function drawComets(t, sc, lo) {
      if (t < T_DRAW - 100 || t > T_CLOSE1) return;
      const fa = smooth(T_DRAW - 100, T_DRAW + 500, t) * (1 - smooth(T_CLOSE0, T_CLOSE1, t));
      if (fa <= 0.01) return;
      const tail = lo ? 6 : 16;
      for (const cm of COMETS) {
        const u = cm.u0 + cm.v * (t - T_DRAW);
        // its colour drifts through the spectrum, one hue every few seconds
        const ci = Math.floor((t - T_DRAW) / 2300 + cm.ph) % COMET_COLS.length;
        const spr = env.sprite(COMET_COLS[ci]);
        for (let q = tail - 1; q >= 0; q--) {
          const k = kOf(u - q * 0.0040);
          let x = X[k];
          let y = Y[k];
          if (sc < 0.999) { x = CX + (x - CX) * sc; y = CY + (y - CY) * sc; }
          const fall = 1 - q / tail;
          stamp(spr, x, y, (q ? 22 : 40) * s * (0.4 + 0.6 * fall), fa * (q ? 0.5 : 0.95) * fall);
        }
        const k = kOf(u);
        const hx = sc < 0.999 ? CX + (X[k] - CX) * sc : X[k];
        const hy = sc < 0.999 ? CY + (Y[k] - CY) * sc : Y[k];
        stamp(P.glow, hx, hy, 46 * s, 0.55 * fa);
        if (!lo) stamp(P.glint, hx, hy, 34 * s, 0.7 * fa);
      }
    }

    /** Where a grain of the words' dust is at t (into PX, PY, size factor PS), and how bright. */
    let PX = 0;
    let PY = 0;
    let PS = 1;
    let PG = 0;                                 // how much glow it carries
    let PD = 0;                                 // how dark a shadow it casts (only on its way to and from a letter)
    function grain(i, t, drawn, sc) {
      PS = 1;
      PG = 0;
      PD = 0;
      if (t < D.rel[i]) {
        if (D.knot[i]) {
          if (t < D.tb[i]) return 0;
          if (t < D.ta[i]) {
            // draining down the loop into the crossing, faster and faster
            const f = (t - D.tb[i]) / (D.ta[i] - D.tb[i]);
            const k = kOf(D.lobe[i] * 0.5 + D.ub[i] * (1 - easeIn(f)));
            PX = X[k];
            PY = Y[k];
            PG = 0.5 * (1 - smooth(0.75, 1, f));
            return 0.85 * smooth(0, 0.15, f);
          }
          // swirling in the knot
          const age = t - D.ta[i];
          const rr = D.r[i] * smooth(0, 160, age);
          const th = D.th[i] + D.w[i] * age;
          PX = CX + rr * Math.cos(th);
          PY = CY + rr * Math.sin(th) * 0.42;
          return 0.85;
        }
        // riding the loop
        const u = D.up[i] - D.v[i] * (D.rel[i] - t);
        const uf = u - Math.floor(u);
        const rel = uf < 0.5 ? uf : uf - 0.5;
        if (rel > drawn) return 0;
        const k = kOf(uf);
        PX = X[k] - TY[k] * D.off[i];
        PY = Y[k] + TX[k] * D.off[i];
        return 0.85 * clamp((drawn - rel) * 30, 0, 1);
      }
      if (t < D.land[i]) {
        // flying in: out of the knot or off the loop, round, and condensing into the letter
        const f = (t - D.rel[i]) / (D.land[i] - D.rel[i]);
        const e = 1 - Math.pow(1 - f, 2.3);
        const m = 1 - e;
        const b0 = m * m * m;
        const b1 = 3 * m * m * e;
        const b2 = 3 * m * e * e;
        const b3 = e * e * e;
        PX = b0 * D.x0[i] + b1 * D.x1[i] + b2 * D.x2[i] + b3 * D.tx[i];
        PY = b0 * D.y0[i] + b1 * D.y1[i] + b2 * D.y2[i] + b3 * D.ty[i];
        PS = 1 + 0.4 * bump(f, 0.45, 0.5);
        PG = smooth(0, 0.15, f);
        PD = smooth(0, 0.1, f);
        return 0.85 + 0.15 * smooth(0, 0.2, f);
      }
      if (t < D.out[i]) {
        // landed: a flash, then it stays, one grain of the letter in dust, until the letter has formed
        // round it; then it melts into the letter
        const lf = D.lf[i];
        if (t > lf + 560) return 0;
        const since = t - D.land[i];
        PX = D.tx[i];
        PY = D.ty[i];
        PS = 1 + 0.8 * (1 - smooth(0, 180, since));
        PG = 1 - smooth(0, 220, since);
        PD = 1 - smooth(lf - 60, lf + 120, t);     // (the letter's own halo takes over)
        return (0.72 + 0.28 * (1 - smooth(0, 260, since))) * (1 - smooth(lf + 60, lf + 560, t));
      }
      if (t < D.back[i]) {
        // lifted off the letter and drawn back into the loop
        const f = (t - D.out[i]) / (D.back[i] - D.out[i]);
        const e = easeInOut(f);
        const m = 1 - e;
        let qx;
        let qy;
        if (D.uq[i] < 0) {
          qx = CX;
          qy = CY;
        } else {
          const k = kOf(D.uq[i]);
          qx = X[k];
          qy = Y[k];
        }
        let x2 = D.ox2[i];
        let y2 = D.oy2[i];
        if (sc < 0.999) { qx = CX + (qx - CX) * sc; qy = CY + (qy - CY) * sc; x2 = CX + (x2 - CX) * sc; y2 = CY + (y2 - CY) * sc; }
        PX = m * m * m * D.tx[i] + 3 * m * m * e * D.ox1[i] + 3 * m * e * e * x2 + e * e * e * qx;
        PY = m * m * m * D.ty[i] + 3 * m * m * e * D.oy1[i] + 3 * m * e * e * y2 + e * e * e * qy;
        PS = 1 + 0.5 * bump(f, 0.25, 0.25);
        PG = 0.7 * (1 - smooth(0.7, 1, f));
        PD = 1 - smooth(0.35, 0.75, f);
        return (0.95 - 0.1 * smooth(0.7, 1, f)) * smooth(0, 0.08, f) * (1 - smooth(T_CLOSE1 - 200, T_CLOSE1 + 40, t));
      }
      // back on the loop (or in the knot), going round into the crossing as the loop closes
      const age = t - D.back[i];
      if (D.uq[i] < 0) {
        const th = D.th[i] + D.w[i] * age;
        const rr = D.r[i] * 0.8 * smooth(0, 200, age);
        PX = CX + rr * Math.cos(th) * sc;
        PY = CY + rr * Math.sin(th) * 0.42 * sc;
      } else {
        const k = kOf(D.uq[i] + 0.00012 * age);
        PX = CX + (X[k] - CX) * sc;
        PY = CY + (Y[k] - CY) * sc;
      }
      return 0.85 * (1 - smooth(T_CLOSE1 - 200, T_CLOSE1 + 40, t));
    }

    /**
     * Where every grain of the words' dust is in this frame (kept in GX.. for drawWordDust, in order of
     * colour), and a small dark shadow under each, drawn before the letters: the letters have a dark
     * halo too, and with it the dust that builds them can be seen pouring in over a bright picture.
     */
    let GM = 0;
    function placeWordDust(t, sc) {
      const drawn = 0.5 * penAt(t);
      let m = 0;
      // (all of it even when the PC struggles: it builds the words, and half of it vanishing in the
      // middle of a letter would show)
      for (let c = 0; c < D_ORDER.length; c++) {
        const ids = D_ORDER[c];
        for (let q = 0; q < ids.length; q++) {
          const i = ids[q];
          let a = grain(i, t, drawn, sc);
          if (a <= 0.02) continue;
          a *= 0.8 + 0.2 * Math.sin(D.ph[i] + t * 0.013);
          GX[m] = PX;
          GY[m] = PY;
          GZ[m] = D.size[i] * PS;
          GA[m] = a;
          GG[m] = PG;
          GD[m] = PD;
          GI[m] = i;
          GC[m] = c;
          m++;
        }
      }
      GM = m;
      if (!m) return;
      ctx.globalCompositeOperation = 'source-over';
      for (let j = 0; j < m; j++) if (GD[j] > 0.02) add(GX[j], GY[j], GZ[j] * 2.2, GA[j] * GD[j] * 0.3);
      flush(SHADOW);
    }

    function drawWordDust(t) {
      let glows = 0;
      const maxGlows = env.low() ? 0 : 140;
      const m = GM;
      if (m) {
        let j = 0;
        for (let c = 0; c < DUST.length; c++) {
          if (j >= m || GC[j] !== c) continue;
          const spr = env.sprite(DUST[c]);
          for (; j < m && GC[j] === c; j++) {
            const sz = GZ[j];
            const a = GA[j];
            add(GX[j], GY[j], sz, a);
            // a soft glow round some of the moving grains
            if (GG[j] > 0.05 && glows < maxGlows && (GI[j] % 3) === 0) {
              const gs = sz * 5.5;
              ctx.globalAlpha = a * 0.3 * GG[j];
              ctx.drawImage(spr, GX[j] - gs / 2, GY[j] - gs / 2, gs, gs);
              n++;
              glows++;
            }
          }
          flush(DUST[c]);
        }
      }
      // grains drifting off the loop onto the letters during the hold
      if (t > 3000 && t < 10500) {
        for (const d of DRIFT) {
          if (t < d.t0 || t > d.t1 + d.life) continue;
          let x;
          let y;
          let a;
          if (t < d.t1) {
            const f = (t - d.t0) / (d.t1 - d.t0);
            const e = easeInOut(f);
            const m = 1 - e;
            x = m * m * m * d.x0 + 3 * m * m * e * d.x1 + 3 * m * e * e * d.x3 + e * e * e * d.x3;
            y = m * m * m * d.y0 + 3 * m * m * e * d.y1 + 3 * m * e * e * (d.y3 - 40 * s) + e * e * e * d.y3;
            a = 0.9 * smooth(0, 0.1, f);
          } else {
            x = d.x3;
            y = d.y3;
            a = 1 - smooth(0, d.life, t - d.t1);
            if (t - d.t1 < 300) stamp(P.glint, x, y, 22 * s * (1 - (t - d.t1) / 300), 0.8 * a);
          }
          ctx.fillStyle = DUST[d.col];
          ctx.globalAlpha = a;
          ctx.fillRect(x - d.size / 2, y - d.size / 2, d.size, d.size);
          n++;
        }
      }
    }

    function drawWords(t) {
      if (t < 200 || t >= T_CLOSE1) return;
      for (const e of LET) {
        const g = e.g;
        const la0 = e.la0;
        const la1 = e.la1;
        const d0 = e.d0;
        if (t < la0 - 120) continue;
        const span = Math.max(90, la1 - la0);
        // A letter condenses out of its dust: the grains land one by one and draw it in dust first
        // (see grain()); a haze gathers round it and pulls in; once a third of the grains are there
        // the letter's shape starts to glow lilac between them, and as the last of them land it burns
        // white and cools into its colours. At the end it flares, its colours go, and its light thins
        // out as its dust lifts off.
        const brk = smooth(d0, d0 + 220, t);
        const thin = smooth(d0 + 40, d0 + 340, t);
        if (thin >= 1) continue;
        const ha = 0.42 * smooth(la0 - 120, la0 + span * 0.5, t) * (1 - smooth(la1 - 160, la1 + 140, t));
        if (ha > 0.01) {
          ctx.globalCompositeOperation = 'lighter';
          stamp(P.haze, g.cx, g.cy, g.size * (2.1 - 0.9 * smooth(la0 - 120, la1, t)), ha);
          ctx.globalCompositeOperation = 'source-over';
        }
        const a = smooth(la0 + span * 0.6, la1 + 160, t) * (1 - brk);
        if (a > 0.003) { env.glyph(g, a, FILL); n++; }
        const glow = 0.7 * smooth(la0 + span * 0.35, la1, t) * (1 - smooth(la1 + 40, la1 + 360, t)) +
          0.55 * smooth(d0 - 20, d0 + 110, t) * (1 - thin);
        if (glow > 0.01) { env.glyph(g, glow, GLOW, { op: 'lighter' }); n++; }
        let hot = 0.75 * smooth(la0 + span * 0.7, la1 + 20, t) * (1 - smooth(la1 + 30, la1 + 320, t));
        hot += 0.55 * bump(t, d0 + 50, 170);
        // and it glints as a ripple passes
        const dc = Math.hypot(g.cx - CX, (g.cy - CY) * 1.3);
        hot += 0.4 * ripplePush(t, dc) * (1 - brk);
        if (hot > 0.01) { env.glyph(g, hot * (1 - thin), HOT, { op: 'lighter' }); n++; }
      }
    }

    function drawWink(t) {
      if (t < T_CLOSE1 - 300 || t >= T_GONE) return;
      // the loop has closed into its crossing: a point of light that flares and winks out
      const k = t < T_WINK ? smooth(T_CLOSE1 - 300, T_WINK, t) : 1 - smooth(T_WINK, T_GONE - 20, t);
      if (k <= 0.004) return;
      stamp(P.glow, CX, CY, 100 * s * k, 0.85 * k);
      stamp(P.glint, CX, CY, 80 * s * (0.3 + 0.7 * k), k);
      ctx.globalAlpha = 0.5 * k;
      const sw = 400 * s * k;
      ctx.drawImage(P.streak, CX - sw / 2, CY - 7 * s, sw, 14 * s);
      n++;
    }

    function draw(t) {
      if (!(t >= 0) || t >= T_GONE) return 0;
      n = 0;
      nb = 0;
      const lo = env.low();
      const sc = closeAt(t);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawStars(t, lo);
      drawLoop(t, sc, lo);
      drawComets(t, sc, lo);
      drawKnot(t, sc);
      drawStream(t, sc, lo);
      drawPens(t);
      drawFlare(t);
      placeWordDust(t, sc);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      drawWords(t);
      ctx.globalCompositeOperation = 'lighter';
      drawWordDust(t);
      drawWink(t);
      ctx.restore();
      return n;
    }

    /**
     * Before midnight (the canvas is idle then): the letters are made in every look they are drawn
     * in, and a few frames are drawn and wiped at once, so every picture, sprite and code path is
     * ready and the first frames at midnight have nothing slow left to do.
     */
    function prime() {
      env.warm(FILL);
      env.warm(HOT);
      env.warm(GLOW);
      for (const c of DUST.concat(COMET_COLS)) env.sprite(c);
      const cv = ctx.canvas;
      ctx.save();
      for (const t of [30, 260, 520, 900, 1500, 4300, 10700, 11500, 12100]) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw(t);
      }
      ctx.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.restore();
    }

    return { step: function () {}, draw: draw, prime: prime };
  }

  APFx.register('infinity', { name: 'Infinity', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
