const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const channel = 'magnum-opus-knowledge-bridge';

test('the local launcher prepares storage even when the game is already running', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/start-local.ps1'), 'utf8');
  assert.match(source, /\$prepareStorage = \{[\s\S]*?d1 migrations apply DB --local/);
  const runningBranch = source.slice(source.indexOf('if ($localListener) {'), source.indexOf('$env:CLOUDFLARE_CF_FETCH_ENABLED'));
  assert.match(runningBranch, /& \$buildKnowledge\s+& \$prepareStorage\s+if \(!\$NoOpen\)/);
  const stoppedBranch = source.slice(source.indexOf('$env:CLOUDFLARE_CF_FETCH_ENABLED'));
  assert.match(stoppedBranch, /& \$prepareStorage\s+\$localServer = Start-Process/);
});

test('the local Grimoire calls browser fetch without an invalid instance receiver', async () => {
  const ts = require('typescript-knowledge');
  const source = fs.readFileSync(path.join(root, 'knowledge-app/src/storage/local-grimoire-store.ts'), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const calls = [];
  const exports = {};
  const nativeFetch = function (url, options) {
    'use strict';
    assert.equal(this, undefined, 'fetch must not receive the LocalGrimoireApi instance');
    calls.push({ url, options });
    return Promise.resolve({
      ok: true,
      json: async () => url === '/api/auth/session'
        ? { account: { id: 'synthetic' }, csrf: 'synthetic-csrf', localMode: true }
        : { state: {}, revision: 0, results: [] },
      blob: async () => new Blob(['synthetic']),
    });
  };
  vm.runInNewContext(compiled, {
    exports, require: () => ({}), fetch: nativeFetch, FormData, Blob,
  });
  const api = await exports.LocalGrimoireApi.connect();
  await api.load();
  await api.save(0, {});
  await api.search('synthetic');
  await api.uploadFile('synthetic', new File(['synthetic'], 'synthetic.txt'));
  await api.downloadFile('synthetic');
  await api.deleteFile('synthetic');
  assert.equal(calls.length, 7);
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'));
  assert.ok(calls.filter(call => ['PUT', 'POST', 'DELETE'].includes(call.options.method))
    .every(call => call.options.headers['X-MO-CSRF'] === 'synthetic-csrf'));
});

function fixture() {
  const listeners = new Map();
  const timers = new Map();
  const button = area => ({
    dataset: { libraryArea: area },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const frame = () => {
    const sent = [];
    return {
      src: '',
      sent,
      contentWindow: {
        postMessage(message, targetOrigin) { sent.push({ message, targetOrigin }); },
      },
    };
  };
  const host = { hidden: true, dataset: {} };
  const main = { hidden: false };
  const grimoire = frame();
  const tree = frame();
  const profileMap = frame();
  const contextLabel = { hidden: true, textContent: '' };
  const status = { hidden: true, textContent: '' };
  const elements = new Map([
    ['knowledge-library-host', host],
    ['main', main],
    ['knowledge-library-grimoire-frame', grimoire],
    ['knowledge-library-tree-frame', tree],
    ['knowledge-portal-frame', profileMap],
    ['knowledge-library-context', contextLabel],
    ['knowledge-library-status', status],
  ]);
  const classes = new Set();
  const navigations = [];
  const window = {
    location: { origin: 'http://127.0.0.1:4175' },
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) || []), listener]);
    },
    MOApp: {
      navigate(view) {
        navigations.push(view);
        if (view.startsWith('library/')) {
          window.MOKnowledgeLibrary.syncRoute('#' + view);
          window.MOKnowledgeLibrary.afterRender('library');
        } else window.MOKnowledgeLibrary.afterRender(view);
      },
    },
  };
  const document = {
    body: {
      classList: {
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        remove(name) { classes.delete(name); },
      },
    },
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) {
      return selector === '#knowledge-library-host [data-library-area]'
        ? ['grimoire', 'tree', 'books'].map(button)
        : [];
    },
  };
  const source = fs.readFileSync(path.join(root, 'public/knowledge-library.js'), 'utf8');
  vm.runInNewContext(source, { window, document,
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  window.MOKnowledgeLibrary.syncRoute('#library/grimoire');

  return {
    classes,
    contextLabel,
    document,
    grimoire,
    host,
    main,
    navigations,
    profileMap,
    send(sourceWindow, data, origin = window.location.origin) {
      for (const listener of listeners.get('message') || []) {
        listener({ data, origin, source: sourceWindow });
      }
    },
    status,
    tree,
    timers,
    window,
  };
}

function treeSearch(query = 'Keter') {
  return {
    channel,
    version: 1,
    type: 'search-term',
    query,
    context: { term: query, sefirah: 'Binah', field: 'Vedomie', category: 'Skúmanie' },
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('reading bridge accepts only Grimoire page events and rejects other frames, origins and client reward counts', async () => {
  const app=fixture(),calls=[];
  app.window.MOAuth={recordReadingTurn:async data=>{calls.push(plain(data));return{turns:25,towardsReward:0,awarded:true};}};
  const message={channel,version:2,type:'reading-request',requestId:'11111111-1111-4111-8111-111111111111',
    operation:'turn',data:{eventId:'22222222-2222-4222-8222-222222222222',documentId:'doc',fromPage:1,toPage:2}};
  app.send(app.tree.contentWindow,message);
  app.send(app.grimoire.contentWindow,message,'https://invalid.example');
  app.send(app.grimoire.contentWindow,{...message,data:{...message.data,coins:1}});
  app.send(app.grimoire.contentWindow,{...message,data:{...message.data,toPage:1}});
  assert.equal(calls.length,0);
  app.send(app.grimoire.contentWindow,message);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);
  assert.equal(app.grimoire.sent.at(-1).message.type,'reading-response');
  assert.equal(app.grimoire.sent.at(-1).message.result.awarded,true);
});

test('the Library defaults to its entrance and direct Grimoire links load the local frame', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.syncRoute('#library');

  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'room');
  app.window.MOKnowledgeLibrary.afterRender('library');
  assert.equal(app.host.hidden, true);
  assert.equal(app.main.hidden, false);
  assert.equal(app.grimoire.src, '');
  app.window.MOKnowledgeLibrary.syncRoute('#library/grimoire');
  app.window.MOKnowledgeLibrary.afterRender('library');

  assert.equal(app.host.hidden, false);
  assert.equal(app.main.hidden, true);
  assert.equal(app.grimoire.src, '/knowledge/index.html?entry=local-game-2');
  assert.equal(app.tree.src, '');
  assert.equal(app.classes.has('knowledge-library-open'), true);
});

