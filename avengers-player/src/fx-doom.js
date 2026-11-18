/*!
 * Avengers Player: 'doom', sorcery and steel (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays: a green flash with a burst of rays and a shock ring, and two
 *             heads of green fire race round a great circle from the top, drawing it and shedding
 *             sparks; a second ring is traced from below, runic marks ignite as the fire passes
 *             them and a figure draws itself inside.
 *   0.5 s     the words are cut out of the light from the middle outwards, white-hot green, and
 *             cool into polished steel (white to steel grey).
 *   1-9 s     the circle turns slowly, its inner ring the other way, a dashed dial between them;
 *             green flames lick upward along the outer ring and sparks spiral inward to the words.
 *             A polished-steel sheen sweeps across the words three times; twice the circle surges.
 *   9.4 s     the circle gathers itself, spins faster and collapses inward into the words, which
 *             flare white-hot; a green flash at 11 s, and the energy bursts out as embers that drift
 *             away while everything fades from 11.5 s (nothing at all is drawn from 12.94 s on).
 *
 * Original geometry only: rings, ticks, regular polygons and angular marks made up here, no symbol
 * of any film, comic or company. Light only (the movie is under the canvas): the words are stamped
 * by fx.js, glows are added with 'lighter' in light colours (a dark glow would dim a bright scene),
 * a few thin lines are plain strokes. Every frame is a function of the seed and t alone (nothing is
 * simulated from frame to frame), so renderAt(t), a resize in the middle and the live animation
 * draw the same picture.
 *
 * Speed, measured on a software-rendered canvas (the yardstick): a sprite drawn at its own size on
 * whole pixels is cheap and a rotated one five times dearer, so the glyph marks are drawn from
 * pre-turned copies (made as the circle turns them, kept per size); a thick 'lighter' stroke costs
 * three times a plain one and a 1-pixel line least of all, so the rings are thin lines with sprite
 * glows; per-sprite transforms are avoided; big soft light is a gradient on a few shapes, briefly.
 */
