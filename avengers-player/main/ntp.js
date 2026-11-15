'use strict';

/**
 * Internet time for the main process: "how wrong is this PC's clock right now?"
 *
 * The whole point of the app is that the snap lands on real midnight, and a PC clock is easily a
 * few seconds out. measure() asks several public time servers and returns one number the app adds
 * to Date.now() to get true time.
 *
 * Design rules:
 *  - measure() never throws, never rejects and always settles inside overallTimeoutMs. The app
 *    calls it every few minutes for hours, so every socket is closed and every timer is cleared on
 *    every path, including the unhappy ones.
 *  - No single answer is trusted: replies are validated field by field, the servers have to agree
 *    with each other, and the reported uncertainty is a deliberately pessimistic bound.
 *  - Elapsed time comes from the monotonic clock anchored to one Date.now() reading, so Windows
 *    stepping the system clock in the middle of an exchange cannot corrupt the maths.
 *
 * Only Node built-ins are used. "http" is here solely so httpsEndpoints may point at a plain
 * http:// address (the unit tests use a local server); every default endpoint is https.
 */

const dgram = require('dgram');
const dns = require('dns');
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

// ------------------------------------------------------------------------------------------------
// Tunables
// ------------------------------------------------------------------------------------------------

/** Five independent operators, so one company having a bad night cannot fool the vote. */
const DEFAULT_SERVERS = Object.freeze([
  'time.cloudflare.com',
  'time.google.com',
  'time.windows.com',
  'pool.ntp.org',
  'time.apple.com',
]);

/**
 * Only used when UDP port 123 is blocked. "trace" endpoints carry a millisecond timestamp in the
 * body; "date" endpoints only have the one-second Date response header.
 */
const DEFAULT_HTTPS_ENDPOINTS = Object.freeze([
  Object.freeze({ url: 'https://www.cloudflare.com/cdn-cgi/trace', kind: 'trace' }),
  Object.freeze({ url: 'https://www.google.com/generate_204', kind: 'date' }),
  Object.freeze({ url: 'https://www.microsoft.com/', kind: 'date' }),
]);

const DEFAULT_PORT = 123;
const DEFAULT_SAMPLES = 4;
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_OVERALL_TIMEOUT_MS = 6000;

const MAX_SERVERS = 12;
const MAX_SAMPLES = 8; // public servers rate-limit clients that hammer them
const MAX_HTTPS_ENDPOINTS = 6;

/** A server that stays silent twice in a row is treated as unreachable. */
const MAX_SILENT_TRIES = 2;
/**
 * Once a server has answered, later samples only matter if they are faster than the best one, so
 * there is no point waiting the full timeout for them (many pool servers answer the first packet
 * and then rate-limit the rest).
 */
const FOLLOW_UP_MIN_MS = 250;
const FOLLOW_UP_DELAY_FACTOR = 4;

/** With this many servers fully sampled, stragglers get a short grace period and are cut off. */
const DEFAULT_ENOUGH_SERVERS = 3;
const EARLY_STOP_GRACE_MS = 300;

/** Share of the time budget the NTP phase may use when the HTTPS fallback still has to fit. */
const NTP_BUDGET_SHARE = 0.6;

// Agreement rules (see combine()).
const AGREE_FLOOR_MS = 60;
const AGREE_DELAY_FACTOR = 3;
const TWO_SERVER_LIMIT_MS = 250;
const BASE_UNCERTAINTY_MS = 2; // Date.now() granularity plus timer jitter
const SINGLE_SOURCE_PENALTY_MS = 15; // nobody to cross-check against

/** A Date header only has whole seconds: the true instant is anywhere in that second. */
const DATE_HEADER_HALF_STEP_MS = 500;
const DATE_HEADER_MIN_UNCERTAINTY_MS = 600;
const DATE_HEADER_AGREE_MS = 1100;

/** RFC 5905 clients ignore servers whose own error estimate is this bad. */
const MAX_ROOT_DISTANCE_MS = 1500;
/** Server clocks are coarser than ours, so allow a hair of negative round trip before rejecting. */
const DELAY_SLACK_MS = 1;
/**
 * The app was written after this date, so any source claiming an earlier time is broken. A lower
 * bound can never go stale (an upper bound would be a time bomb, so there is none).
 */
const MIN_PLAUSIBLE_TIME_MS = Date.UTC(2024, 0, 1);

const MAX_TRACE_BODY_CHARS = 16 * 1024;
const USER_AGENT = 'AvengersPlayer/1.0 (clock check)';

// SNTP wire format (RFC 4330 / RFC 5905).
const PACKET_BYTES = 48;
const MODE_CLIENT = 3;
const MODE_SERVER = 4;
const CLIENT_VERSION = 4;
const LEAP_UNSYNCHRONISED = 3;
const MAX_STRATUM = 15;
const ORIGINATE_AT = 24;
const RECEIVE_AT = 32;
const TRANSMIT_AT = 40;
const NTP_UNIX_DELTA_S = 2208988800; // 1900-01-01 to 1970-01-01
const NTP_ERA_S = 4294967296; // the 32-bit seconds field wraps every 2^32 s (next: February 2036)
const NTP_ERA_MS = NTP_ERA_S * 1000;
const FRACTION_SCALE = 4294967296;
/**
 * Low bits of our transmit fraction are random. The server has to echo the whole timestamp back,
 * so a reply that was not triggered by this exact request (late, duplicated or forged) is
 * recognised. The top 10 bits still carry the real time to about a millisecond.
 */
const NONCE_BITS = 22;
const NONCE_RANGE = 1 << NONCE_BITS;

const STOP_NO_REPLY = 'no reply in time';
const STOP_ENOUGH = 'no reply yet (stopped early: enough servers answered)';
const STOP_NOT_NEEDED = 'not needed';