test('library deep links restore room, books and both retained frames without changing source state', () => {
  const app = fixture(), library = app.window.MOKnowledgeLibrary;
  for (const area of ['grimoire','tree','books']) {
    library.syncRoute('#library/' + area); library.afterRender('library');
    assert.equal(library.mode(), area);
    assert.equal(app.host.hidden, area === 'books');
    assert.equal(app.main.hidden, area !== 'books');
  }
  const sources = [app.grimoire.src, app.tree.src];
  library.syncRoute('#library'); library.afterRender('library');
  assert.equal(library.mode(), 'room');
  assert.equal(app.host.hidden, true);
  assert.equal(app.main.hidden, false);
  assert.deepEqual([app.grimoire.src, app.tree.src], sources);
  library.syncRoute('#library/unknown');
  assert.equal(library.mode(), 'room');
  library.openSearch('psychology');
  assert.equal(app.navigations.at(-1), 'library/grimoire');
  assert.equal(library.mode(), 'grimoire');
  assert.deepEqual([app.grimoire.src, app.tree.src], sources);
});

function documentRequest(operation = 'catalog', documentId = '', node = null) {
  return { channel, version: 2, type: 'document-request', requestId: 'request-1', operation, documentId, node };
}

test('unified search starts at three letters and limits matches to document content, folders and terminology', () => {
  const ts = require('typescript-knowledge'), modules = new Map();
  function load(relative) {
    const filename = path.join(root, 'knowledge-app/src', `${relative}.ts`);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    modules.set(filename, exports);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, { exports, require: name => load(path.relative(
      path.join(root, 'knowledge-app/src'), path.resolve(path.dirname(filename), name))) });
    return exports;
  }
  const sources = {
    listSources: () => ['one', 'two'].map(id => ({ id, title: 'same.txt', kind: 'document', createdAt: '' })),
    listTextSegments: () => [
      { id: 's1', sourceId: 'one', text: 'Kognícia, KOGNÍCIA. kognitívna.', pageNumber: 7 },
      { id: 's2', sourceId: 'two', text: 'kognicia a pamäť' },
    ],
  };
  const grimoire = {
    listTabs: () => [{ id: 'tab', title: 'Synthetic' }],
    listFolders: () => [{ id: 'folder', title: 'Folder', note: 'Kognícia a pamäť' }],
    listDocuments: () => ['one', 'two', 'three'].map(id => ({ id, name: 'same.txt' })),
  };
  const nodes = [{ id: 'node', fieldId: 'field', categoryId: 'category', term: 'Kognícia', title: 'Psychológia', description: '' }];
  const search = load('search/search-service').searchLibrary;
  const result = plain(search('kognicia', sources, grimoire, nodes, ['synthetic missing source']));
  assert.deepEqual(result.documents.map(item => item.documentId), ['one', 'two']);
  assert.equal(result.documents[0].occurrences, 2);
  assert.equal(result.documents[0].occurrence.startOffset, 0);
  assert.equal(result.documents[0].occurrence.endOffset, 8);
  assert.equal(result.documents[0].occurrence.pageNumber, 7);
  assert.equal(result.nodes.length, 1);
  assert.deepEqual(result.errors, ['synthetic missing source']);
  assert.equal(search('kognic', sources, grimoire, nodes).documents.length, 2);
  const prefixSources = {
    listSources: () => [{id:'psy',title:'synthetic.txt',kind:'document',createdAt:''}],
    listTextSegments: () => [{id:'psy-page',sourceId:'psy',pageNumber:4,
      text:'Psychológie, psycho-logiky a PSYCHOLÓGIA. Nezhoda: biopsychológia.'}],
  };
  const prefixes = search('psy', prefixSources, grimoire, []);
  assert.equal(prefixes.documents[0].occurrences, 4);
  assert.equal(search('psychol', prefixSources, grimoire, []).documents[0].occurrences, 3);
  assert.equal(search('psycholo', prefixSources, grimoire, []).documents[0].occurrences, 3);
  assert.equal(search('psychologix', prefixSources, grimoire, []).documents.length, 0);
  assert.equal(search('log', prefixSources, grimoire, []).documents[0].occurrences, 4);
  assert.equal(search('logik', prefixSources, grimoire, []).documents[0].occurrences, 1);
  assert.equal(prefixes.documents[0].occurrence.pageNumber, 4);
  assert.equal(prefixes.documents[0].occurrence.startOffset, 0);
  assert.equal(prefixes.documents[0].occurrence.endOffset, 3);
  assert.equal(search('kognicia a pamat', sources, grimoire, nodes).documents[0].documentId, 'two');
  for (const query of ['', 'ko', 'k12']) {
    const result = search(query, sources, grimoire, nodes);
    assert.equal(result.documents.length + result.nodes.length + result.sources.length, 0);
  }
  assert.equal(search('same', sources, grimoire, nodes).documents.length, 0, 'filename is not document content');
  assert.equal(search('Psychológia', sources, grimoire, nodes).nodes.length, 0, 'branch title is not terminology');
  assert.equal(search('kognicia', sources, grimoire, nodes, [], [
    {kind:'book',id:'game-book',title:'Kognícia',snippet:'Kognícia',url:'/#books'},
  ]).sources.length, 0, 'unrelated game records excluded');
  const destinations = load('search/destination-search').searchDestinations;
  const folders = [{id:'folder',tabId:'tab',parentId:null,title:'Kognícia'}];
  assert.equal(destinations('ko', [], folders).length, 0);
  assert.equal(destinations('kognic', [], folders).length, 1);
  assert.equal(destinations('kognicia', [{id:'tab',title:'Kognícia'}], folders).length, 1);
});

