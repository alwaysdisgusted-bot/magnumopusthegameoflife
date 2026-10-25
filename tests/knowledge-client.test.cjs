'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const M = require('../server/knowledge-model.mjs').default;
const source = fs.readFileSync(path.join(__dirname, '../public/knowledge.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const decode = value => String(value).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const resource = patch => ({ id: 'r1', sourceKind: 'upload', sourceId: 'asset1', title: 'Zdroj', text: 'Text', assetId: 'asset1', mime: 'text/plain', conceptIds: [], manualConceptIds: [], excludedConceptIds: [], analysisStatus: 'indexed', analyzedAt: 1, updatedAt: 1, pages: [{ number: 1, text: 'Text' }], pagination: 'unpaginated', ...patch });
const study = () => ({ version: 1, categories: [{ id: 'study-psych', name: 'Psychológia', parentId: null, slot: 4, keywords: ['psychológia'] }, { id: 'study-cognition', name: 'Kognícia', parentId: 'study-psych', slot: null, keywords: ['kognícia', 'myslenie'] }], notes: [], links: [] });

function fixture(options = {}) {
  let account = 'A', root, form, html = '', currentStudy = study();
  const states = new Map(Object.entries(options.states || { A: M.createState() }).map(([id, state]) => [id, { state: clone(state), revision: 0 }]));
  const requests = [], notifications = [], navigations = [], readerCalls = [], ocrCalls = [];
  const status = { textContent: '' }, results = { innerHTML: '' };
  class BrowserFormData extends FormData {
    constructor(element) { super(); if (element) for (const [name, value] of Object.entries(element.values)) for (const item of Array.isArray(value) ? value : [value]) this.append(name, item); }
  }
  const app = {
    state: { books: options.books || [] },
    esc: value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    toast: value => notifications.push(value),
    render() {
      html = window.MOKnowledge.render();
      root = { dataset: {}, listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; }, querySelector(selector) { return selector === '#knowledge-editor-form' ? form : selector === '[data-knowledge-results]' ? results : null; } };
      form = null;
      if (html.includes('id="knowledge-editor-form"')) {
        const values = {};
        for (const match of html.matchAll(/<input\b[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*>/g)) {
          if (match[1] === 'conceptIds') { if (/\bchecked\b/.test(match[0])) (values.conceptIds ||= []).push(decode(match[2])); }
          else values[match[1]] = decode(match[2]);
        }
        for (const match of html.matchAll(/<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) values[match[1]] = decode(match[2]);
        for (const match of html.matchAll(/<select\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) values[match[1]] = decode(/<option value="([^"]*)"[^>]*selected/.exec(match[2])?.[1] || '');
        form = { values, addEventListener() {} };
      }
      window.MOKnowledge.afterRender('knowledge');
    },
    navigate(view) { navigations.push(view); if (view === 'knowledge') this.render(); }, openModal() {},
  };
  const window = {
    MOApp: app,
    MOKnowledgeModel: { ...M, validateState: value => M.validateState(clone(value)) },
    MOAuth: { getAccount: () => account ? { id: account } : null, async api(url, extra = {}) {
      const request = { url, account, ...extra }; requests.push(request);
      const custom = options.handler?.(request); if (custom !== undefined) return custom;
      if (url === '/api/knowledge') {
        const current = states.get(account) || { state: M.createState(), revision: 0 };
        if (extra.method === 'PUT') { const saved = { state: M.validateState(clone(extra.body.state)), revision: current.revision + 1 }; states.set(account, saved); return clone(saved); }
        return clone(current);
      }
      if (url === '/api/study') return { state: clone(currentStudy), revision: 1 };
      if (url === '/api/workspace/pages') return { pages: [] };
      if (url === '/api/calendar/notes?all=1') return { notes: [] };
      if (url === '/api/library/photos') return { photos: [] };
      if (url === '/api/desk') return { state: { items: [] } };
      if (url === '/api/auth/session') return { account: { id: account }, csrf: 'synthetic-test-token' };
      throw Error('Unexpected API route: ' + url);
    } },
    MOKnowledgeExtract: { cancel() {}, extract: options.extract || (async () => ({ text: 'Text', mime: 'text/plain', status: 'indexed', warning: '', pages: [{ number: 1, text: 'Text' }], pagination: 'unpaginated' })), recognizePhoto: async photo => { ocrCalls.push(photo); return 'Nový OCR prepis'; } },
    MOKnowledgeReader: { open: async (...args) => readerCalls.push(clone(args)), destroy() {} },
    MOStudy: { getSelectedCategory: () => 'study-cognition' }, addEventListener() {},
  };
  const document = { getElementById: id => id === 'knowledge-root' ? root : id === 'knowledge-editor-form' ? form : null, querySelector: selector => selector === '[data-knowledge-status]' ? status : null, querySelectorAll: () => [] };
  const fetch = async (url, extra) => {
    requests.push({ url, account, ...extra });
    return { ok: true, status: 200, json: async () => ({ file: { id: 'uploaded-pdf', name: 'podklad.pdf', mime: 'application/pdf', size: 30 } }) };
  };
  vm.runInNewContext(source, { window, document, structuredClone, Intl, Blob, URL, FormData: BrowserFormData, File, crypto: webcrypto, fetch, setTimeout, clearTimeout, console });
  const f = {
    api: window.MOKnowledge, app, requests, notifications, navigations, readerCalls, ocrCalls,
    get html() { return html; }, get form() { return form; }, get results() { return results.innerHTML; },
    state: id => clone(states.get(id || account)?.state), setAccount: id => { account = id; }, setStudy: value => { currentStudy = value; },
    action: (name, id = '') => window.MOKnowledge.handleAction('knowledge-' + name, { dataset: { id } }),
    async open() { app.render(); await tick(); await tick(); },
    async upload(files) { root.listeners.change({ target: { files, value: '', matches: selector => selector === '[data-knowledge-files]' } }); await tick(); await tick(); },
    query(value) { root.listeners.input({ target: { value, matches: selector => selector === '[data-knowledge-query]' } }); },
  };
  return f;
}

test('scientific concept tree places sephirot and preserves study categories without replacing the study', async () => {
  const f = fixture({ books: [{ id: 'book1', title: 'Kognícia a myslenie', author: '', tags: [], notes: 'Pamäť a pozornosť.' }] });
  await f.open();
  assert.match(f.html, /knowledge-graph-node root[^>]*transform="translate\(500 343\)"[^>]*data-id="sefirah-tiferet"/);
  assert.match(f.html, /knowledge-graph-node topic[^>]*data-id="psychology"/);
  assert.match(f.html, /Desať Sefirot · vzťahy a slovník/);
  assert.match(f.html, /Vedecká terminológia · moderný interpretačný most/);
  assert.match(f.html, /FOS 2007/);
  assert.match(f.html, /Psychológia → Kognícia → Kognitívna veda/);
  assert.match(f.html, /Binah<\/strong><span class="knowledge-sefirot-translation">Porozumenie/);
  assert.match(f.html, /Ein Sof · Bez konca/);
  assert.match(f.html, /Da’at · Poznanie/);
  assert.match(f.html, /32 ciest múdrosti/);
  assert.match(f.html, /nepriraďuje hebrejské písmená/);
  assert.match(f.html, /moderná interpretačná vrstva/);
  assert.match(f.html, /Triedenie používa textové kľúčové slová.*nie AI porozumenie významu/);
  const widget = f.api.renderProfileWidget();
  assert.match(widget, /knowledge-profile-widget/);
  assert.match(widget, /interpretačná pomôcka/);
  assert.match(widget, /knowledge-graph-sephirah/);
  await f.action('scan');
  let saved = f.state();
  assert.equal(saved.concepts.find(item => item.id === 'psychology').parentId, 'social-sciences');
  assert.equal(saved.concepts.find(item => item.id === 'cognitive-science').parentId, 'cognition');
  assert.equal(saved.concepts.find(item => item.id === 'psychology').studyCategoryId, 'study-psych');
  assert.equal(saved.concepts.find(item => item.id === 'cognition').studyCategoryId, 'study-cognition');
  assert.equal(saved.concepts.find(item => item.id === 'cognition').parentId, 'psychology');
  assert.ok(M.resourcesUnder(saved, 'psychology').some(item => item.id === 'book_book1'));
  const renamed = study(); renamed.categories[0].name = 'Moja psychológia'; renamed.categories[0].slot = 9; f.setStudy(renamed);
  await f.action('refresh');
  assert.match(f.html, /knowledge-graph-node root[^>]*transform="translate\(500 343\)"[^>]*data-id="sefirah-tiferet"/);
  assert.match(f.html, /Moja psychológia/);
  f.api.openStudyCategory('study-cognition'); await tick(); await tick();
  assert.match(f.html, /knowledge-graph-node topic selected[^>]*data-id="cognition"/);
  assert.ok(f.requests.filter(request => request.method).every(request => request.url === '/api/knowledge'));
});

test('late account responses cannot leak resources and held drafts return only to their owner', async () => {
  const accountA = M.createState(), accountB = M.createState();
  accountA.resources.push(resource({ id: 'private-A', title: 'Tajomstvo účtu A' })); accountB.resources.push(resource({ id: 'private-B', title: 'Zdroj účtu B' }));
  const late = deferred(); let knowledgeReadsA = 0;
  const f = fixture({ states: { A: accountA, B: accountB }, handler: request => request.url === '/api/knowledge' && !request.method && request.account === 'A' && ++knowledgeReadsA === 2 ? late.promise : undefined });
  await f.open(); await f.action('resource', 'private-A'); f.form.values.text = 'Rozpísaný text iba pre A';
  const refreshingA = f.action('refresh'); f.api.destroy({ preserveDraft: true }); f.setAccount('B'); await f.open();
  late.resolve({ state: accountA, revision: 0 }); await refreshingA;
  assert.match(f.html, /Zdroj účtu B/); assert.doesNotMatch(f.html, /Tajomstvo účtu A|Rozpísaný text iba pre A/);
  f.api.destroy({ preserveDraft: true }); f.setAccount('A'); await f.open();
  assert.equal(f.form.values.text, 'Rozpísaný text iba pre A');
  assert.equal(f.api.hasUnsavedDrafts(), true);
});

test('library reanalysis preserves corrected text, manual links and unavailable source records', async () => {
  const initial = M.createState();
  initial.resources.push(resource({ id: 'book_book1', sourceKind: 'book', sourceId: 'book1', assetId: null, title: 'Kniha', text: 'Môj opravený prepis', pages: [{ number: 1, text: 'Môj opravený prepis' }], conceptIds: ['psychology'], manualConceptIds: ['psychology'], excludedConceptIds: ['cognition'] }), resource({ id: 'page_page1', sourceKind: 'page', sourceId: 'page1', assetId: null, title: 'Dočasne nedostupná stránka' }));
  const photoId = '33333333-3333-4333-8333-333333333333';
  initial.resources.push(resource({ id: 'library_photo_' + photoId, sourceKind: 'library-photo', sourceId: photoId, assetId: null, mime: 'image/jpeg', title: 'Opravená fotografia', text: 'Opravený OCR text', pages: [{ number: 1, text: 'Opravený OCR text' }] }));
  const f = fixture({ states: { A: initial }, books: [{ id: 'book1', title: 'Kniha', notes: 'Neopravený pôvodný text', tags: [] }], handler: request => {
    if (request.url === '/api/workspace/pages') throw Error('Zdroj je dočasne nedostupný');
    if (request.url === '/api/library/photos') return { photos: [{ id: photoId, caption: 'Fotka', categoryName: 'Psychológia' }] };
    if (request.url === '/api/calendar/notes?all=1') return { notes: [{ id: 'new-note', title: 'Nová poznámka', text: 'Myslenie a kognícia', date: '2026-10-20' }] };
  } });
  await f.open(); await f.action('scan');
  const saved = f.state(), book = saved.resources.find(item => item.id === 'book_book1');
  assert.equal(book.text, 'Môj opravený prepis'); assert.deepEqual(book.pages, [{ number: 1, text: 'Môj opravený prepis' }]);
  assert.ok(book.manualConceptIds.includes('psychology')); assert.ok(book.excludedConceptIds.includes('cognition'));
  assert.ok(saved.resources.some(item => item.id === 'page_page1'));
  assert.equal(saved.resources.find(item => item.id === 'library_photo_' + photoId).text, 'Opravený OCR text');
  assert.equal(f.ocrCalls.length, 0);
  assert.ok(saved.resources.some(item => item.sourceKind === 'daynote' && item.sourceId === 'new-note'));
  assert.match(f.html, /Osobné stránky:.*Existujúce záznamy zostali zachované/);
});

test('PDF upload keeps original page numbers and corrections never retain false page coordinates', async () => {
  const extracted = { text: 'Prvá strana\n\nHľadané heslo na tretej', mime: 'application/pdf', status: 'needs_text', warning: 'Druhá strana čaká na doplnenie.', pages: [{ number: 1, text: 'Prvá strana' }, { number: 2, text: '' }, { number: 3, text: 'Hľadané heslo na tretej' }], pagination: 'pages' };
  const f = fixture({ extract: async () => clone(extracted) });
  await f.open(); await f.upload([new File(['%PDF-1.7 synthetic'], 'podklad.pdf', { type: 'application/pdf' })]);
  const id = 'upload_uploaded-pdf';
  let uploaded = f.state().resources.find(item => item.id === id);
  assert.ok(uploaded, 'uploaded original and its extracted text must be saved');
  assert.deepEqual(uploaded.pages, extracted.pages); assert.equal(uploaded.pagination, 'pages'); assert.equal(uploaded.analysisStatus, 'needs_text');
  await f.action('resource', id); f.form.values.title = 'Upravený názov'; await f.action('editor-save');
  uploaded = f.state().resources.find(item => item.id === id);
  assert.equal(uploaded.analysisStatus, 'needs_text'); assert.deepEqual(uploaded.pages, extracted.pages);
  await f.action('resource', id); f.form.values.text = 'Opravené nové heslo'; await f.action('editor-save');
  uploaded = f.state().resources.find(item => item.id === id);
  assert.equal(uploaded.text, 'Opravené nové heslo'); assert.equal(uploaded.pagination, 'unpaginated');
  assert.deepEqual(uploaded.pages, [{ number: 1, text: 'Opravené nové heslo' }]);
  f.query('nové heslo'); assert.match(f.results, /<mark>nové heslo<\/mark>/);
  await f.action('source', id);
  assert.equal(f.readerCalls[0][0].text, 'Opravené nové heslo'); assert.equal(f.readerCalls[0][1].query, 'nové heslo');
});
