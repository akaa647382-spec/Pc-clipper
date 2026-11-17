'use strict';
// The settings store and the restart helper: what a power cut, an empty battery or a shutdown leaves behind.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Store, writeDurable } = require('../../main/store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ap-store-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a save reaches the disk whole and reads back', () => {
  const dir = tmp();
  const s = new Store(dir);
  assert.strictEqual(s.set({ renderer: { armed: true, armedTarget: 123 } }), true);
  assert.deepStrictEqual(new Store(dir).get(), { renderer: { armed: true, armedTarget: 123 } });
  assert.ok(!fs.existsSync(path.join(dir, 'settings.json.tmp')), 'no temp file left behind');
});

test('writeDurable writes the whole text', () => {
  const dir = tmp();
  const f = path.join(dir, 'x');
  const text = 'é'.repeat(200000);
  writeDurable(f, text);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), text);
});

test('a settings file zeroed or cut short by a power cut: the backup is used', () => {
  for (const damage of ['zeroed', 'cut short', 'empty']) {
    const dir = tmp();
    const s = new Store(dir);
    s.set({ renderer: { armed: true, n: 1 } });
    s.set({ renderer: { armed: true, n: 2 } });       // settings.json.bak now holds n: 1
    const f = path.join(dir, 'settings.json');
    const len = fs.statSync(f).size;
    if (damage === 'zeroed') fs.writeFileSync(f, Buffer.alloc(len));
    else if (damage === 'cut short') fs.writeFileSync(f, fs.readFileSync(f, 'utf8').slice(0, Math.floor(len / 2)));
    else fs.writeFileSync(f, '');
    const back = new Store(dir).get();
    assert.strictEqual(back.renderer && back.renderer.armed, true, damage + ': still armed');
    assert.strictEqual(back.renderer.n, 1, damage + ': the last good copy');
  }
});

test('a damaged settings file is never copied over the good backup', () => {
  const dir = tmp();
  const s = new Store(dir);
  s.set({ renderer: { armed: true, n: 1 } });
  s.set({ renderer: { armed: true, n: 2 } });
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, Buffer.alloc(40));               // damaged on disk
  const t = new Store(dir);                            // starts from the backup (n: 1)
  // A save that fails half way (here: the rename is made impossible) must leave the backup as it was.
  fs.mkdirSync(path.join(dir, 'settings.json.tmp'));   // a directory where the temp file goes: the write fails
  assert.strictEqual(t.set({ renderer: { armed: true, n: 3 } }), false);
  fs.rmdirSync(path.join(dir, 'settings.json.tmp'));
  assert.strictEqual(new Store(dir).get().renderer.n, 1, 'the backup still holds the last good settings');
  // The next good save replaces the damaged file; the damaged one does not become the backup.
  assert.strictEqual(t.set({ renderer: { armed: true, n: 4 } }), true);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json.bak'), 'utf8')).renderer.n, 1);
  assert.strictEqual(new Store(dir).get().renderer.n, 4);
});

/**
 * Runs watchdog.js against a stand-in "app" (a sleeping Node process) and a stand-in relaunch
 * (a Node script that writes down the arguments it was started with).
 */
async function runWatchdog({ markers = [], mode = null, armed = true, killAfter = 300, waitMs = 3500 }) {
  const dir = tmp();
  const target = Date.now() + 3600000;
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ renderer: { armed: armed, armedTarget: target, armedEnd: target + 600000 } }));
  for (const m of markers) fs.writeFileSync(path.join(dir, m), 'x');
  const started = path.join(dir, 'started.json');
  const relaunchScript = path.join(dir, 'relaunch.js');
  fs.writeFileSync(relaunchScript, 'require("fs").writeFileSync(' + JSON.stringify(started) + ', JSON.stringify({ args: process.argv.slice(2), at: Date.now() }));');
  const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  const relaunch = { exe: process.execPath, args: [relaunchScript], cwd: dir };
  const args = [path.join(__dirname, '..', '..', 'main', 'watchdog.js'), String(app.pid), dir, JSON.stringify(relaunch)];
  if (mode) args.push(JSON.stringify(mode));
  const dog = spawn(process.execPath, args, { stdio: 'ignore' });
  await sleep(killAfter);
  const killedAt = Date.now();
  app.kill('SIGKILL');
  await sleep(waitMs);
  try { dog.kill('SIGKILL'); } catch (e) { /* gone */ }
  const log = (() => { try { return fs.readFileSync(path.join(dir, 'avengers-player.log'), 'utf8'); } catch (e) { return ''; } })();
  const out = fs.existsSync(started) ? JSON.parse(fs.readFileSync(started, 'utf8')) : null;
  return { out, killedAt, log };
}

