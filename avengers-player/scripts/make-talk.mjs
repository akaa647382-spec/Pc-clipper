// Makes the sound and the subtitle files of the "talking" test films: synthetic voices that speak
// exactly when the subtitle lines say so, over music and effects that do not care about the lines.
// The subtitle sync is tested against them: it has to find where the lines belong from the sound.
//
//   node scripts/make-talk.mjs <folder>
//
// Writes talk.wav (stereo, 240 s), talk51.wav (5.1, the voices only in the centre channel),
// talk-long.wav (mono, 1800 s) and the .srt files that go with them. Everything is derived from
// fixed seeds, so the files are the same every time.
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
if (!out) { console.error('usage: make-talk.mjs <folder>'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const RATE = 16000;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Subtitle lines of a film: talkative scenes with pauses, and stretches with no talk at all. */
function makeCues(seconds, seed) {
  const r = rng(seed);
  const between = (a, b) => a + (b - a) * r();
  const cues = [];
  let t = between(2, 6);
  while (t < seconds - 8) {
    // A scene of talk…
    const sceneEnd = Math.min(seconds - 6, t + between(25, 70));
    while (t < sceneEnd) {
      const len = between(0.9, 4.2);
      if (t + len > seconds - 4) break;
      cues.push({ start: t, end: t + len });
      t += len + (r() < 0.7 ? between(0.15, 1.2) : between(1.5, 5));
    }
    // …then a stretch without any.
    t += between(6, 28);
  }
  return cues;
}

/**
 * The voices: one channel in which somebody speaks during every line, from a little after the
 * line appears until a little before it goes (subtitles stay on screen after the last word).
 */
function voiceTrack(seconds, cues, seed) {
  const r = rng(seed);
  const between = (a, b) => a + (b - a) * r();
  const n = Math.round(seconds * RATE);
  const x = new Float32Array(n);
  for (const c of cues) {
    const from = c.start + between(0, 0.1);
    const to = c.end - between(0.12, Math.min(0.5, (c.end - c.start) * 0.35));
    let t = from;
    const f0base = between(95, 225);
    while (t < to) {
      const len = Math.min(to - t, between(0.1, 0.26));
      if (len < 0.05) break;
      const f0 = f0base * between(0.9, 1.12);
      const glide = between(-18, 18);
      const loud = between(0.16, 0.3);
      const formants = [between(350, 800), between(1000, 2200), between(2400, 3100)];
      const a = Math.round(t * RATE);
      const b = Math.min(n, Math.round((t + len) * RATE));
      const ramp = Math.round(0.02 * RATE);
      for (let i = a; i < b; i++) {
        const k = i - a;
        const env = Math.min(1, k / ramp, (b - 1 - i) / ramp);
        const f = f0 + glide * (k / (b - a));
        const ph = 2 * Math.PI * f * (k / RATE);
        let s = 0;
        for (let h = 1; h * f < 3400; h++) {
          const hf = h * f;
          let w = 0.02;
          for (const fm of formants) { const d = (hf - fm) / 160; w += Math.exp(-d * d); }
          s += w * Math.sin(h * ph) / h ** 0.5;
        }
        x[i] += loud * env * s * 0.5;
      }
      t += len + between(0.03, 0.09);
    }
  }
  return x;
}

/** Music and effects: loud, and in no way tied to the lines. */
function bedTrack(seconds, seed, level) {
  const r = rng(seed);
  const between = (a, b) => a + (b - a) * r();
  const n = Math.round(seconds * RATE);
  const x = new Float32Array(n);
  // Music: a few held notes that swell and fade, changing every few seconds.
  let t = 0;
  while (t < seconds) {
    const len = between(3, 9);
    const notes = [between(90, 180), between(180, 360), between(360, 720)];
    const swell = between(0.15, 0.5);
    const a = Math.round(t * RATE);
    const b = Math.min(n, Math.round((t + len) * RATE));
    for (let i = a; i < b; i++) {
      const tt = i / RATE;
      const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * swell * tt);
      x[i] += level * 0.35 * env * (Math.sin(2 * Math.PI * notes[0] * tt) + 0.7 * Math.sin(2 * Math.PI * notes[1] * tt) + 0.4 * Math.sin(2 * Math.PI * notes[2] * tt));
    }
    t += len;
  }
  // Effects: bursts of noise at times of their own.
  t = between(1, 8);
  while (t < seconds - 2) {
    const len = between(0.2, 1.6);
    const loud = level * between(0.5, 1.6);
    const a = Math.round(t * RATE);
    const b = Math.min(n, Math.round((t + len) * RATE));
    let prev = 0;
    for (let i = a; i < b; i++) {
      const env = Math.min(1, (i - a) / 400, (b - 1 - i) / 2000);
      prev = 0.6 * prev + 0.4 * (r() * 2 - 1);                 // noise with the top rolled off
      x[i] += loud * env * prev * 1.6;
    }
    t += len + between(2, 14);
  }
  // A floor of hiss under everything.
  for (let i = 0; i < n; i++) x[i] += level * 0.05 * (r() * 2 - 1);
  return x;
}

function writeWav(file, channels) {
  const n = channels[0].length;
  const ch = channels.length;
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      data.writeInt16LE(Math.round(v * 32767), (i * ch + c) * 2);
    }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(ch, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * ch * 2, 28); head.writeUInt16LE(ch * 2, 32); head.writeUInt16LE(16, 34);
  head.write('data', 36); head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}

