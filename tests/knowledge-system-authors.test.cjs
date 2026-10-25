'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-system/app.js'), 'utf8');
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));

// Run the complete client with isolated DOM/storage doubles. The test-only
// closure probe exposes state; production code gains no testing interface.
async function fixture(authors = {}) {
  const nodes = new Map(), writes = [];
  function element() {
    return { value: '', textContent: '', innerHTML: '', hidden: false, disabled: false,
      open: false, children: [], listeners: {}, dataset: {},
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, after() {}, scrollIntoView() {},
      querySelectorAll: () => [],
      addEventListener(type, handler) { this.listeners[type] = handler; },
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); }
    };
  }
  const get = selector => {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  };
  const document = { documentElement: element(), querySelector: get,
    querySelectorAll: selector => selector.includes('#manual-author-form button') ? [get('#author-submit')] : [],
    createElement: element, createTextNode: text => ({ textContent: text }), addEventListener() {} };
  let stored = copy(authors), failure = null, beforeSave = null;
  const store = {
    async getValue(key, fallback) { return key === 'authors' ? copy(stored) : fallback; },
    async getDocuments() { return []; },
    onChanged() {},
    async setValue(key, proposal, expected) {
      writes.push({ key, proposal: copy(proposal), expected: copy(expected) });
      await beforeSave?.();
      if (failure) throw failure;
      if (JSON.stringify(expected) !== JSON.stringify(stored)) {
        const error = new Error('Autori sa medzitým zmenili v druhej karte.');
        error.code = 'value_conflict';
        throw error;
      }
      stored = copy(proposal);
      return copy(stored);
    }
  };
  const window = { location: { search: '' }, MOKnowledgeCatalog:require('../server/knowledge-catalog.cjs'), MOKnowledgeStore: store, addEventListener() {} };
  const probe = `window.probe = {
    loadCustomAuthors, addCustomAuthor,
    state: () => ({ customAuthors, ready, editingRunning, externalReloadPending, authorStorageWarning }),
    select: () => { selectedField = 'natural-sciences'; },
    busy: (upload, storage) => { uploadRunning = upload; storageBusy = storage; },
    field: () => fields.find(field => field.id === 'natural-sciences')
  };`;
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, probe + '\n})();'),
    { window, document, URL, URLSearchParams, structuredClone, setTimeout, clearTimeout, Blob, console });
  await tick();
  return { probe: window.probe, get, writes,
    saved: () => copy(stored), replace: value => { stored = copy(value); },
    fail: value => { failure = value; }, wait: callback => { beforeSave = callback; } };
}

test('client retains unknown imported author branches and exact names when adding', async () => {
  const imported = { future: { archive: ['  Imported Author  ', 'a'.repeat(200)] },
    'natural-sciences': { futureCategory: ['Unknown category author'] } };
  const f = await fixture(imported), field = f.probe.field(), category = field.categories[0];
  assert.equal(f.probe.state().ready, true);
  assert.equal(await f.probe.addCustomAuthor(field, category, 'New Author'), true);
  assert.deepEqual(f.writes[0].expected, imported);
  assert.deepEqual(f.saved().future, imported.future);
  assert.deepEqual(f.saved()['natural-sciences'].futureCategory, imported['natural-sciences'].futureCategory);
  assert.deepEqual(f.saved()['natural-sciences'][category.id], ['New Author']);
  assert.deepEqual(plain(f.probe.state().customAuthors), f.saved());
});

for (const [name, invalid] of [
  ['array root', []], ['array branch', { future: [] }],
  ['non-array list', { future: { archive: 'Author' } }],
  ['blank name', { future: { archive: [' '] } }],
  ['non-string name', { future: { archive: [42] } }],
  ['oversized name', { future: { archive: ['a'.repeat(201)] } }],
  ['oversized list', { future: { archive: Array(201).fill('Author') } }]
]) {
  test(`client rejects ${name} without replacing its loaded author snapshot`, async () => {
    const original = { future: { archive: ['Keep Author'] } };
    const f = await fixture(original);
    f.replace(invalid);
    await assert.rejects(f.probe.loadCustomAuthors());
    assert.deepEqual(plain(f.probe.state().customAuthors), original);
    assert.equal(f.writes.length, 0);
    f.replace(original);
    await f.probe.loadCustomAuthors();
    assert.equal(f.probe.state().authorStorageWarning, '');
  });
}

