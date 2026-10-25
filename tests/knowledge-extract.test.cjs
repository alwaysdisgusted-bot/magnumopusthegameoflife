'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { zipSync, strToU8 } = require('fflate');
const source = fs.readFileSync(path.join(__dirname, '../public/knowledge-extract.js'), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const file = (name, value, type = '') => new File([value], name, { type });

function fixture(extra = {}) {
  const window = {
    location: new URL('http://127.0.0.1:4175/'), URL, Blob, TextDecoder, AbortController, setTimeout, clearTimeout,
    MOPhotoOCR: { cancel: () => Promise.resolve(), resize: async () => 'data:image/jpeg;base64,YQ==', recognize: async () => 'Text z obrázka' },
    fetch: async () => { throw new Error('Unexpected network request'); }, ...extra,
  };
  vm.runInNewContext(source, { window, Uint8Array, DataView, Map, console });
  return window.MOKnowledgeExtract;
}

test('plain text and Markdown preserve Unicode and accept UTF-16 with BOM', async () => {
  const helper = fixture();
  const progress = [];
  const text = await helper.extract(file('poznamka.txt', '  Žltý kôň\r\nDruhý riadok  '), message => progress.push(message));
  assert.equal(text.text, 'Žltý kôň\nDruhý riadok');
  assert.equal(text.mime, 'text/plain');
  assert.equal(text.status, 'indexed');
  assert.equal(text.warning, '');
  assert.ok(progress.every(message => typeof message === 'string'));
  const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from('# Čitateľný nadpis', 'utf16le')]);
  const markdown = await helper.extract(file('poznamka.md', utf16));
  assert.equal(markdown.text, '# Čitateľný nadpis');
  assert.equal(markdown.mime, 'text/markdown');
  assert.equal(markdown.status, 'indexed');
});

test('text limits are explicit and invalid or oversized inputs are rejected', async () => {
  const helper = fixture();
  const limited = await helper.extract(file('dlhy.txt', 'a'.repeat(199999) + '🦉' + ' koniec'));
  assert.equal(limited.text.length, 199999);
  assert.equal(limited.status, 'needs_text');
  assert.match(limited.warning, /200 000.*skrátený/);
  assert.equal((await helper.extract(file('prazdny.txt', '  '))).status, 'needs_text');
  await assert.rejects(helper.extract({ name: 'obrovsky.txt', size: 15 * 1024 * 1024 + 1, arrayBuffer() { throw new Error('Must not read'); } }), /15 MB/);
  await assert.rejects(helper.extract(file('cudzie.exe', 'text')), /PDF.*DOCX.*TXT/);
  await assert.rejects(helper.extract(file('binarne.txt', new Uint8Array([97, 0, 98]))), /platný text/);
  await assert.rejects(helper.extract(file('nespravne.png', 'not an image')), /poškodená/);
});

test('DOCX bounds all ZIP entries before extraction and validates extracted text integrity', async () => {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  function node(namespaceURI, localName, ownText = '', childNodes = []) {
    const value = { namespaceURI, localName, childNodes, get textContent() { return ownText + this.childNodes.map(child => child.textContent).join(''); } };
    childNodes.forEach(child => { child.remove = () => { value.childNodes = value.childNodes.filter(item => item !== child); }; });
    return value;
  }
  class Parser {
    parseFromString() {
      const paragraph = node(ns, 'p', '', [node(ns, 't', 'Bezpečný text'), node(ns, 'br'), node('http://www.w3.org/1999/xhtml', 'script', '', [node(ns, 't', 'Nesmie sa objaviť')]), node(ns, 't', 'Ďalší riadok')]);
      const documentElement = node(ns, 'document', '', [paragraph]);
      function all() { const result = []; (function visit(item) { result.push(item); item.childNodes.forEach(visit); })(documentElement); return result; }
      return { documentElement, getElementsByTagName: name => all().filter(item => name === '*' || item.localName === name), getElementsByTagNameNS: (namespace, name) => all().filter(item => (namespace === '*' || item.namespaceURI === namespace) && item.localName === name) };
    }
  }
  let unpacked = 0;
  const fflate = require('fflate');
  const helper = fixture({ DOMParser: Parser, fflate: { unzipSync(...args) { unpacked += 1; return fflate.unzipSync(...args); } } });
  const parts = { '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document xmlns:w="' + ns + '"><w:p><w:t>Bezpečný text</w:t><w:br/><w:t>Ďalší riadok</w:t></w:p></w:document>') };
  const bytes = zipSync(parts, { level: 0 });
  const answer = await helper.extract(file('poznamka.docx', bytes));
  assert.equal(answer.text, 'Bezpečný text\nĎalší riadok');
  assert.equal(answer.status, 'indexed');
  assert.equal(unpacked, 1);
  const tooLarge = Uint8Array.from(bytes);
  const central = Buffer.from(tooLarge).indexOf(Buffer.from([80, 75, 1, 2]));
  new DataView(tooLarge.buffer).setUint32(central + 24, 25 * 1024 * 1024 + 1, true);
  await assert.rejects(helper.extract(file('bomba.docx', tooLarge)), /25 MB/);
  assert.equal(unpacked, 1, 'oversized metadata must fail before decompression');
  const damaged = Uint8Array.from(bytes);
  const textOffset = Buffer.from(damaged).indexOf(Buffer.from('Bezpečný text'));
  damaged[textOffset] ^= 1;
  await assert.rejects(helper.extract(file('poskodeny.docx', damaged)), /poškodená/);
  await assert.rejects(helper.extract(file('deklaracie.docx', zipSync({ ...parts, 'word/document.xml': strToU8('<!DOCTYPE w:document [<!ENTITY a "text">]><w:document/>') }))), /XML deklarácie/);
});

