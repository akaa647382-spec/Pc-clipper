'use strict';
/**
 * Optional FFmpeg helper for the main process.
 *
 * The player decodes video with Chromium, which cannot play Dolby (AC-3 / E-AC-3), DTS or TrueHD
 * sound. A movie that plays silently at midnight is a disaster, so the app looks inside the file
 * when it is imported and offers a one-click fix: copy the picture bit for bit and convert only
 * the sound to AAC. FFmpeg does that work; this module finds it, asks it what is in a file, runs
 * the conversion, and can fetch a pinned, checksummed FFmpeg build on Windows.
 *
 * Nothing here uses a shell: every process is spawned with an argument array, so file names with
 * spaces, quotes, ampersands or non-ASCII letters are safe.
 */
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ locate */

let cached;     // undefined = not looked yet, null = looked and found nothing

function resetCache() {
  cached = undefined;
}

function exeName(platform) {
  return (platform || process.platform) === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

/** Every place worth looking, most specific first. Exposed so tests can inspect it. */
function candidates(opts) {
  opts = opts || {};
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = exeName(platform);
  const list = [];
  for (const extra of opts.extra || []) {
    if (typeof extra === 'string' && extra) list.push(extra);
  }
  if (opts.userDataDir) list.push(p.join(opts.userDataDir, 'ffmpeg', 'bin', name));
  if (platform === 'win32' && env.LOCALAPPDATA) {
    // The user's other apps download FFmpeg here: PC Clipper and Avengers Player.
    if (env.APPDATA) list.push(p.join(env.APPDATA, 'Avengers Player', 'ffmpeg', 'bin', name));
    list.push(p.join(env.LOCALAPPDATA, 'PCClipper', 'ffmpeg', 'bin', name));
  }
  const execDir = opts.execPath ? p.dirname(opts.execPath) : (opts.execPath === null ? '' : p.dirname(process.execPath));
  if (execDir) {
    list.push(p.join(execDir, name));
    list.push(p.join(execDir, 'ffmpeg', 'bin', name));
  }
  if (!opts.skipPath) {
    const sep = platform === 'win32' ? ';' : ':';
    for (const dir of String(env.PATH || env.Path || '').split(sep)) {
      const clean = dir.trim().replace(/^"|"$/g, '');
      if (clean) list.push(p.join(clean, name));
    }
  }
  return Array.from(new Set(list));
}

/** Runs a process to the end, collecting its output. Never rejects. */
function run(exe, args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let child;
    let out = '';
    let err = '';
    let done = false;
    let timer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(Object.assign({ stdout: out, stderr: err }, r));
    };
    try {
      child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ code: -1, error: e });
      return;
    }
    const cap = opts.maxBytes || 4 * 1024 * 1024;
    child.stdout.on('data', (d) => { if (out.length < cap) out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { if (err.length < cap) err += d.toString('utf8'); });
    child.on('error', (e) => finish({ code: -1, error: e }));
    child.on('close', (code) => finish({ code: code == null ? -1 : code }));
    if (opts.timeoutMs) {
      timer = setTimeout(() => { killTree(child); finish({ code: -1, timedOut: true }); }, opts.timeoutMs);
    }
  });
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      // FFmpeg has no children of its own, but /T costs nothing and /F is needed for a hung process.
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    } else {
      child.kill('SIGKILL');
    }
  } catch (e) { /* already gone */ }
}

async function works(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
  } catch (e) {
    return false;
  }
  const r = await run(file, ['-hide_banner', '-version'], { timeoutMs: 5000, maxBytes: 65536 });
  return r.code === 0 && /ffmpeg version/i.test(r.stdout);
}

/** Path of a working FFmpeg, or null. The answer is remembered until resetCache(). */
async function locate(opts) {
  opts = opts || {};
  if (cached !== undefined && !opts.noCache) return cached;
  let found = null;
  for (const c of candidates(opts)) {
    if (await works(c)) { found = c; break; }
  }
  if (!opts.noCache) cached = found;
  return found;
}

/* ------------------------------------------------------------------- probe */

