/*!
 * Avengers Player: 'arc', the Arc Reactor celebration (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays: a reactor core ignites in the middle of the frame (a white-hot
 *             burst, a lens streak, a ring of light) and its segmented rings assemble round it,
 *             inside out, spinning up. Its ring of light runs out over the title: each letter is a
 *             tube that blinks once or twice as the ring passes it (0.1-0.6 s), but does not catch.
 *   0.7 s     the reactor rises into the space above the words and settles.
 *   1.4 s     the core flares; rays and a shockwave sweep out across the picture. As the wave
 *             reaches each letter of the title (the middle first) the tube strikes: two or three
 *             quick white-hot flickers, then it catches and settles into its colour.
 *   ~2.0 s    once the title has caught, energy pours down from the reactor into the year, one digit
 *             after another: each fills with cyan light from the bottom up and tops out with a small
 *             flash (the last at about 3.1 s).
 *   2-9 s     the rings spin, energy filaments race round them, current jumps between them, motes
 *             orbit the core, the core beats and a bar of light scans the words; a surge at 6.2 s.
 *   9.3 s     the rings spin down, flicker and break into drifting cyan sparks; the core collapses.
 *   10.5 s    the words lose their power: the digits drain from the top down, then the letters of
 *             the title flicker out one by one from the ends inwards.
 *   11-12.5 s everything fades out.
 *
 * Every frame is a function of the seed and t alone (nothing is simulated frame by frame), so
 * renderAt(t), a resize in the middle and the live animation all draw the same picture.
 */