const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i;
const TRACE_PATH_PATTERN = /\/cdn-cgi\/trace$/;
const TRACE_TS_PATTERN = /^ts=(\d{9,11})(?:\.(\d{1,9}))?[ \t\r]*$/m;
const HTTP_DATE_PATTERN = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------

function noop() {}

const round3 = (x) => Math.round(x * 1000) / 1000;
const ceil3 = (x) => Math.ceil(x * 1000 - 1e-6) / 1000;

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A short, single-line reason that is safe to show in a diagnostics list. */
function errorText(err) {
  if (err && typeof err.code === 'string' && err.code) return err.code;
  const message = err && err.message ? String(err.message) : String(err);
  return message.replace(/\s+/g, ' ').trim().slice(0, 80) || 'unknown error';
}

function pickInt(value, min, max, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function shortLabel(value) {
  let text;
  try {
    text = String(value);
  } catch (_) {
    text = '';
  }
  return text.trim().slice(0, 80) || '(empty)';
}

/**
 * Wall-clock time that advances with the monotonic clock. Date.now() can jump (Windows time sync,
 * the user fixing the clock); performance.now() cannot, so intervals measured with this are safe.
 */
function createClock() {
  const wallAtStart = Date.now();
  const monoAtStart = performance.now();
  return { now: () => wallAtStart + (performance.now() - monoAtStart) };
}

/**
 * A minimal cancel signal. AbortSignal would work too, but it warns once more than ten waiters
 * are attached, which a dozen servers can exceed.
 */
function createCancelToken() {
  const listeners = new Set();
  let reason = null;
  return {
    get cancelled() {
      return reason !== null;
    },
    get reason() {
      return reason;
    },
    cancel(why) {
      if (reason !== null) return;
      reason = String(why || 'cancelled');
      const waiting = Array.from(listeners);
      listeners.clear();
      for (const listener of waiting) {
        try {
          listener(reason);
        } catch (_) {
          // One misbehaving waiter must not stop the others from being released.
        }
      }
    },
    /** Calls listener(reason) once on cancel (at once if already cancelled); returns an unsubscribe. */
    onCancel(listener) {
      if (reason !== null) {
        listener(reason);
        return noop;
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function emptyEntry(host) {
  return { host, ok: false, offsetMs: null, delayMs: null, stratum: null, error: null };
}

function failedEntry(host, error) {
  return Object.assign(emptyEntry(host), { error });
}

// ------------------------------------------------------------------------------------------------
// SNTP packets
// ------------------------------------------------------------------------------------------------

/** Unix epoch ms -> the 32.32 fixed-point NTP timestamp (seconds wrap at the era boundary). */
function unixMsToNtp(ms) {
  const wholeSeconds = Math.floor(ms / 1000);
  const fraction = Math.min(0xFFFFFFFF,
    Math.floor(((ms - wholeSeconds * 1000) / 1000) * FRACTION_SCALE));
  const seconds = (((wholeSeconds + NTP_UNIX_DELTA_S) % NTP_ERA_S) + NTP_ERA_S) % NTP_ERA_S;
  return { seconds, fraction };
}

/**
 * NTP timestamp -> Unix epoch ms. The seconds field is only 32 bits and wraps in February 2036,
 * so the timestamp alone is ambiguous by multiples of ~136 years. We pick the era that puts it
 * closest to pivotMs (our own clock), which is right as long as the PC is less than 68 years out.
 */
function ntpToUnixMs(seconds, fraction, pivotMs) {
  const inEraZero = (seconds - NTP_UNIX_DELTA_S) * 1000 + (fraction / FRACTION_SCALE) * 1000;
  const pivot = Number.isFinite(pivotMs) ? pivotMs : Date.now();
  const era = Math.round((pivot - inEraZero) / NTP_ERA_MS);
  return inEraZero + era * NTP_ERA_MS;
}

function randomNonce() {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    return webCrypto.getRandomValues(new Uint32Array(1))[0] % NONCE_RANGE;
  }
  return Math.floor(Math.random() * NONCE_RANGE);
}

/**
 * Builds the 48-byte client request. Everything is zero except the first byte and the transmit
 * timestamp, which doubles as a nonce (see NONCE_BITS).
 * opts: { nowMs (default Date.now()), nonce (integer, default random) }
 */
function buildPacket(opts) {
  const o = opts || {};
  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  const nonce = Number.isInteger(o.nonce) ? ((o.nonce % NONCE_RANGE) + NONCE_RANGE) % NONCE_RANGE
    : randomNonce();
  const stamp = unixMsToNtp(nowMs);
  let fraction = Math.floor(stamp.fraction / NONCE_RANGE) * NONCE_RANGE + nonce;
  // An all-zero transmit timestamp means "not set" on the wire, and servers may ignore it.
  if (stamp.seconds === 0 && fraction === 0) fraction = 1;
  const packet = Buffer.alloc(PACKET_BYTES);
  packet[0] = (CLIENT_VERSION << 3) | MODE_CLIENT; // leap indicator 0
  packet.writeUInt32BE(stamp.seconds, TRANSMIT_AT);
  packet.writeUInt32BE(fraction, TRANSMIT_AT + 4);
  return packet;
}

/** True when the reply's originate field repeats the transmit timestamp of our request. */
function echoesRequest(reply, request) {
  return Buffer.isBuffer(reply) && Buffer.isBuffer(request) &&
    reply.length >= PACKET_BYTES && request.length >= PACKET_BYTES &&
    reply.compare(request, TRANSMIT_AT, TRANSMIT_AT + 8, ORIGINATE_AT, ORIGINATE_AT + 8) === 0;
}

function isZeroTimestamp(packet, at) {
  return packet.readUInt32BE(at) === 0 && packet.readUInt32BE(at + 4) === 0;
}

/** Kiss-of-death packets carry a four-letter reason (RATE, DENY, ...) where the reference id is. */
function kissCode(packet) {
  const code = packet.toString('latin1', 12, 16).replace(/[^A-Za-z0-9]/g, '');
  return code || 'no code';
}

/**
 * Validates and decodes a server reply. Never throws: returns { ok: false, error } for anything
 * that is not a usable answer.
 * opts: { request (the Buffer we sent: enables the originate check), pivotMs (see ntpToUnixMs) }
 */
function parsePacket(buffer, opts) {
  const o = opts || {};
  if (!Buffer.isBuffer(buffer)) return { ok: false, error: 'not a packet' };
  if (buffer.length < PACKET_BYTES) return { ok: false, error: 'short packet' };

  const header = {
    leap: buffer[0] >> 6,
    version: (buffer[0] >> 3) & 7,
    mode: buffer[0] & 7,
    stratum: buffer[1],
    // Root delay is signed in NTPv3; a slightly negative value must not look like 18 hours.
    rootDelayMs: (Math.abs(buffer.readInt32BE(4)) / 65536) * 1000,
    rootDispersionMs: (buffer.readUInt32BE(8) / 65536) * 1000,
  };
  const reject = (error) => Object.assign({ ok: false, error }, header);

  if (header.mode !== MODE_SERVER) return reject('wrong mode ' + header.mode);
  if (header.version !== 3 && header.version !== 4) {
    return reject('unsupported version ' + header.version);
  }
  if (o.request !== undefined && !echoesRequest(buffer, o.request)) {
    return reject('originate mismatch');
  }
  // Stratum 0 is the server telling us to go away; check it before the leap bits because
  // kiss-of-death packets usually set "unsynchronised" as well and this reason is more useful.
  if (header.stratum === 0) return reject('kiss-of-death ' + kissCode(buffer));
  if (header.stratum > MAX_STRATUM) return reject('bad stratum ' + header.stratum);
  if (header.leap === LEAP_UNSYNCHRONISED) return reject('server not synchronised');
  if (isZeroTimestamp(buffer, TRANSMIT_AT)) return reject('zero transmit timestamp');
  if (isZeroTimestamp(buffer, RECEIVE_AT)) return reject('zero receive timestamp');
  if (header.rootDelayMs / 2 + header.rootDispersionMs > MAX_ROOT_DISTANCE_MS) {
    return reject('server unsure of its own time');
  }

  const receiveMs = ntpToUnixMs(buffer.readUInt32BE(RECEIVE_AT),
    buffer.readUInt32BE(RECEIVE_AT + 4), o.pivotMs);
  const transmitMs = ntpToUnixMs(buffer.readUInt32BE(TRANSMIT_AT),
    buffer.readUInt32BE(TRANSMIT_AT + 4), o.pivotMs);
  if (transmitMs < receiveMs) return reject('inconsistent timestamps');

  return Object.assign({ ok: true, error: null }, header, { receiveMs, transmitMs });
}

/**
 * Turns one validated reply into an offset and a round-trip delay.
 * sentAt (t1) and receivedAt (t4) are ours; receive (t2) and transmit (t3) are the server's.
 */
function readSample(message, request, sentAt, receivedAt) {
  const reply = parsePacket(message, { request, pivotMs: receivedAt });
  if (!reply.ok) return { ok: false, error: reply.error, final: true };
  const delayMs = (receivedAt - sentAt) - (reply.transmitMs - reply.receiveMs);
  // A server that claims to have held the packet longer than the whole round trip is lying.
  if (delayMs < -DELAY_SLACK_MS) return { ok: false, error: 'inconsistent timestamps', final: true };
  if (reply.transmitMs < MIN_PLAUSIBLE_TIME_MS) {
    return { ok: false, error: 'implausible server time', final: true };
  }
  return {
    ok: true,
    offsetMs: ((reply.receiveMs - sentAt) + (reply.transmitMs - receivedAt)) / 2,
    delayMs: Math.max(0, delayMs),
    stratum: reply.stratum,
  };
}

// ------------------------------------------------------------------------------------------------
// Name lookup
// ------------------------------------------------------------------------------------------------

/**
 * Lookups still in flight on the system resolver, by host name. dns.lookup cannot be cancelled
 * and can take far longer than our timeout when the network is down, so without this every
 * measure() call would queue another batch behind the stuck ones.
 */
const pendingLookups = new Map();

function callLookup(lookup, hostname) {
  return new Promise((resolve, reject) => {
    lookup(hostname, { family: 4 }, (err, found) => {
      if (err) return reject(err);
      const first = Array.isArray(found) ? found[0] : found;
      const address = first && typeof first === 'object' ? first.address : first;
      if (typeof address !== 'string' || !IPV4_PATTERN.test(address)) {
        return reject(new Error('no IPv4 address'));
      }
      return resolve(address);
    });
  });
}

function sharedLookup(hostname, lookup) {
  if (lookup !== dns.lookup) return callLookup(lookup, hostname);
  const key = hostname.toLowerCase();
  let pending = pendingLookups.get(key);
  if (!pending) {
    pending = callLookup(lookup, hostname);
    pendingLookups.set(key, pending);
    const forget = () => {
      pendingLookups.delete(key);
    };
    pending.then(forget, forget);
  }
  return pending;
}

/** Host name -> IPv4 address, giving up after timeoutMs or when the token is cancelled. */
function resolveIpv4(hostname, lookup, timeoutMs, token) {
  if (IPV4_PATTERN.test(hostname)) return Promise.resolve(hostname);
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = noop;
    let timer = null;
    const settle = (deliver, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      deliver(value);
    };
    timer = setTimeout(() => settle(reject, new Error('timeout')), timeoutMs);
    unsubscribe = token.onCancel((why) => settle(reject, new Error(why)));
    if (settled) return;
    sharedLookup(hostname, lookup).then(
      (address) => settle(resolve, address),
      (err) => settle(reject, err));
  });
}

// ------------------------------------------------------------------------------------------------
// One SNTP server
// ------------------------------------------------------------------------------------------------

function closeQuietly(socket) {
  try {
    socket.close();
  } catch (_) {
    // Already closed.
  }
}

/**
 * Opens an IPv4 UDP socket that is already bound. Binding up front keeps the (asynchronous)
 * implicit bind out of the first sample's round-trip time.
 */
function openSocket() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    // Permanent listener: an 'error' event with nobody listening would crash the main process.
    socket.on('error', noop);
    const onError = (err) => {
      socket.removeListener('listening', onListening);
      closeQuietly(socket);
      reject(err);
    };
    const onListening = () => {
      socket.removeListener('error', onError);
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('listening', onListening);
    try {
      socket.bind(0);
    } catch (err) {
      onError(err);
    }
  });
}