const TEXT_SUBTITLES = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
const CHANNELS = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, '3.1': 4, '4.0': 4, quad: 4, '4.1': 5, '5.0': 5, '5.1': 6, '6.0': 6, '6.1': 7, '7.0': 7, '7.1': 8 };

function parseDuration(text) {
  const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(text);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : NaN;
}

/** Turns the text FFmpeg prints about a file into a description of its streams. */
function parseProbe(stderr) {
  const text = String(stderr || '');
  const input = /Input #0,\s*([^\n]*?),\s*from\s/.exec(text);
  if (!input) return null;
  const result = { durationSec: parseDuration(text), container: input[1].trim(), video: null, audio: [], subtitles: [] };
  const lines = text.split(/\r?\n/);
  const counts = { Video: 0, Audio: 0, Subtitle: 0 };
  let current = null;
  for (const line of lines) {
    const s = /^\s*Stream #0:(\d+)(?:\[[^\]]*\])?(?:\(([^)]*)\))?:\s*(Video|Audio|Subtitle|Data|Attachment):\s*(.*)$/.exec(line);
    if (s) {
      current = null;
      const kind = s[3];
      const rest = s[4];
      if (!(kind in counts)) continue;
      const codec = (/^([A-Za-z0-9_]+)/.exec(rest) || [])[1] || '';
      const profile = (/^[A-Za-z0-9_]+\s+\(([^)/]+)\)/.exec(rest) || [])[1] || '';
      const lang = s[2] && s[2] !== 'und' ? s[2] : '';
      const isDefault = /\(default\)/.test(rest);
      if (kind === 'Video') {
        // Cover art is stored as a one-frame "video": it is not the film.
        if (/\(attached pic\)/.test(rest)) continue;
        const index = counts.Video++;
        if (result.video) continue;
        const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(rest + ' ');
        const pix = (/,\s*((?:yuv|yuvj|yuva|gbr|rgb|bgr|gray|nv|p0)[a-z0-9]*)/.exec(rest) || [])[1] || '';
        const fps = /([\d.]+)\s*fps/.exec(rest);
        const depth = /p?(1[0246])(?:le|be)?$/.exec(pix);
        current = result.video = {
          index: index, codec: codec.toLowerCase(), profile: profile,
          width: size ? +size[1] : 0, height: size ? +size[2] : 0,
          fps: fps ? parseFloat(fps[1]) : 0, pixFmt: pix, bitDepth: depth ? +depth[1] : 8, title: ''
        };
      } else if (kind === 'Audio') {
        const rate = /(\d+)\s*Hz/.exec(rest);
        const layout = (/Hz,\s*([^,]+)/.exec(rest) || [])[1] || '';
        const layoutKey = layout.trim().replace(/\(.*\)$/, '');
        const explicit = /(\d+)\s*channels/.exec(layout);
        current = {
          index: counts.Audio++, codec: codec.toLowerCase(), profile: profile,
          channels: explicit ? +explicit[1] : (CHANNELS[layoutKey] || 0), channelLayout: layout.trim(),
          sampleRate: rate ? +rate[1] : 0, lang: lang, title: '', isDefault: isDefault
        };
        result.audio.push(current);
      } else {
        const c = codec.toLowerCase();
        current = { index: counts.Subtitle++, codec: c, lang: lang, title: '', isText: TEXT_SUBTITLES.includes(c) };
        result.subtitles.push(current);
      }
      continue;
    }
    if (current) {
      const t = /^\s+title\s*:\s*(.*)$/i.exec(line);
      if (t) current.title = t[1].trim();
    }
  }
  return result;
}

async function probe(ffmpegPath, file) {
  if (typeof file !== 'string' || !file) throw new Error('No file given.');
  if (!fs.existsSync(file)) throw new Error('The file does not exist: ' + file);
  const r = await run(ffmpegPath, ['-hide_banner', '-nostdin', '-i', file], { timeoutMs: 30000 });
  if (r.error) throw new Error('FFmpeg could not be started: ' + r.error.message);
  if (r.timedOut) throw new Error('FFmpeg took too long to read the file.');
  const parsed = parseProbe(r.stderr);
  if (!parsed || (!parsed.video && !parsed.audio.length)) {
    throw new Error('That file is not a video FFmpeg can read.');
  }
  return parsed;
}

