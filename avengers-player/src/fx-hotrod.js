/*!
 * Avengers Player: 'hotrod', the Hot Rod celebration (a style for src/fx.js). Forged in red and gold.
 *
 *   0.0 s     the instant it plays: two thrusters scream in from the lower left and right of the
 *             frame on red and gold exhaust and cross behind the middle of the words in a burst of
 *             light and rays, then climb away to the top corners.
 *   0.35 s    the year is forged, one digit after the other (0.52, 0.76, 1.0, 1.24 s): a white-hot
 *             slug dives in and strikes, and the digit lands white-hot, squashed by the blow, with a
 *             jolt of the whole row, a flash, rays, a shock ring on the ground and a burst of sparks;
 *             then it cools to polished gold with a deep red edge.
 *   1.26 s    the last strike throws a bead of molten metal that arcs over to the start of the
 *             title and lights a welding torch there.
 *   1.6 s     the torch runs along the title letter by letter, left to right, weaving and throwing a
 *             spray of falling sparks; every letter it passes is welded on white-hot and cools to
 *             polished gold (the line is complete at 2.75 s).
 *   2.8-10.6 s  the metal holds: a polished sheen sweeps the words three times, glinting at the
 *             corners; twice a wave of heat runs through the letters, glowing red and shimmering; embers
 *             drift up from the letters and from below.
 *   10.25 s   the metal cools towards bronze and the letters go out one after the other, title
 *             first: each burns out red and breaks into embers that drift off; nothing is drawn from
 *             12.54 s on.
 *
 * Without a year (RIGHT ON TIME, TARGET REACHED) the thrusters cross behind the title, the crossing
 * throws the bead and the weld starts at 0.64 s (the title is complete at 2.15 s). Only the year it
 * is given is ever shown (no roll-over from the year before).
 *
 * The words are never stamped whole: every letter is drawn on its own (env.glyph), at the moment and
 * in the state the forge gives it. Light only (the movie is under the canvas): glows, sparks and
 * trails are added with 'lighter'; the letters keep a dark (deep red) halo so they read over a
 * bright scene. Every frame is a function of the seed and t alone (nothing is simulated from frame
 * to frame), so renderAt(t), a resize in the middle and the live animation draw the same picture.
 *
 * Speed (a software-rendered canvas is the yardstick): big glows are made once at their size in
 * device pixels and copied 1:1; letters are copied 1:1 on whole device pixels except for the few
 * frames a strike squashes one; heat shimmer is a letter's glow drawn in four bands nudged sideways
 * (added light sums exactly, so the bands meet without a seam), only while the metal is hot.
 */
