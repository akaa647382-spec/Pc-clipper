'use strict';
// Writing the length into a recorded WebM file (main/webm.js).
const test = require('node:test');
const assert = require('node:assert');
const { withDuration, readSize, readId } = require('../../main/webm.js');

const hex = (s) => Buffer.from(s.replace(/\s+/g, ''), 'hex');
const HEAD = hex('1A45DFA3 84 4286 8101');                               // EBML header: EBMLVersion 1
const INFO = Buffer.concat([hex('1549A966 8E'), hex('2AD7B1 83 0F4240'), hex('4D80 84'), Buffer.from('test')]);
const TRACKS = hex('1654AE6B 80');
const CLUSTER = Buffer.concat([hex('1F43B675 01FFFFFFFFFFFFFF'), hex('E7 81 00'), Buffer.from('frames')]);

/** The children of the Info element of a file: [{ id, start, size }]. */
function infoChildren(buf) {
  let p = 0;
  const h = readId(buf, p); const hs = readSize(buf, p + h.len); p += h.len + hs.len + hs.val;
  const seg = readId(buf, p); const ss = readSize(buf, p + seg.len); p += seg.len + ss.len;
  for (;;) {
    const el = readId(buf, p); const sz = readSize(buf, p + el.len);
    const start = p + el.len + sz.len;
    if (el.id === 0x1549A966) {
      const out = [];
      for (let q = start; q < start + sz.val;) { const c = readId(buf, q); const cs = readSize(buf, q + c.len); out.push({ id: c.id, start: q + c.len + cs.len, size: cs.val }); q += c.len + cs.len + cs.val; }
      return out;
    }
    p = start + sz.val;
  }
}

test('a recorded WebM (Segment of unknown size) gets its length, and nothing else changes', () => {
  const file = Buffer.concat([HEAD, hex('18538067 01FFFFFFFFFFFFFF'), INFO, TRACKS, CLUSTER]);
  const out = withDuration(file, 40123.5);
  assert.ok(out);
  const d = infoChildren(out).find((c) => c.id === 0x4489);
  assert.ok(d, 'Duration is there');
  assert.strictEqual(out.readDoubleBE(d.start), 40123.5, 'in milliseconds, as TimecodeScale is 1 ms');
  assert.ok(out.slice(out.length - CLUSTER.length).equals(CLUSTER), 'the frames are untouched');
  assert.ok(out.slice(0, HEAD.length).equals(HEAD));
});

test('a Segment of known size grows by what was added', () => {
  const body = Buffer.concat([INFO, TRACKS, hex('1F43B675 83 E78100')]);
  const file = Buffer.concat([HEAD, hex('18538067'), Buffer.from([0x80 | body.length]), body]);
  const out = withDuration(file, 1000);
  assert.ok(out);
  const seg = readSize(out, HEAD.length + 4);
  assert.strictEqual(seg.val, out.length - (HEAD.length + 4 + seg.len), 'the Segment size covers exactly its new content');
});

test('a time unit other than 1 ms is respected', () => {
  const info = Buffer.concat([hex('1549A966 87'), hex('2AD7B1 83 002710')]);   // TimecodeScale 10 000 ns
  const file = Buffer.concat([HEAD, hex('18538067 01FFFFFFFFFFFFFF'), info, CLUSTER]);
  const out = withDuration(file, 2000);
  const d = infoChildren(out).find((c) => c.id === 0x4489);
  assert.strictEqual(out.readDoubleBE(d.start), 2000 * 1e6 / 10000);
});

test('nothing is changed when the file already has a length or is not WebM', () => {
  const dur = hex('4489 88 0000000000000000');
  const info = Buffer.concat([hex('1549A966'), Buffer.from([0x80 | (7 + dur.length)]), hex('2AD7B1 83 0F4240'), dur]);
  assert.strictEqual(withDuration(Buffer.concat([HEAD, hex('18538067 01FFFFFFFFFFFFFF'), info, CLUSTER]), 1000), null);
  assert.strictEqual(withDuration(Buffer.from('not a webm file at all'), 1000), null);
  assert.strictEqual(withDuration(Buffer.alloc(0), 1000), null);
  assert.strictEqual(withDuration(Buffer.concat([HEAD, hex('18538067 01FFFFFFFFFFFFFF'), INFO]), 0), null);
});
