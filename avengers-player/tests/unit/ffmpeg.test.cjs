'use strict';
// Exercises the FFmpeg helper against the real ffmpeg on this machine. Skipped when ffmpeg is absent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const ff = require('../../main/ffmpeg.js');

const sys = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
const HAVE = sys.status === 0;
const skip = HAVE ? false : 'ffmpeg is not installed';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ffmpeg-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function make(name, args) {
  const file = path.join(tmp, name);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, file], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'could not generate ' + name + ': ' + r.stderr);
  return file;
}
const V = ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24,format=yuv420p'];
const A = (hz) => ['-f', 'lavfi', '-i', 'sine=frequency=' + hz + ':sample_rate=48000'];
const X264 = ['-c:v', 'libx264', '-preset', 'ultrafast', '-g', '24'];
const videoHash = (file) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:v:0', '-c', 'copy', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout.trim();

let exe;
let clips;
test.before(async () => {
  if (!HAVE) return;
  ff.resetCache();
  exe = await ff.locate({ execPath: null });
  const srt = path.join(tmp, 'in.srt');
  fs.writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,000\nFirst line\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond <i>line</i>\n');
  clips = {
    aac: make('aac.mp4', [...V, ...A(330), '-t', '6', ...X264, '-c:a', 'aac', '-b:a', '96k']),
    ac3: make('dolby 5.1.mp4', [...V, ...A(440), '-t', '6', ...X264, '-c:a', 'ac3', '-ac', '6', '-b:a', '384k']),
    mkv: make('mixed.mkv', [...V, ...A(440), ...A(880), '-i', srt, '-t', '6', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
      ...X264, '-c:a:0', 'eac3', '-c:a:1', 'aac', '-c:s', 'srt', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=fra',
      '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English subs', '-disposition:a:0', 'default', '-disposition:a:1', '0']),
    // The shape of the file that went wrong for a real user: Dolby Hindi first and flagged as the
    // main track, Dolby English second, English subtitles.
    pahe: make('Film [Org Hindi DDP 5.1 + English DD 5.1] ESubs.mkv', [...V, ...A(440), ...A(880), '-i', srt, '-t', '6', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s',
      ...X264, '-c:a:0', 'eac3', '-ac:a:0', '6', '-b:a:0', '640k', '-c:a:1', 'ac3', '-ac:a:1', '2', '-b:a:1', '192k', '-c:s', 'srt',
      '-metadata:s:a:0', 'language=hin', '-metadata:s:a:0', 'title=Org Hindi DDP 5.1', '-metadata:s:a:1', 'language=eng', '-metadata:s:a:1', 'title=English DD 2.0',
      '-metadata:s:s:0', 'language=eng', '-disposition:a:0', 'default', '-disposition:a:1', '0']),
    // Languages named only in the track titles, as many files have them.
    titled: make('titles only.mkv', [...V, ...A(440), ...A(880), '-t', '4', '-map', '0:v', '-map', '1:a', '-map', '2:a',
      ...X264, '-c:a:0', 'ac3', '-c:a:1', 'ac3', '-metadata:s:a:0', 'title=Hindi 2.0', '-metadata:s:a:1', 'title=English 2.0']),
    videoOnly: make('silent.mp4', [...V, '-t', '3', ...X264, '-an']),
    audioOnly: make('sound.m4a', [...A(330), '-t', '3', '-c:a', 'aac']),
    odd: make("It's a 'test' & more — fïlm (1).mp4", [...V, ...A(330), '-t', '3', ...X264, '-c:a', 'ac3', '-b:a', '192k'])
  };
});