(function (root) {
  'use strict';

  const FX = root.APFx;
  if (!FX || typeof FX.register !== 'function') return;

  const DURATION = 12600;
  const GONE_AT = DURATION - 60;        // nothing at all is drawn from here on
  const TAU = Math.PI * 2;

  // The timeline (ms).
  const T_IN = -90;                     // the thrusters' heads are at the edges of the frame ...
  const T_CROSS = 330;                  // ... cross behind the words ...
  const T_OUT = 2 * T_CROSS - T_IN;     // ... and are out by the top corners
  const SLUG = 180;                     // a white-hot slug falls this long before it strikes a digit
  const HIT0 = 520;                     // the first digit is struck ...
  const HIT_LAST = 1240;                // ... and the last one then
  const BEAD = 240;                     // a bead of molten metal flies from the last strike to the title
  const WELD_END = 2750;                // the title is welded by then (2150 without a year)
  const SHEENS = [3300, 6150, 8850];    // a polished sheen sweeps across the words
  const WAVES = [4500, 7450];           // a wave of heat runs through the metal, shimmering
  const SHEEN_DUR = 1150;
  // The light across the sheen's band: [distance from its middle (1 = its half-width), light].
  const SHEEN_PROFILE = [[0, 0.62], [0.08, 0.57], [0.18, 0.44], [0.32, 0.29], [0.48, 0.18], [0.66, 0.09], [0.83, 0.035], [1, 0]];
  const T_COOL0 = 10250;                // the metal cools from gold to bronze ...
  const T_COOL1 = 11000;
  const T_OUT0 = 10600;                 // ... and the letters go out, title first,
  const LETTER_OUT = 520;               // each over this long
  // The weld's front: the metal comes in over this much of the title's height behind the torch,
  // along a soft (smoothstep) edge.
  const FEATHER = 0.42;
  const WIPE = [[0, 'rgba(0,0,0,0)'], [0.2, 'rgba(0,0,0,0.1)'], [0.4, 'rgba(0,0,0,0.35)'], [0.6, 'rgba(0,0,0,0.65)'],
    [0.8, 'rgba(0,0,0,0.9)'], [1, 'rgba(0,0,0,1)']];

  // Hot Rod's red and gold.
  const RED = '#e02b35';
  const GOLD = '#ffc24a';
  const EMBER_COLS = ['#ffc45a', '#ff8a2a', '#ff5a2a', '#e02b35'];

  // The letters: polished gold with a deep red edge (per line, see lineFill), white-hot, their red
  // heat glow, the light of the sheen and the bronze they cool to.
  const POLISH = [[0, '#fff0c0'], [0.18, '#ffd878'], [0.45, '#ffbc3c'], [0.52, '#b05c16'], [0.58, '#ffcf68'], [0.82, '#f0922a'], [1, '#c22e28']];
  const BRONZE = [[0, '#e3c08a'], [0.46, '#b07a3c'], [0.53, '#6a3a1a'], [0.6, '#a46a32'], [1, '#5e2218']];
  const HALO = 'rgba(64,4,8,0.9)';      // a deep red edge, dark enough to read over a bright scene
  const HOT = { stops: [[0, '#ffffff'], [1, '#fff1c6']], halo: 'rgba(255,168,64,1)' };
  const HEAT = { stops: [[0, '#ff9440'], [1, '#ff4626']], halo: 'rgba(255,44,28,1)' };
  const SHEEN = { stops: [[0, '#ffffff'], [1, '#fff4d8']] };

  // Sparks cool from white-hot to dull red as they fly (by the share of their life gone).
  const SPARK_COLS = ['#fffdf2', '#fff0b4', '#ffd25a', '#ffa034', '#ff6424', '#d92a28'];
  const SPARK_ALPHA = [1, 1, 0.95, 0.85, 0.7, 0.45];
  const NB = SPARK_COLS.length;
  const STREAK = 0.03;                  // a spark's streak: where it was this long ago (s)
  const STRIPS = 4;                     // heat shimmer: the hot glow is drawn in this many bands
  const CROPS = [];
  for (let s = 0; s < STRIPS; s++) CROPS.push([0, s / STRIPS, 1, (s + 1) / STRIPS]);

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(2 - 2 * x, 3) / 2);

  /* ------------------------------------------------------- textures --- */

  let TEX = null;                       // made once for the page (the first create(), from prime())

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function radialPic(size, stops) {
    const c = canvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  function textures() {
    if (TEX) return TEX;
    const white = radialPic(128, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(255,253,244,0.95)'], [0.28, 'rgba(255,228,165,0.45)'],
      [0.55, 'rgba(255,165,70,0.12)'], [1, 'rgba(255,120,40,0)']]);
    // A long horizontal lens streak: a round glow squashed sixteen times.
    const flare = canvas(256, 16);
    let g = flare.getContext('2d');
    g.setTransform(8, 0, 0, 0.5, 0, 0);
    let gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,250,232,1)');
    gr.addColorStop(0.12, 'rgba(255,214,140,0.75)');
    gr.addColorStop(0.4, 'rgba(255,140,60,0.22)');
    gr.addColorStop(1, 'rgba(224,43,53,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 32, 32);
    // A four-point glint: the sheen catching a corner of the metal.
    const star = canvas(64, 64);
    g = star.getContext('2d');
    g.drawImage(flare, 0, 28, 64, 8);
    g.translate(32, 32);
    g.rotate(Math.PI / 2);
    g.drawImage(flare, -24, -3, 48, 6);
    g.setTransform(1, 0, 0, 1, 0, 0);
    gr = g.createRadialGradient(32, 32, 0, 32, 32, 9);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,220,150,0)');
    g.fillStyle = gr;
    g.fillRect(20, 20, 24, 24);
    // A comet's tail, bright at its head (the right end) and tapering away to the left: three soft
    // wedges laid over each other.
    const tail = canvas(256, 32);
    g = tail.getContext('2d');
    for (const ly of [[30, 0.22], [16, 0.42], [6, 0.95]]) {
      const lg = g.createLinearGradient(0, 0, 256, 0);
      lg.addColorStop(0, 'rgba(224,43,53,0)');
      lg.addColorStop(0.45, 'rgba(255,96,40,' + (0.35 * ly[1]).toFixed(3) + ')');
      lg.addColorStop(0.85, 'rgba(255,196,96,' + (0.85 * ly[1]).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(255,250,232,' + ly[1] + ')');
      g.fillStyle = lg;
      g.beginPath();
      g.moveTo(0, 16);
      g.lineTo(250, 16 - ly[0] / 2);
      g.quadraticCurveTo(256, 16, 250, 16 + ly[0] / 2);
      g.closePath();
      g.fill();
    }
    TEX = { white: white, flare: flare, star: star, tail: tail };
    return TEX;
  }

  // Glows that are always drawn at one size are made at that size in device pixels and copied 1:1
  // (a stretched sprite costs several times as much on a software-rendered canvas): a head of fire
  // (white-hot core, gold, red), and the flash of a strike or of the crossing.
  const HEAD_STOPS = [[0, 'rgba(255,255,255,1)'], [0.06, 'rgba(255,252,236,1)'], [0.13, 'rgba(255,226,150,0.85)'],
    [0.25, 'rgba(255,180,80,0.5)'], [0.45, 'rgba(240,96,48,0.2)'], [0.7, 'rgba(200,40,40,0.07)'], [1, 'rgba(160,20,30,0)']];
  const FLASH_STOPS = [[0, 'rgba(255,250,236,0.95)'], [0.1, 'rgba(255,232,170,0.75)'], [0.28, 'rgba(255,176,80,0.38)'],
    [0.5, 'rgba(236,84,44,0.14)'], [0.75, 'rgba(200,40,40,0.04)'], [1, 'rgba(160,20,30,0)']];
  const STILLS = new Map();             // kept for the page, by size (prime() makes the ones a size needs)
  // The letters in plain white without their halo, in device pixels, and a buffer as big: the
  // sheen's light is kept to the metal by it. Made from the letters themselves for one size and
  // words (prime() makes it), kept for the page: { key, x, y, c, buf, g }.
  let MASK = null;

  function still(px, stops) {
    const d = Math.max(2, Math.round(px));
    const key = d + (stops === HEAD_STOPS ? 'h' : 'f');
    let c = STILLS.get(key);
    if (!c) {
      if (STILLS.size > 24) STILLS.clear();
      c = radialPic(d, stops);
      STILLS.set(key, c);
    }
    return c;
  }

  /**
   * A fill for the letters with its colours laid out per line: fx.js runs a fill's colours from the
   * top of the title to the bottom of the year, so the profile (0 at the top of a line's capitals, 1
   * at their bottom) is placed once on each line and every letter gets the whole polished bevel.
   */
  function lineFill(L, profile, halo) {
    const span = Math.max(1, L.bottom - L.top);
    const lines = [[L.titleY, L.titleSize]];
    if (L.year) lines.push([L.yearY, L.yearSize]);
    const stops = [];
    let last = 0;
    for (const ln of lines) {
      const top = ln[0] - ln[1] * 0.38;
      const h = ln[1] * 0.76;
      for (const p of profile) {
        const o = Math.round(clamp((top + h * p[0] - L.top) / span, last, 1) * 10000) / 10000;
        last = o;
        stops.push([o, p[1]]);
      }
    }
    return halo ? { stops: stops, halo: halo } : { stops: stops };
  }

  /* ---------------------------------------------------------- style --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const rnd = env.rnd;
    const S = env.scale;
    const dpr = env.dpr || 1;
    const lerp = env.lerp;
    const smooth = env.smooth;
    const easeOut = env.easeOut;
    const tex = textures();
    const emberPics = EMBER_COLS.map((c) => env.sprite(c));

    const glyphs = env.glyphs();
    const TL = glyphs.filter((g) => g.line === 0);
    const YL = glyphs.filter((g) => g.line === 1);
    const nT = TL.length;
    const nY = YL.length;
    const TS = L.titleSize;
    const YS = nY ? L.yearSize : TS;
    const GOLDF = lineFill(L, POLISH, HALO);
    const BRONZEF = lineFill(L, BRONZE, HALO);
    let minX = Infinity;
    let maxX = -Infinity;
    for (const g of glyphs) { if (g.x0 < minX) minX = g.x0; if (g.x1 > maxX) maxX = g.x1; }
    if (!glyphs.length) { minX = L.cx; maxX = L.cx; }

    /* -- the timeline of the letters -- */

    // The digits are struck one after the other. The last strike (without a year: the crossing)
    // throws a molten bead that arcs over to the start of the title and lights the torch where it
    // lands; the weld then runs along the title: across a letter at one speed, from one letter to
    // the next three times as fast (the torch lifted).
    const HIT = new Float64Array(nY);
    for (let i = 0; i < nY; i++) HIT[i] = nY > 1 ? HIT0 + (HIT_LAST - HIT0) * i / (nY - 1) : HIT0;
    const B0 = nY ? HIT[nY - 1] + 20 : T_CROSS + 30;
    const FLY = nY ? BEAD : BEAD - 70;
    const B1 = B0 + FLY;
    const W0 = B1 + 100;
    const W1 = nY ? WELD_END : 2150;
    const WS = new Float64Array(nT);
    const WE = new Float64Array(nT);
    let vWeld = 1;                                            // px per ms while welding
    {
      let work = 0;
      for (let j = 0; j < nT; j++) {
        work += Math.max(1, TL[j].x1 - TL[j].x0);
        if (j < nT - 1) work += Math.max(0, TL[j + 1].x0 - TL[j].x1) / 3;
      }
      vWeld = work / Math.max(1, W1 - W0);
      let tc = W0;
      for (let j = 0; j < nT; j++) {
        WS[j] = tc;
        tc += Math.max(1, TL[j].x1 - TL[j].x0) / vWeld;
        WE[j] = tc;
        if (j < nT - 1) tc += Math.max(0, TL[j + 1].x0 - TL[j].x1) / (vWeld * 3);
      }
    }
    function weldX(t) {
      if (!nT) return L.cx;
      // lit on the edge of the first letter's halo, it runs onto the letter as the weld begins
      if (t <= WS[0]) return TL[0].x0 - TL[0].size * 0.6 * (1 - clamp((t - (W0 - 100)) / 100, 0, 1));
      for (let j = 0; j < nT; j++) {
        if (t < WE[j]) return lerp(TL[j].x0, TL[j].x1, (t - WS[j]) / (WE[j] - WS[j]));
        if (j < nT - 1 && t < WS[j + 1]) return lerp(TL[j].x1, TL[j + 1].x0, (t - WE[j]) / Math.max(1e-3, WS[j + 1] - WE[j]));
      }
      // past the last letter the torch lifts away to the right (and the clip uncovers its halo)
      return TL[nT - 1].x1 + (t - WE[nT - 1]) * vWeld * 1.5;
    }
    // The torch weaves up and down the letters as it goes.
    const weldY = (t) => L.titleY + TS * 0.26 * Math.sin(TAU * (t - W0) / 115);
    const bead = nT ? {
      x0: nY ? YL[nY - 1].cx : L.cx, y0: nY ? YL[nY - 1].top : L.titleY,
      x1: weldX(W0 - 100), y1: weldY(W0 - 100), apex: Math.max(TS * 1.2, H * 0.12)
    } : null;
    /** Where the bead is at t (sets AX, AY). */
    function beadAt(t) {
      const u = clamp((t - B0) / FLY, 0, 1);
      AX = lerp(bead.x0, bead.x1, u);
      AY = lerp(bead.y0, bead.y1, u) - bead.apex * 4 * u * (1 - u);
    }
    // The letters go out at the end, title first, left to right, then the year.
    const OUT = new Float64Array(glyphs.length);
    glyphs.forEach((g, k) => {
      OUT[k] = g.line === 0 ? T_OUT0 + (nT > 1 ? g.i / (nT - 1) : 0) * 650 : T_OUT0 + 450 + g.i * (nY > 1 ? 360 / (nY - 1) : 0);
    });
    // As a letter goes out its metal fades first and its last red glow a little after: it burns out.
    const outOf = (k, t) => 1 - smooth(OUT[k], OUT[k] + LETTER_OUT * 0.65, t);
    const lastGlow = (k, t) => 0.85 * Math.sin(Math.PI * clamp((t - OUT[k] + 80) / (LETTER_OUT + 80), 0, 1));

    /* -- the thrusters: two exhaust paths crossing behind the words -- */

    // They cross behind the middle of the words (between the two lines), rising from the lower
    // corners and climbing away to the upper ones.
    const CX = L.cx;
    const CY = nY ? (L.titleY + L.yearY) / 2 : L.titleY;
    const AMP = Math.min(W, H * 1.78);
    const NP = 64;
    function makePath(dir, k1, k2) {
      const x = new Float32Array(NP + 1);
      const y = new Float32Array(NP + 1);
      for (let k = 0; k <= NP; k++) {
        const u = k / NP;
        const d = u - 0.5;
        const px = lerp(-0.1 * W, 1.1 * W, u);
        x[k] = dir > 0 ? px : W - px;
        y[k] = CY - d * k1 * AMP - (d > 0 ? d * d * k2 * AMP : -d * d * 0.12 * AMP);
      }
      return { x: x, y: y, ph: rnd() * TAU };
    }
    const paths = [makePath(1, 0.26, 0.55), makePath(-1, 0.21, 0.66)];
    let AX = 0;
    let AY = 0;
    function pathAt(p, u) {
      const f = clamp(u, 0, 1) * NP;
      const k = Math.min(NP - 1, Math.floor(f));
      const r = f - k;
      AX = p.x[k] + (p.x[k + 1] - p.x[k]) * r;
      AY = p.y[k] + (p.y[k + 1] - p.y[k]) * r;
    }
    const headU = (t) => (t - T_IN) / (T_OUT - T_IN);

    // Where each slug dives from: high above its digit, from alternate sides.
    const slugs = YL.map((g, i) => ({ x: g.cx + (i % 2 ? 1 : -1) * YS * (0.55 + rnd() * 0.3), y: g.cy - Math.min(YS * 2.5, H * 0.52) }));

    /* -- sparks: every one laid out now, drawn from t alone -- */

    const sp = { tb: [], x: [], y: [], vx: [], vy: [], k: [], g: [], life: [], w: [], hot: [] };
    function spark(tb, x, y, vx, vy, life, drag, grav, w, hot) {
      sp.tb.push(tb); sp.x.push(x); sp.y.push(y); sp.vx.push(vx); sp.vy.push(vy);
      sp.k.push(drag); sp.g.push(grav); sp.life.push(life); sp.w.push(w); sp.hot.push(hot);
    }
    // shed by the thrusters' heads
    for (const p of paths) {
      for (let m = 0; m < 50; m++) {
        const tb = (T_IN + (m + rnd()) / 50 * (T_OUT - T_IN)) / 1000;
        if (tb < 0) { rnd(); rnd(); rnd(); rnd(); continue; }
        const u = headU(tb * 1000);
        pathAt(p, u + 0.01);
        const ax = AX;
        const ay = AY;
        pathAt(p, u);
        const dx = ax - AX;
        const dy = ay - AY;
        const len = Math.hypot(dx, dy) || 1;
        const back = (120 + rnd() * 260) * S;
        const side = (rnd() - 0.5) * 300 * S;
        spark(tb, AX, AY, -dx / len * back - dy / len * side, -dy / len * back + dx / len * side, 0.25 + rnd() * 0.4, 2.2, 900 * S,
          (1.2 + rnd() * 0.8) * S, 0.75 + rnd() * 0.25);
      }
    }
    // the crossing
    for (let m = 0; m < 64; m++) {
      const a = rnd() * TAU;
      const v = (250 + Math.sqrt(rnd()) * 650) * S;
      spark(T_CROSS / 1000, CX, CY, Math.cos(a) * v, Math.sin(a) * v * 0.7, 0.4 + rnd() * 0.6, 1.8, 1100 * S, (1.4 + rnd()) * S, 0.85 + rnd() * 0.15);
    }
    // each strike: a fan thrown up off the digit, and a few skidding along the ground
    YL.forEach((g, i) => {
      const tb = HIT[i] / 1000;
      for (let m = 0; m < 64; m++) {
        const a = -Math.PI / 2 + (rnd() - 0.5) * 2.8;
        const big = rnd() < 0.15;
        const v = (big ? 260 + rnd() * 380 : 340 + rnd() * 820) * S * Math.sqrt(YS / 214);
        spark(tb, lerp(g.x0, g.x1, rnd()), g.bottom - rnd() * (g.bottom - g.top) * 0.45, Math.cos(a) * v, Math.sin(a) * v,
          big ? 0.9 + rnd() * 0.6 : 0.45 + rnd() * 0.7, big ? 1.0 : 1.5, 1800 * S, (big ? 2.6 : 1.4 + rnd() * 0.9) * S, 0.9 + rnd() * 0.1);
      }
      for (let m = 0; m < 16; m++) {
        const dir = rnd() < 0.5 ? -1 : 1;
        const v = (350 + rnd() * 500) * S;
        spark(tb, g.cx + dir * (g.x1 - g.x0) * 0.4, g.bottom, dir * v, -(40 + rnd() * 140) * S, 0.35 + rnd() * 0.4, 2.4, 1500 * S,
          (1.2 + rnd() * 0.8) * S, 0.8 + rnd() * 0.2);
      }
    });
    // the bead sheds a few drops as it flies
    if (bead) {
      for (let m = 0; m < 14; m++) {
        const tms = B0 + (m + rnd()) / 14 * FLY;
        beadAt(tms);
        spark(tms / 1000, AX, AY, (rnd() - 0.5) * 160 * S, (rnd() - 0.2) * 160 * S, 0.3 + rnd() * 0.35, 1.8, 1500 * S, 1.3 * S, 1);
      }
    }
    // the torch: lit with a pop, then a steady spray falling from it, and a pop as each letter is done
    if (nT) {
      const x0 = weldX(W0 - 100);
      const y0 = weldY(W0 - 100);
      for (let m = 0; m < 18; m++) {
        const a = rnd() * TAU;
        const v = (200 + rnd() * 420) * S;
        spark((W0 - 100) / 1000, x0, y0, Math.cos(a) * v, Math.sin(a) * v, 0.3 + rnd() * 0.4, 1.6, 1600 * S, (1.2 + rnd() * 0.8) * S, 1);
      }
      const n = Math.round((W1 - W0) * 0.38);                 // 380 a second
      for (let m = 0; m < n; m++) {
        const tms = W0 + (m + rnd()) / n * (W1 - W0);
        const big = rnd() < 0.12;
        const v = big ? 0.6 : 1;
        spark(tms / 1000, weldX(tms) + (rnd() - 0.5) * TS * 0.06, weldY(tms), (rnd() - 0.5) * 2 * 330 * S * v, (-0.55 + rnd() * 1.3) * 400 * S * v,
          big ? 0.7 + rnd() * 0.5 : 0.3 + rnd() * 0.55, big ? 0.9 : 1.3, 2000 * S, (big ? 2.2 : 1.2 + rnd() * 0.7) * S, 0.85 + rnd() * 0.15);
      }
      TL.forEach((g, j) => {
        for (let m = 0; m < 5; m++) {
          const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
          const v = (180 + rnd() * 280) * S;
          spark(WE[j] / 1000, g.x1, weldY(WE[j]), Math.cos(a) * v, Math.sin(a) * v, 0.3 + rnd() * 0.3, 1.6, 1700 * S, 1.3 * S, 1);
        }
      });
    }
    const NS = sp.tb.length;
    const S_TB = Float32Array.from(sp.tb);
    const S_X = Float32Array.from(sp.x);
    const S_Y = Float32Array.from(sp.y);
    const S_VX = Float32Array.from(sp.vx);
    const S_VY = Float32Array.from(sp.vy);
    const S_K = Float32Array.from(sp.k);
    const S_G = Float32Array.from(sp.g);
    const S_LIFE = Float32Array.from(sp.life);
    const S_W = Float32Array.from(sp.w);
    const S_HOT = Float32Array.from(sp.hot);
    let PX = 0;
    let PY = 0;
    /** Where spark i is `a` seconds after it was thrown: slowed by the air, falling. */
    function sparkAt(i, a) {
      const k = S_K[i];
      const e = (1 - Math.exp(-k * a)) / k;
      PX = S_X[i] + S_VX[i] * e;
      PY = S_Y[i] + S_VY[i] * e + S_G[i] * (a - e) / k;
    }

    /* -- embers: drifting up from the letters while they hold, and carrying them off at the end -- */

    const wp = env.wordPoints(900);
    const pts = wp && wp.pts ? wp.pts : new Float32Array(0);
    const NPTS = pts.length >> 1;
    // the points on each letter
    const onLetter = glyphs.map((g) => {
      const list = [];
      const pad = g.size * 0.08;
      for (let q = 0; q < NPTS; q++) {
        const x = pts[q * 2];
        const y = pts[q * 2 + 1];
        if (x >= g.x0 - pad && x <= g.x1 + pad && y >= g.top - g.size * 0.3 && y <= g.bottom + g.size * 0.3) list.push(q);
      }
      return list;
    });
    function letterPoint(k) {
      const list = onLetter[k];
      const g = glyphs[k];
      if (!list.length) return [lerp(g.x0, g.x1, rnd()), lerp(g.top, g.bottom, rnd())];
      const q = list[Math.floor(rnd() * list.length) % list.length];
      return [pts[q * 2], pts[q * 2 + 1]];
    }
    const em = { tb: [], x: [], y: [], vx: [], rise: [], acc: [], sway: [], ph: [], fr: [], life: [], size: [], col: [] };
    function ember(tb, xy, vx, rise, acc, life, size) {
      em.tb.push(tb); em.x.push(xy[0]); em.y.push(xy[1]); em.vx.push(vx); em.rise.push(rise); em.acc.push(acc);
      em.sway.push((4 + rnd() * 12) * S); em.ph.push(rnd() * TAU); em.fr.push(1.2 + rnd() * 1.6);
      em.life.push(life); em.size.push(size); em.col.push(Math.floor(rnd() * EMBER_COLS.length) % EMBER_COLS.length);
    }
    if (glyphs.length) {
      // off the hot letters while they hold ...
      const first = W1 / 1000 - 0.2;
      const last = T_OUT0 / 1000 - 0.2;
      for (let m = 0; m < 120; m++) {
        const tb = first + (m + rnd()) / 120 * (last - first);
        const k = Math.floor(rnd() * glyphs.length) % glyphs.length;
        const life = Math.min(1.8 + rnd() * 1.6, 12.4 - tb);
        ember(tb, letterPoint(k), (rnd() - 0.3) * 22 * S, (30 + rnd() * 50) * S, (10 + rnd() * 25) * S, life, Math.max(1.2, (1.8 + rnd() * 1.6) * S));
      }
      // ... up from the forge below the frame ...
      for (let m = 0; m < 36; m++) {
        const tb = 0.8 + (m + rnd()) / 36 * (last - 2.4);
        const life = Math.min(2.8 + rnd() * 2, 12.4 - tb);
        ember(tb, [lerp(minX - TS, maxX + TS, rnd()), H + 8 * S], (rnd() - 0.4) * 30 * S, (70 + rnd() * 90) * S, (8 + rnd() * 16) * S, life, Math.max(1, (1.4 + rnd() * 1.4) * S));
      }
      // ... and carrying every letter off as it goes out
      glyphs.forEach((g, k) => {
        for (let m = 0; m < 16; m++) {
          const tb = OUT[k] / 1000 - 0.05 + rnd() * 0.45;
          const life = Math.min(0.8 + rnd() * 0.6, 12.45 - tb);
          ember(tb, letterPoint(k), (10 + rnd() * 50) * S, (50 + rnd() * 80) * S, 40 * S, life, Math.max(1.2, (2 + rnd() * 1.6) * S));
        }
      });
    }
    const NE = em.tb.length;
    const E_TB = Float32Array.from(em.tb);
    const E_X = Float32Array.from(em.x);
    const E_Y = Float32Array.from(em.y);
    const E_VX = Float32Array.from(em.vx);
    const E_RISE = Float32Array.from(em.rise);
    const E_ACC = Float32Array.from(em.acc);
    const E_SW = Float32Array.from(em.sway);
    const E_PH = Float32Array.from(em.ph);
    const E_FR = Float32Array.from(em.fr);
    const E_LIFE = Float32Array.from(em.life);
    const E_SZ = Float32Array.from(em.size);
    const E_COL = Uint8Array.from(em.col);

    /* -------------------------------------------------- drawing --- */

    let count = 0;
    const TF = { op: 'source-over', dx: 0, dy: 0, sx: undefined, sy: undefined, crop: undefined };
    const headPic = still(260 * S * dpr, HEAD_STOPS);           // a thruster's head
    const slugPic = still(YS * 0.95 * dpr, HEAD_STOPS);         // a slug
    const torchPic = still(TS * 3 * dpr, HEAD_STOPS);           // the torch
    const hitPic = still(YS * 2.4 * dpr, FLASH_STOPS);          // a strike's flash
    const crossPic = still(560 * S * dpr, FLASH_STOPS);         // the crossing's flash
    const stills = [headPic, slugPic, torchPic, hitPic, crossPic];

    /** A still at its own size, on whole device pixels. */
    function stamp(pic, x, y, a) {
      if (a <= 0.004) return;
      const w = pic.width / dpr;
      const h = pic.height / dpr;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(pic, Math.round((x - w / 2) * dpr) / dpr, Math.round((y - h / 2) * dpr) / dpr, w, h);
      count++;
    }

    function blit(pic, x, y, d, a) {
      if (a <= 0.004 || d < 0.5) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(pic, x - d / 2, y - d / 2, d, d);
      count++;
    }

    function blitWH(pic, x, y, w, h, a) {
      if (a <= 0.004 || w < 0.5) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(pic, x - w / 2, y - h / 2, w, h);
      count++;
    }

    /**
     * One letter: `fill` at `a`, moved by (dx, dy), scaled by (sx, sy) about its middle. A letter that
     * is not scaled is moved by whole device pixels only, so fx.js copies its picture 1:1 (a copy
     * that has to be resampled costs several times as much).
     */
    function letter(g, a, fill, op, dx, dy, sx, sy, crop) {
      if (a <= 0.004) return;
      const scaled = Math.abs(sx - 1) > 0.003 || Math.abs(sy - 1) > 0.003;
      TF.op = op;
      TF.dx = scaled ? dx : Math.round(dx * dpr) / dpr;
      TF.dy = scaled ? dy : Math.round(dy * dpr) / dpr;
      TF.sx = scaled ? sx : undefined;
      TF.sy = scaled ? sy : undefined;
      TF.crop = crop;
      env.glyph(g, a, fill, TF);
      count++;
    }

    /**
     * A glow over a letter ('lighter'), in bands nudged sideways by a little each: the heat shimmers.
     * Added light sums exactly, so the bands meet without a seam.
     */
    function glow(g, a, fill, amp, t, dx, dy, sx, sy, lo) {
      if (a <= 0.012) return;
      if (lo || amp < 0.4) { letter(g, a, fill, 'lighter', dx, dy, sx, sy, undefined); return; }
      for (let s = 0; s < STRIPS; s++) {
        const w = amp * Math.sin(t * 0.0093 + s * 1.9 + g.cx * 0.031) * Math.sin(t * 0.0047 + s * 0.7 + g.i);
        letter(g, a, fill, 'lighter', dx + w, dy, sx, sy, CROPS[s]);
      }
    }

    /** A picture laid along the line from (x0, y0) to (x1, y1), `w` thick: its right end at (x1, y1). */
    function beam(pic, x0, y0, x1, y1, w, a) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (a <= 0.004 || len < 1) return;
      ctx.save();
      ctx.translate(x0, y0);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(pic, 0, -w / 2, len, w);
      ctx.restore();
      count++;
    }

    /* the thrusters */

    const QX = new Float32Array(NP + 2);
    const QY = new Float32Array(NP + 2);
    const QA = new Float32Array(NP + 2);
    const TRAIL_COLS = [RED, '#ff9a36', '#fff4d6'];

    function drawThrusters(t, lo) {
      if (t > 1900) return;
      const hu = headU(t);
      if (hu <= 0) return;
      const span = T_OUT - T_IN;
      const last = Math.min(NP, Math.floor(hu * NP));
      ctx.lineJoin = 'bevel';
      for (const p of paths) {
        // the samples the head has passed, aged: the exhaust rises, spreads and wavers as it cools
        let m = 0;
        for (let k = 0; k <= last + 1; k++) {
          let x;
          let y;
          let age;
          if (k <= last) { x = p.x[k]; y = p.y[k]; age = (t - (T_IN + span * k / NP)) / 1000; }
          else if (hu < 1) { pathAt(p, hu); x = AX; y = AY; age = 0; }
          else break;
          if (age > 1.15) continue;
          QX[m] = x + Math.cos(k * 0.43 + t * 0.0031 + p.ph) * 12 * age * S;
          QY[m] = y - age * (34 + 30 * age) * S + Math.sin(k * 0.61 + t * 0.0043 + p.ph) * 16 * age * S;
          QA[m] = age;
          m++;
        }
        if (m >= 2) {
          // three layers, a few segments at a time: wide red smoke, the gold body, the white-hot core
          for (let layer = lo ? 1 : 0; layer < 3; layer++) {
            ctx.strokeStyle = TRAIL_COLS[layer];
            for (let c = 0; c < m - 1; c += 8) {
              const e = Math.min(m - 1, c + 8);
              const age = (QA[c] + QA[e]) / 2;
              const hot = Math.exp(-age / 0.16);
              const smoke = Math.exp(-age / 0.3);
              let a;
              let w;
              if (layer === 0) { a = 0.26 * smoke; w = (10 + 24 * age) * S; }
              else if (layer === 1) { a = 0.8 * hot + 0.12 * smoke; w = (4 + 9 * age) * S; }
              else { a = hot * hot; w = 2.4 * S; }
              if (a < 0.015) continue;
              ctx.globalAlpha = a;
              ctx.lineWidth = Math.max(1, w);
              ctx.beginPath();
              ctx.moveTo(QX[c], QY[c]);
              for (let k = c + 1; k <= e; k++) ctx.lineTo(QX[k], QY[k]);
              ctx.stroke();
              count++;
            }
          }
        }
        // the head: a white-hot flame with its plume streaming back along the path
        if (hu < 1.03) {
          pathAt(p, Math.min(1, hu) - 0.1);
          const bx = AX;
          const by = AY;
          pathAt(p, Math.min(1, hu));
          const hx = AX;
          const hy = AY;
          if (hx > -160 * S && hx < W + 160 * S) {
            beam(tex.tail, bx, by, hx, hy, 52 * S, 1);
            stamp(headPic, hx, hy, 1);
            if (!lo) blitWH(tex.flare, hx, hy, 380 * S, 24 * S, 0.8);
          }
        }
      }
    }

    // The rays of light a strike or the crossing throws out (angles, lengths), made now.
    const rays = (n, up) => Array.from({ length: n }, (_, i) => ({
      a: up ? -Math.PI / 2 + ((i + rnd()) / n - 0.5) * 2.9 : (i + rnd()) / n * TAU,
      l: 0.55 + rnd() * 0.75
    }));
    const crossRays = rays(10, false);
    const hitRays = YL.map(() => rays(8, true));

    /** Rays bursting out of (x, y): `len` long, bright at the middle. */
    function drawRays(list, x, y, len, w, a) {
      if (a <= 0.01) return;
      for (const r of list) beam(tex.tail, x + Math.cos(r.a) * len * r.l, y + Math.sin(r.a) * len * r.l, x, y, w, a);
    }

    /** The heads cross: a burst of light behind the words. */
    function drawCrossing(t, lo) {
      const tau = (t - T_CROSS) / 1000;
      if (tau < -0.06 || tau > 0.62) return;
      const on = smooth(-0.06, 0, tau);
      const a1 = tau < 0 ? on * 0.5 : Math.exp(-tau / 0.12);
      stamp(crossPic, CX, CY, on * Math.exp(-Math.max(0, tau) / 0.18));
      if (tau < 0.3) blit(tex.white, CX, CY, (150 + 360 * Math.max(0, tau)) * S, a1);
      blitWH(tex.flare, CX, CY, 1400 * S, 36 * S, 0.9 * a1);
      if (tau > 0 && tau < 0.2 && !lo) drawRays(crossRays, CX, CY, (160 + 820 * easeOut(tau / 0.2)) * S, 13 * S, 0.8 * (1 - tau / 0.2));
    }

    /** The slugs diving onto the digits, and what each strike throws off. */
    function drawStrikes(t, lo) {
      for (let i = 0; i < nY; i++) {
        const tau = t - HIT[i];
        if (tau < -SLUG || tau > 480) continue;
        const g = YL[i];
        if (tau < 0) {
          // the slug: a molten bolt accelerating down its line, its fire streaming behind it
          const q = (tau + SLUG) / SLUG;
          const k = Math.pow(q, 1.8);
          const hx = lerp(slugs[i].x, g.cx, k);
          const hy = lerp(slugs[i].y, g.cy, k);
          const k0 = Math.pow(Math.max(0, q - 0.4), 1.8);
          const vis = smooth(0, 0.3, q);
          beam(tex.tail, lerp(slugs[i].x, g.cx, k0), lerp(slugs[i].y, g.cy, k0), hx, hy, YS * 0.34, vis);
          stamp(slugPic, hx, hy, vis);
          continue;
        }
        // the strike: a white flash, rays, a lens streak and a shock ring rolling out on the ground
        stamp(hitPic, g.cx, g.cy, Math.exp(-tau / 150));
        if (tau < 140) blit(tex.white, g.cx, g.cy, YS * (0.9 + 0.5 * tau / 140), 1 - tau / 140);
        if (tau < 420) blitWH(tex.flare, g.cx, g.cy + YS * 0.08, YS * 5.5, YS * 0.18, 0.9 * Math.exp(-tau / 130));
        if (tau < 150 && !lo) drawRays(hitRays[i], g.cx, g.cy, YS * (0.6 + 1.1 * easeOut(tau / 150)), YS * 0.085, 0.9 * (1 - tau / 150));
        if (tau < 280) {
          const u = tau / 280;
          const rx = (g.x1 - g.x0) * (0.55 + 1.25 * easeOut(u));
          ctx.strokeStyle = GOLD;
          for (const ly of [[9, 0.3], [3, 0.9]]) {
            ctx.globalAlpha = ly[1] * (1 - u) * (1 - u);
            ctx.lineWidth = Math.max(1, ly[0] * S * (1 - 0.5 * u));
            ctx.beginPath();
            ctx.ellipse(g.cx, g.bottom + YS * 0.03, rx, rx * 0.16, 0, 0, TAU);
            ctx.stroke();
            count++;
          }
        }
      }
    }

    /** The row of digits jolts at every strike. */
    function joltAt(t) {
      let dy = 0;
      for (let i = 0; i < nY; i++) {
        const tau = t - HIT[i];
        if (tau >= 0 && tau < 420) dy += YS * 0.04 * Math.exp(-tau / 70) * Math.cos(TAU * tau / 130);
      }
      return dy;
    }

    /** The red heat in the metal after forging, dying away as it cools. */
    function heatOf(tau) {
      return smooth(0, 120, tau) * 0.95 * Math.exp(-Math.max(0, tau - 180) / 600);
    }

    // While the words hold, a wave of heat runs through them now and then, left to right, and the
    // letters it passes glow red and shimmer.
    const spanX = Math.max(1, maxX - minX);
    function waveOf(g, t) {
      let h = 0;
      for (const w0 of WAVES) {
        const u = (t - w0) / 1700;
        if (u <= -0.3 || u >= 1.3) continue;
        const d = ((g.cx - minX) / spanX - u) / 0.16;
        h += 0.5 * Math.exp(-d * d);
      }
      return h;
    }

    /** The year: each digit struck into being white-hot, squashed by the blow, then cooling. */
    function drawYear(t, lo, cool) {
      if (!nY) return;
      const jolt = joltAt(t);
      for (let i = 0; i < nY; i++) {
        const g = YL[i];
        const tau = t - HIT[i];
        if (tau < 0) continue;
        const k = nT + i;
        const out = outOf(k, t);
        const end = lastGlow(k, t);
        if (out <= 0.004 && end <= 0.004) continue;
        const grow = 0.2 * (1 - easeOut(clamp(tau / 90, 0, 1)));
        const sq = Math.exp(-tau / 70) * Math.cos(TAU * tau / 220);
        const sx = (1 + grow) * (1 + 0.12 * sq);
        const sy = (1 + grow) * (1 - 0.14 * sq);
        const dy = jolt + (1 - sy) * (g.bottom - g.cy) - g.size * 0.06 * (1 - out);
        letter(g, smooth(15, 70, tau) * out, GOLDF, 'source-over', 0, dy, sx, sy, undefined);
        if (cool > 0.004) letter(g, cool * out, BRONZEF, 'source-over', 0, dy, sx, sy, undefined);
        // the heat: under the white of the strike, then shimmering as it cools, then a quiet glow
        const hot = tau < 130 ? 1 : Math.exp(-(tau - 130) / 300);
        const wave = waveOf(g, t);
        const amp = S * (wave * 4 + (tau < 1800 ? 2.6 * Math.exp(-tau / 700) : 0));
        glow(g, Math.max((heatOf(tau) + wave) * (1 - cool) * out, end) * (1 - 0.85 * hot), HEAT, amp, t, 0, dy, sx, sy, lo);
        letter(g, hot * out, HOT, 'lighter', 0, dy, sx, sy, undefined);
      }
    }

    /**
     * The title: welded on behind the torch as it passes, white-hot, cooling to polished gold. The
     * letters are drawn first in the frame, whole, and what lies ahead of the weld is wiped off again
     * with a soft edge just behind the torch, so no letter or halo is ever cut by a straight line.
     */
    function drawTitle(t, lo, cool) {
      if (!nT || t < W0 - 100) return;
      const welding = t < W1 + 90;
      const feather = TS * FEATHER;
      const front = welding ? weldX(t) + feather * 0.3 : Infinity;
      let reach = -Infinity;                                  // the right edge of what is drawn
      for (let j = 0; j < nT; j++) {
        const g = TL[j];
        if (g.x0 - g.size * 0.8 >= front) break;              // the weld has not reached its halo yet
        const tau = t - WS[j];
        const out = outOf(j, t);
        const end = lastGlow(j, t);
        if (out <= 0.004 && end <= 0.004) continue;
        reach = g.x1 + g.size * 1.2;
        const dy = -g.size * 0.06 * (1 - out);
        letter(g, out, GOLDF, 'source-over', 0, dy, 1, 1, undefined);
        if (cool > 0.004) letter(g, cool * out, BRONZEF, 'source-over', 0, dy, 1, 1, undefined);
        const done = WE[j] - WS[j] + 60;
        const hot = tau < done ? 1 : Math.exp(-(tau - done) / 280);
        const wave = waveOf(g, t);
        const amp = S * (wave * 3.2 + (tau < 1800 ? 2.2 * Math.exp(-tau / 700) : 0));
        glow(g, Math.max((heatOf(tau) + wave) * (1 - cool) * out, end) * (1 - 0.85 * hot), HEAT, amp, t, 0, dy, 1, 1, lo);
        letter(g, hot * out, HOT, 'lighter', 0, dy, 1, 1, undefined);
      }
      if (reach > front - feather) {
        // ahead of the weld: wiped off, fading in over `feather` behind the torch
        const gr = ctx.createLinearGradient(front - feather, 0, front, 0);
        for (const s of WIPE) gr.addColorStop(s[0], s[1]);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.fillStyle = gr;
        ctx.fillRect(front - feather, L.titleY - TS * 1.8, reach - front + feather, TS * 3.6);
        ctx.globalCompositeOperation = 'source-over';
        count++;
      }
    }

    /** The bead flying to the start of the title, then the torch: a flickering white point and its glare. */
    function drawTorch(t, lo) {
      if (bead && t > B0 && t < B1 + 20) {
        beadAt(t - 45);
        const bx = AX;
        const by = AY;
        beadAt(t);
        const vis = smooth(B0, B0 + 50, t);
        beam(tex.tail, bx, by, AX, AY, TS * 0.32, vis);
        stamp(slugPic, AX, AY, 0.8 * vis);
      }
      if (!nT || t < W0 - 100 || t > W1 + 180) return;
      const on = smooth(W0 - 100, W0 - 50, t) * (1 - smooth(W1 + 30, W1 + 180, t));
      const x = weldX(t);
      const y = weldY(t);
      const fl = 0.78 + 0.22 * Math.sin(t * 0.083) * Math.sin(t * 0.051 + 1.3);
      // the pop as it lights
      const pop = 1 - clamp((t - (W0 - 100)) / 200, 0, 1);
      if (pop > 0 && pop < 1) blit(tex.white, x, y, TS * 2.2, pop);
      stamp(torchPic, x, y, on * fl);
      blit(tex.white, x, y, TS * 0.7, on);
      if (!lo) blitWH(tex.flare, x, y, TS * 5, TS * 0.2, 0.85 * on * fl);
    }

    const maskKey = W + 'x' + H + '@' + dpr + '|' + L.title + '|' + L.year;
    /**
     * The mask of the letters for the sheen: every letter drawn in white (no halo) with env.glyph
     * onto the canvas, copied off into a picture of its own, and the canvas cleared again. Only
     * called while the canvas is empty: from prime(), or at the start of a frame.
     */
    function buildMask() {
      const cv = ctx.canvas;
      const x0 = clamp(Math.floor((minX - TS * 0.5) * dpr), 0, cv.width);
      const x1 = clamp(Math.ceil((maxX + TS * 0.5) * dpr), 0, cv.width);
      const y0 = clamp(Math.floor((L.top - TS * 0.5) * dpr), 0, cv.height);
      const y1 = clamp(Math.ceil((L.bottom + TS * 0.5) * dpr), 0, cv.height);
      const c = canvas(x1 - x0, y1 - y0);
      const buf = canvas(x1 - x0, y1 - y0);
      ctx.save();
      try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        for (const g of glyphs) env.glyph(g, 1, SHEEN);
        c.getContext('2d').drawImage(cv, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
      } finally {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.restore();
      }
      MASK = { key: maskKey, x: x0, y: y0, c: c, buf: buf, g: buf.getContext('2d') };
    }

    /** A band of polished light sweeping across the metal, glinting at the letters' corners. */
    function drawSheen(t, cool) {
      for (const s0 of SHEENS) {
        const u = (t - s0) / SHEEN_DUR;
        if (u <= 0 || u >= 1) continue;
        const e = easeInOut(u);
        const top = L.top - TS * 0.2;
        const bot = L.bottom + TS * 0.2;
        const slant = (bot - top) * 0.36;
        const bw = Math.max(14, (maxX - minX) * 0.075);
        const bx = lerp(minX - bw - slant, maxX + bw + slant, e);
        // the band: light rising smoothly across it to a hot line in the middle, kept to the
        // letters by their mask (made in a buffer of its own, then added to the frame)
        const m = MASK;
        if (m && m.key === maskKey) {
          const sx = clamp(Math.floor((bx - bw - slant) * dpr) - m.x, 0, m.c.width);
          const ex = clamp(Math.ceil((bx + bw + slant) * dpr) - m.x, 0, m.c.width);
          if (ex - sx >= 1) {
            const dyl = bot - top;
            const len = Math.sqrt(4 * slant * slant + dyl * dyl);
            const r = bw * dyl / len;                              // the band's half-width across it
            const nx = dyl / len * r * dpr;
            const ny = 2 * slant / len * r * dpr;
            const mx = bx * dpr - m.x;
            const my = (top + bot) / 2 * dpr - m.y;
            const gr = m.g.createLinearGradient(mx - nx, my - ny, mx + nx, my + ny);
            for (const s of SHEEN_PROFILE) {
              const col = 'rgba(255,251,238,' + s[1] + ')';
              gr.addColorStop(0.5 - s[0] / 2, col);
              if (s[0] > 0) gr.addColorStop(0.5 + s[0] / 2, col);
            }
            const b = m.g;
            b.save();
            b.beginPath();
            b.rect(sx, 0, ex - sx, m.c.height);
            b.clip();
            b.globalCompositeOperation = 'copy';
            b.drawImage(m.c, 0, 0);
            b.globalCompositeOperation = 'source-in';
            b.fillStyle = gr;
            b.fillRect(sx, 0, ex - sx, m.c.height);
            b.restore();
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 1 - cool;
            ctx.drawImage(m.buf, sx, 0, ex - sx, m.c.height, m.x + sx, m.y, ex - sx, m.c.height);
            ctx.restore();
            count++;
          }
        }
        // glints where the band crosses the top corners of the letters
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let k = 0; k < glyphs.length; k++) {
          const g = glyphs[k];
          const yy = g.top + g.size * 0.04;
          const cxb = bx + slant * (1 - 2 * (yy - top) / (bot - top));
          for (const xx of [g.x0 + g.size * 0.05, g.x1 - g.size * 0.05]) {
            const d = (xx - cxb) / (bw * 0.35);
            const k2 = Math.exp(-d * d);
            if (k2 < 0.05) continue;
            blit(tex.star, xx, yy, g.size * 0.75 * k2, k2 * outOf(k, t));
          }
        }
        ctx.restore();
      }
    }

    /** All the sparks alive at t: streaks of their last moment, batched by colour. */
    const sparkPaths = new Array(NB * 2);
    function drawSparks(t, lo) {
      const tt = t / 1000;
      for (let b = 0; b < NB * 2; b++) sparkPaths[b] = null;
      let n = 0;
      for (let i = 0; i < NS; i += lo ? 2 : 1) {
        const a = tt - S_TB[i];
        if (a <= 0 || a >= S_LIFE[i]) continue;
        const f = a / S_LIFE[i];
        sparkAt(i, a);
        const x = PX;
        const y = PY;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
        sparkAt(i, a > STREAK ? a - STREAK : 0);
        const b = Math.min(NB - 1, Math.floor((1 - S_HOT[i] * (1 - f)) * NB));
        const key = S_W[i] > 1.8 * S ? b + NB : b;
        let p = sparkPaths[key];
        if (!p) p = sparkPaths[key] = new Path2D();
        p.moveTo(PX, PY);
        p.lineTo(x + (x === PX && y === PY ? 0.5 : 0), y);
        n++;
      }
      ctx.lineCap = 'round';
      for (let key = 0; key < NB * 2; key++) {
        const p = sparkPaths[key];
        if (!p) continue;
        const b = key % NB;
        ctx.strokeStyle = SPARK_COLS[b];
        ctx.globalAlpha = SPARK_ALPHA[b];
        ctx.lineWidth = Math.max(1, (key >= NB ? 2.4 : 1.5) * S * (1 - b * 0.08));
        ctx.stroke(p);
        count++;
      }
      ctx.lineCap = 'butt';
      return n;
    }

    function drawEmbers(t, lo) {
      const tt = t / 1000;
      let n = 0;
      for (let i = 0; i < NE; i += lo ? 2 : 1) {
        const a = tt - E_TB[i];
        if (a <= 0 || a >= E_LIFE[i]) continue;
        const f = a / E_LIFE[i];
        const x = E_X[i] + E_VX[i] * a + E_SW[i] * Math.sin(E_PH[i] + a * E_FR[i]);
        const y = E_Y[i] - E_RISE[i] * a - 0.5 * E_ACC[i] * a * a;
        const fl = 0.68 + 0.32 * Math.sin(E_PH[i] * 3 + a * 11);
        const al = smooth(0, 0.15, a) * (1 - smooth(0.5, 1, f)) * fl;
        if (al <= 0.01) continue;
        const s = E_SZ[i] * (1 - 0.35 * f);
        if (!lo) blit(emberPics[E_COL[i]], x, y, s * 8, al * 0.7);
        ctx.globalAlpha = al;
        ctx.fillStyle = EMBER_COLS[E_COL[i]];
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        n++;
      }
      count += n;
    }

    function draw(t) {
      count = 0;
      if (!(t >= 0) || t >= GONE_AT || !glyphs.length) return 0;
      // The sheen's mask: prime() makes it; after a change of size it is made here, while the
      // canvas is still empty (fx.js clears it before every frame).
      if (t >= SHEENS[0] - 400 && t < SHEENS[SHEENS.length - 1] + SHEEN_DUR && (!MASK || MASK.key !== maskKey)) buildMask();
      const lo = env.low();
      const cool = 0.55 * smooth(T_COOL0, T_COOL1, t);
      ctx.save();
      // the title first, on the empty canvas: what the weld has not reached is wiped off again
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      drawTitle(t, lo, cool);
      // the thrusters and their crossing (gone before the title's middle is welded)
      ctx.globalCompositeOperation = 'lighter';
      drawThrusters(t, lo);
      drawCrossing(t, lo);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // the year, as far as it is struck, and the sheen on the metal
      drawYear(t, lo, cool);
      drawSheen(t, cool);
      // in front: the strikes, the torch, sparks and embers
      ctx.globalCompositeOperation = 'lighter';
      drawStrikes(t, lo);
      drawTorch(t, lo);
      drawSparks(t, lo);
      drawEmbers(t, lo);
      ctx.restore();
      return count;
    }

    return {
      step: function () { /* every frame is drawn from t alone */ },
      draw: draw,
      /**
       * Before midnight: every letter picture the animation uses (env.warm makes them), and each of
       * them and every texture drawn once into one pixel and cleared again, so the first frame at
       * midnight has nothing slow left to do.
       */
      prime: function () {
        const fills = [GOLDF, HOT, HEAT, SHEEN, BRONZEF];
        for (const f of fills) env.warm(f);
        if (!MASK || MASK.key !== maskKey) buildMask();      // the canvas is empty before midnight
        const px = Math.floor(L.cx * dpr);
        const py = Math.floor(L.titleY * dpr);
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          ctx.rect(px, py, 1, 1);
          ctx.clip();
          ctx.globalAlpha = 0.01;
          const pics = [tex.white, tex.flare, tex.star, tex.tail].concat(emberPics, stills, MASK ? [MASK.c, MASK.buf] : []);
          for (const pic of pics) ctx.drawImage(pic, px, py, 1, 1);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const firsts = [TL[0], YL[0]].filter(Boolean);
          for (const f of fills) {
            for (const g of firsts) env.glyph(g, 0.01, f, { dx: px / dpr + 0.5 / dpr - g.cx, dy: py / dpr + 0.5 / dpr - g.cy, scale: 0.01 });
          }
        } finally {
          ctx.restore();
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(px - 2, py - 2, 5, 5);
          ctx.restore();
        }
      }
    };
  }

  FX.register('hotrod', { name: 'Hot Rod', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
