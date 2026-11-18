'use strict';
/* global scp */
// Speed Clip Poster window. All data comes from the main process (window.scp); this file only draws.

let S = null; // latest state
let tab = 'now';
let pendingFile = null; // clip chosen but not checked yet

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (p) => (p == null || !Number.isFinite(p) ? '–' : Math.round(p * 100) + '%');
const tz = () => (S && S.settings.tz) || undefined;

/** "today", "tomorrow" or "Fri, Nov 20", in your time zone. */
function dayWord(ms) {
  const dayOf = (x) => new Date(x).toLocaleDateString('en-CA', { timeZone: tz() });
  if (dayOf(ms) === dayOf(Date.now())) return 'today';
  if (dayOf(ms) === dayOf(Date.now() + 86400e3)) return 'tomorrow';
  return new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz() });
}
function fmtTime(ms, withDay) {
  if (!Number.isFinite(ms)) return '–';
  const time = new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz() });
  return withDay ? time + ' ' + dayWord(ms) : time;
}
function fmtDate(ms) {
  return Number.isFinite(ms) ? new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz() }) : '–';
}
function fmtDur(ms) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const s = Math.floor((ms % 60e3) / 1000);
  let out = h ? h + ' h ' + String(m).padStart(2, '0') + ' min' : m ? m + ' min ' + String(s).padStart(2, '0') + ' s' : s + ' s';
  if (h >= 48) out = Math.round(h / 24) + ' days';
  return (neg ? '-' : '') + out;
}
function ago(ms) {
  if (!ms) return 'never';
  const d = Date.now() - ms;
  if (d < 60e3) return 'just now';
  return fmtDur(d).replace(/ \d+ s$/, '') + ' ago';
}

function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), bad ? 7000 : 3500);
}

async function act(promise, okMsg) {
  const r = await promise;
  if (r && r.error) {
    toast(r.error, true);
    return null;
  }
  if (okMsg) toast(okMsg);
  return r;
}

/** Skip re-rendering a tab while you are typing in it. */
function editing(section) {
  const a = document.activeElement;
  return a && section.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}

// ---------------------------------------------------------------------------
// Tab: when to post
// ---------------------------------------------------------------------------