test('locate: finds ffmpeg on PATH, and nothing in a bogus list', { skip }, async () => {
  assert.ok(exe && fs.existsSync(exe), 'found ' + exe);
  ff.resetCache();
  assert.equal(await ff.locate({ extra: [path.join(tmp, 'nope')], skipPath: true, execPath: null, noCache: true }), null);
  // A file that exists but is not FFmpeg must not be accepted.
  const fake = path.join(tmp, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  fs.writeFileSync(fake, '#!/bin/sh\necho hello\n', { mode: 0o755 });
  assert.equal(await ff.locate({ extra: [fake], skipPath: true, execPath: null, noCache: true }), null);
  fs.unlinkSync(fake);
  assert.equal(await ff.locate({ extra: [exe], skipPath: true, execPath: null, noCache: true }), exe);
});

test('candidates: Windows search order includes the PC Clipper folder', () => {
  const list = ff.candidates({
    platform: 'win32', userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\Avengers Player', execPath: 'C:\\Apps\\Avengers Player\\Avengers Player.exe',
    env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', PATH: 'C:\\Windows;"C:\\Program Files\\ffmpeg\\bin"' }, extra: ['D:\\tools\\ffmpeg.exe']
  });
  assert.deepEqual(list, [
    'D:\\tools\\ffmpeg.exe',
    'C:\\Users\\me\\AppData\\Roaming\\Avengers Player\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Users\\me\\AppData\\Local\\PCClipper\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Apps\\Avengers Player\\ffmpeg.exe',
    'C:\\Apps\\Avengers Player\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Windows\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe'
  ]);
});

test('probe: reads streams field by field', { skip }, async () => {
  const a = await ff.probe(exe, clips.aac);
  assert.ok(Math.abs(a.durationSec - 6) < 0.3, 'duration ' + a.durationSec);
  assert.match(a.container, /mp4/);
  assert.equal(a.video.codec, 'h264');
  assert.equal(a.video.width, 320);
  assert.equal(a.video.height, 180);
  assert.equal(a.video.fps, 24);
  assert.equal(a.video.pixFmt, 'yuv420p');
  assert.equal(a.video.bitDepth, 8);
  assert.equal(a.audio.length, 1);
  assert.equal(a.audio[0].codec, 'aac');
  assert.equal(a.audio[0].sampleRate, 48000);
  assert.equal(a.audio[0].channels, 1);

  const d = await ff.probe(exe, clips.ac3);
  assert.equal(d.audio[0].codec, 'ac3');
  assert.equal(d.audio[0].channels, 6);

  const m = await ff.probe(exe, clips.mkv);
  assert.match(m.container, /matroska/);
  assert.deepEqual(m.audio.map((x) => [x.index, x.codec, x.lang, x.isDefault]), [[0, 'eac3', 'eng', true], [1, 'aac', 'fra', false]]);
  assert.equal(m.subtitles.length, 1);
  assert.equal(m.subtitles[0].isText, true);
  assert.equal(m.subtitles[0].lang, 'eng');
  assert.equal(m.subtitles[0].title, 'English subs');

  assert.equal((await ff.probe(exe, clips.videoOnly)).audio.length, 0);
  assert.equal((await ff.probe(exe, clips.audioOnly)).video, null);
  assert.equal((await ff.probe(exe, clips.odd)).audio[0].codec, 'ac3');
  await assert.rejects(ff.probe(exe, path.join(tmp, 'missing.mp4')), /does not exist/);
  const junk = path.join(tmp, 'junk.mp4');
  fs.writeFileSync(junk, 'this is not a video');
  await assert.rejects(ff.probe(exe, junk), /not a video/);
});

test('parseProbe: real-world lines', () => {
  const text = [
    "Input #0, matroska,webm, from 'Movie.mkv':",
    '  Duration: 03:01:11.25, start: 0.000000, bitrate: 15320 kb/s',
    '  Stream #0:0(eng): Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160 [SAR 1:1 DAR 16:9], 23.98 fps, 23.98 tbr, 1k tbn (default)',
    '  Stream #0:1(eng): Audio: truehd, 48000 Hz, 7.1, s32 (24 bit) (default)',
    '      Metadata:',
    '        title           : TrueHD Atmos 7.1',
    '  Stream #0:2(eng): Audio: ac3, 48000 Hz, 5.1(side), fltp, 640 kb/s',
    '  Stream #0:3(eng): Subtitle: hdmv_pgs_subtitle',
    '  Stream #0:4(ara): Subtitle: subrip',
    '      Metadata:',
    '        title           : Arabic',
    '  Stream #0:5: Video: mjpeg (Progressive), yuvj420p(pc, bt470bg/unknown/unknown), 600x900, 90k tbr, 90k tbn (attached pic)',
    '  Stream #0:6: Attachment: ttf'
  ].join('\n');
  const p = ff.parseProbe(text);
  assert.ok(Math.abs(p.durationSec - 10871.25) < 0.01);
  assert.deepEqual([p.video.codec, p.video.width, p.video.height, p.video.bitDepth, p.video.pixFmt], ['hevc', 3840, 2160, 10, 'yuv420p10le']);
  assert.ok(Math.abs(p.video.fps - 23.98) < 0.001);
  assert.deepEqual(p.audio.map((a) => [a.codec, a.channels, a.title, a.isDefault]), [['truehd', 8, 'TrueHD Atmos 7.1', true], ['ac3', 6, '', false]]);
  assert.deepEqual(p.subtitles.map((s) => [s.index, s.codec, s.isText, s.lang, s.title]), [[0, 'hdmv_pgs_subtitle', false, 'eng', ''], [1, 'subrip', true, 'ara', 'Arabic']]);
  assert.equal(ff.parseProbe('garbage'), null);
  assert.ok(Number.isNaN(ff.parseProbe("Input #0, mp4, from 'x':\n  Duration: N/A, bitrate: N/A\n  Stream #0:0: Audio: aac, 44100 Hz, stereo").durationSec));
});

test('assess: what Chromium can and cannot play, in plain words', () => {
  const v = (o) => Object.assign({ index: 0, codec: 'h264', pixFmt: 'yuv420p', bitDepth: 8 }, o);
  const a = (codec, o) => Object.assign({ index: 0, codec, channels: 2, isDefault: false }, o);
  let r = ff.assess({ video: v(), audio: [a('aac')] });
  assert.deepEqual([r.videoOk, r.audioOk, r.needsAudioFix, r.reasons.length], [true, true, false, 0]);

  r = ff.assess({ video: v(), audio: [a('eac3')] });
  assert.deepEqual([r.videoOk, r.audioOk, r.needsAudioFix, r.audioIndex], [true, false, true, 0]);
  assert.match(r.reasons[0], /Dolby Digital Plus/);
  assert.match(r.reasons[0], /silent/);

  r = ff.assess({ video: v(), audio: [a('aac', { index: 0 }), a('dts', { index: 1, isDefault: true })] });
  assert.deepEqual([r.audioOk, r.needsAudioFix, r.audioIndex, r.silentWithoutFix], [false, true, 1, false], 'with no languages to go by, the file\'s main track is the one that counts');
  assert.match(r.reasons[0], /The main sound track is DTS/);
  assert.match(r.reasons[0], /another sound track instead/);
  assert.equal(r.audioReason, r.reasons[0]);

  r = ff.assess({ video: v(), audio: [] });
  assert.deepEqual([r.audioOk, r.needsAudioFix, r.silentWithoutFix], [false, false, true]);
  assert.match(r.reasons[0], /no sound/);

  // A sound problem is reported separately from a picture problem.
  r = ff.assess({ video: v({ codec: 'mpeg4' }), audio: [a('ac3')] });
  assert.match(r.reasons[0], /MPEG-4/);
  assert.match(r.audioReason, /Dolby Digital/);

  assert.equal(ff.assess({ video: v({ codec: 'hevc' }), audio: [a('aac')] }, { hevcOk: true }).videoOk, true);
  r = ff.assess({ video: v({ codec: 'hevc' }), audio: [a('aac')] }, { hevcOk: false });
  assert.equal(r.videoOk, false);
  assert.match(r.reasons[0], /HEVC/);
  assert.equal(ff.assess({ video: v({ pixFmt: 'yuv420p10le', bitDepth: 10 }), audio: [a('aac')] }).videoOk, false, '10-bit H.264');
  assert.equal(ff.assess({ video: v({ pixFmt: 'yuv444p' }), audio: [a('aac')] }).videoOk, false);
  assert.equal(ff.assess({ video: v({ codec: 'av1' }), audio: [a('opus')] }).videoOk, true);
  assert.equal(ff.assess({ video: v({ codec: 'mpeg4' }), audio: [a('mp3')] }).videoOk, false);
  assert.equal(ff.assess({ video: null, audio: [a('aac')] }).videoOk, false);
  for (const ok of ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le']) assert.equal(ff.assess({ video: v(), audio: [a(ok)] }).audioOk, true, ok);
  for (const bad of ['ac3', 'eac3', 'dts', 'truehd', 'wmav2']) assert.equal(ff.assess({ video: v(), audio: [a(bad)] }).needsAudioFix, true, bad);
});

test('assess: English is the track that counts, whatever the file calls its main track', () => {
  const v = { index: 0, codec: 'hevc', pixFmt: 'yuv420p10le', bitDepth: 10 };
  // The file that went wrong for a real user: Hindi first and flagged as the main track, English second.
  const pahe = {
    video: v,
    audio: [
      { index: 0, codec: 'eac3', channels: 6, lang: 'hin', title: 'Org Hindi DDP 5.1', isDefault: true },
      { index: 1, codec: 'ac3', channels: 6, lang: 'eng', title: 'English DD 5.1', isDefault: false }
    ]
  };
  let r = ff.assess(pahe, { hevcOk: true });
  assert.deepEqual([r.audioIndex, r.audioLang, r.preferLang, r.hasPreferred, r.needsAudioFix, r.silentWithoutFix], [1, 'eng', 'eng', true, true, true]);
  assert.match(r.audioReason, /^The English sound track is Dolby Digital \(AC-3\)/);
  assert.match(r.audioReason, /silent/);

  r = ff.assess(pahe, { hevcOk: true, preferLang: 'hi' });
  assert.deepEqual([r.audioIndex, r.audioLang, r.preferLang, r.hasPreferred], [0, 'hin', 'hin', true]);
  assert.match(r.audioReason, /^The Hindi sound track is Dolby Digital Plus/);

  r = ff.assess(pahe, { hevcOk: true, preferLang: 'French' });
  assert.deepEqual([r.audioIndex, r.audioLang, r.preferLang, r.hasPreferred], [0, 'hin', 'fra', false], 'no French: the file\'s own main track');

  // A dub that plays, the original that does not: the fix is still needed, and the reason says what would happen.
  const mixed = { video: v, audio: [{ index: 0, codec: 'aac', channels: 2, lang: 'hin', isDefault: true }, { index: 1, codec: 'ac3', channels: 6, lang: 'eng', isDefault: false }] };
  r = ff.assess(mixed, { hevcOk: true });
  assert.deepEqual([r.audioIndex, r.audioOk, r.needsAudioFix, r.silentWithoutFix], [1, false, true, false]);
  assert.match(r.audioReason, /would play in Hindi instead/);

  // Both playable: nothing to fix, and English is still the one named.
  const fine = { video: v, audio: [{ index: 0, codec: 'aac', channels: 2, lang: 'hin', isDefault: true }, { index: 1, codec: 'aac', channels: 6, lang: 'eng', isDefault: false }] };
  r = ff.assess(fine, { hevcOk: true });
  assert.deepEqual([r.audioIndex, r.audioOk, r.needsAudioFix, r.audioReason], [1, true, false, '']);

  // A Hindi-only file: it plays, and the result says the wanted language is not there.
  r = ff.assess({ video: v, audio: [{ index: 0, codec: 'aac', channels: 6, lang: 'hin', isDefault: true }] }, { hevcOk: true });
  assert.deepEqual([r.audioOk, r.audioLang, r.hasPreferred], [true, 'hin', false]);
});

test('convertArgs: the chosen language goes first and is the one flagged to play', () => {
  const info = {
    video: { index: 0, codec: 'hevc' },
    audio: [
      { index: 0, codec: 'eac3', channels: 6, lang: 'hin', title: 'Org Hindi DDP 5.1', isDefault: true },
      { index: 1, codec: 'ac3', channels: 6, lang: 'eng', title: 'English DD 5.1', isDefault: false },
      { index: 2, codec: 'aac', profile: 'LC', channels: 2, lang: '', title: 'English Commentary', isDefault: false },
      { index: 3, codec: 'truehd', channels: 8, lang: 'tam', title: '', isDefault: false }
    ]
  };
  const arg = (list) => ff.convertArgs(info, 'in.mkv', 'out.mp4.part', list.map((i) => info.audio[i]), []).join(' ');
  let s = arg([1]);
  assert.match(s, /-map 0:v:0 -map 0:a:1 -c:v copy -c:a:0 aac -b:a:0 384k -disposition:a:0 default/);
  assert.match(s, /-metadata:s:a:0 handler_name=English/);
  assert.match(s, / -sn /, 'no subtitles asked for');
  assert.match(s, /-tag:v hvc1/, 'HEVC needs the tag Chromium looks for');
  assert.doesNotMatch(s, /language=/, 'a language the file already states is left alone');

  s = arg([1, 0, 2, 3]);
  assert.match(s, /-map 0:a:1 -map 0:a:0 -map 0:a:2 -map 0:a:3 /, 'English first, the rest in file order');
  assert.match(s, /-c:a:0 aac -b:a:0 384k -disposition:a:0 default/);
  assert.match(s, /-c:a:1 aac -b:a:1 384k -disposition:a:1 0 /);
  assert.match(s, /-c:a:2 copy -disposition:a:2 0 -metadata:s:a:2 language=eng -metadata:s:a:2 handler_name=English/, 'plain AAC is copied; a language known only from the title is written down');
  assert.match(s, /-c:a:3 aac -b:a:3 384k -ac:a:3 6 -disposition:a:3 0 .*handler_name=Tamil/, '7.1 is folded down to 5.1');

  // The track that will play is re-encoded even when it already is AAC: the result must be certain to decode.
  s = arg([2]);
  assert.match(s, /-map 0:a:2 -c:v copy -c:a:0 aac -b:a:0 192k -disposition:a:0 default/);

  const withSubs = ff.convertArgs(info, 'in.mkv', 'o.part', [info.audio[1]], [{ index: 0 }, { index: 2 }]).join(' ');
  assert.match(withSubs, /-map 0:a:1 -map 0:s:0 -map 0:s:2 /);
  assert.match(withSubs, /-c:s mov_text/);
  assert.doesNotMatch(withSubs, / -sn /);
});

test('convertAudio: sound becomes AAC, the picture is bit-identical', { skip }, async () => {
  for (const [key, index] of [['ac3', 0], ['mkv', 0], ['odd', 0]]) {
    const input = clips[key];
    const output = ff.suggestOutputPath(input);
    assert.ok(output.endsWith(' (Avengers Player).mp4'));
    const seen = [];
    const r = await ff.convertAudio(exe, input, output, { audioIndex: index, onProgress: (p) => seen.push(p.fraction) });
    assert.equal(r.output, output);
    assert.ok(fs.existsSync(output) && !fs.existsSync(output + '.part'), key);
    const p = await ff.probe(exe, output);
    assert.equal(p.audio.length, 1);
    assert.equal(p.audio[0].codec, 'aac', key);
    assert.equal(p.video.codec, 'h264');
    assert.ok(Math.abs(p.durationSec - (await ff.probe(exe, input)).durationSec) < 0.3);
    assert.equal(videoHash(output), videoHash(input), key + ': video stream must be copied untouched');
    assert.ok(videoHash(input).length > 10);
    assert.equal(seen[seen.length - 1], 1, 'progress ends at 1');
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'progress never goes backwards');
    assert.equal(ff.assess(p).audioOk, true);
  }
  // 5.1 stays 5.1.
  assert.equal((await ff.probe(exe, ff.suggestOutputPath(clips.ac3))).audio[0].channels, 6);
});

test('convertAudio: English is converted first, whatever the file flags as its main track', { skip }, async () => {
  const input = clips.pahe;
  const before = await ff.probe(exe, input);
  assert.deepEqual(before.audio.map((a) => [a.codec, a.lang, a.isDefault]), [['eac3', 'hin', true], ['ac3', 'eng', false]]);
  assert.equal(ff.assess(before).audioIndex, 1);

  // No track named: English it is, and only English.
  let out = path.join(tmp, 'pahe-default.mp4');
  let r = await ff.convertAudio(exe, input, out, {});
  assert.deepEqual(r.audio, [{ index: 1, lang: 'eng' }]);
  let p = await ff.probe(exe, out);
  assert.deepEqual(p.audio.map((a) => [a.codec, a.lang, a.isDefault, a.channels, a.title]), [['aac', 'eng', true, 2, 'English']]);
  assert.equal(videoHash(out), videoHash(input), 'the picture is copied untouched');

  // Keeping the others: English first and flagged to play, Hindi after it.
  out = path.join(tmp, 'pahe-both.mp4');
  r = await ff.convertAudio(exe, input, out, { keepOthers: true });
  assert.deepEqual(r.audio, [{ index: 1, lang: 'eng' }, { index: 0, lang: 'hin' }]);
  p = await ff.probe(exe, out);
  assert.deepEqual(p.audio.map((a) => [a.codec, a.lang, a.isDefault, a.channels, a.title]), [['aac', 'eng', true, 2, 'English'], ['aac', 'hin', false, 6, 'Hindi']]);
  assert.equal(videoHash(out), videoHash(input));
  const judged = ff.assess(p);
  assert.deepEqual([judged.audioOk, judged.audioIndex, judged.needsAudioFix], [true, 0, false], 'the result needs no further fixing');

  // The subtitles come along and can still be pulled out as text.
  assert.equal(r.subtitles, 1);
  assert.deepEqual(p.subtitles.map((x) => [x.codec, x.lang, x.isText]), [['mov_text', 'eng', true]]);
  const srtOut = path.join(tmp, 'pahe-both.srt');
  await ff.extractSubtitle(exe, out, 0, srtOut);
  assert.match(fs.readFileSync(srtOut, 'utf8'), /First line[\s\S]*Second/);

  // Another language can be asked for, by track or by preference.
  out = path.join(tmp, 'pahe-hindi.mp4');
  r = await ff.convertAudio(exe, input, out, { audioIndex: 0, keepOthers: true });
  p = await ff.probe(exe, out);
  assert.deepEqual(p.audio.map((a) => [a.lang, a.isDefault]), [['hin', true], ['eng', false]]);
  out = path.join(tmp, 'pahe-pref.mp4');
  r = await ff.convertAudio(exe, input, out, { preferLang: 'hin' });
  assert.deepEqual((await ff.probe(exe, out)).audio.map((a) => a.lang), ['hin']);

  // Subtitles can be left out.
  out = path.join(tmp, 'pahe-nosubs.mp4');
  r = await ff.convertAudio(exe, input, out, { keepSubtitles: false });
  assert.equal(r.subtitles, 0);
  assert.equal((await ff.probe(exe, out)).subtitles.length, 0);
});

test('convertAudio: a language known only from a track title is found and written into the new file', { skip }, async () => {
  const before = await ff.probe(exe, clips.titled);
  assert.deepEqual(before.audio.map((a) => [a.lang, a.title]), [['', 'Hindi 2.0'], ['', 'English 2.0']]);
  assert.deepEqual([ff.assess(before).audioIndex, ff.assess(before).audioLang], [1, 'eng']);
  const out = path.join(tmp, 'titled-out.mp4');
  await ff.convertAudio(exe, clips.titled, out, { keepOthers: true });
  const p = await ff.probe(exe, out);
  assert.deepEqual(p.audio.map((a) => [a.lang, a.isDefault, a.title]), [['eng', true, 'English'], ['hin', false, 'Hindi']]);
});

test('convertAudio: refusals and failures leave nothing behind', { skip }, async () => {
  await assert.rejects(ff.convertAudio(exe, clips.aac, clips.aac, {}), /cannot replace the original/);
  await assert.rejects(ff.convertAudio(exe, clips.videoOnly, path.join(tmp, 'o1.mp4'), {}), /no sound track/);
  await assert.rejects(ff.convertAudio(exe, clips.audioOnly, path.join(tmp, 'o2.mp4'), {}), /no picture/);
  await assert.rejects(ff.convertAudio(exe, clips.aac, path.join(tmp, 'o3.mp4'), { audioIndex: 5 }), /no sound track number 6/);
  await assert.rejects(ff.convertAudio(exe, clips.aac, path.join(tmp, 'no-such-dir', 'o4.mp4'), {}), /could not convert/);
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(ff.convertAudio(exe, clips.ac3, path.join(tmp, 'o5.mp4'), { signal: ctl.signal }), { name: 'AbortError' });
  for (const n of ['o1', 'o2', 'o3', 'o5']) {
    assert.ok(!fs.existsSync(path.join(tmp, n + '.mp4')) && !fs.existsSync(path.join(tmp, n + '.mp4.part')), n);
  }
});

test('convertAudio: cancelling mid-way kills FFmpeg and removes the partial file', { skip }, async () => {
  const long = make('long.mp4', [...V, ...A(440), '-t', '240', ...X264, '-crf', '40', '-c:a', 'ac3', '-b:a', '192k']);
  const out = path.join(tmp, 'long-out.mp4');
  const ctl = new AbortController();
  let calls = 0;
  const t0 = Date.now();
  await assert.rejects(ff.convertAudio(exe, long, out, { signal: ctl.signal, onProgress: () => { if (++calls === 1) ctl.abort(); } }), { name: 'AbortError' });
  assert.ok(Date.now() - t0 < 8000, 'returned promptly');
  assert.ok(!fs.existsSync(out) && !fs.existsSync(out + '.part'));
});

test('extractSubtitle: text tracks come out as SRT', { skip }, async () => {
  const out = path.join(tmp, 'out.srt');
  assert.equal(await ff.extractSubtitle(exe, clips.mkv, 0, out, {}), out);
  const text = fs.readFileSync(out, 'utf8');
  // The container may shift cue times by a few milliseconds (encoder delay); that is irrelevant for subtitles.
  assert.match(text, /00:00:00,5\d\d --> 00:00:02,0\d\d/);
  assert.match(text, /First line/);
  assert.match(text, /Second <i>line<\/i>/);
  await assert.rejects(ff.extractSubtitle(exe, clips.aac, 0, path.join(tmp, 'none.srt'), {}), /no subtitle track/);
});

/* ---- download: ZIP reading and fingerprint check, against a local server ---- */

function buildZip(name, files, compress) {
  const zip = path.join(tmp, name);
  const dir = fs.mkdtempSync(path.join(tmp, 'zipsrc-'));
  for (const [rel, data] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
  const py = 'import sys,zipfile,os\nz=zipfile.ZipFile(sys.argv[1],"w",zipfile.ZIP_DEFLATED if sys.argv[3]=="1" else zipfile.ZIP_STORED)\nz.comment=b"a zip comment"\n' +
    'for root,_,names in os.walk(sys.argv[2]):\n  for n in sorted(names):\n    p=os.path.join(root,n); z.write(p, os.path.relpath(p, sys.argv[2]).replace(os.sep,"/"))\nz.close()\n';
  const r = spawnSync('python3', ['-c', py, zip, dir, compress ? '1' : '0'], { encoding: 'utf8' });
  return r.status === 0 ? zip : null;
}
const HAVE_PY = spawnSync('python3', ['--version']).status === 0;
const payload = Buffer.concat([Buffer.from('MZ fake ffmpeg program\n'), crypto.randomBytes(300000), Buffer.alloc(200000, 7)]);
const zipFiles = {
  'ffmpeg-8.1-essentials_build/README.txt': 'read me',
  'ffmpeg-8.1-essentials_build/bin/ffplay.exe': 'not this one',
  'ffmpeg-8.1-essentials_build/bin/ffmpeg.exe': payload,
  'ffmpeg-8.1-essentials_build/doc/deep/bin/ffmpeg.exe': 'a decoy deeper in the tree',
  'ffmpeg-8.1-essentials_build/presets/x.ffpreset': 'preset'
};

test('zip: extracts exactly bin/ffmpeg.exe, deflated or stored', { skip: HAVE_PY ? false : 'python3 is not installed' }, async () => {
  for (const compress of [true, false]) {
    const zip = buildZip('pkg-' + compress + '.zip', zipFiles, compress);
    const dest = path.join(tmp, 'unz-' + compress, 'bin', 'ffmpeg.exe');
    const fractions = [];
    const name = await ff.extractFfmpegFromZip(zip, dest, { onProgress: (p) => fractions.push(p.fraction) });
    assert.equal(name, 'ffmpeg-8.1-essentials_build/bin/ffmpeg.exe');
    assert.ok(fs.readFileSync(dest).equals(payload), 'payload identical');
    assert.equal(fractions[fractions.length - 1], 1);
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), ['ffmpeg.exe'], 'nothing else is written');
  }
  const empty = buildZip('other.zip', { 'x/readme.txt': 'nothing useful' }, true);
  await assert.rejects(ff.extractFfmpegFromZip(empty, path.join(tmp, 'e', 'ffmpeg.exe')), /does not contain/);
  const notZip = path.join(tmp, 'not.zip');
  fs.writeFileSync(notZip, crypto.randomBytes(5000));
  await assert.rejects(ff.extractFfmpegFromZip(notZip, path.join(tmp, 'e2', 'ffmpeg.exe')), /ZIP/);
  // A damaged payload must be caught, not installed.
  const zip = buildZip('damaged.zip', zipFiles, false);
  const bytes = fs.readFileSync(zip);
  const at = bytes.indexOf(Buffer.from('MZ fake ffmpeg program'));
  bytes[at + 5000] ^= 0xFF;
  fs.writeFileSync(zip, bytes);
  if (typeof require('node:zlib').crc32 === 'function') {
    await assert.rejects(ff.extractFfmpegFromZip(zip, path.join(tmp, 'e3', 'bin', 'ffmpeg.exe')), /damaged/);
    assert.ok(!fs.existsSync(path.join(tmp, 'e3', 'bin', 'ffmpeg.exe')));
  }
});