/**
 * One request/reply exchange. Resolves (never rejects) with a sample, or with
 * { ok: false, error, final } where final means "do not bother asking this server again".
 */
function exchange(socket, peer, timeoutMs, clock, token) {
  return new Promise((resolve) => {
    const request = buildPacket({ nowMs: clock.now() });
    let sentAt = 0;
    let ignored = '';
    let settled = false;
    let timer = null;
    let unsubscribe = noop;

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onError);
      resolve(outcome);
    };
    const onMessage = (message, rinfo) => {
      const receivedAt = clock.now(); // first statement: anything before it inflates the delay
      if (rinfo.address !== peer.address || rinfo.port !== peer.port) {
        ignored = 'reply from unexpected address';
        return;
      }
      // Not an answer to this request (a late reply to an earlier sample, a duplicate or a
      // forgery). Keep waiting: the real answer may still be on its way.
      if (!echoesRequest(message, request)) {
        ignored = parsePacket(message, { request }).error || 'unexpected packet';
        return;
      }
      finish(readSample(message, request, sentAt, receivedAt));
    };
    const onError = (err) => finish({ ok: false, error: 'socket: ' + errorText(err), final: true });

    timer = setTimeout(() => finish({
      ok: false,
      error: ignored ? 'timeout (ignored: ' + ignored + ')' : 'timeout',
      final: false,
    }), timeoutMs);
    unsubscribe = token.onCancel((why) => finish({ ok: false, error: why, final: true }));
    if (settled) return;

    socket.on('message', onMessage);
    socket.on('error', onError);
    // Read the clock before sending so [sentAt, receivedAt] always brackets the real exchange;
    // that is what makes delay / 2 a true bound on the error.
    sentAt = clock.now();
    try {
      socket.send(request, peer.port, peer.address, (err) => {
        if (err) finish({ ok: false, error: 'send: ' + errorText(err), final: true });
      });
    } catch (err) {
      finish({ ok: false, error: 'send: ' + errorText(err), final: true });
    }
  });
}

