(() => {
  'use strict';
  const A = () => window.MOApp, auth = () => window.MOAuth, esc = value => A().esc(String(value ?? ''));
  const catalog = new Map((window.MOQuoteCatalog || []).map(quote => [quote.id, quote]));
  const resource = () => ({ data: null, loaded: false, loading: false, error: '', task: null });
  let accountId = '', generation = 0, formToken = 0, activeView = '';
  let own = resource(), selection = resource(), saved = resource();
  const button = (action, label, extra = '', style = 'secondary small') => `<button type="button" class="btn ${style}" data-action="${action}" ${extra}>${label}</button>`;
  const accountAttrs = id => `data-account="${esc(id)}"`;
  function closeOwnModal() {
    const dialog = document.getElementById('modal');
    if (dialog?.open && dialog.querySelector('[data-showcase-modal]')) dialog.close();
  }
  function destroy() {
    generation++; formToken++; closeOwnModal();
    accountId = ''; activeView = ''; own = resource(); selection = resource(); saved = resource();
  }
  function sync() {
    const id = auth().getAccount()?.id || '';
    if (id !== accountId) { destroy(); accountId = id; }
    return !!id;
  }
  const sameSession = (gen, id) => gen === generation && !!id && accountId === id && auth().getAccount()?.id === id;
  function assertSession(gen, id = accountId) {
    if (!sameSession(gen, id)) throw Error('Prihlásenie sa zmenilo. Otvor profil znova.');
  }
  async function request(path, options) {
    const gen = generation, id = accountId;
    assertSession(gen, id);
    const result = await auth().api(path, options);
    assertSession(gen, id);
    return result;
  }
  function redraw() { if (activeView === 'profile' && accountId && auth().getAccount()?.id === accountId) A().render(); }
  function load(item, path, key) {
    if (item.loading) return item.task;
    if (item.loaded || item.error || !accountId) return Promise.resolve();
    const gen = generation; item.loading = true;
    item.task = (async () => {
      try {
        const result = await request(path);
        if (gen !== generation) return;
        item.data = key ? result[key] : result; item.loaded = true;
      } catch (error) { if (gen === generation) item.error = error.message || 'Načítanie sa nepodarilo.'; }
      finally { if (gen === generation) { item.loading = false; item.task = null; redraw(); } }
    })();
    return item.task;
  }
  const loadOwn = () => load(own, '/api/social/wizards/' + encodeURIComponent(accountId));
  const loadSelection = () => load(selection, '/api/social/showcase', 'showcase');
  const loadSaved = () => load(saved, '/api/quotes/saved', 'saved');
  function invalidate() {
    // Invalidate pending reads as well as completed snapshots, including after a visibility change.
    generation++; formToken++; closeOwnModal(); own = resource(); selection = resource(); saved = resource();
    redraw();
  }
  function quoteIds(ids) { return [...new Set(Array.isArray(ids) ? ids : [])].filter(id => catalog.has(id)).slice(0, 6); }
  function quoteCard(quote) {
    return `<figure class="showcase-quote"><span class="showcase-quote-mark" aria-hidden="true">“</span><div><blockquote>${esc(quote.text)}</blockquote><figcaption>— ${esc(quote.author || 'Autor neurčený')}</figcaption>${window.MOQuoteSources?.workMarkup(quote)||''}${quote.verification!=='verified'?`<p class="quote-verification">${quote.verification==='paraphrase'?'Parafráza':quote.verification==='personal'?'Osobný zápis':'Autorstvo neoverené'}</p>`:''}</div></figure>`;
  }
  function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sk-SK', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bratislava' });
  }
  function noteCards(notes, owner, featured = false) {
    return (Array.isArray(notes) ? notes : []).filter(note => note && typeof note.id === 'string').map(note => {
      const excerpt = String(note.excerpt ?? note.text ?? '').replace(/\s+/g, ' ').slice(0, 280);
      return `<article class="showcase-note ${featured ? 'is-featured' : ''}" data-showcase-note="${esc(note.id)}"><div class="showcase-note-meta">${featured ? '<span class="showcase-pin">📌 Pripnutá na profile</span>' : '<span>Verejná poznámka</span>'}<span>${esc(dateText(note.updatedAt))}</span></div><h3><button type="button" class="showcase-note-title" data-action="showcase-note" ${accountAttrs(owner)} data-id="${esc(note.id)}">${esc(note.title || 'Poznámka bez názvu')}</button></h3>${excerpt ? `<p>${esc(excerpt)}${String(note.excerpt ?? note.text ?? '').length > 280 ? '…' : ''}</p>` : ''}<div class="card-actions">${button('showcase-note', 'Prečítať poznámku →', `${accountAttrs(owner)} data-id="${esc(note.id)}"`, 'ghost small')}${owner === auth().getAccount()?.id ? button('dn-edit', 'Upraviť poznámku', `data-id="${esc(note.id)}"`) : ''}</div></article>`;
    }).join('');
  }
  function moreButton(owner, offset) {
    return Number.isSafeInteger(offset) && offset >= 0 ? button('showcase-more', 'Viac verejných poznámok', `${accountAttrs(owner)} data-offset="${offset}"`) : '';
  }
  function accessible(data, id) {
    return !!data?.profile && data.profile.accountId === id && (data.profile.visible === true || id === auth().getAccount()?.id);
  }
  function renderPublic(data) {
    const profile = data?.profile, owner = profile?.accountId;
    if (!owner || !accessible(data, owner)) return '<p class="showcase-empty">Tento profil nie je verejne dostupný.</p>';
    const featured = Array.isArray(data.featuredNotes) ? data.featuredNotes : [], featuredIds = new Set(featured.map(note => note.id));
    const notes = (Array.isArray(data.notes) ? data.notes : []).filter(note => !featuredIds.has(note.id));
    const chosen = quoteIds(data.quoteIds).map(id => catalog.get(id));
    return `<div class="showcase-public" ${accountAttrs(owner)}><section class="showcase-section"><div class="showcase-section-heading"><div><p class="eyebrow">MYŠLIENKY, KTORÉ MA SPREVÁDZAJÚ</p><h3>Obľúbené citáty</h3></div><span class="showcase-count">${chosen.length} / 6</span></div>${chosen.length ? `<div class="showcase-quotes">${chosen.map(quoteCard).join('')}</div>` : '<p class="showcase-empty">Na profile zatiaľ nie sú vybrané citáty.</p>'}</section><section class="showcase-section"><div class="showcase-section-heading"><div><p class="eyebrow">Z OTVORENÉHO ZÁPISNÍKA</p><h3>Verejné poznámky</h3></div></div>${featured.length ? `<div class="showcase-featured">${noteCards(featured, owner, true)}</div>` : ''}<div class="showcase-notes" data-showcase-notes>${noteCards(notes, owner)}</div>${!featured.length && !notes.length ? '<p class="showcase-empty">Zatiaľ tu nie sú verejné poznámky.</p>' : ''}<div class="showcase-more" data-showcase-page>${moreButton(owner, data.nextOffset)}</div></section></div>`;
  }
  function renderOwn() {
    if (!sync()) return '';
    const profile = own.data?.profile;
    const body = own.error ? `<div class="notice" role="alert">${esc(own.error)} ${button('showcase-retry', 'Skúsiť znova')}</div>` : own.loaded ? renderPublic(own.data) : '<p class="showcase-empty" role="status">Načítavam tvoj verejný profil…</p>';
    return `<section class="showcase-own" aria-labelledby="showcase-heading"><header class="showcase-own-heading"><div><p class="eyebrow">TVOJE MIESTO MEDZI ČARODEJNÍKMI</p><h2 id="showcase-heading">Verejný profil</h2><p class="showcase-visibility ${profile?.visible ? 'is-visible' : ''}">${profile ? profile.visible ? '◇ Viditeľný ostatným prihláseným čarodejníkom.' : '◇ Profil je súkromný. Nižšie vidíš svoj náhľad.' : 'Viditeľnosť profilu sa načítava…'}</p></div><div class="card-actions">${button('social-profile', 'Upraviť viditeľnosť a predstavenie')}${button('navigate', 'Sieň slávy →', 'data-view="hall"', 'ghost small')}</div></header><div class="showcase-own-tools"><p>Zo svojej osobnej zbierky vyber najviac 6 citátov, ktoré chceš vystaviť. Uloženie citátu do zbierky ho samo nepridá na verejný profil.</p>${button('showcase-edit', 'Vybrať citáty na profil', '', 'primary small')}</div>${body}<footer class="showcase-own-footer"><div><p>Ostatní uvidia iba poznámky, ktorým v editore nastavíš verejnú viditeľnosť. Pripnutie na profil ich zvýrazní na začiatku.</p><p class="form-hint">Verejné poznámky a vybrané citáty sa ostatným zobrazia po zviditeľnení profilu.</p></div><div class="card-actions">${button('showcase-manage-notes', 'Spravovať verejné poznámky')}${button('dn-section', 'Poznámky pripnuté k profilu', 'data-section="profile"', 'ghost small')}</div></footer></section>`;
  }
  function beginModal(title) {
    const token = ++formToken, gen = generation, id = accountId;
    A().openModal(title, '<div id="showcase-loading" data-showcase-modal role="status">Načítavam…</div>', null, { readOnly: true });
    const marker = document.getElementById('showcase-loading');
    return { gen, id, token, marker, valid: () => sameSession(gen, id) && formToken === token && !!marker?.isConnected && !!document.getElementById('modal')?.open };
  }
  function modalFailure(context, error, action, attrs) {
    if (!context.valid()) return;
    context.marker.innerHTML = `<p class="form-error" role="alert">${esc(error.message || 'Načítanie sa nepodarilo.')}</p>${button(action, 'Skúsiť znova', attrs)}`;
    context.marker.removeAttribute('role');
  }
  async function editQuotes() {
    if (!sync()) return;
    const context = beginModal('Citáty na tvojom profile');
    // Always re-read the collection: personal favourites may have changed in another view or tab.
    const collection = resource(), current = resource();
    await Promise.all([load(collection, '/api/quotes/saved', 'saved'), load(current, '/api/social/showcase', 'showcase')]);
    if (!context.valid()) return;
    if (collection.error || current.error) { modalFailure(context, Error(collection.error || current.error), 'showcase-edit', ''); return; }
    saved = collection; selection = current;
    const allowed = new Set((Array.isArray(collection.data) ? collection.data : []).map(row => row.quoteId).filter(id => catalog.has(id)));
    const chosen = new Set(quoteIds(current.data?.quoteIds).filter(id => allowed.has(id)));
    const quotes = [...allowed].map(id => catalog.get(id));
    const revision = current.data?.revision;
    A().openModal('Citáty na tvojom profile', `<div id="showcase-editor" data-showcase-modal><p>Vyber najviac 6 citátov zo svojej osobnej zbierky. Zverejnený výber zmeníš až tlačidlom <strong>Uložiť výber</strong>.</p><p class="form-hint">Výber bude viditeľný ostatným prihláseným čarodejníkom, keď bude tvoj profil verejný.</p><p class="showcase-selection-count" id="showcase-selection-count" role="status" aria-live="polite">${chosen.size} / 6 vybraných</p><div id="showcase-selection-conflict"></div>${quotes.length ? `<div class="showcase-picker">${quotes.map(quote => `<label class="showcase-picker-choice"><input type="checkbox" name="quoteIds" value="${esc(quote.id)}" aria-label="${esc('Vystaviť citát: ' + (quote.author || 'Autor neurčený') + ' – ' + String(quote.text || '').slice(0, 120))}" ${chosen.has(quote.id) ? 'checked' : ''}><span>${quoteCard(quote)}</span></label>`).join('')}</div>` : '<div class="showcase-empty"><p>V osobnej zbierke ešte nemáš citáty. Najprv si ulož tie, ktoré ťa oslovia.</p><button type="button" class="btn secondary small" data-action="showcase-collection">Otvoriť moju zbierku</button></div>'}</div>`, async fd => {
      assertSession(context.gen, context.id);
      if (!valid()) throw Error('Otvor výber citátov znova.');
      const ids = [...new Set(fd.getAll('quoteIds').map(String))];
      if (ids.length > 6 || ids.some(id => !allowed.has(id))) throw Error('Vyber najviac 6 citátov zo svojej zbierky.');
      if (!Number.isSafeInteger(revision) || revision < 0) throw Error('Výber sa nenačítal správne. Načítaj ho znova.');
      const boxes = editor.querySelectorAll('input[name="quoteIds"]'); boxes.forEach(input => { input.disabled = true; });
      try {
        const result = await request('/api/social/showcase', { method: 'PUT', body: { quoteIds: ids, expectedRevision: revision } });
        assertSession(context.gen, context.id);
        if (!valid()) return;
        selection.data = result.showcase; selection.loaded = true;
        own = resource(); A().toast('Výber citátov na profile je uložený.'); redraw();
      } catch (error) {
        if (!valid()) return;
        if (error.status === 409) {
          const panel = document.getElementById('showcase-selection-conflict');
          if (panel) panel.innerHTML = `<div class="notice"><p>Výber sa medzitým zmenil v inom okne. Tvoje zaškrtnutia zostali zachované. Načítaj aktuálny výber a uprav ho znova.</p>${button('showcase-edit', 'Načítať aktuálny výber')}</div>`;
          throw Error('Výber sa zmenil v inom okne. Načítaj aktuálny výber pred ďalším uložením.');
        }
        throw error;
      } finally { if (valid()) { boxes.forEach(input => { input.disabled = false; }); updateCount(); } }
    }, { submitLabel: 'Uložiť výber' });
    const editor = document.getElementById('showcase-editor');
    const valid = () => sameSession(context.gen, context.id) && formToken === context.token && !!editor?.isConnected && !!document.getElementById('modal')?.open;
    const updateCount = () => {
      if (!valid()) return;
      const boxes = [...editor.querySelectorAll('input[name="quoteIds"]')], count = boxes.filter(input => input.checked).length;
      const counter = document.getElementById('showcase-selection-count');
      if (counter) counter.textContent = `${count} / 6 vybraných${count >= 6 ? ' · limit je naplnený' : ''}`;
      boxes.forEach(input => { input.disabled = !input.checked && count >= 6; });
    };
    editor.addEventListener('change', updateCount); updateCount();
  }
  async function openPublicNote(owner, noteId) {
    if (!sync() || !owner || !noteId) return;
    const context = beginModal('Verejná poznámka');
    try {
      const result = await request('/api/social/wizards/' + encodeURIComponent(owner) + '/notes/' + encodeURIComponent(noteId));
      if (!context.valid()) return;
      const note = result.note;
      if (!note || note.id !== noteId) throw Error('Poznámka už nie je verejne dostupná.');
      A().openModal(note.title || 'Verejná poznámka', `<article class="showcase-note-reader" data-showcase-modal><p class="showcase-note-meta">${note.featured ? '📌 Pripnutá na profile · ' : ''}${esc(dateText(note.updatedAt))}</p><div class="showcase-note-text">${esc(note.text)}</div><div class="card-actions">${button('showcase-profile', '← Späť na profil', accountAttrs(owner))}</div></article>`, null, { readOnly: true });
    } catch (error) { modalFailure(context, error, 'showcase-note', `${accountAttrs(owner)} data-id="${esc(noteId)}"`); }
  }
  async function openPublicProfile(owner) {
    if (!sync() || !owner) return;
    const context = beginModal('Čarodejnícky profil');
    try {
      const result = await request('/api/social/wizards/' + encodeURIComponent(owner));
      if (!context.valid()) return;
      if (!accessible(result, owner)) throw Error('Profil už nie je verejne dostupný.');
      A().openModal(result.profile.displayName || 'Čarodejnícky profil', `<div data-showcase-modal><p class="social-full-bio">${esc(result.profile.bio || 'Predstavenie nie je uvedené.')}</p>${renderPublic(result)}</div>`, null, { readOnly: true });
    } catch (error) { modalFailure(context, error, 'showcase-profile', accountAttrs(owner)); }
  }
  async function moreNotes(el) {
    const owner = el.dataset.account, offset = Number(el.dataset.offset), container = el.closest('.showcase-public');
    if (!owner || !Number.isSafeInteger(offset) || offset < 0 || !container || el.disabled) return;
    const gen = generation, id = accountId;
    el.disabled = true; el.textContent = 'Načítavam poznámky…';
    const valid = () => sameSession(gen, id) && container.isConnected && el.isConnected;
    try {
      const result = await request('/api/social/wizards/' + encodeURIComponent(owner) + '?offset=' + offset);
      if (!valid()) return;
      if (!accessible(result, owner)) throw Object.assign(Error('Profil už nie je verejne dostupný.'), { status: 404 });
      const list = container.querySelector('[data-showcase-notes]');
      const seen = new Set([...container.querySelectorAll('[data-showcase-note]')].map(card => card.dataset.showcaseNote));
      const notes = (Array.isArray(result.notes) ? result.notes : []).filter(note => !seen.has(note.id));
      if (list) list.insertAdjacentHTML('beforeend', noteCards(notes, owner));
      const footer = el.closest('[data-showcase-page]');
      if (footer) footer.innerHTML = moreButton(owner, result.nextOffset);
    } catch (error) {
      if (!valid()) return;
      if (error.status === 403 || error.status === 404) container.innerHTML = `<p class="form-error" role="alert">${esc(error.message || 'Profil už nie je verejne dostupný.')}</p>`;
      else {
        const footer = el.closest('[data-showcase-page]');
        if (footer) footer.innerHTML = `<p class="form-error" role="alert">${esc(error.message || 'Ďalšie poznámky sa nepodarilo načítať.')}</p>${moreButton(owner, offset)}`;
      }
    }
  }
  function afterRender(view) {
    if (!sync()) return;
    activeView = view;
    if (view === 'profile') { loadOwn(); loadSelection(); loadSaved(); }
  }
  async function handleAction(action, el) {
    if (!action.startsWith('showcase-')) return false;
    if (!sync()) return true;
    if (action === 'showcase-edit') await editQuotes();
    else if (action === 'showcase-retry') invalidate();
    else if (action === 'showcase-note') await openPublicNote(el.dataset.account, el.dataset.id);
    else if (action === 'showcase-profile') await openPublicProfile(el.dataset.account);
    else if (action === 'showcase-more') await moreNotes(el);
    else if (action === 'showcase-manage-notes') { formToken++; closeOwnModal(); window.MODayNotes.openPublic(); }
    else if (action === 'showcase-collection') { formToken++; closeOwnModal(); A().navigate('quotes'); }
    return true;
  }
  window.MOShowcase = { renderOwn, afterRender, handleAction, destroy, renderPublic, openPublicNote, invalidate };
})();