/* ------------------------------------------------------------------ assess */

const AUDIO_NAMES = {
  ac3: 'Dolby Digital (AC-3)', eac3: 'Dolby Digital Plus (E-AC-3)', dts: 'DTS', truehd: 'Dolby TrueHD', mlp: 'MLP',
  wmav2: 'Windows Media Audio', wmapro: 'Windows Media Audio Pro', alac: 'Apple Lossless', mp2: 'MPEG Layer II', amr_nb: 'AMR'
};
const VIDEO_NAMES = {
  hevc: 'HEVC (H.265)', mpeg4: 'MPEG-4 Part 2 (DivX/Xvid)', mpeg2video: 'MPEG-2', vc1: 'VC-1', wmv3: 'Windows Media Video',
  msmpeg4v3: 'MS-MPEG4', prores: 'ProRes', theora: 'Theora'
};
const playableAudio = (codec) => ['aac', 'mp3', 'opus', 'vorbis', 'flac'].includes(codec) || /^pcm_/.test(codec);

/** What will happen when Chromium plays this file, in words a non-technical person can act on. */
function assess(info, opts) {
  opts = opts || {};
  const reasons = [];
  let videoOk = false;
  const v = info && info.video;
  if (!v) {
    reasons.push('This file has no picture.');
  } else if (v.codec === 'h264') {
    const plain = v.bitDepth === 8 && /^yuvj?420p$/.test(v.pixFmt || 'yuv420p');
    videoOk = plain;
    if (!plain) reasons.push('The picture is ' + (v.bitDepth > 8 ? v.bitDepth + '-bit ' : '') + 'H.264 in a format (' + v.pixFmt + ') this player cannot decode.');
  } else if (v.codec === 'hevc') {
    videoOk = !!opts.hevcOk;
    if (!videoOk) reasons.push('The picture is HEVC (H.265), which this PC cannot decode in this player. Use an H.264 copy of the film.');
  } else if (['vp8', 'vp9', 'av1'].includes(v.codec)) {
    videoOk = true;
  } else {
    reasons.push('The picture is ' + (VIDEO_NAMES[v.codec] || v.codec) + ', which this player cannot decode. Use an H.264 copy of the film.');
  }

  const audio = (info && info.audio) || [];
  let audioOk = false;
  let needsAudioFix = false;
  let audioIndex = 0;
  if (!audio.length) {
    reasons.push('This file has no sound track.');
  } else {
    // The player plays the default track, like any player would; that is the one that must work.
    const main = audio.find((a) => a.isDefault) || audio[0];
    audioIndex = main.index;
    if (playableAudio(main.codec)) {
      audioOk = true;
    } else {
      needsAudioFix = true;
      const other = audio.find((a) => playableAudio(a.codec));
      reasons.push('The ' + (audio.length > 1 ? 'main sound track' : 'sound') + ' is ' + (AUDIO_NAMES[main.codec] || main.codec.toUpperCase()) +
        ', which this player cannot decode.' + (other ? ' Without the fix it would fall back to another track' + (other.lang ? ' (' + other.lang + ')' : '') + '.' : ' Without the fix the movie would be silent.'));
    }
  }
  return { videoOk: videoOk, audioOk: audioOk, audioIndex: audioIndex, needsAudioFix: needsAudioFix, reasons: reasons };
}

/* ----------------------------------------------------------------- convert */

function abortError() {
  const e = new Error('Cancelled.');
  e.name = 'AbortError';
  return e;
}

function suggestOutputPath(input) {
  const dir = path.dirname(input);
  const base = path.basename(input, path.extname(input));
  return path.join(dir, base + ' (converted).mp4');
}

const samePath = (a, b) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

function lastLines(text, n) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-n).join(' | ');
}

