/*!
 * Avengers Player: 'tva', branching time (a style for src/fx.js).
 *
 *   0.0 s     the instant it plays: a point of amber light flares in the middle of the frame, a
 *             single timeline shoots out of it to both edges, a ring of light races out to where the
 *             dial will be, and the point stretches into a tall slit.
 *   0.4 s     the slit opens into a tall door of amber light (retro scanlines, a soft CRT flicker, a
 *             rolling bar) and the words switch on like an old screen: a line that opens into them.
 *   0.55 s    an abstract analog dial lights up round the door, a bright point sweeping its ring; its
 *             two hands spin round, one each way, and settle at ten past ten.
 *   0.6-6 s   the timeline branches, and the branches branch again and again: a growing tree of
 *             luminous lines that blooms out towards the edges, every fork flashing as it splits.
 *             Pulses of light run out along the lines while motes drift out of the door.
 *   5.6 s     a surge: the door flares and a wave of light runs out through the whole tree.
 *   7.9 s     the branches are pruned back, the youngest first, into the single line, and the line
 *             is reeled back into the door; the hands wind back to midnight.
 *   10.35 s   the door closes to a vertical slit, which collapses and winks out.
 *   11.3 s    the words and whatever is left fade; nothing is drawn from 12.58 s.
 *
 * Only light is added over the film, and every frame is a function of the seed and t alone (nothing
 * is simulated frame by frame), so renderAt(t), a resize in the middle and the live animation all
 * draw the same picture. Lines are hardly ever stroked per frame (that is slow on a software GPU):
 * the forks, the glows and the door are drawn once into pictures of their own and only stamped, cut
 * to the length that has grown so far.
 */
