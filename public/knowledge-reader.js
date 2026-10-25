(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MOKnowledgeReader = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  var active = null, generation = 0;
  var MAX_FILE_BYTES = 15 * 1024 * 1024, MAX_RENDER_PIXELS = 8000000, MAX_TRANSCRIPT = 30000;
  var UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

  // Keep the original UTF-16 offsets while folding accents, ligatures and
  // punctuation. Highlight ranges always address the untouched source string.
  function normalizedOffsets(value) {
    var text = String(value == null ? '' : value), folded = '', starts = [], ends = [], offset = 0;
    for (var character of text) {
      var start = offset; offset += character.length;
      var pieces = character.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!pieces) { if (ends.length) ends[ends.length - 1] = offset; continue; }
      for (var piece of pieces) {
        if (/[\p{L}\p{N}]/u.test(piece)) {
          for (var unit = 0; unit < piece.length; unit++) { folded += piece[unit]; starts.push(start); ends.push(offset); }
        } else if (folded && folded[folded.length - 1] !== ' ') { folded += ' '; starts.push(start); ends.push(offset); }
        else if (ends.length && folded[folded.length - 1] === ' ') ends[ends.length - 1] = offset;
      }
    }
    if (folded.endsWith(' ')) { folded = folded.slice(0, -1); starts.pop(); ends.pop(); }
    return { text: folded, starts: starts, ends: ends };
  }
  function findMatches(text, query) {
    var source = normalizedOffsets(text), term = normalizedOffsets(query).text, matches = [];
    if (!term || !source.text) return matches;
    for (var offset = 0; offset <= source.text.length - term.length;) {
      var found = source.text.indexOf(term, offset); if (found < 0) break;
      var start = source.starts[found], end = source.ends[found + term.length - 1], previous = matches[matches.length - 1];
      if (!previous || previous.start !== start || previous.end !== end) matches.push({ start: start, end: end });
      offset = found + term.length;
    }
    return matches;
  }
  function element(tag, className, text) {
    var node = root.document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text; return node;
  }
  function button(text, title) { var node = element('button', 'kr-button', text); node.type = 'button'; if (title) node.title = title; return node; }
  function alive(state) { return active === state && state.generation === generation && !state.controller.signal.aborted; }
  function assertAlive(state) { if (!alive(state)) { var error = new Error('Čítačka bola zatvorená.'); error.name = 'AbortError'; throw error; } }
  function quiet(promise) { if (promise && typeof promise.catch === 'function') promise.catch(function () {}); }
  function destroy() {
    generation++;
    var state = active; active = null; if (!state) return;
    state.controller.abort(); state.renderSerial++;
    if (state.render) { try { state.render.cancel(); } catch (_) {} }
    if (state.pdfTask) { try { quiet(state.pdfTask.destroy()); } catch (_) {} }
    else if (state.pdf) { try { quiet(state.pdf.destroy()); } catch (_) {} }
    if (state.dialog.open && typeof state.dialog.close === 'function') state.dialog.close();
    state.dialog.remove();
    if (state.ownedBlobURL) root.URL.revokeObjectURL(state.ownedBlobURL);
    if (state.previousFocus && state.previousFocus.isConnected && typeof state.previousFocus.focus === 'function') state.previousFocus.focus({ preventScroll: true });
  }
  function safeOriginal(resource, original) {
    if (resource.assetId && new RegExp('^' + UUID + '$', 'i').test(resource.assetId)) return '/api/knowledge/files/' + resource.assetId;
    if (resource.mime === 'application/pdf') return '';
    var value = original && (original.photo || original.url || original.image) || '';
    if (typeof value !== 'string') return '';
    if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length <= 22 * 1024 * 1024) return value;
    try {
      var url = new root.URL(value, root.location.href);
      if (url.origin === root.location.origin && new RegExp('^/api/(?:knowledge/files|library/photos)/' + UUID + '$', 'i').test(url.pathname) && !url.search && !url.hash) return url.pathname;
    } catch (_) {}
    return '';
  }
  function localBlobURL(resource, original) {
    if (resource.assetId || typeof root.Blob !== 'function' || !(original.blob instanceof root.Blob)) return '';
    var blob = original.blob, mime = resource.mime || blob.type;
    if (!blob.size || blob.size > MAX_FILE_BYTES || blob.type !== mime || !/^(?:image\/(?:png|jpeg|webp)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|text\/(?:plain|markdown|csv|x-log))$/.test(mime)) return '';
    return root.URL.createObjectURL(blob);
  }
  function entries(resource, original) {
    if (resource.pagination === 'pages' && Array.isArray(resource.pages) && resource.pages.length) return resource.pages.map(function (page) { return { number: page.number, text: String(page.text || ''), hits: [] }; });
    return [{ number: null, text: typeof resource.text === 'string' ? resource.text : String(original && original.text || ''), hits: [] }];
  }
  function pageEntry(state) { return state.paged ? state.entries.find(function (entry) { return entry.number === state.currentPage; }) || { number: state.currentPage, text: '', hits: [] } : state.entries[0]; }
  function currentHit(state) { return state.hitIndex >= 0 ? state.hits[state.hitIndex] : null; }
  function addHighlight(parent, text, ranges, current) {
    var fragment = root.document.createDocumentFragment(), cursor = 0;
    ranges.forEach(function (range) {
      if (range.start < cursor || range.end <= range.start) return;
      fragment.append(root.document.createTextNode(text.slice(cursor, range.start)));
      var mark = element('mark', current && range.start === current.start && range.end === current.end ? 'kr-hit kr-hit-current' : 'kr-hit', text.slice(range.start, range.end));
      fragment.append(mark); cursor = range.end;
    });
    fragment.append(root.document.createTextNode(text.slice(cursor))); parent.append(fragment);
  }
  function renderTranscript(state) {
    var entry = pageEntry(state), hit = currentHit(state), selected = hit && hit.number === entry.number ? hit.range : null;
    state.transcript.replaceChildren();
    state.transcriptHeading.textContent = state.paged ? 'Prepis skutočnej strany ' + entry.number : 'Text dokumentu · bez pevného stránkovania';
    state.transcriptNote.textContent = state.resource.analysisStatus !== 'indexed' ? 'Prepis ešte nie je úplný. Vyhľadávajú sa uložené časti textu.' : '';
    if (!entry.text) { state.transcript.append(element('p', 'kr-muted', 'Táto strana ešte nemá uložený prepis. Pôvodný dokument zostáva dostupný.')); return; }
    var start = entry.text.length > MAX_TRANSCRIPT ? Math.max(0, Math.min(entry.text.length - MAX_TRANSCRIPT, (selected ? selected.start : 0) - 3000)) : 0;
    var end = Math.min(entry.text.length, start + MAX_TRANSCRIPT), text = entry.text.slice(start, end);
    var ranges = entry.hits.filter(function (range) { return range.start >= start && range.end <= end; }).map(function (range) { return { start: range.start - start, end: range.end - start }; });
    var selectedRange = selected && selected.start >= start ? { start: selected.start - start, end: selected.end - start } : null;
    if (start) state.transcript.append(root.document.createTextNode('…\n'));
    addHighlight(state.transcript, text, ranges, selectedRange);
    if (end < entry.text.length) state.transcript.append(root.document.createTextNode('\n…'));
    if (start || end < entry.text.length) state.transcriptNote.textContent += ' Zobrazený je výrez prepisu; ďalší výskyt otvorí príslušnú časť.';
    var selectedMark = state.transcript.querySelector('.kr-hit-current');
    if (selectedMark) selectedMark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderConcepts(state) {
    state.chips.replaceChildren();
    var queryIds = [], model = root.MOKnowledgeModel;
    if (state.query.trim() && model) {
      try { queryIds = model.analyzeResource({ title: state.query, text: state.query, manualConceptIds: [], excludedConceptIds: [], analysisStatus: 'indexed' }, state.concepts).resource.conceptIds; } catch (_) {}
    }
    var ids = Array.from(new Set(queryIds.concat(state.resource.conceptIds || [])));
    ids.forEach(function (id) {
      var concept = state.concepts.find(function (item) { return item.id === id; }); if (!concept) return;
      var chip = button(concept.name, 'Prejsť na oblasť ' + concept.name); chip.classList.add('kr-concept');
      if (queryIds.indexOf(id) >= 0) chip.classList.add('kr-concept-match');
      chip.addEventListener('click', function () { var callback = state.onConcept, query = state.query; destroy(); if (typeof callback === 'function') quiet(Promise.resolve(callback(id, query))); });
      state.chips.append(chip);
    });
    if (!state.chips.children.length) state.chips.append(element('p', 'kr-muted', 'Pre toto slovo zatiaľ nie je priradená oblasť.'));
    if (typeof state.onQuery === 'function' && state.query.trim()) {
      var mapSearch = button('Nájsť slovo v mape', 'Prejsť od hľadaného slova k pojmovej mape');
      mapSearch.addEventListener('click', function () { var callback = state.onQuery, query = state.query; destroy(); quiet(Promise.resolve(callback(query))); }); state.chips.append(mapSearch);
    }
  }
  function controls(state) {
    state.count.textContent = !state.query.trim() ? 'Napíš hľadané slovo' : state.hits.length ? (state.hitIndex + 1) + ' / ' + state.hits.length + ' výskytov' : 'Žiadny výskyt';
    state.previousHit.disabled = state.nextHit.disabled = !state.hits.length;
    if (state.pdf) {
      state.pageLabel.textContent = 'Strana ' + state.currentPage + ' / ' + state.pdf.numPages;
      state.pageInput.value = state.currentPage; state.pageInput.max = state.pdf.numPages;
      state.previousPage.disabled = state.currentPage <= 1; state.nextPage.disabled = state.currentPage >= state.pdf.numPages;
    } else if (!state.isPdf) state.pageLabel.textContent = state.paged ? 'Strana ' + state.currentPage + ' podľa uloženého prepisu' : 'Dokument bez pevného stránkovania';
  }
  function nativeText(content) {
    var text = '', records = [];
    content.items.forEach(function (item) {
      if (typeof item.str !== 'string') return;
      records.push({ item: item, start: text.length, end: text.length + item.str.length }); text += item.str + (item.hasEOL ? '\n' : ' ');
    });
    return { text: text, records: records };
  }
  function renderTextOverlay(state, cache) {
    if (!alive(state) || !cache || cache.number !== state.currentPage) return;
    state.layer.replaceChildren();
    var native = nativeText(cache.content), matches = findMatches(native.text, state.query), selected = currentHit(state), entry = pageEntry(state);
    var pageOrdinal = selected && selected.number === cache.number ? entry.hits.findIndex(function (range) { return range.start === selected.range.start && range.end === selected.range.end; }) : -1;
    var isSameText = normalizedOffsets(native.text).text === normalizedOffsets(entry.text).text;
    var selectedNative = isSameText && pageOrdinal >= 0 ? matches[pageOrdinal] : null;
    var measure = root.document.createElement('canvas').getContext('2d');
    native.records.forEach(function (record) {
      var item = record.item, ranges = matches.filter(function (range) { return range.start < record.end && range.end > record.start; }).map(function (range) { return { start: Math.max(0, range.start - record.start), end: Math.min(item.str.length, range.end - record.start) }; });
      // These positions are derived from PDF text matrices and the actual page
      // viewport, using the same ascent/rotation logic as a PDF text layer.
      var style = cache.content.styles[item.fontName] || {}, matrix = state.library.Util.transform(cache.viewport.transform, item.transform);
      var angle = Math.atan2(matrix[1], matrix[0]); if (style.vertical) angle += Math.PI / 2;
      var fontHeight = Math.hypot(matrix[2], matrix[3]), ascent = fontHeight * (typeof style.ascent === 'number' ? style.ascent : typeof style.descent === 'number' ? 1 + style.descent : 0.8);
      if (!fontHeight || !Number.isFinite(fontHeight)) return;
      var family = style.fontFamily || 'sans-serif', span = element('span', 'kr-pdf-text');
      span.style.left = (matrix[4] + ascent * Math.sin(angle)) + 'px'; span.style.top = (matrix[5] - ascent * Math.cos(angle)) + 'px';
      span.style.fontSize = fontHeight + 'px'; span.style.fontFamily = family;
      var scale = 1;
      if (measure) { measure.font = fontHeight + 'px ' + family; var measured = measure.measureText(item.str).width; if (measured > 0) scale = (style.vertical ? item.height : item.width) * cache.viewport.scale / measured; }
      span.style.transform = 'rotate(' + angle + 'rad) scaleX(' + scale + ')';
      var localCurrent = selectedNative && selectedNative.start < record.end && selectedNative.end > record.start ? { start: Math.max(0, selectedNative.start - record.start), end: Math.min(item.str.length, selectedNative.end - record.start) } : null;
      addHighlight(span, item.str, ranges, localCurrent); state.layer.append(span);
    });
    if (!native.text.trim()) state.transcriptHeading.textContent = 'Rozpoznaný prepis skenovanej strany ' + cache.number;
    else if (entry.number !== null) state.transcriptHeading.textContent = 'Uložený textový prepis strany ' + cache.number;
    if (selected && selected.number === cache.number && !matches.length) state.transcriptNote.textContent = 'Výskyt je zvýraznený v uloženom prepise. Na obraze strany sa jeho poloha nedá spoľahlivo určiť.';
    else if (!isSameText && entry.text && native.text.trim()) state.transcriptNote.textContent += ' Uložený prepis môže obsahovať tvoje opravy; na strane sú zvýraznené zodpovedajúce pôvodné slová.';
  }
  function showError(state, message) { if (alive(state)) { state.message.textContent = message; state.message.setAttribute('role', 'alert'); } }
  async function renderPdfPage(state, number) {
    if (!alive(state) || !state.pdf) return;
    number = Math.max(1, Math.min(state.pdf.numPages, Math.trunc(Number(number)) || 1)); state.currentPage = number;
    controls(state); renderTranscript(state);
    if (state.cache && state.cache.number === number && state.cache.zoom === state.zoom) { renderTextOverlay(state, state.cache); return; }
    var serial = ++state.renderSerial;
    if (state.render) { try { state.render.cancel(); } catch (_) {} }
    state.cache = null; state.layer.replaceChildren(); state.message.textContent = 'Načítavam skutočnú stranu ' + number + '…';
    try {
      var page = await state.pdf.getPage(number); assertAlive(state); if (serial !== state.renderSerial) return;
      var natural = page.getViewport({ scale: 1 }), available = Math.max(280, Math.min(1300, state.preview.clientWidth - 32)), ratio = Math.min(2, root.devicePixelRatio || 1);
      if (![natural.width, natural.height].every(function (value) { return Number.isFinite(value) && value > 0; })) throw new Error('Strana PDF nemá platné rozmery.');
      var scale = available / natural.width * state.zoom;
      scale = Math.min(scale, 8192 / (natural.width * ratio), 8192 / (natural.height * ratio), Math.sqrt(MAX_RENDER_PIXELS / (natural.width * natural.height * ratio * ratio)));
      var viewport = page.getViewport({ scale: scale }), canvas = element('canvas', 'kr-pdf-canvas'); canvas.setAttribute('aria-label', 'Pôvodné PDF, skutočná strana ' + number);
      canvas.width = Math.max(1, Math.floor(viewport.width * ratio)); canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
      canvas.style.width = viewport.width + 'px'; canvas.style.height = viewport.height + 'px';
      state.sheet.style.width = viewport.width + 'px'; state.sheet.style.height = viewport.height + 'px';
      state.layer.style.width = viewport.width + 'px'; state.layer.style.height = viewport.height + 'px';
      var oldCanvas = state.sheet.querySelector('canvas'); if (oldCanvas) oldCanvas.remove(); state.sheet.prepend(canvas);
      var context = canvas.getContext('2d', { alpha: false }); if (!context) throw new Error('Prehliadač nevie zobraziť obraz strany.');
      var task = page.render({ canvasContext: context, canvas: canvas, viewport: viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); state.render = task;
      var values = await Promise.all([task.promise, page.getTextContent()]); assertAlive(state); if (serial !== state.renderSerial) return;
      state.render = null; state.cache = { number: number, zoom: state.zoom, content: values[1], viewport: viewport }; state.message.textContent = '';
      renderTextOverlay(state, state.cache);
    } catch (error) { if (alive(state) && serial === state.renderSerial && error.name !== 'RenderingCancelledException') showError(state, 'Stranu sa nepodarilo zobraziť. Uložený prepis a stiahnutie originálu zostávajú dostupné.'); }
  }
  async function loadPdf(state) {
    try {
      if (!state.originalURL) throw new Error('Pôvodný PDF súbor nie je dostupný.');
      if (!root.MOKnowledgeExtract || typeof root.MOKnowledgeExtract.getPdfLibrary !== 'function') throw new Error('Miestny nástroj na zobrazenie PDF nie je pripravený.');
      state.message.textContent = 'Otváram súkromný dokument PDF…';
      var values = await Promise.all([root.MOKnowledgeExtract.getPdfLibrary(), root.fetch(state.originalURL, { credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store', signal: state.controller.signal })]);
      assertAlive(state); var response = values[1];
      if (!response.ok) throw new Error('Pôvodný súkromný súbor sa nepodarilo načítať.');
      if (Number(response.headers.get('Content-Length') || 0) > MAX_FILE_BYTES) throw new Error('PDF presahuje povolenú veľkosť.');
      var bytes = new Uint8Array(await response.arrayBuffer()); assertAlive(state);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('PDF presahuje povolenú veľkosť.');
      state.library = values[0];
      function asset(path) { return new root.URL('/vendor/knowledge/' + path, root.location.href).href; }
      state.pdfTask = state.library.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false, useSystemFonts: true, cMapUrl: asset('cmaps/'), cMapPacked: true, standardFontDataUrl: asset('standard_fonts/'), wasmUrl: asset('wasm/'), iccUrl: asset('iccs/'), useWorkerFetch: true, disableAutoFetch: true });
      state.pdf = await state.pdfTask.promise; assertAlive(state);
      if (!Number.isInteger(state.pdf.numPages) || state.pdf.numPages < 1) throw new Error('PDF nemá čitateľné strany.');
      state.pageControls.hidden = false;
      var hit = currentHit(state); await renderPdfPage(state, hit && hit.number !== null ? hit.number : 1);
      if (!state.paged) state.transcriptNote.textContent = 'Uložený prepis nemá hranice strán. Pre presné výsledky podľa strán dokument znovu analyzuj.';
    } catch (error) { if (alive(state) && error.name !== 'AbortError') showError(state, error.message + ' Uložený text a stiahnutie originálu zostávajú dostupné.'); }
  }
  function selectHit(state, index) {
    if (!state.hits.length) { state.hitIndex = -1; controls(state); renderTranscript(state); if (state.cache) renderTextOverlay(state, state.cache); return; }
    state.hitIndex = (index + state.hits.length) % state.hits.length;
    var hit = currentHit(state); if (hit.number !== null) state.currentPage = hit.number;
    controls(state); renderTranscript(state);
    if (state.pdf) quiet(renderPdfPage(state, state.currentPage));
  }
  function search(state) {
    state.query = state.search.value; state.hits = [];
    state.entries.forEach(function (entry) { entry.hits = findMatches(entry.text, state.query); entry.hits.forEach(function (range) { state.hits.push({ number: entry.number, range: range }); }); });
    renderConcepts(state); selectHit(state, 0);
  }
  function open(resource, options) {
    options = options || {}; destroy();
    if (!root.document || !root.document.body) throw new Error('Čítačka potrebuje otvorenú hru v prehliadači.');
    var dialog = element('dialog', 'knowledge-reader'), original = typeof options.original === 'string' ? { url: options.original } : options.original || {};
    var state = { generation: generation, resource: resource, original: original, originalURL: safeOriginal(resource, original), concepts: options.concepts || [], onConcept: options.onConcept, controller: new root.AbortController(), dialog: dialog, previousFocus: root.document.activeElement, entries: entries(resource, original), hits: [], hitIndex: -1, query: '', currentPage: 1, isPdf: resource.mime === 'application/pdf', pdf: null, pdfTask: null, render: null, renderSerial: 0, zoom: 1, cache: null };
    state.ownedBlobURL = localBlobURL(resource, original); if (state.ownedBlobURL) state.originalURL = state.ownedBlobURL; state.onQuery = options.onQuery;
    state.paged = state.entries[0].number !== null; if (state.paged) state.currentPage = state.entries[0].number;
    active = state; dialog.setAttribute('aria-labelledby', 'kr-title');
    var header = element('header', 'kr-header'), heading = element('div'), title = element('h2', '', resource.title || 'Čítačka dokumentu'); title.id = 'kr-title';
    heading.append(element('p', 'kr-eyebrow', 'SÚKROMNÁ ČÍTAČKA'), title); header.append(heading);
    var actions = element('div', 'kr-header-actions');
    if (state.originalURL) { var download = element('a', 'kr-button', 'Stiahnuť originál'); download.href = state.originalURL; download.download = original.name || resource.title || 'dokument'; actions.append(download); }
    var close = button('Zavrieť ×', 'Zavrieť čítačku'); close.addEventListener('click', destroy); actions.append(close); header.append(actions);
    var toolbar = element('div', 'kr-toolbar'), searchLabel = element('label', 'kr-search-label', 'Nájsť v dokumente');
    state.search = element('input', 'kr-search'); state.search.type = 'search'; state.search.maxLength = 200; state.search.placeholder = 'Slovo alebo fráza…'; state.search.autocomplete = 'off'; state.search.value = String(options.query || '').slice(0, 200); searchLabel.append(state.search); toolbar.append(searchLabel);
    state.previousHit = button('↑', 'Predchádzajúci výskyt · Shift + F3'); state.nextHit = button('↓', 'Ďalší výskyt · F3'); state.count = element('output', 'kr-count'); state.count.setAttribute('aria-live', 'polite');
    state.previousHit.addEventListener('click', function () { selectHit(state, state.hitIndex - 1); }); state.nextHit.addEventListener('click', function () { selectHit(state, state.hitIndex + 1); }); toolbar.append(state.previousHit, state.nextHit, state.count);
    state.pageControls = element('div', 'kr-page-controls'); state.pageControls.hidden = true;
    state.previousPage = button('‹', 'Predchádzajúca strana'); state.nextPage = button('›', 'Ďalšia strana'); state.pageInput = element('input', 'kr-page-input'); state.pageInput.type = 'number'; state.pageInput.min = '1'; state.pageInput.setAttribute('aria-label', 'Prejsť na skutočnú stranu PDF');
    state.previousPage.addEventListener('click', function () { quiet(renderPdfPage(state, state.currentPage - 1)); }); state.nextPage.addEventListener('click', function () { quiet(renderPdfPage(state, state.currentPage + 1)); }); state.pageInput.addEventListener('change', function () { quiet(renderPdfPage(state, state.pageInput.value)); });
    var zoomOut = button('−', 'Zmenšiť stranu'), zoomIn = button('+', 'Zväčšiť stranu');
    zoomOut.addEventListener('click', function () { state.zoom = Math.max(0.5, state.zoom - 0.25); quiet(renderPdfPage(state, state.currentPage)); }); zoomIn.addEventListener('click', function () { state.zoom = Math.min(3, state.zoom + 0.25); quiet(renderPdfPage(state, state.currentPage)); });
    state.pageControls.append(state.previousPage, state.pageInput, state.nextPage, zoomOut, zoomIn); toolbar.append(state.pageControls);
    var location = element('div', 'kr-location'); state.pageLabel = element('span'); state.message = element('span', 'kr-message'); state.message.setAttribute('aria-live', 'polite'); location.append(state.pageLabel, state.message);
    var body = element('div', 'kr-body'), documentArea = element('main', 'kr-document');
    state.preview = element('section', 'kr-preview'); state.preview.setAttribute('aria-label', 'Pôvodný dokument'); state.sheet = element('div', 'kr-pdf-sheet'); state.layer = element('div', 'kr-pdf-layer'); state.layer.setAttribute('aria-hidden', 'true'); state.sheet.append(state.layer); state.preview.append(state.sheet);
    if (!state.isPdf) {
      state.sheet.hidden = true;
      if (state.originalURL && /^image\//.test(resource.mime || original.mime || '')) { var image = element('img', 'kr-photo'); image.src = state.originalURL; image.alt = resource.title || 'Pôvodná súkromná fotografia'; image.addEventListener('error', function () { showError(state, 'Pôvodnú fotografiu sa nepodarilo načítať. Uložený prepis zostáva dostupný.'); }); state.preview.append(image); }
      else state.preview.hidden = true;
    }
    var transcriptSection = element('section', 'kr-transcript-section'); state.transcriptHeading = element('h3'); state.transcriptNote = element('p', 'kr-muted'); state.transcript = element('div', 'kr-transcript'); state.transcript.tabIndex = 0; state.transcript.setAttribute('aria-label', 'Vyhľadateľný prepis dokumentu');
    transcriptSection.append(state.transcriptHeading, state.transcriptNote, state.transcript); documentArea.append(state.preview, transcriptSection);
    var sidebar = element('aside', 'kr-sidebar'); sidebar.append(element('h3', '', 'Od slova k poznaniu'), element('p', 'kr-muted', 'Dvojklikom vyber slovo v texte. Potom otvor jeho oblasť v pojmovej mape.')); state.chips = element('div', 'kr-concepts'); sidebar.append(state.chips); body.append(documentArea, sidebar);
    dialog.append(header, toolbar, location, body); root.document.body.append(dialog);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); destroy(); }); dialog.addEventListener('close', function () { if (active === state) destroy(); });
    dialog.addEventListener('keydown', function (event) {
      if (event.key === 'F3' || (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp'))) { event.preventDefault(); selectHit(state, state.hitIndex + (event.shiftKey || event.key === 'ArrowUp' ? -1 : 1)); }
      if (event.target === state.search && event.key === 'Enter') { event.preventDefault(); selectHit(state, state.hitIndex + (event.shiftKey ? -1 : 1)); }
    });
    documentArea.addEventListener('dblclick', function () { var selection = root.getSelection && String(root.getSelection()).trim(); if (selection && selection.length <= 120) { state.search.value = selection; search(state); } });
    state.search.addEventListener('input', function () { search(state); });
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    search(state); if (state.isPdf) quiet(loadPdf(state)); state.search.focus({ preventScroll: true });
    return dialog;
  }
  return Object.freeze({ open: open, destroy: destroy, findMatches: findMatches });
});