function renderNow() {
  const el = $('#tab-now');
  const p = S.prediction || {};
  const banners = [];
  if (!S.hasKey) banners.push('<div class="banner"><b>Add a free YouTube API key</b> to load Speed\'s stream history. Without it the app only sees "live now", so it cannot predict. <a data-go="settings">Settings → YouTube key</a> (5 minutes).</div>');
  else if (S.historyBusy) banners.push('<div class="banner"><span class="spinner"></span>Loading his stream history… ' + S.historyBusy.found + ' streams found so far.</div>');
  else if (S.historyError) banners.push('<div class="banner bad">History could not load: ' + esc(S.historyError) + '</div>');
  if (S.lastCheck && S.lastCheck.error) banners.push('<div class="banner bad">Last YouTube check failed ' + ago(S.lastCheck.errorAt) + ': ' + esc(S.lastCheck.error) + '</div>');
  if (S.calibrating) banners.push('<div class="banner"><span class="spinner"></span>Calibrating on his history… ' + Math.round((100 * S.calibrating.done) / S.calibrating.total) + '%</div>');

  let card;
  if (p.status === 'live') {
    card = `<div class="status live"><div class="label">Right now</div><div class="big">SPEED IS LIVE</div>
      <div class="sub">${S.lastCheck && S.lastCheck.live && S.lastCheck.live.title ? esc(S.lastCheck.live.title) : 'On YouTube.'} If the clips channel is still open, post now. If it is locked, log the lock below and wait for the next one.</div></div>`;
  } else if (p.status === 'post-now') {
    card = `<div class="status post-now"><div class="label">Do it now</div><div class="big">POST NOW</div>
      <div class="sub">${pct(p.within.h2)} chance he is live within 2 h. Chance the clips are already locked: ${pct(p.chanceLockedAtPost)}.</div></div>`;
  } else if (p.status === 'wait' && p.postAt) {
    card = `<div class="status wait"><div class="label">Post at</div><div class="big">${fmtTime(p.postAt, true)}</div>
      <div class="sub">in <span class="countdown" data-until="${p.postAt}">${fmtDur(p.postAt - Date.now())}</span> · then a ${pct(p.chanceLockedAtPost)} chance the clips are already locked (your risk setting is ${pct(p.risk)})</div></div>`;
  } else if (p.status === 'not-soon') {
    card = `<div class="status not-soon"><div class="label">Not likely in the next ${p.sessionHours} h</div><div class="big">${p.start && p.start.median ? 'Next likely: ' + fmtTime(p.start.median, true) : 'No pattern yet'}</div>
      <div class="sub">${pct(p.chanceThisSession)} chance he goes live in the next ${p.sessionHours} h. ${p.postAt ? 'Rough post time for that: <b>' + fmtTime(p.postAt, true) + '</b>.' : ''} Don't post now: it would be buried before he gets to it. You'll get an alert.</div></div>`;
  } else {
    card = `<div class="status not-soon"><div class="big">No prediction yet</div><div class="sub">${esc(p.error || 'Waiting for data.')}</div></div>`;
  }

  let details = '';
  if (p.status && p.status !== 'live' && p.start) {
    const lockTxt = p.lock.learned ? 'learned from your ' + p.lock.samples + ' logged locks' : 'a guess until you log 3 locks';
    details = `<div class="panel">
      <div class="row" style="justify-content:space-between"><b>Next stream</b>
        <span>Confidence <span class="badge ${p.confidence}">${{ high: 'high: scheduled on YouTube', medium: 'medium', low: 'low', none: 'none: not enough history' }[p.confidence]}</span></span></div>
      <div class="stats">
        <div class="stat"><div class="v">${pct(p.within.h2)}</div><div class="k">live within 2 h</div></div>
        <div class="stat"><div class="v">${pct(p.within.h6)}</div><div class="k">live within 6 h</div></div>
        <div class="stat"><div class="v">${pct(p.within.h24)}</div><div class="k">live within 24 h</div></div>
        <div class="stat"><div class="v">${p.start.median ? fmtTime(p.start.median) : '–'}</div><div class="k">most likely start${p.start.median ? ', ' + dayWord(p.start.median) : ''}</div></div>
      </div>
      <p class="dim">Middle half of the guesses: ${fmtTime(p.start.p25, true)} to ${fmtTime(p.start.p75, true)}.
        Mods lock the clips about <b>${Math.round(p.lock.medianMin)} min</b> before he goes live (${lockTxt})${p.predictedLockAt ? ', so the lock is most likely around <b>' + fmtTime(p.predictedLockAt, true) + '</b>' : ''}.
        ${p.source === 'scheduled' ? 'Based on a stream scheduled on YouTube.' : 'Based on when he usually goes live' + (p.calibrated ? ', calibrated on his history.' : ' (not calibrated yet).')}</p>
      ${chart(p)}
    </div>`;
  }

  const queued = S.clips.filter((c) => c.status === 'queued');
  const queue = `<div class="panel"><div class="row" style="justify-content:space-between"><b>Clips waiting for the moment (${queued.length})</b>
      <button class="btn small" data-go="check">Check a clip</button></div>
    ${queued.length ? '<ul class="items">' + queued.map((c) => `<li class="${c.result.verdict === 'post' ? 'ok' : c.result.verdict === 'dont' ? 'block' : 'warn'}"><span class="ic">${c.result.verdict === 'post' ? '✓' : '!'}</span>
      <div class="row" style="justify-content:space-between"><span>${esc(c.facts.fileName)} <span class="faint">${esc(c.result.headline)}</span></span>
      <span class="row"><button class="btn small" data-show="${c.id}">Show file</button><button class="btn small primary" data-posted="${c.id}">I posted it</button><button class="btn small" data-unqueue="${c.id}">Remove</button></span></div></li>`).join('') + '</ul>' : '<p class="dim">None. Check a clip and press "Wait for the moment" to have it listed here when the alert fires.</p>'}
  </div>`;

  const lc = S.lastCheck;
  const footer = `<div class="panel row" style="justify-content:space-between">
      <div><button class="btn big primary" data-lock>Clips just got locked</button>
        <span class="faint" style="margin-left:8px">Press this the moment the mods lock the clips channel. It teaches the app the lock timing.</span></div>
    </div>
    <p class="faint">Checked YouTube ${lc ? ago(lc.at) + (lc.via === 'page' ? ' (no key: live/scheduled only)' : '') : 'not yet'} · ${S.streamCount} past streams known · <button class="linkbtn" data-poll>check now</button></p>`;

  el.innerHTML = banners.join('') + card + details + queue + footer;
}