function followUpTimeout(bestDelayMs, timeoutMs) {
  return Math.min(timeoutMs, Math.max(FOLLOW_UP_MIN_MS, FOLLOW_UP_DELAY_FACTOR * bestDelayMs));
}

/** Takes up to cfg.samples samples from one address and keeps the one with the shortest delay. */
async function collectSamples(socket, peer, cfg, clock, token) {
  let best = null;
  let good = 0;
  let silentTries = 0;
  let lastError = 'no reply';
  for (let i = 0; i < cfg.samples; i++) {
    if (token.cancelled) {
      lastError = token.reason;
      break;
    }
    const timeoutMs = best ? followUpTimeout(best.delayMs, cfg.timeoutMs) : cfg.timeoutMs;
    const outcome = await exchange(socket, peer, timeoutMs, clock, token);
    if (outcome.ok) {
      good++;
      silentTries = 0;
      if (!best || outcome.delayMs < best.delayMs) best = outcome;
      continue;
    }
    lastError = outcome.error;
    if (outcome.final) break;
    // It answered before and is silent now: rate limiting or a lost packet. What we have is fine.
    if (best) break;
    if (++silentTries >= MAX_SILENT_TRIES) break;
  }
  return { best, good, lastError };
}

/**
 * Measures against one server. Resolves (never rejects) with an entry whose offset is relative
 * to `clock`, plus `address` and `samples` (number of good samples) for diagnostics.
 */
async function sampleServer(target, cfg, clock, token) {
  const entry = Object.assign(emptyEntry(target.label), { address: null, samples: 0 });
  if (target.error) return Object.assign(entry, { error: target.error });
  let socket = null;
  try {
    if (token.cancelled) return Object.assign(entry, { error: token.reason });
    try {
      entry.address = await resolveIpv4(target.hostname, cfg.lookup, cfg.timeoutMs, token);
    } catch (err) {
      return Object.assign(entry, { error: token.cancelled ? token.reason : 'dns: ' + errorText(err) });
    }
    try {
      socket = await openSocket();
    } catch (err) {
      return Object.assign(entry, { error: 'socket: ' + errorText(err) });
    }
    const peer = { address: entry.address, port: target.port };
    const { best, good, lastError } = await collectSamples(socket, peer, cfg, clock, token);
    entry.samples = good;
    if (!best) return Object.assign(entry, { error: lastError });
    return Object.assign(entry, {
      ok: true, offsetMs: best.offsetMs, delayMs: best.delayMs, stratum: best.stratum,
    });
  } catch (err) {
    return Object.assign(entry, { ok: false, error: 'internal error: ' + errorText(err) });
  } finally {
    if (socket) closeQuietly(socket);
  }
}

