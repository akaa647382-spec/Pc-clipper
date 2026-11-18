'use strict';
// Gathers the facts core/clipcheck.cjs judges: size, length, picture, sound levels, silence,
// black screens, scene cuts, a fingerprint per second (for repeat detection) and the text on
// screen (OCR on a handful of frames). Also makes a copy that fits Discord's upload limit.

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ffmpeg = require('./ffmpeg.cjs');

/** Runs FFmpeg, keeping stdout as a Buffer (for raw frames) and stderr as text. */
function runBuf(exe, args, { timeoutMs = 300000, maxOut = 64 * 1024 * 1024, signal } = {}) {
  return new Promise((resolve) => {
    const out = [];
    let outLen = 0;
    let err = '';
    let done = false;
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(Object.assign({ stdout: Buffer.concat(out), stderr: err }, r));
    };
    const onAbort = () => { try { child.kill(); } catch (_) {} finish({ code: -1, aborted: true }); };
    if (signal) signal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} finish({ code: -1, timedOut: true }); }, timeoutMs);
    child.stdout.on('data', (d) => { if (outLen < maxOut) { out.push(d); outLen += d.length; } });
    child.stderr.on('data', (d) => { if (err.length < 4 * 1024 * 1024) err += d.toString('utf8'); });
    child.on('error', (e) => finish({ code: -1, error: e }));
    child.on('close', (code) => finish({ code }));
  });
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Parses volumedetect + silencedetect output. */
function parseAudioStats(stderr, durationSec) {
  const mean = /mean_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  const max = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(stderr);
  let silence = 0;
  let startSilent = 0;
  const starts = [...stderr.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map((m) => Math.max(0, +m[1]));
  const ends = [...stderr.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => +m[1]);
  for (let i = 0; i < starts.length; i++) {
    const e = i < ends.length ? ends[i] : durationSec;
    silence += Math.max(0, e - starts[i]);
    if (starts[i] < 0.05) startSilent = e;
  }
  const num = (m) => (m ? (m[1] === '-inf' ? -91 : parseFloat(m[1])) : NaN);
  return { meanVolumeDb: num(mean), maxVolumeDb: num(max), silenceSec: silence, startSilentSec: startSilent };
}

/** Parses blackdetect + the scene-change frames printed by showinfo. */
function parseVideoStats(stderr) {
  let black = 0;
  let startBlack = 0;
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/g)) {
    black += +m[3];
    if (+m[1] < 0.05) startBlack = +m[2];
  }
  const cuts = (stderr.match(/\[Parsed_showinfo[^\]]*\]\s*n:\s*\d+/g) || []).length;
  return { blackSec: black, startBlackSec: startBlack, sceneCuts: cuts };
}

/** 9x8 grey frames -> 64-bit difference hashes as hex. Also the average change between seconds. */
function hashesFromRaw(buf) {
  const FRAME = 72;
  const hashes = [];
  for (let off = 0; off + FRAME <= buf.length; off += FRAME) {
    let hex = '';
    for (let row = 0; row < 8; row++) {
      let byte = 0;
      for (let col = 0; col < 8; col++) {
        const a = buf[off + row * 9 + col];
        const b = buf[off + row * 9 + col + 1];
        byte = (byte << 1) | (a > b ? 1 : 0);
      }
      hex += byte.toString(16).padStart(2, '0');
    }
    hashes.push(hex);
  }
  const { hamming } = require('../core/clipcheck.cjs');
  let motion = 0;
  for (let i = 1; i < hashes.length; i++) motion += hamming(hashes[i - 1], hashes[i]);
  return { hashes, motion: hashes.length > 1 ? motion / (hashes.length - 1) : NaN };
}

/** Mean absolute difference between consecutive grey frames (0-255 scale). */
function motionFromRaw(buf, frameSize) {
  const n = Math.floor(buf.length / frameSize);
  if (n < 2) return NaN;
  let total = 0;
  for (let f = 1; f < n; f++) {
    let d = 0;
    const a = (f - 1) * frameSize;
    const b = f * frameSize;
    for (let i = 0; i < frameSize; i++) d += Math.abs(buf[a + i] - buf[b + i]);
    total += d / frameSize;
  }
  return total / (n - 1);
}

let ocrWorkerPromise = null;