function chart(p) {
  const pts = p.curve || [];
  if (!pts.length) return '';
  const W = 900, H = 150, top = 14, bottom = 22;
  const max = Math.max(0.05, ...pts.map((x) => x.p));
  const bw = W / pts.length;
  let bars = '';
  pts.forEach((x, i) => {
    const h = ((H - top - bottom) * x.p) / max;
    bars += `<rect class="bar" x="${(i * bw + 1).toFixed(1)}" y="${(H - bottom - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${fmtTime(x.t, true)}: ${(x.p * 100).toFixed(1)}%</title></rect>`;
  });
  let axis = '';
  pts.forEach((x, i) => {
    if (i % 6 === 0) axis += `<text class="axis" x="${(i * bw).toFixed(1)}" y="${H - 6}">${esc(new Date(x.t).toLocaleTimeString([], { hour: 'numeric', timeZone: tz() }))}</text>`;
  });
  let mark = '';
  if (p.postAt && p.postAt < pts[0].t + pts.length * 3600e3) {
    const x = ((p.postAt - pts[0].t) / 3600e3) * bw;
    mark = `<line class="postline" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${top - 4}" y2="${H - bottom}"></line><text class="locktxt" x="${(x + 4).toFixed(1)}" y="${top + 4}">post</text>`;
  }
  return `<p class="faint" style="margin-top:12px">Chance he goes live in each hour, next 48 h:</p><svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${bars}${axis}${mark}</svg>`;
}

// ---------------------------------------------------------------------------
// Tab: check a clip
// ---------------------------------------------------------------------------

function renderCheckShell() {
  const el = $('#tab-check');
  if (el.dataset.ready) return;
  el.dataset.ready = '1';
  el.innerHTML = `
    <h2>Check a clip</h2>
    <div class="drop" id="drop"><strong>Drop a clip here</strong> or click to pick one<div class="faint" id="picked"></div></div>
    <div class="field"><label for="caption">The message you'll post with it (optional)</label>
      <textarea id="caption" placeholder="e.g. speed would lose it at this"></textarea>
      <div class="help">Checked too: links, @handles, "speed react", slurs.</div></div>
    <div class="row"><button class="btn primary" id="go" disabled>Check it</button><span class="faint" id="ffnote"></span></div>
    <div id="checkProgress"></div>
    <h3>Checked clips</h3>
    <div id="clipList"></div>`;
  const drop = $('#drop');
  drop.addEventListener('click', async () => {
    const f = await scp.pickClip();
    if (f && !f.error) setPending(f);
  });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) setPending(scp.pathForFile(f));
  });
  $('#go').addEventListener('click', async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    $('#go').disabled = true;
    const r = await act(scp.analyze(file, $('#caption').value));
    if (r) {
      pendingFile = null;
      $('#picked').textContent = '';
      $('#caption').value = '';
    }
    $('#go').disabled = !pendingFile;
  });
}

function setPending(file) {
  pendingFile = file;
  $('#picked').textContent = file;
  $('#go').disabled = !file;
}

function renderCheck() {
  renderCheckShell();
  $('#ffnote').innerHTML = S.ffmpegPath ? '' : 'FFmpeg is needed to check clips. <a data-go="settings">Get it in Settings</a>.';
  $('#checkProgress').innerHTML = S.analyzing ? `<div class="progress"><span class="spinner"></span>${esc(S.analyzing.file)}: ${esc(S.analyzing.step)}…</div>` : '';
  const list = $('#clipList');
  if (editing(list)) return;
  list.innerHTML = S.clips.length ? S.clips.map(clipCard).join('') : '<p class="dim">No clips checked yet.</p>';
}

