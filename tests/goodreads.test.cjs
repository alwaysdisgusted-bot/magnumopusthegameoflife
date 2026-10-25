'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../public/goodreads.js'), 'utf8');
const filename = path.join(__dirname, '../public/goodreads.js');
const loaded = new Module(filename, module); loaded.filename = filename; loaded._compile(source, filename);
const G = loaded.exports;
const M = require('../server/game-model.cjs');
const headers = ['Book Id', 'Title', 'Author', 'Number of Pages', 'Bookshelves', 'Exclusive Shelf', 'My Rating', 'ISBN13'];
const quote = value => '"' + String(value).replace(/"/g, '""') + '"';
const csv = rows => headers.join(',') + '\r\n' + rows.map(row => row.map(quote).join(',')).join('\r\n');
const book = (id, title, pages = '100', shelf = 'read', author = 'Autor') => [id, title, author, pages, 'filozofia, rast', shelf, '4', '="9781234567890"'];

test('Goodreads CSV supports a BOM, commas, escaped quotes, CRLF and quoted newlines', () => {
  const text = '\uFEFF' + csv([book('123', 'Kniha, ktorá vraví "áno"', '120', 'read', 'Anna\nNováková')]);
  const parsed = G.parseCSV(text);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0].Title, 'Kniha, ktorá vraví "áno"');
  assert.equal(parsed.rows[0].Author, 'Anna\nNováková');
  assert.equal(parsed.rows[0].ISBN13, '="9781234567890"');
  const plan = G.planImport(parsed, [], { readAsComplete: true });
  assert.equal(plan.importCount, 1);
  assert.deepEqual(plan.books[0].goodreads, { id: '123', isbn: '9781234567890', shelf: 'read', rating: 4 });
  assert.deepEqual(plan.books[0].tags, ['filozofia', 'rast', 'read']);
  assert.equal(plan.books[0].current, 120);
});

test('malformed CSV cannot silently shift columns or discard unclosed quoted data', () => {
  for (const text of ['', '\uFEFF', 'Author,Pages\nA,10', 'Title, title\nA,B', 'Title,Author\n"broken', 'Title,Author\n"closed"bad,A', 'Title,Author\nnot"quoted,A', 'Title,Author\nA,B,C']) assert.throws(() => G.parseCSV(text), text);
  assert.equal(G.parseCSV('Title,Author\nA,B\n\n').rows.length, 1);
  assert.equal(G.parseCSV('Title,Author\n"A" ,B').rows[0].Title, 'A');
});

test('CSV byte and row bounds are enforced before importing a large library', () => {
  assert.throws(() => G.parseCSV('Title\n' + 'x'.repeat(5 * 1024 * 1024)), /5 MB/);
  const multibyte = 'Title\n' + 'é'.repeat(2700000);
  assert.ok(multibyte.length < 5 * 1024 * 1024); assert.throws(() => G.parseCSV(multibyte), /5 MB/);
  assert.throws(() => G.parseCSV('Title\n' + Array.from({ length: 10001 }, (_, i) => 'Book ' + i).join('\n')), /10 000/);
  assert.equal(G.parseCSV('Title\n' + Array.from({ length: 10000 }, (_, i) => 'Book ' + i).join('\n')).rows.length, 10000);
});

test('missing or invalid page counts are reported without inventing book lengths', () => {
  const rows = ['', '0', '-1', '12.5', 'unknown', '100001'].map((pages, i) => book(String(i + 1), 'Chýbajúce strany ' + i, pages));
  rows.push(book('99', 'Platná kniha', '245'));
  const plan = G.planImport(csv(rows), [], {});
  assert.equal(plan.missingPages, 6); assert.equal(plan.importCount, 1); assert.equal(plan.books[0].total, 245);
});

test('duplicates use Goodreads IDs and normalized title-author pairs within both libraries', () => {
  const existing = [{ title: '  DUNA ', author: 'Frank   Herbert', current: 75, goodreads: { id: '100' } }];
  const text = csv([book('100', 'Odlišné vydanie', '500'), book('200', 'duna', '600', 'to-read', ' frank herbert '), book('300', 'Nová kniha'), book('300', 'Rovnaká nová kniha'), book('400', ' nová  KNIHA ') ]);
  const before = JSON.stringify(existing),plan = G.planImport(text, existing, {});
  assert.equal(plan.duplicates, 4); assert.equal(plan.importCount, 1); assert.equal(plan.books[0].title, 'Nová kniha');
  assert.equal(JSON.stringify(existing), before);
});

test('library capacity, safe metadata and tag limits are reflected in the preview', () => {
  const existing = Array.from({ length: 499 }, (_, i) => ({ title: 'Existujúca ' + i, author: '', current: 1 }));
  const a = book('1', 'Prvá'); a[4] = Array.from({ length: 35 }, (_, i) => 'tag-' + i).join(', '); a[6] = '99'; a[7] = 'not-an-isbn';
  const plan = G.planImport(csv([a, book('2', 'Druhá'), book('3', 'Tretia')]), existing, {});
  assert.equal(plan.importCount, 1); assert.equal(plan.capacitySkipped, 2); assert.equal(plan.books[0].tags.length, 30);
  assert.equal(plan.ignoredTags, 6); assert.equal(plan.books[0].goodreads.rating, 0); assert.equal(plan.books[0].goodreads.isbn, '');
  const invalid = G.planImport(csv([book('1', '', '100'), book('2', 'x'.repeat(201), '100')]), [], {}); assert.equal(invalid.invalid, 2);
});

test('historical completion is optional and never mints rewards or overwrites existing progress', () => {
  const state = M.createState();
  M.addBook(state, { title: 'Rozčítaná', author: 'Autor', total: 100, current: 25, tags: [], cover: '' });
  const original = JSON.stringify(state.books[0]),ledger = JSON.stringify(state.ledger),reading = JSON.stringify(state.reading);
  const plan = G.importIntoState(state, M, csv([book('1', 'Rozčítaná'), book('2', 'Historická'), book('3', 'Teraz čítam', '40', 'currently-reading')]), { readAsComplete: true, profileUrl: 'https://www.goodreads.com/user/show/123-merlin' });
  assert.equal(plan.importCount, 2); assert.equal(plan.duplicates, 1); assert.equal(JSON.stringify(state.books[0]), original);
  assert.equal(state.books[1].current, 100); assert.equal(state.books[2].current, 0);
  assert.equal(JSON.stringify(state.ledger), ledger); assert.equal(JSON.stringify(state.reading), reading); assert.equal(M.balance(state), 0);
  assert.equal(state.settings.goodreadsUrl, 'https://www.goodreads.com/user/show/123');
  const fresh = M.createState(); G.importIntoState(fresh, M, csv([book('20', 'Začíname', '40')]), {});
  assert.equal(fresh.books[0].current, 0); assert.equal(M.balance(fresh), 0);
  M.readBook(fresh, fresh.books[0].id, 20); assert.equal(M.balance(fresh), 1);
});

test('saved profile links are canonical HTTPS Goodreads user pages', () => {
  assert.equal(G.profileURL('https://goodreads.com/user/show/123-Merlin?ref=nav#books'), 'https://www.goodreads.com/user/show/123');
  assert.equal(G.profileURL(''), '');
  for (const value of ['javascript:alert(1)', 'http://www.goodreads.com/user/show/123', 'https://goodreads.com.evil.test/user/show/123', 'https://example.com/user/show/123', 'https://www.goodreads.com/book/show/123', 'https://user:pass@www.goodreads.com/user/show/123', 'https://www.goodreads.com:8443/user/show/123']) assert.throws(() => G.profileURL(value), value);
});