/**
 * One shared Tesseract worker, English. The language data ships with the app (gzipped). Inside
 * Electron tesseract.js thinks it is in a browser and would try to download it, but it reads a
 * cached copy first: so the bundled file is unpacked once into `dataDir` and the worker reads only
 * that ('readOnly'). Nothing is downloaded.
 */
function ocrWorker(opts) {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const T = require('tesseract.js');
      const dataDir = opts.ocrDataDir || path.join(os.tmpdir(), 'speed-clip-poster-ocr');
      const target = path.join(dataDir, 'eng.traineddata');
      if (!fs.existsSync(target)) {
        const gz = unpacked(require.resolve('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'));
        fs.mkdirSync(dataDir, { recursive: true });
        const tmp = target + '.part';
        fs.writeFileSync(tmp, require('node:zlib').gunzipSync(fs.readFileSync(gz)));
        fs.renameSync(tmp, target);
      }
      return T.createWorker('eng', 1, {
        cachePath: dataDir,
        cacheMethod: 'readOnly',
        // Never used while the cached file is there; a local path so a mistake fails fast instead of reaching the internet.
        langPath: dataDir,
        workerPath: unpacked(require.resolve('tesseract.js/src/worker-script/node/index.js')),
        logger: () => {},
        errorHandler: () => {},
      });
    })().catch((e) => {
      ocrWorkerPromise = null;
      throw e;
    });
  }
  return ocrWorkerPromise;
}

/** Files inside app.asar that a child process must read live in app.asar.unpacked. */
function unpacked(p) {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

async function closeOcr() {
  if (!ocrWorkerPromise) return;
  try { (await ocrWorkerPromise).terminate(); } catch (_) {}
  ocrWorkerPromise = null;
}

/** Text on screen from frames at a few points of the clip. Words below 60% confidence are dropped. */
async function readScreenText(exe, file, durationSec, opts) {
  const dir = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'scp-ocr-'));
  try {
    const points = durationSec > 2 ? [0.5, 0.1, 0.3, 0.5, 0.7, 0.9].map((f, i) => (i === 0 ? Math.min(0.5, durationSec / 4) : f * durationSec)) : [0];
    const frames = [];
    for (let i = 0; i < points.length; i++) {
      const out = path.join(dir, 'f' + i + '.png');
      const r = await runBuf(exe, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', points[i].toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=1280:-2', '-y', out], { timeoutMs: 60000, signal: opts.signal });
      if (r.code === 0 && fs.existsSync(out)) frames.push(out);
    }
    const worker = await ocrWorker(opts);
    const lines = new Set();
    for (const f of frames) {
      const r = await worker.recognize(f);
      const words = [];
      for (const w of (r.data && r.data.words) || []) if (w.confidence >= 60 && /\w/.test(w.text)) words.push(w.text);
      const line = words.join(' ').trim();
      if (line) lines.add(line);
    }
    return { text: Array.from(lines).join('\n'), frames: frames.length };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Everything about one clip. `onStep(label)` reports progress in plain words.
 */
