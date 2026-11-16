'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

test('fmtDuration / parseDuration round-trip', () => {
  assert.equal(C.fmtDuration(9030), '2:30:30');
  assert.equal(C.fmtDuration(9030.25, { ms: true }), '2:30:30.250');
  assert.equal(C.fmtDuration(59.9996, { ms: true }), '1:00.000');
  assert.equal(C.fmtDuration(75), '1:15');
  assert.equal(C.fmtDuration(75, { forceHours: true }), '0:01:15');
  assert.equal(C.fmtDuration(-5), '-0:05');
  assert.equal(C.fmtDuration(NaN), '--:--');
  assert.equal(C.parseDuration('2:30:30'), 9030);
  assert.equal(C.parseDuration('2:30:30.5'), 9030.5);
  assert.equal(C.parseDuration('2:30:30,250'), 9030.25);
  assert.equal(C.parseDuration('150:30'), 9030);
  assert.equal(C.parseDuration('9030'), 9030);
  assert.equal(C.parseDuration('2h30m30s'), 9030);
  assert.equal(C.parseDuration('2h 30m'), 9000);
  assert.ok(Number.isNaN(C.parseDuration('')));
  assert.ok(Number.isNaN(C.parseDuration('abc')));
  assert.ok(Number.isNaN(C.parseDuration('1:2:3:4')));
  assert.ok(Number.isNaN(C.parseDuration('1.5:20')));
  for (const s of [0, 0.001, 59.999, 3599.5, 9030, 10871.208]) {
    assert.ok(Math.abs(C.parseDuration(C.fmtDuration(s, { ms: true })) - s) < 0.0006, String(s));
  }
});

test('countdown reaches zero exactly at the target', () => {
  assert.equal(C.countdownParts(10000).total, 10);
  assert.equal(C.countdownParts(9999).total, 10);
  assert.equal(C.countdownParts(9001).total, 10);
  assert.equal(C.countdownParts(9000).total, 9);
  assert.equal(C.countdownParts(1).total, 1);
  assert.equal(C.countdownParts(0).total, 0);
  assert.equal(C.countdownParts(-500).total, 0);
  assert.equal(C.fmtCountdown(3 * 86400000 + 3723000), '3d 01:02:03');
  assert.equal(C.fmtCountdown(3723000), '01:02:03');
});

test('clock formatting, 12 and 24 hour', () => {
  assert.equal(C.fmtClock(new Date(2026, 11, 31, 21, 29, 30), false), '9:29:30 PM');
  assert.equal(C.fmtClock(new Date(2026, 11, 31, 21, 29, 30), true), '21:29:30');
  assert.equal(C.fmtClock(new Date(2027, 0, 1, 0, 0, 0), false), '12:00:00 AM');
  assert.equal(C.fmtClock(new Date(2027, 0, 1, 12, 0, 5), false), '12:00:05 PM');
  assert.equal(C.fmtDateTime(new Date(2026, 11, 31, 21, 29, 30).getTime(), false), 'Thu, Dec 31 · 9:29:30 PM');
});

test('new year target: default snap gives a 9:29:30 PM start', () => {
  const now = new Date(2026, 10, 15, 12, 0, 0).getTime();
  const s = C.computeSession({ nowMs: now, snapSec: C.DEFAULT_SNAP_SEC, durationSec: 10871, targetMode: 'newyear' });
  assert.equal(s.targetEpoch, new Date(2027, 0, 1, 0, 0, 0).getTime());
  assert.equal(s.startEpoch, new Date(2026, 11, 31, 21, 29, 30).getTime());
  assert.equal(s.endEpoch, s.startEpoch + 10871000);
  assert.equal(C.expectedPos(s, s.startEpoch), 0);
  assert.equal(C.expectedPos(s, s.targetEpoch), C.DEFAULT_SNAP_SEC);
});

