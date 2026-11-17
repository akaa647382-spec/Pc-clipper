'use strict';
/**
 * How the last run of the app ended, from what it left on the disk. Pure, so it can be tested.
 *
 *   clean     closed on purpose (the "clean-exit" marker)
 *   watchdog  it crashed and the crash watchdog started this instance (--recovered)
 *   shutdown  Windows shut down, restarted or signed out with the app open (the "session-end" marker)
 *   cut       the PC went off without warning: a power cut, an empty battery, the power button held.
 *             Known when the PC has started since the app was last seen running. Also the power
 *             cut test, and "cannot tell" when nothing says when the app was last running.
 *   killed    the app stopped while the PC kept running: ended from Task Manager, or frozen and closed
 *
 * `lastAlive`: the last moment the app was seen running while armed (written every 15 s).
 * `bootedAt`: when the PC started (now minus its uptime).
 */
function classifyLastRun(o) {
  const lastAlive = Number.isFinite(o.lastAlive) && o.lastAlive > 0 ? o.lastAlive : null;
  const shutdownAt = Number.isFinite(o.shutdownAt) ? o.shutdownAt : null;
  const drill = o.drill && Number.isFinite(o.drill.at) && Number.isFinite(o.drill.offMs) ? { at: o.drill.at, offMs: o.drill.offMs } : null;
  let ended;
  if (o.clean) ended = 'clean';
  else if (o.recovered) ended = 'watchdog';
  else if (shutdownAt != null) ended = 'shutdown';
  else if (drill || lastAlive == null || !Number.isFinite(o.bootedAt)) ended = 'cut';
  // The PC has been up since before the app was last seen: it never went off. (A minute of
  // slack: the uptime and the clock are read a moment apart, and the last beat can lag.)
  else ended = o.bootedAt > lastAlive - 60000 ? 'cut' : 'killed';
  return { ended: ended, lastAlive: lastAlive, shutdownAt: shutdownAt, drill: drill };
}

module.exports = { classifyLastRun };