test('download: fingerprint is checked before anything is unpacked', { skip: HAVE_PY ? false : 'python3 is not installed' }, async () => {
  const zip = buildZip('served.zip', zipFiles, true);
  const body = fs.readFileSync(zip);
  const good = crypto.createHash('sha256').update(body).digest('hex');
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits++;
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/pkg.zip' }); res.end(); return; }
    if (req.url === '/missing') { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    await assert.rejects(ff.download(path.join(tmp, 'dl0'), {}), process.platform === 'win32' ? /./ : /only available on Windows/);
    await assert.rejects(ff.download(path.join(tmp, 'dl1'), { platform: 'win32', sources: [{ url: base + '/pkg.zip', sha256: good }] }), /could not be downloaded/, 'plain http is refused');

    const wrong = path.join(tmp, 'dl2');
    await assert.rejects(ff.download(wrong, { platform: 'win32', allowHttp: true, sources: [{ url: base + '/pkg.zip', sha256: 'ab'.repeat(32) }] }), /fingerprint/);
    assert.ok(!fs.existsSync(path.join(wrong, 'bin')), 'nothing unpacked from an unverified download');
    assert.deepEqual(fs.readdirSync(wrong), [], 'the bad download is thrown away');

    const dest = path.join(tmp, 'dl3');
    const phases = new Set();
    const exePath = await ff.download(dest, {
      platform: 'win32', allowHttp: true, onProgress: (p) => phases.add(p.phase),
      sources: [{ url: base + '/missing', sha256: good }, { url: base + '/redirect', sha256: good.toUpperCase() }]
    });
    assert.equal(exePath, path.join(dest, 'bin', 'ffmpeg.exe'));
    assert.ok(fs.readFileSync(exePath).equals(payload));
    assert.deepEqual(fs.readdirSync(dest), ['bin'], 'the zip is removed afterwards');
    assert.deepEqual([...phases].sort(), ['download', 'extract', 'verify']);
    assert.ok(hits >= 4);

    const ctl = new AbortController();
    ctl.abort();
    await assert.rejects(ff.download(path.join(tmp, 'dl4'), { platform: 'win32', allowHttp: true, signal: ctl.signal, sources: [{ url: base + '/pkg.zip', sha256: good }] }), { name: 'AbortError' });
  } finally {
    server.close();
  }
});

test('pinned sources are HTTPS with full fingerprints', () => {
  assert.ok(ff.SOURCES.length >= 1);
  for (const s of ff.SOURCES) {
    assert.match(s.url, /^https:\/\/github\.com\//);
    assert.match(s.sha256, /^[0-9a-f]{64}$/);
  }
});