(function (root) {
  'use strict';

  const APFx = root.APFx;
  if (!APFx || typeof APFx.register !== 'function') return;

  const DURATION = 12800;
  const FADE_FROM = DURATION - 1500;            // everything fades out from here
  const FADE_TO = DURATION - 220;               // and nothing at all is drawn from here on
  const PI = Math.PI;
  const TAU = PI * 2;

  // The words: cream at the top, amber, burnt orange at the foot, in a dark walnut halo.
  const FILL = { stops: [[0, '#fff4dc'], [0.5, '#f4a23c'], [1, '#c8622a']], halo: 'rgba(26,13,5,0.92)' };
  // White glyphs with no halo: the mask the scanlines on the words are cut from.
  const MASK = { stops: [[0, '#ffffff'], [1, '#ffffff']] };

  const AMBER = '#f4a23c';
  const ORANGE = '#c8622a';
  const MUSTARD = '#e9c64a';
  const CREAM = '#fff0cf';
  const HOT = '#ffe3a6';

  const T_LINE = 560;          // the timeline reaches both edges
  const T_SLIT0 = 30;          // the slit grows to the door's height
  const T_SLIT1 = 470;
  const T_OPEN0 = 430;         // the door opens
  const T_OPEN1 = 1350;
  const T_WORDS0 = 360;        // the words switch on
  const T_WORDS1 = 1080;
  const T_DIAL0 = 560;         // the dial lights up from the top
  const T_DIAL1 = 1800;
  const T_HANDS0 = 900;        // the hands spin up (time rushing on) ...
  const T_SPIN = 1700;         // ... for this long, then drift in a ten-past-ten pose
  const T_REWIND = 9300;       // and rewind to midnight
  const REWIND_DUR = 900;
  const T_SURGE = 5600;        // a wave of light runs out through the tree
  const SURGE_V = 1.5;         // px per ms at scale 1
  const SHIMMERS = [1900, 3800, T_SURGE + 120, 7500];   // a band of light rolls down the words
  const T_PRUNE = 7900;        // the youngest branches are pruned first
  const PRUNE_SPAN = 1050;     // ... and the first generation this much later
  const T_BACK0 = 9750;        // the timeline is reeled back into the door
  const BACK_DUR = 750;
  const T_CLOSE0 = 10350;      // the door closes to a slit
  const T_CLOSE1 = 11050;
  const T_WINK = 11300;        // the slit collapses and winks out
  const T_WINK1 = 11730;
  const T_DIALOFF0 = 10150;    // the dial goes out
  const T_DIALOFF1 = 11250;

  // How a line looks in each generation: core width (at scale 1), glow and core colour, brightness.
  const GEN = [
    { cw: 2.6, glow: AMBER, core: CREAM, a: 1 },
    { cw: 2.1, glow: AMBER, core: '#ffd98f', a: 0.96 },
    { cw: 1.85, glow: '#eea23e', core: '#fbcd6c', a: 0.9 },
    { cw: 1.6, glow: '#de8a3a', core: '#f6b450', a: 0.84 },
    { cw: 1.4, glow: '#cf6e2e', core: '#ee9e48', a: 0.77 },
    { cw: 1.25, glow: ORANGE, core: '#e88e40', a: 0.7 }
  ];
  const MUSTARD_CORE = '#fde39a';
  // A line is drawn once as a stack of strokes, widest and faintest first: [width x core, alpha, core colour?].
  const PASSES = [[11, 0.04, 0], [7, 0.07, 0], [4.3, 0.13, 0], [2.6, 0.27, 0], [1.5, 0.66, 1], [0.85, 1, 1]];
  const MIN_DY = [0, 40, 26, 18, 13, 10];       // smallest split worth drawing, per generation
  const WANT_DY = [0, 118, 92, 72, 56, 44];     // how far a branch splits off into free space
  const SPACE = [0, 20, 16, 13, 11, 10];        // closest a branch runs to its neighbour
  const SPEED = [0, 0.62, 0.5, 0.43, 0.37, 0.33]; // growth, px per ms at scale 1

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
  const easeOut = (u) => 1 - (1 - u) * (1 - u) * (1 - u);
  const easeIn = (u) => u * u;
  const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(2 - 2 * u, 3) / 2);
  const easeOutBack = (u) => { const v = u - 1; return 1 + 2.2 * v * v * v + 1.2 * v * v; };
  /** 0 outside [c - w, c + w], rising smoothly to 1 at c. */
  const bump = (t, c, w) => { const u = 1 - Math.abs(t - c) / w; return u <= 0 ? 0 : u * u * (3 - 2 * u); };

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /* ------------------------------------------------------- the layout --- */

  /** Where the door, the dial and the timeline sit, around the words. */
  function geometry(env) {
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const s = env.scale;
    const wp = env.wordPoints(600);
    const cx = W / 2;
    const doorTop = H * 0.075;
    const doorBot = clamp(L.titleY + L.titleSize * 0.12, doorTop + H * 0.28, H * 0.9);
    const dh = doorBot - doorTop;
    const dcy = (doorTop + doorBot) / 2;
    const R = Math.max(dh * 0.4, Math.min(dcy - H * 0.025, W * 0.42));
    // The door is as wide as the dial round it allows (its corners stay inside the ring).
    const inside = (R - 18 * s) * (R - 18 * s) - (dh / 2) * (dh / 2);
    let dw = Math.min(dh * 0.42, W * 0.2);
    if (inside > 0) dw = Math.min(dw, 2 * Math.sqrt(inside));
    dw = Math.max(dw, Math.min(dh * 0.3, W * 0.2));
    const marg = Math.max(L.titleSize * 0.3, 12 * s);
    const wMin = Math.min(wp.minX, cx) - marg;
    const wMax = Math.max(wp.maxX, cx) + marg;
    const fadeY0 = L.top - 95 * s;
    const fadeY1 = L.top - 25 * s;
    // The dial's ring is drawn from the top down to where the words begin (angles from 12 o'clock).
    const arcVis = Math.acos(clamp((dcy - fadeY0) / R, -1, 1));
    const arcEnd = Math.acos(clamp((dcy - fadeY1) / R, -1, 1));
    return {
      cx: cx, doorTop: doorTop, doorBot: doorBot, dh: dh, dcy: dcy, dw: dw, R: R,
      lineY: Math.round(dcy * env.dpr) / env.dpr,
      dMin: R * 0.8,                                    // the first forks, just inside the ring
      E: W / 2 + 30 * s,                                // a tip this far from the middle is off screen
      wordsHalf: Math.max(cx - wMin, wMax - cx) + 30 * s, // no branch dips below wordsTop closer than this
      wordsTop: L.top - 14 * s,
      wMin: wMin, wMax: wMax,
      yTop: H * 0.04, yBot: H * 0.965,
      fadeY0: fadeY0, fadeY1: fadeY1, arcVis: arcVis, arcEnd: Math.max(arcVis, arcEnd),
      wordsMid: (L.top + L.bottom) / 2
    };
  }

  /**
   * The tree of timelines. Swept outward from the middle, each fork splits the free space between
   * a line and its neighbour (or the open space beyond the outermost line), so no two lines ever
   * cross and the tree fans out towards the edges. Each side of the frame grows its own tree.
   */
  function growTree(env, G) {
    const rnd = env.rnd;
    const s = env.scale;
    const dpr = env.dpr;
    const qy = (y) => Math.round(y * dpr) / dpr;
    const all = [];
    const mains = [];
    for (let si = 0; si < 2; si++) {
      const side = si === 0 ? 1 : -1;
      const main = { side: side, gen: 0, d0: 0, d1: 0, Lf: 0, yP: G.lineY, yT: G.lineY, dy: 0, len: G.E, kids: [], parent: null };
      mains.push(main);
      const lines = [{ y: G.lineY, b: main, up: G.dMin, dn: G.dMin }];
      let d = G.dMin + rnd() * 20 * s;
      let made = 0;
      const weights = [];
      while (d < G.E - 90 * s && made < 30) {
        let total = 0;
        weights.length = 0;
        const floor = d < G.wordsHalf ? Math.min(G.wordsTop, G.yBot) : G.yBot;
        for (let i = 0; i < lines.length; i++) {
          const ln = lines[i];
          let w = 0;
          if (ln.b.gen < 5 && (ln.up <= d || ln.dn <= d)) {
            const up = ln.up <= d ? ln.y - (i > 0 ? lines[i - 1].y : G.yTop) : 0;
            const dn = ln.dn <= d ? (i < lines.length - 1 ? lines[i + 1].y : floor) - ln.y : 0;
            w = (ln.b.gen === 0 ? 1.6 : 1) * (0.4 + Math.min(1.6, Math.max(up, dn) / (110 * s)));
            if (i === 0 || i === lines.length - 1) w *= 2;     // the outermost lines bloom outward
          }
          weights.push(w);
          total += w;
        }
        if (total > 0) {
          let pick = rnd() * total;
          let i = 0;
          while (i < lines.length - 1 && (pick > weights[i] || weights[i] === 0)) { pick -= weights[i]; i++; }
          if (weights[i] > 0 && fork(lines, i, d, floor)) made++;
        }
        d += (7 + rnd() * 16) * s;
      }

      function fork(lines, i, d, floor) {
        const ln = lines[i];
        const g = ln.b.gen + 1;
        const y = ln.y;
        const above = i > 0 ? lines[i - 1].y : null;
        const below = i < lines.length - 1 ? lines[i + 1].y : null;
        const sp = SPACE[g] * s;
        const minDy = MIN_DY[g] * s;
        let upRoom = -1;
        let dnRoom = -1;
        if (ln.up <= d) upRoom = y - (above != null ? above + sp : G.yTop);
        if (ln.dn <= d) dnRoom = (below != null ? below - sp : floor) - y;
        const canUp = upRoom >= minDy;
        const canDn = dnRoom >= minDy;
        if (!canUp && !canDn) return false;
        const dir = canUp && canDn ? (rnd() * (upRoom + dnRoom) < upRoom ? -1 : 1) : canUp ? -1 : 1;
        const room = dir < 0 ? upRoom : dnRoom;
        const inner = dir < 0 ? above != null : below != null;
        // Between two lines: about halfway. Into open space: a generous split (deeper still into
        // the free corners beside the words).
        let dy;
        if (inner) dy = (room + sp) * (0.4 + rnd() * 0.2);
        else dy = WANT_DY[g] * s * (0.75 + rnd() * 0.6) * (dir > 0 && floor === G.yBot ? 1.7 : dir < 0 ? 1.2 : 1);
        dy = Math.min(dy, room);
        if (dy < minDy) return false;
        const Lf = clamp(dy * (1.08 + rnd() * 0.6), 34 * s, 300 * s);
        if (d + Lf > G.E - 60 * s) return false;
        const yT = qy(y + dir * dy);
        const qd = (v) => side * (Math.round((G.cx + side * v) * dpr) / dpr - G.cx);
        const d0 = qd(d);
        const d1 = qd(d + Lf);
        const b = {
          side: side, gen: g, d0: d0, d1: d1, Lf: d1 - d0, yP: y, yT: yT, dy: yT - y, len: G.E - d0,
          kids: [], parent: ln.b, mustard: rnd() < 0.22
        };
        ln.b.kids.push(b);
        all.push(b);
        lines.splice(dir < 0 ? i : i + 1, 0, { y: b.yT, b: b, up: d + Lf + 22 * s, dn: d + Lf + 22 * s });
        if (dir < 0) ln.up = d + Lf + 14 * s; else ln.dn = d + Lf + 14 * s;
        return true;
      }
    }

    // When each branch grows: it splits once its parent has grown past the fork, a little later.
    const mainAt = (d) => T_LINE * (1 - Math.cbrt(Math.max(0, 1 - d / G.E)));
    for (const b of all) {
      const p = b.parent;
      const reach = p.gen === 0 ? mainAt(b.d0) : p.ts + (b.d0 - p.d0) / p.v;
      const delay = 110 + rnd() * 240 + (b.gen - 1) * rnd() * 360;
      b.ts = Math.max(reach + delay, b.gen === 1 ? 640 + rnd() * 380 : 0);
      b.v = (SPEED[b.gen] + rnd() * 0.18) * s;
      // pulses of light that run out along the line once it has grown
      b.pv = (0.8 + rnd() * 0.4) * s;
      b.pP = b.len / b.pv + 300 + rnd() * 1500;
      b.pPh = 250 + rnd() * b.pP;
    }

    // Pruning: the youngest generation goes first, and a branch is always gone before its parent
    // has been cut back past it.
    let maxGen = 1;
    for (const b of all) if (b.gen > maxGen) maxGen = b.gen;
    const stepG = PRUNE_SPAN / Math.max(1, maxGen - 1);
    for (let g = maxGen; g >= 1; g--) {
      for (const b of all) {
        if (b.gen !== g) continue;
        b.vr = (1.3 + rnd() * 0.5) * s;
        let pr = T_PRUNE + (maxGen - g) * stepG + rnd() * 240;
        for (const c of b.kids) pr = Math.max(pr, c.prEnd + 40 - (G.E - c.d0) / b.vr);
        b.pr = pr;
        b.prEnd = pr + b.len / b.vr;
      }
    }
    let back0 = T_BACK0;
    for (const m of mains) {
      for (const c of m.kids) back0 = Math.max(back0, c.prEnd + 40 - BACK_DUR * Math.sqrt(Math.max(0, 1 - c.d0 / G.E)));
    }
    // Draw order: the oldest generations first.
    all.sort((a, b) => a.gen - b.gen || a.ts - b.ts);
    return { all: all, back0: back0, maxGen: maxGen };
  }

  /* -------------------------------------------------- pictures (once) --- */

  // Kept for the life of the page (prime() makes them before midnight; play() finds them ready).
  let CACHE = null;

  function strokeLine(g, path, cw, glow, core) {
    for (const p of PASSES) {
      g.globalAlpha = p[1];
      g.strokeStyle = p[2] ? core : glow;
      g.lineWidth = cw * p[0];
      path(g);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** A short horizontal piece of glowing line, stretched to any length when it is drawn. */
  function lineStrip(cw, glow, core, dpr) {
    const pad = Math.ceil(5.7 * cw * dpr) + 2;
    const c = canvas(4, pad * 2);
    const g = c.getContext('2d');
    g.lineCap = 'butt';
    strokeLine(g, (q) => { q.beginPath(); q.moveTo(-4, pad); q.lineTo(8, pad); }, cw * dpr, glow, core);
    return c;
  }

  /**
   * A soft round glow that fades to its own colour made transparent (a glow that fades to
   * transparent black leaves a grey fringe over a bright picture).
   */
  function glowSprite(r, g, b) {
    const c = canvas(64, 64);
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    const col = (a) => 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    gr.addColorStop(0, col(0.95));
    gr.addColorStop(0.2, col(0.78));
    gr.addColorStop(0.5, col(0.24));
    gr.addColorStop(0.75, col(0.06));
    gr.addColorStop(1, col(0));
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return c;
  }

  function radialTex(size, stops) {
    const c = canvas(size, size);
    const g = c.getContext('2d');
    const r = size / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    for (const st of stops) gr.addColorStop(st[0], st[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }

  /** A lens streak: bright in the middle, fading along its length and across it. */
  function flareTex(horizontal) {
    const long = 256;
    const thin = 32;
    const c = horizontal ? canvas(long, thin) : canvas(thin, long);
    const g = c.getContext('2d');
    const a = horizontal ? g.createLinearGradient(0, 0, long, 0) : g.createLinearGradient(0, 0, 0, long);
    a.addColorStop(0, 'rgba(244,140,50,0)');
    a.addColorStop(0.3, 'rgba(244,150,60,0.28)');
    a.addColorStop(0.47, 'rgba(255,214,150,0.85)');
    a.addColorStop(0.5, 'rgba(255,244,214,1)');
    a.addColorStop(0.53, 'rgba(255,214,150,0.85)');
    a.addColorStop(0.7, 'rgba(244,150,60,0.28)');
    a.addColorStop(1, 'rgba(244,140,50,0)');
    g.fillStyle = a;
    g.fillRect(0, 0, c.width, c.height);
    const b = horizontal ? g.createLinearGradient(0, 0, 0, thin) : g.createLinearGradient(0, 0, thin, 0);
    b.addColorStop(0, 'rgba(0,0,0,0)');
    b.addColorStop(0.5, 'rgba(0,0,0,1)');
    b.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = b;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /**
   * The light a door of this shape throws round itself: a soft glow made of many faint rounded
   * rectangles (no blur filter needed), fading towards its foot. It is drawn in eight pieces round
   * the opening; the middle one, where the door itself is, is never drawn.
   */
  function boxGlow(wIn, hIn, m, fadeFrom) {
    const c = canvas(wIn + 2 * m, hIn + 2 * m);
    const g = c.getContext('2d');
    const steps = 26;
    for (let k = 0; k < steps; k++) {
      const e = m * (1 - k / steps);
      g.globalAlpha = 0.055;
      g.fillStyle = k < steps * 0.45 ? ORANGE : AMBER;
      roundRect(g, m - e, m - e, wIn + 2 * e, hIn + 2 * e, e + 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-in';
    const gr = g.createLinearGradient(0, 0, 0, c.height);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(clamp((m + hIn * fadeFrom) / c.height, 0.05, 0.95), 'rgba(0,0,0,0.9)');
    gr.addColorStop(1, 'rgba(0,0,0,0.12)');
    g.fillStyle = gr;
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  function buildPictures(env, G, tree, key) {
    const W = env.W;
    const L = env.layout;
    const s = env.scale;
    const dpr = env.dpr;
    const P = { key: key };
    const scan = Math.max(2, Math.round(3 * s * dpr));      // scanline period, in device pixels
    const scanOn = Math.max(1, Math.round(scan * 0.5));

    // Straight runs of line, one per generation (and the mustard variety).
    P.strips = GEN.map((st) => lineStrip(st.cw * s, st.glow, st.core, dpr));
    P.mustard = GEN.map((st) => lineStrip(st.cw * s, MUSTARD, MUSTARD_CORE, dpr));

    // Every fork, drawn once into one atlas: the S of the split with its glow.
    const AW = 2048;
    const boxes = tree.all.map((b) => {
      const pad = 5.7 * GEN[b.gen].cw * s + 1.5;
      const x0 = b.side > 0 ? G.cx + b.d0 : G.cx - b.d1;           // the fork's S, left to right
      const x1 = b.side > 0 ? G.cx + b.d1 : G.cx - b.d0;
      b.bxD = Math.round(x0 * dpr);
      b.bwD = Math.max(1, Math.round(x1 * dpr) - b.bxD);
      b.byD = Math.floor((Math.min(b.yP, b.yT) - pad) * dpr);
      b.bhD = Math.ceil((Math.max(b.yP, b.yT) + pad) * dpr) - b.byD;
      return { b: b, w: b.bwD + 2, h: b.bhD + 2 };
    });
    boxes.sort((p, q) => q.h - p.h);
    let x = 0;
    let y = 0;
    let rowH = 0;
    for (const bx of boxes) {
      if (x + bx.w > AW) { x = 0; y += rowH; rowH = 0; }
      bx.b.ax = x + 1;
      bx.b.ay = y + 1;
      x += bx.w;
      if (bx.h > rowH) rowH = bx.h;
    }
    const atlas = canvas(AW, Math.max(1, y + rowH));
    const ag = atlas.getContext('2d');
    ag.lineCap = 'butt';
    ag.lineJoin = 'round';
    for (const bx of boxes) {
      const b = bx.b;
      const st = GEN[b.gen];
      // Each S is drawn clipped to its own box, running on a little past the end so that it
      // meets the straight run it turns into without a seam.
      ag.save();
      ag.setTransform(1, 0, 0, 1, 0, 0);
      ag.beginPath();
      ag.rect(b.ax, b.ay, b.bwD, b.bhD);
      ag.clip();
      ag.setTransform(dpr, 0, 0, dpr, b.ax - b.bxD, b.ay - b.byD);
      const x0 = G.cx + b.side * b.d0;
      strokeLine(ag, (q) => {
        q.beginPath();
        for (let k = 0; k <= 32; k++) {
          const u = k / 32;
          const px = x0 + b.side * b.Lf * u;
          const py = b.yP + b.dy * (0.5 - 0.5 * Math.cos(PI * u));
          if (k === 0) q.moveTo(px, py); else q.lineTo(px, py);
        }
        q.lineTo(x0 + b.side * (b.Lf + 6), b.yT);
      }, st.cw * s, b.mustard ? MUSTARD : st.glow, b.mustard ? MUSTARD_CORE : st.core);
      ag.restore();
      // The branch comes out of its parent's line: its first few pixels fade in, so its glow does
      // not start with a hard edge on top of the parent's.
      const ramp = Math.min(b.bwD, Math.round(14 * s * dpr));
      const fx0 = b.side > 0 ? b.ax : b.ax + b.bwD;
      const fade = ag.createLinearGradient(fx0, 0, fx0 + b.side * ramp, 0);
      fade.addColorStop(0, 'rgba(0,0,0,1)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      ag.setTransform(1, 0, 0, 1, 0, 0);
      ag.globalCompositeOperation = 'destination-out';
      ag.fillStyle = fade;
      ag.fillRect(b.side > 0 ? b.ax : b.ax + b.bwD - ramp, b.ay, ramp, b.bhD);
      ag.globalCompositeOperation = 'source-over';
    }
    P.atlas = atlas;

    // The door's light: hot in the middle, warm at the jambs, dying away behind the words, cut by
    // scanlines. It is drawn narrow and stretched to whatever width the door has opened to.
    const dhD = Math.max(4, Math.round(G.dh * dpr));
    const behind = clamp((L.top - 20 * s - G.doorTop) / G.dh, 0.3, 0.94);
    const door = canvas(64, dhD);
    let g = door.getContext('2d');
    let gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(255,150,52,1)');
    gr.addColorStop(0.1, 'rgba(255,166,66,0.86)');
    gr.addColorStop(0.5, 'rgba(255,192,96,0.95)');
    gr.addColorStop(0.9, 'rgba(255,166,66,0.86)');
    gr.addColorStop(1, 'rgba(255,150,52,1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, dhD);
    g.globalCompositeOperation = 'destination-in';
    gr = g.createLinearGradient(0, 0, 0, dhD);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(behind * 0.7, 'rgba(0,0,0,0.9)');
    gr.addColorStop(behind, 'rgba(0,0,0,0.5)');
    gr.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, dhD);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let yy = 0; yy < dhD; yy += scan) g.fillRect(0, yy + scanOn, 64, scan - scanOn);
    // a hotter top, where the light comes from, and a deeper orange towards the foot
    g.globalCompositeOperation = 'source-atop';
    gr = g.createLinearGradient(0, 0, 0, dhD);
    gr.addColorStop(0, 'rgba(255,240,200,0.5)');
    gr.addColorStop(0.3, 'rgba(255,214,140,0.12)');
    gr.addColorStop(0.55, 'rgba(255,200,120,0)');
    gr.addColorStop(1, 'rgba(200,98,42,0.3)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, dhD);
    P.door = door;

    // The jambs: a vertical glowing line the height of the door, fading out behind the words.
    const ecw = 2.7 * s;
    const epad = Math.ceil(5.7 * ecw * dpr) + 2;
    const edge = canvas(epad * 2, dhD);
    g = edge.getContext('2d');
    g.lineCap = 'butt';
    strokeLine(g, (q) => { q.beginPath(); q.moveTo(epad, -4); q.lineTo(epad, dhD + 4); }, ecw * dpr, AMBER, CREAM);
    g.globalCompositeOperation = 'destination-in';
    gr = g.createLinearGradient(0, 0, 0, dhD);
    gr.addColorStop(0, 'rgba(0,0,0,1)');
    gr.addColorStop(Math.max(0, behind - 0.08), 'rgba(0,0,0,1)');
    gr.addColorStop(1, 'rgba(0,0,0,0.14)');
    g.fillStyle = gr;
    g.fillRect(0, 0, edge.width, dhD);
    P.edge = edge;

    // The glow round the door, a quarter size (it is soft) and stretched to the door.
    const q = 0.25;
    P.glowM = 90 * s;
    P.glowCut = Math.max(4, Math.round(P.glowM * q));
    P.glow = boxGlow(Math.max(4, Math.round(G.dw * q)), Math.max(4, Math.round(G.dh * q)), P.glowCut, behind);

    P.flash = radialTex(128, [[0, 'rgba(255,246,220,1)'], [0.12, 'rgba(255,220,160,0.85)'], [0.35, 'rgba(244,162,60,0.32)'], [0.7, 'rgba(200,98,42,0.07)'], [1, 'rgba(200,98,42,0)']]);
    P.flareH = flareTex(true);
    P.flareV = flareTex(false);
    // A small ring that blooms where a branch splits off (light colours only: it must not grey a
    // bright picture).
    const ring = canvas(64, 64);
    g = ring.getContext('2d');
    strokeLine(g, (q2) => { q2.beginPath(); q2.arc(32, 32, 22, 0, TAU); }, 1.5, '#ffd9a0', '#fff3d8');
    P.ring = ring;
    P.spr = { hot: glowSprite(255, 227, 166), amber: glowSprite(247, 172, 76), mustard: glowSprite(236, 202, 92), cream: glowSprite(255, 240, 207) };
    // The CRT's rolling bar.
    const bar = canvas(4, 64);
    g = bar.getContext('2d');
    gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(255,226,170,0)');
    gr.addColorStop(0.5, 'rgba(255,226,170,0.9)');
    gr.addColorStop(1, 'rgba(255,226,170,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 4, 64);
    P.bar = bar;

    // The words' own scanlines: the glyphs are stamped once (env.words, no halo) and copied out,
    // then cut into lines. The canvas is cleared again at once; the next frame clears it anyway.
    const topD = Math.max(0, Math.floor((L.top - L.titleSize * 0.3) * dpr));
    const botD = Math.min(Math.round(env.H * dpr), Math.ceil((L.bottom + L.titleSize * 0.3) * dpr));
    const leftD = Math.max(0, Math.floor(G.wMin * dpr));
    const rightD = Math.min(Math.round(W * dpr), Math.ceil(G.wMax * dpr));
    P.mask = null;
    if (botD - topD > 4 && rightD - leftD > 4) {
      const ctx = env.ctx;
      const mask = canvas(rightD - leftD, botD - topD);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, topD, ctx.canvas.width, botD - topD);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      env.words(1, MASK, 1);
      g = mask.getContext('2d');
      g.drawImage(ctx.canvas, leftD, topD, mask.width, mask.height, 0, 0, mask.width, mask.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, topD, ctx.canvas.width, botD - topD);
      ctx.restore();
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      for (let yy = 0; yy < mask.height; yy += scan) g.fillRect(0, yy + scanOn, mask.width, scan - scanOn);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#fff1d0';
      g.fillRect(0, 0, mask.width, mask.height);
      P.mask = mask;
      P.maskBox = { x: leftD / dpr, y: topD / dpr, w: mask.width / dpr, h: mask.height / dpr };
    }
    return P;
  }

  /* ------------------------------------------------------------ style --- */

  function create(env) {
    const ctx = env.ctx;
    const W = env.W;
    const H = env.H;
    const L = env.layout;
    const rnd = env.rnd;
    const s = env.scale;
    const dpr = env.dpr;
    const fingerprint = rnd();                   // the seed's first number keys the cached pictures
    const G = geometry(env);
    const tree = growTree(env, G);
    const BR = tree.all;
    const key = [W, H, dpr, fingerprint, L.title, L.year].join('|');
    if (CACHE && CACHE.key === key) {
      // The same seed grows the same tree: its forks take their places in the cached atlas.
      for (let i = 0; i < BR.length; i++) Object.assign(BR[i], CACHE.links[i]);
    } else {
      CACHE = null;
      const pics = buildPictures(env, G, tree, key);
      pics.links = BR.map((b) => ({ ax: b.ax, ay: b.ay, bxD: b.bxD, bwD: b.bwD, byD: b.byD, bhD: b.bhD }));
      CACHE = pics;
    }
    const P = CACHE;

    // The CRT flicker: a table of small random wobbles, and three short dips with a tear.
    const NOISE = new Float32Array(256);
    for (let i = 0; i < 256; i++) NOISE[i] = rnd();
    const DIPS = [];
    for (let i = 0; i < 3; i++) DIPS.push({ t: 2500 + i * 1950 + rnd() * 1100, len: 80 + rnd() * 70, dx: (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 3) * s });
    const TEARS = [];
    for (let i = 0; i < 12; i++) TEARS.push({ y: rnd(), w: 0.5 + rnd() * 0.8, x: rnd() - 0.5 });

    // Motes of light drifting out of the door.
    const MOTES = [];
    for (let i = 0; i < 80; i++) {
      const life = 2000 + rnd() * 1900;
      const t0 = 950 + rnd() * Math.max(500, T_CLOSE0 - 950 - life);
      const x0 = G.cx + (rnd() - 0.5) * G.dw * 0.9;
      const out = x0 >= G.cx ? 1 : -1;
      MOTES.push({
        t0: t0, life: life, x0: x0, y0: G.doorTop + G.dh * (0.06 + rnd() * 0.62),
        vx: out * (0.012 + rnd() * 0.07) * s, vy: -(0.006 + rnd() * 0.034) * s,
        wob: (4 + rnd() * 12) * s, wf: 0.0012 + rnd() * 0.0026, ph: rnd() * TAU,
        size: (1.1 + rnd() * 1.9) * s, col: rnd() < 0.5 ? 0 : rnd() < 0.6 ? 1 : 2, a: 0.55 + rnd() * 0.45
      });
    }

    // The dial: 60 ticks round the ring (angle measured from 12 o'clock), faded where the words are.
    const TICKS = [];
    for (let k = 0; k < 60; k++) {
      const a = -PI / 2 + (k / 60) * TAU;
      const fromTop = Math.min(k, 60 - k) / 60 * TAU;
      TICKS.push({ k: k, c: Math.cos(a), s: Math.sin(a), at: fromTop, fade: 1 - smooth(G.fadeY0, G.fadeY1, G.dcy + Math.sin(a) * G.R) });
    }
    const SPR = P.spr;
    const MOTE_SPR = [SPR.amber, SPR.mustard, SPR.cream];
    const door = { w: 0, hh: 0, open: 0, bright: 1 };
    let n = 0;                                   // primitives drawn this frame

    const fadeY = (y) => 1 - smooth(G.fadeY0, G.fadeY1, y);
    const flicker = (t) => {
      let f = 0.93 + 0.07 * NOISE[((t / 47) | 0) & 255] + 0.025 * Math.sin(t * 0.0147);
      for (const d of DIPS) if (t > d.t && t < d.t + d.len) f *= 0.6;
      return f;
    };
    const dipShift = (t) => {
      for (const d of DIPS) if (t > d.t && t < d.t + d.len) return d.dx;
      return 0;
    };
    /** Where a branch is at distance e from its fork. */
    const bx = (b, e) => G.cx + b.side * (b.d0 + e);
    const by = (b, e) => (e < b.Lf ? b.yP + b.dy * (0.5 - 0.5 * Math.cos(PI * e / b.Lf)) : b.yT);

    function stamp(img, x, y, size, a) {
      if (a <= 0.004) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      n++;
    }

    function stamp2(img, x, y, w, h, a) {
      if (a <= 0.004) return;
      const x0 = Math.round(x * dpr);
      const y0 = Math.round(y * dpr);
      const x1 = Math.round((x + w) * dpr);
      const y1 = Math.round((y + h) * dpr);
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(img, x0 / dpr, y0 / dpr, (x1 - x0) / dpr, (y1 - y0) / dpr);
      n++;
    }

    /** A horizontal run of line from x0 to x1 at height y. */
    function run(strip, x0, x1, y, a) {
      if (a <= 0.004) return;
      const a0 = Math.round(x0 * dpr);
      const a1 = Math.round(x1 * dpr);
      if (a1 - a0 < 1) return;
      ctx.globalAlpha = a > 1 ? 1 : a;
      ctx.drawImage(strip, 1, 0, 2, strip.height, a0 / dpr, Math.round(y * dpr - strip.height / 2) / dpr, (a1 - a0) / dpr, strip.height / dpr);
      n++;
    }

    function doorState(t) {
      let hh = (G.dh / 2) * easeOut(clamp((t - T_SLIT0) / (T_SLIT1 - T_SLIT0), 0, 1));
      hh *= 1 - easeIn(clamp((t - (T_WINK - 260)) / 260, 0, 1));          // the slit collapses into the wink
      const ou = clamp((t - T_OPEN0) / (T_OPEN1 - T_OPEN0), 0, 1);
      const open = ou <= 0 ? 0 : easeOutBack(ou);
      const close = smooth(T_CLOSE0, T_CLOSE1, t);
      const slit = 2.6 * s;
      door.open = clamp(open, 0, 1) * (1 - close);
      door.w = slit + (G.dw - slit) * Math.max(0, open) * (1 - close);
      door.hh = hh;
      door.bright = 1 + 0.4 * bump(t, T_OPEN0 + 260, 520) + 0.5 * bump(t, T_SURGE + 60, 420) + 0.55 * bump(t, T_CLOSE1 - 60, 420);
    }

    /* ----------------------------------------------------- drawing --- */

    function drawOpening(t, fa) {
      if (t > 760) return;
      if (t < 360) {
        // A warm flash over the whole picture, well under a quarter of full brightness.
        const a = 0.19 * (1 - t / 360) * (1 - t / 360) * fa;
        const gr = ctx.createRadialGradient(G.cx, G.lineY, 0, G.cx, G.lineY, Math.max(W, H) * 0.8);
        gr.addColorStop(0, 'rgba(255,200,130,' + a.toFixed(3) + ')');
        gr.addColorStop(0.45, 'rgba(244,162,60,' + (a * 0.4).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(200,98,42,0)');
        ctx.globalAlpha = 1;
        ctx.fillStyle = gr;
        ctx.fillRect(0, 0, W, H);
        n++;
      }
      const k = 1 - smooth(0, 700, t);
      const grow = easeOut(clamp(t / 260, 0, 1));
      stamp(P.flash, G.cx, G.lineY, (90 + 230 * grow) * s, k * fa);
      // the anamorphic streak of the first instant
      const fw = W * (0.5 + 1.1 * grow);
      const fh = 64 * s * (1 - 0.4 * grow);
      stamp2(P.flareH, G.cx - fw / 2, G.lineY - fh / 2, fw, fh, 0.95 * k * fa);
      // a ring of light races out to where the dial will be
      if (t < 700) {
        const u = t / 700;
        const k2 = (1 - u) * (1 - u) * fa;
        ctx.beginPath();
        ctx.arc(G.cx, G.dcy, Math.max(1, G.R * easeOut(u)), 0, TAU);
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = (8 + 10 * (1 - u)) * s;
        ctx.globalAlpha = 0.14 * k2;
        ctx.stroke();
        ctx.strokeStyle = HOT;
        ctx.lineWidth = (1.2 + 4 * (1 - u)) * s;
        ctx.globalAlpha = 0.75 * k2;
        ctx.stroke();
        n += 2;
      }
    }

    function drawGlow(t, fa, lo) {
      if (lo || door.hh <= 1) return;
      const a = (0.25 + 0.75 * door.open) * door.bright * flicker(t) * fa;
      if (a <= 0.004) return;
      // Eight pieces of the glow picture round the opening, so it hugs the door at any width.
      const img = P.glow;
      const m = P.glowCut;
      const M = P.glowM;
      const sx = [0, m, img.width - m, img.width];
      const sy = [0, m, img.height - m, img.height];
      const x0 = G.cx - door.w / 2;
      const y0 = G.dcy - door.hh;
      const q = (v) => Math.round(v * dpr) / dpr;
      const dx = [q(x0 - M), q(x0), q(x0 + door.w), q(x0 + door.w + M)];
      const dy = [q(y0 - M), q(y0), q(y0 + door.hh * 2), q(y0 + door.hh * 2 + M)];
      ctx.globalAlpha = a > 1 ? 1 : a;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          if (r === 1 && c === 1) continue;
          const w = dx[c + 1] - dx[c];
          const h = dy[r + 1] - dy[r];
          if (w <= 0.5 || h <= 0.5) continue;
          ctx.drawImage(img, sx[c], sy[r], sx[c + 1] - sx[c], sy[r + 1] - sy[r], dx[c], dy[r], w, h);
          n++;
        }
      }
    }

    function drawDial(t, fa, lo) {
      const vis = smooth(T_DIAL0, T_DIAL0 + 500, t) * (1 - smooth(T_DIALOFF0, T_DIALOFF1, t)) * fa;
      if (vis <= 0.004) return;
      const R = G.R;
      const cx = G.cx;
      const cy = G.dcy;
      const reveal = PI * easeOut(clamp((t - T_DIAL0) / (T_DIAL1 - T_DIAL0), 0, 1));   // lit this far from 12 o'clock
      const gone = clamp((t - T_DIALOFF0) / (T_DIALOFF1 - T_DIALOFF0), 0, 1);          // goes out from the bottom up
      const lim = Math.min(reveal, G.arcEnd * (1 - gone));
      if (lim <= 0.01) return;
      const surge = bump(t, T_SURGE + 120, 520);
      // the ring
      ctx.lineCap = 'butt';
      const vMain = Math.min(lim, G.arcVis);
      if (!lo) {
        ctx.strokeStyle = AMBER;
        ctx.lineWidth = 7 * s;
        ctx.globalAlpha = (0.07 + 0.08 * surge) * vis;
        ctx.beginPath();
        ctx.arc(cx, cy, R, -PI / 2 - vMain, -PI / 2 + vMain);
        ctx.stroke();
        n++;
      }
      ctx.strokeStyle = '#f6c06a';
      ctx.lineWidth = 1.4 * s;
      ctx.globalAlpha = (0.5 + 0.3 * surge) * vis;
      ctx.beginPath();
      ctx.arc(cx, cy, R, -PI / 2 - vMain, -PI / 2 + vMain);
      ctx.stroke();
      n++;
      if (lim > G.arcVis + 0.01) {
        ctx.globalAlpha = 0.18 * vis;
        ctx.beginPath();
        ctx.arc(cx, cy, R, -PI / 2 + G.arcVis, -PI / 2 + lim);
        ctx.moveTo(cx + Math.cos(-PI / 2 - G.arcVis) * R, cy + Math.sin(-PI / 2 - G.arcVis) * R);
        ctx.arc(cx, cy, R, -PI / 2 - G.arcVis, -PI / 2 - lim, true);
        ctx.stroke();
        n++;
      }
      // the ticks: radial strokes, the hours longer; the ones the sweep and the long hand pass light up
      const sweep = -PI / 2 + ((t - T_DIAL0) / 2400) * TAU;
      const sw = ((sweep + PI / 2) % TAU + TAU) % TAU;
      const spin = easeOut(clamp((t - T_HANDS0) / T_SPIN, 0, 1));
      const drift = clamp((t - T_HANDS0 - T_SPIN) / (T_REWIND - T_HANDS0 - T_SPIN), 0, 1);
      const home = 1 - easeInOut(clamp((t - T_REWIND) / REWIND_DUR, 0, 1));
      const longA = -PI / 2 + ((TAU + 0.62) * spin + 0.72 * drift) * home;      // clockwise
      const shortA = -PI / 2 - ((TAU + 0.92) * spin + 0.22 * drift) * home;     // the other way
      const longK = ((longA + PI / 2) % TAU + TAU) % TAU;
      const hv = vis * smooth(T_HANDS0 - 300, T_HANDS0 + 400, t);
      ctx.strokeStyle = '#f7d27a';
      ctx.lineWidth = 1.6 * s;
      ctx.globalAlpha = 0.5 * vis * (1 + 0.6 * surge);
      ctx.beginPath();
      let lit = 0;
      for (let i = 0; i < 60; i++) {
        const tk = TICKS[i];
        if (tk.at > lim || tk.fade <= 0.01) continue;
        const major = tk.k % 5 === 0;
        const r0 = major ? 0.915 : 0.955;
        if (tk.fade < 0.98) continue;                        // faded ones are drawn on their own below
        ctx.moveTo(cx + tk.c * R * r0, cy + tk.s * R * r0);
        ctx.lineTo(cx + tk.c * R * 0.992, cy + tk.s * R * 0.992);
      }
      ctx.stroke();
      n++;
      for (let i = 0; i < 60; i++) {
        const tk = TICKS[i];
        if (tk.at > lim || tk.fade <= 0.01) continue;
        const ang = (tk.k / 60) * TAU;
        let d = sw - ang;
        d = ((d % TAU) + TAU) % TAU;                         // how far behind the sweep
        let glow = reveal >= PI && d < 0.6 ? 1 - d / 0.6 : 0;
        let dl = Math.abs(longK - ang);
        if (dl > PI) dl = TAU - dl;
        if (dl < 0.16) glow = Math.max(glow, (1 - dl / 0.16) * (hv / Math.max(vis, 1e-3)));
        const major = tk.k % 5 === 0;
        const faded = tk.fade < 0.98;
        if (glow <= 0.02 && !faded) continue;
        const r0 = major ? 0.915 : 0.955;
        ctx.strokeStyle = glow > 0.02 ? '#fff0c8' : '#f7d27a';
        ctx.lineWidth = (major ? 2.4 : 1.8) * s;
        ctx.globalAlpha = Math.min(1, vis * tk.fade * (faded ? 0.5 : 0) + vis * tk.fade * glow);
        ctx.beginPath();
        ctx.moveTo(cx + tk.c * R * r0, cy + tk.s * R * r0);
        ctx.lineTo(cx + tk.c * R * 0.992, cy + tk.s * R * 0.992);
        ctx.stroke();
        n++;
        if (glow > 0.5 && !lo && lit++ < 6) stamp(SPR.mustard, cx + tk.c * R * 0.96, cy + tk.s * R * 0.96, 26 * s, vis * tk.fade * glow * 0.45);
      }
      // a fine dotted ring inside the ticks
      if (!lo) {
        ctx.fillStyle = '#f0b860';
        const sz = 1.4 * s;
        for (let i = 0; i < 120; i++) {
          const a = -PI / 2 + (i / 120) * TAU;
          const at = Math.min(i, 120 - i) / 120 * TAU;
          if (at > lim) continue;
          const py = cy + Math.sin(a) * R * 0.875;
          const fy = fadeY(py);
          if (fy <= 0.01) continue;
          ctx.globalAlpha = 0.4 * vis * fy;
          ctx.fillRect(cx + Math.cos(a) * R * 0.875 - sz / 2, py - sz / 2, sz, sz);
          n++;
        }
      }
      // the sweep point and its tail
      if (reveal >= PI) {
        for (let j = 0; j < (lo ? 3 : 7); j++) {
          const a = sweep - j * 0.07;
          const at = Math.abs((((a + PI / 2) % TAU) + TAU) % TAU - PI);
          if (PI - at > lim) continue;
          const px = cx + Math.cos(a) * R;
          const py = cy + Math.sin(a) * R;
          stamp(j === 0 ? SPR.hot : SPR.amber, px, py, (j === 0 ? 30 : 22 - j * 2) * s, vis * fadeY(py) * (j === 0 ? 0.95 : 0.55 * (1 - j / 7)));
        }
      }
      // the hands (behind the door: drawn only outside it)
      if (hv > 0.01) {
        hand(longA, R * 0.95, 2 * s, hv);
        hand(shortA, R * 0.8, 3.4 * s, hv * 0.9);
      }
    }

    function hand(a, r1, width, v) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const hw = door.w / 2 + 12 * s;
      const hh = Math.max(door.hh, 1) + 12 * s;
      const r0 = Math.min(Math.abs(c) > 1e-4 ? hw / Math.abs(c) : 1e9, Math.abs(sn) > 1e-4 ? hh / Math.abs(sn) : 1e9);
      if (r0 >= r1 - 8 * s) return;
      const x0 = G.cx + c * r0;
      const y0 = G.dcy + sn * r0;
      const x1 = G.cx + c * r1;
      const y1 = G.dcy + sn * r1;
      const a1 = v * Math.min(fadeY(y1), fadeY((y0 + y1) / 2));
      if (a1 <= 0.01) return;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = AMBER;
      ctx.lineWidth = width * 3.6;
      ctx.globalAlpha = 0.2 * a1;
      ctx.stroke();
      ctx.strokeStyle = '#ffe0a0';
      ctx.lineWidth = width;
      ctx.globalAlpha = 0.9 * a1;
      ctx.stroke();
      n += 2;
      stamp(SPR.hot, x1, y1, 26 * s, 0.9 * a1);
      stamp(SPR.amber, x0, y0, 16 * s, 0.6 * a1);
    }

    function drawBranches(t, fa, lo) {
      const atlas = P.atlas;
      const wave = t > T_SURGE && t < T_SURGE + 1100 ? (t - T_SURGE) * SURGE_V * s + door.w / 2 : -1;
      for (let i = 0; i < BR.length; i++) {
        const b = BR[i];
        if (t < b.ts) continue;
        const x0 = G.cx + b.side * b.d0;
        // the bloom where it splits off
        const dtB = t - b.ts;
        if (dtB < 420) {
          const u = dtB / 420;
          const big = b.gen === 1 ? 1.2 : b.gen === 2 ? 1 : 0.8;
          stamp(SPR.hot, x0, b.yP, (16 + 40 * easeOut(u)) * s * big, (1 - u) * (1 - u) * fa);
          if (!lo && u < 0.8) stamp(P.ring, x0, b.yP, (6 + 18 * easeOut(u)) * s * big * 64 / 22, 0.7 * (1 - u / 0.8) * fa);
        }
        const grown = dtB * b.v;
        let tip = grown < b.len ? grown : b.len;
        let back = false;
        if (t > b.pr) {
          const r = b.len - (t - b.pr) * b.vr;
          if (r < tip) { tip = r; back = true; }
        }
        if (tip <= 0) {
          const dtP = t - b.prEnd;
          if (dtP >= 0 && dtP < 360) stamp(SPR.amber, x0, b.yP, 26 * s, 0.8 * (1 - dtP / 360) * fa);
          continue;
        }
        const A = fa * GEN[b.gen].a;
        // the S of the split, cut to what has grown
        const sv = tip < b.Lf ? tip : b.Lf;
        // how many device pixels of it are showing, counted from the fork
        const vis = Math.min(b.bwD, b.side > 0 ? Math.round((G.cx + b.d0 + sv) * dpr) - b.bxD
          : b.bxD + b.bwD - Math.round((G.cx - b.d0 - sv) * dpr));
        if (vis >= 1) {
          ctx.globalAlpha = A;
          const off = b.side > 0 ? 0 : b.bwD - vis;
          ctx.drawImage(atlas, b.ax + off, b.ay, vis, b.bhD, (b.bxD + off) / dpr, b.byD / dpr, vis / dpr, b.bhD / dpr);
          n++;
        }
        // the straight run beyond it
        if (tip > b.Lf) {
          const strip = (b.mustard ? P.mustard : P.strips)[b.gen];
          if (b.side > 0) run(strip, G.cx + b.d1, G.cx + b.d0 + tip, b.yT, A);
          else run(strip, G.cx - b.d0 - tip, G.cx - b.d1, b.yT, A);
        }
        // the growing (or retreating) tip
        if (grown < b.len || back) {
          const hx = bx(b, tip);
          const hy = by(b, tip);
          if (back) stamp(SPR.amber, hx, hy, 18 * s, 0.7 * A);
          else {
            stamp(SPR.hot, hx, hy, (b.gen === 1 ? 34 : 26) * s, 0.95 * A);
            ctx.globalAlpha = A;
            ctx.fillStyle = CREAM;
            const cs = 2.6 * s;
            ctx.fillRect(hx - cs / 2, hy - cs / 2, cs, cs);
            n++;
          }
        } else if (!lo || (i & 1) === 0) {
          // a pulse of light running out along the line
          const pt = t - b.ts - b.pPh;
          if (pt > 0 && t < b.pr) {
            const e = (pt % b.pP) * b.pv;
            if (e < tip) stamp(b.mustard ? SPR.mustard : SPR.hot, bx(b, e), by(b, e), 20 * s, 0.75 * A);
          }
        }
        // the surge passing through
        if (wave > 0) {
          const e = wave - b.d0;
          if (e >= 0 && e < tip) stamp(SPR.hot, bx(b, e), by(b, e), 30 * s, A);
        }
      }
    }

    function drawMainLine(t, fa) {
      let tip = t < T_LINE ? G.E * easeOut(t / T_LINE) : G.E;
      if (t > tree.back0) tip = G.E * (1 - easeIn(clamp((t - tree.back0) / BACK_DUR, 0, 1)));
      const inner = door.w / 2;
      if (tip <= inner + 0.5) return;
      const strip = P.strips[0];
      const a = fa * (1 + 0.3 * bump(t, 300, 400));
      run(strip, G.cx + inner, G.cx + tip, G.lineY, a);
      run(strip, G.cx - tip, G.cx - inner, G.lineY, a);
      if (t < T_LINE + 140 || t > tree.back0) {
        // the heads that draw it (and later reel it back in), each with a streak of light
        const k = t < T_LINE + 140 ? 1 - smooth(T_LINE - 80, T_LINE + 140, t) : 1;
        for (let sd = -1; sd <= 1; sd += 2) {
          const hx = G.cx + sd * tip;
          stamp(SPR.hot, hx, G.lineY, 46 * s, k * fa);
          stamp2(P.flareH, hx - 170 * s, G.lineY - 13 * s, 340 * s, 26 * s, 0.8 * k * fa);
        }
      } else if (t > 1500) {
        // pulses along the main line
        for (let j = 0; j < 3; j++) {
          const e = ((t - 1500 + j * 1150) % 3450) * 0.62 * s;
          if (e < inner || e > tip) continue;
          stamp(SPR.hot, G.cx + e, G.lineY, 24 * s, 0.85 * fa);
          stamp(SPR.hot, G.cx - e, G.lineY, 24 * s, 0.85 * fa);
        }
      }
      if (t > T_SURGE && t < T_SURGE + 1100) {
        const e = (t - T_SURGE) * SURGE_V * s + inner;
        if (e < tip) {
          for (let sd = -1; sd <= 1; sd += 2) {
            stamp(SPR.hot, G.cx + sd * e, G.lineY, 44 * s, fa);
            stamp2(P.flareH, G.cx + sd * e - 110 * s, G.lineY - 10 * s, 220 * s, 20 * s, 0.75 * fa);
          }
        }
      }
    }

    function drawDoor(t, fa, lo) {
      if (door.hh <= 0.5) return;
      const f = flicker(t) * door.bright * fa;
      const dx = dipShift(t);
      const x0 = G.cx - door.w / 2 + dx;
      const y0 = G.dcy - door.hh;
      const h = door.hh * 2;
      // the light inside, stretched to the opening
      stamp2(P.door, x0, y0, door.w, h, 0.95 * f);
      // the jambs and the head
      const ew = P.edge.width / dpr;
      stamp2(P.edge, x0 - ew / 2, y0, ew, h, f);
      stamp2(P.edge, x0 + door.w - ew / 2, y0, ew, h, f);
      run(P.strips[0], x0 - 1.4 * s, x0 + door.w + 1.4 * s, y0, 0.95 * f);
      if (door.w < 30 * s) {
        // the slit: a vertical streak of light
        const k = 1 - door.w / (30 * s);
        stamp2(P.flareV, G.cx - 14 * s, y0 - 30 * s, 28 * s, h + 60 * s, 0.75 * k * f);
      }
      if (!lo && door.open > 0.6) {
        // the rolling bar of an old screen
        const bh = G.dh * 0.14;
        const p = (((t - 900) / 2700) % 1 + 1) % 1;
        const by0 = y0 - bh + p * (h + bh);
        const top = Math.max(by0, y0);
        const bot = Math.min(by0 + bh, y0 + h);
        if (bot > top) {
          const sy = ((top - by0) / bh) * 64;
          const sh = ((bot - top) / bh) * 64;
          ctx.globalAlpha = 0.22 * f;
          ctx.drawImage(P.bar, 0, sy, 4, Math.max(0.5, sh), x0, top, door.w, bot - top);
          n++;
        }
      }
      if (dx !== 0) {
        // a tear in the picture during a dip
        ctx.fillStyle = HOT;
        for (let i = 0; i < TEARS.length; i += 2) {
          const tr = TEARS[i + ((t / 40) | 0) % 2];
          ctx.globalAlpha = 0.5 * fa;
          ctx.fillRect(G.cx + tr.x * door.w - (tr.w * door.w) / 2, y0 + tr.y * h * 0.8, tr.w * door.w, Math.max(1, 1.4 * s));
          n++;
        }
      }
    }

    function drawMotes(t, fa, lo) {
      for (let i = 0; i < MOTES.length; i += lo ? 2 : 1) {
        const m = MOTES[i];
        const age = t - m.t0;
        if (age < 0 || age > m.life) continue;
        const u = age / m.life;
        const a = smooth(0, 0.12, u) * (1 - smooth(0.55, 1, u)) * m.a * fa;
        if (a <= 0.01) continue;
        const x = m.x0 + m.vx * age + Math.sin(m.ph + age * m.wf) * m.wob;
        const y = m.y0 + m.vy * age + Math.cos(m.ph * 1.3 + age * m.wf * 0.8) * m.wob * 0.5;
        stamp(MOTE_SPR[m.col], x, y, m.size * 6, a * 0.7);
        ctx.globalAlpha = a;
        ctx.fillStyle = HOT;
        ctx.fillRect(x - m.size / 2, y - m.size / 2, m.size, m.size);
        n++;
      }
    }

    function drawWink(t, fa) {
      if (t < T_WINK - 140 || t > T_WINK1) return;
      const k = t < T_WINK ? smooth(T_WINK - 140, T_WINK, t) : 1 - smooth(T_WINK, T_WINK1, t);
      const a = k * fa;
      stamp(P.flash, G.cx, G.dcy, 150 * s * (0.6 + 0.4 * k), a);
      const fw = 420 * s * k + 40 * s;
      stamp2(P.flareH, G.cx - fw / 2, G.dcy - 9 * s, fw, 18 * s, a);
      const fh = 300 * s * k + 30 * s;
      stamp2(P.flareV, G.cx - 8 * s, G.dcy - fh / 2, 16 * s, fh, a);
    }

    function drawWords(t, fa, lo) {
      if (t < T_WORDS0) return;
      const mid = G.wordsMid;
      // switching on: a bright line across the middle, which opens into the words
      const lineK = 1 - smooth(T_WORDS0 + 230, T_WORDS0 + 560, t);
      if (lineK > 0.01) {
        const half = (G.wMax - G.wMin) / 2 * easeOut(clamp((t - T_WORDS0) / 240, 0, 1));
        const wc = (G.wMax + G.wMin) / 2;
        run(P.strips[0], wc - half, wc + half, mid, lineK * fa);
        stamp(P.flash, wc, mid, 120 * s, 0.6 * lineK * fa);
      }
      const u = clamp((t - T_WORDS0 - 150) / (T_WORDS1 - T_WORDS0 - 150), 0, 1);
      if (u <= 0) return;
      const sy = 0.03 + 0.97 * easeOutBack(u);
      const a = Math.min(1, u * 2.4) * fa;
      ctx.save();
      if (Math.abs(sy - 1) > 1e-4) {
        ctx.translate(0, mid);
        ctx.scale(1, sy);
        ctx.translate(0, -mid);
      }
      env.words(a, FILL, 1);
      n++;
      const M = P.mask;
      if (M) {
        const B = P.maskBox;
        ctx.globalCompositeOperation = 'lighter';
        // the scanlines on the glyphs: strong as they switch on, then a soft texture
        const on = 1 - smooth(0.25, 1, u);
        const steady = lo ? 0 : 0.12;
        const sa = (steady + 0.65 * on + 0.1 * smooth(FADE_FROM, FADE_TO - 400, t)) * a;
        if (sa > 0.004) {
          ctx.globalAlpha = sa;
          ctx.drawImage(M, B.x, B.y, M.width / dpr, M.height / dpr);
          n++;
        }
        // the shimmer: a band of brighter lines rolling down the words
        for (const t0 of SHIMMERS) {
          const ph = t - t0;
          if (ph < 0 || ph > 1100) continue;
          const bandH = B.h * 0.34;
          const cyB = B.y - bandH + (ph / 1100) * (B.h + bandH * 2);
          for (let j = -3; j <= 3; j++) {
            const y0 = cyB + j * bandH / 7 - bandH / 14;
            const top = Math.max(Math.round((y0 - B.y) * dpr), 0);
            const bot = Math.min(Math.round((y0 + bandH / 7 - B.y) * dpr), M.height);
            if (bot <= top) continue;
            const w = Math.cos((j / 3.5) * PI / 2);
            ctx.globalAlpha = 0.6 * w * w * a;
            ctx.drawImage(M, 0, top, M.width, bot - top, B.x, B.y + top / dpr, M.width / dpr, (bot - top) / dpr);
            n++;
          }
        }
      }
      ctx.restore();
    }

    function draw(t) {
      if (!(t >= 0) || t >= FADE_TO) return 0;
      const fa = 1 - smooth(FADE_FROM, FADE_TO, t);
      const lo = env.low();
      n = 0;
      doorState(t);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawOpening(t, fa);
      drawGlow(t, fa, lo);
      drawDial(t, fa, lo);
      drawBranches(t, fa, lo);
      drawMainLine(t, fa);
      drawDoor(t, fa, lo);
      drawMotes(t, fa, lo);
      drawWink(t, fa);
      drawWords(t, fa, lo);
      ctx.restore();
      return n;
    }

    /**
     * Before midnight (the canvas is idle then): every picture, a gradient and a stroke are drawn
     * once, tiny and faint, into a corner of the real canvas and wiped at once, so the first frames
     * at midnight have nothing left to upload or set up.
     */
    function prime() {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.02;
      for (const img of [P.atlas, P.door, P.edge, P.glow, P.flash, P.flareH, P.flareV, P.ring, P.bar, P.mask].concat(P.strips, P.mustard)) {
        if (img) ctx.drawImage(img, 0, 0, 1, 1);
      }
      for (const k in SPR) ctx.drawImage(SPR[k], 0, 0, 1, 1);
      const gr = ctx.createRadialGradient(1, 1, 0, 1, 1, 2);
      gr.addColorStop(0, 'rgba(255,200,130,0.2)');
      gr.addColorStop(1, 'rgba(200,98,42,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 2, 2);
      ctx.strokeStyle = HOT;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(1, 1, 1, 0, TAU);
      ctx.stroke();
      ctx.clearRect(0, 0, 4, 4);
      ctx.restore();
    }

    return { step: function () {}, draw: draw, prime: prime };
  }

  APFx.register('tva', { name: 'TVA', duration: DURATION, create: create });
})(typeof window !== 'undefined' ? window : this);
