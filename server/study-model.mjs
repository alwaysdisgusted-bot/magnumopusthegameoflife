const StudyModel = (function () {
  'use strict';
  var MAX_BYTES = 10 * 1024 * 1024;
  function fail(message) { throw new Error(message); }
  function plain(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail('Neplatný objekt: ' + label + '.');
    Reflect.ownKeys(value).forEach(function (key) {
      if (typeof key !== 'string' || allowed.indexOf(key) < 0 || key === '__proto__' || key === 'prototype' || key === 'constructor') fail('Nepovolené pole: ' + label + '.');
      if (!Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), 'value')) fail('Neplatné pole: ' + label + '.');
    });
    return value;
  }
  function list(value, max, label) {
    if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) fail('Neplatný alebo príliš dlhý zoznam: ' + label + '.');
    for (var i = 0; i < value.length; i++) {
      var descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('Zoznam nesmie obsahovať prázdne ani vypočítavané položky.');
    }
    return value;
  }
  function text(value, max, label, required) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail(label + ' môže obsahovať ' + (required ? '1 až ' : 'najviac ') + max + ' znakov.');
    return value;
  }
  function identifier(value, seen) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Neplatný identifikátor osobného štúdia.');
    if (seen) { if (seen.has(value)) fail('Každá kategória, poznámka a prepojenie musí mať vlastný identifikátor.'); seen.add(value); }
    return value;
  }
  function integer(value, min, max, label) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) fail(label + ' musí byť celé číslo od ' + min + ' do ' + max + '.');
    return value;
  }
  function photo(value) {
    if (value === '') return value;
    if (typeof value !== 'string' || value.length > 2800000 || !/^data:image\/(?:png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) || !value.slice(value.indexOf(',') + 1).length) fail('Fotka musí byť PNG, JPEG alebo WebP, približne do 2 MB.');
    return value;
  }
  function byteLength(value) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).length;
    var bytes = 0;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      if (code < 128) bytes++; else if (code < 2048) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function createState() {
    return { version: 1, categories: [{ id: 'finance', name: 'Peniaze a úspory', parentId: null, slot: 6, keywords: ['peniaze', 'úspory', 'financie', 'investície'] }], notes: [], links: [] };
  }
  function validateState(value) {
    plain(value, ['version', 'categories', 'notes', 'links'], 'osobné štúdium');
    if (value.version !== 1) fail('Táto verzia osobného štúdia nie je podporovaná.');
    var clean = { version: 1, categories: [], notes: [], links: [] }, seen = new Set(), byId = Object.create(null), slots = new Set();
    clean.categories = list(value.categories, 100, 'kategórie').map(function (category) {
      plain(category, ['id', 'name', 'parentId', 'slot', 'keywords'], 'kategória');
      var id = identifier(category.id, seen), parentId = category.parentId;
      if (parentId !== null) identifier(parentId);
      if (parentId === null) {
        integer(category.slot, 0, 9, 'Pozícia hlavnej kategórie');
        if (slots.has(category.slot)) fail('Dve hlavné kategórie nemôžu obsadiť rovnaké miesto.');
        slots.add(category.slot);
      } else if (category.slot !== null) fail('Podkategória nemá vlastnú pozíciu na strome.');
      var result = { id: id, name: text(category.name, 160, 'Názov kategórie', true), parentId: parentId, slot: category.slot, keywords: list(category.keywords, 30, 'kľúčové slová').map(function (word) { return text(word, 100, 'Kľúčové slovo', true); }) };
      byId[id] = result; return result;
    });
    clean.categories.forEach(function (category) {
      var current = category, ancestors = new Set(), levels = 0;
      while (current) {
        if (ancestors.has(current.id)) fail('Kategórie nesmú vytvárať kruh.');
        ancestors.add(current.id);
        if (++levels > 5) fail('Osobné štúdium môže mať najviac päť úrovní kategórií.');
        if (current.parentId === null) break;
        current = byId[current.parentId];
        if (!current) fail('Nadradená kategória neexistuje.');
      }
    });
    function categoryId(value) { identifier(value); if (!byId[value]) fail('Kategória poznámky alebo prepojenia neexistuje.'); return value; }
    clean.notes = list(value.notes, 500, 'poznámky').map(function (note) {
      plain(note, ['id', 'categoryId', 'title', 'text', 'photo', 'source', 'createdAt', 'updatedAt'], 'poznámka');
      if (note.source !== 'manual' && note.source !== 'ocr') fail('Neznámy pôvod poznámky.');
      var created = integer(note.createdAt, 0, Number.MAX_SAFE_INTEGER, 'Dátum vytvorenia'), updated = integer(note.updatedAt, created, Number.MAX_SAFE_INTEGER, 'Dátum úpravy');
      return { id: identifier(note.id, seen), categoryId: categoryId(note.categoryId), title: text(note.title, 160, 'Názov poznámky'), text: text(note.text, 20000, 'Text poznámky'), photo: photo(note.photo), source: note.source, createdAt: created, updatedAt: updated };
    });
    clean.links = list(value.links, 1000, 'prepojenia').map(function (link) {
      plain(link, ['id', 'categoryId', 'kind', 'targetId'], 'prepojenie');
      if (['book', 'page', 'finance'].indexOf(link.kind) < 0) fail('Neznámy typ prepojenia.');
      if (typeof link.targetId !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(link.targetId)) fail('Neplatný cieľ prepojenia.');
      return { id: identifier(link.id, seen), categoryId: categoryId(link.categoryId), kind: link.kind, targetId: link.targetId };
    });
    if (byteLength(JSON.stringify(clean)) > MAX_BYTES) fail('Osobné štúdium presahuje 10 MB. Zmenši vložené fotografie alebo rozdeľ poznámky.');
    return clean;
  }
  return Object.freeze({ createState: createState, validateState: validateState });
})();
export default StudyModel;