test('unified query and exact-document search requests use only trusted frame endpoints', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  const query = { channel, version: 2, type: 'query-changed', query: 'Kognícia' };
  app.send({}, query); app.send(app.tree.contentWindow, query);
  assert.equal(app.tree.sent.length, 0);
  app.send(app.grimoire.contentWindow, query);
  assert.equal(app.tree.sent[0].message.query, 'Kognícia');
  assert.equal(app.profileMap.sent[0].message.query, 'Kognícia');
  const request = { channel, version: 2, type: 'search-request', requestId: 'shared-search',
    operation: 'open-search', documentId: 'doc-2', query: 'Kognícia' };
  app.send(app.tree.contentWindow, { ...request, token: 'invalid' });
  app.send(app.tree.contentWindow, request, 'https://invalid.example');
  assert.equal(app.timers.size, 0);
  app.send(app.tree.contentWindow, request);
  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });
  assert.deepEqual(plain(app.grimoire.sent[0].message), request);
});

test('map document result shows its page and opens the exact Grimoire search match without rewards', async () => {
  function element() {
    return {
      children: [], listeners: {}, classList: { add() {} }, dataset: {}, disabled: false,
      append(...items) { this.children.push(...items); },
      replaceChildren() { this.children = []; },
      setAttribute() {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
    };
  }
  const panel = element(), calls = [];
  const source = fs.readFileSync(path.join(root, 'public/knowledge-system/app.js'), 'utf8');
  const rendering = source.slice(source.indexOf('function renderUnifiedResults(query)'), source.indexOf('\nfunction mapNode()'));
  const context = {
    document: { querySelector: () => panel, createElement: element },
    unifiedError: '',
    unifiedResult: { query: 'logik', documents: [
      {documentId:'doc-exact',title:'Synthetic.pdf',excerpt:'Psycho-lógika LOGIKA <img src=x onerror=alert(1)>',occurrences:2,occurrence:{pageNumber:7}},
    ], nodes: [], sources: [], errors: [] },
    requestGrimoire: async (...args) => { calls.push(args); },
    storageMessage: message => { throw Error(message); },
  };
  const highlighting = [
    source.match(/^const normalize = .*$/m)[0],
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('\nfunction authorsFor(')),
    source.slice(source.indexOf('function normalizedTextWithOffsets('), source.indexOf('\nfunction pagesForText(')),
    source.slice(source.indexOf('function highlightedGameText('), source.indexOf('\nfunction renderGameResults(')),
  ].join('\n');
  vm.runInNewContext(highlighting + rendering + '\nrenderUnifiedResults("logik");', context);
  const button = panel.children.find(item => item.dataset?.grimoireResult === 'doc-exact');
  assert.ok(button);
  assert.match(button.children[2].textContent, /2 výskytov · Strana 7 · Otvoriť v Grimoári/);
  assert.equal(button.children[3].innerHTML, 'Psycho-<mark>lógik</mark>a <mark>LOGIK</mark>A &lt;img src=x onerror=alert(1)&gt;');
  await button.listeners.click();
  assert.deepEqual(calls, [['open-search','doc-exact',null,'logik']]);
  assert.equal(button.disabled, false);
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.window.MOKnowledgeLibrary.handleAction('library-area', {dataset:{libraryArea:'tree'}});
  app.send(app.tree.contentWindow, {channel,version:2,type:'search-request',requestId:'map-result',
    operation:'open-search',documentId:'doc-exact',query:'logik'});
  app.send(app.grimoire.contentWindow, {channel,version:1,type:'ready'});
  app.send(app.grimoire.contentWindow, {channel,version:2,type:'document-response',requestId:'map-result',
    ok:true,error:'',result:{}});
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire');
  assert.equal(app.grimoire.sent[0].message.query, 'logik');
  const reader = fs.readFileSync(path.join(root, 'knowledge-app/src/ui/search-screen.ts'), 'utf8');
  const openReader = reader.slice(reader.indexOf('  function openReader('), reader.indexOf('  function renderReaderVersion('));
  const modeStart = openReader.indexOf('    if (occurrence) {');
  const modeChange = openReader.slice(modeStart, openReader.indexOf('    positionFeedback.textContent', modeStart));
  const pressed = {}, reading = {
    occurrence: {segmentId:'page-7'}, pagedReading:true, foundPage:6, saved:undefined,
    scrollModeButton: {setAttribute: (key,value) => { pressed.scroll=value; }},
    pagedModeButton: {setAttribute: (key,value) => { pressed.paged=value; }},
    applyReadingLayout: position => { pressed.position=plain(position); },
  };
  vm.runInNewContext(modeChange, reading);
  assert.equal(reading.pagedReading, false);
  assert.deepEqual(pressed, {scroll:'true',paged:'false',position:{pageIndex:6,scrollFraction:0}});
  assert.match(openReader, /selectedMark\?\.scrollIntoView\(\{ behavior: 'auto', block: 'center' \}\)/);
  assert.match(openReader, /resetScrollReadingTracking\(\)/);
  assert.doesNotMatch(openReader, /confirmReadingTurn\(|readingReward\(/);
});

test('map node navigation waits for map readiness and acknowledgement instead of opening a search-only page', () => {
  const app = fixture(), node = { fieldId: 'field', categoryId: 'category', term: 'Term' };
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.grimoire.contentWindow, { channel, version: 2, type: 'open-map-node', node });
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'tree');
  app.send(app.tree.contentWindow, { channel, version: 2, type: 'map-ready' });
  const delivered = app.tree.sent.map(item => item.message.type);
  assert.ok(delivered.indexOf('query-changed') < delivered.indexOf('open-map-node'));
  app.send(app.tree.contentWindow, { channel, version: 2, type: 'node-response', node, ok: true, error: '' });
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'tree');
  assert.equal(app.timers.size, 0);
  app.send(app.grimoire.contentWindow, { channel, version: 2, type: 'open-map-node', node });
  app.window.MOKnowledgeLibrary.handleAction('library-area', {dataset:{libraryArea:'grimoire'}});
  app.send(app.tree.contentWindow, {channel,version:2,type:'node-response',node,ok:true,error:''});
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire', 'late acknowledgement cannot override newer navigation');
});