// ------------------------------------------------------------------------------------------------
// Agreement between sources
// ------------------------------------------------------------------------------------------------

function isUsable(entry) {
  return Boolean(entry) && entry.ok === true && Number.isFinite(entry.offsetMs) &&
    Number.isFinite(entry.delayMs) && entry.delayMs >= 0;
}

function lowestDelay(entries) {
  return entries.reduce((best, entry) => (entry.delayMs < best.delayMs ? entry : best));
}

function offsetSpread(entries) {
  const offsets = entries.map((entry) => entry.offsetMs);
  return Math.max.apply(null, offsets) - Math.min.apply(null, offsets);
}

/**
 * Splits samples into those that agree with the median offset and the outliers.
 * The answer is only accepted when a strict majority agrees: with three servers reading 0, 500
 * and 1000 ms the median "agrees with itself", but nobody actually confirmed it.
 */
function splitByAgreement(samples, toleranceFor, pairLimitMs) {
  const spreadMs = offsetSpread(samples);
  if (samples.length === 2 && spreadMs > pairLimitMs) {
    return {
      ok: false,
      agreeing: [],
      outliers: [],
      error: 'two sources disagree by ' + Math.round(spreadMs) + ' ms',
    };
  }
  const middle = median(samples.map((sample) => sample.offsetMs));
  const agreeing = [];
  const outliers = [];
  for (const sample of samples) {
    const off = Math.abs(sample.offsetMs - middle);
    (off <= toleranceFor(sample) ? agreeing : outliers).push(sample);
  }
  if (agreeing.length * 2 <= samples.length) {
    return {
      ok: false,
      agreeing: [],
      outliers: [],
      error: 'sources disagree (' + samples.length + ' answered, ' + Math.round(spreadMs) +
        ' ms apart)',
    };
  }
  return { ok: true, agreeing, outliers, error: null };
}

function noAnswer(error) {
  return {
    ok: false, offsetMs: 0, uncertaintyMs: Infinity, host: null, agreeing: 0, outliers: [], error,
  };
}

function ntpTolerance(sample) {
  return Math.max(AGREE_FLOOR_MS, AGREE_DELAY_FACTOR * sample.delayMs);
}

/**
 * Combines per-server results into one answer.
 *  - Servers further from the median offset than max(60 ms, 3 x their delay) are outliers.
 *  - A strict majority of the servers that answered has to agree, and two servers that are more
 *    than 250 ms apart (with no third to break the tie) are never trusted.
 *  - The answer is the agreeing server with the shortest round trip, because half the round trip
 *    is the hard limit on how wrong a sample can be.
 *  - uncertainty = that delay / 2 + half the spread of the agreeing offsets + 2 ms, plus 15 ms
 *    when only one server answered at all.
 * The input is not modified. `outliers` holds the rejected input entries.
 */
function combine(serverResults) {
  const usable = (Array.isArray(serverResults) ? serverResults : []).filter(isUsable);
  if (usable.length === 0) return noAnswer('no time server answered');
  const split = splitByAgreement(usable, ntpTolerance, TWO_SERVER_LIMIT_MS);
  if (!split.ok) return noAnswer(split.error);
  const best = lowestDelay(split.agreeing);
  const lonely = usable.length === 1 ? SINGLE_SOURCE_PENALTY_MS : 0;
  return {
    ok: true,
    offsetMs: best.offsetMs,
    uncertaintyMs: best.delayMs / 2 + offsetSpread(split.agreeing) / 2 + BASE_UNCERTAINTY_MS + lonely,
    host: best.host === undefined ? null : best.host,
    agreeing: split.agreeing.length,
    outliers: split.outliers,
    error: null,
  };
}

/**
 * Same idea for the HTTPS fallback. Millisecond ("ts") samples are treated like time servers.
 * Date headers are a last resort: they only have whole seconds, so the estimate is the middle of
 * that second and the uncertainty is never reported below 600 ms.
 */
function combineHttp(entries) {
  const usable = entries.filter(isUsable);
  const precise = usable.filter((entry) => entry.kind === 'ts');
  if (precise.length > 0) return combine(precise);
  const coarse = usable.filter((entry) => entry.kind === 'date');
  if (coarse.length === 0) return noAnswer('no internet time source answered');
  // Two honest Date headers can differ by a full second plus both round trips.
  const slowest = Math.max.apply(null, coarse.map((entry) => entry.delayMs));
  const split = splitByAgreement(coarse, () => DATE_HEADER_AGREE_MS + slowest, Infinity);
  if (!split.ok) return noAnswer(split.error);
  const best = lowestDelay(split.agreeing);
  return {
    ok: true,
    offsetMs: best.offsetMs,
    uncertaintyMs: Math.max(DATE_HEADER_MIN_UNCERTAINTY_MS,
      DATE_HEADER_HALF_STEP_MS + best.delayMs / 2 + BASE_UNCERTAINTY_MS),
    host: best.host,
    agreeing: split.agreeing.length,
    outliers: split.outliers,
    error: null,
  };
}

/** Flags rejected sources so the per-server list explains itself. Only called when a majority agreed. */
function markOutliers(verdict) {
  for (const entry of verdict.outliers) {
    const offBy = Math.round(entry.offsetMs - verdict.offsetMs);
    entry.ok = false;
    entry.error = 'outlier: ' + (offBy > 0 ? '+' : '') + offBy + ' ms away from the other sources';
  }
}

// ------------------------------------------------------------------------------------------------
// HTTPS fallback
// ------------------------------------------------------------------------------------------------

