'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const loaded = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/knowledge-system/store.js'), 'utf8'), { module: loaded });
const createStore = loaded.exports;
const copy = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));

// Only the IDB operations used by this module are modelled. Writes are staged
// until completion, so an abort after a queued write must leave no partial data.
function indexedDBMock() {
  const databases = new Map();
  const versions = new Map(), connections = new Map();
  const mock = { opened: [], writes: 0, failWrites: false, databases, versions, closed: 0, transactions: [], blockUpgrades: false };
  mock.open = (name, version) => {
    mock.opened.push({ name, version });
    const request = {};
    setImmediate(() => {
      const oldVersion = versions.get(name) || 0;
      if (version < oldVersion) {
        request.error = Object.assign(new Error('VersionError'), { name: 'VersionError' });
        request.onerror?.(); return;
      }
      const upgrade = version > oldVersion;
      if (upgrade) for (const connection of [...(connections.get(name) || [])]) connection.onversionchange?.();
      const fresh = !databases.has(name);
      if (fresh) databases.set(name, new Map());
      const stores = databases.get(name);
      let closed = false;
      const database = {
        close() { if (!closed) { closed = true; mock.closed++; connections.get(name)?.delete(database); } },
        objectStoreNames: { contains: key => stores.has(key) },
        createObjectStore(key, options) { stores.set(key, { keyPath: options.keyPath, rows: new Map() }); },
        transaction(names, mode) {
          if (closed) throw new Error('InvalidStateError');
          mock.transactions.push({ names: [...names], mode });
          const working = new Map(names.map(key => [key, copy(stores.get(key))]));
          let pending = 0;
          let stopped = false;
          const tx = {
            error: null,
            abort() {
              if (stopped) return;
              stopped = true;
              setImmediate(() => tx.onabort?.());
            },
            objectStore(key) {
              const table = working.get(key);
              const requestFor = operation => {
                if (stopped) throw new Error('TransactionInactiveError');
                pending++;
                const request = {};
                setImmediate(() => {
                  if (stopped) return;
                  try { request.result = operation(); } catch (error) {
                    request.error = error; tx.error = error;
                    request.onerror?.(); tx.onerror?.(); tx.abort(); return;
                  }
                  request.onsuccess?.();
                  pending--;
                  setImmediate(() => {
                    if (stopped || pending) return;
                    stopped = true;
                    if (mode === 'readwrite') for (const [name, store] of working) stores.set(name, store);
                    tx.oncomplete?.();
                  });
                });
                return request;
              };
              return {
                get: id => requestFor(() => copy(table.rows.get(id))),
                getAll: () => requestFor(() => copy([...table.rows.values()])),
                count: () => requestFor(() => table.rows.size),
                put: value => requestFor(() => {
                  assert.equal(mode, 'readwrite');
                  mock.writes++;
                  if (mock.failWrites && key === 'values' && value.key === 'metadata') throw new Error('QuotaExceededError');
                  table.rows.set(value[table.keyPath], copy(value));
                  return value[table.keyPath];
                })
              };
            }
          };
          return tx;
        }
      };
      const complete = () => {
        request.result = database;
        if (upgrade) request.onupgradeneeded?.();
        versions.set(name, version);
        if (!connections.has(name)) connections.set(name, new Set());
        connections.get(name).add(database);
        request.onsuccess?.();
      };
      if (upgrade && mock.blockUpgrades) {
        mock.completeBlockedOpen = complete;
        request.onblocked?.(); return;
      }
      complete();
    });
    return request;
  };
  return mock;
}