test('document requests wait for Grimoire readiness and exact-ID open switches only on acknowledgement', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'tree' } });
  app.send(app.tree.contentWindow, documentRequest('open', 'document-2'));
  assert.equal(app.grimoire.sent.length, 0);
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'tree');
  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });
  assert.equal(app.grimoire.sent[0].message.documentId, 'document-2');
  app.send(app.grimoire.contentWindow, {
    channel, version: 2, type: 'document-response', requestId: 'request-1', ok: true, error: '', result: {},
  });
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire');
  assert.equal(app.tree.sent.length, 1);
  assert.equal(app.timers.size, 0);
});

test('document protocol rejects foreign frames, malformed node context, and extra payload keys', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send({}, documentRequest());
  app.send(app.tree.contentWindow, documentRequest(), 'https://invalid.example');
  app.send(app.tree.contentWindow, { ...documentRequest(), token: 'must-not-cross' });
  app.send(app.tree.contentWindow, documentRequest('link', 'document-1', { fieldId: 'field', categoryId: 'category', term: 'Term', extra: true }));
  assert.equal(app.timers.size, 0);
  assert.equal(app.grimoire.sent.length, 0);
});

test('document bridge reports timeouts and failures without claiming navigation succeeded', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'tree' } });
  app.send(app.tree.contentWindow, documentRequest('open-map', 'map-original'));
  [...app.timers.values()][0]();
  assert.equal(app.tree.sent[0].message.ok, false);
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'tree');
});

