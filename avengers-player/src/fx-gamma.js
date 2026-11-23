/*!
 * Avengers Player: 'gamma', GROUND ZERO. Mass, impact, rage.
 *
 * At midnight something colossal lands on the ground under the words. Nothing of it is ever seen:
 * only what it does. The frame is blown out white for two frames; as it clears (the exposure falls
 * off as green-white light around the crater, torn by the dust it shines through, never a veil) the
 * camera is knocked down hard and a berm of broken rock is thrown up where the words will stand:
 * every rock on its own arc out of the pit, opaque from its first frame, over a bed of dust that
 * gathers under it. A low shock of dust races along the ground to both edges of the frame, rock
 * flies under gravity, a few thin sparks fly off. There are no rays, no streak and no star: the
 * light of a blow is a glow behind the rock and the letters, which stand dark against it. The
 * rocks are dark, opaque basalt at all times: the crater's light is only an underlight on their
 * down-turned facets, and leaks up BETWEEN them. The pile lies on a soft dark bed of dust.
 * The year breaks up through the rubble digit by digit: each grinds up in surges and stalls, the
 * chunks before it heaved up and aside, grit pouring off its shoulders; it comes up incandescent (a
 * dark crust broken into plates, pale heat only in the narrow cracks and along some edges, a thin
 * glow given off by those), hangs, drops, and the stone gives for two or three frames as it lands
 * in a ring of dust; it cools from its edges inward to grey rock with a cool key along its top
 * chamfers, green only from below. The title then comes at the camera word by word (each one
 * picture, with a true zoom blur, shrinking onto its place); the last word is the biggest hit: a
 * camera knock and a short, low bloom.
 * While the words hold, the scene breathes like rage: the pit glows (a wide, level glow behind the
 * letters), flickers and slowly brightens, embers climb, low sheets of dust roll outward along the
 * ground, the light in the cracks wavers, and a heartbeat (lub-dub, harder each time) flares the
 * pit and the cracks, drops the camera, swells the whole lockup by a per cent or two, makes grit
 * hop and, from the third beat, shakes the berm and breathes dust out of it. Three times a glint
 * crosses the stone along its chamfers. At 6 s a second smash (a burst of green-white light, no
 * white frame) throws the block of letters into the air: not as one rigid slab, each letter a
 * little higher or lower than its neighbour, drifting, the title's letters turning a degree, and
 * the title comes down a frame or two after the year. Each letter cracks as it lands: fissures run
 * up it from its foot in five or six frames, white-hot at their tips, wide at the foot and a hair
 * at their ends, along the valleys of the rock, never straight. From 10 s the ground trembles. At
 * 11 s the final pound: a burst of light, the cracks blaze, the letters break along them into thick
 * pieces that go cold within a fifth of a second, come down on the heap where they stood (their
 * lowest corner behind the row of rock in front) and tip over onto their sides (turning: never
 * squashed), a pile of broken stone; then the heap gives way from its ends inward, every rock
 * rolling over and dropping away into the pit, and takes the pieces on it with it; the last of it
 * settles with a low thud, and the light and the dust die to nothing in 180 ms. Nothing is left
 * to cut.
 *
 * Timeline (ms; with a four-digit year and a three-word title):
 *       0        IMPACT: the frame white for two frames, then green-white light falling off around
 *                the crater, behind the rock (gone by ~150)
 *      14..310   the berm is thrown up, rock by rock, from the middle outward
 *      30        the camera is knocked down (about 15, 34, 29, 21 px on frames 3 to 6) and shaken;
 *                the shock of dust reaches both edges of the frame by ~250; rock, low debris, sparks
 *     330..930   a digit starts every 200 ms: 310 ms grinding up through the rubble (three surges,
 *                two stalls), 90 ms hanging, 100 ms dropping
 *     830..1430  ... and each lands (the stone squashes for 2-3 frames, the camera drops ~9 px, a
 *                ring of dust), incandescent; its edges are cold after ~0.2 s, its cracks after ~0.7 s
 *    1750..2350  the title words slam in toward the camera, one every 300 ms (each travels 85 ms);
 *                the LAST (2350) is the hero hit: camera knock, a short low bloom, low dust, rock
 *    3000, 4350, 5250   heartbeat (lub at the beat, dub 230 ms later): the camera drops 8, 9, 10 px,
 *                the lockup swells 0.9 .. 1.2 %
 *    3500, 7000, 9100   a glint crosses the letters (900 ms each; the year 140 ms after the title)
 *    6000        SECOND SMASH: a burst of green-white light around the crater, behind the letters
 *                (no white frame), shock dust, rock; the letters are thrown up (each a little apart) ...
 *    6380        ... the year crashes back (camera, rubble kicked up, dust, chips), the title 25 ms
 *                later; each letter cracks from its foot to its head in 90 ms
 *    7550, 8750, 9750, 10450   heartbeat, harder each time (camera 11, 12, 13, 14 px; the lockup
 *                swells up to 1.9 %; the berm shudders and breathes dust)
 *   10000..11000 the ground trembles, more and more
 *   11000        FINAL POUND: a burst of light, the cracks blaze (90 ms) ...
 *   11090        ... the letters break along their cracks into thick pieces; their light dies in
 *                ~0.17 s; they come down on the heap (rumbles at ~11420 and ~11610) and tip over
 *                onto their sides (all lying by ~11800)
 *   11720..12120 the heap gives way, rock by rock, from its ends inward, in dust, and the pieces
 *                lying on it go with it
 *   12120        the last of it settles: a low thud (camera 15 px), a last flare of the pit ...
 *   12300        ... and light and dust have died to nothing (180 ms): nothing is drawn from here
 *   12500        end
 * Without a year the crater is under the title and its words slam in from 560 ms.
 *
 * Nothing here is a character: no figure, fist, face or logo, only forces and materials. The only
 * text is the words given.
 *
 * The letters (Gasoek One, OFL; the Y redrawn) are never typed text: the mask of each is carved once
 * (corners cleaved off, angular bites; a digit keeps all but one outer corner, the Y its stem, fork
 * and notch), and the stone is worked out per pixel: distance to the edge -> a thin, broken
 * chamfer; a photograph of rock (ambientCG Rock023, CC0, shipped in fx-gamma-tex.js) gives the
 * colour (as a grey: the grade, dark and a little olive, is ours), the fine relief (its normal
 * map), the occlusion and the network of cracks; a few tilted facets make the face hewn. The
 * light: a raking key from the upper left; gamma green only as light, from below (what faces down,
 * the low part of the face, the bottom of the side walls, the thin hot core of the cracks). The
 * depth of a letter is a side wall found per pixel, of the same rock, near black; it stops short
 * inside counters, so they stay open. The light is a separate picture (that is what pulses);
 * incandescent is another (dark crust in patches, heat in the cracks and edges, capped below
 * white) cross-faded into the stone in two stages. After the second smash the letter is cut by the
 * fissures it will break along (the cheapest ways from its foot to its edge over rock of uneven
 * strength: jagged, branching); at the end each piece is that part of the stone with a wall of dark
 * rock under every cut, its light apart.
 * The berm is made of single rocks (angular outlines, the photograph of basalt Rock030 for their
 * surface, the letters' lights), drawn back to front over a dark bed where they lie close; rock
 * sprites are the same rocks at 16 angles. Dust is never a round billow: it is wide, low, streaky
 * sheets (dense and dark at the ground, torn into wisps above, green from below near the crater)
 * that are thrown out and roll along the ground (behind the heap, and before it); they end unevenly
 * at the ground, never along a level line.
 * The photographs are decoded off the main thread when the file loads and read into arrays once;
 * if a picture must be made before that, relief from noise stands in (and the scene is remade).
 *
 * Light and solids: the movie is under the canvas, so no backdrop is ever painted and the film is
 * never darkened as a whole. Light is added ('lighter'); the white-out is a brief veil of white.
 * Letters, rock, rubble and dust are solid or semi-transparent things drawn normally; they are
 * local or brief. The film cannot shake, so everything drawn here does: by whole pixels, all of it
 * by the same amount (there is no zoom), so the lockup always moves as one; when it swells on a
 * heartbeat, every letter is drawn through one transform. The whole lockup is raised so that its
 * middle sits at 0.6 of the height.
 *
 * Deterministic: everything is worked out from the seed, and a frame depends only on the seed and
 * t (step() has nothing to do).
 *
 * Speed (software canvas, 1920x1080): every picture is made once per size, text and seed and kept
 * in a module cache: about 4 s of work, done by a generator that yields every few milliseconds,
 * in the order the pictures are needed (lights, sprites, dust, berm; digits; title; glint; pieces).
 * prime() (env.priming; under the Final Countdown) does 5 ms of it and then a 5.5 ms slice every
 * few ms until it is done (about 7 s here). Asked to play before that is through (or without it),
 * the first frame makes what is missing at once (up to ~4 s: one wait, then every frame is on
 * time; the pictures are the same either way). After a resize mid-run the pictures of the old size
 * are drawn scaled until the new ones are made in slices.
 * Per frame: no text, shadow, gradient or path; everything big is drawn 1:1 on whole pixels from
 * pictures cut to their content; only small things are turned or scaled. env.low() halves dust,
 * grit and embers.
 *
 * Sound: one env.cue('plan', {...}, 0) at create() carries every moment (ms, x 0..1): impact (t,
 * knock: when the camera is hit), lens[] (empty: no rock close to the lens in this cut), digits[]
 * (rise, hang, land), words[] (land, punch, letters), accent (the hero hit), beats[] (t, dub,
 * strength 1 .. 2.15), sweeps[] (t, dur: the glints), smash (t, knock, hopLand: the year lands,
 * titleLand: the title lands, cracks[]: per letter t and dur of its cracking), tremble (t, until),
 * exit (t, knock, blaze, burst, shatters[], pieceLands[]: the two rumbles of pieces coming down,
 * crumble .. crumbleEnd: the heap giving way, thud: the last settle, dark: every light gone),
 * rockLands[], debris[] (rock thrown low past the lens: t, x, dir), jets[] (empty: no fans of grit in
 * this cut), flybys[] (empty), dust[] (dust kicked up: t, x, power), shockwaves[] (the dust
 * front along the ground: t, dur), fissures (t, dur: the berm coming up), cool, lastPulse (= thud),
 * gone, duration.
 */
