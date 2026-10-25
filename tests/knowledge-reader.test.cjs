'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/knowledge-reader.js'), 'utf8'), sandbox);
const R = sandbox.module.exports;
const ranges = (text, query) => JSON.parse(JSON.stringify(R.findMatches(text, query)));

test('reader highlights exact original offsets across accents, combining marks, Unicode and punctuation', () => {
  const text = '🧠 KOGNÍCIA, kognícia a kogni\u0301cia; pamäť.';
  const found = ranges(text, 'kognicia');
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(range => text.slice(range.start, range.end)), ['KOGNÍCIA', 'kognícia', 'kogni\u0301cia']);
  const phrase = 'Pamäť — a\npozornosť';
  assert.deepEqual(ranges(phrase, 'pamat a pozornost'), [{ start: 0, end: phrase.length }]);
  assert.deepEqual(ranges('ﬃ a ffi', 'ffi').map(range => range.end - range.start), [1, 3]);
});

test('reader finds every occurrence and treats empty or punctuation-only search as no matches', () => {
  assert.deepEqual(ranges('Kognícia\nKOGNÍCIA\nPozornosť', 'kognícia'), [{ start: 0, end: 8 }, { start: 9, end: 17 }]);
  assert.deepEqual(ranges('abc', ''), []); assert.deepEqual(ranges('abc', ' — '), []); assert.deepEqual(ranges('abc', 'missing'), []);
  assert.deepEqual(ranges('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
});
