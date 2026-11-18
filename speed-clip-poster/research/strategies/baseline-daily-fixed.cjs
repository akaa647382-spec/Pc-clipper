'use strict';
// Post one clip every day at a fixed local time (2:30 PM in the given tz).
module.exports = {
  name: 'baseline-daily-fixed-1430',
  describe: 'Post one clip every day at 2:30 PM local time, no matter what.',
  decide(ctx) {
    return ctx.local.hour >= 14.5 && ctx.postsToday === 0;
  },
};
