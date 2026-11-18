'use strict';
// Speed's YouTube: past streams (when each one really started and ended) and "live / scheduled now".
//
// Two ways in:
//   * With a free YouTube Data API key (best): exact start/end of every past stream, and any
//     scheduled stream with its time. About 2 quota units per check; the free daily quota is 10,000.
//   * Without a key: the public /live page is read for "live now" or "scheduled". No history,
//     so predictions need the key. The page layout can change; this is best-effort.
//
// `fetchFn` is injected (global fetch in the app, fakes in tests).

const API = 'https://www.googleapis.com/youtube/v3';
const HANDLE = 'IShowSpeed';
// His channel id, used if the handle lookup fails.
const FALLBACK_CHANNEL_ID = 'UCWsDFcIhY2DBi3GB5uykGXA';

class YouTubeError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function getJson(fetchFn, url) {
  let res;
  try {
    res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new YouTubeError('Could not reach YouTube (' + (e && e.message ? e.message : e) + ').', 'network');
  }
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    /* not JSON */
  }
  if (!res.ok) {
    const reason = body && body.error && body.error.errors && body.error.errors[0] ? body.error.errors[0].reason : '';
    if (res.status === 400 && /keyInvalid|badRequest/i.test(reason + JSON.stringify(body || ''))) throw new YouTubeError('The YouTube API key was not accepted. Check it in Settings.', 'bad-key');
    if (res.status === 403 && /quota/i.test(reason)) throw new YouTubeError('The YouTube daily quota is used up. It resets at midnight Pacific time.', 'quota');
    if (res.status === 403) throw new YouTubeError('YouTube refused the key (' + (reason || 'forbidden') + '). Is "YouTube Data API v3" enabled for it?', 'forbidden');
    throw new YouTubeError('YouTube answered ' + res.status + (reason ? ' (' + reason + ')' : '') + '.', 'http');
  }
  return body;
}

function q(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

/** Channel id + uploads playlist for the handle. */
async function resolveChannel(fetchFn, key, handle = HANDLE) {
  const body = await getJson(fetchFn, API + '/channels?' + q({ part: 'contentDetails,snippet', forHandle: handle, key }));
  const item = body && body.items && body.items[0];
  const id = item ? item.id : FALLBACK_CHANNEL_ID;
  const uploads = item && item.contentDetails && item.contentDetails.relatedPlaylists ? item.contentDetails.relatedPlaylists.uploads : 'UU' + id.slice(2);
  return { id, uploads, title: item && item.snippet ? item.snippet.title : handle };
}

function parseTime(s) {
  const t = Date.parse(s || '');
  return Number.isFinite(t) ? t : null;
}

/** Turns videos.list items into stream records. Only items that are or were live streams. */
function videosToStreams(items) {
  const out = [];
  for (const v of items || []) {
    const d = v.liveStreamingDetails;
    if (!d) continue;
    out.push({
      id: v.id,
      title: v.snippet ? v.snippet.title : '',
      state: v.snippet ? v.snippet.liveBroadcastContent : 'none', // 'live' | 'upcoming' | 'none'
      start: parseTime(d.actualStartTime),
      end: parseTime(d.actualEndTime),
      scheduled: parseTime(d.scheduledStartTime),
    });
  }
  return out;
}

async function videosById(fetchFn, key, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await getJson(fetchFn, API + '/videos?' + q({ part: 'liveStreamingDetails,snippet', id: ids.slice(i, i + 50).join(','), key, maxResults: 50 }));
    out.push(...videosToStreams(body.items));
  }
  return out;
}

/**
 * Past streams, newest first, going back `maxPages` x 50 uploads or until `sinceMs`.
 * Returns { channel, streams: [{id,title,state,start,end,scheduled}], quotaUsed }.
 */
