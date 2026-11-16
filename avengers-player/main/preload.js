'use strict';
/**
 * Bridge between the player page and the main process. The page gets a small, explicit API
 * (window.apNative) and no direct access to Node or Electron.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('apNative', {
  isNative: true,
  platform: process.platform,

  // settings (synchronous load so the first paint already has the right theme and state)
  loadState: () => ipcRenderer.sendSync('state:load'),
  saveState: (obj) => ipcRenderer.invoke('state:save', obj),

  // movie
  pickMovie: () => ipcRenderer.invoke('movie:pick'),
  openMovie: (file) => ipcRenderer.invoke('movie:open', file),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },

  // subtitles
  pickSubtitle: () => ipcRenderer.invoke('subs:pick'),
  readSubtitle: (file) => ipcRenderer.invoke('subs:read', file),
  findSubtitles: (moviePath) => ipcRenderer.invoke('subs:find', moviePath),

  // window
  setFullscreen: (flag) => ipcRenderer.invoke('win:fullscreen', flag),
  isFullscreen: () => ipcRenderer.invoke('win:is-fullscreen'),
  onFullscreen: (cb) => on('win:fullscreen-changed', cb),

  // session: keeps the PC awake, guards the close button and runs the crash watchdog while armed
  setArmed: (flag, autoRestart) => ipcRenderer.send('session:armed', { armed: !!flag, autoRestart: autoRestart !== false }),

  // the crash drill: takes the whole app down so the watchdog can be seen bringing it back
  crashNow: () => ipcRenderer.send('drill:crash'),

  // internet time
  measureTime: () => ipcRenderer.invoke('time:measure'),

  // FFmpeg helper
  ffLocate: () => ipcRenderer.invoke('ff:locate'),
  ffPick: () => ipcRenderer.invoke('ff:pick'),
  ffProbe: (file, hevcOk, preferLang) => ipcRenderer.invoke('ff:probe', file, hevcOk, preferLang),
  ffConvert: (file, audioIndex, keepOthers, preferLang) => ipcRenderer.invoke('ff:convert', file, audioIndex, keepOthers, preferLang),
  ffDownload: () => ipcRenderer.invoke('ff:download'),
  ffCancel: () => ipcRenderer.invoke('ff:cancel'),
  ffExtractSub: (file, subIndex) => ipcRenderer.invoke('ff:extract-sub', file, subIndex),
  ffSubWindow: (file, fromSec, durSec, preferLang) => ipcRenderer.invoke('ff:sub-window', file, fromSec, durSec, preferLang),
  onFfProgress: (cb) => on('ff:progress', cb),

  // misc
  appInfo: () => ipcRenderer.invoke('app:info'),
  showItem: (file) => ipcRenderer.invoke('shell:show-item', file),
  openLog: () => ipcRenderer.invoke('shell:open-log'),
  log: (line) => ipcRenderer.send('log', String(line))
});
