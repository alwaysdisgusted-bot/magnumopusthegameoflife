'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/academy.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function fixture(handler) {
  let user = { id: 'A', name: 'Čarodej A' }, view = '', html = '', modal, timerId = 0;
  const timers = new Map(), listeners = {}, requests = [], toasts = [], elements = new Map();
  const document = { hidden: false, addEventListener: (name, callback) => listeners[name] = callback, getElementById: id => elements.get(id) || null, querySelector: () => null };
  const window = {
    addEventListener: (name, callback) => listeners[name] = callback,
    MOAuth: { getAccount: () => user, api: async (path, options = {}) => { const request = { path, ...options }; requests.push(request); return handler(request); } },
    MOApp: { esc, icon: name => '<svg data-icon="' + name + '"></svg>', render() { html = window.MOAcademy.render(view); window.MOAcademy.afterRender(view); }, toast: text => toasts.push(text), openModal(title, content, callback) { modal = { title, content, callback }; } }
  };
  vm.runInNewContext(source, { window, document, navigator: { clipboard: { writeText: async () => {} } }, setInterval: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearInterval: id => timers.delete(id), setTimeout: callback => setImmediate(callback), clearTimeout, console });
  return { api: window.MOAcademy, timers, requests, listeners, elements, toasts, get html() { return html; }, get modal() { return modal; }, setUser(value) { user = value; }, render(next) { view = next; window.MOApp.render(); }, action(name, data = {}) { return window.MOAcademy.handleAction(name, { dataset: data }); } };
}

test('late responses from an old account cannot expose its personal pages after account switch', async () => {
  const old = deferred(); let calls = 0;
  const f = fixture(request => {
    if (request.path === '/api/workspace/pages') return ++calls === 1 ? old.promise : { pages: [{ id: 'new', title: 'Nový účet', body: 'Nové poznámky', revision: 1 }] };
    if (request.path === '/api/workspace/tasks') return { tasks: [] };
    throw Error(request.path);
  });
  f.render('workspace'); await flush();
  f.api.destroy(); f.setUser({ id: 'B', name: 'Čarodej B' }); f.render('workspace'); await flush();
  old.resolve({ pages: [{ id: 'secret', title: 'TAJNÉ ÚDAJE A', body: 'Súkromný obsah účtu A', revision: 1 }] }); await flush();
  assert.match(f.html, /Nový účet/); assert.ok(!f.html.includes('TAJNÉ ÚDAJE A')); assert.ok(!f.html.includes('Súkromný obsah účtu A'));
});

test('chat polling updates only messages, preserves the composer, and stops when leaving or logging out', async () => {
  let polls = 0;
  const f = fixture(request => {
    if (request.path === '/api/academy/rooms') return { rooms: [{ id: 'room', name: 'Naša miestnosť', isOwner: true }] };
    if (request.path.endsWith('/channels')) return { channels: [{ id: 'channel', name: 'všeobecne' }] };
    if (request.path.endsWith('/members')) return { members: [{ id: 'A', name: 'Čarodej A' }] };
    if (request.path.startsWith('/api/workspace/pages')) return { pages: [] };
    if (request.path.startsWith('/api/workspace/tasks')) return { tasks: [] };
    if (request.path.endsWith('/messages')) return { messages: [{ id: 'm' + ++polls, authorId: 'A', authorName: '<script>meno</script>', body: '<img onerror=x>', createdAt: '2026-10-18T20:00:00.000Z' }], hasMore: false };
    throw Error(request.path);
  });
  const input = { value: 'Rozpísaná správa' }, submit = { disabled: false }, form = { querySelector: selector => selector === 'textarea' ? input : submit, reportValidity: () => true };
  const list = { innerHTML: '', scrollHeight: 100, scrollTop: 0, clientHeight: 50 };
  f.elements.set('mo-chat-form', form); f.elements.set('mo-chat-messages', list);
  f.render('academy'); await flush(); f.action('academy-room-open', { id: 'room' }); await flush();
  assert.equal(f.timers.size, 1); assert.equal([...f.timers.values()][0].delay, 5000);
  f.listeners.input({ target: { id: 'mo-chat-input', value: input.value } });
  [...f.timers.values()][0].callback(); await flush();
  assert.equal(input.value, 'Rozpísaná správa'); assert.match(list.innerHTML, /&lt;img onerror=x&gt;/); assert.ok(!list.innerHTML.includes('<script>'));
  f.render('gym'); assert.equal(f.timers.size, 0);
  f.render('academy'); await flush(); assert.equal(f.timers.size, 1);
  f.api.destroy(); assert.equal(f.timers.size, 0);
});

