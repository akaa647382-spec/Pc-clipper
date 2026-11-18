'use strict';
// Should you post this clip? Checks the facts about a clip against the Speed server's clip rules
// and server rules, and against what gets a clip skipped. Pure logic: the facts are gathered by
// main/analyze.cjs (FFmpeg + on-screen text reading).
//
// Each finding has a level:
//   block = this breaks a rule or will not upload; do not post it like this
//   warn  = mods may delete it, or people will scroll past it
//   ok    = checked and fine
// Things the app cannot check are listed separately, so "POST" never means "checked everything".

const RULES = {
  promo: 'Rule 7 + clip rules: no advertising or seeking personal gain',
  begging: 'Fan art/clip rule 1: no begging via text in clips',
  slur: 'Rules 4 and 6: no slurs or hateful language',
  nsfw: 'Rule 3: no NSFW (instant ban)',
  war: 'Rule 15: no jokes about wars or global events',
  age: 'Rule 1: no jokes about being underage',
  english: 'Rule 5: English only',
  repeat: 'Clip rule 5: no repetitive media (blacklist risk)',
  cringe: 'Clip rule 4: no cringe/unreactable clips',
  upload: 'Discord upload limit',
  embed: 'Plays inside Discord',
};

// Speed's own handles are fine to mention.
const SPEED_HANDLES = /^@(ishowspeed|speed|ishowspeedy|ishowspeedhq|ishowspeedsui)$/i;

/** Lower-case, undo common letter swaps so "fr33 v-bucks" and "f0ll0w" still match. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/[|]/g, 'i');
}

const TEXT_CHECKS = [
  // --- block ---
  { level: 'block', rule: 'promo', title: 'Self-promotion', why: 'Links or "sub/follow me" get clips deleted and can get you blacklisted.',
    re: [/(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitch\.tv|kick\.com|discord\.gg|discord\.com\/invite|linktr\.ee|x\.com\/|twitter\.com\/)/, /\b(sub(scribe)?|follow)\b[^.\n]{0,20}\b(me|my|to my|channel|back)\b/, /\bcheck (out )?my\b/, /\blink in (my )?bio\b/, /\bcash ?app\b/, /\b(yt|tt|ig|tiktok|insta)\s*[:\-–]\s*@?\w{3,}/] },
  { level: 'block', rule: 'begging', title: 'Begging Speed to watch', why: 'Asking Speed to react or notice you in the clip counts as begging.',
    re: [/\b(speed|bro|plz|pls|please)\b[^.\n]{0,25}\b(react|watch|see this|notice|look at)\b/, /\b(add me|add back|pin (this|me|pls|please)|shout ?out (me|my)|notice me|follow back)\b/, /\bplease watch\b/] },
  { level: 'block', rule: 'slur', title: 'Slur', why: 'Swearing is allowed; slurs are not.',
    re: [/\bnigg(er|ers|uh)\b/, /\bf[a@]g(g[o0]t)?s?\b/, /\bretard(ed|s)?\b/, /\btr[a@]nn(y|ies)\b/, /\bk[i]ke\b/, /\bsp[i]c\b/, /\bch[i]nk\b/, /\bbeaner\b/, /\bwetback\b/, /\braghead\b/] },
  { level: 'block', rule: 'nsfw', title: 'NSFW words', why: 'NSFW is an instant ban, even as a joke.',
    re: [/\b(porn|nsfw|nudes?|onlyfans|hentai|xxx)\b/] },
  // --- warn ---
  { level: 'warn', rule: 'slur', title: 'N-word (soft a)', why: 'Mods often treat it as a slur. Safer without it.',
    re: [/\bnigg(a|as|az)\b/] },
  { level: 'warn', rule: 'war', title: 'War or world-event topic', why: 'Jokes about ongoing wars or global events can be punished.',
    re: [/\b(ukraine|russia|gaza|israel|palestine|hamas|hezbollah|putin|zelensky|netanyahu|idf|isis|terroris[mt]|bomb(ing)?|missile|ww3|world war)\b/] },
  { level: 'warn', rule: 'age', title: 'Age mention', why: 'Joking about being under 13 is against the rules.',
    raw: true, re: [/\b(i'?m|im|i am)\s*(1[0-2]|[5-9]|five|six|seven|eight|nine|ten|eleven|twelve)\s*(years? old|yrs? old|y\/o|yo)\b/] },
  // Cash tags: on the raw text, because digit swapping would turn "$500" into a word.
  { level: 'block', rule: 'promo', title: 'Cash tag', why: 'Asking for money is seeking personal gain.',
    raw: true, re: [/(^|\s)\$[a-z][a-z0-9_]{2,}/] },
];

/** Runs the text checks on one piece of text. Returns findings with the matched words. */
function scanText(text, source) {
  const findings = [];
  const norm = normalize(text);
  const raw = String(text || '').toLowerCase();
  if (!norm.trim()) return findings;
  for (const c of TEXT_CHECKS) {
    const hits = [];
    for (const re of c.re) {
      const m = (c.raw ? raw : norm).match(new RegExp(re.source, 'g'));
      if (m) hits.push(...m);
    }
    if (hits.length) findings.push({ level: c.level, rule: c.rule, title: c.title + ' (' + source + ')', why: c.why, evidence: Array.from(new Set(hits.map((h) => h.trim()))).slice(0, 5) });
  }
  // @handles that are not Speed's.
  const handles = (String(text || '').match(/(^|\s)@[a-z0-9_.]{3,30}/gi) || []).map((h) => h.trim()).filter((h) => !SPEED_HANDLES.test(h));
  const promo = findings.find((f) => f.rule === 'promo');
  if (handles.length && promo) promo.evidence = Array.from(new Set([...promo.evidence, ...handles])).slice(0, 6);
  if (handles.length && !promo) {
    findings.push({ level: 'block', rule: 'promo', title: 'Someone\'s @handle (' + source + ')', why: 'A handle in the clip reads as advertising. Crop or blur it.', evidence: handles.slice(0, 5) });
  }
  return findings;
}