function clipCard(c) {
  const r = c.result;
  const f = c.facts;
  const sizeBlock = r.items.some((i) => (i.rule === 'upload' && i.level === 'block') || (i.rule === 'embed' && i.level === 'warn'));
  const icon = { block: '✕', warn: '!', ok: '✓' };
  const items = r.items.map((i) => `<li class="${i.level}"><span class="ic">${icon[i.level]}</span><div>${esc(i.title)}
      ${i.why ? '<div class="why">' + esc(i.why) + '</div>' : ''}
      ${i.evidence && i.evidence.length ? '<div>' + i.evidence.map((e) => '<span class="chip">' + esc(e) + '</span>').join('') + '</div>' : ''}
      ${i.rule && r.rules && r.rules[i.rule] && i.level !== 'ok' ? '<div class="faint">' + esc(r.rules[i.rule]) + '</div>' : ''}</div></li>`).join('');
  const status = c.status === 'posted' ? '<span class="badge high">posted ' + esc(fmtDate(c.postedAt)) + '</span>' : c.status === 'queued' ? '<span class="badge medium">waiting for the moment</span>' : '';
  return `<div class="clip ${r.verdict}" data-id="${c.id}">
    <div class="head"><div><div class="verdict">${esc(r.headline)}</div>
      <div class="faint">${esc(f.fileName)} · ${(f.sizeBytes / 1048576).toFixed(1)} MB · ${Math.round(f.durationSec)} s${f.video ? ' · ' + f.video.width + 'x' + f.video.height : ''} · score ${r.score}/100</div></div>
      <div>${status}</div></div>
    <div class="body">
      <ul class="items">${items}</ul>
      ${f.ocrText ? '<details><summary>Text found on screen</summary><pre class="faint" style="white-space:pre-wrap">' + esc(f.ocrText) + '</pre></details>' : ''}
      <details><summary>Not checked (do these yourself)</summary><ul>${r.notChecked.map((n) => '<li>' + esc(n) + '</li>').join('')}</ul></details>
      <div class="field"><label>Message</label><textarea data-caption="${c.id}" rows="2">${esc(c.caption)}</textarea></div>
      <div class="row">
        ${sizeBlock ? `<button class="btn primary" data-small="${c.id}">Make a ${S.settings.uploadLimitMB} MB copy</button>` : ''}
        ${c.status === 'checked' && r.verdict !== 'dont' ? `<button class="btn primary" data-queue="${c.id}">Wait for the moment</button>` : ''}
        ${c.status === 'queued' ? `<button class="btn" data-unqueue="${c.id}">Stop waiting</button>` : ''}
        ${c.status !== 'posted' ? `<button class="btn" data-posted="${c.id}">I posted it</button>` : ''}
        <button class="btn" data-recheck="${c.id}">Re-check message</button>
        <button class="btn" data-show="${c.id}">Show file</button>
        <button class="btn danger" data-remove="${c.id}">Remove</button>
      </div>
      ${c.status === 'posted' ? '<p class="faint">Remembered so the app can warn you if you try to post it again.</p>' : ''}
    </div></div>`;
}

// ---------------------------------------------------------------------------
// Tab: lock log
// ---------------------------------------------------------------------------