(function (root) {
  'use strict';

  const APFx = root.APFx;
  if (!APFx || typeof APFx.register !== 'function') return;

  const DURATION = 12500;
  const FADE_FROM = DURATION - 1500;              // everything fades out from here
  const TAU = Math.PI * 2;
  // The words: white at the top to reactor cyan at the bottom, with a deep navy halo.
  const FILL = { stops: [[0, '#ffffff'], [0.5, '#e8fcff'], [1, '#93ebff']], halo: 'rgba(0,8,20,0.9)', stroke: { width: 0.024, stops: [[0, '#a6f5ff'], [1, '#1fb6f5']] } };
  // A tube striking: white-hot with a cyan bloom round it (added as light, never on its own).
  const HOT = { stops: [[0, '#ffffff'], [0.55, '#f6feff'], [1, '#c4f5ff']], halo: 'rgba(95,227,255,0.9)' };
  // A tube glowing without having caught (its blinks at ignition, its last glow going out): cyan
  // neon light, added on top.
  const GLOW = { stops: [[0, '#d8fbff'], [0.5, '#8cecff'], [1, '#4fd6ff']], halo: 'rgba(60,200,255,0.85)' };
  // A digit filling with the reactor's light: deeper cyan, laid over the digit in its colour (whose
  // dark halo it keeps, so it has none of its own: two halos on top of each other would darken
  // round the digit as it tops out).
  const CHARGE = { stops: [[0, '#9cefff'], [0.5, '#5fe3ff'], [1, '#22b8f5']], stroke: { width: 0.024, stops: [[0, '#a6f5ff'], [1, '#1fb6f5']] } };
  // The surface of the light in a digit: a white-hot line inside the strokes only. (No halo: a halo
  // cut into a thin band shows as a hard-edged slab wider than the digit. Its soft glow is drawn on
  // its own.) A fill without a halo is cut into smaller cells, so its crops are worked out apart.
  const SURF = { stops: [[0, '#ffffff'], [0.55, '#f6feff'], [1, '#c4f5ff']] };

  const T_YEAR0 = 1700;         // the earliest the energy starts pouring into the first digit
  const YEAR_GAP = 205;         // the next digit starts this much later (less for a long year)
  const POUR = 120;             // the stream takes this long to reach the digit
  const FILL_MS = 350;          // and the digit this long to fill
  const T_YEAR_OUT = 10450;     // the digits drain, the last one first
  const DRAIN_MS = 300;
  const T_TITLE_OUT = 10620;    // the letters of the title go out, from the ends inwards

  const T_RISE0 = 680;          // the reactor rises from the middle of the frame into place
  const T_RISE1 = 1320;
  const T_FLARE = 1400;         // the core flares and the shockwave leaves
  const SHOCK_DUR = 1500;
  const PULSES = [2800, 4400, 8000];             // the core's heartbeats
  const T_SURGE = 6200;         // a second beat in the middle: the reactor surges
  const SCANS = [3300, 6900, 9050];              // a bar of light scans the words
  const SCAN_DUR = 1250;
  const T_DOWN = 9300;          // spin-down
  const T_BREAK = 9750;         // the rings start breaking into sparks
  const T_CORE_OUT = 10950;     // the core collapses

  const WHITE = '#ffffff';
  const ICE = '#d2f9ff';
  const CYAN = '#5fe3ff';
  const GOLD = '#f6c453';
  // The reactor's soft light on everything round it, and the dark backing behind it.
  const HALO_STOPS = [[0, 'rgba(120,232,255,0.6)'], [0.22, 'rgba(70,200,255,0.34)'], [0.5, 'rgba(40,165,255,0.13)'],
    [0.78, 'rgba(30,150,255,0.035)'], [1, 'rgba(30,150,255,0)']];
  const SCRIM_STOPS = [[0, 'rgba(2,8,20,0.42)'], [0.55, 'rgba(2,8,20,0.3)'], [0.8, 'rgba(2,8,20,0.12)'], [1, 'rgba(2,8,20,0)']];

  /* ----------------------------------------------------- textures (once) --- */

  let TEX = null;
  // Pictures that depend on the size of the screen, kept between prime() and play() (play() lays the
  // style out again, and making them there would cost the first frame): the reactor's soft light and
  // its dark backing (a few, by size), and the ignition's flash over the frame (the last one only:
  // it is as big as the canvas).
  const STILLS = new Map();
  let FLASH = null;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function radial(g, x, y, r, stops) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    for (const s of stops) gr.addColorStop(s[0], s[1]);
    return gr;
  }

  /** Glows drawn once and stamped (kept for the life of the page: prime() makes them before it plays). */
  function textures() {
    if (TEX) return TEX;
    // The core: a white-hot centre inside a cyan bloom.
    const core = canvas(256, 256);
    let g = core.getContext('2d');
    g.fillStyle = radial(g, 128, 128, 128, [[0, 'rgba(255,255,255,1)'], [0.06, 'rgba(255,255,255,1)'], [0.12, 'rgba(214,250,255,0.92)'],
      [0.22, 'rgba(110,228,255,0.5)'], [0.4, 'rgba(50,185,255,0.18)'], [0.68, 'rgba(30,150,255,0.05)'], [1, 'rgba(30,150,255,0)']]);
    g.fillRect(0, 0, 256, 256);
    // A long horizontal lens streak (an anamorphic flare): a round glow squashed sixteen times.
    const streak = canvas(512, 32);
    g = streak.getContext('2d');
    g.setTransform(16, 0, 0, 1, 0, 0);
    g.fillStyle = radial(g, 16, 16, 16, [[0, 'rgba(240,253,255,1)'], [0.1, 'rgba(170,240,255,0.8)'], [0.35, 'rgba(80,200,255,0.25)'], [1, 'rgba(30,150,255,0)']]);
    g.fillRect(0, 0, 32, 32);
    // The same, standing up: the bar of light that scans the words.
    const bar = canvas(32, 256);
    g = bar.getContext('2d');
    g.setTransform(1, 0, 0, 8, 0, 0);
    g.fillStyle = radial(g, 16, 16, 16, [[0, 'rgba(225,251,255,0.9)'], [0.25, 'rgba(120,230,255,0.35)'], [1, 'rgba(30,150,255,0)']]);
    g.fillRect(0, 0, 32, 32);
    TEX = { core: core, streak: streak, bar: bar };
    return TEX;
  }

  /* -------------------------------------------------------------- style --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const rnd = env.rnd;
    const clamp = env.clamp;
    const lerp = env.lerp;
    const smooth = env.smooth;
    const easeOut = env.easeOut;
    const tex = textures();
    const glowIce = env.sprite(ICE);
    const glowCyan = env.sprite(CYAN);
    const glowGold = env.sprite(GOLD);
    const backOut = (u) => { const v = u - 1; return 1 + 2.70158 * v * v * v + 1.70158 * v * v; };

    // Where the reactor holds: centred in the space above the words. It is born bigger, in the
    // middle of the frame, and rises into place.
    const spaceTop = H * 0.045;
    const spaceBottom = Math.max(H * 0.3, L.top - H * 0.035);
    const HOLD_R = Math.max(24, Math.min(H * 0.21, (spaceBottom - spaceTop) * 0.46, W * 0.3));
    const HOLD_X = W / 2;
    const HOLD_Y = (spaceTop + spaceBottom) / 2;
    const START_R = Math.max(HOLD_R, Math.min(HOLD_R * 1.6, H * 0.36, W * 0.36));
    const START_Y = H * 0.47;
    const K_HOLD = Math.max(0.35, HOLD_R / 225);
    // Once the reactor holds still (from T_RISE1) its halo and its dark backing are always the same
    // picture: drawn once at their final size, a frame copies them 1:1 onto whole device pixels
    // (a stretched sprite or a big gradient costs several times as much on a software-rendered canvas).
    // While it rises, its backing is the picture at its starting size fading into the one at its final
    // size, both copied 1:1 too.
    const DPR = env.dpr || 1;
    function still(r, stops, name) {
      const px = Math.max(2, Math.ceil(r * 2 * DPR));
      const key = name + px;
      let c = STILLS.get(key);
      if (c) return c;
      c = canvas(px, px);
      const g = c.getContext('2d');
      g.fillStyle = radial(g, px / 2, px / 2, px / 2, stops);
      g.fillRect(0, 0, px, px);
      STILLS.set(key, c);
      if (STILLS.size > 9) STILLS.delete(STILLS.keys().next().value);
      return c;
    }
    const haloPic = still(HOLD_R * 1.25, HALO_STOPS, 'halo');
    const scrimPic = still(HOLD_R * 1.32, SCRIM_STOPS, 'scrim');
    const scrimBorn = still(START_R * 1.32, SCRIM_STOPS, 'scrim');
    // The flash over the frame at ignition, round the core where it is born: the same picture every
    // frame but for its strength, so it is drawn once (a gradient over the whole frame each frame
    // costs most of a frame on a software-rendered canvas).
    const flashPic = (function () {
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const key = cw + 'x' + ch + '@' + DPR + ':' + HOLD_X + ',' + START_Y;
      if (FLASH && FLASH.key === key) return FLASH.pic;
      const c = canvas(cw, ch);
      const g = c.getContext('2d');
      g.fillStyle = radial(g, HOLD_X * DPR, START_Y * DPR, Math.max(W, H) * 0.75 * DPR,
        [[0, 'rgba(200,247,255,1)'], [0.25, 'rgba(80,200,255,0.5)'], [1, 'rgba(30,140,255,0)']]);
      g.fillRect(0, 0, cw, ch);
      FLASH = { key: key, pic: c };
      return c;
    })();

    // The pose of this frame (set by pose(t)): centre, radius, and the scale of lines and specks.
    let X = HOLD_X;
    let Y = HOLD_Y;
    let RR = HOLD_R;
    let KK = K_HOLD;
    function pose(t) {
      const u = smooth(T_RISE0, T_RISE1, t);
      X = HOLD_X;
      Y = lerp(START_Y, HOLD_Y, u);
      RR = lerp(START_R, HOLD_R, u);
      KK = Math.max(0.35, RR / 225);
    }
    const lw = (px) => Math.max(1, px * KK);

    // A table of seeded noise for flicker and twinkle (the frame for t never depends on the past).
    const NOISE = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) NOISE[i] = rnd();
    const noise = (a, b) => NOISE[(Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & 1023];

    /* ------------------------------------------------------------- spin --- */

    // How fast the reactor turns (1 = cruising): spins up, overspeeds at the flare, surges, spins down.
    function spinAt(t) {
      const up = 0.55 * smooth(0, 500, t) + 0.45 * smooth(500, 1400, t);
      const over = 1.1 * smooth(T_FLARE - 120, T_FLARE + 200, t) * (1 - smooth(T_FLARE + 450, T_FLARE + 2000, t));
      const surge = 0.9 * smooth(T_SURGE - 150, T_SURGE + 100, t) * (1 - smooth(T_SURGE + 300, T_SURGE + 1500, t));
      const down = 1 - 0.85 * smooth(T_DOWN, T_DOWN + 1500, t);
      return (up + over + surge) * down;
    }
    // Its integral, tabulated: how far a ring turning at speed 1 has turned by t.
    const STEP = 10;
    const NA = Math.ceil((DURATION + 200) / STEP) + 2;
    const turned = new Float64Array(NA);
    for (let i = 1; i < NA; i++) turned[i] = turned[i - 1] + spinAt((i - 0.5) * STEP) * STEP / 1000;
    function spun(t) {
      const x = clamp(t / STEP, 0, NA - 1.001);
      const i = x | 0;
      return turned[i] + (turned[i + 1] - turned[i]) * (x - i);
    }

    /* ------------------------------------------------------------ rings --- */

    function addRing(o) {
      o.th0 = rnd() * TAU;
      o.whip = o.whip || 0;
      const n = o.n || 0;
      o.s0 = new Float32Array(n);                  // segment start (radians, in the ring's frame)
      o.sl = new Float32Array(n);                  // segment length
      o.tb = new Float32Array(n);                  // when it breaks into sparks
      if (o.seg === 'even') {
        for (let j = 0; j < n; j++) { o.s0[j] = j * TAU / n; o.sl[j] = o.fill * TAU / n; }
      } else if (o.seg === 'rand') {
        const lens = [];
        const gaps = [];
        let sum = 0;
        for (let j = 0; j < n; j++) { const a = 0.45 + rnd(); const gp = 0.14 + rnd() * 0.3; lens.push(a); gaps.push(gp); sum += a + gp; }
        let at = 0;
        for (let j = 0; j < n; j++) { o.s0[j] = at; o.sl[j] = lens[j] * TAU / sum; at += (lens[j] + gaps[j]) * TAU / sum; }
      }
      for (let j = 0; j < n; j++) o.tb[j] = o.breakAt + rnd() * o.breakSpan;
      return o;
    }

    // Inside out: f is the radius in R, w the line width in px (at R = 225), sp radians per second
    // at cruising speed, dir +1 clockwise.
    const hub = addRing({ f: 0.205, w: 2.4, sp: 0, dir: 1, t0: 20, dur: 460, breakAt: T_CORE_OUT, breakSpan: 0 });
    const coil = addRing({ f: 0.335, w: 18, sp: 0.36, dir: 1, t0: 90, dur: 420, seg: 'even', n: 14, fill: 0.7, breakAt: T_BREAK + 650, breakSpan: 520 });
    const dash = addRing({ f: 0.47, w: 1.8, sp: 0.8, dir: -1, t0: 200, dur: 500, n: 72, breakAt: T_BREAK + 380, breakSpan: 600 });
    const arcs = addRing({ f: 0.6, w: 5.5, sp: 1.0, dir: 1, t0: 270, dur: 560, whip: 2.4, seg: 'rand', n: 5, breakAt: T_BREAK + 260, breakSpan: 620 });
    const ticks = addRing({ f: 0.735, w: 1.5, sp: 0.2, dir: -1, t0: 340, dur: 540, n: 96, breakAt: T_BREAK + 140, breakSpan: 600 });
    const outer = addRing({ f: 0.875, w: 2.8, sp: 0.5, dir: -1, t0: 400, dur: 600, whip: 3.0, seg: 'rand', n: 3, breakAt: T_BREAK, breakSpan: 560 });
    const rim = addRing({ f: 1.0, w: 1.3, sp: 0.22, dir: 1, t0: 460, dur: 700, seg: 'even', n: 4, fill: 0.085, breakAt: T_BREAK, breakSpan: 420 });
    const field = { f: 1.2, th0: rnd() * TAU, sp: 0.07, dir: -1 };
    const ARC_RINGS = [arcs, outer];

    function angleOf(o, t) {
      return o.th0 + o.dir * (o.sp * spun(t) - o.whip * (1 - easeOut(clamp((t - o.t0) / 1000, 0, 1))));
    }

    /* ----------------------------------------------------------- shock --- */

    // The shockwave leaves the core where the reactor holds (it has risen by then).
    const rho0 = 0.2 * HOLD_R;
    let far = 0;
    for (const p of [[0, 0], [W, 0], [0, H], [W, H]]) far = Math.max(far, Math.hypot(p[0] - HOLD_X, p[1] - HOLD_Y));
    const rho1 = far + 60 * K_HOLD;
    const shockRadius = (t) => rho0 + (rho1 - rho0) * (1 - Math.pow(1 - clamp((t - T_FLARE) / SHOCK_DUR, 0, 1), 4));
    // When the shockwave reaches a point this far from the core.
    const shockTime = (d) => T_FLARE + SHOCK_DUR * (1 - Math.pow(1 - clamp((d - rho0) / (rho1 - rho0), 0, 1), 0.25));

    // The surge sends a smaller wave of light out from the core.
    const SURGE_DUR = 1400;
    const surgeRadius = (t) => RR * (0.25 + 3.3 * easeOut(clamp((t - T_SURGE) / SURGE_DUR, 0, 1)));
    // When it reaches the words (the reactor has long settled by then).
    const surgeOnWords = T_SURGE + SURGE_DUR * (1 - Math.cbrt(1 - clamp(((L.top - HOLD_Y) / HOLD_R - 0.25) / 3.3, 0, 0.999)));

    // Rays of light thrown out by the flare.
    const NRAY = 14;
    const rayA = new Float32Array(NRAY);
    const rayW = new Float32Array(NRAY);
    const rayL = new Float32Array(NRAY);
    for (let i = 0; i < NRAY; i++) { rayA[i] = (i + rnd() * 0.7) * TAU / NRAY; rayW[i] = 0.012 + rnd() * 0.022; rayL[i] = 0.55 + rnd() * 0.45; }

    // Energy drawn into the core just before it flares.
    const NCH = 52;
    const chA = new Float32Array(NCH);
    const chF = new Float32Array(NCH);
    const chT = new Float32Array(NCH);
    const chD = new Float32Array(NCH);
    for (let i = 0; i < NCH; i++) {
      chA[i] = rnd() * TAU;
      chF[i] = 1.2 + rnd() * 1.6;
      chD[i] = 300 + rnd() * 200;
      chT[i] = T_FLARE + 30 - chD[i] - rnd() * 420;
    }

    /* ----------------------------------------------------------- words --- */

    // Points on the letters, for the sparks that run over them (when each one sparks is set with
    // the letters, below).
    const wp = env.wordPoints(Math.round(clamp(1100 * K_HOLD * K_HOLD, 260, 1300)));
    const nW = wp.pts.length >> 1;
    const wx = new Float32Array(nW);
    const wy = new Float32Array(nW);
    const wReach = new Float32Array(nW);
    const wSize = new Float32Array(nW);
    for (let i = 0; i < nW; i++) {
      wx[i] = wp.pts[i * 2] + (rnd() - 0.5) * wp.step * 0.6;
      wy[i] = wp.pts[i * 2 + 1] + (rnd() - 0.5) * wp.step * 0.6;
      wReach[i] = rnd() * 50;
      wSize[i] = (1.5 + rnd() * 1.4) * K_HOLD;
    }
    const wMinX = wp.minX;
    const wMaxX = wp.maxX;
    // Where each line of words runs (from the points on its letters): the scanning bar lights a line
    // only while it is over it, so it never leaves a smudge of light on the empty picture beside it.
    const SCAN_LINES = [];
    {
      const split = L.year ? (L.titleY + L.yearY) / 2 : Infinity;
      for (let q = 0; q < (L.year ? 2 : 1); q++) {
        let x0 = Infinity;
        let x1 = -Infinity;
        for (let i = 0; i < nW; i++) {
          if ((wy[i] < split) !== (q === 0)) continue;
          if (wx[i] < x0) x0 = wx[i];
          if (wx[i] > x1) x1 = wx[i];
        }
        if (x1 > x0) SCAN_LINES.push({ x0: x0, x1: x1, y: q ? L.yearY : L.titleY, h: (q ? L.yearSize : L.titleSize) * 1.7 });
      }
    }

    /* --------------------------------------------------------- comets --- */

    // Bright filaments racing round the rings, each a head and a fading tail.
    const comets = [];
    const lanes = [0.47, 0.535, 0.6, 0.8, 0.875, 1.0, 1.1];
    for (let i = 0; i < 14; i++) {
      const surge = i >= 9;
      comets.push({
        f: lanes[(rnd() * lanes.length) | 0],
        thick: rnd() < 0.45 ? 1 : 0,
        speed: (2.3 + rnd() * 2.4) * (rnd() < 0.5 ? 1 : -1),
        ph: rnd() * TAU,
        tail: 0.75 + rnd() * 1.0,
        on: surge ? T_SURGE - 120 + rnd() * 260 : T_FLARE + 100 + i * 110 + rnd() * 160,
        off: surge ? T_SURGE + 1300 + rnd() * 900 : T_DOWN + 150 + rnd() * 900,
        blink: 0.0005 + rnd() * 0.0007,
        bph: rnd() * TAU
      });
    }
    const COMET_PARTS = 6;

    /* ---------------------------------------------------------- bolts --- */

    // Short-lived arcs of current jumping between two rings.
    const bolts = [];
    const pairs = [[0.39, 0.6], [0.6, 0.875], [0.875, 1.0], [0.47, 0.735]];
    for (let t = T_FLARE + 450; t < T_DOWN + 300;) {
      const pr = pairs[(rnd() * pairs.length) | 0];
      bolts.push({ t: t, dur: 90 + rnd() * 140, th: rnd() * TAU, d: (rnd() - 0.5) * 0.5, f1: pr[0], f2: pr[1], id: bolts.length });
      t += (t > T_SURGE - 200 && t < T_SURGE + 900 ? 90 : 230) + rnd() * 520;
    }
    const BOLT_PTS = 8;

    /* ---------------------------------------------------------- motes --- */

    // Specks of light thrown into orbit by the flare.
    const NM = 96;
    const motes = [];
    for (let i = 0; i < NM; i++) {
      const band = rnd();
      const f = band < 0.2 ? 0.24 + rnd() * 0.14 : band < 0.72 ? 0.42 + rnd() * 0.55 : 1.05 + rnd() * 0.45;
      const tilted = rnd() < 0.24;
      motes.push({
        f: f,
        ecc: tilted ? 0.32 + rnd() * 0.36 : 1,
        tilt: rnd() * Math.PI,
        w: (0.75 + rnd() * 0.6) * Math.pow(0.6 / f, 1.2) * (rnd() < 0.62 ? 1 : -1),
        ph: rnd() * TAU,
        size: 1.1 + rnd() * 1.5,
        app: T_FLARE + 30 + rnd() * 650,
        exit: T_BREAK + rnd() * 1100,
        gold: rnd() < 0.1,
        glow: rnd() < 0.7,
        tw: rnd() * TAU
      });
    }

    /* --------------------------------------------------------- sparks --- */

    // What the rings break into: born where a segment was at the moment it breaks.
    const MAXS = 1000;
    const sx = new Float32Array(MAXS);
    const sy = new Float32Array(MAXS);
    const svx = new Float32Array(MAXS);
    const svy = new Float32Array(MAXS);
    const stb = new Float32Array(MAXS);
    const slife = new Float32Array(MAXS);
    const ssz = new Float32Array(MAXS);
    const sdrag = new Float32Array(MAXS);
    const scol = new Uint8Array(MAXS);              // 0 ice, 1 white, 2 gold
    const sglow = new Uint8Array(MAXS);
    let ns = 0;
    const k = K_HOLD;
    function emit(a, rr, tb, vt, col) {
      if (ns >= MAXS) return;
      const i = ns++;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const v = vt * (0.7 + rnd() * 0.6);
      const vr = (35 + rnd() * 150) * k;
      sx[i] = HOLD_X + c * rr;
      sy[i] = HOLD_Y + s * rr;
      svx[i] = -s * v + c * vr + (rnd() - 0.5) * 34 * k;
      svy[i] = c * v + s * vr + (rnd() - 0.5) * 34 * k;
      stb[i] = tb;
      slife[i] = 1100 + rnd() * 1000;
      ssz[i] = (1.4 + rnd() * 1.8) * k;
      sdrag[i] = 0.45 + rnd() * 0.7;
      scol[i] = col != null ? col : rnd() < 0.18 ? 1 : 0;
      sglow[i] = rnd() < 0.45 ? 1 : 0;
    }
    const tangential = (o, t, rr) => o.dir * o.sp * spinAt(t) * rr;
    // Segmented rings: sparks along each segment, spaced about 7 px apart.
    for (const o of [outer, arcs, coil, rim]) {
      const r0 = o.f * HOLD_R;
      for (let j = 0; j < o.n; j++) {
        const tb = o.tb[j];
        const a0 = angleOf(o, tb) + o.s0[j];
        const m = clamp(Math.round(o.sl[j] * r0 / (7 * k)) * (o === coil ? 2 : 1), 2, 22);
        for (let q = 0; q < m; q++) {
          const rr = r0 + (rnd() - 0.5) * o.w * k * 0.8;
          emit(a0 + ((q + rnd()) / m) * o.sl[j], rr, tb + rnd() * 90, tangential(o, tb, rr), o === rim && rnd() < 0.35 ? 2 : null);
        }
      }
    }
    // The fine rings and the rim's hairline go as a scatter of sparks while they fade.
    for (let j = 0; j < 46; j++) { const tb = dash.breakAt + rnd() * dash.breakSpan; emit(angleOf(dash, tb) + rnd() * TAU, dash.f * HOLD_R, tb, tangential(dash, tb, dash.f * HOLD_R)); }
    for (let j = 0; j < 48; j++) { const tb = ticks.breakAt + rnd() * ticks.breakSpan; emit(angleOf(ticks, tb) + rnd() * TAU, (ticks.f + rnd() * 0.05) * HOLD_R, tb, tangential(ticks, tb, ticks.f * HOLD_R)); }
    for (let j = 0; j < 40; j++) { const tb = rim.breakAt + rnd() * rim.breakSpan; emit(angleOf(rim, tb) + rnd() * TAU, HOLD_R, tb, tangential(rim, tb, HOLD_R), rnd() < 0.12 ? 2 : null); }
    for (let j = 0; j < 30; j++) emit(rnd() * TAU, hub.f * HOLD_R * (0.4 + rnd() * 0.6), T_CORE_OUT + rnd() * 80, 0, rnd() < 0.4 ? 1 : 0);
    // Drawn in alpha bands, one path per colour and band.
    const SPARK_FILL = [ICE, WHITE, GOLD];
    const BANDS = 4;

    /* --------------------------------------------------------- letters --- */

    // Each letter of the title is a tube the reactor lights; each digit of the year a cell it charges.
    const LET = env.glyphs();
    const TITLE = LET.filter((g) => g.line === 0);
    const YEAR = LET.filter((g) => g.line === 1);

    // When the ignition's ring of light (drawBurst) passes a point: it leaves the core where the
    // reactor is born, before it rises.
    function ringTime(x, y) {
      const e = (Math.hypot(x - HOLD_X, y - START_Y) / START_R - 0.1) / 1.7;
      return e <= 0 ? 0 : e >= 1 ? 620 : 620 * (1 - Math.cbrt(1 - e));
    }

    // A tube's moments are lists of flashes [from, to, fill, hot] in ms: fill is the letter in its
    // colour, hot the white-hot light added on top. Between flashes only a dying glow is left.
    const nT = TITLE.length;
    const tubes = TITLE.map((g) => {
      // The ignition: as the ring passes, the tube blinks (light only), once or twice, and fails.
      const b1 = ringTime(g.cx, g.cy) + 60 + rnd() * 110;
      const blinks = [[b1, b1 + 34 + rnd() * 26, 0, 0.5 + rnd() * 0.2]];
      if (rnd() < 0.65) { const b2 = blinks[0][1] + 80 + rnd() * 130; blinks.push([b2, b2 + 24 + rnd() * 18, 0, 0.3 + rnd() * 0.15]); }
      // and tries again, here and there, while the reactor draws its charge in before the flare.
      if (rnd() < 0.55) {
        const b3 = Math.max(blinks[blinks.length - 1][1] + 90, T_FLARE - 560 + rnd() * 420);
        if (b3 < T_FLARE - 80) blinks.push([b3, b3 + 26 + rnd() * 18, 0, 0.26 + rnd() * 0.16]);
      }
      // The flare: the shockwave reaches it, two or three quick flickers, and it catches.
      // The further from the middle, the longer it takes to catch, so the title lights from the
      // middle outwards.
      const at = shockTime(Math.hypot(g.cx - HOLD_X, g.cy - HOLD_Y)) + rnd() * 25;
      const side = nT > 1 ? Math.abs(g.i - (nT - 1) / 2) / ((nT - 1) / 2) : 0;
      const strike = [];
      const nf = rnd() < 0.3 + 0.5 * side ? 3 : 2;
      let s = 0;
      for (let q = 0; q < nf; q++) {
        const len = 22 + rnd() * 24;
        const p = q === 0 ? 0.8 + rnd() * 0.2 : 0.45 + rnd() * 0.45;
        strike.push([s, s + len, p * 0.8, p]);
        s += len + 40 + rnd() * 50 + side * 70;
      }
      // Power-down, from the ends inwards: a sag, a last surge, a sputter or two, then dark.
      const out = T_TITLE_OUT + Math.min(g.i, nT - 1 - g.i) * 72 + rnd() * 50;
      const down = [];
      let o = 0;
      const seg = (len, fill, hot) => { down.push([o, o + len, fill, hot]); o += len; };
      seg(45 + rnd() * 45, 0.42, 0);
      seg(28 + rnd() * 20, 1, 0.5);
      seg(45 + rnd() * 55, 0.1, 0);
      if (rnd() < 0.6) { seg(24 + rnd() * 20, 0.62, 0.22); seg(40 + rnd() * 40, 0.06, 0); }
      return { g: g, blinks: blinks, at: at, strike: strike, caught: at + s, out: out, down: down, dark: out + o };
    });

    // Where a letter's ink really is, measured once in this style's face: fx.js only guesses (cy +-
    // 0.37 of the size), and Michroma's capitals and figures sit higher than that, so a fill that
    // trusted the guess would top out with the top of the digit still dark, which then popped in.
    const FACE = typeof APFx.face === 'function' ? APFx.face('arc') : null;
    function inkOf(g) {
      const k = { top: g.top, bottom: g.bottom, left: g.x0, right: g.x1 };
      if (!FACE) return k;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = FACE.weight + ' ' + g.size + 'px ' + FACE.family;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const m = ctx.measureText(g.ch);
      ctx.restore();
      const up = m.actualBoundingBoxAscent;
      const down = m.actualBoundingBoxDescent;
      if (isFinite(up) && isFinite(down) && up + down > g.size * 0.2) { k.top = g.cy - up; k.bottom = g.cy + down; }
      const lf = m.actualBoundingBoxLeft;
      const rt = m.actualBoundingBoxRight;
      if (isFinite(lf) && isFinite(rt) && lf + rt > 0) { k.left = g.x0 - lf; k.right = g.x0 + rt; }
      return k;
    }

    // The year waits for the title: the light reaches the first digit as the last letter of the
    // title catches, so the two lines are never being built at the same time.
    let titleLit = 0;
    for (const tb of tubes) titleLit = Math.max(titleLit, tb.caught);
    const T_Y0 = clamp(titleLit - POUR - 60, T_YEAR0, T_YEAR0 + 600);
    // The year: energy pours from the reactor into each digit in turn, which fills from the bottom up.
    const nY = YEAR.length;
    const yGap = nY > 1 ? Math.min(YEAR_GAP, 820 / (nY - 1)) : 0;
    const digits = YEAR.map((g, j) => {
      const at = T_Y0 + j * yGap + rnd() * 40;
      return { g: g, ink: inkOf(g), at: at, full: at + POUR + FILL_MS, drain: T_YEAR_OUT + (nY - 1 - j) * 110 + rnd() * 30 };
    });
    // How full a digit is (0-1) at t: it fills quickly at first, then tops out; it drains smoothly.
    function level(d, t) {
      if (t >= d.drain) return 1 - smooth(0, DRAIN_MS, t - d.drain);
      const u = clamp((t - d.at - POUR) / FILL_MS, 0, 1);
      return 1 - (1 - u) * (1 - u);
    }
    // When the drain's surface is at level lv (the inverse of the smoothstep in level()).
    const drainAt = (lv) => DRAIN_MS * (0.5 - Math.sin(Math.asin(clamp(2 * lv - 1, -1, 1)) / 3));
    // The height of the surface at that level: from just under the ink (its outline included) to
    // just over it, where little of the halo is left to cut.
    const levelY = (d, lv) => lerp(d.ink.bottom + d.g.size * 0.05, d.ink.top - d.g.size * 0.08, lv);
    // Where that height cuts a letter's picture: fx.js cuts each letter into a cell this tall, the
    // margin round it set by the fill's halo (as fx.js works it out).
    const CELL_PAD = (Math.max(6, L.titleSize * 0.28) * 1.6 + L.titleSize * 0.04) / Math.min(1, DPR) + 2;
    const SURF_PAD = (L.titleSize * 0.04) / Math.min(1, DPR) + 2;
    function cropAt(g, y, pad) {
      const top = Math.floor((g.cy - g.size * 0.62 - pad) * DPR) / DPR;
      const bottom = Math.ceil((g.cy + g.size * 0.62 + pad) * DPR) / DPR;
      return clamp((y - top) / Math.max(1, bottom - top), 0, 1);
    }

    // Everything holds still in between: from ALL_ON the words are one picture until they lose power.
    let ALL_ON = T_FLARE;
    for (const tb of tubes) ALL_ON = Math.max(ALL_ON, tb.caught + 480);
    for (const d of digits) ALL_ON = Math.max(ALL_ON, d.full + 440);
    let ALL_OUT = T_YEAR_OUT;
    for (const tb of tubes) ALL_OUT = Math.max(ALL_OUT, tb.dark + 460);
    for (const d of digits) ALL_OUT = Math.max(ALL_OUT, d.drain + DRAIN_MS + 40);

    // When each point on the words sparks: a point of the title as the shockwave passes it and when
    // its tube goes out; a point of the year as the light filling (and later draining) its digit
    // passes it.
    const wOut = new Float32Array(nW);
    const splitY = nY ? (L.titleY + L.yearY) / 2 : Infinity;
    let sparkFrom = Infinity;
    let sparkTo = -Infinity;
    for (let i = 0; i < nW; i++) {
      const year = wy[i] >= splitY;
      const list = year ? digits : tubes;
      let best = null;
      let bd = Infinity;
      for (const e of list) { const dd = Math.abs(e.g.cx - wx[i]); if (dd < bd) { bd = dd; best = e; } }
      if (!best) { wReach[i] = -1e9; wOut[i] = -1e9; continue; }
      if (year) {
        const lv = clamp((levelY(best, 0) - wy[i]) / (levelY(best, 0) - levelY(best, 1)), 0, 1);
        wReach[i] = best.at + POUR + FILL_MS * (1 - Math.sqrt(1 - lv)) + wReach[i] * 0.4;
        wOut[i] = best.drain + drainAt(lv);
      } else {
        wReach[i] += shockTime(Math.hypot(wx[i] - HOLD_X, wy[i] - HOLD_Y));
        wOut[i] = best.dark + wReach[i] % 40;
      }
      if (wReach[i] < sparkFrom) sparkFrom = wReach[i];
      if (wReach[i] > sparkTo) sparkTo = wReach[i];
    }

    /* ------------------------------------------------------------ draw --- */

    let count = 0;

    function sprite(img, x, y, size, a) {
      if (a <= 0.004 || size <= 0.5) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      count++;
    }

    /** A picture made at device resolution, centred on (x, y), copied 1:1 onto whole device pixels. */
    function blit(img, x, y, a) {
      if (a <= 0.004) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, Math.round(x * DPR - img.width / 2) / DPR, Math.round(y * DPR - img.height / 2) / DPR, img.width / DPR, img.height / DPR);
      count++;
    }

    /** How strongly the core beats at t (0 calm, about 1 at the top of a beat, more in the surge). */
    function beat(t) {
      let b = 0;
      for (let i = 0; i < PULSES.length; i++) {
        const age = t - PULSES[i];
        if (age >= 0 && age < 1400) b = Math.max(b, Math.exp(-age / 260) * smooth(0, 60, age));
      }
      const sa = t - T_SURGE;
      if (sa >= 0 && sa < 2400) b = Math.max(b, 1.4 * Math.exp(-sa / 420) * smooth(0, 90, sa));
      return b;
    }

    /** The reactor losing power: 1 steady, dropping in flickers as it spins down. */
    function power(t) {
      if (t < T_DOWN + 200) return 1;
      const dying = smooth(T_DOWN + 200, T_BREAK + 500, t);
      return 1 - dying * 0.45 * noise(77, Math.floor(t / 55));
    }

    /** A soft flash over the frame at ignition (well under a quarter of full light). */
    function drawFlash(t, fade) {
      if (t >= 320) return;
      const a = 0.2 * Math.pow(1 - t / 320, 2) * fade;
      if (a <= 0.004) return;
      // (The reactor is still where it is born: the picture is centred on it.)
      ctx.globalAlpha = a;
      ctx.drawImage(flashPic, 0, 0, flashPic.width / DPR, flashPic.height / DPR);
      count++;
    }

    /** The first ring of light at ignition, and the rays of the flare. */
    function drawBurst(t, fade, low) {
      const u = t / 620;
      if (u < 1) {
        ctx.strokeStyle = ICE;
        ctx.lineWidth = lw(3.5 * (1 - u) + 1);
        ctx.globalAlpha = 0.9 * Math.pow(1 - u, 1.5) * fade;
        ctx.beginPath();
        ctx.arc(X, Y, RR * (0.1 + 1.7 * easeOut(u)), 0, TAU);
        ctx.stroke();
        count++;
      }
      const v = (t - T_FLARE) / 1300;
      if (v > 0 && v < 1 && !low) {
        const a = Math.pow(1 - v, 2.2) * smooth(0, 0.03, v) * 0.45 * fade;
        const len = RR * (1.4 + 3.4 * easeOut(v));
        const g = ctx.createRadialGradient(X, Y, RR * 0.12, X, Y, len);
        g.addColorStop(0, 'rgba(225,251,255,0.95)');
        g.addColorStop(0.35, 'rgba(95,227,255,0.4)');
        g.addColorStop(1, 'rgba(30,150,255,0)');
        const rot = v * 0.35;
        ctx.fillStyle = g;
        ctx.globalAlpha = a;
        ctx.beginPath();
        for (let i = 0; i < NRAY; i++) {
          const e = rayA[i] + rot;
          ctx.moveTo(X, Y);
          ctx.arc(X, Y, len * rayL[i], e - rayW[i], e + rayW[i]);
          ctx.closePath();
        }
        ctx.fill();
        count += NRAY;
      }
    }

    function drawCharge(t, fade) {
      if (t < T_FLARE - 1000 || t > T_FLARE + 40) return;
      const head = new Path2D();
      const tail = new Path2D();
      let n = 0;
      for (let i = 0; i < NCH; i++) {
        const u = (t - chT[i]) / chD[i];
        if (u <= 0 || u >= 1) continue;
        // Falls in faster and faster, a bright head and a fainter tail streaming behind it.
        const r = RR * (0.24 + chF[i] * (1 - u * u));
        const len = RR * (0.04 + 0.32 * u * u) * Math.min(1, u * 6);
        const c = Math.cos(chA[i]);
        const s = Math.sin(chA[i]);
        const mid = r + len * 0.35;
        head.moveTo(X + c * r, Y + s * r);
        head.lineTo(X + c * mid, Y + s * mid);
        tail.moveTo(X + c * mid, Y + s * mid);
        tail.lineTo(X + c * (r + len), Y + s * (r + len));
        n++;
      }
      if (!n) return;
      ctx.lineCap = 'round';
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = lw(1.4);
      ctx.globalAlpha = 0.4 * fade;
      ctx.stroke(tail);
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = lw(2);
      ctx.globalAlpha = 0.9 * fade;
      ctx.stroke(head);
      ctx.lineCap = 'butt';
      count += n * 2;
    }

    /** A soft dark backing behind the reactor so its light still reads over a bright scene. */
    function drawScrim(t, fade) {
      const a = 0.85 * smooth(T_RISE0 - 250, T_RISE1, t) * (1 - smooth(T_BREAK + 300, T_CORE_OUT + 300, t)) * fade;
      if (a <= 0.004) return;
      ctx.globalCompositeOperation = 'source-over';
      // While it rises (and shrinks), the backing at its first size gives way to the one at its last.
      const u = smooth(T_RISE0, T_RISE1, t);
      if (u < 1) blit(scrimBorn, X, Y, a * (1 - u));
      if (u > 0) blit(scrimPic, X, Y, a * u);
      ctx.globalCompositeOperation = 'lighter';
    }

    function drawCore(t, fade, b, low) {
      // Size (diameter, in R) and brightness of the core.
      let size;
      let a = 1;
      if (t < T_FLARE) {
        const ign = smooth(0, 50, t);
        size = 2.0 * Math.exp(-t / 200) * ign + 1.05 * smooth(60, 520, t) + 0.3 * ign;
        // Charging: a flutter just before the flare.
        if (t > T_FLARE - 320) { size += 0.35 * smooth(T_FLARE - 320, T_FLARE, t); a = 0.72 + 0.28 * noise(5, Math.floor(t / 40)); }
      } else {
        size = 1.55 + 1.3 * Math.exp(-(t - T_FLARE) / 280) + 0.45 * b;
      }
      // Dying: shrinks and dims, then one last pop.
      if (t > T_CORE_OUT - 700) {
        const d = smooth(T_CORE_OUT - 700, T_CORE_OUT, t);
        size *= 1 - 0.8 * d;
        a *= (1 - 0.5 * d) * (0.7 + 0.3 * noise(9, Math.floor(t / 45)));
        if (t >= T_CORE_OUT) {
          const pa = (t - T_CORE_OUT) / 420;
          size = 1.7 * (0.5 + 0.5 * easeOut(clamp(pa, 0, 1)));
          a = pa < 1 ? Math.pow(1 - pa, 2) * 0.9 : 0;
        }
      }
      a *= fade;
      // The reactor's glow on its surroundings, then the core itself.
      const haloA = (0.5 * smooth(T_FLARE + 150, T_FLARE + 900, t) + 0.35 * b) * (1 - smooth(T_BREAK, T_CORE_OUT, t)) * fade;
      if (t > T_FLARE + 150 && !low) blit(haloPic, X, Y, haloA);
      sprite(tex.core, X, Y, size * RR, a);
      // The anamorphic streak: wide at ignition and at the flare, a thin glint while it holds.
      let sw = 0;
      let sa = 0;
      if (t < T_FLARE) { sw = W * 1.15 * (0.25 + 0.75 * easeOut(clamp(t / 260, 0, 1))); sa = 1 - smooth(120, 900, t); }
      const ft = t - T_FLARE;
      if (ft >= 0 && ft < 1500) { const w2 = W * 1.6 * (0.35 + 0.65 * easeOut(clamp(ft / 240, 0, 1))); const a2 = 1 - smooth(80, 1500, ft); if (a2 > sa) { sw = w2; sa = a2; } }
      const hold = 0.2 * (1 + 0.8 * b) * smooth(T_FLARE + 600, T_FLARE + 1600, t) * (1 - smooth(T_CORE_OUT - 600, T_CORE_OUT, t));
      if (hold > sa) { sw = RR * 6.2; sa = hold; }
      if (t >= T_CORE_OUT) { sw = RR * 4 * (1 + (t - T_CORE_OUT) / 300); sa = a; }
      if (sa > 0.004 && fade > 0) {
        const sh = lw(30) * (0.6 + 0.4 * Math.min(1, sa));
        ctx.globalAlpha = Math.min(1, sa * fade);
        ctx.drawImage(tex.streak, X - sw / 2, Y - sh / 2, sw, sh);
        count++;
      }
    }

    function drawShock(t, fade, low) {
      const u = (t - T_FLARE) / SHOCK_DUR;
      if (u <= 0 || u >= 1) return;
      const rho = shockRadius(t);
      const a = Math.pow(1 - u, 1.25) * fade;
      const w = (22 + 80 * easeOut(u)) * K_HOLD;
      const inner = Math.max(0, rho - w);
      const outerR = rho + 3 * K_HOLD;
      const g = ctx.createRadialGradient(HOLD_X, HOLD_Y, inner, HOLD_X, HOLD_Y, outerR);
      g.addColorStop(0, 'rgba(30,150,255,0)');
      g.addColorStop(0.72, 'rgba(95,227,255,0.24)');
      g.addColorStop(0.95, 'rgba(225,252,255,0.9)');
      g.addColorStop(1, 'rgba(225,252,255,0)');
      ctx.globalAlpha = a;
      ctx.strokeStyle = g;
      ctx.lineWidth = outerR - inner;
      ctx.beginPath();
      ctx.arc(HOLD_X, HOLD_Y, (inner + outerR) / 2, 0, TAU);
      ctx.stroke();
      count++;
      // A thin gold echo just behind it.
      const r2 = shockRadius(t - 110);
      if (r2 > rho0 + 2 && !low) {
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(1, 1.6 * K_HOLD);
        ctx.beginPath();
        ctx.arc(HOLD_X, HOLD_Y, r2, 0, TAU);
        ctx.stroke();
        count++;
      }
    }

    /** Thin rings rippling out from the core on each beat, and a wave of light at the surge. */
    function drawRipples(t, fade) {
      ctx.strokeStyle = ICE;
      ctx.lineWidth = lw(1.5);
      for (let i = 0; i < PULSES.length; i++) {
        const u = (t - PULSES[i]) / 1100;
        if (u <= 0 || u >= 1) continue;
        ctx.globalAlpha = 0.4 * Math.pow(1 - u, 1.6) * fade;
        ctx.beginPath();
        ctx.arc(X, Y, RR * (0.22 + 1.05 * easeOut(u)), 0, TAU);
        ctx.stroke();
        count++;
      }
      const u = (t - T_SURGE) / SURGE_DUR;
      if (u > 0 && u < 1) {
        const rho = surgeRadius(t);
        const w = (14 + 46 * u) * KK;
        const inner = Math.max(0, rho - w);
        const g = ctx.createRadialGradient(X, Y, inner, X, Y, rho + 2 * KK);
        g.addColorStop(0, 'rgba(30,150,255,0)');
        g.addColorStop(0.75, 'rgba(95,227,255,0.3)');
        g.addColorStop(0.95, 'rgba(225,252,255,0.85)');
        g.addColorStop(1, 'rgba(225,252,255,0)');
        ctx.globalAlpha = 0.6 * Math.pow(1 - u, 1.4) * fade;
        ctx.strokeStyle = g;
        ctx.lineWidth = rho + 2 * KK - inner;
        ctx.beginPath();
        ctx.arc(X, Y, (inner + rho + 2 * KK) / 2, 0, TAU);
        ctx.stroke();
        count++;
      }
    }

    /** A ring's light gets a lift when a ripple passes over it. */
    function lift(t, f) {
      let b = 0;
      for (let i = 0; i < PULSES.length; i++) {
        const u = (t - PULSES[i]) / 1100;
        if (u <= 0 || u >= 1) continue;
        const d = (0.22 + 1.05 * easeOut(u) - f) / 0.07;
        b = Math.max(b, Math.exp(-d * d) * (1 - u));
      }
      const us = (t - T_SURGE) / SURGE_DUR;
      if (us > 0 && us < 1) { const d = (surgeRadius(t) / RR - f) / 0.09; b = Math.max(b, Math.exp(-d * d) * 1.3 * (1 - us)); }
      return 1 + 0.7 * b;
    }

    /** Adds a ring's unbroken segments to the current path (shrinking towards their middle as they break). */
    function segPath(o, t, th, r, fly) {
      let n = 0;
      for (let j = 0; j < o.n; j++) {
        let s = o.s0[j];
        let len = o.sl[j];
        const since = t - o.tb[j];
        if (since >= 140) continue;
        if (since > 0) { const keep = 1 - since / 140; s += len * (1 - keep) / 2; len *= keep; }
        let rr = r;
        if (fly) {
          // Coil blocks fly in from far out, one after another round the ring.
          const u = clamp((t - o.t0 - j * 22) / o.dur, 0, 1);
          if (u <= 0) continue;
          rr = r * (1 + 1.7 * Math.pow(1 - easeOut(u), 1.4));
        }
        const a = th + s;
        ctx.moveTo(X + Math.cos(a) * rr, Y + Math.sin(a) * rr);
        ctx.arc(X, Y, rr, a, a + len);
        n++;
      }
      return n;
    }

    /** A flash where a segment breaks. */
    function breakFlashes(o, t, th, r, fade) {
      if (t < o.breakAt || t > o.breakAt + o.breakSpan + 200) return;
      for (let j = 0; j < o.n; j++) {
        const since = t - o.tb[j];
        if (since < 0 || since > 200) continue;
        const a = th + o.s0[j] + o.sl[j] / 2;
        sprite(glowIce, X + Math.cos(a) * r, Y + Math.sin(a) * r, (26 + o.sl[j] * 30) * KK, (1 - since / 200) * 0.9 * fade);
      }
    }

    function drawRings(t, fade, low) {
      const pw = power(t) * fade;
      ctx.lineCap = 'butt';

      // Hub: the ring right round the core, a faint lit disc inside it, and turbine vanes.
      {
        const o = hub;
        const u = (t - o.t0) / o.dur;
        if (u > 0 && t < T_CORE_OUT + 60) {
          const r = o.f * RR * backOut(clamp(u, 0, 1)) * (t > T_CORE_OUT - 700 ? 1 - 0.55 * smooth(T_CORE_OUT - 700, T_CORE_OUT, t) : 1);
          const a = smooth(0, 0.2, u) * pw;
          ctx.beginPath();
          ctx.arc(X, Y, Math.max(0.5, r), 0, TAU);
          ctx.fillStyle = CYAN;
          ctx.globalAlpha = a * 0.13;
          ctx.fill();
          ctx.strokeStyle = ICE;
          ctx.lineWidth = lw(o.w);
          ctx.globalAlpha = a * 0.95;
          ctx.stroke();
          const vane = spun(t) * 2.8;
          ctx.beginPath();
          for (let j = 0; j < 12; j++) {
            const e = vane + j * TAU / 12;
            const c = Math.cos(e);
            const s = Math.sin(e);
            ctx.moveTo(X + c * r * 0.45, Y + s * r * 0.45);
            ctx.lineTo(X + c * r * 0.82, Y + s * r * 0.82);
          }
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = lw(2);
          ctx.globalAlpha = a * 0.3;
          ctx.stroke();
          count += 14;
        }
      }

      // Coils: thick blocks, each with a hot filament down its middle.
      {
        const o = coil;
        if (t > o.t0) {
          const th = angleOf(o, t);
          const r = o.f * RR;
          const a = smooth(o.t0, o.t0 + 260, t) * pw * lift(t, o.f);
          ctx.beginPath();
          const n = segPath(o, t, th, r, true);
          if (n) {
            if (!low) { ctx.strokeStyle = CYAN; ctx.lineWidth = lw(o.w + 12); ctx.globalAlpha = a * 0.12; ctx.stroke(); }
            ctx.strokeStyle = CYAN;
            ctx.lineWidth = lw(o.w);
            ctx.globalAlpha = a * 0.42;
            ctx.stroke();
            ctx.strokeStyle = WHITE;
            ctx.lineWidth = lw(3);
            ctx.globalAlpha = a * 0.85;
            ctx.stroke();
            count += n * (low ? 2 : 3);
          }
          breakFlashes(o, t, th, r, fade);
        }
      }

      // Fine dashes, written on round the ring.
      {
        const o = dash;
        const u = (t - o.t0) / o.dur;
        if (u > 0) {
          const a = smooth(0, 0.15, u) * pw * lift(t, o.f) * (1 - smooth(o.breakAt + 100, o.breakAt + o.breakSpan + 200, t));
          if (a > 0.004) {
            const th = angleOf(o, t);
            const r = o.f * RR;
            const reveal = easeOut(clamp(u, 0, 1));
            const period = TAU * r / o.n;
            ctx.setLineDash([period * 0.42, period * 0.58]);
            ctx.strokeStyle = ICE;
            ctx.lineWidth = lw(o.w);
            ctx.globalAlpha = a * 0.75;
            ctx.beginPath();
            ctx.arc(X, Y, r, th, th + reveal * TAU);
            ctx.stroke();
            ctx.setLineDash([]);
            count += o.n;
            if (reveal < 0.995) sprite(glowIce, X + Math.cos(th + reveal * TAU) * r, Y + Math.sin(th + reveal * TAU) * r, 18 * KK, a);
          }
        }
      }

      // The arc rings: arcs that swirl into place (the inner one with a bright line inside).
      for (const o of ARC_RINGS) {
        const u = (t - o.t0) / o.dur;
        if (u <= 0) continue;
        const r = o.f * RR * (0.6 + 0.4 * backOut(clamp(u, 0, 1)));
        const a = smooth(0, 0.3, u) * pw * lift(t, o.f);
        const th = angleOf(o, t);
        breakFlashes(o, t, th, r, fade);
        ctx.beginPath();
        const n = segPath(o, t, th, r, false);
        if (!n) continue;
        if (!low) { ctx.strokeStyle = CYAN; ctx.lineWidth = lw(o.w + 9); ctx.globalAlpha = a * 0.13; ctx.stroke(); }
        ctx.strokeStyle = o === arcs ? CYAN : ICE;
        ctx.lineWidth = lw(o.w);
        ctx.globalAlpha = a * (o === arcs ? 0.62 : 0.85);
        ctx.stroke();
        if (o === arcs) {
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = lw(1.4);
          ctx.globalAlpha = a * 0.8;
          ctx.stroke();
        }
        count += n * (low ? 2 : 3);
        if (o === outer) {
          // Small square studs at the ends of the outer arcs.
          ctx.fillStyle = WHITE;
          ctx.globalAlpha = a * 0.9;
          const s = lw(5);
          for (let j = 0; j < o.n; j++) {
            if (t >= o.tb[j]) continue;
            const e0 = th + o.s0[j];
            const e1 = e0 + o.sl[j];
            ctx.fillRect(X + Math.cos(e0) * r - s / 2, Y + Math.sin(e0) * r - s / 2, s, s);
            ctx.fillRect(X + Math.cos(e1) * r - s / 2, Y + Math.sin(e1) * r - s / 2, s, s);
            count += 2;
          }
        }
      }

      // Ticks: a dial of short marks, written on the other way round.
      {
        const o = ticks;
        const u = (t - o.t0) / o.dur;
        if (u > 0) {
          const a = smooth(0, 0.15, u) * pw * lift(t, o.f) * (1 - smooth(o.breakAt + 60, o.breakAt + o.breakSpan + 150, t));
          if (a > 0.004) {
            const th = angleOf(o, t);
            const r = o.f * RR;
            const shown = Math.round(o.n * easeOut(clamp(u, 0, 1)));
            ctx.beginPath();
            for (let j = 0; j < shown; j++) {
              const e = th - j * TAU / o.n;
              const len = (j % 8 === 0 ? 0.075 : 0.035) * RR;
              const c = Math.cos(e);
              const s = Math.sin(e);
              ctx.moveTo(X + c * r, Y + s * r);
              ctx.lineTo(X + c * (r + len), Y + s * (r + len));
            }
            ctx.strokeStyle = ICE;
            ctx.lineWidth = lw(o.w);
            ctx.globalAlpha = a * 0.6;
            ctx.stroke();
            count += shown;
          }
        }
      }

      // Rim: a hairline that closes in from outside, four bright brackets and eight gold marks.
      {
        const o = rim;
        const u = (t - o.t0) / o.dur;
        if (u > 0) {
          const r = RR * (1 + 0.45 * Math.pow(1 - easeOut(clamp(u, 0, 1)), 1.5));
          const a = smooth(0, 0.3, u) * pw * lift(t, o.f);
          const th = angleOf(o, t);
          const hair = a * (1 - smooth(o.breakAt, o.breakAt + o.breakSpan + 200, t));
          if (hair > 0.004) {
            ctx.strokeStyle = CYAN;
            ctx.lineWidth = lw(o.w);
            ctx.globalAlpha = hair * 0.45;
            ctx.beginPath();
            ctx.arc(X, Y, r, 0, TAU);
            ctx.stroke();
            ctx.beginPath();
            for (let j = 0; j < 8; j++) {
              const e = th + (j + 0.5) * TAU / 8;
              const c = Math.cos(e);
              const s = Math.sin(e);
              ctx.moveTo(X + c * (r - 0.03 * RR), Y + s * (r - 0.03 * RR));
              ctx.lineTo(X + c * (r + 0.045 * RR), Y + s * (r + 0.045 * RR));
            }
            ctx.strokeStyle = GOLD;
            ctx.lineWidth = lw(2.2);
            ctx.globalAlpha = hair * 0.85;
            ctx.stroke();
            count += 9;
          }
          breakFlashes(o, t, th, r, fade);
          ctx.beginPath();
          const n = segPath(o, t, th, r, false);
          if (n) {
            ctx.strokeStyle = WHITE;
            ctx.lineWidth = lw(4.5);
            ctx.globalAlpha = a * 0.85;
            ctx.stroke();
            count += n;
          }
        }
      }

      // Field: a faint dashed ring further out, lit by the shockwave as it passes.
      {
        const ton = shockTime(field.f * HOLD_R);
        const a = 0.24 * smooth(ton, ton + 300, t) * pw * (1 - smooth(T_BREAK, T_BREAK + 900, t)) * lift(t, field.f);
        if (a > 0.004) {
          const th = field.th0 + field.dir * field.sp * spun(t);
          const r = field.f * RR;
          const period = TAU * r / 120;
          ctx.setLineDash([period * 0.5, period * 0.5]);
          ctx.strokeStyle = CYAN;
          ctx.lineWidth = lw(1.1);
          ctx.globalAlpha = a;
          ctx.beginPath();
          ctx.arc(X, Y, r, th, th + TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          count++;
        }
      }
    }

    function drawComets(t, fade, low) {
      const heads = [];
      for (let part = 0; part < COMET_PARTS; part++) {
        for (let thick = 0; thick < 2; thick++) {
          ctx.beginPath();
          let n = 0;
          for (let i = 0; i < comets.length; i++) {
            const c = comets[i];
            if (c.thick !== thick || t < c.on || t > c.off) continue;
            if (low && (i & 1)) continue;
            // A comet comes and goes by growing and shrinking its tail.
            const vis = smooth(c.on, c.on + 300, t) * (1 - smooth(c.off - 350, c.off, t)) * (0.55 + 0.45 * Math.sin(t * c.blink + c.bph));
            if (vis < 0.03) continue;
            const head = c.ph + c.speed * t / 1000;
            const tl = c.tail * vis / COMET_PARTS;
            const r = c.f * RR;
            const a0 = c.speed > 0 ? head - (part + 1) * tl : head + part * tl;
            ctx.moveTo(X + Math.cos(a0) * r, Y + Math.sin(a0) * r);
            ctx.arc(X, Y, r, a0, a0 + tl);
            n++;
            if (part === 0) heads.push(i, vis);
          }
          if (!n) continue;
          const f = 1 - part / COMET_PARTS;
          if (thick && part < 3 && !low) {
            ctx.strokeStyle = CYAN;
            ctx.lineWidth = lw(8);
            ctx.globalAlpha = 0.16 * f * fade;
            ctx.stroke();
          }
          ctx.strokeStyle = part < 2 ? WHITE : ICE;
          ctx.lineWidth = lw((thick ? 2.8 : 1.7) * (0.45 + 0.55 * f));
          ctx.globalAlpha = Math.pow(f, 1.4) * fade;
          ctx.stroke();
          count += n;
        }
      }
      for (let h = 0; h < heads.length; h += 2) {
        const c = comets[heads[h]];
        const head = c.ph + c.speed * t / 1000;
        sprite(glowIce, X + Math.cos(head) * c.f * RR, Y + Math.sin(head) * c.f * RR, (c.thick ? 24 : 16) * KK, heads[h + 1] * fade);
      }
    }

    function drawBolts(t, fade, low) {
      ctx.beginPath();
      let n = 0;
      const ends = [];
      for (let i = 0; i < bolts.length; i++) {
        const b = bolts[i];
        const age = t - b.t;
        if (age < 0 || age > b.dur) continue;
        if (noise(b.id, Math.floor(t / 33)) < 0.22) continue;           // it flickers
        const slot = Math.floor(t / 45);
        for (let j = 0; j <= BOLT_PTS; j++) {
          const s = j / BOLT_PTS;
          const inner = j > 0 && j < BOLT_PTS;
          const e = b.th + b.d * s + (inner ? (noise(b.id * 13 + j, slot) - 0.5) * 0.09 : 0);
          const r = RR * (lerp(b.f1, b.f2, s) + (inner ? (noise(b.id * 29 + j, slot + 7) - 0.5) * 0.06 : 0));
          const x = X + Math.cos(e) * r;
          const y = Y + Math.sin(e) * r;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          if (j === 0 || j === BOLT_PTS) ends.push(x, y);
        }
        n++;
      }
      if (!n) return;
      ctx.lineJoin = 'bevel';
      if (!low) { ctx.strokeStyle = CYAN; ctx.lineWidth = lw(5); ctx.globalAlpha = 0.22 * fade; ctx.stroke(); }
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = lw(1.3);
      ctx.globalAlpha = 0.9 * fade;
      ctx.stroke();
      count += n * BOLT_PTS;
      for (let e = 0; e < ends.length; e += 2) sprite(glowIce, ends[e], ends[e + 1], 16 * KK, 0.75 * fade);
    }

    function drawMotes(t, fade, low) {
      const pts = [new Path2D(), new Path2D(), new Path2D()];          // ice bright, ice dim, gold
      const trails = new Path2D();
      let n = 0;
      const turn = spun(t);
      for (let i = 0; i < NM; i++) {
        if (low && (i & 1)) continue;
        const m = motes[i];
        if (t < m.app) continue;
        const out = t > m.exit ? (t - m.exit) / 1000 : 0;
        let a = smooth(m.app, m.app + 250, t) * (1 - smooth(m.exit + 100, m.exit + 1000, t)) * fade;
        a *= 0.6 + 0.4 * Math.sin(t * 0.004 + m.tw);
        if (a < 0.03) continue;
        const r = RR * m.f * (0.15 + 0.85 * easeOut(clamp((t - m.app) / 900, 0, 1))) + out * out * 320 * KK;
        const ph = m.ph + m.w * turn;
        const c = Math.cos(m.tilt);
        const s = Math.sin(m.tilt);
        const ex = Math.cos(ph) * r;
        const ey = Math.sin(ph) * r * m.ecc;
        const x = X + ex * c - ey * s;
        const y = Y + ex * s + ey * c;
        const sz = m.size * KK;
        pts[m.gold ? 2 : a > 0.6 ? 0 : 1].rect(x - sz / 2, y - sz / 2, sz, sz);
        if (!low && m.ecc === 1 && a > 0.2) {
          const tl = Math.min(0.5, Math.abs(m.w) * 0.35);
          const a0 = m.w > 0 ? ph - tl : ph;
          trails.moveTo(X + Math.cos(a0) * r, Y + Math.sin(a0) * r);
          trails.arc(X, Y, r, a0, a0 + tl);
        }
        if (m.glow) sprite(m.gold ? glowGold : glowCyan, x, y, sz * 6, a * 0.55);
        n++;
      }
      if (!n) return;
      ctx.lineWidth = lw(1);
      ctx.strokeStyle = CYAN;
      ctx.globalAlpha = 0.28 * fade;
      ctx.stroke(trails);
      ctx.fillStyle = WHITE;
      ctx.globalAlpha = 0.95 * fade;
      ctx.fill(pts[0]);
      ctx.fillStyle = ICE;
      ctx.globalAlpha = 0.5 * fade;
      ctx.fill(pts[1]);
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.9 * fade;
      ctx.fill(pts[2]);
      count += n * 2;
    }

    function drawSparks(t, fade, low) {
      if (t < T_BREAK - 10) return;
      const paths = [];
      for (let i = 0; i < SPARK_FILL.length * BANDS; i++) paths.push(null);
      const step = low ? 2 : 1;
      for (let i = 0; i < ns; i += step) {
        const age = t - stb[i];
        if (age < 0 || age >= slife[i]) continue;
        const u = age / slife[i];
        let a = Math.pow(1 - u, 1.3) * fade * (0.62 + 0.38 * Math.sin(age * 0.028 + i * 1.7));
        if (a < 0.03) continue;
        const as = age / 1000;
        const f = (1 - Math.exp(-sdrag[i] * as)) / sdrag[i];
        const x = sx[i] + svx[i] * f + 6 * k * as;
        const y = sy[i] + svy[i] * f - 14 * k * as;
        let s = ssz[i];
        if (age < 140) { s *= 1 + 1.4 * (1 - age / 140); a = Math.min(1, a * 1.3); }
        const band = Math.min(BANDS - 1, (a * BANDS) | 0);
        const key = scol[i] * BANDS + band;
        (paths[key] || (paths[key] = new Path2D())).rect(x - s / 2, y - s / 2, s, s);
        if (sglow[i]) sprite(scol[i] === 2 ? glowGold : glowCyan, x, y, s * 6, a * 0.7);
        count++;
      }
      for (let i = 0; i < paths.length; i++) {
        if (!paths[i]) continue;
        ctx.fillStyle = SPARK_FILL[(i / BANDS) | 0];
        ctx.globalAlpha = ((i % BANDS) + 0.7) / BANDS;
        ctx.fill(paths[i]);
      }
    }

    /** Light on the words: the shockwave igniting them, scans, and the odd twinkle. */
    function drawWordLights(t, fade, low, wordsA) {
      if (!nW) return;
      const step = low ? 2 : 1;
      const bands = [null, null, null, null];        // points drawn in four bands of brightness
      const put = (i, s, a) => {
        const b = a >= 0.7 ? 3 : a >= 0.45 ? 2 : a >= 0.2 ? 1 : 0;
        (bands[b] || (bands[b] = new Path2D())).rect(wx[i] - s / 2, wy[i] - s / 2, s, s);
      };
      let n = 0;
      // 1. Ignition: a point of the title flashes as the shockwave passes it, a point of the year as
      // the light filling its digit rises past it; then it glows on a moment.
      if (t > sparkFrom - 20 && t < sparkTo + 1100) {
        for (let i = 0; i < nW; i += step) {
          const age = t - wReach[i];
          if (age < 0 || age > 1100) continue;
          const a = (0.95 * Math.exp(-age / 70) + 0.08 * Math.exp(-age / 260)) * fade;
          if (a < 0.05) continue;
          put(i, wSize[i] * (0.75 + 0.45 * Math.exp(-age / 90)), a);
          if (age < 120 && i % 3 === 0) sprite(glowCyan, wx[i], wy[i], 17 * k, a * 0.45);
          n++;
        }
      }
      // 1b. Power-down: a tube's points spit a last spark as it goes out, a digit's as it drains.
      if (t > T_YEAR_OUT - 20 && t < ALL_OUT + 500) {
        for (let i = 0; i < nW; i += step) {
          const age = t - wOut[i];
          if (age < 0 || age > 420) continue;
          const a = 0.8 * Math.exp(-age / 90) * fade;
          if (a < 0.05) continue;
          put(i, wSize[i] * (0.7 + 0.4 * Math.exp(-age / 90)), a);
          n++;
        }
      }
      // 2. A scan: a soft bar of light crosses the words, sparking the points it passes.
      for (let j = 0; j < SCANS.length; j++) {
        const u = (t - SCANS[j]) / SCAN_DUR;
        if (u <= 0 || u >= 1) continue;
        const band = (wMaxX - wMinX) * 0.06 + 18 * k;
        const xs = lerp(wMinX - band * 2, wMaxX + band * 2, smooth(0, 1, u));
        const env1 = Math.sin(u * Math.PI);
        const ba = 0.3 * env1 * wordsA * fade;
        if (ba > 0.004) {
          for (let q = 0; q < SCAN_LINES.length; q++) {
            const ln = SCAN_LINES[q];
            const a = ba * smooth(ln.x0 - band, ln.x0 + band * 0.6, xs) * (1 - smooth(ln.x1 - band * 0.6, ln.x1 + band, xs));
            if (a <= 0.004) continue;
            ctx.globalAlpha = a;
            ctx.drawImage(tex.bar, xs - band * 0.9, ln.y - ln.h / 2, band * 1.8, ln.h);
            count++;
          }
        }
        for (let i = 0; i < nW; i += step) {
          const d = (wx[i] - xs) / band;
          if (d <= -1 || d >= 1) continue;
          const a = (1 - d * d) * (1 - d * d) * 0.95 * env1 * wordsA * fade;
          if (a < 0.05) continue;
          put(i, wSize[i], a);
          n++;
        }
      }
      // 3. Twinkles while the words hold, a burst of them when the surge reaches the words.
      if (wordsA > 0.5) {
        const slot = Math.floor(t / 130);
        const within = (t - slot * 130) / 130;
        const burst = t > surgeOnWords ? Math.exp(-(t - surgeOnWords) / 380) : 0;
        const odds = 0.016 + 0.07 * burst;
        for (let i = 0; i < nW; i += step) {
          if (noise(i, slot) > odds) continue;
          const a = (1 - within) * 0.9 * wordsA * fade;
          put(i, wSize[i] * 1.3, a);
          sprite(glowIce, wx[i], wy[i], 12 * k, a * 0.7);
          n++;
        }
      }
      if (!n) return;
      const BAND_A = [0.12, 0.32, 0.58, 0.92];
      for (let b = 0; b < 4; b++) {
        if (!bands[b]) continue;
        ctx.fillStyle = b >= 2 ? WHITE : ICE;
        ctx.globalAlpha = BAND_A[b];
        ctx.fill(bands[b]);
      }
      count += n;
    }

    /* --------------------------------------------------------- letters --- */

    const LIGHT = { op: 'lighter' };
    const flash = [0, 0];
    /** [fill, hot] of a tube s ms into a list of flashes (after a flash, a quickly dying glow). */
    function flashes(list, s) {
      flash[0] = 0;
      flash[1] = 0;
      for (let q = 0; q < list.length; q++) {
        const f = list[q];
        if (s < f[0]) break;
        if (s < f[1]) { flash[0] = f[2]; flash[1] = f[3]; break; }
        flash[0] = 0;
        flash[1] = Math.max(f[2], f[3]) * 0.22 * Math.exp(-(s - f[1]) / 45);
      }
      return flash;
    }

    /** The title: each tube blinks at ignition, strikes at the flare, holds, and goes out. */
    function drawTitle(t, fade) {
      for (let q = 0; q < nT; q++) {
        const tb = tubes[q];
        let fill = 0;
        let hot = 0;
        let glow = 0;
        if (t < tb.at) {
          glow = flashes(tb.blinks, t)[1];
        } else if (t < tb.caught) {
          flashes(tb.strike, t - tb.at);
          fill = flash[0];
          hot = flash[1];
        } else if (t < tb.out) {
          const c = t - tb.caught;
          fill = 1;
          hot = 0.95 * Math.exp(-c / 170) * (1 - smooth(260, 460, c));
        } else if (t < tb.dark) {
          flashes(tb.down, t - tb.out);
          fill = flash[0];
          hot = flash[1];
        } else {
          const c = t - tb.dark;
          glow = 0.42 * Math.exp(-c / 120) * (1 - smooth(220, 440, c));     // the last of its glow
        }
        if (fill > 0.003) { env.glyph(tb.g, fill * fade, FILL); count++; }
        if (hot > 0.01) { env.glyph(tb.g, hot * fade, HOT, LIGHT); count++; }
        if (glow > 0.01) { env.glyph(tb.g, glow * fade, GLOW, LIGHT); count++; }
      }
    }

    /** The year: each digit fills with the reactor's light, flashes as it tops out, holds, drains. */
    function drawYear(t, fade) {
      for (let j = 0; j < nY; j++) {
        const d = digits[j];
        const g = d.g;
        if (t < d.at + POUR) continue;
        if (t < d.full || t >= d.drain) {
          const lv = level(d, t);
          if (lv <= 0.002) continue;
          const y = levelY(d, lv);
          const filling = t < d.full;
          // Below the surface: the digit (with its halo), in cyan while it fills; the surface itself
          // a white-hot line in the strokes with a soft glow along it. Draining: the digit keeps its
          // colour below a falling surface.
          env.glyph(g, fade, FILL, { crop: [0, cropAt(g, y, CELL_PAD), 1, 1] });
          if (filling) env.glyph(g, fade, CHARGE, { crop: [0, cropAt(g, y, SURF_PAD), 1, 1] });
          env.glyph(g, 0.95 * fade, SURF, { op: 'lighter', crop: [0, cropAt(g, y, SURF_PAD), 1, cropAt(g, y + g.size * 0.05, SURF_PAD)] });
          const w = d.ink.right - d.ink.left;
          const ga = 0.6 * Math.min(1, lv * 6) * (filling ? 1 - smooth(FILL_MS - 80, FILL_MS, t - d.at - POUR) : smooth(0, 60, t - d.drain)) * fade;
          if (ga > 0.004) {
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = ga;
            ctx.drawImage(tex.streak, d.ink.left - w * 0.22, y - g.size * 0.07, w * 1.44, g.size * 0.14);
            ctx.restore();
          }
          count += 4;
        } else {
          // Topped out: the cyan gives way to the digit's colour through a white-hot flash.
          const c = t - d.full;
          env.glyph(g, fade, FILL);
          const cyan = 1 - smooth(0, 260, c);
          if (cyan > 0.01) env.glyph(g, cyan * fade, CHARGE);
          const hot = 1.15 * smooth(0, 50, c) * Math.exp(-c / 160) * (1 - smooth(260, 440, c));
          if (hot > 0.01) env.glyph(g, hot * fade, HOT, LIGHT);
          count += 3;
        }
      }
    }

    /** Energy pouring from the reactor's rim into the digits that are charging (behind the title). */
    function drawStreams(t, fade, low) {
      if (!nY || t < T_YEAR0 || t > digits[nY - 1].full + 200) return;
      const path = new Path2D();
      let n = 0;
      for (let j = 0; j < nY; j++) {
        const d = digits[j];
        const s = t - d.at;
        if (s <= 0 || s >= POUR + FILL_MS + 160) continue;
        const x1 = d.g.cx;
        const y1 = levelY(d, level(d, t));
        const e = Math.atan2(y1 - Y, x1 - X);
        const x0 = X + Math.cos(e) * RR * 0.97;
        const y0 = Y + Math.sin(e) * RR * 0.97;
        const head = easeOut(clamp(s / POUR, 0, 1));
        const tail = Math.pow(clamp((s - POUR - FILL_MS) / 160, 0, 1), 1.6);    // topped out: the rest falls in
        if (head - tail < 0.004) continue;
        path.moveTo(lerp(x0, x1, tail), lerp(y0, y1, tail));
        path.lineTo(lerp(x0, x1, head), lerp(y0, y1, head));
        n++;
      }
      if (!n) return;
      ctx.lineCap = 'round';
      if (!low) { ctx.strokeStyle = CYAN; ctx.lineWidth = lw(16); ctx.globalAlpha = 0.14 * fade; ctx.stroke(path); }
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = lw(4.5);
      ctx.globalAlpha = 0.5 * fade;
      ctx.stroke(path);
      ctx.strokeStyle = ICE;
      ctx.lineWidth = lw(1.5);
      ctx.globalAlpha = 0.8 * fade;
      ctx.stroke(path);
      // Pulses of light racing down it.
      ctx.setLineDash([lw(12), lw(26)]);
      ctx.lineDashOffset = -t * 1.6 * KK;
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = lw(3.4);
      ctx.globalAlpha = fade;
      ctx.stroke(path);
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
      ctx.lineCap = 'butt';
      count += n * 4;
    }

    /** Where a stream meets a digit: the head as it falls, then a glow on the rising surface. */
    function drawSplashes(t, fade) {
      if (!nY || t < T_YEAR0 || t > digits[nY - 1].full + 700) return;
      for (let j = 0; j < nY; j++) {
        const d = digits[j];
        const s = t - d.at;
        if (s <= 0) continue;
        const g = d.g;
        if (s < POUR + FILL_MS + 160) {
          // Where the stream leaves the reactor's rim.
          const y1 = levelY(d, level(d, t));
          const e = Math.atan2(y1 - Y, g.cx - X);
          const out = smooth(0, 60, s) * (1 - smooth(POUR + FILL_MS, POUR + FILL_MS + 160, s));
          sprite(glowCyan, X + Math.cos(e) * RR * 0.97, Y + Math.sin(e) * RR * 0.97, 46 * KK, 0.8 * out * fade);
        }
        if (s < POUR + FILL_MS) {
          const y1 = levelY(d, level(d, t));
          if (s < POUR) {
            const head = easeOut(s / POUR);
            const e = Math.atan2(y1 - Y, g.cx - X);
            sprite(glowIce, lerp(X + Math.cos(e) * RR * 0.97, g.cx, head), lerp(Y + Math.sin(e) * RR * 0.97, y1, head), 34 * KK, 0.9 * fade);
          } else {
            // (Gone by the time the digit tops out, so its flash takes over without a jump.)
            sprite(glowIce, g.cx, y1, g.size * 0.55, 0.55 * (1 - smooth(POUR + FILL_MS - 80, POUR + FILL_MS, s)) * fade);
          }
        } else {
          // Topped out: a small flash at the top of the digit.
          const c = s - POUR - FILL_MS;
          const a = 0.95 * smooth(0, 50, c) * Math.exp(-c / 150) * fade;
          if (a > 0.01) sprite(glowIce, g.cx, d.ink.top, g.size * (0.7 + 0.5 * (1 - Math.exp(-c / 120))), a);
        }
      }
    }

    function draw(t) {
      count = 0;
      if (!(t >= 0) || t >= DURATION) return 0;
      const fade = 1 - smooth(FADE_FROM, DURATION - 120, t);
      if (fade <= 0) return 0;
      const low = env.low();
      const b = beat(t);
      pose(t);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawScrim(t, fade);
      drawFlash(t, fade);
      drawCharge(t, fade);
      drawShock(t, fade, low);
      drawBurst(t, fade, low);
      drawRipples(t, fade);
      drawCore(t, fade, b, low);
      drawRings(t, fade, low);
      drawBolts(t, fade, low);
      drawComets(t, fade, low);
      drawMotes(t, fade, low);
      drawStreams(t, fade, low);
      ctx.restore();

      // The words: built letter by letter by the reactor (see the top of this file). While they
      // all hold still they are one picture.
      if (t >= ALL_ON && t < T_YEAR_OUT) {
        env.words(fade, FILL, 1);
        count++;
      } else if (t < ALL_OUT) {
        drawTitle(t, fade);
        drawYear(t, fade);
      }
      const wa = smooth(ALL_ON - 300, ALL_ON, t) * (1 - smooth(T_YEAR_OUT - 250, T_YEAR_OUT, t));

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawSplashes(t, fade);
      drawWordLights(t, fade, low, wa);
      drawSparks(t, fade, low);
      ctx.restore();
      return count;
    }

    // The sound (sfx-arc.js): every moment of this animation is known from here, so one plan carries
    // them all (x is 0..1 across the frame). Nothing here is drawn or drawn from the seed.
    if (env.cue) {
      const across = (a, r) => (HOLD_X + Math.cos(a) * r) / W;
      const breaks = [];
      for (const o of [outer, arcs, coil, rim]) {
        for (let j = 0; j < o.n; j++) breaks.push({ t: o.tb[j], x: across(angleOf(o, o.tb[j]) + o.s0[j] + o.sl[j] / 2, o.f * HOLD_R) });
      }
      env.cue('plan', {
        tubes: tubes.map((tb) => ({ x: tb.g.cx / W, i: tb.g.i, n: nT, blinks: tb.blinks.map((f) => f[0]), at: tb.at,
          strikes: tb.strike.map((f) => tb.at + f[0]), caught: tb.caught, out: tb.out, downs: tb.down.map((f) => tb.out + f[0]), dark: tb.dark })),
        digits: digits.map((d, j) => ({ x: d.g.cx / W, i: j, at: d.at, hit: d.at + POUR, full: d.full, drain: d.drain })),
        bolts: bolts.map((b) => ({ t: b.t, dur: b.dur, x: across(b.th, (b.f1 + b.f2) / 2 * HOLD_R) })),
        breaks: breaks,
        titleLit: titleLit, allOn: ALL_ON, allOut: ALL_OUT, surgeOnWords: surgeOnWords
      }, 0);
    }

    return {
      step: function () { /* every frame is drawn from t alone */ },
      draw: draw,
      prime: function () {
        // fx.js draws the words, and each letter in each fill, once and keeps the pictures: make
        // them now (the words clipped to nothing so the canvas stays clear) instead of at midnight.
        ctx.save();
        ctx.beginPath();
        ctx.rect(-4, -4, 1, 1);
        ctx.clip();
        env.words(1, FILL, 1);
        ctx.restore();
        env.warm(FILL);
        env.warm(HOT);
        if (nT) env.warm(GLOW, L.title, 0);
        if (nY) { env.warm(CHARGE, L.year, 1); env.warm(SURF, L.year, 1); }
      }
    };
  }

  APFx.register('arc', { name: 'Arc Reactor', duration: DURATION, font: { family: 'AP Michroma', weight: 400, tracking: 0.06 }, create: create });
})(typeof window !== 'undefined' ? window : this);