test('page drafts survive rerenders and remote updates; a stale save never silently overwrites another revision', async () => {
  let revision = 1;
  const f = fixture(request => {
    if (request.path === '/api/workspace/pages') return { pages: [{ id: 'page', title: '<Názov>', body: revision === 1 ? 'Pôvodná stránka' : 'Novšia uložená stránka', revision, updatedAt: '2026-10-18T20:00:00.000Z' }] };
    if (request.path === '/api/workspace/tasks') return { tasks: [] };
    if (request.path === '/api/workspace/pages/page' && request.method === 'PUT') { const error = Error('Stránka sa zmenila.'); error.status = 409; throw error; }
    if (request.path === '/api/workspace/pages/page') return { page: { id: 'page', title: '<Názov>', body: 'Novšia uložená stránka', revision: 2 } };
    throw Error(request.path);
  });
  f.render('workspace'); await flush(); assert.match(f.html, /&lt;Názov&gt;/);
  const editor = { dataset: { pageId: 'page' }, querySelector: selector => ({ value: selector.includes('title') ? 'Môj nový názov' : 'Moje rozpísané myšlienky' }) };
  f.listeners.input({ target: { id: 'mo-document-body', closest: () => editor } });
  f.render('workspace'); assert.match(f.html, /Moje rozpísané myšlienky/);
  revision = 2; f.action('academy-refresh'); await flush(); assert.match(f.html, /Moje rozpísané myšlienky/);
  f.action('academy-page-save', { id: 'page' }); await flush();
  assert.equal(f.requests.find(r => r.method === 'PUT').body.expectedRevision, 1);
  assert.match(f.html, /novšiu uloženú verziu/); assert.match(f.html, /Moje rozpísané myšlienky/);
  f.action('academy-page-reload', { id: 'page' }); await f.modal.callback(new Map()); await flush(); assert.match(f.html, /Novšia uložená stránka/); assert.ok(!f.html.includes('Moje rozpísané myšlienky'));
});

test('mutations returning after logout are discarded and do not create a visible former-account room', async () => {
  const pending = deferred();
  const f = fixture(request => request.path === '/api/academy/rooms' && request.method === 'POST' ? pending.promise : { rooms: [] });
  f.render('academy'); await flush(); f.action('academy-room-create');
  const promise = f.modal.callback(new Map([['name', 'Súkromná miestnosť A']]));
  f.api.destroy(); f.setUser({ id: 'B', name: 'B' }); f.render('academy'); await flush();
  pending.resolve({ room: { id: 'old-room', name: 'Súkromná miestnosť A' }, inviteCode: 'AAAAAAAAAAAAAAAA' });
  await assert.rejects(promise, /Prihlásenie sa zmenilo/); await flush(); assert.ok(!f.html.includes('Súkromná miestnosť A'));
});

test('expired sessions keep drafts in memory for their account without showing them to another account', async () => {
  const f = fixture(request => request.path === '/api/workspace/pages' ? { pages: [{ id: 'page', title: 'Poznámky', body: 'Uložené', revision: 1 }] } : { tasks: [] });
  f.render('workspace'); await flush();
  const editor = { dataset: { pageId: 'page' }, querySelector: selector => ({ value: selector.includes('title') ? 'Rozpracovaný názov A' : 'Tajný rozpracovaný obsah A' }) };
  f.listeners.input({ target: { id: 'mo-document-body', closest: () => editor } });
  assert.equal(f.api.hasUnsavedDrafts(), true);
  f.api.destroy({ preserveDraft: true }); f.setUser({ id: 'B', name: 'B' }); f.render('workspace'); await flush();
  assert.ok(!f.html.includes('Tajný rozpracovaný obsah A'));
  f.api.destroy(); f.setUser({ id: 'A', name: 'A' }); f.render('workspace'); await flush();
  assert.match(f.html, /Tajný rozpracovaný obsah A/); assert.match(f.html, /Rozpracovaný názov A/);
});

