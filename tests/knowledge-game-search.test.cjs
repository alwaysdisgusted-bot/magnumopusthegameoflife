'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const common = { exports: {} };
Function('module', fs.readFileSync(path.join(__dirname, '../public/knowledge-game-search.js'), 'utf8'))(common);
const api = common.exports;

const empty = () => ({
  '/api/workspace/pages': { pages: [] },
  '/api/calendar/notes?all=1': { notes: [] },
  '/api/desk': { state: { items: [] } },
  '/api/study': { state: { notes: [] } },
  '/api/save': { state: { books: [] } }
});
function fixture(data = empty(), handler) {
  const requests = [];
  return { requests, fetch: async (path, options) => {
    requests.push({ path, options });
    if (handler) { const response = await handler(path, options); if (response) return response; }
    return { ok: true, status: 200, json: async () => data[path] ?? (path.startsWith('/api/knowledge/grimoire/search?') ? { results: [] } : undefined) };
  } };
}

test('accent and case folding returns original offsets including combining marks and emoji', () => {
  const text = '🧙 KOGNÍCIA, kogni\u0301cia; ďalší ŽIVOT';
  const ranges = api.findRanges(text, 'kognicia');
  assert.deepEqual(ranges.map(r => text.slice(r.start, r.end)), ['KOGNÍCIA', 'kogni\u0301cia']);
  assert.deepEqual(api.findRanges('e\u0301 É', 'e'), [{ start: 0, end: 2 }, { start: 3, end: 4 }]);
  assert.deepEqual(api.findRanges('🧙', '🧙'), [{ start: 0, end: 2 }]);
  assert.deepEqual(api.findRanges('Kognícia\n\t a pamäť', 'KOGNICIA  a'), [{ start: 0, end: 12 }]);
  assert.deepEqual(api.findRanges(text, ''), []);
});

test('searches all owned note sources and returns safe original-section links using GET only', async () => {
  const data = empty();
  data['/api/workspace/pages'].pages.push({ id: 'page-1', title: '<Pracovňa>', body: 'Kognícia na stránke' });
  data['/api/calendar/notes?all=1'].notes.push({ id: 'day-1', title: '', date: '2026-10-21', text: 'kognícia v dni' });
  data['/api/desk'].state.items.push({ id: 'note-1', type: 'note', text: 'kognícia v lístku' }, { id: 'photo-1', type: 'image', name: 'Kognícia <foto>', src: 'kognícia secret image data' });
  data['/api/study'].state.notes.push({ id: 'study-1', title: 'Štúdium', text: 'kognícia v štúdiu' });
  data['/api/save'].state.books.push({ id: 'book-1', title: 'Kniha', notes: 'kognícia pri čítaní', tags: [] });
  const f = fixture(data), result = await api.search('kognicia', { fetch: f.fetch });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.results.map(r => r.kind), ['page', 'daynote', 'desk-note', 'desk-photo', 'study', 'book']);
  assert.deepEqual(result.results.map(r => r.url.split('#')[1]), ['workspace', 'calendar', 'desk', 'desk', 'study', 'library']);
  assert.equal(result.results[0].title, '<Pracovňa>');
  assert.equal(result.results[3].text, 'Kognícia <foto>');
  for (const row of result.results) {
    const link = new URL(row.url, 'http://127.0.0.1:4175');
    assert.equal(link.origin, 'http://127.0.0.1:4175');
    assert.equal(link.searchParams.get('knowledgeSearch'), 'kognicia');
    assert.equal(link.searchParams.get('sourceId'), row.id);
  }
  assert.equal(f.requests.length, 6);
  for (const request of f.requests) {
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.cache, 'no-store');
    assert.equal(request.options.headers['X-MO-Request'], '1');
    assert.equal(request.options.body, undefined);
  }
});

