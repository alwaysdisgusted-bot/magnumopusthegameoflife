'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../server/knowledge-grimoire-model.mjs').default;

function sampleState(text = 'Kognícia a pamäť.') {
  return {
    version: 1,
    tabs: [{ id: 'tab-1', title: 'Kognícia — moja knižnica' }],
    folders: [{ id: 'folder-1', tabId: 'tab-1', parentId: null, title: 'Psychológia', note: 'Poznámky o kognícia' }],
    documents: [{ id: 'document-1', folderId: 'folder-1', fileId: 'document-1', name: 'Zápisky.pdf', mediaType: 'application/pdf', size: 10, addedAt: '2026-10-23T00:00:00.000Z' }],
    textSegments: [{ id: 'segment-1', sourceId: 'document-1', segmentNumber: 0, pageNumber: null, text }],
    favoriteWords: [{ id: 'favorite-1', word: 'Kognícia', normalizedWord: 'kognicia', note: 'Dôležitý pojem' }],
    readingPositions: [{ documentId: 'document-1', pageIndex: 0, scrollFraction: 0.25 }],
    readingMarkers: [],
    wordCollections: [{
      id: 'collection-1', favoriteId: 'favorite-1', kind: 'tab', parentTabId: null,
      title: 'Kognícia', note: 'Výbery', excludedDocumentIds: [], includedDocumentIds: [], uploadFolderId: null,
    }],
    editedTexts: [{ documentId: 'document-1', text: 'Moje upravené znenie' }],
  };
}

test('accepts complete snapshots and searches tab, folder, notes, text, and edited content', () => {
  const state = model.validateState(sampleState());
  assert.deepEqual(state.documents.map(item => item.id), ['document-1']);
  const results = model.searchState(state, 'kognicia');
  assert.ok(results.some(item => item.kind === 'grimoire-tab' && item.id === 'tab-1'));
  assert.ok(results.some(item => item.kind === 'grimoire-folder' && item.text.includes('Poznámky o kognícia')));
  assert.ok(results.some(item => item.kind === 'grimoire-document' && item.text.includes('Kognícia a pamäť.')));
  assert.ok(results.some(item => item.kind === 'grimoire-favorite' && item.text.includes('Dôležitý pojem')));
  assert.ok(results.some(item => item.kind === 'grimoire-collection' && item.id === 'collection-1'));
});

test('search snippets use original UTF-16 offsets after combining marks', () => {
  const state = sampleState(`${'e\u0301'.repeat(600)} Kognícia na konci.`)
  state.tabs[0].title = 'Moja knižnica'
  state.folders[0].note = 'Bez zhody'
  state.editedTexts = []
  const result = model.searchState(state, 'kognicia').find(item => item.kind === 'grimoire-document');
  assert.ok(result);
  assert.match(result.text, /Kognícia na konci/);
});

test('rejects invalid folder relationships, duplicate IDs, and missing document originals', () => {
  const badParent = sampleState();
  badParent.folders[0].tabId = 'missing';
  assert.throws(() => model.validateState(badParent));
  const duplicate = sampleState();
  duplicate.documents[0].id = 'folder-1';
  duplicate.documents[0].fileId = 'folder-1';
  assert.throws(() => model.validateState(duplicate));
  const missingFile = sampleState();
  missingFile.documents[0].fileId = 'different-file';
  assert.throws(() => model.validateState(missingFile));
});

test('rejects stale reading markers and invalid search expressions', () => {
  const state = sampleState();
  state.readingMarkers = [{ documentId: 'document-1', segmentIndex: 0, startOffset: 0, endOffset: 100 }];
  assert.throws(() => model.validateState(state));
  assert.throws(() => model.searchState(sampleState(), '  '), /Zadaj výraz/);
  assert.throws(() => model.searchState(sampleState(), 'x'.repeat(151)), /Zadaj výraz/);
});

test('map references and explicit node links survive validation without original file migration', () => {
  const state = sampleState();
  const docId = 'map_' + 'a'.repeat(64);
  state.documents.push({ ...state.documents[0], id: docId, fileId: docId, mapDocumentId: 'original:one' });
  state.mapLinks = [{ documentId: docId, fieldId: 'psychology', categoryId: 'cognition', term: 'Kognícia' }];
  assert.equal(model.validateState(state).mapLinks.length, 1);
  state.mapLinks.push({ ...state.mapLinks[0] });
  assert.throws(() => model.validateState(state));
  state.mapLinks = [{ ...state.mapLinks[0], documentId: 'not-present' }];
  assert.throws(() => model.validateState(state));
});
