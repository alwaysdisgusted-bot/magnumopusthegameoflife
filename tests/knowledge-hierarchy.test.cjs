'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modelSource = fs.readFileSync(path.join(__dirname, '../public/knowledge-system/hierarchy.js'), 'utf8');
// The project is ESM; exercise the browser module's CommonJS-compatible factory
// in the current realm without requiring the .js file as an ES module.
const createModel = vm.compileFunction(modelSource + '\nreturn module.exports;', ['module'])({ exports: {} });
const catalog = () => [
  { id: 'science', name: 'Veda', categories: [{ id: 'psychology', name: 'Psychológia' }, { id: 'physics', name: 'Fyzika' }] },
  { id: 'humanities', name: 'Humanitné vedy', categories: [{ id: 'history', name: 'História' }] }
];
const hierarchy = (...nodes) => ({ version: 1, nodes });
const node = (id, parentId = 'psychology', patch = {}) => ({ id, fieldId: 'science', parentId, name: id, description: '', ...patch });
function model(fields = catalog()) {
  let sequence = 0;
  return createModel(fields, { randomUUID: () => '00000000-0000-4000-8000-' + String(++sequence).padStart(12, '0') });
}

test('current complete built-in catalog is accepted without copying unrelated terms or authors', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/knowledge-system/catalog.js'), 'utf8');
  const literal = /const fields = (\[[\s\S]*?\n\]);/.exec(app)?.[1];
  assert.ok(literal, 'Read the existing catalog declaration without booting the UI');
  const fields = vm.runInNewContext('(' + literal + ')'), m = model(fields), empty = m.empty();
  for (const field of fields) {
    assert.equal(m.categories(empty, field.id).length, field.categories.length);
    assert.equal(m.path(empty, field.id, field.categories[0].id)[0].id, field.id);
  }
  assert.equal(JSON.stringify(empty), '{"version":1,"nodes":[]}');
});

test('create and rename keep generated identity independent of names and detach immutable snapshots', () => {
  const m = model(), empty = m.empty();
  const created = m.add(empty, { fieldId: 'science', parentId: 'psychology', name: ' Učenie ', description: ' Poznámka ' });
  const id = created.nodes[0].id;
  assert.match(id, /^custom-[a-f0-9-]{36}$/);
  const renamed = m.rename(created, id, { name: 'Opakovanie' });
  assert.equal(renamed.nodes[0].id, id);
  assert.equal(renamed.nodes[0].description, ' Poznámka ');
  assert.equal(created.nodes[0].name, ' Učenie ');
  assert.equal(empty.nodes.length, 0);
  assert.throws(() => { renamed.nodes[0].name = 'Mutation'; }, TypeError);
  assert.throws(() => { renamed.nodes.push(node('extra')); }, TypeError);
});

test('moving a complete subtree preserves every identity and updates the common resolver path', () => {
  const m = model(), original = hierarchy(node('learning'), node('repeat', 'learning'), node('recall', 'repeat'));
  const moved = m.reparent(original, 'learning', 'physics');
  assert.deepEqual(moved.nodes.map(item => item.id), original.nodes.map(item => item.id));
  assert.deepEqual(m.path(moved, 'science', 'recall').map(item => item.id), ['science', 'physics', 'learning', 'repeat', 'recall']);
  assert.deepEqual(m.descendants(moved, 'science', 'physics'), ['learning', 'repeat', 'recall']);
  assert.deepEqual(m.categories(moved, 'science').map(item => [item.id, item.depth]), [['psychology', 1], ['physics', 1], ['learning', 2], ['repeat', 3], ['recall', 4]]);
  assert.equal(original.nodes[0].parentId, 'psychology');
});

test('self parenting and indirect cycles are rejected without changing the proposal', () => {
  const m = model(), original = hierarchy(node('learning'), node('repeat', 'learning'));
  const before = JSON.stringify(original);
  assert.throws(() => m.reparent(original, 'learning', 'learning'), /cyklus/);
  assert.throws(() => m.reparent(original, 'learning', 'repeat'), /cyklus/);
  assert.equal(JSON.stringify(original), before);
});

test('unknown fields, missing parents and cross-field parents fail rather than inventing branches', () => {
  const m = model();
  assert.throws(() => m.validate(hierarchy(node('learning', 'psychology', { fieldId: 'unknown' }))), /Neznámy odbor/);
  assert.throws(() => m.validate(hierarchy(node('learning', 'missing'))), /Rodič/);
  assert.throws(() => m.validate(hierarchy(node('learning', 'history'))), /Rodič/);
  assert.throws(() => m.validate(hierarchy(node('learning', 'science'))), /Rodič/);
});

test('custom IDs are globally unique and cannot collide with built-in fields or categories', () => {
  const m = model();
  assert.throws(() => m.validate(hierarchy(node('same'), node('same', 'history', { fieldId: 'humanities' }))), /Kolízia/);
  assert.throws(() => m.validate(hierarchy(node('science'))), /Kolízia/);
  assert.throws(() => m.validate(hierarchy(node('history'))), /Kolízia/);
});

