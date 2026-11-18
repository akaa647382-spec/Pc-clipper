'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Y = require('../../core/youtube.cjs');

function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(url);
    for (const [re, body, status] of routes) {
      if (re.test(url)) {
        return { ok: (status || 200) < 400, status: status || 200, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
      }
    }
    throw new Error('no route for ' + url);
  };
}

const channel = { items: [{ id: 'UCabc', snippet: { title: 'IShowSpeed' }, contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] };
const vid = (id, extra) => Object.assign({ id, snippet: { title: 't' + id, liveBroadcastContent: 'none' } }, extra);

test('history: pages through uploads and keeps only streams', async () => {
  const log = [];
  const f = fakeFetch([
    [/channels\?/, channel],
    [/playlistItems.*pageToken=p2/, { items: [{ contentDetails: { videoId: 'c', videoPublishedAt: '2026-01-01T00:00:00Z' } }] }],
    [/playlistItems/, { nextPageToken: 'p2', items: [{ contentDetails: { videoId: 'a', videoPublishedAt: '2026-03-01T00:00:00Z' } }, { contentDetails: { videoId: 'b', videoPublishedAt: '2026-02-01T00:00:00Z' } }] }],
    [/videos\?.*id=a%2Cb/, { items: [vid('a', { liveStreamingDetails: { actualStartTime: '2026-03-01T20:00:00Z', actualEndTime: '2026-03-01T23:00:00Z', scheduledStartTime: '2026-03-01T19:45:00Z' } }), vid('b')] }],
    [/videos\?.*id=c/, { items: [vid('c', { liveStreamingDetails: { actualStartTime: '2026-01-01T18:00:00Z' } })] }],
  ], log);
  const r = await Y.fetchHistory(f, 'KEY');
  assert.strictEqual(r.channel.uploads, 'UUabc');
  assert.deepStrictEqual(r.streams.map((s) => s.id), ['a', 'c']);
  assert.strictEqual(r.streams[0].start, Date.parse('2026-03-01T20:00:00Z'));
  assert.strictEqual(r.streams[0].scheduled, Date.parse('2026-03-01T19:45:00Z'));
  assert.strictEqual(r.streams[1].end, null);
  assert.strictEqual(r.quotaUsed, 5);
  assert.ok(log.every((u) => u.includes('key=KEY')));
});

test('checkNow: finds live and scheduled streams', async () => {
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const f = fakeFetch([
    [/playlistItems/, { items: [{ contentDetails: { videoId: 'x' } }, { contentDetails: { videoId: 'y' } }] }],
    [/videos\?/, { items: [vid('x', { snippet: { liveBroadcastContent: 'upcoming' }, liveStreamingDetails: { scheduledStartTime: soon } }), vid('y', { liveStreamingDetails: { actualStartTime: '2026-01-01T00:00:00Z', actualEndTime: '2026-01-01T02:00:00Z' } })] }],
  ]);
  const r = await Y.checkNow(f, 'K', { id: 'UCabc', uploads: 'UUabc' });
  assert.strictEqual(r.live, null);
  assert.strictEqual(r.upcoming.id, 'x');
  assert.strictEqual(r.upcoming.scheduled, Date.parse(soon));
});

test('bad key and quota give plain messages', async () => {
  const bad = fakeFetch([[/./, { error: { errors: [{ reason: 'keyInvalid' }] } }, 400]]);
  await assert.rejects(Y.resolveChannel(bad, 'K'), (e) => e.code === 'bad-key');
  const quota = fakeFetch([[/./, { error: { errors: [{ reason: 'quotaExceeded' }] } }, 403]]);
  await assert.rejects(Y.resolveChannel(quota, 'K'), (e) => e.code === 'quota');
});

test('no-key live page parsing', () => {
  const live = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"> ... "isLiveNow":true';
  assert.strictEqual(Y.parseLivePage(live).live.id, 'abcdefghijk');
  const up = '<link rel="canonical" href="https://www.youtube.com/watch?v=abcdefghijk"> "isUpcoming":true,"scheduledStartTime":"1790000000"';
  const r = Y.parseLivePage(up);
  assert.strictEqual(r.live, null);
  assert.strictEqual(r.upcoming.scheduled, 1790000000000);
  assert.deepStrictEqual(Y.parseLivePage('<html>channel page</html>'), { live: null, upcoming: null });
});

test('merge keeps one record per video, newest data wins', () => {
  const m = Y.mergeStreams([{ id: 'a', start: 1, end: null }], [{ id: 'a', start: 1, end: 5 }, { id: 'b', start: 3 }]);
  assert.deepStrictEqual(m, [{ id: 'a', start: 1, end: 5 }, { id: 'b', start: 3 }]);
});
