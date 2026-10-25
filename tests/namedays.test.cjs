'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const source = readFileSync(path.join(__dirname, '../public/namedays.js'), 'utf8');
const common = { exports: {} };
Function('module', source)(common);
const names = common.exports;

test('Oficiálne meniny pokrývajú všetkých 366 dní vrátane priestupného dňa', () => {
  const keys = Object.keys(names.days);
  assert.equal(keys.length, 366);
  const date = new Date(Date.UTC(2024, 0, 1));
  for (let day = 0; day < 366; day++) {
    const iso = date.toISOString().slice(0, 10);
    const key = iso.slice(5);
    assert.ok(Object.hasOwn(names.days, key), key);
    assert.deepEqual(names.get(iso), names.days[key]);
    assert.ok(names.get(iso).every(name => typeof name === 'string' && name.length > 0));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  assert.equal(date.toISOString().slice(0, 10), '2025-01-01');
});

test('Zoznam zachováva oficiálne podoby a poradie mien', () => {
  assert.deepEqual(names.get('2026-10-19'), ['Kristián']);
  assert.deepEqual(names.get('2024-02-29'), ['Radomír']);
  assert.deepEqual(names.get('2026-06-29'), ['Peter', 'Pavol', 'Petra']);
  assert.deepEqual(names.get('2026-01-10'), ['Daša']);
  assert.deepEqual(names.get('2026-01-20'), ['Dalibor', 'Sebastián', 'Fabián']);
  assert.deepEqual(names.get('2026-12-24'), ['Adam', 'Eva']);
  assert.deepEqual(names.get('2026-12-31'), ['Silvester']);
});

test('Dni bez pridelených mien sú prázdne, názvy sviatkov sa nevydávajú za mená', () => {
  assert.deepEqual(Object.keys(names.days).filter(key => names.days[key].length === 0), ['01-01', '05-01', '11-02', '12-25']);
  for (const key of ['01-01', '05-01', '11-02', '12-25']) assert.deepEqual(names.get('2026-' + key), []);
});

test('Neplatné dátumy vrátane nepriestupného februára nevracajú cudzie meniny', () => {
  for (const value of [null, undefined, 20261019, {}, '', '10-19', '2026-1-10', '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '0000-01-01', '2026-10-19T00:00:00Z']) {
    assert.deepEqual(names.get(value), [], String(value));
  }
  assert.deepEqual(names.get('2000-02-29'), ['Radomír']);
});

test('Úprava výsledku nemení spoločný dátový zoznam a zdroj je oficiálny', () => {
  const result = names.get('2026-10-19');
  result.push('Prepísané meno');
  assert.deepEqual(names.get('2026-10-19'), ['Kristián']);
  assert.ok(Object.isFrozen(names.days));
  assert.ok(Object.isFrozen(names.days['10-19']));
  assert.equal(new URL(names.sourceURL).hostname, 'www.culture.gov.sk');
  assert.equal(names.sourceLabel, 'Oficiálne kalendárium MK SR 2025');
});

test('Prehliadač dostane rovnaké verejné API bez siete', () => {
  const browser = {};
  Function('globalThis', source)(browser);
  assert.deepEqual(browser.MONamedays.get('2026-10-19'), ['Kristián']);
  assert.equal(typeof browser.MONamedays.sourceURL, 'string');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest/);
});