test('a newer host navigation cancels an in-flight document open and ignores its late acknowledgement', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'tree' } });
  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });
  app.send(app.tree.contentWindow, documentRequest('open', 'document-2'));
  app.window.MOKnowledgeLibrary.afterRender('gym');
  assert.equal(app.tree.sent[0].message.ok, false);
  assert.equal(app.grimoire.sent[1].message.type, 'document-cancel');
  app.send(app.grimoire.contentWindow, {
    channel, version: 2, type: 'document-response', requestId: 'request-1', ok: true, error: '', result: {},
  });
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'tree');
  assert.equal(app.tree.sent.length, 1);
});

test('map originals are adapted without upload, duplicate names stay distinct, and unlink preserves documents', async () => {
  const ts = require('typescript-knowledge');
  const model = require('../server/knowledge-grimoire-model.mjs').default;
  const source = fs.readFileSync(path.join(root, 'knowledge-app/src/storage/local-grimoire-store.ts'), 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => ({}), crypto: require('node:crypto').webcrypto, TextEncoder, Blob, FormData });
  let revision = 0, persisted = model.createState(), uploads = 0;
  const fetcher = async (url, options) => {
    if (url === '/api/auth/session') return { ok: true, json: async () => ({ account: { id: 'owner-A' }, csrf: 'csrf-A', localMode: true }) };
    if (options.method === 'POST') uploads++;
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      assert.equal(body.expectedRevision, revision);
      persisted = model.validateState(body.state); revision++;
      return { ok: true, json: async () => ({ revision }) };
    }
    return { ok: true, json: async () => ({ state: JSON.parse(JSON.stringify(persisted)), revision, updatedAt: null }) };
  };
  const mapDocuments = ['map-one', 'map-two'].map(id => ({
    id, name: 'same.txt', size: 3, mime: 'text/plain', text: id,
    pages: [{ number: 1, text: id }], blob: new Blob(['abc'], { type: 'text/plain' }),
  }));
  const mapStore = { getDocuments: async () => mapDocuments };
  const api = await exports.LocalGrimoireApi.connect(fetcher);
  const database = await exports.LocalGrimoireDatabase.load(api);
  await database.syncMapDocuments(mapStore);
  assert.equal(persisted.documents.length, 2);
  assert.notEqual(persisted.documents[0].id, persisted.documents[1].id);
  assert.equal(uploads, 0);
  assert.equal(persisted.mapLinks.length, 0);
  const afterSync = revision;
  await database.syncMapDocuments(mapStore);
  assert.equal(revision, afterSync);
  const marker = { segmentIndex: 0, startOffset: 0, endOffset: 3 };
  await new exports.LocalReadingMarkerStore(database).set(persisted.documents[0].id, marker);
  mapDocuments[0].name = 'renamed.txt';
  await database.syncMapDocuments(mapStore);
  assert.deepEqual(plain(await new exports.LocalReadingMarkerStore(database).get(persisted.documents[0].id)), marker);
  const link = { documentId: persisted.documents[0].id, fieldId: 'psychology', categoryId: 'cognition', term: 'Term' };
  await database.setMapLink(link, true);
  await database.setMapLink(link, true);
  assert.equal(persisted.mapLinks.length, 1);
  const reloaded = await exports.LocalGrimoireDatabase.load(api);
  assert.equal(reloaded.read().mapLinks.length, 1);
  await reloaded.setMapLink(link, false);
  assert.equal(persisted.mapLinks.length, 0);
  assert.equal(persisted.documents.length, 2);
  assert.equal(mapDocuments.length, 2);
  const store = new exports.LocalGrimoireStore(reloaded, mapStore);
  assert.equal(await (await store.downloadDocument(link.documentId)).text(), 'abc');
  const term = {id:'term-child',fieldId:'psychology',categoryId:'cognition',term:'Child',
    folderPath:[{key:'root',title:'Root'},{key:'parent',title:'Parent'},{key:'term-child',title:'Child'}]};
  await reloaded.organizeTermDocuments(term,[]);
  assert.equal(persisted.folders.filter(item => item.id.startsWith('tree_')).length,0);
  await reloaded.organizeTermDocuments(term,['map-one']);
  const firstPath = persisted.folders.filter(item => item.id.startsWith('tree_'));
  assert.deepEqual(firstPath.map(item => item.title),['Root','Parent','Child']);
  assert.equal(firstPath[1].parentId,firstPath[0].id);
  assert.equal(firstPath[2].parentId,firstPath[1].id);
  assert.equal(persisted.documents[0].folderId,firstPath[2].id);
  await reloaded.organizeTermDocuments(term,['map-one']);
  assert.equal(persisted.folders.filter(item => item.id.startsWith('tree_')).length,3);
  assert.equal(persisted.mapLinks.length,1);
  await assert.rejects(reloaded.organizeTermDocuments(term,['not-owned']),/katalógu/);
  assert.equal(persisted.documents.length,2);
  const reopened = await exports.LocalGrimoireDatabase.load(api);
  assert.equal(reopened.read().documents[0].folderId,firstPath[2].id);
  await reopened.organizeTermDocuments({...term,id:'other',term:'Other',folderPath:[{key:'root',title:'Root'},{key:'other',title:'Other'}]},['map-one']);
  const other = persisted.folders.find(item => item.title === 'Other');
  assert.equal(new exports.LocalGrimoireStore(reopened,mapStore).listDocuments(other.id)[0].id,persisted.documents[0].id);
  assert.equal(persisted.documents[0].folderId,firstPath[2].id);
  assert.equal(persisted.documents.length,2);
  assert.deepEqual(model.terminologySources(persisted,{documentIds:[],folderIds:[other.id],collectionIds:[]}),[persisted.documents[0].id]);
  const renamed = {...term,folderPath:term.folderPath.map(item => item.key === 'parent' ? {...item,title:'Renamed parent'} : item)};
  await reopened.organizeTermDocuments(renamed,[]);
  assert.equal(persisted.folders.find(item => item.id === firstPath[1].id).title,'Renamed parent');
  assert.equal(uploads,0);
});

