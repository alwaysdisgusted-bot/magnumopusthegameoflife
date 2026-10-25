(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOKnowledgeGameSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var MAX_QUERY = 150;
  var MAX_RESULTS = 100;
  var destinations = Object.freeze({
    page: 'workspace', daynote: 'calendar', 'desk-note': 'desk', 'desk-photo': 'desk', study: 'study', book: 'library',
    'grimoire-tab': 'library', 'grimoire-folder': 'library', 'grimoire-document': 'library',
    'grimoire-favorite': 'library', 'grimoire-collection': 'library'
  });

  // Keep original UTF-16 offsets while removing accents. A separate combining
  // mark belongs to the preceding character and must be highlighted with it.
  function folded(value) {
    var text = String(value == null ? '' : value), normalized = '', starts = [], ends = [], offset = 0;
    for (var character of text) {
      var end = offset + character.length;
      var part = character.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '');
      if (!part && /\p{M}/u.test(character) && ends.length) ends[ends.length - 1] = end;
      if (/\s/u.test(character)) {
        if (normalized.endsWith(' ')) { ends[ends.length - 1] = end; offset = end; continue; }
        part = ' ';
      }
      for (var index = 0; index < part.length; index++) {
        normalized += part[index]; starts.push(offset); ends.push(end);
      }
      offset = end;
    }
    return { text: normalized, starts: starts, ends: ends };
  }

  function findRanges(value, query) {
    var target = folded(value), needle = folded(query).text, ranges = [], cursor = 0;
    if (!needle) return ranges;
    while (cursor <= target.text.length - needle.length) {
      var position = target.text.indexOf(needle, cursor);
      if (position < 0) break;
      var range = { start: target.starts[position], end: target.ends[position + needle.length - 1] };
      var previous = ranges[ranges.length - 1];
      if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
      else ranges.push(range);
      cursor = position + needle.length;
    }
    return ranges;
  }

  function string(value) {
    if (value == null) return '';
    if (typeof value !== 'string') throw Error('Zdroj vrátil neplatný text.');
    return value;
  }
  function record(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Zdroj vrátil neplatný záznam.');
    return value;
  }
  function list(value) {
    if (!Array.isArray(value)) throw Error('Zdroj vrátil neplatný zoznam.');
    return value;
  }
  function joined(values) { return values.map(string).filter(Boolean).join('\n'); }
  function source(kind, item, title, text) {
    record(item);
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(item.id)) throw Error('Zdroj vrátil neplatný identifikátor.');
    return { kind: kind, id: item.id, title: title, text: text };
  }

  var sources = [
    { name: 'Pracovňa', path: '/api/workspace/pages', read: function (data) {
      return list(record(data).pages).map(function (item) { record(item); return source('page', item, string(item.title) || 'Stránka Pracovne', joined([item.title, item.body])); });
    } },
    { name: 'Denné poznámky', path: '/api/calendar/notes?all=1', read: function (data) {
      return list(record(data).notes).map(function (item) { record(item); return source('daynote', item, string(item.title) || string(item.date) || 'Denná poznámka', joined([item.title, item.date, item.text])); });
    } },
    { name: 'Alchymistický stôl', path: '/api/desk', read: function (data) {
      return list(record(record(data).state).items).map(function (item) {
        record(item);
        if (item.type === 'note') return source('desk-note', item, string(item.name) || 'Lístok z alchymistického stola', joined([item.name, item.text]));
        if (item.type === 'image') return source('desk-photo', item, string(item.name) || 'Fotografia zo stola', string(item.name));
        throw Error('Zdroj vrátil neplatný typ položky.');
      });
    } },
    { name: 'Osobné štúdium', path: '/api/study', read: function (data) {
      return list(record(record(data).state).notes).map(function (item) { record(item); return source('study', item, string(item.title) || 'Poznámka zo štúdia', joined([item.title, item.text])); });
    } },
    { name: 'Knižnica', path: '/api/save', read: function (data) {
      return list(record(record(data).state).books).map(function (item) {
        record(item);
        var tags = item.tags == null ? '' : list(item.tags).map(string).join(' ');
        return source('book', item, string(item.title) || 'Kniha', joined([item.title, item.author, tags, item.notes]));
      });
    } },
    { name: 'Grimoár', path: function (query) { return '/api/knowledge/grimoire/search?q=' + encodeURIComponent(query); }, read: function (data) {
      return list(record(data).results).map(function (item) {
        record(item);
        if (!['grimoire-tab', 'grimoire-folder', 'grimoire-document', 'grimoire-favorite', 'grimoire-collection'].includes(item.kind)) {
          throw Error('Grimoár vrátil neplatný typ výsledku.');
        }
        return source(item.kind, item, string(item.title) || 'Grimoár', joined([item.title, item.text]));
      });
    } }
  ];

  function abortError() { var error = Error('Vyhľadávanie bolo zastavené.'); error.name = 'AbortError'; return error; }
  function checkAbort(signal) { if (signal && signal.aborted) throw abortError(); }
  async function readSource(config, request, signal, query) {
    checkAbort(signal);
    var response = await request(typeof config.path === 'function' ? config.path(query) : config.path, {
      method: 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-MO-Request': '1', 'Accept': 'application/json' }, signal: signal
    });
    checkAbort(signal);
    if (!response || !response.ok) {
      if (response && response.status === 401) throw Error('Otvor lokálnu hru a prihlás sa.');
      throw Error('Zdroj sa nepodarilo načítať' + (response && response.status ? ' (HTTP ' + response.status + ')' : '') + '.');
    }
    var data;
    try { data = await response.json(); } catch { throw Error('Zdroj vrátil neplatnú odpoveď.'); }
    checkAbort(signal);
    return config.read(data);
  }
  function snippet(text, range) {
    var start = Math.max(0, range.start - 70), end = Math.min(text.length, Math.max(range.end + 100, start + 200));
    // Avoid splitting surrogate pairs at the edges of a plain-text preview.
    if (start && /[\uDC00-\uDFFF]/.test(text[start])) start--;
    if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end])) end++;
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  async function search(query, options) {
    options = options || {};
    var signal = options.signal;
    checkAbort(signal);
    if (typeof query !== 'string' || !query.trim() || !folded(query.trim()).text.trim()) return { results: [], errors: ['Zadaj hľadané slovo.'] };
    query = query.trim();
    if (query.length > MAX_QUERY) return { results: [], errors: ['Vyhľadávanie môže mať najviac 150 znakov.'] };
    var request = options.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
    if (typeof request !== 'function') return { results: [], errors: ['Lokálne zdroje nie sú dostupné.'] };
    var matching = typeof options.findRanges === 'function' ? options.findRanges : findRanges;
    var selectedSources = sources.filter(function (config) { return !options.excludeGrimoire || config.name !== 'Grimoár'; });
    var responses = await Promise.all(selectedSources.map(async function (config) {
      try { return { items: await readSource(config, request, signal, query) }; }
      catch (error) {
        checkAbort(signal);
        if (error && error.name === 'AbortError') throw error;
        return { error: config.name + ': ' + (error && error.message || 'Zdroj sa nepodarilo načítať.') };
      }
    }));
    checkAbort(signal);
    var results = [], errors = [];
    responses.forEach(function (response) {
      if (response.error) { errors.push(response.error); return; }
      response.items.forEach(function (item) {
        var ranges = matching(item.text, query);
        if (!ranges.length || results.length >= MAX_RESULTS) return;
        results.push({ kind: item.kind, id: item.id, title: item.title, text: item.text, snippet: snippet(item.text, ranges[0]), occurrences: ranges.length,
          url: '/?knowledgeSearch=' + encodeURIComponent(query) + '&sourceKind=' + encodeURIComponent(item.kind) + '&sourceId=' + encodeURIComponent(item.id) + '#' + destinations[item.kind] });
      });
    });
    return { results: results, errors: errors };
  }

  return Object.freeze({ search: search, findRanges: findRanges });
});
