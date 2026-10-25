(function () {
  'use strict';

  var A = function () { return window.MOApp; };
  var M = function () { return A().model; };
  var S = function () { return A().state; };
  var e = function (value) { return A().esc(value == null ? '' : String(value)); };
  var icon = function (name, size) { return A().icon(name, size || 20); };
  var number = function (value) { return new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 2 }).format(Number(value) || 0); };
  var money = function (value) { return new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0); };
  var catalog = function () { return M().CATALOG || []; };
  var daily = function () { return M().DAILY || []; };
  var owned = function (item) { return (item.type === 'outfit' ? S().wardrobe : S().animals).indexOf(item.id) >= 0; };
  var color = function (value) { return /^#[0-9a-f]{3,8}$/i.test(value || '') ? value : '#D57C9F'; };
  var wizardAsset = function (id) { return 'assets/wizard.svg' + ({ rose: '#rose', forest: '#forest', midnight: '#cobalt' }[id] || ''); };

  function button(action, label, options) {
    options = options || {};
    return '<button type="button" class="btn ' + (options.className || 'primary') + '" data-action="' + e(action) + '"' + (options.id ? ' data-id="' + e(options.id) + '"' : '') + (options.minutes ? ' data-minutes="' + e(options.minutes) + '"' : '') + (options.disabled ? ' disabled' : '') + '>' + (options.icon ? icon(options.icon, 18) : '') + '<span>' + e(label) + '</span></button>';
  }

  function head(eyebrow, title, subtitle, actions) {
    return '<header class="page-header"><div><div class="eyebrow">' + e(eyebrow) + '</div><h1 class="page-title">' + e(title) + '</h1><p class="page-subtitle">' + e(subtitle) + '</p></div><div class="toolbar">' + (actions || '') + '</div></header>';
  }

  function stat(value, label, glyph) {
    return '<div class="stat">' + (glyph ? icon(glyph, 22) : '') + '<div><div class="value">' + e(value) + '</div><div class="label">' + e(label) + '</div></div></div>';
  }

  function empty(glyph, title, text, action) {
    return '<div class="empty-state"><div class="empty-icon">' + icon(glyph, 38) + '</div><h2>' + e(title) + '</h2><p>' + e(text) + '</p>' + (action || '') + '</div>';
  }

  function field(label, name, value, options) {
    options = options || {};
    var attrs = ' name="' + e(name) + '" id="extra-' + e(name) + '"';
    if (options.required) attrs += ' required';
    if (options.maxLength) attrs += ' maxlength="' + options.maxLength + '"';
    if (options.min != null) attrs += ' min="' + options.min + '"';
    if (options.max != null) attrs += ' max="' + options.max + '"';
    if (options.step) attrs += ' step="' + options.step + '"';
    if (options.placeholder) attrs += ' placeholder="' + e(options.placeholder) + '"';
    var control = options.textarea ? '<textarea' + attrs + ' rows="4">' + e(value) + '</textarea>' : '<input type="' + (options.type || 'text') + '"' + attrs + ' value="' + e(value) + '">';
    return '<div class="field' + (options.full ? ' full' : '') + '"><label for="extra-' + e(name) + '">' + e(label) + '</label>' + control + (options.hint ? '<p class="form-hint">' + e(options.hint) + '</p>' : '') + '</div>';
  }

  function numeric(form, key, label, options) {
    options = options || {};
    var raw = String(form.get(key) || '').trim();
    var value = Number(raw);
    if (!raw || !Number.isFinite(value) || value < (options.min == null ? 0 : options.min) || (options.integer && !Number.isSafeInteger(value)) || value > (options.max || 1000000000)) {
      throw new Error('Vyplň platnú hodnotu pre „' + label + '“.');
    }
    return value;
  }

  function textValue(form, key, label, max) {
    var value = String(form.get(key) || '').trim();
    if (!value || value.length > (max || 120)) throw new Error('Vyplň „' + label + '“ (najviac ' + (max || 120) + ' znakov).');
    return value;
  }

  function progress(value, total) {
    var percent = total > 0 ? Math.max(0, Math.min(100, value / total * 100)) : 0;
    return '<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="' + e(total) + '" aria-valuenow="' + e(Math.min(value, total)) + '"><div class="progress-fill" style="width:' + percent + '%"></div></div>';
  }

  function recent(metric) {
    var records = S().ledger.filter(function (entry) { return entry.metric === metric; }).slice(-5).reverse();
    if (!records.length) return '<p class="muted">Prvý zápis sa objaví tu.</p>';
    return '<div class="activity-list">' + records.map(function (entry) {
      var date = new Date(entry.at);
      var dateText = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('sk-SK', { day: 'numeric', month: 'short' });
      return '<div class="activity-row"><div class="activity-icon">' + icon('check', 18) + '</div><div class="activity-info"><strong>' + e(entry.label) + '</strong><small class="muted">' + e(dateText) + '</small></div><span class="activity-amount positive">+' + number(entry.coins) + ' ' + icon('coin', 16) + '</span></div>';
    }).join('') + '</div>';
  }

  function meditation() {
    var med = S().meditation;
    return '<section class="scene illustrated-room meditation-page"><div class="scene-inner">' + head('Pokoj pod korunou stromu', 'Strom meditácie', 'Na chvíľu spomaľ. Zapíš čas, ktorý si venoval meditácii.', button('extra-meditate', 'Zapísať meditáciu', { icon: 'plus' })) +
      '<div class="stats-strip">' + stat(number(med.total) + ' min', 'celkový čas', 'clock') + stat(number(med.threshold) + ' min', 'na jednu odmenu', 'tree') + stat(number(med.reward), 'koruna za odmenu', 'coin') + '</div>' +
      '<div class="grid two"><div class="content-panel"><div class="empty-icon">' + icon('tree', 58) + '</div><h2 class="section-title">Tvoj pokoj prináša ovocie</h2><p>Každých ' + number(med.threshold) + ' minút meditácie ti prinesie ' + number(med.reward) + ' korunu. Zvyšné minúty sa prenášajú do ďalšieho zápisu.</p><div class="progress-meta"><span>K ďalšej odmene</span><strong>' + number(med.remainder) + ' / ' + number(med.threshold) + ' min</strong></div>' + progress(med.remainder, med.threshold) + '<div class="card-actions">' + button('extra-meditate-quick', 'Dokončil som 25 minút', { className: 'secondary', icon: 'check', minutes: 25 }) + '</div></div><div class="content-panel"><h2 class="section-title">Posledné meditácie</h2>' + recent('meditation') + '</div></div></div></section>';
  }

  function gallery() {
    var projects = S().projects;
    var complete = projects.filter(function (p) { return p.done; }).length;
    var cards = projects.map(function (p) {
      return '<article class="card project-card"><div class="card-top"><div class="empty-icon">' + icon(p.done ? 'check' : 'palette', 28) + '</div><span class="tag">' + (p.done ? 'Dokončený' : 'Rozpracovaný') + '</span></div><h2>' + e(p.title) + '</h2><p class="muted">' + (p.done ? 'Tvorba sa počíta. Odmenu už máš vo svojom mešci.' : 'Dokonči svoj skutočný projekt a získaj 1 korunu.') + '</p><div class="card-actions">' + (p.done ? '<span class="positive">' + icon('check', 18) + ' Odmena získaná</span>' : button('extra-project-finish', 'Dokončiť projekt', { id: p.id, icon: 'check' }) + button('extra-project-edit', 'Upraviť', { id: p.id, className: 'ghost small', icon: 'edit' })) + '</div></article>';
    }).join('');
    return '<section class="scene illustrated-room gallery-page"><div class="scene-inner">' + head('Miesto pre tvoju tvorbu', 'Galéria', 'Od nápadu k hotovému dielu. Každý dokončený projekt prinesie 1 korunu.', button('extra-project-add', 'Pridať projekt', { icon: 'plus' })) + '<div class="stats-strip">' + stat(number(projects.length - complete), 'rozpracované projekty', 'palette') + stat(number(complete), 'dokončené projekty', 'check') + '</div>' + (cards ? '<div class="grid two">' + cards + '</div>' : '<div class="content-panel">' + empty('palette', 'Každé dielo začína nápadom', 'Pridaj svoj prvý tvorivý projekt.', button('extra-project-add', 'Pridať projekt', { icon: 'plus' })) + '</div>') + '</div></section>';
  }

  function animalArt(id, size) {
    var art = {
      cat: '<path d="M25 30 17 8 40 23M55 23 78 8 71 32" fill="#b09bc7" stroke="#32283e" stroke-width="4"/><ellipse cx="48" cy="48" rx="33" ry="29" fill="#c2afd2" stroke="#32283e" stroke-width="4"/><path d="m31 46 8 1m18 0 8-1" stroke="#403153" stroke-width="5" stroke-linecap="round"/><path d="m44 57 4 4 4-4" fill="#df94b0"/><path d="M28 61 8 58m20 10L9 72m58-11 20-3m-20 10 19 4" stroke="#665276" stroke-width="2"/>',
      owl: '<path d="M19 32 17 10 39 21M56 21 80 10 77 34" fill="#bd9273" stroke="#493744" stroke-width="4"/><ellipse cx="48" cy="48" rx="32" ry="36" fill="#c49c7a" stroke="#493744" stroke-width="4"/><ellipse cx="34" cy="40" rx="17" ry="20" fill="#eddfbd"/><ellipse cx="62" cy="40" rx="17" ry="20" fill="#eddfbd"/><circle cx="34" cy="41" r="7" fill="#263342"/><circle cx="62" cy="41" r="7" fill="#263342"/><path d="m42 52 6 10 6-10" fill="#d9ae54"/><path d="M36 70h7m10 0h7m-19 9h14" stroke="#936d5b" stroke-width="3" stroke-linecap="round"/>',
      fox: '<path d="m17 40 2-32 25 24m10 0L79 8l1 32" fill="#d28257" stroke="#563b48" stroke-width="4"/><path d="M14 39q34-26 68 0L68 68 48 83 28 68Z" fill="#d68b5f" stroke="#563b48" stroke-width="4"/><path d="m17 45 31 22 31-22-13 25-18 13-18-13Z" fill="#efdfbf"/><path d="m29 44 10 4m18 0 10-4" stroke="#493744" stroke-width="5" stroke-linecap="round"/><path d="m42 63 6 6 6-6Z" fill="#493744"/>'
    };
    return '<svg width="' + (size || 100) + '" height="' + (size || 100) + '" viewBox="0 0 96 96" aria-hidden="true">' + (art[id] || art.cat) + '</svg>';
  }

  function farm() {
    var animals = catalog().filter(function (item) { return item.type === 'animal' && owned(item); });
    return '<section class="scene illustrated-room farm-page"><div class="scene-inner">' + head('Malí obyvatelia dedinky', 'Farma', 'Domov pre spoločníkov, ktorých si získal svojou vytrvalosťou.', button('extra-open-shop', 'Navštíviť obchod', { icon: 'shop' })) + (animals.length ? '<div class="grid three">' + animals.map(function (item) { return '<article class="card animal-card"><div class="animal-portrait">' + animalArt(item.id, 120) + '</div><h2>' + e(item.name) + '</h2><p class="muted">' + e(item.description) + '</p><span class="tag">' + icon('paw', 15) + ' U teba doma</span></article>'; }).join('') + '</div>' : '<div class="content-panel">' + empty('paw', 'Farma čaká na prvého spoločníka', 'Za nazbierané koruny si v obchode môžeš kúpiť zvieratá.', button('extra-open-shop', 'Vybrať spoločníka', { icon: 'shop' })) + '</div>') + '</div></section>';
  }

  function catalogCard(item) {
    var isOwned = owned(item);
    var isEquipped = item.type === 'outfit' && S().profile.equipped === item.id;
    var balance = M().balance(S());
    var artwork = item.type === 'animal' ? animalArt(item.id, 100) : '<div class="outfit-preview" style="--outfit-color:' + color(item.color) + '"><img src="' + wizardAsset(item.id) + '" alt="" width="110" height="130"></div>';
    var action = isOwned ? (item.type === 'outfit' ? button('extra-equip', isEquipped ? 'Oblečené' : 'Obliecť', { id: item.id, disabled: isEquipped, className: 'secondary', icon: isEquipped ? 'check' : 'hat' }) : '<span class="positive">' + icon('check', 18) + ' Býva na farme</span>') : button('extra-buy', 'Kúpiť za ' + number(item.price), { id: item.id, disabled: balance < item.price, icon: 'coin' });
    return '<article class="card ' + (item.type === 'outfit' ? 'outfit-card' : 'animal-card') + (isOwned ? ' is-owned' : '') + '"><div class="card-top"><span class="tag">' + (item.type === 'outfit' ? 'Oblečenie' : 'Spoločník') + '</span><span class="price">' + icon('coin', 18) + number(item.price) + '</span></div><div class="shop-art">' + artwork + '</div><h2>' + e(item.name) + '</h2><p class="muted">' + e(item.description) + '</p><div class="card-actions">' + action + '</div>' + (!isOwned && balance < item.price ? '<p class="form-hint">Chýba ti ' + number(item.price - balance) + ' korún.</p>' : '') + '</article>';
  }

  function shop() {
    var items = catalog();
    return '<section class="page shop-page">' + head('Niečo čarovné za tvoje úsilie', 'Magický obchod', 'Vyber si nový kostým alebo spoločníka. Každý predmet kupuješ len raz.', '<div class="balance-pill">' + icon('coin', 23) + '<strong>' + number(M().balance(S())) + '</strong><span>korún</span></div>') + '<h2 class="section-title">Čarodejov šatník</h2><div class="grid three">' + items.filter(function (i) { return i.type === 'outfit'; }).map(catalogCard).join('') + '</div><h2 class="section-title">Spoločníci do dedinky</h2><div class="grid three">' + items.filter(function (i) { return i.type === 'animal'; }).map(catalogCard).join('') + '</div></section>';
  }

  function challenges() {
    var key = M().dateKey();
    var claims = S().dailyClaims[key] || [];
    return '<section class="page challenges-page">' + head('Malé kroky každý deň', 'Denné výzvy', 'Plň svoje aktivity a vyzdvihni si zelený prášok. Nové výzvy začínajú o polnoci.', '<div class="balance-pill">' + icon('spark', 23) + '<strong>' + number(M().powder(S())) + '</strong><span>zeleného prášku</span></div>') + '<div class="grid two">' + daily().map(function (challenge) {
      var value = M().metricProgress(S(), challenge.metric, key);
      var done = value >= challenge.target;
      var claimed = Array.isArray(claims) ? claims.indexOf(challenge.id) >= 0 : !!claims[challenge.id];
      return '<article class="card challenge-card' + (claimed ? ' is-owned' : '') + '"><div class="card-top"><span class="empty-icon">' + icon(claimed ? 'check' : 'star', 28) + '</span><span class="tag">' + icon('spark', 15) + ' +' + number(challenge.powder) + '</span></div><h2>' + e(challenge.title) + '</h2><p class="muted">' + e(challenge.description) + '</p><div class="progress-meta"><span>' + (claimed ? 'Splnené a vyzdvihnuté' : done ? 'Výzva je splnená' : 'Dnešný progres') + '</span><strong>' + number(Math.min(value, challenge.target)) + ' / ' + number(challenge.target) + '</strong></div>' + progress(value, challenge.target) + '<div class="card-actions">' + button('extra-claim-daily', claimed ? 'Odmena vyzdvihnutá' : done ? 'Vyzdvihnúť odmenu' : 'Pokračuj v aktivitách', { id: challenge.id, disabled: claimed || !done, className: done && !claimed ? 'primary' : 'secondary', icon: claimed ? 'check' : 'spark' }) + '</div></article>';
    }).join('') + '</div><div class="notice">' + icon('spark', 20) + '<p>Zelený prášok sa ti zbiera do zásoby. Jeho ďalšie využitie spolu doplníme neskôr.</p></div></section>';
  }

  var BANK_FIELDS = [
    ['card', 'Na účte', 'Peniaze na karte a bankových účtoch'],
    ['cash', 'Hotovosť', 'Peniaze v peňaženke a doma'],
    ['invested', 'Investované', 'Aktuálna hodnota tvojich investícií'],
    ['owed', 'Dlžím', 'Koľko peňazí dlžíš ty'],
    ['receivable', 'Dlžia mi', 'Koľko peňazí dlžia tebe']
  ];

  function strategyCard(strategy) {
    var months = strategy.monthly > 0 ? Math.ceil(strategy.target / strategy.monthly) : null;
    var deadline = strategy.deadline ? new Date(strategy.deadline + 'T12:00:00').toLocaleDateString('sk-SK') : '';
    return '<article class="card"><div class="card-top"><span class="tag">Vlastná stratégia</span>' + button('extra-strategy-edit', 'Upraviť', { id: strategy.id, className: 'ghost small', icon: 'edit' }) + '</div><h3>' + e(strategy.title) + '</h3><div class="progress-meta"><span>Cieľ</span><strong>' + money(strategy.target) + '</strong></div><div class="progress-meta"><span>Mesačne odložiť</span><strong>' + money(strategy.monthly) + '</strong></div>' + (deadline ? '<div class="progress-meta"><span>Plánovaný dátum</span><strong>' + e(deadline) + '</strong></div>' : '') + (months ? '<p class="form-hint">Od nuly k cieľu pri tejto mesačnej sume: približne ' + number(months) + ' mesiacov.</p>' : '') + (strategy.notes ? '<p class="strategy-notes">' + e(strategy.notes).replace(/\n/g, '<br>') + '</p>' : '') + '<div class="card-actions">' + button('extra-strategy-delete', 'Odstrániť', { id: strategy.id, className: 'ghost small', icon: 'trash' }) + '</div></article>';
  }

  function bank() {
    var bank = S().bank;
    var assets = bank.card + bank.cash + bank.invested;
    var net = assets + bank.receivable - bank.owed;
    return '<section class="scene illustrated-room bank-page"><div class="scene-inner">' + head('Prehľad pre pokojnejšiu hlavu', 'Banka', 'Tvoje skutočné peniaze a vlastné finančné plány v eurách.', button('extra-bank-edit', 'Aktualizovať sumy', { icon: 'edit' })) + '<div class="stats-strip">' + stat(money(net), 'čistý majetok', 'bank') + stat(money(assets), 'účet, hotovosť a investície', 'coin') + '</div><div class="finance-grid">' + BANK_FIELDS.map(function (item) { return '<div class="finance-card"><span class="label">' + e(item[1]) + '</span><strong class="value' + (item[0] === 'owed' ? ' negative' : '') + '">' + money(bank[item[0]]) + '</strong><p class="muted">' + e(item[2]) + '</p></div>'; }).join('') + '</div><p class="form-hint">Čistý majetok = účet + hotovosť + investície + pohľadávky − dlhy.</p><div class="page-header"><div><h2 class="section-title">Moje finančné stratégie</h2><p class="muted">Pomenuj svoj cieľ a urči si, koľko chceš pravidelne odkladať.</p></div>' + button('extra-strategy-add', 'Vytvoriť stratégiu', { icon: 'plus', className: 'secondary' }) + '</div>' + (S().strategies.length ? '<div class="grid two">' + S().strategies.map(strategyCard).join('') + '</div>' : '<div class="content-panel">' + empty('bank', 'Daj svojim peniazom smer', 'Vytvor si prvý cieľ: rezervu, cestovanie alebo čokoľvek, na čom ti záleží.', button('extra-strategy-add', 'Vytvoriť stratégiu', { icon: 'plus' })) + '</div>') + '</div></section>';
  }

  function safeCalendar(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    var url;
    try { url = new URL(text); } catch (error) { throw new Error('Vlož celý odkaz začínajúci na https://.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Kalendár musí mať bezpečný odkaz začínajúci na https://.');
    return url.href;
  }

  function calendar() {
    var url = '';
    try { url = safeCalendar(S().settings.calendarUrl); } catch (error) { /* An invalid imported address is never made clickable. */ }
    return '<section class="page calendar-page">' + head('Tvoj čas, tvoj príbeh', 'Magnum Opus kalendár', 'Maj svoj kalendár poruke priamo z dedinky.', button('extra-calendar-edit', url ? 'Upraviť odkaz' : 'Pridať odkaz', { icon: url ? 'edit' : 'plus', className: 'secondary' })) + '<div class="content-panel">' + (url ? '<div class="empty-state"><div class="empty-icon">' + icon('calendar', 52) + '</div><h2>Kalendár je pripravený</h2><p class="calendar-address">' + e(url) + '</p><a class="btn primary" href="' + e(url) + '" target="_blank" rel="noopener noreferrer">' + icon('calendar', 20) + '<span>Otvoriť kalendár</span></a><p class="form-hint">Otvorí sa v novej karte.</p></div>' : empty('calendar', 'Pripoj svoj kalendár', 'Vlož odkaz na svoj Magnum Opus kalendár z ChatGPT knižnice alebo iný kalendár, ktorý používaš.', button('extra-calendar-edit', 'Pridať odkaz na kalendár', { icon: 'plus' }))) + '</div></section>';
  }

  function profile() {
    var state = S();
    var outfit = catalog().find(function (item) { return item.id === state.profile.equipped; });
    var outfits = catalog().filter(function (item) { return item.type === 'outfit' && owned(item); });
    return '<section class="page profile-page">' + head('Hrdina tvojho vlastného príbehu', 'Tvoj profil', 'Každý skutočný krok mení tvoju dedinku.', button('extra-profile-edit', 'Upraviť meno', { icon: 'edit', className: 'secondary' })) + '<section class="content-panel profile-identity"><img class="profile-identity-photo" src="assets/profile-picture.png" alt="Tvoja profilová fotografia" width="132" height="132"><div><p class="eyebrow">TVOJ OSOBNÝ PROFIL</p><h2>' + e(state.profile.name) + '</h2><p class="muted">Tvoj portrét a tvoj čarodej majú v dedinke vlastné miesto.</p></div></section><div class="grid two"><div class="content-panel wizard-display" style="--outfit-color:' + color(outfit && outfit.color) + '"><p class="eyebrow">TVOJ ČARODEJ</p><img src="' + wizardAsset(state.profile.equipped) + '" alt="Tvoj čarodej" width="220" height="260"><h2>' + e(state.profile.name) + '</h2><span class="tag">' + e(outfit ? outfit.name : 'Klasické rúcho') + '</span></div><div class="content-panel"><h2 class="section-title">Tvoja cesta</h2><div class="stats-strip">' + stat(number(M().balance(state)), 'nazbieraných korún', 'coin') + stat(number(M().powder(state)), 'zeleného prášku', 'spark') + '</div><div class="activity-list"><div class="activity-row"><span class="activity-icon">' + icon('book', 21) + '</span><div class="activity-info">Knihy v knižnici</div><strong>' + number(state.books.length) + '</strong></div><div class="activity-row"><span class="activity-icon">' + icon('hat', 21) + '</span><div class="activity-info">Kostýmy v šatníku</div><strong>' + number(state.wardrobe.length) + '</strong></div><div class="activity-row"><span class="activity-icon">' + icon('paw', 21) + '</span><div class="activity-info">Spoločníci na farme</div><strong>' + number(state.animals.length) + '</strong></div></div></div></div><div class="page-header"><div><h2 class="section-title">Tvoj šatník</h2><p class="muted">Vyber si rúcho, v ktorom sa dnes vydáš za svojimi cieľmi.</p></div>' + button('extra-open-shop', 'Získať nové oblečenie', { icon: 'shop', className: 'secondary' }) + '</div><div class="grid three">' + outfits.map(catalogCard).join('') + '</div></section>';
  }

  function meditateModal() {
    A().openModal('Zapísať meditáciu', '<p class="muted">Koľko minút si meditoval v skutočnom svete?</p><div class="form-grid">' + field('Počet minút', 'minutes', '25', { type: 'number', min: 1, max: 1440, step: 1, required: true, full: true }) + '</div><p class="reward-preview">' + icon('coin', 18) + ' Každých ' + number(S().meditation.threshold) + ' minút = ' + number(S().meditation.reward) + ' koruna. Zvyšok sa prenáša.</p>', function (form) {
      var minutes = numeric(form, 'minutes', 'Počet minút', { integer: true, min: 1, max: 1440 });
      A().commit(function (state) { M().meditate(state, minutes); }, 'Meditácia je zapísaná.');
    }, { submitLabel: 'Zapísať čas' });
  }

  function projectModal(id) {
    var project = id ? S().projects.find(function (p) { return p.id === id; }) : null;
    if (id && !project) throw new Error('Tento projekt sa už nenašiel.');
    A().openModal(project ? 'Upraviť projekt' : 'Nový tvorivý projekt', '<div class="form-grid">' + field('Názov projektu', 'title', project ? project.title : '', { required: true, maxLength: 120, full: true, placeholder: 'Napríklad: Dokončiť ilustráciu' }) + '</div><p class="form-hint">Za dokončenie získaš 1 korunu.</p>', function (form) {
      var title = textValue(form, 'title', 'Názov projektu', 120);
      A().commit(function (state) {
        if (project) {
          var current = state.projects.find(function (p) { return p.id === id; });
          if (!current || current.done) throw new Error('Dokončený projekt už nemožno meniť.');
          current.title = title;
        } else M().addProject(state, title);
      }, project ? 'Projekt je upravený.' : 'Nový projekt je pripravený.');
    }, { submitLabel: project ? 'Uložiť projekt' : 'Pridať projekt' });
  }

  function bankModal() {
    A().openModal('Aktualizovať financie', '<p class="muted">Zapíš aktuálne sumy v eurách.</p><div class="form-grid">' + BANK_FIELDS.map(function (item) { return field(item[1] + ' (€)', item[0], S().bank[item[0]], { type: 'number', min: 0, max: 1000000000, step: '0.01', required: true, hint: item[2] }); }).join('') + '</div>', function (form) {
      var values = {};
      BANK_FIELDS.forEach(function (item) { values[item[0]] = Math.round(numeric(form, item[0], item[1], { max: 1000000000 }) * 100) / 100; });
      A().commit(function (state) { BANK_FIELDS.forEach(function (item) { state.bank[item[0]] = values[item[0]]; }); }, 'Finančný prehľad je aktualizovaný.');
    }, { submitLabel: 'Uložiť financie' });
  }

  function strategyModal(id) {
    var strategy = id ? S().strategies.find(function (item) { return item.id === id; }) : null;
    if (id && !strategy) throw new Error('Táto stratégia sa už nenašla.');
    var item = strategy || { title: '', target: '', monthly: '', deadline: '', notes: '' };
    A().openModal(strategy ? 'Upraviť stratégiu' : 'Nová finančná stratégia', '<div class="form-grid">' + field('Názov cieľa', 'title', item.title, { required: true, maxLength: 120, full: true, placeholder: 'Napríklad: Finančná rezerva' }) + field('Cieľová suma (€)', 'target', item.target, { type: 'number', min: '0.01', max: 1000000000, step: '0.01', required: true }) + field('Mesačne odložím (€)', 'monthly', item.monthly, { type: 'number', min: '0.01', max: 1000000000, step: '0.01', required: true }) + field('Plánovaný dátum (nepovinné)', 'deadline', item.deadline, { type: 'date', full: true }) + field('Môj plán a poznámky', 'notes', item.notes, { textarea: true, full: true, maxLength: 4000, placeholder: 'Čo urobím, aby som cieľ dosiahol?' }) + '</div>', function (form) {
      var values = { title: textValue(form, 'title', 'Názov cieľa', 120), target: Math.round(numeric(form, 'target', 'Cieľová suma', { min: 0.01 }) * 100) / 100, monthly: Math.round(numeric(form, 'monthly', 'Mesačná suma', { min: 0.01 }) * 100) / 100, deadline: String(form.get('deadline') || ''), notes: String(form.get('notes') || '').trim() };
      if (values.notes.length > 4000) throw new Error('Poznámky môžu mať najviac 4 000 znakov.');
      if (values.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(values.deadline) || Number.isNaN(new Date(values.deadline + 'T12:00:00').getTime()))) throw new Error('Vyplň platný plánovaný dátum.');
      A().commit(function (state) {
        if (strategy) {
          var current = state.strategies.find(function (entry) { return entry.id === id; });
          if (!current) throw new Error('Táto stratégia sa už nenašla.');
          Object.assign(current, values);
        } else state.strategies.push(Object.assign({ id: A().uid() }, values));
      }, 'Stratégia je uložená.');
    }, { submitLabel: 'Uložiť stratégiu' });
  }

  function calendarModal() {
    A().openModal('Odkaz na kalendár', '<p class="muted">Vlož celý odkaz na svoj Magnum Opus kalendár.</p><div class="form-grid">' + field('Odkaz na kalendár', 'url', S().settings.calendarUrl, { type: 'url', maxLength: 2000, full: true, placeholder: 'https://…', hint: 'Prázdnym poľom uložený odkaz odstrániš.' }) + '</div>', function (form) {
      var url = safeCalendar(form.get('url'));
      if (url.length > 2000) throw new Error('Odkaz je príliš dlhý.');
      A().commit(function (state) { state.settings.calendarUrl = url; }, url ? 'Kalendár je pripojený.' : 'Odkaz na kalendár je odstránený.');
    }, { submitLabel: 'Uložiť odkaz' });
  }

  function profileModal() {
    A().openModal('Meno tvojho čarodeja', '<div class="form-grid">' + field('Meno', 'name', S().profile.name, { required: true, maxLength: 40, full: true }) + '</div>', function (form) {
      var name = textValue(form, 'name', 'Meno', 40);
      A().commit(function (state) { state.profile.name = name; }, 'Čarodej má nové meno.');
    }, { submitLabel: 'Uložiť meno' });
  }

  function confirmPurchase(id) {
    var item = catalog().find(function (entry) { return entry.id === id; });
    if (!item) throw new Error('Tento predmet sa už nenašiel.');
    A().openModal('Kúpiť ' + item.name + '?', '<p>' + e(item.description) + '</p><p class="reward-preview">' + icon('coin', 22) + ' Cena: <strong>' + number(item.price) + ' korún</strong></p><p class="muted">Po nákupe ti zostane ' + number(M().balance(S()) - item.price) + ' korún.</p>', function () {
      A().commit(function (state) { M().buy(state, id); }, item.type === 'animal' ? 'Nový spoločník už býva na tvojej farme.' : 'Nové oblečenie je v tvojom šatníku.');
    }, { submitLabel: 'Kúpiť za ' + number(item.price) + ' korún' });
  }

  var renderers = { meditation: meditation, gallery: gallery, farm: farm, shop: shop, challenges: challenges, bank: bank, calendar: calendar, profile: profile };
  window.MOExtras = {
    render: function (view) { return renderers[view] ? renderers[view]() : ''; },
    handleAction: function (action, el) {
      var id = el && el.dataset ? el.dataset.id : '';
      switch (action) {
        case 'extra-meditate': meditateModal(); return true;
        case 'extra-meditate-quick': A().commit(function (state) { M().meditate(state, 25); }, '25 minút meditácie je zapísaných.'); return true;
        case 'extra-project-add': projectModal(); return true;
        case 'extra-project-edit': projectModal(id); return true;
        case 'extra-project-finish': A().openModal('Dokončiť projekt?', '<p>Potvrď, že si svoj projekt dokončil aj v skutočnom svete.</p><p class="reward-preview">' + icon('coin', 20) + ' Získaš 1 korunu.</p>', function () { A().commit(function (state) { M().finishProject(state, id); }, 'Projekt je dokončený. Získal si 1 korunu!'); }, { submitLabel: 'Projekt je hotový' }); return true;
        case 'extra-open-shop': A().navigate('shop'); return true;
        case 'extra-buy': confirmPurchase(id); return true;
        case 'extra-equip': A().commit(function (state) { M().equip(state, id); }, 'Nové rúcho ti pristane.'); return true;
        case 'extra-claim-daily': A().commit(function (state) { M().claimDaily(state, id); }, 'Zelený prášok je v tvojej zásobe.'); return true;
        case 'extra-bank-edit': bankModal(); return true;
        case 'extra-strategy-add': strategyModal(); return true;
        case 'extra-strategy-edit': strategyModal(id); return true;
        case 'extra-strategy-delete': A().openModal('Odstrániť stratégiu?', '<p>Túto stratégiu odstrániš zo svojho finančného plánu.</p>', function () { A().commit(function (state) { state.strategies = state.strategies.filter(function (item) { return item.id !== id; }); }, 'Stratégia je odstránená.'); }, { submitLabel: 'Odstrániť stratégiu' }); return true;
        case 'extra-calendar-edit': calendarModal(); return true;
        case 'extra-profile-edit': profileModal(); return true;
        default: return false;
      }
    },
    afterRender: function () {}
  };
})();