function renderLog() {
  const el = $('#tab-log');
  if (editing(el)) return;
  const p = S.prediction || {};
  const lock = p.lock || {};
  const rows = S.locks.map((l) => `<tr><td>${fmtDate(l.at)}</td><td>${l.liveAt ? fmtDate(l.liveAt) : '<span class="faint">no stream within 6 h</span>'}</td>
    <td class="num">${l.gapMin != null ? Math.round(l.gapMin) + ' min' : '–'}</td><td><button class="btn small danger" data-dellock="${l.id}">Delete</button></td></tr>`).join('');
  const streams = S.recentStreams.map((s) => `<tr><td>${fmtDate(s.start)}</td><td>${s.end ? fmtDur(s.end - s.start) : '<span class="faint">?</span>'}</td>
    <td>${esc(s.title || '')}${s.approx ? ' <span class="faint">(seen live, time ±' + S.settings.pollMinutes + ' min)</span>' : ''}${s.manual ? ' <span class="faint">(by hand)</span>' : ''}</td>
    <td>${s.manual || s.approx ? `<button class="btn small danger" data-delstream="${s.id}">Delete</button>` : ''}</td></tr>`).join('');
  el.innerHTML = `
    <h2>Lock log</h2>
    <div class="panel">
      <p>How long before Speed goes live do the mods lock the clips? Nobody publishes this, so the app learns it from you.
        Each lock you log is matched to the stream that starts within 6 h after it.</p>
      <p><b>${lock.learned ? 'Learned: the clips lock about ' + Math.round(lock.medianMin) + ' min before he goes live (most locks ' + Math.round(lock.p20Min) + '–' + Math.round(lock.p80Min) + ' min).' : 'Using a guess (15–90 min) until 3 logged locks match a stream. Logged so far: ' + (lock.samples || 0) + '.'}</b></p>
      <div class="row" style="margin-top:10px">
        <button class="btn big primary" data-lock>Clips just got locked</button>
        <span class="dim">or a past one:</span><input type="datetime-local" id="pastLock"><button class="btn" id="addPastLock">Add</button>
      </div>
    </div>
    <table><thead><tr><th>Locked</th><th>He went live</th><th>Gap</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="dim">Nothing logged yet.</td></tr>'}</tbody></table>
    <h3>His recent streams</h3>
    <div class="row" style="margin-bottom:8px"><span class="dim">Missed one (app was off, no key)? He went live at</span><input type="datetime-local" id="pastStream"><button class="btn" id="addPastStream">Add</button></div>
    <table><thead><tr><th>Went live</th><th>Length</th><th>Title</th><th></th></tr></thead><tbody>${streams || '<tr><td colspan="4" class="dim">None known yet.</td></tr>'}</tbody></table>`;
  $('#addPastLock').onclick = () => addPast('#pastLock', scp.addLock, 'Lock added.');
  $('#addPastStream').onclick = () => addPast('#pastStream', scp.addStream, 'Stream added.');
}

/** datetime-local is in the PC's own zone; Date parses it the same way. */
function addPast(sel, fn, msg) {
  const v = $(sel).value;
  const t = Date.parse(v);
  if (!v || !Number.isFinite(t)) return toast('Pick a date and time first.', true);
  if (t > Date.now()) return toast('That is in the future.', true);
  act(fn(t), msg);
}

// ---------------------------------------------------------------------------
// Tab: accuracy
// ---------------------------------------------------------------------------