const ENGLISH_WORDS = new Set('the a an and or is are was i you he she it we they this that what when why how no yes not to of in on for with my your his bro lol lmao bruh speed like just got get go so what\'s it\'s don\'t can\'t'.split(' '));

function englishCheck(text, source) {
  const t = String(text || '');
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 12) return null;
  const nonLatin = letters.filter((ch) => !/[a-zA-ZÀ-ɏ]/.test(ch)).length;
  if (nonLatin / letters.length > 0.3) return { level: 'warn', rule: 'english', title: 'Not English (' + source + ')', why: 'The server is English-only.' };
  const words = t.toLowerCase().match(/[a-z']+/g) || [];
  if (words.length >= 6 && !words.some((w) => ENGLISH_WORDS.has(w))) return { level: 'warn', rule: 'english', title: 'May not be English (' + source + ')', why: 'The server is English-only.' };
  return null;
}

// ---------------------------------------------------------------------------
// Repeat detection: per-second 64-bit picture fingerprints (dHash), compared as hex strings
// ---------------------------------------------------------------------------

const POPCOUNT = new Uint8Array(256).map((_, i) => { let c = 0, x = i; while (x) { c += x & 1; x >>= 1; } return c; });

function hamming(hexA, hexB) {
  let d = 0;
  for (let i = 0; i < 16; i += 2) d += POPCOUNT[parseInt(hexA.substr(i, 2), 16) ^ parseInt(hexB.substr(i, 2), 16)];
  return d;
}

/** Share of `a`'s frames that have a near-identical frame anywhere in `b` (0..1). */
function similarity(a, b, maxBits = 8) {
  if (!a || !b || !a.length || !b.length) return 0;
  let hit = 0;
  for (const h of a) {
    for (const g of b) {
      if (hamming(h, g) <= maxBits) { hit++; break; }
    }
  }
  return hit / a.length;
}

/** Hashes that are almost all one colour say nothing about the clip; leave them out. */
function informative(hashes) {
  return (hashes || []).filter((h) => h !== '0000000000000000' && h !== 'ffffffffffffffff');
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

/**
 * facts = {
 *   fileName, sizeBytes, sha256, container,
 *   durationSec, video: {codec,width,height,fps} | null, audio: [..],
 *   meanVolumeDb, maxVolumeDb, silenceSec, blackSec, sceneCuts, motion,
 *   startSilentSec, startBlackSec,
 *   hashes: [hex16], ocrText: string, ocrOk: bool
 * }
 * opts = { caption, uploadLimitMB, history: [{fileName, sha256, hashes, postedAt}] }
 */
function checkClip(facts, opts = {}) {
  const items = [];
  const add = (level, rule, title, why, evidence) => items.push({ level, rule, title, why, evidence });
  const limitMB = opts.uploadLimitMB || 10;
  const dur = facts.durationSec || 0;
  const v = facts.video;

  // --- Upload & playback ---
  const mb = (facts.sizeBytes || 0) / (1024 * 1024);
  if (mb > limitMB) add('block', 'upload', 'Too big to upload: ' + mb.toFixed(1) + ' MB (limit ' + limitMB + ' MB)', 'Discord will refuse it. Use "Make a ' + limitMB + ' MB copy".');
  else add('ok', 'upload', 'Size ' + mb.toFixed(1) + ' MB fits the ' + limitMB + ' MB limit', '');

  const container = String(facts.container || '').toLowerCase();
  const ext = String(facts.fileName || '').toLowerCase().split('.').pop();
  if (!v) add('block', 'embed', 'No picture', 'This is not a video clip.');
  else if (['mkv', 'avi', 'flv', 'wmv'].includes(ext) || /matroska|avi|flv|asf/.test(container) && ext !== 'webm') add('warn', 'embed', 'A .' + ext + ' file will not play inside Discord', 'People have to download it to watch, so almost nobody will. Use "Make a ' + limitMB + ' MB copy" (it saves an MP4).');
  else if (v.codec === 'hevc') add('warn', 'embed', 'HEVC (H.265) video often shows as a black box in Discord', 'Use "Make a ' + limitMB + ' MB copy" to get H.264.');
  else add('ok', 'embed', 'Plays inside Discord (' + (v.codec || '?') + ')', '');

  // --- Watchability ---
  if (dur < 4) add('warn', 'cringe', 'Very short (' + dur.toFixed(1) + ' s)', 'Too short to react to.');
  else if (dur > 600) add('block', 'cringe', 'Too long (' + Math.round(dur / 60) + ' min)', 'Nobody reacts to a 10-minute clip in a clips channel. Cut it to the best 15-60 s.');
  else if (dur > 120) add('warn', 'cringe', 'Long (' + Math.round(dur) + ' s)', 'Clips over 2 minutes get skipped. 15-60 s is the sweet spot.');
  else add('ok', 'cringe', 'Length ' + Math.round(dur) + ' s', '');

  if (v) {
    const short = Math.min(v.width, v.height);
    if (short && short < 360) add('warn', 'cringe', 'Low resolution (' + v.width + 'x' + v.height + ')', 'Blurry clips look low-effort.');
    if (v.fps && v.fps < 20) add('warn', 'cringe', 'Choppy (' + v.fps + ' fps)', 'Below 20 fps looks laggy.');
  }

  if (!facts.audio || !facts.audio.length) add('warn', 'cringe', 'No sound', 'Silent clips are hard to react to on stream.');
  else {
    if (Number.isFinite(facts.maxVolumeDb) && facts.maxVolumeDb >= -0.2 && Number.isFinite(facts.meanVolumeDb) && facts.meanVolumeDb > -11) add('warn', 'cringe', 'Ear-rape loud (average ' + facts.meanVolumeDb.toFixed(0) + ' dB)', 'Distorted loud audio is a classic "cringe" delete.');
    else if (Number.isFinite(facts.meanVolumeDb) && facts.meanVolumeDb < -38) add('warn', 'cringe', 'Very quiet (average ' + facts.meanVolumeDb.toFixed(0) + ' dB)', 'Speed will not hear it on stream.');
    if (dur > 0 && facts.silenceSec / dur > 0.5) add('warn', 'cringe', 'Mostly silent (' + Math.round((100 * facts.silenceSec) / dur) + '%)', 'Dead air gets skipped.');
  }
  if (dur > 0 && facts.blackSec / dur > 0.25) add('warn', 'cringe', 'Black screen for ' + Math.round(facts.blackSec) + ' s', 'Looks broken.');
  if ((facts.startBlackSec || 0) >= 1.5 || (facts.startSilentSec || 0) >= 2.5) add('warn', 'cringe', 'Slow start', 'The first seconds are black or silent. Viewers decide in 2-3 seconds; cut the dead start.');
  if (dur > 15 && Number.isFinite(facts.motion) && facts.motion < 0.3) add('warn', 'cringe', 'The picture barely changes', 'A still image with audio is hard to react to.');

  // --- Repeats ---
  const mine = informative(facts.hashes);
  let worst = null;
  for (const h of opts.history || []) {
    if (facts.sha256 && h.sha256 === facts.sha256) { worst = { h, sim: 1, exact: true }; break; }
    const sim = Math.max(similarity(mine, informative(h.hashes)), similarity(informative(h.hashes), mine) * 0.9);
    if (!worst || sim > worst.sim) worst = { h, sim };
  }
  if (worst && (worst.exact || worst.sim >= 0.6)) {
    const when = worst.h.postedAt ? ' on ' + new Date(worst.h.postedAt).toLocaleDateString() : '';
    add('block', 'repeat', worst.exact ? 'You already posted this exact file' + when : 'Looks like a clip you already posted' + when + ' (' + Math.round(worst.sim * 100) + '% the same)', 'Reposting the same clip can get you blacklisted from posting.', [worst.h.fileName]);
  } else if (worst && worst.sim >= 0.3) {
    add('warn', 'repeat', 'Partly the same as ' + worst.h.fileName + ' (' + Math.round(worst.sim * 100) + '%)', 'Fine if it is a different moment; mods delete near-repeats.');
  } else if (opts.history && opts.history.length) {
    add('ok', 'repeat', 'Not a repeat of your ' + opts.history.length + ' posted clip' + (opts.history.length === 1 ? '' : 's'), '');
  }

  // --- Text: your message and words on screen ---
  const textFindings = [...scanText(opts.caption, 'your message'), ...scanText(facts.ocrText, 'on screen')];
  const eng = [englishCheck(opts.caption, 'your message'), englishCheck(facts.ocrText, 'on screen')].filter(Boolean);
  for (const f of [...textFindings, ...eng]) items.push(f);
  if (!textFindings.length && !eng.length) add('ok', 'promo', facts.ocrOk ? 'No ads, handles, begging or slurs in your message or on screen' : 'No ads, begging or slurs in your message', '');
  if (!facts.ocrOk) add('warn', 'promo', 'On-screen text was not checked', 'Text reading failed for this clip, so check by eye for @handles and links.');

  const blocks = items.filter((i) => i.level === 'block');
  const warns = items.filter((i) => i.level === 'warn');
  const score = Math.max(0, 100 - 45 * blocks.length - 12 * warns.length);
  let verdict;
  let headline;
  if (blocks.length) {
    verdict = 'dont';
    headline = "DON'T POST: " + blocks[0].title.replace(/ \(.*\)$/, '') + (blocks.length > 1 ? ' (+' + (blocks.length - 1) + ' more)' : '');
  } else if (warns.length >= 2) {
    verdict = 'risky';
    headline = 'RISKY: ' + warns.length + ' things could get it deleted or skipped';
  } else {
    verdict = 'post';
    headline = warns.length ? 'POST: one small thing to look at' : 'POST: nothing against the rules found';
  }
  return {
    verdict,
    headline,
    score,
    items: [...blocks, ...warns, ...items.filter((i) => i.level === 'ok')],
    notChecked: [
      'Words said out loud (slurs or self-promo in the audio). Listen once before posting.',
      'Nudity or gore in the picture.',
      'Whether the clip was taken from someone else.',
      'Whether it is AI-made beyond the "certain extent" the rules allow.',
      'Whether it is actually funny. That one is on you.',
    ],
    rules: RULES,
  };
}

module.exports = { checkClip, scanText, englishCheck, normalize, similarity, hamming, informative, RULES };
