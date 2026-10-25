(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.MOKnowledgeStore = factory(root, root.MOKnowledgeVocabularyModel);
})(typeof window === 'object' ? window : globalThis, function createKnowledgeStore(env, vocabularyModel) {
  'use strict';
  // This database is deliberately independent of the game and the old demo.
  const DATABASE = 'magnum-opus-knowledge-system-v1';
  const FORMAT = 'magnum-opus-knowledge-system';
  const MAX_FILE = 15 * 1024 * 1024;
  const MAX_BACKUP = 100 * 1024 * 1024;
  const MAX_TEXT = 200000;
  const MAX_DOCUMENTS = 1000;
  const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'text/markdown', 'text/x-markdown', 'text/csv', 'text/tab-separated-values']);
  let opening;
  const subscribers = new Set();
  const fail = message => new Error('Znalostný systém: ' + message);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const vocabularyMode = Boolean(vocabularyModel);
  if (vocabularyMode && (typeof vocabularyModel.validate !== 'function' || typeof vocabularyModel.empty !== 'function')) throw fail('Chýba platný model hierarchie.');

  function plain(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === null || Object.getPrototypeOf(prototype) === null;
  }

  function shape(value, allowed, label) {
    if (!plain(value)) throw fail(label + ' má neplatný formát.');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !allowed.includes(key) ||
      !own(Object.getOwnPropertyDescriptor(value, key), 'value'))) throw fail(label + ' obsahuje nepovolené údaje.');
  }

  function string(value, maximum, label, empty = false) {
    if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) {
      throw fail(label + ' má neplatnú alebo príliš dlhú hodnotu.');
    }
    return value;
  }

  function identifier(value) {
    string(value, 150, 'Identifikátor');
    if (/[^a-zA-Z0-9_.:-]/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) {
      throw fail('Neplatný identifikátor.');
    }
    return value;
  }

  function mime(value) {
    string(value, 150, 'Typ súboru');
    const normalized = value.toLowerCase().split(';')[0].trim();
    if (!MIME_TYPES.has(normalized)) throw fail('Tento typ súboru nie je podporovaný. Použi PDF, DOCX, PNG, JPEG, WebP alebo obyčajný text.');
    return normalized;
  }

  function normalizeDocument(input) {
    shape(input, ['id', 'name', 'size', 'mime', 'text', 'pageKind', 'pages', 'blob', 'pagination', 'analysisStatus', 'warning'], 'Dokument');
    const document = {
      id: identifier(input.id), name: string(input.name, 255, 'Názov dokumentu'),
      size: input.size, mime: mime(input.mime), text: string(input.text, MAX_TEXT, 'Text dokumentu', true),
      pageKind: input.pageKind, pages: []
    };
    if (!Number.isSafeInteger(document.size) || document.size < 0 || document.size > MAX_FILE) throw fail('Súbor môže mať najviac 15 MiB.');
    if (/\.(?:svg|html?|xhtml|js|mjs|cjs|exe|bat|cmd|ps1|sh)$/i.test(document.name)) throw fail('HTML, SVG a spustiteľné súbory sa neprijímajú.');
    if (!['original', 'virtual'].includes(input.pageKind)) throw fail('Neplatný druh strán.');
    if (!Array.isArray(input.pages) || input.pages.length > 10000) throw fail('Neplatný alebo príliš veľký zoznam strán.');
    const numbers = new Set();
    let characters = 0;
    document.pages = input.pages.map(page => {
      shape(page, ['number', 'text'], 'Strana');
      if (!Number.isSafeInteger(page.number) || page.number < 1 || numbers.has(page.number)) throw fail('Čísla strán musia byť kladné a jedinečné.');
      numbers.add(page.number);
      const text = string(page.text, MAX_TEXT, 'Text strany', true);
      characters += text.length;
      if (characters > MAX_TEXT) throw fail('Text strán môže obsahovať najviac 200 000 znakov.');
      return { number: page.number, text };
    });
    if (own(input, 'pagination')) {
      if (!['pages', 'unpaginated'].includes(input.pagination)) throw fail('Neplatné stránkovanie.');
      document.pagination = input.pagination;
    }
    if (own(input, 'analysisStatus')) document.analysisStatus = string(input.analysisStatus, 100, 'Stav spracovania', true);
    if (own(input, 'warning')) document.warning = string(input.warning, 2000, 'Upozornenie', true);
    if (own(input, 'blob')) {
      if (!(input.blob instanceof env.Blob) || input.blob.size !== document.size || mime(input.blob.type) !== document.mime) {
        throw fail('Originál súboru nezodpovedá jeho veľkosti alebo typu.');
      }
      document.blob = input.blob;
    }
    return document;
  }

  async function verifyBlob(document) {
    if (!document.blob || document.mime.startsWith('text/')) return;
    const bytes = new Uint8Array(await document.blob.slice(0, 16).arrayBuffer());
    const starts = sequence => sequence.every((byte, index) => bytes[index] === byte);
    const ascii = (offset, text) => Array.from(text).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
    const valid = document.mime === 'image/png' ? starts([137, 80, 78, 71, 13, 10, 26, 10]) :
      document.mime === 'image/jpeg' ? starts([255, 216, 255]) :
        document.mime === 'image/webp' ? ascii(0, 'RIFF') && ascii(8, 'WEBP') :
          document.mime === 'application/pdf' ? ascii(0, '%PDF-') : starts([80, 75, 3, 4]);
    if (!valid) throw fail('Obsah originálu nezodpovedá deklarovanému typu súboru.');
  }

  function normalizeValue(key, input) {
    if (!['terms', 'authors'].includes(key)) throw fail('Neznámy kľúč úložiska.');
    if (!plain(input) || Reflect.ownKeys(input).length > 100) throw fail('Neplatný zoznam pojmov alebo autorov.');
    const result = {};
    let total = 0;
    for (const field of Reflect.ownKeys(input)) {
      identifier(field);
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!own(descriptor, 'value')) throw fail('Nepovolený formát zoznamu.');
      const categories = descriptor.value;
      if (!plain(categories) || Reflect.ownKeys(categories).length > 100) throw fail('Neplatný zoznam podkategórií.');
      result[field] = {};
      for (const category of Reflect.ownKeys(categories)) {
        identifier(category);
        const entriesDescriptor = Object.getOwnPropertyDescriptor(categories, category);
        if (!own(entriesDescriptor, 'value')) throw fail('Nepovolený formát podkategórie.');
        const entries = entriesDescriptor.value;
        if (!Array.isArray(entries) || entries.length > (key === 'terms' ? 500 : 200)) throw fail('Príliš veľa položiek v podkategórii.');
        total += entries.length;
        if (total > 5000) throw fail('Zoznam môže obsahovať najviac 5 000 položiek.');
        if (Reflect.ownKeys(entries).length !== entries.length + 1) throw fail('Neplatný zoznam položiek.');
        result[field][category] = [];
        for (let index = 0; index < entries.length; index++) {
          const entryDescriptor = Object.getOwnPropertyDescriptor(entries, index);
          if (!entryDescriptor || !own(entryDescriptor, 'value')) throw fail('Neplatná položka zoznamu.');
          const entry = entryDescriptor.value;
          if (key === 'authors') result[field][category].push(string(entry, 200, 'Meno autora'));
          else {
            shape(entry, ['term', 'description'], 'Pojem');
            result[field][category].push({ term: string(entry.term, 150, 'Pojem'), description: string(entry.description, 2000, 'Opis pojmu', true) });
          }
        }
      }
    }
    return result;
  }

  function mergeValues(key, current, incoming) {
    const merged = normalizeValue(key, current || {});
    for (const [field, categories] of Object.entries(incoming)) {
      merged[field] ||= {};
      for (const [category, entries] of Object.entries(categories)) {
        const target = merged[field][category] ||= [];
        const seen = new Set(target.map(entry => JSON.stringify(entry)));
        for (const entry of entries) {
          const serialized = JSON.stringify(entry);
          if (!seen.has(serialized)) { target.push(entry); seen.add(serialized); }
        }
      }
    }
    return normalizeValue(key, merged);
  }

  function open() {
    if (!env.indexedDB) return Promise.reject(fail('Prehliadač neposkytuje IndexedDB. Povoľ miestne ukladanie a otvor stránku znova; údaje sa zatiaľ neuložili.'));
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      let finished = false;
      let request;
      try { request = env.indexedDB.open(DATABASE, vocabularyMode ? 2 : 1); } catch (error) {
        reject(fail('Miestne úložisko sa nepodarilo otvoriť. ' + (error?.message || 'Skontroluj povolenie ukladania v prehliadači.')));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('documents')) database.createObjectStore('documents', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('values')) database.createObjectStore('values', { keyPath: 'key' });
      };
      request.onerror = () => { finished = true; reject(fail(request.error?.name === 'VersionError' ? 'Úložisko používa novší systém. Ulož rozpísanú prácu a otvor aktuálnu stránku mapy.' : 'Miestne úložisko sa nepodarilo otvoriť. ' + (request.error?.message || ''))); };
      request.onblocked = () => { finished = true; reject(fail('Otvorenie úložiska blokuje iná karta. Ulož rozpísanú prácu, zavri staršie karty systému a skús znova.')); };
      request.onsuccess = () => {
        if (finished) { request.result.close(); return; }
        const database = request.result;
        database.onversionchange = () => { database.close(); opening = undefined; };
        resolve(database);
      };
    }).catch(error => { opening = undefined; throw error; });
    return opening;
  }

  async function transaction(mode, callback, stores = ['documents', 'values']) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let result;
      let reason;
      let tx;
      try { tx = database.transaction(stores, mode); } catch (error) { reject(fail('Úložisko nie je dostupné. ' + error.message)); return; }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(reason || fail('Zápis sa neuložil. ' + (tx.error?.message || 'Prehliadač transakciu zrušil.')));
      tx.onerror = () => { /* onabort provides the final result, including rollback. */ };
      const abort = error => { reason = error; try { tx.abort(); } catch { reject(error); } };
      try { callback(tx, value => { result = value; }, abort); } catch (error) { abort(error); }
    });
  }

  function uuid() {
    if (env.crypto?.randomUUID) return env.crypto.randomUUID();
    if (!env.crypto?.getRandomValues) throw fail('Prehliadač nepodporuje bezpečné identifikátory.');
    const bytes = env.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function signature(document) {
    if (!env.crypto?.subtle || !env.TextEncoder) throw fail('Prehliadač nepodporuje bezpečné overenie obsahu súborov.');
    const { blob, ...metadata } = document;
    delete metadata.id;
    const hash = async bytes => Array.from(new Uint8Array(await env.crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const metadataHash = await hash(new env.TextEncoder().encode(JSON.stringify(metadata)));
    return metadataHash + ':' + (blob ? await hash(await blob.arrayBuffer()) : 'no-original');
  }

  const channel = (() => { try { return env.BroadcastChannel ? new env.BroadcastChannel(DATABASE) : null; } catch { return null; } })();
  function notify(external) {
    const detail = { external };
    for (const callback of subscribers) { try { callback(detail); } catch (error) { env.console?.error('Znalostný systém: aktualizácia zobrazenia zlyhala.', error); } }
    if (env.dispatchEvent && env.CustomEvent) env.dispatchEvent(new env.CustomEvent('knowledge-system-storage-updated', { detail }));
    if (!external) { try { channel?.postMessage({ type: 'changed' }); } catch { /* Notifications are optional; persistence already succeeded. */ } }
  }
  if (channel) channel.onmessage = event => { if (event.data?.type === 'changed') notify(true); };
  function markUpdated(tx, operation) {
    tx.objectStore('values').put({ key: 'metadata', value: { updatedAt: new Date().toISOString(), operation } });
  }

  async function getDocuments() {
    return transaction('readonly', (tx, done) => {
      const request = tx.objectStore('documents').getAll();
      request.onsuccess = () => done(request.result.map(record => record.document));
    });
  }

  async function putDocument(input) {
    const document = normalizeDocument(input);
    await verifyBlob(document);
    const digest = await signature(document);
    await transaction('readwrite', (tx, done, abort) => {
      const store = tx.objectStore('documents');
      const count = store.count();
      const previous = store.get(document.id);
      let waiting = 2;
      const save = () => {
        if (--waiting) return;
        if (!previous.result && count.result >= MAX_DOCUMENTS) { abort(fail('Knižnica môže obsahovať najviac 1 000 dokumentov.')); return; }
        store.put({ id: document.id, document, signature: digest });
        markUpdated(tx, 'document');
        done(document);
      };
      count.onsuccess = save; previous.onsuccess = save;
    });
    notify(false);
    return document;
  }

  async function getValue(key, fallback) {
    if (!['terms', 'authors'].includes(key)) throw fail('Neznámy kľúč úložiska.');
    return transaction('readonly', (tx, done) => {
      const request = tx.objectStore('values').get(key);
      request.onsuccess = () => done(request.result ? request.result.value : fallback);
    });
  }

  async function setValue(key, input, expected) {
    if (vocabularyMode) throw fail('Použi spoločný zápis setVocabulary pre hierarchiu, pojmy a autorov.');
    const value = normalizeValue(key, input);
    const compare = arguments.length > 2;
    const stable = data => JSON.stringify(Object.keys(data).sort().map(field => [field,
      Object.keys(data[field]).sort().map(category => [category, data[field][category]])]));
    const expectedSnapshot = compare ? stable(normalizeValue(key, expected)) : null;
    await transaction('readwrite', (tx, done, abort) => {
      const values = tx.objectStore('values');
      const save = () => { values.put({ key, value }); markUpdated(tx, key); done(value); };
      const hierarchy = values.get('hierarchy');
      hierarchy.onsuccess = () => {
        if (hierarchy.result) { abort(fail('Novšia hierarchia vyžaduje spoločný zápis slovníka. Otvor aktuálnu stránku mapy.')); return; }
        if (!compare) { save(); return; }
        const current = values.get(key);
        current.onsuccess = () => {
        try {
          if (stable(normalizeValue(key, current.result?.value || {})) !== expectedSnapshot) {
            const error = fail(`${key === 'authors' ? 'Autori' : 'Pojmy'} sa medzitým zmenili v druhej karte. Najprv načítaj uložené zmeny.`);
            error.code = 'value_conflict';
            abort(error);
            return;
          }
          save();
        } catch (error) { abort(error); }
        };
      };
    });
    notify(false);
    return value;
  }

  function normalizeVocabulary(input) {
    if (!vocabularyMode) throw fail('Spoločné úložisko kategórií ešte nie je zapnuté.');
    shape(input, ['hierarchy', 'terms', 'authors'], 'Slovník');
    return { hierarchy: vocabularyModel.validate(input.hierarchy), terms: normalizeValue('terms', input.terms), authors: normalizeValue('authors', input.authors) };
  }

  const hierarchyNode = node => [node.id, node.fieldId, node.parentId, node.name, node.description];
  const stableValues = data => Object.keys(data).sort().map(field => [field, Object.keys(data[field]).sort().map(category => [category, data[field][category]])]);
  function stableVocabulary(value) {
    return JSON.stringify([value.hierarchy.version, [...value.hierarchy.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(hierarchyNode), stableValues(value.terms), stableValues(value.authors)]);
  }
  function readVocabulary(tx, done, abort) {
    const values = tx.objectStore('values'), requests = ['hierarchy', 'terms', 'authors'].map(key => values.get(key));
    let waiting = requests.length;
    const ready = () => {
      if (--waiting) return;
      try { done(normalizeVocabulary({ hierarchy: requests[0].result ? requests[0].result.value : vocabularyModel.empty(), terms: requests[1].result ? requests[1].result.value : {}, authors: requests[2].result ? requests[2].result.value : {} })); }
      catch (error) { abort(error); }
    };
    requests.forEach(request => { request.onsuccess = ready; });
  }
  async function getVocabulary() {
    if (!vocabularyMode) throw fail('Spoločné úložisko kategórií ešte nie je zapnuté.');
    return transaction('readonly', (tx, done, abort) => readVocabulary(tx, done, abort), ['values']);
  }
  async function setVocabulary(input, expected) {
    const value = normalizeVocabulary(input), expectedSnapshot = stableVocabulary(normalizeVocabulary(expected));
    await transaction('readwrite', (tx, done, abort) => readVocabulary(tx, current => {
      if (stableVocabulary(current) !== expectedSnapshot) {
        const error = fail('Slovník sa medzitým zmenil v druhej karte. Najprv načítaj uložené zmeny.');
        error.code = 'value_conflict'; abort(error); return;
      }
      const values = tx.objectStore('values');
      for (const key of ['hierarchy', 'terms', 'authors']) values.put({ key, value: value[key] });
      markUpdated(tx, 'vocabulary'); done(value);
    }, abort), ['values']);
    notify(false);
    return value;
  }

  function mergeHierarchy(current, incoming) {
    const nodes = new Map(current.nodes.map(node => [node.id, node]));
    for (const node of incoming.nodes) {
      const previous = nodes.get(node.id);
      if (previous && JSON.stringify(hierarchyNode(previous)) !== JSON.stringify(hierarchyNode(node))) throw fail('Konflikt definície rovnakej kategórie v zálohe. Import nič nezmenil.');
      if (!previous) nodes.set(node.id, node);
    }
    return vocabularyModel.validate({ version: 1, nodes: [...nodes.values()] });
  }

  async function snapshot() {
    return transaction('readonly', (tx, done) => {
      const documents = tx.objectStore('documents').getAll();
      const values = tx.objectStore('values').getAll();
      let waiting = 2;
      const ready = () => { if (!--waiting) done({ documents: documents.result, values: values.result }); };
      documents.onsuccess = ready; values.onsuccess = ready;
    });
  }

  function encode(bytes) {
    const parts = [];
    for (let offset = 0; offset < bytes.length; offset += 32768) parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
    return env.btoa(parts.join(''));
  }

  async function exportBackup() {
    const saved = await snapshot();
    const values = Object.fromEntries(saved.values.filter(record => ['hierarchy', 'terms', 'authors'].includes(record.key)).map(record => [record.key, record.value]));
    if (!vocabularyMode && own(values, 'hierarchy')) throw fail('Novšiu hierarchiu nemožno vynechať zo zálohy verzie 1. Otvor aktuálnu stránku mapy.');
    const vocabulary = vocabularyMode ? normalizeVocabulary({ hierarchy: own(values, 'hierarchy') ? values.hierarchy : vocabularyModel.empty(), terms: values.terms || {}, authors: values.authors || {} }) : { terms: values.terms || {}, authors: values.authors || {} };
    const backup = { format: FORMAT, version: vocabularyMode ? 2 : 1, exportedAt: new Date().toISOString(), documents: [], ...vocabulary };
    let estimated = new env.Blob([JSON.stringify(backup)]).size;
    const tooLarge = () => fail('Záloha by prekročila 100 MiB. Zachovaj existujúce súbory a rozdeľ knižnicu do viacerých menších prenosov.');
    for (const record of saved.documents) {
      const { blob, ...document } = record.document;
      estimated += new env.Blob([JSON.stringify(document)]).size + (blob ? Math.ceil(blob.size / 3) * 4 + 256 : 2);
      if (estimated > MAX_BACKUP) throw tooLarge();
      if (blob) document.blob = { type: document.mime, base64: encode(new Uint8Array(await blob.arrayBuffer())) };
      backup.documents.push(document);
    }
    const result = new env.Blob([JSON.stringify(backup)], { type: 'application/json' });
    if (result.size > MAX_BACKUP) throw tooLarge();
    return result;
  }

  async function parseBackup(file) {
    if (!(file instanceof env.Blob) || file.size > MAX_BACKUP) throw fail('Záloha musí byť súbor JSON veľký najviac 100 MiB.');
    let input;
    try { input = JSON.parse(await file.text()); } catch { throw fail('Záloha neobsahuje platný JSON.'); }
    shape(input, vocabularyMode ? ['format', 'version', 'exportedAt', 'documents', 'terms', 'authors', 'hierarchy'] : ['format', 'version', 'exportedAt', 'documents', 'terms', 'authors'], 'Záloha');
    if (input.format !== FORMAT || !(vocabularyMode ? [1, 2] : [1]).includes(input.version)) throw fail(`Toto nie je podporovaná záloha samostatného znalostného systému (verzia ${vocabularyMode ? '1 alebo 2' : '1'}).`);
    if (input.version === 1 && own(input, 'hierarchy')) throw fail('Záloha verzie 1 nesmie obsahovať hierarchiu.');
    const hierarchy = vocabularyMode ? (input.version === 2 ? vocabularyModel.validate(input.hierarchy) : vocabularyModel.empty()) : null;
    if (own(input, 'exportedAt')) string(input.exportedAt, 100, 'Dátum zálohy');
    if (!Array.isArray(input.documents) || input.documents.length > MAX_DOCUMENTS) throw fail('Záloha môže obsahovať najviac 1 000 dokumentov.');
    const terms = normalizeValue('terms', input.terms);
    const authors = normalizeValue('authors', input.authors);
    const documents = [];
    for (const entry of input.documents) {
      if (!plain(entry)) throw fail('Dokument má neplatný formát.');
      const decoded = { ...entry };
      if (own(entry, 'blob')) {
        shape(entry.blob, ['type', 'base64'], 'Originál v zálohe');
        const type = mime(entry.blob.type);
        const encoded = entry.blob.base64;
        if (typeof encoded !== 'string' || encoded.length > Math.ceil(MAX_FILE / 3) * 4 || encoded.length % 4) {
          throw fail('Originál má neplatné kódovanie alebo prekračuje 15 MiB.');
        }
        const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
        // A simple character scan also handles a 15 MiB original without the
        // recursion cost of a repeated-group base64 regular expression.
        if (/[^A-Za-z0-9+/]/.test(padding ? encoded.slice(0, -padding) : encoded)) throw fail('Originál má neplatné kódovanie.');
        let binary;
        try { binary = env.atob(encoded); } catch { throw fail('Originál má neplatné kódovanie.'); }
        if (binary.length > MAX_FILE) throw fail('Originál prekračuje 15 MiB.');
        decoded.blob = new env.Blob([Uint8Array.from(binary, char => char.charCodeAt(0))], { type });
      }
      const document = normalizeDocument(decoded);
      await verifyBlob(document);
      documents.push({ id: document.id, document, signature: await signature(document) });
    }
    return { documents, terms, authors, hierarchy };
  }

  async function importBackup(file) {
    // Parsing, decoding, bounds and blob checks finish before the first write.
    const input = await parseBackup(file);
    const result = await transaction('readwrite', (tx, done, abort) => {
      const documents = tx.objectStore('documents');
      const values = tx.objectStore('values');
      const currentDocuments = documents.getAll();
      const currentTerms = values.get('terms');
      const currentAuthors = values.get('authors');
      const currentHierarchy = values.get('hierarchy');
      let waiting = 4;
      const merge = () => {
        if (--waiting) return;
        try {
          if (!vocabularyMode && currentHierarchy.result) throw fail('Novšia hierarchia vyžaduje aktuálny systém mapy. Import nič nezmenil.');
          const hierarchy = vocabularyMode ? mergeHierarchy(currentHierarchy.result ? vocabularyModel.validate(currentHierarchy.result.value) : vocabularyModel.empty(), input.hierarchy) : null;
          const existing = currentDocuments.result;
          const ids = new Set(existing.map(record => record.id));
          const signatures = new Set(existing.map(record => record.signature));
          const additions = [];
          for (const record of input.documents) {
            if (signatures.has(record.signature)) continue;
            let id = record.id;
            if (ids.has(id)) do { id = uuid(); } while (ids.has(id));
            ids.add(id); signatures.add(record.signature);
            additions.push({ ...record, id, document: { ...record.document, id } });
          }
          if (existing.length + additions.length > MAX_DOCUMENTS) throw fail('Import by prekročil limit 1 000 dokumentov.');
          const terms = mergeValues('terms', currentTerms.result?.value, input.terms);
          const authors = mergeValues('authors', currentAuthors.result?.value, input.authors);
          for (const record of additions) documents.put(record);
          values.put({ key: 'terms', value: terms }); values.put({ key: 'authors', value: authors });
          if (vocabularyMode) values.put({ key: 'hierarchy', value: hierarchy });
          markUpdated(tx, 'import');
          done({ documents: existing.length + additions.length, terms, authors, ...(vocabularyMode ? { hierarchy } : {}), imported: additions.length });
        } catch (error) { abort(error); }
      };
      currentDocuments.onsuccess = merge; currentTerms.onsuccess = merge; currentAuthors.onsuccess = merge; currentHierarchy.onsuccess = merge;
    });
    notify(false);
    return result;
  }

  function onChanged(callback) {
    if (typeof callback !== 'function') throw fail('Odber aktualizácií potrebuje funkciu.');
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  }

  return Object.freeze({ getDocuments, putDocument, getValue, setValue, getVocabulary, setVocabulary, exportBackup, importBackup, onChanged });
});