function environment(indexedDB = indexedDBMock(), extra = {}) {
  return { indexedDB, Blob, crypto: webcrypto, TextEncoder, btoa, atob, ...extra };
}
function doc(id = 'document-1', text = 'Kognícia a pamäť.') {
  const blob = new Blob([text], { type: 'text/plain' });
  return { id, name: 'Poznámky.txt', size: blob.size, mime: blob.type, text, pageKind: 'virtual',
    pagination: 'unpaginated', pages: [{ number: 1, text }], blob };
}
function file(input) { return new Blob([JSON.stringify(input)], { type: 'application/json' }); }
function backup(documents = [], terms = {}, authors = {}) {
  return { format: 'magnum-opus-knowledge-system', version: 1, documents, terms, authors };
}
function withoutBlob(document) { const { blob, ...metadata } = document; return metadata; }

test('own IndexedDB persists originals, text, metadata and custom values across store instances', async () => {
  const db = indexedDBMock();
  const env = environment(db);
  Object.defineProperty(env, 'localStorage', { get() { throw new Error('Must never access the game or old demo'); } });
  const store = createStore(env);
  const input = { ...doc(), analysisStatus: 'complete', warning: '' };
  const updates = [];
  store.onChanged(event => updates.push(event.external));
  await store.putDocument(input);
  await store.setValue('terms', { science: { cognition: [{ term: 'pamäť', description: 'Uchovávanie.' }] } });
  const reloaded = createStore(env);
  const documents = await reloaded.getDocuments();
  assert.equal(documents.length, 1);
  assert.equal(await documents[0].blob.text(), input.text);
  assert.deepEqual(plain(withoutBlob(documents[0])), plain(withoutBlob(input)));
  assert.equal((await reloaded.getValue('terms', {})).science.cognition[0].term, 'pamäť');
  assert.deepEqual(await reloaded.getValue('authors', []), []);
  assert.deepEqual(updates, [false, false]);
  assert.ok(db.opened.every(item => item.name === 'magnum-opus-knowledge-system-v1' && item.version === 1));
});

test('strict bounds, MIME checks, plain shapes and unavailable storage fail clearly before writes', async () => {
  const db = indexedDBMock();
  const store = createStore(environment(db));
  await assert.rejects(store.putDocument({ ...doc(), size: 15 * 1024 * 1024 + 1 }), /15 MiB/);
  await assert.rejects(store.putDocument({ ...doc(), text: 'a'.repeat(200001) }), /príliš dlhú/);
  await assert.rejects(store.putDocument({ ...doc(), name: 'script.html' }), /HTML/);
  await assert.rejects(store.putDocument({ ...doc(), mime: 'image/svg+xml' }), /typ súboru/);
  await assert.rejects(store.putDocument({ ...doc(), mime: 'image/png' }), /nezodpovedá/);
  const disguised = new Blob(['<html>bad</html>'], { type: 'application/pdf' });
  await assert.rejects(store.putDocument({ ...doc(), mime: disguised.type, size: disguised.size, blob: disguised }), /Obsah originálu/);
  await assert.rejects(store.putDocument({ ...doc(), pages: [{ number: 1, text: '' }, { number: 1, text: '' }] }), /jedinečné/);
  await assert.rejects(store.putDocument({ ...doc(), gameSession: 'forbidden' }), /nepovolené/);
  await assert.rejects(store.setValue('terms', JSON.parse('{"__proto__": {}}')), /identifikátor/);
  await assert.rejects(store.setValue('session', {}), /Neznámy kľúč/);
  const accessor = {};
  Object.defineProperty(accessor, 'field', { enumerable: true, get() { throw new Error('No getter should execute'); } });
  await assert.rejects(store.setValue('terms', accessor), /Nepovolený formát/);
  assert.equal(db.writes, 0);
  await assert.rejects(createStore(environment(null)).getDocuments(), /IndexedDB/);
  await store.putDocument(doc());
  const rows = db.databases.get('magnum-opus-knowledge-system-v1').get('documents').rows;
  const original = copy(rows.get('document-1'));
  for (let index = 2; index <= 1000; index++) rows.set('seed-' + index, { ...copy(original), id: 'seed-' + index });
  await assert.rejects(store.putDocument(doc('one-too-many')), /1 000 dokumentov/);
  await store.putDocument(doc('document-1', 'Aktualizácia existujúceho dokumentu.'));
  assert.equal((await store.getDocuments()).length, 1000);
});

