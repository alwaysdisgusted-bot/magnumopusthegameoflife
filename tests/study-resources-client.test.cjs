'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../server/study-model.mjs').default;
const source = fs.readFileSync(path.join(__dirname, '../public/study.js'), 'utf8');
const photoId = '33333333-3333-4333-8333-333333333333';
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const note = (id, title, visibility = 'private') => ({ id, title, text: 'Vlastný zápis o financiách.', date: '2026-10-20', visibility });
const photo = caption => ({ id: photoId, categoryId: 'category', categoryName: 'Peniaze', caption, url: 'https://untrusted.example/image.png' });
function fixture(handler) {
  let account = 'A', modal;
  const requests = [], openedNotes = [];
  const state = { books: [], bank: { card: 0, cash: 0, invested: 0, owed: 0, receivable: 0 }, strategies: [] };
  const app = {
    state, render() {}, toast() {},
    esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    openModal(title, html, callback, options) { modal = { title, html, callback, options }; }
  };
  const window = {
    MOApp: app,
    MOStudyModel: { createState: model.createState, validateState: value => model.validateState(clone(value)) },
    MOAuth: {
      getAccount: () => account ? { id: account } : null,
      isAuthenticated: () => !!account,
      async api(url, options = {}) {
        const request = { url, account, ...options }; requests.push(request);
        const custom = handler?.(request); if (custom !== undefined) return custom;
        if (url === '/api/study') return { state: model.createState(), revision: 0 };
        if (url === '/api/workspace/pages') return { pages: [] };
        if (url === '/api/calendar/notes?all=1') return { notes: [] };
        if (url === '/api/library/photos') return { photos: [] };
        throw Error('Unexpected API route');
      }
    },
    MODayNotes: { async handleAction(action, element) { openedNotes.push({ action, id: element.dataset.id }); } },
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, document: {}, structuredClone, Intl, Blob, URL, setTimeout, clearTimeout });
  return {
    api: window.MOStudy, state, requests, openedNotes,
    get modal() { return modal; }, setAccount(id) { account = id; },
    async open() { window.MOStudy.afterRender('study'); await tick(); await tick(); }
  };
}

test('aggregates topic-matched book notes, daynotes and private library photos without changing source data', async () => {
  const f = fixture(request => request.url === '/api/calendar/notes?all=1' ? { notes: [note('one', 'Súkromné financie <script>'), note('two', 'Verejné financie', 'public'), { ...note('other', 'Iná téma'), text: 'Záhrada a kvety' }] } : request.url === '/api/library/photos' ? { photos: [photo('Úspory & plán'), { ...photo('Peniaze zo zlého ID'), id: 'evil/id' }] } : undefined);
  f.state.books.push({ id: 'book', title: 'Nenápadný názov', author: 'Autor', tags: [], current: 1, total: 10, notes: 'Poznámka: úspory a rozpočet.' });
  await f.open(); const html = f.api.render();
  assert.match(html, /Nenápadný názov/); assert.match(html, /Súkromné financie &lt;script&gt;/);
  assert.match(html, /DENNÁ POZNÁMKA · SÚKROMNÁ/); assert.match(html, /DENNÁ POZNÁMKA · VEREJNÁ/);
  assert.match(html, /Úspory &amp; plán/); assert.doesNotMatch(html, /Iná téma|Peniaze zo zlého ID|untrusted\.example/);
  assert.ok(f.requests.every(request => !request.method), 'aggregation only reads original sources');
});

test('opens the existing note editor flow and keeps photos on a UUID-only private route in a read-only dialog', async () => {
  const f = fixture(request => request.url === '/api/calendar/notes?all=1' ? { notes: [note('note-id', 'Financie')] } : request.url === '/api/library/photos' ? { photos: [photo('Investície <img>')] } : undefined);
  await f.open();
  await f.api.handleAction('study-daynote', { dataset: { id: 'note-id' } });
  assert.deepEqual(f.openedNotes, [{ action: 'dn-open', id: 'note-id' }]);
  await f.api.handleAction('study-daynote', { dataset: { id: 'not-cached' } }); assert.equal(f.openedNotes.length, 1);
  await f.api.handleAction('study-library-photo', { dataset: { id: photoId } });
  assert.equal(f.modal.options.readOnly, true); assert.equal(f.modal.callback, null);
  assert.match(f.modal.html, new RegExp('/api/library/photos/' + photoId)); assert.match(f.modal.html, /Investície &lt;img&gt;/);
  assert.doesNotMatch(f.modal.html, /untrusted\.example/); assert.ok(f.requests.every(request => !request.method));
});

test('reports independent unavailable sources and refresh recovers without hiding available notes', async () => {
  let failing = true;
  const f = fixture(request => {
    if (request.url === '/api/calendar/notes?all=1') return { notes: [note('one', 'Dostupné financie')] };
    if (failing && request.url === '/api/workspace/pages') throw Error('Stránky v údržbe');
    if (failing && request.url === '/api/library/photos') throw Error('Fotografie v údržbe');
  });
  await f.open(); let html = f.api.render();
  assert.match(html, /Dostupné financie/); assert.match(html, /Osobné stránky sa nepodarilo načítať/); assert.match(html, /Fotografie knižnice sa nepodarilo načítať/);
  failing = false; await f.api.handleAction('study-refresh', { dataset: {} }); html = f.api.render();
  assert.match(html, /Dostupné financie/); assert.doesNotMatch(html, /v údržbe|Načítavam súvisiace/);
});

test('discarded account responses never populate the next account topic sources or open their photos', async () => {
  const oldNotes = deferred(), oldPhotos = deferred();
  const f = fixture(request => {
    if (request.url === '/api/calendar/notes?all=1') return request.account === 'A' ? oldNotes.promise : { notes: [note('B-note', 'Financie účtu B')] };
    if (request.url === '/api/library/photos') return request.account === 'A' ? oldPhotos.promise : { photos: [] };
  });
  await f.open(); f.setAccount('B'); f.api.render(); await f.open();
  oldNotes.resolve({ notes: [note('A-note', 'Financie tajomstvo A')] }); oldPhotos.resolve({ photos: [photo('Financie tajomstvo A')] }); await tick(); await tick();
  const html = f.api.render(); assert.match(html, /Financie účtu B/); assert.doesNotMatch(html, /tajomstvo A/);
  await f.api.handleAction('study-library-photo', { dataset: { id: photoId } }); assert.equal(f.modal, undefined);
});

test('a slower earlier refresh cannot replace a newer source snapshot from the same account', async () => {
  const oldNotes = deferred(), oldPhotos = deferred(); let noteReads = 0, photoReads = 0;
  const f = fixture(request => {
    if (request.url === '/api/calendar/notes?all=1') return ++noteReads === 1 ? oldNotes.promise : { notes: [note('new', 'Financie aktuálne')] };
    if (request.url === '/api/library/photos') return ++photoReads === 1 ? oldPhotos.promise : { photos: [photo('Úspory aktuálne')] };
  });
  await f.open(); await f.api.handleAction('study-refresh', { dataset: {} });
  oldNotes.resolve({ notes: [note('old', 'Financie staré')] }); oldPhotos.resolve({ photos: [photo('Úspory staré')] }); await tick(); await tick();
  const html = f.api.render(); assert.match(html, /Financie aktuálne/); assert.match(html, /Úspory aktuálne/); assert.doesNotMatch(html, /Financie staré|Úspory staré|Načítavam súvisiace/);
});