(function (root) {
  'use strict';

  const FX = root.APFx;
  if (!FX || typeof FX.register !== 'function') return;

  const DURATION = 12500;
  const REVEAL = 310;                   // the berm is thrown up from the middle outward in this time
  const D0 = 330;                       // the first digit starts to push up
  const RISE = 310;                     // a digit grinds up through the rock in this time ...
  const HANG = 90;                      // ... hangs ...
  const FALL = 100;                     // ... and drops onto the ground
  const PUNCH = 85;                     // a title word travels this long before it lands
  const SMASH = 6000;                   // the second smash
  const HOP = 380;                      // the block of letters is in the air this long after it
  const EXIT = 11000;                   // the final pound
  const BLAZE = 90;                     // the cracks blaze this long before the letters burst
  const CRUMBLE = EXIT + 720;           // the heap of rubble starts to give way (from its ends inward)
  const SINK = [240, 100];              // ... the middle this much later than the ends; a rock takes about this long to go
  const LAG = 25;                       // the title lands this long after the year when the block comes down
  const CRACK = 90;                     // a letter cracks from its foot to its head in this time
  const FADE = 180;                     // after the last thud every light dies to nothing in this time
  const GONE = 12300;                   // nothing at all is drawn from here on
  const KNOCK = 30;                     // the camera is knocked as the white-out clears (frame 3)
  const TREMBLE = 10000;                // the ground starts to tremble before the pound
  const LAST = 12120;                   // the last of the rubble settles: the final low thud
  const BEATS = [3000, 4350, 5250, 7550, 8750, 9750, 10450];
  const DUB = 230;                      // the second thump of a heartbeat
  const SWEEPS = [3500, 7000, 9100];    // a band of light crosses the stone
  const SWEEP = 900;
  const EXT = 0.085;                    // how deep a letter is, as a share of its size
  const BEV = 0.02;                      // the width of its hard bevel
  const KY = 0.27;                      // the ground is seen this flat
  const KZ = 0.92;

  const FAMILY = "'AP Gasoek One', \"Bahnschrift\", \"DIN Alternate\", \"Segoe UI\", system-ui, sans-serif";
  const FACE = { family: 'AP Gasoek One', weight: 400, tracking: 0.07, scale: 1.3 };
  const TAU = Math.PI * 2;

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const now = () => (root.performance ? root.performance.now() : Date.now());

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash2 = (i, j, k) => {
    let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  /* ------------------------------------------------------------ noise --- */

  /** A 256 x 256 tile of fractal noise, 0..1, that repeats without a seam; made once. */
  const NT = (function () {
    const N = 256;
    const out = new Float32Array(N * N);
    const R = mulberry(0x6A77A);
    let amp = 1;
    let tot = 0;
    for (let cells = 4; cells <= 64; cells *= 2) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = R();
      const sc = cells / N;
      for (let y = 0; y < N; y++) {
        const fy = y * sc;
        const y0 = Math.floor(fy);
        let ty = fy - y0;
        ty = ty * ty * (3 - 2 * ty);
        const ya = (y0 % cells) * cells;
        const yb = ((y0 + 1) % cells) * cells;
        for (let x = 0; x < N; x++) {
          const fx = x * sc;
          const x0 = Math.floor(fx);
          let tx = fx - x0;
          tx = tx * tx * (3 - 2 * tx);
          const xa = x0 % cells;
          const xb = (x0 + 1) % cells;
          const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * tx;
          const b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * tx;
          out[y * N + x] += (a + (b - a) * ty) * amp;
        }
      }
      tot += amp;
      amp *= 0.55;
    }
    let lo = 1e9;
    let hi = -1e9;
    for (let i = 0; i < out.length; i++) { out[i] /= tot; if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo);
    return out;
  })();
  /** The noise at (x, y), any real numbers (one tile is 256 across). */
  function ns(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const xa = x0 & 255;
    const xb = (x0 + 1) & 255;
    const ya = (y0 & 255) << 8;
    const yb = ((y0 + 1) & 255) << 8;
    const a = NT[ya + xa] + (NT[ya + xb] - NT[ya + xa]) * tx;
    const b = NT[yb + xa] + (NT[yb + xb] - NT[yb + xa]) * tx;
    return a + (b - a) * ty;
  }
  /** Smooth noise along one axis, -1..1 (the camera's shake, flicker). */
  function vn(x, seed) {
    const i = Math.floor(x);
    let f = x - i;
    f = f * f * f * (f * (f * 6 - 15) + 10);
    const a = hash2(i, seed, 7) * 2 - 1;
    const b = hash2(i + 1, seed, 7) * 2 - 1;
    return a + (b - a) * f;
  }

  /** A box blur of a w x h float picture, `passes` times (three passes are close to a Gaussian). */
  function blur(src, w, h, r, passes) {
    r = Math.max(1, Math.round(r));
    let a = src;
    const tmp = new Float32Array(w * h);
    let out = new Float32Array(w * h);
    const inv = 1 / (2 * r + 1);
    for (let p = 0; p < (passes || 1); p++) {
      for (let y = 0; y < h; y++) {                     // along x
        const o = y * w;
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[o + clamp(k, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[o + x] = s * inv;
          const xo = x - r;
          const xi = x + r + 1;
          s += a[o + (xi < w ? xi : w - 1)] - a[o + (xo > 0 ? xo : 0)];
        }
      }
      for (let x = 0; x < w; x++) {                     // along y
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = s * inv;
          const yo = y - r;
          const yi = y + r + 1;
          s += tmp[(yi < h ? yi : h - 1) * w + x] - tmp[(yo > 0 ? yo : 0) * w + x];
        }
      }
      if (a === src) a = new Float32Array(w * h);
      const sw = a; a = out; out = sw;
    }
    return a;
  }

  /** The same in thin slices: it yields every 50 000 pixels or so (never a whole pass at once). */
  function* blurG(src, w, h, r, passes) {
    r = Math.max(1, Math.round(r));
    let a = src;
    const tmp = new Float32Array(w * h);
    const inv = 1 / (2 * r + 1);
    const ey = Math.max(4, Math.round(50000 / w)), ex = Math.max(4, Math.round(30000 / h));
    for (let p = 0; p < passes; p++) {
      const out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {                     // along x
        const o = y * w;
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[o + clamp(k, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          tmp[o + x] = s * inv;
          const xo = x - r;
          const xi = x + r + 1;
          s += a[o + (xi < w ? xi : w - 1)] - a[o + (xo > 0 ? xo : 0)];
        }
        if (y % ey === ey - 1) yield;
      }
      for (let x = 0; x < w; x++) {                     // along y
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = s * inv;
          const yo = y - r;
          const yi = y + r + 1;
          s += tmp[(yi < h ? yi : h - 1) * w + x] - tmp[(yo > 0 ? yo : 0) * w + x];
        }
        if (x % ex === ex - 1) yield;
      }
      a = out;
      yield;
    }
    return a;
  }

  /** For every pixel inside (A >= 0.5): how far the nearest pixel outside is (px); 0 outside. */
  function* distInside(A, w, h) {
    const INF = 1e12;
    const n = w * h;
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) d[i] = A[i] >= 0.5 ? INF : 0;
    yield;
    const m = Math.max(w, h);
    const f = new Float64Array(m);
    const v = new Int32Array(m);
    const z = new Float64Array(m + 1);
    const pass = (off, step, len) => {
      for (let q = 0; q < len; q++) f[q] = d[off + q * step];
      let k = 0;
      v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        do {
          const p = v[k];
          s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        } while (s <= z[k] && --k >= 0);
        k++;
        v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1] < q) k++;
        const p = v[k];
        d[off + q * step] = (q - p) * (q - p) + f[p];
      }
    };
    for (let x = 0; x < w; x++) { pass(x, w, h); if ((x & 63) === 63) yield; }
    for (let y = 0; y < h; y++) { pass(y * w, 1, w); if ((y & 63) === 63) yield; }
    yield;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = d[i] > 0 ? Math.sqrt(d[i]) - 0.5 : 0;
    return out;
  }

  /** A canvas from RGBA bytes. */
  function toCanvas(px, w, h) {
    const c = mk(w, h);
    const q = c.getContext('2d');
    const im = q.createImageData(w, h);
    im.data.set(px);
    q.putImageData(im, 0, 0);
    return c;
  }
  /** Bytes cut down to the box that holds something. */
  function cropped(px, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      const o = y * w * 4 + 3;
      for (let x = 0; x < w; x++) if (px[o + x * 4]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return { c: mk(1, 1), x: 0, y: 0, w: 1, h: 1 };
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const out = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) out.set(px.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x0 + cw) * 4), y * cw * 4);
    return { c: toCanvas(out, cw, ch), x: x0, y: y0, w: cw, h: ch };
  }

  /** Light to be added: RGB (0..255+, any) written so that 'lighter' adds exactly it. */
  function putLight(px, o, r, g, b, least) {
    const m = r > g ? (r > b ? r : b) : (g > b ? g : b);
    if (m < (least || 0.6)) { px[o + 3] = 0; return; }
    const k = 255 / m;
    px[o] = r * k; px[o + 1] = g * k; px[o + 2] = b * k; px[o + 3] = m > 255 ? 255 : m;
  }
  /** A real motion blur of RGBA bytes along (dx, dy), worked out in floats (any length, no banding). */
  function* smearPx(src, w, h, dx, dy, soft) {
    const n = Math.max(2, Math.ceil(Math.hypot(dx, dy)) + 1);
    const px = Math.ceil(Math.abs(dx) / 2) + 2 + (soft | 0), py = Math.ceil(Math.abs(dy) / 2) + 2 + (soft | 0);
    const W2 = w + 2 * px, H2 = h + 2 * py;
    let acc = new Float32Array(W2 * H2 * 4);
    for (let k = 0; k < n; k++) {
      const u = k / (n - 1) - 0.5;
      const sx = Math.round(px + dx * u), sy = Math.round(py + dy * u);
      for (let y = 0; y < h; y++) {
        let o = ((y + sy) * W2 + sx) * 4, i = y * w * 4;
        for (let x = 0; x < w; x++, o += 4, i += 4) {
          const a = src[i + 3];
          if (!a) continue;
          acc[o] += src[i] * a; acc[o + 1] += src[i + 1] * a; acc[o + 2] += src[i + 2] * a; acc[o + 3] += a;
        }
      }
      if (w * h * (k + 1) % 200000 < w * h) yield;
    }
    if (soft) {                                           // and a little out of focus
      for (let c = 0; c < 4; c++) {
        const ch = new Float32Array(W2 * H2);
        for (let i = 0; i < W2 * H2; i++) ch[i] = acc[i * 4 + c];
        const b = yield* blurG(ch, W2, H2, soft, 2);
        for (let i = 0; i < W2 * H2; i++) acc[i * 4 + c] = b[i];
      }
    }
    const out = new Uint8ClampedArray(W2 * H2 * 4);
    for (let i = 0; i < W2 * H2 * 4; i += 4) {
      const a = acc[i + 3];
      if (a <= 0) continue;
      out[i] = acc[i] / a; out[i + 1] = acc[i + 1] / a; out[i + 2] = acc[i + 2] / a; out[i + 3] = a / n;
    }
    return { c: toCanvas(out, W2, H2), px: px, py: py };
  }
  /** A real motion blur of a picture: `n` copies spread along (dx, dy), averaged. */
  function smear(src, dx, dy, n) {
    const px = Math.ceil(Math.abs(dx) / 2) + 1;
    const py = Math.ceil(Math.abs(dy) / 2) + 1;
    const c = mk(src.width + 2 * px, src.height + 2 * py);
    const q = c.getContext('2d');
    q.globalCompositeOperation = 'lighter';
    q.globalAlpha = 1 / n;
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) - 0.5 : 0;
      q.drawImage(src, px + dx * u, py + dy * u);
    }
    return { c: c, px: px, py: py };
  }

  /* ------------------------------------------------- the rock pictures --- */

  /**
   * Photographs of rock (ambientCG Rock023 for the letters, Rock030 for the rubble; CC0), shipped
   * as JPEG data: URLs in fx-gamma-tex.js (window.APGammaTex). They are decoded off the main thread
   * as soon as this file loads and read into typed arrays once. Each set: lum (the colour as
   * luminance), disp (height), ao, rough, and the normal (nx, ny as bytes around 128; y down).
   * If a picture has to be made before they are there, relief worked out from noise stands in
   * (TEX.real is false then, and the scenes made with it are remade once the real ones arrive).
   */
  const TEX = { A: null, B: null, real: false, done: false, imgs: null, left: 0, raw: {} };
  const TEXN = { a: 1024, b: 512 };
  const TEXMAPS = ['a_lum', 'a_disp', 'a_ao', 'a_rough', 'a_nrm', 'b_lum', 'b_disp', 'b_ao', 'b_nrm'];

  function texReadOne(name) {
    if (TEX.raw[name]) return true;
    const im = TEX.imgs && TEX.imgs[name];
    if (!im || !im.complete || !im.naturalWidth) return false;
    const n = TEXN[name[0]];
    const c = mk(n, n);
    const q = c.getContext('2d', { willReadFrequently: true });
    q.drawImage(im, 0, 0, n, n);
    const d = q.getImageData(0, 0, n, n).data;
    if (name.slice(2) === 'nrm') {
      const x = new Uint8Array(n * n), y = new Uint8Array(n * n);
      for (let i = 0, o = 0; i < n * n; i++, o += 4) { x[i] = d[o]; y[i] = 255 - d[o + 1]; }
      TEX.raw[name] = [x, y];
    } else {
      const a = new Uint8Array(n * n);
      for (let i = 0, o = 0; i < n * n; i++, o += 4) a[i] = d[o];
      TEX.raw[name] = a;
    }
    return true;
  }
  function texSet(p, n) {
    const r = TEX.raw;
    return { n: n, m: n - 1, sh: Math.round(Math.log2(n)), lum: r[p + '_lum'], disp: r[p + '_disp'], ao: r[p + '_ao'], rough: r[p + '_rough'] || null, nx: r[p + '_nrm'][0], ny: r[p + '_nrm'][1] };
  }
  function texFinish() {
    for (const nm of TEXMAPS) if (!TEX.raw[nm]) return false;
    TEX.A = texSet('a', TEXN.a);
    TEX.B = texSet('b', TEXN.b);
    TEX.real = true; TEX.done = true; TEX.imgs = null;
    return true;
  }
  /** Relief from noise, for when the photographs are not there (yet). */
  function texFallback() {
    const make = (n, seed, strata) => {
      const lum = new Uint8Array(n * n), disp = new Uint8Array(n * n), ao = new Uint8Array(n * n), rough = new Uint8Array(n * n), nx = new Uint8Array(n * n), ny = new Uint8Array(n * n);
      const hf = new Float32Array(n * n);
      const k = 256 / n;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const X = x * k, Y = y * k;
        const rdg = 1 - Math.abs(2 * ns(X * 2 + seed, Y * 2 + 7) - 1);
        const cr = smooth(0.93, 0.99, rdg);
        const h = ns(X + seed, Y * (strata ? 3 : 1)) * 0.6 + ns(X * 4 + 9, Y * 4 + seed) * 0.3 + ns(X * 16, Y * 16 + 3) * 0.1 - cr * 0.3;
        hf[y * n + x] = h;
        lum[y * n + x] = clamp(70 + 110 * (ns(X * 8 + 3, Y * 8) * 0.5 + ns(X * 32, Y * 32 + seed) * 0.5) - 60 * cr, 0, 255);
        disp[y * n + x] = clamp(h * 255, 0, 255);
        ao[y * n + x] = 255 * (1 - 0.8 * cr);
        rough[y * n + x] = 150;
      }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const i = y * n + x;
        nx[i] = clamp(128 - (hf[y * n + ((x + 1) & (n - 1))] - hf[y * n + ((x - 1) & (n - 1))]) * 900, 0, 255);
        ny[i] = clamp(128 - (hf[((y + 1) & (n - 1)) * n + x] - hf[((y - 1) & (n - 1)) * n + x]) * 900, 0, 255);
      }
      return { n: n, m: n - 1, sh: Math.round(Math.log2(n)), lum: lum, disp: disp, ao: ao, rough: rough, nx: nx, ny: ny };
    };
    TEX.A = make(512, 11, true);
    TEX.B = make(256, 57, false);
    TEX.done = true; TEX.real = false;
  }
  /** The pictures are needed now: read whatever is loaded, or fall back. */
  function texNow() {
    if (TEX.real) return;
    if (TEX.imgs) { let all = true; for (const nm of TEXMAPS) if (!texReadOne(nm)) all = false; if (all && texFinish()) return; }
    if (!TEX.A) texFallback();
  }
  (function () {
    const src = root.APGammaTex;
    if (!src || typeof root.Image === 'undefined') return;
    TEX.imgs = {};
    const queue = TEXMAPS.slice();
    const readNext = () => {                              // one map per turn of the event loop
      if (TEX.real || !TEX.imgs) return;
      const nm = queue.shift();
      if (nm === undefined) { texFinish(); return; }
      texReadOne(nm);
      root.setTimeout(readNext, 0);
    };
    // An image is ready when its decode() settles (it is decoded off the main thread then) or, if that does not
    // come (decode() can wait for a frame to be painted), 1.2 s after it has loaded.
    const fin = (im) => { if (im.__fin) return; im.__fin = true; if (--TEX.left === 0) root.setTimeout(readNext, 0); };
    for (const nm of TEXMAPS) {
      if (!src[nm]) { TEX.imgs = null; return; }
      const im = new root.Image();
      im.decoding = 'async';
      TEX.imgs[nm] = im;
      TEX.left++;
      const loaded = () => root.setTimeout(() => fin(im), 1200);
      im.onload = loaded; im.onerror = () => fin(im);
      im.src = src[nm];
      if (im.decode) im.decode().then(() => fin(im), () => { if (im.complete) fin(im); });
    }
  })();

  /** A map at (u, v), 0..255: between the four texels, repeating. */
  function tx(a, T, u, v) {
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const m = T.m, sh = T.sh;
    const xa = x0 & m, xb = (x0 + 1) & m, ya = (y0 & m) << sh, yb = ((y0 + 1) & m) << sh;
    const p = a[ya + xa], r = a[yb + xa];
    const t = p + (a[ya + xb] - p) * fx;
    return t + (r + (a[yb + xb] - r) * fx - t) * fy;
  }
  /* ------------------------------------------------- the stone letters --- */

  const nrm = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  const KEY = nrm(-0.52, -0.66, 0.54);          // the key light: from the upper left, raking
  const HALF = nrm(KEY[0], KEY[1], KEY[2] + 1); // ... and where its glint sits
  const SWL = nrm(-0.22, -0.34, 0.92);          // the light of the sweep: nearly from the front
  const LIFT = 1.42;                            // how light the rock of the letters is (against a dark film)
  const RIM = 225;                             // the cool key along the top chamfers
  const font = (size) => FACE.weight + ' ' + size + 'px ' + FAMILY;

  /** Walks out from `src` over a mask, eight ways (cost per pixel 1..44): how far every pixel is, and from which pixel it was reached. */
  function* walk(A, cost, w, h, src) {
    const n = w * h;
    const dist = new Int32Array(n).fill(0x3fffffff);
    const prev = new Int32Array(n).fill(-1);
    const NB = 128;
    const buckets = [];
    for (let k = 0; k < NB; k++) buckets.push([]);
    dist[src] = 0; buckets[0].push(src);
    let left = 1, done = 0;
    for (let d = 0; left > 0; d++) {
      if (done > 6000) { done = 0; yield; }
      const b = buckets[d & (NB - 1)];
      for (let q = 0; q < b.length; q++) {
        const i = b[q];
        left--; done++;
        if (dist[i] !== d) continue;
        const x = i % w, y = (i / w) | 0;
        for (let e = 0; e < 8; e++) {
          const X = x + (e === 0 || e === 4 || e === 6 ? -1 : e === 1 || e === 5 || e === 7 ? 1 : 0);
          const Y = y + (e === 2 || e === 4 || e === 5 ? -1 : e === 3 || e === 6 || e === 7 ? 1 : 0);
          if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
          const j = Y * w + X;
          if (A[j] < 0.5) continue;
          const nd = d + (e < 4 ? cost[j] : (cost[j] * 1.42 + 0.5) | 0);
          if (nd < dist[j]) { dist[j] = nd; prev[j] = i; buckets[nd & (NB - 1)].push(j); left++; }
        }
      }
      b.length = 0;
    }
    return { dist: dist, prev: prev };
  }

  /**
   * One letter, hewn from dark rock and shaded per pixel, once. The mask of the letter is carved
   * (corners cleaved off, angular bites and notches; the Y's stem, fork and notch are left alone),
   * then: distance to the edge -> a thin, broken chamfer; the photograph of the rock (Rock023) gives
   * the colour (as a grey: the grade is ours), the fine relief (its normal map), the occlusion and
   * the network of cracks; a few tilted facets make the face hewn. The light: a raking key from the
   * upper left, and the crater's green from below (on what faces down, on the low part of the face,
   * along the bottom of the side walls, in the cracks). The depth of the letter is a side wall found
   * per pixel, of the same rock, near black. Gives: stone before and after the second smash, the
   * light of each (it pulses), the incandescent letter and its glow, what a passing light picks out,
   * and (later, on demand) the pieces it breaks into along its cracks.
   */
  function* makeGlyph(g, S, exx, R) {
    const T = TEX.A, TB = TEX.B;
    const size = g.size;
    const P = Math.ceil(size * 0.2) + 6;
    const ox = Math.floor(g.x0) - P;
    const gw = Math.ceil(g.x1 - g.x0) + 2 * P + 1;
    const gh = Math.ceil(size * 1.12) + 2 * P;
    let holeD = null, holeR = 0;                      // how far a pixel is from a counter (a hole of the letter), and how much wider those were cut
    const oy = Math.round(g.cy - gh / 2);
    const n = gw * gh;
    const cv = mk(gw, gh);
    const q = cv.getContext('2d', { willReadFrequently: true });
    q.font = font(size);
    q.textBaseline = 'middle';
    q.textAlign = 'left';
    q.fillStyle = '#fff';
    q.fillText(g.ch, g.x0 - ox, g.cy - oy);
    const alphaOf = (ctx2) => {
      const d = ctx2.getImageData(0, 0, gw, gh).data;
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = d[i * 4 + 3] / 255;
      return a;
    };
    let A = alphaOf(q);
    const A0 = A;
    yield;

    /* ---- the edge of the letter: where it turns a corner, where it runs straight ---- */
    const rr = Math.max(3, Math.round(size * 0.055));
    const I = new Int32Array((gw + 1) * (gh + 1));
    for (let y = 0; y < gh; y++) {
      let row = 0;
      for (let x = 0; x < gw; x++) {
        row += A[y * gw + x] >= 0.5 ? 1 : 0;
        I[(y + 1) * (gw + 1) + x + 1] = I[y * (gw + 1) + x + 1] + row;
      }
    }
    const box = (x, y) => {
      const x0 = Math.max(0, x - rr), x1 = Math.min(gw, x + rr + 1), y0 = Math.max(0, y - rr), y1 = Math.min(gh, y + rr + 1);
      return (I[y1 * (gw + 1) + x1] - I[y0 * (gw + 1) + x1] - I[y1 * (gw + 1) + x0] + I[y0 * (gw + 1) + x0]) / ((2 * rr + 1) * (2 * rr + 1));
    };
    yield;
    // the Y keeps its stem, its fork and its notch whole: only the outer tops of its arms may break
    const isY = g.ch === 'Y';
    const yHalf = (g.x1 - g.x0) * 0.27, yMid = g.cx - ox, yTop = g.cy - oy - size * 0.1;
    const free = (p) => !isY || (Math.abs(p.x - yMid) > yHalf + size * 0.05 && p.y < yTop);
    const edge = [];
    for (let y = 1; y < gh - 1; y++) {
      for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        if (A[i] >= 0.5 && (A[i - 1] < 0.5 || A[i + 1] < 0.5 || A[i - gw] < 0.5 || A[i + gw] < 0.5)) { const p = { x: x, y: y, f: box(x, y) }; if (free(p)) edge.push(p); }
      }
    }
    yield;
    /** Which way is out of the stone at an edge point. */
    const outward = (p) => {
      let sx = 0, sy = 0, c = 0;
      for (let y = Math.max(0, p.y - rr); y <= Math.min(gh - 1, p.y + rr); y++) {
        for (let x = Math.max(0, p.x - rr); x <= Math.min(gw - 1, p.x + rr); x++) if (A[y * gw + x] >= 0.5) { sx += x; sy += y; c++; }
      }
      const dx = p.x - sx / Math.max(1, c), dy = p.y - sy / Math.max(1, c);
      const l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    const pickApart = (list, want, gap) => {
      const out = [];
      for (let tries = 0; tries < want * 12 && out.length < want && list.length; tries++) {
        const p = list[(R() * list.length) | 0];
        if (out.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > gap)) out.push(p);
      }
      return out;
    };
    const big = g.line === 1 || size > 190 * S;
    if (edge.length > 8) {
      q.globalCompositeOperation = 'destination-out';
      q.fillStyle = '#000';
      const poly = (pts) => { q.beginPath(); pts.forEach((p, k) => (k ? q.lineTo(p[0], p[1]) : q.moveTo(p[0], p[1]))); q.closePath(); q.fill(); };
      yield;
      // corners: most are cleaved off by one straight cut, some by an angular bite (two cuts meeting in a sharp corner)
      const corners = [];
      edge.filter((p) => p.f < 0.37).sort((a, b) => a.f - b.f).forEach((p) => {
        if (corners.length < 18 && corners.every((o) => Math.hypot(o.x - p.x, o.y - p.y) > size * 0.11)) corners.push(p);
      });
      // one outer corner of a digit takes a real hit (never an inner one: the figure must stay itself)
      let heavy = -1;
      if (big) {
        const gx0 = g.x0 - ox, gx1 = g.x1 - ox, gy0 = g.cy - oy - size * 0.37, gy1 = g.cy - oy + size * 0.37;
        const outer = [];
        corners.forEach((p, ci) => { if (Math.min(Math.abs(p.x - gx0), Math.abs(p.x - gx1)) < size * 0.1 && Math.min(Math.abs(p.y - gy0), Math.abs(p.y - gy1)) < size * 0.1) outer.push(ci); });
        const pick = R();
        if (outer.length) heavy = outer[(pick * outer.length) | 0];
      }
      yield;
      // what makes a letter itself is left whole: the N's diagonal and notches, the D's square back, the T's bar
      const chr = g.ch, gmx = (g.x0 + g.x1) / 2 - ox, gbx0 = g.x0 - ox, gbx1 = g.x1 - ox, gwd = g.x1 - g.x0;
      const spare = (p) => (chr === 'N' && Math.min(Math.abs(p.x - gbx0), Math.abs(p.x - gbx1)) > gwd * 0.12) || (chr === 'D' && p.x < gmx) || (chr === 'T' && p.y < g.cy - oy - size * 0.1) || chr === 'W' || chr === 'M';
      corners.forEach((p, ci) => {
        const k = R();
        if ((big || k < 0.3 || spare(p)) && ci !== heavy) return;       // a digit keeps its other corners: it must read at once
        const o = outward(p);
        const tx0 = -o[1], ty0 = o[0];
        const F = size * 0.16;
        if (big || k < 0.8 || chr === 'N' || chr === 'D' || chr === 'T') {
          const dd = size * (ci === heavy ? 0.05 + R() * 0.03 : big ? 0.012 + R() * 0.018 : 0.016 + R() * 0.04);
          const a = Math.atan2(o[1], o[0]) + (R() - 0.5) * (ci === heavy ? 0.5 : 0.9);
          const nx = Math.cos(a), ny = Math.sin(a), L = size * 0.22;
          const cx0 = p.x - o[0] * dd, cy0 = p.y - o[1] * dd;
          poly([[cx0 - ny * L, cy0 + nx * L], [cx0 + ny * L, cy0 - nx * L], [cx0 + ny * L + nx * F, cy0 - nx * L + ny * F], [cx0 - ny * L + nx * F, cy0 + nx * L + ny * F]]);
        } else {
          const dd = size * (0.026 + R() * 0.026), l1 = size * (0.03 + R() * 0.04), l2 = size * (0.03 + R() * 0.04), j = (R() - 0.5) * size * 0.03;
          const ax = p.x - o[0] * dd + tx0 * j, ay = p.y - o[1] * dd + ty0 * j;
          const mx = p.x + tx0 * l1 * 0.5 - o[0] * dd * (0.3 + R() * 0.5), my = p.y + ty0 * l1 * 0.5 - o[1] * dd * (0.3 + R() * 0.5);
          poly([[p.x + tx0 * l1 + o[0] * F, p.y + ty0 * l1 + o[1] * F], [p.x + tx0 * l1 + o[0] * 2, p.y + ty0 * l1 + o[1] * 2], [mx, my], [ax, ay],
            [p.x - tx0 * l2 + o[0] * 2, p.y - ty0 * l2 + o[1] * 2], [p.x - tx0 * l2 + o[0] * F, p.y - ty0 * l2 + o[1] * F]]);
        }
      });
      q.getImageData(0, 0, 1, 1); yield;                  // (what is cut so far is rasterized now, not all at the end)
      // straight runs: a few shallow breaks, and (on a digit) a deep wedge or two
      const straight = edge.filter((p) => p.f > 0.44 && p.f < 0.56 && !spare(p));
      for (const p of pickApart(straight, big ? 4 : 2, size * 0.2)) {
        const o = outward(p);
        const tx0 = -o[1], ty0 = o[0];
        const len = size * (0.05 + R() * 0.1);
        const dep = size * (0.012 + R() * 0.022);
        const u1 = -0.5 + 0.1 + R() * 0.5;
        poly([[p.x - tx0 * len / 2 + o[0] * 4, p.y - ty0 * len / 2 + o[1] * 4], [p.x - tx0 * len / 2, p.y - ty0 * len / 2],
          [p.x + tx0 * len * u1 - o[0] * dep, p.y + ty0 * len * u1 - o[1] * dep],
          [p.x + tx0 * len / 2, p.y + ty0 * len / 2], [p.x + tx0 * len / 2 + o[0] * 4, p.y + ty0 * len / 2 + o[1] * 4]]);
      }
      for (const p of pickApart(straight, big ? 1 : 0, size * 0.3)) {
        const o = outward(p);
        const a = Math.atan2(-o[1], -o[0]) + (R() - 0.5) * 0.9;
        const dep = size * (0.024 + R() * 0.02);
        const hw = size * (0.014 + R() * 0.02);
        const tx0 = -o[1], ty0 = o[0];
        poly([[p.x - tx0 * hw + o[0] * 4, p.y - ty0 * hw + o[1] * 4], [p.x + tx0 * hw * (0.6 + R()) + o[0] * 4, p.y + ty0 * hw * (0.6 + R()) + o[1] * 4],
          [p.x + Math.cos(a) * dep, p.y + Math.sin(a) * dep]]);
      }
      q.globalCompositeOperation = 'source-over';
      q.getImageData(0, 0, 1, 1); yield;
      A = alphaOf(q);
      if (isY) { const c0 = Math.max(0, Math.floor(yMid - yHalf)), c1 = Math.min(gw - 1, Math.ceil(yMid + yHalf)); for (let y = 0; y < gh; y++) for (let x = c0; x <= c1; x++) A[y * gw + x] = A0[y * gw + x]; }
      yield;
      // the counters (the holes of D, A, P, R, 0 ...) are slits in this face: they are cut wider, so that they read small
      {
        const out = new Uint8Array(n);
        const st2 = [];
        for (let x = 0; x < gw; x++) { st2.push(x, (gh - 1) * gw + x); }
        for (let y = 0; y < gh; y++) { st2.push(y * gw, y * gw + gw - 1); }
        for (let cnt = 0; st2.length; cnt++) {
          if ((cnt & 16383) === 16383) yield;
          const i = st2.pop();
          if (out[i] || A[i] >= 0.5) continue;
          out[i] = 1;
          const x = i % gw;
          if (x > 0) st2.push(i - 1);
          if (x < gw - 1) st2.push(i + 1);
          if (i >= gw) st2.push(i - gw);
          if (i < n - gw) st2.push(i + gw);
        }
        yield;
        const m = new Float32Array(n);
        let any = 0;
        for (let i = 0; i < n; i++) { if (A[i] < 0.5 && !out[i]) any++; else m[i] = 1; }
        if (any > 12) {
          const dc = yield* distInside(m, gw, gh);
          const rc = size * (chr === 'D' ? 0.034 : chr === 'O' || chr === '0' ? 0.02 : 0.014);
          holeD = dc; holeR = rc;
          for (let i = 0; i < n; i++) if (A[i] > 0 && m[i] && dc[i] < rc + 1) A[i] *= clamp(dc[i] - rc + 0.5, 0, 1);
        }
      }
      yield;
      // what is too thin to be rock goes (an opening: sharp corners stay sharp), and so does anything left standing apart
      const ro = Math.max(1.2, size * 0.012);
      const D1 = yield* distInside(A, gw, gh);
      yield;
      const inv = new Float32Array(n);
      for (let i = 0; i < n; i++) inv[i] = D1[i] > ro ? 0 : 1;
      const D2 = yield* distInside(inv, gw, gh);
      yield;
      for (let i = 0; i < n; i++) if (A[i] > 0 && D1[i] <= ro) A[i] *= clamp(ro + 1.7 - D2[i], 0, 1);
      yield;
      const comp = new Int32Array(n);
      const areas = [0];
      const stack = [];
      for (let i0 = 0; i0 < n; i0++) {
        if (A[i0] < 0.5 || comp[i0]) continue;
        const id = areas.length;
        let area = 0;
        comp[i0] = id; stack.push(i0);
        while (stack.length) {
          const i = stack.pop();
          area++;
          const x = i % gw;
          if (x > 0 && A[i - 1] >= 0.5 && !comp[i - 1]) { comp[i - 1] = id; stack.push(i - 1); }
          if (x < gw - 1 && A[i + 1] >= 0.5 && !comp[i + 1]) { comp[i + 1] = id; stack.push(i + 1); }
          if (i >= gw && A[i - gw] >= 0.5 && !comp[i - gw]) { comp[i - gw] = id; stack.push(i - gw); }
          if (i < n - gw && A[i + gw] >= 0.5 && !comp[i + gw]) { comp[i + gw] = id; stack.push(i + gw); }
        }
        areas.push(area);
      }
      yield;
      const most = Math.max.apply(null, areas);
      const keep = (i) => comp[i] && areas[comp[i]] >= most * 0.12;
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        if (A[i] <= 0) continue;
        if (A[i] >= 0.5) { if (!keep(i)) A[i] = 0; } else if (!(keep(i - 1) || keep(i + 1) || keep(i - gw) || keep(i + gw) || keep(i - gw - 1) || keep(i - gw + 1) || keep(i + gw - 1) || keep(i + gw + 1))) A[i] = 0;
      }
    }
    yield;

    /* ---- the rock: its photograph under the letter ---- */
    const fq = 1 / S;
    const tk = (big ? 1.0 : 0.72) * fq * T.n / 1024;             // texels per pixel (a small letter: the rock seen closer, so that it is not grain)
    const det = big ? 1 : 0.6;                                   // ... and its fine relief and contrast held back
    // every letter is hewn from its own block: the photograph is moved and turned for each (the strata never run through a line)
    const hs = (k) => hash2(g.ch.charCodeAt(0) * 31 + g.i * 7, g.line * 5 + 3, k);
    const tAng = (hs(1) - 0.5) * 1.0 + (hs(4) < 0.5 ? 0 : Math.PI);
    const tca = Math.cos(tAng) * tk, tsa = Math.sin(tAng) * tk, tcn = Math.cos(tAng), tsn = Math.sin(tAng);
    const tu0 = hs(2) * T.n - (g.cx * tca - g.cy * tsa), tv0 = hs(3) * T.n - (g.cx * tsa + g.cy * tca);
    const tl = new Float32Array(n), ta = new Float32Array(n), tnx = new Float32Array(n), tny = new Float32Array(n), td = new Float32Array(n);
    const b = Math.max(1.6, BEV * size);
    let Dm = yield* distInside(A, gw, gh);
    yield;
    const Ab = yield* blurG(A, gw, gh, 1, 2);
    yield;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (Ab[i] < 0.01) { ta[i] = 1; continue; }
        const u = (x + ox) * tca - (y + oy) * tsa + tu0, v = (x + ox) * tsa + (y + oy) * tca + tv0;
        tl[i] = tx(T.lum, T, u, v) / 255;
        ta[i] = tx(T.ao, T, u, v) / 255;
        td[i] = tx(T.disp, T, u, v) / 255;
        const mx = (tx(T.nx, T, u, v) - 128) / 127, my = (tx(T.ny, T, u, v) - 128) / 127;
        tnx[i] = (mx * tcn + my * tsn) * det;
        tny[i] = (-mx * tsn + my * tcn) * det;
      }
      if ((y & 7) === 7) yield;
    }
    // its cracks: the dark valleys of the photograph
    const cr = new Float32Array(n);
    for (let i = 0; i < n; i++) cr[i] = A[i] > 0.02 ? smooth(0.86, 0.48, ta[i]) * Math.min(1, Dm[i] / (b * 0.8) + 0.15) : 0;
    yield;

    /* ---- the lines it will break along: fissures that run from its foot (where the blow comes from) up through the
       valleys of the rock to its edge, branching; the pieces are what lies between them ---- */
    const major = new Float32Array(n);                // how deep the stone is cut by a fissure here
    const mcore = new Float32Array(n);                // the hot hairline in it (it wavers along the line; parts are dark)
    const lab = new Uint8Array(n).fill(255);          // which piece a pixel belongs to
    let nLab = 0;
    {
      const rimP = [];
      let yMax = 0, area = 0;
      for (let y = 1; y < gh - 1; y++) for (let x = 1; x < gw - 1; x++) {
        const i = y * gw + x;
        if (A[i] < 0.5) continue;
        area++;
        if (A[i - 1] < 0.5 || A[i + 1] < 0.5 || A[i - gw] < 0.5 || A[i + gw] < 0.5) { rimP.push(i); if (y > yMax) yMax = y; }
      }
      yield;
      if (rimP.length > 20) {
        // where it starts: on the foot, on the side of the crater
        const wantX = g.cx - ox - clamp(exx * 9, -1, 1) * (g.x1 - g.x0) * 0.3;
        let src = rimP[0], bd = 1e9;
        for (const i of rimP) { const y = (i / gw) | 0; if (y < yMax - size * 0.05) continue; const d = Math.abs((i % gw) - wantX) + (yMax - y) * 2; if (d < bd) { bd = d; src = i; } }
        const crS = yield* blurG(cr, gw, gh, 1, 1);
        const cost = new Uint8Array(n);
        const eb = Math.max(3, size * 0.05);
        for (let y = 0; y < gh; y++) {
          for (let x = 0; x < gw; x++) {
            const i = y * gw + x;
            if (A[i] < 0.5) continue;
            const X = (x + ox) * fq, Y = (y + oy) * fq;
            // cheap along the rock's own valleys; and every bit of rock is of its own strength (so a line is never straight)
            const rnd = hash2(x >> 1, y >> 1, 77) * 0.6 + hash2(x >> 2, y >> 2, 78) * 0.4;
            cost[i] = clamp(Math.round(1 + 15 * (1 - Math.min(1, crS[i] * 1.6)) + 12 * (1 - smooth(0, eb, Dm[i])) + 26 * Math.abs(ns(X * 0.02 + 60, Y * 0.02 + 14) - 0.5) + 22 * rnd * rnd), 1, 44);
          }
          if ((y & 15) === 15) yield;
        }
        cost[src] = 1;
        const wk = yield* walk(A, cost, gw, gh, src);
        yield;
        const K = big ? 3 + (R() < 0.5 ? 1 : 0) : (R() < 0.5 ? 1 : 2);
        const sx0 = src % gw, sy0 = (src / gw) | 0;
        const ends = [];
        for (let k = 0; k < K; k++) {
          let best = -1, bi = -1;
          for (let q = 0; q < rimP.length; q += 2) {
            const i = rimP[q];
            if (wk.prev[i] < 0) continue;
            const x = i % gw, y = (i / gw) | 0;
            let dmin = Math.hypot(x - sx0, y - sy0) * (k ? 1 : 0.6);
            for (const e of ends) { const d = Math.hypot(x - (e % gw), y - ((e / gw) | 0)); if (d < dmin) dmin = d; }
            dmin *= 0.7 + 0.6 * R();
            if (dmin > best) { best = dmin; bi = i; }
          }
          if (bi >= 0) ends.push(bi);
        }
        // twigs: short fissures that leave a line and die out inside the stone
        const twig = [];
        for (let k = 0; k < (big ? 3 : 1); k++) {
          let i = 0, tries = 0;
          do { i = (R() * n) | 0; tries++; } while (tries < 400 && (A[i] < 0.5 || Dm[i] < eb || wk.prev[i] < 0));
          if (tries < 400) twig.push(i);
        }
        yield;
        const ord = new Int32Array(n).fill(-1);       // how far along the line from the foot (steps)
        const flow = new Uint8Array(n);
        const onPath = new Uint8Array(n);
        let ordMax = 1;
        const lines = [];
        const trace = (end, cuts) => {
          const pts = [];
          for (let i = end; i >= 0; i = wk.prev[i]) pts.push(i);
          pts.reverse();
          let from = 0;
          if (!cuts) { for (let q = pts.length - 1; q >= 0; q--) if (onPath[pts[q]]) { from = q; break; } }
          const line = [];
          for (let q = from; q < pts.length; q++) {
            const i = pts[q];
            if (ord[i] < 0) ord[i] = q;
            if (q > ordMax) ordMax = q;
            if (cuts) { onPath[i] = 1; if (flow[i] < 9) flow[i]++; }
            line.push(i);
          }
          lines.push({ pts: line, cuts: cuts, len: pts.length });
        };
        for (const e of ends) trace(e, true);
        for (const e of twig) trace(e, false);
        yield;
        // the lines as grooves: wide at the foot, a hair at their ends; the hot core wavers along them
        const sk = size / 300;
        lines.forEach((ln, li) => {
          const m = ln.pts.length;
          // the walk goes from pixel to pixel (eight ways): the line itself is that path smoothed, with a slight
          // waver of its own, and is drawn at those places between the pixels (no stair steps, no ruled runs)
          const sxs = new Float32Array(m), sys = new Float32Array(m);
          for (let q = 0; q < m; q++) {
            const hw = Math.min(2, q, m - 1 - q);
            let ax = 0, ay = 0;
            for (let d = -hw; d <= hw; d++) { const j = ln.pts[q + d]; ax += j % gw; ay += (j / gw) | 0; }
            const wob = hw / 2 * 2.4 * Math.max(0.6, sk), o1 = ord[ln.pts[q]] / Math.max(0.6, sk);
            sxs[q] = ax / (2 * hw + 1) + (ns(o1 * 0.05 + 7, 3.5) * 0.7 + ns(o1 * 0.17 + 30, 5.5) * 0.3 - 0.5) * wob;
            sys[q] = ay / (2 * hw + 1) + (ns(o1 * 0.05 + 60, 9.5) * 0.7 + ns(o1 * 0.17 + 90, 1.5) * 0.3 - 0.5) * wob;
          }
          for (let q = 0; q < m; q++) {
            const i = ln.pts[q];
            const fx = sxs[q], fy = sys[q];
            const x = Math.round(fx), y = Math.round(fy);
            const s = ord[i] / ordMax;
            const along = ln.cuts ? 1 : smooth(1, 0.35, (q + 1) / m);                         // a twig dies out
            const wv = 0.55 + 0.9 * ns(ord[i] * 0.045 / sk + li * 31, li * 17 + 5);
            const rad = (0.55 + (2.3 * sk + 0.5) * Math.pow(1 - s, 1.4) * (flow[i] > 1 ? 1.2 : 1)) * wv * along + (ln.cuts ? 0 : -0.2);
            if (rad <= 0.1) continue;
            const bri = smooth(0.34, 0.6, ns(ord[i] * 0.03 / sk + 90 + li * 13, li * 7 + 40)) * (0.45 + 0.55 * Math.pow(1 - s, 0.8)) * along;
            const rr2 = Math.ceil(rad + 1.5);
            for (let dy = -rr2; dy <= rr2; dy++) for (let dx = -rr2; dx <= rr2; dx++) {
              const X = x + dx, Y = y + dy;
              if (X < 0 || Y < 0 || X >= gw || Y >= gh) continue;
              const j = Y * gw + X;
              const d = Math.hypot(X - fx, Y - fy);
              const v = clamp(rad - d + 0.6, 0, 1);
              if (v > major[j]) major[j] = v;
              const c = clamp(1 - d / (0.4 * rad + 0.55), 0, 1) * bri;
              if (c > mcore[j]) mcore[j] = c;
            }
          }
        });
        yield;
        // the pieces: what the lines that cut leave apart
        const stack = [];
        const sizes = [];
        for (let i0 = 0; i0 < n; i0++) {
          if (A[i0] < 0.5 || onPath[i0] || lab[i0] !== 255 || nLab >= 250) continue;
          const id = nLab++;
          let cnt = 0;
          lab[i0] = id; stack.push(i0);
          while (stack.length) {
            const i = stack.pop();
            cnt++;
            const x = i % gw;
            if (x > 0) { const j = i - 1; if (A[j] >= 0.5 && !onPath[j] && lab[j] === 255) { lab[j] = id; stack.push(j); } }
            if (x < gw - 1) { const j = i + 1; if (A[j] >= 0.5 && !onPath[j] && lab[j] === 255) { lab[j] = id; stack.push(j); } }
            if (i >= gw) { const j = i - gw; if (A[j] >= 0.5 && !onPath[j] && lab[j] === 255) { lab[j] = id; stack.push(j); } }
            if (i < n - gw) { const j = i + gw; if (A[j] >= 0.5 && !onPath[j] && lab[j] === 255) { lab[j] = id; stack.push(j); } }
          }
          sizes.push(cnt);
        }
        yield;
        // slivers join their neighbours, and so do the pixels of the lines themselves
        const small = Math.max(40, area * 0.03);
        const queue = [];
        for (let i = 0; i < n; i++) { if (lab[i] !== 255 && sizes[lab[i]] < small) lab[i] = 255; }
        yield;
        for (let i = gw; i < n - gw; i++) if (lab[i] !== 255 && (lab[i - 1] === 255 || lab[i + 1] === 255 || lab[i - gw] === 255 || lab[i + gw] === 255)) queue.push(i);
        yield;
        for (let q = 0; q < queue.length; q++) {
          const i = queue[q];
          const x = i % gw;
          if (x > 0) { const j = i - 1; if (A[j] >= 0.5 && lab[j] === 255) { lab[j] = lab[i]; queue.push(j); } }
          if (x < gw - 1) { const j = i + 1; if (A[j] >= 0.5 && lab[j] === 255) { lab[j] = lab[i]; queue.push(j); } }
          if (i >= gw) { const j = i - gw; if (A[j] >= 0.5 && lab[j] === 255) { lab[j] = lab[i]; queue.push(j); } }
          if (i < n - gw) { const j = i + gw; if (A[j] >= 0.5 && lab[j] === 255) { lab[j] = lab[i]; queue.push(j); } }
          if ((q & 8191) === 8191) yield;
        }
      }
      if (!nLab) { for (let i = 0; i < n; i++) if (A[i] >= 0.5) lab[i] = 0; nLab = 1; }
    }
    yield;

    /* ---- what does not depend on the cracks ---- */
    Dm = yield* blurG(Dm, gw, gh, 1, 1);
    // chisel facets: the face is a handful of planes, each tilted its own way
    const nf = big ? 8 : 4;
    const fs = [];
    for (let k = 0; k < nf; k++) fs.push([P + R() * (gw - 2 * P), P + R() * (gh - 2 * P), (R() - 0.5) * 0.5, (R() - 0.5) * 0.5]);
    let TX = new Float32Array(n);
    let TY = new Float32Array(n);
    const h0 = new Float32Array(n);
    const BW = new Float32Array(n);                   // how wide the chamfer is here (it is broken)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (Ab[i] < 0.01) continue;
        const d = Dm[i];
        let best = 1e9, bk = 0;
        for (let k = 0; k < nf; k++) { const dx = x - fs[k][0], dy = (y - fs[k][1]) * 1.3; const dd = dx * dx + dy * dy + ns(x * 0.05 + k * 9, y * 0.05) * size * size * 0.05; if (dd < best) { best = dd; bk = k; } }
        const X = (x + ox) * fq, Y = (y + oy) * fq;
        const bl = b * (0.25 + 1.5 * smooth(0.3, 0.75, ns(X * 0.045 + 11, Y * 0.045 + 77))) * (0.7 + 0.6 * td[i]);
        BW[i] = bl;
        const top = smooth(bl * 0.9, bl * 1.4 + 1, d);
        TX[i] = fs[bk][2] * top; TY[i] = fs[bk][3] * top;
        h0[i] = (d < bl ? d : bl) * 1.25;
      }
      if ((y & 15) === 15) yield;
    }
    TX = yield* blurG(TX, gw, gh, 1, 1);
    TY = yield* blurG(TY, gw, gh, 1, 1);
    yield;

    /* ---- the side wall: for a pixel under an edge, how far back the face is ---- */
    const E = Math.max(3, Math.round(EXT * size));
    const el = Math.hypot(exx, 1);
    const ex = exx / el, ey = 1 / el;
    /** The rock of a wall `s` px behind an edge whose outward normal is (gx, gy2): near black; only its low edge takes the crater's light. */
    const wall = [0, 0, 0, 0];
    const wallAt = (x, y, s, depth, gx, gy2, inner) => {
      const u = ((x + ox) * tca - (y + oy) * tsa) * 1.3 + tu0 + 77, v = ((x + ox) * tsa + (y + oy) * tca) * 1.3 + s * 1.3 * tk + tv0 + 500;
      const l = tx(T.lum, T, u, v) / 255, a = tx(T.ao, T, u, v) / 255;
      const rock = (0.2 + 2.6 * l * l) * (0.25 + 0.75 * a);
      const dep = s / depth;
      // one light on it, from the crater below: it falls off up the wall, and every facet takes it differently (never a line)
      const fac = ns((x + ox) * fq * 0.07 + 300, (y + oy) * fq * 0.05 + s * 0.05);
      const under = Math.max(0, gy2 * 0.9 + 0.1) * Math.pow(dep, 1.7) * (0.25 + 1.5 * smooth(0.3, 0.75, fac)) * (0.3 + 1.2 * l) * (0.4 + 0.6 * a);
      const kl = Math.max(0, gx * KEY[0] + gy2 * KEY[1]) * (1 - 0.5 * dep);
      const con = s < 2.2 ? 0.5 + 0.22 * s : 1;                       // the dark line where wall meets face
      const base = inner ? 22 : 13;
      wall[0] = (base * rock + 46 * kl * rock) * con + 3 * under;
      wall[1] = (base * 1.12 * rock + 50 * kl * rock) * con + 17 * under;
      wall[2] = (base * 0.95 * rock + 44 * kl * rock) * con + 7 * under;
      wall[3] = under;
    };
    yield;
    const sideRGB = new Uint8ClampedArray(n * 3);
    const SC = new Float32Array(n);                   // how much of the pixel the side wall covers
    const SD = new Float32Array(n);                   // how close to the hot face the wall is here
    const SG = new Float32Array(n);                   // how much of the crater's light it takes
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (A[i] > 0.996) continue;
        let cov = 0, hit = 0, hi = -1;
        for (let s = 1; s <= E; s++) {
          const xs = Math.round(x - ex * s), ys = Math.round(y - ey * s);
          if (xs < 1 || ys < 1 || xs >= gw - 1 || ys >= gh - 1) break;
          const j = ys * gw + xs;
          let a = A[j];
          if (s > E - 1.5) a *= 0.5;
          if (a > cov) cov = a;
          if (a >= 0.5 && !hit) { hit = s; hi = j; }
          if (a > 0.98) break;
        }
        if (cov <= 0.004) continue;
        if (!hit) { hit = E; hi = Math.round(y - ey * E) * gw + Math.round(x - ex * E); }
        // inside a counter or between two arms the wall stops short: the opening stays open
        let below = 0;
        for (let s = 1; s <= E * 3; s++) {
          const xs = Math.round(x + ex * s), ys = Math.round(y + ey * s);
          if (xs < 1 || ys < 1 || xs >= gw - 1 || ys >= gh - 1) break;
          if (A[ys * gw + xs] >= 0.5) { below = s; break; }
        }
        if (below) { cov *= smooth(0.42, 0.3, hit / (hit + below)); if (cov <= 0.004) continue; }
        let gx = Ab[hi + 1] - Ab[hi - 1], gy2 = Ab[hi + gw] - Ab[hi - gw];
        const gl2 = Math.hypot(gx, gy2) || 1;
        gx = -gx / gl2; gy2 = -gy2 / gl2;                 // out of the stone
        wallAt(x, y, hit, E, gx, gy2, false);
        SC[i] = cov;
        SG[i] = wall[3];
        SD[i] = Math.pow(1 - hit / E, 2);
        sideRGB[i * 3] = wall[0]; sideRGB[i * 3 + 1] = wall[1]; sideRGB[i * 3 + 2] = wall[2];
      }
      if ((y & 7) === 7) yield;
    }
    // a soft, wide, faint shadow where the letter stands against the film
    const U8 = new Float32Array(n);
    for (let i = 0; i < n; i++) U8[i] = Math.max(A[i], SC[i]);
    const SH = yield* blurG(U8, gw, gh, Math.max(2, size * 0.04), 3);
    const shOff = 0;
    yield;
    // the tight box of the letter itself, and where its feet are
    let tx0 = gw, ty0 = gh, tx1 = 0, ty1 = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (U8[y * gw + x] > 0.05) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
    if (tx1 < tx0) { tx0 = ty0 = 0; tx1 = gw - 1; ty1 = gh - 1; }
    let fy1 = 0, fy0 = 0;
    for (let y = gh - 1; y >= 0 && !fy1; y--) for (let x = 0; x < gw; x++) if (A[y * gw + x] > 0.5) { fy1 = y; break; }
    for (let y = 0; y < gh && !fy0; y++) for (let x = 0; x < gw; x++) if (A[y * gw + x] > 0.5) { fy0 = y; break; }
    // heat: where the cracks are (widely), for the incandescent letter
    const thin = new Float32Array(n);                 // the cracks that are lines (a wide dark hollow carries no light)
    { const cs = yield* blurG(cr, gw, gh, Math.max(2, Math.round(size * 0.009)), 2); for (let i = 0; i < n; i++) thin[i] = clamp((cr[i] - cs[i] * 1.15) * 2.6, 0, 1); }
    const crW = yield* blurG(thin, gw, gh, Math.max(2, Math.round(size * 0.022)), 2);
    yield;

    /* ---- the stone and its light, for one state of the cracks ---- */
    const hot = new Uint8ClampedArray(n * 4);         // incandescent: crust, heat in the cracks and on the edges
    const hot2 = new Uint8ClampedArray(n * 4);        // ... later: the edges have gone cold, the cracks inside still glow
    const EM = new Float32Array(n);                   // how much a pixel of the incandescent letter gives off
    const spec = new Uint8ClampedArray(n * 4);
    const keep = {};
    function* stone(second) {
      // how deep the stone is cut here, and how much of the cut glows
      const gv = new Float32Array(n);
      const core = new Float32Array(n);
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        if (x === 0 && (y & 31) === 31) yield;
        const i = y * gw + x;
        if (A[i] < 0.02) continue;
        const X = (x + ox) * fq, Y = (y + oy) * fq;
        const reg = ns(X * 0.012 + 150, Y * 0.012 + 33);
        const live = smooth(0.5, 0.62, reg);                                             // where the rock's own cracks carry light
        const mj = second ? major[i] : 0;
        gv[i] = Math.min(1, cr[i] * 0.85 + mj);
        core[i] = Math.max(thin[i] * live * (0.45 + 0.55 * ns(X * 0.09 + 9, Y * 0.09 + 70)), second ? mcore[i] : 0);
      }
      yield;
      const GV = yield* blurG(gv, gw, gh, 1, 1);
      const GLW = yield* blurG(core, gw, gh, Math.max(1, Math.round(size * 0.007)), 2);
      const h = new Float32Array(n);
      const depth = Math.max(2.5, size * 0.02);
      for (let i = 0; i < n; i++) h[i] = h0[i] - GV[i] * depth * 0.4 - (second ? major[i] * depth * 1.3 : 0);
      yield;
      const hb = yield* blurG(h, gw, gh, Math.max(2, Math.round(b * 0.8)), 2);
      yield;
      const px = new Uint8ClampedArray(n * 4);
      const em = new Uint8ClampedArray(n * 4);
      const fh = Math.max(1, fy1 - fy0);
      for (let y = 1; y < gh - 1; y++) {
        const low = clamp((y - fy0) / fh, 0, 1);                       // 0 at the head of the letter, 1 at its feet
        const wash = low * low * low;
        for (let x = 1; x < gw - 1; x++) {
          const i = y * gw + x;
          const o = i * 4;
          const a = A[i];
          const sc = SC[i];
          const shs = i - shOff >= 0 ? SH[i - shOff] : 0;
          if (a <= 0.004 && sc <= 0.004) {
            if (shs > 0.01) px[o + 3] = shs * 0.3 * 255;
            if (GLW[i] > 0.01) putLight(em, o, 10 * GLW[i], 60 * GLW[i], 22 * GLW[i]);
            continue;
          }
          let r = 0, gg = 0, bb = 0, er = 0, eg = 0, eb = 0;
          if (a > 0.004) {
            const bx = -(h[i + 1] - h[i - 1]) * 0.5, by = -(h[i + gw] - h[i - gw]) * 0.5;      // the chamfer and the cuts
            let nx = bx + TX[i] + tnx[i] * 0.95;
            let ny = by + TY[i] + tny[i] * 0.95;
            const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
            nx *= il; ny *= il;
            const nz = il;
            const kd = Math.max(0, nx * KEY[0] + ny * KEY[1] + nz * KEY[2]);
            const wear = (h[i] - hb[i]) / b;
            const g1 = GV[i];
            const ao = (0.3 + 0.7 * ta[i]) * (1 - 0.7 * clamp(-wear * 1.2, 0, 1)) * (1 - 0.6 * g1);
            const X = (x + ox) * fq, Y = (y + oy) * fq;
            // the colour of the rock: its photograph as a grey, graded dark and a little olive
            const l = clamp((tl[i] - 0.47) * (1.1 + 0.7 * det) + 0.42 + (ns(X * 0.016 + 5, Y * 0.016) - 0.5) * 0.3, 0, 1);
            const v = LIFT * (0.068 + 0.27 * l * l + 0.09 * l);
            const ar = 255 * v * 0.93, ag = 255 * v, ab = 255 * v * 0.9;
            const lit = 0.34 * ao + 1.62 * kd * (0.3 + 0.7 * ao);
            const fill = Math.max(0, by * 0.8 + ny * 0.25 - 0.05) * ao;                     // what faces down takes the crater's green
            // a cool key from above and behind: it catches the chamfer along the top of every stroke (the stone stands off a dark film)
            // (thin, and broken: it is there on this stretch of an edge and gone on the next; never round a counter)
            const rimG = smooth(0.4, 0.62, ns(X * 0.045 + 20, Y * 0.045) * 0.7 + ns(X * 0.16 + 3, Y * 0.16 + 50) * 0.3) * (holeD ? smooth(holeR + BW[i] + 1.5, holeR + BW[i] + 4, holeD[i]) : 1);
            const rimT = clamp(-by * 0.95 - 0.08, 0, 1) * (1 - smooth(BW[i] * 0.5 + 0.4, BW[i] * 0.95 + 1.3, Dm[i])) * (0.55 + 0.45 * ao) * rimG;
            const rough = T.rough ? tx(T.rough, T, (x + ox) * tca - (y + oy) * tsa + tu0, (x + ox) * tsa + (y + oy) * tca + tv0) / 255 : 0.6;
            const sp = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), 46) * 0.14 * ao * (1.5 - rough);
            const edg = clamp(wear * 2.4 - 0.3, 0, 1) * (0.1 + 0.9 * kd) * smooth(0.3, 0.6, ns(X * 0.21 + 200, Y * 0.21));
            const ws = wash * (0.35 + 0.65 * ao) * (0.6 + 0.4 * l);
            r = ar * lit * 1.03 + 2 * fill + 110 * edg + 235 * sp + 3 * ws + RIM * 0.86 * rimT;
            gg = ag * lit + 9 * fill + 122 * edg + 245 * sp + 13 * ws + RIM * 0.97 * rimT;
            bb = ab * lit * 1.0 + 4 * fill + 108 * edg + 235 * sp + 6 * ws + RIM * rimT;
            // light that comes and goes: the hot core of the cracks, the crater's light from below
            const c = core[i] * Math.min(1, g1 * 2.2 + 0.25);
            const gw2 = GLW[i];
            er = 240 * c * c + 10 * gw2 + 7 * fill + 11 * ws;
            eg = 255 * c + 64 * gw2 + 38 * fill + 58 * ws;
            eb = 200 * c * c + 24 * gw2 + 15 * fill + 22 * ws;
            if (!second) {
              // incandescent rock: a dark crust over most of the face; the heat shows pale in the narrow cracks and along the
              // edges, and as a faint glow in the rock right beside them
              const n1 = ns(X * 0.034 + 200, Y * 0.034 + 9), n2 = ns(X * 0.11 + 31, Y * 0.11 + 60);
              const rimH = (1 - smooth(BW[i] * 0.4, BW[i] * 1.0 + 1.2, Dm[i])) * smooth(0.5, 0.66, n1 * 0.6 + ns(X * 0.07 + 5, Y * 0.07 + 80) * 0.4);
              const near = Math.min(1, crW[i] * 3.2);
              const hz = smooth(0.4, 0.6, ns(X * 0.3 + 77, Y * 0.3 + 5));              // where the stone is still hot through
              const rd1 = 1 - Math.abs(2 * ns(X * 1.1 + 300, Y * 1.1 + 21) - 1);
              const web = smooth(0.915, 0.985, rd1) * hz * smooth(0.3, 0.55, n1);                                // the crust is broken into a few plates (in places)
              const line = Math.min(1, thin[i] * 2.2 + smooth(0.25, 0.8, cr[i]) * 0.6 * hz + web);
              const seep = Math.max(Math.pow(near, 1.5) * 0.5 * smooth(0.25, 0.65, n2), 0.12 * smooth(0.6, 0.95, rd1) * hz);
              const e2 = Math.max(line, seep);                                  // the cracks
              const e1 = Math.max(e2, rimH * (0.45 + 0.5 * n2));                 // ... and, in places, the edges
              const cm = (0.4 + 0.2 * n1) * (0.75 + 0.25 * ao);                  // the crust: the stone, darker
              for (let hI = 0; hI < 2; hI++) {
                const e = hI ? e2 * 0.85 * smooth(0, size * 0.09, Dm[i]) : e1;
                let hr, hg, hb2;
                // (a dim green where it only seeps, a pale yellow where it shows, near white in the core: never lime)
                if (e < 0.35) { const u = e / 0.35; hr = 40 * u * u; hg = 78 * u; hb2 = 30 * u * u; }
                else if (e < 0.7) { const u = (e - 0.35) / 0.35; hr = lerp(40, 222, u); hg = lerp(78, 228, u); hb2 = lerp(30, 132, u); }
                else { const u = Math.min(1, (e - 0.7) / 0.3); hr = lerp(222, 255, u); hg = lerp(228, 255, u); hb2 = lerp(132, 228, u); }
                const dst = hI ? hot2 : hot;
                const km = hI ? Math.min(1, cm * 1.5) : cm;
                dst[o] = r * km * (1 - 0.6 * e) + hr; dst[o + 1] = gg * km * (1 - 0.6 * e) + hg; dst[o + 2] = bb * km * (1 - 0.6 * e) + hb2;
              }
              EM[i] = e1 * e1 * a;
              // what a light passing in front picks out: the chamfers turned to it, the worn edges, a sheen
              const sw = Math.pow(Math.max(0, nx * SWL[0] + ny * SWL[1] + nz * SWL[2]), 26) * 0.16 * (0.4 + l) + edg * 1.5 + (1 - smooth(0, BW[i] + 1, Dm[i])) * 0.95 * (0.25 + kd) + kd * 0.03;
              putLight(spec, o, 215 * sw * a, 255 * sw * a, 205 * sw * a);
            }
          }
          let al = a;
          if (a < 0.996 && sc > 0.004) {
            const k = sc * (1 - a);
            r = r * a + sideRGB[i * 3] * k; gg = gg * a + sideRGB[i * 3 + 1] * k; bb = bb * a + sideRGB[i * 3 + 2] * k;
            al = a + k;
            r /= al; gg /= al; bb /= al;
            const u = SG[i] * k;
            er = er * a + 9 * u; eg = eg * a + 62 * u; eb = eb * a + 22 * u;
            if (!second) {
              const hk = 0.3 * SD[i];
              hot[o] = (hot[o] * a + (sideRGB[i * 3] + 30 * hk) * k) / al; hot[o + 1] = (hot[o + 1] * a + (sideRGB[i * 3 + 1] + 90 * hk) * k) / al; hot[o + 2] = (hot[o + 2] * a + (sideRGB[i * 3 + 2] + 30 * hk) * k) / al;
              hot2[o] = (hot2[o] * a + sideRGB[i * 3] * k) / al; hot2[o + 1] = (hot2[o + 1] * a + sideRGB[i * 3 + 1] * k) / al; hot2[o + 2] = (hot2[o + 2] * a + sideRGB[i * 3 + 2] * k) / al;
            }
          } else {
            er *= a; eg *= a; eb *= a;
          }
          if (!second) { hot[o + 3] = al * 255; hot2[o + 3] = al * 255; }
          const at = al + shs * 0.3 * (1 - al);
          px[o] = r; px[o + 1] = gg; px[o + 2] = bb; px[o + 3] = at * 255;
          putLight(em, o, er, eg, eb);
        }
        if ((y & 7) === 7) yield;
      }
      if (second) { keep.px = px; keep.em = em; }
      const st = cropped(px, gw, gh);
      yield;
      return { stone: st, light: cropped(em, gw, gh) };
    }
    const sa = yield* stone(false);
    yield;
    const sb = yield* stone(true);
    yield;

    /* ---- the glow of the incandescent letter: light spilled by what gives it off (the cracks, the edges), close to them ---- */
    const b1 = yield* blurG(EM, gw, gh, Math.max(1, size * 0.011), 2);
    yield;
    const b2 = yield* blurG(EM, gw, gh, Math.max(2, size * 0.032), 2);
    yield;
    const bp = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) { if ((i & 32767) === 32767) yield; const k1 = b1[i] * 1.5, k2 = b2[i] * 1.7; putLight(bp, i * 4, 70 * k1 + 16 * k2, 120 * k1 + 80 * k2, 40 * k1 + 26 * k2, 3); }
    yield;

    /**
     * The pieces the letter breaks into (made when the end is near): each is a part of the cracked
     * stone cut out along the cracks, with a wall of dark rock under every cut so that it is thick,
     * and the light of its cracks apart (so that a piece can go cold).
     */
    function* pieces() {
      const out = [];
      const Ec = Math.max(3, Math.round(E * 0.85));
      for (let k = 0; k < nLab; k++) {
        const M0 = new Float32Array(n);
        let cnt = 0, sx = 0, sy = 0, x0 = gw, y0 = gh, x1 = 0, y1 = 0;
        for (let i = 0; i < n; i++) if (lab[i] === k) { M0[i] = 1; cnt++; const x = i % gw, y = (i / gw) | 0; sx += x; sy += y; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (cnt < 30) continue;
        x0 = Math.max(1, x0 - 3); y0 = Math.max(1, y0 - 3); x1 = Math.min(gw - 2, x1 + 3 + Math.ceil(Math.abs(ex) * Ec)); y1 = Math.min(gh - 2, y1 + Ec + 3);
        const Ms = yield* blurG(M0, gw, gh, 1, 1);
        yield;
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const px = new Uint8ClampedArray(cw * ch * 4), lp = new Uint8ClampedArray(cw * ch * 4);
        const src = keep.px, sem = keep.em;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = y * gw + x;
          const o = ((y - y0) * cw + (x - x0)) * 4, so = i * 4;
          // the face of the piece: the letter's own pixels (its outer walls go with it)
          let m = clamp((Ms[i] - 0.5) * 2.4 + 0.5, 0, 1);
          let fa = m * Math.min(1, A[i] + (M0[i] ? SC[i] : 0));
          if (!fa && SC[i] > 0.004 && A[i] < 0.5) {                        // an outer wall belongs to the piece above it
            for (let s = 1; s <= E; s++) { const j = Math.round(y - ey * s) * gw + Math.round(x - ex * s); if (j < 0) break; if (A[j] >= 0.5) { if (lab[j] === k) fa = Math.min(1, A[i] + SC[i]); break; } }
          }
          let r = src[so] * fa, gg = src[so + 1] * fa, bb = src[so + 2] * fa, al = fa;
          if (fa > 0) { const ea = sem[so + 3] / 255 * fa; lp[o] = sem[so]; lp[o + 1] = sem[so + 1]; lp[o + 2] = sem[so + 2]; lp[o + 3] = ea * 255; }
          if (fa < 0.996) {
            // under a cut: the inside of the rock
            let hit = 0, cov = 0;
            for (let s = 1; s <= Ec; s++) {
              const xs = Math.round(x - ex * s), ys = Math.round(y - ey * s);
              if (xs < 1 || ys < 1) break;
              const j = ys * gw + xs;
              if (lab[j] === k && A[j] >= 0.5) { hit = s; cov = Math.min(1, Ms[j] * 2) * (s > Ec - 1.5 ? 0.5 : 1); break; }
            }
            if (hit) {
              wallAt(x, y, hit, Ec, 0, 1, true);
              const kk = cov * (1 - fa);
              r += wall[0] * kk; gg += wall[1] * kk; bb += wall[2] * kk; al += kk;
            }
          }
          if (al > 0.004) { px[o] = r / al; px[o + 1] = gg / al; px[o + 2] = bb / al; px[o + 3] = al * 255; }
        }
        yield;
        out.push({ px: px, lp: lp, w: cw, h: ch, x: x0, y: y0, mx: sx / cnt - x0, my: sy / cnt - y0 });
      }
      keep.px = keep.em = null;
      return out;
    }

    // the fissures alone, white-hot (their tips as they run up the letter)
    const tipPx = new Uint8ClampedArray(n * 4);
    { const mg = yield* blurG(mcore, gw, gh, Math.max(1, Math.round(size * 0.008)), 2); for (let i = 0; i < n; i++) { if ((i & 32767) === 32767) yield; const c = Math.min(1, mcore[i] * 1.6), g2 = mg[i] * 2.2; if (c > 0.01 || g2 > 0.01) putLight(tipPx, i * 4, 255 * c + 40 * g2, 255 * c + 150 * g2, 215 * c + 60 * g2, 2); } }
    yield;
    const cTip = cropped(tipPx, gw, gh);
    yield;
    const cHot = cropped(hot, gw, gh);
    yield;
    const cHot2 = cropped(hot2, gw, gh);
    yield;
    const cSpec = cropped(spec, gw, gh);
    yield;
    return {
      g: g, line: g.line, ox: ox, oy: oy, w: gw, h: gh, size: size,
      stoneA: sa.stone, lightA: sa.light, stoneB: sb.stone, lightB: sb.light,
      hot: cHot, hot2: cHot2, tip: cTip, spec: cSpec, bloom: cropped(bp, gw, gh),
      bx: tx0, by: ty0, bw: tx1 - tx0 + 1, bh: ty1 - ty0 + 1, feet: oy + fy1 + 1, pieces: pieces
    };
  }

  /* ------------------------------------------------ rock, dust, sparks --- */

  /** The shape of a piece of broken rock: an angular outline (5 to 8 straight breaks), the slope of each break, a top plane and a cleave or two across it. */
  function rockShape(seed, flat) {
    const R = mulberry(seed);
    const m = 5 + ((R() * 4) | 0);
    const asp = flat ? 0.42 + R() * 0.25 : 0.62 + R() * 0.38;
    const E = [];
    const a0 = R() * TAU;
    for (let k = 0; k < m; k++) {
      const a = a0 + (k + (R() - 0.5) * 0.85) / m * TAU;
      E.push([Math.cos(a), Math.sin(a) / asp, 0.56 + R() * 0.42, 0.7 + Math.pow(R(), 2) * 2.6]);
    }
    const nc = 1 + ((R() * 2) | 0);
    for (let k = 0; k < nc; k++) { const a = R() * TAU; E.push([Math.cos(a), Math.sin(a), 0.05 + R() * 0.4, 0.25 + R() * 0.5, 1]); }
    return { E: E, top: 0.42 + R() * 0.25, tx: (R() - 0.5) * 0.3, ty: (R() - 0.5) * 0.3, ox: R() * 700, oy: R() * 700, tone: 0.62 + R() * 0.75 };
  }

  /**
   * A piece of rock, sz x sz, turned by `ang`: its outline and facets from its shape, its surface
   * from the photograph (Rock030: colour as a grey, relief, occlusion), lit by the same lights as
   * the letters. o: tone (how light the rock is), green (how much of the crater's light it takes
   * from below: an underlight that only the facets turned down or edge-on catch, multiplied by the
   * rock's own colour and occlusion, so that it stays dark, opaque basalt), dark (its base in
   * shadow), light (also give the part of that light that pulses). The edge is anti-aliased.
   */
  function* rockPixels(sz, sh, ang, o) {
    const TB = TEX.B;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rad = sz * 0.5 - 1.5;
    const ystep = Math.max(2, Math.round(5000 / sz));           // (a large rock is made in thin slices)
    const E = sh.E, ne = E.length;
    const tone = (o.tone || 1) * sh.tone, green = o.green || 0, dark = o.dark === undefined ? 0.5 : o.dark;
    const tk = (o.tk || 1) * TB.n / 512;
    const h = new Float32Array(sz * sz), al = new Float32Array(sz * sz);
    for (let y = 0; y < sz; y++) {
      for (let x = 0; x < sz; x++) {
        const u0 = (x + 0.5 - sz / 2) / rad, v0 = (y + 0.5 - sz / 2) / rad;
        const u = u0 * ca + v0 * sa, v = -u0 * sa + v0 * ca;
        if (u * u + v * v > 2.4) continue;
        const ch = (ns(u * 2.6 + sh.ox, v * 2.6 + sh.oy) - 0.5) * 0.16 + (ns(u * 9 + sh.ox, v * 9 + sh.oy) - 0.5) * 0.07;
        let dm = 1e9, hh = sh.top + sh.tx * u + sh.ty * v;
        for (let k = 0; k < ne; k++) {
          const e = E[k];
          const d = e[2] - (u * e[0] + v * e[1]) + ch;
          if (e[4]) { const hk = (d + 0.5) * e[3] + 0.12; if (hk < hh) hh = hk; continue; }
          if (d < dm) dm = d;
          const hk = d * e[3];
          if (hk < hh) hh = hk;
        }
        const i = y * sz + x;
        al[i] = clamp(dm * rad + 0.5, 0, 1);
        h[i] = Math.max(0, hh) + (tx(TB.disp, TB, (u * rad) * tk + sh.ox, (v * rad) * tk + sh.oy) / 255 - 0.5) * 0.3;
      }
      if (y % ystep === ystep - 1) yield;
    }
    const px = new Uint8ClampedArray(sz * sz * 4);
    const lp = o.light ? new Float32Array(sz * sz * 3) : null;
    for (let y = 1; y < sz - 1; y++) {
      for (let x = 1; x < sz - 1; x++) {
        const i = y * sz + x;
        const a = al[i];
        if (a <= 0.003) continue;
        const u0 = (x + 0.5 - sz / 2) / rad, v0 = (y + 0.5 - sz / 2) / rad;
        const u = u0 * ca + v0 * sa, v = -u0 * sa + v0 * ca;
        const tu = (u * rad) * tk + sh.ox, tv = (v * rad) * tk + sh.oy;
        const tnx = (tx(TB.nx, TB, tu, tv) - 128) / 127, tny = (tx(TB.ny, TB, tu, tv) - 128) / 127;
        let nx = -(h[i + 1] - h[i - 1]) * 0.5 * rad + (tnx * ca - tny * sa) * 1.3;
        let ny = -(h[i + sz] - h[i - sz]) * 0.5 * rad + (tnx * sa + tny * ca) * 1.3;
        const il = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        nx *= il; ny *= il;
        const kd = Math.max(0, nx * KEY[0] + ny * KEY[1] + il * KEY[2]);
        const l = tx(TB.lum, TB, tu, tv) / 255, ao = tx(TB.ao, TB, tu, tv) / 255;
        const v2 = (0.05 + 0.5 * clamp((l - 0.16) * 2.2, 0, 1)) * tone;
        const base = 1 - dark * smooth(-0.1, 0.75, v0);                          // its underside is in its own shadow
        const lit = (0.2 + 1.5 * kd) * (0.35 + 0.65 * ao) * base;
        // the crater's light, from below: on what faces down (and a little on what is edge-on), times the rock itself
        const dn = Math.max(0, ny * 1.15 - 0.08);
        const fill = (dn * dn * 0.75 + 0.25 * dn) * green * (0.3 + 0.7 * ao) * 255 * (v2 + 0.03) * (0.4 + 0.6 * smooth(-0.6, 0.6, v0));
        const p = i * 4;
        px[p] = 255 * v2 * lit * 1.0 + 0.2 * fill;
        px[p + 1] = 255 * v2 * lit * 1.02 + 1.1 * fill;
        px[p + 2] = 255 * v2 * lit * 0.92 + 0.4 * fill;
        px[p + 3] = a * 255;
        if (lp) { const e = fill * a; lp[i * 3] = 0.22 * e; lp[i * 3 + 1] = 1.25 * e; lp[i * 3 + 2] = 0.45 * e; }
      }
      if (y % ystep === ystep - 1) yield;
    }
    return { px: px, lp: lp };
  }

  /**
   * Dust as it lies and runs along the ground: a wide, low, streaky sheet. Dense and dark at its
   * base, torn into wisps at the top, long tapering ends, an uneven soft foot; lit from the upper left and shadowed by
   * itself, green from below near the crater. (Never a round billow: nothing here hangs in the air.)
   */
  function* sheetPixels(w, h, seed, green) {
    const R = mulberry(seed);
    const ox = R() * 300, oy = R() * 300;
    const den = new Float32Array(w * h);
    const f = 100 / h;
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;                                // 0 at the top, 1 at the ground
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w * 2 - 1;
        const fx = x * f * 0.26 + ox, fy = y * f + oy;       // the noise is drawn out along the ground: streaks
        const wy = (ns(fx * 0.4 + 50, fy * 0.3) - 0.5) * 34, wx = (ns(fx * 0.4, fy * 0.4 + 90) - 0.5) * 16;
        const n = ns(fx + wx, fy + wy) * 0.62 + ns(fx * 2.6 + 31, (fy + wy) * 3.1 + 17) * 0.38;
        const top = 0.02 + 0.6 * ns(fx * 0.3 + 9, oy + 3) + 0.42 * u * u;          // where the sheet starts: lower toward its ends
        const body = smooth(top, top + 0.55, v);
        const wisp = Math.pow(ns(fx * 1.4 + 77 + wx, fy * 4.5 + wy * 2), 2.4) * smooth(top - 0.3, top + 0.25, v) * (1 - 0.6 * body);
        const d = body * clamp((n - 0.36 + 0.12 * body) * 4.2, 0, 1.15) + wisp * 0.7 * clamp((n - 0.3) * 4, 0, 1);
        // it ends unevenly and softly at the ground (never along a level line), and inside its picture
        const bot = 0.5 + 0.26 * ns(fx * 0.45 + 21, oy + 11) + 0.08 * (ns(fx * 2.1 + 5, oy + 2) - 0.5);
        den[y * w + x] = clamp(d, 0, 1) * smooth(bot + 0.2, bot, v) * smooth(1, 0.93, v) * smooth(1, 0.25, Math.abs(u));
      }
      if ((y & 7) === 7) yield;
    }
    const px = new Uint8ClampedArray(w * h * 4);
    const st = Math.max(1, Math.round(h / 26));
    for (let y = 0; y < h; y++) {
      const v = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const d = den[i];
        if (d <= 0.004) continue;
        let sh = 0;
        for (let k = 1; k <= 5; k++) {
          const xs = x - k * st * 2, ys = y - k * st;
          if (xs >= 0 && ys >= 0) sh += den[ys * w + xs];
        }
        const lit = Math.exp(-sh * 0.5) * (1 - 0.4 * v);                 // dark where it is dense, at the ground
        const under = green ? smooth(0.3, 1, v) * (1 - Math.abs((x + 0.5) / w * 2 - 1) * 0.7) : 0;
        const o = i * 4;
        px[o] = 50 + 128 * lit - 8 * under;
        px[o + 1] = 46 + 121 * lit + 22 * under;
        px[o + 2] = 40 + 104 * lit - 3 * under;
        px[o + 3] = Math.min(0.8, Math.pow(d, 0.9) * 1.2) * 255;
      }
      if ((y & 7) === 7) yield;
    }
    return { px: px, w: w, h: h };
  }

  /** A canvas scaled to w x h (high quality), made once. */
  function sized(src, w, h) {
    const c = mk(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
    const q = c.getContext('2d');
    q.imageSmoothingQuality = 'high';
    q.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  /** The sprites every size shares the recipe of: rock at 16 angles, dust, sparks, embers, a streak. */
  function* makeSprites(S) {
    const out = {};
    // rock: 6 pieces x 16 angles, lit per pixel; and each one blurred by its own flight, for when it is fast
    const rs = Math.max(20, Math.round(46 * S));
    out.rs = rs;
    out.rocks = [];
    out.rockBlur = [];
    for (let k = 0; k < 6; k++) {
      const set = [];
      let first = null;
      const sh = rockShape(9100 + k * 77, k % 3 === 1);
      for (let a = 0; a < 16; a++) { const px = (yield* rockPixels(rs, sh, a / 16 * TAU, { green: 1.3, tone: 1.1, tk: 1 / S, dark: 0.35 })).px; if (!a) first = px; set.push(toCanvas(px, rs, rs)); yield; }
      out.rocks.push(set);
      out.rockBlur.push([yield* smearPx(first, rs, rs, 0, rs * 0.5, 0), yield* smearPx(first, rs, rs, 0, rs * 1.2, 0)]);
    }
    yield;
    out.bs = 1;
    out.boulders = [];                                 // (no rock crosses the lens in this cut)
    // dust: 3 sheets along the ground in two lights (plain, and green from the crater)
    const dh = Math.max(40, Math.round(150 * S)), dw = Math.round(dh * 5.2);
    out.sheets = [];
    for (let k = 0; k < 3; k++) {
      const pair = [];
      for (let gI = 0; gI < 2; gI++) {
        const p = yield* sheetPixels(dw, dh, 700 + k * 53, gI === 1);
        pair.push(toCanvas(p.px, p.w, p.h));
        yield;
      }
      out.sheets.push(pair);
    }
    // a spark: a thin streak, sharp at the front, tapering away behind (drawn along its flight); no head
    {
      const w = 96, h = 8;
      const px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const u = x / (w - 1);
          const v = (y + 0.5 - h / 2) / (h / 2);
          const half = 0.12 + 0.5 * Math.pow(u, 2.2) * smooth(1, 0.9, u);
          const body = clamp(1 - Math.abs(v) / half, 0, 1);
          const c = body * Math.pow(u, 1.8) * smooth(1, 0.93, u) * 1.5;
          putLight(px, (y * w + x) * 4, 250 * c * (0.3 + 0.7 * u * u), 265 * c, 150 * c * (0.2 + 0.8 * u * u * u));
        }
      }
      out.spark = toCanvas(px, w, h);
    }
    // an ember / a soft dot of light
    {
      const w = 32;
      const px = new Uint8ClampedArray(w * w * 4);
      for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
        const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - w / 2) / (w / 2);
        const c = Math.pow(Math.max(0, 1 - d), 2.2);
        putLight(px, (y * w + x) * 4, 255 * c * c * 1.5 + 60 * c, 300 * c, 150 * c * c + 70 * c);
      }
      out.ember = toCanvas(px, w, w);
    }
    // a chip of cold rock for the grit (a few shapes)
    out.chips = [];
    for (let k = 0; k < 4; k++) out.chips.push(toCanvas((yield* rockPixels(14, rockShape(300 + k * 19, k === 2), k, { tk: 3 / S, dark: 0.3 })).px, 14, 14));
    yield;
    return out;
  }
  /* ------------------------------------------------------- the rubble --- */

  /** Puts a rock (RGBA bytes, sz x sz) over a picture at (x0, y0); its light replaces what it hides. */
  function blitRock(dst, lt, pw, ph, rk, sz, x0, y0) {
    const px = rk.px, lp = rk.lp;
    for (let y = 0; y < sz; y++) {
      const Y = y + y0;
      if (Y < 0 || Y >= ph) continue;
      for (let x = 0; x < sz; x++) {
        const X = x + x0;
        if (X < 0 || X >= pw) continue;
        const s = (y * sz + x) * 4;
        const a = px[s + 3] / 255;
        if (a <= 0) continue;
        const d = (Y * pw + X) * 4;
        const da = dst[d + 3] / 255;
        const oa = a + da * (1 - a);
        dst[d] = (px[s] * a + dst[d] * da * (1 - a)) / oa;
        dst[d + 1] = (px[s + 1] * a + dst[d + 1] * da * (1 - a)) / oa;
        dst[d + 2] = (px[s + 2] * a + dst[d + 2] * da * (1 - a)) / oa;
        dst[d + 3] = oa * 255;
        if (lt) {
          const l = (Y * pw + X) * 3, q = (y * sz + x) * 3;
          lt[l] = lt[l] * (1 - a) + (lp ? lp[q] : 0); lt[l + 1] = lt[l + 1] * (1 - a) + (lp ? lp[q + 1] : 0); lt[l + 2] = lt[l + 2] * (1 - a) + (lp ? lp[q + 2] : 0);
        }
      }
    }
  }

  /**
   * The berm, once: broken rock piled at the feet of the letters. Every piece is its own rock (an
   * angular outline, the photograph of basalt for its surface, lit by the letters' lights; the
   * crater's light only as an underlight on its down-turned facets), drawn from the back to the
   * front. Under the letters (and a quarter of a letter's height to either side) the pile is low:
   * nothing stands above their feet, so nothing can read as a point between two digits; its top is
   * uneven (up to the feet here, lower there). Beyond, at the shoulders, it is heaped up, chunk on
   * chunk, and thins out to single stones that lie on the ground. Under all of it lies a soft dark
   * bed of dust (the pile's contact shadow); between the pieces dark dust, and there the crater's light leaks up
   * (that light is a picture of its own: it pulses). Gives the part behind the letters and the part
   * in front of their feet (which hides where a digit comes up through it), the light of each, the
   * bed alone, and every rock as its own picture (they are thrown up one by one, and go one by one).
   */
  function* makeBerm(W, H, cx, gy, S, R, x0h, x1h, em) {
    const TB = TEX.B;
    const span = x1h - x0h;
    const ext = Math.max(30 * S, Math.min(W * 0.17, Math.max(120 * S, span * 0.3), (0.95 * W - span) / 2));
    const mid = (x0h + x1h) / 2;
    const X0 = Math.max(0, Math.floor(x0h - ext - 50 * S)), X1 = Math.min(W, Math.ceil(x1h + ext + 50 * S));
    const Yt = Math.max(0, Math.floor(gy - 130 * S)), Yb = Math.min(H, Math.ceil(gy + 128 * S));
    const pw = Math.max(1, X1 - X0), ph = Math.max(1, Yb - Yt);
    const keep = span / 2 + em * 0.27;                    // inside this, nothing rises above the feet
    const rocks = [];
    // (inside the letters' span the top of the pile is uneven: it comes up to their feet here, lies lower there)
    const dip = (x) => 24 * S * Math.pow(ns(x * 0.017 / S + 3, 7.3), 1.3);
    const add = (x, y, rad, front, out, chunky) => rocks.push({ x: x, y: y, rad: Math.max(5 * S, rad), front: front, out: out,
      seed: (R() * 1e6) | 0, ang: R() * TAU, flat: R() < (chunky ? 0.12 : 0.45), dn: clamp(Math.abs(x - mid) / (span / 2 + ext), 0, 1), j: R() });
    // the front: rows of rubble before the feet (their tops level with the feet under the letters)
    const row = (yc, ys, r0, r1, thin) => {
      for (let x = x0h - ext; x < x1h + ext;) {
        const out = clamp((Math.abs(x - mid) - span / 2) / ext, 0, 1);            // 0 under the letters, 1 where the last stone lies
        const rad = lerp(r0, r1, Math.pow(R(), 1.6)) * (1 - 0.6 * out) * S;
        const p = (1 - smooth(0.4, 1, out)) * (1 - smooth(0.4, 1, out)) * thin + (out > 0 ? 0.05 : 0);
        if (R() < p) {
          let y = yc * S + gy + (R() - 0.5) * ys * S;
          if (Math.abs(x - mid) < keep + rad) y = Math.max(y, gy - 5 * S + rad * 0.8 + dip(x));
          add(x + (R() - 0.5) * rad, y, rad, true, out);
        }
        x += rad * (0.8 + R() * 0.6) * (1 + 1.6 * smooth(0.35, 1, out));
      }
    };
    // behind the letters: low rubble in the pit; heaped at the shoulders (large chunks below, smaller ones on them)
    for (const side of [-1, 1]) {
      for (let d = 0; d < span / 2 + ext;) {
        const x = mid + side * d;
        const o2 = d - keep;                              // how far out on the shoulder
        const out = clamp((d - span / 2) / ext, 0, 1);
        if (o2 < 0) {
          const rad = (14 + 22 * R()) * S;
          add(x, gy - 5 * S + dip(x) + rad * (0.8 + 0.3 * R()), rad, false, out);
          d += rad * (0.9 + R() * 0.7);
        } else {
          const hill = smooth(0, 26 * S, o2) * (1 - smooth(0.4, 1, out));           // the heap
          // (a heap of several chunks, one on another: never one slab)
          const rad = (16 + 44 * hill * (0.45 + 0.55 * R())) * (1 - 0.45 * out) * S;
          if (R() < 0.5 + 0.5 * hill) {
            add(x + side * rad * 0.5, gy - rad * (0.12 + 0.3 * R()), rad, false, out, true);
            if (hill > 0.3 && R() < 0.85) {
              const r2 = rad * (0.5 + 0.3 * R()), y2 = gy - rad * 0.8 - r2 * (0.3 + 0.3 * R());
              add(x + side * rad * (0.1 + 0.6 * R()), y2, r2, false, out, true);
              if (hill > 0.6 && R() < 0.6) { const r3 = r2 * (0.5 + 0.3 * R()); add(x + side * rad * (0.2 + 0.4 * R()), y2 - r2 * 0.6 - r3 * 0.3, r3, false, out, true); }
            }
          }
          d += rad * (0.5 + R() * 0.5) * (1 + 1.2 * smooth(0.5, 1, out));
        }
      }
    }
    row(11, 7, 7, 20, 0.9);
    row(24, 6, 22, 50, 1);
    row(36, 14, 12, 40, 0.85);
    row(47, 12, 15, 36, 0.7);
    row(62, 20, 5, 16, 0.4);
    rocks.sort((a, b) => (a.front - b.front) || (a.y - b.y));
    yield;

    // every rock, lit: the key from the upper left, and the crater's light from below on its down-turned facets
    const pics = [];
    const cov = new Float32Array(pw * ph), covF = new Float32Array(pw * ph);
    for (const r of rocks) {
      const sz = Math.ceil(r.rad * 2) + 4;
      const near = Math.exp(-Math.pow((r.x - mid) / (span * 0.6), 2));
      const rk = yield* rockPixels(sz, rockShape(r.seed, r.flat), r.ang, r.front
        ? { tone: 0.86 + 0.25 * r.out, green: 0.7 * near, dark: 0.6, tk: 1 / S, light: true }
        : { tone: 0.8 + 0.3 * r.out, green: 1.5 * near, dark: 0.5, tk: 1 / S, light: true });
      r.sz = sz; r.px0 = Math.round(r.x - X0 - sz / 2); r.py0 = Math.round(r.y - Yt - sz / 2);
      pics.push(rk);
      for (let y = 0; y < sz; y++) { const Y = y + r.py0; if (Y < 0 || Y >= ph) continue; for (let x = 0; x < sz; x++) { const X = x + r.px0; if (X < 0 || X >= pw) continue; const a = rk.px[(y * sz + x) * 4 + 3] / 255; if (a > cov[Y * pw + X]) cov[Y * pw + X] = a; if (r.front && a > covF[Y * pw + X]) covF[Y * pw + X] = a; } }
      yield;
    }
    const cb = yield* blurG(cov, pw, ph, Math.max(2, Math.round(7 * S)), 2);
    yield;
    const cf = yield* blurG(covF, pw, ph, Math.max(2, Math.round(7 * S)), 2);         // (the rubble in front alone: only it has a bed before the feet)
    yield;
    const cw = yield* blurG(covF, pw, ph, Math.max(3, Math.round(16 * S)), 3);        // (wide: the shadow the rubble in front stands on)
    yield;
    const co = yield* blurG(cov, pw, ph, Math.max(3, Math.round(13 * S)), 3);         // (the pile as a whole: the bed thins away softly toward its outline)
    yield;

    // the bed between the rocks, where they lie close: dark dust, and the crater's light coming up through it; and
    // under the pile a soft dark bed of dust on the ground (its contact shadow: it falls off softly to every side)
    const sdy = Math.round(15 * S);
    const sB = new Uint8ClampedArray(pw * ph * 4), sF = new Uint8ClampedArray(pw * ph * 4);
    const lB = new Float32Array(pw * ph * 3), lF = new Float32Array(pw * ph * 3);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = y * pw + x;
        const wx = x + X0, wy = y + Yt;
        const inner = 1 - smooth(span * 0.46, span * 0.5 + 30 * S, Math.abs(wx - mid));
        const edge = (ns(wx * 0.06 / S + 9, 3) - 0.5) * 14 * S;
        // in front of the feet the bed is whole under the letters (a digit comes up from behind it)
        const forced = inner * smooth(gy + 1 * S + edge * 0.6, gy + 13 * S + edge * 0.6, wy) * (1 - smooth(gy + 30 * S + edge, gy + 50 * S + edge, wy));
        const low = smooth(0.3, 0.8, co[i]) * smooth(gy - 36 * S, gy - 2 * S, wy);                 // (it lies low: it is on the ground)
        const back = wy < gy + 3 * S + edge * 0.5;                          // (behind the letters above this line, before their feet below it)
        // Behind: the bed of the whole pile (the rocks of the heap are put over it: it never hides one). In front of the
        // feet: only the bed of the rubble that lies in front (so no rock behind is ever cut along this line).
        const aB = smooth(0.45, 0.9, cb[i]) * low;
        const aF = back ? 0 : Math.max(smooth(0.45, 0.9, cf[i]), forced * smooth(0.3, 0.55, cb[i])) * low;
        const shade = 0.56 * smooth(0.06, 0.7, cw[Math.max(0, y - sdy) * pw + x]);                 // (no edge of its own: it is the blurred outline of the rocks)
        if (shade > 0.008) { const o = i * 4; sF[o] = 7; sF[o + 1] = 8; sF[o + 2] = 8; sF[o + 3] = shade * 255; }
        if (aB <= 0.004 && aF <= 0.004) continue;
        const l = tx(TB.lum, TB, wx * 2.2 / S, wy * 2.2 / S) / 255;
        const dust = 0.5 + 0.9 * ns(wx * 0.11 / S + 40, wy * 0.3 / S);
        const glow = Math.exp(-Math.pow((wx - mid) / (span * 0.55), 2)) * Math.exp(-Math.pow((wy - gy - 4 * S) / (30 * S), 2));
        const v = (10 + 40 * l) * (0.55 + 0.45 * dust) * (1 - 0.5 * glow);
        const fis = smooth(0.52, 0.8, glow * (0.3 + 1.3 * ns(wx * 0.9 / S + 70, wy * 2.4 / S + 5)));
        for (let pass = 0; pass < 2; pass++) {
          const a = pass ? aF : aB;
          if (a <= 0.004) continue;
          const dst = pass ? sF : sB, lt = pass ? lF : lB;
          const o = i * 4;
          const sa = dst[o + 3] / 255 * (1 - a), oa = a + sa;                                      // (over the shadow)
          dst[o] = ((v * 1.02 + 2 * glow) * a + 7 * sa) / oa; dst[o + 1] = ((v + 9 * glow) * a + 8 * sa) / oa; dst[o + 2] = ((v * 0.9 + 4 * glow) * a + 8 * sa) / oa; dst[o + 3] = oa * 255;
          // the light comes up in veins between the rocks, never as a sheet or a pool
          const fk = a * 0.55;
          lt[i * 3] = (6 * glow + 70 * fis * fis) * fk; lt[i * 3 + 1] = (26 * glow + 190 * fis) * fk; lt[i * 3 + 2] = (10 * glow + 64 * fis * fis) * fk;
        }
      }
      if ((y & 3) === 3) yield;
    }
    const bedB = { c: toCanvas(sB, pw, ph), x: 0, y: 0 };
    yield;
    const bedF = { c: toCanvas(sF, pw, ph), x: 0, y: 0 };
    yield;
    // the rocks over it, from the back to the front (each also kept as a picture of its own)
    const list = [];
    for (let k = 0; k < rocks.length; k++) {
      const r = rocks[k];
      blitRock(r.front ? sF : sB, r.front ? lF : lB, pw, ph, pics[k], r.sz, r.px0, r.py0);
      list.push({ c: toCanvas(pics[k].px, r.sz, r.sz), x: r.px0, y: r.py0, sz: r.sz, front: r.front, dn: r.dn, j: r.j, j2: hash2(r.seed, 3, 9), j3: hash2(r.seed, 5, 11) });
      pics[k] = null;
      if ((k & 1) === 1) yield;
    }
    const light = (lt) => { const px = new Uint8ClampedArray(pw * ph * 4); for (let i = 0; i < pw * ph; i++) putLight(px, i * 4, lt[i * 3], lt[i * 3 + 1], lt[i * 3 + 2], 3); return cropped(px, pw, ph); };
    const back = toCanvas(sB, pw, ph);
    const fr = cropped(sF, pw, ph);
    yield;
    const lb = light(lB);
    yield;
    const lf = light(lF);
    return { x: X0, y: Yt, w: pw, h: ph, back: back, front: fr, lightB: lb, lightF: lf, bedB: bedB, bedF: bedF, rocks: list, keep: keep, mid: mid };
  }

  /** Light in the air, made once: the glow that hangs in the dust over the pit (one picture; no rays, no streak). */
  function* makeLights(W, H, Rc, S) {
    const out = {};
    const w = Math.ceil(Math.min(Rc * 2.3, W)), h = Math.ceil(Math.min(Rc * 1.2, H * 0.6));
    const px = new Uint8ClampedArray(w * h * 4);
    yield;
    const by = h * 0.86;                                 // the pit is this far down the picture
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - w / 2) / (w / 2), dy = (by - y - 0.5) / by;
        // a wide, low glow that hangs in the dust over the crater (wide: it is as strong in every gap between the
        // letters, never a pool in one of them), torn by the dust it lights; no rays
        const px2 = Math.sign(dx) * Math.max(0, Math.abs(dx) - 0.42) / 0.58;      // level across the middle
        const d = Math.hypot(px2, dy * (dy < 0 ? 5.5 : 2.1));
        const dustN = 0.62 + 0.76 * ns(x * 0.55 / S + 40, y * 2.2 / S + 9);
        const c = Math.pow(Math.max(0, 1 - d), 2.3) * dustN;
        const hot = Math.pow(Math.max(0, 1 - Math.hypot(px2 * 1.25, dy * (dy < 0 ? 9 : 4.2))), 2.4) * dustN;
        putLight(px, (y * w + x) * 4, 24 * c + 40 * hot, 135 * c + 88 * hot, 52 * c + 38 * hot, 2.5);
      }
      if ((y & 1) === 1) yield;
    }
    yield;
    out.air = toCanvas(px, w, h);
    yield;
    out.airY = by;
    return out;
  }


  /* ------------------------------------------------- the scene: what happens when --- */

  const pulse = (tau, decay) => (tau < 0 ? 0 : tau < 20 ? tau / 20 : Math.exp(-(tau - 20) / decay));

  /** Everything that is known without drawing a pixel: where things stand, the timeline, every particle. */
  function makeSim(env, sig) {
    const D = env.dpr || 1;
    const W = Math.max(8, Math.round(env.W * D));
    const H = Math.max(8, Math.round(env.H * D));
    const S = env.scale * D;
    const U = H / 1080;
    const L = env.layout;
    const R = mulberry(((sig * 4294967296) >>> 0) ^ 0x0B5E55ED);
    const cx = L.cx * D;
    let desc = 0.36;
    try {
      const c = env.ctx;
      c.save();
      c.font = font(200);
      c.textBaseline = 'middle';
      const m = c.measureText(L.year || L.title || 'H');
      if (m.actualBoundingBoxDescent > 20) desc = m.actualBoundingBoxDescent / 200;
      c.restore();
    } catch (e) { /* the usual share */ }

    /* ---- the letters: where they stand. The year is the hero: where the layout caps it, it is
       set a little larger (it grows upward from its feet and the title moves up with it). ---- */
    const G0 = env.glyphs().map((g) => ({ line: g.line, i: g.i, n: g.n, ch: g.ch, size: g.size * D, x0: g.x0 * D, x1: g.x1 * D, cx: g.cx * D, cy: g.cy * D }));
    const d0 = G0.filter((g) => g.line === 1);
    const hasYear = d0.length > 0;
    let yk = 1;
    let up = 0;
    if (hasYear) {
      const yw = d0[d0.length - 1].x1 - d0[0].x0;
      yk = clamp(Math.min(1.3, 0.8 * W / Math.max(1, yw), 2.7 * L.titleSize * D / Math.max(1, L.yearSize * D)), 1, 1.3);
      up = 2 * desc * L.yearSize * D * (yk - 1);
    }
    const yb = L.yearY * D + desc * L.yearSize * D;
    const G = G0.map((g) => (g.line === 1
      ? { line: 1, i: g.i, n: g.n, ch: g.ch, size: g.size * yk, x0: cx + (g.x0 - cx) * yk, x1: cx + (g.x1 - cx) * yk, cx: cx + (g.cx - cx) * yk, cy: yb - desc * g.size * yk }
      : { line: 0, i: g.i, n: g.n, ch: g.ch, size: g.size, x0: g.x0, x1: g.x1, cx: g.cx, cy: g.cy - up }));
    {
      // The title never runs wider than 86 % of the frame, and the whole lockup is raised: the middle
      // of the block (the top of the title to the feet of the hero line) sits at 0.6 of the height.
      const tl = G.filter((g) => g.line === 0);
      if (tl.length) {
        const k = Math.min(hasYear ? 1 : 1.3, 0.86 * W / Math.max(1, tl[tl.length - 1].x1 - tl[0].x0 + EXT * tl[0].size));
        if (k !== 1) for (const g of tl) { g.size *= k; g.x0 = cx + (g.x0 - cx) * k; g.x1 = cx + (g.x1 - cx) * k; g.cx = cx + (g.cx - cx) * k; }
      }
      const top = tl.length ? tl[0].cy - tl[0].size * 0.37 : G.length ? G[0].cy - G[0].size * 0.37 : 0;
      const last = G[G.length - 1];
      const bot = last ? last.cy + last.size * (desc + EXT) : 0;
      const dy = Math.round(clamp(0.6 * H - (top + bot) / 2, -0.2 * H, 0));
      for (const g of G) g.cy += dy;
    }
    const digits = G.filter((g) => g.line === 1);
    const letters = G.filter((g) => g.line === 0);
    const hero = hasYear ? digits : letters;
    const heroSize = hero.length ? hero[0].size : L.titleSize * D;
    const heroCy = hero.length ? hero[0].cy : L.titleY * D;
    const titleCy = letters.length ? letters[0].cy : L.titleY * D;
    const titleSize = letters.length ? letters[0].size : L.titleSize * D;
    const gy = Math.round(Math.min(H * 0.97, heroCy + heroSize * (desc + EXT * 0.5)));
    const hx0 = hero.length ? hero[0].x0 : cx - 100 * S;
    const hx1 = hero.length ? hero[hero.length - 1].x1 : cx + 100 * S;
    const Rc = clamp((hx1 - hx0) * (hasYear ? 0.58 : 0.4), 90 * S, W * 0.33);
    const GRAV = 3300 * U;

    /* ---- the timeline ---- */
    const words = [];
    {
      let cur = null;
      let gi = 0;
      for (const ch of Array.from(L.title)) {
        if (!ch.trim()) { cur = null; continue; }
        if (gi >= letters.length) break;
        if (!cur) { cur = { g: [] }; words.push(cur); }
        cur.g.push(letters[gi++]);
      }
    }
    const nd = digits.length;
    const DI = nd > 1 ? Math.min(200, 640 / (nd - 1)) : 0;
    const riseAt = digits.map((g, i) => D0 + i * DI);
    const landAt = riseAt.map((a) => a + RISE + HANG + FALL);
    const lastLand = hasYear ? landAt[nd - 1] : 0;
    const nw = words.length;
    const WI = nw > 1 ? Math.min(300, 760 / (nw - 1)) : 0;
    const W0 = hasYear ? lastLand + 320 : 560;
    words.forEach((w, i) => {
      w.at = W0 + i * WI;
      w.x0 = w.g[0].x0;
      w.x1 = w.g[w.g.length - 1].x1;
      w.cx = (w.x0 + w.x1) / 2;
      w.hero = i === nw - 1;
    });
    const titleDone = nw ? W0 + (nw - 1) * WI : W0;

    const hits = [];        // { t, a, d, s, k }: the camera is knocked (px, decay ms, seed, how much of it is the first shove down)
    const flashes = [];     // [t, strength, frames]: the frame is overexposed (whole frame: the impact, the smash, the pound)
    const blooms = [];      // [t, strength, x, y]: a bloom of light at a place
    const thumps = [];      // [t, strength]: the light of the pit and of the cracks flares
    const pulses = [];      // [t, amount]: the whole lockup swells for a moment (a heartbeat)
    const tremors = [];     // [t, px]: the berm shudders
    const puffs = [];       // dust: sheets along the ground
    const rocks = [];       // thrown rock
    const sparks = [];      // hot grit
    const chips = [];       // cold grit falling off the stone
    const boulders = [];    // (none: no rock crosses the lens in this cut)
    const breach = [];      // rubble heaved aside by a digit
    const lands = [];       // rock hitting the ground, for the sound
    const dustCues = [];
    const shocks = [];

    const hk = clamp(heroSize / (300 * S), 0.42, 1);    // (the berm is made to this scale; what lies on it follows)
    const hit = (t, px, decay, k, n) => hits.push({ t: t, a: px * S, d: decay, s: (R() * 1000) | 0, k: k == null ? 0.75 : k, n: n == null ? 1 : n });

    /** One sheet of dust: thrown `dx` along the ground from x (fast, then it rolls on at `drift` px/s), thinning away. */
    function sheet(t, x, dx, o) {
      puffs.push({
        t: t, life: o.life, x: x, y: o.y, dx: dx, tau: o.tau, drift: o.drift || 0, lift: o.lift || 0, a: o.a, sp: (R() * 3) | 0,
        z: o.z, green: !!o.green, front: !!o.front
      });
    }
    /** Dust kicked up at a place on the ground: a few low sheets that run out to both sides. */
    function dustBurst(t, x, y, power, n, spread, life, green) {
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? 1 : -1;
        const k = (i + 0.5 + (R() - 0.5) * 0.6) / n;
        const front = i % 3 === 1;
        sheet(t + R() * 40, x + dir * R() * spread * 0.1, dir * spread * (0.2 + 0.8 * k), {
          life: life * (0.6 + R() * 0.5), y: front ? y + (34 + R() * 26) * S * hk : y + (2 + R() * 10) * S, tau: 130 + R() * 150, drift: dir * (30 + R() * 50) * S, lift: (4 + R() * 10) * S,
          a: (front ? 0.42 : 0.62) * (0.7 + R() * 0.3) * Math.min(1, 0.5 + 0.5 * power), z: (power > 0.9 && !front ? 1 : 2) + (hk < 0.75 ? 1 : 0), green: green && k < 0.6, front: front
        });
      }
      dustCues.push({ t: Math.round(t), x: +(x / W).toFixed(3), power: +power.toFixed(2) });
    }
    /** The shock along the ground: low dust thrown out fast to both sides, as far as `reach` (the frame's edges at the impact). */
    function dustFront(t, reach, n, power) {
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? 1 : -1;
        const k = (Math.floor(i / 2) + 1) / Math.ceil(n / 2);
        const front = (i >> 1) % 2 === 1;
        sheet(t + R() * 16, cx + dir * Rc * 0.1, dir * reach * (0.16 + 0.84 * k), {
          life: (1200 + R() * 900) * (0.7 + 0.3 * power), y: front ? gy + (50 + R() * 60) * S * hk : gy + (4 + R() * 12) * S, tau: 55 + 40 * k + R() * 16, drift: dir * (60 + R() * 70 + (front ? 60 : 0)) * S, lift: (6 + R() * 12) * S,
          a: (front ? (t < 1 ? 0.34 : 0.5) : 0.7) * power * (0.8 + R() * 0.2), z: (front ? 0 : (i >> 1) % 3 === 0 ? 0 : 1) + (hk < 0.75 ? 1 : 0), green: k < 0.45, front: front
        });
      }
      shocks.push({ t: t, dur: 260 });
    }
    function rock(t0, x, y, vx, vy, size, front, near) {
      // Rock thrown up behind the letters comes down behind the rubble in front of them (it is not seen again); rock
      // thrown toward the lens either lands on the rubble (and lies there) or leaves the frame. At the end nothing
      // is thrown toward the lens.
      if (t0 >= EXIT) front = false;
      const stays = !near && t0 < EXIT - 500 && front && R() < 0.4;
      const yg = gy + (12 + R() * 44) * S * hk;
      let t1 = 1e9, t2 = 0, vy2 = 0;
      if (stays && yg < H - 6 * S) {
        const disc = vy * vy + 2 * GRAV * Math.max(0, yg - y);
        t1 = (-vy + Math.sqrt(disc)) / GRAV;
        vy2 = -(vy + GRAV * t1) * (0.18 + R() * 0.2);
        t2 = 2 * -vy2 / GRAV;
        const lx = x + vx * t1;
        if (lx > 0 && lx < W && size > 9 * S) lands.push({ t: Math.round(t0 + t1 * 1000), x: +(lx / W).toFixed(3), size: +(size / (30 * S)).toFixed(2) });
      }
      rocks.push({ t: t0, x: x, y: y, vx: vx, vy: vy, t1: t1, t2: t2, yg: yg, cut: front ? 1e9 : gy + (14 + R() * 10) * S * hk, vx2: vx * 0.4, vy2: vy2, size: size, sp: (R() * 5) | 0, rot: R() * TAU, rv: (R() - 0.5) * (near ? 5 : 16), front: front, fade: 500 + R() * 700, sh: near ? 1 / 80 : 1 / 120, near: !!near });
    }
    function rockBurst(t, x, y, n, power, spread) {
      for (let i = 0; i < n; i++) {
        const a = (R() - 0.5) * spread;
        const sp = (560 + R() * 1050) * power * U;
        const sz = (9 + Math.pow(R(), 2) * 40) * S * (0.7 + 0.3 * power);
        rock(t + R() * 40, x + (R() - 0.5) * Rc * 0.9, y - R() * 10 * S, Math.sin(a) * sp * 1.15, -Math.cos(a) * sp, sz, R() < 0.5);
      }
    }
    /** Rock thrown low and wide, close to the lens: it crosses the lower third and leaves the frame. */
    function debris(t, n, power) {
      for (let i = 0; i < n; i++) {
        const dir = i % 2 ? 1 : -1;
        const sz = (26 + R() * 34) * S * (0.75 + 0.25 * power);
        rock(t + 20 + R() * 90, cx + dir * (0.1 + R() * 0.5) * Rc, gy + (10 + R() * 50) * S, dir * (900 + R() * 1700) * U * power, -(300 + R() * 900) * U * power, sz, true, true);
      }
    }
    function sparkBurst(t, x, y, n, power, spreadX, up) {
      n = Math.ceil(n * 0.5);                             // few, thin
      for (let i = 0; i < n; i++) {
        const a = (R() - 0.5) * (up ? 1.4 : 2.8);
        const sp = (300 + R() * 1250) * power * U;
        sparks.push({ t: t + R() * 50, life: 300 + R() * 700, x: x + (R() - 0.5) * spreadX, y: y - R() * 6 * S, vx: Math.sin(a) * sp * 1.2, vy: -Math.cos(a) * sp, g: GRAV * 0.5, w: (1.3 + Math.pow(R(), 2.5) * 2.6) * S });
      }
    }
    function chipBurst(t, x0, x1, y, n, fall) {
      for (let i = 0; i < n; i++) {
        chips.push({ t: t + R() * 160, x: lerp(x0, x1, R()), y: y + R() * 4 * S, vx: (R() - 0.5) * 90 * S, vy: -R() * 120 * U, life: fall * (0.6 + R() * 0.6), s: (3 + R() * 6) * S, sp: (R() * 4) | 0, rot: R() * TAU, rv: (R() - 0.5) * 20 });
      }
    }

    const BURST0 = EXIT + BLAZE;
    const skip = (n) => { for (let i = 0; i < n; i++) R(); };      // (what was cut from this scene drew this many random numbers: the rest stays as it was)
    /* ---- what happens when ---- */
    // The impact: the frame is white for two frames; the knock lands as it clears (frames 3 to 8).
    hit(KNOCK, 46, 150, 0.85);
    flashes.push([0, 1, 2]);
    thumps.push([0, 1.6]);
    dustFront(0, W * 0.5 + 60 * S, 14, 1);
    dustBurst(60, cx, gy, 1.5, 8, W * 0.3, 3200, true);
    skip(56);
    rockBurst(0, cx, gy, 30, 1, 2.3);
    rockBurst(0, cx, gy, 12, 1.5, 1.5);
    debris(0, 16, 1);
    // the foot of the berm comes up out of dust
    for (let i = 0; i < 4; i++) sheet(10 + i * 30, cx + (i - 1.5) * Rc * 0.5, (i - 1.5) * Rc * 0.2, { life: 700 + R() * 300, y: gy + (62 + R() * 16) * S * hk, tau: 120, drift: (i - 1.5) * 40 * S, lift: 6 * S, a: 0.8, z: hk < 0.75 ? 2 : 1, green: true, front: true });
    sparkBurst(0, cx, gy, 34, 1, Rc * 1.2, false);
    skip(8);
    // The digits.
    digits.forEach((g, i) => {
      const t = landAt[i];
      const wd = g.x1 - g.x0;
      hit(t, 11, 110, 0.8);                                 // the camera drops ~9 px as it lands
      thumps.push([riseAt[i], 0.5]);
      thumps.push([t, 0.7]);
      dustBurst(riseAt[i] + 40, g.cx, gy, 0.3, 2, wd * 0.7, 1100, true);
      dustBurst(t, g.cx, gy, 0.7, 4, wd * 1.5, 1300, true);  // the ring of dust it lands in
      for (let k = 0; k < 6; k++) rock(riseAt[i] + R() * RISE * 0.8, g.cx + (R() - 0.5) * wd, gy - 4 * S, (R() - 0.5) * 620 * S, -(380 + R() * 620) * U, (7 + R() * 13) * S, R() < 0.6);
      for (let k = 0; k < 7; k++) { const dir = k % 2 ? 1 : -1; rock(t + R() * 20, g.cx + dir * wd * (0.3 + R() * 0.3), gy + 2 * S, dir * (120 + R() * 520) * S, -(300 + R() * 520) * U, (7 + R() * 14) * S, R() < 0.7); }
      sparkBurst(riseAt[i], g.cx, gy, 7, 0.75, wd * 0.8, true);
      // the breach: rubble in front of the digit is heaved up and aside as it comes through; grit pours off its shoulders
      for (let k = 0; k < 4; k++) {
        const dir = k % 2 ? 1 : -1;
        // (they lie before the middle of the digit, below its feet: never at its corners or between two digits)
        breach.push({ t: riseAt[i] + R() * 60, land: t, x: g.cx + dir * wd * (0.06 + 0.12 * R()), y: gy + (30 + R() * 12) * S * hk, size: (30 + R() * 20) * S * hk, sp: (R() * 6) | 0, rot: R() * TAU,
          dir: dir, tilt: dir * (0.5 + R() * 0.7), slide: dir * wd * (0.04 + R() * 0.1), lift: (14 + R() * 22) * S * hk, rest: 0.35 + R() * 0.3, kick: (5 + R() * 9) * S, j: R() });
      }
      chipBurst(riseAt[i] + RISE * 0.3, g.x0, g.x1, gy - g.size * 0.3, 10, 480);
      chipBurst(riseAt[i] + RISE * 0.62, g.x0, g.x1, gy - g.size * 0.55, 12, 520);
      chipBurst(riseAt[i] + RISE * 0.95, g.x0, g.x1, gy - g.size * 0.72, 12, 560);
      rockBurst(riseAt[i] + 30, g.cx, gy + 6 * S, 4, 0.5, 1.6);
      sparkBurst(t, g.cx, gy, 6, 0.55, wd, false);
    });
    // The title.
    words.forEach((w) => {
      const wb = titleCy + titleSize * (desc + EXT);
      const ww = w.x1 - w.x0;
      if (w.hero) {
        hit(w.at, 24, 130, 0.75);
        blooms.push([w.at, 0.5, w.cx, titleCy + titleSize * 0.3, ww]);
        thumps.push([w.at, 1.2]);
        dustFront(w.at, W * 0.3, 6, 0.6);
        rockBurst(w.at, cx, gy, 10, 0.7, 2.0);
        sparkBurst(w.at, cx, gy, 14, 0.75, Rc, false);
        sparkBurst(w.at, w.cx, wb, 8, 0.5, ww, false);
        chipBurst(w.at, w.x0, w.x1, wb, 16, 620);
      } else {
        hit(w.at, 12, 110, 0.7);
        thumps.push([w.at, 0.5]);
        sparkBurst(w.at, w.cx, wb, 6, 0.45, ww, false);
        chipBurst(w.at, w.x0, w.x1, wb, 9, 520);
      }
    });
    // The heartbeat: harder each time; the last is more than twice the first.
    const beatK = BEATS.map((b, i) => 1 + 1.15 * i / Math.max(1, BEATS.length - 1));
    BEATS.forEach((b, i) => {
      const k = beatK[i];
      const e = (k - 1) / 1.15;                              // 0 at the first, 1 at the last
      thumps.push([b, 0.62 * k]);
      thumps.push([b + DUB, 0.4 * k]);
      hit(b, lerp(8, 14, e) / 0.8, 80, 0.8, 0);              // the camera drops 8 px at the first, 14 at the last (little shake: a thump)
      hit(b + DUB, lerp(4, 7.5, e) / 0.8, 70, 0.8, 0);
      pulses.push([b, 0.009 * k]);
      pulses.push([b + DUB, 0.0052 * k]);
      for (let q = 0; q < 3 + 2 * i; q++) rock(b + R() * 30, cx + (R() - 0.5) * Rc * 2.2, gy + R() * 20 * S, (R() - 0.5) * 110 * S, -(190 + R() * 260 + i * 40) * U, (5 + R() * 7) * S, true);
      sparkBurst(b, cx, gy, 3 + 2 * i, 0.4 + i * 0.05, Rc * 1.6, true);
      if (i >= 2) {                                         // from the third beat the berm shudders and breathes dust
        tremors.push([b, 1.6 + 2.6 * e]);
        tremors.push([b + DUB, 1 + 1.4 * e]);
        dustBurst(b, cx, gy, 0.3 + 0.5 * e, 2 + (i >> 1), Rc * (1.2 + e), 1500, true);
        chipBurst(b, hx0, hx1, gy + 4 * S, 4 + 2 * i, 420);
      }
    });
    // The second smash: the whole block is thrown up as one mass, and comes down cracked.
    hit(SMASH + 17, 28, 150, 0.75);
    flashes.push([SMASH, 0.95, 0]);
    thumps.push([SMASH, 1.6]);
    dustFront(SMASH, W * 0.5, 10, 0.85);
    skip(28);
    rockBurst(SMASH, cx, gy, 20, 0.95, 2.2);
    debris(SMASH, 8, 0.8);
    sparkBurst(SMASH, cx, gy, 26, 0.95, Rc * 1.3, false);
    hit(SMASH + HOP, 24, 130, 0.8);                         // ... and it crashes back
    thumps.push([SMASH + HOP, 1.3]);
    tremors.push([SMASH + HOP, 5]);
    dustFront(SMASH + HOP, W * 0.34, 8, 0.7);
    rockBurst(SMASH + HOP, cx, gy + 4 * S, 14, 0.6, 2.4);
    sparkBurst(SMASH + HOP, cx, gy, 12, 0.6, Rc * 1.2, false);
    if (hero.length) chipBurst(SMASH + HOP, hx0, hx1, gy - heroSize * 0.3, 22, 700);
    if (hasYear && words.length) chipBurst(SMASH + HOP, words[0].x0, words[nw - 1].x1, titleCy + titleSize * desc, 18, 700);
    // The final pound: one flash; the cracks blaze; the letters burst (no second flash).
    hit(EXIT + 17, 30, 160, 0.75);
    flashes.push([EXIT, 1, 0]);
    thumps.push([EXIT, 1.8]);
    hit(EXIT + BLAZE, 12, 110, 0.5);
    dustFront(EXIT, W * 0.5, 8, 0.9);
    skip(28);
    dustBurst(EXIT + BLAZE, cx, gy, 1, 4, W * 0.3, 1100, true);
    rockBurst(EXIT, cx, gy, 12, 0.9, 2.2);
    sparkBurst(EXIT, cx, gy, 28, 1, Rc * 1.4, false);
    sparkBurst(EXIT + BLAZE, cx, gy - heroSize * 0.4, 22, 0.9, Rc * 1.6, false);
    // the pieces come down on the rubble (two rumbles), the heap gives way from its ends inward in dust, and the
    // last of it settles with a low thud: the light dies with it
    hit(BURST0 + 330, 7, 80, 0.8, 0.4);
    hit(BURST0 + 520, 9, 80, 0.8, 0.4);
    tremors.push([BURST0 + 330, 3]);
    tremors.push([BURST0 + 520, 4]);
    dustBurst(BURST0 + 300, cx - (hx1 - hx0) * 0.22, gy, 0.7, 4, (hx1 - hx0) * 0.5, 800, false);
    dustBurst(BURST0 + 470, cx + (hx1 - hx0) * 0.2, gy, 0.8, 4, (hx1 - hx0) * 0.6, 800, false);
    for (let i = 0; i < 5; i++) {
      const d = 1 - i / 4;                                // from the ends inward
      for (const dir of [-1, 1]) dustBurst(CRUMBLE + (1 - d) * SINK[0] - 30 + R() * 30, cx + dir * d * ((hx1 - hx0) * 0.5 + 80 * S), gy, 0.6, 2, 190 * S, 520, false);
    }
    dustBurst(LAST - 20, cx, gy, 1, 6, (hx1 - hx0) * 0.6, 420, false);
    hit(LAST, 15, 80, 0.85, 0.3);
    thumps.push([LAST, 0.9]);

    /* ---- what never stops while the words hold ---- */
    // dust rolling outward along the ground, in layers (the near ones faster): each sheet crosses its stretch and thins away
    const amb = [];
    for (let i = 0; i < 12; i++) {
      const front = i % 3 === 2;
      const dir = i % 2 ? 1 : -1;
      amb.push({
        dir: dir, x0: (0.1 + R() * 0.5) * Rc, span: (front ? 1.7 : 1.1) * Rc * (0.8 + R() * 0.4), per: (front ? 3000 : 4200) * (0.8 + R() * 0.4), ph: (i * 0.29 + R() * 0.1) % 1,
        y: front ? gy + (48 + R() * 30) * S * hk : gy + (4 + R() * 16) * S * hk, a: front ? 0 * R() : 0.7 + R() * 0.25 /* (none rolls in front of the rubble: a sheet there reads as a level bar across the rock) */, sp: i % 3, z: (front ? 2 : (i % 4 === 0 ? 0 : 1)) + (hk < 0.75 ? 1 : 0), green: !front && i % 2 === 0, front: front
      });
    }
    const embers = [];
    for (let i = 0; i < 56; i++) {
      embers.push({ x: cx + (R() - 0.5) * Rc * 2.3, per: 1500 + R() * 2200, ph: R(), rise: (170 + R() * 480) * U, wob: (10 + R() * 30) * S, wp: R() * TAU, w: (4.5 + R() * 8) * S, fl: 0.006 + R() * 0.012 });
    }

    rocks.sort((a, b) => a.t - b.t);
    lands.sort((a, b) => a.t - b.t);
    const X = (v) => +(clamp(v / W, 0, 1)).toFixed(3);
    const burst = EXIT + BLAZE;
    const plan = {
      impact: { t: 0, x: X(cx), knock: KNOCK },
      digits: digits.map((g, i) => ({ x: X(g.cx), i: i, rise: riseAt[i], hang: riseAt[i] + RISE, land: landAt[i] })),
      words: words.map((w) => ({ x: X(w.cx), land: w.at, punch: PUNCH, letters: w.g.map((g) => X(g.cx)) })),
      titleDone: titleDone,
      accent: { t: titleDone, x: X(cx) },
      beats: BEATS.map((b, i) => ({ t: b, dub: b + DUB, strength: +beatK[i].toFixed(2) })),
      sweeps: SWEEPS.map((t) => ({ t: t, dur: SWEEP })),
      smash: { t: SMASH, x: X(cx), knock: SMASH + 17, hopLand: SMASH + HOP, titleLand: SMASH + HOP + LAG, cracks: G.map((g) => ({ t: SMASH + HOP + (g.line === 0 && hasYear ? LAG : 0), dur: CRACK, x: X(g.cx), line: g.line })) },
      exit: { t: EXIT, x: X(cx), knock: EXIT + 17, blaze: BLAZE, burst: burst, shatters: G.map((g) => ({ t: EXIT, breaks: burst, x: X(g.cx), line: g.line })), pieceLands: [burst + 330, burst + 520], crumble: CRUMBLE, crumbleEnd: LAST, thud: LAST, dark: LAST + FADE },
      rockLands: lands,
      rubbleLands: [],
      flybys: [],
      debris: rocks.filter((r) => r.near).map((r) => ({ t: Math.round(r.t), x: X(r.x), dir: r.vx > 0 ? 1 : -1 })),
      lens: [],
      jets: [],
      tremble: { t: TREMBLE, until: EXIT },
      dust: dustCues,
      shockwaves: shocks,
      fissures: { t: 0, dur: REVEAL },
      cool: burst + 180, lastPulse: LAST, gone: GONE, duration: DURATION
    };

    return {
      W: W, H: H, D: D, S: S, U: U, cx: cx, gy: gy, Rc: Rc, GRAV: GRAV, hasYear: hasYear, desc: desc,
      G: G, digits: digits, letters: letters, words: words, riseAt: riseAt, landAt: landAt, titleDone: titleDone,
      heroCy: heroCy, heroSize: heroSize, titleCy: titleCy, titleSize: titleSize, hx0: hx0, hx1: hx1,
      hits: hits, flashes: flashes, blooms: blooms, thumps: thumps, pulses: pulses, tremors: tremors, puffs: puffs, rocks: rocks, sparks: sparks, chips: chips,
      boulders: boulders, breach: breach, hk: hk, embers: embers, amb: amb, plan: plan, seed: ((sig * 4294967296) >>> 0)
    };
  }

  /** Splits a polygon by the line through (mx, my) with normal (nx, ny): [the side behind it, the side ahead]. */
  function splitPoly(poly, mx, my, nx, ny) {
    const a = [], b = [];
    for (let k = 0; k < poly.length; k++) {
      const A = poly[k], B = poly[(k + 1) % poly.length];
      const da = (A[0] - mx) * nx + (A[1] - my) * ny, db = (B[0] - mx) * nx + (B[1] - my) * ny;
      (da <= 0 ? a : b).push(A);
      if ((da <= 0) !== (db <= 0)) { const u = da / (da - db); const p = [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u]; a.push(p); b.push(p); }
    }
    return [a, b];
  }
  const polyArea = (p) => { let s = 0; for (let k = 0; k < p.length; k++) { const A = p[k], B = p[(k + 1) % p.length]; s += A[0] * B[1] - B[0] * A[1]; } return Math.abs(s) / 2; };

  /**
   * Every picture of the scene, made once per size, text and seed. A generator: it yields every
   * millisecond or two of work, so that prime() can spread it over the seconds before midnight in
   * thin slices, and create() can simply run it to the end when the animation is asked for at once.
   * Either way the pictures are the same.
   */
  function* makePics(sim, P) {
    const S = sim.S, U = sim.U, W = sim.W, H = sim.H, cx = sim.cx, gy = sim.gy;
    const t = mk(2, 2).getContext('2d');
    const touch = (c) => { if (c && c.width) t.drawImage(c, 0, 0, 2, 2); };              // a picture is used once here, never first at midnight
    while (!TEX.done && sim.wait && now() < sim.wait) yield 'wait';                       // the photographs are still being read
    yield;
    texNow();
    P.real = TEX.real;
    yield;
    P.lights = yield* makeLights(W, H, sim.Rc, S);
    touch(P.lights.air);
    P.sp = yield* makeSprites(S);
    // dust sheets at three sizes (always drawn exactly as a picture is, never scaled)
    P.sheet = [];
    for (const pair of P.sp.sheets) {
      const two = [];
      for (const d of pair) {
        const list = [d];
        for (const z of [0.7, 0.48, 0.32]) { list.push(sized(d, d.width * z, d.height * z)); yield; }
        list.forEach(touch);
        two.push(list);
      }
      P.sheet.push(two);
    }
    yield;
    // the burst of light at a great blow: green-white, falling off from the crater; the dust it shines through tears
    // it into layers, and it reaches further here and less there, so it is never a clean oval: no rays, no star
    // (half size, drawn doubled; dithered, so it never bands). It is drawn behind the rock and the letters.
    {
      const bw = Math.ceil(W / 2), bh = Math.ceil(H * 0.84 / 2);
      const px = new Uint8ClampedArray(bw * bh * 4);
      const f = 2 / S;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const dx = (x + 0.5 - bw / 2) / (bw / 2), dy = (y + 0.5 - bh * 0.8) / (bh * 0.8);
          const reach = 0.58 + 0.34 * ns(x * f * 0.0065 + 40, y * f * 0.009 + 7);                             // it reaches further here, less there
          const c0 = Math.max(0, 1 - Math.hypot(dx * 1.02, dy * (dy > 0 ? 4.6 : 1.04)) / reach);
          const lay = 0.5 + 0.8 * Math.pow(ns(x * f * 0.14 + 300, y * f * 1.5 + 50) * 0.65 + ns(x * f * 0.5 + 20, y * f * 3.4 + 9) * 0.35, 1.3);   // layers of dust across it
          const core = Math.pow(c0, 3.2);
          const win = smooth(0, 0.12, x / bw) * smooth(0, 0.12, 1 - x / bw) * smooth(0, 0.14, y / bh) * smooth(0, 0.05, 1 - y / bh);                 // (it ends inside its picture)
          const c = Math.pow(c0, 1.45) * lerp(lay, 1, core) * win + (hash2(x, y, 5) - 0.5) * 0.006;
          if (c <= 0) continue;
          putLight(px, (y * bw + x) * 4, 236 * Math.pow(c, 1.35) + 90 * core, 318 * c + 40 * core, 246 * Math.pow(c, 1.22) + 80 * core, 1.2);
        }
        if ((y & 3) === 3) yield;
      }
      P.bloom = toCanvas(px, bw, bh);
      touch(P.bloom);
    }
    // ... and a smaller, greener one around the word that lands hardest
    {
      const bw = Math.ceil(Math.min(W, 1100 * S) / 2), bh = Math.ceil(Math.min(H, 560 * S) / 2);
      const px = new Uint8ClampedArray(bw * bh * 4);
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const c = Math.pow(Math.max(0, 1 - Math.hypot((x + 0.5 - bw / 2) / (bw / 2), (y + 0.5 - bh / 2) / (bh / 2))), 2);
          putLight(px, (y * bw + x) * 4, 190 * c * c + 30 * c, 250 * c, 150 * c * c + 50 * c, 1.5);
        }
        if ((y & 7) === 7) yield;
      }
      P.bloomW = toCanvas(px, bw, bh);
      touch(P.bloomW);
    }
    yield;
    P.ground = yield* makeBerm(W, H, cx, gy, S * clamp(sim.heroSize / (300 * S), 0.42, 1), mulberry(sim.seed ^ 0x6A0D), sim.hx0, sim.hx1, sim.heroSize);
    [P.ground.back, P.ground.front.c, P.ground.lightB.c, P.ground.lightF.c, P.ground.bedB.c, P.ground.bedF.c].forEach(touch);
    for (const r of P.ground.rocks) touch(r.c);
    yield;
    // the shadow the block of letters casts on the berm while it is in the air (behind it, and on the rubble in front)
    {
      const g = P.ground;
      const sw = Math.round(Math.min(g.w, sim.hx1 - sim.hx0 + 150 * S)), sh = Math.round(150 * S);
      const sx = Math.round((sim.hx0 + sim.hx1) / 2 - sw / 2), sy = Math.round(gy - 50 * S);
      const make = (pic, px, py) => {
        const c = mk(sw, sh), q = c.getContext('2d');
        q.drawImage(pic, px - sx, py - sy);
        q.globalCompositeOperation = 'source-in';
        let gr = q.createLinearGradient(0, 0, sw, 0);
        gr.addColorStop(0, 'rgba(3,5,4,0)'); gr.addColorStop(0.12, 'rgba(3,5,4,1)'); gr.addColorStop(0.88, 'rgba(3,5,4,1)'); gr.addColorStop(1, 'rgba(3,5,4,0)');
        q.fillStyle = gr; q.fillRect(0, 0, sw, sh);
        q.globalCompositeOperation = 'destination-in';
        gr = q.createLinearGradient(0, 0, 0, sh);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, 'rgba(0,0,0,1)'); gr.addColorStop(0.62, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
        q.fillStyle = gr; q.fillRect(0, 0, sw, sh);
        touch(c);
        return c;
      };
      P.shadow = { x: sx, y: sy, back: make(g.back, g.x, g.y), front: make(g.front.c, g.x + g.front.x, g.y + g.front.y) };
    }
    yield;
    P.stage = 1;                                        // all that the impact needs is there

    /* ---- the letters: the digits first (they come first), then the title ---- */
    P.GL = [];
    const order = sim.G.map((g, k) => k).sort((a, b) => (sim.G[b].line - sim.G[a].line) || (a - b));
    for (const k of order) {
      const g = sim.G[k];
      const o = yield* makeGlyph(g, S, clamp((g.cx - cx) / W, -0.5, 0.5) * 0.32, mulberry(sim.seed ^ (0x9E3779B1 * (k + 1))));
      o.k = k;
      P.GL[k] = o;
      [o.stoneA, o.stoneB, o.lightA, o.lightB, o.hot, o.hot2, o.tip, o.spec, o.bloom].forEach((c) => touch(c.c));
      if (g.line === 1) P.digits = (P.digits || 0) + 1;
      yield;
    }
    for (const w of sim.words) for (const g of w.g) P.GL[sim.G.indexOf(g)].word = w;
    P.stage = 2;
    // ... and each word of the title as it comes at the camera: blurred by its own approach
    for (const w of sim.words) {
      const os = w.g.map((g) => P.GL[sim.G.indexOf(g)]);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const o of os) { x0 = Math.min(x0, o.ox); y0 = Math.min(y0, o.oy); x1 = Math.max(x1, o.ox + o.w); y1 = Math.max(y1, o.oy + o.h); }
      const wp = mk(x1 - x0, y1 - y0);
      const q = wp.getContext('2d');
      for (const o of os) {
        q.globalCompositeOperation = 'source-over';
        q.globalAlpha = 1;
        q.drawImage(o.stoneA.c, o.ox + o.stoneA.x - x0, o.oy + o.stoneA.y - y0);
        q.globalAlpha = 1;
        q.drawImage(o.hot.c, o.ox + o.hot.x - x0, o.oy + o.hot.y - y0);
        q.globalCompositeOperation = 'lighter';
        q.globalAlpha = 1;
        q.drawImage(o.bloom.c, o.ox + o.bloom.x - x0, o.oy + o.bloom.y - y0);
      }
      // It comes at the camera about a point chosen so that, however large, it never reaches over the
      // word before it (nor out of the frame); and from above: its feet stay where they will stand.
      const ww = w.x1 - w.x0, mg = 24 * S;
      const wi = sim.words.indexOf(w);
      const Lx = wi > 0 ? sim.words[wi - 1].x1 + (w.x0 - sim.words[wi - 1].x1) * 0.35 : mg, Rx = W - mg;
      const bx0 = Math.min(x0, w.x0), bx1 = Math.max(x1, w.x1);
      const Z0 = 0.2;
      const se = clamp((Rx - Lx) / Math.max(1, bx1 - bx0), 1.12, 2.3 * (1 + Z0 / 2));      // the widest it may be, blur and all
      w.s0 = se / (1 + Z0 / 2);
      const lo = (bx1 * se - Rx) / (se - 1), hi = (bx0 * se - Lx) / (se - 1);
      w.px = lo > hi ? (lo + hi) / 2 : clamp(w.cx, lo, hi);
      w.py = y1;
      // the word at half size, as numbers; then a true zoom blur about that point: 28 samples per pixel (in floats: no banding)
      const hw = Math.ceil((x1 - x0) / 2), hh = Math.ceil((y1 - y0) / 2);
      const hc = mk(hw, hh), hq = hc.getContext('2d');
      hq.imageSmoothingQuality = 'high';
      hq.drawImage(wp, 0, 0, hw, hh);
      const sd = hq.getImageData(0, 0, hw, hh).data;
      const sf = new Float32Array(hw * hh * 4);
      for (let i = 0; i < hw * hh * 4; i += 4) { const al = sd[i + 3] / 255; sf[i] = sd[i] * al; sf[i + 1] = sd[i + 1] * al; sf[i + 2] = sd[i + 2] * al; sf[i + 3] = sd[i + 3]; }
      yield;
      const ppx = (w.px - x0) / 2, ppy = (w.py - y0) / 2;       // the point, in the half-size picture
      w.stages = [];
      for (const zk of [Z0, 0.12, 0.05]) {
        const e = 1 + zk / 2;
        const sx0 = Math.floor(ppx + (0 - ppx) * e) - 1, sy0 = Math.floor(ppy + (0 - ppy) * e) - 1;
        const sx1 = Math.ceil(ppx + (hw - ppx) * e) + 1, sy1 = Math.ceil(ppy + (hh - ppy) * e) + 1;
        const cw = sx1 - sx0, chh = sy1 - sy0;
        const out = new Uint8ClampedArray(cw * chh * 4);
        const N = 28;
        const inv = new Float32Array(N);
        for (let j = 0; j < N; j++) inv[j] = 1 / (1 + zk * ((j + 0.5) / N - 0.5));
        for (let y = 0; y < chh; y++) {
          const ry = y + sy0 + 0.5 - ppy;
          for (let x = 0; x < cw; x++) {
            const rx = x + sx0 + 0.5 - ppx;
            let r = 0, g2 = 0, b2 = 0, al = 0;
            for (let j = 0; j < N; j++) {
              const ix = (ppx + rx * inv[j]) | 0, iy = (ppy + ry * inv[j]) | 0;
              if (ix < 0 || iy < 0 || ix >= hw || iy >= hh) continue;
              const q2 = (iy * hw + ix) * 4;
              r += sf[q2]; g2 += sf[q2 + 1]; b2 += sf[q2 + 2]; al += sf[q2 + 3];
            }
            if (al < 0.5 * N) continue;
            const o = (y * cw + x) * 4, k2 = 255 / al;
            out[o] = r * k2; out[o + 1] = g2 * k2; out[o + 2] = b2 * k2; out[o + 3] = al / N;
          }
          if ((y & 1) === 1) yield;
        }
        const c = toCanvas(out, cw, chh);
        w.stages.push({ c: c, x: x0 + sx0 * 2, y: y0 + sy0 * 2, w: cw * 2, h: chh * 2 });
        touch(c);
        yield;
      }
    }
    P.stage = 3;

    /* ---- the light sweep: per line, a work picture and a soft leaning band to show the glints through ---- */
    P.lines = [];
    for (const line of [0, 1]) {
      const os = P.GL.filter((o) => o.line === line);
      if (!os.length) continue;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const o of os) { x0 = Math.min(x0, o.ox + o.bx); y0 = Math.min(y0, o.oy + o.by); x1 = Math.max(x1, o.ox + o.bx + o.bw); y1 = Math.max(y1, o.oy + o.by + o.bh); }
      const lh = y1 - y0, bw = Math.round(lh * 0.5 + 300 * S);
      const px = new Uint8ClampedArray(bw * lh * 4);
      const half = 105 * S;
      for (let y = 0; y < lh; y++) for (let x = 0; x < bw; x++) {
        const d = (x - bw / 2 - (lh / 2 - y) * 0.42) / half;
        const o = (y * bw + x) * 4;
        px[o] = px[o + 1] = px[o + 2] = 255;
        px[o + 3] = 255 * Math.min(1, Math.exp(-d * d * 3) * 0.2 + Math.exp(-d * d * 26) * 0.9);        // a narrow, hard glint with a faint skirt
        if (x === bw - 1 && (y & 31) === 31) yield;
      }
      P.lines.push({ line: line, os: os, x: x0, y: y0, w: x1 - x0, h: lh, work: mk(x1 - x0, lh), band: toCanvas(px, bw, lh), bw: bw });
      yield;
    }
    P.stage = 4;


    /* ---- what each letter breaks into at the end: pieces cut along its cracks, thick, their light apart; sharp and blurred by their fall ---- */
    const RF = mulberry(sim.seed ^ 0x51F15EED);
    P.chunks = [];
    for (const o of P.GL) {
      const ps = yield* o.pieces();
      o.pieces = null;
      for (const pc of ps) {
        const c = toCanvas(pc.px, pc.w, pc.h);
        const wx = o.ox + pc.x + pc.mx, wy = o.oy + pc.y + pc.my;
        let dx = wx - cx, dy = wy - (gy + 60 * S);
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        // Thrown low: heavy, turning slowly. It comes down on the rubble at the feet of the letters, inside the heap
        // (its lowest corner behind the row of rock in front), and tips over until it lies on its side, bedding
        // itself in; it goes when the rock under it goes. Its blur is short and along the way it is really going
        // when it is fast.
        const g = P.ground;
        const sp = (240 + RF() * 420) * U;
        let vx = dx * sp * 0.85 + (RF() - 0.5) * 150 * U;
        let vy = dy * sp * 0.3 - (40 + RF() * 130) * U;
        const big = pc.w * pc.h > 0.05 * sim.heroSize * sim.heroSize;
        const om = big ? 0 : (RF() - 0.5) * 2.8;                         // (a big piece does not turn in the air: it is put on whole pixels, a plain copy)
        // (An upright piece of a letter of the title is half a letter. So that no row of them ever stands on the heap as
        // a word, each is thrown up a little more or less (they come down one after another, not together) and goes
        // over at once and fast when it lands.)
        const lean = om === 0 && o.line === 0 && o.size < 0.7 * sim.heroSize && pc.h > pc.w * 0.8;
        if (lean) vy -= RF() * 300 * U;
        const G2 = sim.GRAV * 1.3;
        const delay = RF() * 60;
        const gyl = gy + (10 + RF() * 16) * S * sim.hk;                  // where its lowest corner comes to rest
        const low = (a) => { const s = Math.sin(a), q = Math.cos(a); return Math.max(-s * pc.mx, s * (pc.w - pc.mx)) + Math.max(-q * pc.my, q * (pc.h - pc.my)); };
        let t1 = 0;
        while (t1 < 1.5 && wy + vy * t1 + 0.5 * G2 * t1 * t1 + low(om * t1) < gyl) t1 += 0.004;
        const lim = g.keep + 0.3 * (g.w / 2 - g.keep);                   // it lands on the heap, never beside it
        let lx = wx + vx * t1;
        if (Math.abs(lx - g.mid) > lim) { lx = g.mid + Math.sign(lx - g.mid) * lim * (0.72 + 0.28 * RF()); vx = (lx - wx) / Math.max(0.05, t1); }
        const out = Math.abs(lx - g.mid) / lim;
        const dir = out > 0.55 ? -Math.sign(lx - g.mid) : (RF() < 0.75 ? (vx >= 0 ? 1 : -1) : (vx >= 0 ? -1 : 1));      // (at the ends of the heap it falls inward)
        const a1 = om * t1;
        const aT = pc.h > pc.w * 0.8 ? dir * (Math.PI / 2 + (RF() - 0.5) * 0.6) : dir * (0.12 + RF() * 0.3);
        const ts = Math.max(0, (11 * 120 * U - Math.abs(vy)) / G2), l = Math.hypot(vx, vy + G2 * ts) || 1, an = om * ts;
        const co = Math.cos(an), si = Math.sin(an);
        const d1 = [(vx * co + (vy + G2 * ts) * si) / l, (-vx * si + (vy + G2 * ts) * co) / l];
        const b1 = yield* smearPx(pc.px, pc.w, pc.h, d1[0] * 5 * U, d1[1] * 5 * U, 0);
        P.chunks.push({
          k: o.k, c: c, l: toCanvas(pc.lp, pc.w, pc.h), b1: b1, w: pc.w, h: pc.h, mx: pc.mx, my: pc.my, x: wx, y: wy,
          vx: vx, vy: vy, om: om, delay: delay, t1: t1, a1: a1, aT: aT, lx: lx, gyl: gyl, roll: dir * (pc.h > pc.w * 0.8 ? 0.3 * pc.h : 0.06 * pc.w), T: (150 + 170 * Math.sqrt(Math.max(pc.w, pc.h) / sim.heroSize) + RF() * 40) * (lean ? 0.55 : 1), lean: lean,
          sink: Math.min((0.06 + 0.14 * RF()) * Math.min(pc.w, pc.h), 16 * S * sim.hk), dn: clamp((Math.abs(lx - g.mid) + 0.25 * Math.max(pc.w, pc.h)) / (g.w / 2), 0, 1), j: RF(), j2: RF()      /* (its outer end: it goes when the rock under that end goes) */
        });
        yield;
      }
    }
    P.chunks.sort((a, b) => a.y - b.y);                 // the low ones last: on top, so that the cuts open as they part
    for (const c of P.chunks) [c.c, c.l, c.b1.c].forEach(touch);
    P.done = true;
    return P;
  }

  /* ----------------------------------------- scenes kept between runs --- */

  const SCENES = [];

  /**
   * Runs a scene's picture-making for at most `ms` (without a limit when ms is 0), or until `enough`
   * says what is needed is there. True once that is so (or all is made).
   */
  function pump(sc, ms, enough) {
    const t0 = now();
    for (;;) {
      if (!sc.it || (enough && enough(sc.P))) return true;
      const r = sc.it.next();
      if (r.done) { sc.it = null; return true; }
      if (r.value === 'wait') { if (ms) return false; sc.sim.wait = 0; continue; }
      if (ms && now() - t0 >= ms) return false;
    }
  }
  /** The rest of the work in thin slices, between the frames of whatever is on screen. */
  function trickle(sc) {
    if (!sc.it || sc.timer) return;
    const tick = () => {
      sc.timer = 0;
      if (!pump(sc, 5.5)) sc.timer = root.setTimeout(tick, 2);
    };
    sc.timer = root.setTimeout(tick, 2);
  }

  /* ---------------------------------------------------------- create --- */

  function create(env) {
    const sig = env.rnd();
    const L = env.layout;
    let fontOk = true;
    try { fontOk = !document.fonts || document.fonts.check(font(40)); } catch (e) { /* as it is */ }
    if (!env.priming) texNow();                         // asked to play now: the photographs as they are (read at once if they are loaded)
    // (From prime() the pictures wait for the photographs, so that scene counts as made with them even if they are
    // still being read; one that had to be made without them is dropped as soon as they are there.)
    const text = [L.title, L.year, sig, fontOk, env.priming || TEX.real || !TEX.imgs].join('|');
    const key = [env.W, env.H, env.dpr, L.titleSize, L.yearSize, L.cx, L.titleY, text].join('|');
    let sc = null;
    for (const s of SCENES) if (s.key === key) sc = s;
    if (sc && sc.P.real === false && TEX.real) { if (sc.timer) root.clearTimeout(sc.timer); SCENES.splice(SCENES.indexOf(sc), 1); sc = null; }
    if (!sc) {
      const sim = makeSim(env, sig);
      sim.wait = now() + 3000;
      sc = { key: key, text: text, sim: sim, P: {}, it: null, timer: 0 };
      sc.it = makePics(sim, sc.P);
      SCENES.push(sc);
      if (SCENES.length > 3) { const old = SCENES.shift(); if (old.timer) root.clearTimeout(old.timer); }
    }
    // The sound's plan.
    env.cue('plan', JSON.parse(JSON.stringify(sc.sim.plan)), 0);
    // From prime() the pictures are made in slices (prime() below starts them). Asked to play at once,
    // they are made in the order they are needed: each when it is first drawn, the rest in slices
    // between the frames. If the same words are already there at another size (the window was
    // resized while it plays), those pictures are drawn scaled until the new ones are made.
    let alt = null;
    if (!env.priming && sc.it) {
      for (const s of SCENES) if (s !== sc && s.text === sc.text && !s.it) alt = s;
      if (alt) trickle(sc);
      else if (sc.timer) { root.clearTimeout(sc.timer); sc.timer = 0; }
    }
    const own = drawer(sc, env);
    const other = alt ? drawer(alt, env) : null;
    return {
      step: function () { /* a frame depends only on the seed and t */ },
      draw: function (t) {
        if (other && sc.it) {
          const k = sc.sim.S / alt.sim.S;
          return other(t, k, sc.sim.cx - alt.sim.cx * k, sc.sim.gy - alt.sim.gy * k);
        }
        const t0 = now();
        const r = own(t, 1, 0, 0);
        // what is not made yet is made in the time a frame leaves over (at most 4 ms a frame)
        if (sc.it && !sc.timer) { const used = now() - t0; if (used < 7) pump(sc, Math.min(4, 8.5 - used)); }
        return r;
      },
      prime: function () { if (!pump(sc, 5)) trickle(sc); }
    };
  }

  /** What draws a scene: draw(t, k, bx, by) (scaled by k and moved by (bx, by) when it stands in for another size). */
  function drawer(sc, env) {
    const ctx = env.ctx;
    const sim = sc.sim;
    const W = sim.W, H = sim.H, D = sim.D, S = sim.S, U = sim.U;
    const cx = sim.cx, gy = sim.gy, Rc = sim.Rc, GRAV = sim.GRAV;
    const BURST = EXIT + BLAZE;
    const P = sc.P;
    let ox = 0, oy = 0;                                 // the camera: knocked about (whole pixels; everything moves by the same amount)
    let gty = 0;                                        // the berm shuddering
    let bk = 1, bx = 0, by0 = 0;                        // the scene as a whole, scaled and moved (a stand-in for another size)
    const ST = (a, b, c, d, e, f) => ctx.setTransform(a * bk, b * bk, c * bk, d * bk, e * bk + bx, f * bk + by0);
    const need = (enough) => { if (sc.it && !enough(P)) pump(sc, 0, enough); };
    const bump = (tau, T) => (tau <= 0 ? 0 : (tau / T) * Math.exp(1 - tau / T));          // up fast, back more slowly: 1 at tau = T

    function sumPulse(list, t, decay) {
      let v = 0;
      for (let i = 0; i < list.length; i++) {
        const tau = t - list[i][0];
        if (tau >= 0 && tau < decay * 7) v += list[i][1] * pulse(tau, decay);
      }
      return v;
    }

    /**
     * The camera. Every blow shoves it down (it is back within a few frames) and shakes it with smooth
     * noise that dies away; before the final pound the ground trembles, more and more. There is no
     * zoom: everything moves by the same whole pixels, so the lockup always moves as one.
     */
    function setCamera(t) {
      let sx = 0, sy = 0;
      for (let i = 0; i < sim.hits.length; i++) {
        const h = sim.hits[i];
        const tau = t - h.t;
        if (tau < 0 || tau > h.d * 6) continue;
        const e = Math.exp(-tau / h.d) * Math.min(1, tau / 12);
        sx += h.a * h.n * e * vn(tau * 0.017 + 0.5, h.s) * 0.8;
        sy += h.a * h.n * e * vn(tau * 0.019 + 0.5, h.s + 77) * 0.6 + h.a * h.k * bump(tau, 22);
      }
      if (t > TREMBLE && t < EXIT + 60) {
        const a = 6.5 * S * Math.pow((Math.min(t, EXIT) - TREMBLE) / (EXIT - TREMBLE), 1.5);
        sx += a * vn(t * 0.043, 901);
        sy += a * vn(t * 0.049, 902);
      }
      ox = Math.round(sx); oy = Math.round(sy);
      let g = 0;
      for (let i = 0; i < sim.tremors.length; i++) {
        const tau = t - sim.tremors[i][0];
        if (tau >= 0 && tau < 420) g += sim.tremors[i][1] * S * Math.exp(-tau / 80) * vn(tau * 0.07, 400 + i);
      }
      gty = Math.round(g);
    }
    /** The whole lockup swells a little on a heartbeat (1 when it does not). */
    function lockScale(t) {
      let v = 0;
      for (let i = 0; i < sim.pulses.length; i++) {
        const tau = t - sim.pulses[i][0];
        if (tau > 0 && tau < 260) v += sim.pulses[i][1] * bump(tau, 32);
      }
      return v < 0.001 ? 1 : 1 + v;
    }

    /** How far a rock of the berm is on its way up out of the pit (<= 0 not yet, >= 1 landed); dn: 0 in the middle .. 1 at the ends. */
    const riseU = (dn, j, j2, t) => (t - 14 - dn * 105 - j * 28) / (105 + 55 * j2);
    /** How far gone it is at the end (<= 0 it stands, >= 1 gone): the heap gives way from its ends inward. */
    const sinkQ = (dn, j, j2, t) => (t - CRUMBLE - (1 - dn) * SINK[0] - j * 30) / (SINK[1] + 40 * j2);
    const dnAt = (x) => clamp(Math.abs(x - P.ground.mid) / (P.ground.w / 2), 0, 1);
    /**
     * The berm, behind the letters or in front of their feet. While it stands it is one picture. At the
     * impact every rock is thrown up out of the pit on its own arc (opaque from its first frame: it
     * grows and turns as it comes, it never fades in) over a bed of dust that gathers under it; at the
     * end every rock rolls over and drops away into the pit, from the ends of the heap inward.
     */
    function drawBerm(t, pit, front) {
      const g = P.ground;
      const X = g.x + ox, Y = g.y + oy + gty;
      if (t >= LAST + 20) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (t >= REVEAL && t < CRUMBLE) {
        if (front) ctx.drawImage(g.front.c, X + g.front.x, Y + g.front.y); else ctx.drawImage(g.back, X, Y);
      } else {
        const rising = t < REVEAL;
        const bed = front ? g.bedF : g.bedB;
        const ba = rising ? smooth(210, REVEAL, t) : 1 - smooth(CRUMBLE - 140, CRUMBLE + 70, t);      // (the bed has gone before the first rock goes: it is never left alone)
        if (ba > 0.02) { ctx.globalAlpha = ba; ctx.drawImage(bed.c, X + bed.x, Y + bed.y); ctx.globalAlpha = 1; }
        const mxl = g.mid - g.x, pyl = gy - g.y + 10 * S * sim.hk, hs = S * sim.hk;
        for (let i = 0; i < g.rocks.length; i++) {
          const r = g.rocks[i];
          if (r.front !== front) continue;
          const h2 = r.sz / 2;
          if (rising) {
            const u = riseU(r.dn, r.j, r.j2, t);
            if (u <= 0) continue;
            if (u >= 1) { ctx.drawImage(r.c, X + r.x, Y + r.y); continue; }
            const cxr = r.x + h2, cyr = r.y + h2;
            const e = 1 - (1 - u) * (1 - u);
            const x = lerp(lerp(mxl, cxr, 0.55), cxr, e), y = lerp(pyl, cyr, u) - (26 + 84 * r.j3) * hs * (1 - 0.5 * r.dn) * 4 * u * (1 - u);
            if (r.sz < 58 * hs) { ctx.drawImage(r.c, Math.round(X + x - h2), Math.round(Y + y - h2)); continue; }      // (a small one: a plain copy)
            const k = 0.42 + 0.58 * smooth(0, 0.75, u);
            const an = (r.j - 0.5) * 2.6 * (1 - u);
            const c = Math.cos(an) * k, sn = Math.sin(an) * k;
            ctx.imageSmoothingEnabled = false;
            ST(c, sn, -sn, c, X + x, Y + y);
            ctx.drawImage(r.c, -h2, -h2);
            ST(1, 0, 0, 1, 0, 0);
          } else {
            const q = sinkQ(r.dn, r.j, r.j2, t);
            if (q >= 1) continue;
            if (q <= 0) { ctx.drawImage(r.c, X + r.x, Y + r.y); continue; }
            // it rolls over and drops away into the pit (it turns and gets smaller as a whole: never flattened)
            const an = (r.j - 0.5) * 2.4 * q, k = 1 - Math.pow(q, 1.5);
            const c = Math.cos(an) * k, sn = Math.sin(an) * k;
            ctx.imageSmoothingEnabled = false;
            ST(c, sn, -sn, c, X + r.x + h2 + (r.j3 - 0.5) * 14 * hs * q, Y + r.y + h2 + (8 * hs + 0.3 * r.sz) * q * q);
            ctx.drawImage(r.c, -h2, -h2);
            ST(1, 0, 0, 1, 0, 0);
          }
        }
        ctx.imageSmoothingEnabled = true;
      }
      // the crater's light coming up between the rocks (it pulses), and what little of it their undersides catch
      const lt = front ? g.lightF : g.lightB;
      const la = Math.min(1, pit) * (t < REVEAL ? smooth(0.62, 1, t / REVEAL) : 1 - smooth(CRUMBLE - 160, CRUMBLE + 40, t));
      if (la > 0.02) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = la;
        ctx.drawImage(lt.c, X + lt.x, Y + lt.y);
      }
    }
    /** The shadow of the block on the berm while it is in the air. */
    function drawShadow(a, front) {
      if (a < 0.03 || !P.shadow) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(front ? P.shadow.front : P.shadow.back, P.shadow.x + ox, P.shadow.y + oy + gty);
    }

    /** Dust: sheets thrown out along the ground by the blows, and the ones that never stop rolling outward. */
    function drawSheets(t, DE, lo, front) {
      ctx.globalCompositeOperation = 'source-over';
      const par = front ? 1.3 : 0.8;
      const px = Math.round(ox * par), py = Math.round(oy * par);
      const env2 = smooth(300, 1400, t) * DE;
      if (env2 > 0.02) {
        for (let i = 0; i < sim.amb.length; i++) {
          const b = sim.amb[i];
          if (b.front !== front || (lo && i > 4)) continue;
          const u = ((t / b.per + b.ph) % 1 + 1) % 1;
          const a = b.a * smooth(0, 0.2, u) * (1 - smooth(0.5, 1, u)) * env2;
          if (a < 0.012) continue;
          const pic = P.sheet[b.sp][b.green ? 1 : 0][b.z];
          ctx.globalAlpha = a;
          ctx.drawImage(pic, Math.round(cx + b.dir * (b.x0 + b.span * u) - pic.width / 2) + px, Math.round(b.y - pic.height) + py);
        }
      }
      for (let i = 0; i < sim.puffs.length; i++) {
        const p = sim.puffs[i];
        if (p.front !== front || (lo && (i & 3) === 3)) continue;
        const tau = t - p.t;
        if (tau < 0 || tau >= p.life) continue;
        const u = tau / p.life;
        const a = Math.min(1, p.a) * Math.min(1, tau / 34) * Math.pow(1 - u, 1.4) * DE;
        if (a < 0.012) continue;
        const pic = P.sheet[p.sp][p.green ? 1 : 0][p.z];
        ctx.globalAlpha = a;
        ctx.drawImage(pic, Math.round(p.x + p.dx * (1 - Math.exp(-tau / p.tau)) + p.drift * tau * 0.001 - pic.width / 2) + px, Math.round(p.y - p.lift * u - pic.height) + py);
      }
    }
    function drawRocks(t, front) {
      ctx.globalCompositeOperation = 'source-over';
      const sp = P.sp;
      for (let i = 0; i < sim.rocks.length; i++) {
        const r = sim.rocks[i];
        if (r.t > t) break;
        if (r.front !== front) continue;
        const tau = (t - r.t) / 1000;
        let x, y, vx = r.vx, vy, rot, a = 1;
        let kf = 1;
        if (tau < r.t1) { x = r.x + r.vx * tau; vy = r.vy + GRAV * tau; y = r.y + r.vy * tau + 0.5 * GRAV * tau * tau; rot = r.rot + r.rv * tau; if (y > H + 140 * S || x < -160 * S || x > W + 160 * S || (y > r.cut && vy > 0)) continue; }
        else {
          const t2 = tau - r.t1;
          if (t2 < r.t2) { vx = r.vx2; x = r.x + r.vx * r.t1 + r.vx2 * t2; vy = r.vy2 + GRAV * t2; y = r.yg + r.vy2 * t2 + 0.5 * GRAV * t2 * t2; rot = r.rot + r.rv * r.t1 + r.rv * 0.4 * t2; }
          else {
            const t3 = (t2 - r.t2) * 1000;
            if (t3 > r.fade) continue;
            vx = 0; vy = 0; x = r.x + r.vx * r.t1 + r.vx2 * r.t2; y = r.yg; rot = r.rot + r.rv * r.t1 + r.rv * 0.4 * r.t2;
            kf = Math.sqrt(1 - t3 / r.fade);                                                   // it settles into the rubble (never a fade)
            y += r.size * 0.35 * (1 - kf);
            if (t >= CRUMBLE) { const q = sinkQ(dnAt(x), 0.5, 0.5, t); if (q >= 1) continue; if (q > 0) kf *= 1 - q; }
          }
        }
        const speed = Math.hypot(vx, vy);
        const bl = speed * r.sh / r.size;                      // how long the blur of the exposure is, in rocks
        const k = r.size / sp.rs * kf;
        ctx.globalAlpha = a;
        ctx.imageSmoothingEnabled = k > 1.4 || (bl <= 0.55 && r.size > 16 * S);
        if (bl > 0.55) {
          const b = sp.rockBlur[r.sp][bl > 1.1 ? 1 : 0];
          const an = Math.atan2(vy, vx) - Math.PI / 2;
          const c = Math.cos(an) * k, s = Math.sin(an) * k;
          ST(c, s, -s, c, x + ox, y + oy);
          ctx.drawImage(b.c, -b.c.width / 2, -b.c.height / 2);
        } else {
          const turn = ((rot % TAU) + TAU) % TAU;
          const ai = Math.round(turn / TAU * 16);
          const res = turn - ai / 16 * TAU;
          const c = Math.cos(res) * k, s = Math.sin(res) * k;
          ST(c, s, -s, c, x + ox, y + oy);
          ctx.drawImage(sp.rocks[r.sp][ai & 15], -sp.rs / 2, -sp.rs / 2);
        }
      }
      ctx.imageSmoothingEnabled = true;
      ST(1, 0, 0, 1, 0, 0);
    }
    function drawChips(t, lo) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < sim.chips.length; i++) {
        const c = sim.chips[i];
        const tau = t - c.t;
        if (tau < 0 || tau > c.life || (lo && (i & 1))) continue;
        const ts = tau / 1000;
        const k = c.s / 14;
        const an = c.rot + c.rv * ts;
        const co = Math.cos(an) * k, si = Math.sin(an) * k;
        ctx.globalAlpha = Math.min(1, (1 - tau / c.life) * 3);
        ST(co, si, -si, co, c.x + c.vx * ts + ox, c.y + c.vy * ts + 0.5 * GRAV * 0.8 * ts * ts + oy);
        ctx.drawImage(P.sp.chips[c.sp], -7, -7);
      }
      ctx.imageSmoothingEnabled = true;
      ST(1, 0, 0, 1, 0, 0);
    }
    function drawSparks(t, lo, pit) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < sim.sparks.length; i++) {
        const p = sim.sparks[i];
        const tau = t - p.t;
        if (tau < 0 || tau > p.life || (lo && (i & 1))) continue;
        const ts = tau / 1000;
        const vy = p.vy + p.g * ts;
        const sp = Math.hypot(p.vx, vy);
        const len = clamp(sp * 0.036, p.w * 5, 130 * S) / 96, wd = p.w / 8 * 1.6;
        const c = p.vx / sp, s = vy / sp;
        ctx.globalAlpha = Math.min(1, (1 - tau / p.life) * 2.2) ;
        ST(c * len, s * len, -s * wd, c * wd, p.x + p.vx * ts + ox, p.y + p.vy * ts + 0.5 * p.g * ts * ts + oy);
        ctx.drawImage(P.sp.spark, -90, -4);
      }
      ST(1, 0, 0, 1, 0, 0);
      // embers climbing out of the pit, flickering
      const env2 = smooth(700, 2200, t) * (1 - smooth(EXIT, EXIT + 500, t)) ;
      if (env2 < 0.02) return;
      for (let i = 0; i < sim.embers.length; i++) {
        const e = sim.embers[i];
        if (lo && (i & 1)) continue;
        const u = ((t / e.per + e.ph) % 1 + 1) % 1;
        const fl = 0.55 + 0.45 * Math.sin(t * e.fl + e.wp * 5) * Math.sin(t * e.fl * 0.37 + e.wp);
        const a = Math.min(1, u * 5) * (1 - u) * fl * env2 * Math.min(1.7, 0.8 + pit * 0.7) * 1.4;
        if (a < 0.03) continue;
        const w = e.w * (1 - 0.5 * u);
        ctx.globalAlpha = Math.min(1, a);
        ctx.drawImage(P.sp.ember, e.x + Math.sin(u * 7 + e.wp) * e.wob + ox - w / 2, gy - 6 * S - u * e.rise + oy - w / 2, w, w);
      }
    }

    /** The heat of a letter over its stone: first the edges go cold, then the cracks inside (two pictures), and the glow they give off. */
    function putHeat(o, X, Y, heat) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = Math.min(1, heat * 2.2);
      ctx.drawImage(o.hot2.c, X + o.hot2.x, Y + o.hot2.y);
      const a1 = clamp((heat - 0.4) / 0.5, 0, 1);
      if (a1 > 0.02) { ctx.globalAlpha = a1; ctx.drawImage(o.hot.c, X + o.hot.x, Y + o.hot.y); }
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, heat);
      ctx.drawImage(o.bloom.c, X + o.bloom.x, Y + o.bloom.y);
    }
    /**
     * One letter standing (at LX, LY from its place, lifted by dy): its stone, its heat, the light in
     * its cracks. `grow` (0..1) is how far the fissures have run up it from its foot after the block
     * crashed back: below that line it is the cracked stone, above it still whole, and where the
     * fissures have just got to they are at their hottest.
     */
    function putGlyph(o, LX, LY, dy, B, heat, veins, grow) {
      const X = o.ox + LX, Y = o.oy + LY + dy;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const part = B && grow < 1;
      const cutY = part ? Math.round(lerp(o.feet - o.oy + 2, o.by - 2, Math.pow(Math.max(0, grow), 0.85))) : 0;
      if (!part) { const st = B ? o.stoneB : o.stoneA; ctx.drawImage(st.c, X + st.x, Y + st.y); }
      else {
        const a = o.stoneA, b = o.stoneB;
        ctx.drawImage(a.c, X + a.x, Y + a.y);
        const sy = clamp(cutY - b.y, 0, b.h);
        if (sy < b.h) ctx.drawImage(b.c, 0, sy, b.w, b.h - sy, X + b.x, Y + b.y + sy, b.w, b.h - sy);
      }
      if (heat > 0.02) putHeat(o, X, Y, heat);
      if (veins > 0.03) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, veins);
        if (!part) {
          const li = B ? o.lightB : o.lightA;
          ctx.drawImage(li.c, X + li.x, Y + li.y);
          if (veins > 1) { ctx.globalAlpha = Math.min(1, veins - 1); ctx.drawImage(li.c, X + li.x, Y + li.y); }
        } else {
          const la = o.lightA, lb = o.lightB;
          const ha = clamp(cutY - la.y, 0, la.h);
          if (ha > 0) ctx.drawImage(la.c, 0, 0, la.w, ha, X + la.x, Y + la.y, la.w, ha);
          const sy = clamp(cutY - lb.y, 0, lb.h);
          if (sy < lb.h) ctx.drawImage(lb.c, 0, sy, lb.w, lb.h - sy, X + lb.x, Y + lb.y + sy, lb.w, lb.h - sy);
          // the tips of the fissures, where they have just got to: white-hot
          const tp = o.tip, s2 = clamp(cutY - tp.y, 0, tp.h), th = Math.min(tp.h - s2, Math.max(5, Math.round(o.size * 0.1)));
          if (th > 0) { ctx.globalAlpha = 1; ctx.drawImage(tp.c, 0, s2, tp.w, th, X + tp.x, Y + tp.y + s2, tp.w, th); }
        }
      }
    }
    /** How far up a digit is (0..1) at u of its rise: it grinds up in three surges, stalling between them (rock is in the way). */
    function grind(u) {
      if (u < 0.2) return 0.4 * smooth(0, 0.2, u);
      if (u < 0.36) return 0.4 + 0.035 * (u - 0.2) / 0.16;
      if (u < 0.54) return 0.435 + 0.335 * smooth(0.36, 0.54, u);
      if (u < 0.7) return 0.77 + 0.03 * (u - 0.54) / 0.16;
      return 0.8 + 0.2 * (1 - Math.pow(1 - (u - 0.7) / 0.3, 2));
    }
    /** A digit on its way up through the rock, hanging, dropping, landing: incandescent, cut off at the ground. */
    function putDigit(o, tau, veins) {
      const size = o.size;
      const top = o.oy + o.by;
      const over = size * 0.12;
      let dy, jx = 0, sq = 0;
      if (tau < RISE) {
        const u = tau / RISE;
        dy = lerp(gy - top + 4 * S, -over, grind(u));
        const stall = (u > 0.2 && u < 0.36) || (u > 0.54 && u < 0.7) ? 1 : 0.35;
        jx = Math.round(2.6 * S * vn(tau * 0.09, o.k) * stall);       // it shudders against the rock
      } else if (tau < RISE + HANG) {
        dy = -over - size * 0.012 * Math.sin((tau - RISE) / HANG * Math.PI);
      } else if (tau < RISE + HANG + FALL) {
        const w = (tau - RISE - HANG) / FALL;
        dy = -over * (1 - w * w);
      } else {
        const tl = tau - RISE - HANG - FALL;
        sq = Math.exp(-tl / 24);                                      // it lands: for two or three frames the stone gives
        const heat = Math.exp(-tl / 240);
        if (sq < 0.05) { putGlyph(o, ox, oy, 0, false, heat, veins, 1); return; }
        ST(1 + 0.05 * sq, 0, 0, 1 - 0.1 * sq, o.g.cx + ox, o.feet + oy + 2 * S * sq);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        const bx2 = o.ox - o.g.cx, by2 = o.oy - o.feet;
        ctx.drawImage(o.stoneA.c, bx2 + o.stoneA.x, by2 + o.stoneA.y);
        putHeat(o, bx2, by2, heat);
        ST(1, 0, 0, 1, 0, 0);
        return;
      }
      const X = o.ox + ox + jx, Y = Math.round(o.oy + oy + dy);
      const hh = Math.min(o.h, Math.round(gy + 17 * S + oy) - Y);                  // behind the rubble in front of it
      if (hh < 2) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const h1 = Math.min(o.hot.h, hh - o.hot.y);
      if (h1 > 0) ctx.drawImage(o.hot.c, 0, 0, o.hot.w, h1, X + o.hot.x, Y + o.hot.y, o.hot.w, h1);
      ctx.globalCompositeOperation = 'lighter';
      const h2 = Math.min(o.bloom.h, hh - o.bloom.y);
      if (h2 > 0) ctx.drawImage(o.bloom.c, 0, 0, o.bloom.w, h2, X + o.bloom.x, Y + o.bloom.y, o.bloom.w, h2);
    }

    /** How high a letter is (px, up is negative) `tt` ms after the second smash threw it up: it crashes back and gives once more. */
    function hopOf(tt) {
      if (tt < 0 || tt >= HOP + 100) return 0;
      const u = tt / HOP;
      if (u < 1) return -H * 0.075 * 4 * u * (1 - u);
      const w = (tt - HOP) / 100;
      return -H * 0.006 * 4 * w * (1 - w);
    }
    const hopAt = (t) => Math.round(hopOf(t - SMASH));
    function drawLetters(t, pit) {
      const GL = P.GL;
      const nd = sim.digits.length, ng = sim.G.length;
      if (sim.hasYear && t < sim.riseAt[nd - 1] + 40) { let c = 0; for (let i = 0; i < nd; i++) if (t >= sim.riseAt[i]) c++; need((p) => (p.digits || 0) >= c); }
      else need((p) => p.stage >= 3);
      // on a heartbeat the whole lockup swells from its feet: one transform for every letter, so it moves as one
      const ls = lockScale(t);
      let LX = ox, LY = oy;
      if (ls !== 1) { ST(ls, 0, 0, ls, cx * (1 - ls) + ox, gy * (1 - ls) + oy); LX = 0; LY = 0; }
      const base = 0.34 + 0.6 * Math.max(0, pit - 0.5);
      const blaze = t >= EXIT ? smooth(0, BLAZE, t - EXIT) : 0;
      const hopping = t >= SMASH && t < SMASH + HOP + 160;
      for (let k = 0; k < ng; k++) {
        const o = GL[k];
        if (!o) continue;
        // The second smash throws the block up, but not as one rigid slab: every letter goes a little higher or
        // lower than its neighbour, drifts and turns a degree or so in the air, and the title comes down a frame
        // or two after the year. Each cracks from its foot as it lands.
        let by = 0, rot = 0, dxk = 0, B = t >= SMASH + HOP, grow = 1, cf = 0;
        if (t >= SMASH) {
          const h1 = hash2(k, 11, 1), h2 = hash2(k, 12, 2), h3 = hash2(k, 13, 3);
          const lag = (o.line === 0 && sim.hasYear ? LAG : 0) + h1 * 12;
          const tt = t - SMASH - lag;
          if (hopping && tt > 0) {
            by = Math.round(hopOf(tt) * (0.93 + 0.14 * h2));
            if (tt < HOP) { const a = Math.sin(tt / HOP * Math.PI); rot = o.line === 1 || Math.abs(h3 - 0.5) < 0.2 ? 0 : (h3 - 0.5) * 0.06 * a; dxk = Math.round((h2 - 0.5) * 7 * S * a); }
          }
          B = tt >= HOP;
          if (B) { grow = (tt - HOP) / CRACK; cf = 0.55 * Math.exp(-(tt - HOP) / 380); }
        }
        const veins = base * (0.8 + 0.5 * vn(t * 0.011, 31 + (k >> 1))) + cf + blaze * 1.7;
        let heat;
        if (o.line === 1) {
          const tau = t - sim.riseAt[o.g.i];
          if (tau < 0) continue;
          if (tau < RISE + HANG + FALL + 200) { putDigit(o, tau, veins); continue; }
          heat = Math.exp(-(tau - RISE - HANG - FALL) / 240) + blaze * 0.6;
        } else {
          const w = o.word;
          if (!w || t < w.at) continue;
          heat = Math.exp(-(t - w.at) / 105) + blaze * 0.6;
        }
        if (rot !== 0 && ls === 1) {
          const c = Math.cos(rot), sn = Math.sin(rot);
          ST(c, sn, -sn, c, o.g.cx + ox + dxk, o.feet + oy + by);
          putGlyph(o, -o.g.cx, -o.feet, 0, B, heat, veins, grow);
          ST(1, 0, 0, 1, 0, 0);
        } else putGlyph(o, LX + dxk, LY, by, B, heat, veins, grow);
      }
      if (t >= SWEEPS[0]) { need((p) => p.stage >= 4); drawSweep(t, LX, LY + hopAt(t)); }
      if (ls !== 1) ST(1, 0, 0, 1, 0, 0);
      // a word of the title on its way to the camera: one picture, blurred by its approach, shrinking
      // onto its place about a point from which it never reaches over the word before it
      for (const w of sim.words) {
        const u = (t - (w.at - PUNCH)) / PUNCH;
        if (u < 0 || u >= 1 || !w.stages) continue;
        const s = 1 + (w.s0 - 1) * Math.pow(1 - u, 1.5);
        const st = w.stages[u < 0.4 ? 0 : u < 0.75 ? 1 : 2];
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = u < 0.1 ? 0.6 : 1;
        ctx.drawImage(st.c, w.px + (st.x - w.px) * s + ox, w.py + (st.y - w.py) * s + oy, st.w * s, st.h * s);
      }
    }

    /**
     * The pieces of the letters after the pound: thrown low and turning slowly, they come down on the
     * heap where the letters stood (each with its foot behind the row of rock in front), tip over about
     * the corner they landed on until they lie on their side, bedded in, and go down with the rock
     * under them when the heap gives way. Never squashed; a short blur along its flight when a piece is fast.
     */
    function drawChunks(t) {
      const G2 = GRAV * 1.3;                                            // heavy: thrown low, they drop fast
      const hs = S * sim.hk;
      ctx.imageSmoothingEnabled = true;
      for (let i = 0; i < P.chunks.length; i++) {
        const c = P.chunks[i];
        const q = t >= CRUMBLE - 15 ? sinkQ(c.dn, c.j * 0.5, c.j2, t + 15) : 0;         // the rock under it goes: so does it
        if (q >= 1) continue;
        const tb = t - BURST - c.delay;
        const ts = Math.max(0, tb) / 1000;
        const px = -c.mx, py = -c.my;
        let x, y, an, fast = false, lowE = 0, rest = false;
        if (ts < c.t1) {
          const vy = c.vy + G2 * ts;
          x = c.x + c.vx * ts + ox; y = c.y + c.vy * ts + 0.5 * G2 * ts * ts + oy; an = c.om * ts;
          fast = Math.hypot(c.vx, vy) >= 13 * 120 * U;                  // (the blur of a 1/120 s exposure is 13 px or more)
        } else {
          const u = Math.min(1, (ts - c.t1) * 1000 / c.T), e = c.lean ? Math.pow(u, 1.2) : u * u;   // it goes over faster and faster, and stops dead (half a letter of the title: at once)
          an = lerp(c.a1, c.aT, e);
          // (its lowest corner stays on the ground as it turns)
          const s = Math.sin(an), q2 = Math.cos(an);
          rest = u >= 1;
          lowE = Math.max(-s * c.mx, s * (c.w - c.mx)) + Math.max(-q2 * c.my, q2 * (c.h - c.my));
          x = c.lx + c.roll * e + ox; y = c.gyl + c.sink * e - lowE + oy + gty;
        }
        let k = 1;
        // (it goes down with the rock under it: its foot drops into the pit, it never shrinks where it lies)
        if (q > 0) { k = 1 - Math.pow(q, 1.5); y += lowE * (1 - k) + (16 * hs + 0.25 * Math.min(c.w, c.h)) * q * q; an += (c.j - 0.5) * 0.5 * q; }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        if (rest && q <= 0 && tb > 200) {
          // lying still: its picture as it lies is made once (turned, filtered) and then only copied (this is most of the exit's cost)
          if (!c.rest) {
            const co = Math.cos(an), si = Math.sin(an);
            const xs = [-c.mx, c.w - c.mx], ys = [-c.my, c.h - c.my];
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            for (const X of xs) for (const Y of ys) { const rx = co * X - si * Y, ry = si * X + co * Y; x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); y0 = Math.min(y0, ry); y1 = Math.max(y1, ry); }
            const bx = Math.ceil(-x0) + 1, by = Math.ceil(-y0) + 1;
            const cv = mk(Math.ceil(x1) + bx + 1, Math.ceil(y1) + by + 1), g2 = cv.getContext('2d');
            g2.setTransform(co, si, -si, co, bx, by);
            g2.drawImage(c.c, px, py);
            c.rest = { c: cv, bx: bx, by: by };
          }
          ST(1, 0, 0, 1, 0, 0);
          ctx.drawImage(c.rest.c, Math.round(x - c.rest.bx), Math.round(y - c.rest.by));
          continue;
        }
        if (an === 0 && k === 1) ST(1, 0, 0, 1, Math.round(x - c.mx) + c.mx, Math.round(y - c.my) + c.my);
        else { const co = Math.cos(an) * k, si = Math.sin(an) * k; ST(co, si, -si, co, x, y); }
        if (fast) ctx.drawImage(c.b1.c, px - c.b1.px, py - c.b1.py);    // a short blur along its flight
        else ctx.drawImage(c.c, px, py);
        const glow = 1 - smooth(20, 170, tb);                           // the light in its cracks dies: it is cold rock that falls
        if (glow > 0.03) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = glow;
          ctx.drawImage(c.l, px, py);
        }
      }
      ST(1, 0, 0, 1, 0, 0);
    }

    /** Rubble in front of a digit: it comes up with the berm, is heaved up and aside as the digit comes through, jumps as it lands, and goes down with the berm. */
    function drawBreach(t) {
      const sp = P.sp;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      for (let i = 0; i < sim.breach.length; i++) {
        const b = sim.breach[i];
        const dn = dnAt(b.x);
        let kb = 1, off = 0;
        if (t < REVEAL) { const u = riseU(dn, b.j, 0.5, t); if (u <= 0) continue; if (u < 1) { kb = 0.42 + 0.58 * smooth(0, 0.75, u); off = (1 - u) * 22 * S - 30 * S * 4 * u * (1 - u); } }
        else if (t >= CRUMBLE) { const q = sinkQ(dn, b.j, 0.5, t); if (q >= 1) continue; if (q > 0) { kb = 1 - q; off = b.size * 0.3 * q; } }
        const tau = t - b.t;
        let p = 0, hop = 0;
        if (tau > 0) {
          const u = Math.min(1, tau / (RISE * 0.8));
          const e = 1 - (1 - u) * (1 - u);
          p = e * (1 - (1 - b.rest) * smooth(RISE, RISE + HANG + FALL + 140, tau));
          hop = Math.sin(Math.min(1, tau / (RISE + HANG + FALL)) * Math.PI) * 0.8 + b.kick / b.lift * bump(t - b.land, 45);
        }
        const rot = b.rot + b.tilt * p;
        const turn = ((rot % TAU) + TAU) % TAU;
        const ai = Math.round(turn / TAU * 16);
        const res = turn - ai / 16 * TAU;
        const k = b.size / sp.rs * kb;
        const c = Math.cos(res) * k, s = Math.sin(res) * k;
        ST(c, s, -s, c, b.x + b.slide * p + ox, b.y - b.lift * hop - b.lift * 0.2 * p + off + oy + gty);
        ctx.drawImage(sp.rocks[b.sp][ai & 15], -sp.rs / 2, -sp.rs / 2);
      }
      ST(1, 0, 0, 1, 0, 0);
    }

    /** A glint crossing the stone: what a light passing in front picks out (the chamfers, the worn edges), shown through a narrow leaning band. */
    function drawSweep(t, LX, LY) {
      for (let k = 0; k < SWEEPS.length; k++) {
        for (const ln of P.lines) {
          const u = (t - SWEEPS[k] - (ln.line === 1 ? 140 : 0)) / SWEEP;
          if (u <= 0 || u >= 1) continue;
          const e = u * u * (3 - 2 * u);
          const bx = Math.round(lerp(-ln.bw, ln.w, e));
          const x0 = Math.max(0, bx), x1 = Math.min(ln.w, bx + ln.bw);
          if (x1 <= x0) continue;
          const q = ln.work.getContext('2d');
          q.save();
          q.beginPath();
          q.rect(x0, 0, x1 - x0, ln.h);
          q.clip();
          q.clearRect(x0, 0, x1 - x0, ln.h);
          q.globalCompositeOperation = 'source-over';
          for (const o of ln.os) if (o.ox + o.w > ln.x + x0 && o.ox < ln.x + x1) q.drawImage(o.spec.c, o.ox + o.spec.x - ln.x, o.oy + o.spec.y - ln.y);
          q.globalCompositeOperation = 'destination-in';
          q.drawImage(ln.band, bx, 0);
          q.restore();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.min(1, Math.sin(u * Math.PI) * 3);
          const X = ln.x + LX, Y = ln.y + LY;
          ctx.drawImage(ln.work, x0, 0, x1 - x0, ln.h, X + x0, Y, x1 - x0, ln.h);
        }
      }
    }

    function draw(t, k, x, y) {
      if (t < 0 || t >= LAST + FADE) return 0;            // (after the last thud every light has died: nothing is drawn)
      bk = k; bx = x; by0 = y;
      need((p) => p.done);                                // whatever prime() has not made yet is made before the first frame is drawn
      const lo = env.low();
      const DE = 1 - smooth(LAST - 40, LAST + FADE - 10, t);   // the dust thins to nothing with the light, after the last thud
      ST(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      setCamera(t);

      // the light of the pit: it breathes, flickers, rises slowly while the words hold, flares on every blow; after the
      // pound it sinks low, flares once more as the last of the rubble settles, and dies to nothing
      const life = smooth(0, 60, t) * (1 - 0.72 * smooth(EXIT + 150, EXIT + 800, t)) * (1 - smooth(LAST + 20, LAST + FADE - 10, t));
      const pit = (0.5 + 0.12 * Math.sin(t * 0.0043) + 0.14 * vn(t * 0.012, 3) + 0.07 * vn(t * 0.034, 9) + 0.2 * smooth(2600, EXIT - 200, t) + sumPulse(sim.thumps, t, 230) * 0.62) * life;

      // the glow that hangs in the dust over the crater: behind everything (the rocks stand dark against it)
      const ga = Math.min(1, pit * 0.8);
      if (ga > 0.02) {
        const gl = P.lights.air;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = ga;
        ctx.drawImage(gl, Math.round(cx - gl.width / 2 + ox), Math.round(gy - P.lights.airY + oy));
      }
      // The exposure at a great blow: white for a frame or two (the impact only), then it falls off fast as light
      // around the crater, behind the rock, the dust and the letters (they stand dark against it: never a veil).
      let white = 0, fall = 0;
      for (let i = 0; i < sim.flashes.length; i++) {
        const f = sim.flashes[i];
        const tau = t - f[0];
        if (tau < 0 || tau > 200) continue;
        const fw = f[2] * 16.6;                             // (just under that many frames, so that never one more is white)
        if (tau < fw) white = Math.max(white, f[1]);
        else fall = Math.max(fall, f[1] * (f[2] ? 1 : 1.3) * Math.exp(-(tau - fw) / 27));
      }
      if (fall > 0.02 && !white) {
        const bl = P.bloom;
        ctx.globalCompositeOperation = 'lighter';
        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = Math.min(1, fall * 1.15);
        ctx.drawImage(bl, Math.round(cx - bl.width + ox), Math.round(gy - bl.height * 1.6 + oy), bl.width * 2, bl.height * 2);
        ctx.imageSmoothingEnabled = true;
      }
      drawSheets(t, DE, lo, false);                       // (the dust behind rolls behind the heap: the rock stands solid before it)
      drawBerm(t, pit, false);
      drawRocks(t, false);
      const air = -hopAt(t) / (H * 0.075);                // 0..1: how far the block is off the ground
      if (t < BURST) {
        drawShadow(air * 0.8, false);
        drawLetters(t, pit);
      } else { need((p) => p.done); drawChunks(t); }
      drawBerm(t, pit, true);
      if (t < BURST) drawShadow(air * 0.8, true);
      drawBreach(t);
      drawSheets(t, DE, lo, true);
      drawRocks(t, true);
      drawChips(t, lo);
      drawSparks(t, lo, pit);

      // light in the lens: a bloom at the hero word
      ctx.globalCompositeOperation = 'lighter';
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < sim.blooms.length; i++) {
        const b = sim.blooms[i];
        const tau = t - b[0];
        if (tau < 0 || tau > 240) continue;
        const bw = P.bloomW;
        ctx.globalAlpha = Math.min(1, b[1] * Math.exp(-tau / 45));
        ctx.drawImage(bw, Math.round(b[2] - bw.width + ox), Math.round(b[3] - bw.height + oy), bw.width * 2, bw.height * 2);
      }
      ctx.imageSmoothingEnabled = true;
      if (white > 0) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = Math.min(1, white);
        ctx.fillStyle = 'rgb(244,255,247)';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.setTransform(D, 0, 0, D, 0, 0);
      return 0;
    }

    return draw;
  }

  FX.register('gamma', { name: 'Gamma', duration: DURATION, font: FACE, create: create });
})(typeof window !== 'undefined' ? window : this);