test('legacy word collections retain their identity and serialize only server-supported fields after moving to the tree', async () => {
  const ts=require('typescript-knowledge'), model=require('../server/knowledge-grimoire-model.mjs').default, exports={};
  const source=fs.readFileSync(path.join(root,'knowledge-app/src/storage/local-grimoire-store.ts'),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:()=>({validateNote:note=>assert.ok(note.length<=500)}),crypto:require('node:crypto').webcrypto,FormData,Blob});
  let persisted=model.createState(),revision=0;
  persisted.favoriteWords.push({id:'legacy',word:'Poznanie',normalizedWord:'poznanie',note:'Pôvodný text'});
  persisted.tabs.push({id:'tab',title:'Knižnica'});
  const fetcher=async(url,options)=>{
    if(url==='/api/auth/session')return {ok:true,json:async()=>({account:{id:'owner'},csrf:'csrf',localMode:true})};
    if(options.method==='PUT'){
      const body=JSON.parse(options.body);assert.equal(body.expectedRevision,revision);
      persisted=model.validateState(body.state);revision++;
      return {ok:true,json:async()=>({revision})};
    }
    return {ok:true,json:async()=>({state:plain(persisted),revision})};
  };
  const api=await exports.LocalGrimoireApi.connect(fetcher),db=await exports.LocalGrimoireDatabase.load(api);
  const store=new exports.LocalWordCollectionStore(db);
  const created=await store.create(persisted.favoriteWords[0],'tab');
  assert.equal('word' in persisted.wordCollections[0],false);
  assert.equal(created.word,'Poznanie');
  assert.equal((await store.create(persisted.favoriteWords[0],'tab')).id,created.id);
  await store.saveDetails(created.id,'Nový názov','Poznámka kolekcie');
  const loaded=new exports.LocalWordCollectionStore(await exports.LocalGrimoireDatabase.load(api)).list()[0];
  assert.equal(loaded.id,created.id);assert.equal(loaded.word,'Poznanie');assert.equal(loaded.title,'Nový názov');
  assert.equal(persisted.favoriteWords[0].note,'Pôvodný text');
});