function renderAccuracy() {
  const el = $('#tab-accuracy');
  const c = S.calibration;
  let body;
  if (!c) {
    body = `<div class="panel"><p>${esc(S.calibrationNote || 'Not calibrated yet. It runs by itself after his history loads (needs a YouTube key and 25+ past streams).')}</p></div>`;
  } else {
    const a = c.after;
    const b = c.before;
    const skill = a.brier != null && a.brierBaseline ? Math.round((1 - a.brier / a.brierBaseline) * 100) : null;
    const calRows = a.calibration.filter((x) => x.n).map((x) => `<tr><td>${Math.round(x.range[0] * 100)}–${Math.round(x.range[1] * 100)}%</td><td class="num">${pct(x.predicted)}</td><td class="num">${pct(x.happened)}</td><td class="num">${x.n}</td></tr>`).join('');
    body = `
      <div class="panel">
        <h3 style="margin-top:0">If you had used the app on his last ${a.streamsTested} streams</h3>
        <div class="stats">
          <div class="stat"><div class="v">${pct(a.goodRate)}</div><div class="k">posted before the lock and within ${a.goodWindowHours} h of him going live</div></div>
          <div class="stat"><div class="v">${pct(a.madeItRate)}</div><div class="k">posted before the lock at all</div></div>
          <div class="stat"><div class="v">${a.medianHoursEarly != null ? a.medianHoursEarly.toFixed(1) + ' h' : '–'}</div><div class="k">typical time before he went live</div></div>
          <div class="stat"><div class="v">${a.missedLock} / ${a.neverSaidPost}</div><div class="k">too late / never said post</div></div>
        </div>
        <div class="meter" style="margin:10px 0"><div style="width:${Math.round((a.goodRate || 0) * 100)}%"></div></div>
        <p class="dim">Before calibration: ${pct(b.goodRate)} good. Assumes the lock comes ${Math.round(a.assumedLockGapMin)} min before he goes live${S.prediction && S.prediction.lock && S.prediction.lock.learned ? ' (from your log)' : ' (a guess; log locks to make this real)'}.</p>
        <p class="dim">The "live within 6 h" number is ${skill != null ? (skill >= 0 ? skill + '% better' : -skill + '% worse') : '–'} than always guessing his average rate (Brier score ${a.brier != null ? a.brier.toFixed(3) : '–'} vs ${a.brierBaseline != null ? a.brierBaseline.toFixed(3) : '–'}; lower is better).</p>
        <p class="faint">Honest caveat: the settings were tuned on the same streams they are tested on, so expect real results a bit below these. Tours and breaks break any pattern; a scheduled stream on YouTube is the only near-certain signal.</p>
      </div>
      <div class="panel">
        <b>Do the percentages mean what they say?</b>
        <p class="dim">When the app said "X% chance he is live within 6 h", how often was he?</p>
        <table class="calib"><thead><tr><th>App said</th><th>Average said</th><th>Really happened</th><th>Times</th></tr></thead><tbody>${calRows}</tbody></table>
      </div>
      <p class="faint">Calibrated ${ago(c.at)} on streams since ${fmtDate(S.firstStream)}. Settings: ${esc(JSON.stringify(c.options))}</p>`;
  }
  el.innerHTML = `<h2>How accurate is it?</h2>${body}
    <div class="row"><button class="btn" data-calibrate ${S.calibrating ? 'disabled' : ''}>${S.calibrating ? 'Calibrating… ' + Math.round((100 * S.calibrating.done) / S.calibrating.total) + '%' : 'Re-calibrate now'}</button>
    <button class="btn" data-history ${S.historyBusy || !S.hasKey ? 'disabled' : ''}>Reload full history</button></div>`;
}

// ---------------------------------------------------------------------------
// Tab: settings
// ---------------------------------------------------------------------------