test('client rejects a stale manual author save and keeps the draft with a reload action', async () => {
  const f = await fixture(), field = f.probe.field(), category = field.categories[0];
  f.probe.select();
  f.get('#manual-author-category').value = category.id;
  f.get('#manual-author-name').value = 'My unsaved author';
  const winner = { 'natural-sciences': { [category.id]: ['Second tab author'] } };
  f.replace(winner); // No notification: the conditional write must catch this.
  await f.get('#manual-author-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(f.saved(), winner);
  assert.deepEqual(plain(f.probe.state().customAuthors), {});
  assert.equal(f.get('#manual-author-name').value, 'My unsaved author');
  assert.match(f.get('#author-detection-status').textContent, /Autor nebol pridaný/);
  assert.equal(f.probe.state().externalReloadPending, true);
  assert.equal(f.get('#author-submit').disabled, true);
  const reload = f.get('#storage-status').children.find(child => child.textContent === 'Načítať uložené zmeny');
  assert.ok(reload);
  await reload.listeners.click();
  assert.deepEqual(plain(f.probe.state().customAuthors), winner);
  assert.equal(f.get('#manual-author-name').value, 'My unsaved author');
  assert.equal(f.get('#author-submit').disabled, false);
  await f.get('#manual-author-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(f.saved()['natural-sciences'][category.id], ['Second tab author', 'My unsaved author']);
  assert.equal(f.get('#manual-author-name').value, '');
});

test('failed author write leaves live state and draft intact while blocking overlapping edits', async () => {
  const original = { future: { archive: ['Keep Author'] } }, f = await fixture(original);
  const field = f.probe.field(), category = field.categories[0];
  let release;
  f.wait(() => new Promise(resolve => { release = resolve; }));
  f.fail(new Error('QuotaExceededError'));
  f.probe.select();
  f.get('#manual-author-category').value = category.id;
  f.get('#manual-author-name').value = 'Retry Author';
  const saving = f.get('#manual-author-form').listeners.submit({ preventDefault() {} });
  assert.equal(f.get('#author-submit').disabled, true);
  assert.deepEqual(plain(f.probe.state().customAuthors), original);
  await assert.rejects(f.probe.addCustomAuthor(field, category, 'Overlap'), /ešte ukladá/);
  release(); await saving;
  assert.deepEqual(f.saved(), original);
  assert.deepEqual(plain(f.probe.state().customAuthors), original);
  assert.equal(f.get('#manual-author-name').value, 'Retry Author');
  assert.equal(f.get('#author-submit').disabled, false);
  assert.equal(f.probe.state().externalReloadPending, false);
  f.wait(null); f.fail(null);
  await f.get('#manual-author-form').listeners.submit({ preventDefault() {} });
  assert.deepEqual(f.saved().future, original.future);
  assert.deepEqual(f.saved()['natural-sciences'][category.id], ['Retry Author']);
});

test('author add respects import/upload guards and compares duplicate names without trimming stored text', async () => {
  const f = await fixture(), field = f.probe.field(), category = field.categories[0];
  for (const [upload, storage] of [[true, false], [false, true]]) {
    f.probe.busy(upload, storage);
    await assert.rejects(f.probe.addCustomAuthor(field, category, 'Blocked'), /dokončenie/);
  }
  f.probe.busy(false, false);
  const original = { 'natural-sciences': { [category.id]: ['  Stored Author  '] } };
  f.replace(original); await f.probe.loadCustomAuthors();
  assert.equal(await f.probe.addCustomAuthor(field, category, 'stored author'), false);
  assert.deepEqual(plain(f.probe.state().customAuthors), original);
  assert.equal(f.writes.length, 0);
});