test('failed replacement-page fetch never deletes the existing draft', async () => {
  const f = fixture(request => {
    if (request.path === '/api/workspace/pages') return { pages: [{ id: 'page', title: 'Poznámky', body: 'Uložené', revision: 1 }] };
    if (request.path === '/api/workspace/tasks') return { tasks: [] };
    throw Error('Momentálne bez spojenia');
  });
  f.render('workspace'); await flush();
  const editor = { dataset: { pageId: 'page' }, querySelector: selector => ({ value: selector.includes('title') ? 'Názov' : 'Dôležitá neuložená myšlienka' }) };
  f.listeners.input({ target: { id: 'mo-document-body', closest: () => editor } });
  f.action('academy-page-reload', { id: 'page' }); await assert.rejects(f.modal.callback(new Map()), /bez spojenia/);
  f.render('workspace'); assert.match(f.html, /Dôležitá neuložená myšlienka/);
});

test('editing during a pending stale save marks the live draft as conflicted', async () => {
  const pending = deferred();
  const f = fixture(request => {
    if (request.path === '/api/workspace/pages') return { pages: [{ id: 'page', title: 'Poznámky', body: 'Uložené', revision: 1 }] };
    if (request.path === '/api/workspace/tasks') return { tasks: [] };
    return pending.promise.then(() => { const error = Error('Stránka sa zmenila'); error.status = 409; throw error; });
  });
  f.render('workspace'); await flush(); let body = 'Prvá zmena';
  const editor = { dataset: { pageId: 'page' }, querySelector: selector => ({ value: selector.includes('title') ? 'Názov' : body }) };
  f.listeners.input({ target: { id: 'mo-document-body', closest: () => editor } }); f.action('academy-page-save', { id: 'page' });
  body = 'Ďalšia myšlienka počas ukladania'; f.listeners.input({ target: { id: 'mo-document-body', closest: () => editor } }); pending.resolve(); await flush();
  assert.match(f.html, /novšiu uloženú verziu/); assert.match(f.html, /Ďalšia myšlienka počas ukladania/);
});

test('switching rooms during a pending load starts the newly selected room and ignores old results', async () => {
  const old = deferred();
  const f = fixture(request => {
    if (request.path === '/api/academy/rooms') return { rooms: [{ id: 'room-A', name: 'Miestnosť A' }, { id: 'room-B', name: 'Miestnosť B' }] };
    if (request.path === '/api/academy/rooms/room-A/channels') return old.promise;
    if (request.path.endsWith('/channels')) return { channels: [{ id: 'channel-B', name: 'Kanál B' }] };
    if (request.path.endsWith('/members')) return { members: [] };
    if (request.path.startsWith('/api/workspace/pages')) return { pages: [] };
    if (request.path.startsWith('/api/workspace/tasks')) return { tasks: [] };
    if (request.path.endsWith('/messages')) return { messages: [], hasMore: false };
    throw Error(request.path);
  });
  f.render('academy'); await flush(); f.action('academy-room-open', { id: 'room-A' }); await flush();
  f.action('academy-lobby'); f.action('academy-room-open', { id: 'room-B' }); await flush();
  assert.match(f.html, /Kanál B/); assert.ok(!f.html.includes('Pripravujem tvoj priestor'));
  old.resolve({ channels: [{ id: 'channel-A', name: 'Starý kanál A' }] }); await flush();
  assert.match(f.html, /Kanál B/); assert.ok(!f.html.includes('Starý kanál A'));
});
