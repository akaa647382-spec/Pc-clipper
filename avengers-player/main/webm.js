'use strict';
/**
 * A WebM file from the browser's recorder says nothing about how long it is (it is written while
 * recording), so players show no length and seek badly. withDuration() puts the length into the
 * file's Segment Info, the way any finished WebM file has it. Pure, so it can be tested.
 */

/** An EBML variable-length size at pos: { len, val, unknown } (unknown: all ones, "until the end"). */
function readSize(buf, pos) {
  if (pos >= buf.length) return null;
  const b = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
  if (len > 8 || pos + len > buf.length) return null;
  let val = b & (mask - 1);
  let allOnes = val === mask - 1;
  for (let i = 1; i < len; i++) { val = val * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) allOnes = false; }
  return { len: len, val: val, unknown: allOnes };
}

/** An EBML element ID at pos: { len, id } (IDs keep their length marker, as in the spec tables). */
function readId(buf, pos) {
  if (pos >= buf.length) return null;
  const b = buf[pos];
  const len = b & 0x80 ? 1 : b & 0x40 ? 2 : b & 0x20 ? 3 : b & 0x10 ? 4 : 0;
  if (!len || pos + len > buf.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { len: len, id: id };
}

/** A size written in 8 bytes (always enough here). */
function size8(n) {
  const out = Buffer.alloc(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

const EBML = 0x1A45DFA3, SEGMENT = 0x18538067, INFO = 0x1549A966, DURATION = 0x4489, TIMECODE_SCALE = 0x2AD7B1;

/**
 * The same WebM file with its length (ms) written in, or null when the file is not as expected
 * (or already says how long it is).
 */
function withDuration(buf, ms) {
  if (!Buffer.isBuffer(buf) || !(ms > 0)) return null;
  let pos = 0;
  const head = readId(buf, pos);
  if (!head || head.id !== EBML) return null;
  const headSize = readSize(buf, pos + head.len);
  if (!headSize || headSize.unknown) return null;
  pos += head.len + headSize.len + headSize.val;
  const seg = readId(buf, pos);
  if (!seg || seg.id !== SEGMENT) return null;
  const segSizeAt = pos + seg.len;
  const segSize = readSize(buf, segSizeAt);
  if (!segSize) return null;
  let p = segSizeAt + segSize.len;
  // The Segment's first children: Info is among them (before the first Cluster).
  for (let guard = 0; guard < 16 && p < buf.length; guard++) {
    const el = readId(buf, p);
    if (!el) return null;
    const sz = readSize(buf, p + el.len);
    if (!sz || sz.unknown) return null;
    const start = p + el.len + sz.len;
    const end = start + sz.val;
    if (end > buf.length) return null;
    if (el.id === INFO) {
      // Already has a length? Then there is nothing to do. Read the time unit on the way.
      let scale = 1000000;
      for (let q = start; q < end;) {
        const c = readId(buf, q);
        const cs = c && readSize(buf, q + c.len);
        if (!c || !cs) return null;
        const cStart = q + c.len + cs.len;
        if (c.id === DURATION) return null;
        if (c.id === TIMECODE_SCALE && cs.val >= 1 && cs.val <= 8) { let v = 0; for (let i = 0; i < cs.val; i++) v = v * 256 + buf[cStart + i]; if (v > 0) scale = v; }
        q = cStart + cs.val;
      }
      const dur = Buffer.alloc(11);
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;          // Duration, 8 bytes
      dur.writeDoubleBE(ms * 1e6 / scale, 3);
      const newInfo = Buffer.concat([buf.slice(p, p + el.len), size8(sz.val + dur.length), buf.slice(start, end), dur]);
      const grew = newInfo.length - (end - p);
      let segHead = buf.slice(0, segSizeAt + segSize.len);
      if (!segSize.unknown) {
        // A Segment of known size grows by as much (its size is written again, in 8 bytes).
        segHead = Buffer.concat([buf.slice(0, segSizeAt), size8(segSize.val + grew)]);
      }
      return Buffer.concat([segHead, buf.slice(segSizeAt + segSize.len, p), newInfo, buf.slice(end)]);
    }
    p = end;
  }
  return null;
}

module.exports = { withDuration, readSize, readId };
