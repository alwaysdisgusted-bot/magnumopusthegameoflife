(() => {
  'use strict';
  const A = () => window.MOApp, auth = () => window.MOAuth, esc = value => A().esc(value);
  const held = new Map();
  let accountId = '', generation = 0, formToken = 0, activeView = '', busy = false;
  let query = '', appliedQuery = '', box = 'inbox', drafts = { profile: null, mail: null };
  const resource = () => ({ data: null, loaded: false, loading: false, loadingMore: false, error: '', moreError: '', task: null });
  let profile = resource(), friends = resource(), hall = resource(), inbox = resource(), sent = resource();

  function reset() {
    generation++; formToken++; busy = false;
    profile = resource(); friends = resource(); hall = resource(); inbox = resource(); sent = resource();
    query = ''; appliedQuery = ''; box = 'inbox'; drafts = { profile: null, mail: null };
  }
  function hasDrafts() { return !!drafts.profile || !!drafts.mail; }
  function sync() {
    const id = auth().getAccount()?.id || '';
    if (id !== accountId) {
      if (accountId && hasDrafts()) held.set(accountId, structuredClone(drafts));
      reset(); accountId = id;
      if (id && held.has(id)) { drafts = held.get(id); held.delete(id); }
    }
    return !!id;
  }
  function assertSession(gen, id = accountId) {
    if (gen !== generation || !id || accountId !== id || auth().getAccount()?.id !== id) throw Error('Prihlásenie sa zmenilo.');
  }
  async function request(path, options) {
    const gen = generation, id = accountId;
    assertSession(gen, id);
    const result = await auth().api(path, options);
    assertSession(gen, id);
    return result;
  }
  function redraw() {
    if (accountId && auth().getAccount()?.id === accountId && ['hall', 'mail'].includes(activeView)) A().render();
  }
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
  const loadProfile = () => load(profile, '/api/social/profile', 'profile');
  const loadFriends = () => load(friends, '/api/social/friends');
  const loadHall = () => load(hall, '/api/social/hall?q=' + encodeURIComponent(appliedQuery));
  const loadBox = value => load(value === 'sent' ? sent : inbox, '/api/social/mail?box=' + value + '&limit=50&offset=0');
  const accepted = () => friends.data?.accepted || [];
  const incoming = () => friends.data?.incoming || [];
  const outgoing = () => friends.data?.outgoing || [];
  const messages = item => item.data?.messages || [];
  const unreadCount = () => messages(inbox).filter(message => !message.readAt).length;
  const inboxContinues = () => inbox.data?.nextOffset !== null && inbox.data?.nextOffset !== undefined;
  const button = (action, text, extra = '', style = 'secondary small') => `<button type="button" class="btn ${style}" data-action="${action}" ${extra} ${busy ? 'disabled' : ''}>${text}</button>`;
  const dateText = value => new Date(value).toLocaleString('sk-SK', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Bratislava' });
  function status(item, action, empty) {
    if (item.error) return `<div class="notice social-error" role="alert">${esc(item.error)} ${button(action, 'Skúsiť znova')}</div>`;
    if (!item.loaded) return '<p class="social-loading" role="status">Načítavam…</p>';
    return empty || '';
  }
  function draftNotice(kind) {
    if (!drafts[kind]) return '';
    return `<div class="notice social-draft"><span>${kind === 'mail' ? 'Máš rozpísaný list.' : 'Máš rozpracovaný profil do siene.'}</span><div class="toolbar">${button('social-resume-' + kind, 'Pokračovať')}${button('social-discard-' + kind, 'Zahodiť návrh', '', 'ghost small')}</div></div>`;
  }
  function ownProfile() {
    const value = profile.data;
    return `<section class="social-own-profile"><div class="social-seal" aria-hidden="true">${A().icon('hat', 32)}</div><div class="social-own-copy"><p class="eyebrow">TVOJE MIESTO V SIENI</p><h2>${esc(auth().getAccount()?.displayName || 'Tvoj čarodejnícky účet')}</h2>${profile.loaded ? `<p class="social-visibility ${value.visible ? 'is-visible' : ''}">${value.visible ? '◇ Tvoj profil je viditeľný v sieni.' : '◇ Tvoj profil je súkromný.'}</p><p class="social-bio">${esc(value.bio || 'Pridaj krátke predstavenie pre ostatných čarodejníkov.')}</p>` : status(profile, 'social-retry-profile')}<p class="form-hint">V sieni sa zobrazuje meno, predstavenie a obsah, ktorý si vyberieš na verejný profil. Svoj profil zverejníš dobrovoľne.</p></div>${profile.loaded ? button('social-profile', 'Upraviť viditeľnosť a profil') : ''}</section>`;
  }
  function relation(account) {
    const found = accepted().find(row => row.accountId === account);
    if (found) return { type: 'accepted', row: found };
    const received = incoming().find(row => row.accountId === account);
    if (received) return { type: 'incoming', row: received };
    const pending = outgoing().find(row => row.accountId === account);
    return pending ? { type: 'outgoing', row: pending } : null;
  }
  function wizardCard(wizard) {
    const rel = relation(wizard.accountId);
    return `<article class="social-wizard-card"><span class="social-mini-seal" aria-hidden="true">${A().icon('hat', 24)}</span><div><h3><button type="button" class="social-name" data-action="social-wizard" data-account="${esc(wizard.accountId)}">${esc(wizard.displayName)}</button></h3><p class="social-bio">${esc(wizard.bio || 'Čarodejník zatiaľ nepridal predstavenie.')}</p><span class="social-relation">${rel?.type === 'accepted' ? 'Tvoj priateľ' : rel?.type === 'incoming' ? 'Poslal ti žiadosť' : rel?.type === 'outgoing' ? 'Žiadosť je odoslaná' : 'Viditeľný profil'}</span></div>${button('social-wizard', 'Otvoriť profil', `data-account="${esc(wizard.accountId)}"`, 'ghost small')}</article>`;
  }
  function friendRow(row, kind) {
    const account = esc(row.accountId), id = esc(row.id);
    return `<li class="social-friend-row"><div><button type="button" class="social-name" data-action="social-wizard" data-account="${account}">${esc(row.displayName)}</button><small>${kind === 'accepted' ? 'Priateľstvo potvrdené' : kind === 'incoming' ? 'Chce sa stať tvojím priateľom' : 'Čaká na prijatie'}</small></div><div class="toolbar">${kind === 'incoming' ? button('social-accept', 'Prijať', `data-id="${id}"`, 'primary small') + button('social-decline', 'Odmietnuť', `data-id="${id}"`, 'ghost small') : kind === 'accepted' ? button('social-compose', 'Napísať list', `data-account="${account}"`, 'secondary small') + button('social-remove-friend', 'Odobrať priateľa', `data-id="${id}"`, 'ghost small') : button('social-remove-friend', 'Zrušiť žiadosť', `data-id="${id}"`, 'ghost small')}</div></li>`;
  }
  function connections() {
    return `<section class="social-connections"><div class="social-section-heading"><div><p class="eyebrow">MALÝ KRUH SPOLOČNÍKOV</p><h2>Priatelia a žiadosti</h2></div><span class="social-count">${accepted().length} priateľov</span></div>${!friends.loaded ? status(friends, 'social-retry-friends') : `<div class="social-friends-grid"><section><h3>Prijaté žiadosti <span>${incoming().length}</span></h3><ul class="social-friend-list">${incoming().map(row => friendRow(row, 'incoming')).join('') || '<li class="social-empty-line">Nemáš nové žiadosti.</li>'}</ul></section><section><h3>Odoslané žiadosti <span>${outgoing().length}</span></h3><ul class="social-friend-list">${outgoing().map(row => friendRow(row, 'outgoing')).join('') || '<li class="social-empty-line">Žiadna žiadosť nečaká na prijatie.</li>'}</ul></section><section class="social-accepted"><h3>Tvoji priatelia <span>${accepted().length}</span></h3><ul class="social-friend-list">${accepted().map(row => friendRow(row, 'accepted')).join('') || '<li class="social-empty-line">Otvor profil čarodejníka a pošli mu žiadosť o priateľstvo.</li>'}</ul></section></div>`}</section>`;
  }
  function hallView() {
    const wizards = hall.data?.wizards || [];
    return `<section class="page social-page"><header class="page-header"><div><p class="eyebrow">ZA SPOLOČNÝM STOLOM</p><h1 class="page-title">Sieň slávy</h1><p class="page-subtitle">Spoznaj ľudí na ich vlastnej ceste a spoj sa s priateľmi.</p></div><div class="toolbar">${button('social-refresh', 'Obnoviť')}${button('social-mail', 'Moja pošta', '', 'primary')}</div></header>${draftNotice('profile')}${ownProfile()}<section class="social-directory"><div class="social-section-heading"><div><p class="eyebrow">OTVORENÉ DVERE</p><h2>Čarodejníci v sieni</h2></div><span class="social-count">${hall.loaded ? wizards.length + (hall.data.truncated ? '+' : '') + ' profilov' : ''}</span></div><div class="social-search"><div class="field"><label for="social-search">Hľadať čarodejnícke meno</label><input type="search" id="social-search" maxlength="64" value="${esc(query)}" placeholder="Čarodejnícke meno…" autocomplete="off"></div>${button('social-search', 'Hľadať', '', 'secondary')}</div>${!hall.loaded ? status(hall, 'social-retry-hall') : wizards.length ? `<div class="social-wizard-grid">${wizards.map(wizardCard).join('')}</div>${hall.data.truncated ? '<p class="form-hint">Zobrazuje sa prvá časť výsledkov. Spresni meno vo vyhľadávaní.</p>' : ''}` : `<div class="social-empty"><span aria-hidden="true">✦</span><h3>${appliedQuery ? 'Také meno sa v sieni nenašlo.' : 'Sieň čaká na prvých čarodejníkov.'}</h3><p>${appliedQuery ? 'Skús časť mena alebo vymaž vyhľadávanie.' : 'Zobrazia sa tu účty, ktoré si dobrovoľne zverejnia profil.'}</p></div>`}</section>${connections()}</section>`;
  }
  function mailRow(message) {
    const received = box === 'inbox', unread = received && !message.readAt;
    return `<button type="button" class="social-mail-row ${unread ? 'is-unread' : ''}" data-action="social-open-mail" data-id="${esc(message.id)}"><span class="social-letter-mark" aria-hidden="true">${unread ? '●' : '◇'}</span><span class="social-letter-copy"><span class="social-letter-person">${esc(received ? message.senderName : message.recipientName)}${unread ? '<span class="social-unread-label">Neprečítané</span>' : ''}</span><strong>${esc(message.subject)}</strong><span class="social-letter-preview">${esc((message.text || '').replace(/\s+/g, ' ').slice(0, 110))}</span></span><time datetime="${esc(new Date(message.createdAt).toISOString())}">${esc(dateText(message.createdAt))}</time></button>`;
  }
  function mailView() {
    const current = box === 'sent' ? sent : inbox;
    return `<section class="page social-page"><header class="page-header"><div><p class="eyebrow">SOVIA POŠTA</p><h1 class="page-title">Pošta</h1><p class="page-subtitle">Osobné listy medzi priateľmi v Magnum Opus.</p></div><div class="toolbar">${button('social-hall', 'Sieň slávy')}${button('social-refresh', 'Obnoviť')}${button('social-compose', '＋ Napísať list', '', 'primary')}</div></header><p class="social-private-note">◇ Tvoju schránku vidíš iba ty. List číta jeho odosielateľ a príjemca.</p>${draftNotice('mail')}<div class="social-mail-tabs" role="group" aria-label="Poštové schránky">${button('social-box', 'Prijaté' + (inbox.loaded ? ` · ${unreadCount()}${inboxContinues() ? '+' : ''} neprečítaných` : ''), `data-box="inbox" aria-pressed="${box === 'inbox'}"`, box === 'inbox' ? 'primary' : 'secondary')}${button('social-box', 'Odoslané', `data-box="sent" aria-pressed="${box === 'sent'}"`, box === 'sent' ? 'primary' : 'secondary')}</div>${friends.error ? status(friends, 'social-retry-friends') : friends.loaded && !accepted().length ? '<div class="notice">Listy si môžu posielať potvrdení priatelia. Otvor Sieň slávy a nadviaž prvé priateľstvo.</div>' : ''}<section class="social-mailbox" aria-label="${box === 'sent' ? 'Odoslané listy' : 'Prijaté listy'}">${!current.loaded ? status(current, 'social-retry-mail') : messages(current).length ? `<div class="social-letter-list">${messages(current).map(mailRow).join('')}</div>${current.moreError ? `<p class="form-error" role="alert">${esc(current.moreError)}</p>` : ''}${current.data.nextOffset !== null && current.data.nextOffset !== undefined ? `<div class="social-more">${button('social-more-mail', current.loadingMore ? 'Načítavam staršie listy…' : 'Načítať staršie listy', current.loadingMore ? 'disabled' : '')}</div>` : ''}` : `<div class="social-empty"><span aria-hidden="true">✉</span><h2>${box === 'sent' ? 'Tvoj prvý list ešte čaká na napísanie.' : 'Schránka je zatiaľ prázdna.'}</h2><p>${box === 'sent' ? 'Napíš niekomu zo svojich priateľov.' : 'Keď ti priateľ napíše, list nájdeš tu.'}</p></div>`}</section><p class="form-hint">Pošta zostáva v hre. Odoslať môžeš najviac 30 listov za 24 hodín. Tvoja schránka uchová spolu najviac 500 prijatých a odoslaných listov.</p></section>`;
  }
  function render(view) {
    sync();
    if (!accountId) return '<section class="page"><h1 class="page-title">Tvoj čarodejnícky účet</h1><p>Prihlás sa do svojho účtu.</p></section>';
    return view === 'mail' ? mailView() : hallView();
  }
  async function mutate(path, options) {
    if (busy) throw Error('Počkaj na dokončenie predchádzajúcej akcie.');
    const gen = generation; busy = true;
    try { return await request(path, options); }
    finally { if (gen === generation) { busy = false; redraw(); } }
  }
  function observeClose(editor, token, gen) {
    const dialog = document.getElementById('modal');
    const onClose = () => {
      if (dialog.open) return;
      dialog.removeEventListener('close', onClose);
      if (token === formToken && gen === generation) { formToken++; redraw(); }
    };
    dialog.addEventListener('close', onClose);
    return () => token === formToken && gen === generation && editor.isConnected && auth().getAccount()?.id === accountId;
  }
  function lock(editor, value) { editor.querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = value; }); }
  async function profileForm() {
    const gen = generation, token = ++formToken, sourceView = activeView;
    await loadProfile(); assertSession(gen);
    if (token !== formToken || activeView !== sourceView) return;
    if (!profile.loaded) throw Error(profile.error || 'Profil sa ešte načítava.');
    const value = structuredClone(drafts.profile || profile.data);
    A().openModal('Tvoj profil v sieni', `<div id="social-profile-editor"><label class="checkbox-label social-visibility-choice"><input type="checkbox" name="visible" id="social-visible" ${value.visible ? 'checked' : ''}> Chcem byť viditeľný v Sieni slávy</label><p class="form-hint">Ostatní prihlásení čarodejovia uvidia tvoje meno, predstavenie, vybrané citáty a verejné poznámky. Súkromný profil sa vo vyhľadávaní nezobrazuje.</p><div class="field"><label for="social-bio">Krátke predstavenie</label><textarea id="social-bio" name="bio" maxlength="160" rows="3" placeholder="Čomu sa venuješ a čo ťa zaujíma?">${esc(value.bio)}</textarea><span class="form-hint">Najviac 160 znakov.</span></div></div>`, async fd => {
      assertSession(gen);
      if (!valid()) throw Error('Otvor profil znova.');
      capture();
      const body = { visible: fd.has('visible'), bio: String(fd.get('bio')).trim(), expectedRevision: value.revision };
      drafts.profile = { ...value, ...body }; lock(editor, true);
      try {
        const result = await mutate('/api/social/profile', { method: 'PUT', body }); assertSession(gen);
        profile.data = result.profile; profile.loaded = true; drafts.profile = null;
        hall = resource(); window.MOShowcase?.invalidate(); A().toast('Profil v sieni je uložený.'); redraw();
      } finally { if (valid()) lock(editor, false); }
    });
    const editor = document.getElementById('social-profile-editor'), valid = observeClose(editor, token, gen);
    const capture = () => {
      if (!valid()) return;
      const next = { ...value, visible: document.getElementById('social-visible').checked, bio: document.getElementById('social-bio').value };
      drafts.profile = next.visible === profile.data.visible && next.bio === profile.data.bio ? null : next;
    };
    editor.addEventListener('input', capture); editor.addEventListener('change', capture);
  }
  function knownWizard(id) {
    return [...(hall.data?.wizards || []), ...accepted(), ...incoming(), ...outgoing()].find(wizard => wizard.accountId === id);
  }
  async function wizardDetail(id) {
    const wizard = knownWizard(id);
    if (!wizard) throw Error('Profil už nie je v načítanom zozname. Obnov sieň.');
    const gen=generation,token=++formToken,sourceView=activeView;
    let exhibition=null;
    try { exhibition=await request('/api/social/wizards/'+encodeURIComponent(id)); }
    catch(error) { if(error.status!==404)throw error; }
    assertSession(gen);if(token!==formToken||sourceView!==activeView)return;
    const rel = relation(id), account = esc(id);
    const actions = !friends.loaded ? '<p class="form-hint">Priateľstvá sa načítavajú. Profil otvor o chvíľu znova.</p>' : rel?.type === 'accepted' ? `<p class="social-relation">Ste priatelia.</p>${button('social-compose', 'Napísať list', `data-account="${account}"`, 'primary')}${button('social-remove-friend', 'Odobrať priateľa', `data-id="${esc(rel.row.id)}"`, 'ghost small')}` : rel?.type === 'incoming' ? `<p>Poslal ti žiadosť o priateľstvo.</p>${button('social-accept', 'Prijať žiadosť', `data-id="${esc(rel.row.id)}"`, 'primary')}${button('social-decline', 'Odmietnuť', `data-id="${esc(rel.row.id)}"`)}` : rel?.type === 'outgoing' ? `<p class="social-relation">Tvoja žiadosť čaká na prijatie.</p>${button('social-remove-friend', 'Zrušiť žiadosť', `data-id="${esc(rel.row.id)}"`)}` : button('social-request', 'Poslať žiadosť o priateľstvo', `data-account="${account}"`, 'primary');
    A().openModal(exhibition?.profile.displayName||wizard.displayName, `<div class="social-profile-detail"><div class="social-seal" aria-hidden="true">${A().icon('hat', 36)}</div><p class="eyebrow">ČARODEJNÍCKY PROFIL</p><p class="social-full-bio">${esc(exhibition?.profile.bio || (exhibition?'Predstavenie nie je uvedené.':'Tento čarodej má profil nastavený ako súkromný.'))}</p><div class="card-actions">${actions}</div><p class="form-hint">Po potvrdení priateľstva si môžete posielať osobné listy.</p></div>${exhibition?window.MOShowcase.renderPublic(exhibition):''}`, null, { readOnly: true });
  }
  async function compose(recipient = '', resume = false) {
    if (drafts.mail && !resume) { A().toast('Najprv dokonči alebo zahoď rozpísaný list.'); A().navigate('mail'); return; }
    const gen = generation, sourceView = activeView, token = ++formToken;
    await loadFriends(); assertSession(gen);
    if (token !== formToken || activeView !== sourceView) return;
    if (!friends.loaded) throw Error(friends.error || 'Priatelia sa ešte načítavajú.');
    if (!accepted().length) { A().toast('Najprv nadviaž priateľstvo v Sieni slávy.'); A().navigate('hall'); return; }
    const value = structuredClone(resume && drafts.mail ? drafts.mail : { recipientId: recipient || '', subject: '', text: '' });
    const found = accepted().some(friend => friend.accountId === value.recipientId);
    A().openModal('Napísať list', `<div id="social-mail-editor"><div class="field"><label for="social-recipient">Komu</label><select id="social-recipient" name="recipientId" required><option value="">Vyber priateľa…</option>${!found && value.recipientId ? '<option value="" selected>Pôvodný príjemca už nie je medzi priateľmi</option>' : ''}${accepted().map(friend => `<option value="${esc(friend.accountId)}" ${friend.accountId === value.recipientId ? 'selected' : ''}>${esc(friend.displayName)}</option>`).join('')}</select></div><div class="field"><label for="social-subject">Predmet</label><input id="social-subject" name="subject" maxlength="160" required value="${esc(value.subject)}"></div><div class="field"><label for="social-mail-text">Tvoj list</label><textarea id="social-mail-text" name="text" rows="10" maxlength="10000" required>${esc(value.text)}</textarea><span class="form-hint">Najviac 10 000 znakov. List sa odošle vybranému priateľovi.</span></div></div>`, async fd => {
      assertSession(gen);
      if (!valid()) throw Error('Otvor list znova.');
      capture();
      const body = { recipientId: String(fd.get('recipientId')), subject: String(fd.get('subject')).trim(), text: String(fd.get('text')).trim() };
      if (!body.subject || !body.text) throw Error('Doplň predmet aj text listu.');
      if (!accepted().some(friend => friend.accountId === body.recipientId)) throw Error('Vyber niekoho zo svojich priateľov.');
      drafts.mail = { ...body }; lock(editor, true);
      try {
        await mutate('/api/social/mail', { method: 'POST', body }); assertSession(gen);
        drafts.mail = null; sent = resource(); A().toast('List je odoslaný.'); redraw();
      } finally { if (valid()) lock(editor, false); }
    }, { submitLabel: 'Odoslať list' });
    const editor = document.getElementById('social-mail-editor'), valid = observeClose(editor, token, gen);
    const capture = () => {
      if (!valid()) return;
      drafts.mail = { recipientId: document.getElementById('social-recipient').value, subject: document.getElementById('social-subject').value, text: document.getElementById('social-mail-text').value };
    };
    editor.addEventListener('input', capture); editor.addEventListener('change', capture);
  }
  async function openMail(id) {
    const gen = generation, token = ++formToken;
    let message = (await request('/api/social/mail/' + encodeURIComponent(id))).message;
    if (token !== formToken || activeView !== 'mail') return;
    if (message.recipientId === accountId && !message.readAt) {
      message = (await request('/api/social/mail/' + encodeURIComponent(id) + '/read', { method: 'POST', body: {} })).message;
      if (token !== formToken || activeView !== 'mail') return;
      if (inbox.loaded) inbox.data.messages = messages(inbox).map(row => row.id === id ? message : row);
      redraw();
    }
    assertSession(gen);
    const reply = message.recipientId === accountId && accepted().some(friend => friend.accountId === message.senderId);
    A().openModal(message.subject, `<div class="social-message-detail"><dl class="social-message-meta"><div><dt>Od</dt><dd>${esc(message.senderName)}</dd></div><div><dt>Komu</dt><dd>${esc(message.recipientName)}</dd></div><div><dt>Odoslané</dt><dd>${esc(dateText(message.createdAt))}</dd></div></dl><div class="social-message-text">${esc(message.text)}</div>${reply ? `<div class="card-actions">${button('social-compose', 'Napísať odpoveď', `data-account="${esc(message.senderId)}"`, 'primary small')}</div>` : ''}</div>`, null, { readOnly: true });
  }
  async function moreMail() {
    const targetBox = box, item = targetBox === 'sent' ? sent : inbox, gen = generation;
    if (!item.loaded || item.loadingMore || item.data.nextOffset === null || item.data.nextOffset === undefined) return;
    item.loadingMore = true; item.moreError = ''; redraw();
    try {
      const result = await request('/api/social/mail?box=' + targetBox + '&limit=50&offset=' + item.data.nextOffset);
      assertSession(gen);
      const seen = new Set(messages(item).map(message => message.id));
      item.data = { ...result, messages: [...messages(item), ...result.messages.filter(message => !seen.has(message.id))] };
    } catch (error) { if (gen === generation) item.moreError = error.message || 'Staršie listy sa nepodarilo načítať.'; }
    finally { if (gen === generation) { item.loadingMore = false; redraw(); } }
  }
  function search() {
    query = document.getElementById('social-search')?.value || '';
    appliedQuery = query.trim(); hall = resource(); redraw();
  }
  function discard(kind) {
    const gen = generation, token = ++formToken;
    A().openModal(kind === 'mail' ? 'Zahodiť rozpísaný list?' : 'Zahodiť rozpracovaný profil?', '<div id="social-discard-confirm"><p>Tento neuložený návrh sa odstráni.</p></div>', () => {
      assertSession(gen);
      if (!valid()) throw Error('Otvor návrh znova.');
      drafts[kind] = null; formToken++; redraw();
    }, { submitLabel: 'Zahodiť návrh' });
    const valid = observeClose(document.getElementById('social-discard-confirm'), token, gen);
  }
  function removeFriend(id) {
    const row = [...accepted(), ...outgoing()].find(friend => friend.id === id);
    if (!row) throw Error('Priateľstvo sa zmenilo. Obnov sieň.');
    const isAccepted = row.status === 'accepted', gen = generation, token = ++formToken;
    A().openModal(isAccepted ? 'Odobrať priateľa?' : 'Zrušiť žiadosť?', `<div id="social-friend-confirm"><p>${isAccepted ? `Ukončíš priateľstvo s čarodejníkom ${esc(row.displayName)}. Ďalšie listy si budete môcť posielať po opätovnom potvrdení priateľstva.` : `Zrušíš odoslanú žiadosť pre čarodejníka ${esc(row.displayName)}.`}</p>${isAccepted ? '<p class="form-hint">Doterajšie listy zostanú v tvojej schránke.</p>' : ''}</div>`, async () => {
      assertSession(gen);
      if (!valid()) throw Error('Otvor potvrdenie znova.');
      await mutate('/api/social/friends/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
      assertSession(gen); friends = resource(); formToken++;
      A().toast(isAccepted ? 'Priateľstvo je ukončené.' : 'Žiadosť je zrušená.'); redraw();
    }, { submitLabel: isAccepted ? 'Odobrať priateľa' : 'Zrušiť žiadosť' });
    const valid = observeClose(document.getElementById('social-friend-confirm'), token, gen);
  }
  async function handleAction(action, el) {
    if (!action.startsWith('social-')) return false;
    if (!sync()) return true;
    const gen = generation;
    if (busy) throw Error('Počkaj na dokončenie predchádzajúcej akcie.');
    if (action === 'social-hall') A().navigate('hall');
    else if (action === 'social-mail') A().navigate('mail');
    else if (action === 'social-profile' || action === 'social-resume-profile') await profileForm();
    else if (action === 'social-compose') await compose(el.dataset.account);
    else if (action === 'social-resume-mail') await compose('', true);
    else if (action === 'social-discard-profile') discard('profile');
    else if (action === 'social-discard-mail') discard('mail');
    else if (action === 'social-remove-friend') removeFriend(el.dataset.id);
    else if (action === 'social-wizard') await wizardDetail(el.dataset.account);
    else if (action === 'social-search') search();
    else if (action === 'social-box') { box = el.dataset.box === 'sent' ? 'sent' : 'inbox'; redraw(); }
    else if (action === 'social-open-mail') await openMail(el.dataset.id);
    else if (action === 'social-more-mail') await moreMail();
    else if (action === 'social-refresh') { profile = resource(); friends = resource(); hall = resource(); inbox = resource(); sent = resource(); redraw(); }
    else if (action === 'social-retry-profile') { profile = resource(); redraw(); }
    else if (action === 'social-retry-friends') { friends = resource(); redraw(); }
    else if (action === 'social-retry-hall') { hall = resource(); redraw(); }
    else if (action === 'social-retry-mail') { if (box === 'sent') sent = resource(); else inbox = resource(); redraw(); }
    else if (action === 'social-request' || action === 'social-accept' || action === 'social-decline') {
      const isRequest = action === 'social-request';
      await mutate('/api/social/friends/' + (isRequest ? 'request' : encodeURIComponent(el.dataset.id) + '/respond'), { method: 'POST', body: isRequest ? { accountId: el.dataset.account } : { accept: action === 'social-accept' } });
      assertSession(gen); friends = resource(); formToken++; document.getElementById('modal')?.close();
      A().toast(isRequest ? 'Žiadosť o priateľstvo je odoslaná.' : action === 'social-accept' ? 'Priateľstvo je potvrdené.' : 'Žiadosť je odmietnutá.'); redraw();
    }
    return true;
  }
  function afterRender(view) {
    activeView = view;
    if (!sync() || !['hall', 'mail'].includes(view)) return;
    loadFriends();
    if (view === 'hall') {
      loadProfile(); loadHall();
      const input = document.getElementById('social-search');
      if (input) {
        input.oninput = event => { query = event.target.value; };
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); search(); } };
      }
    } else { loadBox('inbox'); if (box === 'sent') loadBox('sent'); }
  }
  function destroy({ preserveDraft } = {}) {
    if (preserveDraft && accountId && hasDrafts()) held.set(accountId, structuredClone(drafts));
    else if (accountId) held.delete(accountId);
    reset(); accountId = ''; activeView = '';
  }
  window.addEventListener('beforeunload', event => { if (hasDrafts() || busy) { event.preventDefault(); event.returnValue = ''; } });
  window.MOSocial = { render, afterRender, handleAction, destroy, hasUnsavedDrafts: () => hasDrafts() || busy };
})();
