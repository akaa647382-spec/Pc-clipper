'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../src/subs-core.js');

const enc = (text, encoding) => {
  // Encode with Node for the legacy code pages the tests need.
  if (encoding === 'utf-8') return new Uint8Array(Buffer.from(text, 'utf8'));
  if (encoding === 'utf-16le') return new Uint8Array(Buffer.from(text, 'utf16le'));
  const table = new Map();
  const dec = new TextDecoder(encoding);
  for (let b = 0x80; b <= 0xFF; b++) { const ch = dec.decode(new Uint8Array([b])); if (ch !== '�') table.set(ch, b); }
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (table.has(ch)) out.push(table.get(ch));
    else throw new Error('cannot encode ' + ch + ' in ' + encoding);
  }
  return new Uint8Array(out);
};

/** The only tags allowed in cue html, always balanced. */
function assertSafe(html, label) {
  const stripped = html.replace(/<\/?(i|b|u)>|<br>/g, '');
  assert.ok(!/[<>]/.test(stripped), label + ': stray markup in ' + JSON.stringify(html));
  assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(stripped), label + ': unescaped ampersand in ' + JSON.stringify(html));
  const stack = [];
  for (const m of html.matchAll(/<(\/?)(i|b|u)>/g)) {
    if (!m[1]) stack.push(m[2]); else assert.equal(stack.pop(), m[2], label + ': unbalanced ' + html);
  }
  assert.equal(stack.length, 0, label + ': unclosed tag in ' + html);
}

const SRT = [
  '1', '00:00:01,000 --> 00:00:04,000', 'Hello there.', '',
  '2', '00:00:05,500 --> 00:00:07,250', '<i>Italic</i> and <b>bold</b>', 'second line', '',
  '3', '01:02:03,004 --> 01:02:05,006', 'Late one', ''
].join('\r\n');

test('SRT: basic parsing', () => {
  const r = S.parse(SRT, 'movie.srt');
  assert.equal(r.format, 'srt');
  assert.equal(r.cues.length, 3);
  assert.deepEqual([r.cues[0].start, r.cues[0].end], [1, 4]);
  assert.equal(r.cues[0].text, 'Hello there.');
  assert.equal(r.cues[1].start, 5.5);
  assert.equal(r.cues[1].end, 7.25);
  assert.equal(r.cues[1].html, '<i>Italic</i> and <b>bold</b><br>second line');
  assert.equal(r.cues[1].text, 'Italic and bold\nsecond line');
  assert.ok(Math.abs(r.cues[2].start - 3723.004) < 1e-9);
});

test('SRT: tolerant of real-world mess', () => {
  const messy = [
    '﻿00:00:01.5 --> 00:00:02.75  X1:100 X2:200 Y1:10 Y2:20', 'no index, dot separator, coordinates',
    '2', '0:03,000 --> 0:04,000', 'no hours', '',
    '', '',
    'x', '00:00:05,000 --> 00:00:06,000', '{\\an8}top <font color="#ff0000">red</font> text', '',
    '4', '00:00:07,000 --> 00:00:08,000', 'line one', '', 'line two after a stray blank', '',
    '5', '00:00:09,000 --> 00:00:09,000', 'zero length is dropped', '',
    '6', '00:00:10,000 --> 00:00:11,000', '', '',
    '7', '00:00:12,000 --> 00:00:13,000', '2 < 3 & 5 > 4', '',
    '8', '100:00:00,000 --> 100:00:01,000', 'hour one hundred'
  ].join('\n');
  const r = S.parse(messy, 'x.srt');
  const texts = r.cues.map((c) => c.text);
  assert.deepEqual(texts, ['no index, dot separator, coordinates', 'no hours', 'top red text', 'line one\nline two after a stray blank', '2 < 3 & 5 > 4', 'hour one hundred']);
  assert.equal(r.cues[0].start, 1.5);
  assert.equal(r.cues[0].end, 2.75);
  assert.equal(r.cues[1].start, 3);
  assert.equal(r.cues[4].html, '2 &lt; 3 &amp; 5 &gt; 4');
  assert.equal(r.cues[5].start, 360000);
  assert.ok(r.warnings.length >= 1);
  r.cues.forEach((c, i) => assertSafe(c.html, 'messy ' + i));
});

test('SRT: cues without blank lines between them', () => {
  const r = S.parse('1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:03,000 --> 00:00:04,000\nB\n3\n00:00:05,000 --> 00:00:06,000\nC', 'a.srt');
  assert.deepEqual(r.cues.map((c) => c.text), ['A', 'B', 'C']);
});

