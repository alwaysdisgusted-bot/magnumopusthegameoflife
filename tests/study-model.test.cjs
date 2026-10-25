'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../server/study-model.mjs').default;
const note = (overrides = {}) => ({ id: 'note-1', categoryId: 'finance', title: 'Moje myšlienky', text: 'Poznámka o úsporách', photo: '', source: 'manual', createdAt: 1, updatedAt: 2, ...overrides });
const category = (id, parentId, slot = null) => ({ id, name: id, parentId, slot, keywords: [] });
const clone = value => JSON.parse(JSON.stringify(value));

test('personal study starts with one editable finance root and independent collections', () => {
  const state = M.createState();
  assert.deepEqual(state.categories[0], { id: 'finance', name: 'Peniaze a úspory', parentId: null, slot: 6, keywords: ['peniaze', 'úspory', 'financie', 'investície'] });
  state.notes.push(note());
  state.categories.push(category('saving', 'finance'));
  state.links.push({ id: 'link-1', categoryId: 'saving', kind: 'finance', targetId: 'bank' });
  const clean = M.validateState(state);
  assert.deepEqual(clean, state); clean.categories[0].keywords.push('nové'); clean.notes[0].text = 'Upravené';
  assert.notDeepEqual(clean, state); assert.equal(M.createState().notes.length, 0);
});

test('the browser and server validators return identical states and reject the same invalid values', () => {
  const sandbox = { module: { exports: {} }, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/study-model.js'), 'utf8'), sandbox);
  const browser = sandbox.module.exports;
  const data = M.createState(); data.notes.push(note({ source: 'ocr', photo: 'data:image/png;base64,YQ==' }));
  const browserData = vm.runInNewContext('JSON.parse(data)', { data: JSON.stringify(data) });
  // A fresh VM creates distinct object prototypes, so validate in the module's realm.
  sandbox.data = JSON.stringify(data);
  assert.equal(JSON.stringify(vm.runInNewContext('module.exports.validateState(JSON.parse(data))', sandbox)), JSON.stringify(M.validateState(data)));
  assert.equal(typeof browser.createState, 'function'); assert.ok(browserData);
  for (const bad of [{ ...data, version: 99 }, { ...data, unexpected: true }, { ...data, notes: [note({ source: 'service' })] }]) {
    sandbox.data = JSON.stringify(bad);
    assert.throws(() => M.validateState(bad));
    assert.throws(() => vm.runInNewContext('module.exports.validateState(JSON.parse(data))', sandbox));
  }
});

test('category roots occupy unique slots and subcategories resolve independently of order', () => {
  const state = M.createState();
  state.categories.unshift(category('saving', 'finance'));
  state.categories.push(category('body', null, 1));
  assert.deepEqual(M.validateState(state), state);
  for (const badCategory of [category('duplicate', null, 6), category('floating', null, null), category('missing', 'absent'), category('misplaced', 'finance', 2), category('above', null, 10)]) {
    const bad = clone(state); bad.categories.push(badCategory); assert.throws(() => M.validateState(bad));
  }
});

test('cycles, self-parenting and more than five category levels are rejected', () => {
  const state = M.createState();
  for (let i = 1; i <= 4; i++) state.categories.push(category('level-' + i, i === 1 ? 'finance' : 'level-' + (i - 1)));
  assert.doesNotThrow(() => M.validateState(state));
  state.categories.push(category('level-5', 'level-4'));
  assert.throws(() => M.validateState(state), /päť/);
  const cycle = M.createState(); cycle.categories.push(category('a', 'b'), category('b', 'a'));
  assert.throws(() => M.validateState(cycle), /kruh/);
  cycle.categories = [category('a', 'a')]; assert.throws(() => M.validateState(cycle), /kruh/);
});

test('notes preserve OCR text and photos while rejecting invalid references, types and timestamps', () => {
  const state = M.createState(); state.notes.push(note({ source: 'ocr', photo: 'data:image/jpeg;base64,YWJj', text: 'Riadok\nďalší riadok\tčíslo 7' }));
  assert.deepEqual(M.validateState(state), state);
  for (const patch of [{ categoryId: 'missing' }, { id: 'finance' }, { id: '../bad' }, { title: 'x'.repeat(161) }, { text: 'x'.repeat(20001) }, { photo: 'https://example.com/a.png' }, { photo: 'data:image/svg+xml;base64,YQ==' }, { photo: 'data:image/png;base64,' }, { source: 'ai' }, { createdAt: NaN }, { createdAt: -1 }, { updatedAt: 0 }, { updatedAt: 1.5 }, { text: 'bad\u0000control' }]) {
    const bad = M.createState(); bad.notes.push(note(patch)); assert.throws(() => M.validateState(bad), JSON.stringify(patch));
  }
});

test('links require existing categories, safe targets and supported kinds without sharing IDs', () => {
  const state = M.createState();
  for (const [index, kind] of ['book', 'page', 'finance'].entries()) state.links.push({ id: 'link-' + index, categoryId: 'finance', kind, targetId: 'target-' + index });
  assert.deepEqual(M.validateState(state), state);
  for (const patch of [{ categoryId: 'unknown' }, { targetId: 'javascript:alert(1)' }, { targetId: '' }, { targetId: '../../secret' }, { kind: 'account' }, { id: 'finance' }]) {
    const bad = M.createState(); bad.links.push({ id: 'one', categoryId: 'finance', kind: 'book', targetId: 'book-1', ...patch }); assert.throws(() => M.validateState(bad));
  }
  state.notes.push(note({ id: 'link-0' })); assert.throws(() => M.validateState(state));
});

test('unknown fields, accessors, non-finite values and sparse arrays never enter a snapshot', () => {
  const state = M.createState();
  const getter = { version: 1, categories: [], notes: [], links: [] }; Object.defineProperty(getter, 'ownerId', { get() { throw new Error('must not run'); }, enumerable: true });
  assert.throws(() => M.validateState(getter), /Nepovolené/);
  const array = []; array.length = 1;
  assert.throws(() => M.validateState({ ...state, notes: array }));
  assert.throws(() => M.validateState({ ...state, notes: [note({ id: 'Infinity', createdAt: Infinity })] }));
  assert.throws(() => M.validateState({ ...state, categories: [{ ...state.categories[0], owner: 'another-user' }] }));
  assert.throws(() => M.validateState({ ...state, links: [{ id: 'l', categoryId: 'finance', kind: 'book', targetId: 'b', source: 'hidden' }] }));
});

test('collection and UTF-8 snapshot limits reject oversized study data', () => {
  const categories = M.createState(); categories.categories.push(...Array.from({ length: 100 }, (_, i) => category('category-' + i, 'finance')));
  assert.throws(() => M.validateState(categories));
  const notes = M.createState(); notes.notes = Array.from({ length: 501 }, (_, i) => note({ id: 'note-' + i })); assert.throws(() => M.validateState(notes));
  const links = M.createState(); links.links = Array.from({ length: 1001 }, (_, i) => ({ id: 'link-' + i, categoryId: 'finance', kind: 'book', targetId: 'book-' + i })); assert.throws(() => M.validateState(links));
  const multibyte = M.createState(); multibyte.notes = Array.from({ length: 500 }, (_, i) => note({ id: 'note-' + i, text: 'é'.repeat(12000) }));
  assert.ok(JSON.stringify(multibyte).length < 10 * 1024 * 1024); assert.throws(() => M.validateState(multibyte), /10 MB/);
});