test('JSON backup round trips originals and merges without deleting, duplicating or replacing conflicts', async () => {
  const source = createStore(environment());
  await source.putDocument(doc('shared-id', 'Nový text.'));
  await source.setValue('terms', { science: { cognition: [{ term: 'nové', description: 'Nový opis.' }] } });
  await source.setValue('authors', { science: { cognition: ['Nový autor'] } });
  const exported = await source.exportBackup();
  assert.equal(exported.type, 'application/json');
  const contents = JSON.parse(await exported.text());
  assert.deepEqual(Object.keys(contents).sort(), ['authors', 'documents', 'exportedAt', 'format', 'terms', 'version']);
  assert.equal(contents.version, 1);
  assert.equal(contents.documents[0].blob.type, 'text/plain');
  assert.equal(Buffer.from(contents.documents[0].blob.base64, 'base64').toString('utf8'), 'Nový text.');
  const target = createStore(environment());
  await target.putDocument(doc('shared-id', 'Zachovať pôvodný text.'));
  await target.setValue('terms', { science: { cognition: [{ term: 'staré', description: 'Starý opis.' }] } });
  await target.setValue('authors', { science: { cognition: ['Pôvodný autor'] } });
  const first = await target.importBackup(exported);
  assert.equal(first.imported, 1);
  assert.equal(first.documents, 2);
  assert.deepEqual(plain(first.authors.science.cognition), ['Pôvodný autor', 'Nový autor']);
  assert.deepEqual(plain(first.terms.science.cognition).map(item => item.term), ['staré', 'nové']);
  const saved = await target.getDocuments();
  assert.equal(saved.find(item => item.id === 'shared-id').text, 'Zachovať pôvodný text.');
  const added = saved.find(item => item.id !== 'shared-id');
  assert.match(added.id, /^[0-9a-f-]{36}$/);
  assert.equal(await added.blob.text(), 'Nový text.');
  assert.equal((await target.importBackup(exported)).imported, 0);
  assert.equal((await target.getDocuments()).length, 2);
});

test('whole backup validates before writes, including late invalid entries and foreign session fields', async () => {
  const db = indexedDBMock();
  const store = createStore(environment(db));
  await store.putDocument(doc('keep'));
  await store.setValue('authors', { science: { cognition: ['Existujúci autor'] } });
  const beforeWrites = db.writes;
  const before = plain(withoutBlob((await store.getDocuments())[0]));
  const incoming = backup([withoutBlob(doc('new')), { ...withoutBlob(doc('invalid')), pages: [{ number: 0, text: 'bad' }] }]);
  await assert.rejects(store.importBackup(file(incoming)), /kladné/);
  await assert.rejects(store.importBackup(file({ ...backup(), sessions: ['foreign'] })), /nepovolené/);
  await assert.rejects(store.importBackup(file({ ...backup(), version: 2 })), /verzia 1/);
  await assert.rejects(store.importBackup(file(backup([{ ...withoutBlob(doc('new')), blob: { type: 'text/plain', base64: '!!!!' } }]))), /kódovanie/);
  assert.equal(db.writes, beforeWrites);
  assert.deepEqual(plain(withoutBlob((await store.getDocuments())[0])), before);
  assert.deepEqual(plain(await store.getValue('authors', {})), { science: { cognition: ['Existujúci autor'] } });
});

