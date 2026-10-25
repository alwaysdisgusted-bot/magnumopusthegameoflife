(function () {
  'use strict';
  var currentView = '', accountId = '', generation = 0, loadSerial = 0, poll = null, chatBusy = false;
  var rooms = [], roomsLoaded = false, selectedRoom = '', selectedChannel = '', academyTab = 'channels', workspaceTab = 'pages';
  var channels = [], members = [], personal = fresh(), shared = fresh(), roomLoaded = '', loading = false, loadError = '';
  var drafts = Object.create(null), chatDrafts = Object.create(null), chats = Object.create(null), listeners = false;
  var heldDrafts = new Map();
  var embedded = null;
  function fresh() { return { loaded: false, pages: [], tasks: [], selectedPage: '' }; }
  function app() { return window.MOApp; }
  function auth() { return window.MOAuth; }
  function esc(value) { return app().esc(value == null ? '' : String(value)); }
  function icon(name, size) { return app().icon(name, size || 18); }
  async function api(path, options) {
    var gen = generation, id = accountId;
    var data = await auth().api(path, options);
    var user = account();
    if (gen !== generation || !user || user.id !== id) { var stale = new Error('Prihlásenie sa zmenilo. Otvor svoj priestor znova.'); stale.code = 'stale_account'; throw stale; }
    return data;
  }
  function account() { return auth() && auth().getAccount ? auth().getAccount() : null; }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }
  function reset() {
    stopPoll(); generation++; loadSerial++; rooms = []; roomsLoaded = false; selectedRoom = ''; selectedChannel = ''; channels = []; members = [];
    personal = fresh(); shared = fresh(); roomLoaded = ''; loading = false; loadError = ''; drafts = Object.create(null); chatDrafts = Object.create(null); chats = Object.create(null); chatBusy = false;
  }
  function hasUnsavedDrafts() { return Object.keys(drafts).length > 0 || Object.keys(chatDrafts).some(function (key) { return !!chatDrafts[key].trim(); }); }
  function syncAccount() {
    var user = account(), id = user ? user.id : '';
    if (id !== accountId) {
      reset(); accountId = id;
      if (id && heldDrafts.has(id)) { var saved = heldDrafts.get(id); drafts = saved.drafts; chatDrafts = saved.chatDrafts; heldDrafts.delete(id); }
    }
    return !!id;
  }
  function redraw() {
    if (embedded && currentView === 'workspace') { embedded.innerHTML = render('workspace'); afterRender('workspace'); }
    else if (currentView === 'academy' || currentView === 'workspace') app().render();
  }
  function handleError(error) { app().toast(error.message || 'Zmenu sa nepodarilo uložiť. Skús to znova.'); }
  function run(promise) { Promise.resolve(promise).catch(handleError); }
  function button(action, title, options) {
    options = options || {};
    return '<button type="button" class="btn ' + (options.style || 'secondary') + '" data-action="' + action + '"' + (options.id ? ' data-id="' + esc(options.id) + '"' : '') + (options.tab ? ' data-tab="' + esc(options.tab) + '"' : '') + (options.status ? ' data-status="' + esc(options.status) + '"' : '') + (options.disabled ? ' disabled' : '') + '>' + (options.icon ? icon(options.icon) : '') + '<span>' + esc(title) + '</span></button>';
  }
  function field(label, name, value, options) {
    options = options || {};
    var attrs = ' id="academy-' + name + '" name="' + name + '"' + (options.required ? ' required' : '') + ' maxlength="' + (options.max || 160) + '"';
    return '<div class="field full"><label for="academy-' + name + '">' + esc(label) + '</label>' + (options.area ? '<textarea' + attrs + ' rows="' + (options.rows || 8) + '">' + esc(value) + '</textarea>' : '<input' + attrs + ' value="' + esc(value) + '">') + '</div>';
  }
  function nonempty(form, key, label, max) { var value = String(form.get(key) || '').trim(); if (!value || value.length > max) throw new Error(label + ': vyplň 1 až ' + max + ' znakov.'); return value; }
  function titleHeader(eyebrow, title, subtitle, actions) { return '<header class="page-header"><div><div class="eyebrow">' + esc(eyebrow) + '</div><h1 class="page-title">' + esc(title) + '</h1><p class="page-subtitle">' + esc(subtitle) + '</p></div><div class="toolbar">' + (actions || '') + '</div></header>'; }
  function context() { return currentView === 'academy' ? shared : personal; }
  function room() { return rooms.find(function (item) { return item.id === selectedRoom; }); }
  function scope() { return currentView === 'academy' ? selectedRoom : ''; }
  function keyFor(id) { return (scope() || 'personal') + ':' + id; }
  function queryScope() { return scope() ? '?roomId=' + encodeURIComponent(scope()) : ''; }
  function date(value) { var d = new Date(value); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'short' }); }
  function errorNotice() { return loadError ? '<div class="mo-workspace-error" role="alert"><p>' + esc(loadError) + '</p>' + button('academy-refresh', 'Skúsiť znova', { icon: 'arrow' }) + '</div>' : ''; }
  async function loadRooms() {
    if (loading) return;
    var gen = generation, token = ++loadSerial; loading = true; loadError = ''; redraw();
    try { var data = await api('/api/academy/rooms'); if (gen !== generation || token !== loadSerial) return; rooms = data.rooms; roomsLoaded = true; }
    catch (error) { if (gen === generation && token === loadSerial) loadError = error.message; }
    finally { if (gen === generation && token === loadSerial) { loading = false; redraw(); } }
  }
  async function loadRoom(id) {
    var gen = generation, token = ++loadSerial; loading = true; loadError = ''; redraw();
    try {
      var results = await Promise.all([api('/api/academy/rooms/' + id + '/channels'), api('/api/academy/rooms/' + id + '/members'), api('/api/workspace/pages?roomId=' + id), api('/api/workspace/tasks?roomId=' + id)]);
      if (gen !== generation || token !== loadSerial || id !== selectedRoom) return;
      channels = results[0].channels; members = results[1].members; shared.pages = results[2].pages; shared.tasks = results[3].tasks; shared.loaded = true; roomLoaded = id;
      if (!channels.some(function (c) { return c.id === selectedChannel; })) selectedChannel = channels.length ? channels[0].id : '';
      if (!shared.pages.some(function (p) { return p.id === shared.selectedPage; })) shared.selectedPage = shared.pages.length ? shared.pages[0].id : '';
    } catch (error) { if (gen === generation && token === loadSerial && id === selectedRoom) loadError = error.message; }
    finally { if (gen === generation && token === loadSerial && id === selectedRoom) { loading = false; redraw(); } }
  }
  async function loadPersonal() {
    if (loading) return;
    var gen = generation, token = ++loadSerial; loading = true; loadError = ''; redraw();
    try { var results = await Promise.all([api('/api/workspace/pages'), api('/api/workspace/tasks')]); if (gen !== generation || token !== loadSerial) return; personal.pages = results[0].pages; personal.tasks = results[1].tasks; personal.loaded = true; if (!personal.pages.some(function (p) { return p.id === personal.selectedPage; })) personal.selectedPage = personal.pages.length ? personal.pages[0].id : ''; }
    catch (error) { if (gen === generation && token === loadSerial) loadError = error.message; }
    finally { if (gen === generation && token === loadSerial) { loading = false; redraw(); } }
  }
  function refreshContext() { return currentView === 'academy' ? loadRoom(selectedRoom) : loadPersonal(); }
  function tabs(items, active) { return '<div class="mo-workspace-tabs" role="tablist">' + items.map(function (item) { return '<button type="button" role="tab" aria-selected="' + (active === item[0]) + '" class="' + (active === item[0] ? 'active' : '') + '" data-action="academy-tab" data-tab="' + item[0] + '">' + icon(item[2]) + '<span>' + item[1] + '</span></button>'; }).join('') + '</div>'; }
  function lobby() {
    return titleHeader('Spoločná cesta', 'Akadémia', 'Súkromné miestnosti pre teba a ľudí, ktorých pozveš.', button('academy-join', 'Vstúpiť s kódom', { icon: 'plus' }) + button('academy-room-create', 'Vytvoriť miestnosť', { style: 'primary', icon: 'hat' })) + errorNotice() + (loading && !roomsLoaded ? '<div class="mo-loading" role="status">Otváram brány akadémie…</div>' : rooms.length ? '<div class="grid two">' + rooms.map(function (item) { return '<article class="card mo-room-card"><div class="mo-room-emblem">' + icon('hat', 32) + '</div><span class="tag">' + (item.isOwner ? 'Tvoja miestnosť' : 'Člen akadémie') + '</span><h2>' + esc(item.name) + '</h2><p class="muted">Kanály, spoločné poznámky a projektová tabuľa.</p>' + button('academy-room-open', 'Vstúpiť', { id: item.id, icon: 'arrow', style: 'primary' }) + '</article>'; }).join('') + '</div>' : '<div class="content-panel mo-workspace-empty"><div class="mo-room-emblem">' + icon('hat', 46) + '</div><h2>Každá akadémia začína stretnutím</h2><p>Vytvor miestnosť a pozvi svojich ľudí kódom, alebo vstúp do existujúcej akadémie.</p>' + button('academy-room-create', 'Vytvoriť prvú miestnosť', { icon: 'plus', style: 'primary' }) + '</div>');
  }
  function pageView() {
    var data = context(), selected = data.pages.find(function (p) { return p.id === data.selectedPage; });
    var draft = selected ? drafts[keyFor(selected.id)] : null;
    var content = selected ? '<div class="mo-document-toolbar"><span class="muted">' + (draft ? 'Rozpracované zmeny' : 'Uložené · ' + date(selected.updatedAt)) + '</span><div class="toolbar">' + button('academy-page-delete', 'Odstrániť', { id: selected.id, style: 'ghost small', icon: 'trash' }) + button('academy-page-save', 'Uložiť stránku', { id: selected.id, style: 'primary small', icon: 'check' }) + '</div></div>' + (draft && draft.conflict ? '<div class="mo-workspace-error"><p>Stránka má novšiu uloženú verziu. Tvoje rozpracované zmeny sú zachované. Pred načítaním novej verzie si ich môžeš skopírovať.</p>' + button('academy-page-copy', 'Skopírovať môj text', { id: selected.id, style: 'secondary small' }) + button('academy-page-reload', 'Načítať novú verziu', { id: selected.id, style: 'secondary small' }) + '</div>' : '') + '<div class="mo-page-editor" data-page-id="' + esc(selected.id) + '"><label class="sr-only" for="mo-document-title">Názov stránky</label><input id="mo-document-title" class="mo-document-title" maxlength="160" value="' + esc(draft ? draft.title : selected.title) + '" placeholder="Názov stránky"><label class="sr-only" for="mo-document-body">Obsah stránky a poznámky</label><textarea id="mo-document-body" class="mo-document-body" maxlength="20000" placeholder="Tu má priestor tvoj ďalší nápad…">' + esc(draft ? draft.body : selected.body) + '</textarea></div>' : '<div class="mo-workspace-empty"><div class="empty-icon">' + icon('book', 40) + '</div><h2>Priestor pre tvoje myšlienky</h2><p>Pridaj stránku pre poznámky, nápady alebo plán projektu.</p>' + button('academy-page-create', 'Vytvoriť stránku', { icon: 'plus', style: 'primary' }) + '</div>';
    return '<div class="mo-notebook"><aside class="mo-page-list"><div class="mo-page-list-title"><strong>Stránky a poznámky</strong>' + button('academy-page-create', 'Nová', { icon: 'plus', style: 'ghost small' }) + '</div>' + data.pages.map(function (p) { return '<button class="mo-page-link' + (selected && selected.id === p.id ? ' active' : '') + '" type="button" data-action="academy-page-open" data-id="' + esc(p.id) + '">' + icon('book', 16) + '<span>' + esc(p.title) + '</span>' + (drafts[keyFor(p.id)] ? '<span title="Rozpracované zmeny" aria-label="Rozpracované zmeny">•</span>' : '') + '</button>'; }).join('') + '</aside><div class="mo-document">' + content + '</div></div>';
  }
  function memberName(id) { var user = members.find(function (m) { return m.id === id; }); return user ? user.name : 'Ja'; }
  function boardView() {
    return '<div class="mo-board-heading"><div><h2>Projektová tabuľa</h2><p class="muted">Od nápadu k dokončeniu, krok za krokom.</p></div>' + button('academy-task-create', 'Pridať úlohu', { icon: 'plus', style: 'primary' }) + '</div><div class="mo-kanban">' + [['todo', 'Na rade', 'spark'], ['doing', 'V procese', 'clock'], ['done', 'Hotovo', 'check']].map(function (column) {
      var tasks = context().tasks.filter(function (t) { return t.status === column[0]; });
      return '<section class="mo-kanban-column"><h3>' + icon(column[2], 16) + esc(column[1]) + '<span>' + tasks.length + '</span></h3><div class="mo-task-stack">' + (tasks.length ? tasks.map(function (task) { return '<article class="mo-task-card"><h4>' + esc(task.title) + '</h4>' + (task.description ? '<p>' + esc(task.description.length > 180 ? task.description.slice(0, 180) + '…' : task.description) + '</p>' : '') + (task.assigneeId ? '<span class="tag">' + esc(memberName(task.assigneeId)) + '</span>' : '') + '<div class="mo-task-actions">' + button('academy-task-edit', 'Otvoriť', { id: task.id, style: 'ghost small', icon: 'edit' }) + (task.status !== 'done' ? button('academy-task-status', task.status === 'todo' ? 'Začať' : 'Dokončiť', { id: task.id, status: task.status === 'todo' ? 'doing' : 'done', style: 'secondary small', icon: 'check' }) : '') + '</div></article>'; }).join('') : '<p class="mo-column-empty">' + (column[0] === 'todo' ? 'Pridaj svoj ďalší krok.' : column[0] === 'doing' ? 'Tu sa nápady menia na činy.' : 'Tu bude mať miesto hotová práca.') + '</p>') + '</div></section>';
    }).join('') + '</div>';
  }
  function messageHtml(messages) {
    return messages.length ? messages.map(function (message) { return '<article class="mo-message' + (message.authorId === accountId ? ' mine' : '') + '"><div class="mo-message-author"><strong>' + esc(message.authorName) + '</strong><time datetime="' + esc(message.createdAt) + '">' + esc(new Date(message.createdAt).toLocaleString('sk-SK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + '</time></div><p>' + esc(message.body) + '</p></article>'; }).join('') : '<div class="mo-chat-empty">Tu sa začína spoločná konverzácia. Napíš prvú správu.</div>';
  }
  function chatView() {
    var chat = chats[selectedChannel] || { messages: [], loaded: false, hasMore: false };
    var channel = channels.find(function (item) { return item.id === selectedChannel; });
    return '<div class="mo-chat"><aside class="mo-channel-list"><div class="mo-page-list-title"><strong>Kanály</strong>' + button('academy-channel-create', 'Nový', { icon: 'plus', style: 'ghost small' }) + '</div>' + channels.map(function (item) { return '<button type="button" class="mo-page-link' + (item.id === selectedChannel ? ' active' : '') + '" data-action="academy-channel-open" data-id="' + esc(item.id) + '"><span class="mo-channel-hash">#</span><span>' + esc(item.name) + '</span></button>'; }).join('') + '<div class="mo-member-list"><span class="muted">Členovia · ' + members.length + '</span>' + members.map(function (m) { return '<div><span class="mo-member-dot"></span>' + esc(m.name) + '</div>'; }).join('') + '</div></aside><section class="mo-chat-main"><header><h2># ' + esc(channel ? channel.name : 'Kanál') + '</h2><span id="mo-chat-status" class="muted" role="status"></span></header><div class="mo-chat-history">' + button('academy-chat-older', 'Staršie správy', { disabled: !chat.hasMore, style: 'ghost small' }) + '</div><div id="mo-chat-messages" class="mo-chat-messages" role="log" aria-label="Správy v kanáli">' + (chat.loaded ? messageHtml(chat.messages) : '<div class="mo-chat-empty">Načítavam správy…</div>') + '</div><form id="mo-chat-form" class="mo-chat-compose"><label class="sr-only" for="mo-chat-input">Tvoja správa</label><textarea id="mo-chat-input" name="message" maxlength="4000" required rows="2" placeholder="Napíš správu do #' + esc(channel ? channel.name : 'kanála') + '">' + esc(chatDrafts[selectedChannel] || '') + '</textarea><button class="btn primary" type="submit">' + icon('arrow', 19) + '<span>Odoslať</span></button></form><p class="mo-chat-hint muted">Enter odošle · Shift + Enter pridá riadok</p></section></div>';
  }
  function render(view) {
    if (view !== 'academy' && view !== 'workspace') return '';
    if (view !== currentView) { stopPoll(); loadSerial++; loading = false; currentView = view; loadError = ''; }
    if (!syncAccount()) return '<section class="page"><div class="content-panel mo-workspace-empty"><h1>Prihlás sa do svojho účtu</h1><p>Akadémia aj osobná pracovňa patria k tvojmu čarodejníkovi.</p></div></section>';
    if (view === 'academy' && !selectedRoom) return '<section class="page academy-page">' + lobby() + '</section>';
    var isShared = view === 'academy', activeRoom = room();
    var header = isShared ? titleHeader('Akadémia', activeRoom ? activeRoom.name : 'Spoločná miestnosť', 'Priestor pre vaše rozhovory, myšlienky a spoločné projekty.', button('academy-lobby', 'Moje akadémie', { icon: 'arrow', style: 'ghost' }) + (activeRoom && activeRoom.isOwner ? button('academy-invite', 'Pozvať členov', { icon: 'plus' }) : '') + button('academy-refresh', 'Obnoviť', { icon: 'arrow', style: 'ghost' })) : titleHeader('Myšlienky, ktoré dostávajú tvar', 'Pracovňa', 'Tvoje osobné stránky, poznámky a projektová tabuľa.', button('academy-refresh', 'Obnoviť', { icon: 'arrow', style: 'ghost' }));
    var activeTab = isShared ? academyTab : workspaceTab;
    var content = loading && !context().loaded ? '<div class="mo-loading" role="status">Pripravujem tvoj priestor…</div>' : activeTab === 'channels' ? chatView() : activeTab === 'pages' ? pageView() : boardView();
    return '<section class="page ' + (isShared ? 'academy-page' : 'workspace-page') + '">' + header + errorNotice() + tabs(isShared ? [['channels', 'Kanály', 'hat'], ['pages', 'Stránky', 'book'], ['board', 'Tabuľa', 'check']] : [['pages', 'Stránky a poznámky', 'book'], ['board', 'Projektová tabuľa', 'check']], activeTab) + content + '</section>';
  }
  async function fetchChat(older) {
    if (!selectedChannel || chatBusy || currentView !== 'academy' || academyTab !== 'channels' || !syncAccount()) return;
    var gen = generation, channel = selectedChannel, prior = chats[channel] || { messages: [], loaded: false, hasMore: false };
    if (older && (!prior.hasMore || !prior.messages.length)) return;
    chatBusy = true;
    try {
      var data = await api('/api/academy/channels/' + channel + '/messages' + (older ? '?before=' + encodeURIComponent(prior.messages[0].id) : ''));
      if (gen !== generation || selectedChannel !== channel) return;
      var byId = new Map(); prior.messages.concat(data.messages).forEach(function (message) { byId.set(message.id, message); });
      var messages = Array.from(byId.values()).sort(function (a, b) { return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id); });
      var changed = JSON.stringify(messages) !== JSON.stringify(prior.messages) || !prior.loaded;
      chats[channel] = { messages: messages, loaded: true, hasMore: older || !prior.loaded ? data.hasMore : prior.hasMore };
      var list = document.getElementById('mo-chat-messages');
      if (list && currentView === 'academy' && academyTab === 'channels' && changed) { var bottom = list.scrollHeight - list.scrollTop - list.clientHeight < 90; var previousHeight = list.scrollHeight; var top = list.scrollTop; list.innerHTML = messageHtml(messages); if (older) list.scrollTop = top + list.scrollHeight - previousHeight; else if (bottom || !prior.loaded) list.scrollTop = list.scrollHeight; }
      var olderButton = document.querySelector('[data-action="academy-chat-older"]'); if (olderButton) olderButton.disabled = !chats[channel].hasMore;
      var status = document.getElementById('mo-chat-status'); if (status) status.textContent = '';
    } catch (error) { var statusNode = document.getElementById('mo-chat-status'); if (gen === generation && statusNode) statusNode.textContent = error.message || 'Správy sa nepodarilo obnoviť.'; }
    finally { if (gen === generation) chatBusy = false; }
  }
  async function sendMessage(form) {
    var channel = selectedChannel, input = form.querySelector('textarea'), submit = form.querySelector('button[type="submit"]');
    var body = input.value.trim(); if (!body || body.length > 4000 || submit.disabled) return;
    var gen = generation; submit.disabled = true;
    try { await api('/api/academy/channels/' + channel + '/messages', { method: 'POST', body: { body: body } }); if (gen !== generation) return; if ((chatDrafts[channel] || '').trim() === body) { chatDrafts[channel] = ''; if (channel === selectedChannel) input.value = ''; } await fetchChat(false); }
    catch (error) { handleError(error); }
    finally { if (submit.isConnected) submit.disabled = false; }
  }
  function showInvite(code) { setTimeout(function () { app().openModal('Pozývací kód akadémie', '<p>Tento kód odovzdaj ľuďom, ktorých chceš pozvať. Potrebujú vlastný herný účet.</p><div class="mo-invite-code">' + esc(code) + '</div><p class="form-hint">Kód si odlož. Z bezpečnostných dôvodov ho znovu nezobrazujeme; môžeš vytvoriť nový.</p><button type="button" class="btn secondary" data-action="academy-copy-invite" data-code="' + esc(code) + '">Skopírovať kód</button>', null, { readOnly: true }); }, 0); }
  function roomCreate() { app().openModal('Nová akadémia', field('Názov miestnosti', 'name', '', { required: true }), async function (form) { var name = nonempty(form, 'name', 'Názov', 160); var data = await api('/api/academy/rooms', { method: 'POST', body: { name: name } }); rooms.unshift(data.room); roomsLoaded = true; selectedRoom = data.room.id; shared = fresh(); await loadRoom(selectedRoom); showInvite(data.inviteCode); }, { submitLabel: 'Vytvoriť miestnosť' }); }
  function roomJoin() { app().openModal('Vstúpiť do akadémie', field('Pozývací kód', 'code', '', { required: true, max: 30 }) + '<p class="form-hint">Použi 16-znakový kód od zakladateľa miestnosti.</p>', async function (form) { var data = await api('/api/academy/rooms/join', { method: 'POST', body: { code: nonempty(form, 'code', 'Kód', 30) } }); if (!rooms.some(function (r) { return r.id === data.room.id; })) rooms.unshift(data.room); selectedRoom = data.room.id; shared = fresh(); await loadRoom(selectedRoom); app().toast('Vitaj v akadémii.'); }, { submitLabel: 'Vstúpiť' }); }
  function pageCreate() {
    var ctx = context(), roomId = scope();
    app().openModal('Nová stránka', field('Názov', 'title', '', { required: true }) + field('Obsah a poznámky', 'body', '', { area: true, max: 20000 }), async function (form) { var data = await api('/api/workspace/pages', { method: 'POST', body: { title: nonempty(form, 'title', 'Názov', 160), body: String(form.get('body') || ''), roomId: roomId || null } }); ctx.pages.unshift(data.page); ctx.selectedPage = data.page.id; redraw(); app().toast('Stránka je uložená.'); }, { submitLabel: 'Vytvoriť stránku' });
  }
  async function pageSave(id) {
    var ctx = context(), page = ctx.pages.find(function (p) { return p.id === id; }), draft = drafts[keyFor(id)]; if (!page || !draft) { app().toast('Stránka už je uložená.'); return; }
    if (!draft.title.trim()) throw new Error('Daj stránke názov.');
    var draftKey = keyFor(id), submitted = Object.assign({}, draft);
    try { var data = await api('/api/workspace/pages/' + id, { method: 'PUT', body: { title: submitted.title.trim(), body: submitted.body, expectedRevision: submitted.revision } }); var index = ctx.pages.findIndex(function (p) { return p.id === id; }); if (index >= 0) ctx.pages[index] = data.page; if (drafts[draftKey] && drafts[draftKey].title === submitted.title && drafts[draftKey].body === submitted.body) delete drafts[draftKey]; else if (drafts[draftKey]) drafts[draftKey].revision = data.page.revision; redraw(); app().toast('Stránka je uložená.'); }
    catch (error) { if (error.status === 409 && drafts[draftKey]) { drafts[draftKey].conflict = true; redraw(); } throw error; }
  }
  function pageDelete(id) { var ctx = context(), page = ctx.pages.find(function (p) { return p.id === id; }), draftKey = keyFor(id); if (!page) return; app().openModal('Odstrániť stránku?', '<p>Odstrániš stránku <strong>' + esc(page.title) + '</strong> a jej poznámky.</p>', async function () { await api('/api/workspace/pages/' + id, { method: 'DELETE', body: { expectedRevision: page.revision } }); ctx.pages = ctx.pages.filter(function (p) { return p.id !== id; }); ctx.selectedPage = ctx.pages.length ? ctx.pages[0].id : ''; delete drafts[draftKey]; redraw(); }, { submitLabel: 'Odstrániť stránku' }); }
  function taskForm(id) {
    var ctx = context(), task = id ? ctx.tasks.find(function (t) { return t.id === id; }) : null, roomId = scope(); if (id && !task) return;
    var title = task ? task.title : '', description = task ? task.description : '', status = task ? task.status : 'todo', assignee = task ? task.assigneeId : '';
    var selects = '<div class="field full"><label for="academy-status">Stav</label><select id="academy-status" name="status">' + [['todo', 'Na rade'], ['doing', 'V procese'], ['done', 'Hotovo']].map(function (item) { return '<option value="' + item[0] + '"' + (status === item[0] ? ' selected' : '') + '>' + item[1] + '</option>'; }).join('') + '</select></div>';
    if (roomId) selects += '<div class="field full"><label for="academy-assignee">Priradiť členovi</label><select id="academy-assignee" name="assigneeId"><option value="">Bez priradenia</option>' + members.map(function (m) { return '<option value="' + esc(m.id) + '"' + (assignee === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></div>';
    app().openModal(task ? 'Upraviť úlohu' : 'Nová úloha', field('Názov úlohy', 'title', title, { required: true }) + field('Popis a poznámky', 'description', description, { area: true, max: 20000, rows: 5 }) + selects + (task ? '<div class="mo-task-delete">' + button('academy-task-delete', 'Odstrániť úlohu', { id: task.id, icon: 'trash', style: 'ghost small' }) + '</div>' : ''), async function (form) { var payload = { title: nonempty(form, 'title', 'Názov', 160), description: String(form.get('description') || ''), status: String(form.get('status')), assigneeId: form.get('assigneeId') || null, roomId: roomId || null }; if (task) payload.expectedRevision = task.revision; var data = await api('/api/workspace/tasks' + (task ? '/' + task.id : ''), { method: task ? 'PUT' : 'POST', body: payload }); if (task) { var i = ctx.tasks.findIndex(function (t) { return t.id === task.id; }); if (i >= 0) ctx.tasks[i] = data.task; } else ctx.tasks.unshift(data.task); redraw(); app().toast('Úloha je uložená.'); }, { submitLabel: 'Uložiť úlohu' });
  }
  function taskDelete(id) { var ctx = context(), task = ctx.tasks.find(function (t) { return t.id === id; }); if (!task) return; app().openModal('Odstrániť úlohu?', '<p>Odstrániš úlohu <strong>' + esc(task.title) + '</strong>.</p>', async function () { await api('/api/workspace/tasks/' + id, { method: 'DELETE', body: { expectedRevision: task.revision } }); ctx.tasks = ctx.tasks.filter(function (t) { return t.id !== id; }); redraw(); }, { submitLabel: 'Odstrániť úlohu' }); }
  async function moveTask(id, status) { var ctx = context(), task = ctx.tasks.find(function (t) { return t.id === id; }); if (!task || ['todo', 'doing', 'done'].indexOf(status) < 0) return; try { var data = await api('/api/workspace/tasks/' + id, { method: 'PUT', body: Object.assign({}, task, { status: status, expectedRevision: task.revision }) }); ctx.tasks[ctx.tasks.findIndex(function (t) { return t.id === id; })] = data.task; redraw(); } catch (error) { if (error.status === 409) await refreshContext(); throw error; } }
  function bindOnce() {
    if (listeners) return; listeners = true;
    document.addEventListener('input', captureInput);
    window.addEventListener('beforeunload', function (event) { if (hasUnsavedDrafts() || heldDrafts.size) { event.preventDefault(); event.returnValue = ''; } });
  }
  function captureInput(event) {
      if (event.target.id === 'mo-chat-input') chatDrafts[selectedChannel] = event.target.value;
      if (event.target.id === 'mo-document-title' || event.target.id === 'mo-document-body') { var editor = event.target.closest('.mo-page-editor'); if (!editor) return; var id = editor.dataset.pageId, page = context().pages.find(function (p) { return p.id === id; }); if (!page) return; var previous = drafts[keyFor(id)]; drafts[keyFor(id)] = { title: editor.querySelector('#mo-document-title').value, body: editor.querySelector('#mo-document-body').value, revision: previous ? previous.revision : page.revision, conflict: previous ? previous.conflict : false }; var indicator = (embedded || document).querySelector('.mo-document-toolbar > .muted'); if (indicator) indicator.textContent = 'Rozpracované zmeny'; }
  }
  function afterRender(view) {
    if (embedded) view = 'workspace';
    if (view !== 'academy' && view !== 'workspace') { if (currentView !== view) { loadSerial++; loading = false; } currentView = view; stopPoll(); return; }
    bindOnce(); if (!syncAccount()) { stopPoll(); return; }
    if (view === 'workspace' && !personal.loaded && !loading && !loadError) { run(loadPersonal()); return; }
    if (view === 'academy' && !selectedRoom && !roomsLoaded && !loading && !loadError) { run(loadRooms()); return; }
    if (view === 'academy' && selectedRoom && roomLoaded !== selectedRoom && !loading && !loadError) { run(loadRoom(selectedRoom)); return; }
    stopPoll();
    if (view === 'academy' && selectedRoom && academyTab === 'channels' && selectedChannel && roomLoaded === selectedRoom) {
      var form = document.getElementById('mo-chat-form'); if (form) { form.onsubmit = function (event) { event.preventDefault(); run(sendMessage(form)); }; var input = form.querySelector('textarea'); input.onkeydown = function (event) { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (form.reportValidity()) run(sendMessage(form)); } }; }
      run(fetchChat(false)); poll = setInterval(function () { if (!document.hidden) run(fetchChat(false)); }, 5000);
    }
  }
  function handleAction(action, element) {
    if (action.indexOf('academy-') !== 0) return false;
    var id = element.dataset.id;
    if (!syncAccount()) { app().toast('Najprv sa prihlás do svojho účtu.'); return true; }
    switch (action) {
      case 'academy-room-create': roomCreate(); break;
      case 'academy-join': roomJoin(); break;
      case 'academy-room-open': loadSerial++; loading = false; selectedRoom = id; shared = fresh(); roomLoaded = ''; selectedChannel = ''; academyTab = 'channels'; redraw(); break;
      case 'academy-lobby': loadSerial++; loading = false; selectedRoom = ''; stopPoll(); redraw(); break;
      case 'academy-tab': if (currentView === 'academy') academyTab = element.dataset.tab; else workspaceTab = element.dataset.tab; redraw(); break;
      case 'academy-refresh': run(currentView === 'workspace' ? loadPersonal() : selectedRoom ? loadRoom(selectedRoom) : loadRooms()); break;
      case 'academy-invite': app().openModal('Vytvoriť nový pozývací kód?', '<p>Pôvodný kód prestane fungovať. Súčasní členovia v miestnosti zostanú.</p>', async function () { var data = await api('/api/academy/rooms/' + selectedRoom + '/invite', { method: 'POST', body: {} }); showInvite(data.inviteCode); }, { submitLabel: 'Vytvoriť nový kód' }); break;
      case 'academy-copy-invite': run(navigator.clipboard.writeText(element.dataset.code).then(function () { app().toast('Kód je skopírovaný.'); })); break;
      case 'academy-channel-open': selectedChannel = id; redraw(); break;
      case 'academy-channel-create': app().openModal('Nový kanál', field('Názov kanála', 'name', '', { required: true, max: 80 }), async function (form) { var data = await api('/api/academy/rooms/' + selectedRoom + '/channels', { method: 'POST', body: { name: nonempty(form, 'name', 'Názov kanála', 80) } }); channels.push(data.channel); selectedChannel = data.channel.id; redraw(); }, { submitLabel: 'Vytvoriť kanál' }); break;
      case 'academy-chat-older': run(fetchChat(true)); break;
      case 'academy-page-create': pageCreate(); break;
      case 'academy-page-open': context().selectedPage = id; redraw(); break;
      case 'academy-page-save': run(pageSave(id)); break;
      case 'academy-page-delete': pageDelete(id); break;
      case 'academy-page-copy': var saved = drafts[keyFor(id)]; if (saved) run(navigator.clipboard.writeText(saved.title + '\n\n' + saved.body).then(function () { app().toast('Tvoj text je skopírovaný.'); })); break;
      case 'academy-page-reload': var draftKey = keyFor(id), pageContext = context(); app().openModal('Načítať uloženú verziu?', '<p>Rozpracované zmeny tejto stránky sa nahradia aktuálnou uloženou verziou. Ak ich chceš zachovať, najprv si ich skopíruj.</p>', async function () { var data = await api('/api/workspace/pages/' + id); var pageIndex = pageContext.pages.findIndex(function (p) { return p.id === id; }); if (pageIndex >= 0) pageContext.pages[pageIndex] = data.page; delete drafts[draftKey]; redraw(); }, { submitLabel: 'Načítať uloženú verziu' }); break;
      case 'academy-task-create': taskForm(); break;
      case 'academy-task-edit': taskForm(id); break;
      case 'academy-task-delete': taskDelete(id); break;
      case 'academy-task-status': run(moveTask(id, element.dataset.status)); break;
      default: return false;
    }
    return true;
  }
  function embed(target) {
    embedded = target;
    if (!target) return;
    if (!target.dataset.academyBound) {
      target.dataset.academyBound = 'true';
      target.addEventListener('input', captureInput);
      target.addEventListener('click', function (event) {
        if (embedded !== target) return;
        var button = event.target.closest('[data-action]');
        if (button) {
          handleAction(button.dataset.action, button);
          if (target.ownerDocument.defaultView !== window && document.querySelector('dialog[open]')) window.focus();
        }
      });
    }
    target.innerHTML = render('workspace'); afterRender('workspace');
  }
  window.MOAcademy = { render: render, embed: embed, handleAction: handleAction, afterRender: afterRender, hasUnsavedDrafts: hasUnsavedDrafts, destroy: function (options) { embedded = null; if (accountId) { if (options && options.preserveDraft && hasUnsavedDrafts()) heldDrafts.set(accountId, { drafts: drafts, chatDrafts: chatDrafts }); else heldDrafts.delete(accountId); } reset(); accountId = ''; currentView = ''; } };
})();