async function analyze(exe, file, opts = {}) {
  const step = opts.onStep || (() => {});
  step('Reading the file');
  const st = fs.statSync(file);
  const info = await ffmpeg.probe(exe, file);
  const dur = Number.isFinite(info.durationSec) ? info.durationSec : 0;
  const sha = await sha256File(file);
  const facts = {
    fileName: path.basename(file),
    filePath: file,
    sizeBytes: st.size,
    sha256: sha,
    container: info.container,
    durationSec: dur,
    video: info.video ? { codec: info.video.codec, width: info.video.width, height: info.video.height, fps: info.video.fps } : null,
    audio: info.audio.map((a) => ({ codec: a.codec })),
  };
  const limit = ['-t', '600'];

  if (info.audio.length) {
    step('Listening to the sound levels');
    const r = await runBuf(exe, ['-hide_banner', '-nostdin', ...limit, '-i', file, '-vn', '-af', 'volumedetect,silencedetect=n=-45dB:d=0.8', '-f', 'null', '-'], { signal: opts.signal });
    Object.assign(facts, parseAudioStats(r.stderr, Math.min(dur, 600)));
  }
  if (info.video) {
    step('Watching for black screens and cuts');
    const r = await runBuf(exe, ['-hide_banner', '-nostdin', ...limit, '-i', file, '-an', '-vf', "scale=320:-2,blackdetect=d=0.3:pix_th=0.10,select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { signal: opts.signal });
    Object.assign(facts, parseVideoStats(r.stderr));

    step('Fingerprinting the picture');
    const h = await runBuf(exe, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...limit, '-i', file, '-an', '-vf', 'fps=1,scale=9:8:flags=area,format=gray', '-f', 'rawvideo', '-'], { signal: opts.signal });
    Object.assign(facts, hashesFromRaw(h.stdout));
    // Motion: average pixel change between frames half a second apart, on a 64x36 grey picture
    // (0 = still image; a facecam with someone talking is well above 1). The 9x8 fingerprints
    // above are too coarse for this: they miss small movement.
    const m = await runBuf(exe, ['-hide_banner', '-nostdin', '-loglevel', 'error', ...limit, '-i', file, '-an', '-vf', 'fps=2,scale=64:36:flags=area,format=gray', '-f', 'rawvideo', '-'], { signal: opts.signal });
    facts.motion = motionFromRaw(m.stdout, 64 * 36);

    step('Reading text on screen');
    try {
      // OCR must never hang a check: give up after 90 s and say the text was not checked.
      let timer;
      const o = await Promise.race([
        readScreenText(exe, file, dur, opts),
        new Promise((_, reject) => { timer = setTimeout(() => { closeOcr(); reject(new Error('Reading the text took too long.')); }, opts.ocrTimeoutMs || 90000); }),
      ]).finally(() => clearTimeout(timer));
      facts.ocrText = o.text;
      facts.ocrOk = o.frames > 0;
    } catch (e) {
      facts.ocrText = '';
      facts.ocrOk = false;
      facts.ocrError = String(e && e.message ? e.message : e);
    }
  }
  return facts;
}

/**
 * A copy that fits `limitMB`: H.264 + AAC MP4, smaller picture if the bit rate gets low.
 * Tries again a bit smaller if the first try comes out too big.
 */
async function makeSmallCopy(exe, file, limitMB, opts = {}) {
  const info = await ffmpeg.probe(exe, file);
  const dur = info.durationSec;
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('Could not read how long the clip is.');
  const targetBytes = limitMB * 1024 * 1024 * 0.94;
  const audioK = info.audio.length ? 96 : 0;
  const out = opts.output || path.join(path.dirname(file), path.basename(file, path.extname(file)) + ' (' + limitMB + 'MB).mp4');
  const part = out + '.part.mp4';
  let videoK = Math.floor((targetBytes * 8) / dur / 1000 - audioK - 8);
  if (videoK < 120) throw new Error('This clip is too long to fit in ' + limitMB + ' MB and still be watchable. Cut it to under ' + Math.floor((targetBytes * 8) / ((audioK + 400) * 1000)) + ' seconds first.');
  const srcH = info.video ? Math.min(info.video.height, info.video.width) : 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shortSide = videoK < 500 ? 480 : videoK < 1500 ? 720 : Math.min(1080, srcH || 1080);
    const vf = info.video && info.video.width >= info.video.height ? `scale=-2:'min(${shortSide},ih)'` : `scale='min(${shortSide},iw)':-2`;
    const args = ['-hide_banner', '-nostdin', '-y', '-i', file, '-map', '0:v:0', ...(audioK ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', audioK + 'k', '-ac', '2'] : ['-an']),
      '-vf', vf + ',format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', videoK + 'k', '-maxrate', Math.round(videoK * 1.2) + 'k', '-bufsize', videoK * 2 + 'k',
      '-movflags', '+faststart', part];
    if (opts.onStep) opts.onStep('Making a ' + limitMB + ' MB copy' + (attempt ? ' (try ' + (attempt + 1) + ')' : ''));
    const r = await runBuf(exe, args, { timeoutMs: 30 * 60 * 1000, signal: opts.signal });
    if (r.code !== 0) {
      fs.rmSync(part, { force: true });
      throw new Error('FFmpeg could not make the copy: ' + r.stderr.trim().split('\n').slice(-2).join(' '));
    }
    const size = fs.statSync(part).size;
    if (size <= limitMB * 1024 * 1024) {
      fs.renameSync(part, out);
      return { file: out, sizeBytes: size };
    }
    videoK = Math.floor(videoK * ((limitMB * 1024 * 1024 * 0.9) / size));
  }
  fs.rmSync(part, { force: true });
  throw new Error('Could not get the copy under ' + limitMB + ' MB. Cut the clip shorter.');
}

module.exports = { analyze, makeSmallCopy, closeOcr, parseAudioStats, parseVideoStats, hashesFromRaw, motionFromRaw, runBuf };
