(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.MOKnowledgeHierarchy = factory;
})(typeof window === 'object' ? window : globalThis, function createHierarchyModel(catalog, options) {
  'use strict';
  options ||= {};
  // Pure proposals only. Persistence, export and UI activation belong to the
  // vocabulary transaction; this module never opens storage or reads documents.
  const MAX_DEPTH = 8, MAX_CATEGORIES = 100;
  const fail = message => new Error('Hierarchia: ' + message);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const normalized = value => value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sk');
  const fields = new Map(), builtins = new Map(), reserved = new Set();
  const uuid = options.randomUUID || (() => globalThis.crypto.randomUUID());

  function text(value, maximum, label, empty = false) {
    if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())) throw fail(label + ' má neplatnú alebo príliš dlhú hodnotu.');
    return value;
  }
  function identifier(value) {
    text(value, 150, 'Identifikátor');
    if (/[^a-zA-Z0-9_.:-]/.test(value) || ['__proto__', 'prototype', 'constructor'].includes(value)) throw fail('Neplatný identifikátor.');
    return value;
  }
  function shape(value, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Neplatný objekt.');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) throw fail('Neplatný prototyp.');
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key) || !own(Object.getOwnPropertyDescriptor(value, key), 'value')) || required.some(key => !own(value, key))) throw fail('Neplatné alebo chýbajúce polia.');
  }
  function list(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) throw fail('Neplatný alebo príliš veľký zoznam.');
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !own(descriptor, 'value')) throw fail('Zoznam obsahuje neplatnú položku.');
    }
    return value;
  }

  list(catalog, 100);
  if (!catalog.length) throw fail('Chýba katalóg odborov.');
  for (const field of catalog) {
    const id = identifier(field.id), name = text(field.name, 150, 'Názov odboru');
    if (fields.has(id)) throw fail('Duplicitný odbor.');
    fields.set(id, Object.freeze({ id, fieldId: id, name, kind: 'field' }));
    reserved.add(id);
    const categories = new Map(), names = new Set();
    for (const category of list(field.categories, MAX_CATEGORIES)) {
      const categoryId = identifier(category.id), categoryName = text(category.name, 150, 'Názov kategórie');
      if (categories.has(categoryId) || names.has(normalized(categoryName))) throw fail('Duplicitná pevná kategória.');
      categories.set(categoryId, Object.freeze({ id: categoryId, fieldId: id, parentId: null, name: categoryName,
        description: text(category.description ?? '', 2000, 'Popis', true), kind: 'builtin' }));
      names.add(normalized(categoryName));
      reserved.add(categoryId);
    }
    builtins.set(id, categories);
  }

  function inspect(input) {
    shape(input, ['version', 'nodes']);
    if (input.version !== 1) throw fail('Nepodporovaná verzia hierarchie.');
    list(input.nodes, fields.size * MAX_CATEGORIES);
    const ids = new Set(), nodes = [], byField = new Map();
    for (const [fieldId, categories] of builtins) byField.set(fieldId, new Map(categories));
    for (let index = 0; index < input.nodes.length; index++) {
      const inputNode = input.nodes[index];
      shape(inputNode, ['id', 'fieldId', 'parentId', 'name', 'description']);
      const node = { id: identifier(inputNode.id), fieldId: identifier(inputNode.fieldId),
        parentId: inputNode.parentId === null ? null : identifier(inputNode.parentId),
        name: text(inputNode.name, 150, 'Názov kategórie'), description: text(inputNode.description, 2000, 'Popis', true) };
      if (!fields.has(node.fieldId)) throw fail('Neznámy odbor.');
      if (ids.has(node.id) || reserved.has(node.id)) throw fail('Kolízia identifikátora kategórie.');
      ids.add(node.id);
      const categories = byField.get(node.fieldId);
      categories.set(node.id, Object.freeze({ ...node, kind: 'custom' }));
      if (categories.size > MAX_CATEGORIES) throw fail('Odbor môže obsahovať najviac 100 kategórií vrátane pevných.');
      nodes.push(Object.freeze(node));
    }
    const depths = new Map();
    for (const [fieldId, categories] of byField) {
      const visiting = new Set(), memo = new Map(), siblingNames = new Map();
      function depth(id) {
        if (memo.has(id)) return memo.get(id);
        if (visiting.has(id)) throw fail('Presun by vytvoril cyklus.');
        const node = categories.get(id);
        if (!node) throw fail('Rodič neexistuje v tom istom odbore.');
        visiting.add(id);
        const value = node.parentId === null ? 1 : depth(node.parentId) + 1;
        if (value > MAX_DEPTH) throw fail('Vetva môže mať najviac 8 úrovní kategórií.');
        visiting.delete(id); memo.set(id, value);
        return value;
      }
      for (const node of categories.values()) {
        depth(node.id);
        const names = siblingNames.get(node.parentId) || new Set();
        const name = normalized(node.name);
        if (names.has(name)) throw fail('Pod týmto rodičom už je kategória s rovnakým názvom.');
        names.add(name); siblingNames.set(node.parentId, names);
      }
      depths.set(fieldId, memo);
    }
    return { value: Object.freeze({ version: 1, nodes: Object.freeze(nodes) }), byField, depths };
  }

  function validate(input) { return inspect(input).value; }
  function empty() { return Object.freeze({ version: 1, nodes: Object.freeze([]) }); }
  function customNode(value, id) {
    identifier(id);
    const found = value.nodes.find(node => node.id === id);
    if (!found) throw fail('Upravovať možno iba existujúcu vlastnú kategóriu.');
    return found;
  }
  function add(input, data) {
    shape(data, ['fieldId', 'parentId', 'name', 'description'], ['fieldId', 'name']);
    const value = validate(input);
    const generated = uuid();
    if (typeof generated !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(generated)) throw fail('Nepodarilo sa vytvoriť stabilný identifikátor.');
    const node = { id: 'custom-' + generated, fieldId: data.fieldId, parentId: own(data, 'parentId') ? data.parentId : null,
      name: data.name, description: own(data, 'description') ? data.description : '' };
    return validate({ version: 1, nodes: [...value.nodes, node] });
  }
  function rename(input, id, data) {
    shape(data, ['name', 'description'], ['name']);
    const value = validate(input), original = customNode(value, id);
    const replacement = { ...original, name: data.name, description: own(data, 'description') ? data.description : original.description };
    return validate({ version: 1, nodes: value.nodes.map(node => node.id === id ? replacement : node) });
  }
  function reparent(input, id, parentId) {
    const value = validate(input);
    customNode(value, id);
    return validate({ version: 1, nodes: value.nodes.map(node => node.id === id ? { ...node, parentId } : node) });
  }
  function selection(input, fieldId, id) {
    const state = inspect(input), categories = state.byField.get(fieldId);
    if (!categories) throw fail('Neznámy odbor.');
    const node = categories.get(id);
    if (!node) throw fail('Neznáma kategória v tomto odbore.');
    return { ...state, categories, node };
  }
  function path(input, fieldId, id) {
    const { categories, node } = selection(input, fieldId, id), result = [];
    let current = node;
    while (current) { result.unshift(current); current = current.parentId === null ? null : categories.get(current.parentId); }
    return Object.freeze([fields.get(fieldId), ...result]);
  }
  function ordered(categories, parentId, result) {
    for (const node of categories.values()) if (node.parentId === parentId) {
      result.push(node); ordered(categories, node.id, result);
    }
    return result;
  }
  function descendants(input, fieldId, id) {
    const { categories } = selection(input, fieldId, id);
    return Object.freeze(ordered(categories, id, []).map(node => node.id));
  }
  function categories(input, fieldId) {
    const state = inspect(input), entries = state.byField.get(fieldId);
    if (!entries) throw fail('Neznámy odbor.');
    return Object.freeze(ordered(entries, null, []).map(node => Object.freeze({ ...node, depth: state.depths.get(fieldId).get(node.id) })));
  }
  return Object.freeze({ empty, validate, add, rename, reparent, path, descendants, categories });
});
