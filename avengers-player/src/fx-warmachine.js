/*!
 * Avengers Player: 'warmachine', the War Machine celebration (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays, a tactical display boots: a white-hot line cuts across the
 *             middle of the frame and splits into two silver scan lines that sweep to the top and
 *             bottom edges, leaving faint contact marks where they find the letters; a vertical
 *             scan crosses the frame and lights up the display's frame, side scales and heading tape.
 *   0.2 s     a targeting reticle (tick ring, turning segments, range arcs) ignites in the middle of
 *             the picture, spinning, and slides down onto the words while it closes in.
 *   0.44 s    target acquisition: a red seeker box drops out of the reticle and hops along the title
 *             in a quick staccato; it snaps onto each letter in turn and a scan line renders that
 *             letter in brushed steel, top to bottom (HAPPY NEW YEAR by 1.5 s). The reticle opens
 *             where the letters cross it, each as it arrives.
 *   1.5 s     the seeker opens the year's readout, a counter: each digit powers on as a drum that
 *             rolls at full speed (the year that is ending is never shown) and stops dead on its
 *             digit, one by one, left to right, each lock with a white flash, a red double blink, a
 *             target box and a tick of the reticle. The last lock (2.55 s) locks the whole display:
 *             corner brackets snap round the words and a red ring pulses out. (A title without a
 *             year locks at 1.8 s; a year that is not a number is acquired like the title.)
 *   2.8-9 s   five salvoes: red-hot tracers fire from both lower corners, arc upward and burst into
 *             silver-white flak above the words, each burst marked by the display, with showers of
 *             sparks; a sheen runs across the steel letters.
 *   8.65 s    the finale: one last round from each gun curves in from the sides; the crosshair turns
 *             red, the two meet above the reticle at 9.75 s in one big burst and the brackets blink
 *             red again; a last sheen crosses the steel while the sparks rain down.
 *   11 s      the display powers down: scales and lines retract, the brackets let go, the letters
 *             scan out from the ends inwards and the reticle shrinks to a point that winks out by 12.45 s.
 *
 * Every frame is a function of the seed and t alone (nothing is simulated from frame to frame), so
 * renderAt(t), a resize in the middle and the live animation all draw the same picture.
 */