test('watchdog: after a crash the app is started again with --recovered', async () => {
  const r = await runWatchdog({});
  assert.ok(r.out, 'started again');
  assert.deepStrictEqual(r.out.args, ['--recovered']);
});

test('watchdog: Windows ending the session, the power cut test, a deliberate quit: no restart', async () => {
  for (const m of ['session-end', 'power-drill', 'clean-exit']) {
    const r = await runWatchdog({ markers: [m], waitMs: 2500 });
    assert.strictEqual(r.out, null, m + ': must not start the app');
  }
});

test('watchdog in power cut mode: waits as long as the PC is "off", then starts the app with no arguments', async () => {
  const r = await runWatchdog({ mode: { powerCut: 2000 }, waitMs: 4000 });
  assert.ok(r.out, 'started again');
  assert.deepStrictEqual(r.out.args, [], 'no --recovered: exactly as Windows starts it at sign-in');
  const after = r.out.at - r.killedAt;
  assert.ok(after >= 1900 && after < 3500, 'started ' + after + ' ms after the cut');
  assert.match(r.log, /power cut test: the PC is "back on"/);
});

test('watchdog in power cut mode: nothing is started when the countdown is no longer armed', async () => {
  const r = await runWatchdog({ mode: { powerCut: 1000 }, armed: false, waitMs: 2500 });
  assert.strictEqual(r.out, null);
});

const { classifyLastRun } = require('../../main/lastrun.js');

test('how the last run ended: power cut, empty battery, shutdown, killed, crash, quit', () => {
  const T = Date.parse('2026-12-31T22:00:00Z');
  const base = { clean: false, recovered: false, shutdownAt: NaN, lastAlive: T, drill: null };
  // The PC started after the app was last seen running: it went off (a power cut, an empty battery, the power button).
  assert.strictEqual(classifyLastRun({ ...base, bootedAt: T + 4 * 60000 }).ended, 'cut');
  // The PC kept running: the app was ended (Task Manager) or froze.
  assert.strictEqual(classifyLastRun({ ...base, bootedAt: T - 3 * 3600000 }).ended, 'killed');
  // Windows said the session was ending.
  assert.strictEqual(classifyLastRun({ ...base, shutdownAt: T + 1000, bootedAt: T + 60000 }).ended, 'shutdown');
  // A shutdown with Fast Startup keeps the old uptime: still a shutdown, by the marker.
  assert.strictEqual(classifyLastRun({ ...base, shutdownAt: T + 1000, bootedAt: T - 86400000 }).ended, 'shutdown');
  // Crash restarted by the watchdog, and a quit on purpose.
  assert.strictEqual(classifyLastRun({ ...base, recovered: true, bootedAt: T - 1e6 }).ended, 'watchdog');
  assert.strictEqual(classifyLastRun({ ...base, clean: true, bootedAt: T - 1e6 }).ended, 'clean');
  // The power cut test (the PC did not really go off): reported as the test.
  const d = classifyLastRun({ ...base, drill: { at: T, offMs: 30000 }, bootedAt: T - 1e6 });
  assert.strictEqual(d.ended, 'cut');
  assert.deepStrictEqual(d.drill, { at: T, offMs: 30000 });
  // Nothing says when it last ran: cannot tell, so the PC is taken to have gone off.
  assert.strictEqual(classifyLastRun({ ...base, lastAlive: NaN, bootedAt: T }).ended, 'cut');
  assert.strictEqual(classifyLastRun({ ...base, lastAlive: NaN, bootedAt: T }).lastAlive, null);
});
