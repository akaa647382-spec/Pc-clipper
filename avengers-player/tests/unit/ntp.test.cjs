'use strict';

/**
 * Tests for main/ntp.js.
 *
 * Everything runs offline. The "internet" is a set of fake SNTP servers on 127.0.0.1 whose clock
 * error and bad behaviour are configurable, plus a local web server standing in for the HTTPS
 * fallback endpoints. The fake servers encode their packets with their own code (not the
 * module's), so the two implementations check each other.
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const dns = require('node:dns');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const NTP_MODULE = path.join(__dirname, '..', '..', 'main', 'ntp.js');
const ntp = require(NTP_MODULE);

// ------------------------------------------------------------------------------------------------
// Test rig
// ------------------------------------------------------------------------------------------------

const realDateNow = Date.now;
const realLookup = dns.lookup;
const realCreateSocket = dgram.createSocket;

/**
 * "True time" for the fake servers: the PC clock, advanced monotonically from an anchor.
 * The anchor is taken afresh before every test. ntp.js reports offsets against Date.now() as it is
 * when measure() returns, so if the real system clock is stepped while this file runs (a VM being
 * resumed, the host syncing its clock) an anchor taken once at load would make every later test
 * fail by the size of the step; this way it can only upset the test it lands in.
 */
let wallAnchor = 0;
let monoAnchor = 0;
const trueNow = () => wallAnchor + (performance.now() - monoAnchor);

function anchorTrueTime() {
  // Date.now() only has whole milliseconds: wait for it to tick so the anchor is exact.
  const first = realDateNow();
  let now = first;
  while (now === first) now = realDateNow();
  wallAnchor = now;
  monoAnchor = performance.now();
}
anchorTrueTime();

const NTP_UNIX_DELTA_S = 2208988800;
const TWO_32 = 4294967296;

/** Every UDP socket the module opens is recorded so each test can prove it was closed again. */
const clientSockets = [];
dgram.createSocket = function trackedCreateSocket(...args) {
  const socket = realCreateSocket.apply(this, args);
  const record = { closed: false };
  socket.once('close', () => {
    record.closed = true;
  });
  clientSockets.push(record);
  return socket;
};

const cleanups = [];

beforeEach(anchorTrueTime);

afterEach(async () => {
  Date.now = realDateNow;
  dns.lookup = realLookup;
  while (cleanups.length) await cleanups.pop()();
  await sleep(5); // 'close' events are delivered on a later tick
  const open = clientSockets.filter((record) => !record.closed).length;
  const total = clientSockets.length;
  clientSockets.length = 0;
  assert.equal(open, 0, open + ' of ' + total + ' UDP sockets opened by ntp.js were left open');
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function near(actual, expected, tolerance, label) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tolerance,
    (label || 'value') + ': expected ' + expected + ' +/- ' + tolerance + ', got ' + actual);
}

async function timed(run) {
  const started = performance.now();
  const value = await run();
  return { value, elapsedMs: performance.now() - started };
}

function writeNtpTime(buffer, at, unixMs) {
  const wholeSeconds = Math.floor(unixMs / 1000);
  const fraction = (unixMs - wholeSeconds * 1000) / 1000;
  buffer.writeUInt32BE((wholeSeconds + NTP_UNIX_DELTA_S) % TWO_32, at);
  buffer.writeUInt32BE(Math.min(TWO_32 - 1, Math.floor(fraction * TWO_32)), at + 4);
}

function readNtpTime(buffer, at, era) {
  const seconds = buffer.readUInt32BE(at) + (era || 0) * TWO_32 - NTP_UNIX_DELTA_S;
  return seconds * 1000 + (buffer.readUInt32BE(at + 4) / TWO_32) * 1000;
}

const REPLY_DEFAULTS = Object.freeze({
  skewMs: 0, // how wrong the PC clock is according to this server (server time - true PC time)
  procDelayMs: 0, // time the server sits on the request (reported honestly in its timestamps)
  sendDelayMs: 0, // extra delay on the way back only: an asymmetric network path
  drop: false, // packet loss
  leap: 0,
  version: 4,
  mode: 4,
  stratum: 2,
  kiss: '', // four-letter kiss-of-death code placed in the reference id
  rootDelayS: 0.01,
  rootDispersionS: 0.005,
  corruptOriginate: false,
  zeroTransmit: false,
  zeroReceive: false,
  transmitExtraMs: 0, // lie about how long the request was held
  truncateTo: 48,
  fromOtherPort: false,
  junkFirst: false, // send an unrelated packet before the real answer
  duplicate: false, // send the answer twice
  onReceive: null,
});

function buildReply(request, plan, receiveMs, transmitMs) {
  const reply = Buffer.alloc(48);
  reply[0] = (plan.leap << 6) | (plan.version << 3) | plan.mode;
  reply[1] = plan.stratum;
  reply[2] = 6;
  reply.writeInt8(-20, 3);
  reply.writeUInt32BE(Math.round(plan.rootDelayS * 65536), 4);
  reply.writeUInt32BE(Math.round(plan.rootDispersionS * 65536), 8);
  reply.write(plan.kiss || 'FAKE', 12, 4, 'latin1');
  writeNtpTime(reply, 16, receiveMs - 5000);
  request.copy(reply, 24, 40, 48);
  if (plan.corruptOriginate) reply[31] ^= 0x01;
  if (!plan.zeroReceive) writeNtpTime(reply, 32, receiveMs);
  if (!plan.zeroTransmit) writeNtpTime(reply, 40, transmitMs + plan.transmitExtraMs);
  return reply.subarray(0, plan.truncateTo);
}

function bindLocal(socket) {
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => resolve(socket.address().port));
  });
}

/**
 * Starts a fake SNTP server. `options` are REPLY_DEFAULTS overrides; options.plan(index) may
 * return further overrides for the index-th request, so behaviour can change per sample.
 */
async function startSntp(options) {
  const base = Object.assign({}, REPLY_DEFAULTS, options);
  const socket = realCreateSocket.call(dgram, 'udp4');
  const other = realCreateSocket.call(dgram, 'udp4');
  const timers = new Set();
  const server = { requests: 0, port: 0, host: '' };

  const later = (ms, run) => {
    if (!ms) {
      run();
      return;
    }
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  socket.on('message', (request, rinfo) => {
    const index = server.requests++;
    const plan = Object.assign({}, base, typeof base.plan === 'function' ? base.plan(index) : null);
    const receiveMs = trueNow() + plan.skewMs;
    if (plan.onReceive) plan.onReceive(index);
    if (plan.drop) return;
    later(plan.procDelayMs, () => {
      const reply = buildReply(request, plan, receiveMs, trueNow() + plan.skewMs);
      later(plan.sendDelayMs, () => {
        const out = plan.fromOtherPort ? other : socket;
        if (plan.junkFirst) {
          const junk = buildReply(request, Object.assign({}, plan, { corruptOriginate: true }),
            receiveMs + 4000, receiveMs + 4000);
          out.send(junk, rinfo.port, rinfo.address);
        }
        out.send(reply, rinfo.port, rinfo.address);
        if (plan.duplicate) out.send(reply, rinfo.port, rinfo.address);
      });
    });
  });

  server.port = await bindLocal(socket);
  await bindLocal(other);
  server.host = '127.0.0.1:' + server.port;
  cleanups.push(() => new Promise((resolve) => {
    for (const timer of timers) clearTimeout(timer);
    other.close(() => socket.close(resolve));
  }));
  return server;
}

function traceBody(nowMs) {
  return [
    'fl=29f123',
    'h=www.example.test',
    'ip=203.0.113.7',
    'ts=' + (nowMs / 1000).toFixed(3),
    'visit_scheme=https',
    'uag=test',
    'colo=AMS',
    'http=http/1.1',
    'loc=NL',
    'tls=TLSv1.3',
    'warp=off',
    '',
  ].join('\n');
}

/**
 * Starts a local web server that plays the part of a fallback endpoint.
 * options: skewMs, date (false omits the Date header), age, status, body, hang, delayMs.
 */
async function startWeb(options) {
  const o = options || {};
  const web = { hits: [], base: '' };
  const timers = new Set();
  const server = http.createServer((req, res) => {
    web.hits.push(req.method + ' ' + req.url);
    if (o.hang) return;
    const respond = () => {
      const now = trueNow() + (o.skewMs || 0);
      res.sendDate = false;
      if (o.date !== false) res.setHeader('Date', new Date(now).toUTCString());
      if (o.age !== undefined) res.setHeader('Age', String(o.age));
      res.statusCode = o.status || 200;
      res.end(req.method === 'HEAD' ? undefined : (o.body !== undefined ? o.body : traceBody(now)));
    };
    if (o.delayMs) timers.add(setTimeout(respond, o.delayMs));
    else respond();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  web.base = 'http://127.0.0.1:' + server.address().port;
  cleanups.push(() => new Promise((resolve) => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    server.close(resolve);
  }));
  return web;
}

function freeTcpPort() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

/** Runs a script in a fresh Node process and reports how it ended. */
function runNode(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    let killed = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const killer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, 15000);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, killed, stdout, stderr });
    });
  });
}

/** The parent's environment without anything that changes how Node trusts certificates. */
function plainEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const name of Object.keys(env)) {
    if (/^(NODE_OPTIONS|NODE_EXTRA_CA_CERTS|NODE_USE_ENV_PROXY|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY)$/i.test(name)) {
      delete env[name];
    }
  }
  return Object.assign(env, extra);
}

const offlineLookup = (hostname, options, callback) => {
  process.nextTick(callback, Object.assign(new Error('getaddrinfo ENOTFOUND ' + hostname),
    { code: 'ENOTFOUND' }));
};

const sample = (host, offsetMs, delayMs) => ({ host, ok: true, offsetMs, delayMs, stratum: 2, error: null });

