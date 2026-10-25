(() => {
  'use strict';
  const A = () => window.MOApp, auth = () => window.MOAuth;
  const esc = value => A().esc(String(value ?? ''));
  const resource = () => ({ items: [], loaded: false, loading: false, error: '', version: 0 });
  let accountId = '', generation = 0, activeView = '', tab = 'books', selected = '';
  let categories = resource(), photos = new Map(), formSerial = 0;
  const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
  const currentAccount = () => auth().getAccount()?.id || '';
  const photoCountText = value => { const n = Number(value) || 0; return `${n} ${n === 1 ? 'fotografia' : n >= 2 && n <= 4 ? 'fotografie' : 'fotografií'}`; };
  const same = (gen, id) => !!id && gen === generation && id === accountId && id === currentAccount();
  const photoUrl = photo => uuid(photo?.id) ? '/api/library/photos/' + photo.id : '';
  function destroy() {
    generation++; formSerial++; accountId = ''; activeView = ''; selected = ''; tab = 'books';
    categories = resource(); photos = new Map();
    if (document.querySelector('#modal [data-lc-modal]')) document.getElementById('modal')?.close();
  }
  function sync() {
    const id = currentAccount();
    if (accountId !== id) { destroy(); accountId = id; }
    return !!id;
  }
  function assertSession(gen, id) {
    if (!same(gen, id)) throw Error('Prihlásenie sa zmenilo. Otvor knižnicu znova.');
  }
  async function request(path, options) {
    const gen = generation, id = accountId; assertSession(gen, id);
    const result = await auth().api(path, options); assertSession(gen, id); return result;
  }
  function listFor(id) {
    if (!photos.has(id)) photos.set(id, resource());
    return photos.get(id);
  }
  function currentCategory() { return categories.items.find(item => item.id === selected); }
  function button(action, label, attrs = '', style = 'secondary small') {
    return `<button type="button" class="btn ${style}" data-action="${action}" ${attrs}>${label}</button>`;
  }
  function tabs() {
    sync();
    return `<nav class="lc-tabs" aria-label="Časti knižnice">${button('lc-tab', 'Knihy', `data-tab="books" aria-pressed="${tab === 'books'}"`)}${button('lc-tab', 'Kategórie', `data-tab="categories" aria-pressed="${tab === 'categories'}"`)}</nav>`;
  }
  function rail(id, label, content, extra = '') {
    return `<div class="lc-rail-wrap"><div class="lc-rail-arrows">${button('lc-scroll', '←', `data-rail="${id}" data-direction="-1" aria-controls="${id}" aria-label="${esc(label)}: posunúť doľava"`, 'ghost small')}${button('lc-scroll', '→', `data-rail="${id}" data-direction="1" aria-controls="${id}" aria-label="${esc(label)}: posunúť doprava"`, 'ghost small')}</div><div id="${id}" class="lc-rail ${extra}" tabindex="0" role="region" aria-label="${esc(label)}. Posúvaj šípkami doľava a doprava.">${content}</div></div>`;
  }
  function render() {
    sync();
    const cat = currentCategory(), items = cat ? listFor(cat.id) : null;
    const categoriesBody = categories.error ? `<div class="lc-message" role="alert">${esc(categories.error)} ${button('lc-retry-categories', 'Skúsiť znova')}</div>` : !categories.loaded ? '<p class="lc-message" role="status">Načítavam kategórie…</p>' : !categories.items.length ? '<p class="lc-message">Vytvor prvú kategóriu, napríklad Filozofia, Peniaze alebo Nápady. Do každej môžeš ukladať vlastné fotografie.</p>' : rail('lc-categories', 'Kategórie', categories.items.map(item => `<button type="button" class="lc-category${selected === item.id ? ' is-selected' : ''}" data-action="lc-select" data-id="${esc(item.id)}" aria-pressed="${selected === item.id}"><span class="lc-category-icon" aria-hidden="true">${A().icon('book', 25)}</span><strong>${esc(item.name)}</strong><span>${photoCountText(item.photoCount)}</span></button>`).join(''));
    const photoBody = !cat ? '' : items.error ? `<div class="lc-message" role="alert">${esc(items.error)} ${button('lc-retry-photos', 'Skúsiť znova')}</div>` : !items.loaded ? '<p class="lc-message" role="status">Načítavam fotografie…</p>' : !items.items.length ? '<p class="lc-message">Táto kategória je zatiaľ prázdna. Pridaj fotografie alebo odfotené poznámky.</p>' : rail('lc-photos', 'Fotografie v kategórii ' + cat.name, items.items.map(photo => `<article class="lc-photo"><button type="button" class="lc-photo-open" data-action="lc-open-photo" data-id="${esc(photo.id)}" aria-label="Otvoriť fotografiu${photo.caption ? ': ' + esc(photo.caption) : ''}"><img src="${photoUrl(photo)}" alt="${esc(photo.caption || 'Fotografia v kategórii ' + cat.name)}" loading="lazy" decoding="async"></button><div class="lc-photo-footer"><p title="${esc(photo.caption || '')}">${esc(photo.caption || 'Bez popisu')}</p>${button('lc-delete-photo', A().icon('trash', 17), `data-id="${esc(photo.id)}" aria-label="Odstrániť fotografiu${photo.caption ? ': ' + esc(photo.caption) : ''}"`, 'ghost small')}</div></article>`).join(''), 'lc-photos');
    return `<section id="library-categories-root" class="content-panel lc-panel" aria-labelledby="lc-title"><header class="lc-heading"><div><p class="eyebrow">TVOJE VLASTNÉ POLIČKY</p><h2 id="lc-title">Kategórie knižnice</h2><p class="muted">Kategórie aj fotografie listuj do strán. Šípkami, posunutím prsta alebo vodorovným posuvníkom.</p></div>${button('lc-create', A().icon('plus', 17) + ' Nová kategória', '', 'primary small')}</header>${categoriesBody}${cat ? `<section class="lc-category-detail" aria-labelledby="lc-category-title"><header class="lc-heading"><div><p class="eyebrow">OTVORENÁ KATEGÓRIA</p><h3 id="lc-category-title">${esc(cat.name)}</h3></div><div class="card-actions">${button('lc-rename', A().icon('edit', 16) + ' Premenovať')}${button('lc-upload', A().icon('upload', 17) + ' Pridať fotografie', '', 'primary small')}</div></header>${photoBody}</section>` : ''}</section>`;
  }
  function refresh() {
    if (activeView !== 'library' || tab !== 'categories' || !same(generation, accountId)) return;
    const node = document.getElementById('library-categories-root'); if (!node) return;
    const positions = new Map([...node.querySelectorAll('.lc-rail')].map(rail => [rail.id, rail.scrollLeft]));
    const focused = node.contains(document.activeElement) ? { action: document.activeElement.dataset.action, id: document.activeElement.dataset.id, rail: document.activeElement.id } : null;
    node.outerHTML = render();
    for (const [id, position] of positions) { const rail = document.getElementById(id); if (rail) rail.scrollLeft = position; }
    if (focused) {
      const root = document.getElementById('library-categories-root');
      const match = [...root.querySelectorAll('[data-action],.lc-rail')].find(node => focused.rail ? node.id === focused.rail : node.dataset.action === focused.action && node.dataset.id === focused.id);
      match?.focus({ preventScroll: true });
    }
  }
  async function loadCategories(force = false) {
    if (categories.loading || (!force && (categories.loaded || categories.error)) || !accountId) return;
    const gen = generation, id = accountId, target = categories, version = target.version; target.loading = true; target.error = '';
    try {
      const result = await request('/api/library/categories'); if (!same(gen, id) || version !== target.version) return;
      target.items = (Array.isArray(result.categories) ? result.categories : []).filter(item => uuid(item.id)); target.loaded = true;
      if (!currentCategory()) selected = target.items[0]?.id || '';
    } catch (error) { if (same(gen, id)) target.error = error.message || 'Kategórie sa nepodarilo načítať.'; }
    finally { if (same(gen, id)) { target.loading = false; refresh(); if (version !== target.version) void loadCategories(true); if (selected) void loadPhotos(selected); } }
  }
  async function loadPhotos(id, force = false) {
    const target = listFor(id); if (target.loading || (!force && (target.loaded || target.error)) || !uuid(id)) return;
    const gen = generation, owner = accountId, version = target.version; target.loading = true; target.error = '';
    try {
      const result = await request('/api/library/categories/' + id + '/photos'); if (!same(gen, owner) || version !== target.version) return;
      target.items = (Array.isArray(result.photos) ? result.photos : []).filter(item => uuid(item.id)); target.loaded = true;
    } catch (error) { if (same(gen, owner)) target.error = error.message || 'Fotografie sa nepodarilo načítať.'; }
    finally { if (same(gen, owner)) { target.loading = false; refresh(); if (version !== target.version) void loadPhotos(id, true); } }
  }
  function afterRender(view) {
    sync(); activeView = view;
    if (view === 'library' && tab === 'categories') { void loadCategories(); if (selected) void loadPhotos(selected); }
  }
  function beginForm() {
    const serial = ++formSerial, gen = generation, id = accountId;
    return { gen, id, assert() { assertSession(gen, id); if (serial !== formSerial) throw Error('Otvor formulár znova.'); } };
  }
  function categoryForm(rename) {
    const cat = rename ? currentCategory() : null; if (rename && !cat) return;
    const context = beginForm();
    A().openModal(rename ? 'Premenovať kategóriu' : 'Nová kategória', `<div class="field" data-lc-modal><label for="lc-name">Názov kategórie</label><input id="lc-name" name="name" value="${esc(cat?.name || '')}" required maxlength="80" autocomplete="off" placeholder="Napríklad Filozofia"></div>`, async data => {
      context.assert(); const name = String(data.get('name') || '').trim(); if (!name || name.length > 80) throw Error('Vyplň názov s najviac 80 znakmi.');
      const result = await request('/api/library/categories' + (cat ? '/' + cat.id : ''), { method: cat ? 'PATCH' : 'POST', body: cat ? { name, expectedRevision: cat.revision } : { name } });
      context.assert(); const item = result.category;
      if (!uuid(item?.id)) throw Error('Uloženie kategórie sa nepodarilo potvrdiť. Obnov zoznam.');
      categories.version++; categories.items = cat ? categories.items.map(old => old.id === cat.id ? { ...old, ...item } : old) : [...categories.items, item];
      categories.loaded = true; categories.error = ''; selected = item.id; refresh(); void loadPhotos(selected); A().toast(cat ? 'Názov kategórie je uložený.' : 'Kategória je pripravená.');
    }, { submitLabel: rename ? 'Uložiť názov' : 'Vytvoriť kategóriu' });
  }
  async function compressPhoto(file) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Vyber fotografie vo formáte PNG, JPG alebo WebP.');
    if (!file.size || file.size > 20 * 1024 * 1024) throw Error('Jedna pôvodná fotografia môže mať najviac 20 MB.');
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('Fotografiu „' + file.name + '“ sa nepodarilo otvoriť.')); img.src = url; });
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 64000000) throw Error('Fotografia má príliš veľké rozmery. Vyber obrázok do 64 megapixelov.');
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext('2d'); if (!ctx) throw Error('Prehliadač nepodporuje úpravu fotografie.');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [.9, .8, .65, .5]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (data.startsWith('data:image/jpeg;base64,') && Math.ceil((data.length - data.indexOf(',') - 1) * .75) < 2 * 1024 * 1024) return data;
      }
      throw Error('Fotografia je aj po zmenšení príliš veľká. Vyber menší obrázok.');
    } finally { URL.revokeObjectURL(url); }
  }
  function uploadForm() {
    const cat = currentCategory(); if (!cat) return;
    const context = beginForm(), uploaded = new WeakSet();
    A().openModal('Fotografie · ' + cat.name, `<div class="field" data-lc-modal><label for="lc-files">Vyber fotografie</label><input id="lc-files" name="photos" type="file" accept="image/png,image/jpeg,image/webp" multiple required><p class="form-hint">Naraz najviac 20 fotografií. Fotografie sa pred uložením zmenšia na najviac 1600 px.</p></div><div class="field"><label for="lc-caption">Popis (nepovinný)</label><input id="lc-caption" name="caption" maxlength="300"><p class="form-hint">Pri viacerých fotografiách sa tento popis pridá ku každej.</p></div><p id="lc-upload-status" role="status" aria-live="polite"></p>`, async data => {
      context.assert(); const files = data.getAll('photos').filter(file => file && file.size);
      if (!files.length || files.length > 20) throw Error('Vyber od 1 do 20 fotografií.');
      const caption = String(data.get('caption') || '').trim(); if (caption.length > 300) throw Error('Popis môže mať najviac 300 znakov.');
      for (const file of files) if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw Error('Vyber PNG, JPG alebo WebP do 20 MB na jednu fotografiu.');
      const marker = document.getElementById('lc-upload-status'), stillOpen = () => marker?.isConnected && document.getElementById('modal')?.open;
      let added = 0;
      try {
        for (let index = 0; index < files.length; index++) {
          context.assert(); if (!stillOpen()) break; const file = files[index]; if (uploaded.has(file)) continue;
          marker.textContent = `Ukladám fotografiu ${index + 1} z ${files.length}…`;
          const image = await compressPhoto(file); context.assert(); if (!stillOpen()) break;
          const result = await request('/api/library/categories/' + cat.id + '/photos', { method: 'POST', body: { image, caption } }); context.assert();
          uploaded.add(file); added++;
          const target = listFor(cat.id); target.version++; categories.version++; if (uuid(result.photo?.id) && !target.items.some(photo => photo.id === result.photo.id)) target.items.push(result.photo);
          const category = categories.items.find(item => item.id === cat.id); if (category) category.photoCount = (Number(category.photoCount) || 0) + 1;
        }
      } catch (error) { throw Error((added ? `${added} fotografií je uložených. ` : '') + (error.message || 'Ďalšiu fotografiu sa nepodarilo uložiť.') + ' Už potvrdené fotografie sa pri opakovaní tohto formulára nepridajú znova.'); }
      finally { if (same(context.gen, context.id)) { refresh(); void loadCategories(true); void loadPhotos(cat.id, true); } }
      if (added) A().toast(`Uložené fotografie: ${added}.`);
    }, { submitLabel: 'Uložiť fotografie' });
  }
  async function handleAction(action, el) {
    if (!action.startsWith('lc-')) return false;
    if (!sync()) return true;
    if (action === 'lc-tab') { tab = el.dataset.tab === 'categories' ? 'categories' : 'books'; A().render(); return true; }
    if (action === 'lc-scroll') {
      const rail = document.getElementById(el.dataset.rail); rail?.scrollBy({ left: (Number(el.dataset.direction) < 0 ? -1 : 1) * Math.max(180, rail.clientWidth * .8), behavior: 'smooth' }); return true;
    }
    if (action === 'lc-create') categoryForm(false);
    if (action === 'lc-rename') categoryForm(true);
    if (action === 'lc-select' && categories.items.some(cat => cat.id === el.dataset.id)) { selected = el.dataset.id; refresh(); void loadPhotos(selected); }
    if (action === 'lc-upload') uploadForm();
    if (action === 'lc-retry-categories') { categories.error = ''; void loadCategories(true); refresh(); }
    if (action === 'lc-retry-photos' && selected) { listFor(selected).error = ''; void loadPhotos(selected, true); refresh(); }
    if (action === 'lc-open-photo' || action === 'lc-delete-photo') {
      const cat = currentCategory(), photo = cat && listFor(cat.id).items.find(photo => photo.id === el.dataset.id);
      if (!photo) return true;
      const context = beginForm();
      if (action === 'lc-open-photo') A().openModal(photo.caption || 'Fotografia · ' + cat.name, `<div data-lc-modal class="lc-photo-detail"><img src="${photoUrl(photo)}" alt="${esc(photo.caption || 'Fotografia v kategórii ' + cat.name)}">${photo.caption ? `<p>${esc(photo.caption)}</p>` : ''}</div>`, null, { readOnly: true });
      else A().openModal('Odstrániť fotografiu?', `<div data-lc-modal><p>Fotografia sa odstráni z kategórie <strong>${esc(cat.name)}</strong>.</p><p class="form-hint">Pôvodný súbor v počítači zostane zachovaný.</p></div>`, async () => {
        context.assert(); await request('/api/library/photos/' + photo.id, { method: 'DELETE', body: {} }); context.assert();
        const target = listFor(cat.id); target.version++; categories.version++; target.items = target.items.filter(item => item.id !== photo.id);
        const category = categories.items.find(item => item.id === cat.id); if (category) category.photoCount = Math.max(0, (Number(category.photoCount) || 0) - 1);
        refresh(); void loadCategories(true); A().toast('Fotografia bola odstránená.');
      }, { submitLabel: 'Odstrániť fotografiu' });
    }
    return true;
  }
  document.addEventListener('keydown', event => {
    const rail = event.target.closest?.('.lc-rail'); if (!rail || event.target !== rail || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') rail.scrollTo({ left: event.key === 'Home' ? 0 : rail.scrollWidth, behavior: 'smooth' });
    else rail.scrollBy({ left: (event.key === 'ArrowLeft' ? -1 : 1) * Math.max(180, rail.clientWidth * .8), behavior: 'smooth' });
  });
  window.MOLibraryCategories = { tabs, render, afterRender, handleAction, destroy, isActive: () => tab === 'categories' };
})();
