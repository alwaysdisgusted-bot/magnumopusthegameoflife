(() => {
  'use strict';

  const VIEWS = Object.freeze({
    page:'workspace', daynote:'calendar', 'desk-note':'desk', 'desk-photo':'desk', study:'study', book:'library',
    'grimoire-tab':'library', 'grimoire-folder':'library', 'grimoire-document':'library',
    'grimoire-favorite':'library', 'grimoire-collection':'library'
  });
  const LABELS = Object.freeze({
    page:'Pracovňa', daynote:'Denná poznámka', 'desk-note':'Lístok na alchymistickom stole',
    'desk-photo':'Fotka na alchymistickom stole', study:'Osobné štúdium', book:'Knižnica',
    'grimoire-tab':'Záložka Grimoára', 'grimoire-folder':'Priečinok Grimoára',
    'grimoire-document':'Dokument Grimoára', 'grimoire-favorite':'Obľúbený výraz Grimoára',
    'grimoire-collection':'Kolekcia Grimoára'
  });
  const MAX_MATCHES = 250;
  let active = null;
  let observer = null;
  let frame = 0;

  const text = value => typeof value === 'string' ? value : '';
  const account = () => window.MOAuth?.getAccount?.()?.id || '';
  const folded = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('sk');

  function request(view) {
    const url = new URL(window.location.href);
    const kind = url.searchParams.get('sourceKind') || '';
    const id = url.searchParams.get('sourceId') || '';
    const query = (url.searchParams.get('knowledgeSearch') || '').trim();
    if (!Object.hasOwn(VIEWS, kind) || VIEWS[kind] !== view || url.hash !== '#'+view ||
        !/^[A-Za-z0-9_-]{1,160}$/.test(id) || !query || query.length > 150 ||
        /[\u0000-\u001f\u007f]/.test(query) || !folded(query) || !account()) return null;
    return {view, kind, id, query, account:account(), key:JSON.stringify([view, kind, id, query, account()])};
  }

  function current(entry) {
    return active === entry && request(entry.view)?.key === entry.key;
  }

  function element(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function button(label, callback) {
    const node = element('button', 'btn secondary small', label);
    node.type = 'button';
    node.addEventListener('click', callback);
    return node;
  }

  function cleanDecoration() {
    document.querySelectorAll('[data-mo-source-mark]').forEach(mark => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    document.querySelectorAll('.knowledge-source-target').forEach(node => node.classList.remove('knowledge-source-target'));
  }

  function destroy() {
    observer?.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    active = null;
    document.querySelectorAll('.knowledge-source-panel').forEach(node => node.remove());
    cleanDecoration();
  }

  function close(entry) {
    if (!current(entry)) return;
    const url = new URL(window.location.href);
    ['knowledgeSearch','sourceKind','sourceId'].forEach(key => url.searchParams.delete(key));
    window.history.replaceState(window.history.state, '', url.pathname+url.search+url.hash);
    destroy();
  }

  // Use the same literal, accent-insensitive matching as the map's search.
  function ranges(value, query, limit = MAX_MATCHES) {
    if (window.MOKnowledgeGameSearch?.findRanges) {
      return window.MOKnowledgeGameSearch.findRanges(value, query).slice(0,limit).map(range => [range.start,range.end]);
    }
    let normalized = '';
    const starts = [], ends = [];
    let offset = 0;
    for (const character of value) {
      const end = offset+character.length;
      let clean = character.normalize('NFD').toLowerCase().replace(/\p{M}/gu, '');
      if (!clean && /\p{M}/u.test(character) && ends.length) ends[ends.length-1] = end;
      if (/\s/u.test(character)) {
        if (normalized.endsWith(' ')) { ends[ends.length-1] = end; offset = end; continue; }
        clean = ' ';
      }
      for (let i = 0; i < clean.length; i++) {
        starts.push(offset);
        ends.push(end);
      }
      normalized += clean;
      offset = end;
    }
    const needle = folded(query).replace(/\s+/g, ' '), found = [];
    let cursor = 0;
    while (needle && found.length < limit) {
      const index = normalized.indexOf(needle, cursor);
      if (index < 0) break;
      const start = starts[index], end = ends[index+needle.length-1];
      if (!found.length || start >= found[found.length-1][1]) found.push([start,end]);
      cursor = index+needle.length;
    }
    return found;
  }

  function highlighted(node, value, query, marks, limit = MAX_MATCHES, actual = false) {
    let cursor = 0;
    for (const [start,end] of ranges(value, query, limit)) {
      node.appendChild(document.createTextNode(value.slice(cursor,start)));
      const mark = element('mark', 'knowledge-source-match', value.slice(start,end));
      if (actual) mark.dataset.moSourceMark = '1';
      node.appendChild(mark);
      marks.push(mark);
      cursor = end;
    }
    node.appendChild(document.createTextNode(value.slice(cursor)));
  }

  function fields(title, body, meta = '', fallback = 'Bez názvu') {
    return [
      {tag:'h3', className:'knowledge-source-title', text:text(title) || fallback, heading:true},
      {tag:'p', className:'knowledge-source-text', text:[text(title),text(meta),text(body)].filter(Boolean).join('\n')}
    ].filter(field => field.text);
  }

  function boundedPreview(value, query) {
    const maximum = 200000;
    if (value.length <= maximum) return {value, shortened:false};
    const first = ranges(value,query,1)[0]?.[0] || 0;
    let start = Math.max(0,Math.min(value.length-maximum,first-1000));
    let end = Math.min(value.length,start+maximum);
    if (start && /[\uDC00-\uDFFF]/.test(value[start])) start--;
    if (end < value.length && /[\uDC00-\uDFFF]/.test(value[end])) end++;
    return {value:(start ? '…' : '')+value.slice(start,end)+(end < value.length ? '…' : ''), shortened:true};
  }

  async function original(entry) {
    const api = window.MOAuth.api;
    let result, source;
    if (entry.kind === 'page') {
      result = await api('/api/workspace/pages');
      source = result.pages?.find(item => item.id === entry.id);
      return source ? {fields:fields(source.title,source.body), source} : null;
    }
    if (entry.kind === 'daynote') {
      result = await api('/api/calendar/notes?all=1');
      source = result.notes?.find(item => item.id === entry.id);
      return source ? {fields:fields(source.title,source.text,source.date,'Denná poznámka'), source} : null;
    }
    if (entry.kind === 'desk-note' || entry.kind === 'desk-photo') {
      result = await api('/api/desk');
      source = result.state?.items?.find(item => item.id === entry.id && item.type === (entry.kind === 'desk-note' ? 'note' : 'image'));
      return source ? {fields:fields(source.name,source.text,'',LABELS[entry.kind]), source} : null;
    }
    if (entry.kind === 'study') {
      result = await api('/api/study');
      source = result.state?.notes?.find(item => item.id === entry.id);
      return source ? {fields:fields(source.title,source.text), source} : null;
    }
    result = await api('/api/save');
    source = result.state?.books?.find(item => item.id === entry.id);
    return source ? {fields:fields(source.title,source.notes,[text(source.author),Array.isArray(source.tags) ? source.tags.map(text).join(' ') : ''].filter(Boolean).join('\n')), source} : null;
  }

  function sameId(selector, attribute, id) {
    return [...document.querySelectorAll(selector)].find(node => node.getAttribute(attribute) === id);
  }

  // These existing actions select the original page, day, or category. A page
  // selection displays its existing workspace editor only when no drafts exist.
  // Never focus a textarea, save a draft, or replace current editor contents.
  function routeOriginal(entry) {
    if (entry.kind.startsWith('grimoire-')) {
      if (!entry.routed) entry.routed = window.MOKnowledgeLibrary?.openSearch(entry.query) === true;
      return;
    }
    if (!entry.result || entry.routed || document.getElementById('modal')?.open) return;
    const source = entry.result.source;
    if (entry.kind === 'page') {
      if (window.MOAcademy?.hasUnsavedDrafts?.()) return;
      const target = sameId('[data-action="academy-page-open"]', 'data-id', entry.id);
      if (!target) {
        const tab = sameId('.workspace-page [data-action="academy-tab"]', 'data-tab', 'pages');
        if (tab && tab.getAttribute('aria-selected') !== 'true' && !entry.openedTab) {
          entry.openedTab = true;
          window.MOAcademy?.handleAction('academy-tab', tab);
        }
        return;
      }
      entry.routed = true;
      if (!sameId('.mo-page-editor', 'data-page-id', entry.id)) window.MOAcademy?.handleAction('academy-page-open', target);
    } else if (entry.kind === 'daynote') {
      if (window.MODayNotes?.hasUnsavedDrafts?.()) return;
      entry.routed = true;
      if (window.MOCalendar?.getSelectedDay?.() !== source.date) window.MOCalendar?.selectDay?.(source.date);
    } else if (entry.kind === 'study') {
      if (window.MOStudy?.hasUnsavedDrafts?.() || !document.querySelector('.study-layout')) return;
      entry.routed = true;
      if (window.MOStudy?.getSelectedCategory?.() !== source.categoryId) {
        window.MOStudy?.handleAction('study-select', {dataset:{id:source.categoryId}});
      }
    }
  }

  function markVisible(node, query) {
    if (!node || node.querySelector('[data-mo-source-mark]')) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const texts = [];
    while (walker.nextNode()) {
      const child = walker.currentNode;
      if (child.parentElement?.closest('input,textarea,select,script,style,mark,[contenteditable]')) continue;
      if (ranges(child.textContent, query, 1).length) texts.push(child);
    }
    let count = 0;
    for (const child of texts) {
      if (count >= MAX_MATCHES) break;
      const fragment = document.createDocumentFragment(), marks = [];
      highlighted(fragment, child.textContent, query, marks, MAX_MATCHES-count, true);
      count += marks.length;
      child.replaceWith(fragment);
    }
  }

  function decorateOriginal(entry) {
    if (!entry.result) return;
    let target;
    if (entry.kind.startsWith('desk-')) {
      target = sameId('[data-desk-item]', 'data-desk-item', entry.id);
      markVisible(target?.querySelector('.desk-item-caption'), entry.query);
      // Scroll only the desk viewport, so the result panel stays in view.
      if (target && !entry.deskScrolled) {
        const viewport = target.closest('.desk-viewport');
        if (viewport) {
          const rect = target.getBoundingClientRect(), view = viewport.getBoundingClientRect();
          viewport.scrollLeft += rect.left-view.left-(view.width-rect.width)/2;
          viewport.scrollTop += rect.top-view.top-(view.height-rect.height)/2;
          entry.deskScrolled = true;
        }
      }
    } else if (entry.kind === 'page') {
      target = sameId('.mo-page-editor', 'data-page-id', entry.id);
      const link = sameId('[data-action="academy-page-open"]', 'data-id', entry.id);
      markVisible(link, entry.query);
    } else if (entry.kind === 'daynote') {
      target = sameId('[data-action="dn-open"]', 'data-id', entry.id)?.closest('.daynote-card');
      markVisible(target?.querySelector('.daynote-title'), entry.query);
      markVisible(target?.querySelector('.daynote-text'), entry.query);
    } else if (entry.kind === 'study') {
      target = sameId('.study-note-card', 'data-id', entry.id);
      markVisible(target?.querySelector('strong'), entry.query);
      markVisible(target?.querySelector('p'), entry.query);
    } else if (entry.kind === 'book') {
      target = sameId('[data-action="book-detail"]', 'data-id', entry.id)?.closest('.book-card');
      markVisible(target?.querySelector('.book-title'), entry.query);
      markVisible(target?.querySelector('.book-author'), entry.query);
    }
    if (target) target.classList.add('knowledge-source-target');
  }

  function setMatch(entry, index, scroll) {
    if (!current(entry) || !entry.panel?.isConnected) return;
    const marks = entry.marks || [];
    entry.match = marks.length ? (index+marks.length)%marks.length : 0;
    marks.forEach((mark, i) => mark.classList.toggle('is-current', i === entry.match));
    entry.counter.textContent = marks.length ? 'Výskyt '+(entry.match+1)+' z '+marks.length+(entry.limited ? ' (prvých 250)' : '') : '';
    if (scroll && marks.length) marks[entry.match].scrollIntoView({block:'nearest',inline:'nearest'});
  }

  function buildPanel(entry) {
    const panel = element('section', 'knowledge-source-panel');
    panel.setAttribute('aria-label', 'Výsledok vyhľadávania v pôvodnom zdroji');
    const header = element('div', 'knowledge-source-heading');
    const heading = element('div');
    heading.appendChild(element('p', 'eyebrow', 'VÝSLEDOK Z MAPY POZNANIA · '+LABELS[entry.kind]));
    heading.appendChild(element('h2', '', 'Hľadaný výraz: „'+entry.query+'“'));
    header.appendChild(heading);
    header.appendChild(button('Zavrieť výsledok', () => close(entry)));
    panel.appendChild(header);
    const status = element('p', 'knowledge-source-status');
    status.setAttribute('role', 'status');
    if (entry.loading) status.textContent = 'Načítavam pôvodný uložený zdroj…';
    else if (entry.error) status.textContent = 'Pôvodný zdroj sa nepodarilo načítať. Skús ho obnoviť.';
    else if (!entry.result) status.textContent = 'Tento zdroj už neexistuje alebo k nemu nemáš prístup.';
    panel.appendChild(status);
    entry.marks = [];
    if (entry.result) {
      const controls = element('div', 'knowledge-source-controls');
      const previous = button('← Predchádzajúci výskyt', () => setMatch(entry, entry.match-1, true));
      const next = button('Nasledujúci výskyt →', () => setMatch(entry, entry.match+1, true));
      entry.counter = element('span', 'knowledge-source-counter');
      entry.counter.setAttribute('aria-live', 'polite');
      controls.append(previous, next, entry.counter);
      panel.appendChild(controls);
      const preview = element('div', 'knowledge-source-preview');
      preview.tabIndex = 0;
      preview.setAttribute('aria-label', 'Pôvodný uložený text so zvýraznenými výskytmi');
      let shortened = false, totalMatches = 0;
      for (const field of entry.result.fields) {
        const node = element(field.tag, field.className);
        if (field.heading) node.textContent = field.text;
        else {
          const bounded = boundedPreview(field.text,entry.query);
          shortened ||= bounded.shortened;
          totalMatches += ranges(bounded.value,entry.query,MAX_MATCHES+1).length;
          highlighted(node, bounded.value, entry.query, entry.marks, MAX_MATCHES-entry.marks.length);
        }
        preview.appendChild(node);
      }
      entry.limited = totalMatches > MAX_MATCHES;
      previous.disabled = next.disabled = entry.marks.length < 2;
      panel.appendChild(preview);
      if (shortened) panel.appendChild(element('p', 'knowledge-source-hint', 'Dlhý zdroj: náhľad zobrazuje najviac 200 000 znakov okolo prvého výskytu. Úplný text zostáva v pôvodnom zázname.'));
      status.textContent = entry.marks.length ? 'Pôvodný uložený text. Výskyty sú zvýraznené aj v čitateľnom náhľade.' : 'V aktuálnom uloženom zdroji sa tento výraz už nenachádza.';
      panel.appendChild(element('p', 'knowledge-source-hint', 'Náhľad číta iba obsah, ktorý je už uložený v hre. Upravovať môžeš pôvodný záznam v tejto sekcii; rozpísané zmeny zostávajú v editore.'));
    }
    if (!entry.loading) panel.appendChild(button('Obnoviť zdroj', () => load(entry)));
    entry.panel = panel;
    return panel;
  }

  function observe(entry) {
    const main = document.getElementById('main');
    if (!main || !window.MutationObserver) return;
    observer ||= new MutationObserver(records => {
      if (!current(entry) || frame || records.every(record => record.target.closest?.('.knowledge-source-panel'))) return;
      frame = requestAnimationFrame(() => { frame = 0; draw(entry); });
    });
    observer.observe(main, {childList:true,subtree:true});
  }

  function draw(entry) {
    if (!current(entry)) return;
    observer?.disconnect();
    routeOriginal(entry);
    if (!current(entry)) return;
    if (entry.kind.startsWith('grimoire-')) return;
    const root = entry.view === 'desk' ? document.getElementById('desk-root') : document.querySelector('#main .page, #main .scene');
    if (!root) { observe(entry); return; }
    if (!entry.panel?.isConnected || entry.rebuild) {
      entry.panel?.remove();
      const panel = buildPanel(entry);
      const header = root.querySelector(':scope > header, :scope > .page-header, :scope > .desk-heading');
      if (header) header.after(panel); else root.prepend(panel);
      entry.rebuild = false;
      if (entry.result) setMatch(entry, entry.match || 0, false);
    }
    decorateOriginal(entry);
    if (entry.result && !entry.scrolled && entry.panel?.isConnected) {
      entry.scrolled = true;
      entry.panel.scrollIntoView({block:'nearest'});
      setMatch(entry, entry.match || 0, true);
    }
    observe(entry);
  }

  async function load(entry) {
    if (!current(entry)) return;
    const serial = entry.serial = (entry.serial || 0)+1;
    entry.loading = true;
    entry.error = false;
    entry.result = null;
    entry.rebuild = true;
    observer?.disconnect();
    cleanDecoration();
    draw(entry);
    try {
      const result = await original(entry);
      if (!current(entry) || serial !== entry.serial) return;
      entry.result = result;
    } catch {
      if (!current(entry) || serial !== entry.serial) return;
      entry.error = true;
    } finally {
      if (current(entry) && serial === entry.serial) {
        entry.loading = false;
        entry.rebuild = true;
        entry.scrolled = false;
        draw(entry);
      }
    }
  }

  function afterRender(view) {
    const value = request(view);
    if (!value) { destroy(); return Promise.resolve(); }
    if (active?.key === value.key) { draw(active); return active.pending || Promise.resolve(); }
    destroy();
    active = {...value, loading:false, result:null, match:0};
    const entry = active;
    entry.pending = load(entry);
    return entry.pending;
  }

  window.MOKnowledgeSourceNavigation = Object.freeze({afterRender, destroy});
})();