test('new year target: stays on the midnight that just passed while the film is still running', () => {
  const dur = 10871;
  const tail = (dur - C.DEFAULT_SNAP_SEC) * 1000;
  const jan1 = new Date(2027, 0, 1, 0, 0, 0).getTime();
  const during = C.computeSession({ nowMs: jan1 + 5 * 60000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(during.targetEpoch, jan1);
  const justBeforeEnd = C.computeSession({ nowMs: jan1 + tail - 1000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(justBeforeEnd.targetEpoch, jan1);
  const after = C.computeSession({ nowMs: jan1 + tail + 1000, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(after.targetEpoch, new Date(2028, 0, 1, 0, 0, 0).getTime());
  const lastSecond = C.computeSession({ nowMs: jan1 - 1, snapSec: C.DEFAULT_SNAP_SEC, durationSec: dur, targetMode: 'newyear' });
  assert.equal(lastSecond.targetEpoch, jan1);
});

test('custom target and unknown duration', () => {
  const target = new Date(2026, 5, 1, 20, 0, 0).getTime();
  const s = C.computeSession({ nowMs: 0, snapSec: 100, durationSec: NaN, targetMode: 'custom', customTargetMs: target });
  assert.equal(s.targetEpoch, target);
  assert.equal(s.startEpoch, target - 100000);
  assert.equal(s.endEpoch, null);
  const fallback = C.computeSession({ nowMs: new Date(2026, 5, 1).getTime(), snapSec: 100, durationSec: 200, targetMode: 'custom', customTargetMs: NaN });
  assert.equal(fallback.targetEpoch, new Date(2027, 0, 1).getTime());
});

test('median', () => {
  assert.equal(C.median([3, 1, 2]), 2);
  assert.equal(C.median([4, 1, 2, 3]), 2.5);
  assert.ok(Number.isNaN(C.median([])));
});

/** Simulates a player whose position follows the commanded rate, with measurement noise. */
function simulate(initialDrift, opts) {
  const ctrl = new C.DriftController(opts);
  let drift = initialDrift;
  let rate = 1;
  let hard = false;
  const trace = [];
  const noise = (i) => Math.sin(i * 12.9898) * 0.004;
  for (let i = 0; i < 24 * 20; i++) {            // 20 s of 24 fps frames
    const t = i / 24;
    drift += (rate - 1) / 24;
    ctrl.push(t, drift + noise(i));
    if (i % 5 === 0) {                             // decisions ~5 times a second
      const r = ctrl.decide(t);
      if (r.action === 'hard') { hard = true; break; }
      rate = r.rate;
    }
    trace.push({ t, drift, rate });
  }
  return { trace, hard, final: drift, ctrl };
}

test('drift controller converges from both sides without overshooting much', () => {
  for (const d0 of [0.2, -0.2, 0.05, -0.05, 0.45, -0.45]) {
    const { trace, hard, final } = simulate(d0);
    assert.equal(hard, false, 'no hard seek for ' + d0);
    assert.ok(Math.abs(final) < 0.02, 'converged from ' + d0 + ' -> ' + final);
    const overshoot = d0 > 0 ? Math.min(...trace.map((x) => x.drift)) : Math.max(...trace.map((x) => x.drift));
    assert.ok(Math.abs(overshoot) < 0.03, 'overshoot ' + overshoot + ' from ' + d0);
    for (const x of trace) assert.ok(x.rate >= 0.94 - 1e-9 && x.rate <= 1.06 + 1e-9, 'rate bounded');
    const settled = trace.find((x) => Math.abs(x.drift) < 0.012);
    assert.ok(settled && settled.t < 12, 'settles in time from ' + d0);
  }
});

test('drift controller leaves small drift alone and asks for a seek on big drift', () => {
  const quiet = simulate(0.012);
  assert.ok(quiet.trace.every((x) => x.rate === 1), 'inside the deadband nothing is touched');
  assert.equal(simulate(0.8).hard, true);
  assert.equal(simulate(-3).hard, true);
});

test('drift controller needs fresh samples', () => {
  const c = new C.DriftController();
  assert.equal(c.decide(1).drift, null);
  c.push(1, 0.1);
  assert.equal(c.decide(1).drift, null, 'one sample is not enough');
  c.push(1.05, 0.1);
  assert.equal(c.decide(1.05).action, 'rate');
  assert.equal(c.decide(5).drift, null, 'stale samples are ignored');
  c.push(NaN, 1); c.push(2, NaN);
  c.reset();
  assert.equal(c.rate, 1);
});

test('film versions: ENDGAME is 3:01:11, ENCORE is 3:01:36', () => {
  const ids = C.FILM_VERSIONS.map((v) => v.id);
  assert.deepEqual(ids, ['original', 'encore', 'custom']);
  assert.equal(C.filmVersion('original').lengthSec, 3 * 3600 + 1 * 60 + 11);
  assert.equal(C.filmVersion('encore').lengthSec, 3 * 3600 + 1 * 60 + 36);
  assert.equal(C.REFERENCE_SEC, 10871);
  assert.match(C.filmVersion('original').name, /3:01:11/);
  assert.match(C.filmVersion('encore').name, /3:01:36/);
  assert.equal(C.filmVersion('original').snapSec, 9030, 'where the search starts');
  assert.equal(C.filmVersion('encore').snapSec, 9030);
  assert.equal(C.filmVersion('custom').snapSec, null);
  // No cut is taken on trust: 2:30:30 is a round number until the frame has been found in the file.
  for (const v of C.FILM_VERSIONS) assert.equal(v.settled, false, v.id);
  // A cut that is no longer offered keeps its own snap point; nothing at all means the film itself.
  assert.equal(C.filmVersion('encore-intro').id, 'custom');
  assert.equal(C.filmVersion('nonsense').id, 'custom');
  assert.equal(C.filmVersion('').id, 'original');
  assert.equal(C.filmVersion(undefined).id, 'original');
  for (const v of C.FILM_VERSIONS) {
    assert.ok(v.name && v.short && v.note && v.family, v.id);
    if (v.minutes) assert.ok(v.minutes[0] < v.minutes[1], v.id);
  }
  // The ranges used to recognise a file must not overlap.
  const ranges = C.FILM_VERSIONS.filter((v) => v.minutes).map((v) => v.minutes).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < ranges.length; i++) assert.ok(ranges[i][0] >= ranges[i - 1][1]);
});
test('film versions: recognised by the length of the file', () => {
  const guess = (h, m, sec) => { const v = C.guessFilmVersion(h * 3600 + m * 60 + sec); return v ? v.id : null; };
  assert.equal(guess(3, 1, 11), 'original', 'ENDGAME');
  assert.equal(guess(3, 1, 36), 'encore', 'ENCORE');
  assert.equal(guess(3, 0, 57), 'original', 'the 2019 cinema print');
  assert.equal(guess(3, 1, 20), 'original', 'a few seconds of logo in front');
  assert.equal(guess(3, 1, 23), 'original');
  assert.equal(guess(3, 1, 24), 'encore', 'halfway between the two lengths is where one becomes the other');
  assert.equal(guess(3, 1, 40), 'encore');
  assert.equal(guess(3, 5, 10), 'encore', 'a longer copy of the re-release');
  assert.equal(guess(2, 29, 0), null, 'Infinity War is not Endgame');
  assert.equal(guess(0, 3, 20), null, 'a test clip');
  assert.equal(guess(3, 10, 0), null);
  assert.equal(C.guessFilmVersion(NaN), null);
  assert.equal(C.guessFilmVersion(0), null);
  assert.equal(C.guessFilmVersion(-5), null);
});

// A run of frames as the app measures them: brightness of the middle of the picture, and how much of it is white.
function strip(opts) {
  const fps = opts.fps || 24;
  const out = [];
  for (let i = 0; i < Math.round((opts.to - opts.from) * fps); i++) {
    const t = opts.from + i / fps;
    let k = 0;
    for (const f of opts.flashes || []) k = Math.max(k, Math.max(0, Math.min(1, (t - f.at) / (f.rise || 0.1666))) * Math.max(0, Math.min(1, (f.at + (f.hold || 1.7) - t) / (f.fade || 0.7))));
    const calm = opts.calm != null ? opts.calm : 0.3;
    const peak = opts.peak != null ? opts.peak : 1;
    const mean = calm + (peak - calm) * k;
    out.push({ t: t, mean: mean, white: peak >= 0.99 ? (k >= 0.97 ? 1 : k > 0.8 ? 0.5 : 0) : 0 });
  }
  return out;
}

test('findFlash: the white-out of the snap, and the frame on which it begins', () => {
  // The picture begins to brighten on the frame after 101.5 and is white all over four frames later.
  const fr = strip({ from: 98, to: 106, flashes: [{ at: 101.5 }] });
  const f = C.findFlash(fr, { expect: 100 });
  assert.ok(f);
  assert.equal(f.kind, 'white');
  assert.ok(Math.abs(fr[f.rise].t - 101.5417) < 0.001, 'the first brighter frame: ' + fr[f.rise].t);
  assert.ok(Math.abs(fr[f.start].t - 101.6667) < 0.001, 'the first frame that is white all over: ' + fr[f.start].t);
  assert.ok(fr[f.end].t > 102.3 && fr[f.end].t < 102.7);
  assert.ok(f.duration > 0.7 && f.duration < 1.1);

  // A hard cut to white: the flash begins on the white frame itself.
  const cut = strip({ from: 10, to: 16, flashes: [{ at: 12, rise: 0.001 }] });
  const c = C.findFlash(cut);
  assert.equal(c.rise, c.start);
  assert.ok(Math.abs(cut[c.start].t - 12.0417) < 0.001);

  // At 6 frames a second (the long test clips) there is no room for a ramp either.
  const slow = strip({ from: 9028, to: 9036, fps: 6, flashes: [{ at: 9031.5 }] });
  const s6 = C.findFlash(slow);
  assert.ok(Math.abs(slow[s6.rise].t - 9031.6667) < 0.001, String(slow[s6.rise].t));

  // Nothing there, too little to go by, or white from the very first frame (no beginning to point at).
  assert.equal(C.findFlash(strip({ from: 0, to: 8 })), null);
  assert.equal(C.findFlash([]), null);
  assert.equal(C.findFlash(null), null);
  assert.equal(C.findFlash(fr.slice(0, 3)), null);
  assert.equal(C.findFlash(strip({ from: 101.7, to: 102.3, flashes: [{ at: 101.5 }] })), null);

  // One white frame is a camera flash or a cut, not the snap.
  const blip = strip({ from: 0, to: 6 });
  blip[60].white = 1; blip[60].mean = 1;
  assert.equal(C.findFlash(blip), null);

  // Two white-outs: the longer one; of two equals, the one nearer to where the snap is expected.
  const two = strip({ from: 0, to: 30, flashes: [{ at: 5, hold: 0.6, fade: 0.2 }, { at: 20 }] });
  assert.ok(Math.abs(two[C.findFlash(two, { expect: 5 }).start].t - 20.1667) < 0.001, 'the longer white-out wins even when it is further away');
  const twins = strip({ from: 0, to: 30, flashes: [{ at: 5 }, { at: 20 }] });
  assert.ok(Math.abs(twins[C.findFlash(twins, { expect: 6 }).start].t - 5.1667) < 0.001);
  assert.ok(Math.abs(twins[C.findFlash(twins, { expect: 19 }).start].t - 20.1667) < 0.001);

  // A flash that does not reach pure white is still found, and says so.
  const dim = strip({ from: 0, to: 10, calm: 0.2, peak: 0.8, flashes: [{ at: 4 }] });
  const d = C.findFlash(dim);
  assert.equal(d.kind, 'bright');
  assert.ok(dim[d.start].t > 4 && dim[d.start].t < 4.3);
  // A picture that is bright all the time is not a flash.
  assert.equal(C.findFlash(strip({ from: 0, to: 10, calm: 0.8, peak: 0.8, flashes: [{ at: 4 }] })), null);

  // A fast sweep that sees only every fifth frame still finds it.
  const sparse = strip({ from: 60, to: 160, flashes: [{ at: 101.5 }] }).filter((x, i) => i % 5 === 0);
  const sp = C.findFlash(sparse, { expect: 100, minDur: 0.2 });
  assert.ok(sp && Math.abs(sparse[sp.start].t - 101.7) < 0.25, String(sp && sparse[sp.start].t));
});

test('findSnapLine: the line before the snap, wherever the subtitles put it', () => {
  // The cues of the 4K Blu-ray, as published: the line is split over three, seconds apart.
  const disc = [
    { start: 8998.198, end: 9001.702, text: 'I am... inevitable.' },
    { start: 9021.847, end: 9023.390, text: 'And I...' },
    { start: 9025.058, end: 9026.226, text: 'am...' },
    { start: 9029.938, end: 9031.440, text: 'Iron Man.' },
    { start: 9150.142, end: 9151.852, text: 'Mr. Stark?' }
  ];
  assert.deepEqual(C.findSnapLine(disc, 9030), { start: 9021.847, end: 9031.440, text: 'And I... am... Iron Man.' });
  // Captions for the hard of hearing put sounds in between, in brackets.
  const sdh = [
    { start: 8996.610, end: 9000.213, text: 'I am inevitable.' },
    { start: 9018.2, end: 9019.9, text: 'And I...' },
    { start: 9021.835, end: 9023.501, text: '(PANTING)' },
    { start: 9023.503, end: 9024.637, text: 'am...' },
    { start: 9026.0, end: 9027.0, text: '[GAUNTLET POWERS UP]' },
    { start: 9028.408, end: 9029.809, text: '<i>Iron Man.</i>' }
  ];
  const hit = C.findSnapLine(sdh, 9030);
  assert.equal(hit.end, 9029.809);
  assert.equal(hit.start, 9018.2);
  assert.equal(hit.text, 'And I... am... Iron Man.');
  // Two cues, one cue, other punctuation.
  const cues = [
    { start: 100, end: 102, text: 'I am... inevitable.' },
    { start: 9021.2, end: 9023.0, text: 'And I...' },
    { start: 9023.4, end: 9026.1, text: '<i>am... Iron Man.</i>' },
    { start: 9500, end: 9502, text: 'Everybody wants a happy ending.' }
  ];
  assert.deepEqual(C.findSnapLine(cues, 9030), { start: 9021.2, end: 9026.1, text: 'And I... am... Iron Man.' });
  assert.deepEqual(C.findSnapLine([{ start: 5, end: 8, text: 'And I... am... Iron Man.' }], 9030), { start: 5, end: 8, text: 'And I... am... Iron Man.' });
  assert.deepEqual(C.findSnapLine([{ start: 5, end: 8, text: '- And I am\nIron-Man.' }], 0), { start: 5, end: 8, text: '- And I am Iron-Man.' });
  // The same words twice in a film: the one nearest to where the snap is expected.
  const twice = [{ start: 600, end: 602, text: 'I am Iron Man.' }, { start: 9024, end: 9026, text: 'I am Iron Man.' }];
  assert.equal(C.findSnapLine(twice, 9030).start, 9024);
  assert.equal(C.findSnapLine(twice, 500).start, 600);
  // Not the line.
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'I am inevitable.' }, { start: 3, end: 4, text: 'Iron Man is here.' }, { start: 30, end: 31, text: 'I am' }], 0), null);
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'And I...' }, { start: 60, end: 62, text: 'am Iron Man' }], 0), null, 'two cues a minute apart are not one line');
  assert.equal(C.findSnapLine([{ start: 1, end: 2, text: 'I am... inevitable.' }, { start: 22, end: 23, text: 'Iron Man.' }], 0), null, 'the other man\'s "I am" is not the beginning of this line');
  assert.equal(C.findSnapLine([], 0), null);
  assert.equal(C.findSnapLine(null, 0), null);
});

