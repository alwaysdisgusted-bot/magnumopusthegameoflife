'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../server/knowledge-model.mjs').default;
const resource = (patch = {}) => ({ id: 'resource-1', sourceKind: 'upload', sourceId: 'document-1', title: '', text: '', assetId: null, mime: 'text/plain', conceptIds: [], manualConceptIds: [], excludedConceptIds: [], analysisStatus: 'needs_text', analyzedAt: 0, updatedAt: 1, pages: [], pagination: 'unpaginated', ...patch });

test('browser and generated server model share an independent validated starting hierarchy', () => {
  const state = M.createState();
  assert.equal(state.concepts.find(item => item.id === 'cognition').parentId, 'psychology');
  assert.deepEqual(M.sephirot.map(item => item.id), ['keter', 'chokhmah', 'binah', 'chesed', 'gevurah', 'tiferet', 'netzach', 'hod', 'yesod', 'malkhut']);
  assert.ok(M.sephirot.every(item => item.name && item.translation && item.meaning));
  assert.ok(M.sephirot.every(item => item.pillar && item.relation && item.scienceLens));
  assert.equal(state.concepts.find(item => item.id === 'psychology').parentId, 'social-sciences');
  assert.equal(state.concepts.find(item => item.id === 'social-sciences').parentId, 'sefirah-tiferet');
  assert.equal(state.concepts.find(item => item.id === 'cognitive-science').parentId, 'cognition');
  const legacy = M.mergeCatalog([{ id: 'psychology', parentId: null, name: 'Psychológia', keywords: [], studyCategoryId: null }]);
  assert.equal(legacy.find(item => item.id === 'psychology').parentId, 'social-sciences');
  assert.ok(legacy.some(item => item.id === 'agricultural-sciences' && item.parentId === 'sefirah-malkhut'));
  assert.ok(M.loreTerms.some(item => item.name === 'Ein Sof' && /nie je jednou z desiatich/.test(item.meaning)));
  assert.ok(M.loreTerms.some(item => item.name === 'Da’at' && /nie je všeobecne jedenástou/.test(item.meaning)));
  assert.ok(M.loreTerms.some(item => item.name === 'Cimcum (Tzimtzum)'));
  assert.ok(M.loreTerms.some(item => item.name === '32 ciest múdrosti' && /22 písmen/.test(item.translation)));
  state.resources.push(resource({ text: 'Súkromná poznámka' }));
  assert.deepEqual(M.validateState(state), state);
  assert.equal(M.createState().resources.length, 0);
  const clean = M.validateState(state); clean.concepts[0].keywords.push('vlastné');
  assert.notDeepEqual(clean, state);
  const sandbox = { module: { exports: {} }, TextEncoder, data: JSON.stringify(state) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/knowledge-model.js'), 'utf8'), sandbox);
  assert.equal(JSON.stringify(vm.runInNewContext('module.exports.validateState(JSON.parse(data))', sandbox)), JSON.stringify(M.validateState(state)));
});

test('classification recognizes Slovak inflections and English synonyms without substring guesses', () => {
  let result = M.analyzeResource(resource({ title: 'Kognitívne procesy', text: 'Cognition a cognitive science skúmajú pamäti a pozornosti. Emóciami súvisí motivácia a učenie.' }), M.createState().concepts);
  for (const id of ['cognition', 'memory', 'attention', 'emotions', 'motivation', 'learning']) assert.ok(result.resource.conceptIds.includes(id), id);
  assert.equal(result.concepts.find(item => item.id === 'memory').parentId, 'cognition');
  result = M.analyzeResource(resource({ title: 'Astronómia a spoločenské vedy', text: 'Fyzika skúma prírodu; psychológia študuje kogníciu.' }), M.createState().concepts);
  for (const id of ['astronomy', 'physics', 'natural-sciences', 'social-sciences', 'psychology', 'cognition']) assert.ok(result.resource.conceptIds.includes(id), id);
  const custom = [{ id: 'ai', name: 'AI', parentId: null, keywords: ['AI', 'poznanie sveta'] }];
  result = M.analyzeResource(resource({ text: 'Mail a krajina; zqxvblorp.', analysisStatus: 'indexed' }), custom);
  assert.deepEqual(result.resource.conceptIds, []);
  assert.equal(result.concepts.length, 1);
  assert.equal(result.resource.analysisStatus, 'indexed');
  assert.equal(M.normalize('KOGNÍCIA —  Pozornosť'), 'kognicia pozornost');
  assert.equal(M.analyzeResource(resource({ text: '' }), []).resource.analysisStatus, 'needs_text');
  assert.equal(M.analyzeResource(resource({ text: 'Čiastočný text PDF', analysisStatus: 'needs_text' }), []).resource.analysisStatus, 'needs_text');
  assert.equal(M.analyzeResource(resource({ text: 'Čiastočný chybný prepis', analysisStatus: 'error' }), []).resource.analysisStatus, 'error');
});

test('reanalysis removes stale automatic links while preserving explicit links and exclusions', () => {
  const concepts = [{ id: 'manual', parentId: null, name: 'Vlastné zaradenie', keywords: [] }, { id: 'keyword', parentId: null, name: 'Téma', keywords: ['ľadovec'] }];
  const first = M.analyzeResource(resource({ text: 'Ľadovec a pamäť', manualConceptIds: ['manual'], conceptIds: ['manual'], excludedConceptIds: ['cognition'] }), concepts.concat(M.createState().concepts));
  assert.ok(first.resource.conceptIds.includes('manual'));
  assert.ok(first.resource.conceptIds.includes('keyword'));
  assert.ok(first.resource.conceptIds.includes('memory'));
  assert.ok(!first.resource.conceptIds.includes('cognition'));
  const changed = first.concepts.map(item => item.id === 'keyword' ? { ...item, keywords: ['vulkán'] } : item);
  const second = M.analyzeResource(first.resource, changed);
  assert.ok(!second.resource.conceptIds.includes('keyword'));
  assert.ok(second.resource.conceptIds.includes('manual'));
  assert.deepEqual(second.resource.manualConceptIds, ['manual']);
  const state = { version: 1, concepts: second.concepts, resources: [second.resource] };
  assert.doesNotThrow(() => M.validateState(state));
});

test('a parent concept lists resources linked anywhere in its descendants once', () => {
  const state = M.createState();
  state.concepts.push({ id: 'memory', name: 'Pamäť', parentId: 'cognition', keywords: [] });
  state.resources.push(resource({ id: 'one', conceptIds: ['memory', 'cognition'] }), resource({ id: 'two', conceptIds: ['psychology'] }), resource({ id: 'three' }));
  assert.deepEqual(M.resourcesUnder(state, 'psychology').map(item => item.id), ['one', 'two']);
  assert.deepEqual(M.resourcesUnder(state, 'cognition').map(item => item.id), ['one']);
  assert.deepEqual(M.resourcesUnder(state, 'missing'), []);
});

test('validation rejects unsafe shapes, URLs, cycles, duplicates and index size limits', () => {
  const state = M.createState(); state.resources.push(resource());
  for (const patch of [{ sourceId: 'https://example.com/a' }, { sourceId: 'data:image/png;base64,a' }, { assetId: '../other' }, { sourceURL: 'https://example.com' }, { text: 'x'.repeat(200001) }, { title: 'x'.repeat(501) }, { conceptIds: ['missing'] }, { conceptIds: ['cognition'], excludedConceptIds: ['cognition'] }, { manualConceptIds: ['psychology'] }, { analyzedAt: Infinity }, { mime: 'text/html' }]) assert.throws(() => M.validateState({ ...state, resources: [resource(patch)] }));
  assert.throws(() => M.validateState({ ...state, concepts: [{ id: 'a', name: 'A', keywords: [], parentId: 'b' }, { id: 'b', name: 'B', keywords: [], parentId: 'a' }] }));
  assert.throws(() => M.validateState({ ...state, resources: [resource(), resource()] }));
  const getter = { ...state }; Object.defineProperty(getter, 'ownerId', { get() { throw new Error('getter must not run'); } });
  assert.throws(() => M.validateState(getter), /Nepovolené/);
  const sparse = []; sparse.length = 1; assert.throws(() => M.validateState({ ...state, resources: sparse }));
  assert.throws(() => M.validateState({ ...state, resources: Array.from({ length: 5001 }, (_, index) => resource({ id: 'r-' + index })) }));
  const large = { ...state, resources: Array.from({ length: 60 }, (_, index) => resource({ id: 'r-' + index, text: 'é'.repeat(200000) })) };
  assert.throws(() => M.validateState(large), /20 MB/);
});

test('page coordinates and study category links preserve exact boundaries and safely default older resources', () => {
  const state = M.createState(); state.concepts[1].studyCategoryId = 'study-category-7';
  state.resources.push(resource({ pagination: 'pages', pages: [{ number: 2, text: 'Prvá uložená strana' }, { number: 17, text: 'Kognícia na skutočnej strane 17.' }] }));
  const clean = M.validateState(state);
  assert.equal(clean.concepts[1].studyCategoryId, 'study-category-7');
  assert.deepEqual(clean.resources[0].pages, state.resources[0].pages);
  const analyzed = M.analyzeResource(clean.resources[0], clean.concepts);
  assert.equal(analyzed.concepts[1].studyCategoryId, 'study-category-7');
  assert.deepEqual(analyzed.resource.pages, clean.resources[0].pages);
  const old = resource(); delete old.pages; delete old.pagination;
  const defaults = M.validateState({ ...state, resources: [old] }).resources[0];
  assert.deepEqual(defaults.pages, []); assert.equal(defaults.pagination, 'unpaginated');
  for (const pages of [[{ number: 0, text: '' }], [{ number: 100001, text: '' }], [{ number: 1, text: '' }, { number: 1, text: '' }], [{ number: 2, text: '' }, { number: 1, text: '' }], [{ number: 1, text: '', url: 'https://other.example' }]]) assert.throws(() => M.validateState({ ...state, resources: [resource({ pages, pagination: 'pages' })] }));
  assert.throws(() => M.validateState({ ...state, concepts: [{ ...state.concepts[0], studyCategoryId: '../other' }] }));
});
