'use strict';
// Runs the real analyser (FFmpeg + OCR) on the clips from scripts/make-test-media.sh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('../../main/analyze.cjs');
const C = require('../../core/clipcheck.cjs');

const D = path.join(__dirname, '..', 'fixtures', 'media');
const EXE = 'ffmpeg';
const have = fs.existsSync(path.join(D, 'good.mp4'));
const facts = {};
const get = async (name) => (facts[name] = facts[name] || (await A.analyze(EXE, path.join(D, name))));

test.after(() => A.closeOcr());

test('a normal clip passes', { skip: !have && 'run scripts/make-test-media.sh first' }, async () => {
  const f = await get('good.mp4');
  assert.ok(Math.abs(f.durationSec - 20) < 0.5);
  assert.strictEqual(f.video.width, 1280);
  assert.ok(f.hashes.length >= 19);
  assert.ok(f.motion > 1, 'moving picture, motion ' + f.motion);
  assert.ok(f.meanVolumeDb < -20 && f.meanVolumeDb > -36, 'mean ' + f.meanVolumeDb); // lavfi sine is 1/8 amplitude, x0.3
  assert.ok(f.ocrOk);
  const r = C.checkClip(f, { caption: 'speed would lose it at this', history: [] });
  assert.strictEqual(r.verdict, 'post', JSON.stringify(r.items.filter((i) => i.level !== 'ok')));
});

test('on-screen self-promo is caught', { skip: !have }, async () => {
  const f = await get('promo.mp4');
  assert.match(f.ocrText.toLowerCase(), /clipzking/);
  const r = C.checkClip(f, { history: [] });
  assert.strictEqual(r.verdict, 'dont');
  assert.ok(r.items.some((i) => i.rule === 'promo' && i.level === 'block'));
});

test('a re-encoded copy of a posted clip is a repeat, a different clip is not', { skip: !have }, async () => {
  const good = await get('good.mp4');
  const again = await get('good-reencoded.mp4');
  const other = await get('other.mp4');
  const history = [{ fileName: 'good.mp4', sha256: good.sha256, hashes: good.hashes, postedAt: Date.now() - 86400e3 }];
  const r1 = C.checkClip(again, { history });
  assert.ok(r1.items.some((i) => i.rule === 'repeat' && i.level === 'block'), JSON.stringify(r1.items.filter((i) => i.rule === 'repeat')));
  const r2 = C.checkClip(other, { history });
  assert.ok(!r2.items.some((i) => i.rule === 'repeat' && i.level !== 'ok'));
  const r3 = C.checkClip(good, { history });
  assert.match(r3.items.find((i) => i.rule === 'repeat').title, /exact file/);
});

test('black and silent clip is flagged', { skip: !have }, async () => {
  const f = await get('dead.mp4');
  assert.ok(f.blackSec > 15, 'black ' + f.blackSec);
  assert.ok(f.silenceSec > 15, 'silence ' + f.silenceSec);
  assert.ok(f.motion < 0.3, 'still picture, motion ' + f.motion);
  const r = C.checkClip(f, { history: [] });
  assert.notStrictEqual(r.verdict, 'post');
  assert.ok(r.items.some((i) => /Black screen/.test(i.title)));
  assert.ok(r.items.some((i) => /silent/i.test(i.title)));
  assert.ok(r.items.some((i) => /barely changes/.test(i.title)));
});

test('MKV is flagged as not playing in Discord', { skip: !have }, async () => {
  const f = await get('other.mkv');
  const r = C.checkClip(f, { history: [] });
  assert.ok(r.items.some((i) => i.rule === 'embed' && i.level === 'warn'));
});

test('too big: blocked, and the small copy fits 10 MB and still plays', { skip: !have, timeout: 300000 }, async () => {
  const f = await get('big.mp4');
  const r = C.checkClip(f, { history: [], uploadLimitMB: 10 });
  assert.ok(r.items.some((i) => i.rule === 'upload' && i.level === 'block'));
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scp-')), 'small.mp4');
  const c = await A.makeSmallCopy(EXE, path.join(D, 'big.mp4'), 10, { output: out });
  assert.ok(c.sizeBytes <= 10 * 1024 * 1024, 'size ' + c.sizeBytes);
  assert.ok(c.sizeBytes > 5 * 1024 * 1024, 'uses the budget: ' + c.sizeBytes);
  const g = await A.analyze(EXE, out);
  assert.ok(Math.abs(g.durationSec - 30) < 0.5);
  assert.strictEqual(g.video.codec, 'h264');
  assert.ok(g.audio.length === 1);
});
