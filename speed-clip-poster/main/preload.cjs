'use strict';
// The page gets this small API (window.scp) and nothing else from Node or Electron.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('scp', {
  getState: () => call('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  saveSettings: (patch) => call('settings:save', patch),
  setKey: (key) => call('key:set', key),
  pollNow: () => call('poll:now'),
  refreshHistory: () => call('history:refresh'),
  calibrate: () => call('calibrate:run'),
  addLock: (at) => call('lock:add', at),
  removeLock: (id) => call('lock:remove', id),
  addStream: (at) => call('stream:add', at),
  removeStream: (id) => call('stream:remove', id),
  testAlert: () => call('test:alert'),
  ffLocate: () => call('ff:locate'),
  ffDownload: () => call('ff:download'),
  ffPick: () => call('ff:pick'),
  onFfProgress: (cb) => ipcRenderer.on('ff:progress', (_e, p) => cb(p)),
  pickClip: () => call('clip:pick'),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch (_) { return ''; } },
  analyze: (file, caption) => call('clip:analyze', file, caption),
  recheck: (id, caption) => call('clip:recheck', id, caption),
  smallCopy: (id) => call('clip:small-copy', id),
  setClipStatus: (id, status) => call('clip:set-status', id, status),
  removeClip: (id) => call('clip:remove', id),
  showClip: (id) => call('clip:show', id),
  openLink: (which) => call('open:link', which),
});