test('failed write atomically rolls back document, terms, authors and import metadata', async () => {
  const db = indexedDBMock();
  const store = createStore(environment(db));
  await store.putDocument(doc('keep'));
  await store.setValue('terms', { science: { cognition: [{ term: 'pôvodný', description: '' }] } });
  await store.setValue('authors', { science: { cognition: ['Pôvodný autor'] } });
  const before = copy(db.databases.get('magnum-opus-knowledge-system-v1'));
  const events = [];
  store.onChanged(event => events.push(event));
  db.failWrites = true;
  const incoming = backup([withoutBlob(doc('new', 'Nový obsah.'))],
    { science: { cognition: [{ term: 'pridaný', description: '' }] } }, { science: { cognition: ['Nový autor'] } });
  await assert.rejects(store.importBackup(file(incoming)), /Zápis sa neuložil/);
  assert.deepEqual(db.databases.get('magnum-opus-knowledge-system-v1'), before);
  assert.deepEqual(events, []);
  assert.equal((await store.getDocuments()).length, 1);
  assert.equal((await store.getValue('authors', {})).science.cognition[0], 'Pôvodný autor');
});

test('sibling contexts receive one external notification with no broadcast feedback loop', async () => {
  const channels = [];
  let posted = 0;
  class Channel {
    constructor(name) { this.name = name; channels.push(this); }
    postMessage(data) {
      posted++;
      for (const other of channels) if (other !== this && other.name === this.name) other.onmessage?.({ data });
    }
  }
  const db = indexedDBMock();
  const browserEvents = [];
  class Event { constructor(type, options) { this.type = type; this.detail = options.detail; } }
  const first = createStore(environment(db, { BroadcastChannel: Channel }));
  const second = createStore(environment(db, { BroadcastChannel: Channel, CustomEvent: Event, dispatchEvent(event) { browserEvents.push(event); } }));
  const local = [], remote = [];
  first.onChanged(event => local.push(event.external));
  const unsubscribe = second.onChanged(event => remote.push(event.external));
  await first.putDocument(doc());
  assert.deepEqual(local, [false]);
  assert.deepEqual(remote, [true]);
  assert.equal(posted, 1);
  assert.equal((await second.getDocuments()).length, 1);
  assert.equal(browserEvents[0].type, 'knowledge-system-storage-updated');
  assert.equal(browserEvents[0].detail.external, true);
  unsubscribe();
  await first.setValue('authors', {});
  assert.deepEqual(remote, [true]);
  assert.equal(posted, 2);
});

test('conditional term replacement preserves imports and original documents while moving one entry', async () => {
  const store = createStore(environment());
  await store.putDocument(doc('original'));
  const expected = { science: { cognition: [{ term: 'Cognition', description: 'a'.repeat(2000) }] }, future: { archive: [{ term: 'n'.repeat(150), description: '' }] } };
  await store.setValue('terms', expected);
  const proposal = copy(expected);
  const moved = proposal.science.cognition.splice(0, 1)[0];
  proposal.other = { memory: [{ ...moved, term: 'COGNITION' }] };
  const events = [];
  store.onChanged(event => events.push(event.external));
  // Field ordering has no semantic effect on an expected snapshot.
  await store.setValue('terms', proposal, { future: expected.future, science: expected.science });
  const saved = await store.getValue('terms', {});
  assert.deepEqual(plain(saved), proposal);
  assert.deepEqual(expected.science.cognition, [{ term: 'Cognition', description: 'a'.repeat(2000) }]);
  const documents = await store.getDocuments();
  assert.equal(documents.length, 1);
  assert.equal(await documents[0].blob.text(), 'Kognícia a pamäť.');
  const exported = JSON.parse(await (await store.exportBackup()).text());
  assert.deepEqual(exported.terms, proposal);
  assert.equal(exported.terms.future.archive[0].term.length, 150);
  assert.deepEqual(events, [false]);
});

test('stale conditional edits are rejected without a write even when notifications are unavailable', async () => {
  const db = indexedDBMock(), env = environment(db);
  const first = createStore(env), second = createStore(env);
  const original = { science: { cognition: [{ term: 'pôvodný', description: '' }] } };
  await first.setValue('terms', original, {});
  const stale = await first.getValue('terms', {});
  const winner = { science: { cognition: [{ term: 'novší', description: 'Zachovať.' }] } };
  await second.setValue('terms', winner, original);
  const beforeWrites = db.writes, events = [];
  first.onChanged(event => events.push(event));
  await assert.rejects(first.setValue('terms', { science: { cognition: [{ term: 'starý návrh', description: '' }] } }, stale), error => error.code === 'value_conflict');
  assert.equal(db.writes, beforeWrites);
  assert.deepEqual(plain(await first.getValue('terms', {})), winner);
  assert.deepEqual(events, []);
});