/**
 * Copies the picture untouched and converts one sound track to AAC.
 * Writes to "<output>.part" and renames only on success, so a half-written file is never mistaken
 * for the movie.
 */
async function convertAudio(ffmpegPath, input, output, opts) {
  opts = opts || {};
  if (typeof input !== 'string' || typeof output !== 'string' || !input || !output) throw new Error('Input and output files are required.');
  if (samePath(input, output)) throw new Error('The converted file cannot replace the original.');
  if (opts.signal && opts.signal.aborted) throw abortError();
  const info = await probe(ffmpegPath, input);
  if (!info.video) throw new Error('This file has no picture to copy.');
  const audioIndex = Number.isInteger(opts.audioIndex) ? opts.audioIndex : 0;
  const track = info.audio.find((a) => a.index === audioIndex);
  if (!track) throw new Error('This file has no sound track number ' + (audioIndex + 1) + '.');

  const part = output + '.part';
  const args = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-i', input, '-map', '0:v:' + info.video.index, '-map', '0:a:' + audioIndex, '-c:v', 'copy', '-c:a', 'aac'];
  const channels = track.channels || 2;
  args.push('-b:a', channels <= 2 ? '192k' : '384k');
  if (channels > 6) args.push('-ac', '6');
  // Without this tag most MP4 readers, Chromium included, refuse HEVC.
  if (info.video.codec === 'hevc') args.push('-tag:v', 'hvc1');
  args.push('-sn', '-dn', '-map_metadata', '0', '-f', 'mp4', part);

  const started = Date.now();
  const cleanup = () => { try { fs.unlinkSync(part); } catch (e) { /* nothing there */ } };

  await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error('FFmpeg could not be started: ' + e.message));
      return;
    }
    let err = '';
    let buf = '';
    let aborted = false;
    let lastFraction = 0;
    let speed = 0;
    const onAbort = () => { aborted = true; killTree(child); };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    const settle = (fn, value) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      fn(value);
    };
    child.stderr.on('data', (d) => { if (err.length < 65536) err += d.toString('utf8'); });
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq);
        const value = line.slice(eq + 1);
        if (key === 'speed') { const sp = parseFloat(value); if (isFinite(sp)) speed = sp; }
        if (key === 'out_time_us' || key === 'out_time_ms') {
          // Both keys are in microseconds (a long-standing FFmpeg quirk).
          const sec = parseInt(value, 10) / 1e6;
          if (isFinite(sec) && info.durationSec > 0) {
            const fraction = Math.max(lastFraction, Math.min(0.999, sec / info.durationSec));
            lastFraction = fraction;
            if (typeof opts.onProgress === 'function') {
              const etaSec = speed > 0 ? Math.max(0, (info.durationSec - sec) / speed) : NaN;
              try { opts.onProgress({ fraction: fraction, speed: speed, etaSec: etaSec }); } catch (e) { /* caller's problem */ }
            }
          }
        }
      }
    });
    child.on('error', (e) => { cleanup(); settle(reject, new Error('FFmpeg could not be started: ' + e.message)); });
    child.on('close', (code) => {
      if (aborted || (opts.signal && opts.signal.aborted)) { cleanup(); settle(reject, abortError()); return; }
      if (code !== 0) {
        cleanup();
        settle(reject, new Error('FFmpeg could not convert the sound: ' + (lastLines(err, 3) || 'exit code ' + code)));
        return;
      }
      settle(resolve);
    });
  });

  try {
    if (!(fs.statSync(part).size > 0)) throw new Error('empty output');
    try { fs.unlinkSync(output); } catch (e) { /* no earlier copy */ }
    fs.renameSync(part, output);
  } catch (e) {
    cleanup();
    throw new Error('The converted file could not be saved: ' + e.message);
  }
  if (typeof opts.onProgress === 'function') {
    try { opts.onProgress({ fraction: 1, speed: 0, etaSec: 0 }); } catch (e) { /* caller's problem */ }
  }
  return { output: output, seconds: (Date.now() - started) / 1000 };
}