(function (root) {
  'use strict';

  const FX = root.APFx;
  if (!FX || typeof FX.register !== 'function') return;

  const DURATION = 13000;
  const FADE_AT = DURATION - 1500;      // everything fades out from here ...
  const GONE_AT = DURATION - 60;        // ... and nothing at all is drawn from here on
  const TAU = Math.PI * 2;
  const TOP = -Math.PI / 2;
  const BOTTOM = Math.PI / 2;

  // The timeline (ms).
  const T_TRACE = 900;                  // the outer ring is drawn from the top down both sides
  const T_IN0 = 220;                    // the inner ring is drawn from the bottom up
  const T_IN1 = 1080;
  const T_FIG0 = 520;                   // the figure inside draws itself
  const T_FIG1 = 1500;
  const T_W0 = 430;                     // the words are cut out of the light ...
  const T_W1 = 1150;
  const T_COOL0 = 1200;                 // ... and cool from green-white heat to steel
  const T_COOL1 = 2400;
  const SHEENS = [2600, 5650, 8350];    // the polished-steel sheen
  const SHEEN_DUR = 1300;
  const SURGES = [4150, 7050];          // the circle surges
  const T_CHARGE = 9350;                // the circle gathers itself ...
  const T_COLLAPSE = 9950;              // ... falls in on itself ...
  const T_FLASH = 11050;                // ... and goes out in a green flash
  const T_SP0 = 380;                    // the sparks start spiralling in
  const SP_LAST = T_FLASH - 140;        // the last of them arrive before the flash

  // Rotation (rad/s): the outer circle clockwise, the inner ring against it, the dial between faster.
  const W_OUT = 0.085;
  const W_IN = -0.15;
  const W_DIAL = 0.24;
  const NA = 90;                        // the glyph marks are drawn from copies turned in 4 degree steps
  const STEP = TAU / NA;

  // Doom's greens and steel.
  const FIRE = '#45e08a';
  const FIRE_LIGHT = '#8dffbe';
  const FIRE_HOT = '#eafff2';
  const STEEL = '#c4ccd2';

  // The words while they are hot, and the light of the sheen (no halo: it only brightens the steel).
  const HOT = { stops: [[0, '#ffffff'], [0.5, '#e8fff1'], [1, '#86f7b4']], halo: 'rgba(0,14,6,0.86)' };
  const SHEEN = { stops: [[0, '#ffffff'], [1, '#f1f7fb']] };
  const HALO = 'rgba(0,10,4,0.88)';

  /*
   * The glyph marks, made up for this circle: polylines in a box 2 wide and 3 tall (y down, up is
   * away from the centre of the circle), plus dots.
   */
  const GLYPHS = [
    { p: [[[0, -1.5], [0, 1.5]], [[0, -1.5], [0.8, -1.05], [0, -0.6]], [[0, 0.55], [-0.7, 1.0]]] },
    // (a diamond on a staff: with two splayed legs instead, it would be the othala rune, a sign some
    // hate groups have taken up)
    { p: [[[0, -1.5], [0.55, -0.85], [0, -0.2], [-0.55, -0.85], [0, -1.5]], [[0, -0.2], [0, 1.5]]], d: [[-0.55, 0.75], [0.55, 0.75]] },
    { p: [[[-0.85, -0.45], [0, -1.3], [0.85, -0.45]], [[-0.85, 0.35], [0, -0.5], [0.85, 0.35]]], d: [[0, 1.0]] },
    { p: [[[-0.8, -1.4], [0.8, -1.4], [-0.8, 1.4], [0.8, 1.4], [-0.8, -1.4]], [[0.3, 0], [0.95, 0]]] },
    { p: [[[-0.75, 0.2], [0, -1.3], [0.75, 0.2], [-0.75, 0.2]], [[0, 0.2], [0, 1.5]], [[0, 1.5], [0.55, 1.05]]], d: [[0, -0.35]] },
    { p: [[[0.8, 1.4], [-0.8, 1.4], [-0.8, -1.4], [0.8, -1.4], [0.8, 0.45], [-0.15, 0.45], [-0.15, -0.5]]] },
    { p: [[[-0.85, -1.4], [-0.85, 1.4]], [[0.85, -1.4], [0.85, 1.4]], [[0, -0.62], [0.45, 0], [0, 0.62], [-0.45, 0], [0, -0.62]]] },
    { p: [[[0, 1.5], [0, -1.45]], [[-0.72, -0.72], [0, -1.45], [0.72, -0.72]], [[-0.8, 0.35], [-0.3, 0.8]], [[0.8, 0.35], [0.3, 0.8]]] },
    { p: [[[-0.4, -1.5], [0.1, -0.95], [-0.4, -0.4], [-0.9, -0.95], [-0.4, -1.5]], [[-0.4, -0.4], [0.4, 0.4]], [[0.4, 0.4], [0.9, 0.95], [0.4, 1.5], [-0.1, 0.95], [0.4, 0.4]]] },
    { p: [[[-0.65, -0.3], [0.65, -0.3], [0.65, 1.4], [-0.65, 1.4], [-0.65, -0.3]], [[0, -1.5], [0, 0.55]]], d: [[0, 1.0]] },
    { p: [[[-0.8, -1.4], [0.8, -1.4], [0, -0.15], [-0.8, -1.4]], [[0, -0.15], [0, 1.5]]], d: [[0.55, 0.85]] },
    { p: [[[0, -1.5], [0, 1.5]], [[0, -0.95], [0.8, -1.4]], [[0, 0], [-0.8, 0.45]], [[0, 0.95], [0.8, 0.5]]] }
  ];

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2);
  /** The inverse of easeInOut. */
  const easeInOutInv = (y) => (y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2);

  /** How far apart two angles are, 0..PI. */
  function angDist(a, b) {
    let d = (a - b) % TAU;
    if (d < 0) d += TAU;
    return d > Math.PI ? TAU - d : d;
  }

  /* ------------------------------------------------------- textures --- */

  const CACHE = { key: '', tex: null };   // made once per size (prime() makes them before midnight)

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /** A round soft glow `d` CSS pixels across. */
  function blob(d, dpr, stops) {
    const px = Math.max(4, Math.round(d * dpr));
    const c = canvas(px, px);
    const g = c.getContext('2d');
    const r = px / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    for (const s of stops) grad.addColorStop(s[0], s[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    return { c: c, w: px / dpr, h: px / dpr };
  }

  /** A tongue of green fire leaning by `lean` (of its width): round and hot at the base (84% down). */
  function flameTex(dpr, lean) {
    const w = Math.round(44 * clamp(dpr, 1, 2));
    const h = Math.round(w * 2.5);
    const c = canvas(w, h);
    const g = c.getContext('2d');
    const x0 = w / 2;
    const y0 = h * 0.84;
    const tongue = (r, len, l) => {
      const xt = x0 + l;
      g.beginPath();
      g.moveTo(xt, y0 - len);
      g.bezierCurveTo(xt + r * 0.25, y0 - len * 0.7, x0 + r * 1.25, y0 - r * 1.6, x0 + r, y0);
      g.arc(x0, y0, r, 0, Math.PI);
      g.bezierCurveTo(x0 - r * 1.25, y0 - r * 1.6, xt - r * 0.25, y0 - len * 0.7, xt, y0 - len);
      g.closePath();
    };
    let grad = g.createLinearGradient(0, y0 + w * 0.3, 0, y0 - h * 0.8);
    grad.addColorStop(0, 'rgba(110,245,165,0)');
    grad.addColorStop(0.1, 'rgba(120,250,172,0.75)');
    grad.addColorStop(0.5, 'rgba(90,240,155,0.42)');
    grad.addColorStop(1, 'rgba(90,240,155,0)');
    g.shadowColor = 'rgba(90,240,155,0.9)';
    g.shadowBlur = w * 0.28;
    g.fillStyle = grad;
    tongue(w * 0.27, h * 0.76, w * lean);
    g.fill();
    g.shadowBlur = 0;
    grad = g.createLinearGradient(0, y0 + w * 0.14, 0, y0 - h * 0.46);
    grad.addColorStop(0, 'rgba(240,255,246,0)');
    grad.addColorStop(0.18, 'rgba(238,255,244,0.95)');
    grad.addColorStop(0.6, 'rgba(170,255,210,0.5)');
    grad.addColorStop(1, 'rgba(120,250,172,0)');
    g.fillStyle = grad;
    tongue(w * 0.13, h * 0.44, w * lean * 0.5);
    g.fill();
    return { c: c, base: 0.84 };
  }

  /** One glyph mark, `gh` CSS pixels tall, glowing green with a white-hot core (upright). */
  function glyphMaster(tpl, gh, dpr) {
    const u = gh / 3;
    const lw = Math.max(1.1, gh * 0.06);
    const pad = Math.ceil(gh * 0.22 + 2);
    const wCss = 2 * u + 2 * pad;
    const hCss = gh + 2 * pad;
    const c = canvas(wCss * dpr, hCss * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, c.width / 2, c.height / 2);
    const path = new Path2D();
    for (const line of tpl.p) {
      path.moveTo(line[0][0] * u, line[0][1] * u);
      for (let i = 1; i < line.length; i++) path.lineTo(line[i][0] * u, line[i][1] * u);
    }
    g.lineJoin = 'miter';
    g.miterLimit = 3;
    g.lineCap = 'round';
    g.shadowColor = 'rgba(80,240,150,1)';
    g.shadowBlur = gh * 0.2 * dpr;
    g.strokeStyle = 'rgba(110,245,165,0.95)';
    g.lineWidth = lw * 1.7;
    g.stroke(path);
    g.stroke(path);
    g.shadowBlur = 0;
    g.strokeStyle = FIRE_HOT;
    g.lineWidth = lw * 0.75;
    g.stroke(path);
    if (tpl.d) {
      g.fillStyle = FIRE_HOT;
      const s = lw * 1.6;
      for (const d of tpl.d) {
        g.save();
        g.translate(d[0] * u, d[1] * u);
        g.rotate(Math.PI / 4);
        g.fillRect(-s / 2, -s / 2, s, s);
        g.restore();
      }
    }
    return c;
  }

  /** A set of glyph marks of one size: the upright masters and their turned copies (made on demand). */
  function glyphSet(gh, dpr) {
    return { masters: GLYPHS.map((g) => glyphMaster(g, gh, dpr)), turned: GLYPHS.map(() => new Array(NA)), dpr: dpr };
  }

  /** Glyph `k` of the set turned to step `i` (of NA). */
  function turnedGlyph(set, k, i) {
    const list = set.turned[k];
    let s = list[i];
    if (s) return s;
    const m = set.masters[k];
    const px = Math.ceil(Math.hypot(m.width, m.height));
    const c = canvas(px, px);
    const g = c.getContext('2d');
    g.translate(px / 2, px / 2);
    g.rotate(i * STEP);
    g.drawImage(m, -m.width / 2, -m.height / 2);
    s = list[i] = { c: c, w: px / set.dpr, h: px / set.dpr };
    return s;
  }

  /** A small steel ring with a green spark in it (the nodes of the figure). */
  function nodeSprite(d, dpr) {
    const px = Math.max(8, Math.round(d * dpr));
    const c = canvas(px, px);
    const g = c.getContext('2d');
    const r = px / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'rgba(225,255,236,0.95)');
    grad.addColorStop(0.18, 'rgba(130,250,180,0.6)');
    grad.addColorStop(0.5, 'rgba(110,245,165,0.16)');
    grad.addColorStop(1, 'rgba(110,245,165,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    g.strokeStyle = 'rgba(214,222,228,0.95)';
    g.lineWidth = Math.max(1, px * 0.06);
    g.beginPath();
    g.arc(r, r, r * 0.42, 0, TAU);
    g.stroke();
    return { c: c, w: px / dpr, h: px / dpr };
  }

  /** A four-pointed glint of polished steel. */
  function glintSprite(d, dpr) {
    const px = Math.max(12, Math.round(d * dpr));
    const c = canvas(px, px);
    const g = c.getContext('2d');
    const r = px / 2;
    let grad = g.createRadialGradient(r, r, 0, r, r, r * 0.42);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(240,248,255,0.55)');
    grad.addColorStop(1, 'rgba(240,248,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    const ray = (horiz) => {
      grad = horiz ? g.createLinearGradient(0, 0, px, 0) : g.createLinearGradient(0, 0, 0, px);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.95)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      const t = Math.max(1, px * 0.035);
      if (horiz) g.fillRect(0, r - t / 2, px, t); else g.fillRect(r - t / 2, 0, t, px);
    };
    ray(true);
    ray(false);
    return { c: c, w: px / dpr, h: px / dpr };
  }

  const GLOW = [[0, 'rgba(185,255,212,0.85)'], [0.2, 'rgba(110,245,165,0.5)'], [0.5, 'rgba(90,240,155,0.16)'], [1, 'rgba(90,240,155,0)']];

  function textures(R, S, dpr) {
    const key = R.toFixed(2) + '|' + S.toFixed(4) + '|' + dpr;
    if (CACHE.key === key) return CACHE.tex;
    const tex = {
      ring: blob(R * 0.07, dpr, GLOW),
      ringIn: blob(R * 0.054, dpr, GLOW),
      head: blob(R * 0.2, dpr, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(235,255,242,0.95)'], [0.3, 'rgba(120,250,172,0.45)'], [0.6, 'rgba(90,240,155,0.12)'], [1, 'rgba(90,240,155,0)']]),
      spark: blob(Math.max(10, 19 * S), dpr, [[0, 'rgba(244,255,248,1)'], [0.16, 'rgba(175,255,208,0.9)'], [0.42, 'rgba(110,245,165,0.3)'], [1, 'rgba(110,245,165,0)']]),
      ember: blob(Math.max(14, 30 * S), dpr, [[0, 'rgba(236,255,242,0.95)'], [0.16, 'rgba(150,255,195,0.75)'], [0.45, 'rgba(100,242,160,0.2)'], [1, 'rgba(100,242,160,0)']]),
      node: nodeSprite(R * 0.036, dpr),
      glint: glintSprite(R * 0.15, dpr),
      flames: [flameTex(dpr, 0), flameTex(dpr, -0.16), flameTex(dpr, 0.16)],
      gOut: glyphSet(R * 0.05, dpr),
      gIn: glyphSet(R * 0.035, dpr)
    };
    CACHE.key = key;
    CACHE.tex = tex;
    return tex;
  }

  /* ---------------------------------------------------------- style --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const dpr = env.dpr || 1;
    const S = env.scale;
    const rnd = env.rnd;
    const smooth = env.smooth;
    const lerp = env.lerp;
    const easeOut = env.easeOut;

    /* --- where everything sits --- */
    const wp = env.wordPoints(1600);
    const pts = wp.pts;
    const cx = L.cx;
    const cy = (L.top + L.bottom) / 2;
    const split = L.year ? (L.titleY + L.titleSize * 0.5 + L.yearY - L.yearSize * 0.5) / 2 : Infinity;
    let reach = 0;
    const ink = { t0: Infinity, t1: -Infinity, y0: Infinity, y1: -Infinity };
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i];
      const y = pts[i + 1];
      const d = Math.hypot(x - cx, y - cy);
      if (d > reach) reach = d;
      if (y < split) { if (y < ink.t0) ink.t0 = y; if (y > ink.t1) ink.t1 = y; }
      else { if (y < ink.y0) ink.y0 = y; if (y > ink.y1) ink.y1 = y; }
    }
    if (!(reach > 0)) reach = Math.max(40, (wp.maxX - wp.minX) / 2);
    let R = Math.max(reach * 1.1, H * 0.42);
    R = Math.min(R, W * 0.49, cy - H * 0.035);
    R = Math.max(R, Math.min(W, H) * 0.22);
    const TEX = textures(R, S, dpr);
    const minX = wp.minX;
    const maxX = wp.maxX;

    /* --- the words in polished steel: each line white at the top, a dark horizon, steel below --- */
    const STEELFILL = (function () {
      const span = Math.max(1, L.bottom - L.top);
      const f = (y) => clamp((y - L.top) / span, 0, 1);
      const stops = [];
      const line = (a, b) => {
        const at = (k) => f(a + (b - a) * k);
        stops.push([at(0), '#ffffff'], [at(0.44), '#d3dadf'], [at(0.5), '#86939e'], [at(0.62), '#a2aeb7'], [at(1), STEEL]);
      };
      const ts = L.titleSize;
      line(isFinite(ink.t0) ? ink.t0 : L.titleY - ts * 0.36, isFinite(ink.t1) ? ink.t1 : L.titleY + ts * 0.36);
      if (L.year) {
        const ys = L.yearSize;
        line(isFinite(ink.y0) ? ink.y0 : L.yearY - ys * 0.36, isFinite(ink.y1) ? ink.y1 : L.yearY + ys * 0.36);
      }
      let last = 0;
      for (const s of stops) { s[0] = Math.max(last, clamp(s[0], 0, 1)); last = s[0]; }
      return { stops: stops, halo: HALO };
    })();

    /* --- one table of random numbers: every choice below is read from it or from rnd --- */
    const RT = new Float32Array(4096);
    for (let i = 0; i < RT.length; i++) RT[i] = rnd();
    const RTM = RT.length - 1;
    const rt = (i) => RT[i & RTM];

    /* --- the outer circle --- */
    const N_RS = 96;                     // glow sprites along the fire ring
    const RS_F1 = new Float32Array(N_RS);
    const RS_F2 = new Float32Array(N_RS);
    const RS_P1 = new Float32Array(N_RS);
    const RS_P2 = new Float32Array(N_RS);
    for (let i = 0; i < N_RS; i++) {
      RS_F1[i] = 0.006 + rnd() * 0.008;
      RS_F2[i] = 0.013 + rnd() * 0.012;
      RS_P1[i] = rnd() * TAU;
      RS_P2[i] = rnd() * TAU;
    }
    const N_RI = 64;                     // ... and along the inner ring
    const RI_F = new Float32Array(N_RI);
    const RI_P = new Float32Array(N_RI);
    for (let i = 0; i < N_RI; i++) { RI_F[i] = 0.007 + rnd() * 0.012; RI_P[i] = rnd() * TAU; }

    const N_GO = 36;                     // glyph marks round the outer band
    const N_GI = 24;                     // ... and round the inner one
    const pickGlyphs = (n) => {
      const out = new Uint8Array(n);
      let prev = -1;
      for (let i = 0; i < n; i++) {
        let k = Math.floor(rnd() * GLYPHS.length);
        if (k === prev) k = (k + 1 + Math.floor(rnd() * (GLYPHS.length - 1))) % GLYPHS.length;
        out[i] = prev = k;
      }
      return out;
    };
    const GO = pickGlyphs(N_GO);
    const GI = pickGlyphs(N_GI);
    const GO_PH = new Float32Array(N_GO);
    for (let i = 0; i < N_GO; i++) GO_PH[i] = rnd() * TAU;
    // Each mark sits a hair off its even place, so that the marks reach their next turned copy one
    // at a time rather than a dozen in the same frame.
    const jitter = (n) => { const j = new Float32Array(n); for (let i = 0; i < n; i++) j[i] = (i / n) * TAU + (rnd() - 0.5) * STEP; return j; };
    const GO_A = jitter(N_GO);
    const GI_A = jitter(N_GI);

    // Ticks round the outside of the circle, in steel (drawn about the centre, turned each frame).
    const R_TICK = R * 1.045;
    const ticks = new Path2D();
    const N_TICK = 144;
    for (let i = 0; i < N_TICK; i++) {
      const a = (i / N_TICK) * TAU;
      const len = i % 6 === 0 ? R * 0.036 : R * 0.014;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ticks.moveTo(c * R_TICK, s * R_TICK);
      ticks.lineTo(c * (R_TICK + len), s * (R_TICK + len));
    }

    // The dial between the rings: dashes of light with gaps, and fine steel ticks inside them.
    const R_DIAL = R * 0.79;
    const dial = new Path2D();
    const N_DASH = 18;
    for (let i = 0; i < N_DASH; i++) {
      const a = (i / N_DASH) * TAU;
      const len = (TAU / N_DASH) * (i % 3 === 0 ? 0.42 : 0.62);
      dial.moveTo(Math.cos(a) * R_DIAL, Math.sin(a) * R_DIAL);
      dial.arc(0, 0, R_DIAL, a, a + len);
    }
    const dialTicks = new Path2D();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const r0 = R_DIAL - R * (i % 4 === 0 ? 0.03 : 0.014);
      dialTicks.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      dialTicks.lineTo(Math.cos(a) * (R_DIAL - R * 0.005), Math.sin(a) * (R_DIAL - R * 0.005));
    }

    // The figure inside the inner ring: two nine-sided rings of points joined in a zigzag band.
    const R_IN = R * 0.665;
    const R_FIG = R * 0.578;
    const R_FIG2 = R * 0.47;
    const FIG_N = 9;
    const figEdges = [];                 // [x0, y0, x1, y1] about the centre, unturned
    for (let j = 0; j < FIG_N; j++) {
      const a = (j / FIG_N) * TAU + TOP;
      const b = ((j + 1) / FIG_N) * TAU + TOP;
      const m = ((j + 0.5) / FIG_N) * TAU + TOP;
      const A = [Math.cos(a) * R_FIG, Math.sin(a) * R_FIG];
      const B = [Math.cos(b) * R_FIG, Math.sin(b) * R_FIG];
      const M = [Math.cos(m) * R_FIG2, Math.sin(m) * R_FIG2];
      figEdges.push([A[0], A[1], B[0], B[1]], [A[0], A[1], M[0], M[1]], [M[0], M[1], B[0], B[1]]);
    }
    const figPath = new Path2D();
    for (const e of figEdges) { figPath.moveTo(e[0], e[1]); figPath.lineTo(e[2], e[3]); }

    /* --- flames along the outer ring: more of them on the upper half, where they are seen --- */
    const N_FL = 110;
    const FL_A = new Float32Array(N_FL);
    const FL_LIFE = new Float32Array(N_FL);
    const FL_PER = new Float32Array(N_FL);
    const FL_OFF = new Float32Array(N_FL);
    const FL_W = new Float32Array(N_FL);
    const FL_H = new Float32Array(N_FL);
    const FL_PH = new Float32Array(N_FL);
    const FL_BIT = new Uint8Array(N_FL);
    for (let i = 0; i < N_FL; i++) {
      let a = 0;
      for (let tries = 0; tries < 12; tries++) {
        a = rnd() * TAU;
        if (rnd() < 0.25 + 0.75 * Math.max(0, -Math.sin(a))) break;
      }
      const up = Math.max(0, -Math.sin(a));
      FL_A[i] = a;
      FL_BIT[i] = rnd() < 0.24 ? 1 : 0;
      FL_LIFE[i] = FL_BIT[i] ? 520 + rnd() * 380 : 380 + rnd() * 420;
      FL_PER[i] = FL_LIFE[i] + rnd() * 200;
      FL_OFF[i] = rnd() * FL_PER[i];
      FL_W[i] = R * (0.044 + rnd() * 0.03);
      FL_H[i] = R * (0.075 + rnd() * 0.08) * (0.7 + 0.55 * up);
      FL_PH[i] = rnd() * TAU;
    }

    /* --- sparks shed by the heads of fire that draw the circle --- */
    const N_HS = 64;
    const HS = [];
    for (let i = 0; i < N_HS; i++) {
      const side = i % 2 ? 1 : -1;
      const te = T_TRACE * (0.02 + 0.85 * Math.pow(rnd(), 1.4));
      const a = TOP + side * Math.PI * easeOut(clamp(te / T_TRACE, 0, 1));
      const out = R * (0.25 + rnd() * 0.75);
      const back = R * (0.3 + rnd() * 0.9) * (1 - te / T_TRACE * 0.6);
      HS.push({
        t0: te, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R,
        vx: Math.cos(a) * out - side * -Math.sin(a) * back, vy: Math.sin(a) * out - side * Math.cos(a) * back,
        life: 320 + rnd() * 420, s: Math.max(1.3, 2.4 * S) * (0.7 + rnd() * 0.6)
      });
    }

    /* --- sparks spiralling in --- */
    const N_SP = 200;
    const SP_DUR = new Float32Array(N_SP);
    const SP_PER = new Float32Array(N_SP);
    const SP_OFF = new Float32Array(N_SP);
    const SP_TURN = new Float32Array(N_SP);
    const SP_SIZE = new Float32Array(N_SP);
    const SP_HOT = new Uint8Array(N_SP);
    for (let i = 0; i < N_SP; i++) {
      SP_DUR[i] = 1500 + rnd() * 1300;
      SP_PER[i] = SP_DUR[i] + 150 + rnd() * 900;
      SP_OFF[i] = rnd() * SP_PER[i];
      SP_TURN[i] = Math.PI * (0.7 + rnd() * 0.9);
      SP_SIZE[i] = Math.max(1.6, 3.1 * S) * (0.7 + rnd() * 0.6);
      SP_HOT[i] = rnd() < 0.4 ? 1 : 0;
    }

    /* --- embers after the flash --- */
    const N_EM = 200;
    const EM_X = new Float32Array(N_EM);
    const EM_Y = new Float32Array(N_EM);
    const EM_VX = new Float32Array(N_EM);
    const EM_VY = new Float32Array(N_EM);
    const EM_K = new Float32Array(N_EM);
    const EM_LIFT = new Float32Array(N_EM);
    const EM_LIFE = new Float32Array(N_EM);
    const EM_DELAY = new Float32Array(N_EM);
    const EM_SIZE = new Float32Array(N_EM);
    const EM_PH = new Float32Array(N_EM);
    const EM_COL = new Uint8Array(N_EM);
    for (let i = 0; i < N_EM; i++) {
      const a = rnd() * TAU;
      const r0 = R * 0.12 * Math.sqrt(rnd());
      EM_X[i] = cx + Math.cos(a) * r0;
      EM_Y[i] = cy + Math.sin(a) * r0;
      const v = R * (0.45 + Math.pow(rnd(), 0.8) * 2.1);
      const b = a + (rnd() - 0.5) * 0.5;
      EM_VX[i] = Math.cos(b) * v;
      EM_VY[i] = Math.sin(b) * v * 0.8 - R * 0.2;
      EM_K[i] = 1.5 + rnd() * 1.3;
      EM_LIFT[i] = R * (0.1 + rnd() * 0.2);
      EM_LIFE[i] = 1.35 + rnd() * 0.5;
      EM_DELAY[i] = rnd() * 0.1;
      EM_SIZE[i] = Math.max(1.8, 3.6 * S) * (0.6 + rnd() * 0.7);
      EM_PH[i] = rnd() * TAU;
      const c = rnd();
      EM_COL[i] = c < 0.2 ? 2 : c < 0.45 ? 1 : 0;   // green, white-hot, steel
    }
    const EM_COLORS = [FIRE_LIGHT, FIRE_HOT, STEEL];

    /* --- the rays of the flashes: thin wedges from the centre --- */
    const N_RAY = 22;
    const RAY_A = new Float32Array(N_RAY);
    const RAY_W = new Float32Array(N_RAY);
    const RAY_L = new Float32Array(N_RAY);
    for (let i = 0; i < N_RAY; i++) {
      RAY_A[i] = ((i + rnd() * 0.6) / N_RAY) * TAU;
      RAY_W[i] = 0.004 + rnd() * 0.009;
      RAY_L[i] = R * (0.35 + rnd() * 0.55);
    }

    /* --- the sheen: where it glints on the letters --- */
    const glints = SHEENS.map(() => {
      const list = [];
      const n = pts.length / 2;
      for (let k = 0; k < 9 && n > 0; k++) {
        const i = Math.floor(rnd() * n);
        list.push(pts[i * 2], pts[i * 2 + 1], 0.6 + rnd() * 0.5);
      }
      return list;
    });

    /* ------------------------------------------------- the clock --- */

    const spinExtra = (t) => {
      if (t <= T_CHARGE) return 0;
      const x = (Math.min(t, T_FLASH) - T_CHARGE) / 1000;
      return x * x * x;
    };
    const rotOut = (t) => W_OUT * t / 1000 + 0.55 * spinExtra(t);
    const rotIn = (t) => W_IN * t / 1000 - 0.95 * spinExtra(t);
    const rotDial = (t) => W_DIAL * t / 1000 + 0.75 * spinExtra(t);
    /** Spinning so fast that coarser turned copies of the glyphs will do. */
    const fastSpin = (t) => t > T_CHARGE + 700;

    /** How big the circle is: whole, a breath out as it gathers itself, then falling in. */
    const kappa = (t) => {
      if (t < T_CHARGE) return 1;
      if (t < T_COLLAPSE) return 1 + 0.035 * easeOut((t - T_CHARGE) / (T_COLLAPSE - T_CHARGE));
      if (t < T_FLASH) return 1.035 * (1 - Math.pow((t - T_COLLAPSE) / (T_FLASH - T_COLLAPSE), 2.3));
      return 0;
    };

    /** How hard the fire burns: the surges, the gathering and the collapse. */
    const power = (t) => {
      let p = 1;
      for (const s of SURGES) if (t > s - 100 && t < s + 1400) p += 0.55 * Math.exp(-Math.abs(t - s - 150) / 330);
      p += 0.5 * smooth(T_CHARGE, T_FLASH, t);
      return p;
    };

    // The outer ring is drawn from the top down both sides; the inner one from the bottom up.
    const spanOut = (t) => Math.PI * easeOut(clamp(t / T_TRACE, 0, 1));
    const litOut = (a) => T_TRACE * (1 - Math.cbrt(1 - angDist(a, TOP) / Math.PI));
    const spanIn = (t) => Math.PI * easeInOut(clamp((t - T_IN0) / (T_IN1 - T_IN0), 0, 1));
    const litIn = (a) => T_IN0 + (T_IN1 - T_IN0) * easeInOutInv(angDist(a, BOTTOM) / Math.PI);

    /** A glyph's extra brightness: when the fire first reaches it, and when a surge runs past it. */
    const flareAt = (a, t, lit) => {
      let f = t >= lit ? Math.exp(-(t - lit) / 260) : 0;
      const d = angDist(a, TOP) / Math.PI;
      for (const s of SURGES) {
        const ts = s + 650 * d;
        if (t >= ts && t < ts + 1500) f += 0.85 * Math.exp(-(t - ts) / 300);
      }
      return f;
    };

    const onScreen = (x, y, m) => x > -m && x < W + m && y > -m && y < H + m;

    // Device-pixel transform helpers (env.ctx is scaled to CSS pixels by fx.js).
    const setT = (a, b, c, d, e, f) => ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr);
    const resetT = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /** A sprite centred on (x, y), at its own size (on whole pixels when it can be). */
    const blit = (s, x, y) => {
      if (dpr === 1) ctx.drawImage(s.c, Math.round(x - s.w / 2), Math.round(y - s.h / 2));
      else ctx.drawImage(s.c, x - s.w / 2, y - s.h / 2, s.w, s.h);
    };
    /** A glyph mark of `set`, template k, at (x, y), facing away from the centre (screen angle a). */
    const glyph = (set, k, a, x, y, t) => {
      let i = Math.round((a + Math.PI / 2) / STEP) % NA;
      if (i < 0) i += NA;
      if (fastSpin(t)) i = (Math.round(i / 3) * 3) % NA;
      blit(turnedGlyph(set, k, i), x, y);
    };

    /* ----------------------------------------------- the drawing --- */

    const CORE = [[0, 'rgba(244,255,248,1)'], [0.22, 'rgba(150,255,195,0.7)'], [0.6, 'rgba(100,242,160,0.2)'], [1, 'rgba(100,242,160,0)']];
    const WIDE = [[0, 'rgba(110,245,165,1)'], [0.5, 'rgba(90,240,155,0.38)'], [1, 'rgba(90,240,155,0)']];
    const RAYS = [[0, 'rgba(240,255,246,0.95)'], [0.12, 'rgba(170,255,210,0.6)'], [0.45, 'rgba(110,245,165,0.14)'], [1, 'rgba(110,245,165,0)']];

    function radial(x, y, r, stops, alpha) {
      if (alpha <= 0.004 || r < 1) return 0;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      for (const s of stops) g.addColorStop(s[0], s[1]);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      return 1;
    }

    function shock(r, w, alpha) {
      if (alpha <= 0.004 || r < 1) return 0;
      ctx.globalAlpha = Math.min(1, alpha * 0.45);
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.strokeStyle = FIRE_HOT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      return 2;
    }

    /** A burst of thin rays from the centre, `len` of their full length. */
    function rays(t, alpha, len) {
      if (alpha <= 0.004) return 0;
      const turn = t * 0.00012;
      let far = 0;
      ctx.beginPath();
      for (let i = 0; i < N_RAY; i++) {
        const a = RAY_A[i] + turn;
        const l = RAY_L[i] * len;
        if (l > far) far = l;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a - RAY_W[i]) * l, cy + Math.sin(a - RAY_W[i]) * l);
        ctx.lineTo(cx + Math.cos(a + RAY_W[i]) * l, cy + Math.sin(a + RAY_W[i]) * l);
        ctx.closePath();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, far);
      for (const s of RAYS) g.addColorStop(s[0], s[1]);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = g;
      ctx.fill();
      return N_RAY;
    }

    /** Flashes and shock rings behind the words: the instant it plays, the surges, the collapse. */
    function drawFlashes(t, fade) {
      let n = 0;
      // The instant it plays.
      if (t < 900) {
        if (t < 360) n += radial(cx, cy, R * 0.62, WIDE, 0.2 * (1 - smooth(0, 360, t)));
        n += radial(cx, cy, R * (0.24 + 0.16 * easeOut(clamp(t / 400, 0, 1))), CORE, 0.9 * (1 - smooth(20, 480, t)));
        n += rays(t, 0.75 * (1 - smooth(30, 420, t)), 0.6 + 0.7 * easeOut(clamp(t / 420, 0, 1)));
        const k = easeOut(clamp(t / 820, 0, 1));
        n += shock(lerp(R * 0.08, R * 1.32, k), lerp(R * 0.05, 1.5, k), 0.9 * (1 - k));
      }
      // The surges: a pulse leaves the inner ring.
      for (const s of SURGES) {
        if (t < s || t > s + 1000) continue;
        const k = easeOut((t - s) / 1000);
        n += shock(lerp(R_IN, R * 1.2, k), lerp(R * 0.03, 1, k), 0.6 * (1 - k) * fade);
      }
      // The collapse: the centre burns brighter and brighter.
      if (t > T_COLLAPSE && t < T_FLASH) {
        const k = smooth(T_COLLAPSE, T_FLASH, t);
        n += radial(cx, cy, R * (0.16 + 0.24 * k), CORE, 0.7 * k * k * fade);
      }
      // The flash it goes out in, and its shock ring.
      if (t >= T_FLASH && t < T_FLASH + 1300) {
        const u = (t - T_FLASH) / 1300;
        if (u < 0.3) n += radial(cx, cy, R * 0.66, WIDE, 0.22 * Math.pow(1 - smooth(0, 0.3, u), 1.5) * fade);
        const k = easeOut(clamp(u / 0.8, 0, 1));
        n += shock(lerp(R * 0.05, R * 1.6, k), lerp(R * 0.04, 1.5, k), 0.9 * (1 - k) * fade);
      }
      return n;
    }

    /** In front of the words: the heart of the final flash and its rays. */
    function drawFlashFront(t, fade) {
      if (t < T_FLASH - 60 || t > T_FLASH + 600) return 0;
      const u = (t - T_FLASH + 60) / 660;
      let n = 0;
      if (u < 0.75) n += radial(cx, cy, R * (0.26 + 0.16 * easeOut(u)), CORE, 0.9 * Math.pow(1 - u / 0.75, 2) * fade);
      n += rays(t, 0.8 * Math.pow(1 - u, 1.6) * fade, 0.7 + 0.7 * easeOut(u));
      return n;
    }

    /** The great circle: the fire ring and its glyph band, the ticks, the border and the dial. */
    function drawOuter(t, k, P, fade, low) {
      let n = 0;
      const r = R * k;
      const span = spanOut(t);
      const full = span >= Math.PI - 1e-4;
      const rot = rotOut(t);
      const lit = (a) => full || angDist(a, TOP) <= span;
      const vis = fade * (k < 0.3 ? smooth(0.02, 0.3, k) : 1);
      if (vis <= 0.003) return 0;
      const kk = Math.max(0.05, k);

      // The steel ticks outside the fire and the dial between the rings (turned about the centre).
      const tickA = smooth(200, 1100, t) * vis;
      if (tickA > 0.01) {
        ctx.globalCompositeOperation = 'source-over';
        const c = Math.cos(rot) * k;
        const s = Math.sin(rot) * k;
        setT(c, s, -s, c, cx, cy);
        ctx.globalAlpha = 0.5 * tickA;
        ctx.strokeStyle = STEEL;
        ctx.lineWidth = 1 / (dpr * kk);
        ctx.stroke(ticks);
        n += N_TICK;
        const rd = rotDial(t);
        const cd = Math.cos(rd) * k;
        const sd = Math.sin(rd) * k;
        setT(cd, sd, -sd, cd, cx, cy);
        const dA = smooth(500, 1300, t) * vis;
        ctx.globalAlpha = 0.4 * dA;
        ctx.stroke(dialTicks);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.7 * dA;
        ctx.strokeStyle = FIRE_LIGHT;
        ctx.stroke(dial);
        n += N_DASH + 72;
        resetT();
      }

      // The fire ring: flickering glow and a white-hot core.
      const a0 = TOP - span;
      const a1 = TOP + span;
      const arc = (rr) => { ctx.beginPath(); if (full) ctx.arc(cx, cy, rr, 0, TAU); else ctx.arc(cx, cy, rr, a0, a1); };
      const spr = TEX.ring;
      const m = spr.w;
      for (let i = 0; i < N_RS; i += low ? 2 : 1) {
        const a = (i / N_RS) * TAU + rot;
        if (!lit(a)) continue;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (!onScreen(x, y, m)) continue;
        const fl = 0.5 + 0.3 * Math.sin(t * RS_F1[i] + RS_P1[i]) + 0.2 * Math.sin(t * RS_F2[i] + RS_P2[i]);
        ctx.globalAlpha = Math.min(1, fl * 0.75 * P * vis * (low ? 1.5 : 1));
        blit(spr, x, y);
        n++;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, 0.9 * vis);
      ctx.strokeStyle = FIRE_HOT;
      ctx.lineWidth = 1.7;
      arc(r);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * vis * smooth(150, 900, t);
      ctx.strokeStyle = FIRE_LIGHT;
      ctx.lineWidth = 1 / dpr;
      arc(r * 0.885);
      ctx.stroke();
      arc(r * 0.982);
      ctx.stroke();
      n += 3;

      // The heads of fire that draw it.
      if (!full) {
        const h = TEX.head;
        for (const dir of [-1, 1]) {
          const ah = TOP + dir * span;
          for (let j = 6; j >= 0; j--) {
            const ab = ah - dir * j * 0.04;
            ctx.globalAlpha = (j === 0 ? 1 : 0.55 * (1 - j / 7)) * vis;
            blit(h, cx + Math.cos(ab) * r, cy + Math.sin(ab) * r);
            n++;
          }
        }
      }

      // The glyph marks, facing out, and steel nodes between every third pair.
      const gr = r * 0.935;
      const set = TEX.gOut;
      const glow = TEX.ring;
      for (let i = 0; i < N_GO; i++) {
        const a = GO_A[i] + rot;
        if (!lit(a)) continue;
        const x = cx + Math.cos(a) * gr;
        const y = cy + Math.sin(a) * gr;
        if (!onScreen(x, y, R * 0.06)) continue;
        const f = flareAt(a, t, litOut(a));
        const wave = Math.pow(0.5 + 0.5 * Math.cos(2 * (a - rot) - t * 0.0021 + GO_PH[i] * 0.15), 8);
        const b = (0.62 + 0.3 * wave + 0.08 * Math.sin(t * 0.009 + GO_PH[i])) * (0.85 + 0.15 * P);
        if (f > 0.04 && !low) {
          ctx.globalAlpha = Math.min(1, f * 0.8 * vis);
          blit(glow, x, y);
          n++;
        }
        ctx.globalAlpha = Math.min(1, (b + f) * vis);
        glyph(set, GO[i], a, x, y, t);
        n++;
        if (i % 3 === 0) {
          const an = a + Math.PI / N_GO;
          ctx.globalAlpha = 0.75 * vis;
          blit(TEX.node, cx + Math.cos(an) * gr, cy + Math.sin(an) * gr);
          n++;
        }
      }
      return n;
    }

    /** The inner ring, turning the other way, its glyphs and the figure inside it. */
    function drawInner(t, k, P, fade, low) {
      let n = 0;
      if (t < T_IN0) return 0;
      const r = R_IN * k;
      const span = spanIn(t);
      const full = span >= Math.PI - 1e-4;
      const rot = rotIn(t);
      const lit = (a) => full || angDist(a, BOTTOM) <= span;
      const vis = fade * (k < 0.3 ? smooth(0.02, 0.3, k) : 1);
      if (vis <= 0.003) return 0;
      const a0 = BOTTOM - span;
      const a1 = BOTTOM + span;
      const arc = (rr) => { ctx.beginPath(); if (full) ctx.arc(cx, cy, rr, 0, TAU); else ctx.arc(cx, cy, rr, a0, a1); };

      // The figure, drawing itself edge by edge, turned with the ring.
      const figP = clamp((t - T_FIG0) / (T_FIG1 - T_FIG0), 0, 1);
      if (figP > 0) {
        const c = Math.cos(rot) * k;
        const s = Math.sin(rot) * k;
        setT(c, s, -s, c, cx, cy);
        ctx.globalAlpha = Math.min(1, 0.55 * vis * (0.85 + 0.15 * P));
        ctx.strokeStyle = FIRE_LIGHT;
        ctx.lineWidth = 1 / (dpr * Math.max(0.05, k));
        if (figP >= 1) ctx.stroke(figPath);
        else {
          ctx.beginPath();
          for (let j = 0; j < FIG_N; j++) {
            const q = clamp((figP - j * (0.5 / FIG_N)) / (4 / FIG_N), 0, 1);
            if (q <= 0) continue;
            for (let e = 0; e < 3; e++) {
              const E = figEdges[j * 3 + e];
              ctx.moveTo(E[0], E[1]);
              ctx.lineTo(lerp(E[0], E[2], q), lerp(E[1], E[3], q));
            }
          }
          ctx.stroke();
        }
        n += FIG_N * 3;
        resetT();
        for (let j = 0; j < FIG_N; j++) {
          const q = clamp((figP - j * (0.5 / FIG_N)) / (4 / FIG_N), 0, 1);
          if (q <= 0) continue;
          const a = (j / FIG_N) * TAU + TOP + rot;
          const x = cx + Math.cos(a) * R_FIG * k;
          const y = cy + Math.sin(a) * R_FIG * k;
          if (!onScreen(x, y, 20)) continue;
          ctx.globalAlpha = Math.min(1, q * 0.9 * vis);
          blit(TEX.node, x, y);
          n++;
        }
      }

      // The ring itself: flickering fire and a hot core.
      const spr = TEX.ringIn;
      const m = spr.w;
      for (let i = 0; i < N_RI; i += low ? 2 : 1) {
        const a = (i / N_RI) * TAU + rot;
        if (!lit(a)) continue;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (!onScreen(x, y, m)) continue;
        const fl = 0.55 + 0.45 * Math.sin(t * RI_F[i] + RI_P[i]);
        ctx.globalAlpha = Math.min(1, (0.35 + 0.45 * fl) * P * vis * (low ? 1.5 : 1));
        blit(spr, x, y);
        n++;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, 0.85 * vis);
      ctx.strokeStyle = FIRE_HOT;
      ctx.lineWidth = 1.4;
      arc(r);
      ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 * vis;
      ctx.strokeStyle = FIRE_LIGHT;
      ctx.lineWidth = 1 / dpr;
      arc(R_FIG * k);
      ctx.stroke();
      n += 2;
      if (!full) {
        const h = TEX.head;
        for (const dir of [-1, 1]) {
          const ah = BOTTOM + dir * span;
          for (let j = 4; j >= 0; j--) {
            const ab = ah - dir * j * 0.055;
            ctx.globalAlpha = (j === 0 ? 0.85 : 0.4 * (1 - j / 5)) * vis;
            blit(h, cx + Math.cos(ab) * r, cy + Math.sin(ab) * r);
            n++;
          }
        }
      }

      // The inner glyphs, facing out.
      const gr = r * 0.935;
      const set = TEX.gIn;
      for (let i = 0; i < N_GI; i++) {
        const a = GI_A[i] + rot;
        if (!lit(a)) continue;
        const x = cx + Math.cos(a) * gr;
        const y = cy + Math.sin(a) * gr;
        if (!onScreen(x, y, R * 0.05)) continue;
        const f = flareAt(a, t, litIn(a));
        ctx.globalAlpha = Math.min(1, (0.62 + 0.12 * Math.sin(t * 0.007 + i) + f) * vis * (0.85 + 0.15 * P));
        glyph(set, GI[i], a, x, y, t);
        n++;
      }
      return n;
    }

    /** Green flames licking upward along the outer ring. */
    function drawFlames(t, k, P, fade, low) {
      const kill = 1 - smooth(T_COLLAPSE + 80, T_COLLAPSE + 650, t);
      if (kill <= 0 || k <= 0.05) return 0;
      let n = 0;
      const r = R * k * 1.006;
      const rot = rotOut(t);
      const span = spanOut(t);
      const full = span >= Math.PI - 1e-4;
      const boost = 0.7 + 0.3 * P;
      for (let i = 0; i < N_FL; i += low ? 2 : 1) {
        const a = FL_A[i] + rot;
        const since = full ? Infinity : t - litOut(a);
        if (!full && (angDist(a, TOP) > span || since < 30)) continue;
        const per = FL_PER[i];
        const life = FL_LIFE[i];
        const tt = t + FL_OFF[i];
        const c = Math.floor(tt / per);
        const local = tt - c * per;
        if (local >= life || local > since) continue;
        const u = local / life;
        const rv = rt(i * 7919 + c * 104729);
        const bx = cx + Math.cos(a) * r;
        const by = cy + Math.sin(a) * r;
        if (by < -R * 0.2 || by > H + R * 0.05 || bx < -R * 0.1 || bx > W + R * 0.1) continue;
        const tex = TEX.flames[Math.floor(rt(i * 31 + c * 17) * 3)];
        let fw;
        let fh;
        let x;
        let y;
        let alpha;
        if (FL_BIT[i]) {
          // a lick of flame torn off the top, rising away and shrinking
          const s = (1 - 0.6 * u);
          fw = FL_W[i] * 0.7 * s;
          fh = fw * 1.7;
          x = bx + Math.sin(FL_PH[i] + u * 5.5) * R * 0.01;
          y = by - FL_H[i] * (0.35 + 1.25 * u) * boost;
          alpha = smooth(0, 0.2, u) * (1 - smooth(0.3, 1, u)) * 0.85;
        } else {
          // a tongue rooted on the ring, leaping up, dancing, falling back
          const e = Math.sin(Math.PI * u);
          const dance = 0.82 + 0.18 * Math.sin(t * 0.021 + FL_PH[i] * 3);
          fh = FL_H[i] * (0.65 + 0.7 * rv) * (0.3 + 0.7 * e) * dance * boost;
          fw = FL_W[i] * (0.75 + 0.3 * e);
          x = bx + Math.sin(FL_PH[i] + u * 6.5) * R * 0.005;
          y = by;
          alpha = Math.pow(e, 0.55);
        }
        ctx.globalAlpha = Math.min(1, alpha * kill * fade * (low ? 1.3 : 1));
        ctx.drawImage(tex.c, x - fw / 2, y - fh * tex.base, fw, fh);
        n++;
      }
      return n;
    }

    /** Sparks shed by the heads of fire while they draw the circle. */
    function drawHeadSparks(t) {
      if (t > T_TRACE + 900) return 0;
      let n = 0;
      ctx.fillStyle = FIRE_HOT;
      for (let i = 0; i < N_HS; i++) {
        const p = HS[i];
        const tau = (t - p.t0) / 1000;
        if (tau < 0 || tau * 1000 > p.life) continue;
        const e = (1 - Math.exp(-2.6 * tau)) / 2.6;
        const x = p.x + p.vx * e;
        const y = p.y + p.vy * e + 0.5 * R * 0.5 * tau * tau;
        const a = 1 - (tau * 1000) / p.life;
        ctx.globalAlpha = a;
        ctx.fillRect(x - p.s / 2, y - p.s / 2, p.s, p.s);
        ctx.globalAlpha = a * 0.8;
        blit(TEX.spark, x, y);
        n += 2;
      }
      return n;
    }

    /** Sparks spiralling in to the words. */
    function drawSparks(t, fade, low) {
      if (t < T_SP0 || t > SP_LAST) return 0;
      let n = 0;
      const spr = TEX.spark;
      const ramp = smooth(T_SP0, T_SP0 + 900, t);
      ctx.fillStyle = FIRE_LIGHT;
      for (let i = 0; i < N_SP; i += low ? 2 : 1) {
        const per = SP_PER[i];
        const tt = t - T_SP0 - SP_OFF[i];
        if (tt < 0) continue;
        const c = Math.floor(tt / per);
        const local = tt - c * per;
        const dur = SP_DUR[i];
        if (local >= dur) continue;
        if (t - local + dur > SP_LAST) continue;
        const u = local / dur;
        const th0 = rt(i * 131 + c * 977) * TAU;
        const r0 = R * (1.02 + 0.5 * rt(i * 71 + c * 313));
        const r1 = R * 0.16;
        const turn = SP_TURN[i];
        const rr = r0 + (r1 - r0) * Math.pow(u, 1.25);
        const th = th0 + turn * u * u;
        const px = cx + Math.cos(th) * rr;
        const py = cy + Math.sin(th) * rr;
        if (!onScreen(px, py, 30)) continue;
        const a = smooth(0, 0.12, u) * (1 - smooth(0.72, 1, u)) * ramp * fade;
        if (a <= 0.01) continue;
        const s = SP_SIZE[i];
        // the trail: fading copies further back on the path
        for (let j = 4; j >= 1; j--) {
          const q = Math.max(0, u - j * 0.018);
          const qr = r0 + (r1 - r0) * Math.pow(q, 1.25);
          const qt = th0 + turn * q * q;
          const ss = s * (1 - j * 0.16);
          ctx.globalAlpha = a * (0.8 - j * 0.16);
          ctx.fillRect(cx + Math.cos(qt) * qr - ss / 2, cy + Math.sin(qt) * qr - ss / 2, ss, ss);
          n++;
        }
        ctx.globalAlpha = Math.min(1, a * (SP_HOT[i] ? 1 : 0.8));
        blit(spr, px, py);
        n++;
      }
      return n;
    }

    /** The words: cut out of the light, white-hot cooling to steel; the sheen sweeping across. */
    function drawWords(t, fade) {
      if (t < T_W0) return 0;
      let n = 0;
      const p = clamp((t - T_W0) / (T_W1 - T_W0), 0, 1);
      const half = (maxX - minX) / 2 + L.titleSize * 0.7;
      const hw = half * easeOut(p);
      if (hw < 0.5) return 0;
      const a = fade;
      // hot while being cut, and again as the collapsing circle pours into them
      const heat = Math.max(1 - smooth(T_COOL0, T_COOL1, t),
        0.9 * smooth(T_COLLAPSE + 350, T_FLASH, t) * (1 - smooth(T_FLASH + 120, T_FLASH + 1100, t)));
      ctx.save();
      if (p < 1) {
        ctx.beginPath();
        ctx.rect(cx - hw, L.top - L.titleSize * 1.2, hw * 2, L.bottom - L.top + L.titleSize * 2.4);
        ctx.clip();
      }
      env.words(a, STEELFILL);
      if (heat > 0.005) env.words(a * heat, HOT);
      ctx.restore();
      n += heat > 0.005 ? 2 : 1;

      // The edges of the cut, burning.
      if (p < 1) {
        const e = 1 - smooth(0.6, 1, p);
        const y0 = L.top - L.titleSize * 0.15;
        const hgt = L.bottom - L.top + L.titleSize * 0.3;
        const gw = Math.max(5, L.titleSize * 0.16);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (const dir of [-1, 1]) {
          const x = cx + dir * hw;
          const g = ctx.createLinearGradient(x - gw, 0, x + gw, 0);
          g.addColorStop(0, 'rgba(110,245,165,0)');
          g.addColorStop(0.5, 'rgba(160,255,205,0.6)');
          g.addColorStop(1, 'rgba(110,245,165,0)');
          ctx.globalAlpha = e;
          ctx.fillStyle = g;
          ctx.fillRect(x - gw, y0, gw * 2, hgt);
          ctx.fillStyle = FIRE_HOT;
          ctx.globalAlpha = 0.95 * e;
          ctx.fillRect(x - 1, y0, 2, hgt);
          n += 2;
        }
        ctx.restore();
      }

      // The sheen: a band of polished light crossing the steel, glinting where it passes.
      for (let si = 0; si < SHEENS.length; si++) {
        const s0 = SHEENS[si];
        if (t < s0 || t >= s0 + SHEEN_DUR) continue;
        const u = (t - s0) / SHEEN_DUR;
        const e = easeInOut(u);
        const top = L.top - L.titleSize * 0.1;
        const bot = L.bottom + L.titleSize * 0.1;
        const slant = (bot - top) * 0.32;
        const bw = Math.max(18, (maxX - minX) * 0.085);
        const x0 = minX - bw - slant * 1.2;
        const x1 = maxX + bw + slant * 1.2;
        const bx = lerp(x0, x1, e);
        // a broad soft band, a brighter one inside it and a thin sharp streak just behind
        const layers = [[0, 1, 0.3], [0, 0.5, 0.38], [0, 0.17, 0.7], [-0.95, 0.12, 0.5]];
        for (const ly of layers) {
          const c = bx + ly[0] * bw;
          const w = bw * ly[1];
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(c - w + slant, top);
          ctx.lineTo(c + w + slant, top);
          ctx.lineTo(c + w - slant, bot);
          ctx.lineTo(c - w - slant, bot);
          ctx.closePath();
          ctx.clip();
          env.words(ly[2] * a, SHEEN);
          ctx.restore();
          n++;
        }
        const gl = glints[si];
        const gsp = TEX.glint;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let j = 0; j < gl.length; j += 3) {
          const gx = gl[j];
          const gy = gl[j + 1];
          const centre = bx + slant * (1 - 2 * (gy - top) / (bot - top));
          const d = (gx - centre) / (bw * 0.5);
          const k2 = Math.exp(-d * d);
          if (k2 < 0.02) continue;
          const sz = gsp.w * gl[j + 2] * (0.5 + 0.7 * k2);
          ctx.globalAlpha = Math.min(1, k2 * a);
          ctx.drawImage(gsp.c, gx - sz / 2, gy - sz / 2, sz, sz);
          n++;
        }
        ctx.restore();
      }
      return n;
    }

    /** After the flash: embers drifting away. */
    function drawEmbers(t, fade, low) {
      if (t < T_FLASH) return 0;
      let n = 0;
      const tt = (t - T_FLASH) / 1000;
      const spr = TEX.ember;
      let px = 0;
      let py = 0;
      // where ember i is q seconds after it left: thrown out, slowed by the air, rising, swaying
      const at = (i, q) => {
        const e = (1 - Math.exp(-EM_K[i] * q)) / EM_K[i];
        px = EM_X[i] + EM_VX[i] * e + Math.sin(EM_PH[i] + q * 3.1) * R * 0.025 * q;
        py = EM_Y[i] + EM_VY[i] * e - 0.5 * EM_LIFT[i] * q * q;
      };
      for (let i = 0; i < N_EM; i += low ? 2 : 1) {
        const tau = tt - EM_DELAY[i];
        const life = EM_LIFE[i];
        if (tau < 0 || tau >= life) continue;
        at(i, tau);
        const x = px;
        const y = py;
        if (!onScreen(x, y, 16)) continue;
        const u = tau / life;
        const flick = 0.72 + 0.28 * Math.sin(EM_PH[i] * 3 + tau * 17);
        const a = (1 - smooth(0.55, 1, u)) * flick * fade;
        if (a <= 0.01) continue;
        const s = EM_SIZE[i] * (1 - 0.35 * u);
        ctx.fillStyle = EM_COLORS[EM_COL[i]];
        // while they fly fast, a streak behind them
        if (tau < 0.6 && !low) {
          at(i, Math.max(0, tau - 0.04));
          const ss = s * 0.7;
          ctx.globalAlpha = Math.min(1, a * 0.45 * (1 - tau / 0.6));
          ctx.fillRect(px - ss / 2, py - ss / 2, ss, ss);
          n++;
        }
        ctx.globalAlpha = Math.min(1, a * 0.9);
        blit(spr, x, y);
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        n += 2;
      }
      return n;
    }

    function draw(t) {
      if (!(t >= 0) || t >= GONE_AT) return 0;
      const fade = 1 - smooth(FADE_AT, GONE_AT, t);
      if (fade <= 0.002) return 0;
      const low = env.low();
      const k = kappa(t);
      const P = power(t);
      let n = 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      n += drawFlashes(t, fade);
      if (k > 0.004) {
        n += drawInner(t, k, P, fade, low);
        n += drawOuter(t, k, P, fade, low);
        n += drawFlames(t, k, P, fade, low);
      }
      n += drawHeadSparks(t);
      n += drawSparks(t, fade, low);
      ctx.restore();
      n += drawWords(t, fade);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      n += drawFlashFront(t, fade);
      n += drawEmbers(t, fade, low);
      ctx.restore();
      return n;
    }

    return {
      step: function () { /* every frame is drawn from t alone */ },
      draw: draw,
      /**
       * Before midnight: the words' pictures, the glyph marks turned the way the first moments need
       * them (later ones are turned as the circle turns, a few a second), and every texture touched
       * once, off the picture.
       */
      prime: function () {
        const first = new Set();
        const need = (set, n, rot, kinds, place) => {
          for (let tt = 0; tt <= 1600; tt += 100) {
            for (let i = 0; i < n; i++) {
              let j = Math.round((place[i] + rot(tt) + Math.PI / 2) / STEP) % NA;
              if (j < 0) j += NA;
              first.add(turnedGlyph(set, kinds[i], j));
            }
          }
        };
        need(TEX.gOut, N_GO, rotOut, GO, GO_A);
        need(TEX.gIn, N_GI, rotIn, GI, GI_A);
        // One pixel under the words, so that the words' pictures are really drawn (and uploaded) once.
        const px = Math.floor(cx * dpr);
        const py = Math.floor(L.titleY * dpr);
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          ctx.rect(px, py, 1, 1);
          ctx.clip();
          resetT();
          env.words(0.01, STEELFILL);
          env.words(0.01, HOT);
          env.words(0.01, SHEEN);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 0.01;
          const all = [TEX.ring, TEX.ringIn, TEX.head, TEX.spark, TEX.ember, TEX.node, TEX.glint].concat(TEX.flames);
          for (const sp of all) ctx.drawImage(sp.c, px, py, 1, 1);
          for (const sp of first) ctx.drawImage(sp.c, px, py, 1, 1);
        } finally {
          ctx.restore();
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(px - 1, py - 1, 3, 3);
          ctx.restore();
        }
      }
    };
  }

  FX.register('doom', { name: 'Doom', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