async function fetchHistory(fetchFn, key, opts = {}) {
  const maxPages = opts.maxPages || 20;
  const sinceMs = opts.sinceMs || 0;
  const channel = opts.channel || (await resolveChannel(fetchFn, key));
  let quota = opts.channel ? 0 : 1;
  const streams = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page++) {
    const body = await getJson(fetchFn, API + '/playlistItems?' + q({ part: 'contentDetails', playlistId: channel.uploads, maxResults: 50, pageToken, key }));
    quota++;
    const ids = (body.items || []).map((it) => it.contentDetails && it.contentDetails.videoId).filter(Boolean);
    if (!ids.length) break;
    const vids = await videosById(fetchFn, key, ids);
    quota += Math.ceil(ids.length / 50);
    streams.push(...vids);
    const oldest = (body.items || []).map((it) => parseTime(it.contentDetails.videoPublishedAt)).filter(Boolean).sort((a, b) => a - b)[0];
    if (opts.onProgress) opts.onProgress(streams.filter((s) => s.start).length, page + 1);
    if (!body.nextPageToken || (oldest && oldest < sinceMs)) break;
    pageToken = body.nextPageToken;
  }
  return { channel, streams, quotaUsed: quota };
}

/**
 * Is he live, or is a stream scheduled? Looks at the newest 10 uploads (2 quota units).
 * Returns { live: stream|null, upcoming: stream|null, recent: [...] }.
 */
async function checkNow(fetchFn, key, channel) {
  const ch = channel || (await resolveChannel(fetchFn, key));
  const body = await getJson(fetchFn, API + '/playlistItems?' + q({ part: 'contentDetails', playlistId: ch.uploads, maxResults: 10, key }));
  const ids = (body.items || []).map((it) => it.contentDetails && it.contentDetails.videoId).filter(Boolean);
  const vids = ids.length ? await videosById(fetchFn, key, ids) : [];
  return summarizeNow(vids, ch);
}

function summarizeNow(vids, channel) {
  const live = vids.find((v) => v.state === 'live' || (v.start && !v.end && v.state !== 'none')) || null;
  const now = Date.now();
  const upcoming = vids
    .filter((v) => v.state === 'upcoming' && v.scheduled && v.scheduled > now - 6 * 3600 * 1000)
    .sort((a, b) => a.scheduled - b.scheduled)[0] || null;
  return { live, upcoming, recent: vids, channel };
}

/**
 * No key: read the public /live page. Returns { live, upcoming } with `scheduled` when found.
 */
async function checkNowNoKey(fetchFn, handle = HANDLE) {
  let res;
  try {
    res = await fetchFn('https://www.youtube.com/@' + handle + '/live', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    });
  } catch (e) {
    throw new YouTubeError('Could not reach YouTube (' + (e && e.message ? e.message : e) + ').', 'network');
  }
  if (!res.ok) throw new YouTubeError('YouTube answered ' + res.status + '.', 'http');
  return parseLivePage(await res.text());
}

function parseLivePage(html) {
  const vid = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1] || null;
  const isLive = /"isLiveNow":true/.test(html) || /"isLive":true/.test(html);
  const sched = (html.match(/"scheduledStartTime":"(\d{9,11})"/) || [])[1];
  const isUpcoming = /"isUpcoming":true/.test(html) || (!!sched && !isLive);
  return {
    live: vid && isLive ? { id: vid, state: 'live' } : null,
    upcoming: vid && isUpcoming && sched ? { id: vid, state: 'upcoming', scheduled: Number(sched) * 1000 } : null,
  };
}

/** Merges fresh stream records into the stored list by video id; newest data wins. */
function mergeStreams(stored, fresh) {
  const byId = new Map();
  for (const s of stored || []) byId.set(s.id, s);
  for (const s of fresh || []) byId.set(s.id, Object.assign({}, byId.get(s.id) || {}, s));
  return Array.from(byId.values()).sort((a, b) => (a.start || a.scheduled || 0) - (b.start || b.scheduled || 0));
}

module.exports = {
  resolveChannel,
  fetchHistory,
  checkNow,
  checkNowNoKey,
  parseLivePage,
  videosToStreams,
  summarizeNow,
  mergeStreams,
  YouTubeError,
  HANDLE,
  FALLBACK_CHANNEL_ID,
};