test('languages: codes, names and titles', () => {
  for (const [input, want] of [['eng', 'eng'], ['en', 'eng'], ['EN-us', 'eng'], ['English', 'eng'], ['hin', 'hin'], ['hi', 'hin'],
    ['fre', 'fra'], ['ger', 'deu'], ['chi', 'zho'], ['und', ''], ['', ''], [null, ''], ['xx', 'xx'], ['not a code', '']]) {
    assert.equal(C.normLang(input), want, String(input));
  }
  assert.equal(C.langName('eng'), 'English');
  assert.equal(C.langName('hi'), 'Hindi');
  assert.equal(C.langName('und'), '');
  assert.equal(C.langName('xx'), 'XX');
  assert.equal(C.langFromTitle('Org Hindi DDP 5.1 - 640Kbps'), 'hin');
  assert.equal(C.langFromTitle('English DD 5.1'), 'eng');
  assert.equal(C.langFromTitle('Surround 5.1'), '');
  assert.equal(C.langFromTitle('Finnish'), 'fin');
  assert.equal(C.langFromTitle('unfinished'), '', 'a language name inside another word does not count');
  assert.equal(C.trackLang({ lang: 'und', title: 'English DD 5.1' }), 'eng');
  assert.equal(C.trackLang({ language: 'hin', label: 'SoundHandler' }), 'hin');
  assert.equal(C.trackLang(null), '');
});