test('conditional edits roll back on write failure and reject oversized proposals before changes', async () => {
  const db = indexedDBMock(), store = createStore(environment(db));
  const expected = { science: { cognition: [{ term: 'zachovať', description: 'Originál.' }] } };
  await store.putDocument(doc('keep'));
  await store.setValue('terms', expected);
  const before = copy(db.databases.get('magnum-opus-knowledge-system-v1'));
  const events = [];
  store.onChanged(event => events.push(event));
  db.failWrites = true;
  await assert.rejects(store.setValue('terms', { science: { memory: [{ term: 'presunutý', description: '' }] } }, expected), /Zápis sa neuložil/);
  assert.deepEqual(db.databases.get('magnum-opus-knowledge-system-v1'), before);
  const beforeWrites = db.writes;
  await assert.rejects(store.setValue('terms', { science: { memory: Array.from({ length: 501 }, () => ({ term: 'veľa', description: '' })) } }, expected), /Príliš veľa/);
  assert.equal(db.writes, beforeWrites);
  assert.deepEqual(events, []);
});

test('conditional author addition and export preserve unknown imported branches and original documents', async () => {
  const store = createStore(environment());
  await store.putDocument(doc('author-original'));
  const expected = { future: { archive: ['  Imported Author  ', 'a'.repeat(200)] }, science: { unknownCategory: ['Keep'] } };
  await store.setValue('authors', expected);
  const proposal = copy(expected);
  proposal.science.cognition = ['New Author'];
  await store.setValue('authors', proposal, { science: expected.science, future: expected.future });
  const exported = JSON.parse(await (await store.exportBackup()).text());
  assert.deepEqual(exported.authors, proposal);
  assert.deepEqual(expected.science, { unknownCategory: ['Keep'] });
  assert.equal(exported.documents.length, 1);
  assert.equal(await (await store.getDocuments())[0].blob.text(), 'Kognícia a pamäť.');
});

test('stale conditional author writes preserve the other tab even without change notifications', async () => {
  const db = indexedDBMock(), env = environment(db), first = createStore(env), second = createStore(env);
  const original = { science: { cognition: ['Original'] } };
  await first.setValue('authors', original, {});
  const stale = await first.getValue('authors', {});
  const winner = { science: { cognition: ['Original', 'Second tab'] } };
  await second.setValue('authors', winner, original);
  const beforeWrites = db.writes, events = [];
  first.onChanged(event => events.push(event));
  await assert.rejects(first.setValue('authors', { science: { cognition: ['Stale tab'] } }, stale),
    error => error.code === 'value_conflict' && /Autori/.test(error.message));
  assert.equal(db.writes, beforeWrites);
  assert.deepEqual(plain(await first.getValue('authors', {})), winner);
  assert.deepEqual(events, []);
});

test('author transaction failure rolls back both the record and metadata without notifying', async () => {
  const db = indexedDBMock(), store = createStore(environment(db));
  const original = { science: { cognition: ['Keep'] } };
  await store.setValue('authors', original);
  const before = copy(db.databases.get('magnum-opus-knowledge-system-v1')), events = [];
  store.onChanged(event => events.push(event));
  db.failWrites = true;
  await assert.rejects(store.setValue('authors', { science: { cognition: ['Keep', 'New'] } }, original), /Zápis sa neuložil/);
  assert.deepEqual(db.databases.get('magnum-opus-knowledge-system-v1'), before);
  assert.deepEqual(events, []);
});