/** A small deterministic generator, so a failing randomised test can be replayed. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------
// Packets
// ------------------------------------------------------------------------------------------------

test('buildPacket makes a minimal 48-byte SNTP client request', () => {
  const nowMs = Date.UTC(2026, 11, 31, 23, 59, 58, 250);
  const packet = ntp.buildPacket({ nowMs, nonce: 0x155555 });
  assert.equal(packet.length, 48);
  assert.equal(packet[0], 0x23, 'leap 0, version 4, mode 3 (client)');
  assert.ok(packet.subarray(1, 40).every((byte) => byte === 0), 'nothing but the transmit timestamp is filled in');
  near(readNtpTime(packet, 40), nowMs, 1, 'transmit timestamp carries the real time');
  assert.equal(packet.readUInt32BE(44) & 0x3FFFFF, 0x155555, 'the low fraction bits are the nonce');
});

test('buildPacket uses a fresh random nonce for every request', () => {
  const nowMs = Date.UTC(2026, 11, 31, 12, 0, 0, 0);
  const stamps = new Set();
  for (let i = 0; i < 64; i++) stamps.add(ntp.buildPacket({ nowMs }).readUInt32BE(44));
  assert.ok(stamps.size > 60, 'only ' + stamps.size + ' distinct transmit timestamps in 64 packets');
  const defaulted = ntp.buildPacket();
  near(readNtpTime(defaulted, 40), Date.now(), 50, 'defaults to the current time');
});

test('parsePacket decodes a well-formed reply (round trip with buildPacket)', () => {
  const nowMs = Date.UTC(2026, 11, 31, 23, 59, 59, 500);
  const request = ntp.buildPacket({ nowMs });
  const reply = buildReply(request, Object.assign({}, REPLY_DEFAULTS, { stratum: 3 }),
    nowMs + 1234.25, nowMs + 1234.75);
  const parsed = ntp.parsePacket(reply, { request, pivotMs: nowMs });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.error, null);
  assert.equal(parsed.mode, 4);
  assert.equal(parsed.version, 4);
  assert.equal(parsed.leap, 0);
  assert.equal(parsed.stratum, 3);
  near(parsed.receiveMs, nowMs + 1234.25, 0.001, 'receive timestamp');
  near(parsed.transmitMs, nowMs + 1234.75, 0.001, 'transmit timestamp');
  near(parsed.rootDelayMs, 10, 0.1, 'root delay');
  near(parsed.rootDispersionMs, 5, 0.1, 'root dispersion');
  // Extension fields or a MAC after the first 48 bytes are allowed and ignored.
  assert.equal(ntp.parsePacket(Buffer.concat([reply, Buffer.alloc(20, 7)]), { request }).ok, true);
  // Version 3 servers are fine too.
  const v3 = buildReply(request, Object.assign({}, REPLY_DEFAULTS, { version: 3 }), nowMs, nowMs);
  assert.equal(ntp.parsePacket(v3, { request, pivotMs: nowMs }).ok, true);
  // The whole legal range is accepted: stratum 1 to 15, and a pending leap second (1 or 2).
  for (const overrides of [{ stratum: 1 }, { stratum: 15 }, { leap: 1 }, { leap: 2 }]) {
    const legal = buildReply(request, Object.assign({}, REPLY_DEFAULTS, overrides), nowMs, nowMs);
    const decoded = ntp.parsePacket(legal, { request, pivotMs: nowMs });
    assert.equal(decoded.ok, true, JSON.stringify(overrides) + ': ' + decoded.error);
  }
});

test('parsePacket rejects everything that is not a trustworthy server reply', () => {
  const nowMs = Date.UTC(2026, 11, 31, 20, 0, 0, 0);
  const request = ntp.buildPacket({ nowMs });
  const reject = (overrides, pattern, receiveMs, transmitMs) => {
    const plan = Object.assign({}, REPLY_DEFAULTS, overrides);
    const reply = buildReply(request, plan, receiveMs || nowMs, transmitMs || nowMs + 0.5);
    const parsed = ntp.parsePacket(reply, { request, pivotMs: nowMs });
    assert.equal(parsed.ok, false, JSON.stringify(overrides) + ' should be rejected');
    assert.match(parsed.error, pattern);
  };
  reject({ truncateTo: 47 }, /short packet/);
  reject({ truncateTo: 0 }, /short packet/);
  reject({ mode: 3 }, /wrong mode 3/);
  reject({ mode: 5 }, /wrong mode 5/);
  reject({ version: 2 }, /version 2/);
  reject({ version: 5 }, /version 5/);
  reject({ leap: 3 }, /not synchronised/);
  reject({ stratum: 0, kiss: 'RATE' }, /kiss-of-death RATE/);
  reject({ stratum: 0, kiss: 'DENY', leap: 3 }, /kiss-of-death DENY/);
  reject({ stratum: 16 }, /bad stratum 16/);
  reject({ stratum: 255 }, /bad stratum 255/);
  reject({ zeroTransmit: true }, /zero transmit/);
  reject({ zeroReceive: true }, /zero receive/);
  reject({ corruptOriginate: true }, /originate mismatch/);
  reject({ rootDispersionS: 3 }, /unsure/);
  reject({}, /inconsistent timestamps/, nowMs + 10, nowMs + 5);

  // The originate check is skipped only when the caller has no request to compare with.
  const corrupt = buildReply(request, Object.assign({}, REPLY_DEFAULTS, { corruptOriginate: true }),
    nowMs, nowMs);
  assert.equal(ntp.parsePacket(corrupt, { pivotMs: nowMs }).ok, true);
  assert.equal(ntp.parsePacket(corrupt, { request: null, pivotMs: nowMs }).ok, false);
  // Our own request is not a reply.
  assert.match(ntp.parsePacket(request).error, /wrong mode 3/);
});

test('parsePacket never throws on garbage', () => {
  for (const junk of [undefined, null, 0, 'time', {}, [], new Uint8Array(48), Buffer.alloc(0), Buffer.alloc(48), Buffer.alloc(48, 0xFF), Buffer.alloc(1000, 0x24)]) {
    const parsed = ntp.parsePacket(junk, { request: junk, pivotMs: NaN });
    assert.equal(parsed.ok, false);
    assert.equal(typeof parsed.error, 'string');
  }
});

test('NTP era: timestamps keep working across the February 2036 rollover', () => {
  const rollover = Date.UTC(2036, 1, 7, 6, 28, 16);
  // Seconds field wraps to 0 exactly at the rollover.
  assert.deepEqual(ntp.unixMsToNtp(rollover), { seconds: 0, fraction: 0 });
  assert.equal(ntp.unixMsToNtp(rollover - 1000).seconds, 0xFFFFFFFF);
  assert.equal(ntp.unixMsToNtp(Date.UTC(1970, 0, 1)).seconds, NTP_UNIX_DELTA_S);

  // The same wire value means 1900 or 2036 depending on which is closer to our own clock.
  assert.equal(ntp.ntpToUnixMs(0, 0, rollover + 5000), rollover);
  assert.equal(ntp.ntpToUnixMs(0, 0, Date.UTC(1905, 0, 1)), Date.UTC(1900, 0, 1));
  assert.equal(ntp.ntpToUnixMs(0xFFFFFFFF, 0, rollover + 5000), rollover - 1000);
  assert.equal(ntp.ntpToUnixMs(5, 0, rollover - 2000), rollover + 5000);

  for (const when of [Date.UTC(2026, 11, 31, 23, 59, 59, 999), rollover - 1, rollover, rollover + 1,
    Date.UTC(2040, 5, 1, 12, 0, 0, 123), Date.UTC(2100, 0, 1), Date.UTC(2172, 2, 1)]) {
    const stamp = ntp.unixMsToNtp(when);
    assert.ok(stamp.seconds >= 0 && stamp.seconds < TWO_32 && stamp.fraction >= 0 && stamp.fraction < TWO_32);
    // Recovered correctly even when our own clock is hours or years away from the server's.
    for (const clockError of [0, 3600e3, -3600e3, 20 * 365 * 86400e3, -20 * 365 * 86400e3]) {
      near(ntp.ntpToUnixMs(stamp.seconds, stamp.fraction, when + clockError), when, 0.001,
        new Date(when).toISOString() + ' with pivot error ' + clockError);
    }
  }
});

test('NTP era: a full exchange straddling the rollover parses to the right instants', () => {
  const rollover = Date.UTC(2036, 1, 7, 6, 28, 16);
  // We send 300 ms before the wrap; the server (0.8 s ahead of us) answers after it.
  const sentAt = rollover - 300;
  const request = ntp.buildPacket({ nowMs: sentAt });
  assert.equal(request.readUInt32BE(40), 0xFFFFFFFF, 'request is stamped in era 0');
  const reply = buildReply(request, REPLY_DEFAULTS, sentAt + 810, sentAt + 811);
  assert.equal(reply.readUInt32BE(40), 0, 'reply is stamped in era 1');
  const parsed = ntp.parsePacket(reply, { request, pivotMs: sentAt + 20 });
  assert.equal(parsed.ok, true);
  near(parsed.receiveMs, rollover + 510, 0.001);
  near(parsed.transmitMs, rollover + 511, 0.001);

  // And long after it: in 2040 both sides are in era 1.
  const later = Date.UTC(2040, 11, 31, 23, 59, 30);
  const request2040 = ntp.buildPacket({ nowMs: later });
  const parsed2040 = ntp.parsePacket(buildReply(request2040, REPLY_DEFAULTS, later + 40, later + 41),
    { request: request2040, pivotMs: later });
  assert.equal(parsed2040.ok, true);
  near(parsed2040.transmitMs, later + 41, 0.001);
});

// ------------------------------------------------------------------------------------------------
// One server
// ------------------------------------------------------------------------------------------------

test('querySntp recovers a clock that is 1234 ms slow', async () => {
  const server = await startSntp({ skewMs: 1234, stratum: 3 });
  const result = await ntp.querySntp('127.0.0.1', server.port, { timeoutMs: 1000 });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 1234, 5, 'offset');
  assert.ok(result.delayMs >= 0 && result.delayMs < 50, 'loopback delay, got ' + result.delayMs);
  assert.equal(result.stratum, 3);
  assert.equal(result.error, null);
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.address, '127.0.0.1');
  assert.equal(result.samples, 4);
  assert.equal(server.requests, 4, 'four samples by default');
});

test('querySntp recovers a clock that is 87654 ms fast', async () => {
  const server = await startSntp({ skewMs: -87654 });
  const result = await ntp.querySntp(server.host, undefined, { timeoutMs: 1000, samples: 3 });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, -87654, 5, 'offset');
  assert.equal(server.requests, 3);
});

test('time the server spends on the request does not bias the offset or count as delay', async () => {
  const server = await startSntp({ skewMs: 500, procDelayMs: 40 });
  const result = await ntp.querySntp(server.host, null, { timeoutMs: 1000, samples: 2 });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 500, 5, 'offset');
  assert.ok(result.delayMs < 25, 'server processing time must be subtracted, delay was ' + result.delayMs);
});

test('the lowest-delay sample wins, wherever it is in the sequence', async () => {
  for (const delays of [[60, 0, 30, 45], [0, 60, 30, 45], [45, 60, 30, 0]]) {
    const server = await startSntp({ skewMs: 700, plan: (i) => ({ sendDelayMs: delays[i] }) });
    const result = await ntp.querySntp(server.host, null, { timeoutMs: 1000 });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.samples, 4);
    // The slow samples are off by half their extra delay (22 to 30 ms); only the clean one is not.
    near(result.offsetMs, 700, 5, 'offset with delays ' + delays);
    assert.ok(result.delayMs < 15, 'kept a slow sample: delay ' + result.delayMs + ' with delays ' + delays);
  }
});

test('an asymmetric path biases the offset, but never beyond half the reported delay', async () => {
  const server = await startSntp({ skewMs: -300, sendDelayMs: 40 });
  const result = await ntp.querySntp(server.host, null, { timeoutMs: 1000, samples: 2 });
  assert.equal(result.ok, true, result.error);
  assert.ok(result.delayMs >= 38 && result.delayMs < 80, 'delay ' + result.delayMs);
  near(result.offsetMs, -300 - 20, 6, 'biased by half the extra one-way delay');
  assert.ok(Math.abs(result.offsetMs + 300) <= result.delayMs / 2 + 2, 'error stays inside delay / 2');
});

test('packet loss: a lost first request is retried', async () => {
  const server = await startSntp({ skewMs: 42, plan: (i) => ({ drop: i === 0 }) });
  const { value: result, elapsedMs } = await timed(
    () => ntp.querySntp(server.host, null, { timeoutMs: 120 }));
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 42, 5, 'offset');
  assert.equal(server.requests, 4);
  assert.equal(result.samples, 3);
  assert.ok(elapsedMs >= 110, 'waited for the lost packet');
});

test('packet loss after a good sample: keeps what it has without waiting the full timeout', async () => {
  // Typical of pool servers that answer once and then rate-limit.
  const server = await startSntp({ skewMs: -15, plan: (i) => ({ drop: i > 0 }) });
  const { value: result, elapsedMs } = await timed(
    () => ntp.querySntp(server.host, null, { timeoutMs: 3000 }));
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, -15, 5, 'offset');
  assert.equal(result.samples, 1);
  assert.equal(server.requests, 2, 'stops asking once the server goes quiet');
  assert.ok(elapsedMs < 1500, 'took ' + elapsedMs + ' ms');
});

test('a silent server is given up on after two tries', async () => {
  const server = await startSntp({ drop: true });
  const { value: result, elapsedMs } = await timed(
    () => ntp.querySntp(server.host, null, { timeoutMs: 80 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'timeout');
  assert.equal(result.offsetMs, null);
  assert.equal(result.delayMs, null);
  assert.equal(result.stratum, null);
  assert.equal(server.requests, 2);
  assert.ok(elapsedMs >= 150 && elapsedMs < 600, 'took ' + elapsedMs + ' ms');
});

test('bad replies are rejected with a reason, and the server is not asked again', async () => {
  const farInThePast = Date.UTC(2001, 0, 1) - trueNow();
  const cases = [
    [{ stratum: 16 }, /bad stratum 16/],
    [{ stratum: 0, kiss: 'RATE', leap: 3 }, /kiss-of-death RATE/],
    [{ mode: 5 }, /wrong mode 5/],
    [{ mode: 3 }, /wrong mode 3/],
    [{ version: 1 }, /version 1/],
    [{ leap: 3 }, /not synchronised/],
    [{ zeroTransmit: true }, /zero transmit/],
    [{ zeroReceive: true }, /zero receive/],
    [{ rootDispersionS: 10 }, /unsure/],
    [{ transmitExtraMs: 500 }, /inconsistent timestamps/],
    [{ transmitExtraMs: -500 }, /inconsistent timestamps/],
    [{ skewMs: farInThePast }, /implausible server time/],
  ];
  for (const [behaviour, pattern] of cases) {
    const server = await startSntp(behaviour);
    const { value: result, elapsedMs } = await timed(
      () => ntp.querySntp(server.host, null, { timeoutMs: 1500 }));
    assert.equal(result.ok, false, JSON.stringify(behaviour) + ' must not be accepted');
    assert.match(result.error, pattern);
    assert.equal(result.offsetMs, null);
    assert.equal(server.requests, 1, JSON.stringify(behaviour) + ': asked again after a definite refusal');
    assert.ok(elapsedMs < 1000, 'a definite refusal must not wait for the timeout');
  }
});

test('replies that do not belong to our request are ignored, not accepted', async () => {
  const cases = [
    [{ corruptOriginate: true }, /timeout \(ignored: originate mismatch\)/],
    [{ truncateTo: 40 }, /timeout \(ignored: short packet\)/],
    [{ fromOtherPort: true }, /timeout \(ignored: reply from unexpected address\)/],
  ];
  for (const [behaviour, pattern] of cases) {
    const server = await startSntp(Object.assign({ skewMs: 9999 }, behaviour));
    const result = await ntp.querySntp(server.host, null, { timeoutMs: 70 });
    assert.equal(result.ok, false, JSON.stringify(behaviour) + ' must not be accepted');
    assert.match(result.error, pattern);
    assert.equal(server.requests, 2);
  }
});

test('stray and duplicate packets do not spoil a good exchange', async () => {
  const noisy = await startSntp({ skewMs: 321, junkFirst: true, duplicate: true });
  const result = await ntp.querySntp(noisy.host, null, { timeoutMs: 1000 });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.samples, 4);
  near(result.offsetMs, 321, 5, 'offset');
});

test('a late reply to an earlier sample is never taken for the sample in flight', async () => {
  // The answer to the first request is held back past the timeout and carries a time 90 s out.
  // It lands while the third request is waiting for its own, slower, answer. Without the
  // originate check it would be the quickest reply by far and so the sample that gets kept.
  const server = await startSntp({
    skewMs: 300,
    plan: (i) => (i === 0 ? { sendDelayMs: 130, skewMs: 90000 } : { sendDelayMs: 30 }),
  });
  const { value: result, elapsedMs } = await timed(
    () => ntp.querySntp(server.host, null, { timeoutMs: 80 }));
  assert.equal(result.ok, true, result.error);
  assert.equal(server.requests, 4);
  assert.equal(result.samples, 3, 'only the answers to the three live requests count');
  near(result.offsetMs, 300 - 15, 8, 'offset (biased by half of the 30 ms return delay)');
  assert.ok(result.delayMs >= 28, 'the late packet was taken for a quick answer: delay ' + result.delayMs);
  assert.ok(elapsedMs >= 140, 'the late reply must arrive while samples are still being taken');
});

test('a reply from a different IP address is ignored, even a perfectly formed one', async (t) => {
  const front = realCreateSocket.call(dgram, 'udp4');
  cleanups.push(() => new Promise((resolve) => front.close(resolve)));
  const port = await bindLocal(front);
  // The impostor answers from the same port number on another address, so the address is the
  // only thing that tells its packets apart from the real server's.
  const impostor = realCreateSocket.call(dgram, 'udp4');
  cleanups.push(() => new Promise((resolve) => {
    try {
      impostor.close(resolve);
    } catch (_) {
      resolve();
    }
  }));
  try {
    await new Promise((resolve, reject) => {
      impostor.once('error', reject);
      impostor.bind(port, '127.0.0.2', resolve);
    });
  } catch (_) {
    t.skip('this machine has no second loopback address to answer from');
    return;
  }
  let requests = 0;
  front.on('message', (request, rinfo) => {
    requests++;
    const now = trueNow() + 4242;
    impostor.send(buildReply(request, REPLY_DEFAULTS, now, now), rinfo.port, rinfo.address);
  });
  const result = await ntp.querySntp('127.0.0.1', port, { timeoutMs: 70 });
  assert.equal(result.ok, false, 'accepted an answer from an address that was never asked');
  assert.equal(result.error, 'timeout (ignored: reply from unexpected address)');
  assert.equal(result.offsetMs, null);
  assert.equal(requests, 2);
});

test('a kiss-of-death after a good sample keeps the good sample and stops asking', async () => {
  const server = await startSntp({ skewMs: 64, plan: (i) => (i > 0 ? { stratum: 0, kiss: 'RATE' } : null) });
  const result = await ntp.querySntp(server.host, null, { timeoutMs: 1000 });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 64, 5, 'offset');
  assert.equal(server.requests, 2);
});

test('host names are resolved to IPv4 through the lookup function', async () => {
  const server = await startSntp({ skewMs: 77 });
  const asked = [];
  const lookup = (hostname, options, callback) => {
    asked.push([hostname, options.family]);
    setTimeout(callback, 5, null, '127.0.0.1', 4);
  };
  const result = await ntp.querySntp('fake-time.test', server.port, { timeoutMs: 1000, lookup });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.host, 'fake-time.test');
  assert.equal(result.address, '127.0.0.1');
  near(result.offsetMs, 77, 5, 'offset');
  assert.deepEqual(asked, [['fake-time.test', 4]]);

  // The { all: true } result shape is understood as well.
  const listLookup = (hostname, options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]);
  const viaList = await ntp.querySntp('fake-time.test:' + server.port, null, { timeoutMs: 1000, lookup: listLookup });
  assert.equal(viaList.ok, true, viaList.error);
});

test('name lookup failures are reported, never thrown', async () => {
  const cases = [
    [offlineLookup, /^dns: ENOTFOUND$/],
    [() => {}, /^dns: timeout$/], // a resolver that never answers
    [() => {
      throw new Error('resolver exploded');
    }, /^dns: resolver exploded$/],
    [(hostname, options, callback) => callback(null, '::1', 6), /^dns: no IPv4 address$/],
    [(hostname, options, callback) => callback(null, undefined), /^dns: no IPv4 address$/],
  ];
  for (const [lookup, pattern] of cases) {
    const { value: result, elapsedMs } = await timed(
      () => ntp.querySntp('fake-time.test', 123, { timeoutMs: 80, lookup }));
    assert.equal(result.ok, false);
    assert.match(result.error, pattern);
    assert.ok(elapsedMs < 400, 'took ' + elapsedMs + ' ms');
  }
});

test('invalid server names fail cleanly without touching the network', async () => {
  let lookups = 0;
  const lookup = (hostname, options, callback) => {
    lookups++;
    offlineLookup(hostname, options, callback);
  };
  const cases = [
    ['', /invalid server name/],
    ['   ', /invalid server name/],
    [null, /invalid server name/],
    [undefined, /invalid server name/],
    [42, /invalid server name/],
    [{}, /invalid server name/],
    ['bad host!', /invalid server name/],
    ['-dash.example', /invalid server name/],
    ['http://time.example', /IPv6|invalid/],
    ['[::1]:123', /IPv6/],
    ['::1', /IPv6/],
    ['time.example:0', /invalid port/],
    ['time.example:70000', /invalid port/],
    ['time.example:ntp', /invalid port/],
    ['time.example:', /invalid port/],
  ];
  for (const [host, pattern] of cases) {
    const result = await ntp.querySntp(host, 123, { timeoutMs: 80, lookup });
    assert.equal(result.ok, false);
    assert.match(result.error, pattern, 'host ' + JSON.stringify(host));
    assert.equal(typeof result.host, 'string');
  }
  assert.equal(lookups, 0);
});

// ------------------------------------------------------------------------------------------------
// combine()
// ------------------------------------------------------------------------------------------------

test('combine: nothing usable gives ok false, offset 0 and infinite uncertainty', () => {
  for (const input of [undefined, null, 'servers', 7, {}, [], [null], [undefined, 3, 'x'],
    [{ host: 'a', ok: false, offsetMs: 5, delayMs: 5 }],
    [{ host: 'a', ok: true, offsetMs: NaN, delayMs: 5 }],
    [{ host: 'a', ok: true, offsetMs: 5, delayMs: Infinity }],
    [{ host: 'a', ok: true, offsetMs: 5, delayMs: -1 }],
    [{ host: 'a', ok: 'yes', offsetMs: 5, delayMs: 5 }]]) {
    const verdict = ntp.combine(input);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.offsetMs, 0);
    assert.equal(verdict.uncertaintyMs, Infinity);
    assert.equal(typeof verdict.error, 'string');
  }
});

test('combine: a single server is accepted with 15 ms of extra uncertainty', () => {
  const verdict = ntp.combine([sample('a', 100, 20), { host: 'b', ok: false, error: 'timeout' }]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.offsetMs, 100);
  assert.equal(verdict.uncertaintyMs, 20 / 2 + 2 + 15);
  assert.equal(verdict.host, 'a');
  assert.equal(verdict.error, null);
});

test('combine: the lowest-delay agreeing server is the answer; uncertainty follows the formula', () => {
  const verdict = ntp.combine([sample('a', 100, 30), sample('b', 104, 10), sample('c', 96, 50)]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.host, 'b');
  assert.equal(verdict.offsetMs, 104);
  assert.equal(verdict.uncertaintyMs, 10 / 2 + (104 - 96) / 2 + 2);
  assert.equal(verdict.agreeing, 3);
  assert.deepEqual(verdict.outliers, []);
});

test('combine: an outlier is rejected even when it has the shortest delay', () => {
  const liar = sample('c', 5000, 8);
  const verdict = ntp.combine([sample('a', 100, 10), sample('b', 102, 12), liar]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.host, 'a');
  assert.equal(verdict.offsetMs, 100);
  assert.equal(verdict.uncertaintyMs, 10 / 2 + 2 / 2 + 2);
  assert.equal(verdict.outliers.length, 1);
  assert.equal(verdict.outliers[0], liar);

  const five = ntp.combine([sample('a', 10, 20), sample('b', 12, 25), sample('c', 14, 30),
    sample('d', 900, 5), sample('e', -700, 5)]);
  assert.equal(five.ok, true);
  assert.equal(five.offsetMs, 10);
  assert.deepEqual(five.outliers.map((entry) => entry.host).sort(), ['d', 'e']);
});

test('combine: the agreement window is max(60 ms, 3 x the server\'s own delay)', () => {
  // 146 ms from the median: fine for a server with an 80 ms round trip...
  const tolerated = ntp.combine([sample('a', 0, 10), sample('b', 4, 10), sample('c', 150, 80)]);
  assert.equal(tolerated.ok, true);
  assert.equal(tolerated.agreeing, 3);
  assert.equal(tolerated.offsetMs, 0);
  assert.equal(tolerated.uncertaintyMs, 10 / 2 + 150 / 2 + 2);
  // ...but not for one that answered in 10 ms.
  const rejected = ntp.combine([sample('a', 0, 10), sample('b', 4, 10), sample('c', 150, 10)]);
  assert.equal(rejected.ok, true);
  assert.equal(rejected.agreeing, 2);
  assert.deepEqual(rejected.outliers.map((entry) => entry.host), ['c']);
  // Exactly on the 60 ms line still agrees.
  const edge = ntp.combine([sample('a', 0, 1), sample('b', 0, 1), sample('c', 60, 1)]);
  assert.equal(edge.agreeing, 3);
  assert.equal(ntp.combine([sample('a', 0, 1), sample('b', 0, 1), sample('c', 60.5, 1)]).agreeing, 2);
});

test('combine: two servers must agree; with no third to break the tie it is not ok', () => {
  const agree = ntp.combine([sample('a', 10, 20), sample('b', 30, 10)]);
  assert.equal(agree.ok, true);
  assert.equal(agree.offsetMs, 30);
  assert.equal(agree.uncertaintyMs, 10 / 2 + 20 / 2 + 2);

  for (const pair of [
    [sample('a', 0, 10), sample('b', 251, 10)],
    [sample('a', 0, 10), sample('b', 1000, 10)],
    [sample('a', 0, 200), sample('b', 300, 200)], // long delays do not excuse more than 250 ms
    [sample('a', 0, 10), sample('b', 200, 10)], // inside 250 ms, but neither confirms the other
  ]) {
    const verdict = ntp.combine(pair);
    assert.equal(verdict.ok, false, 'offsets ' + pair.map((entry) => entry.offsetMs));
    assert.equal(verdict.offsetMs, 0);
    assert.equal(verdict.uncertaintyMs, Infinity);
    assert.match(verdict.error, /disagree/);
  }
  // A third server breaks the tie.
  const settled = ntp.combine([sample('a', 0, 10), sample('b', 1000, 10), sample('c', 3, 12)]);
  assert.equal(settled.ok, true);
  assert.equal(settled.offsetMs, 0);
  assert.deepEqual(settled.outliers.map((entry) => entry.host), ['b']);
});

test('combine: no majority means no answer', () => {
  assert.equal(ntp.combine([sample('a', 0, 5), sample('b', 500, 5), sample('c', 1000, 5)]).ok, false);
  assert.equal(ntp.combine([sample('a', 0, 5), sample('b', 2, 5), sample('c', 500, 5), sample('d', 502, 5)]).ok, false);
  // Two sloppy servers must not outvote two precise ones just because their window is wider.
  assert.equal(ntp.combine([sample('a', 0, 100), sample('b', 0, 100), sample('c', 200, 5), sample('d', 200, 5)]).ok, false);
});

test('combine: a lone server\'s own stated error counts against it; a confirmed server does not need it', () => {
  const vague = Object.assign(sample('a', 100, 20), { rootDistanceMs: 300 });
  const alone = ntp.combine([vague, { host: 'b', ok: false, error: 'timeout' }]);
  assert.equal(alone.ok, true);
  assert.equal(alone.offsetMs, 100);
  assert.equal(alone.uncertaintyMs, 20 / 2 + 2 + 15 + 300);
  const confirmed = ntp.combine([vague, sample('b', 102, 30), sample('c', 99, 40)]);
  assert.equal(confirmed.host, 'a');
  assert.equal(confirmed.uncertaintyMs, 20 / 2 + 3 / 2 + 2);
  // Values that make no sense are ignored, not trusted and not thrown on.
  for (const junk of [NaN, -5, '300', null, {}]) {
    const verdict = ntp.combine([Object.assign(sample('a', 100, 20), { rootDistanceMs: junk })]);
    assert.equal(verdict.uncertaintyMs, 20 / 2 + 2 + 15, 'rootDistanceMs ' + JSON.stringify(junk));
  }
});

test('combine: a lying minority can never drag the answer outside the agreement window', () => {
  const random = seededRandom(20261231);
  for (let round = 0; round < 3000; round++) {
    const honestCount = 2 + Math.floor(random() * 4);
    const liarCount = Math.floor(random() * honestCount); // always fewer liars than honest servers
    const truth = (random() - 0.5) * 100000;
    const entries = [];
    let worstHonestError = 0;
    for (let i = 0; i < honestCount; i++) {
      // An honest sample is never further from the truth than half its round trip.
      const delayMs = 1 + random() * 80;
      const errorMs = (random() - 0.5) * delayMs;
      worstHonestError = Math.max(worstHonestError, Math.abs(errorMs));
      entries.push(sample('honest' + i, truth + errorMs, delayMs));
    }
    for (let i = 0; i < liarCount; i++) {
      // Liars say anything, from a hair off to 10 s out, and claim any round trip they like.
      const lie = (random() - 0.5) * (random() < 0.5 ? 400 : 20000);
      entries.splice(Math.floor(random() * (entries.length + 1)), 0,
        sample('liar' + i, truth + lie, random() * 80));
    }
    const describe = () => 'round ' + round + ': ' + JSON.stringify(entries);
    const verdict = ntp.combine(entries);
    assert.equal(verdict.ok, true, 'an honest majority was not recognised in ' + describe());
    const chosen = entries.find((entry) => entry.host === verdict.host);
    assert.equal(verdict.offsetMs, chosen.offsetMs, describe());
    assert.ok(!verdict.outliers.includes(chosen), 'the answer is one of its own outliers in ' + describe());
    assert.ok(verdict.agreeing * 2 > entries.length, describe());
    assert.ok(Number.isFinite(verdict.uncertaintyMs) && verdict.uncertaintyMs >= chosen.delayMs / 2 + 2, describe());
    // The median of a set with an honest majority lies among the honest values, and the answer
    // has to be inside its own agreement window around that median.
    const window = worstHonestError + Math.max(60, 3 * chosen.delayMs);
    assert.ok(Math.abs(verdict.offsetMs - truth) <= window + 1e-6,
      'answer ' + (verdict.offsetMs - truth) + ' ms from the truth, window ' + window + ' in ' + describe());
  }
});

test('combine does not modify its input', () => {
  const input = [sample('a', 100, 10), sample('b', 102, 12), sample('c', 5000, 8), { host: 'd', ok: false, error: 'timeout' }];
  const before = JSON.stringify(input);
  ntp.combine(input);
  assert.equal(JSON.stringify(input), before);
});

// ------------------------------------------------------------------------------------------------
// measure()
// ------------------------------------------------------------------------------------------------

test('measure: servers that agree give ok true, method ntp and the exact result shape', async () => {
  const servers = [await startSntp({ skewMs: 1234, stratum: 1 }), await startSntp({ skewMs: 1235, stratum: 2 }),
    await startSntp({ skewMs: 1233, stratum: 3 })];
  const before = Date.now();
  const result = await ntp.measure({ servers: servers.map((server) => server.host), timeoutMs: 1000, httpsFallback: false });
  assert.deepEqual(Object.keys(result).sort(), ['at', 'error', 'method', 'offsetMs', 'ok', 'servers', 'uncertaintyMs']);
  assert.equal(result.ok, true);
  assert.equal(result.method, 'ntp');
  assert.equal(result.error, null);
  near(result.offsetMs, 1234, 6, 'offset');
  assert.ok(result.uncertaintyMs >= 2 && result.uncertaintyMs < 40, 'uncertainty ' + result.uncertaintyMs);
  assert.ok(Math.abs(result.offsetMs - 1234) <= result.uncertaintyMs + 1, 'the truth lies inside the stated bound');
  assert.ok(result.at >= before && result.at <= Date.now());
  assert.equal(result.servers.length, 3);
  result.servers.forEach((entry, i) => {
    assert.deepEqual(Object.keys(entry).sort(), ['delayMs', 'error', 'host', 'offsetMs', 'ok', 'stratum']);
    assert.equal(entry.host, servers[i].host);
    assert.equal(entry.ok, true);
    assert.equal(entry.error, null);
    assert.equal(entry.stratum, i + 1);
    near(entry.offsetMs, 1233 + [1, 2, 0][i], 6, 'offset of server ' + i);
    assert.ok(entry.delayMs >= 0 && entry.delayMs < 50);
  });
});

test('measure: recovers +1234 ms and -87654 ms from a single server (with the 15 ms penalty)', async () => {
  for (const skewMs of [1234, -87654]) {
    const server = await startSntp({ skewMs });
    const result = await ntp.measure({ servers: [server.host], timeoutMs: 1000, httpsFallback: false });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.method, 'ntp');
    near(result.offsetMs, skewMs, 5, 'offset');
    assert.ok(result.uncertaintyMs >= 17 && result.uncertaintyMs < 45, 'uncertainty ' + result.uncertaintyMs);
    // Adding the offset to Date.now() gives the server's idea of now.
    near(Date.now() + result.offsetMs, trueNow() + skewMs, 6, 'corrected clock');
  }
});

test('measure: an outlier server is rejected and flagged', async () => {
  const good = [await startSntp({ skewMs: 100 }), await startSntp({ skewMs: 102 })];
  const liar = await startSntp({ skewMs: 5000 });
  const result = await ntp.measure({
    servers: [liar.host, good[0].host, good[1].host], timeoutMs: 1000, httpsFallback: false,
  });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 101, 6, 'offset');
  assert.equal(result.servers[0].host, liar.host);
  assert.equal(result.servers[0].ok, false);
  // The distance in the message is the measured one: liar minus answer (4898 or 4900 ms depending
  // on which good server was quicker), not a constant, so check it against the numbers reported.
  const flagged = /^outlier: \+(\d+) ms away from the other sources$/.exec(result.servers[0].error);
  assert.ok(flagged, 'unexpected reason: ' + result.servers[0].error);
  near(Number(flagged[1]), result.servers[0].offsetMs - result.offsetMs, 0.6, 'stated distance');
  near(result.servers[0].offsetMs, 5000, 6, 'the outlier still reports what it measured');
  assert.equal(result.servers[1].ok, true);
  assert.equal(result.servers[2].ok, true);
  assert.ok(Math.abs(result.offsetMs - 101) <= result.uncertaintyMs + 1, 'the truth lies inside the stated bound');
  assert.ok(result.uncertaintyMs < 40, 'the outlier must not widen the bound: ' + result.uncertaintyMs);
});

test('measure: two servers that disagree give ok false', async () => {
  const a = await startSntp({ skewMs: 0 });
  const b = await startSntp({ skewMs: 1000 });
  const web = await startWeb({ skewMs: 0 });
  const result = await ntp.measure({
    servers: [a.host, b.host], timeoutMs: 1000, httpsEndpoints: [web.base + '/cdn-cgi/trace'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.method, 'none');
  assert.equal(result.offsetMs, 0);
  assert.equal(result.uncertaintyMs, Infinity);
  assert.match(result.error, /two sources disagree by (99\d|100\d) ms/);
  // Both answered properly; we just cannot tell which one is right.
  assert.deepEqual(result.servers.map((entry) => entry.ok), [true, true]);
  near(result.servers[1].offsetMs - result.servers[0].offsetMs, 1000, 6);
  assert.equal(web.hits.length, 0, 'the web fallback is only for when no time server answers');
});

test('measure: when every server times out it gives ok false, method none, inside the overall timeout', async () => {
  const silent = [await startSntp({ drop: true }), await startSntp({ drop: true }), await startSntp({ drop: true })];
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: silent.map((server) => server.host), timeoutMs: 100, overallTimeoutMs: 1500, httpsFallback: false,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.method, 'none');
  assert.equal(result.offsetMs, 0);
  assert.equal(result.uncertaintyMs, Infinity);
  assert.equal(result.error, 'no time server answered');
  assert.equal(result.servers.length, 3);
  for (const entry of result.servers) {
    assert.equal(entry.ok, false);
    assert.equal(entry.error, 'timeout');
    assert.equal(entry.offsetMs, null);
    assert.equal(entry.delayMs, null);
    assert.equal(entry.stratum, null);
  }
  assert.ok(elapsedMs >= 190 && elapsedMs <= 1500, 'took ' + elapsedMs + ' ms');
});

test('measure: the overall timeout wins over long per-request timeouts', async () => {
  const silent = [await startSntp({ drop: true }), await startSntp({ drop: true })];
  const hanging = await startWeb({ hang: true });
  for (const httpsFallback of [false, true]) {
    const { value: result, elapsedMs } = await timed(() => ntp.measure({
      servers: silent.map((server) => server.host),
      timeoutMs: 20000,
      overallTimeoutMs: 500,
      httpsFallback,
      httpsEndpoints: [hanging.base + '/cdn-cgi/trace', hanging.base + '/'],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.method, 'none');
    assert.ok(elapsedMs <= 500, 'settled after ' + elapsedMs + ' ms, limit 500');
    assert.ok(elapsedMs >= 250, 'gave up too early: ' + elapsedMs + ' ms');
    assert.deepEqual(result.servers.slice(0, 2).map((entry) => entry.error), ['no reply in time', 'no reply in time']);
    assert.equal(result.servers.length, httpsFallback ? 4 : 2);
  }
  assert.equal(hanging.hits.length, 2, 'the fallback was tried once, in the time that was left');
});

test('measure: a server that only answers part of the time still counts when time runs out', async () => {
  // Answers the first request, then holds every later reply for longer than the budget.
  const slow = await startSntp({ skewMs: 250, plan: (i) => ({ sendDelayMs: i === 0 ? 0 : 800 }) });
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: [slow.host], timeoutMs: 5000, overallTimeoutMs: 400, httpsFallback: false,
  }));
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 250, 5, 'offset');
  assert.ok(elapsedMs <= 400, 'settled after ' + elapsedMs + ' ms');
});

test('measure: does not wait for a dead server once three others have answered', async () => {
  const good = [await startSntp({ skewMs: -40 }), await startSntp({ skewMs: -41 }), await startSntp({ skewMs: -39 })];
  const dead = await startSntp({ drop: true });
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: [dead.host].concat(good.map((server) => server.host)), timeoutMs: 2000, httpsFallback: false,
  }));
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, -40, 6, 'offset');
  assert.equal(result.servers[0].ok, false);
  assert.match(result.servers[0].error, /stopped early/);
  assert.ok(elapsedMs < 1500, 'waited ' + elapsedMs + ' ms for a dead server');

  // With the early stop switched off the dead server gets its full two tries.
  const patient = await timed(() => ntp.measure({
    servers: [dead.host].concat(good.map((server) => server.host)),
    timeoutMs: 300,
    enoughServers: 12,
    httpsFallback: false,
  }));
  assert.equal(patient.value.ok, true);
  assert.equal(patient.value.servers[0].error, 'timeout');
  assert.ok(patient.elapsedMs >= 590, 'took ' + patient.elapsedMs + ' ms');
});

test('measure: a system clock step in the middle of the exchange does not corrupt the result', async () => {
  // Forwards (Windows syncing its clock) and backwards (someone setting it back an hour).
  for (const stepMs of [7000, -3600000]) {
    const stepClock = () => {
      Date.now = () => realDateNow() + stepMs;
    };
    // The PC clock jumps while the second of four samples is in flight.
    const server = await startSntp({ skewMs: 250, procDelayMs: 15, plan: (i) => (i === 1 ? { onReceive: stepClock } : null) });
    const result = await ntp.measure({ servers: [server.host], timeoutMs: 1000, httpsFallback: false });
    assert.equal(server.requests, 4);
    assert.equal(result.ok, true, result.error);
    // True time has not moved; the PC clock now reads stepMs more, so the correction is that much smaller.
    near(result.offsetMs, 250 - stepMs, 5, 'offset relative to the clock as it is now');
    near(result.servers[0].offsetMs, 250 - stepMs, 5, 'per-server offset');
    assert.ok(result.servers[0].delayMs < 30, 'the jump must not look like network delay: ' + result.servers[0].delayMs);
    near(result.at, realDateNow() + stepMs, 100, 'at is the stepped Date.now()');
    near(Date.now() + result.offsetMs, trueNow() + 250, 6, 'corrected clock');
    Date.now = realDateNow;
  }
});

test('measure: works end to end when the wire timestamps are in the next NTP era (after 2036)', async () => {
  // The PC clock and the server both say June 2040; the server is 250 ms ahead.
  const jumpMs = Date.UTC(2040, 5, 1) - realDateNow();
  const future = await startSntp({ skewMs: jumpMs + 250 });
  Date.now = () => realDateNow() + jumpMs;
  const result = await ntp.measure({ servers: [future.host], timeoutMs: 1000, httpsFallback: false });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 250, 5, 'offset in 2040');
  near(result.at, Date.UTC(2040, 5, 1), 60000, 'at');

  // A PC that is 13 years behind a server is told exactly that (it is not an era mix-up)...
  Date.now = realDateNow;
  const behind = await ntp.measure({ servers: [future.host], timeoutMs: 1000, httpsFallback: false });
  assert.equal(behind.ok, true, behind.error);
  near(behind.offsetMs, jumpMs + 250, 5, 'offset of a PC 13 years behind');

  // ...and so is one that is 13 years ahead of a server with the right time.
  const present = await startSntp({ skewMs: 0 });
  Date.now = () => realDateNow() + jumpMs;
  const ahead = await ntp.measure({ servers: [present.host], timeoutMs: 1000, httpsFallback: false });
  assert.equal(ahead.ok, true, ahead.error);
  near(ahead.offsetMs, -jumpMs, 5, 'offset of a PC 13 years ahead');
});

test('measure: the true offset always lies inside the stated uncertainty, whatever the paths do', async () => {
  const random = seededRandom(31122026);
  for (let round = 0; round < 6; round++) {
    const truth = Math.round((random() - 0.5) * 20000);
    const servers = [];
    for (let i = 0; i < 3; i++) {
      // Every server sits behind its own lopsided path: replies come back up to 30 ms late,
      // differently for each packet, and some servers hold on to requests for a while.
      const holdMs = Math.floor(random() * 12);
      servers.push(await startSntp({
        skewMs: truth,
        plan: () => ({ procDelayMs: holdMs, sendDelayMs: Math.floor(random() * 30) }),
      }));
    }
    const result = await ntp.measure({ servers: servers.map((server) => server.host), timeoutMs: 500, httpsFallback: false });
    assert.equal(result.ok, true, result.error);
    const errorMs = Math.abs(result.offsetMs - truth);
    assert.ok(errorMs <= result.uncertaintyMs,
      'round ' + round + ': off by ' + errorMs + ' ms but claims +/- ' + result.uncertaintyMs + ' ' + JSON.stringify(result.servers));
    assert.ok(result.uncertaintyMs < 100, 'round ' + round + ': uncertainty ' + result.uncertaintyMs);
  }
});

test('measure: a lopsided path shared by every server is covered by the stated uncertainty', async () => {
  // All replies come back 40 ms late (a slow downlink, say). Every server is then wrong by the
  // same 20 ms, so they agree perfectly; only the round-trip time gives the error away.
  for (const count of [1, 3]) {
    const servers = [];
    for (let i = 0; i < count; i++) servers.push(await startSntp({ skewMs: -600, sendDelayMs: 40 }));
    const result = await ntp.measure({ servers: servers.map((server) => server.host), timeoutMs: 1000, httpsFallback: false });
    assert.equal(result.ok, true, result.error);
    const errorMs = Math.abs(result.offsetMs + 600);
    assert.ok(errorMs >= 15 && errorMs <= 26, 'expected to be about 20 ms out, was ' + errorMs);
    assert.ok(result.uncertaintyMs >= errorMs, count + ' server(s): off by ' + errorMs + ' ms but claims +/- ' + result.uncertaintyMs);
    assert.ok(result.uncertaintyMs < 60, 'uncertainty ' + result.uncertaintyMs);
  }
});

test('measure: a lone server that admits to being unsure is not passed off as precise', async () => {
  // Root distance = 0.2 s / 2 + 0.9 s = 1.0 s: under the 1.5 s cut-off, so the server is accepted.
  const vague = await startSntp({ skewMs: 400, rootDelayS: 0.2, rootDispersionS: 0.9 });
  const alone = await ntp.measure({ servers: [vague.host], timeoutMs: 1000, httpsFallback: false });
  assert.equal(alone.ok, true, alone.error);
  near(alone.offsetMs, 400, 5, 'offset');
  // The app only applies a correction that is good to 250 ms; this one is not.
  assert.ok(alone.uncertaintyMs >= 1000 && alone.uncertaintyMs < 1060, 'uncertainty ' + alone.uncertaintyMs);
  assert.deepEqual(Object.keys(alone.servers[0]).sort(), ['delayMs', 'error', 'host', 'offsetMs', 'ok', 'stratum']);

  // Two precise servers that agree with it settle the matter.
  const precise = [await startSntp({ skewMs: 401 }), await startSntp({ skewMs: 399 })];
  const confirmed = await ntp.measure({
    servers: [vague.host, precise[0].host, precise[1].host], timeoutMs: 1000, httpsFallback: false,
  });
  assert.equal(confirmed.ok, true, confirmed.error);
  near(confirmed.offsetMs, 400, 6, 'offset');
  assert.ok(confirmed.uncertaintyMs < 40, 'uncertainty ' + confirmed.uncertaintyMs);
});

test('measure: one machine known under two names gets one vote', async () => {
  const wrong = await startSntp({ skewMs: 3000 });
  const right = await startSntp({ skewMs: 0 });
  const lookup = (hostname, options, callback) => process.nextTick(callback, null, '127.0.0.1', 4);
  const result = await ntp.measure({
    servers: ['time-a.test:' + wrong.port, 'time-b.test:' + wrong.port, 'honest.test:' + right.port],
    lookup,
    timeoutMs: 1000,
    httpsFallback: false,
  });
  assert.equal(result.ok, false, 'a machine with two names outvoted an independent server: ' + result.offsetMs);
  assert.match(result.error, /two sources disagree by (299\d|300\d) ms/);
  assert.deepEqual(result.servers.map((entry) => entry.ok), [true, false, true]);
  assert.equal(result.servers[1].error, 'same machine as time-a.test:' + wrong.port);
  assert.equal(result.servers[1].offsetMs, null);
  assert.equal(wrong.requests, 4, 'the machine is asked under one name only');

  // An address and a name for the same machine are recognised too.
  const mixed = await ntp.measure({
    servers: ['127.0.0.1:' + right.port, 'honest.test:' + right.port], lookup, timeoutMs: 1000, httpsFallback: false,
  });
  assert.equal(mixed.ok, true, mixed.error);
  assert.deepEqual(mixed.servers.map((entry) => entry.ok), [true, false]);
  assert.ok(mixed.uncertaintyMs >= 17, 'one machine is a single source: ' + mixed.uncertaintyMs);

  // The same address on another port is a different server (every other test here relies on it).
  const both = await ntp.measure({
    servers: ['time-a.test:' + right.port, 'time-b.test:' + wrong.port], lookup, timeoutMs: 1000, httpsFallback: false,
  });
  assert.deepEqual(both.servers.map((entry) => entry.ok), [true, true]);
});

test('measure: the backstop ends the wait even when a socket never finishes opening', async () => {
  const tracked = dgram.createSocket;
  const stuck = [];
  dgram.createSocket = () => {
    const socket = new EventEmitter();
    socket.bind = () => {};
    socket.close = () => {
      socket.closed = true;
    };
    stuck.push(socket);
    return socket;
  };
  try {
    const { value: result, elapsedMs } = await timed(() => ntp.measure({
      servers: ['127.0.0.1:9'], overallTimeoutMs: 600, httpsFallback: false,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.method, 'none');
    assert.equal(result.offsetMs, 0);
    assert.equal(result.uncertaintyMs, Infinity);
    assert.equal(result.error, 'timed out');
    // The backstop is set a hair before the limit (585 ms here), so allow for a late timer.
    assert.ok(elapsedMs >= 500 && elapsedMs <= 650, 'settled after ' + elapsedMs + ' ms, limit 600');
    // When the socket does come up afterwards it is closed at once, not left behind.
    assert.equal(stuck.length, 1);
    stuck[0].emit('listening');
    await sleep(10);
    assert.equal(stuck[0].closed, true, 'a socket that opened after the deadline was left open');
  } finally {
    dgram.createSocket = tracked;
  }
});

test('measure: host:port strings, the port option and duplicate servers', async () => {
  const server = await startSntp({ skewMs: 5 });
  const viaPort = await ntp.measure({ servers: ['127.0.0.1'], port: server.port, timeoutMs: 1000, httpsFallback: false });
  assert.equal(viaPort.ok, true, viaPort.error);
  assert.equal(viaPort.servers[0].host, '127.0.0.1');

  const before = server.requests;
  const twice = await ntp.measure({
    servers: [server.host, ' ' + server.host + ' ', server.host], timeoutMs: 1000, httpsFallback: false,
  });
  assert.equal(twice.ok, true);
  assert.equal(twice.servers.length, 1, 'the same server must not get two votes');
  assert.equal(server.requests - before, 4);
});

test('measure: host names go through the injected lookup', async () => {
  const servers = [await startSntp({ skewMs: 10 }), await startSntp({ skewMs: 11 })];
  const lookup = (hostname, options, callback) => {
    if (hostname.startsWith('alive')) process.nextTick(callback, null, '127.0.0.1', 4);
    else offlineLookup(hostname, options, callback);
  };
  const result = await ntp.measure({
    servers: ['alive-a.test:' + servers[0].port, 'alive-b.test:' + servers[1].port, 'gone.test'],
    lookup,
    timeoutMs: 1000,
    httpsFallback: false,
  });
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 10.5, 6, 'offset');
  assert.deepEqual(result.servers.map((entry) => entry.ok), [true, true, false]);
  assert.equal(result.servers[2].error, 'dns: ENOTFOUND');
});

test('measure: nonsense options never throw and fall back to safe values', async () => {
  const server = await startSntp({ skewMs: 33 });
  const result = await ntp.measure({
    servers: [server.host],
    port: 'ntp',
    samples: 'many',
    timeoutMs: -5,
    overallTimeoutMs: NaN,
    enoughServers: {},
    httpsFallback: 'no',
    httpsEndpoints: 'https://example.invalid',
    lookup: 'dns',
  });
  // timeoutMs -5 is clamped to the 50 ms minimum; the local server answers well inside that.
  assert.equal(result.ok, true, result.error);
  near(result.offsetMs, 33, 5, 'offset');
  assert.equal(server.requests, 4, 'samples fell back to the default of 4');

  const capped = await ntp.measure({ servers: [server.host], samples: 1e9, timeoutMs: 1000, httpsFallback: false });
  assert.equal(capped.ok, true);
  assert.equal(server.requests, 4 + 8, 'samples are capped at 8');

  const single = await ntp.measure({ servers: [server.host], samples: 0, timeoutMs: 1000, httpsFallback: false });
  assert.equal(single.ok, true);
  assert.equal(server.requests, 4 + 8 + 1, 'samples below 1 are raised to 1');

  let lookups = 0;
  const lookup = (hostname, options, callback) => {
    lookups++;
    offlineLookup(hostname, options, callback);
  };
  const junk = await ntp.measure({
    servers: [null, 42, {}, '', 'bad host!', '[::1]:123', 'time.example:99999', 'ok-name.test'],
    lookup,
    httpsEndpoints: [null, 7, 'not a url', 'ftp://example.test/time', { url: 5 }],
  });
  assert.equal(junk.ok, false);
  assert.equal(junk.method, 'none');
  assert.equal(junk.offsetMs, 0);
  assert.equal(junk.uncertaintyMs, Infinity);
  assert.equal(junk.servers.length, 8 + 5);
  assert.equal(lookups, 1, 'only the one valid name is looked up');
  for (const entry of junk.servers) {
    assert.equal(entry.ok, false);
    assert.equal(typeof entry.host, 'string');
    assert.ok(typeof entry.error === 'string' && entry.error.length > 0 && entry.error.length < 100);
  }
});

test('measure: with no options it tries the five default servers, then the web, and survives being offline', async () => {
  // Make the system resolver fail at once, so nothing leaves this machine.
  const asked = [];
  dns.lookup = (hostname, options, callback) => {
    asked.push(hostname);
    offlineLookup(hostname, typeof options === 'function' ? {} : options, typeof options === 'function' ? options : callback);
  };
  for (const opts of [undefined, null, 42, 'fast', [], { servers: [] }, { servers: 'time.example' }]) {
    asked.length = 0;
    const { value: result, elapsedMs } = await timed(() => ntp.measure(opts));
    assert.equal(result.ok, false);
    assert.equal(result.method, 'none');
    assert.equal(result.offsetMs, 0);
    assert.equal(result.uncertaintyMs, Infinity);
    assert.equal(typeof result.error, 'string');
    assert.deepEqual(result.servers.slice(0, 5).map((entry) => entry.host), Array.from(ntp.DEFAULT_SERVERS));
    assert.deepEqual(result.servers.slice(0, 5).map((entry) => entry.error), Array(5).fill('dns: ENOTFOUND'));
    assert.deepEqual(result.servers.slice(5).map((entry) => entry.host),
      ['www.cloudflare.com', 'www.google.com', 'www.microsoft.com']);
    assert.deepEqual(result.servers.slice(5).map((entry) => entry.error), Array(3).fill('ENOTFOUND'));
    assert.deepEqual(asked.slice(0, 5), Array.from(ntp.DEFAULT_SERVERS));
    assert.ok(elapsedMs < 2000, 'took ' + elapsedMs + ' ms');
  }
  assert.deepEqual(Array.from(ntp.DEFAULT_SERVERS),
    ['time.cloudflare.com', 'time.google.com', 'time.windows.com', 'pool.ntp.org', 'time.apple.com']);
  assert.ok(Object.isFrozen(ntp.DEFAULT_SERVERS));
  assert.ok(ntp.DEFAULT_HTTPS_ENDPOINTS.every((endpoint) => endpoint.url.startsWith('https://')));
});

test('measure: with no arguments it still settles inside 6 s when the system resolver hangs', async () => {
  // The worst case for the time limit: every name lookup, for the time servers and for the web
  // fallback alike, simply never comes back.
  const countTimers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
  const asked = [];
  const waiting = [];
  dns.lookup = (hostname, options, callback) => {
    asked.push(hostname);
    waiting.push(typeof options === 'function' ? options : callback);
  };
  const timersBefore = countTimers();
  try {
    const { value: result, elapsedMs } = await timed(() => ntp.measure());
    assert.ok(elapsedMs <= 6000, 'settled after ' + elapsedMs + ' ms, limit 6000');
    assert.equal(result.ok, false);
    assert.equal(result.method, 'none');
    assert.equal(result.offsetMs, 0);
    assert.equal(result.uncertaintyMs, Infinity);
    assert.deepEqual(result.servers.map((entry) => entry.error),
      Array(5).fill('dns: timeout').concat(Array(3).fill('no reply in time')));
    assert.deepEqual(asked.slice(0, 5), Array.from(ntp.DEFAULT_SERVERS));
    assert.equal(clientSockets.length, 0, 'no socket is opened before the address is known');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(countTimers(), timersBefore, 'timers still running: ' + process.getActiveResourcesInfo().join(', '));
  } finally {
    // Let the resolver give up at last, so ntp.js stops waiting on these lookups in later tests.
    for (const callback of waiting.splice(0)) callback(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));
    await sleep(5);
  }
});

test('measure: a system resolver that is still busy is not asked again', async () => {
  const asked = [];
  const waiting = [];
  // Node's own UDP code sends literal addresses through dns.lookup as well; those stay real.
  dns.lookup = (hostname, options, callback) => {
    if (net.isIP(hostname)) return realLookup(hostname, options, callback);
    asked.push(hostname);
    waiting.push(callback);
    return undefined;
  };
  const server = await startSntp({ skewMs: 55 });
  const opts = { servers: ['stuck-a.test', 'stuck-b.test'], port: server.port, timeoutMs: 60, httpsFallback: false };
  for (let i = 0; i < 3; i++) {
    const { value: result, elapsedMs } = await timed(() => ntp.measure(opts));
    assert.equal(result.ok, false);
    assert.deepEqual(result.servers.map((entry) => entry.error), ['dns: timeout', 'dns: timeout']);
    assert.ok(elapsedMs < 1000, 'took ' + elapsedMs + ' ms');
  }
  assert.deepEqual(asked, ['stuck-a.test', 'stuck-b.test'], 'three measurements must not queue three lookups per name');

  // The resolver finally gives up. The next measurement asks afresh and uses the new answer.
  for (const callback of waiting.splice(0)) callback(Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }));
  await sleep(5);
  dns.lookup = (hostname, options, callback) => {
    if (net.isIP(hostname)) return realLookup(hostname, options, callback);
    asked.push(hostname);
    process.nextTick(callback, null, '127.0.0.1', 4);
    return undefined;
  };
  const recovered = await ntp.measure(opts);
  assert.equal(recovered.ok, true, recovered.error);
  near(recovered.offsetMs, 55, 5, 'offset');
  assert.deepEqual(asked.slice(2), ['stuck-a.test', 'stuck-b.test']);
});

test('measure: many calls in a row, and several at once, all clean up after themselves', async () => {
  const servers = [await startSntp({ skewMs: 20 }), await startSntp({ skewMs: 21 }), await startSntp({ drop: true })];
  const opts = { servers: servers.map((server) => server.host), timeoutMs: 60, samples: 2, httpsFallback: false };
  for (let i = 0; i < 8; i++) {
    const result = await ntp.measure(opts);
    assert.equal(result.ok, true, result.error);
    near(result.offsetMs, 20.5, 6, 'offset in round ' + i);
  }
  const together = await Promise.all(Array.from({ length: 6 }, () => ntp.measure(opts)));
  for (const result of together) {
    assert.equal(result.ok, true, result.error);
    near(result.offsetMs, 20.5, 8, 'offset in a concurrent call');
  }
  // 14 calls x 3 servers; the afterEach hook checks that every one of these sockets was closed.
  assert.equal(clientSockets.length, 14 * 3);
});

// ------------------------------------------------------------------------------------------------
// HTTPS fallback
// ------------------------------------------------------------------------------------------------

test('parseTraceTimestamp reads the ts= line of a /cdn-cgi/trace body', () => {
  assert.equal(ntp.parseTraceTimestamp(traceBody(1798761600123)), 1798761600123);
  assert.equal(ntp.parseTraceTimestamp('ts=1700000000.123'), 1700000000123);
  assert.equal(ntp.parseTraceTimestamp('fl=1\r\nts=1700000000.5\r\nh=x\r\n'), 1700000000500);
  assert.equal(ntp.parseTraceTimestamp('h=x\nts=1700000000\n'), 1700000000000);
  near(ntp.parseTraceTimestamp('ts=1700000000.123456789'), 1700000000123.456, 0.001);
  for (const bad of ['', 'hello', 'xts=1700000000.123', 'ts=soon', 'ts=12.5', 'ts=', 'ts=1700000000.', 'ts=-1700000000',
    'h=ts=1700000000.123', undefined, null, 1700000000, {}]) {
    assert.ok(Number.isNaN(ntp.parseTraceTimestamp(bad)), JSON.stringify(bad) + ' must not parse');
  }
});

test('parseHttpDate only accepts the standard HTTP date format', () => {
  assert.equal(ntp.parseHttpDate('Thu, 31 Dec 2026 23:59:59 GMT'), Date.UTC(2026, 11, 31, 23, 59, 59));
  assert.equal(ntp.parseHttpDate(new Date(Date.UTC(2027, 0, 1, 0, 0, 0)).toUTCString()), Date.UTC(2027, 0, 1));
  for (const bad of ['', '2026-12-31T23:59:59Z', '2026-12-31 23:59:59', 'Thursday, 31-Dec-26 23:59:59 GMT',
    'Thu Dec 31 23:59:59 2026', 'Thu, 31 Dec 2026 23:59:59 +0100', 'Thu, 31 Dec 2026 23:59:59', undefined, null, 5, ['x']]) {
    assert.ok(Number.isNaN(ntp.parseHttpDate(bad)), JSON.stringify(bad) + ' must not parse');
  }
});

test('fallback: when no time server answers, the ts= line of a trace page gives the time', async () => {
  const silent = await startSntp({ drop: true });
  const web = await startWeb({ skewMs: -4321 });
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: [silent.host], timeoutMs: 60, httpsEndpoints: [web.base + '/cdn-cgi/trace'],
  }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  assert.equal(result.error, null);
  near(result.offsetMs, -4321, 30, 'offset');
  assert.ok(Math.abs(result.offsetMs + 4321) <= result.uncertaintyMs, 'the truth lies inside the stated bound');
  assert.ok(result.uncertaintyMs >= 17 && result.uncertaintyMs < 200, 'uncertainty ' + result.uncertaintyMs);
  assert.equal(result.servers.length, 2);
  assert.equal(result.servers[0].error, 'timeout');
  assert.deepEqual(Object.keys(result.servers[1]).sort(), ['delayMs', 'error', 'host', 'offsetMs', 'ok', 'stratum']);
  assert.equal(result.servers[1].host, web.base.replace('http://', ''));
  assert.equal(result.servers[1].ok, true);
  assert.equal(result.servers[1].stratum, null);
  assert.deepEqual(web.hits, ['GET /cdn-cgi/trace']);
  assert.ok(elapsedMs < 1500, 'took ' + elapsedMs + ' ms');
});

test('fallback: Date headers are a last resort with at least 600 ms of uncertainty', async () => {
  const sites = [await startWeb({ skewMs: 30000 }), await startWeb({ skewMs: 30000, status: 503 })];
  const result = await ntp.measure({
    servers: ['not a server!'],
    httpsEndpoints: [sites[0].base + '/', { url: sites[1].base + '/generate_204', kind: 'date' }],
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  // A Date header only has whole seconds, so the estimate can be up to half a second out.
  near(result.offsetMs, 30000, 600, 'offset');
  assert.ok(result.uncertaintyMs >= 600 && result.uncertaintyMs < 700, 'uncertainty ' + result.uncertaintyMs);
  assert.ok(Math.abs(result.offsetMs - 30000) <= result.uncertaintyMs);
  assert.deepEqual(sites[0].hits, ['HEAD /']);
  assert.deepEqual(sites[1].hits, ['HEAD /generate_204'], 'any status will do: the Date header is what counts');
  assert.deepEqual(result.servers.map((entry) => entry.ok), [false, true, true]);
});

test('fallback: a millisecond timestamp is preferred over Date headers', async () => {
  const trace = await startWeb({ skewMs: 1000, delayMs: 40 });
  const coarse = await startWeb({ skewMs: 9000 });
  const hanging = await startWeb({ hang: true });
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: ['not a server!'],
    httpsEndpoints: [coarse.base + '/', hanging.base + '/', trace.base + '/cdn-cgi/trace'],
    overallTimeoutMs: 3000,
  }));
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  near(result.offsetMs, 1000, 30, 'offset');
  assert.ok(result.uncertaintyMs < 200);
  // The precise answer ends the wait: nobody hangs around for the slow coarse site.
  assert.ok(elapsedMs < 1500, 'took ' + elapsedMs + ' ms');
  assert.equal(result.servers[2].error, 'not needed');
});

test('fallback: a trace page without a timestamp still offers its Date header', async () => {
  const web = await startWeb({ skewMs: -20000, body: '<html>moved</html>' });
  const result = await ntp.measure({ servers: ['not a server!'], httpsEndpoints: [web.base + '/cdn-cgi/trace'] });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  near(result.offsetMs, -20000, 600, 'offset');
  assert.ok(result.uncertaintyMs >= 600);

  // An error page with a ts= line in it is not a trace page.
  const errorPage = await startWeb({ skewMs: 50000, status: 500, date: false });
  const refused = await ntp.measure({ servers: ['not a server!'], httpsEndpoints: [errorPage.base + '/cdn-cgi/trace'] });
  assert.equal(refused.ok, false);
  assert.match(refused.servers[1].error, /no usable Date header/);
});

test('fallback: stale, implausible or contradictory web answers are not trusted', async () => {
  const cached = await startWeb({ skewMs: 0, age: 120 });
  const fromCache = await ntp.measure({
    servers: ['not a server!'], httpsEndpoints: [cached.base + '/cdn-cgi/trace', cached.base + '/'],
  });
  assert.equal(fromCache.ok, false);
  assert.deepEqual(fromCache.servers.slice(1).map((entry) => entry.error), ['cached response', 'cached response']);

  const ancient = await startWeb({ skewMs: Date.UTC(1999, 11, 31) - trueNow() });
  const fromThePast = await ntp.measure({
    servers: ['not a server!'], httpsEndpoints: [ancient.base + '/cdn-cgi/trace', ancient.base + '/'],
  });
  assert.equal(fromThePast.ok, false);
  assert.deepEqual(fromThePast.servers.slice(1).map((entry) => entry.error),
    ['implausible server time', 'implausible server time']);

  const sites = [await startWeb({ skewMs: 0 }), await startWeb({ skewMs: 30000 })];
  const split = await ntp.measure({
    servers: ['not a server!'], httpsEndpoints: [sites[0].base + '/', sites[1].base + '/'],
  });
  assert.equal(split.ok, false);
  assert.equal(split.method, 'none');
  assert.match(split.error, /disagree/);

  // Three sites: the odd one out is flagged and the other two carry the vote.
  const third = await startWeb({ skewMs: 0 });
  const voted = await ntp.measure({
    servers: ['not a server!'], httpsEndpoints: [sites[0].base + '/', sites[1].base + '/', third.base + '/'],
  });
  assert.equal(voted.ok, true, voted.error);
  near(voted.offsetMs, 0, 600, 'offset');
  assert.match(voted.servers[2].error, /^outlier/);
});

test('fallback: unreachable and hanging endpoints fail inside the time limit', async () => {
  const silent = await startSntp({ drop: true });
  const hanging = await startWeb({ hang: true });
  const closedPort = await freeTcpPort();
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: [silent.host],
    timeoutMs: 60,
    overallTimeoutMs: 700,
    httpsEndpoints: [hanging.base + '/cdn-cgi/trace', 'http://127.0.0.1:' + closedPort + '/'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.method, 'none');
  assert.equal(result.error, 'no internet time source answered');
  assert.deepEqual(result.servers.map((entry) => entry.error), ['timeout', 'no reply in time', 'ECONNREFUSED']);
  assert.ok(elapsedMs <= 700, 'settled after ' + elapsedMs + ' ms, limit 700');
});

test('fallback: a system clock step while the web request is out does not corrupt the result', async () => {
  const stepMs = -5000;
  const web = await startWeb({ skewMs: 777, delayMs: 30 });
  // The PC clock is set back 5 s while the request is on its way.
  const stepper = setTimeout(() => {
    Date.now = () => realDateNow() + stepMs;
  }, 12);
  const result = await ntp.measure({ servers: ['not a server!'], httpsEndpoints: [web.base + '/cdn-cgi/trace'] });
  clearTimeout(stepper);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  assert.notEqual(Date.now, realDateNow, 'the clock was stepped during the request');
  // The page is stamped when the reply leaves, 30 ms after the request arrived, so the estimate
  // is up to half the round trip out; the stated uncertainty has to cover that.
  near(result.offsetMs, 777 - stepMs, 40, 'offset relative to the clock as it is now');
  near(Date.now() + result.offsetMs, trueNow() + 777, 40, 'corrected clock');
  assert.ok(Math.abs(result.offsetMs - (777 - stepMs)) <= result.uncertaintyMs, 'inside the stated bound');
  assert.ok(result.servers[1].delayMs < 200, 'the jump must not look like network delay: ' + result.servers[1].delayMs);
});

test('fallback: a response that stalls or never ends is cut off, and no connection is left open', async () => {
  const open = new Set();
  const startRaw = async (handler) => {
    const server = http.createServer(handler);
    server.on('connection', (socket) => {
      open.add(socket);
      socket.once('close', () => open.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    }));
    return 'http://127.0.0.1:' + server.address().port;
  };
  // Headers at once, then a body that never finishes.
  const stalled = await startRaw((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.write('fl=1\n');
  });
  // A body far over the size limit, with a tempting timestamp at the very end.
  const bloated = await startRaw((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('x'.repeat(100000) + '\nts=' + ((trueNow() + 5000) / 1000).toFixed(3) + '\n');
  });
  const mute = await startRaw(() => {});
  const { value: result, elapsedMs } = await timed(() => ntp.measure({
    servers: ['not a server!'],
    overallTimeoutMs: 500,
    httpsEndpoints: [stalled + '/cdn-cgi/trace', bloated + '/cdn-cgi/trace', mute + '/'],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.method, 'none');
  assert.deepEqual(result.servers.slice(1).map((entry) => entry.error),
    ['no reply in time', 'response too large', 'no reply in time']);
  assert.ok(elapsedMs <= 500, 'settled after ' + elapsedMs + ' ms, limit 500');
  await sleep(30);
  assert.equal(open.size, 0, open.size + ' connections to the web servers were left open');
});

test('fallback: not used when a time server answers or when it is switched off', async () => {
  const web = await startWeb({ skewMs: 0 });
  const server = await startSntp({ skewMs: 12 });
  const viaNtp = await ntp.measure({ servers: [server.host], timeoutMs: 1000, httpsEndpoints: [web.base + '/cdn-cgi/trace'] });
  assert.equal(viaNtp.ok, true);
  assert.equal(viaNtp.method, 'ntp');
  assert.equal(viaNtp.servers.length, 1);

  const silent = await startSntp({ drop: true });
  const off = await ntp.measure({
    servers: [silent.host], timeoutMs: 60, httpsFallback: false, httpsEndpoints: [web.base + '/cdn-cgi/trace'],
  });
  assert.equal(off.ok, false);
  assert.equal(off.method, 'none');
  assert.equal(off.servers.length, 1);
  assert.equal(web.hits.length, 0);
});

test('fallback over real TLS: the handshake is not counted as delay, and certificates are checked', async (t) => {
  // A throwaway certificate for 127.0.0.1. No openssl on this machine: nothing to test with.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-ntp-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  const made = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-keyout', keyFile, '-out', certFile, '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  if (made.error || made.status !== 0 || !fs.existsSync(certFile)) {
    t.skip('openssl is not available to make a test certificate');
    return;
  }
  const skewMs = 2500;
  const stallMs = 250;
  // The web server sits behind a relay that holds the first bytes back, which makes the TLS
  // handshake slow while the request itself stays fast.
  const script = `
    const fs = require('fs');
    const https = require('https');
    const net = require('net');
    const ntp = require(${JSON.stringify(NTP_MODULE)});
    const web = https.createServer({ key: fs.readFileSync(${JSON.stringify(keyFile)}), cert: fs.readFileSync(${JSON.stringify(certFile)}) },
      (req, res) => res.end('h=x\\nts=' + ((Date.now() + ${skewMs}) / 1000).toFixed(3) + '\\n'));
    web.listen(0, '127.0.0.1', () => {
      const relay = net.createServer((client) => {
        const upstream = net.connect(web.address().port, '127.0.0.1');
        client.pause();
        setTimeout(() => {
          client.pipe(upstream);
          upstream.pipe(client);
        }, ${stallMs});
        client.on('error', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
        client.on('close', () => upstream.destroy());
        upstream.on('close', () => client.destroy());
      });
      relay.listen(0, '127.0.0.1', async () => {
        const result = await ntp.measure({
          servers: ['not a server!'],
          httpsEndpoints: ['https://127.0.0.1:' + relay.address().port + '/cdn-cgi/trace'],
        });
        console.log(JSON.stringify(result));
        relay.close();
        web.close();
      });
    });
  `;

  const trusted = await runNode(script, plainEnv({ NODE_EXTRA_CA_CERTS: certFile }));
  assert.equal(trusted.code, 0, trusted.stderr);
  assert.equal(trusted.killed, false, 'the process did not exit on its own');
  const result = JSON.parse(trusted.stdout);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.method, 'https');
  near(result.offsetMs, skewMs, 40, 'offset');
  assert.ok(result.servers[1].delayMs < stallMs - 100,
    'the ' + stallMs + ' ms handshake leaked into the round trip: ' + result.servers[1].delayMs + ' ms');
  assert.ok(result.uncertaintyMs < 100, 'uncertainty ' + result.uncertaintyMs);

  // Same server, but its certificate is not trusted: the answer must be refused.
  const untrusted = await runNode(script, plainEnv({}));
  assert.equal(untrusted.code, 0, untrusted.stderr);
  const refused = JSON.parse(untrusted.stdout);
  assert.equal(refused.ok, false);
  assert.equal(refused.method, 'none');
  assert.match(refused.servers[1].error, /SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
});

// ------------------------------------------------------------------------------------------------
// Leaks
// ------------------------------------------------------------------------------------------------

test('measure leaves no timers behind', async () => {
  const silent = await startSntp({ drop: true });
  const good = await startSntp({ skewMs: 1 });
  const more = [await startSntp({ skewMs: 2 }), await startSntp({ skewMs: 0 })];
  const slow = await startSntp({ skewMs: 1, sendDelayMs: 25 });
  const hanging = await startWeb({ hang: true });
  const trace = await startWeb({ skewMs: 1 });
  const countTimers = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
  await sleep(20);
  const before = countTimers();
  await ntp.measure({ servers: [silent.host, good.host], timeoutMs: 80, httpsFallback: false });
  await ntp.measure({ servers: [silent.host], timeoutMs: 60, overallTimeoutMs: 400, httpsEndpoints: [hanging.base + '/'] });
  await ntp.measure({ servers: ['slow-dns.test'], lookup: () => {}, timeoutMs: 60, httpsFallback: false });
  // Stopped early because enough servers answered (the grace timer), and a precise web answer
  // that ends the wait for a hanging endpoint.
  const early = await ntp.measure({
    servers: [silent.host, good.host, more[0].host, more[1].host], timeoutMs: 2000, httpsFallback: false,
  });
  assert.match(early.servers[0].error, /stopped early/);
  const viaWeb = await ntp.measure({
    servers: [silent.host], timeoutMs: 60, httpsEndpoints: [hanging.base + '/', trace.base + '/cdn-cgi/trace'],
  });
  assert.equal(viaWeb.method, 'https');
  assert.equal(viaWeb.servers[1].error, 'not needed');
  // A slow server that finishes by itself inside the grace period: the grace timer is still
  // pending when the measurement ends and has to be cleared.
  const inGrace = await ntp.measure({
    servers: [slow.host, good.host, more[0].host, more[1].host], timeoutMs: 2000, httpsFallback: false,
  });
  assert.deepEqual(inGrace.servers.map((entry) => entry.ok), [true, true, true, true]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(countTimers(), before, 'timers still running: ' + process.getActiveResourcesInfo().join(', '));
});

test('a process that only calls measure() exits on its own (no leaked handles)', async () => {
  const closedPort = await freeTcpPort();
  const script = `
    const ntp = require(${JSON.stringify(NTP_MODULE)});
    (async () => {
      const results = [];
      for (let i = 0; i < 3; i++) {
        results.push(await ntp.measure({
          servers: ['127.0.0.1:${closedPort}', '127.0.0.1:${closedPort + 1}', 'never-resolves.test'],
          lookup: () => {},
          timeoutMs: 70,
          overallTimeoutMs: 900,
          httpsEndpoints: ['http://127.0.0.1:${closedPort}/cdn-cgi/trace', 'http://127.0.0.1:${closedPort}/'],
        }));
      }
      await new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
      console.log(JSON.stringify({
        methods: results.map((result) => result.method),
        sources: results.map((result) => result.servers.length),
        resources: process.getActiveResourcesInfo(),
      }));
    })();
  `;
  const started = performance.now();
  const outcome = await runNode(script, process.env);
  assert.equal(outcome.killed, false, 'the process had to be killed: something kept it alive');
  assert.equal(outcome.code, 0, outcome.stderr);
  const report = JSON.parse(outcome.stdout);
  assert.deepEqual(report.methods, ['none', 'none', 'none']);
  assert.deepEqual(report.sources, [5, 5, 5]);
  const leaked = report.resources.filter((name) => /udp|tcp|timeout|addrinfo/i.test(name));
  assert.deepEqual(leaked, [], 'left behind: ' + report.resources.join(', '));
  assert.ok(performance.now() - started < 8000, 'the process took too long to exit');
});