(function (root) {
  'use strict';

  const APFx = root.APFx;
  if (!APFx || typeof APFx.register !== 'function') return;

  const DURATION = 12500;
  const FADE_FROM = DURATION - 1500;            // 11.0 s: the display powers down
  const TAU = Math.PI * 2;

  // Brushed steel: white at the top to steel silver, with the bands of polished metal.
  const FILL = {
    stops: [[0, '#ffffff'], [0.3, '#f4f4f7'], [0.48, '#e8eaef'], [0.58, '#d3d6dd'], [0.64, '#b4b8c2'], [0.68, '#9da1ad'],
      [0.76, '#bec1ca'], [0.83, '#aeb2bc'], [0.9, '#c8cbd3'], [1, '#a0a0ac']],
    halo: 'rgba(2,3,6,0.92)'
  };
  // The same words in plain white without a halo: laid over the steel to polish it.
  const SHEEN = { stops: [[0, '#ffffff'], [1, '#f6f8ff']], halo: '' };
  // A digit of the year in red, without a halo: laid over the steel as it locks (the lock blink).
  const REDFILL = { stops: [[0, '#ff9a9d'], [1, '#ff5a5f']], halo: '' };
  // The steel without its halo: the smear of a digit on a drum that is rolling fast.
  const BLUR = { stops: FILL.stops, halo: '' };

  const WHITE = '#ffffff';
  const SILVER = '#e6e8ee';
  const ICE = '#d3dbec';
  const RED = '#ff5a5f';
  const HUD = [226, 229, 236];                  // the display's lines (rgb)
  const HUD_CSS = 'rgb(226,229,236)';
  const EDGE_A = 0.34;                          // the dark edge round them, relative to their own alpha
  const RED_RGB = [255, 90, 95];
  const SPARK_COLS = ['#ffffff', '#e2e6ef', '#b9c5dd', '#ff5a5f'];
  const SPARK_WEIGHTS = [0.42, 0.34, 0.12, 0.12];

  // The timeline (ms).
  const T_LINE = 240;          // the power-on line reaches the edges
  const T_SPLIT0 = 150;        // it splits into two scan lines ...
  const T_SPLIT1 = 760;        // ... that reach the top and bottom edges
  const T_VSCAN0 = 380;        // a vertical scan crosses the frame, left to right
  const T_VSCAN1 = 1300;
  const T_RET0 = 200;          // the reticle ignites in the middle of the frame ...
  const T_RET1 = 700;
  const T_SLIDE0 = 760;        // ... and slides onto the words
  const T_SLIDE1 = 1620;
  const T_SEEK = 440;          // the seeker drops out of the reticle ...
  const T_FIRST = 560;         // ... and lands on the first letter; the others follow a beat apart
  const SCAN_T = 150;          // a scan line renders one letter (and wipes it out at the end)
  const HOLD = 24;             // the seeker sits on a letter this long before it hops on
  const LOCK_GAP = 230;        // between the locks of the year's digits
  // (The lock itself, T_LOCK, and the brackets that come with it depend on the words: see create.)
  const SHEENS0 = [[0, 650], [4300, 1050], [7000, 1050], [10050, 900]];  // a sheen across the steel [start, length] (the first: at the lock)
  const VOLLEYS0 = [[2300, 2], [3500, 3], [4750, 2], [5950, 3], [7200, 3]];  // [first launch, shots per gun] (the first: not before the lock)
  const T_FINALE = 8650;       // both guns fire one last round each; they meet above the reticle
  const FINALE_FLIGHT = 1100;
  const T_DOWN = FADE_FROM;    // the power-down

  /* ----------------------------------------------------- textures (once) --- */

  let TEX = null;

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
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
    // A white glow with a hot centre (flashes, the final point).
    const glow = canvas(128, 128);
    let g = glow.getContext('2d');
    g.fillStyle = radial(g, 64, 64, 64, [[0, 'rgba(255,255,255,1)'], [0.1, 'rgba(250,251,255,0.92)'], [0.26, 'rgba(222,228,242,0.4)'],
      [0.52, 'rgba(195,205,228,0.11)'], [0.78, 'rgba(185,195,225,0.025)'], [1, 'rgba(180,190,220,0)']]);
    g.fillRect(0, 0, 128, 128);
    // A red glow (tracers, muzzle flashes, the lock).
    const red = canvas(64, 64);
    g = red.getContext('2d');
    g.fillStyle = radial(g, 32, 32, 32, [[0, 'rgba(255,220,214,1)'], [0.15, 'rgba(255,120,112,0.82)'], [0.42, 'rgba(255,72,78,0.26)'], [1, 'rgba(255,60,70,0)']]);
    g.fillRect(0, 0, 64, 64);
    // A band of light, the same all along: stretched into scan lines of any length.
    const band = canvas(4, 64);
    g = band.getContext('2d');
    let lg = g.createLinearGradient(0, 0, 0, 64);
    const BAND = [[0, 'rgba(205,215,240,0)'], [0.32, 'rgba(210,220,242,0.12)'], [0.46, 'rgba(236,241,255,0.55)'], [0.5, 'rgba(255,255,255,1)'],
      [0.54, 'rgba(236,241,255,0.55)'], [0.68, 'rgba(210,220,242,0.12)'], [1, 'rgba(205,215,240,0)']];
    for (const s of BAND) lg.addColorStop(s[0], s[1]);
    g.fillStyle = lg;
    g.fillRect(0, 0, 4, 64);
    // The same band standing up (the vertical scan).
    const vband = canvas(64, 4);
    g = vband.getContext('2d');
    lg = g.createLinearGradient(0, 0, 64, 0);
    for (const s of BAND) lg.addColorStop(s[0], s[1]);
    g.fillStyle = lg;
    g.fillRect(0, 0, 64, 4);
    // A streak that tapers at both ends: a round glow squashed eight times (the power-on line).
    const streak = canvas(256, 32);
    g = streak.getContext('2d');
    g.setTransform(8, 0, 0, 1, 0, 0);
    g.fillStyle = radial(g, 16, 16, 16, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(238,242,255,0.62)'], [0.5, 'rgba(205,215,240,0.16)'], [1, 'rgba(190,200,230,0)']]);
    g.fillRect(0, 0, 32, 32);
    // The same streak standing up.
    const vstreak = canvas(32, 256);
    g = vstreak.getContext('2d');
    g.setTransform(0, 1, -1, 0, 32, 0);
    g.drawImage(streak, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // A four-point glint: two crossed streaks round a hot centre.
    const star = canvas(64, 64);
    g = star.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    g.drawImage(streak, 0, 28, 64, 8);
    g.setTransform(0, 1, -1, 0, 64, 0);
    g.drawImage(streak, 0, 28, 64, 8);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = radial(g, 32, 32, 13, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(242,246,255,0.55)'], [1, 'rgba(220,230,255,0)']]);
    g.fillRect(19, 19, 26, 26);
    // Lit smoke: a soft, flat glow with no hot centre.
    const haze = canvas(64, 64);
    g = haze.getContext('2d');
    g.fillStyle = radial(g, 32, 32, 32, [[0, 'rgba(226,231,242,0.55)'], [0.45, 'rgba(214,221,236,0.32)'], [0.75, 'rgba(200,210,230,0.1)'], [1, 'rgba(190,200,225,0)']]);
    g.fillRect(0, 0, 64, 64);
    TEX = { glow: glow, red: red, band: band, vband: vband, streak: streak, vstreak: vstreak, star: star, haze: haze };
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
    const easeIn = env.easeIn;
    const k = env.scale;                          // 1 on a 1080p screen
    const tex = textures();
    const sprW = env.sprite(WHITE);
    const sprIce = env.sprite(ICE);
    const sprRed = env.sprite(RED);
    const wp = env.wordPoints(1600);              // points on the letters (cached by fx.js)
    const backOut = (u) => { const v = u - 1; return 1 + 2.4 * v * v * v + 1.4 * v * v; };
    const css = (c) => 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    const mix = (c1, c2, u) => [Math.round(lerp(c1[0], c2[0], u)), Math.round(lerp(c1[1], c2[1], u)), Math.round(lerp(c1[2], c2[2], u))];

    /* --- where the words are ------------------------------------------- */

    const TS = L.titleSize;
    const BX = L.cx;
    const BY = (L.top + L.bottom) / 2;
    // The ink of each line (from points on the letters), for the reticle's openings and the brackets.
    const split = L.year ? (L.titleY + L.yearY) / 2 : Infinity;
    const ink = [{ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }, { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity }];
    for (let i = 0; i < wp.pts.length; i += 2) {
      const b = wp.pts[i + 1] < split ? ink[0] : ink[1];
      const x = wp.pts[i];
      const y = wp.pts[i + 1];
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
    if (!isFinite(ink[0].x0)) {                   // no points: guess from the layout
      ink[0] = { x0: W * 0.2, x1: W * 0.8, y0: L.titleY - TS * 0.4, y1: L.titleY + TS * 0.4 };
    }
    const lines = [ink[0]];
    if (isFinite(ink[1].x0)) lines.push(ink[1]);
    const half = wp.step * 0.6;
    const BOXES = lines.map((b) => ({ x0: b.x0 - half - TS * 0.2, x1: b.x1 + half + TS * 0.2, y0: b.y0 - half - TS * 0.1, y1: b.y1 + half + TS * 0.1 }));
    if (BOXES.length === 2) {
      // the space between the two lines, as wide as the narrower one: no slivers of ring in there
      const a = BOXES[0];
      const b = BOXES[1];
      BOXES.push({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: a.y1 - 1, y1: b.y0 + 1 });
    }
    const inkX0 = Math.min.apply(null, lines.map((b) => b.x0)) - half;
    const inkX1 = Math.max.apply(null, lines.map((b) => b.x1)) + half;
    const inkY0 = lines[0].y0 - half;
    const inkY1 = lines[lines.length - 1].y1 + half;
    const inkH = inkY1 - inkY0;

    /* --- the letters: acquired, one at a time --------------------------- */

    // Every letter of both lines: { g (from fx.js), arr (it starts to render), out (it starts to be
    // wiped out), det (the boot's scan finds it), b (its target box) }; the year's digits also have
    // lock (when the counter stops on it), slot, and their drum: seq (its digits), run and speed.
    const DPR = env.dpr;
    const LET = env.glyphs().map((g) => ({ g: g, arr: 0, out: 0, det: 0, lock: -1, slot: -1, seq: null, run: 0, speed: 0, b: null }));
    const NL = LET.length;
    const TITLE = LET.filter((e) => e.g.line === 0);
    const YEAR = LET.filter((e) => e.g.line === 1);
    // A year in digits is read out like a counter; any other year is acquired like the title.
    const COUNTER = /^[0-9]+$/.test(L.year) && YEAR.length === L.year.length ? YEAR : [];
    const ACQ = COUNTER.length ? TITLE : TITLE.concat(YEAR);
    const nA = ACQ.length;
    const nC = COUNTER.length;
    // The ten digits set on the year's line: the counter's scrambling digits are moved from there.
    const DIG = nC ? env.textGlyphs('0123456789', 1) : [];
    const CAD = nA > 1 ? clamp(780 / (nA - 1), 48, 80) : 0;         // the staccato: one letter per beat
    ACQ.forEach((e, i) => { e.arr = T_FIRST + i * CAD; });
    const T_ACQ_END = nA ? ACQ[nA - 1].arr : T_FIRST - 100;
    const T_GATE = T_ACQ_END + 170;               // the seeker opens the readout (or goes home)
    COUNTER.forEach((e, p) => { e.slot = p; e.arr = T_GATE + 40 + p * 55; });
    // The lock of the whole display: the counter's last digit, or a beat after the title.
    const T_LOCK = nC ? Math.max(2450, COUNTER[nC - 1].arr + 150 + LOCK_GAP * (nC - 1)) : Math.max(1750, T_ACQ_END + SCAN_T + 330);
    COUNTER.forEach((e, p) => { e.lock = T_LOCK - LOCK_GAP * (nC - 1 - p); });
    const T_BRK0 = T_LOCK - 440;                  // the corner brackets snap in
    const T_BRK1 = T_LOCK - 40;
    const SHEENS = SHEENS0.map((s, i) => (i ? s : [T_LOCK + 40, s[1]]));
    const VOLLEYS = VOLLEYS0.map((v, i) => (i ? v : [Math.max(v[0], T_LOCK + 250), v[1]]));
    // The power-down wipes them out from the ends inwards, towards the point the reticle shrinks to.
    let far = 1;
    for (const e of LET) far = Math.max(far, Math.abs(e.g.cx - BX));
    for (const e of LET) e.out = T_DOWN + 40 + (1 - Math.abs(e.g.cx - BX) / far) * 460;
    let T_OUT0 = Infinity;
    for (const e of LET) T_OUT0 = Math.min(T_OUT0, e.out);
    // From here until the first one goes, the words are one picture.
    let T_SETTLED = T_LOCK + 440;
    for (const e of ACQ) T_SETTLED = Math.max(T_SETTLED, e.arr + SCAN_T + 300);
    // The boot's two scan lines leave a contact mark on each letter as they pass its line.
    const scanPass = (y) => {
      const u = clamp(Math.abs(y - H / 2) / (H / 2), 0, 1);
      let a = 0;
      let b = 1;
      for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (m * m * (3 - 2 * m) < u) a = m; else b = m; }
      return T_SPLIT0 + (T_SPLIT1 - T_SPLIT0) * a;
    };
    let T_CONTACTS_END = 0;
    for (const e of LET) {
      const g = e.g;
      e.det = scanPass(g.cy);
      e.b = [g.x0 - g.size * 0.17, g.top - g.size * 0.15, g.x1 + g.size * 0.17, g.bottom + g.size * 0.15];
      T_CONTACTS_END = Math.max(T_CONTACTS_END, e.arr + 30);
    }
    // The readout's gate round the year's digits.
    const GATE = nC ? [COUNTER[0].b[0], COUNTER[0].b[1], COUNTER[nC - 1].b[2], COUNTER[nC - 1].b[3]] : null;
    // The seeker's stops: the reticle's centre ('home'), each letter, then the gate (or home again).
    const STOPS = [{ at: T_SEEK, b: null }];
    for (const e of ACQ) STOPS.push({ at: e.arr, b: e.b });
    const LAST = { at: T_GATE, b: GATE };
    STOPS.push(LAST);
    const SEEK_END = nC ? T_LOCK + 260 : T_GATE;

    // The picture of a letter is cut as fx.js cuts it: crop fractions for a height on the screen.
    const PAD_HALO = (Math.max(6, TS * 0.28) * 1.6 + TS * 0.04) / Math.min(1, DPR) + 2;
    const PAD_BARE = (TS * 0.04) / Math.min(1, DPR) + 2;
    function cropAt(g, y, pad) {
      const top = Math.floor((g.cy - g.size * 0.62 - pad) * DPR) / DPR;
      const bottom = Math.ceil((g.cy + g.size * 0.62 + pad) * DPR) / DPR;
      return clamp((y - top) / Math.max(1, bottom - top), 0, 1);
    }

    // The reticle opens where the letters are: each line's box, cut into one stretch per letter at
    // the middle of each gap, is closed to the ring only while that letter is on the screen.
    const ON = new Uint8Array(NL);
    const RUNS = [];
    for (let l = 0; l < 2; l++) {
      const idx = [];
      LET.forEach((e, i) => { if (e.g.line === l) idx.push(i); });
      if (!idx.length) continue;
      const first = LET[idx[0]].g;
      const lastG = LET[idx[idx.length - 1]].g;
      const b = l === 0 || lines.length > 1 ? BOXES[l]
        : { x0: first.x0 - TS * 0.25, x1: lastG.x1 + TS * 0.25, y0: first.top - TS * 0.15, y1: first.bottom + TS * 0.15 };
      const cuts = new Float64Array(idx.length + 1);
      cuts[0] = b.x0;
      for (let i = 1; i < idx.length; i++) cuts[i] = (LET[idx[i - 1]].g.x1 + LET[idx[i]].g.x0) / 2;
      cuts[idx.length] = b.x1;
      RUNS.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, cuts: cuts, idx: idx });
    }
    const MID = BOXES.length === 3 ? BOXES[2] : null;
    let midOn = false;

    /* --- the reticle ----------------------------------------------------- */

    const R1 = clamp(Math.max((L.bottom - L.top) * 0.74, TS * 1.55), 30 * k, H * 0.36);   // locked onto the words
    const R0 = Math.max(R1 * 1.2, Math.min(H * 0.34, W * 0.3));      // born bigger in the middle of the frame
    const SX = W / 2;
    const SY = H / 2;
    let RX = SX;
    let RY = SY;
    let RR = R0;
    function pose(t) {
      const u = smooth(T_SLIDE0, T_SLIDE1, t);
      const v = u * u * (3 - 2 * u);                                   // a softer start and landing
      const ign = easeOut(smooth(T_RET0, T_RET1, t));
      const col = smooth(T_DOWN + 150, T_DOWN + 950, t);
      RX = lerp(SX, BX, v);
      RY = lerp(SY, BY, v);
      RR = lerp(R0, R1, v) * (0.3 + 0.7 * ign) * (1 - col * col * col);
    }
    // Each lock of a digit of the year ticks the reticle round a notch (and the scales with it).
    const NOTCH = TAU / 36;
    function spin(t) {
      let s = 2.6 * (1 - Math.exp(-t / 650)) + 0.1 * t / 1000 + 7 * easeIn(smooth(T_DOWN + 150, T_DOWN + 950, t));
      for (let p = 0; p < nC; p++) {
        const d = t - COUNTER[p].lock;
        if (d > 0) s += NOTCH * (d >= 140 ? 1 : backOut(d / 140));
      }
      return s;
    }

    // The reticle opens where the letters cross it, each as it arrives (and closes as it goes).
    function blocked(x, y) {
      for (let r = 0; r < RUNS.length; r++) {
        const ln = RUNS[r];
        if (y <= ln.y0 || y >= ln.y1 || x <= ln.x0 || x >= ln.x1) continue;
        const c = ln.cuts;
        const n = ln.idx.length;
        for (let i = 0; i < n - 1; i++) if (x < c[i + 1]) return ON[ln.idx[i]] === 1;
        return ON[ln.idx[n - 1]] === 1;
      }
      return midOn && x > MID.x0 && x < MID.x1 && y > MID.y0 && y < MID.y1;
    }
    const ARC_N = 180;
    const MIN_ARC = 0.2;
    const arcs = new Float64Array(64);
    function onRing(cx, cy, r, a) { return blocked(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    function edge(cx, cy, r, a0, a1) {
      const b0 = onRing(cx, cy, r, a0);
      for (let i = 0; i < 8; i++) {
        const m = (a0 + a1) / 2;
        if (onRing(cx, cy, r, m) === b0) a0 = m; else a1 = m;
      }
      return (a0 + a1) / 2;
    }
    /** The open stretches of a ring (pairs of angles in `arcs`); returns how many. */
    function openArcs(cx, cy, r) {
      const da = TAU / ARC_N;
      let first = -1;
      for (let i = 0; i < ARC_N; i++) if (onRing(cx, cy, r, i * da)) { first = i; break; }
      if (first < 0) { arcs[0] = 0; arcs[1] = TAU; return 1; }
      let n = 0;
      let open = false;
      for (let s = 1; s <= ARC_N; s++) {
        const a = (first + s) * da;
        const b = onRing(cx, cy, r, a);
        if (!b && !open) { open = true; arcs[n * 2] = edge(cx, cy, r, a - da, a); }
        else if (b && open) {
          open = false;
          arcs[n * 2 + 1] = edge(cx, cy, r, a - da, a);
          if (arcs[n * 2 + 1] - arcs[n * 2] > MIN_ARC && n < 31) n++;   // slivers are left out
        }
      }
      return n;
    }
    /** Adds to the path the parts of the arc [s0, s0 + len] that are open. */
    function clippedArc(cx, cy, r, s0, len, nOpen) {
      for (let j = 0; j < nOpen; j++) {
        const o0 = arcs[j * 2];
        const o1 = arcs[j * 2 + 1];
        const a = s0 - Math.floor((s0 - o0) / TAU) * TAU;              // the same angle, in [o0, o0 + 2pi)
        let lo = Math.max(a, o0);
        let hi = Math.min(a + len, o1);
        if (hi > lo + 0.06) { ctx.moveTo(cx + r * Math.cos(lo), cy + r * Math.sin(lo)); ctx.arc(cx, cy, r, lo, hi); }
        lo = Math.max(a - TAU, o0);
        hi = Math.min(a - TAU + len, o1);
        if (hi > lo + 0.06) { ctx.moveTo(cx + r * Math.cos(lo), cy + r * Math.sin(lo)); ctx.arc(cx, cy, r, lo, hi); }
      }
    }

    /* --- the salvo --------------------------------------------------------- */

    const GRAV = 0.5 * H;                         // px/s2
    const DRAG = 3.3;                             // 1/s
    const skyTop = H * 0.17;
    const skyLow = Math.max(skyTop + H * 0.08, Math.min(H * 0.42, L.top - H * 0.15));
    const keepOut = BOXES.map((b) => ({ x0: b.x0 - TS * 0.5, x1: b.x1 + TS * 0.5, y0: b.y0 - TS * 0.45, y1: b.y1 + TS * 0.4 }));
    function guidedHits(c) {
      for (let i = 1; i <= 24; i++) {
        const u = i / 24;
        const x = (1 - u) * (1 - u) * c.x0 + 2 * u * (1 - u) * c.px1 + u * u * c.bx;
        const y = (1 - u) * (1 - u) * c.y0 + 2 * u * (1 - u) * c.py1 + u * u * c.by;
        for (const b of keepOut) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
      }
      return false;
    }
    const pathHits = (x0, y0, bx, by) => {
      for (let i = 1; i <= 24; i++) {
        const u = i / 24;
        const x = x0 + (bx - x0) * u;
        const y = y0 - (y0 - by) * (2 * u - u * u);
        for (const b of keepOut) if (x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1) return true;
      }
      return false;
    };
    const shots = [];
    let nSpark = 0;
    const perBurst = clamp(Math.sqrt(k), 0.7, 1.2);
    for (let v = 0; v < VOLLEYS.length; v++) {
      const vt = VOLLEYS[v][0];
      const n = VOLLEYS[v][1];
      const big = v === VOLLEYS.length - 1;
      for (let side = 0; side < 2; side++) {
        const order = [];
        for (let j = 0; j < n; j++) order.push(j);
        for (let j = n - 1; j > 0; j--) { const q = Math.floor(rnd() * (j + 1)); const tmp = order[j]; order[j] = order[q]; order[q] = tmp; }
        for (let j = 0; j < n; j++) {
          const slot = (order[j] + 0.18 + rnd() * 0.64) / n;
          let fx = 0.09 + slot * 0.5;                                    // across this gun's side of the sky
          const high = (order[j] + v) % 2 === 0;
          let by = lerp(skyTop, skyLow, high ? rnd() * 0.45 : 0.5 + rnd() * 0.5);
          const x0 = side ? W * (0.972 - rnd() * 0.012) : W * (0.028 + rnd() * 0.012);
          const y0 = H * 1.02;
          let bx = side ? W * (1 - fx) : W * fx;
          for (let tries = 0; tries < 12 && pathHits(x0, y0, bx, by); tries++) {
            fx = Math.max(0.06, fx - 0.035);
            bx = side ? W * (1 - fx) : W * fx;
            by = Math.max(skyTop * 0.75, by - H * 0.025);
          }
          const flight = 0.95 + rnd() * 0.25;
          const t0 = vt + j * 165 + side * 80 + rnd() * 45;
          const size = big ? 1.08 + rnd() * 0.22 : 0.85 + rnd() * 0.3;
          const count = Math.round((48 + rnd() * 14) * perBurst * (big ? 1.15 : 1));
          shots.push({ x0: x0, y0: y0, bx: bx, by: by, t0: t0, flight: flight * 1000, tb: t0 + flight * 1000, size: size, first: nSpark, n: count, cs: null, ce: null, maxLife: 0, crk: null });
          nSpark += count;
        }
      }
    }
    // The finale: one round from each gun, curving in from the sides to meet above the reticle and
    // burst there together (one a ring, the other a full sphere).
    const finX = W / 2;
    const finY = Math.max(H * 0.2, Math.min((skyTop + skyLow) / 2 - H * 0.03, BY - R1 * 1.5 - H * 0.06));
    const T_FIN_BURST = T_FINALE + FINALE_FLIGHT;
    for (let side = 0; side < 2; side++) {
      const x0 = side ? W * 0.975 : W * 0.025;
      const y0 = H * 1.02;
      let lean = 0.05;
      const c = { x0: x0, y0: y0, bx: finX, by: finY, guided: true, px1: 0, py1: finY + H * 0.04 };
      for (let tries = 0; tries < 10; tries++) {
        c.px1 = x0 + (finX - x0) * lean;
        if (!guidedHits(c)) break;
        lean -= 0.04;                              // climb closer to the edge before turning in
      }
      const count = Math.round(64 * perBurst);
      shots.push({ x0: x0, y0: y0, bx: finX, by: finY, guided: true, px1: c.px1, py1: c.py1, ring: side === 0, unmarked: side === 1,
        t0: T_FINALE, flight: FINALE_FLIGHT, tb: T_FIN_BURST, size: 1.2, first: nSpark, n: count, cs: null, ce: null, maxLife: 0, crk: null });
      nSpark += count;
    }

    // Every spark of every burst, worked out now: the frame only evaluates where each one is at t.
    const VX = new Float32Array(nSpark);
    const VY = new Float32Array(nSpark);
    const LIFE = new Float32Array(nSpark);
    const PH = new Float32Array(nSpark);
    const SZ = new Float32Array(nSpark);
    for (const s of shots) {
      const cols = [];
      for (let i = 0; i < s.n; i++) {
        let pick = rnd();
        let c = 0;
        while (c < SPARK_WEIGHTS.length - 1 && pick > SPARK_WEIGHTS[c]) { pick -= SPARK_WEIGHTS[c]; c++; }
        cols.push(c);
      }
      cols.sort((a, b) => a - b);
      s.cs = [0, 0, 0, 0];
      s.ce = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) { s.cs[c] = s.first + cols.indexOf(c); s.ce[c] = s.first + cols.lastIndexOf(c) + 1; if (cols.indexOf(c) < 0) s.cs[c] = s.ce[c] = s.first; }
      const speed = 0.52 * H * s.size;
      const ring = s.ring != null ? s.ring : rnd() < 0.3;
      for (let i = 0; i < s.n; i++) {
        const j = s.first + i;
        const a = (i / s.n) * TAU + rnd() * 0.5;
        const v = speed * (ring ? 0.82 + rnd() * 0.18 : 0.3 + 0.7 * Math.sqrt(rnd()));
        VX[j] = Math.cos(a) * v;
        VY[j] = Math.sin(a) * v - 0.06 * H;
        LIFE[j] = 1.1 + rnd() * 1.2;
        PH[j] = rnd() * TAU;
        SZ[j] = (2.1 + rnd() * 1.8) * Math.max(0.6, k);
        if (LIFE[j] > s.maxLife) s.maxLife = LIFE[j];
      }
      // Crackle: glints that pop on a few sparks late in the burst.
      s.crk = [];
      for (let c = 0; c < 6; c++) s.crk.push({ at: 0.35 + rnd() * 0.95, j: s.first + Math.floor(rnd() * s.n) });
    }

    /* --- precomputed light --------------------------------------------- */

    const flashGrad = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.8);
    flashGrad.addColorStop(0, 'rgba(232,238,255,1)');
    flashGrad.addColorStop(0.4, 'rgba(210,220,245,0.55)');
    flashGrad.addColorStop(1, 'rgba(190,200,235,0.15)');

    // Glints on the letters: a fixed shuffle of word points.
    const NOISE = new Float32Array(512);
    for (let i = 0; i < 512; i++) NOISE[i] = rnd();
    const nPts = wp.pts.length / 2;

    // The counter: each digit is a drum that rolls at full speed (the units fastest) and stops dead
    // on its digit at its lock: it never slows down on a digit it does not stop on. Wherever the
    // year that is ending differs from the new one, the drum leaves that digit out, so the year
    // that is ending can never be read, not even for a moment.
    const OLD = nC ? String(Number(L.year) - 1) : '';
    for (const e of COUNTER) {
      const target = L.year.charCodeAt(e.slot) - 48;
      const old = OLD.length === nC ? OLD.charCodeAt(e.slot) - 48 : -1;
      const first = Math.floor(rnd() * 10);
      const seq = [];
      for (let i = 0; i < 10; i++) { const d = (first + i) % 10; if (d !== old || old === target) seq.push(d); }
      e.seq = seq;
      const span = Math.max(1, e.lock - e.arr);
      const want = span / Math.max(40, 74 - e.slot * 9);    // digits it would roll at its own pace
      let n = -1;
      for (let m = 2; m < want + 12; m++) if (seq[m % seq.length] === target && (n < 0 || Math.abs(m - want) < Math.abs(n - want))) n = m;
      e.speed = n / span;                                    // digits a ms: it is on its digit exactly at the lock
    }
    /** Where a drum is at t, in digits rolled since it powered on. */
    const drumAt = (e, t) => Math.max(0, Math.min(t, e.lock) - e.arr) * e.speed;

    let count = 0;

    /* --- helpers ----------------------------------------------------------- */

    function stamp(img, x, y, size, a) {
      if (a <= 0.004 || size <= 0.5) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      count++;
    }

    /** A big four-point glint, drawn as two thin streaks round a small core (a big square sprite costs far more). */
    function glint(x, y, size, a) {
      if (a <= 0.004 || size <= 1) return;
      const th = size * 0.075;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(tex.streak, x - size / 2, y - th, size, th * 2);
      ctx.drawImage(tex.vstreak, x - th, y - size / 2, th * 2, size);
      count += 2;
      stamp(tex.glow, x, y, size * 0.32, a);
    }

    /** How lit a part of the display is once the vertical scan has passed x (it flickers on). */
    function lit(x, t) {
      const t0 = T_VSCAN0 + (T_VSCAN1 - T_VSCAN0) * clamp(x / W, 0, 1);
      if (t < t0) return 0;
      const d = t - t0;
      if (d < 150) return ((d / 38) | 0) % 2 ? 0.3 : 1;
      return 1;
    }

    /* --- layers ------------------------------------------------------------ */

    function drawBoot(t) {
      if (t > T_SPLIT1 + 700) return;
      ctx.globalCompositeOperation = 'lighter';
      // A faint flash over the whole frame, well under a quarter of full brightness (its last few
      // per cent go a little early: a whole-frame fill is the dearest thing drawn in these frames).
      if (t < 290) {
        ctx.globalAlpha = 0.16 * Math.pow(1 - t / 420, 1.7) * (1 - smooth(190, 290, t));
        ctx.fillStyle = flashGrad;
        ctx.fillRect(0, 0, W, H);
        count++;
      }
      const y = H / 2;
      // The power-on line: from a point to the full width.
      const lineA = 1 - smooth(T_SPLIT0 + 40, T_SPLIT0 + 520, t);
      if (lineA > 0.004) {
        const reach = W * 0.56 * easeOut(clamp(t / T_LINE, 0, 1)) + 4;
        ctx.globalAlpha = lineA;
        ctx.drawImage(tex.streak, W / 2 - reach, y - 30 * k, reach * 2, 60 * k);
        ctx.fillStyle = WHITE;
        ctx.globalAlpha = lineA * 0.9;
        ctx.fillRect(W / 2 - reach * 0.88, y - 1.1 * k, reach * 1.76, 2.2 * k);
        count += 2;
        stamp(tex.glow, W / 2, y, H * 0.34 * (1 - 0.4 * smooth(0, 520, t)), lineA * 0.9);
        glint(W / 2, y, H * (0.5 - 0.25 * smooth(0, 520, t)), lineA);
      }
      // It splits into two scan lines that sweep to the edges, leaving a raster that fades.
      if (t > T_SPLIT0) {
        const u = smooth(T_SPLIT0, T_SPLIT1, t);
        const yu = y - y * u;
        const yd = y + (H - y) * u;
        const a = 1 - smooth(T_SPLIT1 - 160, T_SPLIT1 + 280, t);
        if (a > 0.004) {
          ctx.globalAlpha = a * 0.7;
          ctx.drawImage(tex.band, 0, yu - 16 * k, W, 32 * k);
          ctx.drawImage(tex.band, 0, yd - 16 * k, W, 32 * k);
          ctx.fillStyle = SILVER;
          ctx.globalAlpha = a;
          ctx.fillRect(0, yu - 0.8 * k, W, 1.6 * k);
          ctx.fillRect(0, yd - 0.8 * k, W, 1.6 * k);
          count += 4;
        }
        const ra = 0.14 * (1 - smooth(T_SPLIT0 + 250, T_SPLIT1 + 600, t));
        if (ra > 0.004) {
          const gap = Math.max(6, H / 34);
          ctx.fillStyle = ICE;
          ctx.globalAlpha = ra;
          for (let ly = y - Math.floor(y / gap) * gap; ly < H; ly += gap) {
            if (ly <= yu || ly >= yd) continue;
            ctx.fillRect(0, ly, W, Math.max(1, k));
            count++;
          }
        }
      }
    }

    function drawVScan(t) {
      if (t < T_VSCAN0 || t > T_VSCAN1 + 160) return;
      const x = W * (t - T_VSCAN0) / (T_VSCAN1 - T_VSCAN0);
      const a = smooth(T_VSCAN0, T_VSCAN0 + 90, t) * (1 - smooth(T_VSCAN1 - 120, T_VSCAN1 + 160, t));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.5;
      ctx.drawImage(tex.vband, x - 18 * k, 0, 36 * k, H);
      ctx.fillStyle = SILVER;
      ctx.globalAlpha = a * 0.75;
      ctx.fillRect(x - 0.6 * k, 0, 1.2 * k, H);
      count += 2;
    }

    /* The display's lines are thin and light; each one gets a faint dark edge so it still reads
       over a bright scene (on a dark one the edge disappears). Rectangles are queued and drawn in
       two passes, the edges first. */
    const SH = Math.max(1, 1.15 * k);
    const RB = new Float32Array(5 * 400);
    let rbN = 0;
    function hudRect(x, y, w, h, a) {
      if (a <= 0.01 || rbN >= 400) return;
      const o = rbN * 5;
      RB[o] = x; RB[o + 1] = y; RB[o + 2] = w; RB[o + 3] = h; RB[o + 4] = a;
      rbN++;
    }
    function hudBracket(x, y, dx, dy, w, a) {
      hudRect(dx < 0 ? x + dx : x - w / 2, y - w / 2, Math.abs(dx) + w / 2, w, a);
      hudRect(x - w / 2, dy < 0 ? y + dy : y - w / 2, w, Math.abs(dy) + w / 2, a);
    }
    function hudFlush(color) {
      if (!rbN) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      for (let i = 0; i < rbN; i++) {
        const o = i * 5;
        ctx.globalAlpha = RB[o + 4] * EDGE_A;
        ctx.fillRect(RB[o] - SH, RB[o + 1] - SH, RB[o + 2] + SH * 2, RB[o + 3] + SH * 2);
      }
      ctx.fillStyle = color;
      for (let i = 0; i < rbN; i++) {
        const o = i * 5;
        ctx.globalAlpha = RB[o + 4];
        ctx.fillRect(RB[o], RB[o + 1], RB[o + 2], RB[o + 3]);
      }
      count += rbN * 2;
      rbN = 0;
    }
    /** Strokes the current path as a line of the display: the dark edge, then the line. */
    function hudStroke(color, a, w) {
      if (a <= 0.01) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000';
      ctx.globalAlpha = a * EDGE_A;
      ctx.lineWidth = w + SH * 2;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      ctx.stroke();
      count += 2;
    }
    function hudTriangle(x0, y0, x1, y1, x2, y2, color, a) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.closePath();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = '#000';
      ctx.globalAlpha = a * EDGE_A;
      ctx.lineWidth = SH * 2;
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.globalAlpha = a;
      ctx.fill();
      count += 2;
    }

    /** The display's frame: corner marks, side scales, heading tape, horizon. */
    function drawFrame(t, lo) {
      if (t < T_VSCAN0) return;
      const off = smooth(T_DOWN, T_DOWN + 620, t);
      if (off >= 1) return;
      const keep = 1 - off;
      const w = Math.max(1, 1.6 * k);
      // Corner marks of the screen.
      const ix = W * 0.03;
      const iy = H * 0.05;
      const arm = H * 0.06 * keep;
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1;
        const sy = c & 2 ? 1 : -1;
        const x = sx < 0 ? ix : W - ix;
        hudBracket(x, sy < 0 ? iy : H - iy, -sx * arm, -sy * arm, w, lit(x, t) * 0.62 * keep);
      }
      // Side scales, scrolling slowly, with a red marker at the horizon.
      const tapeY = clamp(BY, H * 0.3, H * 0.7);
      const tapeH = Math.min(H * 0.27, tapeY - H * 0.1, H * 0.95 - tapeY) * keep;
      const step = H * 0.022;
      const scroll = (t * 0.018 * H / 1000 + spin(t) * H * 0.02) % (step * 5);
      const marks = [];
      for (let side = 0; side < 2; side++) {
        const x = side ? W * 0.94 : W * 0.06;
        const a = lit(x, t) * keep;
        if (a <= 0.01 || tapeH < 2) continue;
        const dir = side ? -1 : 1;                    // ticks point into the picture
        hudRect(x - w / 2, tapeY - tapeH, w, tapeH * 2, 0.5 * a);
        for (let i = -40; i <= 40; i++) {
          const yy = tapeY + i * step + scroll - step * 2.5;
          const d = Math.abs(yy - tapeY) / tapeH;
          if (d > 1) continue;
          const major = ((i % 5) + 5) % 5 === 0;
          if (lo && !major && i % 2) continue;
          const len = (major ? 0.024 : 0.011) * H;
          hudRect(dir > 0 ? x : x - len, yy - w / 2, len, w, (major ? 0.75 : 0.45) * a * (1 - d * d));
        }
        marks.push([x + dir * H * 0.034, tapeY, dir, a]);
      }
      // The heading tape along the top, turning with the reticle; each tick lights up as the scan passes.
      const hy = H * 0.07;
      const hw = W * 0.17 * keep;
      const hstep = W * 0.0115;
      const hscroll = ((spin(t) * W * 0.04) % (hstep * 5) + hstep * 5) % (hstep * 5);
      const ca = lit(W / 2, t) * keep;
      if (hw > 2) {
        for (let i = -30; i <= 30; i++) {
          const xx = W / 2 + i * hstep - hscroll + hstep * 2.5;
          const d = Math.abs(xx - W / 2) / hw;
          if (d > 1) continue;
          const major = ((i % 5) + 5) % 5 === 0;
          if (lo && !major && i % 2) continue;
          const len = (major ? 0.022 : 0.01) * H;
          hudRect(xx - w / 2, hy - len, w, len, (major ? 0.72 : 0.42) * lit(xx, t) * keep * (1 - d * d));
        }
        hudRect(W / 2 - hw, hy, hw * 2, w, 0.4 * ca);
      }
      // The horizon beside the words, from the scales to the reticle.
      const ha = smooth(T_LOCK - 250, T_LOCK + 350, t) * keep;
      if (ha > 0.01) {
        let gapHalf = R1 * 1.16;
        for (const b of BOXES) if (BY > b.y0 && BY < b.y1) gapHalf = Math.max(gapHalf, Math.max(BX - b.x0, b.x1 - BX) + TS * 0.25);
        const outer = W * 0.44 - H * 0.05;
        if (outer > gapHalf) {
          const reach = lerp(gapHalf, outer, keep);
          hudRect(BX - reach, BY - w / 2, reach - gapHalf, w, 0.55 * ha);
          hudRect(BX + gapHalf, BY - w / 2, reach - gapHalf, w, 0.55 * ha);
          hudRect(BX - gapHalf - w, BY - H * 0.012, w * 1.5, H * 0.024, 0.8 * ha);
          hudRect(BX + gapHalf - w * 0.5, BY - H * 0.012, w * 1.5, H * 0.024, 0.8 * ha);
        }
      }
      hudFlush(HUD_CSS);
      // Red markers: on the scales at the horizon, and under the heading tape.
      for (const m of marks) {
        const mx = m[0];
        const my = m[1];
        const dir = m[2];
        hudTriangle(mx - dir * H * 0.004, my, mx + dir * H * 0.014, my - H * 0.009, mx + dir * H * 0.014, my + H * 0.009, RED, 0.9 * m[3]);
      }
      if (hw > 2 && ca > 0.01) {
        hudTriangle(W / 2, hy + H * 0.008, W / 2 - H * 0.009, hy + H * 0.024, W / 2 + H * 0.009, hy + H * 0.024, RED, 0.95 * ca);
      }
    }

    function drawReticle(t, lo) {
      const appear = smooth(T_RET0, T_RET0 + 220, t);
      if (appear <= 0.004 || RR < 2.5) return;
      const rot = spin(t);
      const a = appear * (RR < 12 ? RR / 12 : 1);
      const w = Math.max(1, 1.5 * k);
      const lock = smooth(T_LOCK - 40, T_LOCK + 60, t);
      ctx.lineCap = 'butt';
      // 1. The main ring, open where the words cross it, with short hooks at the openings.
      const nOpen = openArcs(RX, RY, RR);
      ctx.beginPath();
      for (let j = 0; j < nOpen; j++) {
        const a0 = arcs[j * 2];
        const a1 = arcs[j * 2 + 1];
        ctx.moveTo(RX + RR * Math.cos(a0), RY + RR * Math.sin(a0));
        ctx.arc(RX, RY, RR, a0, a1);
        if (a1 - a0 < TAU - 1e-3) {
          ctx.moveTo(RX + RR * 0.94 * Math.cos(a0), RY + RR * 0.94 * Math.sin(a0));
          ctx.lineTo(RX + RR * Math.cos(a0), RY + RR * Math.sin(a0));
          ctx.moveTo(RX + RR * Math.cos(a1), RY + RR * Math.sin(a1));
          ctx.lineTo(RX + RR * 0.94 * Math.cos(a1), RY + RR * 0.94 * Math.sin(a1));
        }
      }
      hudStroke(HUD_CSS, 0.82 * a, w);
      // 2. Ticks round the outside, drawn on in a sweep, turning with the ring.
      const drawn = smooth(T_RET0 + 40, T_RET0 + 640, t);
      const nT = 72;
      ctx.beginPath();
      for (let i = 0; i < nT * drawn; i++) {
        const major = i % 6 === 0;
        if (lo && !major && i % 2) continue;
        const th = rot + (i / nT) * TAU;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const r0 = RR * 1.04;
        const r1 = RR * (major ? 1.115 : 1.07);
        const x0 = RX + c * r0;
        const y0 = RY + s * r0;
        const x1 = RX + c * r1;
        const y1 = RY + s * r1;
        if (blocked(x0, y0) || blocked(x1, y1)) continue;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      hudStroke(HUD_CSS, 0.7 * a, w);
      // 3. Three heavier segments inside, turning the other way; one turns red once locked.
      const nIn = openArcs(RX, RY, RR * 0.9);
      const rot2 = -1.4 * rot + 0.6;
      const sw = Math.max(1.5, 3 * k);
      ctx.beginPath();
      for (let s = lock > 0 ? 1 : 0; s < 3; s++) clippedArc(RX, RY, RR * 0.9, rot2 + s * TAU / 3, TAU / 3 * 0.72, nIn);
      hudStroke(HUD_CSS, 0.6 * a, sw);
      if (lock > 0) {
        ctx.beginPath();
        clippedArc(RX, RY, RR * 0.9, rot2, TAU / 3 * 0.72, nIn);
        hudStroke(css(mix(HUD, RED_RGB, lock)), 0.9 * a, sw);
      }
      // 4. Range arcs above and below with gradations; a marker closes in until the lock.
      const rr = RR * 1.2;
      const span = 0.66;                          // radians each side of straight up
      ctx.beginPath();
      for (let s = 0; s < 2; s++) {
        const mid = s ? Math.PI / 2 : -Math.PI / 2;
        ctx.moveTo(RX + rr * Math.cos(mid - span), RY + rr * Math.sin(mid - span));
        ctx.arc(RX, RY, rr, mid - span, mid + span);
        for (let i = 0; i <= 16; i++) {
          const th = mid - span + (i / 16) * span * 2;
          const len = i % 4 === 0 ? 0.05 : 0.025;
          ctx.moveTo(RX + rr * Math.cos(th), RY + rr * Math.sin(th));
          ctx.lineTo(RX + rr * (1 - len) * Math.cos(th), RY + rr * (1 - len) * Math.sin(th));
        }
      }
      hudStroke(HUD_CSS, 0.55 * a, w);
      // the closing range: a heavier arc from the far end to the marker
      const close = easeOut(smooth(T_RET1 - 200, T_LOCK, t));
      const markA = -Math.PI / 2 - span + span * close;
      ctx.beginPath();
      ctx.arc(RX, RY, rr * 1.03, -Math.PI / 2 - span, markA);
      hudStroke(css(mix(HUD, RED_RGB, lock)), (0.85 - 0.35 * smooth(T_LOCK + 600, T_LOCK + 1500, t)) * a, Math.max(2, 3.5 * k));
      // the marker itself: a red caret on the arc, pointing at the centre
      {
        const blink = t > T_LOCK + 900 ? 0.65 + 0.35 * Math.cos((t - T_LOCK) * 0.006) : 1;
        const mxp = RX + rr * 1.06 * Math.cos(markA);
        const myp = RY + rr * 1.06 * Math.sin(markA);
        const ca = Math.cos(markA);
        const sa = Math.sin(markA);
        const sz = Math.max(5, 11 * k);
        hudTriangle(mxp - ca * sz * 0.2, myp - sa * sz * 0.2, mxp + ca * sz + sa * sz * 0.7, myp + sa * sz - ca * sz * 0.7,
          mxp + ca * sz - sa * sz * 0.7, myp + sa * sz + ca * sz * 0.7, RED, 0.95 * a * blink);
      }
      // 5. Chevrons above and below the centre, snapping in at the lock; the crosshair beyond the ring.
      const cr = RR * (0.84 + 0.12 * (1 - backOutLock(t)));
      const cw = RR * 0.07;
      ctx.beginPath();
      for (let s = -1; s <= 1; s += 2) {
        const yy = RY + s * cr;
        if (blocked(RX, yy) || blocked(RX - cw, yy - s * cw * 0.6)) continue;
        ctx.moveTo(RX - cw, yy + s * cw * 0.6);
        ctx.lineTo(RX, yy);
        ctx.lineTo(RX + cw, yy + s * cw * 0.6);
      }
      hudStroke(css(mix(HUD, RED_RGB, lock * 0.85)), 0.9 * a, Math.max(1.5, 2.2 * k));
      const vy0 = RR * 1.26;
      const vy1 = RR * 1.5;
      hudRect(RX - w / 2, RY - vy1, w, vy1 - vy0, 0.75 * a);
      hudRect(RX - w / 2, RY + vy0, w, vy1 - vy0, 0.75 * a);
      hudFlush(HUD_CSS);
      // While the finale's two rounds close in, the crosshair above the ring turns red and reaches up to them.
      const fd = t - T_FIN_BURST;
      const aim = smooth(-620, -420, fd) * (1 - smooth(0, 260, fd)) * a;
      if (aim > 0.01) {
        const top = Math.min(RY - vy1, finY + H * 0.06);
        hudRect(RX - w * 0.75, top, w * 1.5, RY - vy0 - top, 0.95 * aim);
        hudFlush(RED);
      }
    }

    function backOutLock(t) {
      return backOut(smooth(T_LOCK - 160, T_LOCK + 120, t));
    }

    /** How red the lock is: two blinks, then a glow that fades back to silver (and once more for the finale). */
    function lockRed(t) {
      const f = t - T_FIN_BURST;
      const fin = f >= 0 && f < 900 ? (f < 120 ? 1 : 1 - smooth(120, 900, f)) : 0;
      const d = t - T_LOCK;
      if (d < 0) return fin;
      if (d < 150) return 1;
      if (d < 250) return 0.15;
      if (d < 470) return 1;
      return Math.max(fin, 1 - smooth(470, 1300, d));
    }

    function drawBrackets(t) {
      if (t < T_BRK0) return;
      const p = backOut(smooth(T_BRK0, T_BRK1, t));
      const out = easeIn(smooth(T_DOWN, T_DOWN + 520, t));
      const a = smooth(T_BRK0, T_BRK0 + 90, t) * (1 - out);
      if (a <= 0.01) return;
      const red = lockRed(t);
      const breathe = Math.sin((t - T_LOCK) * 0.0033) * 2.2 * k * smooth(T_LOCK + 900, T_LOCK + 1800, t);
      const squeeze = 5 * k * (smooth(T_LOCK - 60, T_LOCK, t) - smooth(T_LOCK + 40, T_LOCK + 260, t));
      const x0 = inkX0 - TS * 0.42;
      const x1 = inkX1 + TS * 0.42;
      const y0 = inkY0 - TS * 0.36;
      const y1 = inkY1 + TS * 0.36;
      const arm = Math.min(TS * 0.62, (x1 - x0) * 0.2);
      const w = Math.max(1.5, 2.6 * k);
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1;
        const sy = c & 2 ? 1 : -1;
        const fx = sx < 0 ? x0 : x1;
        const fy = sy < 0 ? y0 : y1;
        const ox = sx < 0 ? W * 0.03 : W * 0.97;
        const oy = sy < 0 ? H * 0.05 : H * 0.95;
        const push = breathe - squeeze + out * TS * 1.4;
        hudBracket(lerp(ox, fx, p) + sx * push, lerp(oy, fy, p) + sy * push, -sx * arm, -sy * arm, w, 0.95 * a);
      }
      hudFlush(css(mix(HUD, RED_RGB, red)));
      // The lock: red light at each corner and a ring that rushes out.
      const d = t - T_LOCK;
      if (d > 0 && d < 950) {
        ctx.globalCompositeOperation = 'lighter';
        const u = d / 950;
        const fade = Math.pow(1 - u, 1.5);
        for (let c = 0; c < 4; c++) {
          const fx = c & 1 ? x1 : x0;
          const fy = c & 2 ? y1 : y0;
          stamp(tex.red, fx, fy, TS * 1.6, 0.8 * fade * red);
        }
        const r = R1 * (0.95 + 1.5 * easeOut(u));
        ctx.strokeStyle = RED;
        ctx.lineWidth = 12 * k;
        ctx.globalAlpha = 0.14 * fade;
        ctx.beginPath();
        ctx.arc(BX, BY, r, 0, TAU);
        ctx.stroke();
        ctx.lineWidth = Math.max(1.2, 2 * k);
        ctx.globalAlpha = 0.85 * fade;
        ctx.stroke();
        count += 2;
      }
    }

    function sparkPos(j, age, out) {
      const e = (1 - Math.exp(-DRAG * age)) / DRAG;
      out[0] = VX[j] * e;
      out[1] = VY[j] * e + (GRAV / DRAG) * (age - e);
    }
    const P = [0, 0];
    const Q = [0, 0];
    // A tracer flies a ballistic arc from its gun to the top of its climb, where it bursts (u: 0 to 1);
    // the finale's two rounds climb the sides and curve in (a quadratic curve, slowing as they arrive).
    const tracerX = (s, u) => {
      if (!s.guided) return s.x0 + (s.bx - s.x0) * u;
      const e = 1 - (1 - u) * (1 - u);
      return (1 - e) * (1 - e) * s.x0 + 2 * e * (1 - e) * s.px1 + e * e * s.bx;
    };
    const tracerY = (s, u) => {
      if (!s.guided) return s.y0 - (s.y0 - s.by) * (2 * u - u * u);
      const e = 1 - (1 - u) * (1 - u);
      return (1 - e) * (1 - e) * s.y0 + 2 * e * (1 - e) * s.py1 + e * e * s.by;
    };

    function drawSalvo(t, lo, fadeAll) {
      ctx.globalCompositeOperation = 'lighter';
      const wordsTop = inkY0 - TS * 0.5;
      // Muzzle flashes and tracers.
      for (const s of shots) {
        const d = t - s.t0;
        if (d < 0 || t > s.tb + 30) continue;
        if (d < 200) {
          const m = 1 - d / 200;
          stamp(tex.red, s.x0, H, H * 0.2 * (0.6 + 0.4 * m), 0.7 * m * fadeAll);
          stamp(tex.glow, s.x0, H, H * 0.14, 0.6 * m * m * fadeAll);
        }
        const u = Math.min(1, d / s.flight);
        const tail = Math.max(0, u - 0.22);
        const SEG = lo ? 4 : 7;
        ctx.lineCap = 'round';
        for (let i = 0; i < SEG; i++) {
          const q0 = tail + (u - tail) * (i / SEG);
          const q1 = tail + (u - tail) * ((i + 1) / SEG);
          const f = (i + 1) / SEG;
          ctx.strokeStyle = f > 0.67 ? '#ffb3b5' : RED;
          ctx.globalAlpha = 0.95 * Math.pow(f, 1.5) * fadeAll;
          ctx.lineWidth = (1 + 2.8 * f) * k;
          ctx.beginPath();
          ctx.moveTo(tracerX(s, q0), tracerY(s, q0));
          ctx.lineTo(tracerX(s, q1), tracerY(s, q1));
          ctx.stroke();
          count++;
        }
        ctx.lineCap = 'butt';
        const hx = tracerX(s, u);
        const hy = tracerY(s, u);
        stamp(tex.red, hx, hy, 46 * k, 0.75 * fadeAll);
        stamp(sprW, hx, hy, 16 * k, fadeAll);
      }
      // The display marks each burst point just before it goes off.
      ctx.globalCompositeOperation = 'source-over';
      for (const s of shots) {
        const d = t - s.tb;
        if (d < -340 || d > 220 || s.unmarked) continue;
        const inA = smooth(-340, -240, d) * (1 - smooth(30, 220, d));
        if (inA <= 0.01) continue;
        const hs = H * 0.026 * s.size * (1 + 1.4 * (1 - easeOut(smooth(-340, -60, d))));
        const hot = smooth(-30, 20, d);
        const arm = hs * 0.42;
        const w = Math.max(1.2, 2 * k);
        const ma = 0.9 * inA * fadeAll;
        hudBracket(s.bx - hs, s.by - hs, arm, arm, w, ma);
        hudBracket(s.bx + hs, s.by - hs, -arm, arm, w, ma);
        hudBracket(s.bx - hs, s.by + hs, arm, -arm, w, ma);
        hudBracket(s.bx + hs, s.by + hs, -arm, -arm, w, ma);
        hudFlush(css(mix(RED_RGB, [255, 255, 255], hot)));
      }
      ctx.globalCompositeOperation = 'lighter';
      // Bursts: a flash, a ring and the sparks.
      for (const s of shots) {
        const d = t - s.tb;
        if (d < 0 || d > s.maxLife * 1000) continue;
        if (d < 260) {
          const u = d / 260;
          stamp(tex.glow, s.bx, s.by, H * 0.22 * s.size * (0.55 + 0.45 * easeOut(u)), (1 - u) * (1 - u) * fadeAll);
          glint(s.bx, s.by, H * 0.3 * s.size * (1 - 0.4 * u), (1 - u) * fadeAll);
        }
        if (d < 650 && !lo) {
          // the burst's own smoke, lit from inside, drifting down as it thins
          const u = d / 650;
          stamp(tex.haze, s.bx, s.by + H * 0.02 * u, H * (0.11 + 0.07 * easeOut(u)) * s.size, 0.36 * Math.pow(1 - u, 1.6) * smooth(0, 60, d) * fadeAll);
        }
        if (d < 340) {
          const u = d / 340;
          ctx.strokeStyle = SILVER;
          ctx.globalAlpha = 0.75 * (1 - u) * (1 - u) * fadeAll;
          ctx.lineWidth = Math.max(0.8, (3 * (1 - u) + 0.5) * k);
          ctx.beginPath();
          ctx.arc(s.bx, s.by, H * 0.15 * s.size * easeOut(u), 0, TAU);
          ctx.stroke();
          count++;
        }
      }
      for (let c = 0; c < 4; c++) {
        ctx.fillStyle = SPARK_COLS[c];
        ctx.strokeStyle = SPARK_COLS[c];
        const glowSpr = c === 3 ? sprRed : c === 2 ? sprIce : sprW;
        for (const s of shots) {
          const age = (t - s.tb) / 1000;
          if (age < 0 || age > s.maxLife) continue;
          for (let j = s.cs[c]; j < s.ce[c]; j++) {
            if (lo && (j & 1)) continue;
            const life = LIFE[j];
            if (age >= life) continue;
            const f = age / life;
            sparkPos(j, age, P);
            const x = s.bx + P[0];
            const y = s.by + P[1];
            let al = (1 - f * f) * (f < 0.03 ? f / 0.03 : 1);
            if (f > 0.5) al *= 0.6 + 0.4 * Math.sin(age * 38 + PH[j]);
            if (y > wordsTop - H * 0.06) al *= 1 - smooth(wordsTop - H * 0.06, wordsTop + H * 0.02, y);
            al *= fadeAll;
            if (al <= 0.02) continue;
            const sz = SZ[j] * (1 - 0.4 * f);
            // a trail: the path it flew out on, then the streak of its fall
            sparkPos(j, Math.max(0, age - 0.035 - 0.1 * f), Q);
            const qx = s.bx + Q[0];
            const qy = s.by + Q[1];
            const dx = x - qx;
            const dy = y - qy;
            if (dx * dx < dy * dy * 0.1) {
              // falling all but straight down: a thin bar is the same picture and far cheaper than a slanted line
              const tw = sz * 0.5;
              ctx.globalAlpha = al * 0.45;
              ctx.fillRect(x - tw / 2, dy > 0 ? qy : y, tw, Math.abs(dy));
            } else {
              ctx.globalAlpha = al * 0.5;
              ctx.lineWidth = sz * 0.55;
              ctx.beginPath();
              ctx.moveTo(qx, qy);
              ctx.lineTo(x, y);
              ctx.stroke();
            }
            ctx.globalAlpha = al;
            ctx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
            count += 2;
            if (!lo && j % 3 === 0 && f < 0.7) {
              const gs = sz * 5;
              ctx.globalAlpha = al * 0.55;
              ctx.drawImage(glowSpr, x - gs / 2, y - gs / 2, gs, gs);
              count++;
            }
          }
        }
      }
      // Crackle: late glints in the bursts.
      for (const s of shots) {
        const age = (t - s.tb) / 1000;
        if (age < 0.3 || age > 1.5) continue;
        for (let i = 0; i < s.crk.length; i++) {
          if (lo && (i & 1)) continue;
          const cr = s.crk[i];
          const d = age - cr.at;
          if (d < 0 || d > 0.11) continue;
          sparkPos(cr.j, age, P);
          stamp(tex.star, s.bx + P[0], s.by + P[1], 30 * k, (1 - d / 0.11) * fadeAll);
        }
      }
    }

    /** Polishes the letters inside a slanted band: the words again, in plain white, over the steel. */
    function lightLetters(xc, width, slant, alpha) {
      if (alpha <= 0.004 || width <= 0) return;
      const y0 = inkY0 - TS * 0.3;
      const y1 = inkY1 + TS * 0.3;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xc - width / 2 + slant, y0);
      ctx.lineTo(xc + width / 2 + slant, y0);
      ctx.lineTo(xc + width / 2 - slant, y1);
      ctx.lineTo(xc - width / 2 - slant, y1);
      ctx.closePath();
      ctx.clip();
      env.words(alpha > 1 ? 1 : alpha, SHEEN, 1);
      ctx.restore();
      count++;
    }

    /* --- the letters, acquired --------------------------------------------- */

    const TFX = { crop: [0, 0, 1, 1], op: 'source-over', dx: 0, dy: 0 };     // reused: env.glyph reads it at once
    /** Rows v0..v1 of a letter's picture: `src` is the picture, `at` the letter it stands in for (moved down by dy). */
    function part(src, at, fill, a, v0, v1, op, dy) {
      if (v1 <= v0 + 0.001 || a <= 0.004) return;
      TFX.crop[1] = v0;
      TFX.crop[3] = v1;
      TFX.op = op || 'source-over';
      TFX.dx = at.cx - src.cx;
      TFX.dy = dy || 0;
      env.glyph(src, a > 1 ? 1 : a, fill, TFX);
      count++;
    }
    /** The rows of a letter's picture, moved down by dy, that show between y0 and y1 on the screen. */
    function band(src, at, fill, pad, a, dy, y0, y1, op) {
      if (y1 > y0) part(src, at, fill, a, cropAt(at, y0 - dy, pad), cropAt(at, y1 - dy, pad), op, dy);
    }
    /** A digit of the counter while its drum rolls: the digit going out at the top and the next one
     *  coming in from below, both seen through the counter's window (and, while it powers on, only
     *  above the scan line that renders it). */
    function drawDrum(e, t, lo) {
      const g = e.g;
      const pos = drumAt(e, t);
      const i = Math.floor(pos);
      const f = pos - i;
      const pitch = g.size;
      const wy0 = g.cy - pitch / 2;
      let wy1 = g.cy + pitch / 2;
      const p = (t - e.arr) / SCAN_T;
      const sy = p < 1 ? scanY(g, Math.min(1, p / 0.8)) : Infinity;
      if (sy < wy1) wy1 = sy;
      // A drum at full speed smears its digits: two fainter copies (without the dark halo) where
      // they were a moment ago. It stops dead at its lock, crisp.
      const smear = Math.min(pitch * 0.5, (pos - drumAt(e, t - 16)) * pitch);
      for (let s = 0; s < 2; s++) {
        const src = DIG[e.seq[(i + s) % e.seq.length]];
        const dy = (s - f) * pitch;
        if (smear > pitch * 0.03) {
          band(src, g, BLUR, PAD_BARE, 0.16, dy + smear * 0.9, wy0, wy1);
          band(src, g, BLUR, PAD_BARE, 0.34, dy + smear * 0.45, wy0, wy1);
        }
        band(src, g, FILL, PAD_HALO, 0.88, dy, wy0, wy1);
        if (p < 1) band(src, g, SHEEN, PAD_BARE, 0.9, dy, Math.max(wy0, sy - g.size * 0.3), wy1, 'lighter');
      }
      if (p < 0.8) scanLine(g, sy, (1 - smooth(0.64, 0.8, p)) * Math.min(1, p * 10), lo);
    }
    /** The scan line across one letter at y: a white hairline in its glow. */
    function scanLine(g, y, a, lo) {
      if (a <= 0.01) return;
      const s = Math.sqrt(g.size / TS);           // the year's digits are bigger
      const x0 = g.x0 - g.size * 0.16;
      const w = g.x1 - g.x0 + g.size * 0.32;
      ctx.globalCompositeOperation = 'lighter';
      if (!lo) {
        const bh = 10 * k * s;
        ctx.globalAlpha = 0.6 * a;
        ctx.drawImage(tex.band, x0 - g.size * 0.08, y - bh, w + g.size * 0.16, bh * 2);
        count++;
      }
      ctx.fillStyle = WHITE;
      ctx.globalAlpha = a;
      ctx.fillRect(x0, y - 0.75 * k * s, w, Math.max(1, 1.5 * k * s));
      count++;
    }
    // Where the scan line is when it has gone p of the way over a letter (from just above to just below).
    const scanY = (g, p) => g.top - g.size * 0.12 + (g.bottom - g.top + g.size * 0.24) * p;
    /** A letter rendering in: steel above the scan line, the ink just above the line white-hot. The
     *  last fifth of the time the line, faded, takes the rest of the letter's dark halo down with it. */
    function scanIn(src, at, p, a, lo) {
      const q = p / 0.8;
      const y = q < 1 ? scanY(at, q) : lerp(scanY(at, 1), at.cy + at.size * 0.62 + PAD_HALO, (p - 0.8) / 0.2);
      part(src, at, FILL, a, 0, cropAt(at, y, PAD_HALO));
      if (q < 1) {
        part(src, at, SHEEN, 0.9 * a, cropAt(at, y - at.size * 0.3, PAD_BARE), cropAt(at, y, PAD_BARE), 'lighter');
        scanLine(at, y, (1 - smooth(0.8, 1, q)) * Math.min(1, q * 8), lo);
      }
    }
    /** A letter wiped out: the scan line runs down it again and takes the steel away above it. */
    function scanOut(g, p, lo) {
      const y = scanY(g, p);
      const a = 1 - smooth(0.75, 1, p);
      part(g, g, FILL, a, cropAt(g, y, PAD_HALO), 1);
      part(g, g, SHEEN, 0.9 * a, cropAt(g, y, PAD_BARE), cropAt(g, y + g.size * 0.3, PAD_BARE), 'lighter');
      scanLine(g, y, (1 - smooth(0.85, 1, p)) * Math.min(1, p * 8), lo);
    }

    function drawLetters(t, lo) {
      if (t >= T_SETTLED && t < T_OUT0) {
        // every letter in place, nothing moving: the words in one picture (the same pixels)
        env.words(1, FILL, 1);
        count++;
      } else {
        for (const e of LET) {
          const d = t - e.arr;
          if (d < 0 || t >= e.out + SCAN_T) continue;
          const g = e.g;
          if (t >= e.out) { scanOut(g, (t - e.out) / SCAN_T, lo); continue; }
          if (e.lock >= 0 && t < e.lock) { drawDrum(e, t, lo); continue; }
          if (e.lock < 0) {
            if (d < SCAN_T) scanIn(g, g, d / SCAN_T, 1, lo);
            else part(g, g, FILL, 1, 0, 1);
            // just rendered: white-hot for a moment
            const da = d - SCAN_T * 0.8;
            if (da > 0 && da < 300) part(g, g, SHEEN, 0.6 * (1 - smooth(0, 300, da)), 0, 1, 'lighter');
          } else {
            // locked: the drum clicks into place, the digit flashes white, then blinks red twice
            const dl = t - e.lock;
            const dy = dl < 200 ? -0.1 * g.size * Math.sin(dl / 22) * Math.exp(-dl / 45) : 0;
            part(g, g, FILL, 1, 0, 1, null, dy);
            if (dl < 80) part(g, g, SHEEN, 0.8 * (1 - dl / 80), 0, 1, 'lighter', dy);
            const red = dl < 50 ? 0 : dl < 115 ? 1 : dl < 165 ? 0 : dl < 235 ? 1 : 1 - smooth(235, 420, dl);
            if (red > 0.01) part(g, g, REDFILL, 0.92 * red, 0, 1, null, dy);
          }
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      // The sheen across the steel.
      if (t < T_DOWN) {
        for (const sh of SHEENS) {
          const d = t - sh[0];
          if (d < 0 || d > sh[1]) continue;
          const u = d / sh[1];
          const span = inkX1 - inkX0;
          const bw = Math.max(TS * 1.6, span * 0.16);
          const xc = inkX0 - bw + (span + bw * 2) * smooth(0, 1, u);
          const env1 = Math.sin(Math.PI * u);
          lightLetters(xc, bw, inkH * 0.32, 0.3 * env1);
          lightLetters(xc, bw * 0.36, inkH * 0.32, 0.55 * env1);
        }
      }
      // Glints that come and go on the letters while they hold.
      const ga = smooth(T_LOCK + 200, T_LOCK + 700, t) * (1 - smooth(T_DOWN - 200, T_DOWN, t));
      if (ga > 0.01 && nPts > 0) {
        const slot = Math.floor(t / 150);
        const within = (t - slot * 150) / 150;
        const nG = lo ? 2 : 4;
        for (let g = 0; g < nG; g++) {
          const r = NOISE[(slot * 7 + g * 131) & 511];
          const p = Math.floor(NOISE[(slot * 13 + g * 37 + 5) & 511] * nPts) * 2;
          if (r < 0.35) continue;
          const a = Math.sin(Math.PI * within) * ga * (0.5 + 0.5 * r);
          stamp(tex.star, wp.pts[p], wp.pts[p + 1], (18 + 16 * r) * k, a);
        }
      }
    }

    /* --- the marks of the acquisition: contacts, the seeker, its boxes ------ */

    const SA = [0, 0, 0, 0];
    const SB = [0, 0, 0, 0];
    const WHITE_RGB = [255, 255, 255];
    const armOf = (b) => clamp(Math.min(b[2] - b[0], b[3] - b[1]) * 0.28, 3, TS * 0.5);
    let MARKS_END = Math.max(T_CONTACTS_END, SEEK_END, T_ACQ_END + HOLD + 340);
    for (const e of COUNTER) MARKS_END = Math.max(MARKS_END, e.lock + 440);
    /** Four corner brackets round the box b = [x0, y0, x1, y1], grown by `grow` (queued for hudFlush). */
    function corners(b, grow, arm, w, a) {
      if (a <= 0.01) return;
      const x0 = b[0] - grow;
      const y0 = b[1] - grow;
      const x1 = b[2] + grow;
      const y1 = b[3] + grow;
      hudBracket(x0, y0, arm, arm, w, a);
      hudBracket(x1, y0, -arm, arm, w, a);
      hudBracket(x0, y1, arm, -arm, w, a);
      hudBracket(x1, y1, -arm, -arm, w, a);
    }
    /** The seeker's home: a small box on the reticle's centre, wherever the reticle is at t. */
    function stopBox(s, t, out) {
      if (s.b) { out[0] = s.b[0]; out[1] = s.b[1]; out[2] = s.b[2]; out[3] = s.b[3]; return; }
      const u = smooth(T_SLIDE0, T_SLIDE1, t);
      const v = u * u * (3 - 2 * u);
      const x = lerp(W / 2, BX, v);
      const y = lerp(H / 2, BY, v);
      const hs = TS * 0.24;
      out[0] = x - hs; out[1] = y - hs; out[2] = x + hs; out[3] = y + hs;
    }

    function drawMarks(t) {
      if (t < T_SPLIT0 || t > MARKS_END) return;
      const wThin = Math.max(1, 1.2 * k);
      const wBox = Math.max(1.3, 2 * k);
      // Contacts: where the boot's scan lines found a letter, flickering on, until it is acquired.
      if (t < T_CONTACTS_END) {
        for (const e of LET) {
          const d = t - e.det;
          if (d < 0) continue;
          const a = 0.5 * (d < 150 ? ((((d / 38) | 0) % 2) ? 0.3 : 1) : 1) * (1 - smooth(e.arr - 60, e.arr, t));
          corners(e.b, -e.g.size * 0.05, e.g.size * 0.11, wThin, a);
        }
      }
      // The box the seeker leaves on each letter as it hops on, fading.
      for (const e of ACQ) {
        const d = t - e.arr - HOLD;
        if (d < 0 || d > 320) continue;
        const u = d / 320;
        corners(e.b, -TS * 0.04 * u, armOf(e.b), wBox, 0.85 * (1 - u) * (1 - u));
      }
      hudFlush(HUD_CSS);
      // The counter's digits: a box snaps onto each as it locks, red, white-hot at the lock.
      for (const e of COUNTER) {
        const d = t - e.lock;
        if (d < -90 || d > 420) continue;
        const grow = e.g.size * 0.3 * (1 - backOut(smooth(-90, 10, d)));
        const hot = smooth(-25, 5, d) * (1 - smooth(60, 220, d));
        corners(e.b, grow, armOf(e.b), wBox, smooth(-90, -60, d) * (1 - smooth(200, 420, d)));
        hudFlush(css(mix(RED_RGB, WHITE_RGB, hot)));
      }
      // The seeker: out of the reticle, along the letters, then onto the year's readout (or home).
      if (t >= T_SEEK - 100 && t < SEEK_END) {
        let j = 0;
        while (j + 1 < STOPS.length && t >= STOPS[j + 1].at) j++;
        const A = STOPS[j];
        const B = STOPS[j + 1];
        stopBox(A, t, SA);
        let grow = 0;
        let hot = 0;
        let a = smooth(T_SEEK - 100, T_SEEK - 40, t);
        if (j === 0 && t < T_SEEK) a *= ((t / 30) | 0) % 2 ? 0.4 : 1;   // it flickers on in the reticle
        if (B) {
          const dep = A.at + Math.min(HOLD, (B.at - A.at) * 0.35);
          if (t > dep) {
            const u = smooth(dep, B.at, t);
            stopBox(B, t, SB);
            for (let i = 0; i < 4; i++) SA[i] = lerp(SA[i], SB[i], u);
            grow = TS * 0.14 * Math.sin(Math.PI * u);
            if (!B.b) a *= 1 - smooth(0.5, 1, u);                         // home again, into the reticle
          }
        }
        if (j > 0 && A.b) {
          const d = t - A.at;
          hot = 1 - smooth(15, 95, d);
          grow -= TS * 0.06 * Math.sin(Math.PI * clamp(d / 90, 0, 1));    // it clamps down on the letter
        }
        if (A === LAST && nC) {
          // the readout's gate: it pulses with each lock and lets go at the last
          for (const e of COUNTER) { const d = t - e.lock; if (d >= 0 && d < 140) hot = Math.max(hot, 0.8 * (1 - d / 140)); }
          const go = smooth(T_LOCK, T_LOCK + 250, t);
          grow += TS * 0.35 * go;
          a *= 1 - go;
        }
        corners(SA, grow, armOf(SA), Math.max(1.5, 2.4 * k), a);
        hudFlush(css(mix(RED_RGB, WHITE_RGB, hot)));
      }
    }

    /** The last of the display: a point of light where the reticle shrank, winking out. */
    function drawPoint(t) {
      const d = t - (T_DOWN + 900);
      if (d < 0 || d > 560) return;
      const u = d / 560;
      const a = Math.sin(Math.PI * Math.min(1, u * 1.6)) * (1 - u);
      ctx.globalCompositeOperation = 'lighter';
      stamp(tex.glow, BX, BY, H * 0.2 * (1 - 0.6 * u), 0.8 * a);
      stamp(tex.star, BX, BY, H * 0.16 * (1 - 0.5 * u), a);
    }

    function draw(t) {
      count = 0;
      if (!(t >= 0) || t >= DURATION) return 0;
      const lo = env.low();
      const fadeAll = 1 - smooth(FADE_FROM, DURATION - 200, t);
      pose(t);
      // which letters are on the screen (the reticle is open round them)
      let anyT = false;
      let anyY = false;
      for (let i = 0; i < NL; i++) {
        const e = LET[i];
        const on = t >= e.arr && t < e.out + SCAN_T * 0.5;
        ON[i] = on ? 1 : 0;
        if (on) { if (e.g.line === 0) anyT = true; else anyY = true; }
      }
      midOn = anyT && anyY && MID !== null;
      ctx.save();
      drawBoot(t);
      drawVScan(t);
      drawFrame(t, lo);
      drawReticle(t, lo);
      drawBrackets(t);
      drawSalvo(t, lo, fadeAll);
      drawLetters(t, lo);
      drawMarks(t);
      drawPoint(t);
      ctx.restore();
      return count;
    }

    return {
      step: function () { /* every frame is drawn from t alone */ },
      draw: draw,
      /**
       * Before midnight: fx.js makes the words' picture and every letter's, in each fill and for the
       * counter's other digits, and keeps them; each is also drawn once, faintly, into one pixel that
       * is wiped at once, with every texture, so the first frames at midnight have nothing left to
       * make or upload.
       */
      prime: function () {
        env.warm(FILL);
        env.warm(SHEEN);
        if (nC) {
          env.warm(REDFILL, L.year, 1);
          env.warm(FILL, '0123456789', 1);
          env.warm(SHEEN, '0123456789', 1);
          env.warm(BLUR, '0123456789', 1);
        }
        const px = clamp(Math.floor(BX * DPR), 0, Math.max(0, ctx.canvas.width - 1));
        const py = clamp(Math.floor((TITLE[0] ? TITLE[0].g.cy : BY) * DPR), 0, Math.max(0, ctx.canvas.height - 1));
        ctx.save();
        try {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.beginPath();
          ctx.rect(px, py, 1, 1);
          ctx.clip();
          ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
          env.words(0.01, FILL, 1);
          env.words(0.01, SHEEN, 1);
          const onPx = (g) => ({ dx: (px + 0.5) / DPR - g.cx, dy: (py + 0.5) / DPR - g.cy });
          const pics = [];
          for (const e of [TITLE[0], YEAR[0]]) if (e) pics.push([e.g, FILL], [e.g, SHEEN]);
          if (nC) pics.push([YEAR[0].g, REDFILL], [DIG[0], FILL], [DIG[0], SHEEN], [DIG[0], BLUR]);
          for (const pc of pics) env.glyph(pc[0], 0.01, pc[1], onPx(pc[0]));
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 0.01;
          for (const img of [tex.glow, tex.red, tex.band, tex.vband, tex.streak, tex.vstreak, tex.star, tex.haze, sprW, sprIce, sprRed]) ctx.drawImage(img, px, py, 1, 1);
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

  APFx.register('warmachine', { name: 'War Machine', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