/** Finds "ts=1700000000.123" (epoch seconds) in a /cdn-cgi/trace body. Returns epoch ms or NaN. */
function parseTraceTimestamp(text) {
  const match = TRACE_TS_PATTERN.exec(typeof text === 'string' ? text : '');
  if (!match) return NaN;
  // Read the decimals as whole microseconds: "0.123" * 1000 is not exactly 123 in floating point.
  const micros = Number(((match[2] || '') + '000000').slice(0, 6));
  return Number(match[1]) * 1000 + micros / 1000;
}

/**
 * Strict parser for the HTTP Date header ("Sun, 15 Nov 2026 18:42:00 GMT"). Date.parse alone
 * would quietly read other shapes in local time. Returns epoch ms or NaN.
 */
function parseHttpDate(value) {
  if (typeof value !== 'string' || !HTTP_DATE_PATTERN.test(value)) return NaN;
  return Date.parse(value);
}

/** A response that sat in a cache carries the time it was generated, not the time now. */
function cameFromCache(headers) {
  const age = Number(headers.age);
  return Number.isFinite(age) && age > 0;
}

function dateHeaderSample(headers, midpoint, roundTripMs) {
  const dateMs = parseHttpDate(headers.date);
  if (!Number.isFinite(dateMs)) return { error: 'no usable Date header' };
  if (dateMs < MIN_PLAUSIBLE_TIME_MS) return { error: 'implausible server time' };
  return {
    ok: true,
    kind: 'date',
    offsetMs: dateMs + DATE_HEADER_HALF_STEP_MS - midpoint,
    delayMs: roundTripMs,
  };
}

function traceSample(statusCode, body, headers, midpoint, roundTripMs) {
  const stampMs = statusCode === 200 ? parseTraceTimestamp(body) : NaN;
  if (Number.isFinite(stampMs) && stampMs >= MIN_PLAUSIBLE_TIME_MS) {
    return { ok: true, kind: 'ts', offsetMs: stampMs - midpoint, delayMs: roundTripMs };
  }
  // The page changed shape or an error page came back: its Date header is still worth something.
  return dateHeaderSample(headers, midpoint, roundTripMs);
}

/**
 * Asks one web server for the time. Resolves (never rejects) with an entry; `kind` says whether
 * it came from a millisecond timestamp ('ts') or a Date header ('date').
 */
function queryHttpTime(endpoint, timeoutMs, clock, token) {
  return new Promise((resolve) => {
    const entry = Object.assign(emptyEntry(endpoint.host), { kind: null });
    if (endpoint.error) {
      resolve(Object.assign(entry, { error: endpoint.error }));
      return;
    }
    const secure = endpoint.url.protocol === 'https:';
    const startedAt = clock.now();
    let sentAt = null;
    let request = null;
    let settled = false;
    let timer = null;
    let unsubscribe = noop;

    const finish = (patch) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      // Dropping the connection outright guarantees nothing lingers between measurements.
      if (request) request.destroy();
      resolve(Object.assign(entry, patch));
    };

    // Same wording as the overall stop: the two fire at the same moment and either may win.
    timer = setTimeout(() => finish({ error: STOP_NO_REPLY }), timeoutMs);
    unsubscribe = token.onCancel((why) => finish({ error: why }));
    if (settled) return;

    try {
      request = (secure ? https : http).request(endpoint.url, {
        method: endpoint.kind === 'trace' ? 'GET' : 'HEAD',
        agent: false, // a fresh connection every time: no pooled socket outlives the call
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Cache-Control': 'no-cache' },
      });
    } catch (err) {
      finish({ error: errorText(err) });
      return;
    }
    // Still listening after we are done, on purpose: destroy() above can emit a late 'error'.
    request.on('error', (err) => finish({ error: errorText(err) }));
    request.on('socket', (socket) => {
      // The connection (and TLS) handshake takes several round trips; the clock exchange only
      // starts once the request can actually leave, so that is when the stopwatch starts.
      const markSent = () => {
        if (sentAt === null) sentAt = clock.now();
      };
      if (socket.connecting || socket.secureConnecting === true) {
        socket.once(secure ? 'secureConnect' : 'connect', markSent);
      } else {
        markSent();
      }
    });
    request.on('response', (response) => {
      const receivedAt = clock.now();
      const leftAt = sentAt === null ? startedAt : sentAt;
      const roundTripMs = receivedAt - leftAt;
      const midpoint = leftAt + roundTripMs / 2;
      if (cameFromCache(response.headers)) {
        finish({ error: 'cached response' });
        return;
      }
      if (endpoint.kind !== 'trace') {
        finish(dateHeaderSample(response.headers, midpoint, roundTripMs));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_TRACE_BODY_CHARS) finish({ error: 'response too large' });
      });
      response.on('error', (err) => finish({ error: errorText(err) }));
      response.on('end', () => finish(
        traceSample(response.statusCode, body, response.headers, midpoint, roundTripMs)));
    });
    request.end();
  });
}

// ------------------------------------------------------------------------------------------------
// Options
// ------------------------------------------------------------------------------------------------

/** "host" or "host:port" -> { label, hostname, port } or { label, error }. */
function parseServer(spec, defaultPort) {
  const label = shortLabel(spec);
  if (typeof spec !== 'string' || !spec.trim()) return { label, error: 'invalid server name' };
  const text = spec.trim();
  if (text.startsWith('[') || text.split(':').length > 2) {
    return { label, error: 'IPv6 addresses are not supported' };
  }
  const [hostname, portText] = text.split(':');
  let port = defaultPort;
  if (portText !== undefined) {
    port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
    if (!isPort(port)) return { label, error: 'invalid port' };
  }
  if (!HOSTNAME_PATTERN.test(hostname)) return { label, error: 'invalid server name' };
  return { label, hostname, port, error: null };
}

