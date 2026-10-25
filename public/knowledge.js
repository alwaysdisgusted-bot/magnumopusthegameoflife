(() => {
  'use strict';
  const A = () => window.MOApp, auth = () => window.MOAuth, M = () => window.MOKnowledgeModel;
  const esc = value => A().esc(String(value ?? '')), clone = value => structuredClone(value), fold = value => M().normalize(String(value || ''));
  const labels = { upload: 'Nahraný dokument', book: 'Kniha', page: 'Osobná stránka', daynote: 'Denná poznámka', study: 'Osobné štúdium', 'library-photo': 'Fotografia knižnice', 'desk-photo': 'Fotografia stola' };
  let data = M().createState(), revision = 0, accountId = '', generation = 0;
  let loaded = false, loading = false, saving = false, active = false, conflict = false, error = '', selected = '', query = '', filter = 'all';
  let draft = null, pending = null, task = null, taskSerial = 0, status = '', sourceErrors = [];
  let mapPose = { x: 0, y: 0, scale: 1 }, mapSignature = '', mapBounds = { width: 1000, height: 500 };
  let studyState = null, studyRevision = 0, wantedStudyId = '', surface = 'knowledge', studyStale = false;
  const studyPositions = [[50,8],[80,21],[20,21],[80,40],[20,40],[50,49],[80,65],[20,65],[50,79],[50,94]];
  const studyEdges = [[0,1],[0,2],[0,5],[1,2],[1,3],[1,5],[2,4],[2,5],[3,4],[3,5],[3,6],[4,5],[4,7],[5,6],[5,7],[5,8],[6,7],[6,8],[6,9],[7,8],[7,9],[8,9]];
  const originals = new Map(), held = new Map();
  function reset() {
    generation++; taskSerial++; window.MOKnowledgeExtract?.cancel(); window.MOKnowledgeReader?.destroy?.(); data = M().createState(); revision = 0;
    loaded = loading = saving = conflict = false; error = ''; selected = ''; query = ''; filter = 'all';
    draft = pending = task = null; status = ''; sourceErrors = []; originals.clear(); mapSignature = ''; studyState = null; studyRevision = 0; wantedStudyId = ''; studyStale = false;
  }
  function sync() {
    const id = auth().getAccount()?.id || '';
    if (id !== accountId) { reset(); accountId = id; if (held.has(id)) { const value = held.get(id); draft = value.draft; pending = value.pending; held.delete(id); } }
    return !!id;
  }
  function context() {
    const gen = generation, id = accountId;
    return () => { if (gen !== generation || !id || auth().getAccount()?.id !== id) { const e = Error('Prihlásenie sa zmenilo.'); e.name = 'AbortError'; throw e; } };
  }
  async function api(path, options) { const check = context(); check(); const result = await auth().api(path, options); check(); return result; }
  function redraw() { if (active) A().render(); }
  function setStatus(message) { status = String(message || ''); const el = document.querySelector('[data-knowledge-status]'); if (el) el.textContent = status; }
  function assertWritable() {
    if (!loaded || loading || saving) throw Error('Počkaj na načítanie alebo uloženie mapy poznania.');
    if (studyStale) throw Error('Predmety v Osobnom štúdiu sa zmenili. Obnov mapu pred uložením; rozpísaný návrh zostane zachovaný.');
    if (task) throw Error('Počkaj na dokončenie alebo zastavenie analýzy.');
    if (conflict) throw Error('Mapa sa zmenila v inom okne. Načítaj uloženú verziu; tvoj návrh zostane zachovaný.');
    if (pending) throw Error('Najprv ulož alebo obnov čakajúci návrh. Jeho obsah môžeš aj stiahnuť.');
  }
  async function load() {
    if (loading || !accountId) return; const check = context(); loading = true; error = '';
    try {
      const results = await Promise.allSettled([api('/api/knowledge'), api('/api/study')]); check();
      if (results[0].status !== 'fulfilled') throw results[0].reason;
      if (results[1].status === 'fulfilled' && Array.isArray(results[1].value.state?.categories)) { studyState = results[1].value.state; studyRevision = results[1].value.revision; studyStale = false; }
      else sourceErrors = ['Osobné štúdium sa nepodarilo načítať. Mapa si ponechala dostupné oblasti; obnov ju pred úpravou predmetov.'];
      const result = results[0].value, state = clone(result.state);
      state.concepts = M().mergeCatalog(state.concepts);
      data = M().validateState(syncStudy(state)); revision = result.revision; loaded = true; conflict = false;
      if (wantedStudyId) { selected = data.concepts.find(c => c.studyCategoryId === wantedStudyId)?.id || ''; wantedStudyId = ''; }
      if (selected && !data.concepts.some(c => c.id === selected)) selected = '';
    }
    catch (e) { try { check(); error = e.message; } catch (_) {} }
    finally { try { check(); loading = false; redraw(); } catch (_) {} }
  }
  async function persist(next, message, base = data) {
    const check = context(); let clean;
    try { clean = M().validateState(syncStudy(next)); }
    catch (e) { check(); pending = { base: clone(base), next: clone(next), baseRevision: revision }; error = e.message; redraw(); throw e; }
    if (saving || !loaded || conflict) throw Error(conflict ? 'Načítaj uloženú verziu pred ďalším uložením.' : 'Počkaj na načítanie alebo uloženie.');
    const baseRevision = revision; pending = { base: clone(base), next: clone(clean), baseRevision }; saving = true; lockEditor(true);
    try {
      const result = await api('/api/knowledge', { method: 'PUT', body: { state: clean, expectedRevision: revision } }); check();
      data = M().validateState(result.state || clean); revision = result.revision; pending = null; error = ''; conflict = false; if (message) A().toast(message); return true;
    } catch (e) {
      try { check(); pending = { base: clone(base), next: clone(clean), baseRevision }; if (e.status === 409 || e.code === 'revision_conflict') conflict = true; error = e.message; } catch (_) {} throw e;
    } finally { try { check(); saving = false; lockEditor(false); redraw(); } catch (_) {} }
  }
  function lockEditor(locked) { document.querySelectorAll('#knowledge-editor-form input,#knowledge-editor-form textarea,#knowledge-editor-form select,#knowledge-editor-form button').forEach(el => { el.disabled = locked; }); }
  function analyze(state, resource) { const result = M().analyzeResource(resource, state.concepts); state.concepts = result.concepts; return result.resource; }
  function analyzeAll(state) { state.resources = state.resources.map(resource => analyze(state, resource)); return state; }
  function syncStudy(state) {
    if (!studyState) return state; const mapping = new Map(), used = new Set();
    for (const category of studyState.categories) {
      let concept = state.concepts.find(c => c.studyCategoryId === category.id) || state.concepts.find(c => !c.studyCategoryId && !used.has(c.id) && fold(c.name) === fold(category.name));
      if (!concept) { concept = { id: 'study--' + category.id, parentId: null, name: category.name, keywords: [...category.keywords], studyCategoryId: category.id }; state.concepts.push(concept); }
      concept.studyCategoryId = category.id; concept.name = category.name; concept.keywords = [...category.keywords]; mapping.set(category.id, concept); used.add(concept.id);
    }
    const catalog = new Map(M().catalogConcepts().map(concept => [concept.id, concept]));
    for (const category of studyState.categories) {
      const concept = mapping.get(category.id), taxonomy = catalog.get(concept.id);
      concept.parentId = category.parentId ? mapping.get(category.parentId)?.id || null : taxonomy?.parentId ?? null;
    }
    for (const concept of state.concepts) if (concept.studyCategoryId && !mapping.has(concept.studyCategoryId)) concept.studyCategoryId = null;
    const main = studyState.categories.filter(c => c.parentId === null);
    for (const concept of state.concepts.filter(c => !c.studyCategoryId && c.parentId === null)) {
      const words = [concept.name, ...concept.keywords].map(fold), matching = main.filter(category => category.id === concept.id || [category.name, ...category.keywords].map(fold).some(word => words.includes(word)));
      if (matching.length === 1) concept.parentId = mapping.get(matching[0].id).id;
    }
    return state;
  }
  function graphLabel(name) {
    const words = String(name).split(/\s+/), lines = []; let line = '';
    words.forEach(word => { if ((line + ' ' + word).trim().length > 15 && line) { lines.push(line); line = ''; } if (word.length > 15) { if (line) { lines.push(line); line = ''; } while (word.length > 15) { lines.push(word.slice(0, 15)); word = word.slice(15); } } line = (line + ' ' + word).trim(); }); if (line) lines.push(line);
    return lines.slice(0, 3).map((text, index, all) => `<tspan x="0" dy="${index ? 17 : -((all.length - 1) * 8)}">${esc(text + (index === 2 && lines.length > 3 ? '…' : ''))}</tspan>`).join('');
  }
  function graph() {
    const nodes = new Map(), roots = M().sephirot.map((lore, slot) => ({ slot, conceptId: 'sefirah-' + lore.id }));
    for (const root of roots) {
      if (!data.concepts.some(concept => concept.id === root.conceptId)) continue;
      const position = studyPositions[root.slot];
      nodes.set(root.conceptId, { x: position[0] * 10, y: position[1] * 7, root: true, slot: root.slot });
    }
    let unbound = 0;
    for (const concept of data.concepts.filter(c => c.parentId === null && !nodes.has(c.id))) { nodes.set(concept.id, { x: 1150 + Math.floor(unbound / 5) * 220, y: 100 + (unbound % 5) * 150, root: false }); unbound++; }
    function children(parent, depth) {
      const siblings = data.concepts.filter(c => c.parentId === parent), p = nodes.get(parent); if (!p || depth > 30) return;
      siblings.forEach((child, i) => { const side = p.x >= 500 ? 1 : -1, spread = (i - (siblings.length - 1) / 2) * 110; nodes.set(child.id, { x: p.x + side * (145 + (depth > 1 ? 10 : 0)), y: p.y + spread + 40, root: false }); children(child.id, depth + 1); });
    }
    [...nodes.keys()].forEach(id => children(id, 1));
    const coordinates = [...nodes.values()], minX = Math.min(70, ...coordinates.map(p => p.x - 75)), minY = Math.min(0, ...coordinates.map(p => p.y - 75)), maxX = Math.max(930, ...coordinates.map(p => p.x + 75)), maxY = Math.max(730, ...coordinates.map(p => p.y + 75));
    mapBounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const signature = data.concepts.map(c => c.id + ':' + c.parentId).join('|');
    if (signature !== mapSignature) { mapSignature = signature; fitMap(); }
    const kabbalah = studyEdges.map(([a, b]) => `<line class="knowledge-kabbalah-edge" x1="${studyPositions[a][0] * 10}" y1="${studyPositions[a][1] * 7}" x2="${studyPositions[b][0] * 10}" y2="${studyPositions[b][1] * 7}"/>`).join('');
    const edges = data.concepts.filter(c => c.parentId && nodes.has(c.id) && nodes.has(c.parentId)).map(c => { const a = nodes.get(c.parentId), b = nodes.get(c.id); return `<line class="knowledge-topic-edge" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`; }).join('');
    const empty = studyPositions.map(([x, y], slot) => {
      const lore = M().sephirot[slot];
      if (data.concepts.some(c => c.id === roots[slot].conceptId)) return '';
      return `<g class="knowledge-graph-node empty" transform="translate(${x * 10} ${y * 7})" role="button" tabindex="0" data-action="knowledge-study-room" aria-label="${esc(lore.name + ' · ' + lore.translation + ' · voľné miesto osobného predmetu')}"><circle r="47"/><text class="knowledge-graph-sephirah" text-anchor="middle" y="-11">${esc(lore.name)}</text><text text-anchor="middle" y="17">＋</text></g>`;
    }).join('');
    return `<div class="knowledge-map-controls">${button('map-out', '−', '', 'secondary small')}${button('map-in', '＋', '', 'secondary small')}${button('map-fit', 'Celý strom', '', 'secondary small')}${button('study-room', 'Upraviť hlavné predmety', '', 'ghost small')}</div><div class="knowledge-map-viewport" tabindex="0" aria-label="Dvojrozmerná mapa vedeckých pojmov inšpirovaná Stromom života. Ťahaním posúvaš, kolieskom približuješ. Šípky posúvajú, plus a mínus približujú, Home zobrazí celý strom."><svg class="knowledge-graph" viewBox="0 0 1000 760" role="group" aria-label="Vedecké odbory, podoblasti a schematické vzťahy desiatich Sefirot"><g data-knowledge-map-layer transform="translate(${mapPose.x} ${mapPose.y}) scale(${mapPose.scale})">${kabbalah}${edges}${empty}${data.concepts.map(c => { const p = nodes.get(c.id); if (!p) return ''; const lore = p.root ? M().sephirot[p.slot] : null, loreLabel = lore ? `${lore.name} · ${lore.translation}` : ''; return `<g class="knowledge-graph-node ${p.root ? 'root' : 'topic'} ${selected === c.id ? 'selected' : ''}" transform="translate(${p.x} ${p.y})" role="button" tabindex="0" data-action="knowledge-select" data-id="${esc(c.id)}" aria-label="${esc(c.name + (lore ? ' · ' + loreLabel : '') + ' · ' + conceptCount(c.id) + ' zdrojov')}" ${selected === c.id ? 'aria-current="true"' : ''}><title>${esc(pathFor(c.id, draft?.concepts || data.concepts).map(p => p.name).join(' › ') + (lore ? ` · ${loreLabel}: ${lore.meaning} · ${lore.scienceLens}` : '') + ` · ${conceptCount(c.id)} zdrojov`)}</title><circle r="${p.root ? 57 : 49}"/>${lore ? `<text class="knowledge-graph-sephirah" text-anchor="middle" y="-12">${esc(lore.name)}</text><text text-anchor="middle" y="12">${graphLabel(lore.translation)}</text>` : `<text text-anchor="middle">${graphLabel(c.name)}</text>`}<text class="knowledge-graph-count" text-anchor="middle" y="${p.root ? 43 : 37}">${conceptCount(c.id)} zdrojov</text></g>`; }).join('')}</g></svg></div><p class="form-hint">Desať uzlov Sefirot tvorí stálu orientačnú kostru; vedecké oblasti sú pripojené ako moderná interpretačná vrstva, nie ako tradičné kabalistické učenie. Spojnice znázorňujú jednu schematickú cestovú konfiguráciu; tradície a diagramy sa líšia a táto mapa nepriraďuje hebrejské písmená. Vedecké triedenie vychádza z FOS 2007; kľúčové slová sa párujú doslovne, nejde o AI sémantiku.</p><details class="knowledge-accessible-tree"><summary>Všetky odbory a podoblasti v zozname</summary>${outlineTree()}</details>`;
  }
  function fitMap() { const scale = Math.max(.08, Math.min(1, 900 / mapBounds.width, 650 / mapBounds.height)); mapPose = { scale, x: 500 - (mapBounds.x + mapBounds.width / 2) * scale, y: 380 - (mapBounds.y + mapBounds.height / 2) * scale }; }
  function applyMapPose() { document.querySelector('[data-knowledge-map-layer]')?.setAttribute('transform', `translate(${mapPose.x} ${mapPose.y}) scale(${mapPose.scale})`); }
  function zoomMap(factor, x = 500, y = 380) { const previous = mapPose.scale, next = Math.max(.08, Math.min(5, previous * factor)), ratio = next / previous; mapPose.x = x - (x - mapPose.x) * ratio; mapPose.y = y - (y - mapPose.y) * ratio; mapPose.scale = next; applyMapPose(); }
  function descendants(id) {
    const ids = new Set(id ? [id] : []); let changed = true;
    while (changed) { changed = false; data.concepts.forEach(c => { if (ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); changed = true; } }); } return ids;
  }
  function pathFor(id, concepts = data.concepts) {
    const path = [], seen = new Set(); let current = concepts.find(c => c.id === id);
    while (current && !seen.has(current.id)) { path.unshift(current); seen.add(current.id); current = concepts.find(c => c.id === current.parentId); } return path;
  }
  function button(action, label, id = '', style = 'secondary small', disabled = false) { return `<button type="button" class="btn ${style}" data-action="knowledge-${action}"${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${label}</button>`; }
  function conceptCount(id) { return M().resourcesUnder(data, id).length; }
  function sephirotGuide() {
    const fosFields = [
      ['natural-sciences', 'Chokhmah'], ['engineering-technology', 'Netzach'],
      ['medical-health-sciences', 'Chesed'], ['agricultural-sciences', 'Malkhut'],
      ['social-sciences', 'Tiferet'], ['humanities', 'Hod']
    ].map(([id, sefira]) => {
      const concept = data.concepts.find(item => item.id === id);
      return concept ? `<li><strong>${esc(concept.name)}</strong><span>FOS 2007 · interpretačne pri ${esc(sefira)}</span></li>` : '';
    }).join('');
    const lenses = [
      ['Keter', 'Filozofia vedy a epistemológia'],
      ['Binah', 'Metódy, matematika, logika a štatistika'],
      ['Gevurah', 'Etika výskumu, kontrola skreslení a reprodukovateľnosť'],
      ['Tiferet', 'Interdisciplinárny výskum; Psychológia → Kognícia → Kognitívna veda'],
      ['Yesod', 'Informatika a dátové metódy ako priečna vrstva']
    ].map(([sefira, subject]) => `<li><strong>${esc(sefira)}</strong><span>${esc(subject)}</span></li>`).join('');
    return `<section class="knowledge-sefirot-guide" aria-labelledby="knowledge-sefirot-title"><h3 id="knowledge-sefirot-title">Desať Sefirot · vzťahy a slovník</h3><p>Sefirot sú tradičné pojmy židovskej kabaly; významové glosy a diagramy sa v jednotlivých školách líšia. Preklady sú orientačné. Spoločné chápanie tu opisuje vzťahové dvojice a sprostredkovanie, nie vedecké kategórie.</p><ol>${M().sephirot.map(item => `<li><strong>${esc(item.name)}</strong><span class="knowledge-sefirot-translation">${esc(item.translation)} · pilier ${esc(item.pillar)}</span><p>${esc(item.meaning)}</p><p class="knowledge-sefirot-relation">${esc(item.relation)}</p></li>`).join('')}</ol><h4>Vedecká terminológia · moderný interpretačný most</h4><p>FOS 2007 (OECD/Eurostat) používa šesť hlavných vedných oblastí. Ich umiestnenie na Sefirot nižšie je kurátorská analógia pre prehliadanie osobných zdrojov — nie historické kabalistické priradenie ani vedecká teória.</p><ul class="knowledge-science-crosswalk">${fosFields}</ul><h4>Priečne interpretačné vrstvy</h4><ul class="knowledge-science-crosswalk knowledge-science-lenses">${lenses}</ul><p class="knowledge-interpretation-note"><strong>Príklad:</strong> Kognícia → Kognitívna veda patrí do vetvy Psychológia v rámci spoločenských vied FOS. Klasifikácia konkrétneho výskumu môže byť interdisciplinárna. FOS zaraďuje matematiku a počítačové/informačné vedy pod prírodné vedy; ich umiestnenie pri Binah/Yesod tu označuje iba metodologickú či informačnú funkciu.</p><h4>Súvisiace pojmy (mimo desiatich Sefirot)</h4><dl>${M().loreTerms.map(item => `<div><dt>${esc(item.name)} · ${esc(item.translation)}</dt><dd>${esc(item.meaning)}</dd></div>`).join('')}</dl><p class="knowledge-interpretation-note">Kabalistické súvislosti sú tradičné duchovné/kozmologické výklady. Prepojenie na vedné odbory je moderný navigačný návrh; triedenie zdrojov je textové párovanie kľúčových slov, nie AI porozumenie.</p><p class="knowledge-lore-sources">Zdroje: <a href="https://interoperable-europe.ec.europa.eu/collection/eu-semantic-interoperability-catalogue/solution/field-science-and-technology-classification" target="_blank" rel="noopener noreferrer">European Commission / Eurostat · FOS 2007</a> · <a href="https://www.sefaria.org/Sefer_Yetzirah" target="_blank" rel="noopener noreferrer">Sefaria · Sefer Yetzirah</a> · <a href="https://www.chabad.org/library/article_cdo/aid/361885/jewish/The-Sefirot.htm" target="_blank" rel="noopener noreferrer">Chabad.org · The Sefirot</a>.</p></section>`;
  }
  function tree() { return graph() + sephirotGuide(); }
  function outlineTree(parentId = null, depth = 0) {
    const nodes = data.concepts.filter(c => c.parentId === parentId);
    return nodes.length ? `<ul class="knowledge-tree level-${Math.min(depth, 4)}">${nodes.map(c => `<li><button type="button" class="knowledge-node ${selected === c.id ? 'selected' : ''}" data-action="knowledge-select" data-id="${esc(c.id)}" ${selected === c.id ? 'aria-current="true"' : ''}><span class="knowledge-node-dot" aria-hidden="true">${depth ? '◇' : '✧'}</span><span>${esc(c.name)}</span><small aria-label="Počet zdrojov">${conceptCount(c.id)}</small></button>${outlineTree(c.id, depth + 1)}</li>`).join('')}</ul>` : '';
  }
  function filtered() {
    const searching = !!query.trim(), under = selected && !searching ? new Set(M().resourcesUnder(data, selected).map(r => typeof r === 'string' ? r : r.id)) : null, terms = fold(query).split(/\s+/).filter(Boolean);
    return data.resources.filter(r => (!under || under.has(r.id)) && (searching || filter !== 'unclassified' || !r.conceptIds.length) && (searching || filter !== 'pending' || r.analysisStatus !== 'indexed') && terms.every(term => fold([r.title, r.text, labels[r.sourceKind], ...r.conceptIds.map(id => data.concepts.find(c => c.id === id)?.name || '')].join(' ')).includes(term))).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  function snippet(resource) {
    const text = resource.text || '', concept = data.concepts.find(c => c.id === selected), terms = (query.trim() ? [query.trim(), ...query.trim().split(/\s+/)] : [concept?.name, ...(concept?.keywords || [])]).filter(Boolean), normalized = indexedText(text), normal = normalized.text; let index = -1, term = '';
    for (const word of terms) { const found = normal.indexOf(fold(word)); if (found >= 0 && (index < 0 || found < index)) { index = found; term = word; } }
    if (!text) return '<span class="muted">Text ešte čaká na prepis alebo doplnenie.</span>';
    const originalIndex = index < 0 ? -1 : normalized.map[index], start = Math.max(0, (originalIndex < 0 ? 0 : originalIndex) - 65), end = Math.min(text.length, start + 240), part = text.slice(start, end); let html = esc(part);
    if (originalIndex >= start && originalIndex < end && term) { const local = originalIndex - start, last = normalized.map[Math.min(normalized.map.length - 1, index + fold(term).length - 1)], length = Math.min(end - originalIndex, last + (text.codePointAt(last) > 0xffff ? 2 : 1) - originalIndex); html = esc(part.slice(0, local)) + '<mark>' + esc(part.slice(local, local + length)) + '</mark>' + esc(part.slice(local + length)); }
    return (start ? '…' : '') + html + (end < text.length ? '…' : '');
  }
  function indexedText(text) {
    let normalized = '', index = 0, gap = -1; const map = [];
    for (const char of text) {
      const value = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (const part of value) {
        if (/[\p{L}\p{N}]/u.test(part)) { if (gap >= 0 && normalized) { normalized += ' '; map.push(gap); } gap = -1; normalized += part; for (let unit = 0; unit < part.length; unit++) map.push(index); }
        else if (normalized && gap < 0) gap = index;
      }
      index += char.length;
    }
    return { text: normalized, map };
  }
  function cards() {
    const resources = filtered(), concept = query.trim() ? null : data.concepts.find(c => c.id === selected);
    return `<div class="knowledge-result-heading"><h2>${esc(query.trim() ? 'Výsledky v celej mape' : concept?.name || (filter === 'unclassified' ? 'Nezaradené zdroje' : filter === 'pending' ? 'Čakajú na text' : 'Všetky zdroje'))}</h2><span>${resources.length} / ${data.resources.length} zdrojov</span></div>${concept ? `<p class="knowledge-keywords">${concept.keywords.length ? 'Kľúčové slová: ' + esc(concept.keywords.join(', ')) : 'Pridaj kľúčové slová a spresni automatické zaradenie.'}</p><div class="knowledge-children">${data.concepts.filter(c => c.parentId === selected).map(c => button('select', esc(c.name) + ` <small>${conceptCount(c.id)}</small>`, c.id)).join('')}${button('concept-new', '＋ Podoblasť', selected)}${button('concept-edit', 'Upraviť oblasť', selected)}</div>` : ''}<div class="knowledge-cards">${resources.map(r => `<article class="knowledge-card"><div class="knowledge-card-top"><span class="eyebrow">${esc(labels[r.sourceKind] || r.sourceKind)}</span><span class="knowledge-badge ${r.analysisStatus === 'indexed' ? '' : 'pending'}">${r.analysisStatus === 'indexed' ? 'Analyzované' : r.analysisStatus === 'error' ? 'Prepis zlyhal' : 'Doplň text'}</span></div><h3>${esc(r.title || 'Bez názvu')}</h3><p class="knowledge-snippet">${snippet(r)}</p><div class="knowledge-tags">${r.conceptIds.map(id => data.concepts.find(c => c.id === id)).filter(Boolean).map(c => `<button type="button" data-action="knowledge-select" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('') || '<span>Bez oblasti</span>'}</div><div class="card-actions">${button('source', 'Čítať a hľadať', r.id)}${button('resource', 'Upraviť text a zaradenie', r.id)}</div></article>`).join('') || '<div class="knowledge-empty"><span aria-hidden="true">✧</span><h3>Zatiaľ tu nie sú zdroje</h3><p>Pridaj dokument alebo analyzuj svoje knižnice. Názov oblasti a kľúčové slová pomáhajú vytvárať súvislosti.</p></div>'}</div>`;
  }
  function breadcrumbs() { return `<nav class="knowledge-breadcrumbs" aria-label="Cesta v mape poznania">${button('select', 'Celá mapa')}${pathFor(selected).map(c => `<span aria-hidden="true">›</span>${button('select', esc(c.name), c.id)}`).join('')}</nav>`; }
  function field(label, name, value, attrs = '') { return `<div class="field"><label for="knowledge-${name}">${label}</label><input id="knowledge-${name}" name="${name}" value="${esc(value)}" ${attrs}></div>`; }
  function editor() {
    if (!draft) return '';
    if (draft.type === 'concept') {
      const value = draft.value, unavailable = descendants(value.id);
      return `<section class="knowledge-editor" aria-labelledby="knowledge-editor-title"><header><h2 id="knowledge-editor-title">${draft.isNew ? 'Nová oblasť poznania' : 'Upraviť oblasť'}</h2></header><form id="knowledge-editor-form">${field('Názov oblasti', 'name', value.name, 'required maxlength="160"')}<div class="field"><label for="knowledge-parentId">Nadradená oblasť</label><select id="knowledge-parentId" name="parentId"><option value="">Vyber nadradený predmet alebo pojem</option>${data.concepts.filter(c => !unavailable.has(c.id)).map(c => `<option value="${esc(c.id)}" ${c.id === value.parentId ? 'selected' : ''}>${esc(pathFor(c.id, draft?.concepts || data.concepts).map(p => p.name).join(' › '))}</option>`).join('')}</select></div>${field('Kľúčové slová oddelené čiarkou', 'keywords', value.keywords.join(', '))}<p class="form-hint">Po uložení znova prepojíme uložené texty. Ručné priradenia a vylúčenia zostanú zachované.</p><div class="toolbar">${button('editor-save', 'Uložiť oblasť', '', 'primary', saving || !!task || !!pending || conflict)}${button('editor-discard', 'Zahodiť návrh', '', 'ghost small')}</div></form></section>`;
    }
    const r = draft.value, original = originals.get(r.id), url = resourceURL(r, original);
    return `<section class="knowledge-editor" aria-labelledby="knowledge-editor-title"><header><div><p class="eyebrow">${esc(labels[r.sourceKind])} · SÚKROMNÝ ZDROJ</p><h2 id="knowledge-editor-title">Text a zaradenie</h2></div></header>${url && /^image\//.test(r.mime || original?.mime || '') ? `<img class="knowledge-preview" src="${esc(url)}" alt="${esc(r.title)}">` : ''}${r.assetId ? `<a class="btn secondary small" href="${esc(fileURL(r.assetId))}" target="_blank" rel="noopener">Otvoriť pôvodný súbor</a> <a class="btn secondary small" href="${esc(fileURL(r.assetId))}" download>Stiahnuť súbor</a>` : ''}<form id="knowledge-editor-form">${field('Názov zdroja', 'title', r.title, 'required maxlength="500"')}<div class="field"><label for="knowledge-text">Text dokumentu alebo opravený prepis</label><textarea id="knowledge-text" name="text" rows="12" maxlength="200000">${esc(r.text)}</textarea><span class="form-hint">Opravený text zostáva v mape. Pôvodný súbor sa nemení. Pri ďalšej analýze knižníc zachováme uložený prepis.</span></div><fieldset class="knowledge-picker"><legend>Oblasti poznania</legend><p class="form-hint">Zaškrtnuté oblasti priradíš ručne. Odškrtnuté automatické návrhy vylúčiš.</p>${(draft.concepts || data.concepts).map(c => `<label><input type="checkbox" name="conceptIds" value="${esc(c.id)}" ${r.conceptIds.includes(c.id) ? 'checked' : ''}> <span>${esc(pathFor(c.id, draft?.concepts || data.concepts).map(p => p.name).join(' › '))}</span></label>`).join('')}</fieldset><div class="toolbar">${button('editor-save', 'Uložiť text a zaradenie', '', 'primary', saving || !!task || !!pending || conflict)}${button('resource-analyze', 'Navrhnúť oblasti podľa textu', r.id, 'secondary small', !!task || saving)}${original?.text !== undefined ? button('original-text', 'Načítať pôvodný text') : ''}${button('editor-discard', 'Zahodiť návrh', '', 'ghost small')}</div></form></section>`;
  }
  function render() {
    surface = 'knowledge'; sync(); const unclassified = data.resources.filter(r => !r.conceptIds.length).length, waiting = data.resources.filter(r => r.analysisStatus !== 'indexed').length;
    return `<section id="knowledge-root" class="page knowledge-page"><header class="page-header"><div><p class="eyebrow">PROFIL ČARODEJA · OSOBNÉ ŠTÚDIUM</p><h1 class="page-title">Mapa poznania</h1><p class="page-subtitle">Dokumenty, knihy a myšlienky spojené podľa obsahu.</p></div><div class="toolbar">${button('upload', '＋ Pridať dokument', '', 'primary small', !loaded || saving || !!task || !!pending || conflict)}${button('scan', 'Analyzovať knižnice', '', 'secondary small', !loaded || saving || !!task || !!pending || conflict)}${button('refresh', 'Obnoviť', '', 'ghost small', loading || saving || !!task)}</div></header><p class="knowledge-private">◇ Súbory aj rozpoznávanie textu zostávajú v tejto lokálnej hre. Triedenie používa textové kľúčové slová a ich známe tvary, nie AI porozumenie významu; automatické návrhy si môžeš upraviť. PDF s čitateľným textom sa indexujú po stranách. OCR skenov a fotiek môže chybovať; obrázky nemajú stránkovanie.</p>${error ? `<div class="notice" role="alert">${esc(error)}${conflict ? '<p>Uloženú verziu neprepíšeme. Načítaj ju tlačidlom Obnoviť; návrh a čakajúce texty zostanú zachované.</p>' : ''}</div>` : ''}${pending ? `<div class="notice knowledge-pending"><strong>Čakajúci návrh nie je uložený.</strong><p>Zachovali sme texty aj prepojenia. Po obnovení sa dajú pripojiť iba zmeny, ktoré nekolidujú s uloženými údajmi.</p><div class="toolbar">${button('pending-retry', conflict ? 'Najprv obnov uloženú verziu' : 'Uložiť čakajúci návrh', '', 'primary small', conflict || saving || !!task)}${button('pending-merge', 'Pripojiť zachované zmeny', '', 'secondary small', conflict || saving || !!task)}${button('pending-export', 'Stiahnuť čakajúci návrh')}${button('pending-clear', 'Zahodiť čakajúce zmeny', '', 'ghost small', saving || !!task)}</div></div>` : ''}<div class="knowledge-progress" ${!task && !status ? 'hidden' : ''}><span data-knowledge-status role="status" aria-live="polite">${esc(status)}</span>${task ? button('cancel', 'Zastaviť po aktuálnom zdroji') : ''}</div>${sourceErrors.length ? `<details class="knowledge-warnings" open><summary>${sourceErrors.length} zdrojov potrebuje pozornosť</summary><ul>${sourceErrors.map(item => `<li>${esc(item)}</li>`).join('')}</ul></details>` : ''}${draft ? `<div class="knowledge-draft-notice">Rozpísaný návrh zostáva zachovaný, kým ho uložíš alebo zahodíš.${button('editor-focus', 'Prejsť na návrh')}</div>` : ''}${editor()}${!loaded ? `<div class="content-panel">${loading ? 'Otváram tvoju mapu poznania…' : 'Mapa čaká na načítanie.'}</div>` : `<div class="knowledge-layout"><aside class="knowledge-map"><header><div><p class="eyebrow">OBLASTI POZNANIA</p><h2>Tvoj strom súvislostí</h2></div>${button('concept-new', '＋ Oblasť', '', 'secondary small', saving || !!task || !!pending || conflict)}</header><button class="knowledge-map-all ${!selected ? 'selected' : ''}" data-action="knowledge-select">✧ Celá mapa <small>${data.resources.length}</small></button>${tree() || '<p class="muted">Vytvor prvú oblasť poznania.</p>'}<p class="form-hint">Napríklad Psychológia → Kognícia. Počet zahŕňa aj zdroje v podoblastiach.</p></aside><div class="knowledge-results"><div class="knowledge-search"><label for="knowledge-query">Hľadať v celom texte</label><input id="knowledge-query" data-knowledge-query type="search" value="${esc(query)}" placeholder="Názov, myšlienka alebo pojem…"><div class="knowledge-filters" role="group" aria-label="Filtrovať zdroje">${[['all', 'Všetky', data.resources.length], ['unclassified', 'Nezaradené', unclassified], ['pending', 'Čakajú na text', waiting]].map(([id, name, count]) => `<button type="button" class="${filter === id ? 'selected' : ''}" aria-pressed="${filter === id}" data-action="knowledge-filter" data-id="${id}">${name} <small>${count}</small></button>`).join('')}</div></div><div data-knowledge-breadcrumbs>${breadcrumbs()}</div><div data-knowledge-results>${cards()}</div></div></div>`}<input data-knowledge-files type="file" accept=".pdf,.docx,.txt,.md,image/png,image/jpeg,image/webp" multiple hidden></section>`;
  }
  function widgetResults() {
    const found = filtered(), shown = found.slice(0, 3), concept = data.concepts.find(c => c.id === selected);
    if (!query.trim() && !selected) return `<p class="knowledge-widget-hint">Klikni na predmet v strome alebo vyhľadaj slovo v knihách, poznámkach a dokumentoch.</p><div class="knowledge-widget-stats"><span>${data.resources.length} zdrojov</span><span>${data.resources.filter(r => r.analysisStatus !== 'indexed').length} čaká na text</span>${button('expand', 'Pridať dokumenty a analyzovať knižnice')}</div>`;
    return `<div class="knowledge-result-heading"><h3>${esc(query.trim() ? 'Výsledky v celej mape' : concept?.name || 'Zdroje')}</h3><span>${found.length} zdrojov</span></div><div class="knowledge-widget-results">${shown.map(r => `<article><div><span class="eyebrow">${esc(labels[r.sourceKind])}</span><h4>${esc(r.title || 'Bez názvu')}</h4><p class="knowledge-snippet">${snippet(r)}</p></div>${button('source', 'Čítať', r.id, 'secondary small')}</article>`).join('') || '<p class="muted">Pre toto hľadanie zatiaľ nemáš zdroj. V rozšírenom štúdiu môžeš pridať dokument alebo analyzovať knižnice.</p>'}</div>${found.length > shown.length ? `<p class="form-hint">Zobrazené ${shown.length} z ${found.length} zdrojov. ${button('expand', 'Zobraziť všetky výsledky')}</p>` : ''}`;
  }
  function renderProfileWidget() {
    surface = 'profile'; sync();
    return `<section id="knowledge-root" class="knowledge-page knowledge-profile-widget content-panel" aria-labelledby="knowledge-widget-title"><header class="knowledge-widget-header"><div><p class="eyebrow">TVOJE OSOBNÉ ŠTÚDIUM</p><h2 id="knowledge-widget-title">Strom poznania</h2></div><div class="toolbar">${button('study-room', 'Predmety a poznámky')}${button('expand', 'Rozšíriť mapu')}</div></header><p class="knowledge-private">Tvoje predmety, knihy a dokumenty v jednej súkromnej mape. Mená Sefirot sú tradičné; poloha tvojich oblastí je dnešná interpretačná pomôcka.</p>${error ? `<p class="notice" role="alert">${esc(error)} ${button('refresh', 'Obnoviť')}</p>` : ''}${task ? `<div class="knowledge-progress"><span data-knowledge-status role="status" aria-live="polite">${esc(status || 'Spracúvam zdroje…')}</span>${button('cancel', 'Zastaviť')}</div>` : ''}${pending || draft ? `<p class="knowledge-draft-notice">V štúdiu máš neuložený návrh. ${button('expand', 'Pokračovať v štúdiu')}</p>` : ''}${!loaded ? `<p class="knowledge-widget-hint">${loading ? 'Načítavam tvoje štúdium…' : 'Štúdium čaká na načítanie.'}</p>` : `<div class="knowledge-widget-body"><div class="knowledge-widget-map">${graph()}</div><div class="knowledge-widget-search"><label for="knowledge-query">Hľadať informácie v celom texte</label><input id="knowledge-query" data-knowledge-query type="search" value="${esc(query)}" placeholder="Napíš slovo alebo myšlienku…"><div data-knowledge-results>${widgetResults()}</div></div></div>`}</section>`;
  }
  function capture() {
    const form = document.getElementById('knowledge-editor-form'); if (!form || !draft) return; const fd = new FormData(form);
    if (draft.type === 'concept') Object.assign(draft.value, { name: String(fd.get('name') || ''), parentId: String(fd.get('parentId') || '') || null, keywords: String(fd.get('keywords') || '').split(',').map(w => w.trim()).filter(Boolean) });
    else Object.assign(draft.value, { title: String(fd.get('title') || ''), text: String(fd.get('text') || ''), conceptIds: fd.getAll('conceptIds').map(String) }); draft.changed = true;
  }
  function ensureEditorFree() { capture(); if (draft) throw Error('Najprv ulož alebo zahoď rozpísaný návrh.'); }
  function conceptEditor(id, parentId) {
    ensureEditorFree(); const c = data.concepts.find(c => c.id === id);
    if (c?.studyCategoryId || (!c && !parentId)) { A().navigate('study'); return; }
    if (surface === 'profile') A().navigate('knowledge');
    draft = { type: 'concept', isNew: !c, changed: false, value: clone(c || { id: crypto.randomUUID(), parentId: parentId || null, name: '', keywords: [] }) }; redraw(); focusEditor();
  }
  function focusEditor() { document.querySelector('.knowledge-editor')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); document.querySelector('#knowledge-editor-form input')?.focus({ preventScroll: true }); }
  async function resourceEditor(id) {
    if (task || saving) throw Error('Počkaj na dokončenie analýzy alebo uloženia.');
    ensureEditorFree(); const r = data.resources.find(r => r.id === id); if (!r) return;
    if (surface === 'profile') A().navigate('knowledge');
    draft = { type: 'resource', isNew: false, changed: false, originalText: r.text, originalConceptIds: [...r.conceptIds], touchedConcepts: [], value: clone(r) }; redraw(); focusEditor(); const check = context();
    try { await originalFor(r); check(); if (draft?.value.id === id && !draft.changed) { redraw(); focusEditor(); } }
    catch (e) { try { check(); setStatus('Pôvodný zdroj sa nepodarilo načítať: ' + e.message); } catch (_) {} }
  }
  async function saveEditor() {
    capture(); if (!draft) return; assertWritable(); if (task) throw Error('Počkaj na dokončenie analýzy.');
    const currentDraft = draft, next = clone(data), value = clone(draft.value);
    if (draft.type === 'concept') {
      if (!value.parentId) throw Error('Hlavné predmety vytváraš a upravuješ v Osobnom štúdiu. Tu vyber nadradený predmet alebo pojem.');
      value.name = value.name.trim(); const index = next.concepts.findIndex(c => c.id === value.id);
      if (index < 0) next.concepts.push(value); else next.concepts[index] = value; M().validateState(next); analyzeAll(next);
    } else {
      if (draft.concepts) next.concepts = clone(draft.concepts);
      value.title = value.title.trim(); const picked = new Set(value.conceptIds), auto = M().analyzeResource({ ...value, conceptIds: [], manualConceptIds: [], excludedConceptIds: [] }, next.concepts);
      value.manualConceptIds = [...picked].filter(id => (currentDraft.value.manualConceptIds || []).includes(id) || !(currentDraft.originalConceptIds || []).includes(id) || currentDraft.touchedConcepts?.includes(id));
      value.excludedConceptIds = [...new Set([...(value.excludedConceptIds || []), ...(currentDraft.originalConceptIds || []).filter(id => !picked.has(id)), ...auto.resource.conceptIds.filter(id => next.concepts.some(c => c.id === id) && !picked.has(id))])].filter(id => !picked.has(id));
      value.updatedAt = Date.now();
      if (value.text !== (currentDraft.originalText ?? data.resources.find(r => r.id === value.id)?.text ?? '')) {
        value.analysisStatus = value.text.trim() ? 'indexed' : 'needs_text'; value.pagination = 'unpaginated'; value.pages = value.text ? [{ number: 1, text: value.text }] : [];
      }
      const result = analyze(next, value), index = next.resources.findIndex(r => r.id === value.id); if (index >= 0) next.resources[index] = result; else next.resources.push(result);
    }
    await persist(next, 'Mapa poznania je uložená.');
    if (draft === currentDraft) { if (draft.type === 'concept') selected = draft.value.id; draft = null; redraw(); }
  }
  function hash(value) { let n = 2166136261; for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619); return (n >>> 0).toString(16).padStart(8, '0'); }
  function sourceId(value) { const text = String(value); return /^[A-Za-z0-9_.:-]{1,160}$/.test(text) ? text : 'source_' + hash(text) + hash(text.split('').reverse().join('')); }
  function resourceId(kind, id) { const value = kind.replace(/-/g, '_') + '_' + id; return /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : kind.replace(/-/g, '_') + '_' + hash(id) + hash(id.split('').reverse().join('')); }
  function makeResource(kind, id, title, text, mime = 'text/plain') {
    const sid = sourceId(id), rid = resourceId(kind, sid), old = data.resources.find(r => r.id === rid);
    return { id: rid, sourceKind: kind, sourceId: sid, title: String(title || 'Bez názvu'), text: String(text || ''), pages: text ? [{ number: 1, text: String(text) }] : [], pagination: 'unpaginated', assetId: null, mime, conceptIds: [], manualConceptIds: [], excludedConceptIds: [], analysisStatus: text?.trim() ? 'indexed' : 'needs_text', analyzedAt: 0, updatedAt: Date.now(), ...(old ? { text: old.text, pages: clone(old.pages || []), pagination: old.pagination || 'unpaginated', conceptIds: [...old.conceptIds], manualConceptIds: [...(old.manualConceptIds || [])], excludedConceptIds: [...old.excludedConceptIds], analysisStatus: old.analysisStatus } : {}) };
  }
  function fileURL(id) { return /^[A-Za-z0-9_-]{1,160}$/.test(id || '') ? '/api/knowledge/files/' + encodeURIComponent(id) : ''; }
  function safePhoto(value) { return typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 16000000 ? value : ''; }
  function resourceURL(resource, original) { return resource.assetId ? fileURL(resource.assetId) : original?.photo || ''; }
  function bookText(book) { return [book.title, book.author, ...(book.tags || []), book.notes || ''].filter(Boolean).join('\n'); }
  function addOriginal(kind, id, value) { originals.set(resourceId(kind, sourceId(id)), value); }
  async function originalFor(r) {
    if (originals.has(r.id)) return originals.get(r.id); if (r.sourceKind === 'upload') return null;
    if (r.sourceKind === 'book') { const b = A().state.books.find(b => sourceId(b.id) === r.sourceId); if (b) addOriginal('book', b.id, { item: b, text: bookText(b) }); }
    else if (r.sourceKind === 'page') {
      if (r.sourceId.startsWith('desk-note_')) { const result = await api('/api/desk'); const item = result.state?.items?.find(i => 'desk-note_' + sourceId(i.id) === r.sourceId); if (item) originals.set(r.id, { item, text: item.text || '', desk: true }); }
      else { const result = await api('/api/workspace/pages'); const p = result.pages?.find(p => sourceId(p.id) === r.sourceId); if (p) addOriginal('page', p.id, { item: p, text: [p.title, p.body].filter(Boolean).join('\n') }); }
    } else if (r.sourceKind === 'daynote') { const result = await api('/api/calendar/notes?all=1'); const n = result.notes?.find(n => sourceId(n.id) === r.sourceId); if (n) addOriginal('daynote', n.id, { item: n, text: [n.title, n.date, n.text].filter(Boolean).join('\n') }); }
    else if (r.sourceKind === 'study') { const result = await api('/api/study'); const n = result.state?.notes?.find(n => sourceId(n.id) === r.sourceId); if (n) addOriginal('study', n.id, { item: n, text: [n.title, n.text].filter(Boolean).join('\n'), photo: safePhoto(n.photo), mime: n.photo ? 'image/jpeg' : 'text/plain' }); }
    else if (r.sourceKind === 'library-photo') { const result = await api('/api/library/photos'); const p = result.photos?.find(p => sourceId(p.id) === r.sourceId); if (p && /^[0-9a-f-]{36}$/i.test(p.id)) addOriginal('library-photo', p.id, { item: p, text: [p.caption, p.categoryName].filter(Boolean).join('\n'), photo: '/api/library/photos/' + p.id, mime: p.mime || 'image/jpeg' }); }
    else if (r.sourceKind === 'desk-photo') { const result = await api('/api/desk'); const item = result.state?.items?.find(i => sourceId(i.id) === r.sourceId); if (item) addOriginal('desk-photo', item.id, { item, text: item.name || '', photo: safePhoto(item.src), mime: 'image/jpeg' }); }
    return originals.get(r.id) || null;
  }
  async function openSource(id) {
    const check = context(), r = data.resources.find(r => r.id === id); if (!r) return;
    if (window.MOKnowledgeReader) {
      let original = null; if (!r.assetId) { try { original = await originalFor(r); } catch (e) { setStatus('Pôvodný zdroj sa nepodarilo načítať. Zobrazuje sa uložený text: ' + e.message); } }
      check();
      await window.MOKnowledgeReader.open(r, { query: query || data.concepts.find(c => c.id === selected)?.name || '', original: { ...original, url: resourceURL(r, original) || undefined, mime: r.mime || original?.mime, name: r.title }, concepts: data.concepts, onConcept: id => { capture(); selected = id; query = ''; filter = 'all'; redraw(); } }); return;
    }
    if (r.assetId) { window.open(fileURL(r.assetId), '_blank', 'noopener'); return; }
    const original = await originalFor(r); if (!original) throw Error('Pôvodný zdroj už nie je dostupný. Uložený text zostáva v mape poznania.');
    if (r.sourceKind === 'book') { A().navigate('library'); document.querySelector(`[data-action="book-detail"][data-id="${CSS.escape(original.item.id)}"]`)?.click(); }
    else if (r.sourceKind === 'daynote' && window.MODayNotes) await window.MODayNotes.handleAction('dn-open', { dataset: { id: original.item.id } });
    else if (original.photo) A().openModal(r.title, `<figure class="knowledge-source-figure"><img src="${esc(original.photo)}" alt="${esc(r.title)}"><figcaption>${esc(labels[r.sourceKind])} · Súkromná fotografia</figcaption></figure>`, null, { readOnly: true });
    else A().openModal(r.title, `<p class="knowledge-full-text">${esc(original.text || r.text)}</p><button type="button" class="btn secondary" data-action="knowledge-original-room" data-id="${esc(r.id)}">Otvoriť pôvodnú miestnosť</button>`, null, { readOnly: true });
  }
  async function uploadBinary(file) {
    const check = context(), session = await api('/api/auth/session'); check();
    if (session.account?.id !== accountId || typeof session.csrf !== 'string') throw Error('Prihlásenie sa zmenilo. Obnov stránku.');
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/knowledge/files', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'X-MO-Request': '1', 'X-MO-CSRF': session.csrf, Accept: 'application/json' }, body: form }); check();
    let result; try { result = await response.json(); } catch (_) { throw Error('Súbor sa nepodarilo uložiť.'); }
    if (!response.ok) { const e = Error(result.error?.message || result.message || 'Súbor sa nepodarilo uložiť.'); e.status = response.status; e.code = result.error?.code; throw e; }
    if (!fileURL(result.file?.id)) throw Error('Úložisko vrátilo neplatný súbor.'); return result.file;
  }
  function beginTask(kind) {
    assertWritable(); capture(); if (draft) throw Error('Najprv ulož alebo zahoď rozpísaný návrh.'); if (task) throw Error('Analýza už prebieha.');
    const current = { kind, serial: ++taskSerial, cancelled: false }; task = current; sourceErrors = []; error = ''; redraw();
    const check = context(); return { current, check: () => { check(); if (current.serial !== taskSerial) { const e = Error('Analýza bola zrušená.'); e.name = 'AbortError'; throw e; } } };
  }
  async function uploadFiles(files) {
    if (!files.length) return; if (files.length > 20) throw Error('Naraz vyber najviac 20 dokumentov.');
    for (const f of files) if (!f.size || f.size > 15 * 1024 * 1024 || !/\.(pdf|docx|txt|md|png|jpe?g|webp)$/i.test(f.name)) throw Error('Vyber PDF, DOCX, TXT, MD, JPG, PNG alebo WebP, každý do 15 MB.');
    if (!window.MOKnowledgeExtract) throw Error('Nástroj na čítanie dokumentov nie je pripravený. Obnov stránku.');
    const { current, check } = beginTask('upload'); let count = 0;
    try {
      for (let index = 0; index < files.length; index++) {
        check(); if (current.cancelled) break; const file = files[index]; setStatus(`Ukladám dokument ${index + 1} z ${files.length}: ${file.name}`);
        const asset = await uploadBinary(file); check(); const r = makeResource('upload', asset.id, asset.name || file.name, '', asset.mime || file.type || 'application/octet-stream'); r.assetId = asset.id;
        const initial = clone(data); initial.resources.push(analyze(initial, r)); await persist(initial); check(); count++;
        try {
          if (!current.cancelled) {
            const result = await window.MOKnowledgeExtract.extract(file, message => { try { check(); setStatus(`${file.name} · ${message}`); } catch (_) {} }); check();
            r.mime = result.mime || r.mime; r.pagination = result.pagination === 'pages' ? 'pages' : 'unpaginated';
            if ((result.text || '').length > 200000) { r.analysisStatus = 'needs_text'; sourceErrors.push(file.name + ': Text presahuje 200 000 znakov. Pôvodný súbor je zachovaný; doplň kratší vlastný text v detaile.'); }
            else { r.text = result.text || ''; r.pages = result.pages || (r.text ? [{ number: 1, text: r.text }] : []); r.analysisStatus = result.status === 'indexed' && r.text.trim() ? 'indexed' : 'needs_text'; }
            if (result.warning) sourceErrors.push(file.name + ': ' + result.warning);
          }
        } catch (e) { check(); r.analysisStatus = 'needs_text'; sourceErrors.push(file.name + ': ' + (e.name === 'AbortError' ? 'Prepis bol zastavený. Pôvodný súbor je zachovaný; text môžeš doplniť ručne.' : e.message)); }
        const next = clone(data), position = next.resources.findIndex(item => item.id === r.id); next.resources[position] = analyze(next, r); await persist(next); check(); if (current.cancelled) break;
      }
      setStatus(`${current.cancelled ? 'Zastavené. ' : ''}${count} dokumentov je uložených a zaradených. Prepisy môžeš opraviť v detaile.`);
    } catch (e) { try { check(); error = e.message; } catch (_) {} }
    finally { try { check(); if (task === current) task = null; redraw(); } catch (_) {} }
  }
  async function scanLibraries() {
    if (!window.MOKnowledgeExtract) throw Error('Nástroj na čítanie textu nie je pripravený. Obnov stránku.');
    const { current, check } = beginTask('scan'), candidates = [];
    function add(kind, id, title, text, extra = {}) { const r = makeResource(kind, id, title, text, extra.mime || 'text/plain'); if (extra.photo && !data.resources.some(old => old.id === r.id)) r.analysisStatus = 'needs_text'; candidates.push(r); originals.set(r.id, { text: String(text || ''), ...extra }); }
    try {
      setStatus('Načítavam tvoje súkromné knižnice…'); A().state.books.forEach(b => add('book', b.id, b.title, bookText(b), { item: b }));
      const jobs = [
        ['Osobné stránky', '/api/workspace/pages', result => { if (!Array.isArray(result.pages)) throw Error('Neplatný zoznam stránok.'); result.pages.forEach(p => add('page', p.id, p.title, [p.title, p.body].filter(Boolean).join('\n'), { item: p })); }],
        ['Denné poznámky', '/api/calendar/notes?all=1', result => { if (!Array.isArray(result.notes)) throw Error('Neplatný zoznam poznámok.'); result.notes.forEach(n => add('daynote', n.id, n.title || n.date, [n.title, n.date, n.text].filter(Boolean).join('\n'), { item: n })); }],
        ['Osobné štúdium', '/api/study', result => { if (!Array.isArray(result.state?.notes)) throw Error('Neplatné poznámky štúdia.'); result.state.notes.forEach(n => add('study', n.id, n.title || 'Poznámka zo štúdia', [n.title, n.text, result.state.categories?.find(c => c.id === n.categoryId)?.name].filter(Boolean).join('\n'), { item: n, photo: safePhoto(n.photo), mime: n.photo ? 'image/jpeg' : 'text/plain' })); }],
        ['Fotografie knižnice', '/api/library/photos', result => { if (!Array.isArray(result.photos)) throw Error('Neplatný zoznam fotografií.'); result.photos.forEach(p => { if (!/^[0-9a-f-]{36}$/i.test(p.id)) return; add('library-photo', p.id, p.caption || p.categoryName || 'Fotografia knižnice', [p.caption, p.categoryName].filter(Boolean).join('\n'), { item: p, photo: '/api/library/photos/' + p.id, mime: p.mime || 'image/jpeg' }); }); }],
        ['Alchymistický stôl', '/api/desk', result => { if (!Array.isArray(result.state?.items)) throw Error('Neplatný obsah stola.'); result.state.items.forEach(item => { if (item.type === 'image') add('desk-photo', item.id, item.name || 'Fotografia zo stola', item.name || '', { item, photo: safePhoto(item.src), mime: 'image/jpeg' }); else if (item.type === 'note' && item.text?.trim()) add('page', 'desk-note_' + sourceId(item.id), 'Lístok z alchymistického stola', item.text, { item, desk: true }); }); }]
      ];
      await Promise.allSettled(jobs.map(async ([name, path, accept]) => { try { const result = await api(path); check(); accept(result); } catch (e) { try { check(); sourceErrors.push(name + ': ' + e.message + ' Existujúce záznamy zostali zachované.'); } catch (_) {} } })); check();
      const next = clone(data); let count = 0, recognized = 0;
      pending = { base: data, next, baseRevision: revision };
      for (let index = 0; index < candidates.length; index++) {
        check(); if (current.cancelled) break; const r = candidates[index], original = originals.get(r.id), previous = data.resources.find(old => old.id === r.id);
        setStatus(`Analyzujem zdroj ${index + 1} z ${candidates.length}: ${r.title}`);
        if (original.photo && (!previous || previous.analysisStatus !== 'indexed')) {
          try {
            const text = await window.MOKnowledgeExtract.recognizePhoto(original.photo, message => { try { check(); setStatus(`${index + 1} / ${candidates.length} · ${r.title} · ${message}`); } catch (_) {} }); check();
            if (text.trim()) { r.text = [original.text, text.trim()].filter(Boolean).join('\n\n'); r.pages = [{ number: 1, text: r.text }]; r.pagination = 'unpaginated'; r.analysisStatus = 'indexed'; recognized++; }
            else { r.analysisStatus = 'needs_text'; sourceErrors.push(r.title + ': Čitateľný text sa nenašiel. Doplň ho v detaile.'); }
          } catch (e) { check(); if (previous) { count++; continue; } r.analysisStatus = 'needs_text'; sourceErrors.push(r.title + ': ' + (e.name === 'AbortError' ? 'Prepis bol zastavený.' : e.message)); }
        }
        if (r.text.length > 200000) { sourceErrors.push(r.title + ': Text presahuje 200 000 znakov. Pôvodný zdroj je zachovaný; doplň kratší vlastný text v detaile.'); if (previous) { count++; continue; } r.text = ''; r.pages = []; r.analysisStatus = 'needs_text'; }
        const analyzed = analyze(next, r), found = next.resources.findIndex(old => old.id === r.id); if (found >= 0) next.resources[found] = analyzed; else next.resources.push(analyzed); count++;
      }
      if (count) await persist(next, 'Zdroje sú pripojené k mape poznania.'); else pending = null; check();
      setStatus(`${current.cancelled ? 'Zastavené. ' : ''}Analyzované zdroje: ${count}. Nové prepisy fotografií: ${recognized}. Uložené opravy textov zostali zachované.`);
    } catch (e) { try { check(); error = e.message; } catch (_) {} }
    finally { try { check(); if (task === current) task = null; redraw(); } catch (_) {} }
  }
  function download(value, name) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  async function mergePending() {
    if (!pending || conflict || saving || task) throw Error('Najprv obnov uloženú verziu.'); const savedPending = pending, next = clone(data), collisions = [];
    for (const field of ['concepts', 'resources']) {
      for (const value of savedPending.next[field]) {
        const before = savedPending.base[field].find(item => item.id === value.id); if (JSON.stringify(before) === JSON.stringify(value)) continue;
        const index = next[field].findIndex(item => item.id === value.id), current = index >= 0 ? next[field][index] : undefined;
        if (JSON.stringify(current) === JSON.stringify(value)) continue;
        if (JSON.stringify(current) !== JSON.stringify(before)) { collisions.push(value.title || value.name || value.id); continue; }
        if (index < 0) next[field].push(clone(value)); else next[field][index] = clone(value);
      }
    }
    if (collisions.length) { error = 'Tieto záznamy sa zmenili v oboch návrhoch: ' + collisions.join(', ') + '. Čakajúci návrh je zachovaný na stiahnutie. Uložené údaje neprepíšeme.'; redraw(); return; }
    await persist(analyzeAll(next), 'Zachované zmeny sú uložené.', data); if (draft) { draft = null; redraw(); }
  }
  async function handleAction(action, el) {
    if (!action.startsWith('knowledge-')) return false; if (!sync()) return true; const key = action.slice(10), id = el.dataset.id || '';
    if (key === 'select') { capture(); selected = id; query = ''; filter = 'all'; redraw(); }
    else if (key === 'filter') { capture(); filter = id; selected = ''; redraw(); }
    else if (key === 'refresh') { capture(); if (task || saving) throw Error('Počkaj na dokončenie analýzy alebo uloženia.'); await load(); }
    else if (key === 'concept-new') { assertWritable(); conceptEditor('', id); }
    else if (key === 'concept-edit') { assertWritable(); conceptEditor(id); }
    else if (key === 'resource') await resourceEditor(id);
    else if (key === 'source') await openSource(id);
    else if (key === 'original-room') { document.getElementById('modal')?.close(); const r = data.resources.find(r => r.id === id); A().navigate(originals.get(id)?.desk ? 'desk' : r?.sourceKind === 'study' ? 'study' : 'workspace'); }
    else if (key === 'editor-save') await saveEditor();
    else if (key === 'editor-focus') { capture(); focusEditor(); }
    else if (key === 'editor-discard') { draft = null; redraw(); }
    else if (key === 'original-text') { capture(); const original = originals.get(draft?.value.id); if (draft?.type === 'resource' && original?.text !== undefined) { draft.value.text = original.text; draft.changed = true; redraw(); } }
    else if (key === 'resource-analyze') { capture(); if (draft?.type === 'resource') { const state = clone(data); draft.value = analyze(state, { ...draft.value, conceptIds: [], manualConceptIds: [], excludedConceptIds: [] }); draft.concepts = state.concepts; draft.originalConceptIds = [...draft.value.conceptIds]; draft.changed = true; redraw(); } }
    else if (key === 'study-open') openStudyCategory(id || window.MOStudy?.getSelectedCategory?.());
    else if (key === 'expand') { capture(); A().navigate('knowledge'); }
    else if (key === 'study-room') { capture(); A().navigate('study'); }
    else if (key === 'map-in') zoomMap(1.25);
    else if (key === 'map-out') zoomMap(.8);
    else if (key === 'map-fit') { fitMap(); applyMapPose(); }
    else if (key === 'upload') { assertWritable(); ensureEditorFree(); document.querySelector('[data-knowledge-files]')?.click(); }
    else if (key === 'scan') await scanLibraries();
    else if (key === 'cancel') { if (task) { task.cancelled = true; window.MOKnowledgeExtract?.cancel(); setStatus('Zastavujem prepis. Už spracované zdroje zostanú zachované…'); } }
    else if (key === 'pending-export') { if (pending) download(pending.next, 'magnum-opus-mapa-poznania-cakajuci-navrh.json'); }
    else if (key === 'pending-retry') { if (pending && !conflict) { if (revision !== pending.baseRevision) throw Error('Uložená verzia sa zmenila. Použi Pripojiť zachované zmeny; cudzie zmeny neprepíšeme.'); await persist(pending.next, 'Čakajúci návrh je uložený.', pending.base); draft = null; redraw(); } }
    else if (key === 'pending-merge') await mergePending();
    else if (key === 'pending-clear') A().openModal('Zahodiť čakajúci návrh?', '<p>Neuložené zmeny mapy sa zahodia. Ak ich potrebuješ zachovať, najprv stiahni čakajúci návrh.</p>', () => { pending = null; redraw(); }, { submitLabel: 'Zahodiť čakajúce zmeny' });
    return true;
  }
  function afterRender(view) {
    const wasActive = active; active = view === 'knowledge' || view === 'profile'; if (!active) { if (wasActive) window.MOKnowledgeReader?.destroy?.(); return; } surface = view; sync(); if (!loaded && !loading && !error) void load();
    const root = document.getElementById('knowledge-root'); if (!root || root.dataset.bound) return; root.dataset.bound = '1';
    root.addEventListener('input', event => { if (event.target.matches('[data-knowledge-query]')) { query = event.target.value; const results = root.querySelector('[data-knowledge-results]'); if (results) results.innerHTML = surface === 'profile' ? widgetResults() : cards(); } else if (event.target.closest('#knowledge-editor-form')) capture(); });
    root.addEventListener('change', event => {
      if (event.target.matches('input[name="conceptIds"]') && draft) { draft.touchedConcepts = [...new Set([...(draft.touchedConcepts || []), event.target.value])]; capture(); }
      if (!event.target.matches('[data-knowledge-files]')) return; const files = [...event.target.files]; event.target.value = ''; void uploadFiles(files).catch(e => { error = e.message; redraw(); });
    });
    root.querySelector('#knowledge-editor-form')?.addEventListener('submit', event => { event.preventDefault(); void saveEditor().catch(e => { error = e.message; redraw(); }); });
    if (saving) lockEditor(true);
    bindMap(root);
  }
  function bindMap(root) {
    const viewport = root.querySelector('.knowledge-map-viewport'), svg = root.querySelector('.knowledge-graph'); if (!viewport || !svg) return;
    let gesture = null;
    function point(event) { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const matrix = svg.getScreenCTM(); return matrix ? p.matrixTransform(matrix.inverse()) : { x: 500, y: 380 }; }
    viewport.addEventListener('wheel', event => { event.preventDefault(); const p = point(event); zoomMap(Math.exp(-Math.max(-150, Math.min(150, event.deltaY)) * .002), p.x, p.y); }, { passive: false });
    viewport.addEventListener('pointerdown', event => { if (event.button !== 0 || event.target.closest('[data-action]')) return; const p = point(event); gesture = { pointer: event.pointerId, x: p.x, y: p.y, originalX: mapPose.x, originalY: mapPose.y }; viewport.setPointerCapture(event.pointerId); viewport.classList.add('panning'); event.preventDefault(); });
    viewport.addEventListener('pointermove', event => { if (!gesture || event.pointerId !== gesture.pointer) return; const p = point(event); mapPose.x = gesture.originalX + p.x - gesture.x; mapPose.y = gesture.originalY + p.y - gesture.y; applyMapPose(); });
    function end(event) { if (gesture?.pointer === event.pointerId) { gesture = null; viewport.classList.remove('panning'); } }
    viewport.addEventListener('pointerup', end); viewport.addEventListener('pointercancel', end); viewport.addEventListener('lostpointercapture', end);
    viewport.addEventListener('keydown', event => {
      const node = event.target.closest('.knowledge-graph-node');
      if (node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void handleAction(node.dataset.action, node).catch(e => A().toast(e.message)); return; }
      if (event.target !== viewport) return;
      const shifts = { ArrowLeft: [40,0], ArrowRight: [-40,0], ArrowUp: [0,40], ArrowDown: [0,-40] }, delta = shifts[event.key];
      if (delta) { event.preventDefault(); mapPose.x += delta[0]; mapPose.y += delta[1]; applyMapPose(); }
      else if (['+', '='].includes(event.key)) { event.preventDefault(); zoomMap(1.25); }
      else if (event.key === '-') { event.preventDefault(); zoomMap(.8); }
      else if (event.key === 'Home') { event.preventDefault(); fitMap(); applyMapPose(); }
    });
    root.querySelector('[data-action="knowledge-map-in"]')?.setAttribute('aria-label', 'Priblížiť strom');
    root.querySelector('[data-action="knowledge-map-out"]')?.setAttribute('aria-label', 'Oddialiť strom');
  }
  function openStudyCategory(id) {
    sync(); wantedStudyId = String(id || ''); selected = data.concepts.find(c => c.studyCategoryId === wantedStudyId)?.id || ''; query = ''; filter = 'all';
    if (loaded && !loading) { loaded = false; error = ''; } A().navigate('knowledge');
  }
  function studyChanged() {
    studyStale = true;
    if (draft || pending || task || saving) { error = 'Predmety v Osobnom štúdiu sa zmenili. Obnov mapu pred uložením; tvoj návrh zostane zachovaný.'; return; }
    loaded = false; error = ''; if (active && accountId) void load();
  }
  function destroy({ preserveDraft } = {}) { capture(); if (preserveDraft && accountId && (draft || pending)) held.set(accountId, clone({ draft, pending })); else if (accountId) held.delete(accountId); window.MOKnowledgeReader?.destroy?.(); reset(); accountId = ''; active = false; }
  function hasUnsavedDrafts() { return !!draft || !!pending || saving || !!task; }
  window.addEventListener('beforeunload', event => { if (hasUnsavedDrafts()) { event.preventDefault(); event.returnValue = ''; } });
  window.MOKnowledge = { render, renderProfileWidget, afterRender, handleAction, destroy, hasUnsavedDrafts, openStudyCategory, studyChanged };
})();
