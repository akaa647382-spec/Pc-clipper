'use strict';
// The app as shipped in 1.0.0: post when predict() says post-now (default settings, no calibration).
const P = require('../../core/predictor.cjs');
module.exports = {
  name: 'baseline-app-model',
  describe: 'App 1.0.0: hazard model by time of week, post when a stream in the next 12 h is >= 50% likely and the lock risk reaches 20%.',
  decide(ctx) {
    const r = P.predict({ now: ctx.now, tz: ctx.tz, streams: ctx.history, liveNow: ctx.live });
    return r.status === 'post-now';
  },
};