test('WebVTT: header, notes, styles, identifiers, settings, tags, entities', () => {
  const vtt = [
    'WEBVTT - some title', '',
    'NOTE this is a comment', 'spanning lines', '',
    'STYLE', '::cue { color: red }', '',
    'intro', '00:01.000 --> 00:03.000 line:0 position:20% align:start', '<v Tony>I am <c.loud>Iron</c> Man</v>', '',
    '00:00:04.000 --> 00:00:06.000', '<i>italic <b>both</i> still bold</b> &amp; &lt;b&gt;not bold&lt;/b&gt; &#169; &nbsp;x', '',
    '00:00:07.000 --> 00:00:08.000', 'karaoke <00:00:07.500>timed <ruby>base<rt>ann</rt></ruby>'
  ].join('\n');
  const r = S.parse(vtt, 'a.vtt');
  assert.equal(r.format, 'vtt');
  assert.equal(r.cues.length, 3);
  assert.equal(r.cues[0].start, 1);
  assert.equal(r.cues[0].html, 'I am Iron Man');
  assert.equal(r.cues[1].text, 'italic both still bold & <b>not bold</b> ©  x');
  assert.ok(r.cues[1].html.includes('&lt;b&gt;not bold&lt;/b&gt;'), r.cues[1].html);
  assert.equal(r.cues[2].text, 'karaoke timed baseann');
  r.cues.forEach((c, i) => assertSafe(c.html, 'vtt ' + i));
});

test('ASS: format line, commas in text, overrides, drawings, comments', () => {
  const ass = [
    '[Script Info]', 'Title: x', '',
    '[V4+ Styles]', 'Format: Name, Fontname, Fontsize', 'Style: Default,Arial,20', '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,Hello, world, with commas',
    'Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\an8\\pos(10,20)}{\\i1}italic{\\i0} plain\\Nsecond\\hline {\\b1}bold{\\b0}{\\u1}u',
    'Comment: 0,0:00:06.00,0:00:07.00,Default,,0,0,0,,not shown',
    'Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}',
    'Dialogue: 0,0:00:10.00,0:00:11.00,Default,,0,0,0,,{\\b700}heavy{\\b400} normal <script>x</script>',
    'Dialogue: 0,0:00:12.00,0:00:11.00,Default,,0,0,0,,backwards'
  ].join('\n');
  const r = S.parse(ass, 'a.ass');
  assert.equal(r.format, 'ass');
  assert.deepEqual(r.cues.map((c) => c.text), ['Hello, world, with commas', 'italic plain\nsecond line boldu', 'heavy normal <script>x</script>']);
  assert.equal(r.cues[0].end, 3.5);
  assert.equal(r.cues[1].html, '<i>italic</i> plain<br>second line <b>bold</b><u>u</u>');
  assert.equal(r.cues[2].html, '<b>heavy</b> normal &lt;script&gt;x&lt;/script&gt;');
  r.cues.forEach((c, i) => assertSafe(c.html, 'ass ' + i));
});