test('PDF reads every page within the cap, OCRs scans locally, and marks omitted pages incomplete', async () => {
  const requested = [], rendered = [], options = [], ocr = [];
  let pageCount = 3;
  const library = { getDocument(value) {
    options.push(value);
    return { destroy: async () => {}, promise: Promise.resolve({ numPages: pageCount, async getPage(number) {
      requested.push(number);
      return {
        getTextContent: async () => ({ items: number === 2 ? [] : [{ str: 'Text strany ' + number, hasEOL: true }] }),
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render(value) { rendered.push(value); return { promise: Promise.resolve(), cancel() {} }; }, cleanup() {},
      };
    } }) };
  } };
  const helper = fixture({ pdfjsLib: library, document: { createElement: () => ({ getContext: () => ({}), toDataURL: () => 'data:image/jpeg;base64,YQ==' }) }, MOPhotoOCR: { cancel: async () => {}, recognize: async value => { ocr.push(value); return 'Text naskenovanej strany'; } } });
  const pdf = file('podklad.pdf', '%PDF-1.7\nfixture');
  const complete = await helper.extract(pdf);
  assert.deepEqual(requested, [1, 2, 3]);
  assert.match(complete.text, /Text strany 1[\s\S]*Text naskenovanej strany[\s\S]*Text strany 3/);
  assert.equal(complete.status, 'indexed');
  assert.equal(ocr.length, 1);
  assert.equal(options[0].isEvalSupported, false);
  assert.equal(options[0].enableXfa, false);
  assert.equal(rendered[0].annotationMode, 0);
  requested.length = 0;
  pageCount = 61;
  const partial = await helper.extract(pdf);
  assert.equal(requested.length, 60);
  assert.equal(requested.at(-1), 60);
  assert.equal(partial.status, 'needs_text');
  assert.match(partial.warning, /61 strán.*prvých 60/);
});

test('photo recognition refuses remote URLs and cancellation discards late file or OCR results', async () => {
  const pendingFile = deferred(), pendingOCR = deferred(), startedOCR = deferred();
  let fetches = 0, cancelCalls = 0;
  const helper = fixture({ fetch: async () => { fetches += 1; throw new Error('Must not fetch'); }, MOPhotoOCR: { cancel: async () => { cancelCalls += 1; }, resize: async () => 'data:image/jpeg;base64,YQ==', recognize: async () => { startedOCR.resolve(); return pendingOCR.promise; } } });
  await assert.rejects(helper.recognizePhoto('https://example.org/photo.png'), /miestnej hry/);
  await assert.rejects(helper.recognizePhoto('/unrelated/page'), /miestnej hry/);
  assert.equal(fetches, 0);
  const reading = helper.extract({ name: 'poznamka.txt', size: 4, arrayBuffer: () => pendingFile.promise });
  await Promise.resolve();
  await helper.cancel();
  pendingFile.resolve(Uint8Array.from([116, 101, 120, 116]).buffer);
  await assert.rejects(reading, error => error.name === 'AbortError');
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
  const recognizing = helper.recognizePhoto(file('obrazok.png', png, 'image/png'));
  await startedOCR.promise;
  await helper.cancel();
  pendingOCR.resolve('Neskorý prepis');
  await assert.rejects(recognizing, error => error.name === 'AbortError');
  assert.ok(cancelCalls >= 4);
});

test('PDF page boundaries retain original numbers through unreadable and scanned pages', async () => {
  const library = { getDocument() {
    return { destroy: async () => {}, promise: Promise.resolve({ numPages: 4, async getPage(number) {
      return {
        async getTextContent() {
          if (number === 2) throw new Error('Unreadable page');
          return { items: number === 3 ? [] : [{ str: 'Strana ' + number, hasEOL: true }] };
        },
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render() { return { promise: Promise.resolve(), cancel() {} }; }, cleanup() {},
      };
    } }) };
  } };
  const helper = fixture({ pdfjsLib: library, document: { createElement: () => ({ getContext: () => ({}), toDataURL: () => 'data:image/jpeg;base64,YQ==' }) }, MOPhotoOCR: { cancel: async () => {}, recognize: async () => 'Hľadané slovo v skene' } });
  const answer = await helper.extract(file('strany.pdf', '%PDF-1.7\nfixture'));
  assert.deepEqual(JSON.parse(JSON.stringify(answer.pages)), [
    { number: 1, text: 'Strana 1' }, { number: 2, text: '' },
    { number: 3, text: 'Hľadané slovo v skene' }, { number: 4, text: 'Strana 4' },
  ]);
  assert.equal(answer.pagination, 'pages');
  assert.equal(answer.status, 'needs_text');
  assert.match(answer.warning, /stranách: 2/);
  assert.equal(answer.pages.find(page => page.text.includes('Hľadané')).number, 3);
  assert.equal(await helper.getPdfLibrary(), library);
  const plain = await helper.extract(file('text.md', '# Obsah'));
  assert.deepEqual(JSON.parse(JSON.stringify(plain.pages)), [{ number: 1, text: '# Obsah' }]);
  assert.equal(plain.pagination, 'unpaginated');
});