/** Writes a text subtitle track of the movie to a .srt file. */
async function extractSubtitle(ffmpegPath, input, subIndex, outputSrt, opts) {
  opts = opts || {};
  const info = await probe(ffmpegPath, input);
  const track = info.subtitles.find((s) => s.index === subIndex);
  if (!track) throw new Error('This file has no subtitle track number ' + (subIndex + 1) + '.');
  if (!track.isText) throw new Error('That subtitle track is made of pictures (' + track.codec + '), not text, so it cannot be used here.');
  if (opts.signal && opts.signal.aborted) throw abortError();
  const r = await run(ffmpegPath, ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-i', input, '-map', '0:s:' + subIndex, '-c:s', 'srt', '-f', 'srt', outputSrt], { timeoutMs: 180000 });
  if (r.code !== 0 || !fs.existsSync(outputSrt)) {
    try { fs.unlinkSync(outputSrt); } catch (e) { /* nothing there */ }
    throw new Error('The subtitles could not be read from the movie: ' + (lastLines(r.stderr, 2) || 'unknown error'));
  }
  return outputSrt;
}

/* ---------------------------------------------------------------- download */

// The same pinned builds PC Clipper uses: fixed URLs with known SHA-256 fingerprints.
const SOURCES = [
  {
    label: 'gyan.dev FFmpeg 8.1.1 essentials',
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.1/ffmpeg-8.1.1-essentials_build.zip',
    sha256: '6f58ce889f59c311410f7d2b18895b33c03456463486f3b1ebc93d97a0f54541'
  },
  {
    label: 'BtbN FFmpeg n8.1.3 static',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-gpl-8.1.zip',
    sha256: '401dffcf14c301082e1fc03b0bc876b92ea676bfc521fc56e80a1537d137034f'
  }
];

/** Downloads `url` to `file`, following redirects, and returns the SHA-256 of what was written. */
function fetchToFile(url, file, opts, redirects) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    if ((redirects || 0) > 6) { reject(new Error('Too many redirects.')); return; }
    let parsed;
    try { parsed = new URL(url); } catch (e) { reject(new Error('Bad download address.')); return; }
    const secure = parsed.protocol === 'https:';
    if (!secure && !(opts.allowHttp && parsed.protocol === 'http:')) { reject(new Error('Refusing a download that is not HTTPS.')); return; }
    let settled = false;
    let out = null;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      if (out) out.destroy();
      try { fs.unlinkSync(file); } catch (e2) { /* nothing there */ }
      reject(e);
    };
    const req = (secure ? https : http).get(parsed, { headers: { 'User-Agent': 'SpeedClipPoster', Accept: '*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        settled = true;
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        let next;
        try { next = new URL(res.headers.location, parsed).href; } catch (e) { reject(new Error('Bad redirect.')); return; }
        fetchToFile(next, file, opts, (redirects || 0) + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); fail(new Error('The server answered ' + res.statusCode + '.')); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
      const hash = crypto.createHash('sha256');
      let received = 0;
      out = fs.createWriteStream(file);
      res.on('data', (chunk) => {
        hash.update(chunk);
        received += chunk.length;
        if (typeof opts.onProgress === 'function') {
          try { opts.onProgress({ phase: 'download', fraction: total ? received / total : 0, receivedBytes: received, totalBytes: total }); } catch (e) { /* caller's problem */ }
        }
      });
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('The download was interrupted.')));
      out.on('error', fail);
      out.on('finish', () => {
        if (settled) return;
        if (total && received !== total) { fail(new Error('The download was cut short.')); return; }
        settled = true;
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
        resolve({ sha256: hash.digest('hex'), bytes: received });
      });
      res.pipe(out);
    });
    const onAbort = () => { req.destroy(); fail(abortError()); };
    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    // A connection that goes quiet for 30 s is dead.
    req.setTimeout(30000, () => { req.destroy(); fail(new Error('The download stalled.')); });
    req.on('error', (e) => fail(new Error('The download failed: ' + e.message)));
  });
}