function renderSettings(force) {
  const el = $('#tab-settings');
  if (!force && el.dataset.ready && (editing(el) || tab !== 'settings')) {
    const ff = $('#ffStatus');
    if (ff) ff.innerHTML = ffStatus();
    return;
  }
  el.dataset.ready = '1';
  const s = S.settings;
  let zones = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch (_) {}
  el.innerHTML = `
    <h2>Settings</h2>
    <div class="panel">
      <b>YouTube key</b> ${S.hasKey ? '<span class="badge high">saved' + (S.channel ? ': ' + esc(S.channel.title) : '') + '</span>' : '<span class="badge low">not set</span>'}
      <p class="dim">Free. It lets the app read when each of Speed's past streams started and see scheduled streams. It is stored encrypted on this PC and only sent to YouTube.</p>
      <ol class="steps">
        <li>Open <a data-link="apikey">YouTube Data API v3 in Google Cloud</a> and sign in with any Google account.</li>
        <li>Create a project if it asks (any name), then press <b>Enable</b>.</li>
        <li>Go to <a data-link="credentials">Credentials</a> → <b>Create credentials</b> → <b>API key</b>. Copy it.</li>
        <li>Paste it here and press Save. The app checks it straight away.</li>
      </ol>
      <div class="row"><input type="password" id="key" placeholder="${S.hasKey ? '•••••••• (saved; paste a new one to replace)' : 'Paste the API key'}" style="flex:1;min-width:260px">
        <button class="btn primary" id="saveKey">Save</button>${S.hasKey ? '<button class="btn danger" id="clearKey">Remove</button>' : ''}</div>
    </div>

    <div class="panel">
      <b>Timing</b>
      <div class="field"><label for="risk">How safe? <span id="riskVal">${Math.round(s.risk * 100)}%</span> chance the clips are already locked when you post</label>
        <input type="range" id="risk" min="5" max="40" step="1" value="${Math.round(s.risk * 100)}" style="width:100%">
        <div class="help">Lower = you post earlier and safer, but more clips land on top of yours. Higher = you are closer to the bottom of the channel but more likely to miss the lock.</div></div>
      <div class="grid2">
        <div class="field"><label for="tz">Your time zone</label><input type="text" id="tz" list="tzs" value="${esc(s.tz)}"><datalist id="tzs">${zones.map((z) => '<option value="' + esc(z) + '">').join('')}</datalist></div>
        <div class="field"><label for="lead">"Get ready" alert, minutes before</label><input type="number" id="lead" min="0" max="120" value="${s.leadMinutes}"></div>
        <div class="field"><label for="poll">Check YouTube every (minutes)</label><input type="number" id="poll" min="2" max="30" value="${s.pollMinutes}"><div class="help">With a key each check uses 2 of the 10,000 free daily quota units.</div></div>
        <div class="field"><label for="limit">Your Discord upload limit</label><select id="limit">
          <option value="10" ${s.uploadLimitMB === 10 ? 'selected' : ''}>10 MB (no Nitro)</option>
          <option value="50" ${s.uploadLimitMB === 50 ? 'selected' : ''}>50 MB (Nitro Basic)</option>
          <option value="500" ${s.uploadLimitMB === 500 ? 'selected' : ''}>500 MB (Nitro)</option></select></div>
      </div>
    </div>

    <div class="panel">
      <b>Alerts</b>
      <label class="check"><input type="checkbox" id="alertLive" ${s.alertOnLive ? 'checked' : ''}> Alert when Speed goes live</label>
      <div class="field"><label for="ntfy">Phone alerts (optional, free)</label>
        <div class="row"><input type="text" id="ntfy" value="${esc(s.ntfyTopic)}" placeholder="a long secret name, e.g. speedclips-k39xq2" style="flex:1;min-width:240px"><button class="btn" id="testAlert">Send a test</button></div>
        <div class="help">Install the free <a data-link="ntfy">ntfy</a> app on your phone, subscribe to the same name, and alerts reach your phone too. Anyone who guesses the name can read the alerts, so make it long.</div></div>
      <label class="check"><input type="checkbox" id="tray" ${s.closeToTray ? 'checked' : ''}> Keep running in the tray when the window is closed (needed for alerts)</label>
      <label class="check"><input type="checkbox" id="login" ${s.openAtLogin ? 'checked' : ''}> Start with Windows</label>
    </div>

    <div class="panel"><b>FFmpeg</b> <span id="ffStatus">${ffStatus()}</span>
      <p class="dim">Used to check clips and make small copies. PC Clipper's and Avengers Player's copies are found automatically.</p>
      <div class="row"><button class="btn" id="ffDl">Download FFmpeg (about 110 MB)</button><button class="btn" id="ffPick">I have it: browse…</button><span id="ffProg" class="faint"></span></div>
    </div>
    <p class="faint">Speed Clip Poster ${esc(S.version)} · <button class="linkbtn" data-link="log">open log</button> · It never logs in to Discord and never posts for you.</p>`;

  const save = (patch) => act(scp.saveSettings(patch));
  $('#saveKey').onclick = async () => {
    const k = $('#key').value.trim();
    if (!k) return toast('Paste the key first.', true);
    $('#saveKey').disabled = true;
    const r = await act(scp.setKey(k), 'Key works. Loading his stream history…');
    $('#saveKey').disabled = false;
    if (r) renderSettings(true);
  };
  if ($('#clearKey')) $('#clearKey').onclick = async () => { await act(scp.setKey(''), 'Key removed.'); renderSettings(true); };
  $('#risk').oninput = () => ($('#riskVal').textContent = $('#risk').value + '%');
  $('#risk').onchange = () => save({ risk: +$('#risk').value / 100 });
  $('#tz').onchange = () => save({ tz: $('#tz').value.trim() });
  $('#lead').onchange = () => save({ leadMinutes: +$('#lead').value });
  $('#poll').onchange = () => save({ pollMinutes: +$('#poll').value });
  $('#limit').onchange = () => save({ uploadLimitMB: +$('#limit').value });
  $('#alertLive').onchange = () => save({ alertOnLive: $('#alertLive').checked });
  $('#ntfy').onchange = () => save({ ntfyTopic: $('#ntfy').value.trim() });
  $('#tray').onchange = () => save({ closeToTray: $('#tray').checked });
  $('#login').onchange = () => save({ openAtLogin: $('#login').checked });
  $('#testAlert').onclick = async () => { await save({ ntfyTopic: $('#ntfy').value.trim() }); act(scp.testAlert(), 'Test alert sent.'); };
  $('#ffDl').onclick = async () => {
    $('#ffDl').disabled = true;
    const r = await act(scp.ffDownload(), 'FFmpeg is ready.');
    $('#ffDl').disabled = false;
    $('#ffProg').textContent = '';
    if (r) refresh();
  };
  $('#ffPick').onclick = async () => { await act(scp.ffPick()); refresh(); };
}