const hierarchyModule = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/knowledge-system/hierarchy.js'), 'utf8'), { module: hierarchyModule });
const vocabularyModel = hierarchyModule.exports([
  { id: 'science', name: 'Veda', categories: [{ id: 'cognition', name: 'Kognícia' }] }
]);
const emptyVocabulary = () => ({ hierarchy: { version: 1, nodes: [] }, terms: {}, authors: {} });
const customCategory = (patch = {}) => ({ id: 'custom-learning', fieldId: 'science', parentId: 'cognition', name: 'Učenie', description: '', ...patch });
const v2Backup = (patch = {}) => ({ ...backup(), version: 2, hierarchy: { version: 1, nodes: [] }, ...patch });

test('vocabulary upgrade closes old connections and preserves original bytes and unknown branches', async () => {
  const db = indexedDBMock(), env = environment(db), legacy = createStore(env);
  await legacy.putDocument(doc('keep', 'Nezmenený originál.'));
  const terms = { future: { archive: [{ term: 'n'.repeat(150), description: '' }] } };
  const authors = { future: { archive: ['  Imported Author  ', 'a'.repeat(200)] } };
  await legacy.setValue('terms', terms); await legacy.setValue('authors', authors);
  const beforeWrites = db.writes, modern = createStore(env, vocabularyModel);
  const loaded = await modern.getVocabulary();
  assert.deepEqual(plain(loaded), { ...emptyVocabulary(), terms, authors });
  assert.equal(db.versions.get('magnum-opus-knowledge-system-v1'), 2);
  assert.equal(db.closed, 1);
  assert.equal(db.writes, beforeWrites, 'Opening version 2 does not rewrite documents or vocabulary');
  assert.equal(await (await modern.getDocuments())[0].blob.text(), 'Nezmenený originál.');
  await assert.rejects(legacy.setValue('authors', {}), /novší systém/);
  await assert.rejects(modern.setValue('terms', {}), /setVocabulary/);
});

test('full vocabulary CAS compares all components canonically and uses only the values store', async () => {
  const db = indexedDBMock(), env = environment(db), first = createStore(env, vocabularyModel), second = createStore(env, vocabularyModel);
  const original = emptyVocabulary();
  const firstState = { hierarchy: { version: 1, nodes: [customCategory(), customCategory({ id: 'custom-root', parentId: null, name: 'Ďalšia vetva' })] },
    terms: { future: { archive: [{ term: 'Keep', description: '' }] }, science: { cognition: [] } }, authors: { future: { archive: ['Keep Author'] } } };
  await first.setVocabulary(firstState, original);
  const expected = { authors: firstState.authors, terms: { science: firstState.terms.science, future: firstState.terms.future }, hierarchy: { version: 1, nodes: [...firstState.hierarchy.nodes].reverse() } };
  const winner = copy(firstState); winner.authors.future.archive.push('Second writer');
  await second.setVocabulary(winner, expected);
  const beforeWrites = db.writes, events = [];
  first.onChanged(event => events.push(event));
  const stale = copy(firstState); stale.hierarchy.nodes[0].name = 'Stale rename'; stale.terms.science.cognition.push({ term: 'Stale', description: '' });
  await assert.rejects(first.setVocabulary(stale, firstState), error => error.code === 'value_conflict');
  assert.equal(db.writes, beforeWrites);
  assert.deepEqual(plain(await first.getVocabulary()), winner);
  assert.deepEqual(events, []);
  assert.ok(db.transactions.every(tx => tx.names.length === 1 && tx.names[0] === 'values'));
  assert.deepEqual(firstState.authors.future.archive, ['Keep Author']);
});