test('nothing in a file can become live markup', () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<i onmouseover="alert(1)">hover</i>',
    '<a href="javascript:alert(1)">click</a>',
    '<b><i>unclosed',
    '</i></b>stray closers',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
    '&#60;img src=x onerror=alert(1)&#62;',
    '<iframe src="https://example.com">',
    '<svg/onload=alert(1)>',
    '<i><b></i></b><u>',
    '"quotes" \'single\' & ampersand',
    '<<i>>nested<</i>>',
    '<font color="red" onclick="x()">font</font>'
  ];
  const srt = attacks.map((a, i) => (i + 1) + '\n00:00:' + String(i).padStart(2, '0') + ',000 --> 00:00:' + String(i).padStart(2, '0') + ',900\n' + a + '\n').join('\n');
  const vtt = 'WEBVTT\n\n' + attacks.map((a, i) => '00:00:' + String(i).padStart(2, '0') + '.000 --> 00:00:' + String(i).padStart(2, '0') + '.900\n' + a + '\n').join('\n');
  const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
    attacks.map((a, i) => 'Dialogue: 0,0:00:' + String(i).padStart(2, '0') + '.00,0:00:' + String(i).padStart(2, '0') + '.90,Default,,0,0,0,,' + a).join('\n');
  for (const [name, text] of [['srt', srt], ['vtt', vtt], ['ass', ass]]) {
    const r = S.parse(text, 'x.' + name);
    assert.ok(r.cues.length >= attacks.length - 3, name + ' kept ' + r.cues.length);
    for (const c of r.cues) {
      assertSafe(c.html, name);
      assert.ok(!/on\w+\s*=\s*["']?[^&]/i.test(c.html.replace(/&[a-z#0-9]+;/g, ' ')) || !/</.test(c.html.replace(/<\/?(i|b|u)>|<br>/g, '')), name + ': ' + c.html);
    }
  }
  const r = S.parse(srt, 'x.srt');
  assert.equal(r.cues[0].html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(r.cues[2].html, '&lt;i onmouseover=&quot;alert(1)&quot;&gt;hover', 'a styled tag with attributes is not accepted as a tag');
  assert.equal(r.cues[6].text, '<script>alert(1)</script>', 'entity-encoded tags show as literal text');
  assert.equal(r.cues[6].html, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(r.cues[4].html, '<b><i>unclosed</i></b>', 'unclosed tags are closed');
});

test('garbage in, nothing out, never throws', () => {
  for (const junk of ['', '   ', 'hello world', null, undefined, 42, '-->', '00:00 --> ', 'WEBVTT', '[Events]\nDialogue: broken', '\u0000\u0001\u0002']) {
    const r = S.parse(junk, 'x.srt');
    assert.equal(r.cues.length, 0);
    assert.ok(Array.isArray(r.warnings));
  }
  assert.equal(S.parse('hello', 'x.txt').format, 'unknown');
});

test('a huge hostile file parses quickly', () => {
  const big = ('<'.repeat(200) + '{\\'.repeat(200) + '&'.repeat(200) + '\n').repeat(4000) +
    '1\n00:00:01,000 --> 00:00:02,000\n' + '<i>'.repeat(20000) + 'x\n';
  const t0 = Date.now();
  const r = S.parse(big, 'x.srt');
  assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
  r.cues.forEach((c) => assertSafe(c.html, 'hostile'));
});

test('decode: BOMs, UTF-8, UTF-16', () => {
  assert.deepEqual(S.decode(enc('﻿héllo', 'utf-8')), { text: 'héllo', encoding: 'utf-8', confident: true });
  assert.deepEqual(S.decode(enc('héllo wörld', 'utf-8')), { text: 'héllo wörld', encoding: 'utf-8', confident: true });
  assert.deepEqual(S.decode(enc('﻿hello €', 'utf-16le')), { text: 'hello €', encoding: 'utf-16le', confident: true });
  const noBom = S.decode(enc('1\n00:00:01,000 --> 00:00:02,000\nHello there\n', 'utf-16le'));
  assert.equal(noBom.encoding, 'utf-16le');
  assert.ok(noBom.text.includes('Hello there'));
  assert.equal(S.decode(new Uint8Array(0)).text, '');
  assert.equal(S.decode(enc('abc', 'utf-8').buffer).text, 'abc');
  assert.equal(S.decode(enc('café', 'windows-1252'), 'windows-1252').text, 'café');
  assert.equal(S.decode(enc('abc', 'utf-8'), 'not-a-real-encoding').encoding, 'windows-1252');
});

test('decode: legacy code pages are guessed, and flagged as a guess', () => {
  const cases = [
    ['windows-1252', 'Je suis désolé, ça ne va pas être possible. Où est-ce que tu étais hier soir ? Voilà, c’est déjà fini.'],
    ['windows-1252', 'Ich weiß, dass es schön wäre. Können wir über die Straße gehen? Für größere Mädchen müssen wir zurück.'],
    ['windows-1252', '¿Dónde está el niño? Mañana será otro día. ¡Qué sorpresa más grande! No sé qué decirte, de verdad.'],
    ['windows-1256', 'أنا الرجل الحديدي. لقد فعلنا كل ما في وسعنا، والآن علينا أن ننتظر. ماذا تريد أن تفعل؟ شكراً لك يا صديقي.'],
    ['windows-1251', 'Я железный человек. Мы сделали всё, что могли, и теперь должны ждать. Что ты хочешь сделать? Спасибо тебе, мой друг.'],
    ['windows-1253', 'Είμαι ο σιδερένιος άνθρωπος. Κάναμε ό,τι μπορούσαμε και τώρα πρέπει να περιμένουμε. Τι θέλεις να κάνεις; Ευχαριστώ, φίλε μου.'],
    ['windows-1255', 'אני איש הברזל. עשינו כל מה שיכולנו ועכשיו עלינו לחכות. מה אתה רוצה לעשות? תודה לך חבר שלי.'],
    ['windows-1254', 'Ben Demir Adamım. Elimizden gelen her şeyi yaptık, şimdi beklememiz gerekiyor. Ne yapmak istiyorsun? Teşekkür ederim arkadaşım, çok güzel.'],
    ['windows-1250', 'Jestem Iron Manem. Zrobiliśmy wszystko, co mogliśmy, a teraz musimy poczekać. Co chcesz zrobić? Dziękuję ci, mój przyjacielu, żegnaj.'],
    ['windows-874', 'ฉันคือไอรอนแมน เราทำทุกอย่างที่ทำได้แล้ว ตอนนี้เราต้องรอ คุณต้องการทำอะไร ขอบคุณเพื่อนของฉัน']
  ];
  for (const [encoding, text] of cases) {
    const srt = '1\n00:00:01,000 --> 00:00:04,000\n' + text + '\n\n2\n00:00:05,000 --> 00:00:08,000\n' + text + '\n';
    const r = S.decode(enc(srt, encoding));
    assert.equal(r.encoding, encoding, 'detected ' + r.encoding + ' for ' + text.slice(0, 24));
    assert.equal(r.confident, false);
    assert.ok(r.text.includes(text), 'round trip for ' + encoding);
    assert.equal(S.parse(r.text, 'x.srt').cues.length, 2);
  }
});

test('decode: East Asian encodings', () => {
  const samples = {
    gbk: '我是钢铁侠。我们已经做了我们能做的一切，现在我们必须等待。你想做什么？谢谢你，我的朋友。这是我们的时间。',
    big5: '我是鋼鐵人。我們已經做了我們能做的一切，現在我們必須等待。你想做什麼？謝謝你，我的朋友。這是我們的時間。',
    shift_jis: '私はアイアンマンだ。できることはすべてやった。今は待つしかない。君は何がしたいんだ？ありがとう、友よ。',
    'euc-kr': '나는 아이언맨이다. 우리는 할 수 있는 모든 것을 했고 이제 기다려야 한다. 무엇을 하고 싶은가? 고마워, 친구.'
  };
  const iconv = (text, encoding) => {
    // Node cannot encode these: go through Python, which ships with every codec.
    const r = require('node:child_process').spawnSync('python3', ['-c', 'import sys; sys.stdout.buffer.write(sys.stdin.buffer.read().decode("utf-8").encode(sys.argv[1]))', encoding], { input: Buffer.from(text, 'utf8') });
    return r.status === 0 ? new Uint8Array(r.stdout) : null;
  };
  for (const [encoding, text] of Object.entries(samples)) {
    const bytes = iconv('1\n00:00:01,000 --> 00:00:04,000\n' + text + '\n', encoding === 'shift_jis' ? 'cp932' : encoding === 'euc-kr' ? 'cp949' : encoding);
    if (!bytes) continue;                      // no Python on this machine: skip
    const r = S.decode(bytes);
    assert.equal(r.encoding, encoding, 'detected ' + r.encoding + ' for ' + encoding);
    assert.ok(r.text.includes(text));
  }
});

test('activeAt: boundaries, overlaps and identity', () => {
  const cues = [
    { start: 1, end: 4, text: 'a', html: 'a' },
    { start: 2, end: 3, text: 'b', html: 'b' },
    { start: 2, end: 100, text: 'long', html: 'long' },
    { start: 50, end: 51, text: 'c', html: 'c' }
  ];
  const idx = S.createIndex(cues);
  const names = (t) => S.activeAt(idx, t).map((c) => c.text).join(',');
  assert.equal(names(0.99), '');
  assert.equal(names(1), 'a', 'start is inclusive');
  assert.equal(names(2), 'a,b,long');
  assert.equal(names(3), 'a,long', 'end is exclusive');
  assert.equal(names(4), 'long');
  assert.equal(names(50.5), 'long,c');
  assert.equal(names(99.999), 'long');
  assert.equal(names(100), '');
  assert.equal(names(NaN), '');
  const a = S.activeAt(idx, 2.1);
  const b = S.activeAt(idx, 2.2);
  assert.equal(a, b, 'same array instance while nothing changes');
  assert.equal(S.activeAt(idx, 500), S.activeAt(idx, 600), 'same empty array');
  assert.equal(S.activeAt(null, 1).length, 0);
  assert.equal(S.activeAt(S.createIndex([]), 1).length, 0);
});

test('activeAt matches brute force on 3000 cues at random times', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const cues = [];
  for (let i = 0; i < 3000; i++) {
    const start = rnd() * 10800;
    cues.push({ start, end: start + 0.2 + rnd() * (i % 97 === 0 ? 600 : 6), text: 'c' + i, html: 'c' + i });
  }
  const idx = S.createIndex(cues);
  const sorted = cues.slice().sort((a, b) => (a.start - b.start) || (a.end - b.end));
  const t0 = Date.now();
  for (let k = 0; k < 4000; k++) {
    const t = k % 2 ? rnd() * 10900 : sorted[(rnd() * 3000) | 0][k % 4 ? 'start' : 'end'];
    const want = sorted.filter((c) => c.start <= t && t < c.end);
    assert.deepEqual(S.activeAt(idx, t), want, 't=' + t);
  }
  assert.ok(Date.now() - t0 < 4000);
});

test('encodings list is usable by TextDecoder', () => {
  assert.equal(S.ENCODINGS[0].id, 'auto');
  for (const e of S.ENCODINGS.slice(1)) assert.doesNotThrow(() => new TextDecoder(e.id), e.id);
});