function ffStatus() {
  return S.ffmpegPath ? '<span class="badge high">found</span> <span class="faint">' + esc(S.ffmpegPath) + '</span>' : '<span class="badge low">not found</span>';
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function render() {
  if (!S) return;
  renderNow();
  renderCheck();
  renderLog();
  renderAccuracy();
  renderSettings(false);
}

function showTab(name) {
  tab = name;
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
  if (name === 'settings' && S) renderSettings(true);
}

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});

// One click handler for all the buttons drawn into the tabs.
document.querySelector('main').addEventListener('click', async (e) => {
  const t = e.target.closest('[data-go],[data-lock],[data-poll],[data-show],[data-posted],[data-queue],[data-unqueue],[data-remove],[data-small],[data-recheck],[data-dellock],[data-delstream],[data-calibrate],[data-history],[data-link]');
  if (!t) return;
  const d = t.dataset;
  if (d.go) return showTab(d.go);
  if ('lock' in d) return act(scp.addLock(), 'Lock logged at ' + fmtTime(Date.now()) + '.');
  if ('poll' in d) return act(scp.pollNow(), 'Checked.');
  if (d.show) return act(scp.showClip(d.show));
  if (d.posted) return act(scp.setClipStatus(d.posted, 'posted'), 'Marked as posted. Good luck.');
  if (d.queue) return act(scp.setClipStatus(d.queue, 'queued'), 'You\'ll get an alert when it is time.');
  if (d.unqueue) return act(scp.setClipStatus(d.unqueue, 'checked'));
  if (d.remove) return act(scp.removeClip(d.remove));
  if (d.small) {
    t.disabled = true;
    return act(scp.smallCopy(d.small), 'Copy made and checked. It is at the top of the list.');
  }
  if (d.recheck) {
    const ta = document.querySelector(`textarea[data-caption="${d.recheck}"]`);
    return act(scp.recheck(d.recheck, ta ? ta.value : ''), 'Re-checked.');
  }
  if (d.dellock) return act(scp.removeLock(d.dellock));
  if (d.delstream) return act(scp.removeStream(d.delstream));
  if ('calibrate' in d) return act(scp.calibrate());
  if ('history' in d) return act(scp.refreshHistory(), 'Loading history…');
  if (d.link) return act(scp.openLink(d.link));
});

// Settings has links too (it is inside main as well, handled above).

scp.onFfProgress((p) => {
  const el = $('#ffProg');
  if (el) el.textContent = p.phase === 'verify' ? 'Checking the download…' : p.totalBytes ? Math.round((100 * p.receivedBytes) / p.totalBytes) + '%' : '';
});

scp.onState((s) => {
  S = s;
  render();
});

async function refresh() {
  const s = await scp.getState();
  if (s && !s.error) {
    S = s;
    render();
  }
}

// Countdowns tick every second without a full redraw.
setInterval(() => {
  document.querySelectorAll('[data-until]').forEach((el) => {
    el.textContent = fmtDur(+el.dataset.until - Date.now());
  });
}, 1000);

refresh();