test('terminology bridge allows only trusted frames and whitelisted bounded operations without accepting reward counts', async () => {
  const app=fixture(),calls=[];
  app.window.MOAuth={api:async()=>({terms:[]}),mutateTerminology:async body=>{calls.push(plain(body));return {awarded:false};}};
  const message={channel,version:2,type:'terminology-request',requestId:'term-request',operation:'create',data:{
    creationKey:'11111111-1111-4111-8111-111111111111',details:{
      fieldId:'social-sciences',categoryId:'psychology-cognition',term:'Vlastný termín',description:'Popis',note:'',
      documentIds:[],folderIds:[],collectionIds:[]}}};
  app.send({},message);app.send(app.tree.contentWindow,message,'https://invalid.example');
  app.send(app.tree.contentWindow,{...message,data:{...message.data,details:{...message.data.details,sourceCount:3}}});
  app.send(app.tree.contentWindow,{...message,operation:'delete-everything'});
  assert.equal(calls.length,0);
  app.send(app.tree.contentWindow,message);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].operation,'create');
  assert.equal(app.tree.sent.at(-1).message.ok,true);
  app.send(app.grimoire.contentWindow,{channel,version:1,type:'ready'});
  const legacy={channel,version:2,type:'terminology-request',requestId:'legacy-request',operation:'legacy-note',data:{id:'favorite',note:'Zachovaná poznámka'}};
  app.send(app.tree.contentWindow,legacy);
  assert.equal(app.grimoire.sent.at(-1).message.operation,'legacy-note');
  app.send(app.tree.contentWindow,{...message,requestId:'child-request',data:{...message.data,
    details:{...message.data.details,parent:{termId:'parent-term'}}}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls.at(-1).details.parent,{termId:'parent-term'});
  const folder = {...message,requestId:'folder-request',operation:'term-folder',data:{id:'parent-term',mapDocumentIds:['document-abc']}};
  app.send(app.tree.contentWindow,folder);
  assert.equal(app.grimoire.sent.at(-1).message.operation,'term-folder');
  const count = app.grimoire.sent.length;
  app.send(app.tree.contentWindow,{...folder,requestId:'invalid-folder',data:{...folder.data,mapDocumentIds:['../../foreign']}});
  assert.equal(app.grimoire.sent.length,count);
});

test('Grimoire favorites UI and handlers are removed while local storage adapters remain available to the tree', () => {
  const screen=fs.readFileSync(path.join(root,'knowledge-app/src/ui/search-screen.ts'),'utf8');
  assert.doesNotMatch(screen,/show-favorites|favorite-query|reader-favorite-marker|openFavorites|favoriteStore\.add/);
  const main=fs.readFileSync(path.join(root,'knowledge-app/src/main.ts'),'utf8');
  assert.match(main,/handleLegacyRequest/);
  assert.match(main,/new LocalFavoriteWordStore/);
  assert.doesNotMatch(main,/wordCollectionStore:\s*new LocalWordCollectionStore/);
});

test('Grimoire is dark from initial HTML through startup and has no theme switch', () => {
  const html = fs.readFileSync(path.join(root, 'knowledge-app/index.html'), 'utf8');
  const screen = fs.readFileSync(path.join(root, 'knowledge-app/src/ui/search-screen.ts'), 'utf8');
  assert.match(html, /<html[^>]*data-theme="dark"/);
  assert.match(html, /id="app" data-theme="dark"/);
  assert.doesNotMatch(screen, /theme-toggle|themeToggle|updateTheme/);
});

test('the tree and legacy books remain available without destroying loaded frames', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.syncRoute('#library/grimoire');
  app.window.MOKnowledgeLibrary.afterRender('library');

  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'tree' } });
  const treeSource = app.tree.src;
  const grimoireSource = app.grimoire.src;
  assert.equal(treeSource, '/knowledge-system/index.html?embed=1');
  assert.equal(app.host.dataset.mode, 'tree');
  assert.equal(app.main.hidden, true);

  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'books' } });
  assert.equal(app.host.hidden, true);
  assert.equal(app.main.hidden, false);
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'books');

  app.window.MOKnowledgeLibrary.handleAction('library-area', { dataset: { libraryArea: 'grimoire' } });
  assert.equal(app.grimoire.src, grimoireSource);
  assert.equal(app.tree.src, treeSource);
  assert.equal(app.host.hidden, false);
  assert.equal(app.main.hidden, true);
  assert.equal(app.classes.has('knowledge-library-books'), false);
  app.window.MOKnowledgeLibrary.afterRender('gym');
  assert.equal(app.host.hidden, true);
  assert.equal(app.main.hidden, false);
  assert.equal(app.classes.has('knowledge-library-books'), false);
});

test('a selected tree term is relayed only after the Grimoire announces readiness', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.tree.contentWindow, treeSearch());

  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire');
  assert.equal(app.grimoire.sent.length, 0);
  assert.equal(app.status.hidden, false);
  assert.equal(app.contextLabel.hidden, false);
  assert.match(app.contextLabel.textContent, /Keter.*Binah.*Vedomie.*Skúmanie/);

  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });

  assert.equal(app.grimoire.sent.length, 1);
  assert.deepEqual(plain(app.grimoire.sent[0].message), {
    channel, version: 1, type: 'search', query: 'Keter',
  });
  assert.equal(app.grimoire.sent[0].targetOrigin, 'http://127.0.0.1:4175');
  assert.equal(app.status.hidden, true);
});

test('a pending tree search survives navigation until Grimoire becomes ready', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.tree.contentWindow, treeSearch('Tiferet'));
  app.window.MOKnowledgeLibrary.afterRender('gym');

  assert.equal(app.host.hidden, true);
  assert.equal(app.status.hidden, false);
  assert.equal(app.grimoire.sent.length, 0);

  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });

  assert.equal(app.grimoire.sent.length, 1);
  assert.equal(app.grimoire.sent[0].message.query, 'Tiferet');
});

