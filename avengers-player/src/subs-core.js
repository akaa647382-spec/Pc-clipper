/*!
 * Avengers Player: subtitle decoding and parsing.
 * Pure code with no DOM access: loaded by a <script> tag in the app (window.APSubs) and by Node
 * for the unit tests (module.exports).
 *
 * Everything a subtitle file says ends up in innerHTML, so the one hard rule here is that the
 * `html` of a cue contains escaped text plus only <i>, <b>, <u> and <br>, always well formed.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.APSubs = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ENCODINGS = [
    { id: 'auto', label: 'Auto-detect' },
    { id: 'utf-8', label: 'Unicode (UTF-8)' },
    { id: 'utf-16le', label: 'Unicode (UTF-16 LE)' },
    { id: 'utf-16be', label: 'Unicode (UTF-16 BE)' },
    { id: 'windows-1252', label: 'Western European (Windows-1252)' },
    { id: 'windows-1256', label: 'Arabic (Windows-1256)' },
    { id: 'windows-1251', label: 'Cyrillic (Windows-1251)' },
    { id: 'windows-1250', label: 'Central European (Windows-1250)' },
    { id: 'windows-1253', label: 'Greek (Windows-1253)' },
    { id: 'windows-1254', label: 'Turkish (Windows-1254)' },
    { id: 'windows-1255', label: 'Hebrew (Windows-1255)' },
    { id: 'windows-1257', label: 'Baltic (Windows-1257)' },
    { id: 'windows-1258', label: 'Vietnamese (Windows-1258)' },
    { id: 'windows-874', label: 'Thai (Windows-874)' },
    { id: 'gbk', label: 'Chinese Simplified (GBK)' },
    { id: 'big5', label: 'Chinese Traditional (Big5)' },
    { id: 'shift_jis', label: 'Japanese (Shift JIS)' },
    { id: 'euc-kr', label: 'Korean (EUC-KR)' }
  ];

  /* ============================================================ decoding === */

  function toBytes(input) {
    if (input instanceof Uint8Array) return input;
    if (typeof ArrayBuffer !== 'undefined' && input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
    return new Uint8Array(0);
  }

  function tryDecode(bytes, encoding, fatal) {
    try {
      return new TextDecoder(encoding, { fatal: !!fatal }).decode(bytes);
    } catch (e) {
      return null;
    }
  }

  const stripBom = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

  // What real text in each legacy code page is mostly made of. `common` characters are the
  // frequent letters of the languages written in that code page; `script` is the block its
  // letters live in. A wrong guess decodes to rare letters, symbols or mixed-up capitals.
  const PROFILES = {
    'windows-1252': { latin: true, common: 'éèàêçáíóúñäöüßãõâôåøæùîïûìòëÉÀÇÑÖÜÄÅØÁÍÓÚ’‘“”–—…«»¿¡°' },
    'windows-1250': { latin: true, common: 'ąćęłńóśźżĄĆĘŁŃÓŚŹŻáčďéěíňřšťúůýžÁČĎÉĚÍŇŘŠŤÚŮÝŽőűŐŰöüÖÜăâîşţ„”–' },
    'windows-1254': { latin: true, common: 'ğışİŞĞçöüÇÖÜâî' },
    'windows-1257': { latin: true, common: 'āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽąęėįųĄĘĖĮŲõäöüÕÄÖÜ' },
    'windows-1258': { latin: true, common: 'ăâêôơưđĂÂÊÔƠƯĐ̣̀́̃̉' },
    'windows-1251': { lo: 0x0400, hi: 0x04FF, cased: true, common: 'оеаинтсрвлкмдпуяыьгзбчОЕАИНТСРВЛКМДПіїєІЇЄ' },
    'windows-1253': { lo: 0x0370, hi: 0x03FF, cased: true, common: 'αοιετνσρκπμυλωηγδχθφβςάέήίόύώΑΟΙΕΤΝΣΡΚΠΜ' },
    'windows-1255': { lo: 0x0590, hi: 0x05FF, common: 'יוהמלארתבשנדכעפקחסזגצטםןךףץ' },
    'windows-1256': { lo: 0x0600, hi: 0x06FF, common: 'ايلمنوهرتبعدسفكقحجشصخزثذضغظطةىءآأإؤئ،؟' },
    'windows-874': { lo: 0x0E00, hi: 0x0E7F, common: 'นารกอเงมยวสดทลบหคปจแไีัิ่้ืุูะใโพขช็์ำตถ' }
  };
  const CJK_COMMON = {
    gbk: '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长',
    big5: '的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長',
    shift_jis: 'のにはをたがでてとしれさあるいうもなこっかだすくまけきよらりんどえやそおつ、。ーアイウエオカキクケコサシスセソタチツテトナニヌネノンルレロラリ',
    'euc-kr': ''
  };
  const isCjk = (c) => (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0x3400 && c <= 0x4DBF);
  const isAsciiLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  const isLatinLetter = (c) => (c >= 0xC0 && c <= 0x24F && c !== 0xD7 && c !== 0xF7) || (c >= 0x300 && c <= 0x36F);

  /** How much a decoded text looks like something a human wrote. Higher is better, about -5..2. */
  function plausibility(text, encoding) {
    const p = PROFILES[encoding];
    const cjk = CJK_COMMON[encoding];
    const len = text.length;
    let high = 0;
    let score = 0;
    for (let i = 0; i < len; i++) {
      const c = text.charCodeAt(i);
      if (c < 0x80) continue;
      high++;
      if (c === 0xFFFD || (c >= 0x80 && c <= 0x9F)) { score -= 5; continue; }
      const prev = i > 0 ? text.charCodeAt(i - 1) : 32;
      const next = i + 1 < len ? text.charCodeAt(i + 1) : 32;
      const ch = text.charAt(i);
      if (cjk !== undefined) {
        const run = isCjk(prev) || isCjk(next);
        if (!isCjk(c)) { score += (c >= 0xFF61 && c <= 0xFF9F) ? -0.5 : 0.1; continue; }   // half-width kana, punctuation
        if (!run && (isAsciiLetter(prev) || isAsciiLetter(next))) { score -= 1; continue; }   // a lone ideograph inside a Latin word
        if (encoding === 'euc-kr') score += c >= 0xAC00 && c <= 0xD7AF ? 2 : 0.6;
        else score += cjk.indexOf(ch) >= 0 ? 2 : 1.1;
        continue;
      }
      if (p.latin) {
        const letter = isLatinLetter(c);
        if (!letter) {
          // A symbol wedged between two letters ("pi³ka") means the code page is wrong.
          // Apostrophes and dashes are the exception: "c’est", "peut–être".
          const joiner = '’‘´`–—·'.indexOf(ch) >= 0;
          score += !joiner && isAsciiLetter(prev) && isAsciiLetter(next) ? -3 : (p.common.indexOf(ch) >= 0 ? 1 : 0);
          continue;
        }
        score += p.common.indexOf(ch) >= 0 ? 2 : 0.4;
        if (prev >= 0x80 && next >= 0x80) score -= 1.6;       // Western text has accents sprinkled in, not in runs
        continue;
      }
      const inScript = c >= p.lo && c <= p.hi;
      if (!inScript) { score += (isAsciiLetter(prev) && isAsciiLetter(next)) || isLatinLetter(c) ? -2 : 0; continue; }
      // A Greek, Cyrillic, Hebrew, Arabic or Thai letter glued to a Latin word is an accented
      // Latin letter read through the wrong code page.
      if (isAsciiLetter(prev) || isAsciiLetter(next)) { score -= 3; continue; }
      score += p.common.indexOf(ch) >= 0 ? 2 : 0.3;
      if (p.cased) {
        // A capital in the middle of a word is what a wrong code page looks like.
        const upper = ch !== ch.toLowerCase();
        const prevCh = text.charAt(i - 1);
        if (upper && prev >= p.lo && prev <= p.hi && prevCh === prevCh.toLowerCase() && prevCh !== prevCh.toUpperCase()) score -= 2.5;
      }
      if (encoding === 'windows-1253' && ch === 'ς' && next >= p.lo && next <= p.hi) score -= 3;   // final sigma only ends words
    }
    return high ? score / high : 0;
  }

  function guessLegacy(bytes) {
    // Look at a sample: enough to judge, cheap on a big file.
    const sample = bytes.length > 60000 ? bytes.subarray(0, 60000) : bytes;
    let best = { encoding: 'windows-1252', score: -Infinity };
    for (const encoding of Object.keys(PROFILES)) {
      const text = tryDecode(sample, encoding, false);
      if (text == null) continue;
      let score = plausibility(text, encoding);
      if (encoding === 'windows-1252') score += 0.05;          // the most common one wins ties
      if (score > best.score) best = { encoding: encoding, score: score };
    }
    for (const encoding of Object.keys(CJK_COMMON)) {
      // Multi-byte encodings are strict: bytes that are not valid pairs rule them out.
      let cut = sample;
      let text = tryDecode(cut, encoding, true);
      for (let trim = 1; text == null && trim <= 2 && cut.length > trim; trim++) text = tryDecode(sample.subarray(0, sample.length - trim), encoding, true);
      if (text == null) continue;
      const score = plausibility(text, encoding);
      if (score > best.score) best = { encoding: encoding, score: score };
    }
    return best.encoding;
  }

  /** bytes -> { text, encoding, confident }. Never throws. */
  function decode(input, encoding) {
    const bytes = toBytes(input);
    const want = String(encoding || 'auto').toLowerCase();
    try {
      // A byte order mark settles it, whatever was asked for.
      if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        return { text: stripBom(tryDecode(bytes, 'utf-8', false) || ''), encoding: 'utf-8', confident: true };
      }
      if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) {
        return { text: stripBom(tryDecode(bytes, 'utf-16le', false) || ''), encoding: 'utf-16le', confident: true };
      }
      if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
        return { text: stripBom(tryDecode(bytes, 'utf-16be', false) || ''), encoding: 'utf-16be', confident: true };
      }
      if (want !== 'auto') {
        const text = tryDecode(bytes, want, false);
        if (text != null) return { text: stripBom(text), encoding: want, confident: true };
        return { text: stripBom(tryDecode(bytes, 'windows-1252', false) || ''), encoding: 'windows-1252', confident: false };
      }
      // UTF-16 without a mark: every other byte is zero for Latin text.
      if (bytes.length >= 8) {
        const n = Math.min(bytes.length & ~1, 4000);
        let evenZero = 0;
        let oddZero = 0;
        for (let i = 0; i < n; i += 2) { if (bytes[i] === 0) evenZero++; if (bytes[i + 1] === 0) oddZero++; }
        if (oddZero > n * 0.2 && evenZero < n * 0.02) return { text: stripBom(tryDecode(bytes, 'utf-16le', false) || ''), encoding: 'utf-16le', confident: true };
        if (evenZero > n * 0.2 && oddZero < n * 0.02) return { text: stripBom(tryDecode(bytes, 'utf-16be', false) || ''), encoding: 'utf-16be', confident: true };
      }
      const utf8 = tryDecode(bytes, 'utf-8', true);
      if (utf8 != null) return { text: stripBom(utf8), encoding: 'utf-8', confident: true };
      const guess = guessLegacy(bytes);
      return { text: stripBom(tryDecode(bytes, guess, false) || ''), encoding: guess, confident: false };
    } catch (e) {
      let text = '';
      try { text = stripBom(tryDecode(bytes, 'windows-1252', false) || ''); } catch (e2) { text = ''; }
      return { text: text, encoding: 'windows-1252', confident: false };
    }
  }

  /* ============================================================= markup === */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '‎', rlm: '‏' };

  function decodeEntities(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,6});/g, (m, body) => {
      if (body.charAt(0) === '#') {
        const code = body.charAt(1) === 'x' || body.charAt(1) === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!(code > 0) || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return '';
        return String.fromCodePoint(code);
      }
      const named = NAMED[body.toLowerCase()];
      return named === undefined ? m : named;
    });
  }

  /**
   * Builds safe markup. Text goes in through text(), styles through set(); the builder keeps the
   * <i>/<b>/<u> tags balanced no matter in what order they are switched on and off.
   */
  function createBuilder() {
    const open = [];
    let html = '';
    let plain = '';
    const closeTo = (index) => { while (open.length > index) html += '</' + open.pop() + '>'; };
    return {
      set(tag, on) {
        const at = open.indexOf(tag);
        if (on) {
          if (at < 0) { open.push(tag); html += '<' + tag + '>'; }
          return;
        }
        if (at < 0) return;
        const reopen = open.slice(at + 1);
        closeTo(at);
        for (const t of reopen) { open.push(t); html += '<' + t + '>'; }
      },
      reset() { closeTo(0); },
      text(s) { if (s) { html += escapeHtml(s); plain += s; } },
      br() { html += '<br>'; plain += '\n'; },
      done() {
        closeTo(0);
        // Drop leading/trailing breaks and spaces, so an empty cue is really empty.
        const cleanPlain = plain.replace(/[ \t ]+\n/g, '\n').replace(/^\s+|\s+$/g, '');
        let cleanHtml = html.replace(/^(?:\s|<br>)+/, '').replace(/(?:\s|<br>)+$/, '');
        if (!cleanPlain) cleanHtml = '';
        return { html: cleanHtml, text: cleanPlain };
      }
    };
  }

  // Tags that carry no meaning for us: removed, their inner text kept.
  const STRIP_TAG = /^\/?(font|c|v|lang|ruby|rt|span|s|strike|small|big|a|p|div|center|sub|sup)(?![a-zA-Z0-9])/i;

  /** SRT / WebVTT cue text -> safe markup. Styling other than italic, bold and underline is dropped. */
  function renderTagged(raw) {
    const b = createBuilder();
    const lines = raw.split('\n');
    for (let li = 0; li < lines.length; li++) {
      if (li > 0) b.br();
      // ASS-style overrides such as {\an8} show up in SRT files too.
      const line = lines[li].replace(/\{\\[^}]{0,200}\}/g, '');
      let i = 0;
      while (i < line.length) {
        const lt = line.indexOf('<', i);
        if (lt < 0) { b.text(decodeEntities(line.slice(i))); break; }
        if (lt > i) b.text(decodeEntities(line.slice(i, lt)));
        const gt = line.indexOf('>', lt + 1);
        const inner = gt > lt ? line.slice(lt + 1, gt) : '';
        // Only known subtitle tags are treated as tags. Anything else, "2 < 3" or "<script>", stays
        // visible text (escaped), so nothing in a file can turn into live markup.
        const ok = gt > lt && gt - lt <= 300;
        const style = ok ? /^\s*(\/?)\s*(i|b|u|em|strong)\s*$/i.exec(inner) : null;
        if (style) {
          const name = style[2].toLowerCase();
          b.set(name === 'em' ? 'i' : name === 'strong' ? 'b' : name, style[1] !== '/');
        } else if (ok && /^\s*br\s*\/?\s*$/i.test(inner)) {
          b.br();
        } else if (!(ok && (STRIP_TAG.test(inner) || /^\d[\d:.,]*$/.test(inner)))) {
          b.text('<');
          i = lt + 1;
          continue;
        }
        i = gt + 1;
      }
    }
    return b.done();
  }

  /** ASS / SSA dialogue text -> safe markup. */
  function renderAss(raw) {
    const b = createBuilder();
    let drawing = false;
    let i = 0;
    const text = String(raw);
    while (i < text.length) {
      const c = text.charAt(i);
      if (c === '{') {
        const end = text.indexOf('}', i + 1);
        if (end < 0) { if (!drawing) b.text(text.slice(i)); break; }
        const block = text.slice(i + 1, end);
        const re = /\\([a-zA-Z]+)([^\\]*)/g;
        let m;
        while ((m = re.exec(block)) !== null) {
          const tag = m[1].toLowerCase();
          const arg = m[2].trim();
          if (tag === 'i') b.set('i', arg === '1');
          else if (tag === 'b') b.set('b', arg === '1' || +arg >= 500);      // \b700 is a font weight
          else if (tag === 'u') b.set('u', arg === '1');
          else if (tag === 'r') b.reset();
          else if (tag === 'p') drawing = /^\d+$/.test(arg) && +arg > 0;
        }
        i = end + 1;
        continue;
      }
      if (c === '\\' && i + 1 < text.length) {
        const n = text.charAt(i + 1);
        if (n === 'N' || n === 'n') { if (!drawing) b.br(); i += 2; continue; }
        if (n === 'h') { if (!drawing) b.text(' '); i += 2; continue; }
      }
      let next = i + 1;
      while (next < text.length && text.charAt(next) !== '{' && text.charAt(next) !== '\\') next++;
      if (!drawing) b.text(text.slice(i, next));
      i = next;
    }
    return b.done();
  }

  /* ============================================================= parsing === */

  /** "01:02:03,450", "02:03.4", "1:02:03" -> seconds, or NaN. */
  function parseTime(str) {
    const m = /^(?:(\d{1,5}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(str).trim());
    if (!m) return NaN;
    const h = m[1] ? +m[1] : 0;
    const frac = m[4] ? +((m[4] + '00').slice(0, 3)) / 1000 : 0;
    return h * 3600 + (+m[2]) * 60 + (+m[3]) + frac;
  }

  const TIMING = /^\s*((?:\d{1,5}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)\s*-{1,3}>\s*((?:\d{1,5}:)?\d{1,2}:\d{1,2}(?:[.,]\d{1,3})?)/;

  function parseBlocks(lines, isVtt, warnings) {
    const cues = [];
    let dropped = 0;
    let i = 0;
    const n = lines.length;
    while (i < n) {
      const line = lines[i];
      if (isVtt && /^(NOTE|STYLE|REGION)\b/.test(line) && !TIMING.test(line)) {
        while (i < n && lines[i].trim() !== '') i++;       // a comment or style block: skip to the blank line
        continue;
      }
      const m = TIMING.exec(line);
      if (!m) { i++; continue; }
      const start = parseTime(m[1]);
      const end = parseTime(m[2]);
      i++;
      const text = [];
      while (i < n) {
        const t = lines[i];
        if (t.trim() === '') {
          // A blank line ends the cue, unless the file has a stray blank inside the text:
          // that is the case only when what follows is neither a new cue nor the end.
          let j = i + 1;
          while (j < n && lines[j].trim() === '') j++;
          const nextIsCue = j >= n || TIMING.test(lines[j]) || (/^\s*\d+\s*$/.test(lines[j]) && j + 1 < n && TIMING.test(lines[j + 1])) ||
            (isVtt && j + 1 < n && TIMING.test(lines[j + 1])) || (isVtt && /^(NOTE|STYLE|REGION)\b/.test(lines[j]));
          if (nextIsCue || j - i > 1 || text.length === 0) break;
          i = j;
          continue;
        }
        if (TIMING.test(t)) break;                          // the next cue started without a blank line
        text.push(t);
        i++;
      }
      // A trailing index number belongs to the next cue.
      while (text.length > 1 && /^\s*\d+\s*$/.test(text[text.length - 1]) && i < n && TIMING.test(lines[i])) text.pop();
      const r = renderTagged(text.join('\n'));
      if (!(end > start) || !isFinite(start) || !r.text) { dropped++; continue; }
      cues.push({ start: start, end: end, text: r.text, html: r.html });
    }
    if (dropped) warnings.push(dropped + ' empty or invalid cue' + (dropped === 1 ? '' : 's') + ' skipped');
    return cues;
  }

  function parseAss(lines, warnings) {
    const cues = [];
    let dropped = 0;
    let format = null;
    let inEvents = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (line.charAt(0) === '[') { inEvents = /^\[events\]/i.test(line); continue; }
      if (/^format\s*:/i.test(line) && (inEvents || !format)) {
        if (inEvents) format = line.slice(line.indexOf(':') + 1).split(',').map((f) => f.trim().toLowerCase());
        continue;
      }
      const d = /^dialogue\s*:\s*(.*)$/i.exec(line);
      if (!d) continue;
      const fmt = format || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
      const iStart = fmt.indexOf('start');
      const iEnd = fmt.indexOf('end');
      if (iStart < 0 || iEnd < 0) { dropped++; continue; }
      const parts = [];
      let rest = d[1];
      for (let k = 0; k < fmt.length - 1; k++) {
        const comma = rest.indexOf(',');
        if (comma < 0) break;
        parts.push(rest.slice(0, comma));
        rest = rest.slice(comma + 1);
      }
      if (parts.length < fmt.length - 1) { dropped++; continue; }
      const start = parseTime(parts[iStart]);
      const end = parseTime(parts[iEnd]);
      const r = renderAss(rest);
      if (!(end > start) || !isFinite(start) || !r.text) { dropped++; continue; }
      cues.push({ start: start, end: end, text: r.text, html: r.html });
    }
    if (dropped) warnings.push(dropped + ' empty or invalid line' + (dropped === 1 ? '' : 's') + ' skipped');
    return cues;
  }

  /** text -> { format, cues, warnings }. Never throws. */
  function parse(text, nameHint) {
    const warnings = [];
    try {
      const src = stripBom(String(text == null ? '' : text)).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
      const lines = src.split('\n');
      const hint = /\.([a-z0-9]+)$/i.exec(String(nameHint || ''));
      const ext = hint ? hint[1].toLowerCase() : '';
      let format = 'unknown';
      if (/^\s*WEBVTT/.test(src)) format = 'vtt';
      else if (/^\s*\[(script info|events|v4\+? styles)\]/im.test(src) || /^dialogue\s*:/im.test(src)) format = 'ass';
      else if (lines.some((l) => TIMING.test(l))) format = ext === 'vtt' ? 'vtt' : 'srt';
      else if (ext === 'ass' || ext === 'ssa') format = 'ass';

      let cues = [];
      if (format === 'ass') cues = parseAss(lines, warnings);
      else if (format === 'srt' || format === 'vtt') cues = parseBlocks(lines, format === 'vtt', warnings);
      if (!cues.length && format === 'ass' && lines.some((l) => TIMING.test(l))) { format = 'srt'; cues = parseBlocks(lines, false, warnings); }
      cues.sort((a, b) => (a.start - b.start) || (a.end - b.end));
      if (!cues.length && format !== 'unknown') warnings.push('no subtitle lines found');
      return { format: cues.length ? format : (format === 'unknown' ? 'unknown' : format), cues: cues, warnings: warnings };
    } catch (e) {
      return { format: 'unknown', cues: [], warnings: ['could not read the file'] };
    }
  }

  /* ============================================================== lookup === */

  const NONE = Object.freeze([]);

  /** Prepares cues (sorted by start) for fast lookup. */
  function createIndex(cues) {
    const list = (cues || []).slice().sort((a, b) => (a.start - b.start) || (a.end - b.end));
    const starts = new Float64Array(list.length);
    const maxEnd = new Float64Array(list.length);       // latest end among cues 0..i: bounds the backward scan
    let running = -Infinity;
    for (let i = 0; i < list.length; i++) {
      starts[i] = list[i].start;
      if (list[i].end > running) running = list[i].end;
      maxEnd[i] = running;
    }
    return { cues: list, starts: starts, maxEnd: maxEnd, last: NONE };
  }

  /**
   * All cues with start <= t < end, in start order. Returns the very same array as the previous
   * call when nothing changed, so the caller can skip its DOM work with an identity check.
   */
  function activeAt(index, t) {
    if (!index || !index.cues.length || !(t === t)) return NONE;
    const starts = index.starts;
    let lo = 0;
    let hi = starts.length - 1;
    let at = -1;
    while (lo <= hi) {                                   // last cue that starts at or before t
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= t) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    let found = null;
    for (let i = at; i >= 0 && index.maxEnd[i] > t; i--) {
      if (index.cues[i].end > t) (found || (found = [])).push(index.cues[i]);
    }
    if (!found) { index.last = NONE; return NONE; }
    found.reverse();
    const prev = index.last;
    if (prev.length === found.length) {
      let same = true;
      for (let i = 0; i < found.length; i++) if (prev[i] !== found[i]) { same = false; break; }
      if (same) return prev;
    }
    index.last = found;
    return found;
  }

  return {
    ENCODINGS: ENCODINGS,
    decode: decode,
    parse: parse,
    createIndex: createIndex,
    activeAt: activeAt,
    parseTime: parseTime,
    escapeHtml: escapeHtml
  };
});