/** Finds the end-of-central-directory record of a ZIP file and lists its entries. */
function readZipDirectory(fd, size) {
  const tailLen = Math.min(size, 65557);
  const tail = Buffer.alloc(tailLen);
  fs.readSync(fd, tail, 0, tailLen, size - tailLen);
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a ZIP file.');
  let count = tail.readUInt16LE(eocd + 10);
  let dirSize = tail.readUInt32LE(eocd + 12);
  let dirOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xFFFF || dirSize === 0xFFFFFFFF || dirOffset === 0xFFFFFFFF) {
    // ZIP64: the real numbers live in a second record, pointed at by a locator just before this one.
    const locAt = eocd - 20;
    if (locAt < 0 || tail.readUInt32LE(locAt) !== 0x07064b50) throw new Error('Unsupported ZIP file.');
    const z64Offset = Number(tail.readBigUInt64LE(locAt + 8));
    const z64 = Buffer.alloc(56);
    fs.readSync(fd, z64, 0, 56, z64Offset);
    if (z64.readUInt32LE(0) !== 0x06064b50) throw new Error('Unsupported ZIP file.');
    count = Number(z64.readBigUInt64LE(32));
    dirSize = Number(z64.readBigUInt64LE(40));
    dirOffset = Number(z64.readBigUInt64LE(48));
  }
  if (dirSize > 64 * 1024 * 1024 || dirOffset + dirSize > size) throw new Error('Damaged ZIP file.');
  const dir = Buffer.alloc(dirSize);
  fs.readSync(fd, dir, 0, dirSize, dirOffset);
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= dirSize; i++) {
    if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error('Damaged ZIP file.');
    const method = dir.readUInt16LE(p + 10);
    const crc = dir.readUInt32LE(p + 16);
    let compSize = dir.readUInt32LE(p + 20);
    let fullSize = dir.readUInt32LE(p + 24);
    const nameLen = dir.readUInt16LE(p + 28);
    const extraLen = dir.readUInt16LE(p + 30);
    const commentLen = dir.readUInt16LE(p + 32);
    let localOffset = dir.readUInt32LE(p + 42);
    const name = dir.toString('utf8', p + 46, p + 46 + nameLen);
    // ZIP64 extra field: 64-bit values for whichever of the three fields above is 0xFFFFFFFF.
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = dir.readUInt16LE(x);
      const len = dir.readUInt16LE(x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (fullSize === 0xFFFFFFFF && q + 8 <= xEnd) { fullSize = Number(dir.readBigUInt64LE(q)); q += 8; }
        if (compSize === 0xFFFFFFFF && q + 8 <= xEnd) { compSize = Number(dir.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xFFFFFFFF && q + 8 <= xEnd) { localOffset = Number(dir.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    entries.push({ name: name, method: method, crc: crc, compSize: compSize, fullSize: fullSize, localOffset: localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Extracts the single ".../bin/ffmpeg.exe" entry of a ZIP archive to `destFile`, streaming so a
 * 100 MB program never sits in memory. Returns the entry name.
 */
async function extractFfmpegFromZip(zipFile, destFile, opts) {
  opts = opts || {};
  const wanted = (opts.entryName || 'ffmpeg.exe').toLowerCase();
  const size = fs.statSync(zipFile).size;
  const fd = fs.openSync(zipFile, 'r');
  let entry;
  let dataStart;
  try {
    const entries = readZipDirectory(fd, size);
    const norm = (n) => n.replace(/\\/g, '/').toLowerCase();
    entry = entries.find((e) => norm(e.name).endsWith('/bin/' + wanted) && norm(e.name).split('/').length === 3) ||
      entries.find((e) => norm(e.name).endsWith('bin/' + wanted));
    if (!entry) throw new Error('The downloaded package does not contain ' + wanted + '.');
    if (entry.method !== 0 && entry.method !== 8) throw new Error('The downloaded package uses a compression this app cannot unpack.');
    const local = Buffer.alloc(30);
    fs.readSync(fd, local, 0, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Damaged ZIP file.');
    dataStart = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    if (dataStart + entry.compSize > size) throw new Error('Damaged ZIP file.');
  } finally {
    fs.closeSync(fd);
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const tmp = destFile + '.tmp';
  await new Promise((resolve, reject) => {
    let written = 0;
    let crc = 0;
    let failed = false;
    const fail = (e) => {
      if (failed) return;
      failed = true;
      try { fs.unlinkSync(tmp); } catch (e2) { /* nothing there */ }
      reject(e);
    };
    if (entry.compSize === 0) { fail(new Error('The downloaded package is damaged.')); return; }
    const src = fs.createReadStream(zipFile, { start: dataStart, end: dataStart + entry.compSize - 1 });
    const out = fs.createWriteStream(tmp);
    const stage = entry.method === 8 ? zlib.createInflateRaw() : null;
    const body = stage ? src.pipe(stage) : src;
    body.on('data', (chunk) => {
      written += chunk.length;
      if (typeof zlib.crc32 === 'function') crc = zlib.crc32(chunk, crc);
      if (typeof opts.onProgress === 'function' && entry.fullSize) {
        try { opts.onProgress({ phase: 'extract', fraction: written / entry.fullSize, receivedBytes: written, totalBytes: entry.fullSize }); } catch (e) { /* caller's problem */ }
      }
    });
    src.on('error', fail);
    if (stage) stage.on('error', () => fail(new Error('The downloaded package is damaged.')));
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (written !== entry.fullSize || (typeof zlib.crc32 === 'function' && (crc >>> 0) !== (entry.crc >>> 0))) {
        fail(new Error('The downloaded package is damaged.'));
        return;
      }
      resolve();
    });
    body.pipe(out);
  });
  try { fs.unlinkSync(destFile); } catch (e) { /* no earlier copy */ }
  fs.renameSync(tmp, destFile);
  return entry.name;
}

/**
 * Downloads a pinned FFmpeg build, checks its fingerprint BEFORE unpacking anything, and leaves
 * just ffmpeg.exe in <destDir>/bin. Windows only.
 */
async function download(destDir, opts) {
  opts = opts || {};
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') throw new Error('Automatic download is only available on Windows. Install FFmpeg and use "I have FFmpeg".');
  const sources = opts.sources || SOURCES;
  fs.mkdirSync(destDir, { recursive: true });
  const zip = path.join(destDir, 'ffmpeg-download.zip');
  const exe = path.join(destDir, 'bin', opts.entryName || 'ffmpeg.exe');
  let lastError = null;
  for (const source of sources) {
    try {
      if (opts.signal && opts.signal.aborted) throw abortError();
      const got = await fetchToFile(source.url, zip, { signal: opts.signal, onProgress: opts.onProgress, allowHttp: !!opts.allowHttp });
      if (typeof opts.onProgress === 'function') opts.onProgress({ phase: 'verify', fraction: 1, receivedBytes: got.bytes, totalBytes: got.bytes });
      if (got.sha256.toLowerCase() !== String(source.sha256).toLowerCase()) {
        throw new Error('The downloaded file did not match its fingerprint and was thrown away.');
      }
      await extractFfmpegFromZip(zip, exe, { onProgress: opts.onProgress, entryName: opts.entryName });
      try { fs.unlinkSync(zip); } catch (e) { /* nothing there */ }
      resetCache();
      return exe;
    } catch (e) {
      try { fs.unlinkSync(zip); } catch (e2) { /* nothing there */ }
      if (e && e.name === 'AbortError') throw e;
      lastError = e;
    }
  }
  throw new Error('FFmpeg could not be downloaded. ' + (lastError ? lastError.message : '') + ' Check the internet connection and try again.');
}

module.exports = {
  run: run,
  locate: locate,
  resetCache: resetCache,
  candidates: candidates,
  probe: probe,
  parseProbe: parseProbe,
  assess: assess,
  convertAudio: convertAudio,
  suggestOutputPath: suggestOutputPath,
  extractSubtitle: extractSubtitle,
  download: download,
  extractFfmpegFromZip: extractFfmpegFromZip,
  SOURCES: SOURCES
};
