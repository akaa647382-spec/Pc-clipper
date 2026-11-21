/*!
 * Avengers Player: 'doom', sorcery and steel (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays: a green flash with a burst of rays and a shock ring, and two
 *             heads of green fire race round a great circle from the top, drawing it and shedding
 *             sparks; a second ring is traced from below, runic marks ignite as the fire passes
 *             them and a figure draws itself inside.
 *   0.15 s    as the left head of fire comes level with the title, a spark leaps from it to the
 *             first letter and sets it alight. The title is burnt in letter after letter, left to
 *             right: a head of green fire runs across each letter, eating into its strokes and
 *             throwing sparks, and leaves it white-hot green with a few flames still licking at it;
 *             each letter then cools into polished steel (white to steel grey).
 *   1.05 s    the circle surges: a ring of its fire pours in from the inner ring onto the year and
 *             bursts there, and the year is branded into place, centre digits first, each digit
 *             flaring out of its own burst of green fire from its middle outwards (whole by 1.9 s).
 *   1-9 s     the circle turns slowly, its inner ring the other way, a dashed dial between them;
 *             green flames lick upward along the outer ring and sparks spiral inward to the words.
 *             A polished-steel sheen sweeps across the words three times; twice the circle surges.
 *   9.4 s     the circle gathers itself, spins faster and collapses inward into the words, which
 *             catch fire again, white-hot, and from 10.6 s melt back into fire, centre first: each
 *             letter sinks from the top into a row of flames and rising embers. A green flash at
 *             11 s, the energy bursts out as embers that drift away, and everything fades from
 *             11.5 s (nothing at all is drawn from 12.94 s on).
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
  const SHEENS = [2600, 5650, 8350];    // the polished-steel sheen
  const SHEEN_DUR = 1300;
  const SURGES = [4150, 7050];          // the circle surges
  const T_CHARGE = 9350;                // the circle gathers itself ...
  const T_COLLAPSE = 9950;              // ... falls in on itself ...
  const T_FLASH = 11050;                // ... and goes out in a green flash
  const T_SP0 = 380;                    // the sparks start spiralling in
  const SP_LAST = T_FLASH - 140;        // the last of them arrive before the flash

  // The words (ms). The circle's own fire lights the title, which is burnt in letter after letter;
  // then the circle surges and brands the year into place, centre digits first.
  const BOLT = 120;                     // the spark's flight from the ring's fire to the first letter
  const TRACE_SPAN = 640;               // the first letter of the title catching fire ... the last
  const TRACE_DUR = 300;                // a head of fire crossing one letter
  const COOL_T = 1000;                  // a letter cooling from white-hot green to steel
  const GATHER = 280;                   // the surge pouring in from the inner ring onto the year
  const BRAND_STEP = 190;               // the digits are branded centre first, this far apart
  const BRAND_DUR = 340;                // a digit flaring out of its burst
  const COOL_Y = 1100;
  const T_HEAT = T_COLLAPSE + 250;      // the collapsing circle heats the letters again ...
  const T_MELT = T_COLLAPSE + 650;      // ... and they melt back into fire, centre first
  const MELT_SPREAD = 260;
  const MELT_DUR = 520;

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
  // The green heat round a letter the fire has just made (added as light: its halo is a green glow).
  const BLOOM = { stops: [[0, '#d9ffe9'], [0.5, '#7dffb5'], [1, '#2fd07a']], halo: 'rgba(60,240,140,1)' };

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

  const LCACHE = { key: '', tex: null };
  const GEO = { key: '', list: null };     // the letters' geometry, for the size and words last seen
  const BURN = [[0, 'rgba(250,255,251,1)'], [0.18, 'rgba(200,255,222,0.9)'], [0.45, 'rgba(120,250,172,0.32)'], [1, 'rgba(110,245,165,0)']];
  const BURST = [[0, 'rgba(244,255,248,1)'], [0.22, 'rgba(150,255,195,0.7)'], [0.6, 'rgba(100,242,160,0.2)'], [1, 'rgba(100,242,160,0)']];

  /** The fire that eats into a letter's strokes, sized to the title's letters and to the year's. */
  function letterTextures(ts, ys, dpr) {
    const key = ts.toFixed(2) + '|' + ys.toFixed(2) + '|' + dpr;
    if (LCACHE.key === key) return LCACHE.tex;
    const tex = {
      burnT: blob(Math.max(8, ts * 0.22), dpr, BURN),
      burnY: blob(Math.max(8, ys * 0.12), dpr, BURN),
      burst: blob(Math.max(16, ys * 1.6), dpr, BURST)    // the surge bursting on the year (drawn scaled)
    };
    LCACHE.key = key;
    LCACHE.tex = tex;
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
      return { stops: stops, halo: HALO, stroke: { width: 0.03, stops: [[0, '#b6ffd6'], [0.45, '#45e08a'], [1, '#0d6634']] }, texture: { kind: 'scratches', color: '#ffffff', alpha: 0.42, count: 260, seed: 11 } };
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

    /* --- the letters: where each one's ink is, and when the fire builds it and melts it --- */
    const LT = letterTextures(L.titleSize, L.yearSize || L.titleSize, dpr);
    // fx.js keeps each letter in a cell of its own, halo included, and a crop is a fraction of that
    // cell: here is the cell as fx.js works it out (the steel and the hot fills have the same halo).
    const cellPad = (Math.max(6, L.titleSize * 0.28) * 1.6 + L.titleSize * 0.04) / Math.min(1, dpr) + 2;
    const NS = 6;                        // strips across a title letter: its burning edge is ragged
    const NSY = 10;                      // ... across a digit: it flares out round from its middle
    const NC = 5;                        // columns across a melting letter
    // The letters' geometry depends only on the size and the words: worked out once (prime() does it
    // before midnight) and shared by every instance after it.
    const GL = env.glyphs();
    const GKEY = W + 'x' + H + '|' + dpr + '|' + L.title + '|' + L.year + '|' + L.titleSize + '|' + L.yearSize + '|' +
      GL.map((g) => g.x0.toFixed(2) + ',' + g.x1.toFixed(2)).join(' ');
    if (GEO.key !== GKEY) { GEO.key = GKEY; GEO.list = letterGeometry(); }
    const LETTERS = GL.map((g, id) => Object.assign({ g: g, id: id }, GEO.list[id]));
    const TITLE = LETTERS.filter((o) => o.g.line === 0);
    const YEAR = LETTERS.filter((o) => o.g.line === 1);

    /** Each letter's cell, the ink in it (points in the order the fire reaches them), strips, flame spots. */
    function letterGeometry() {
      const list = GL.map((g) => {
        const half = g.size * 0.62;
        const X0 = Math.floor((g.x0 - g.size * 0.06 - cellPad) * dpr);
        const Y0 = Math.floor((g.cy - half - cellPad) * dpr);
        const wd = Math.max(1, Math.ceil((g.x1 + g.size * 0.06 + cellPad) * dpr) - X0);
        const hd = Math.max(1, Math.ceil((g.cy + half + cellPad) * dpr) - Y0);
        return { g: g, x0: X0 / dpr, y0: Y0 / dpr, w: wd / dpr, h: hd / dpr, wd: wd, hd: hd, raw: [],
          inkL: Infinity, inkR: -Infinity, inkT: Infinity, inkB: -Infinity };
      });
      // Points on the ink, each given to its letter: the fire runs along the strokes, not across boxes.
      const dense = list.length ? env.wordPoints(3400).pts : [];
      for (let i = 0; i < dense.length; i += 2) {
        const x = dense[i];
        const y = dense[i + 1];
        const line = y < split ? 0 : 1;
        let best = null;
        let bd = Infinity;
        for (const o of list) {
          if (o.g.line !== line) continue;
          const d = x < o.g.x0 ? o.g.x0 - x : x > o.g.x1 ? x - o.g.x1 : 0;
          if (d < bd) { bd = d; best = o; }
        }
        if (best && bd < best.g.size * 0.25) best.raw.push(x, y);
      }
      for (const o of list) {
        const g = o.g;
        const raw = o.raw;
        for (let i = 0; i < raw.length; i += 2) {
          if (raw[i] < o.inkL) o.inkL = raw[i];
          if (raw[i] > o.inkR) o.inkR = raw[i];
          if (raw[i + 1] < o.inkT) o.inkT = raw[i + 1];
          if (raw[i + 1] > o.inkB) o.inkB = raw[i + 1];
        }
        if (!(o.inkR >= o.inkL)) { o.inkL = g.x0; o.inkR = g.x1; o.inkT = g.top; o.inkB = g.bottom; }
        o.mx = (o.inkL + o.inkR) / 2;
        o.my = (o.inkT + o.inkB) / 2;
        // in the order the fire reaches them: left to right in the title, out from the middle in the year
        const key = (p) => (g.line === 0 ? raw[p * 2] : Math.hypot(raw[p * 2] - o.mx, raw[p * 2 + 1] - o.my));
        const idx = [];
        for (let p = 0; p < raw.length / 2; p++) idx.push(p);
        idx.sort((p, q) => key(p) - key(q));
        o.pts = new Float32Array(idx.length * 3);
        idx.forEach((p, k) => { o.pts[k * 3] = raw[p * 2]; o.pts[k * 3 + 1] = raw[p * 2 + 1]; o.pts[k * 3 + 2] = key(p); });
        o.raw = null;
        o.rInk = idx.length ? o.pts[o.pts.length - 1] : Math.hypot(o.inkR - o.mx, o.inkB - o.my);
        o.rMax = Math.hypot(Math.max(o.mx - o.x0, o.x0 + o.w - o.mx), Math.max(o.my - o.y0, o.y0 + o.h - o.my)) + 1;
        // a whole letter is drawn without the outer part of its cell, where its halo has faded to
        // nothing (under half a percent): far fewer pixels to blend for the same picture
        const tu = (cellPad * 0.4) / o.w;
        const tv = (cellPad * 0.4) / o.h;
        o.tfS = { crop: [tu, tv, 1 - tu, 1 - tv] };
        o.tfL = { crop: [tu, tv, 1 - tu, 1 - tv], op: 'lighter' };
        // strips over the ink, on whole device pixels so that neighbouring crops meet without a seam
        const ns = g.line === 0 ? NS : NSY;
        o.vb = new Float32Array(ns + 1);
        o.vb[ns] = 1;
        for (let j = 1; j < ns; j++) o.vb[j] = clamp(Math.round((lerp(o.inkT, o.inkB, j / ns) - o.y0) * dpr) / o.hd, 0, 1);
        o.ub = new Float32Array(NC + 1);
        o.ub[NC] = 1;
        for (let c = 1; c < NC; c++) o.ub[c] = clamp(Math.round((lerp(o.inkL, o.inkR, c / NC) - o.x0) * dpr) / o.wd, 0, 1);
        // where flames lick at it: the highest ink in its left half and in its right half
        o.anc = [];
        for (const side of [0, 1]) {
          let bx = 0;
          let by = Infinity;
          for (let k = 0; k < o.pts.length; k += 3) {
            if ((o.pts[k] < o.mx) === (side === 0) && o.pts[k + 1] < by) { bx = o.pts[k]; by = o.pts[k + 1]; }
          }
          if (by < Infinity) o.anc.push(bx, by);
        }
        if (!o.anc.length) o.anc.push(g.cx, o.inkT);
      }
      for (const o of list) delete o.g;      // each instance joins its own glyph records to these
      return list;
    }

    // The left head of fire drawing the outer ring comes level with the title: a spark leaps from it
    // to the first letter and lights it.
    const crossSpan = Math.acos(clamp((cy - L.titleY) / R, -1, 1));
    const tCross = clamp(T_TRACE * (1 - Math.cbrt(Math.max(0, 1 - crossSpan / Math.PI))), 100, 420);
    const T_T0 = tCross + BOLT;
    const lead = TITLE.length ? TITLE[0] : null;
    let bolt = null;
    if (lead) {
      const sp = Math.PI * easeOut(clamp(tCross / T_TRACE, 0, 1));
      const x0 = cx - Math.sin(sp) * R;
      const y0 = cy - Math.cos(sp) * R;
      const d = Math.hypot(lead.inkL - x0, lead.my - y0);
      bolt = { x0: x0, y0: y0, x1: lead.inkL, y1: lead.my, qx: (x0 + lead.inkL) / 2, qy: (y0 + lead.my) / 2 - d * 0.3 - L.titleSize * 0.25 };
    }
    // The year: the circle surges as the last letters of the title burn, and brands it.
    const BRAND = YEAR.length > 0;
    const T_Y0 = TITLE.length ? T_T0 + TRACE_SPAN + TRACE_DUR * 0.5 : T_T0;
    const T_YB = T_Y0 + GATHER;
    const yHalf = BRAND ? (YEAR[YEAR.length - 1].g.x1 - YEAR[0].g.x0) / 2 : 0;
    const xa = TITLE.length ? TITLE[0].g.x0 : 0;
    const xz = TITLE.length ? TITLE[TITLE.length - 1].g.x0 : 0;
    const mid = (YEAR.length - 1) / 2;
    let near = Infinity;
    for (const o of YEAR) near = Math.min(near, Math.abs(o.g.i - mid));
    let far = 1;
    for (const o of LETTERS) far = Math.max(far, Math.hypot(o.g.cx - cx, o.g.cy - cy));
    let T_STEADY = 0;                    // from here every letter is built and cool, until the melt
    for (const o of LETTERS) {
      if (o.g.line === 0) {
        o.t0 = T_T0 + (xz > xa ? (o.g.x0 - xa) / (xz - xa) : 0) * TRACE_SPAN;
        o.t1 = o.t0 + TRACE_DUR;
        o.cool = COOL_T;
      } else {
        o.t0 = T_YB + (Math.abs(o.g.i - mid) - near) * BRAND_STEP;
        o.t1 = o.t0 + BRAND_DUR;
        o.cool = COOL_Y;
      }
      o.m0 = T_MELT + (Math.hypot(o.g.cx - cx, o.g.cy - cy) / far) * MELT_SPREAD;
      o.m1 = o.m0 + MELT_DUR;
      T_STEADY = Math.max(T_STEADY, o.t1 + o.cool);
    }

    /** Where a title letter's head of fire is when it is k of the way across (CSS x). */
    const traceX = (o, k) => {
      const xb = o.inkL - o.g.size * 0.08;
      const xc = o.inkR + o.g.size * 0.1;
      if (k < 0.12) return lerp(o.x0, xb, k / 0.12);
      if (k < 0.86) return lerp(xb, xc, (k - 0.12) / 0.74);
      return lerp(xc, o.x0 + o.w + o.g.size * 0.2, (k - 0.86) / 0.14);
    };
    /** Where a melting letter's top edge is when it is k of the way down (CSS y). */
    const meltY = (o, k) => {
      const yb = o.inkT - o.g.size * 0.08;
      const yc = o.inkB + o.g.size * 0.1;
      if (k < 0.2) return lerp(o.y0, yb, k / 0.2);
      if (k < 0.88) return lerp(yb, yc, Math.pow((k - 0.2) / 0.68, 1.35));
      return lerp(yc, o.y0 + o.h + o.g.size * 0.2, (k - 0.88) / 0.12);
    };

    // Each letter's flicker, its sparks (thrown off the head of fire, or out of a digit's burst) and
    // the embers it melts into: [birth (ms), x, y, vx, vy (px/s), life (ms), size] each.
    for (const o of LETTERS) {
      const g = o.g;
      const s = g.size;
      o.ph = rnd() * TAU;
      o.fi = Math.floor(rnd() * 3);
      o.fper = [260 + rnd() * 160, 260 + rnd() * 160];
      o.foff = [rnd() * 400, rnd() * 400];
      o.mj = new Float32Array(NC);
      for (let c = 0; c < NC; c++) o.mj[c] = (rnd() - 0.5) * 0.12;
      const ns = g.line === 0 ? 6 : 12;
      o.sp = new Float32Array(ns * 7);
      for (let i = 0; i < ns; i++) {
        const q = o.sp;
        const k = i * 7;
        if (g.line === 0) {
          const bf = 0.16 + 0.68 * ((i + rnd()) / ns);
          q[k] = o.t0 + bf * TRACE_DUR;
          q[k + 1] = traceX(o, bf);
          q[k + 2] = lerp(o.inkT, o.inkB, rnd());
          q[k + 3] = s * (0.4 + 1.8 * rnd());
          q[k + 4] = -s * (1.0 + 2.6 * rnd());
          q[k + 5] = 260 + rnd() * 320;
        } else {
          const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * 1.5;
          const v = s * (1.6 + 2.6 * rnd());
          q[k] = o.t0 + rnd() * 70;
          q[k + 1] = o.mx + Math.cos(a) * s * 0.18;
          q[k + 2] = o.my + Math.sin(a) * s * 0.18;
          q[k + 3] = Math.cos(a) * v;
          q[k + 4] = Math.sin(a) * v;
          q[k + 5] = 380 + rnd() * 420;
        }
        q[k + 6] = Math.max(1.2, s * (g.line === 0 ? 0.028 : 0.02)) * (0.7 + 0.6 * rnd());
      }
      // the burst a digit flares out of: tongues of fire thrown outward round its top
      o.tongue = new Float32Array(g.line === 1 ? 5 * 3 : 0);
      for (let i = 0; i < o.tongue.length; i += 3) {
        o.tongue[i] = -Math.PI / 2 + ((i / 3 + 0.5) / 5 - 0.5) * Math.PI * 0.6 + (rnd() - 0.5) * 0.2;
        o.tongue[i + 1] = 0.55 + 0.45 * rnd();
        o.tongue[i + 2] = Math.floor(rnd() * 3);
      }
      o.em = new Float32Array(6 * 7);
      for (let i = 0; i < 6; i++) {
        const k = i * 7;
        const bf = 0.22 + 0.62 * ((i + rnd()) / 6);
        o.em[k] = o.m0 + bf * MELT_DUR;
        o.em[k + 1] = lerp(o.inkL, o.inkR, 0.1 + 0.8 * rnd());
        o.em[k + 2] = Math.min(o.inkB, meltY(o, bf));
        o.em[k + 3] = s * (rnd() - 0.5) * 1.1;
        o.em[k + 4] = -s * (1.1 + 1.7 * rnd());
        o.em[k + 5] = 700 + rnd() * 500;
        o.em[k + 6] = Math.max(1.6, s * 0.03) * (0.7 + 0.6 * rnd());
      }
    }

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
      // the surge that brands the year
      if (BRAND && t > T_Y0 - 200 && t < T_Y0 + 1500) p += 0.65 * Math.exp(-Math.abs(t - T_Y0 - 120) / 300);
      p += 0.5 * smooth(T_CHARGE, T_FLASH, t);
      return p;
    };
    const WAVES = BRAND ? SURGES.concat([T_Y0 - 220]) : SURGES;

    // The outer ring is drawn from the top down both sides; the inner one from the bottom up.
    const spanOut = (t) => Math.PI * easeOut(clamp(t / T_TRACE, 0, 1));
    const litOut = (a) => T_TRACE * (1 - Math.cbrt(1 - angDist(a, TOP) / Math.PI));
    const spanIn = (t) => Math.PI * easeInOut(clamp((t - T_IN0) / (T_IN1 - T_IN0), 0, 1));
    const litIn = (a) => T_IN0 + (T_IN1 - T_IN0) * easeInOutInv(angDist(a, BOTTOM) / Math.PI);

    /** A glyph's extra brightness: when the fire first reaches it, and when a surge runs past it. */
    const flareAt = (a, t, lit) => {
      let f = t >= lit ? Math.exp(-(t - lit) / 260) : 0;
      const d = angDist(a, TOP) / Math.PI;
      for (const s of WAVES) {
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

    function shock(r, w, alpha) { return shockAt(cx, cy, r, r, w, alpha); }

    /** A shock ring round (x, y), rx across and ry tall. */
    function shockAt(x, y, rx, ry, w, alpha) {
      if (alpha <= 0.004 || rx < 1) return 0;
      ctx.globalAlpha = Math.min(1, alpha * 0.45);
      ctx.strokeStyle = FIRE;
      ctx.lineWidth = w;
      ctx.beginPath();
      if (ry === rx) ctx.arc(x, y, rx, 0, TAU);
      else ctx.ellipse(x, y, rx, Math.max(0.5, ry), 0, 0, TAU);
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
      // The brand: a ring of the circle's fire pours in from the inner ring onto the year, and bursts
      // out along it as the digits are branded.
      if (BRAND && t >= T_Y0 && t < T_YB + 800) {
        if (t < T_YB) {
          const k = (t - T_Y0) / GATHER;
          const e = k * k;
          const r = lerp(R_IN, yHalf * 0.55, e);
          n += shockAt(cx, lerp(cy, L.yearY, e), r, lerp(r, r * 0.5, e), lerp(R * 0.035, R * 0.006, e), 0.85 * smooth(0, 0.3, k) * (1 - 0.55 * e) * fade);
          const d = L.yearSize * 1.6;
          ctx.globalAlpha = Math.min(1, 0.5 * e * fade);
          if (ctx.globalAlpha > 0.004) { ctx.drawImage(LT.burst.c, cx - d / 2, L.yearY - d / 2, d, d); n++; }
        } else {
          const u = (t - T_YB) / 800;
          const d = L.yearSize * (1.5 + 0.5 * easeOut(Math.min(1, u * 3)));
          ctx.globalAlpha = Math.min(1, 0.6 * Math.pow(1 - smooth(0, 0.38, u), 2) * fade);
          if (ctx.globalAlpha > 0.004) { ctx.drawImage(LT.burst.c, cx - d / 2, L.yearY - d / 2, d, d); n++; }
          const k = easeOut(u);
          const rx = lerp(yHalf * 0.3, yHalf * 2 + L.yearSize, k);
          n += shockAt(cx, L.yearY, rx, rx * 0.42, lerp(R * 0.03, 1.2, k), 0.9 * (1 - k) * fade);
        }
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

    /* ------------------------------------------------ the letters --- */

    const TFC = { crop: [0, 0, 1, 1] };                  // reused: env.glyph reads them at once
    const TFL = { crop: [0, 0, 1, 1], op: 'lighter' };
    const setCrop = (tf, u0, v0, u1, v1) => { const c = tf.crop; c[0] = u0; c[1] = v0; c[2] = u1; c[3] = v1; return tf; };
    const EDGE = new Float32Array(Math.max(NS, NC));
    let firstMelt = Infinity;
    for (const o of LETTERS) firstMelt = Math.min(firstMelt, o.m0);
    const STEADY_END = firstMelt - 170;  // the words are whole pictures from T_STEADY until the first melt

    /** How hot letter o is at t: white-hot as the fire builds it, cooling to steel, hot again as the circle falls in. */
    function heatOf(o, t) {
      const own = t < o.t1 ? 1 : 1 - smooth(o.t1, o.t1 + o.cool, t);
      return Math.max(own, 0.9 * smooth(T_HEAT, T_MELT, t), smooth(o.m0 - 160, o.m0, t));
    }

    /** A title letter's burning edge at t: the head's x, and EDGE[j] per strip (ragged, its foot a little ahead). */
    function traceEdge(o, t) {
      const s = o.g.size;
      const xe = traceX(o, clamp((t - o.t0) / (o.t1 - o.t0), 0, 1));
      for (let j = 0; j < NS; j++) EDGE[j] = xe + s * (0.15 * ((j + 0.5) / NS - 0.5) + 0.05 * Math.sin(t * 0.043 + j * 2.3 + o.ph));
      return xe;
    }

    /** A digit's burst at t: how far its fire has spread out from its middle (CSS px). */
    function brandR(o, t) {
      const k = clamp((t - o.t0) / (o.t1 - o.t0), 0, 1);
      return k < 0.55 ? o.rInk * 1.06 * easeOut(k / 0.55) : lerp(o.rInk * 1.06, o.rMax, (k - 0.55) / 0.45);
    }

    /** A melting letter's top edge at t: EDGE[c] per column (ragged). */
    function meltEdge(o, t) {
      const s = o.g.size;
      const ye = meltY(o, clamp((t - o.m0) / MELT_DUR, 0, 1));
      for (let c = 0; c < NC; c++) EDGE[c] = ye + s * (0.06 * Math.sin(t * 0.037 + c * 1.9 + o.ph) + o.mj[c]);
      return ye;
    }

    const colOf = (o, x) => {
      const u = (x - o.x0) / o.w;
      let c = 0;
      while (c < NC - 1 && u >= o.ub[c + 1]) c++;
      return c;
    };

    /** A title letter while the fire crosses it: burnt in up to its ragged edge, white-hot. */
    function traceBody(o, t, a) {
      traceEdge(o, t);
      let n = 0;
      let lo = Infinity;
      for (let j = 0; j < NS; j++) {
        const u = (EDGE[j] - o.x0) / o.w;
        if (u <= 0) continue;
        if (u < lo) lo = u;
        setCrop(TFC, 0, o.vb[j], Math.min(1, u), o.vb[j + 1]);
        env.glyph(o.g, a, STEELFILL, TFC);
        env.glyph(o.g, a, HOT, TFC);
        n += 2;
      }
      if (lo < 1) {
        // the green heat round what is burnt, and just behind the fire it glows hotter still
        env.glyph(o.g, 0.6 * a, BLOOM, setCrop(TFL, 0, 0, lo, 1));
        const du = (o.g.size * 0.45) / o.w;
        env.glyph(o.g, 0.55 * a, HOT, setCrop(TFL, Math.max(0, lo - du), 0, lo, 1));
        n += 2;
      }
      return n;
    }

    /** A digit while it flares out of its burst: round from its middle, white-hot and glowing. */
    function brandBody(o, t, a) {
      const r = brandR(o, t);
      if (r <= 0.5) return 0;
      let n = 0;
      for (let j = 0; j < o.vb.length - 1; j++) {
        const ya = o.y0 + o.vb[j] * o.h;
        const yb = o.y0 + o.vb[j + 1] * o.h;
        const dy = ya > o.my ? ya - o.my : yb < o.my ? o.my - yb : 0;
        if (dy >= r) continue;
        const hw = Math.sqrt(r * r - dy * dy);
        const u0 = Math.max(0, (o.mx - hw - o.x0) / o.w);
        const u1 = Math.min(1, (o.mx + hw - o.x0) / o.w);
        setCrop(TFC, u0, o.vb[j], u1, o.vb[j + 1]);
        env.glyph(o.g, a, STEELFILL, TFC);
        env.glyph(o.g, a, HOT, TFC);
        env.glyph(o.g, 0.7 * a, BLOOM, setCrop(TFL, u0, o.vb[j], u1, o.vb[j + 1]));
        n += 3;
      }
      return n;
    }

    /** A letter melting: what is left below its sinking, ragged top edge, white-hot. */
    function meltBody(o, t, a) {
      meltEdge(o, t);
      let n = 0;
      for (let c = 0; c < NC; c++) {
        const v = (EDGE[c] - o.y0) / o.h;
        if (v >= 1) continue;
        setCrop(TFC, o.ub[c], Math.max(0, v), o.ub[c + 1], 1);
        env.glyph(o.g, a, STEELFILL, TFC);
        env.glyph(o.g, a, HOT, TFC);
        env.glyph(o.g, 0.6 * a, BLOOM, setCrop(TFL, o.ub[c], Math.max(0, v), o.ub[c + 1], 1));
        n += 3;
      }
      return n;
    }

    /** The letters: each one built by the fire, cooling to steel, then melting back into fire. */
    function drawLetters(t, fade) {
      if (!LETTERS.length || fade <= 0.003) return 0;
      // All of them built and whole, cool or heating as one: the words in one picture (the same pixels
      // as the letters), as many times as it takes.
      if (t >= T_STEADY && t < STEADY_END) {
        const back = 0.9 * smooth(T_HEAT, T_MELT, t);
        env.words(fade, STEELFILL);
        if (back > 0.005) env.words(fade * back, HOT);
        return back > 0.005 ? 2 : 1;
      }
      let n = 0;
      for (const o of LETTERS) {
        if (t < o.t0 || t >= o.m1) continue;
        if (t < o.t1) n += o.g.line === 0 ? traceBody(o, t, fade) : brandBody(o, t, fade);
        else if (t >= o.m0) n += meltBody(o, t, fade);
        else {
          const h = heatOf(o, t);
          env.glyph(o.g, fade, STEELFILL, o.tfS);
          n++;
          if (h > 0.02) { env.glyph(o.g, fade * h, HOT, o.tfS); n++; }
          // the green heat round it from its own fire (a digit just branded flares a little more)
          const own = Math.max(1 - smooth(o.t1, o.t1 + o.cool, t), smooth(o.m0 - 160, o.m0, t));
          const bloom = fade * own * own * (o.g.line === 1 ? 0.6 + 0.1 * (1 - smooth(o.t1, o.t1 + 450, t)) : 0.6);
          if (bloom > 0.03) { env.glyph(o.g, bloom, BLOOM, o.tfL); n++; }
        }
      }
      return n;
    }

    /** Letter o's sparks: thrown off its head of fire, or out of its burst; slowed by the air, falling. */
    function letterSparks(o, t, fade, low) {
      const q = o.sp;
      const G = o.g.size * 5;
      let n = 0;
      ctx.fillStyle = FIRE_HOT;
      for (let k = 0; k < q.length; k += low ? 14 : 7) {
        const age = t - q[k];
        if (age < 0 || age >= q[k + 5]) continue;
        const s = age / 1000;
        const e = (1 - Math.exp(-2.4 * s)) / 2.4;
        const x = q[k + 1] + q[k + 3] * e;
        const y = q[k + 2] + q[k + 4] * e + 0.5 * G * s * s;
        const al = (1 - age / q[k + 5]) * fade;
        const z = q[k + 6];
        ctx.globalAlpha = Math.min(1, al);
        ctx.fillRect(x - z / 2, y - z / 2, z, z);
        ctx.globalAlpha = Math.min(1, al * 0.7);
        blit(TEX.spark, x, y);
        n += 2;
      }
      return n;
    }

    /** The fire burning a title letter in: on the strokes at its edge, a head of fire, a flame on top. */
    function traceFire(o, t, fade, low) {
      let n = 0;
      if (t < o.t1) {
        const s = o.g.size;
        const k = (t - o.t0) / (o.t1 - o.t0);
        const xe = traceEdge(o, t);
        const lit = smooth(0.07, 0.16, k) * (1 - smooth(0.8, 0.95, k)) * fade;
        if (lit > 0.01) {
          const band = s * 0.26;
          const P = o.pts;
          const span = Math.max(1, o.inkB - o.inkT);
          for (let i = 0; i < P.length; i += low ? 6 : 3) {
            const x = P[i];
            if (x > xe + s * 0.13) break;
            const y = P[i + 1];
            const d = EDGE[clamp(Math.floor(((y - o.inkT) / span) * NS), 0, NS - 1)] - x;
            if (d < 0 || d > band) continue;
            const q = 1 - d / band;
            ctx.globalAlpha = Math.min(1, q * q * 1.25 * lit);
            blit(LT.burnT, x, y);
            n++;
          }
          // the head: a column of green fire down the edge, and tongues of flame leaping off its top
          const hh = span * 2.1;
          const hw = s * 0.8;
          ctx.globalAlpha = Math.min(1, 0.95 * lit);
          ctx.drawImage(TEX.ring.c, xe - hw / 2, o.my - hh / 2, hw, hh);
          const flick = Math.floor(t / 60) + o.fi;
          for (let f = 0; f < 2; f++) {
            const fl = TEX.flames[(flick + f) % 3];
            const fw = s * (f ? 0.34 : 0.44);
            const fh = s * (f ? 0.5 : 0.72) * (0.85 + 0.25 * Math.sin(t * 0.031 + o.ph + f * 2.4));
            const fx = EDGE[f] - s * (f ? 0.12 : 0.02);
            ctx.globalAlpha = Math.min(1, (f ? 0.75 : 0.95) * lit);
            ctx.drawImage(fl.c, fx - fw / 2, o.inkT + s * 0.14 - fh * fl.base, fw, fh);
          }
          n += 3;
        }
      }
      return n + letterSparks(o, t, fade, low);
    }

    /** The burst a digit flares out of: a flash, tongues of fire thrown out round it, fire on its strokes. */
    function brandFire(o, t, fade, low) {
      let n = 0;
      const s = o.g.size;
      const age = t - o.t0;
      if (age < 560) {
        const u = age / 560;
        const d = Math.min(s, L.titleSize * 1.8) * (0.8 + 0.7 * easeOut(Math.min(1, u * 2.5)));
        ctx.globalAlpha = Math.min(1, 0.95 * Math.pow(1 - u, 1.7) * fade);
        ctx.drawImage(TEX.head.c, o.mx - d / 2, o.my - d / 2, d, d);
        n++;
        // tongues of fire leaping up off its top, leaning outward, and dying back (upright sprites:
        // the flame textures lean left and right already, and a turned sprite costs five times more)
        const e = Math.sin(Math.PI * Math.min(1, u * 1.1));
        for (let i = 0; i < o.tongue.length; i += 3) {
          const a = o.tongue[i];
          const len = s * 0.62 * o.tongue[i + 1] * e;
          if (len < 2) continue;
          const side = a < -Math.PI / 2 - 0.2 ? 1 : a > -Math.PI / 2 + 0.2 ? 2 : (o.tongue[i + 2] + Math.floor(t / 70)) % 3;
          const fl = TEX.flames[side];
          const fw = s * 0.32;
          const rx = o.mx + Math.cos(a) * s * 0.3;
          const ry = o.inkT + s * 0.12 + (Math.sin(a) + 1) * s * 0.3;
          ctx.globalAlpha = Math.min(1, 0.9 * e * fade);
          ctx.drawImage(fl.c, rx - fw / 2, ry - len * fl.base, fw, len);
          n++;
        }
      }
      if (t < o.t1) {
        const r = brandR(o, t);
        const lit = (1 - smooth(0.5, 0.65, age / (o.t1 - o.t0))) * fade;
        if (lit > 0.01 && r > 0) {
          const band = s * 0.09;
          const P = o.pts;
          for (let i = 0; i < P.length; i += low ? 15 : 9) {     // every third point (a big digit has many)
            const d = r - P[i + 2];
            if (d < 0) break;
            if (d > band) continue;
            const q = 1 - d / band;
            ctx.globalAlpha = Math.min(1, q * q * 1.2 * lit);
            blit(LT.burnY, P[i], P[i + 1]);
            n++;
          }
        }
      }
      return n + letterSparks(o, t, fade, low);
    }

    /** Flames still licking at a letter while it is hot. */
    function letterFlames(o, t, fade, h) {
      const lvl = smooth(0.12, 0.85, h);
      if (lvl <= 0.01) return 0;
      let n = 0;
      const s = Math.min(o.g.size, L.titleSize * 1.3);     // the year's big digits burn no taller
      for (let k = 0; k < o.anc.length; k += 2) {
        const ax = o.anc[k];
        const ay = o.anc[k + 1];
        // not before the fire has reached it
        if (t < o.t1) {
          if (o.g.line === 0) { if (traceX(o, (t - o.t0) / (o.t1 - o.t0)) < ax) continue; }
          else if (brandR(o, t) < Math.hypot(ax - o.mx, ay - o.my)) continue;
        }
        const per = o.fper[k >> 1];
        const tt = t + o.foff[k >> 1];
        const c = Math.floor(tt / per);
        const e = Math.sin(Math.PI * ((tt - c * per) / per));
        const fh = s * (0.3 + 0.32 * rt(o.id * 131 + c * 17 + k)) * (0.35 + 0.65 * e) * lvl;
        if (fh < 1.5) continue;
        const fw = s * 0.26 * (0.8 + 0.2 * e);
        const fl = TEX.flames[Math.floor(rt(o.id * 53 + c * 7 + k) * 3)];
        ctx.globalAlpha = Math.min(1, Math.sqrt(e * lvl) * 0.9 * fade);
        ctx.drawImage(fl.c, ax - fw / 2, ay + s * 0.06 - fh * fl.base, fw, fh);
        n++;
      }
      return n;
    }

    /** A letter melting back into fire: fire on its strokes at the sinking edge, flames rising off it, embers. */
    function meltFire(o, t, fade, low) {
      let n = 0;
      const s = o.g.size;
      if (t < o.m1) {
        const k = (t - o.m0) / MELT_DUR;
        meltEdge(o, t);
        const lit = smooth(0.05, 0.22, k) * (1 - smooth(0.86, 0.98, k)) * fade;
        if (lit > 0.01) {
          const band = s * 0.2;
          const P = o.pts;
          const spr = o.g.line === 0 ? LT.burnT : LT.burnY;
          const stride = (o.g.line === 0 ? 6 : 9) * (low ? 2 : 1);
          for (let i = 0; i < P.length; i += stride) {
            const x = P[i];
            const d = P[i + 1] - EDGE[colOf(o, x)];
            if (d < 0 || d > band) continue;
            const q = 1 - d / band;
            ctx.globalAlpha = Math.min(1, q * q * 1.2 * lit);
            blit(spr, x, P[i + 1]);
            n++;
          }
          // the flames it turns into
          for (let f = 0; f < 3; f++) {
            const fx = lerp(o.inkL, o.inkR, 0.18 + 0.32 * f);
            const ye = EDGE[colOf(o, fx)];
            if (ye > o.inkB + s * 0.05) continue;
            const fl = TEX.flames[(f + o.fi + Math.floor(t / 75)) % 3];
            const sf = Math.min(s, L.titleSize * 1.4);
            const fw = sf * 0.36;
            const fh = sf * (0.7 + 0.35 * Math.sin(t * 0.023 + f * 2.1 + o.ph)) * (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, k * 1.1)));
            ctx.globalAlpha = Math.min(1, 0.95 * lit);
            ctx.drawImage(fl.c, fx - fw / 2, ye + s * 0.08 - fh * fl.base, fw, fh);
            n++;
          }
        }
      }
      // the embers it leaves, rising and swaying as they die
      const q = o.em;
      for (let i = 0; i < q.length; i += low ? 14 : 7) {
        const age = t - q[i];
        if (age < 0 || age >= q[i + 5]) continue;
        const sec = age / 1000;
        const e = (1 - Math.exp(-1.6 * sec)) / 1.6;
        const x = q[i + 1] + q[i + 3] * e + Math.sin(o.ph + i + sec * 4) * s * 0.06 * sec;
        const y = q[i + 2] + q[i + 4] * e;
        const u = age / q[i + 5];
        const al = (1 - smooth(0.5, 1, u)) * (0.75 + 0.25 * Math.sin(sec * 19 + i)) * fade;
        const z = q[i + 6] * (1 - 0.4 * u);
        ctx.globalAlpha = Math.min(1, al * 0.85);
        blit(TEX.ember, x, y);
        ctx.fillStyle = i % 3 ? FIRE_LIGHT : FIRE_HOT;
        ctx.globalAlpha = Math.min(1, al);
        ctx.fillRect(x - z / 2, y - z / 2, z, z);
        n += 2;
      }
      return n;
    }

    /** The spark that leaps from the ring's head of fire to the first letter, and the letter catching. */
    function drawBolt(t, fade) {
      if (!bolt || t < tCross || t > T_T0 + 260) return 0;
      const b = bolt;
      let n = 0;
      if (t < T_T0) {
        const k = (t - tCross) / BOLT;
        const sw = Math.max(TEX.spark.w, L.titleSize * 0.3);
        // the ring's fire flares as the spark leaves it
        const fd = L.titleSize * (0.9 + 0.6 * k);
        ctx.globalAlpha = Math.min(1, 0.8 * (1 - k) * fade);
        ctx.drawImage(TEX.ring.c, b.x0 - fd / 2, b.y0 - fd / 2, fd, fd);
        n++;
        for (let j = 9; j >= 0; j--) {
          const q = clamp(k - j * 0.05, 0, 1);
          const iq = 1 - q;
          const x = iq * iq * b.x0 + 2 * iq * q * b.qx + q * q * b.x1;
          const y = iq * iq * b.y0 + 2 * iq * q * b.qy + q * q * b.y1;
          const d = sw * (j === 0 ? 2.4 : 1.6 * (1 - j / 10));
          ctx.globalAlpha = Math.min(1, (j === 0 ? 1 : 0.8 * (1 - j / 10)) * fade);
          ctx.drawImage(TEX.spark.c, x - d / 2, y - d / 2, d, d);
          n++;
        }
      } else {
        const u = (t - T_T0) / 260;
        const d = L.titleSize * (0.7 + 0.9 * easeOut(u));
        ctx.globalAlpha = Math.min(1, 0.9 * Math.pow(1 - u, 2) * fade);
        ctx.drawImage(TEX.head.c, b.x1 - d / 2, b.y1 - d / 2, d, d);
        n++;
      }
      return n;
    }

    /** In front of the letters: the fire that builds them, keeps them hot and melts them. */
    function drawLetterFire(t, fade, low) {
      if (!LETTERS.length || fade <= 0.003) return 0;
      let n = drawBolt(t, fade);
      for (const o of LETTERS) {
        if (t < o.t0) continue;
        if (t < o.t1 + 900) n += o.g.line === 0 ? traceFire(o, t, fade, low) : brandFire(o, t, fade, low);
        if (t < o.m0) n += letterFlames(o, t, fade, heatOf(o, t));
        else n += meltFire(o, t, fade, low);
      }
      return n;
    }

    /** The sheen: a band of polished light crossing the steel, glinting where it passes. */
    function drawSheen(t, fade) {
      let n = 0;
      const a = fade;
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
      n += drawLetters(t, fade);
      n += drawSheen(t, fade);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      n += drawLetterFire(t, fade, low);
      n += drawFlashFront(t, fade);
      n += drawEmbers(t, fade, low);
      ctx.restore();
      return n;
    }

    // The sound (sfx-doom.js): every moment of this animation is known from here, so one plan carries
    // them all (x is 0..1 across the frame). Nothing here is drawn or drawn from the seed.
    if (env.cue) {
      env.cue('plan', {
        cx: cx / W, r: R / W, cross: tCross, trace: T_TRACE,
        bolt: bolt ? { x0: bolt.x0 / W, x1: bolt.x1 / W } : null,
        title: TITLE.map((o) => ({ t: o.t0, x: o.g.cx / W, melt: o.m0 })),
        year: YEAR.map((o) => ({ t: o.t0, x: o.g.cx / W, melt: o.m0 })),
        gather: T_Y0, burst: T_YB, steady: T_STEADY,
        sheens: SHEENS, surges: SURGES, charge: T_CHARGE, collapse: T_COLLAPSE, heat: T_HEAT, melt: T_MELT, flash: T_FLASH
      }, 0);
    }

    return {
      step: function () { /* every frame is drawn from t alone */ },
      draw: draw,
      /**
       * Before midnight: the words' pictures and the letters' (steel and white-hot), the glyph marks
       * turned the way the first moments need them (later ones are turned as the circle turns, a few
       * a second), and every texture touched once, off the picture.
       */
      prime: function () {
        env.warm(STEELFILL);
        env.warm(HOT);
        env.warm(BLOOM);
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
          // a letter of each line in each fill, moved onto that pixel, so that their pictures are drawn once
          for (const o of [TITLE[0], YEAR[0]]) {
            if (!o) continue;
            const tf = { dx: (px + 0.5) / dpr - o.g.cx, dy: (py + 0.5) / dpr - o.g.cy };
            env.glyph(o.g, 0.01, STEELFILL, tf);
            env.glyph(o.g, 0.01, HOT, tf);
            tf.op = 'lighter';
            env.glyph(o.g, 0.01, HOT, tf);
            env.glyph(o.g, 0.01, BLOOM, tf);
          }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 0.01;
          const all = [TEX.ring, TEX.ringIn, TEX.head, TEX.spark, TEX.ember, TEX.node, TEX.glint, LT.burnT, LT.burnY, LT.burst].concat(TEX.flames);
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

  FX.register('doom', { name: 'Doom', duration: DURATION, font: { family: 'AP Cinzel', weight: 900, tracking: 0.06 }, create: create });
})(typeof window !== 'undefined' ? window : this);