test('vocabulary metadata failure rolls back all three records and preserves documents without notifications', async () => {
  const db = indexedDBMock(), modern = createStore(environment(db), vocabularyModel);
  await modern.putDocument(doc('original'));
  const original = emptyVocabulary(); await modern.setVocabulary(original, original);
  const before = copy(db.databases.get('magnum-opus-knowledge-system-v1')), events = [];
  modern.onChanged(event => events.push(event)); db.failWrites = true;
  const proposal = { hierarchy: { version: 1, nodes: [customCategory()] }, terms: { science: { 'custom-learning': [{ term: 'Učenie', description: '' }] } }, authors: { science: { 'custom-learning': ['New Author'] } } };
  await assert.rejects(modern.setVocabulary(proposal, original), /Zápis sa neuložil/);
  await assert.rejects(modern.importBackup(file(v2Backup({ ...proposal, documents: [withoutBlob(doc('must-roll-back'))] }))), /Zápis sa neuložil/);
  assert.deepEqual(db.databases.get('magnum-opus-knowledge-system-v1'), before);
  assert.deepEqual(events, []);
  assert.equal(await (await modern.getDocuments())[0].blob.text(), 'Kognícia a pamäť.');
});

test('v2 roundtrip retains hierarchy, raw vocabulary and original bytes and is idempotent', async () => {
  const source = createStore(environment(), vocabularyModel);
  await source.putDocument(doc('roundtrip', 'Originál: učenie a pamäť.'));
  const vocabulary = { hierarchy: { version: 1, nodes: [customCategory()] }, terms: { science: { 'custom-learning': [{ term: ' Učenie ', description: '' }] } }, authors: { future: { archive: ['  Preserve spaces  '] } } };
  await source.setVocabulary(vocabulary, emptyVocabulary());
  const exported = await source.exportBackup(), contents = JSON.parse(await exported.text());
  assert.equal(contents.version, 2);
  assert.deepEqual(contents.hierarchy, vocabulary.hierarchy);
  assert.equal(Buffer.from(contents.documents[0].blob.base64, 'base64').toString('utf8'), 'Originál: učenie a pamäť.');
  const target = createStore(environment(), vocabularyModel);
  assert.equal((await target.importBackup(exported)).imported, 1);
  assert.deepEqual(plain(await target.getVocabulary()), vocabulary);
  assert.equal((await target.importBackup(exported)).imported, 0);
  assert.deepEqual(plain(await target.getVocabulary()), vocabulary);
  assert.equal((await target.getDocuments()).length, 1);
  assert.equal(await (await target.getDocuments())[0].blob.text(), 'Originál: učenie a pamäť.');
});

test('v1 import into v2 keeps existing hierarchy and merges unknown branches without inventing categories', async () => {
  const modern = createStore(environment(), vocabularyModel);
  const existing = { ...emptyVocabulary(), hierarchy: { version: 1, nodes: [customCategory()] } };
  await modern.setVocabulary(existing, emptyVocabulary());
  const terms = { future: { orphan: [{ term: 'Unknown branch', description: '' }] } }, authors = { future: { orphan: ['Unknown Author'] } };
  const result = await modern.importBackup(file(backup([], terms, authors)));
  assert.deepEqual(plain(result.hierarchy), existing.hierarchy);
  assert.deepEqual(plain(await modern.getVocabulary()), { hierarchy: existing.hierarchy, terms, authors });
  const output = JSON.parse(await (await modern.exportBackup()).text());
  assert.equal(output.version, 2); assert.equal(output.hierarchy.nodes.length, 1);
  await assert.rejects(modern.importBackup(file({ ...backup(), hierarchy: existing.hierarchy })), /verzie 1/);
});