test('bridge messages from other origins or unrelated frames are ignored', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.tree.contentWindow, treeSearch(), 'https://example.invalid');
  app.send({}, treeSearch());

  assert.deepEqual(app.navigations, []);
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire');
  assert.equal(app.contextLabel.hidden, true);
});

test('bridge payloads reject extra keys, whitespace changes, and oversized terms', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  const extra = { ...treeSearch(), document: 'must not cross the bridge' };
  const padded = treeSearch(' Keter ');
  const tooLong = treeSearch('x'.repeat(151));

  for (const payload of [extra, padded, tooLong]) app.send(app.tree.contentWindow, payload);

  assert.deepEqual(app.navigations, []);
  assert.equal(app.window.MOKnowledgeLibrary.mode(), 'grimoire');
  assert.equal(app.grimoire.sent.length, 0);
});

test('context is rendered as text and is not included in the Grimoire message', () => {
  const app = fixture();
  app.window.MOKnowledgeLibrary.afterRender('library');
  app.send(app.tree.contentWindow, treeSearch('<img src=x>'));
  app.send(app.grimoire.contentWindow, { channel, version: 1, type: 'ready' });

  assert.match(app.contextLabel.textContent, /<img src=x>/);
  assert.deepEqual(plain(app.grimoire.sent[0].message), {
    channel, version: 1, type: 'search', query: '<img src=x>',
  });
  assert.equal(Object.hasOwn(app.grimoire.sent[0].message, 'context'), false);
});

test('the Grimoire accepts only the parent search protocol and sends ready to that parent', () => {
  const source = fs.readFileSync(path.join(root, 'knowledge-app/src/main.ts'), 'utf8');

  assert.match(source, /event\.origin !== window\.location\.origin \|\| event\.source !== window\.parent/);
  assert.match(source, /hasExactKeys\(message, \['channel', 'version', 'type', 'query'\]\)/);
  assert.match(source, /type: 'ready'/);
  assert.match(source, /input\.value = message\.query/);
});

test('the Grimoire uses the game account with no Supabase client, login, or import path', () => {
  const source = fs.readFileSync(path.join(root, 'knowledge-app/src/main.ts'), 'utf8');
  const searchScreen = fs.readFileSync(path.join(root, 'knowledge-app/src/ui/search-screen.ts'), 'utf8');
  const localStore = fs.readFileSync(path.join(root, 'knowledge-app/src/storage/local-grimoire-store.ts'), 'utf8');
  const vite = fs.readFileSync(path.join(root, 'knowledge-app/vite.config.ts'), 'utf8');

  assert.match(source, /LocalGrimoireApi\.connect\(\)/);
  assert.match(source, /LocalGrimoireDatabase\.load\(api\)/);
  assert.doesNotMatch(source, /supabase|legacy-import|onImportLegacy/i);
  assert.match(localStore, /\/api\/knowledge\/grimoire/);
  assert.doesNotMatch(searchScreen, /supabase|legacy-import|onImportLegacy/i);
  assert.match(searchScreen, /import\.meta\.env\.BASE_URL.*magnum-opus-logo\.png/);
  assert.match(vite, /envDir:\s*false/);
  assert.match(vite, /envPrefix:\s*\[\]/);
  assert.doesNotMatch(vite, /VITE_MO_KNOWLEDGE_SUPABASE/);
});

test('profile search can open local Grimoire results without copying their text into the map', () => {
  const search = fs.readFileSync(path.join(root, 'public/knowledge-game-search.js'), 'utf8');
  const navigation = fs.readFileSync(path.join(root, 'public/knowledge-source-navigation.js'), 'utf8');
  const library = fs.readFileSync(path.join(root, 'public/knowledge-library.js'), 'utf8');

  assert.match(search, /\/api\/knowledge\/grimoire\/search\?q=/);
  assert.match(search, /grimoire-document/);
  assert.match(navigation, /'grimoire-document':'library'/);
  assert.match(navigation, /MOKnowledgeLibrary\?\.openSearch\(entry\.query\)/);
  assert.match(library, /function openSearch\(query\)/);
  assert.match(library, /type: 'search', query: pendingSearch/);
});

test('the host keeps the old books area and embedded tree as explicit secondary views', () => {
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const tree = fs.readFileSync(path.join(root, 'public/knowledge-system/app.js'), 'utf8');

  assert.ok(html.indexOf('</main>') < html.indexOf('id="knowledge-library-host"'));
  assert.match(html, /data-library-area="books"[^>]*>Knihy a fotografie/);
  assert.match(app, /if\(window\.MOKnowledgeLibrary\.mode\(\)!=='books'\)/);
  assert.match(app, /window\.MOLibraryCategories\.render\(\)/);
  assert.match(tree, /type:'search-term', query:selectedTerm\.term/);
});
