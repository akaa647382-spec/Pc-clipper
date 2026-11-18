'use strict';
/**
 * Tiny JSON settings store for the main process.
 *
 * The armed countdown must survive a crash at 11:58 PM, a power cut and an empty laptop battery.
 * Every save is written to a temp file, forced onto the disk (so a power cut a moment later cannot
 * leave a file that only looks written) and then renamed into place (a rename is atomic on NTFS).
 * The previous good file is kept as a backup in case the newest one is ever unreadable.
 */
const fs = require('fs');
const path = require('path');

/** Writes `text` to `file` and does not return before it is on the disk. Throws on failure. */
function writeDurable(file, text) {
  const buf = Buffer.isBuffer(text) ? text : Buffer.from(String(text), 'utf8');
  const fd = fs.openSync(file, 'w');
  try {
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off, off);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

class Store {
  constructor(dir, name) {
    this.file = path.join(dir, name || 'settings.json');
    this.backup = this.file + '.bak';
    this.data = {};
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* reported on first save */ }
    // A file cut short or zeroed by a power cut does not parse: the backup is used instead.
    this.data = this.read(this.file) || this.read(this.backup) || {};
  }

  read(file) {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) {
      return null;
    }
  }

  get() {
    return this.data;
  }

  /** Replaces the stored object. Returns true when it reached the disk. */
  set(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    this.data = obj;
    const tmp = this.file + '.tmp';
    try {
      writeDurable(tmp, JSON.stringify(obj));
      // The backup is the last file that was read back whole: a damaged one is not copied over it.
      try { if (this.read(this.file)) fs.copyFileSync(this.file, this.backup); } catch (e) { /* backup is best effort */ }
      fs.renameSync(tmp, this.file);
      return true;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
      return false;
    }
  }

  merge(patch) {
    return this.set(Object.assign({}, this.data, patch));
  }
}

module.exports = { Store, writeDurable };