test('conflicting imported definitions and merged sibling collisions reject before any document or vocabulary write', async () => {
  const db = indexedDBMock(), modern = createStore(environment(db), vocabularyModel);
  const existing = { ...emptyVocabulary(), hierarchy: { version: 1, nodes: [customCategory()] } };
  await modern.setVocabulary(existing, emptyVocabulary());
  const before = copy(db.databases.get('magnum-opus-knowledge-system-v1')), beforeWrites = db.writes;
  const conflicting = v2Backup({ documents: [withoutBlob(doc('must-not-add'))], hierarchy: { version: 1, nodes: [customCategory({ name: 'Different definition' })] } });
  await assert.rejects(modern.importBackup(file(conflicting)), /Konflikt definície/);
  const collision = v2Backup({ hierarchy: { version: 1, nodes: [customCategory({ id: 'different-id', name: ' UCENIE ' })] } });
  await assert.rejects(modern.importBackup(file(collision)), /rovnakým názvom/);
  const sameDefinition = v2Backup({ hierarchy: { version: 1, nodes: [{ description: '', name: 'Učenie', parentId: 'cognition', fieldId: 'science', id: 'custom-learning' }] } });
  assert.equal(db.writes, beforeWrites); assert.deepEqual(db.databases.get('magnum-opus-knowledge-system-v1'), before);
  await modern.importBackup(file(sameDefinition));
  assert.deepEqual(plain((await modern.getVocabulary()).hierarchy), existing.hierarchy);
});

test('legacy mode refuses seeded future hierarchy and v2 backups and closes a late blocked upgrade connection', async () => {
  const db = indexedDBMock(), env = environment(db), legacy = createStore(env);
  await legacy.putDocument(doc('keep'));
  db.databases.get('magnum-opus-knowledge-system-v1').get('values').rows.set('hierarchy', { key: 'hierarchy', value: { version: 1, nodes: [customCategory()] } });
  const beforeWrites = db.writes;
  await assert.rejects(legacy.exportBackup(), /nemožno vynechať/);
  await assert.rejects(legacy.setValue('authors', {}), /spoločný zápis/);
  await assert.rejects(legacy.importBackup(file(backup())), /aktuálny systém/);
  await assert.rejects(legacy.importBackup(file(v2Backup())), /nepovolené|verzia 1/);
  assert.equal(db.writes, beforeWrites);
  db.blockUpgrades = true;
  const modern = createStore(env, vocabularyModel);
  await assert.rejects(modern.getVocabulary(), /Ulož rozpísanú prácu/);
  assert.equal(db.closed, 1, 'The known old connection closed on versionchange');
  db.completeBlockedOpen();
  assert.equal(db.closed, 2, 'Late success is immediately closed after the rejected request');
  db.blockUpgrades = false;
  assert.equal((await modern.getVocabulary()).hierarchy.nodes.length, 1);
  assert.equal(await (await modern.getDocuments())[0].blob.text(), 'Kognícia a pamäť.');
});

test('vocabulary validation rejects missing snapshots, malformed topology and sparse/accessor entries before opening storage', async () => {
  const db = indexedDBMock(), modern = createStore(environment(db), vocabularyModel), empty = emptyVocabulary();
  await assert.rejects(modern.setVocabulary(empty), /Slovník/);
  const invalid = { ...empty, hierarchy: { version: 1, nodes: [customCategory({ parentId: 'missing' })] } };
  await assert.rejects(modern.setVocabulary(invalid, empty), /Rodič/);
  const sparse = { ...empty, authors: { science: { cognition: new Array(1) } } };
  await assert.rejects(modern.setVocabulary(sparse, empty), /zoznam|položka/);
  let calls = 0;
  const entries = [];
  Object.defineProperty(entries, '0', { get() { calls++; return 'Do not execute'; }, enumerable: true });
  await assert.rejects(modern.setVocabulary({ ...empty, authors: { science: { cognition: entries } } }, empty), /položka/);
  await assert.rejects(modern.importBackup(file(v2Backup({ version: 3 }))), /verzia 1 alebo 2/);
  await assert.rejects(modern.importBackup(file(v2Backup({ hierarchy: invalid.hierarchy }))), /Rodič/);
  const tooManyFields = {};
  for (let index = 0; index < 101; index++) Object.defineProperty(tooManyFields, 'field' + index, { value: {} });
  await assert.rejects(modern.setVocabulary({ ...empty, authors: tooManyFields }, empty), /Neplatný zoznam/);
  assert.equal(calls, 0); assert.equal(db.opened.length, 0); assert.equal(db.writes, 0);
});
