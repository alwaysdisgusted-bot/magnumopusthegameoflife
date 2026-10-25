const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/library-categories.js'), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const categoryId = '22222222-2222-4222-8222-222222222222';
const photoId = '33333333-3333-4333-8333-333333333333';
const category = { id: categoryId, name: 'Filozofia', revision: 7, photoCount: 1 };
const photo = { id: photoId, caption: 'Poznámka', url: 'https://untrusted.example/photo.png', width: 100, height: 100 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(handler) {
  let account = owner, modal = null, closed = false;
  const calls = [], listeners = {}, elements = new Map();
  const document = {
    activeElement: null,
    addEventListener(name, callback) { listeners[name] = callback; },
    querySelector(selector) { return selector === '#modal [data-lc-modal]' && modal ? {} : null; },
    getElementById(id) { if (id === 'modal') return { open: !!modal, close() { closed = true; modal = null; } }; return elements.get(id) || null; }
  };
  const app = {
    esc(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
    icon() { return '<svg></svg>'; }, toast() {},
    openModal(title, html, callback, options) { modal = { title, html, callback, options }; },
    render() { api.afterRender('library'); }
  };
  const auth = { getAccount() { return account ? { id: account } : null; }, async api(path, options = {}) {
    calls.push({ path, options });
    if (handler) { const custom = handler(path, options); if (custom !== undefined) return custom; }
    return path.endsWith('/photos') ? { photos: [photo] } : { categories: [category] };
  } };
  const context = { window: { MOApp: app, MOAuth: auth }, document, URL, Map, WeakSet, Image: class {}, console };
  vm.runInNewContext(source, context);
  const api = context.window.MOLibraryCategories;
  return { api, calls, listeners, elements, get modal() { return modal; }, get closed() { return closed; }, setAccount(id) { account = id; }, async open() { await api.handleAction('lc-tab', { dataset: { tab: 'categories' } }); await tick(); await tick(); } };
}

test('renders escaped categories and captions and keeps photo requests on the private local route', async () => {
  const f = fixture(path => path.endsWith('/photos') ? { photos: [{ ...photo, caption: '<img onerror="bad">' }, { id: 'evil/id', url: 'https://evil.example' }] } : { categories: [{ ...category, name: '<script>bad</script>' }] });
  await f.open(); const html = f.api.render();
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/); assert.match(html, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.match(html, new RegExp('/api/library/photos/' + photoId)); assert.doesNotMatch(html, /https:\/\//); assert.doesNotMatch(html, /evil\/id/);
});

test('ignores reads completed after switching to another account', async () => {
  let resolve;
  const f = fixture(path => path === '/api/library/categories' ? new Promise(done => { resolve = done; }) : undefined);
  await f.api.handleAction('lc-tab', { dataset: { tab: 'categories' } });
  f.setAccount('44444444-4444-4444-8444-444444444444'); f.api.tabs();
  resolve({ categories: [{ ...category, name: 'PRIVATE OLD ACCOUNT' }] }); await tick();
  assert.doesNotMatch(f.api.render(), /PRIVATE OLD ACCOUNT/); assert.equal(f.api.isActive(), false);
});

test('creates categories through a validated modal without changing the game save', async () => {
  const f = fixture((path, options) => options.method === 'POST' ? { category: { ...category, name: options.body.name, photoCount: 0 } } : undefined);
  await f.open(); await f.api.handleAction('lc-create', { dataset: {} });
  await assert.rejects(f.modal.callback(new Map([['name', '   ']])), /Vyplň názov/);
  await f.modal.callback(new Map([['name', '  Moje poznámky  ']]));
  const call = f.calls.find(call => call.options.method === 'POST'); assert.equal(call.path, '/api/library/categories'); assert.equal(call.options.body.name, 'Moje poznámky');
  assert.match(f.api.render(), /Moje poznámky/);
});

test('renames using the category revision to prevent overwriting another update', async () => {
  const f = fixture((path, options) => options.method === 'PATCH' ? { category: { ...category, name: options.body.name, revision: 8 } } : undefined);
  await f.open(); await f.api.handleAction('lc-rename', { dataset: {} });
  await f.modal.callback(new Map([['name', 'Čítanie']]));
  const call = f.calls.find(call => call.options.method === 'PATCH'); assert.equal(call.path, '/api/library/categories/' + categoryId);
  assert.equal(call.options.body.expectedRevision, 7); assert.equal(call.options.body.name, 'Čítanie');
});

test('requires explicit product confirmation before deleting an individual photo', async () => {
  const f = fixture((path, options) => options.method === 'DELETE' ? { ok: true } : undefined);
  await f.open(); await f.api.handleAction('lc-delete-photo', { dataset: { id: photoId } });
  assert.equal(f.calls.some(call => call.options.method === 'DELETE'), false); assert.equal(f.modal.options.submitLabel, 'Odstrániť fotografiu');
  await f.modal.callback();
  const call = f.calls.find(call => call.options.method === 'DELETE'); assert.equal(call.path, '/api/library/photos/' + photoId); assert.deepEqual(Object.keys(call.options.body), []);
});

test('rejects SVG and excessive upload batches before reading or sending any image', async () => {
  const f = fixture(); await f.open(); await f.api.handleAction('lc-upload', { dataset: {} });
  const callback = f.modal.callback;
  await assert.rejects(callback({ getAll: () => [{ size: 10, type: 'image/svg+xml' }], get: () => '' }), /PNG, JPG alebo WebP/);
  await assert.rejects(callback({ getAll: () => Array.from({ length: 21 }, () => ({ size: 10, type: 'image/jpeg' })), get: () => '' }), /1 do 20/);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
});

test('horizontal keyboard scrolling leaves normal vertical page keys alone', () => {
  const f = fixture(); let prevented = 0, delta;
  const rail = { clientWidth: 500, scrollWidth: 2000, closest: () => rail, scrollBy(value) { delta = value; }, scrollTo(value) { delta = value; } };
  f.listeners.keydown({ target: rail, key: 'ArrowRight', preventDefault() { prevented++; } }); assert.equal(prevented, 1); assert.equal(delta.left, 400);
  f.listeners.keydown({ target: rail, key: 'ArrowDown', preventDefault() { prevented++; } }); assert.equal(prevented, 1);
  f.listeners.keydown({ target: rail, key: 'End', preventDefault() { prevented++; } }); assert.equal(delta.left, 2000);
});

test('logout clears category snapshots and closes only its own editor', async () => {
  const f = fixture(); await f.open(); await f.api.handleAction('lc-rename', { dataset: {} });
  f.api.destroy(); assert.equal(f.closed, true); assert.equal(f.api.isActive(), false); assert.doesNotMatch(f.api.render(), /OTVORENÁ KATEGÓRIA/);
});
