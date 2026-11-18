'use strict';
// NOT a strategy: knows the future. Posts exactly 30 min before each lock. The ceiling for comparison.
const P = require('../core/predictor.cjs');
module.exports = function oracle(streams, lockGapMin = 45) {
  const starts = P.cleanStreams(streams).map((s) => s.start);
  return {
    name: 'oracle-cheats',
    describe: 'Knows when each stream starts; posts 30 min before the lock.',
    decide(ctx) {
      const next = starts.find((s) => s > ctx.now);
      return next && next - lockGapMin * 60000 - ctx.now <= 30 * 60000;
    },
  };
};