test('sound track choice: English by default, whatever the file calls its main track', () => {
  const pick = (tracks, lang) => C.pickAudioTrack(tracks, lang);
  // The real case that went wrong: Hindi first and flagged as the main track, English second.
  const pahe = [{ lang: 'hin', title: 'Org Hindi DDP 5.1', isDefault: true }, { lang: 'eng', title: 'English DD 5.1', isDefault: false }];
  assert.equal(pick(pahe), 1, 'English wins over the default flag');
  assert.equal(pick(pahe, 'eng'), 1);
  assert.equal(pick(pahe, 'hin'), 0, 'another preferred language is honoured');
  assert.equal(pick(pahe, 'hi'), 0);
  assert.equal(pick(pahe, 'fra'), 0, 'no French track: the file\'s own main track');
  // Languages only in the titles.
  assert.equal(pick([{ lang: '', title: 'Hindi 5.1' }, { lang: 'und', title: 'English 5.1' }]), 1);
  // No English: a track that does not say what it is beats one that says it is something else.
  assert.equal(pick([{ lang: 'hin', isDefault: true }, { lang: '' }]), 1, 'next to a labelled dub, the unlabelled track is tried');
  assert.equal(pick([{ lang: '' }, { lang: 'hin', isDefault: true }]), 0);
  assert.equal(pick([{ lang: 'hin', isDefault: true }, { lang: 'tam' }]), 0, 'two other languages: the file\'s main track');
  assert.equal(pick([{ lang: 'hin' }, { lang: 'tam', isDefault: true }]), 1);
  // Nothing known: the default flag, else the first.
  assert.equal(pick([{ lang: '' }, { lang: '', isDefault: true }]), 1);
  assert.equal(pick([{ lang: '' }, { lang: '' }]), 0);
  // A commentary is never chosen over the film's own sound, even when it comes first.
  assert.equal(pick([{ lang: 'eng', title: 'Director Commentary', isDefault: true }, { lang: 'eng', title: 'English 5.1' }]), 1);
  assert.equal(pick([{ lang: 'eng', title: 'English 5.1' }, { lang: 'eng', title: 'Commentary' }]), 0);
  assert.equal(pick([{ lang: 'eng', title: 'Commentary' }]), 0, 'the only track is still a track');
  // Two English tracks: the first.
  assert.equal(pick([{ lang: 'hin' }, { lang: 'eng', title: 'English 7.1' }, { lang: 'eng', title: 'English 2.0' }]), 1);
  assert.equal(pick([]), -1);
  assert.equal(pick(null), -1);
});