test('sibling names use trimmed Slovak case and diacritic matching including built-in categories', () => {
  const m = model();
  assert.throws(() => m.validate(hierarchy(node('one', null, { name: ' PSYCHOLOGIA ' }))), /rovnakým názvom/);
  assert.throws(() => m.validate(hierarchy(node('one', 'psychology', { name: 'Učenie' }), node('two', 'psychology', { name: ' UCENIE ' }))), /rovnakým názvom/);
  const allowed = m.validate(hierarchy(node('one', 'psychology', { name: 'Učenie' }), node('two', 'physics', { name: ' UCENIE ' })));
  assert.equal(allowed.nodes[1].name, ' UCENIE ');
});

test('depth eight is accepted while deeper imports and subtree moves are rejected', () => {
  const m = model(), chain = Array.from({ length: 7 }, (_, i) => node('n' + i, i ? 'n' + (i - 1) : 'psychology'));
  const original = hierarchy(...chain, node('root', 'physics'));
  assert.equal(m.categories(original, 'science').find(item => item.id === 'n6').depth, 8);
  assert.throws(() => m.validate(hierarchy(...chain, node('n7', 'n6'))), /8 úrovní/);
  assert.throws(() => m.reparent(original, 'n0', 'n6'), /cyklus/);
  assert.throws(() => m.reparent(original, 'n0', 'root'), /8 úrovní/);
  assert.equal(original.nodes[0].parentId, 'psychology');
});

test('the per-field cap includes fixed categories and checks the entire resulting hierarchy', () => {
  const m = model(), nodes = Array.from({ length: 98 }, (_, i) => node('n' + i, null));
  const full = m.validate(hierarchy(...nodes));
  assert.equal(m.categories(full, 'science').length, 100);
  assert.throws(() => m.add(full, { fieldId: 'science', name: 'One too many' }), /100 kategórií/);
  assert.equal(full.nodes.length, 98);
});

test('strict schema rejects unknown properties, inherited values, sparse arrays and executable accessors', () => {
  const m = model();
  let calls = 0;
  const accessor = { version: 1, get nodes() { calls++; return []; } };
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, '0', { get() { calls++; return node('accessor'); }, enumerable: true });
  const inheritedIterator = [node('safe')];
  Object.setPrototypeOf(inheritedIterator, Object.create(Array.prototype, {
    [Symbol.iterator]: { get() { calls++; throw Error('Must not execute an inherited iterator'); } }
  }));
  assert.equal(m.validate({ version: 1, nodes: inheritedIterator }).nodes[0].id, 'safe');
  for (const invalid of [accessor, { version: 1, nodes: new Array(1) }, { version: 1, nodes: arrayAccessor },
    { version: 1, nodes: [], extra: true }, Object.create({ version: 1, nodes: [] }),
    hierarchy({ ...node('extra'), hidden: 'data' }), { version: 2, nodes: [] }]) assert.throws(() => m.validate(invalid));
  assert.equal(calls, 0);
});

test('name and description boundaries preserve exact text and reject invalid identifiers', () => {
  const m = model(), valid = node('limit', null, { name: ' n' + 'a'.repeat(147) + ' ', description: ' '.repeat(2000) });
  assert.equal(valid.name.length, 150);
  assert.deepEqual(m.validate(hierarchy(valid)).nodes[0], valid);
  assert.throws(() => m.validate(hierarchy(node('long', null, { name: 'a'.repeat(151) }))), /Názov kategórie/);
  assert.throws(() => m.validate(hierarchy(node('long', null, { description: 'a'.repeat(2001) }))), /Popis/);
  for (const id of ['__proto__', 'prototype', 'constructor', 'space id', 'a'.repeat(151)]) assert.throws(() => m.validate(hierarchy(node(id))));
  assert.throws(() => m.validate(hierarchy(node('empty', null, { name: ' ' }))), /Názov kategórie/);
});

test('catalog definitions are detached and identical built-in IDs in different fields resolve in context', () => {
  const fields = catalog();
  fields[1].categories.push({ id: 'psychology', name: 'Dejiny psychológie' });
  const m = model(fields);
  fields[0].categories[0].name = 'Changed outside';
  assert.equal(m.path(m.empty(), 'science', 'psychology')[1].name, 'Psychológia');
  assert.equal(m.path(m.empty(), 'humanities', 'psychology')[1].name, 'Dejiny psychológie');
  assert.throws(() => m.validate(hierarchy(node('psychology'))), /Kolízia/);
});

test('fixed categories cannot be edited and unknown lookups do not silently return partial paths', () => {
  const m = model(), empty = m.empty();
  assert.throws(() => m.rename(empty, 'psychology', { name: 'New' }), /vlastnú/);
  assert.throws(() => m.reparent(empty, 'psychology', null), /vlastnú/);
  assert.throws(() => m.path(empty, 'science', 'missing'), /Neznáma kategória/);
  assert.throws(() => m.descendants(empty, 'missing', 'psychology'), /Neznámy odbor/);
  assert.throws(() => m.categories(empty, 'missing'), /Neznámy odbor/);
});

test('browser factory and generated ID failures have the same validation behavior as Node', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/knowledge-system/hierarchy.js'), 'utf8'), { window });
  const browser = window.MOKnowledgeHierarchy(catalog(), { randomUUID: () => 'bad ID' });
  assert.throws(() => browser.add(browser.empty(), { fieldId: 'science', name: 'New' }), /stabilný identifikátor/);
  const m = createModel(catalog(), { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  const first = m.add(m.empty(), { fieldId: 'science', name: 'First' });
  assert.throws(() => m.add(first, { fieldId: 'science', name: 'Second' }), /Kolízia/);
});
