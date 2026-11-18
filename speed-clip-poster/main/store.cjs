'use strict';
/**
 * Tiny JSON settings store for the main process.
 *
 * The armed countdown must survive a crash at 11:58 PM, so every save is written to a temp file
 * and renamed into place (a rename is atomic on NTFS), and the previous good file is kept as a
 * backup in case the newest one is ever unreadable.
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, name) {
    this.file = path.join(dir, name || 'settings.json');
    this.backup = this.file + '.bak';
    this.data = {};
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* reported on first save */ }
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
      const json = JSON.stringify(obj);
      fs.writeFileSync(tmp, json, 'utf8');
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup); } catch (e) { /* backup is best effort */ }
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

module.exports = { Store };