function parseServers(list, defaultPort) {
  const source = Array.isArray(list) && list.length > 0 ? list : DEFAULT_SERVERS;
  const seen = new Set();
  const targets = [];
  for (const spec of source) {
    const target = parseServer(spec, defaultPort);
    // Asking the same server twice would give it two votes.
    const key = target.error ? 'invalid ' + target.label
      : target.hostname.toLowerCase() + ':' + target.port;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(target);
    if (targets.length >= MAX_SERVERS) break;
  }
  return targets;
}

/** URL string or { url, kind: 'trace' | 'date' } -> { host, url, kind } or { host, error }. */
function parseEndpoint(spec) {
  const raw = typeof spec === 'string' ? spec : (spec && typeof spec.url === 'string' ? spec.url : '');
  let url;
  try {
    url = new URL(raw.trim());
  } catch (_) {
    return { host: shortLabel(raw || spec), error: 'invalid address' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { host: shortLabel(raw), error: 'unsupported protocol' };
  }
  const wanted = spec && typeof spec === 'object' ? spec.kind : undefined;
  const guessed = TRACE_PATH_PATTERN.test(url.pathname) ? 'trace' : 'date';
  return {
    host: url.host,
    url,
    kind: wanted === 'trace' || wanted === 'date' ? wanted : guessed,
    error: null,
  };
}

function parseEndpoints(list) {
  const source = Array.isArray(list) && list.length > 0 ? list : DEFAULT_HTTPS_ENDPOINTS;
  return source.slice(0, MAX_HTTPS_ENDPOINTS).map(parseEndpoint);
}

/**
 * Bad options must never stop the clock check: wrong types fall back to the defaults and
 * out-of-range numbers are clamped.
 */
function normaliseOptions(opts) {
  const o = opts !== null && typeof opts === 'object' ? opts : {};
  const port = isPort(o.port) ? o.port : DEFAULT_PORT;
  const timeoutMs = pickInt(o.timeoutMs, 50, 30000, DEFAULT_TIMEOUT_MS);
  const overallTimeoutMs = pickInt(o.overallTimeoutMs, 250, 120000, DEFAULT_OVERALL_TIMEOUT_MS);
  const httpsFallback = o.httpsFallback !== false;
  // Stop a little early so the bookkeeping after the last cancel still fits inside the promise.
  const margin = Math.min(200, Math.max(25, overallTimeoutMs * 0.1));
  const softStopMs = overallTimeoutMs - margin;
  return {
    targets: parseServers(o.servers, port),
    samples: pickInt(o.samples, 1, MAX_SAMPLES, DEFAULT_SAMPLES),
    timeoutMs,
    overallTimeoutMs,
    httpsFallback,
    endpoints: httpsFallback ? parseEndpoints(o.httpsEndpoints) : [],
    lookup: typeof o.lookup === 'function' ? o.lookup : dns.lookup,
    enoughServers: pickInt(o.enoughServers, 2, MAX_SERVERS, DEFAULT_ENOUGH_SERVERS),
    softStopMs,
    hardStopMs: overallTimeoutMs - margin / 4,
    ntpBudgetMs: httpsFallback ? Math.round(softStopMs * NTP_BUDGET_SHARE) : softStopMs,
  };
}

function safeOptions(opts) {
  try {
    return normaliseOptions(opts);
  } catch (_) {
    // For example a getter that throws. The defaults always work.
    return normaliseOptions(null);
  }
}

// ------------------------------------------------------------------------------------------------
// measure()
// ------------------------------------------------------------------------------------------------

/** All servers in parallel. Stops waiting for stragglers once enough servers are fully sampled. */
async function runNtpPhase(cfg, clock, token) {
  let finished = 0;
  let answered = 0;
  let graceTimer = null;
  const budgetTimer = setTimeout(() => token.cancel(STOP_NO_REPLY), cfg.ntpBudgetMs);
  const noteFinished = (entry) => {
    finished++;
    if (entry.ok) answered++;
    const othersPending = finished < cfg.targets.length;
    if (othersPending && answered >= cfg.enoughServers && graceTimer === null) {
      graceTimer = setTimeout(() => token.cancel(STOP_ENOUGH), EARLY_STOP_GRACE_MS);
    }
    return entry;
  };
  try {
    return await Promise.all(cfg.targets.map(
      (target) => sampleServer(target, cfg, clock, token).then(noteFinished)));
  } finally {
    clearTimeout(budgetTimer);
    clearTimeout(graceTimer);
  }
}

/** All endpoints in parallel; a millisecond-grade answer ends the wait for the coarse ones. */
function runHttpsPhase(cfg, clock, token, startedAt) {
  const timeoutMs = Math.max(1, cfg.softStopMs - (performance.now() - startedAt));
  const stopWhenPrecise = (entry) => {
    if (entry.ok && entry.kind === 'ts') token.cancel(STOP_NOT_NEEDED);
    return entry;
  };
  return Promise.all(cfg.endpoints.map(
    (endpoint) => queryHttpTime(endpoint, timeoutMs, clock, token).then(stopWhenPrecise)));
}

async function runPhases(cfg, clock, tokens, startedAt) {
  const ntpEntries = await runNtpPhase(cfg, clock, tokens.ntp);
  const ntpVerdict = combine(ntpEntries);
  // The web fallback is for networks that block NTP. If time servers did answer but could not
  // agree, a coarser source is not going to settle it.
  const someoneAnswered = ntpEntries.some((entry) => entry.ok);
  if (ntpVerdict.ok || someoneAnswered || !cfg.httpsFallback) {
    if (ntpVerdict.ok) markOutliers(ntpVerdict);
    return { method: 'ntp', verdict: ntpVerdict, servers: ntpEntries };
  }
  const httpEntries = await runHttpsPhase(cfg, clock, tokens.https, startedAt);
  const httpVerdict = combineHttp(httpEntries);
  if (httpVerdict.ok) markOutliers(httpVerdict);
  return { method: 'https', verdict: httpVerdict, servers: ntpEntries.concat(httpEntries) };
}

function publicEntry(entry, stepMs) {
  const measured = Number.isFinite(entry.offsetMs) && Number.isFinite(entry.delayMs);
  const ok = entry.ok === true && measured;
  return {
    host: entry.host,
    ok,
    offsetMs: measured ? round3(entry.offsetMs - stepMs) : null,
    delayMs: measured ? round3(entry.delayMs) : null,
    stratum: Number.isInteger(entry.stratum) ? entry.stratum : null,
    error: ok ? null : (entry.error || 'failed'),
  };
}

/**
 * Shapes the public result. Offsets were measured against `clock`; if Date.now() jumped while we
 * were measuring, the jump is removed here so the result is right for Date.now() as it is now.
 */
function buildResult(outcome, clock) {
  const at = Date.now();
  const stepMs = at - clock.now();
  const verdict = outcome.verdict;
  const ok = verdict.ok === true && Number.isFinite(verdict.offsetMs) &&
    Number.isFinite(verdict.uncertaintyMs);
  return {
    ok,
    offsetMs: ok ? round3(verdict.offsetMs - stepMs) : 0,
    uncertaintyMs: ok ? ceil3(verdict.uncertaintyMs) : Infinity,
    method: ok ? outcome.method : 'none',
    servers: outcome.servers.map((entry) => publicEntry(entry, stepMs)),
    at,
    error: ok ? null : (verdict.error || 'no internet time available'),
  };
}

/**
 * Measures how far this PC's clock is from true time.
 *
 * Resolves with:
 *   { ok, offsetMs, uncertaintyMs, method: 'ntp' | 'https' | 'none', servers: [...], at, error }
 * where offsetMs = trueTime - Date.now() (0 when !ok), uncertaintyMs is a conservative +/- bound
 * (Infinity when !ok), method is 'none' exactly when !ok, each servers entry is
 * { host, ok, offsetMs, delayMs, stratum, error } and error is a short reason (null when ok).
 *
 * opts (all optional): servers (host or host:port strings), port, samples, timeoutMs,
 * httpsFallback, httpsEndpoints (URL strings or { url, kind: 'trace' | 'date' }),
 * overallTimeoutMs, plus two knobs meant for tests and unusual setups: lookup (same signature as
 * dns.lookup) and enoughServers (how many fully sampled servers end the wait for the rest).
 *
 * Never throws, never rejects, and settles within overallTimeoutMs.
 */
async function measure(opts) {
  const startedAt = performance.now();
  const cfg = safeOptions(opts);
  const clock = createClock();
  const tokens = { ntp: createCancelToken(), https: createCancelToken() };
  const stopEverything = (why) => {
    tokens.ntp.cancel(why);
    tokens.https.cancel(why);
  };
  let softTimer = null;
  let hardTimer = null;
  let outcome = null;
  try {
    const work = runPhases(cfg, clock, tokens, startedAt);
    work.catch(noop); // if the backstop wins the race, a late failure must not go unhandled
    // The soft stop cancels every pending wait, after which the work settles within a tick. The
    // hard stop is a backstop that keeps the promise from hanging if something ever fails to.
    const backstop = new Promise((resolve) => {
      softTimer = setTimeout(() => stopEverything(STOP_NO_REPLY), cfg.softStopMs);
      hardTimer = setTimeout(() => resolve(null), cfg.hardStopMs);
    });
    outcome = await Promise.race([work, backstop]);
  } catch (err) {
    outcome = { method: 'none', verdict: noAnswer('internal error: ' + errorText(err)), servers: [] };
  } finally {
    clearTimeout(softTimer);
    clearTimeout(hardTimer);
    stopEverything('finished');
  }
  if (!outcome) outcome = { method: 'none', verdict: noAnswer('timed out'), servers: [] };
  try {
    return buildResult(outcome, clock);
  } catch (err) {
    return {
      ok: false,
      offsetMs: 0,
      uncertaintyMs: Infinity,
      method: 'none',
      servers: [],
      at: Date.now(),
      error: 'internal error: ' + errorText(err),
    };
  }
}

/**
 * Measures against a single server. Resolves (never rejects) with
 * { host, ok, offsetMs, delayMs, stratum, error, address, samples }; offsetMs has the same
 * meaning as in measure(). opts: { samples, timeoutMs, overallTimeoutMs, lookup }.
 */
async function querySntp(host, port, opts) {
  const label = shortLabel(host);
  let deadline = null;
  const token = createCancelToken();
  try {
    const cfg = safeOptions(opts);
    const target = parseServer(host, isPort(port) ? port : DEFAULT_PORT);
    const clock = createClock();
    deadline = setTimeout(() => token.cancel(STOP_NO_REPLY), cfg.softStopMs);
    const entry = await sampleServer(target, cfg, clock, token);
    const shaped = publicEntry(entry, Date.now() - clock.now());
    return Object.assign(shaped, { address: entry.address, samples: entry.samples });
  } catch (err) {
    return Object.assign(failedEntry(label, 'internal error: ' + errorText(err)),
      { address: null, samples: 0 });
  } finally {
    clearTimeout(deadline);
    token.cancel('finished');
  }
}

module.exports = {
  measure,
  querySntp,
  buildPacket,
  parsePacket,
  combine,
  DEFAULT_SERVERS,
  DEFAULT_HTTPS_ENDPOINTS,
  // Exported for tests and diagnostics.
  parseTraceTimestamp,
  parseHttpDate,
  unixMsToNtp,
  ntpToUnixMs,
};