test('search includes local Grimoire folders and documents and links back through the library', async () => {
  const f = fixture(empty(), path => {
    if (path === '/api/knowledge/grimoire/search?q=kognicia') return {
      ok: true, status: 200, json: async () => ({ results: [
        { kind: 'grimoire-folder', id: 'folder-1', title: 'Psychológia', text: 'Moja knižnica → Psychológia\nPoznámka o kognícia', occurrences: 1 },
        { kind: 'grimoire-document', id: 'document-1', title: 'Poznámky.pdf', text: 'Moja knižnica → Psychológia\nKognícia a pamäť', occurrences: 1 }
      ] })
    };
  });
  const result = await api.search('kognicia', { fetch: f.fetch });
  const grimoire = result.results.filter(row => row.kind.startsWith('grimoire-'));
  assert.deepEqual(grimoire.map(row => row.kind), ['grimoire-folder', 'grimoire-document']);
  assert.deepEqual(grimoire.map(row => new URL(row.url, 'http://127.0.0.1:4175').hash), ['#library', '#library']);
  assert.ok(f.requests.some(row => row.path === '/api/knowledge/grimoire/search?q=kognicia'
    && row.options.method === 'GET' && row.options.headers['X-MO-Request'] === '1'));
});

test('matches beyond the preview, counts every occurrence, and never searches image bytes', async () => {
  const data = empty(), text = 'x'.repeat(10000) + ' Hľadané <b> & HĽADANÉ';
  data['/api/workspace/pages'].pages.push({ id: 'long', title: 'Dlhý dokument', body: text });
  data['/api/desk'].state.items.push({ id: 'photo', type: 'image', name: 'Fotografia', src: 'Hľadané' });
  const f = fixture(data), result = await api.search('hladane', { fetch: f.fetch });
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].occurrences, 2);
  assert.equal(result.results[0].text, 'Dlhý dokument\n' + text);
  assert.match(result.results[0].snippet, /Hľadané <b> & HĽADANÉ/);
  assert.ok(result.results[0].snippet.length < 250);
});

test('reports HTTP, network, and malformed-source failures while retaining available matches', async () => {
  const data = empty();
  data['/api/workspace/pages'].pages.push({ id: 'page', title: 'Test', body: 'Dostupná kognícia' });
  data['/api/study'] = { state: { notes: 'broken' } };
  const f = fixture(data, path => {
    if (path === '/api/calendar/notes?all=1') return { ok: false, status: 401 };
    if (path === '/api/desk') throw Error('Syntetický výpadok');
  });
  const result = await api.search('kognicia', { fetch: f.fetch });
  assert.equal(result.results.length, 1);
  assert.equal(result.errors.length, 3);
  assert.match(result.errors[0], /^Denné poznámky:.*prihlás/);
  assert.match(result.errors[1], /^Alchymistický stôl:/);
  assert.match(result.errors[2], /^Osobné štúdium:.*neplatný zoznam/);
});

test('bounds query and result counts without discarding later matches before searching', async () => {
  const f = fixture();
  for (const query of ['', '   ', '\u0301', 'x'.repeat(151)]) {
    const result = await api.search(query, { fetch: f.fetch });
    assert.equal(result.results.length, 0);
    assert.equal(result.errors.length, 1);
  }
  assert.equal(f.requests.length, 0);
  const data = empty();
  data['/api/workspace/pages'].pages = Array.from({ length: 250 }, (_, i) => ({ id: 'page-' + i, title: 'Záznam', body: i < 149 ? 'Bez zhody' : 'q' }));
  const limited = await api.search('q', { fetch: fixture(data).fetch });
  assert.equal(limited.results.length, 100);
  assert.equal(limited.results[0].id, 'page-149');
  assert.deepEqual(limited.errors, []);
  const one = empty(); one['/api/study'].state.notes.push({ id: 'one', text: 'z' });
  assert.equal((await api.search('z', { fetch: fixture(one).fetch })).results[0].id, 'one');
});

test('cancellation rejects the search and passes the same signal to all reads', async () => {
  const controller = new AbortController(), f = fixture(empty(), async () => {
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
  });
  await assert.rejects(api.search('text', { fetch: f.fetch, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.requests.length, 6);
  assert.ok(f.requests.every(r => r.options.signal === controller.signal));
  const before = fixture();
  await assert.rejects(api.search('text', { fetch: before.fetch, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(before.requests.length, 0);
});