const stamp = (t) => {
  const ms = Math.max(0, Math.round(t * 1000));
  const p = (v, w) => String(v).padStart(w, '0');
  return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':' + p(Math.floor(ms / 1000) % 60, 2) + ',' + p(ms % 1000, 3);
};
function writeSrt(file, cues, map) {
  const lines = [];
  let k = 0;
  cues.forEach((c, i) => {
    const a = map ? map(c.start) : c.start;
    const b = map ? map(c.end) : c.end;
    if (!(a > 0.05)) return;
    lines.push(String(++k), stamp(a) + ' --> ' + stamp(b), 'Line ' + (i + 1) + ' of the film.', '');
  });
  fs.writeFileSync(file, lines.join('\n'));
}
const add = (a, b, gain) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (gain == null ? 1 : gain) * b[i]; return o; };

/* ---- the short film: 240 s, stereo ---- */
{
  const seconds = 240;
  const cues = makeCues(seconds, 11);
  const voice = voiceTrack(seconds, cues, 12);
  writeWav(path.join(out, 'talk.wav'), [add(voice, bedTrack(seconds, 13, 0.035)), add(voice, bedTrack(seconds, 14, 0.035))]);
  writeSrt(path.join(out, 'talk.srt'), cues);
  // Made for a copy of the film that starts 2.4 s earlier: every line comes 2.4 s early.
  writeSrt(path.join(out, 'talk-early.srt'), cues, (t) => t - 2.4);
  // Made for a copy that runs at 25 frames a second instead of 23.976, and starts 1.2 s earlier.
  writeSrt(path.join(out, 'talk-pal.srt'), cues, (t) => (t - 1.2) / (25000 / 23976));
  // The lines of another film altogether.
  writeSrt(path.join(out, 'talk-other.srt'), makeCues(seconds, 77));

  // The same film in 5.1: the voices only in the centre, and left, right and the surrounds so
  // loud with music that the lines cannot be made out of a mix-down.
  const quiet = new Float32Array(voice.length);
  writeWav(path.join(out, 'talk51.wav'), [
    bedTrack(seconds, 21, 0.3), bedTrack(seconds, 22, 0.3), add(voice, bedTrack(seconds, 23, 0.01)),
    quiet, bedTrack(seconds, 24, 0.2), bedTrack(seconds, 25, 0.2)
  ]);
}

/* ---- the long film: 1800 s, mono: long enough to be listened to in stretches ---- */
{
  const seconds = 1800;
  const cues = makeCues(seconds, 31);
  writeWav(path.join(out, 'talk-long.wav'), [add(voiceTrack(seconds, cues, 32), bedTrack(seconds, 33, 0.035))]);
  writeSrt(path.join(out, 'talk-long.srt'), cues);
  // Made for a 24.000 frames-a-second copy (the film runs at 23.976), starting 0.8 s earlier.
  writeSrt(path.join(out, 'talk-long-ntsc.srt'), cues, (t) => (t - 0.8) / (24000 / 23976));
  // Made for a cut that lacks 20 s in the middle: right until 15:00, 20 s early after that.
  writeSrt(path.join(out, 'talk-long-cut.srt'), cues, (t) => (t < 900 ? t : t - 20));
}
console.log('talk films written to ' + out);
